import { useEffect, useRef, useState } from "preact/hooks"
import type { State } from "../../src/db"
import { cancelAlarm, notify, scheduleAlarm, settleAlarm } from "../alarm"

// Round 1 to 3 with a rest between them, plus the confirmation in front of
// throwing a session away. All three states live in one component because the
// round counter, the buttons and the confirm share the same place.
//
// This screen exists only while a session runs. The recorded chain and its Start
// button are the idle screen, so there is no "Ready" state here: the reps are
// frozen from the state the app had when Start was pressed.
export function SessionFlow(props: {
  state: State
  onComplete: (reps: number, previousRecord: number) => Promise<void>
  onExit: () => void
}) {
  const { state, onComplete, onExit } = props

  const [round, setRound] = useState(1)
  const [sessionReps] = useState(state.nextReps)
  const [remaining, setRemaining] = useState(0)
  const [counting, setCounting] = useState(false)
  const [paused, setPaused] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [previousRecord] = useState(state.maxPushups)
  const [busy, setBusy] = useState(false)
  // Epoch milliseconds the rest ends at. The countdown is derived from this
  // rather than decremented, so a backgrounded tab that misses every tick still
  // reports the right number when it comes back.
  const [endsAt, setEndsAt] = useState<number | null>(null)
  // Set when the browser refused to play the cue, so the panel can say why
  // nothing was heard.
  const [cueBlocked, setCueBlocked] = useState(false)

  function deadlineFrom(seconds: number): number {
    return Date.now() + seconds * 1000
  }

  function secondsLeft(deadline: number): number {
    return Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
  }

  // A rest settles once, however many things notice that it is over.
  const settled = useRef(true)

  // Everything about a running rest lives here, and the round moves on from
  // inside the tick rather than from an effect.
  //
  // An effect runs after a paint, and a backgrounded page does not paint, so an
  // effect is the one place this cannot be decided. A timer callback plus the
  // visibility change covers both cases. Either the page is running and the
  // timer fires, or the page was away and the listener resolves it when it
  // returns.
  useEffect(() => {
    if (!counting || paused || endsAt === null) return
    const deadline = endsAt

    const settle = () => {
      if (settled.current) return
      settled.current = true
      const heard = settleAlarm()
      setCounting(false)
      setPaused(false)
      setEndsAt(null)
      setRemaining(0)
      setRound((value) => value + 1)
      setCueBlocked(!heard)
      notify("Rest over", "Next round when you are ready")
    }

    const tick = () => {
      const left = secondsLeft(deadline)
      setRemaining(left)
      if (left === 0) settle()
    }

    tick()
    const id = setInterval(tick, 250)
    document.addEventListener("visibilitychange", tick)
    window.addEventListener("pageshow", tick)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", tick)
      window.removeEventListener("pageshow", tick)
    }
  }, [counting, paused, endsAt])

  // Leaving the panel stops the cue, so a tone cannot fire into a screen that is
  // no longer showing a rest.
  useEffect(() => () => cancelAlarm(), [])

  const resting = counting && !confirming
  const working = !counting && !confirming
  const stopping = confirming

  function beginRest() {
    settled.current = false
    setCueBlocked(false)
    const deadline = deadlineFrom(state.restSeconds)
    setEndsAt(deadline)
    setRemaining(secondsLeft(deadline))
    setCounting(true)
    setPaused(false)
    scheduleAlarm(state.restSeconds)
  }

  function togglePause() {
    if (paused) {
      settled.current = false
      const deadline = deadlineFrom(remaining)
      setEndsAt(deadline)
      setPaused(false)
      scheduleAlarm(remaining)
      return
    }
    // Freeze the value first, then drop the deadline so the tick stops.
    cancelAlarm()
    setRemaining(endsAt === null ? remaining : secondsLeft(endsAt))
    setEndsAt(null)
    setPaused(true)
  }

  function abandon() {
    cancelAlarm()
    // The chain is the idle screen again, and the session left no trace: the
    // hub was never told about it.
    onExit()
  }

  function skipRest() {
    cancelAlarm()
    setCounting(false)
    setPaused(false)
    setRemaining(0)
    setEndsAt(null)
    setRound((value) => value + 1)
  }

  async function complete() {
    if (sessionReps <= 0 || busy) return
    cancelAlarm()
    setBusy(true)
    try {
      // The parent records the session and swaps this screen for the
      // congratulations, so there is nothing to reset here.
      await onComplete(sessionReps, previousRecord)
    } finally {
      setBusy(false)
    }
  }

  function next() {
    if (counting) return
    if (round >= state.rounds) {
      void complete()
      return
    }
    beginRest()
  }

  const headline = stopping
    ? "Stop current session?"
    : counting
      ? `${remaining}s`
      : `${sessionReps}× Push-ups`

  const primaryLabel = round >= state.rounds ? "Done" : "Next"

  return (
    <div class="card" style={{ gap: "var(--s4)" }}>
      <div
        class="mono-num center"
        style={{
          fontSize: stopping ? "18px" : counting ? "32px" : "26px",
          color: counting ? "var(--accent)" : "var(--fg)",
          minHeight: "56px",
          display: "grid",
          placeItems: "center",
        }}
      >
        {headline}
      </div>

      {!stopping && (
        <div class="center muted" style={{ fontSize: "13px" }}>
          {counting ? "Rest, pause or skip" : `Round ${round} / ${state.rounds}`}
        </div>
      )}

      {!stopping && (
        <div class="dots">
          {Array.from({ length: state.rounds }, (_, index) => {
            const step = index + 1
            const background =
              step === round ? "var(--accent)" : step < round ? "var(--fg)" : "var(--line)"
            return <span key={step} style={{ background }} />
          })}
        </div>
      )}

      <div class="row" style={{ gap: "var(--s3)" }}>
        {resting && (
          <button type="button" onClick={togglePause}>
            {paused ? "Continue" : "Pause"}
          </button>
        )}
        {resting && (
          <button type="button" onClick={skipRest}>
            Skip
          </button>
        )}

        {working && (
          <button type="button" onClick={() => setConfirming(true)}>
            Stop
          </button>
        )}

        {stopping && (
          <button type="button" onClick={abandon}>
            No
          </button>
        )}

        {working && (
          <button type="button" class="primary" disabled={busy} onClick={next}>
            {primaryLabel}
          </button>
        )}

        {stopping && (
          <button type="button" class="primary" onClick={abandon}>
            Yes
          </button>
        )}
      </div>

      {cueBlocked && (
        <div class="center" style={{ fontSize: "11px", lineHeight: 1.5, color: "var(--keep)" }}>
          The rest ended, but this browser would not play the cue. Allow audio for this site in its
          settings.
        </div>
      )}

      <div class="center faint" style={{ fontSize: "11px", lineHeight: 1.5 }}>
        Next: within 2 days +1 • day 3 keep • day 4+ −1
      </div>
    </div>
  )
}

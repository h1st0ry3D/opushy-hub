import { useEffect, useRef, useState } from "preact/hooks"
import type { State } from "../../src/db"
import { cancelAlarm, notify, playAlarm, resumeAudio, scheduleAlarm, settleAlarm } from "../alarm"
import { keepScreenAwake, releaseScreen } from "../awake"
import { softenReps } from "../status"

// The question in front of either way out of a round: throwing the session away,
// or taking two reps off it. It lives in the app rather than here because the
// header's close button asks the first one and this screen's Yes and No answer
// it, so two components have to agree on it.
export type SessionQuestion = null | "stop" | "too-hard"

// Round 1 to 3 with a rest between them, plus the two questions in front of
// ending one early. All of these states live in one component because the round
// counter, the buttons and the questions share the same place.
//
// This screen exists only while a session runs. The recorded chain and its Start
// button are the idle screen, so there is no "Ready" state here: the reps are
// frozen from the state the app had when Start was pressed, and only "Too Hard"
// moves them from there.
export function SessionFlow(props: {
  state: State
  question: SessionQuestion
  onQuestion: (question: SessionQuestion) => void
  onComplete: (reps: number, previousRecord: number) => Promise<void>
  onExit: () => void
}) {
  const { state, question, onQuestion, onComplete, onExit } = props

  const [round, setRound] = useState(1)
  // Frozen at Start, and moved only by "Too Hard": the rest of the session runs
  // at whatever this says, and it is what complete() records.
  const [sessionReps, setSessionReps] = useState(state.nextReps)
  const [remaining, setRemaining] = useState(0)
  const [counting, setCounting] = useState(false)
  const [paused, setPaused] = useState(false)
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
  // no longer showing a rest. Any tap also gives iOS the gesture it needs to
  // resume audio, which is how a cue that ended while the phone slept is heard.
  useEffect(() => {
    const tap = () => {
      if (resumeAudio()) setCueBlocked(false)
    }
    document.addEventListener("pointerdown", tap)
    return () => {
      document.removeEventListener("pointerdown", tap)
      cancelAlarm()
      releaseScreen()
    }
  }, [])

  const asking = question !== null
  const stopping = question === "stop"
  const softening = question === "too-hard"
  const resting = counting && !asking
  const working = !counting && !asking

  // A locked screen stops the audio clock, so the rest holds the screen on for
  // its own length. The lock is released on pause, skip, end and unmount.
  useEffect(() => {
    if (!counting || paused) return
    keepScreenAwake()
    return () => releaseScreen()
  }, [counting, paused])

  // The stop question is reachable from the header at any point, rest included,
  // and a rest left running would end under the question and move the round on
  // behind the answer. Opened over a rest, it is frozen the same way Pause
  // freezes it, and Continue resumes it if the answer is No.
  useEffect(() => {
    if (question !== "stop" || !counting || paused) return
    cancelAlarm()
    setRemaining(endsAt === null ? remaining : secondsLeft(endsAt))
    setEndsAt(null)
    setPaused(true)
    // Only the question opening is the trigger here; the rest is what it acts on,
    // and re-running on every tick would freeze it a second time.
  }, [question])

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
    // Skipping ends the rest the way the clock would, so the cue plays now
    // instead of at the old deadline. It is also the quickest way to check the
    // sound without waiting out a rest.
    playAlarm()
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
      // congratulations, so there is nothing to reset here. What it records is
      // the reps the last round actually ran at, softened or not, so the next
      // session is still one more than that.
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

  // "Too Hard" asks first, and only on Yes does it take the two reps off. The
  // round then ends the way Done ends it, so the rounds that are left run at the
  // smaller number.
  function tooHard() {
    onQuestion(null)
    if (counting) return
    setSessionReps((value) => softenReps(value))
    next()
  }

  const headline = stopping
    ? "Stop current session?"
    : softening
      ? "Reduce reps by 2?"
      : counting
        ? `${remaining}s`
        : `${sessionReps}× Push-ups`

  const primaryLabel = round >= state.rounds ? "Finish" : "Done"
  // Only the rounds with something still ahead of them can be softened: the last
  // one finishes the session instead.
  const canSoften = round < state.rounds

  return (
    <div class="card" style={{ gap: "var(--s4)" }}>
      <div
        class="mono-num center"
        style={{
          fontSize: asking ? "18px" : counting ? "32px" : "26px",
          color: counting && !asking ? "var(--accent)" : "var(--fg)",
          minHeight: "56px",
          display: "grid",
          placeItems: "center",
        }}
      >
        {headline}
      </div>

      {softening && (
        <div class="center muted" style={{ fontSize: "13px", lineHeight: 1.5 }}>
          {sessionReps}× → {softenReps(sessionReps)}× for the rest of the session
        </div>
      )}

      {!asking && (
        <div class="center muted" style={{ fontSize: "13px" }}>
          {counting ? "Rest, pause or skip" : `Round ${round} / ${state.rounds}`}
        </div>
      )}

      {!asking && (
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

        {working && canSoften && (
          <button type="button" onClick={() => onQuestion("too-hard")}>
            Too Hard
          </button>
        )}

        {/* Either question is answered by the same pair, and No is the same
            move for both: the question closes and nothing else changes. */}
        {asking && (
          <button type="button" onClick={() => onQuestion(null)}>
            No
          </button>
        )}

        {working && (
          <button type="button" class="primary" disabled={busy} onClick={next}>
            {primaryLabel}
          </button>
        )}

        {asking && (
          <button type="button" class="primary" onClick={softening ? tooHard : abandon}>
            Yes
          </button>
        )}
      </div>

      {cueBlocked && (
        <div class="center" style={{ fontSize: "11px", lineHeight: 1.5, color: "var(--keep)" }}>
          The rest ended while the page was asleep, so the cue could not play. Tap the screen to
          hear it.
        </div>
      )}

      <div class="center faint" style={{ fontSize: "11px", lineHeight: 1.5 }}>
        Next: within 2 days +1 • day 3 keep • day 4+ −1
      </div>
    </div>
  )
}

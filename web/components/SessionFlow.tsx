import { useEffect, useState } from "preact/hooks"
import type { State } from "../../src/db"

// Round 1 to 3 with a rest between them, plus the confirmation in front of
// throwing a session away. All three states live in one component because the
// round counter, the buttons and the confirm share the same place.
export function SessionFlow(props: {
  state: State
  onComplete: (reps: number, previousRecord: number) => Promise<void>
}) {
  const { state, onComplete } = props

  const [round, setRound] = useState(0)
  const [sessionReps, setSessionReps] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [counting, setCounting] = useState(false)
  const [paused, setPaused] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [previousRecord, setPreviousRecord] = useState(0)
  const [busy, setBusy] = useState(false)

  // One tick a second while a rest runs. `remaining` sits in the dependency
  // list, so the effect re-arms the timer after each tick.
  useEffect(() => {
    if (!counting || paused) return
    const id = setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(id)
  }, [counting, paused, remaining])

  // A rest only ever runs between rounds, so it can only move forward one.
  useEffect(() => {
    if (!counting || remaining > 0) return
    setCounting(false)
    setPaused(false)
    setRound((value) => value + 1)
  }, [counting, remaining])

  const resting = counting && !confirming
  const working = !counting && !confirming
  const stopping = confirming

  function start() {
    setPreviousRecord(state.maxPushups)
    setSessionReps(state.nextReps)
    setRound(1)
    setCounting(false)
    setPaused(false)
    setRemaining(0)
    setConfirming(false)
  }

  function beginRest() {
    setRemaining(state.restSeconds)
    setCounting(true)
    setPaused(false)
  }

  async function complete() {
    if (sessionReps <= 0 || busy) return
    setBusy(true)
    try {
      await onComplete(sessionReps, previousRecord)
      setRound(0)
      setSessionReps(0)
    } finally {
      setBusy(false)
    }
  }

  function next() {
    if (round === 0) return start()
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
      : round > 0
        ? `${sessionReps}× Push-ups`
        : `Ready: ${state.nextReps}×`

  const primaryLabel = round === 0 ? "Start" : round >= state.rounds ? "Done" : "Next"

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
          {counting ? "Rest, pause or skip" : `Round ${round || 1} / ${state.rounds}`}
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
          <button type="button" onClick={() => setPaused((value) => !value)}>
            {paused ? "Continue" : "Pause"}
          </button>
        )}
        {resting && (
          <button
            type="button"
            onClick={() => {
              setCounting(false)
              setPaused(false)
              setRemaining(0)
              setRound((value) => value + 1)
            }}
          >
            Skip
          </button>
        )}

        {working && round > 0 && (
          <button type="button" onClick={() => setConfirming(true)}>
            Stop
          </button>
        )}

        {stopping && (
          <button
            type="button"
            onClick={() => {
              setConfirming(false)
              setRound(0)
              setSessionReps(0)
              setRemaining(0)
              setCounting(false)
            }}
          >
            No
          </button>
        )}

        {working && (
          <button type="button" class="primary" disabled={busy} onClick={next}>
            {primaryLabel}
          </button>
        )}

        {stopping && (
          <button
            type="button"
            class="primary"
            onClick={() => {
              setConfirming(false)
              setRound(0)
              setSessionReps(0)
              setRemaining(0)
              setCounting(false)
            }}
          >
            Yes
          </button>
        )}
      </div>

      <div class="center faint" style={{ fontSize: "11px", lineHeight: 1.5 }}>
        Next: within 2 days +1 • day 3 keep • day 4+ −1
      </div>
    </div>
  )
}

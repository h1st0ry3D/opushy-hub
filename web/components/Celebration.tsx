import type { State } from "../../src/db"
import { colourFor, isRecord } from "../status"

// The path of each confetti bit is a hash of its index, so there is no state to
// keep. The animation is CSS only and the overlay captures no input.
export function Confetti() {
  const bits = Array.from({ length: 32 }, (_, index) => {
    const r1 = ((index * 9301 + 49297) % 233280) / 233280
    const r2 = (((index + 7) * 4703 + 7919) % 199999) / 199999
    const r3 = (((index + 13) * 2711 + 104729) % 150001) / 150001
    return {
      left: `${Math.round(r1 * 100)}%`,
      animationDuration: `${Math.round(1100 + r3 * 1500)}ms`,
      animationDelay: `${Math.round(r2 * 900)}ms`,
      fontSize: `${Math.round(13 + r3 * 12)}px`,
      colour: colourFor(index % 3 === 0 ? 1 : index % 3 === 1 ? 0 : -1),
      char: ",-."[index % 3],
      drift: `${Math.round((r1 - 0.5) * 90)}px`,
    }
  })

  return (
    <div class="confetti" aria-hidden="true">
      {bits.map((bit, index) => (
        <i
          key={index}
          style={{
            left: bit.left,
            color: bit.colour,
            fontSize: bit.fontSize,
            animationDuration: bit.animationDuration,
            animationDelay: bit.animationDelay,
            "--drift": bit.drift,
          }}
        >
          {bit.char}
        </i>
      ))}
    </div>
  )
}

// What replaces the countdown once the last round is recorded. The session is
// already on the hub at this point, so this screen only reports.
export function Celebration(props: {
  reps: number
  previousRecord: number
  newRecord: boolean
  rounds: number
  onFinish: () => void
}) {
  const { reps, previousRecord, newRecord, rounds, onFinish } = props

  return (
    <>
      <Confetti />
      <div class="overlay">
        <div class="card" style={{ gap: "var(--s3)", textAlign: "center", maxWidth: "360px" }}>
          <div
            class="mono-num"
            style={{ fontSize: "24px", color: newRecord ? "var(--accent)" : "var(--fg)" }}
          >
            {newRecord ? "NEW RECORD" : "GREAT PROGRESS"}
          </div>

          <div class="mono-num" style={{ fontSize: "56px" }}>
            {reps}×
          </div>

          <div class="muted" style={{ fontSize: "13px" }}>
            {newRecord
              ? `Past your record of ${previousRecord}×`
              : `${rounds} rounds, ${reps * rounds} push-ups`}
          </div>

          <div style={{ fontSize: "12px", color: "var(--on-track)" }}>
            Come back within 2 days to keep the chain green
          </div>

          <button type="button" class="primary" onClick={onFinish}>
            Finish
          </button>
        </div>
      </div>
    </>
  )
}

export type Celebration = {
  reps: number
  previousRecord: number
  newRecord: boolean
  rounds: number
}

export function celebrationFrom(state: State, reps: number, previousRecord: number): Celebration {
  return { reps, previousRecord, newRecord: isRecord(reps, previousRecord), rounds: state.rounds }
}

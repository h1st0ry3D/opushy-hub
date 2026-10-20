import { useState } from "preact/hooks"

// First run asks for the most pushups you can do in one go. Everything else follows from
// it, so this is the only number the app ever asks for.
export function Setup(props: { onSave: (maxPushups: number) => Promise<void> }) {
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const value = Math.floor(Number(draft))
  const valid = Number.isFinite(value) && value >= 1 && value <= 10000

  async function submit(event: Event) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      await props.onSave(value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form class="card" onSubmit={submit} style={{ gap: "var(--s4)" }}>
      <div class="mono-num" style={{ fontSize: "20px" }}>
        First setup
      </div>
      <div class="muted" style={{ fontSize: "13px", lineHeight: 1.5 }}>
        How many pushups can you do in one go? The first target is three quarters of that, then it
        follows how long you have been away.
      </div>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={10000}
        placeholder="e.g. 26"
        value={draft}
        onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
        autofocus
      />
      <button type="submit" class="primary" disabled={!valid || busy}>
        {busy ? "Saving…" : "Start training"}
      </button>
    </form>
  )
}

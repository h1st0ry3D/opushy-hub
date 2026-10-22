import { useEffect, useState } from "preact/hooks"
import type { State } from "../src/db"
import { askNotifyPermission, unlockAudio } from "./alarm"
import { api, getToken, HttpError, setToken } from "./api"
import {
  Celebration,
  type Celebration as CelebrationModel,
  celebrationFrom,
} from "./components/Celebration"
import { DayBubble } from "./components/DayBubble"
import { HistoryStrip } from "./components/HistoryStrip"
import { SessionFlow } from "./components/SessionFlow"
import { Setup } from "./components/Setup"
import { pageCount } from "./status"

export function App() {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState("")
  const [needToken, setNeedToken] = useState(getToken() === "")
  // One screen at a time, like the panel: the recorded chain until Start is
  // pressed, then the session, then the congratulations. The chain is not on
  // screen while a session runs, so a round cannot be mistaken for it.
  const [training, setTraining] = useState(false)
  const [page, setPage] = useState(0)
  const [celebrating, setCelebrating] = useState<CelebrationModel | null>(null)

  // Every load lands on the newest page, which is what the bar does after it
  // reads the file. Paging back is still possible, the next load returns here.
  function applyState(next: State) {
    setState(next)
    setPage(Math.max(0, pageCount(next) - 1))
  }

  async function refresh() {
    try {
      const next = await api.state()
      applyState(next)
      setError("")
    } catch (cause) {
      if (cause instanceof HttpError && cause.status === 401) setNeedToken(true)
      setError(cause instanceof Error ? cause.message : "request failed")
    }
  }

  useEffect(() => {
    if (!needToken) void refresh()
  }, [needToken])

  async function complete(reps: number, previousRecord: number) {
    const result = await api.commit(new Date().toISOString(), reps)
    applyState(result)
    // The session is recorded before the congratulations appear, so the screen
    // behind them is already the next run's chain.
    setTraining(false)
    setCelebrating(celebrationFrom(result, reps, previousRecord))
  }

  function startTraining() {
    // The Start tap is the gesture that lets the browser play the rest cue
    // later, so audio and notifications are unlocked from here, not from the
    // session screen.
    unlockAudio()
    askNotifyPermission()
    setTraining(true)
  }

  async function saveMax(value: number) {
    applyState(await api.setMax(value))
  }

  if (needToken) {
    return (
      <TokenCard
        onSave={(value) => {
          setToken(value)
          setNeedToken(value.trim() === "")
        }}
      />
    )
  }

  if (!state) {
    return (
      <div class="card">
        <div class="muted">{error ? `Could not reach the hub: ${error}` : "Loading…"}</div>
        {error && (
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        )}
      </div>
    )
  }

  if (state.maxPushups === 0) {
    return (
      <>
        <Setup onSave={saveMax} />
        {error && <div class="toast">{error}</div>}
      </>
    )
  }

  const pageTotal = pageCount(state)

  return (
    <>
      <div class="row" style={{ gap: "var(--s4)" }}>
        <DayBubble
          daysSinceLast={state.daysSinceLast}
          everTrained={state.everTrained}
          status={state.status}
        />
        <div style={{ flex: 1 }}>
          <div class="mono-num" style={{ fontSize: "20px" }}>
            Opushy
          </div>
          <div class="muted" style={{ fontSize: "12px" }}>
            Record: {state.maxPushups}× • Round: {state.reps}× • {state.trainingDays} days
          </div>
        </div>
        <button
          type="button"
          class="ghost"
          style={{ flex: "0 0 44px", minHeight: "44px" }}
          aria-label="Refresh"
          onClick={() => void refresh()}
        >
          ⟳
        </button>
      </div>

      {training ? (
        <SessionFlow state={state} onComplete={complete} onExit={() => setTraining(false)} />
      ) : (
        <div class="card">
          <div class="mono-num center" style={{ fontSize: "16px" }}>
            My Activity
          </div>
          <HistoryStrip
            history={state.history}
            page={page}
            pageSize={state.pageSize}
            pageCount={pageTotal}
            onPage={setPage}
          />
          <div class="center faint" style={{ fontSize: "11px" }}>
            On track 2 days or less • Keep 3 days • Drop 4 days or more
          </div>
          <button type="button" class="primary" onClick={startTraining}>
            Start
          </button>
        </div>
      )}

      {error && <div class="toast">{error}</div>}

      {celebrating && (
        <Celebration
          reps={celebrating.reps}
          previousRecord={celebrating.previousRecord}
          newRecord={celebrating.newRecord}
          rounds={celebrating.rounds}
          onFinish={() => setCelebrating(null)}
        />
      )}
    </>
  )
}

// The phone pastes this once. It lives in localStorage, and the hub writes its
// own copy to data/token on first boot, so there is nothing to configure on the
// NAS side.
function TokenCard(props: { onSave: (value: string) => void }) {
  const [draft, setDraft] = useState("")

  return (
    <form
      class="card"
      onSubmit={(event) => {
        event.preventDefault()
        if (draft.trim()) props.onSave(draft)
      }}
    >
      <div class="mono-num" style={{ fontSize: "18px" }}>
        Pair this device
      </div>
      <div class="muted" style={{ fontSize: "13px", lineHeight: 1.5 }}>
        Paste the token from <code>data/token</code> on the hub. It is the only secret in the setup.
      </div>
      <input
        type="password"
        placeholder="token"
        value={draft}
        onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
        autofocus
      />
      <button type="submit" class="primary" disabled={!draft.trim()}>
        Save
      </button>
    </form>
  )
}

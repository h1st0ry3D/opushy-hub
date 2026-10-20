// The hub's storage is two tables and raw SQL, with no ORM.
//
// sessions holds the only stored fact. Everything else in the plugin's document
// is derived here, so two devices cannot disagree about how many training days
// there have been.
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { type HistoryEntry, rules } from "./rules"

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id     TEXT PRIMARY KEY,
  time   TEXT NOT NULL,
  reps   INTEGER NOT NULL,
  device TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS sessions_by_time ON sessions (time);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

export type StoredSession = { id: string; time: string; reps: number; device: string }
export type HistoryEntryWithStatus = HistoryEntry & { id: string; status: number }

export type State = {
  rev: number
  now: string
  maxPushups: number
  reps: number
  nextReps: number
  lastTrainingDate: string
  trainingDays: number
  daysSinceLast: number
  status: number
  everTrained: boolean
  rounds: number
  restSeconds: number
  pageSize: number
  history: HistoryEntryWithStatus[]
}

// The id is a hash of the session's own contents, so the same session offered
// twice by two devices collapses into one row. `time` carries milliseconds, so a
// collision means the same event was written twice.
export function sessionId(time: string, reps: number): string {
  return createHash("sha256").update(`${time}|${reps}`).digest("hex").slice(0, 32)
}

export type Hub = ReturnType<typeof createHub>

export function createHub(path: string) {
  const db = new Database(path, { create: true })
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec(SCHEMA)

  const readMeta = db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?")
  const writeMeta = db.query<null, [string, string]>(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
  const listSessions = db.query<StoredSession, []>(
    "SELECT id, time, reps, device FROM sessions ORDER BY time ASC, id ASC",
  )
  const insertSession = db.query<null, [string, string, number, string]>(
    "INSERT OR IGNORE INTO sessions (id, time, reps, device) VALUES (?, ?, ?, ?)",
  )

  function meta(key: string): string | null {
    return readMeta.get(key)?.value ?? null
  }

  function bumpRev(): number {
    const next = Number(meta("rev") ?? "0") + 1
    writeMeta.run("rev", String(next))
    return next
  }

  function maxPushups(): number {
    return Number(meta("maxPushups") ?? "0")
  }

  function state(nowMs: number): State {
    const rows = listSessions.all()
    const history: HistoryEntry[] = rows.map((row) => ({ time: row.time, reps: row.reps }))
    const last = rows.at(-1)
    const max = maxPushups()
    const storedReps = last ? last.reps : rules.baseReps(max)
    const lastTrainingDate = last?.time ?? ""
    const everTrained = lastTrainingDate !== ""
    const daysSinceLast = everTrained
      ? rules.daysSince(lastTrainingDate, nowMs)
      : rules.UNKNOWN_DAYS

    return {
      rev: Number(meta("rev") ?? "0"),
      now: new Date(nowMs).toISOString(),
      maxPushups: max,
      reps: storedReps,
      nextReps: rules.nextReps(max, storedReps, lastTrainingDate, nowMs),
      lastTrainingDate,
      trainingDays: rows.length,
      daysSinceLast,
      status: everTrained ? rules.statusForDays(daysSinceLast) : rules.ON_TRACK,
      everTrained,
      rounds: rules.ROUNDS,
      restSeconds: rules.REST_SECONDS,
      pageSize: rules.PAGE_SIZE,
      history: rows.map((row, index) => ({
        id: row.id,
        time: row.time,
        reps: row.reps,
        status: rules.historyValue(history, index),
      })),
    }
  }

  // Anything the caller cannot prove is a real session is dropped, not stored,
  // and the rest of the batch still lands.
  function upsert(sessions: HistoryEntry[], device: string): { added: number; skipped: number } {
    let added = 0
    let skipped = 0
    let highest = 0
    for (const entry of sessions) {
      if (!rules.isValidTimestamp(entry.time)) {
        skipped += 1
        continue
      }
      const reps = Math.min(rules.MAX_REPS, Math.max(0, Math.floor(entry.reps)))
      const result = insertSession.run(sessionId(entry.time, reps), entry.time, reps, device)
      if (result.changes > 0) {
        added += 1
        highest = Math.max(highest, reps)
      } else {
        skipped += 1
      }
    }
    if (added > 0) {
      // The plugin lets a chain that outgrows its own record raise the record.
      // Same rule here, so the two sides cannot disagree about what a record is.
      if (highest > maxPushups()) writeMeta.run("maxPushups", String(highest))
      bumpRev()
    }
    return { added, skipped }
  }

  // The record only ever goes up, so a stale client cannot lower it.
  function setMax(value: number): void {
    const next = Math.min(rules.MAX_REPS, Math.max(1, Math.floor(value)))
    if (next === maxPushups()) return
    if (next < maxPushups()) return
    writeMeta.run("maxPushups", String(next))
    bumpRev()
  }

  function count(): number {
    return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sessions").get()?.n ?? 0
  }

  // The exact shape state/opushy-state.py writes, so a hub can be poured back
  // into the plugin's own file and read by any client that speaks that schema.
  function document() {
    const current = state(Date.now())
    return {
      maxPushups: current.maxPushups,
      reps: current.reps,
      lastTrainingDate: current.lastTrainingDate,
      trainingDays: current.trainingDays,
      history: current.history.map((entry) => ({ time: entry.time, reps: entry.reps })),
    }
  }

  return { state, document, upsert, setMax, count, close: () => db.close(), db }
}

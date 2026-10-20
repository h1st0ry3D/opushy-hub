// Copy a local tracker file into the hub.
//
// The hub stores the sessions, so the first run needs the history that already
// sits in the plugin's own file. The whole history goes out in one request, and
// the upsert makes a second run add nothing.
//
// The record is sent separately. A session's reps is the target that session
// asked for, and maxPushups can sit above every one of them, so the hub cannot
// work it out from the history alone.
//
//   OPSHUB_TOKEN=... OPSHUB_URL=http://nas:8080 bun scripts/seed.ts ~/.local/state/opushy/opushy_activity.json
import { readFileSync } from "node:fs"

type LocalEntry = { time?: string; ts?: string; reps: number }
type LocalDocument = { maxPushups?: number; history?: LocalEntry[] }
type State = { maxPushups: number; trainingDays: number; nextReps: number }
type SeedResult = State & { added: number; skipped: number }

const path = process.argv[2]
if (!path) {
  console.error("usage: OPSHUB_TOKEN=... bun scripts/seed.ts <opushy_activity.json>")
  process.exit(2)
}

const base = process.env.OPSHUB_URL ?? "http://127.0.0.1:8080"
const token =
  process.env.OPSHUB_TOKEN ??
  readFileSync(`${process.env.OPSHUB_DATA ?? "./data"}/token`, "utf8").trim()

const local = JSON.parse(readFileSync(path, "utf8")) as LocalDocument
// `ts` is what builds before the rename wrote. Reading both means an old export
// can be poured in without editing it first.
const sessions = (local.history ?? [])
  .map((entry) => ({ time: entry.time ?? entry.ts ?? "", reps: entry.reps }))
  .filter((entry) => entry.time !== "")

async function call<T>(method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    console.error(`hub refused ${method} ${route}: ${response.status} ${await response.text()}`)
    process.exit(1)
  }
  return (await response.json()) as T
}

const seeded = await call<SeedResult>("POST", "/api/sessions", { device: "pc", sessions })
console.log(`offered ${sessions.length} sessions: added ${seeded.added}, already there ${seeded.skipped}`)

if (local.maxPushups && local.maxPushups > seeded.maxPushups) {
  const raised = await call<State>("PUT", "/api/max", { maxPushups: local.maxPushups })
  console.log(`record raised from ${seeded.maxPushups} to ${raised.maxPushups}`)
}

const state = await call<State>("GET", "/api/state")
console.log(`hub now: ${state.trainingDays} days, record ${state.maxPushups}×, next ${state.nextReps}×`)

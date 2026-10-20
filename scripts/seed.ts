// Copy a local tracker file into the hub.
//
// The hub stores the sessions, so the first run needs the history that already
// sits in the plugin's own file. The whole history goes out in one request, and
// the upsert makes a second run add nothing.
//
//   bun scripts/seed.ts ~/.local/state/opushy/opushy_activity.json
import { readFileSync } from "node:fs"

type LocalDocument = { history?: { time: string; reps: number }[] }
type SeedResult = { added: number; skipped: number; trainingDays: number; maxPushups: number }

const path = process.argv[2]
if (!path) {
  console.error("usage: bun scripts/seed.ts <opushy_activity.json>")
  process.exit(2)
}

const base = process.env.OPSHUB_URL ?? "http://127.0.0.1:8080"
const token =
  process.env.OPSHUB_TOKEN ?? readFileSync(`${process.env.OPUSHY_DATA ?? "./data"}/token`, "utf8").trim()

const local = JSON.parse(readFileSync(path, "utf8")) as LocalDocument
const sessions = (local.history ?? []).map(({ time, reps }) => ({ time, reps }))

const response = await fetch(`${base}/api/sessions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ device: "pc", sessions }),
})

if (!response.ok) {
  console.error(`hub refused the batch: ${response.status} ${await response.text()}`)
  process.exit(1)
}

const result = (await response.json()) as SeedResult
console.log(`offered ${sessions.length} sessions: added ${result.added}, already there ${result.skipped}`)
console.log(`hub now: ${result.trainingDays} days, record ${result.maxPushups}×`)

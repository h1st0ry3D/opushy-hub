// The hub's own tests. Nothing binds a socket, because Hono's fetch handler
// takes a Request directly. The whole API runs in process against an in-memory
// database.
import { describe, expect, test } from "bun:test"
import { createApi } from "../src/api"
import { createHub, sessionId } from "../src/db"
import { rules } from "../src/rules"

const TOKEN = "test-token"

function setup() {
  const hub = createHub(":memory:")
  const api = createApi(hub, TOKEN)
  const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }
  return { hub, api, auth }
}

async function post(
  api: ReturnType<typeof setup>["api"],
  auth: Record<string, string>,
  path: string,
  body: unknown,
) {
  return api.request(path, { method: "POST", headers: auth, body: JSON.stringify(body) })
}

describe("auth", () => {
  test("health is open so a container healthcheck works", async () => {
    const { api } = setup()
    const response = await api.request("/api/health")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, sessions: 0 })
  })

  test("every other route needs the token", async () => {
    const { api } = setup()
    expect((await api.request("/api/state")).status).toBe(401)
    expect(
      (await api.request("/api/state", { headers: { authorization: "Bearer nope" } })).status,
    ).toBe(401)
  })
})

describe("state", () => {
  test("an empty hub reports a first run", async () => {
    const { api, auth } = setup()
    const state = (await (await api.request("/api/state", { headers: auth })).json()) as {
      maxPushups: number
      nextReps: number
    }
    expect(state.maxPushups).toBe(0)
    expect(state.nextReps).toBe(0)
  })

  test("the record follows the chain up and never down", async () => {
    const { api, auth, hub } = setup()

    const first = await post(api, auth, "/api/sessions", {
      device: "web",
      sessions: [{ time: "2026-10-01T10:00:00.000Z", reps: 26 }],
    })
    expect((await first.json()) as { maxPushups: number }).toMatchObject({ maxPushups: 26 })

    // A stale client offering a lower record cannot lower it.
    const lower = await api.request("/api/max", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ maxPushups: 10 }),
    })
    expect((await lower.json()) as { maxPushups: number }).toMatchObject({ maxPushups: 26 })
    expect(hub.count()).toBe(1)
  })
})

describe("export", () => {
  test("the export is the plugin's own document shape", async () => {
    const { api, auth } = setup()
    await post(api, auth, "/api/sessions", {
      device: "pc",
      sessions: [
        { time: "2026-10-01T10:00:00.000Z", reps: 18 },
        { time: "2026-10-03T10:00:00.000Z", reps: 20 },
      ],
    })

    const doc = (await (await api.request("/api/export", { headers: auth })).json()) as Record<
      string,
      unknown
    >
    expect(Object.keys(doc).sort()).toEqual([
      "history",
      "lastTrainingDate",
      "maxPushups",
      "reps",
      "trainingDays",
    ])
    expect(doc).toMatchObject({
      maxPushups: 20,
      reps: 20,
      lastTrainingDate: "2026-10-03T10:00:00.000Z",
      trainingDays: 2,
    })
    // The helper's schema drops id, device and status, so they are not sent.
    expect(doc.history).toEqual([
      { time: "2026-10-01T10:00:00.000Z", reps: 18 },
      { time: "2026-10-03T10:00:00.000Z", reps: 20 },
    ])
  })
})

describe("sessions", () => {
  test("the same session offered twice by two devices is stored once", async () => {
    const { api, auth, hub } = setup()
    const session = { time: "2026-10-01T10:00:00.000Z", reps: 18 }

    const first = (await (
      await post(api, auth, "/api/sessions", { device: "web", sessions: [session] })
    ).json()) as { added: number }
    const second = (await (
      await post(api, auth, "/api/sessions", { device: "pc", sessions: [session] })
    ).json()) as { added: number; skipped: number }

    expect(first.added).toBe(1)
    expect(second).toMatchObject({ added: 0, skipped: 1 })
    expect(hub.count()).toBe(1)
  })

  test("an unusable timestamp is dropped, the rest of the batch lands", async () => {
    const { api, auth, hub } = setup()
    const response = await post(api, auth, "/api/sessions", {
      device: "pc",
      sessions: [
        { time: "not a date", reps: 18 },
        { time: "2026-10-02T10:00:00.000Z", reps: 19 },
      ],
    })
    expect((await response.json()) as unknown).toMatchObject({ added: 1, skipped: 1 })
    expect(hub.count()).toBe(1)
  })

  test("a bad body is a 400, not a 500", async () => {
    const { api, auth } = setup()
    const response = await post(api, auth, "/api/sessions", {
      sessions: [{ time: 5, reps: "many" }],
    })
    expect(response.status).toBe(400)
  })

  test("the session id is content addressed", () => {
    expect(sessionId("2026-10-01T10:00:00.000Z", 18)).toBe(
      sessionId("2026-10-01T10:00:00.000Z", 18),
    )
    expect(sessionId("2026-10-01T10:00:00.000Z", 18)).not.toBe(
      sessionId("2026-10-01T10:00:00.001Z", 18),
    )
  })
})

describe("this repo does not fork the rules", () => {
  test("the vendored Progression.js still matches the plugin's copy", async () => {
    const pluginUrl = new URL("../../opushy/core/Progression.js", import.meta.url)
    const plugin = Bun.file(pluginUrl)
    if (!(await plugin.exists())) return // sibling checkout absent, nothing to compare
    const vendored = Bun.file(new URL("../core/Progression.js", import.meta.url))
    expect(await vendored.text()).toBe(await plugin.text())
  })

  test("the target the hub reports is the one the plugin would pick", () => {
    // Same inputs the plugin passes, straight from core/Progression.js.
    const now = Date.parse("2026-10-09T12:00:00.000Z")
    const cases = [
      { max: 40, stored: 18, last: "", want: rules.baseReps(40) },
      { max: 40, stored: 18, last: "2026-10-08T12:00:00.000Z", want: 19 },
      { max: 40, stored: 18, last: "2026-10-06T12:00:00.000Z", want: 18 },
      { max: 40, stored: 18, last: "2026-10-01T12:00:00.000Z", want: 13 },
    ]
    for (const item of cases) {
      expect(rules.nextReps(item.max, item.stored, item.last, now)).toBe(item.want)
    }
  })
})

// The HTTP surface. Four routes, one of which is open so the container
// healthcheck can reach it without a secret.
import { timingSafeEqual } from "node:crypto"
import { Hono } from "hono"
import { z } from "zod"
import type { Hub } from "./db"

const sessionBatch = z.object({
  device: z.string().min(1).max(32).default("unknown"),
  sessions: z
    .array(
      z.object({
        time: z.string().min(1).max(32),
        reps: z.number().int().min(0).max(10000),
      }),
    )
    .max(400),
})

const maxBody = z.object({ maxPushups: z.number().int().min(1).max(10000) })

function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createApi(hub: Hub, token: string) {
  const app = new Hono()

  // This route sits above the token guard on purpose. A healthcheck that needs
  // a secret fails for the wrong reason.
  app.get("/api/health", (c) => c.json({ ok: true, sessions: hub.count() }))

  app.use("/api/*", async (c, next) => {
    const header = c.req.header("authorization") ?? ""
    const given = header.startsWith("Bearer ") ? header.slice(7) : ""
    if (!secretMatches(given, token)) return c.json({ error: "unauthorized" }, 401)
    await next()
  })

  app.get("/api/state", (c) => c.json(hub.state(Date.now())))

  // The plugin's own document shape, so `state merge` on the desktop can be fed
  // straight from here and a backup is one curl.
  app.get("/api/export", (c) => c.json(hub.document()))

  app.post("/api/sessions", async (c) => {
    const body = sessionBatch.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: "bad request", issues: body.error.issues }, 400)
    const result = hub.upsert(body.data.sessions, body.data.device)
    return c.json({ ...hub.state(Date.now()), ...result })
  })

  app.put("/api/max", async (c) => {
    const body = maxBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: "bad request", issues: body.error.issues }, 400)
    hub.setMax(body.data.maxPushups)
    return c.json(hub.state(Date.now()))
  })

  return app
}

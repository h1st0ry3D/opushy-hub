// Bun.serve with one HTML entry point.
//
// `import ... with { type: "html" }` is what makes this a single code path: Bun
// bundles the .tsx behind index.html itself, so there is no build step, no watch
// process and no dist/ directory to fall out of date.
//
// The dev script runs `bun --watch` and not `--hot`. A hot reload re-evaluates
// this module while the old process still holds the socket, which ends in
// EADDRINUSE. A watch restart closes the server first.
import index from "../web/index.html" with { type: "html" }
import { createApi } from "./api"
import { createHub } from "./db"
import { env } from "./env"

const hub = createHub(env.dbPath)
const app = createApi(hub, env.token)

const server = Bun.serve({
  port: env.port,
  development: !env.isProd,
  routes: {
    "/api/*": (request: Request) => app.fetch(request),
    "/*": index,
  },
})

console.log(`opushy-hub on http://0.0.0.0:${server.port}  db=${env.dbPath}`)
console.log(`opushy-hub sessions=${hub.count()}  token=${env.token.slice(0, 6)}…`)

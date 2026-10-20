// Bun.serve with one entry point, chosen by mode.
//
// Development imports web/index.html with `{ type: "html" }` and Bun bundles the
// .tsx behind it on request, which is what makes `bun --watch` enough. Production
// serves the same files after `bun build` has written them to dist/, because
// bundling during a request produced an empty response inside the container.
import { serveStatic } from "hono/bun"
import index from "../web/index.html" with { type: "html" }
import { createApi } from "./api"
import { createHub } from "./db"
import { env } from "./env"

const hub = createHub(env.dbPath)
const app = createApi(hub, env.token)

if (env.isProd) {
  // dist/ is built by the Dockerfile. `path` covers the root, `root` covers the
  // hashed asset names it emits beside index.html.
  app.get("/", serveStatic({ path: "./dist/index.html" }))
  app.use("/*", serveStatic({ root: "./dist" }))
}

const server = env.isProd
  ? Bun.serve({
      port: env.port,
      development: false,
      routes: { "/*": (request: Request) => app.fetch(request) },
    })
  : Bun.serve({
      port: env.port,
      development: true,
      routes: {
        "/api/*": (request: Request) => app.fetch(request),
        "/*": index,
      },
    })

console.log(`opushy-hub on http://0.0.0.0:${server.port}  db=${env.dbPath}`)
console.log(`opushy-hub sessions=${hub.count()}  token=${env.token.slice(0, 6)}…`)
console.log(
  `opushy-hub mode=${env.isProd ? "production, serving dist/" : "development, bundling web/"}`,
)

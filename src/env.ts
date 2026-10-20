// Configuration, and the token that stops this from being an open endpoint.
//
// A LAN is not a trust boundary. Any browser tab on any device can POST to an
// unauthenticated port, so the hub mints a token on first boot, writes it with
// mode 0600 next to the database, and the phone pastes it once.
import { randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

function loadToken(dbPath: string): string {
  const explicit = process.env.OPSHUB_TOKEN_FILE
  if (explicit) return readFileSync(explicit, "utf8").trim()

  const inline = (process.env.OPSHUB_TOKEN ?? "").trim()
  if (inline) return inline

  const path = join(dirname(dbPath), "token")
  if (existsSync(path)) return readFileSync(path, "utf8").trim()

  mkdirSync(dirname(dbPath), { recursive: true })
  const token = randomBytes(24).toString("hex")
  writeFileSync(path, `${token}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  console.log(`opushy-hub: no token found, wrote one to ${path}`)
  return token
}

const dbPath = process.env.OPSHUB_DB ?? "./data/hub.sqlite"

export const env = {
  port: Number(process.env.PORT ?? 8080),
  dbPath,
  token: loadToken(dbPath),
  isProd: process.env.NODE_ENV === "production",
}

// One fetch wrapper, with no query library. The app has one read and two writes.
import type { State } from "../src/db"

const TOKEN_KEY = "opushy.token"

export type CommitResult = State & { added: number; skipped: number }

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ""
  } catch {
    return ""
  }
}

export function setToken(value: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, value.trim())
  } catch {
    /* private mode: the token just does not survive a reload */
  }
}

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new HttpError(response.status, detail || response.statusText)
  }
  return (await response.json()) as T
}

export const api = {
  state: () => call<State>("/state"),

  commit: (time: string, reps: number, device = "web") =>
    call<CommitResult>("/sessions", {
      method: "POST",
      body: JSON.stringify({ device, sessions: [{ time, reps }] }),
    }),

  setMax: (maxPushups: number) =>
    call<State>("/max", { method: "PUT", body: JSON.stringify({ maxPushups }) }),
}

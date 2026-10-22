// A rest is longer than the phone's auto-lock, and the cue is scheduled on the
// audio clock. Once the screen locks, iOS freezes the page and its audio
// context, so the tone never fires and no later resume can bring back a clock
// that was stopped. Holding the screen awake for the rest is the only way to
// keep the page running for it.
//
// The wake lock is refused outside a secure context, in Low Power Mode and by
// browsers without the API. It is also released by the browser whenever the
// page is hidden, so a lock taken before a background trip is taken again when
// the page comes back.
type WakeLock = {
  request(type: "screen"): Promise<WakeLockSentinelLike>
}

type WakeLockSentinelLike = {
  release(): Promise<void>
  addEventListener(type: "release", listener: () => void): void
}

let sentinel: WakeLockSentinelLike | null = null
let wanted = false
let listening = false

function wakeLock(): WakeLock | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock
}

async function request(): Promise<void> {
  const lock = wakeLock()
  if (!lock || !wanted || sentinel) return
  try {
    const held = await lock.request("screen")
    // The rest may have ended while the request was in flight.
    if (!wanted) {
      void held.release()
      return
    }
    sentinel = held
    held.addEventListener("release", () => {
      if (sentinel === held) sentinel = null
    })
  } catch {
    // Low Power Mode, a hidden page or an insecure origin. The cue still works
    // while the screen stays on by itself.
  }
}

function watchVisibility(): void {
  if (listening) return
  listening = true
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void request()
  })
}

export function keepScreenAwake(): void {
  wanted = true
  watchVisibility()
  void request()
}

export function releaseScreen(): void {
  wanted = false
  const held = sentinel
  sentinel = null
  if (held) void held.release().catch(() => {})
}

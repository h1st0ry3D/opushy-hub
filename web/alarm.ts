// The end-of-rest cue, scheduled on the audio clock rather than fired by a
// timer.
//
// A JavaScript timer is throttled to about one tick a minute in a background
// tab, and suspended outright when iOS backgrounds the app, so a setTimeout for
// forty-five seconds is not a reliable way to make a sound. Web Audio keeps its
// own clock: a tone scheduled for a future time plays then, even if the page has
// not run any script since. Where the operating system suspends the audio
// context too, nothing can play until the page resumes, and the countdown still
// reports the right value because it is derived from a timestamp.
let context: AudioContext | null = null
let tones: OscillatorNode[] = []

function audio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null
  if (!context) context = new AudioContext()
  return context
}

export function unlockAudio(): void {
  const ctx = audio()
  // Browsers start a context suspended until a gesture, so the first tap on
  // Start is what makes the later cue possible.
  if (ctx && ctx.state === "suspended") void ctx.resume()
}

function beep(ctx: AudioContext, at: number): OscillatorNode {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = "sine"
  oscillator.frequency.setValueAtTime(880, at)
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(0.25, at + 0.01)
  gain.gain.setValueAtTime(0.25, at + 0.16)
  gain.gain.linearRampToValueAtTime(0, at + 0.18)
  oscillator.connect(gain).connect(ctx.destination)
  oscillator.start(at)
  oscillator.stop(at + 0.2)
  return oscillator
}

export function cancelAlarm(): void {
  for (const tone of tones) {
    try {
      tone.stop()
    } catch {
      // already stopped or never started
    }
  }
  tones = []
}

// Two short tones, two thirds of a second apart, so it is noticed over whatever
// else is playing.
export function playAlarm(): void {
  const ctx = audio()
  if (!ctx) return
  if (ctx.state === "suspended") void ctx.resume()
  cancelAlarm()
  const start = ctx.currentTime + 0.02
  tones = [beep(ctx, start), beep(ctx, start + 0.33)]
}

// Scheduled relative to now, so a paused and resumed rest gets a new deadline
// and a new cue.
export function scheduleAlarm(seconds: number): void {
  const ctx = audio()
  if (!ctx) return
  if (ctx.state === "suspended") void ctx.resume()
  cancelAlarm()
  const start = ctx.currentTime + Math.max(0, seconds)
  tones = [beep(ctx, start), beep(ctx, start + 0.33)]
}

// A notification would be the reliable way to reach someone outside the page.
// It needs a secure context, so on plain http over the LAN there is nothing to
// ask for and nothing to show. This becomes live the day the hub speaks https.
export function notify(title: string, body: string): void {
  if (typeof Notification === "undefined") return
  if (!window.isSecureContext) return
  if (Notification.permission !== "granted") return
  new Notification(title, { body })
}

export function askNotifyPermission(): void {
  if (typeof Notification === "undefined") return
  if (!window.isSecureContext) return
  if (Notification.permission === "default") void Notification.requestPermission()
}

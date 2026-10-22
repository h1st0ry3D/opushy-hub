// The end-of-rest cue is scheduled on the audio clock instead of fired by a
// timer.
//
// A JavaScript timer drops to about one tick a minute in a background tab, and
// stops entirely when iOS backgrounds the app, so a setTimeout for forty-five
// seconds is not a reliable way to make a sound. Web Audio keeps its own clock,
// so a tone scheduled for a future time plays then, even if the page has not run
// any script since. Where the operating system suspends the audio context too,
// nothing can play until the page resumes, and the countdown still reports the
// right value because it is derived from a timestamp.
let context: AudioContext | null = null
let tones: OscillatorNode[] = []
// The audio-clock time the cue was scheduled for, so the rest can tell whether
// the cue played or the clock never got there.
let scheduledAt = 0
// Set when a rest ended while the context was not running, so the next tap can
// replay the cue instead of leaving the rest silent.
let missedCue = false
// When the cue was missed, so a stale one is not replayed much later.
let missedAt = 0

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } }

function audio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null
  if (!context) {
    context = new AudioContext()
    // Safari treats Web Audio as "ambient" unless told otherwise, and the
    // ring/silent switch mutes that. "playback" routes the cue like media, so
    // it is heard with the phone on silent. The API arrived in Safari 16.4;
    // everywhere else this line does nothing.
    const session = (navigator as AudioSessionNavigator).audioSession
    if (session) session.type = "playback"
  }
  return context
}

// A resume outside a tap is refused by iOS, which is why every caller ignores
// the outcome: the tone stays queued on the audio clock and plays whenever the
// context does come back.
function resume(ctx: AudioContext): void {
  if (ctx.state === "running") return
  void ctx.resume().catch(() => {})
}

export function unlockAudio(): void {
  const ctx = audio()
  if (!ctx) return
  // Browsers start a context suspended until a gesture, so the first tap on
  // Start is what makes the later cue possible. resume() alone is not enough in
  // Safari: a source node started in the same gesture is what unlocks output.
  resume(ctx)
  const silent = ctx.createBufferSource()
  silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
  silent.connect(ctx.destination)
  silent.start(0)
}

// Called on any tap. It brings an interrupted context back and replays a cue
// that ended while the phone was asleep, which is the only moment iOS lets
// audio start again. True when that replay happened.
export function resumeAudio(): boolean {
  const ctx = audio()
  if (!ctx) return false
  resume(ctx)
  if (!missedCue) return false
  missedCue = false
  if (Date.now() - missedAt > 60_000) return false
  cancelAlarm()
  playAlarm()
  return true
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
  resume(ctx)
  cancelAlarm()
  const start = ctx.currentTime + 0.02
  scheduledAt = start
  tones = [beep(ctx, start), beep(ctx, start + 0.33)]
}

// Scheduled relative to now, so a paused and resumed rest gets a new deadline
// and a new cue.
export function scheduleAlarm(seconds: number): void {
  const ctx = audio()
  if (!ctx) return
  resume(ctx)
  cancelAlarm()
  missedCue = false
  const start = ctx.currentTime + Math.max(0, seconds)
  scheduledAt = start
  tones = [beep(ctx, start), beep(ctx, start + 0.33)]
}

// Called when a rest ends. The tone is left alone if the audio clock reached it.
// Stopping it there is what silenced it before. The cue starts on the deadline
// and the check runs up to a quarter of a second later, so cancelling at that
// point stopped the cue before it played, or part way through it.
//
// If the clock never arrived the tone did not play, because the context was
// suspended while the screen was off. The tone is queued anyway, so it sounds
// as soon as a tap resumes the context, and resumeAudio() replays it if the
// queue was lost. The return value says whether audio is running now, which the
// panel uses to explain that the cue will need a tap.
export function settleAlarm(): boolean {
  const ctx = audio()
  if (!ctx) return false
  if (ctx.state === "running" && ctx.currentTime >= scheduledAt - 0.05) {
    missedCue = false
    return true
  }
  cancelAlarm()
  playAlarm()
  const running = ctx.state === "running"
  missedCue = !running
  missedAt = Date.now()
  return running
}

// A notification would be the reliable way to reach someone outside the page.
// It needs a secure context, so on plain http over the LAN there is nothing to
// ask for and nothing to show. This becomes live the day the hub speaks https.
// iOS also ignores `new Notification`; it needs a service worker behind it.
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

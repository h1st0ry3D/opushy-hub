// The three status colours, mirrored from the plugin's ui/Status.js so the phone
// and the bar cannot disagree about what green means.
import type { State } from "../src/db"

export const ON_TRACK = 1
export const KEEP = 0
export const DROP = -1

const COLOURS: Record<number, string> = {
  [ON_TRACK]: "var(--on-track)",
  [KEEP]: "var(--keep)",
  [DROP]: "var(--drop)",
}

export function colourFor(value: number): string {
  return COLOURS[value] ?? "var(--drop)"
}

export function labelFor(value: number): string {
  if (value === ON_TRACK) return "On track (2 days or less)"
  if (value === KEEP) return "Keep (3 days)"
  return "Drop (4 days or more)"
}

// Progression.daysSince returns 999 for a timestamp it cannot read, and three
// characters is already the widest a small disc takes.
export function dayLabel(everTrained: boolean, days: number): string {
  if (!everTrained) return "∞"
  return days > 99 ? "99" : `${days}d`
}

export function isRecord(target: number, maxPushups: number): boolean {
  return target > maxPushups
}

export function pageCount(state: State): number {
  return Math.max(1, Math.ceil(state.history.length / state.pageSize))
}

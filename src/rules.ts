// The training rules, loaded from the plugin's own file instead of copied.
//
// core/Progression.js is a QML script library. It exports nothing and starts
// with `.pragma library`, and everything it declares becomes a property of the
// context it runs in. So it is evaluated in a bare vm context and read back,
// which is what tests/qmllibrary.mjs does in the plugin repo. Both sides then
// run one implementation of the progression.
import { readFileSync } from "node:fs"
import vm from "node:vm"

export type HistoryEntry = { time: string; reps: number }

export type Rules = {
  ROUNDS: number
  REST_SECONDS: number
  PAGE_SIZE: number
  HISTORY_MAX: number
  MAX_REPS: number
  ON_TRACK: number
  KEEP: number
  DROP: number
  UNKNOWN_DAYS: number
  MS_PER_DAY: number
  fallback: number
  baseReps(maxPushups: number): number
  nextReps(maxPushups: number, storedReps: number, lastTrainingDate: string, nowMs: number): number
  isRecord(target: number, maxPushups: number): boolean
  daysSince(value: string, nowMs: number): number
  statusForDays(days: number): number
  historyValue(history: HistoryEntry[], index: number): number
  isValidTimestamp(value: unknown): boolean
  entryTime(entry: unknown): string
  entryReps(entry: unknown): number
  msUntilNextDay(nowMs: number): number
}

function load(): Rules {
  const source = readFileSync(new URL("../core/Progression.js", import.meta.url), "utf8")
  // `.pragma library` is a QML directive, not JavaScript.
  const js = source.replace(/^\s*\.pragma library\s*$/m, "")
  const context = vm.createContext({
    Math,
    Date,
    JSON,
    Number,
    String,
    Array,
    Object,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    RegExp,
    console,
  })
  vm.runInContext(js, context, { filename: "core/Progression.js" })
  return context as unknown as Rules
}

export const rules = load()

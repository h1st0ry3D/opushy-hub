// The training rules, as pure functions. Time is passed in as `nowMs`; nothing
// here calls Date.now().
.pragma library

// ---- session shape ----
var ROUNDS = 3
var REST_SECONDS = 45

// ---- day thresholds ----
// <=2 days since the last session adds one rep, day 3 keeps the stored value,
// day 4 and later decay by one per extra day.
var ON_TRACK_MAX_DAYS = 2
var KEEP_DAYS = 3
var MS_PER_DAY = 86400000
// What an unusable date reads as: far past the decay threshold.
var UNKNOWN_DAYS = 999

var BASE_RATIO = 0.75

// ---- storage limits, mirrored in state/opushy-state.py ----
var MAX_REPS = 10000
var MAX_TRAINING_DAYS = 1000000
var HISTORY_MAX = 400
var MAX_TS_LEN = 32

// ---- history strip ----
var PAGE_SIZE = 7

// ---- status values (the colours are in ui/Status.js) ----
var ON_TRACK = 1
var KEEP = 0
var DROP = -1

// An ISO-8601 UTC instant, as produced by Date.toISOString(). Fractional
// seconds are 3 digits from toISOString() and 6 from Python, so 1 to 6 are
// accepted. A local time or a date without a zone is not a timestamp.
var TS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/

function isValidTimestamp(value) {
    return typeof value === "string" && value.length <= MAX_TS_LEN && TS_PATTERN.test(value)
}

// Milliseconds since the epoch, or NaN when the value is not a timestamp.
function parseTimestamp(value) {
    if (!isValidTimestamp(value)) return NaN
    var ms = Date.parse(value)
    return isFinite(ms) ? ms : NaN
}

// Whole days between a stored timestamp and `nowMs`. A date in the future gives
// a negative count, which reads as recent.
function daysSince(value, nowMs) {
    var ms = parseTimestamp(value)
    if (!isFinite(ms)) return UNKNOWN_DAYS
    return Math.floor((nowMs - ms) / MS_PER_DAY)
}

// Ms from `nowMs` to the next day boundary, so a day count can be re-evaluated
// when it actually changes. daysSince counts whole 24h periods from a UTC
// instant, so the boundary is UTC midnight rather than local midnight, and the
// caller has to follow it or the count flips at the wrong hour. The few seconds
// of slack keep the tick off the boundary itself, where a session saved a
// moment earlier would already read as the day before.
function msUntilNextDay(nowMs) {
    var d = new Date(nowMs)
    var next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 3)
    return Math.max(1000, next - nowMs)
}

function statusForDays(days) {
    if (days <= ON_TRACK_MAX_DAYS) return ON_TRACK
    if (days === KEEP_DAYS) return KEEP
    return DROP
}

function baseReps(maxPushups) {
    if (!(maxPushups > 0)) return 0
    return Math.max(1, Math.floor(maxPushups * BASE_RATIO))
}

// The number of reps the next session asks for. It never writes and never
// raises the stored max.
function nextReps(maxPushups, storedReps, lastTrainingDate, nowMs) {
    var base = baseReps(maxPushups)
    if (base <= 0) return 0
    if (!lastTrainingDate) return base
    var stored = storedReps > 0 ? storedReps : base
    var days = daysSince(lastTrainingDate, nowMs)
    if (days <= ON_TRACK_MAX_DAYS) return Math.min(MAX_REPS, stored + 1)
    if (days === KEEP_DAYS) return stored
    return Math.max(1, stored - (days - KEEP_DAYS))
}

// A record is beaten, not matched: the same target again leaves the record
// where it is.
function isRecord(target, maxPushups) {
    return target > maxPushups
}

// The timestamp of one stored history entry. `time` is the current key; `ts` is
// what older builds wrote and is still read, so a file from before the rename keeps
// the colours in its history strip.
function entryTime(entry) {
    if (!entry || typeof entry !== "object") return ""
    if (typeof entry.time === "string") return entry.time
    return typeof entry.ts === "string" ? entry.ts : ""
}

function entryReps(entry) {
    if (!entry || typeof entry !== "object") return 0
    var reps = Number(entry.reps)
    return isFinite(reps) ? Math.floor(reps) : 0
}

// The status of a recorded session, derived from the gap to the one before it.
// Never stored: a later session can make an earlier one's gap longer.
function historyValue(history, index) {
    if (!Array.isArray(history) || index < 0 || index >= history.length) return ON_TRACK
    if (index === 0) return ON_TRACK
    var prev = parseTimestamp(entryTime(history[index - 1]))
    var curr = parseTimestamp(entryTime(history[index]))
    if (!isFinite(prev) || !isFinite(curr)) return ON_TRACK
    return statusForDays(Math.floor((curr - prev) / MS_PER_DAY))
}

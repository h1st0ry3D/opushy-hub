// The browser carries one copy of a progression rule: `softenReps` in
// web/status.ts. core/Progression.js is a QML script library the server loads
// through a vm context, so the .tsx files cannot import it, and "Too Hard" has to
// work with the answer of the tap rather than a round trip.
//
// A second copy is only safe while something holds the two together, so this
// walks the range the rule can actually see and fails on any disagreement.
import { describe, expect, test } from "bun:test"
import { rules } from "../src/rules"
import { softenReps } from "../web/status"

describe("too hard", () => {
  test("the browser and the server subtract the same number", () => {
    expect(rules.TOO_HARD_STEP).toBe(2)
    for (const reps of [-5, 0, 1, 2, 3, 4, 17, 25, 99, 10000, 10001]) {
      expect(softenReps(reps)).toBe(rules.softenReps(reps))
    }
  })

  test("two reps come off, and never below one", () => {
    expect(softenReps(20)).toBe(18)
    expect(softenReps(3)).toBe(1)
    expect(softenReps(2)).toBe(1)
    expect(softenReps(1)).toBe(1)
    expect(softenReps(0)).toBe(0)
  })

  // What the session records after a softened one, so the next session is still
  // one more than it.
  test("the next session adds a rep to the reduced value", () => {
    const now = Date.parse("2026-09-27T12:00:00.000Z")
    const yesterday = new Date(now - 86400000).toISOString()
    const target = 33
    const finished = rules.softenReps(target)
    expect(finished).toBe(31)
    expect(rules.nextReps(40, finished, yesterday, now)).toBe(32)
  })
})

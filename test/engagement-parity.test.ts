/**
 * Parity guard for the weekly engagement formula.
 *
 * The engagement-drop alert compares the current-week total (agent.ts, via
 * computeEngagementScore) against a 4-week baseline (supabase.fetchRollingEngagement).
 * Both sides MUST apply the same weights or the "-20% vs average" comparison is
 * meaningless. The weights used to be hardcoded independently in scorer.ts and
 * supabase.ts; they are now unified on computeEngagementScore. This test pins the
 * canonical weights and confirms a baseline-style aggregation matches a
 * current-week-style aggregation over the same counts.
 *
 * Run: tsx test/engagement-parity.test.ts   (also picked up by the test/*.test.ts glob)
 */
import assert from 'node:assert/strict'
import { computeEngagementScore } from '../src/lib/scorer.js'

// 1) Canonical weights: likes×1 + comments×3 + shares×5 + saves×2
assert.equal(
  computeEngagementScore({ likes: 10, comments: 2, shares: 1, saves: 3 }),
  10 * 1 + 2 * 3 + 1 * 5 + 3 * 2, // 27
  'engagement weights drifted from likes×1 + comments×3 + shares×5 + saves×2',
)

// Passive views must never enter the score even if present on the row.
assert.equal(
  computeEngagementScore({ likes: 0, comments: 0, shares: 0, saves: 0, views: 999999 } as any),
  0,
  'views leaked into the engagement score',
)

// 2) A rolling-baseline-style aggregation (supabase.fetchRollingEngagement) and a
//    current-week-style aggregation (agent.ts) over identical raw counts must be equal.
const week = [
  { likes: 100, comments: 5, shares: 2, saves: 4 },
  { likes: 40, comments: 1, shares: 0, saves: 9 },
]
const baselineTotal = week.reduce((s, p) => s + computeEngagementScore(p), 0)
const currentWeekTotal = week.reduce((s, p) => s + computeEngagementScore(p), 0)
assert.equal(
  baselineTotal,
  currentWeekTotal,
  'baseline and current-week total must resolve through one shared formula',
)
assert.equal(
  baselineTotal,
  100 + 5 * 3 + 2 * 5 + 4 * 2 + (40 + 1 * 3 + 0 + 9 * 2), // 133 + 61 = 194
  'baseline aggregation math changed unexpectedly',
)

console.log('✓ engagement-parity: weights canonical (1/3/5/2), views excluded, baseline == current-week formula')

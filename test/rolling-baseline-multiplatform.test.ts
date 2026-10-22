/**
 * Regression guard for the rolling-engagement baseline's PER-PLATFORM aggregation.
 *
 * Context: the engagement-drop alert compares the current-week total (agent.ts) against
 * a 4-week baseline (supabase.fetchRollingEngagement). PR #29 unified the WEIGHTS so both
 * sides use computeEngagementScore -- but the baseline still aggregated rows differently
 * from the current week:
 *   - performance_data is keyed on (content_item_id, platform), so a cross-posted item
 *     has one row per platform.
 *   - The old baseline kept a single row per content_item_id (last-write-wins) and then
 *     re-counted that survivor once per platform slot, so a cross-posted item both
 *     double-counted the surviving platform AND dropped the others.
 *   - The current-week total (agent.ts) scores one row per performance_data row, once.
 * So the "-20% vs 4-week average" comparison measured two differently-shaped totals.
 *
 * engagement-parity.test.ts (PR #29) does NOT catch this: it asserts
 * `reduce(computeEngagementScore) === reduce(computeEngagementScore)` over one array --
 * x === x. This test exercises the real aggregateWeeklyEngagement over a scenario where
 * the old and new algorithms diverge: new => 204, while the old last-write-wins +
 * per-slot re-count yields 132 for this row order (and is order-dependent -- it would
 * give 276 if the DB returned the rows in the other order, i.e. nondeterministic).
 *
 * Run: npx tsx test/rolling-baseline-multiplatform.test.ts
 *      (also picked up by the test/*.test.ts glob once that runner lands)
 */
import assert from 'node:assert/strict'
import { aggregateWeeklyEngagement } from '../src/lib/supabase.js'
import { computeEngagementScore, type EngagementCounts } from '../src/lib/scorer.js'

// Content item "A" is cross-posted to Instagram AND TikTok in week 0 (two slots, one
// perf row per platform). Item "B" is posted to a single platform in week 0.
const A_ig: EngagementCounts = { likes: 100, comments: 5, shares: 2, saves: 4 } // 133
const A_tt: EngagementCounts = { likes: 40, comments: 1, shares: 0, saves: 9 }  //  61
const B:    EngagementCounts = { likes: 10, comments: 0, shares: 0, saves: 0 }  //  10

const perfRowsByItem = new Map<string, EngagementCounts[]>([
  ['A', [A_ig, A_tt]],
  ['B', [B]],
])

// One slot assignment per platform posting (A appears twice: ig + tt).
const slotWeekAssignments = [
  { weekIdx: 0, contentItemId: 'A' },
  { weekIdx: 0, contentItemId: 'A' },
  { weekIdx: 0, contentItemId: 'B' },
]

const expected =
  computeEngagementScore(A_ig) + computeEngagementScore(A_tt) + computeEngagementScore(B) // 204

// (1) Every platform's row counts exactly once -- matches agent.ts's current-week total.
assert.deepEqual(
  aggregateWeeklyEngagement(slotWeekAssignments, perfRowsByItem, 1),
  [expected],
  `cross-posted baseline must sum every platform row once (expected ${expected}); ` +
    `a result of 132/276 means the old content_item_id-collapse + per-slot re-count is back`,
)

// (2) Extra duplicate slots for the same item in a week must NOT inflate the total:
//     the week-level Set de-dups, so engagement is attributed to the item once.
assert.deepEqual(
  aggregateWeeklyEngagement(
    [...slotWeekAssignments, { weekIdx: 0, contentItemId: 'A' }, { weekIdx: 0, contentItemId: 'A' }],
    perfRowsByItem,
    1,
  ),
  [expected],
  'duplicate slot assignments must not multiply a cross-posted item by its slot count',
)

// (3) Dropping one platform's perf row must lower the total by exactly that row's score,
//     proving each platform row is a distinct, counted contributor (not collapsed).
const oneRowPerItem = new Map<string, EngagementCounts[]>([
  ['A', [A_ig]],
  ['B', [B]],
])
assert.deepEqual(
  aggregateWeeklyEngagement(slotWeekAssignments, oneRowPerItem, 1),
  [expected - computeEngagementScore(A_tt)],
  'removing a platform row must drop the week total by exactly that row',
)

// (4) Week binning: slots in other weeks land in their own bucket, not week 0.
assert.deepEqual(
  aggregateWeeklyEngagement(
    [
      { weekIdx: 0, contentItemId: 'A' },
      { weekIdx: 0, contentItemId: 'A' },
      { weekIdx: 1, contentItemId: 'B' },
    ],
    perfRowsByItem,
    2,
  ),
  [computeEngagementScore(A_ig) + computeEngagementScore(A_tt), computeEngagementScore(B)],
  'slots must aggregate into their own week bucket',
)

console.log(
  '✓ rolling-baseline-multiplatform: cross-posted items sum every platform row once ' +
    `(204, not the old order-dependent 132/276); slot duplicates do not inflate; per-week binning holds`,
)

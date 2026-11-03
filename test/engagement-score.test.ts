/**
 * Public-contract smoke test for the weighted engagement score.
 *
 * Green on the current default tree AND after the #28 weight-unification (PR #29)
 * lands -- it only exercises computeEngagementScore's observable behaviour
 * (weights likes x1 + comments x3 + shares x5 + saves x2, passive views excluded).
 *
 * The STRONGER structural guard -- weights defined in exactly one place, every
 * aggregation site routing through this function -- ships in PR #32
 * (test/engagement-weight-drift.test.ts) and is red until the duplicate weight
 * copy in supabase.ts is removed by PR #29. This file is the always-green floor
 * so `npm test` and CI have something to run on the default branch today.
 */
import assert from 'node:assert/strict'
import { computeEngagementScore } from '../src/lib/scorer.js'

// likes x1 + comments x3 + shares x5 + saves x2  ->  10 + 6 + 5 + 6 = 27
assert.equal(
  computeEngagementScore({ likes: 10, comments: 2, shares: 1, saves: 3 } as any),
  27,
  'engagement weights drifted from likes x1 + comments x3 + shares x5 + saves x2',
)

assert.equal(
  computeEngagementScore({ likes: 0, comments: 0, shares: 0, saves: 0 } as any),
  0,
  'an all-zero row must score 0',
)

// passive views must never leak into the weighted score
assert.equal(
  computeEngagementScore({ likes: 1, comments: 0, shares: 0, saves: 0, views: 999999 } as any),
  1,
  'passive views leaked into the engagement score',
)

console.log('\u2713 engagement-score: public contract weights 1/3/5/2, passive views excluded')

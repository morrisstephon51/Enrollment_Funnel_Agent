/**
 * Guard for the engagement-drop "no baseline" blind spot.
 *
 * checkEngagementDrop compares the current-week total against a 4-week rolling
 * baseline. When the baseline is empty (a brand new to Supabase, or the manual
 * CSV workflow where performance rows are never persisted — upsertPerformance is
 * currently unused), the verdict USED to collapse to { dropped: false } — visually
 * identical to "engagement is stable." That silently gave a false all-clear.
 *
 * `hasBaseline` now separates the two so the report can say "detection inactive"
 * instead of showing nothing. This test pins that contract.
 *
 * Run: tsx test/baseline-visibility.test.ts   (also picked up by the test/*.test.ts glob)
 */
import assert from 'node:assert/strict'
import { checkEngagementDrop } from '../src/lib/scorer.js'

// 1) All-zero rolling window (CSV-only workflow) -> no baseline, and NOT a drop.
const zeros = checkEngagementDrop(1000, [0, 0, 0, 0])
assert.equal(zeros.hasBaseline, false, 'all-zero rolling window must report hasBaseline=false')
assert.equal(zeros.dropped, false, 'no baseline must never fire a drop alert')
assert.equal(zeros.baseline, 0, 'no baseline -> baseline 0')

// 2) Empty rolling window (first run) -> no baseline.
const empty = checkEngagementDrop(1000, [])
assert.equal(empty.hasBaseline, false, 'empty rolling window must report hasBaseline=false')
assert.equal(empty.dropped, false, 'empty baseline must never fire a drop alert')

// 3) Real baseline present -> hasBaseline true; a genuine 50% drop still fires.
const drop = checkEngagementDrop(500, [1000, 1000, 1000, 1000])
assert.equal(drop.hasBaseline, true, 'a populated baseline must report hasBaseline=true')
assert.equal(drop.dropped, true, '500 vs a 1000 baseline is a -50% drop and must fire')
assert.equal(drop.baseline, 1000, 'baseline should average the valid weeks')

// 4) Real baseline present, engagement stable -> hasBaseline true, no drop.
//    This is the state that must stay DISTINCT from the no-baseline case.
const stable = checkEngagementDrop(1000, [1000, 900, 1100])
assert.equal(stable.hasBaseline, true, 'stable week still has a real baseline')
assert.equal(stable.dropped, false, 'within 20% of baseline is not a drop')

// 5) Partial baseline (some weeks zero) still counts as a baseline from the valid weeks.
const partial = checkEngagementDrop(300, [0, 1000, 0, 0])
assert.equal(partial.hasBaseline, true, 'at least one non-zero week is a usable baseline')
assert.equal(partial.baseline, 1000, 'baseline averages only the valid (non-zero) weeks')

console.log('✓ baseline-visibility: no-baseline is distinguishable from stable; real drops still fire')

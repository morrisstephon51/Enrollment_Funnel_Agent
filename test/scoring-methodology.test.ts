/**
 * Regression guard: the client-facing "Scoring Methodology" line in the weekly
 * report must state the SAME weights computeEngagementScore actually applies.
 *
 * reporter.ts used to hard-code "(Likes x 1) + (Comments x 3) + (Shares x 5) +
 * (Saves x 2)" as prose — a 4th copy of the weights that drifts silently the
 * moment the formula changes. scorer.ts + supabase.ts were unified on
 * computeEngagementScore (#28); this pins the report's methodology to it too.
 *
 * Reads the RENDERED line and compares its numbers to the scorer, so a revert to
 * hard-coded prose that disagrees with the scorer fails here.
 *
 * Run: tsx test/scoring-methodology.test.ts   (picked up by the test/*.test.ts glob)
 */
import assert from 'node:assert/strict'
import { buildReport } from '../src/lib/reporter.js'
import { computeEngagementScore } from '../src/lib/scorer.js'

const report = buildReport({
  weekLabel: '2026-06-02',
  weekStart: new Date('2026-06-02T00:00:00'),
  weekEnd: new Date('2026-06-09T00:00:00'),
  allPosts: [],
  top3: [],
  bottom3: [],
  narrative: { summary: '', doMoreOf: '', stopDoing: '', enrollmentNote: '' },
  enrollmentData: null,
  dropWarning: null,
  platforms: [],
  totalPosts: 0,
  totalEngagement: 0,
})

const line = report.split('\n').find((l) => l.startsWith('> (Likes'))
assert.ok(line, 'Scoring Methodology weight line not found in report')

const m = line!.match(
  /Likes x (-?\d+(?:\.\d+)?)\) \+ \(Comments x (-?\d+(?:\.\d+)?)\) \+ \(Shares x (-?\d+(?:\.\d+)?)\) \+ \(Saves x (-?\d+(?:\.\d+)?)\)/,
)
assert.ok(m, `could not parse weights from methodology line: ${line}`)

// Weight the scorer actually applies to each metric (unit-probe the real formula).
const w = (metric: 'likes' | 'comments' | 'shares' | 'saves'): number =>
  computeEngagementScore({ likes: 0, comments: 0, shares: 0, saves: 0, [metric]: 1 } as any)

assert.equal(Number(m![1]), w('likes'), 'displayed Likes weight != scorer')
assert.equal(Number(m![2]), w('comments'), 'displayed Comments weight != scorer')
assert.equal(Number(m![3]), w('shares'), 'displayed Shares weight != scorer')
assert.equal(Number(m![4]), w('saves'), 'displayed Saves weight != scorer')

console.log(`✓ scoring-methodology: report weights match computeEngagementScore ${line!.replace('> ', '')}`)

/**
 * Drift guard for the weekly engagement formula (hardens the #28 fix).
 *
 * WHY THIS EXISTS, given test/engagement-parity.test.ts already ships:
 * that file's parity assertion computes BOTH sides with computeEngagementScore
 * (`baselineTotal === currentWeekTotal` is literally `x === x`), never imports
 * supabase.ts, and therefore passes unchanged on the pre-fix tree. Mutation
 * check: re-introducing the exact #28 drift -- baseline weights set to
 * 1/99/99/99 inside fetchRollingEngagement -- leaves it green.
 *
 * Issue #28 is a DUPLICATION bug: the weights were hardcoded in scorer.ts AND
 * again in supabase.ts, so the drop alert could compare two different formulas.
 * The invariant that actually encodes the fix is therefore structural: the
 * weighted-engagement arithmetic must exist in exactly ONE place, and every
 * aggregation site must route through it. fetchRollingEngagement itself needs a
 * live Supabase client, so this guard asserts the invariant over the source.
 *
 * Run: tsx test/engagement-weight-drift.test.ts  (also picked up by test/*.test.ts)
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeEngagementScore } from '../src/lib/scorer.js'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const ROOT = fileURLToPath(new URL('..', import.meta.url))

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : []
  })
}

// Any `comments * N` / `shares * N` / `saves * N` is weighted-engagement math.
// (`likes * 1` alone is too weak a signal to key on.)
const WEIGHTED = /\b(comments|shares|saves)\s*\*\s*\d/

const sites = walk(SRC).flatMap((file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .map((line, i) => ({ file: relative(ROOT, file), line: i + 1, text: line.trim() }))
    .filter(({ text }) => WEIGHTED.test(text)),
)

// 1) Exactly one definition site, and it is scorer.ts.
assert.equal(
  sites.length,
  1,
  `engagement weights must live in exactly ONE place (issue #28). Found ${sites.length}:\n` +
    sites.map((s) => `  ${s.file}:${s.line}  ${s.text}`).join('\n'),
)
assert.equal(
  sites[0].file,
  'src/lib/scorer.ts',
  `the single weight definition must be scorer.ts, found ${sites[0].file}:${sites[0].line}`,
)

// 2) Every aggregation site routes through the shared formula.
for (const [file, fn] of [
  ['src/lib/supabase.ts', 'fetchRollingEngagement (drop-alert baseline)'],
  ['src/agent.ts', 'current-week total'],
] as const) {
  assert.ok(
    readFileSync(join(ROOT, file), 'utf8').includes('computeEngagementScore'),
    `${fn} in ${file} must aggregate via computeEngagementScore, not its own weights`,
  )
}

// 3) The canonical weights themselves: likes x1 + comments x3 + shares x5 + saves x2.
assert.equal(
  computeEngagementScore({ likes: 10, comments: 2, shares: 1, saves: 3 }),
  27,
  'engagement weights drifted from likes x1 + comments x3 + shares x5 + saves x2',
)
assert.equal(
  computeEngagementScore({ likes: 0, comments: 0, shares: 0, saves: 0, views: 999999 } as any),
  0,
  'passive views leaked into the engagement score',
)

console.log(
  `✓ engagement-weight-drift: single weight site (${sites[0].file}:${sites[0].line}), ` +
    'baseline + current-week both route through computeEngagementScore, weights 1/3/5/2',
)

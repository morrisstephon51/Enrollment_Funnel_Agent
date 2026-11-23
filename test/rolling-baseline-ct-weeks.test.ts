// Guards the drop-alert baseline weeks built by fetchRollingEngagement.
// Each boundary must be a true Chicago Monday midnight on ANY host TZ, including
// weeks that span a DST change. Run e.g.:
//   TZ=UTC tsx test/rolling-baseline-ct-weeks.test.ts
//   TZ=Europe/London tsx test/rolling-baseline-ct-weeks.test.ts
import { readFileSync } from 'node:fs'
import { rollingWeekBounds } from '../src/lib/week.js'

let failed = 0
let passed = 0
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) {
    passed++
  } else {
    failed++
    console.error(`FAIL ${name}\n  got:  ${String(got)}\n  want: ${String(want)}`)
  }
}
const iso = (d: Date) => d.toISOString()

// 1. Fall back (2026-11-01). weekStart = Mon 2026-11-02 00:00 CST = 06:00Z.
//    The prior Monday 2026-10-26 00:00 CDT is 05:00Z, 169h earlier, not 168h.
{
  const b = rollingWeekBounds(new Date('2026-11-02T06:00:00Z'), 4)
  eq('fall: 4 weeks', b.length, 4)
  eq('fall: wk0 end == weekStart', iso(b[0].end), '2026-11-02T06:00:00.000Z')
  eq('fall: wk0 start (CDT Monday)', iso(b[0].start), '2026-10-26T05:00:00.000Z')
  eq('fall: wk1 end == wk0 start', iso(b[1].end), iso(b[0].start))
  eq('fall: wk1 start', iso(b[1].start), '2026-10-19T05:00:00.000Z')
  eq('fall: wk3 start', iso(b[3].start), '2026-10-05T05:00:00.000Z')
}

// 2. Spring forward (2026-03-08). weekStart = Mon 2026-03-09 00:00 CDT = 05:00Z.
//    The prior Monday 2026-03-02 00:00 CST is 06:00Z, 167h earlier.
{
  const b = rollingWeekBounds(new Date('2026-03-09T05:00:00Z'), 2)
  eq('spring: wk0 start (CST Monday)', iso(b[0].start), '2026-03-02T06:00:00.000Z')
  eq('spring: wk1 start', iso(b[1].start), '2026-02-23T06:00:00.000Z')
}

// 3. No DST in range: plain 168h steps.
{
  const b = rollingWeekBounds(new Date('2026-06-29T05:00:00Z'), 3)
  eq('summer: wk2 start', iso(b[2].start), '2026-06-08T05:00:00.000Z')
}

// 4. Contiguity: consecutive weeks share a boundary, so no post falls in a gap.
{
  const b = rollingWeekBounds(new Date('2026-11-16T06:00:00Z'), 6)
  for (let i = 1; i < b.length; i++) eq(`contiguous ${i}`, iso(b[i].end), iso(b[i - 1].start))
}

// 5. Call site: fetchRollingEngagement must use the helper, not host-local setDate.
{
  const src = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
  const start = src.indexOf('export async function fetchRollingEngagement')
  const fn = src.slice(start, src.indexOf('\nexport ', start + 1) === -1 ? undefined : src.indexOf('\nexport ', start + 1))
  eq('call site found', start >= 0, true)
  eq('call site uses rollingWeekBounds', /rollingWeekBounds\(\s*weekStart\s*,\s*weeksBack\s*\)/.test(fn), true)
  eq('call site has no setDate', fn.includes('setDate('), false)
}

console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

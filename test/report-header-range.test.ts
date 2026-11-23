// Guards the human-readable week range in the report header (closes #42 and
// its DST follow-on). weekEnd is the exclusive bound (next Monday 00:00 CT),
// so the header must name the Sunday before it in Chicago, on any host TZ and
// on DST weeks. Subtracting a fixed 24h lands on Saturday 23:00 CT when that
// Sunday is the 23-hour spring-forward day. Run under several host zones:
//   TZ=UTC tsx test/report-header-range.test.ts
//   TZ=Pacific/Honolulu tsx test/report-header-range.test.ts
import { buildReport } from '../src/lib/reporter.js'
import { parseWeekArg, addCtDays } from '../src/lib/week.js'

let failed = 0
let passed = 0

function header(week: string): string {
  const weekStart = parseWeekArg(week)
  const weekEnd = addCtDays(weekStart, 7)
  const md = buildReport({
    weekLabel: week,
    weekStart,
    weekEnd,
    allPosts: [],
    top3: [],
    bottom3: [],
    narrative: { summary: 's', doMoreOf: 'd', stopDoing: 'x', enrollmentNote: 'e' },
    enrollmentData: null,
    dropWarning: null,
    platforms: [],
    totalPosts: 0,
    totalEngagement: 0,
  })
  return md.split('\n').slice(0, 12).join('\n')
}

function hasRange(name: string, week: string, want: string) {
  const h = header(week)
  if (h.includes(want)) {
    passed++
  } else {
    failed++
    console.error(`FAIL ${name} (TZ=${process.env.TZ ?? 'host'})\n  want: ${want}\n  header:\n${h}`)
  }
}

hasRange('ordinary CDT week', '2026-06-01', 'Jun 1 – Jun 7, 2026')
hasRange('ordinary CST week', '2026-01-05', 'Jan 5 – Jan 11, 2026')
// Sunday 2026-03-08 is 23h long (spring forward).
hasRange('spring-forward week ends on Sunday', '2026-03-02', 'Mar 2 – Mar 8, 2026')
// Sunday 2026-11-01 is 25h long (fall back).
hasRange('fall-back week ends on Sunday', '2026-10-26', 'Oct 26 – Nov 1, 2026')
// Week spanning a year boundary.
hasRange('year-boundary week', '2026-12-28', 'Dec 28 – Jan 3, 2027')

console.log(`report-header-range: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

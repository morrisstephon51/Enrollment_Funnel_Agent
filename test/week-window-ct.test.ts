// Guards the Chicago week window used for the Supabase posted_at bounds and
// the report label. Run under several host timezones, e.g.
//   TZ=UTC tsx test/week-window-ct.test.ts
//   TZ=Asia/Tokyo tsx test/week-window-ct.test.ts
// Every expectation below is an absolute UTC instant, so it must hold in ANY TZ.
import { lastMonday, addCtDays, parseWeekArg, toWeekLabel } from '../src/lib/week.js'

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

// 1. CDT week: Monday 2026-06-01 00:00 CT == 05:00Z.
{
  const ws = lastMonday(new Date('2026-06-03T17:00:00Z')) // Wed afternoon CT
  eq('CDT weekStart instant', iso(ws), '2026-06-01T05:00:00.000Z')
  eq('CDT weekEnd instant', iso(addCtDays(ws, 7)), '2026-06-08T05:00:00.000Z')
  eq('CDT label', toWeekLabel(ws), '2026-06-01')
}

// 2. Sunday 21:00 CT (= Mon 02:00Z) still belongs to the PRIOR week.
{
  const ws = lastMonday(new Date('2026-06-08T02:00:00Z'))
  eq('Sunday-evening CT belongs to prior week', iso(ws), '2026-06-01T05:00:00.000Z')
  eq('Sunday-evening label', toWeekLabel(ws), '2026-06-01')
}

// 3. CST week (winter): Monday 2026-01-05 00:00 CT == 06:00Z.
{
  const ws = lastMonday(new Date('2026-01-07T12:00:00Z'))
  eq('CST weekStart instant', iso(ws), '2026-01-05T06:00:00.000Z')
  eq('CST label', toWeekLabel(ws), '2026-01-05')
}

// 4. DST spring-forward week (2026-03-08): window is 167h, end on CDT midnight.
{
  const ws = parseWeekArg('2026-03-02')
  eq('pre-DST weekStart', iso(ws), '2026-03-02T06:00:00.000Z')
  const ws2 = parseWeekArg('2026-03-09')
  eq('post-DST weekStart', iso(ws2), '2026-03-09T05:00:00.000Z')
  eq('DST-week weekEnd lands on next CT midnight', iso(addCtDays(ws, 7)), '2026-03-09T05:00:00.000Z')
}

// 5. --week argument is Chicago midnight, not host-local midnight.
{
  const ws = parseWeekArg('2026-06-01')
  eq('--week instant', iso(ws), '2026-06-01T05:00:00.000Z')
  eq('--week label round-trips', toWeekLabel(ws), '2026-06-01')
  let threw = false
  try { parseWeekArg('2026-02-30') } catch { threw = true }
  eq('--week rejects impossible date', threw, true)
}

console.log(`week-window-ct (TZ=${process.env.TZ ?? 'host'}): ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

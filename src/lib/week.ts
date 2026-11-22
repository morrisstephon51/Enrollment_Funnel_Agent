/**
 * Week-window helpers pinned to America/Chicago.
 *
 * BigHeart Health reports run on Chicago weeks (Monday 00:00 CT through the
 * next Monday 00:00 CT, half-open). Every Date returned here is the TRUE
 * instant of a Chicago midnight, so `toISOString()` (used for the Supabase
 * `posted_at` bounds) is correct no matter what timezone the host runs in.
 *
 * The previous helpers built "local midnight of the CT calendar day" with
 * setHours(0), which is only a Chicago midnight when the host itself is on CT:
 *   - on a UTC host the query window started at Mon 00:00Z = Sun 18:00/19:00 CT,
 *     so Sunday-evening posts were filed into the NEXT week's report;
 *   - on a host east of UTC, toISOString() of local midnight is the previous
 *     day, so the week label / report filename named a Sunday.
 */

export const REPORT_TZ = 'America/Chicago'

interface Ymd {
  y: number
  m: number // 1-12
  d: number
}

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: REPORT_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function ctParts(instant: Date) {
  const p: Record<string, number> = {}
  for (const { type, value } of partsFmt.formatToParts(instant)) {
    if (type !== 'literal') p[type] = Number(value)
  }
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number }
}

/** Offset (ms) of Chicago wall clock vs UTC at `instant` (e.g. -5h in CDT). */
function ctOffsetMs(instant: Date): number {
  const p = ctParts(instant)
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** The UTC instant at which the Chicago wall clock reads `ymd` 00:00:00. */
export function ctMidnight({ y, m, d }: Ymd): Date {
  const guess = Date.UTC(y, m - 1, d)
  let t = guess - ctOffsetMs(new Date(guess))
  // Re-check at the candidate instant in case a DST change sits between them.
  t = guess - ctOffsetMs(new Date(t))
  return new Date(t)
}

/** Chicago calendar date of an instant. */
export function ctYmd(instant: Date): Ymd {
  const p = ctParts(instant)
  return { y: p.year, m: p.month, d: p.day }
}

function shiftYmd({ y, m, d }: Ymd, days: number): Ymd {
  const u = new Date(Date.UTC(y, m - 1, d + days))
  return { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate() }
}

/** Monday 00:00 CT of the Chicago week containing `from`. */
export function lastMonday(from: Date = new Date()): Date {
  const ymd = ctYmd(from)
  const dow = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).getUTCDay() // 0=Sun
  const diff = dow === 0 ? 6 : dow - 1
  return ctMidnight(shiftYmd(ymd, -diff))
}

/** Chicago midnight `n` calendar days after the Chicago date of `d` (DST-safe). */
export function addCtDays(d: Date, n: number): Date {
  return ctMidnight(shiftYmd(ctYmd(d), n))
}

/** Parse a `--week YYYY-MM-DD` argument as Chicago midnight of that date. */
export function parseWeekArg(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) throw new Error(`--week must be YYYY-MM-DD, got "${s}"`)
  const ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
  const check = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d))
  if (check.getUTCMonth() + 1 !== ymd.m || check.getUTCDate() !== ymd.d) {
    throw new Error(`--week is not a real calendar date: "${s}"`)
  }
  return ctMidnight(ymd)
}

/** YYYY-MM-DD of the Chicago calendar date of `d` (report label / filename). */
export function toWeekLabel(d: Date): string {
  const { y, m, d: day } = ctYmd(d)
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

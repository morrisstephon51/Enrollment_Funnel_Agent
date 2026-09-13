/**
 * Regression test for the enrollment-CSV parse (src/lib/enrollment-csv.ts).
 *
 * Guards the #23-family bug: a hand-re-saved GA4 UTM export leaves a space after
 * each comma delimiter, so without `trim: true` the "Sessions" column parses to
 * the key " Sessions", reporter.ts's `r['Sessions']` lookup misses it, and the
 * weekly session total silently collapses to the row-count fallback while
 * topUtmSources counts every source as 1.
 *
 * Dependency-free — run with:  npx tsx test/enrollment-csv.test.ts
 */
import { parseEnrollmentCsv } from '../src/lib/enrollment-csv.js'
import type { EnrollmentRow } from '../src/lib/claude-client.js'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.error(`  ✗ ${name} ${detail}`)
  }
}

// Mirror reporter.ts's session accounting so the test asserts the real effect,
// not just the raw keys.
function reporterSessions(rows: EnrollmentRow[]): { hasSessionColumn: boolean; totalSessions: number } {
  const parseSessions = (r: EnrollmentRow): number => {
    const raw = r['Sessions'] ?? r.sessions
    if (raw === undefined || raw === null || raw === '') return NaN
    return Number(String(raw).replace(/,/g, '').trim())
  }
  const vals = rows.map(parseSessions)
  return {
    hasSessionColumn: vals.some((n) => !Number.isNaN(n)),
    totalSessions: vals.reduce((s, n) => s + (Number.isNaN(n) ? 0 : n), 0),
  }
}

// ── Case 1: hand-re-saved GA4 UI export with a space after each delimiter ──────
// This is the exact shape that used to break: without trim the keys come back as
// "Session source", " Sessions", " New users".
const padded = [
  'Session source, Sessions, New users',
  'tiktok, 214, 198',
  'instagram, 156, 142',
  'facebook, 88, 81',
].join('\n')

const paddedRows = parseEnrollmentCsv(padded)
const paddedKeys = Object.keys(paddedRows[0] ?? {})
check(
  'delimiter-space headers trim to clean keys (no leading-space keys)',
  paddedKeys.includes('Sessions') && !paddedKeys.some((k) => k !== k.trim()),
  `got ${JSON.stringify(paddedKeys)}`
)
const paddedAcct = reporterSessions(paddedRows)
check('Sessions column is detected after trim', paddedAcct.hasSessionColumn === true)
check(
  'session total is summed, not collapsed to the row-count fallback',
  paddedAcct.totalSessions === 458,
  `got ${paddedAcct.totalSessions} (expected 214+156+88=458)`
)
check(
  'Session source values are usable (topUtmSources key)',
  paddedRows.every((r) => typeof r['Session source'] === 'string' && (r['Session source'] as string).length > 0),
  `got ${JSON.stringify(paddedRows.map((r) => r['Session source']))}`
)

// ── Case 2: the clean lowercase-normalized sample must keep working ────────────
const normalized = [
  'source,medium,campaign,sessions,new_users,goal_completions',
  'tiktok,social,bigheart-june,214,198,12',
  'instagram,social,bigheart-june,156,142,9',
  'facebook,social,bigheart-june,88,81,4',
  '(direct),(none),(none),43,38,3',
  'google,organic,(not set),31,28,2',
].join('\n')

const normalizedRows = parseEnrollmentCsv(normalized)
check('normalized sample parses all 5 rows', normalizedRows.length === 5, `got ${normalizedRows.length}`)
const normalizedAcct = reporterSessions(normalizedRows)
check(
  'normalized sample sums to 532 sessions (unchanged behavior)',
  normalizedAcct.totalSessions === 532,
  `got ${normalizedAcct.totalSessions}`
)

console.log(`\n${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)

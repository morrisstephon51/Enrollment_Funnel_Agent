// Regression test for GA4 "Sessions" parsing.
//
// Bug: topUtmSources() read the Sessions column with a bare Number(), so a GA4
// UI-export value carrying a thousands-separator ("1,024") became NaN. The two
// biggest sources dropped to "(NaN)" and were mis-sorted below a smaller source
// in the Claude prompt context. reporter.ts already stripped commas, so the two
// copies had silently drifted; both now share parseSessionCount().
//
// Runs with tsx and needs no network/API key — topUtmSources/parseSessionCount
// are pure and the Anthropic client is only constructed inside generateNarrative.
import { parseSessionCount, topUtmSources } from '../src/lib/claude-client.js'
import type { EnrollmentRow } from '../src/lib/claude-client.js'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name} ${detail}`) }
}

const row = (o: Record<string, unknown>) => o as unknown as EnrollmentRow

console.log('\n[parseSessionCount]')
check('parses "1,024" -> 1024', parseSessionCount(row({ Sessions: '1,024' })) === 1024)
check('parses "2,300" -> 2300', parseSessionCount(row({ Sessions: '2,300' })) === 2300)
check('parses plain "512" -> 512', parseSessionCount(row({ Sessions: '512' })) === 512)
check('absent Sessions -> NaN', Number.isNaN(parseSessionCount(row({ source: 'x' }))))
check('empty Sessions -> NaN', Number.isNaN(parseSessionCount(row({ Sessions: '' }))))

console.log('\n[topUtmSources]')
const rows = [
  row({ 'Session source': 'tiktok', 'Sessions': '1,024' }),
  row({ 'Session source': 'instagram', 'Sessions': '512' }),
  row({ 'Session source': 'facebook', 'Sessions': '2,300' }),
]
const top = topUtmSources(rows)
check('output contains no "(NaN)"', !top.some((s) => s.includes('NaN')), `got ${JSON.stringify(top)}`)
check('largest comma-value source ranks first', top[0] === 'facebook (2300)', `got ${top[0]}`)
check('second-largest ranks second', top[1] === 'tiktok (1024)', `got ${top[1]}`)
check('smallest ranks third', top[2] === 'instagram (512)', `got ${top[2]}`)

// A source with no session cell still counts as 1 (not dropped).
const noCount = topUtmSources([row({ 'Session source': 'newsletter' })])
check('source without a Sessions cell counts as 1', noCount[0] === 'newsletter (1)', `got ${noCount[0]}`)

console.log(`\n${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)

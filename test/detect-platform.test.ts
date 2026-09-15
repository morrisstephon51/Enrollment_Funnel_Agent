/**
 * Self-contained regression test for detectPlatform() filename routing.
 *
 * The repo has no test framework wired up, so this runs standalone with
 * `npx tsx test/detect-platform.test.ts` (also `npm test`). It exits non-zero
 * on any failure so it can gate CI once a runner exists.
 *
 * Focus: the "meta" substring collision. The Meta/Facebook alias used to be
 * matched with a raw `lower.includes('meta')`, which fires inside "metadata" —
 * an extremely common export-filename word — and, because the facebook check is
 * ordered before youtube, it silently re-routed even files that name "youtube"
 * to Facebook. Wrong platform -> wrong column map -> every metric reads 0 and
 * rows get skipped as "missing post ID". This locks the fix and the sibling
 * short-code collisions (ig/tt/fb/yt) that were already guarded.
 */
import assert from 'node:assert'
import { detectPlatform } from '../src/lib/csv-normalizer.js'

const igHeaders = ['Post ID', 'Description', 'Post Publish Time', 'Saves', 'Reach', 'Likes']
const fbHeaders = ['Post ID', 'Post message', 'Post reach', 'Reactions', 'Comments']
const ttHeaders = ['Video ID', 'Video Title', 'Video Views', 'Completion rate', 'Likes']
const ytHeaders = ['Video ID', 'Video title', 'Views', 'Watch time (hours)', 'Likes']
const generic = ['a', 'b', 'c']

type Case = { name: string; file: string; headers: string[]; expect: string }
const cases: Case[] = [
  // --- meta-substring regression (the fix) ---
  { name: 'explicit youtube name not hijacked by "metadata"', file: 'youtube-video-metadata.csv', headers: ytHeaders, expect: 'youtube' },
  { name: 'platform-less "metadata" file falls to IG header signature', file: 'content-metadata.csv', headers: igHeaders, expect: 'instagram' },
  { name: 'platform-less "metadata" file falls to YT header signature', file: 'post-metadata-2026.csv', headers: ytHeaders, expect: 'youtube' },
  { name: 'tiktok name with metadata stays tiktok', file: 'tiktok-metadata.csv', headers: generic, expect: 'tiktok' },

  // --- Meta alias must still resolve to facebook ---
  { name: 'meta alias as whole token', file: 'meta-week.csv', headers: generic, expect: 'facebook' },
  { name: 'Meta Business Suite export', file: 'Meta_Business_Suite_Content_2026.csv', headers: generic, expect: 'facebook' },
  { name: 'facebook full name', file: 'facebook-week.csv', headers: generic, expect: 'facebook' },

  // --- pre-existing short-code collision guards (regression lock) ---
  { name: '"ig" not matched inside insights', file: 'tiktok-insights.csv', headers: generic, expect: 'tiktok' },
  { name: 'ig short code as token', file: 'ig-week.csv', headers: generic, expect: 'instagram' },
  { name: 'fb short code as token', file: 'fb-week.csv', headers: generic, expect: 'facebook' },
  { name: 'yt short code as token', file: 'yt-week.csv', headers: generic, expect: 'youtube' },

  // --- header-signature fallback (no platform in filename) ---
  { name: 'facebook via headers', file: 'week1.csv', headers: fbHeaders, expect: 'facebook' },
  { name: 'tiktok via headers', file: 'week1.csv', headers: ttHeaders, expect: 'tiktok' },
]

let passed = 0
const failures: string[] = []
for (const c of cases) {
  try {
    const got = detectPlatform(c.file, c.headers)
    assert.strictEqual(got, c.expect, `${c.name}: "${c.file}" -> ${got}, want ${c.expect}`)
    passed++
    console.log(`ok   ${c.name}`)
  } catch (e) {
    failures.push((e as Error).message)
    console.log(`FAIL ${c.name}`)
  }
}

console.log(`\n${passed}/${cases.length} passed`)
if (failures.length) {
  console.error('\nFailures:\n' + failures.map((f) => '  - ' + f).join('\n'))
  process.exit(1)
}

import fs from 'fs'
import path from 'path'
import type { ScoredPost } from './scorer.js'
import type { ReportNarrative, EnrollmentRow } from './claude-client.js'

function platformBadge(platform: string): string {
  const badges: Record<string, string> = {
    instagram: '📸 Instagram',
    tiktok: '🎵 TikTok',
    facebook: '📘 Facebook',
    youtube: '▶️ YouTube Shorts',
  }
  return badges[platform] ?? platform
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}

function engagementTable(posts: ScoredPost[]): string {
  const header = '| # | Platform | Topic | Likes | Comments | Shares | Saves | Score |'
  const divider = '|---|----------|-------|-------|----------|--------|-------|-------|'
  const rows = posts.map((p, i) => {
    const topic = p.topic.length > 50 ? p.topic.slice(0, 47) + '...' : p.topic
    return `| ${i + 1} | ${platformBadge(p.platform)} | ${topic} | ${fmtNum(p.likes)} | ${fmtNum(p.comments)} | ${fmtNum(p.shares)} | ${fmtNum(p.saves)} | **${fmtNum(p.engagementScore)}** |`
  })
  return [header, divider, ...rows].join('\n')
}

export function buildReport(opts: {
  weekLabel: string
  weekStart: Date
  weekEnd: Date
  allPosts: ScoredPost[]
  top3: ScoredPost[]
  bottom3: ScoredPost[]
  narrative: ReportNarrative
  enrollmentData: { url: string; trafficRows: EnrollmentRow[] } | null
  dropWarning: { dropped: boolean; pctChange: number; baseline: number } | null
  platforms: string[]
  totalPosts: number
  totalEngagement: number
}): string {
  const {
    weekLabel,
    weekStart,
    weekEnd,
    top3,
    bottom3,
    narrative,
    enrollmentData,
    dropWarning,
    platforms,
    totalPosts,
    totalEngagement,
  } = opts

  // weekEnd is the exclusive query bound (the next Monday); the human-readable
  // range should end on the inclusive last day of the week (the Sunday), so
  // display weekEnd - 1 day without mutating weekEnd's query semantics.
  const displayWeekEnd = new Date(weekEnd.getTime() - 24 * 60 * 60 * 1000)
  const dateRange = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${displayWeekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  const generatedAt = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })

  const dropBanner = dropWarning?.dropped
    ? `\n> ⚠️ **ENGAGEMENT ALERT:** Total engagement dropped **${Math.abs(dropWarning.pctChange)}%** below the 4-week rolling average (baseline: ${fmtNum(dropWarning.baseline)} points). Review content strategy immediately.\n`
    : ''

  // Each GA4 export row is one UTM source/grouping (e.g. "tiktok / social"), NOT one
  // session. Printing trafficRows.length as "sessions" drastically understates real
  // traffic — the sample export is 5 rows but 532 sessions (a 106x undercount). Sum the
  // actual Sessions column (matching topUtmSources' column fallback) and report rows and
  // sessions as the distinct quantities they are. Fall back to a row count only when the
  // export carries no per-row session counts.
  // Parse one row's session count, tolerating GA4's thousand-separators ("1,024")
  // the same way csv-normalizer does. Returns NaN when the row has no session value.
  const parseSessions = (r: EnrollmentRow): number => {
    const raw = r['Sessions'] ?? r.sessions
    if (raw === undefined || raw === null || raw === '') return NaN
    return Number(String(raw).replace(/,/g, '').trim())
  }
  const sessionValues = enrollmentData
    ? enrollmentData.trafficRows.map(parseSessions)
    : []
  const hasSessionColumn = sessionValues.some((n) => !Number.isNaN(n))
  const totalSessions = sessionValues.reduce((sum, n) => sum + (Number.isNaN(n) ? 0 : n), 0)
  const trafficLine = !enrollmentData
    ? ''
    : hasSessionColumn
      ? `Traffic data provided: **${fmtNum(totalSessions)} sessions** across **${fmtNum(enrollmentData.trafficRows.length)} UTM source${enrollmentData.trafficRows.length === 1 ? '' : 's'}** this week.`
      : `Traffic data provided: **${fmtNum(enrollmentData.trafficRows.length)} UTM source row${enrollmentData.trafficRows.length === 1 ? '' : 's'}** this week (the export carried no per-row session counts).`

  const enrollmentSection = enrollmentData
    ? `## Enrollment Page Correlation

**URL:** ${enrollmentData.url}

${trafficLine}

${narrative.enrollmentNote}
`
    : `## Enrollment Page Correlation

No enrollment traffic data uploaded this week. To enable correlation, export a CSV from GA4 with UTM parameters and pass it via \`--enrollment-csv\`.

${narrative.enrollmentNote}
`

  const platformCoverage =
    platforms.length > 0
      ? platforms.map((p) => `- ${platformBadge(p)}`).join('\n')
      : '- No platform data uploaded'

  return `# BigHeart Health — Weekly Content Performance Report
**Week of ${weekLabel}** | ${dateRange}
*Generated ${generatedAt} CT*
${dropBanner}
---

## Executive Summary

${narrative.summary}

---

## This Week at a Glance

| Metric | Value |
|--------|-------|
| Posts analyzed | ${totalPosts} |
| Platforms covered | ${platforms.length > 0 ? platforms.join(', ') : 'none'} |
| Total engagement score | ${fmtNum(totalEngagement)} |

**Platforms included this week:**
${platformCoverage}

---

## Top 3 Posts — Post More Like These

${engagementTable(top3)}

### What to Do More Of

${narrative.doMoreOf}

---

## Bottom 3 Posts — Flagged for Review

${engagementTable(bottom3)}

### What to Stop or Rethink

${narrative.stopDoing}

---

${enrollmentSection}
---

## Scoring Methodology

Each post receives an **engagement score** calculated as:
> (Likes x 1) + (Comments x 3) + (Shares x 5) + (Saves x 2)

Posts are **ranked within their platform** (normalized by z-score) to account for platform audience size differences. Views are reported but excluded from the score — they measure exposure, not intent.

---

*Report generated by BigHeart Health Enrollment Funnel Agent v1.0*
*Data source: manual CSV upload + Supabase content_items / performance_data*
`
}

export function saveReport(content: string, reportsDir: string, weekLabel: string): string {
  fs.mkdirSync(reportsDir, { recursive: true })
  const filename = `bigheart-weekly-${weekLabel}.md`
  const filepath = path.join(reportsDir, filename)
  fs.writeFileSync(filepath, content, 'utf-8')
  return filepath
}

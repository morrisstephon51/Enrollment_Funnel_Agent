import Anthropic from '@anthropic-ai/sdk'
import type { ScoredPost } from './scorer.js'

export interface ReportNarrative {
  summary: string
  doMoreOf: string
  stopDoing: string
  enrollmentNote: string
}

export async function generateNarrative(
  top3: ScoredPost[],
  bottom3: ScoredPost[],
  enrollmentData: { url: string; trafficRows: EnrollmentRow[] } | null,
  dropWarning: { dropped: boolean; pctChange: number } | null,
  weekLabel: string
): Promise<ReportNarrative> {
  const topSummary = top3
    .map(
      (p, i) =>
        `${i + 1}. [${p.platform.toUpperCase()}] "${p.topic}" - score ${p.engagementScore} (${p.likes} likes, ${p.comments} comments, ${p.shares} shares, ${p.saves} saves)`
    )
    .join('\n')

  const bottomSummary = bottom3
    .map(
      (p, i) =>
        `${i + 1}. [${p.platform.toUpperCase()}] "${p.topic}" - score ${p.engagementScore}`
    )
    .join('\n')

  const enrollmentContext = enrollmentData
    ? `Enrollment page: ${enrollmentData.url}\nTraffic data rows this week: ${enrollmentData.trafficRows.length}\nTop UTM sources: ${topUtmSources(enrollmentData.trafficRows).join(', ')}`
    : 'No enrollment traffic data provided this week.'

  const dropContext = dropWarning?.dropped
    ? `WARNING: Total engagement dropped ${Math.abs(dropWarning.pctChange)}% below the 4-week average.`
    : 'Engagement is within normal range.'

  const prompt = `You are a healthcare content strategist for BigHeart Health, a community health enrollment program.

Analyze this week's content performance (week of ${weekLabel}) and respond with ONLY a JSON object — no markdown fences, no preamble, no trailing text.

TOP PERFORMING POSTS:
${topSummary}

POSTS FLAGGED FOR REVIEW (lowest engagement):
${bottomSummary}

ENROLLMENT CORRELATION:
${enrollmentContext}

ENGAGEMENT STATUS:
${dropContext}

Return exactly this JSON shape:
{
  "summary": "2-3 sentence executive summary of what worked and why it matters for enrollment",
  "doMoreOf": "1-2 specific content themes or formats to repeat based on top posts",
  "stopDoing": "1-2 specific things to cut or change based on bottom posts",
  "enrollmentNote": "1 sentence tying content performance to enrollment page (or noting the data gap)"
}

Tone: warm but data-informed. Avoid jargon. Write for a non-technical health program director.`

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const message = await client.messages.create({
    model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}'
  try {
    const jsonStr = text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(jsonStr)
    return {
      summary: parsed.summary ?? '',
      doMoreOf: parsed.doMoreOf ?? '',
      stopDoing: parsed.stopDoing ?? '',
      enrollmentNote: parsed.enrollmentNote ?? '',
    }
  } catch {
    // Fallback: extract JSON block from response
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0])
        return {
          summary: parsed.summary ?? '',
          doMoreOf: parsed.doMoreOf ?? '',
          stopDoing: parsed.stopDoing ?? '',
          enrollmentNote: parsed.enrollmentNote ?? '',
        }
      } catch {
        // fall through to safe return below
      }
    }
    return { summary: text.slice(0, 300), doMoreOf: '', stopDoing: '', enrollmentNote: '' }
  }
}

export interface EnrollmentRow {
  source?: string
  medium?: string
  campaign?: string
  sessions?: number
  [key: string]: string | number | undefined
}

/**
 * Parse a GA4 "Sessions" cell, tolerating the thousand-separators GA4 emits in
 * UI-exported CSVs ("1,024"). Returns NaN when the row carries no usable session
 * value so each caller can pick its own fallback (reporter -> row count for the
 * client line; topUtmSources -> assume 1 session per listed source).
 *
 * Single source of truth shared with reporter.ts so the two Sessions parsers
 * cannot drift again: a bare Number("1,024") is NaN, which corrupted the
 * UTM-source counts fed into the Claude prompt (the two biggest, comma-formatted
 * sources rendered as "(NaN)" and were mis-sorted below a smaller source).
 */
export function parseSessionCount(row: EnrollmentRow): number {
  const raw = row['Sessions'] ?? row.sessions
  if (raw === undefined || raw === null || raw === '') return NaN
  return Number(String(raw).replace(/,/g, '').trim())
}

export function topUtmSources(rows: EnrollmentRow[]): string[] {
  const counts: Record<string, number> = {}
  for (const r of rows) {
    // GA4 CSV exports use "Session source" / "Sessions"; fall back to normalized field names
    const key = (r['Session source'] as string | undefined) ?? r.source ?? 'unknown'
    // A row without a usable session count still names a real source -- count it as 1.
    const parsed = parseSessionCount(r)
    const sessionCount = Number.isNaN(parsed) ? 1 : parsed
    counts[key] = (counts[key] ?? 0) + sessionCount
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} (${v})`)
}

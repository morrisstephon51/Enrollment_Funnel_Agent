import Anthropic from '@anthropic-ai/sdk'
import type { ScoredPost } from './scorer.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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
        `${i + 1}. [${p.platform.toUpperCase()}] "${p.topic}" — score ${p.engagementScore} (${p.likes} likes, ${p.comments} comments, ${p.shares} shares, ${p.saves} saves)`
    )
    .join('\n')

  const bottomSummary = bottom3
    .map(
      (p, i) =>
        `${i + 1}. [${p.platform.toUpperCase()}] "${p.topic}" — score ${p.engagementScore}`
    )
    .join('\n')

  const enrollmentContext = enrollmentData
    ? `Enrollment page: ${enrollmentData.url}\nTraffic data rows this week: ${enrollmentData.trafficRows.length}\nTop UTM sources: ${topUtmSources(enrollmentData.trafficRows).join(', ')}`
    : 'No enrollment traffic data provided this week.'

  const dropContext = dropWarning?.dropped
    ? `⚠️ WARNING: Total engagement dropped ${Math.abs(dropWarning.pctChange)}% below the 4-week average.`
    : 'Engagement is within normal range.'

  const prompt = `You are a healthcare content strategist for BigHeart Health, a community health enrollment program.

Write a brief stakeholder-friendly analysis for the week of ${weekLabel}.

TOP PERFORMING POSTS:
${topSummary}

POSTS FLAGGED FOR REVIEW (lowest engagement):
${bottomSummary}

ENROLLMENT CORRELATION:
${enrollmentContext}

ENGAGEMENT STATUS:
${dropContext}

Write:
1. A 2-3 sentence executive summary (what worked this week and why it matters for enrollment)
2. "Do more of" — 1-2 specific content themes or formats to repeat (based on top posts)
3. "Stop doing / rethink" — 1-2 specific things to cut or change (based on bottom posts)
4. A 1-sentence enrollment note (tie content performance to enrollment page if data exists, otherwise note the gap)

Tone: warm but data-informed. Avoid jargon. Write for a non-technical health program director.`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  return parseNarrative(text)
}

function parseNarrative(text: string): ReportNarrative {
  // Best-effort parse — Claude returns numbered sections
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const summary = lines.slice(0, 3).join(' ')
  const doMoreIdx = lines.findIndex((l) => l.toLowerCase().includes('do more'))
  const stopIdx = lines.findIndex((l) => l.toLowerCase().includes('stop') || l.toLowerCase().includes('rethink'))
  const enrollIdx = lines.findIndex((l) => l.toLowerCase().includes('enroll'))

  return {
    summary,
    doMoreOf: doMoreIdx >= 0 ? lines.slice(doMoreIdx, stopIdx > doMoreIdx ? stopIdx : doMoreIdx + 3).join(' ') : lines[3] ?? '',
    stopDoing: stopIdx >= 0 ? lines.slice(stopIdx, enrollIdx > stopIdx ? enrollIdx : stopIdx + 3).join(' ') : lines[5] ?? '',
    enrollmentNote: enrollIdx >= 0 ? lines.slice(enrollIdx).join(' ') : lines[lines.length - 1] ?? '',
  }
}

export interface EnrollmentRow {
  source?: string
  medium?: string
  campaign?: string
  sessions?: number
}

function topUtmSources(rows: EnrollmentRow[]): string[] {
  const counts: Record<string, number> = {}
  for (const r of rows) {
    const key = r.source ?? 'unknown'
    counts[key] = (counts[key] ?? 0) + (r.sessions ?? 1)
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} (${v})`)
}

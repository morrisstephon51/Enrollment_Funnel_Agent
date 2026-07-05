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
      const parsed = JSON.parse(match[0])
      return {
        summary: parsed.summary ?? '',
        doMoreOf: parsed.doMoreOf ?? '',
        stopDoing: parsed.stopDoing ?? '',
        enrollmentNote: parsed.enrollmentNote ?? '',
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

import type { NormalizedRow } from './csv-normalizer.js'

export interface ScoredPost extends NormalizedRow {
  engagementScore: number
  normalizedScore: number // z-score within platform
}

/** Weighted engagement score — high-intent signals weighted above passive views. */
export function computeEngagementScore(row: NormalizedRow): number {
  return row.likes * 1 + row.comments * 3 + row.shares * 5 + row.saves * 2
}

export function scoreAndRank(rows: NormalizedRow[]): ScoredPost[] {
  // Group by platform to normalize within each
  const byPlatform: Record<string, NormalizedRow[]> = {}
  for (const row of rows) {
    if (!byPlatform[row.platform]) byPlatform[row.platform] = []
    byPlatform[row.platform].push(row)
  }

  const scored: ScoredPost[] = []

  for (const [, platformRows] of Object.entries(byPlatform)) {
    const rawScores = platformRows.map(computeEngagementScore)
    const mean = rawScores.reduce((a, b) => a + b, 0) / rawScores.length
    const variance =
      rawScores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / rawScores.length
    const stdDev = Math.sqrt(variance) || 1

    for (let i = 0; i < platformRows.length; i++) {
      scored.push({
        ...platformRows[i],
        engagementScore: rawScores[i],
        normalizedScore: (rawScores[i] - mean) / stdDev,
      })
    }
  }

  return scored.sort((a, b) => b.normalizedScore - a.normalizedScore)
}

export function checkEngagementDrop(
  currentTotal: number,
  rollingTotals: number[]
): { dropped: boolean; pctChange: number; baseline: number } {
  const validTotals = rollingTotals.filter((t) => t > 0)
  if (validTotals.length === 0) return { dropped: false, pctChange: 0, baseline: 0 }

  const baseline = validTotals.reduce((a, b) => a + b, 0) / validTotals.length
  if (baseline === 0) return { dropped: false, pctChange: 0, baseline: 0 }

  const pctChange = ((currentTotal - baseline) / baseline) * 100
  return {
    dropped: pctChange < -20,
    pctChange: Math.round(pctChange * 10) / 10,
    baseline: Math.round(baseline),
  }
}

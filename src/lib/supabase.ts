import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { computeEngagementScore, type EngagementCounts } from './scorer.js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or legacy NEXT_PUBLIC_ equivalents) in env')
  }
  _supabase = createClient(url, key)
  return _supabase
}

export interface ContentRecord {
  id: string
  platform: string
  publish_date: string
  topic: string
  post_id: string | null
  social_post_url: string | null
}

export interface PerformanceRecord {
  content_item_id: string
  platform: string
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  reach: number
  link_clicks: number
  recorded_at: string
}

/** Fetch content posted in the given week, joined with performance data already in DB. */
export async function fetchWeekContent(
  brandId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<{ content: ContentRecord[]; performance: PerformanceRecord[] }> {
  const supabase = getSupabase()
  const { data: slots, error: slotsErr } = await supabase
    .from('calendar_slots')
    .select(`
      id,
      platform,
      posted_at,
      social_post_url,
      content_item_id,
      content_items (
        id,
        input_topic,
        tags
      )
    `)
    .eq('brand_id', brandId)
    .eq('status', 'posted')
    .gte('posted_at', weekStart.toISOString())
    // weekEnd is the EXCLUSIVE next-Monday bound (weekStart + 7d), so the week
    // window is half-open [weekStart, weekEnd). Using .lt (not .lte) keeps a post
    // published exactly at the boundary Monday 00:00 out of two consecutive
    // weekly reports (it belongs only to the week that STARTS at that instant).
    .lt('posted_at', weekEnd.toISOString())

  if (slotsErr) throw new Error(`Supabase calendar_slots error: ${slotsErr.message}`)

  const content: ContentRecord[] = (slots ?? []).map((s: any) => ({
    id: s.content_item_id,
    platform: s.platform,
    publish_date: s.posted_at,
    topic: s.content_items?.input_topic ?? '(no topic)',
    post_id: s.id,
    social_post_url: s.social_post_url,
  }))

  const contentIds = content.map((c) => c.id).filter(Boolean)
  let performance: PerformanceRecord[] = []

  if (contentIds.length > 0) {
    const { data: perf, error: perfErr } = await supabase
      .from('performance_data')
      .select('*')
      .in('content_item_id', contentIds)

    if (perfErr) throw new Error(`Supabase performance_data error: ${perfErr.message}`)
    performance = perf ?? []
  }

  return { content, performance }
}

/** Fetch the last N weeks of total engagement for drop detection.
 *  Uses 2 queries total (regardless of weeksBack) instead of 2×N serial queries.
 */
export async function fetchRollingEngagement(
  brandId: string,
  weeksBack: number,
  weekStart: Date
): Promise<number[]> {
  const supabase = getSupabase()

  // Build week boundary arrays so we can bin slots by week index later.
  const weekBoundaries: Array<{ start: Date; end: Date }> = []
  for (let i = 1; i <= weeksBack; i++) {
    const end = new Date(weekStart)
    end.setDate(end.getDate() - (i - 1) * 7)
    const start = new Date(end)
    start.setDate(start.getDate() - 7)
    weekBoundaries.push({ start, end })
  }

  const rangeStart = weekBoundaries[weekBoundaries.length - 1].start
  const rangeEnd   = weekBoundaries[0].end

  // Single query: all posted slots in the full N-week window.
  const { data: slots, error: slotsErr } = await supabase
    .from('calendar_slots')
    .select('content_item_id, posted_at')
    .eq('brand_id', brandId)
    .eq('status', 'posted')
    .gte('posted_at', rangeStart.toISOString())
    // Half-open upper bound: rangeEnd == current weekStart, so a boundary post at
    // that instant belongs to the current week, not the most recent baseline week.
    .lt('posted_at', rangeEnd.toISOString())

  if (slotsErr) throw new Error(`Supabase calendar_slots error: ${slotsErr.message}`)

  // Assign each posted slot to its week index. A content item cross-posted to N
  // platforms appears as N slots; it is de-duplicated per week inside
  // aggregateWeeklyEngagement so its engagement is counted once, matching the
  // current-week total's `.in(content_item_id)` set semantics in agent.ts.
  const slotWeekAssignments: Array<{ weekIdx: number; contentItemId: string }> = []
  for (const s of slots ?? []) {
    const postedAt = new Date(s.posted_at)
    const weekIdx = weekBoundaries.findIndex(
      ({ start, end }) => postedAt >= start && postedAt < end
    )
    if (weekIdx === -1 || !s.content_item_id) continue
    slotWeekAssignments.push({ weekIdx, contentItemId: s.content_item_id })
  }

  const allIds = [...new Set((slots ?? []).map((s: any) => s.content_item_id).filter(Boolean))]

  // Single query: performance for all IDs across all weeks. performance_data is keyed
  // on (content_item_id, platform) -- the same composite key upsertPerformance writes --
  // so a cross-posted item has one row PER PLATFORM. Collect ALL rows per item; keying
  // by content_item_id alone (as before) kept only whichever row the query returned last
  // and silently dropped every other platform's engagement from the baseline.
  const perfRowsByItem: Map<string, EngagementCounts[]> = new Map()
  if (allIds.length > 0) {
    const { data: perf, error: perfErr } = await supabase
      .from('performance_data')
      .select('content_item_id, likes, comments, shares, saves')
      .in('content_item_id', allIds)

    if (perfErr) throw new Error(`Supabase performance_data error: ${perfErr.message}`)

    for (const p of perf ?? []) {
      const row: EngagementCounts = {
        likes:    p.likes    ?? 0,
        comments: p.comments ?? 0,
        shares:   p.shares   ?? 0,
        saves:    p.saves    ?? 0,
      }
      const rows = perfRowsByItem.get(p.content_item_id)
      if (rows) rows.push(row)
      else perfRowsByItem.set(p.content_item_id, [row])
    }
  }

  // Aggregate by week. Reuse computeEngagementScore so this baseline and the current-week
  // total (agent.ts) apply identical weights AND count the same per-platform rows the same
  // way -- see aggregateWeeklyEngagement for why the old per-item collapse made the
  // "-20% vs 4-week average" comparison measure two differently-shaped totals.
  return aggregateWeeklyEngagement(slotWeekAssignments, perfRowsByItem, weekBoundaries.length)
}

/**
 * Pure per-week engagement aggregator, factored out of fetchRollingEngagement so the
 * baseline math is unit-testable without a live Supabase connection (and so the bug it
 * fixes can be pinned by a non-tautological red->green test).
 *
 * For each week it takes the DISTINCT set of content items posted that week and sums
 * computeEngagementScore over EVERY one of their performance rows (one row per platform)
 * exactly once -- mirroring the current-week total in agent.ts, which scores one row per
 * performance_data row returned by `.in(content_item_id)`. The previous implementation
 * kept a single perf row per content_item_id (last-write-wins) and then re-counted that
 * survivor once per platform slot, so a cross-posted item both double-counted the
 * surviving platform and dropped the others. The weights already matched (PR #29); this
 * makes the row-level aggregation match too, so drop detection compares like with like.
 */
export function aggregateWeeklyEngagement(
  slotWeekAssignments: Array<{ weekIdx: number; contentItemId: string }>,
  perfRowsByItem: Map<string, EngagementCounts[]>,
  weekCount: number
): number[] {
  const distinctIdsByWeek: Array<Set<string>> = Array.from(
    { length: weekCount },
    () => new Set<string>()
  )
  for (const { weekIdx, contentItemId } of slotWeekAssignments) {
    if (weekIdx < 0 || weekIdx >= weekCount || !contentItemId) continue
    distinctIdsByWeek[weekIdx].add(contentItemId)
  }
  return distinctIdsByWeek.map((ids) => {
    let total = 0
    for (const id of ids) {
      for (const row of perfRowsByItem.get(id) ?? []) {
        total += computeEngagementScore(row)
      }
    }
    return total
  })
}

/** Upsert performance rows from CSV import. */
export async function upsertPerformance(rows: PerformanceRecord[]): Promise<void> {
  if (rows.length === 0) return
  const supabase = getSupabase()
  const { error } = await supabase.from('performance_data').upsert(rows, {
    onConflict: 'content_item_id,platform',
  })
  if (error) throw new Error(`Failed to upsert performance data: ${error.message}`)
}

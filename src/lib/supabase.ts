import { createClient, SupabaseClient } from '@supabase/supabase-js'
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

  // Map each slot to its week index.
  const slotsByWeek: Map<number, string[]> = new Map()
  for (const s of slots ?? []) {
    const postedAt = new Date(s.posted_at)
    const weekIdx = weekBoundaries.findIndex(
      ({ start, end }) => postedAt >= start && postedAt < end
    )
    if (weekIdx === -1 || !s.content_item_id) continue
    if (!slotsByWeek.has(weekIdx)) slotsByWeek.set(weekIdx, [])
    slotsByWeek.get(weekIdx)!.push(s.content_item_id)
  }

  const allIds = [...new Set((slots ?? []).map((s: any) => s.content_item_id).filter(Boolean))]

  // Single query: performance for all IDs across all weeks.
  const perfByItemId: Map<string, { likes: number; comments: number; shares: number; saves: number }> = new Map()
  if (allIds.length > 0) {
    const { data: perf, error: perfErr } = await supabase
      .from('performance_data')
      .select('content_item_id, likes, comments, shares, saves')
      .in('content_item_id', allIds)

    if (perfErr) throw new Error(`Supabase performance_data error: ${perfErr.message}`)

    for (const p of perf ?? []) {
      perfByItemId.set(p.content_item_id, {
        likes:    p.likes    ?? 0,
        comments: p.comments ?? 0,
        shares:   p.shares   ?? 0,
        saves:    p.saves    ?? 0,
      })
    }
  }

  // Aggregate by week in memory.
  return weekBoundaries.map((_, i) => {
    const ids = slotsByWeek.get(i) ?? []
    return ids.reduce((sum, id) => {
      const p = perfByItemId.get(id)
      if (!p) return sum
      return sum + p.likes + p.comments * 3 + p.shares * 5 + p.saves * 2
    }, 0)
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

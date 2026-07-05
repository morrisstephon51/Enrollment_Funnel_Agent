import { createClient, SupabaseClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in env')
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
    .lte('posted_at', weekEnd.toISOString())

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

/** Fetch the last N weeks of total engagement for drop detection. */
export async function fetchRollingEngagement(
  brandId: string,
  weeksBack: number,
  weekStart: Date
): Promise<number[]> {
  const supabase = getSupabase()
  const totals: number[] = []

  for (let i = 1; i <= weeksBack; i++) {
    const end = new Date(weekStart)
    end.setDate(end.getDate() - (i - 1) * 7)
    const start = new Date(end)
    start.setDate(start.getDate() - 7)

    const { data: slots } = await supabase
      .from('calendar_slots')
      .select('content_item_id')
      .eq('brand_id', brandId)
      .eq('status', 'posted')
      .gte('posted_at', start.toISOString())
      .lte('posted_at', end.toISOString())

    const ids = (slots ?? []).map((s: any) => s.content_item_id).filter(Boolean)
    if (ids.length === 0) {
      totals.push(0)
      continue
    }

    const { data: perf } = await supabase
      .from('performance_data')
      .select('likes, comments, shares, saves')
      .in('content_item_id', ids)

    const total = (perf ?? []).reduce(
      (sum: number, p: any) =>
        sum + (p.likes ?? 0) + (p.comments ?? 0) * 3 + (p.shares ?? 0) * 5 + (p.saves ?? 0) * 2,
      0
    )
    totals.push(total)
  }

  return totals
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

import { parse } from 'csv-parse/sync'
import fs from 'fs'
import path from 'path'

export interface NormalizedRow {
  postId: string
  platform: 'instagram' | 'tiktok' | 'facebook' | 'youtube'
  topic: string
  publishDate: string
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  reach: number
  linkClicks: number
}

type ColumnMap = Record<string, string>

// Maps normalized field → possible raw column names per platform
const PLATFORM_MAPS: Record<string, ColumnMap> = {
  instagram: {
    postId: 'Post ID',
    topic: 'Description',
    publishDate: 'Post Publish Time',
    views: 'Impressions',
    likes: 'Likes',
    comments: 'Comments',
    shares: 'Shares',
    saves: 'Saves',
    reach: 'Reach',
    linkClicks: 'Profile Activity',
  },
  tiktok: {
    postId: 'Video ID',
    topic: 'Video Title',
    publishDate: 'Video Publish Time',
    views: 'Video Views',
    likes: 'Likes',
    comments: 'Comments',
    shares: 'Shares',
    saves: 'Saves',
    reach: 'Profile Views',
    linkClicks: '',
  },
  facebook: {
    postId: 'Post ID',
    topic: 'Post message',
    publishDate: 'Published',
    views: 'Post impressions',
    likes: 'Reactions',
    comments: 'Comments',
    shares: 'Shares',
    saves: '',
    reach: 'Post reach',
    linkClicks: 'Link clicks',
  },
  youtube: {
    postId: 'Video ID',
    topic: 'Video title',
    publishDate: 'Video publish time',
    views: 'Views',
    likes: 'Likes',
    comments: 'Comments',
    shares: 'Shares',
    saves: '',
    reach: '',
    linkClicks: '',
  },
}

function detectPlatform(filename: string, headers: string[]): NormalizedRow['platform'] {
  const lower = filename.toLowerCase()
  if (lower.includes('instagram') || lower.includes('ig')) return 'instagram'
  if (lower.includes('tiktok') || lower.includes('tt')) return 'tiktok'
  if (lower.includes('facebook') || lower.includes('fb') || lower.includes('meta'))
    return 'facebook'
  if (lower.includes('youtube') || lower.includes('yt')) return 'youtube'

  // Fallback: detect from unique column signatures
  const headerStr = headers.join(' ').toLowerCase()
  if (headerStr.includes('video title') && headerStr.includes('completion rate')) return 'tiktok'
  if (headerStr.includes('video title') && headerStr.includes('watch time')) return 'youtube'
  if (headerStr.includes('post reach') && headerStr.includes('reactions')) return 'facebook'
  if (headerStr.includes('saves') && headerStr.includes('post publish time')) return 'instagram'

  throw new Error(
    `Cannot detect platform from filename "${filename}" or headers. ` +
      `Include the platform name in the filename (e.g. instagram-week.csv).`
  )
}

function getNum(row: Record<string, string>, col: string): number {
  if (!col || !(col in row)) return 0
  const raw = row[col]?.replace(/,/g, '').trim()
  const n = parseFloat(raw ?? '')
  return isNaN(n) ? 0 : Math.round(n)
}

function getStr(row: Record<string, string>, col: string): string {
  if (!col || !(col in row)) return ''
  return row[col]?.trim() ?? ''
}

export function parseCSV(filePath: string): NormalizedRow[] {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const filename = path.basename(filePath)

  const records: Record<string, string>[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true, // handle Excel BOM
  })

  if (records.length === 0) {
    console.warn(`[csv] ${filename}: no rows found, skipping`)
    return []
  }

  const headers = Object.keys(records[0])
  const platform = detectPlatform(filename, headers)
  const map = PLATFORM_MAPS[platform]

  const skipped: string[] = []
  const rows: NormalizedRow[] = []

  for (const rec of records) {
    const postId = getStr(rec, map.postId)
    if (!postId) {
      skipped.push('missing post ID')
      continue
    }
    rows.push({
      postId,
      platform,
      topic: getStr(rec, map.topic).slice(0, 200),
      publishDate: getStr(rec, map.publishDate),
      views: getNum(rec, map.views),
      likes: getNum(rec, map.likes),
      comments: getNum(rec, map.comments),
      shares: getNum(rec, map.shares),
      saves: getNum(rec, map.saves),
      reach: getNum(rec, map.reach),
      linkClicks: getNum(rec, map.linkClicks),
    })
  }

  if (skipped.length > 0) {
    console.warn(`[csv] ${filename}: skipped ${skipped.length} row(s) — ${skipped[0]}`)
  }

  console.log(`[csv] ${filename}: parsed ${rows.length} rows as ${platform}`)
  return rows
}

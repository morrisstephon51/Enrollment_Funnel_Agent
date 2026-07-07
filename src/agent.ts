#!/usr/bin/env tsx
/**
 * BigHeart Health — Enrollment Funnel Agent
 * Generates a weekly performance report from manual CSV uploads + Supabase data.
 *
 * Usage:
 *   npm run report -- --csv instagram.csv --csv tiktok.csv --week 2026-06-02
 *   npm run report -- --help
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config() // fallback to .env
import path from 'path'
import { parseCSV } from './lib/csv-normalizer.js'
import { scoreAndRank, checkEngagementDrop, computeEngagementScore } from './lib/scorer.js'
import { generateNarrative } from './lib/claude-client.js'
import { buildReport, saveReport } from './lib/reporter.js'
import { fetchWeekContent, fetchRollingEngagement } from './lib/supabase.js'
import { maybeCreateCanvaDoc } from './lib/canva-stub.js'
import { parse as parseCSVEnrollment } from 'csv-parse/sync'
import fs from 'fs'

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(args: string[]) {
  const result = {
    csvFiles: [] as string[],
    enrollmentCsv: null as string | null,
    week: null as string | null,
    brandId: process.env.BRAND_ID ?? null,
    help: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') result.help = true
    else if (arg === '--csv') result.csvFiles.push(args[++i])
    else if (arg === '--enrollment-csv') result.enrollmentCsv = args[++i]
    else if (arg === '--week') result.week = args[++i]
    else if (arg === '--brand-id') result.brandId = args[++i]
    else if (arg.startsWith('--csv=')) result.csvFiles.push(arg.slice(6))
    else if (arg.startsWith('--week=')) result.week = arg.slice(7)
    else if (arg.startsWith('--brand-id=')) result.brandId = arg.slice(11)
  }

  return result
}

function printHelp() {
  console.log(`
BigHeart Health — Enrollment Funnel Agent

Usage:
  npm run report -- [options]

Options:
  --csv <file>           Analytics CSV file (repeat for multiple platforms)
  --enrollment-csv <f>   GA4 UTM traffic export for enrollment page (optional)
  --week <YYYY-MM-DD>    Week start date (Monday). Defaults to last Monday.
  --brand-id <uuid>      Supabase brand ID (defaults to BRAND_ID env var)
  --help                 Show this help

Examples:
  npm run report -- --csv data/instagram-2026-06-02.csv --csv data/tiktok-2026-06-02.csv
  npm run report -- --csv data/all-platforms.csv --week 2026-05-26 --enrollment-csv data/ga4.csv

Platform CSV filename hints (auto-detected):
  Include "instagram", "tiktok", "facebook", or "youtube" in the filename.

Output:
  reports/bigheart-weekly-YYYY-MM-DD.md
`)
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function lastMonday(from: Date = new Date()): Date {
  // Pin to CT — agent runs for BigHeart Health in Chicago; near-midnight Sunday UTC
  // would otherwise produce the wrong week label when the server is in UTC.
  const ct = new Date(from.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const day = ct.getDay() // 0=Sun, 1=Mon...
  const diff = day === 0 ? 6 : day - 1
  ct.setDate(ct.getDate() - diff)
  ct.setHours(0, 0, 0, 0)
  return ct
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function toWeekLabel(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const opts = parseArgs(args)

  if (opts.help) {
    printHelp()
    process.exit(0)
  }

  // Resolve week window
  const weekStart = opts.week ? new Date(opts.week + 'T00:00:00') : lastMonday()
  const weekEnd = addDays(weekStart, 7)
  const weekLabel = toWeekLabel(weekStart)

  console.log(`\n🗓  Week: ${weekLabel} → ${toWeekLabel(weekEnd)}`)
  console.log(`📁  Reports dir: ${process.env.REPORTS_DIR ?? './reports'}\n`)

  // ── Step 1: Parse uploaded CSVs ────────────────────────────────────────────
  const allCsvRows = opts.csvFiles.flatMap((f) => parseCSV(path.resolve(f)))

  // ── Step 2: If brand ID available, pull Supabase content for the week ──────
  let supabaseRows: typeof allCsvRows = []
  if (opts.brandId) {
    try {
      console.log(`[supabase] Fetching posted content for brand ${opts.brandId}...`)
      const { content, performance } = await fetchWeekContent(
        opts.brandId,
        weekStart,
        weekEnd
      )
      console.log(`[supabase] Found ${content.length} posted slots, ${performance.length} perf rows`)

      // Merge Supabase performance rows into the CSV row pool
      for (const perf of performance) {
        const match = content.find((c) => c.id === perf.content_item_id)
        supabaseRows.push({
          postId: perf.content_item_id,
          platform: perf.platform as any,
          topic: match?.topic ?? '(from Supabase)',
          publishDate: perf.recorded_at,
          views: perf.views,
          likes: perf.likes,
          comments: perf.comments,
          shares: perf.shares,
          saves: perf.saves,
          reach: perf.reach,
          linkClicks: perf.link_clicks,
        })
      }
    } catch (err) {
      console.warn(`[supabase] Could not fetch — running on CSV data only. Error: ${(err as Error).message}`)
    }
  } else {
    console.log('[supabase] No BRAND_ID set — skipping DB lookup, using CSV data only.')
  }

  // Merge: CSV rows override Supabase rows for same postId (CSV is the source of truth for analytics)
  const csvPostIds = new Set(allCsvRows.map((r) => r.postId))
  const merged = [
    ...allCsvRows,
    ...supabaseRows.filter((r) => !csvPostIds.has(r.postId)),
  ]

  if (merged.length === 0) {
    console.error('\n❌ No data to report. Provide at least one --csv file or ensure Supabase has performance data for this week.')
    process.exit(1)
  }

  // ── Step 3: Score and rank ─────────────────────────────────────────────────
  const scored = scoreAndRank(merged)
  const top3 = scored.slice(0, 3)
  const bottom3 = scored.slice(-3).reverse()
  const totalEngagement = scored.reduce((s, p) => s + computeEngagementScore(p), 0)
  const platforms = [...new Set(scored.map((p) => p.platform))]

  console.log(`\n📊 Scored ${scored.length} posts across ${platforms.join(', ')}`)
  console.log(`   Top: "${top3[0]?.topic?.slice(0, 60)}" (score: ${top3[0]?.engagementScore})`)

  // ── Step 4: Engagement drop check ─────────────────────────────────────────
  let dropWarning = null
  if (opts.brandId) {
    try {
      const rolling = await fetchRollingEngagement(opts.brandId, 4, weekStart)
      dropWarning = checkEngagementDrop(totalEngagement, rolling)
      if (dropWarning.dropped) {
        console.warn(`\n⚠️  ALERT: Engagement down ${Math.abs(dropWarning.pctChange)}% vs 4-week avg`)
      }
    } catch {
      // Non-fatal — rolling data optional
    }
  }

  // ── Step 5: Parse enrollment CSV if provided ───────────────────────────────
  let enrollmentData = null
  if (opts.enrollmentCsv) {
    try {
      const raw = fs.readFileSync(path.resolve(opts.enrollmentCsv), 'utf-8')
      const rows = parseCSVEnrollment(raw, { columns: true, skip_empty_lines: true, bom: true })
      enrollmentData = {
        url: process.env.ENROLLMENT_PAGE_URL ?? 'https://bighearthealth.com/enroll',
        trafficRows: rows,
      }
      console.log(`[enrollment] Loaded ${rows.length} traffic rows from ${opts.enrollmentCsv}`)
    } catch (err) {
      console.warn(`[enrollment] Could not parse enrollment CSV: ${(err as Error).message}`)
    }
  }

  // ── Step 6: Claude narrative ───────────────────────────────────────────────
  console.log('\n🤖 Generating narrative with Claude...')
  let narrative
  try {
    narrative = await generateNarrative(top3, bottom3, enrollmentData, dropWarning, weekLabel)
  } catch (err) {
    console.warn(`[claude] API error, using placeholder narrative: ${(err as Error).message}`)
    narrative = {
      summary: 'Claude narrative unavailable this week — check ANTHROPIC_API_KEY.',
      doMoreOf: 'Review top posts manually.',
      stopDoing: 'Review bottom posts manually.',
      enrollmentNote: 'Enrollment correlation requires manual review.',
    }
  }

  // ── Step 7: Build and save report ─────────────────────────────────────────
  const report = buildReport({
    weekLabel,
    weekStart,
    weekEnd,
    allPosts: scored,
    top3,
    bottom3,
    narrative,
    enrollmentData,
    dropWarning,
    platforms,
    totalPosts: scored.length,
    totalEngagement,
  })

  const reportsDir = path.resolve(process.env.REPORTS_DIR ?? './reports')
  const reportPath = saveReport(report, reportsDir, weekLabel)
  console.log(`\n✅ Report saved: ${reportPath}`)

  // ── Step 8: Optional Canva doc ────────────────────────────────────────────
  const canvaUrl = await maybeCreateCanvaDoc(reportPath, weekLabel)
  if (canvaUrl) {
    console.log(`🎨 Canva doc: ${canvaUrl}`)
  }

  console.log('\n📋 Quick summary:')
  console.log(`   Top post:    "${top3[0]?.topic?.slice(0, 60)}"`)
  console.log(`   Bottom post: "${bottom3[0]?.topic?.slice(0, 60)}"`)
  console.log(`   Do more of:  ${narrative.doMoreOf.slice(0, 100)}...`)
  if (dropWarning?.dropped) {
    console.log(`   ⚠️  Engagement down ${Math.abs(dropWarning.pctChange)}% — flag for review`)
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message)
  process.exit(1)
})

import { parse } from 'csv-parse/sync'
import type { EnrollmentRow } from './claude-client.js'

// Options are kept BYTE-IDENTICAL to the platform CSV parser (csv-normalizer.ts
// parseCSV). Both call-sites read the same kind of hand-touched "manual CSV
// upload", so their parse options must not drift.
//
// `trim: true` is the load-bearing one here. A GA4 UTM export re-saved through
// Excel/Sheets commonly leaves a space after each comma delimiter, so a header
// row like `Session source, Sessions, New users` parses (without trim) to the
// keys ["Session source", " Sessions", " New users"]. reporter.ts then looks up
// `r['Sessions']`, misses the " Sessions" key, reports hasSessionColumn=false,
// and the weekly report silently collapses to the row-count fallback — the exact
// undercount #23 fixed. topUtmSources likewise falls back to `?? 1`, counting
// every source as a single session in the narrative prompt. Trimming restores
// the clean keys so real session totals flow through.
const ENROLLMENT_CSV_OPTIONS = {
  columns: true,
  skip_empty_lines: true,
  trim: true,
  bom: true, // handle Excel BOM
} as const

/** Parse a GA4 UTM traffic export into rows, tolerant of hand-edited whitespace. */
export function parseEnrollmentCsv(raw: string): EnrollmentRow[] {
  return parse(raw, ENROLLMENT_CSV_OPTIONS) as EnrollmentRow[]
}

/** Canva integration stub — set CANVA_ENABLED=true to activate in a future release. */
export async function maybeCreateCanvaDoc(
  reportPath: string,
  weekLabel: string
): Promise<string | null> {
  if (process.env.CANVA_ENABLED !== 'true') return null

  // TODO: Implement using Composio Canva tools when CANVA_ENABLED=true
  // Steps:
  // 1. Read report markdown
  // 2. Use mcp__Canva__create-design-from-brand-template with BigHeart brand kit
  // 3. Populate slides with top/bottom post data
  // 4. Return Canva share URL
  console.log('[canva] CANVA_ENABLED=true detected — Canva integration coming in v2.')
  return null
}

/** Shared UI formatting helpers. One implementation, every surface. */

/** Compact relative time: "12m ago", "3h ago", "4d ago". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const mins = Math.max(1, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Same clock without the "ago" suffix, for tight UIs: "12m", "3h", "4d". */
export function timeAgoCompact(iso: string, now: number = Date.now()): string {
  const mins = Math.max(1, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * Sanitize user text before interpolating it into a PostgREST `.or()` /
 * `.ilike()` filter. PostgREST treats `,` `(` `)` `%` `"` and `\` as filter
 * structure — one stray parenthesis in a search box would otherwise
 * restructure (and widen) the whole query. RLS still applies, but search
 * bypass and error spam are worth preventing at the source.
 */
export function sanitizeFilterText(input: string): string {
  return input
    .replace(/[,()"'\\%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

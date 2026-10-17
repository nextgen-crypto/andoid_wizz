const compact = new Intl.NumberFormat("en", { notation: "compact" });

/** 2800 -> "2.8K", 228 -> "228", 3000 -> "3K". */
export function formatCount(n: number): string {
  return compact.format(n);
}

/** First @mention in a caption, for "Replying to @user" lines. */
export function replyingTo(caption: string): string | null {
  const m = /@([\p{L}\p{N}._]+)/u.exec(caption);
  return m ? m[1]!.toLowerCase() : null;
}
/**
 * X/Twitter-style relative timestamp: "now", "5m", "3h", "2d", "14 Mar".
 *
 * Computed against the real current time (the previous version compared
 * against a hardcoded date, so every October post collapsed to "1m").
 * Future-dated rows (clock skew, scheduling) clamp to "now"; invalid input
 * degrades to an empty string rather than throwing.
 */
export function newsTimeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";

  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "now";

  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  // Older than a week: fall back to an absolute date, like X does.
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(then);
}

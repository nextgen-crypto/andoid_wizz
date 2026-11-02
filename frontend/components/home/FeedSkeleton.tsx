/**
 * Feed loading placeholders. Mirrors FeedCard's structure (header / media /
 * actions) so the shimmer swaps in without a layout jump once real posts land.
 */
export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="divide-y divide-border">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="skeleton-shimmer size-9 rounded-full bg-secondary" />
            <div className="flex-1 space-y-2">
              <div className="skeleton-shimmer h-3 w-32 rounded-full bg-secondary" />
              <div className="skeleton-shimmer h-2.5 w-20 rounded-full bg-secondary" />
            </div>
          </div>
          <div className="skeleton-shimmer mt-3 h-64 rounded-2xl bg-secondary" />
          <div className="mt-3 flex gap-5">
            {Array.from({ length: 4 }, (_, j) => (
              <div key={j} className="skeleton-shimmer h-4 w-9 rounded bg-secondary" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

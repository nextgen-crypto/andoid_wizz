export function AppBootSkeleton() {
  return (
    <div className="flex h-dvh w-full flex-col bg-background overflow-hidden">
      {/* TopBar */}
      <div className="flex shrink-0 items-center justify-between px-4 pt-safe pb-2">
        <div className="skeleton-shimmer h-7 w-24 rounded-lg" />
        <div className="flex gap-2">
          <div className="skeleton-shimmer size-8 rounded-full" />
          <div className="skeleton-shimmer size-8 rounded-full" />
        </div>
      </div>

      {/* Story rail */}
      <div className="flex shrink-0 gap-3 px-4 pb-3 overflow-hidden">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex shrink-0 flex-col items-center gap-1.5">
            <div className="skeleton-shimmer size-16 rounded-full" />
            <div className="skeleton-shimmer h-2 w-10 rounded-full" />
          </div>
        ))}
      </div>

      {/* Feed cards */}
      <div className="flex-1 overflow-hidden">
        {[0, 1].map((i) => (
          <div key={i} className="mb-6">
            {/* Author row */}
            <div className="flex items-center gap-2.5 px-4 mb-2">
              <div className="skeleton-shimmer size-9 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <div className="skeleton-shimmer h-3 w-32 rounded-full" />
                <div className="skeleton-shimmer h-2.5 w-20 rounded-full" />
              </div>
            </div>
            {/* Image placeholder */}
            <div className="skeleton-shimmer w-full" style={{ aspectRatio: "4/5" }} />
            {/* Actions */}
            <div className="flex gap-4 px-4 mt-2.5">
              <div className="skeleton-shimmer h-4 w-14 rounded-full" />
              <div className="skeleton-shimmer h-4 w-14 rounded-full" />
              <div className="skeleton-shimmer h-4 w-14 rounded-full" />
            </div>
          </div>
        ))}
      </div>

      {/* BottomNav */}
      <div className="mt-auto flex shrink-0 justify-around px-6 pb-safe pt-3 border-t border-border">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton-shimmer size-6 rounded-md" />
        ))}
      </div>
    </div>
  );
}

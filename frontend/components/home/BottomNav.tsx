import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CreationEngine } from "@/frontend/components/create/creationEngine";
import { left, right, type CreateKind } from "@/frontend/components/home/nav-items";

function Tab({
  to,
  label,
  Icon,
  exact,
}: {
  to: string;
  label: string;
  Icon: (typeof left)[number]["Icon"];
  exact: boolean;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      activeOptions={{ exact }}
      className="flex min-w-0 flex-1 flex-col items-center py-2.5"
      activeProps={{ "aria-current": "page" }}
    >
      {({ isActive }) => (
        <span className="relative">
          <Icon
            className={
              isActive ? "animate-pop size-[26px] text-brand" : "size-[26px] text-muted-foreground"
            }
          />
          {isActive && (
            <span className="animate-scale-in absolute -bottom-2 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-brand" />
          )}
        </span>
      )}
    </Link>
  );
}

/** Bottom bar shows only the 5 primary destinations (drops Explore + Saved). */
const NAV_ITEMS = [...left, ...right].filter(
  (item) => item.to !== "/explore" && item.to !== "/bookmarks",
);

/** Hosts the global creation engine for contextual surfaces that dispatch `open-create`. */
export function BottomNav() {
  const [createOpen, setCreateOpen] = useState(false);
  const [initialKind, setInitialKind] = useState<CreateKind | null>(null);
  const [initialTrackId, setInitialTrackId] = useState<string | null>(null);
  const [initialSourceUser, setInitialSourceUser] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ kind?: CreateKind; trackId?: string; sourceUser?: string }>
      ).detail;
      setInitialKind(detail?.kind ?? null);
      setInitialTrackId(detail?.trackId ?? null);
      setInitialSourceUser(detail?.sourceUser ?? null);
      setCreateOpen(true);
    };
    window.addEventListener("open-create", handler);
    return () => window.removeEventListener("open-create", handler);
  }, []);

  return (
    <>
      <nav
        aria-label="Primary"
        className="animate-fade-up pointer-events-none sticky bottom-0 z-40 px-2 pb-safe sm:px-4 md:hidden"
      >
        <div className="pointer-events-auto mx-auto mb-2 flex w-full max-w-2xl items-center rounded-3xl border border-border bg-background/90 px-1 shadow-raise backdrop-blur-xl sm:px-2">
          {NAV_ITEMS.map((item) => (
            <Tab key={item.to} {...item} />
          ))}
        </div>
      </nav>

      <CreationEngine
        open={createOpen}
        initial={initialKind}
        initialTrackId={initialTrackId}
        initialSourceUser={initialSourceUser}
        onClose={() => {
          setCreateOpen(false);
          setInitialKind(null);
          setInitialTrackId(null);
          setInitialSourceUser(null);
        }}
      />
    </>
  );
}

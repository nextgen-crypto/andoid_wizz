import { useEffect, useState, type ReactNode } from "react";
import { BottomNav } from "@/frontend/components/home/BottomNav";
import { NavigationRail } from "@/frontend/components/home/NavigationRail";
import { TopBar } from "@/frontend/components/home/TopBar";
import { useSession } from "@/frontend/hooks/useSession";
import { usePushNotifications } from "@/frontend/hooks/usePushNotifications";
import { useMessageNotifications } from "@/frontend/hooks/useMessageNotifications";
import { fetchAppConfig } from "@/frontend/lib/appConfig";
import { supabase } from "@/integrations/supabase/client";

function useMaintenance(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Server-backed first so the banner reaches every device, not just the
    // admin's browser; falls back to the local mirror when unreachable.
    fetchAppConfig()
      .then(({ config }) => {
        if (!cancelled) setOn(Boolean(config.maintenance));
      })
      .catch(() => {
        if (!cancelled) setOn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return on;
}

export function AppShell({
  title,
  children,
  fullHeight = false,
  hideNav = false,
}: {
  title: string;
  children: ReactNode;
  fullHeight?: boolean;
  hideNav?: boolean;
}) {
  const maintenance = useMaintenance();
  const { user } = useSession();
  usePushNotifications(user?.id ?? null);
  useMessageNotifications(user?.id ?? null);
  const [warnings, setWarnings] = useState<{ id: string; message: string }[]>([]);
  const [announcement, setAnnouncement] = useState<{
    id: string;
    title: string;
    message: string;
  } | null>(null);

  // Latest published announcement from the admin console's outbox.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("announcements")
      .select("id, title, message")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled || error || !data?.[0]) return;
        const row = data[0] as { id: string; title: string; message: string };
        try {
          if (sessionStorage.getItem(`wizz:ann:${row.id}`)) return;
        } catch {
          // sessionStorage unavailable — just show it.
        }
        setAnnouncement(row);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function dismissAnnouncement() {
    if (announcement) {
      try {
        sessionStorage.setItem(`wizz:ann:${announcement.id}`, "1");
      } catch {
        // ignore
      }
    }
    setAnnouncement(null);
  }

  useEffect(() => {
    if (!user) {
      setWarnings([]);
      return;
    }
    supabase
      .from("warnings")
      .select("id, message")
      .eq("user_id", user.id)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(3)
      .then(({ data }) => {
        if (data) setWarnings(data as { id: string; message: string }[]);
      });
  }, [user]);

  async function dismissWarning(id: string) {
    setWarnings((prev) => prev.filter((w) => w.id !== id));
    await supabase.from("warnings").update({ is_read: true }).eq("id", id);
  }

  return (
    <div
      className={
        fullHeight
          ? "h-[100dvh] overflow-hidden bg-surface-strong md:pl-20"
          : "min-h-[100dvh] bg-surface-strong md:pl-20"
      }
    >
      <NavigationRail />
      <div
        className={
          fullHeight
            ? "mx-auto flex h-[100dvh] min-h-0 w-full max-w-3xl flex-col bg-background md:border-x md:border-border"
            : "mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col bg-background md:border-x md:border-border"
        }
      >
        <TopBar />
        {maintenance && (
          <p className="bg-live px-4 py-2 text-center text-xs font-bold text-white">
            Maintenance mode is ON — some features may be unavailable.
          </p>
        )}
        {announcement && (
          <div className="flex items-start gap-3 bg-foreground px-4 py-2 text-background">
            <p className="min-w-0 flex-1 text-xs leading-5">
              <span className="font-bold">{announcement.title}</span>
              <span className="opacity-80"> — {announcement.message}</span>
            </p>
            <button
              onClick={dismissAnnouncement}
              className="shrink-0 rounded-full bg-background/20 px-3 py-1 text-[11px] font-bold"
            >
              Dismiss
            </button>
          </div>
        )}
        {warnings.map((w) => (
          <div
            key={w.id}
            className="flex items-center gap-2 bg-foreground px-4 py-2 text-background"
          >
            <p className="min-w-0 flex-1 truncate text-xs font-semibold">{w.message}</p>
            <button
              onClick={() => void dismissWarning(w.id)}
              className="shrink-0 rounded-full bg-background/20 px-3 py-1 text-[11px] font-bold"
            >
              Dismiss
            </button>
          </div>
        ))}
        <main
          className={
            fullHeight
              ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              : "min-w-0 flex-1 pb-24 md:pb-10"
          }
        >
          <h1 className="sr-only">{title}</h1>
          {children}
        </main>
        {!hideNav && <BottomNav />}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, X } from "lucide-react";
import { Empty, Panel } from "@/frontend/components/admin/ui";
import { cn } from "@/lib/utils";
import type { RoleAssign } from "@/frontend/components/admin/opStore";
import { timeAgo } from "@/frontend/lib/format";
import { fetchCacheStats } from "@/backend/api/home.functions";
import { supabase } from "@/integrations/supabase/client";
import type { ActFn } from "@/frontend/components/admin/opStore";
import type { AdminUser } from "@/frontend/hooks/useAdminMetrics";

export function useHealth(enabled: boolean) {
  const [ping, setPing] = useState<number | null>(null);
  const [commentsLive, setCommentsLive] = useState<boolean | null>(null);
  const [cache, setCache] = useState<{
    backend: string;
    hits: number | null;
    misses: number | null;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const t0 = performance.now();
      try {
        const { error } = await supabase
          .from("profiles")
          .select("id", { count: "exact", head: true });
        if (!cancelled) setPing(error ? -1 : Math.round(performance.now() - t0));
      } catch {
        if (!cancelled) setPing(-1);
      }
      try {
        const { error } = await supabase
          .from("comments")
          .select("id", { count: "exact", head: true });
        if (!cancelled) setCommentsLive(!error);
      } catch {
        if (!cancelled) setCommentsLive(false);
      }
      try {
        if (!cancelled) setCache(await fetchCacheStats());
      } catch {
        if (!cancelled) setCache(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return { ping, commentsLive, cache };
}

export function UserDrawer({
  user,
  onClose,
  act,
}: {
  user: AdminUser;
  onClose: () => void;
  act: ActFn;
}) {
  const { data: posts = [] } = useQuery({
    queryKey: ["admin-user-posts", user.id],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("id, caption, created_at")
        .eq("author_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as { id: string; caption: string; created_at: string }[];
    },
  });
  const [role, setRole] = useState("");

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label={`Manage ${user.username}`}>
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-scrim" />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-background">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex min-w-0 items-center gap-3">
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.display_name}
                className="size-11 rounded-full object-cover"
              />
            ) : (
              <span className="grid size-11 place-items-center rounded-full bg-secondary text-sm font-bold">
                {user.display_name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="flex items-center gap-1 truncate text-[15px] font-bold">
                {user.display_name}
                {user.verified && <BadgeCheck className="size-4 text-foreground" />}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                @{user.username} · joined {new Date(user.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          <button
            aria-label="Close panel"
            onClick={onClose}
            className="rounded-full p-2 hover:bg-secondary"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <Panel title="Actions">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["warn", "Warn"],
                  ["restrict", "Restrict"],
                  ["suspend", "Suspend"],
                  ["unsuspend", "Unsuspend"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() =>
                    act(`${label} user`, `@${user.username}`, (s) => ({
                      ...s,
                      flags: {
                        ...s.flags,
                        [user.id]: {
                          ...s.flags[user.id],
                          suspended:
                            key === "suspend"
                              ? true
                              : key === "unsuspend"
                                ? false
                                : s.flags[user.id]?.suspended,
                          restricted: key === "restrict" ? true : s.flags[user.id]?.restricted,
                          warned: key === "warn" ? true : s.flags[user.id]?.warned,
                        },
                      },
                    }))
                  }
                  className={cn(
                    "rounded-full px-4 py-2 text-xs font-bold",
                    key === "suspend" ? "bg-live/10 text-live" : "bg-secondary text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                aria-label="Assign role"
                className="min-w-0 flex-1 rounded-xl border border-border bg-secondary px-3 py-2 text-sm"
              >
                <option value="">Assign role…</option>
                <option value="super">Super admin</option>
                <option value="content">Content admin</option>
                <option value="finance">Finance admin</option>
                <option value="support">Support admin</option>
              </select>
              <button
                disabled={!role}
                onClick={() => {
                  act(`Assign ${role} role`, `@${user.username}`, (s) => ({
                    ...s,
                    roles: [
                      ...s.roles.filter((r) => r.email !== user.username),
                      { email: user.username, role: role as RoleAssign["role"] },
                    ],
                  }));
                  setRole("");
                }}
                className="rounded-full bg-foreground px-4 py-2 text-xs font-bold text-background disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </Panel>
          <Panel title={`Posts (${posts.length})`} hint="Latest 20">
            {posts.length === 0 ? (
              <Empty text="No posts yet." />
            ) : (
              <ul className="divide-y divide-border">
                {posts.map((p) => (
                  <li key={p.id} className="py-2">
                    <p className="truncate text-[13px] font-semibold">
                      {p.caption.slice(0, 80) || "Photo post"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{timeAgo(p.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </aside>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  Film,
  Flag,
  KeyRound,
  Layers,
  LayoutDashboard,
  Megaphone,
  Newspaper,
  ScrollText,
  ShieldAlert,
  SlidersHorizontal,
  Users,
  Wallet,
  BadgeCheck,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BottomNav } from "@/frontend/components/home/BottomNav";
import { isAdminEmail } from "@/frontend/components/admin/admin";
import { useOpStore, type ActFn, type RoleAssign } from "@/frontend/components/admin/opStore";
import { AdManager } from "@/frontend/components/admin/AdManager";
import { CampaignConsole } from "@/frontend/components/admin/CampaignConsole";
import { ShowcaseSection } from "@/frontend/components/admin/ShowcaseSection";
import { Badge, Empty, Panel } from "@/frontend/components/admin/ui";
import {
  ContentSection,
  CreatorsSection,
  ModerationSection,
  PaymentsSection,
} from "@/frontend/components/admin/SectionsA";
import {
  AnalyticsSection,
  AuditSection,
  ConfigSection,
  NotificationsSection,
  RolesSection,
} from "@/frontend/components/admin/SectionsB";
import { NewsAdminSection } from "@/frontend/components/admin/NewsSection";
import { getAds } from "@/frontend/components/ads/ads";
import { useAdminMetrics, type AdminUser } from "@/frontend/hooks/useAdminMetrics";
import { UserDrawer, useHealth } from "@/frontend/screens/adminScreenParts";
import { fetchCacheStats } from "@/backend/api/home.functions";
import { useLiveActivity } from "@/frontend/hooks/useLiveActivity";
import { useSession } from "@/frontend/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const compact = new Intl.NumberFormat("en", { notation: "compact" });

const NAV = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "users", label: "Users", Icon: Users },
  { id: "content", label: "Content", Icon: Film },
  { id: "news", label: "News", Icon: Newspaper },
  { id: "moderation", label: "Moderation", Icon: Flag },
  { id: "payments", label: "Payments", Icon: Wallet },
  { id: "creators", label: "Creators", Icon: BadgeCheck },
  { id: "advertising", label: "Advertising", Icon: Megaphone },
  { id: "showcase", label: "Showcase", Icon: Layers },
  { id: "notifications", label: "Notifications", Icon: Bell },
  { id: "analytics", label: "Analytics", Icon: BarChart3 },
  { id: "config", label: "App config", Icon: SlidersHorizontal },
  { id: "roles", label: "Roles", Icon: KeyRound },
  { id: "audit", label: "Audit logs", Icon: ScrollText },
] as const;

type SectionId = (typeof NAV)[number]["id"];

function timeAgo(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function AdminScreen() {
  const { session, loading: sessionLoading, email, user } = useSession();
  const admin = isAdminEmail(email);
  const { data, loading, error } = useAdminMetrics(admin);
  const { events, connected } = useLiveActivity(admin);
  const { store: ops, act } = useOpStore(email ?? "admin");
  const { ping, commentsLive, cache } = useHealth(admin);
  const [section, setSection] = useState<SectionId>("overview");
  const [userQuery, setUserQuery] = useState("");
  const [managing, setManaging] = useState<AdminUser | null>(null);
  const [adsTick, setAdsTick] = useState(0);
  void adsTick;

  if (sessionLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 pt-16">
        <div className="h-24 w-full animate-pulse rounded-2xl bg-secondary" />
      </div>
    );
  }

  if (!session || !admin) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center px-6 pt-24 text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-secondary">
          <ShieldAlert className="size-7 text-muted-foreground" />
        </span>
        <h1 className="mt-4 text-xl font-bold">Restricted area</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {!session
            ? "Sign in with an admin account."
            : "Your account is not on the admin list. Set VITE_ADMIN_EMAILS in .env."}
        </p>
        {!session && (
          <Link
            to="/auth"
            className="mt-5 w-full rounded-full bg-foreground px-5 py-3 text-sm font-bold text-background"
          >
            Log in
          </Link>
        )}
      </div>
    );
  }

  const pendingReports = ops.reports.filter((r) => r.status === "pending").length;
  const failedTxns = ops.txns.filter((t) => t.status === "failed").length;
  const revenue =
    getAds()
      .filter((a) => a.paid)
      .reduce((s, a) => s + a.budget, 0) +
    ops.txns.filter((t) => t.status === "completed").reduce((s, t) => s + t.fee, 0);
  const users = (data?.users ?? []).filter((u) => {
    const q = userQuery.trim().toLowerCase();
    return !q || u.username.toLowerCase().includes(q) || u.display_name.toLowerCase().includes(q);
  });
  const sectionProps = { m: data ?? null, ops, act, email: email ?? "admin" };

  return (
    <>
      {/* Desktop command center */}
      <div className="hidden min-h-[100dvh] bg-surface-strong lg:block">
        <div className="flex min-h-[100dvh]">
          <aside className="sticky top-0 flex h-[100dvh] w-60 shrink-0 flex-col border-r border-border bg-background">
            <div className="flex items-center justify-between px-5 pb-2 pt-5">
              <span className="text-xl font-black text-title">WIZZ</span>
              <span className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    connected ? "animate-pulse bg-brand" : "bg-muted-foreground",
                  )}
                />
                {connected ? "LIVE" : "…"}
              </span>
            </div>
            <p className="px-5 pb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Admin console
            </p>
            <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
              {NAV.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm",
                    section === id
                      ? "bg-foreground font-bold text-background"
                      : "font-medium text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                  {id === "moderation" && pendingReports > 0 && (
                    <span className="ml-auto rounded-full bg-live px-2 py-0.5 text-[10px] font-bold text-white">
                      {pendingReports}
                    </span>
                  )}
                </button>
              ))}
            </nav>
            <div className="border-t border-border p-3">
              <Link
                to="/"
                className="block rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary"
              >
                ← Back to app
              </Link>
              <p className="truncate px-3 pb-1 pt-1 text-[11px] text-muted-foreground">{email}</p>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-[1400px] p-6">
              {loading && (
                <div className="grid grid-cols-4 gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-24 animate-pulse rounded-2xl bg-secondary" />
                  ))}
                </div>
              )}
              {error && <p className="text-sm font-semibold text-live">{error}</p>}

              {data && section === "overview" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-3">
                    <Stat
                      label="Total users"
                      value={compact.format(data.totals.users)}
                      sub={`+${data.newWeek} this week`}
                    />
                    <Stat
                      label="Posts"
                      value={compact.format(data.totals.posts)}
                      sub={`${data.categories[0]?.name ?? "—"} leads`}
                    />
                    <Stat label="Follows" value={compact.format(data.totals.follows)} />
                    <Stat
                      label="Today"
                      value={compact.format(data.totals.today)}
                      sub="signups + posts + follows"
                    />
                    <Stat
                      label="Reports pending"
                      value={`${pendingReports}`}
                      sub={pendingReports > 0 ? "needs review" : "queue clear"}
                    />
                    <Stat
                      label="Revenue tracked"
                      value={`$${compact.format(revenue)}`}
                      sub="ads + platform fees"
                    />
                    <Stat
                      label="Failed txns"
                      value={`${failedTxns}`}
                      sub={failedTxns > 0 ? "needs attention" : "all clear"}
                    />
                    <Stat
                      label="Live events"
                      value={`${events.length}`}
                      sub={connected ? "streaming now" : "connecting"}
                    />
                  </div>
                  <div className="grid grid-cols-5 gap-4">
                    <div className="col-span-3 rounded-2xl border border-border bg-card p-4">
                      <h3 className="text-sm font-bold">Activity — last 14 days</h3>
                      <div className="mt-2 h-60">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={data.series}
                            margin={{ top: 4, right: 4, bottom: 0, left: -14 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis
                              dataKey="day"
                              tick={{ fontSize: 10 }}
                              tickFormatter={(d: string) => d.slice(5)}
                            />
                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                            <Tooltip />
                            <Area
                              type="monotone"
                              dataKey="users"
                              name="Users"
                              stroke="var(--color-foreground)"
                              fill="var(--color-secondary)"
                            />
                            <Area
                              type="monotone"
                              dataKey="posts"
                              name="Posts"
                              stroke="var(--color-muted-foreground)"
                              fill="transparent"
                              strokeDasharray="5 3"
                            />
                            <Area
                              type="monotone"
                              dataKey="follows"
                              name="Follows"
                              stroke="var(--color-brand)"
                              fill="transparent"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="col-span-2 space-y-4">
                      <Panel title="System health">
                        <ul className="space-y-2 text-[13px]">
                          <li className="flex items-center justify-between">
                            <span className="text-muted-foreground">Database latency</span>
                            <Badge tone={ping !== null && ping >= 0 ? "dark" : "red"}>
                              {ping === null ? "…" : ping < 0 ? "down" : `${ping}ms`}
                            </Badge>
                          </li>
                          <li className="flex items-center justify-between">
                            <span className="text-muted-foreground">Comments migration</span>
                            <Badge tone={commentsLive ? "dark" : "red"}>
                              {commentsLive === null ? "…" : commentsLive ? "applied" : "missing"}
                            </Badge>
                          </li>
                          <li className="flex items-center justify-between">
                            <span className="text-muted-foreground">Realtime</span>
                            <Badge tone={connected ? "dark" : "gray"}>
                              {connected ? "connected" : "connecting"}
                            </Badge>
                          </li>
                          <li className="flex items-center justify-between">
                            <span className="text-muted-foreground">Cache</span>
                            <Badge tone="dark">
                              {cache
                                ? `${cache.backend}${cache.hits !== null ? ` · ${cache.hits}✓/${cache.misses}×` : ""}`
                                : "…"}
                            </Badge>
                          </li>
                          <li className="flex items-center justify-between">
                            <span className="text-muted-foreground">Maintenance</span>
                            <Badge tone={ops.config.maintenance ? "red" : "dark"}>
                              {ops.config.maintenance ? "ON" : "off"}
                            </Badge>
                          </li>
                        </ul>
                      </Panel>
                      <Panel title="Alerts" hint="Newest first">
                        {pendingReports === 0 && failedTxns === 0 && !ops.config.maintenance ? (
                          <Empty text="All quiet." />
                        ) : (
                          <ul className="space-y-2 text-[13px]">
                            {pendingReports > 0 && (
                              <li>
                                <button
                                  onClick={() => setSection("moderation")}
                                  className="font-semibold text-live"
                                >
                                  {pendingReports} reports pending →
                                </button>
                              </li>
                            )}
                            {failedTxns > 0 && (
                              <li>
                                <button
                                  onClick={() => setSection("payments")}
                                  className="font-semibold text-live"
                                >
                                  {failedTxns} failed transactions →
                                </button>
                              </li>
                            )}
                            {ops.config.maintenance && (
                              <li className="font-semibold">Maintenance mode is ON.</li>
                            )}
                          </ul>
                        )}
                      </Panel>
                    </div>
                  </div>
                </div>
              )}

              {data && section === "users" && (
                <div className="space-y-4">
                  <Panel
                    title={`All users (${users.length})`}
                    right={
                      <input
                        value={userQuery}
                        onChange={(e) => setUserQuery(e.target.value)}
                        placeholder="Search name or @username"
                        aria-label="Search users"
                        className="w-64 rounded-xl border border-border bg-secondary px-3 py-2 text-sm outline-none"
                      />
                    }
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left text-[13px]">
                        <thead>
                          <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            <th className="pb-2 pr-3">User</th>
                            <th className="pb-2 pr-3">Joined</th>
                            <th className="pb-2 pr-3">Status</th>
                            <th className="pb-2">Manage</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {users.map((u) => {
                            const flag = ops.flags[u.id];
                            return (
                              <tr key={u.id}>
                                <td className="py-2 pr-3">
                                  <span className="flex items-center gap-2.5">
                                    {u.avatar_url ? (
                                      <img
                                        src={u.avatar_url}
                                        alt={u.display_name}
                                        className="size-8 rounded-full object-cover"
                                      />
                                    ) : (
                                      <span className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-bold">
                                        {u.display_name.slice(0, 1).toUpperCase()}
                                      </span>
                                    )}
                                    <span className="min-w-0">
                                      <span className="flex items-center gap-1 truncate font-semibold">
                                        {u.display_name}
                                        {u.verified && <BadgeCheck className="size-3.5 shrink-0" />}
                                      </span>
                                      <span className="block truncate text-xs text-muted-foreground">
                                        @{u.username}
                                      </span>
                                    </span>
                                  </span>
                                </td>
                                <td className="py-2 pr-3 text-muted-foreground">
                                  {new Date(u.created_at).toLocaleDateString()}
                                </td>
                                <td className="py-2 pr-3">
                                  <span className="flex flex-wrap gap-1">
                                    {flag?.suspended && <Badge tone="red">suspended</Badge>}
                                    {flag?.restricted && <Badge tone="red">restricted</Badge>}
                                    {flag?.warned && <Badge tone="gray">warned</Badge>}
                                    {!flag?.suspended && !flag?.restricted && !flag?.warned && (
                                      <Badge>active</Badge>
                                    )}
                                  </span>
                                </td>
                                <td className="py-2">
                                  <button
                                    onClick={() => setManaging(u)}
                                    className="rounded-full bg-secondary px-4 py-1.5 text-xs font-bold"
                                  >
                                    Manage
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                </div>
              )}

              {section === "content" && <ContentSection {...sectionProps} />}
              {section === "news" && <NewsAdminSection />}
              {section === "moderation" && <ModerationSection {...sectionProps} />}
              {section === "payments" && <PaymentsSection {...sectionProps} />}
              {section === "creators" && <CreatorsSection {...sectionProps} />}
              {section === "advertising" && (
                <div className="space-y-4">
                  <CampaignConsole />
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <AdManager
                      ads={getAds()}
                      refresh={() => setAdsTick((n) => n + 1)}
                      userId={user?.id ?? null}
                    />
                  </div>
                </div>
              )}
              {section === "showcase" && <ShowcaseSection userId={user?.id ?? null} />}
              {section === "notifications" && <NotificationsSection {...sectionProps} />}
              {section === "analytics" && <AnalyticsSection {...sectionProps} />}
              {section === "config" && <ConfigSection {...sectionProps} />}
              {section === "roles" && <RolesSection {...sectionProps} />}
              {section === "audit" && <AuditSection {...sectionProps} />}
            </div>
          </main>
        </div>
      </div>

      {/* Admin is desktop-only */}
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center px-6 pt-24 text-center lg:hidden">
        <span className="grid size-16 place-items-center rounded-2xl bg-secondary">
          <ShieldAlert className="size-7 text-muted-foreground" />
        </span>
        <h1 className="mt-4 text-xl font-bold">Desktop required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The admin console is a desktop workspace. Open /admin in a desktop browser.
        </p>
        <Link
          to="/"
          className="mt-5 w-full rounded-full bg-foreground px-5 py-3 text-sm font-bold text-background"
        >
          Back to app
        </Link>
      </div>

      <div className="lg:hidden">
        <BottomNav />
      </div>
      {managing && <UserDrawer user={managing} onClose={() => setManaging(null)} act={act} />}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

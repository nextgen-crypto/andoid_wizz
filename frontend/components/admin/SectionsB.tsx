import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { fetchAdminRoles, grantAdminRole, revokeAdminRole } from "@/backend/api/admin.functions";
import { videos } from "@/backend/database/seed";
import {
  Badge,
  Empty,
  Field,
  Panel,
  Select,
  Toggle,
  inputCls,
} from "@/frontend/components/admin/ui";
import { exportCsv, newId } from "@/frontend/components/admin/opStore";
import { getAds } from "@/frontend/components/ads/ads";
import type { SectionProps } from "@/frontend/components/admin/SectionsA";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------ NOTIFICATIONS */
export function NotificationsSection({ ops, act }: SectionProps) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState("All users");
  const [schedule, setSchedule] = useState("");

  function save(status: "draft" | "scheduled" | "published", verb: string) {
    if (!title.trim() || !message.trim()) return;
    act(`${verb} announcement`, title.trim(), (s) => ({
      ...s,
      announcements: [
        {
          id: newId("n"),
          title: title.trim(),
          message: message.trim(),
          audience,
          schedule: schedule || "Now",
          status,
          createdAt: new Date().toISOString(),
        },
        ...s.announcements,
      ],
    }));
    setTitle("");
    setMessage("");
    setSchedule("");
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel
        title="Create announcement"
        hint="Push delivery needs a provider — drafts publish in-app for now"
      >
        <div className="space-y-2">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Scheduled Maintenance"
              className={inputCls}
            />
          </Field>
          <Field label="Message">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="WIZZ will be unavailable…"
              className={cn(inputCls, "resize-none")}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Audience">
              <Select value={audience} onChange={(e) => setAudience(e.target.value)}>
                <option>All users</option>
                <option>Creators</option>
                <option>New users</option>
                <option>Tanzania</option>
              </Select>
            </Field>
            <Field label="Schedule">
              <input
                type="datetime-local"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => save("draft", "Save announcement draft")}
              className="flex-1 rounded-full bg-secondary py-2.5 text-sm font-bold"
            >
              Save draft
            </button>
            <button
              onClick={() => save(schedule ? "scheduled" : "published", "Publish announcement")}
              className="flex-1 rounded-full bg-foreground py-2.5 text-sm font-bold text-background"
            >
              {schedule ? "Schedule" : "Publish"}
            </button>
          </div>
        </div>
      </Panel>
      <Panel title={`Outbox (${ops.announcements.length})`}>
        {ops.announcements.length === 0 ? (
          <Empty text="No announcements yet." />
        ) : (
          <ul className="divide-y divide-border">
            {ops.announcements.map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold">{a.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a.message} · {a.audience} · {a.schedule}
                  </span>
                </span>
                <Badge
                  tone={
                    a.status === "published" ? "dark" : a.status === "scheduled" ? "brand" : "gray"
                  }
                >
                  {a.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------- ANALYTICS */
export function AnalyticsSection({ m, ops }: SectionProps) {
  const { data: repeat } = useQuery({
    queryKey: ["admin-repeat-posters"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("posts").select("author_id").limit(1000);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const p of (data ?? []) as { author_id: string }[]) {
        counts.set(p.author_id, (counts.get(p.author_id) ?? 0) + 1);
      }
      const authors = counts.size;
      const repeaters = [...counts.values()].filter((c) => c > 1).length;
      return {
        authors,
        repeaters,
        rate: authors === 0 ? 0 : Math.round((repeaters / authors) * 100),
      };
    },
  });
  const videoViews = videos.reduce((s, v) => s + v.views, 0);
  const watchHours = Math.round((videoViews * 11) / 60 / 60);
  const revenue =
    getAds()
      .filter((a) => a.paid)
      .reduce((s, a) => s + a.budget, 0) +
    ops.txns.filter((t) => t.status === "completed").reduce((s, t) => s + t.fee, 0);
  const todayPosts = m?.series[m.series.length - 1]?.posts ?? 0;
  const dau = (m?.series[m.series.length - 1]?.users ?? 0) + todayPosts;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "DAU (proxy)", value: `${dau}` },
          { label: "MAU", value: `${m?.totals.users ?? 0}` },
          { label: "Repeat posters", value: `${repeat?.rate ?? 0}%` },
          { label: "Posts / day", value: `${todayPosts}` },
          { label: "Video views", value: videoViews.toLocaleString() },
          { label: "Watch time", value: `~${watchHours.toLocaleString()}h` },
          { label: "Revenue tracked", value: `$${revenue.toLocaleString()}` },
          { label: "Hashtag trends", value: `${m?.hashtags.length ?? 0}` },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xl font-bold">{s.value}</p>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {s.label}
            </p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Popular content" hint="Top videos by views">
          <ul className="divide-y divide-border">
            {[...videos]
              .sort((a, b) => b.views - a.views)
              .slice(0, 5)
              .map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{v.title}</span>
                    <span className="text-[11px] text-muted-foreground">{v.category}</span>
                  </span>
                  <span className="text-[13px] font-bold">{v.views.toLocaleString()}</span>
                </li>
              ))}
          </ul>
        </Panel>
        <Panel title="Search trends" hint="Top hashtags stand in until searches are logged">
          <div className="flex flex-wrap gap-1.5">
            {(m?.hashtags ?? []).slice(0, 12).map((h) => (
              <span
                key={h.tag}
                className="rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold"
              >
                #{h.tag} · {h.count}
              </span>
            ))}
            {(m?.hashtags ?? []).length === 0 && <Empty text="No hashtag data yet." />}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- CONFIG */
const CONFIG_ROWS: {
  key: keyof import("@/frontend/components/admin/opStore").OpStore["config"];
  label: string;
  desc: string;
}[] = [
  { key: "registration", label: "Registration", desc: "New accounts can sign up" },
  { key: "newRegistrations", label: "New registrations", desc: "Onboarding funnel open" },
  { key: "phoneVerification", label: "Phone verification", desc: "Require OTP at signup" },
  { key: "emailVerification", label: "Email verification", desc: "Require email confirm" },
  { key: "comments", label: "Comments", desc: "Commenting across feeds" },
  { key: "liveStreaming", label: "Live streaming", desc: "Go-live and Blend rooms" },
  { key: "videoUploads", label: "Video uploads", desc: "Video creation flow" },
  { key: "monetization", label: "Creator monetization", desc: "Earnings + payouts" },
  { key: "maintenance", label: "Maintenance mode", desc: "Shows a banner in-app" },
];

export function ConfigSection({ ops, act }: SectionProps) {
  return (
    <Panel
      title="App configuration"
      hint="Applies instantly per-browser · backend enforcement pending, except maintenance banner"
    >
      <ul className="divide-y divide-border">
        {CONFIG_ROWS.map((row) => (
          <li key={row.key} className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">{row.label}</span>
              <span className="block text-[11px] text-muted-foreground">{row.desc}</span>
            </span>
            <ToggleRow
              checked={ops.config[row.key]}
              onChange={(v) =>
                act(`Set ${row.label} ${v ? "ON" : "OFF"}`, "app-config", (s) => ({
                  ...s,
                  config: { ...s.config, [row.key]: v },
                }))
              }
              label={row.label}
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ToggleRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        checked ? "bg-foreground" : "bg-border",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all dark:bg-black",
          checked ? "left-[22px]" : "left-0.5",
        )}
      />
    </button>
  );
}

export function RolesSection(_props: SectionProps) {
  const queryClient = useQueryClient();
  const [emailInput, setEmailInput] = useState("");
  const [busy, setBusy] = useState(false);

  // Real admin_roles rows through an admin-gated server function. `live:false`
  // means the table/service role isn't configured — shown, not hidden.
  const rolesQuery = useQuery({
    queryKey: ["admin-roles"],
    staleTime: 30_000,
    queryFn: () => fetchAdminRoles(),
  });

  async function grant() {
    setBusy(true);
    try {
      await grantAdminRole({ data: { email: emailInput.trim() } });
      setEmailInput("");
      toast("Admin granted.");
      void queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not grant admin.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: string, email: string) {
    setBusy(true);
    try {
      await revokeAdminRole({ data: { userId } });
      toast(`Removed ${email}.`);
      void queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove admin.");
    } finally {
      setBusy(false);
    }
  }

  const rows = rolesQuery.data?.roles ?? [];
  const live = rolesQuery.data?.live !== false;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="What an admin can do">
        <ul className="space-y-2 text-[13px] text-foreground">
          {[
            "Moderate the report queue (hide, delete, warn)",
            "Publish, edit and remove news stories and trending topics",
            "Review advertising campaigns (approve, reject, pause)",
            "Grant or revoke admin access for other accounts",
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-brand" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
          Admin access is enforced on the server (admin_roles table + ADMIN_EMAILS env). This panel
          edits the table directly — no email allowlist juggling.
        </p>
      </Panel>
      <Panel title={`Admin accounts (${rows.length})`}>
        {!live && (
          <p className="mb-2 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
            The admin_roles table isn't reachable — check SUPABASE_SERVICE_ROLE_KEY.
          </p>
        )}
        <div className="flex gap-2">
          <input
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && emailInput.includes("@") && !busy) void grant();
            }}
            placeholder="admin@example.com"
            aria-label="Admin email"
            className={cn(inputCls, "min-w-0 flex-1")}
          />
          <button
            disabled={!emailInput.includes("@") || busy}
            onClick={() => void grant()}
            className="shrink-0 rounded-full bg-foreground px-4 py-2 text-xs font-bold text-background disabled:opacity-50"
          >
            {busy ? "…" : "Grant"}
          </button>
        </div>
        {rows.length === 0 ? (
          <Empty text={live ? "No admin accounts yet — grant one above." : "Not available."} />
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {rows.map((r) => (
              <li key={r.user_id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{r.email}</span>
                <Badge>admin</Badge>
                <button
                  disabled={busy}
                  onClick={() => void revoke(r.user_id, r.email)}
                  className="rounded-full bg-secondary px-3 py-1 text-[11px] font-bold disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Granting resolves the email against your auth users, so only real accounts can be added.
        </p>
      </Panel>
    </div>
  );
}

/* --------------------------------------------------------------- AUDIT */
export function AuditSection({ ops }: SectionProps) {
  return (
    <Panel
      title={`Security audit log (${ops.audit.length})`}
      hint="Append-only · every admin action lands here"
      right={
        <button
          onClick={() =>
            exportCsv(
              "audit-log.csv",
              ops.audit.map((a) => [a.at, a.actor, a.action, a.target]),
              ["at", "actor", "action", "target"],
            )
          }
          className="rounded-full bg-secondary px-3 py-1.5 text-xs font-bold"
        >
          Export CSV
        </button>
      }
    >
      {ops.audit.length === 0 ? (
        <Empty text="No admin actions recorded yet. Actions you take anywhere in this console appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-3">Time</th>
                <th className="pb-2 pr-3">Actor</th>
                <th className="pb-2 pr-3">Action</th>
                <th className="pb-2">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ops.audit.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">
                    {new Date(a.at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 font-semibold">{a.actor}</td>
                  <td className="py-2 pr-3">{a.action}</td>
                  <td className="py-2 font-mono text-xs">{a.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

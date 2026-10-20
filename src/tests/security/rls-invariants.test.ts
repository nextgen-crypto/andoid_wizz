/**
 * Policy invariants: security properties that must hold across EVERY table
 * regardless of the row under test. These are table-driven checks over the
 * independent engine, encoded directly from the app's security posture:
 *
 *   - service_role bypasses RLS everywhere (BYPASSRLS).
 *   - anon can never INSERT / UPDATE / DELETE anything.
 *   - anon can only SELECT on the explicitly public surfaces.
 *   - admin is an ordinary authenticated user plus is_admin() reads on the
 *     moderation tables — it is NOT a superuser and never widens writes.
 *   - no table may be missing from the matrix (and vice versa).
 */
import { describe, expect, it } from "vitest";
import {
  RLS_ACTIONS,
  RLS_ROLES,
  RLS_TABLES,
  RLS_TEST_MATRIX,
  RLS_UIDS,
  type RlsContext,
  type RlsRole,
} from "../../../backend/security/rls-matrix";
import { NEUTRAL_CONTEXT, evaluateRls } from "./policyEngine";

/** Tables whose SELECT policy grants anon read access (public surfaces). */
const ANON_READABLE_TABLES: ReadonlySet<string> = new Set([
  "ad_campaigns",
  "ad_packages",
  "comment_likes",
  "comments",
  "follows",
  "news_comments",
  "news_stories",
  "post_likes",
  "post_stats",
  "posts",
  "profiles",
  "story_posts",
  "story_relevant_people",
  "trending_topics",
]);

const CLIENT_ROLES: readonly RlsRole[] = RLS_ROLES.filter((role) => role !== "service_role");

function uidOf(role: RlsRole): string {
  if (role === "userA") return RLS_UIDS.userA;
  if (role === "userB") return RLS_UIDS.userB;
  return RLS_UIDS.admin;
}

describe("RLS invariants: service_role", () => {
  const cases = RLS_TABLES.flatMap((table) => RLS_ACTIONS.map((action) => ({ table, action })));

  it.each(cases)("service_role bypasses $action on $table", ({ table, action }) => {
    expect(evaluateRls(table, "service_role", action, NEUTRAL_CONTEXT)).toBe("allow");
  });
});

describe("RLS invariants: anon is read-only and deny-by-default", () => {
  it.each(RLS_TABLES)("anon can never INSERT into %s", (table) => {
    expect(evaluateRls(table, "anon", "INSERT", NEUTRAL_CONTEXT)).toBe("deny");
  });

  it.each(RLS_TABLES)("anon can never UPDATE %s", (table) => {
    expect(evaluateRls(table, "anon", "UPDATE", NEUTRAL_CONTEXT)).toBe("deny");
  });

  it.each(RLS_TABLES)("anon can never DELETE from %s", (table) => {
    expect(evaluateRls(table, "anon", "DELETE", NEUTRAL_CONTEXT)).toBe("deny");
  });

  it("anon can never insert into admin_roles", () => {
    expect(evaluateRls("admin_roles", "anon", "INSERT", { user_id: RLS_UIDS.stranger })).toBe(
      "deny",
    );
  });

  it.each(RLS_TABLES)(
    "unauthenticated SELECT on %s matches the public-surface allowlist",
    (table) => {
      // ad_campaigns' public branch reads the row's own status; the shared
      // neutral context is tuned for posts (status "published").
      const context =
        table === "ad_campaigns"
          ? { status: "active", advertiser_id: RLS_UIDS.stranger }
          : NEUTRAL_CONTEXT;
      const verdict = evaluateRls(table, "anon", "SELECT", context);
      expect(verdict).toBe(ANON_READABLE_TABLES.has(table) ? "allow" : "deny");
    },
  );

  it("the public-surface allowlist only contains real tables", () => {
    for (const table of ANON_READABLE_TABLES) {
      expect(RLS_TABLES).toContain(table);
    }
  });
});

describe("RLS invariants: notifications stay trigger-only", () => {
  it.each(CLIENT_ROLES)("notifications can never be inserted by %s", (role) => {
    const context: RlsContext =
      role === "anon"
        ? { user_id: RLS_UIDS.userA } // even when addressed to themselves
        : { user_id: uidOf(role) };
    expect(evaluateRls("notifications", role, "INSERT", context)).toBe("deny");
  });
});

describe("RLS invariants: admin_roles stay locked", () => {
  const writeActions = RLS_ACTIONS.filter((action) => action !== "SELECT");
  const cases = writeActions.flatMap((action) => CLIENT_ROLES.map((role) => ({ action, role })));

  it.each(cases)("admin_roles $action is denied for $role (even admins)", ({ action, role }) => {
    expect(evaluateRls("admin_roles", role, action, { user_id: RLS_UIDS.admin })).toBe("deny");
  });
});

describe("RLS invariants: admin is not a superuser", () => {
  // Tables with no is_admin() rule anywhere: admin must behave exactly like
  // any other authenticated user there.
  const NO_ADMIN_BYPASS_TABLES = RLS_TABLES.filter(
    (table) => !["admin_roles", "reports", "warnings", "ad_campaigns"].includes(table),
  );

  const cases = NO_ADMIN_BYPASS_TABLES.flatMap((table) =>
    RLS_ACTIONS.map((action) => ({ table, action })),
  );

  it.each(cases)(
    "$action on $table treats admin exactly like a normal user",
    ({ table, action }) => {
      expect(evaluateRls(table, "admin", action, NEUTRAL_CONTEXT)).toBe(
        evaluateRls(table, "userB", action, NEUTRAL_CONTEXT),
      );
    },
  );

  it("admin cannot update warnings written by other users", () => {
    expect(evaluateRls("warnings", "admin", "UPDATE", { user_id: RLS_UIDS.userA })).toBe("deny");
  });

  it("admin cannot update reports written by other users", () => {
    expect(evaluateRls("reports", "admin", "UPDATE", { reporter_id: RLS_UIDS.userA })).toBe("deny");
  });
});

describe("RLS invariants: matrix coverage", () => {
  it("every table has at least one matrix case", () => {
    const covered = new Set(RLS_TEST_MATRIX.map((tc) => tc.table));
    for (const table of RLS_TABLES) {
      expect(covered, `table ${table} is missing from the matrix`).toContain(table);
    }
    expect(covered.size).toBe(RLS_TABLES.length);
  });

  it("no matrix case references a table outside RLS_TABLES", () => {
    for (const tc of RLS_TEST_MATRIX) {
      expect(RLS_TABLES).toContain(tc.table);
    }
  });

  const pairCases = RLS_TABLES.flatMap((table) => RLS_ACTIONS.map((action) => ({ table, action })));
  it.each(pairCases)("every table/action pair is covered: $table $action", ({ table, action }) => {
    expect(RLS_TEST_MATRIX.some((tc) => tc.table === table && tc.action === action)).toBe(true);
  });

  it.each(RLS_TABLES)("anon, userA and service_role all covered for %s", (table) => {
    for (const role of ["anon", "userA", "service_role"] as const) {
      expect(
        RLS_TEST_MATRIX.some((tc) => tc.table === table && tc.role === role),
        `table ${table} has no ${role} case`,
      ).toBe(true);
    }
  });

  it("every role appears in the matrix", () => {
    const roles = new Set(RLS_TEST_MATRIX.map((tc) => tc.role));
    for (const role of RLS_ROLES) {
      expect(roles).toContain(role);
    }
  });

  it("every action appears in the matrix", () => {
    const actions = new Set(RLS_TEST_MATRIX.map((tc) => tc.action));
    for (const action of RLS_ACTIONS) {
      expect(actions).toContain(action);
    }
  });
});

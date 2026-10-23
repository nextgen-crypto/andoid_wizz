import { describe, expect, it } from "vitest";

import { RLS_ACTIONS, RLS_ROLES, RLS_TABLES, RLS_TEST_MATRIX, RLS_UIDS } from "./rls-matrix";

import type { RlsAction, RlsContext, RlsRole, RlsTestCase, RlsVerdict } from "./rls-matrix";

/**
 * Structural + per-case matrix for backend/security/rls-matrix.ts.
 *
 * The RLS matrix is a documentation artifact whose expectations are hardcoded
 * from the migration SQL. Two layers of protection live here:
 *
 *  1. Per-case checks (476 rows): every case is validated against INDEPENDENTLY
 *     hardcoded vocabularies (table names, roles, actions, verdicts, context
 *     keys, status vocabulary) — none of which are read back from the module.
 *  2. Aggregate invariants: exact counts, exact per-table/per-role/per-action
 *     distributions, exact admin/anon-SELECT/userB row lists, uniqueness of
 *     (table, role, action, description), and policy-text ⇒ verdict rules.
 *
 * Every number and list below was pinned by hand from the matrix contents; if
 * a case is added, removed, or edited without updating this file, the suite
 * fails.
 */

// ---------------------------------------------------------------------------
// Independently hardcoded vocabularies (NOT imported from the module under test)
// ---------------------------------------------------------------------------

const EXPECTED_TABLES = [
  "ad_campaigns",
  "ad_events",
  "ad_exposures",
  "ad_packages",
  "ad_payments",
  "ad_preferences",
  "admin_roles",
  "blocks",
  "comment_likes",
  "comments",
  "content_audit",
  "conversations",
  "feed_events",
  "follow_requests",
  "follows",
  "messages",
  "news_comments",
  "news_stories",
  "notifications",
  "post_likes",
  "post_stats",
  "posts",
  "profiles",
  "reports",
  "saves",
  "story_follows",
  "story_posts",
  "story_relevant_people",
  "story_saves",
  "trending_topics",
  "warnings",
] as const;

const EXPECTED_ROLES = ["anon", "userA", "userB", "admin", "service_role"] as const;
const EXPECTED_ACTIONS = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;
const EXPECTED_UIDS = {
  userA: "uid-A",
  userB: "uid-B",
  admin: "uid-ADMIN",
  stranger: "uid-STRANGER",
} as const;

/** Every key RlsContext may carry — a typo in a matrix row would show up here. */
const EXPECTED_CONTEXT_KEYS = [
  "author_id",
  "user_id",
  "follower_id",
  "followee_id",
  "blocker_id",
  "blocked_id",
  "requester_id",
  "reporter_id",
  "actor_id",
  "viewer_id",
  "advertiser_id",
  "sender_id",
  "user_a_id",
  "user_b_id",
  "post_author_id",
  "campaign_advertiser_id",
  "campaign_status",
  "status",
  "visibility",
  "is_deleted",
  "is_private",
  "author_is_private",
  "follower_is_private",
  "followee_is_private",
  "viewer_follows_author",
  "viewer_follows_profile",
  "viewer_follows_follower",
  "viewer_follows_followee",
  "viewer_blocked_author",
  "viewer_blocked_profile",
  "parent_post",
] as const;

/** Status/visibility vocabulary used across all context fields. */
const STATUS_VOCABULARY = [
  "active",
  "archived",
  "draft",
  "followers",
  "paused",
  "private",
  "public",
  "published",
] as const;

/** Tables where the anon SELECT policy is deny-by-default (no public read). */
const ANON_NO_READ_TABLES = [
  "admin_roles",
  "ad_events",
  "ad_exposures",
  "ad_payments",
  "ad_preferences",
  "blocks",
  "content_audit",
  "conversations",
  "feed_events",
  "follow_requests",
  "messages",
  "notifications",
  "reports",
  "saves",
  "story_follows",
  "story_saves",
  "warnings",
] as const;

/** Exact per-table row counts. */
const TABLE_COUNTS: Record<string, number> = {
  ad_campaigns: 19,
  ad_events: 16,
  ad_exposures: 14,
  ad_packages: 11,
  ad_payments: 13,
  ad_preferences: 14,
  admin_roles: 15,
  blocks: 15,
  comment_likes: 13,
  comments: 24,
  content_audit: 13,
  conversations: 14,
  feed_events: 13,
  follow_requests: 16,
  follows: 18,
  messages: 18,
  news_comments: 16,
  news_stories: 12,
  notifications: 15,
  post_likes: 14,
  post_stats: 11,
  posts: 29,
  profiles: 21,
  reports: 17,
  saves: 14,
  story_follows: 15,
  story_posts: 13,
  story_relevant_people: 11,
  story_saves: 14,
  trending_topics: 10,
  warnings: 18,
};

/** Exact per-table set of (role:action) combinations covered. */
const TABLE_COMBOS: Record<string, string[]> = {
  posts: [
    "admin:SELECT",
    "anon:DELETE",
    "anon:INSERT",
    "anon:SELECT",
    "anon:UPDATE",
    "service_role:DELETE",
    "service_role:INSERT",
    "service_role:SELECT",
    "service_role:UPDATE",
    "userA:DELETE",
    "userA:INSERT",
    "userA:SELECT",
    "userA:UPDATE",
    "userB:SELECT",
  ],
  profiles: [
    "admin:SELECT",
    "anon:DELETE",
    "anon:INSERT",
    "anon:SELECT",
    "anon:UPDATE",
    "service_role:DELETE",
    "service_role:INSERT",
    "service_role:SELECT",
    "service_role:UPDATE",
    "userA:DELETE",
    "userA:INSERT",
    "userA:SELECT",
    "userA:UPDATE",
    "userB:SELECT",
  ],
  follows: [
    "admin:UPDATE",
    "anon:DELETE",
    "anon:INSERT",
    "anon:SELECT",
    "anon:UPDATE",
    "service_role:DELETE",
    "service_role:INSERT",
    "service_role:SELECT",
    "service_role:UPDATE",
    "userA:DELETE",
    "userA:INSERT",
    "userA:SELECT",
    "userA:UPDATE",
  ],
  comments: [
    "anon:DELETE",
    "anon:INSERT",
    "anon:SELECT",
    "anon:UPDATE",
    "service_role:DELETE",
    "service_role:INSERT",
    "service_role:SELECT",
    "service_role:UPDATE",
    "userA:DELETE",
    "userA:INSERT",
    "userA:SELECT",
    "userA:UPDATE",
  ],
  notifications: [
    "admin:SELECT",
    "anon:DELETE",
    "anon:INSERT",
    "anon:SELECT",
    "anon:UPDATE",
    "service_role:DELETE",
    "service_role:INSERT",
    "service_role:SELECT",
    "service_role:UPDATE",
    "userA:DELETE",
    "userA:INSERT",
    "userA:SELECT",
    "userA:UPDATE",
  ],
  reports: [
    "admin:DELETE",
    "admin:SELECT",
    "admin:UPDATE",
    "anon:DELETE",
    "anon:INSERT",
    "anon:SELECT",
    "anon:UPDATE",
    "service_role:DELETE",
    "service_role:INSERT",
    "service_role:SELECT",
    "service_role:UPDATE",
    "userA:INSERT",
    "userA:SELECT",
    "userA:UPDATE",
  ],
  warnings: [
    "admin:DELETE",
    "admin:SELECT",
    "admin:UPDATE",
    "anon:DELETE",
    "anon:INSERT",
    "anon:SELECT",
    "anon:UPDATE",
    "service_role:DELETE",
    "service_role:INSERT",
    "service_role:SELECT",
    "service_role:UPDATE",
    "userA:DELETE",
    "userA:INSERT",
    "userA:SELECT",
    "userA:UPDATE",
  ],
  admin_roles: [
    "admin:INSERT",
    "admin:SELECT",
    "admin:UPDATE",
    "anon:DELETE",
    "anon:INSERT",
    "anon:SELECT",
    "anon:UPDATE",
    "service_role:DELETE",
    "service_role:INSERT",
    "service_role:SELECT",
    "service_role:UPDATE",
    "userA:DELETE",
    "userA:INSERT",
    "userA:SELECT",
  ],
  ad_campaigns: [
    "admin:SELECT",
    "admin:UPDATE",
    "anon:DELETE",
    "anon:INSERT",
    "anon:SELECT",
    "anon:UPDATE",
    "service_role:DELETE",
    "service_role:INSERT",
    "service_role:SELECT",
    "service_role:UPDATE",
    "userA:DELETE",
    "userA:INSERT",
    "userA:SELECT",
    "userA:UPDATE",
  ],
  ad_events: [
    "admin:SELECT",
    "anon:DELETE",
    "anon:INSERT",
    "anon:SELECT",
    "anon:UPDATE",
    "service_role:DELETE",
    "service_role:INSERT",
    "service_role:SELECT",
    "service_role:UPDATE",
    "userA:INSERT",
    "userA:SELECT",
    "userA:UPDATE",
  ],
  trending_topics: [
    "anon:DELETE",
    "anon:INSERT",
    "anon:SELECT",
    "anon:UPDATE",
    "service_role:DELETE",
    "service_role:INSERT",
    "service_role:SELECT",
    "service_role:UPDATE",
    "userA:INSERT",
    "userA:SELECT",
  ],
  news_comments: [
    "anon:DELETE",
    "anon:INSERT",
    "anon:SELECT",
    "anon:UPDATE",
    "service_role:DELETE",
    "service_role:INSERT",
    "service_role:SELECT",
    "service_role:UPDATE",
    "userA:DELETE",
    "userA:INSERT",
    "userA:SELECT",
    "userA:UPDATE",
  ],
  story_posts: [
    "anon:DELETE",
    "anon:INSERT",
    "anon:SELECT",
    "anon:UPDATE",
    "service_role:DELETE",
    "service_role:INSERT",
    "service_role:SELECT",
    "service_role:UPDATE",
    "userA:DELETE",
    "userA:INSERT",
    "userA:SELECT",
    "userA:UPDATE",
  ],
};

/** The full ordered list of admin rows as (table, action, expected). */
const ADMIN_ROWS: Array<[string, RlsAction, RlsVerdict]> = [
  ["posts", "SELECT", "deny"],
  ["profiles", "SELECT", "deny"],
  ["notifications", "SELECT", "deny"],
  ["reports", "SELECT", "allow"],
  ["reports", "UPDATE", "deny"],
  ["warnings", "SELECT", "allow"],
  ["warnings", "UPDATE", "deny"],
  ["admin_roles", "SELECT", "allow"],
  ["admin_roles", "INSERT", "deny"],
  ["admin_roles", "UPDATE", "deny"],
  ["ad_campaigns", "SELECT", "allow"],
  ["ad_campaigns", "UPDATE", "deny"],
  ["reports", "SELECT", "allow"],
  ["warnings", "SELECT", "allow"],
  ["follows", "UPDATE", "deny"],
  ["reports", "DELETE", "deny"],
  ["warnings", "DELETE", "deny"],
  ["ad_events", "SELECT", "allow"],
];

/** The full ordered list of anon SELECT rows as (table, expected). */
const ANON_SELECT_ROWS: Array<[string, RlsVerdict]> = [
  ["posts", "allow"],
  ["posts", "deny"],
  ["posts", "deny"],
  ["posts", "deny"],
  ["posts", "deny"],
  ["profiles", "allow"],
  ["profiles", "deny"],
  ["follows", "allow"],
  ["follows", "allow"],
  ["comments", "allow"],
  ["comments", "deny"],
  ["comments", "deny"],
  ["comments", "deny"],
  ["post_likes", "allow"],
  ["comment_likes", "allow"],
  ["admin_roles", "deny"],
  ["ad_packages", "allow"],
  ["ad_campaigns", "allow"],
  ["ad_campaigns", "deny"],
  ["post_stats", "allow"],
  ["news_stories", "allow"],
  ["story_posts", "allow"],
  ["story_relevant_people", "allow"],
  ["trending_topics", "allow"],
  ["news_comments", "allow"],
  ["news_comments", "deny"],
  ["admin_roles", "deny"],
  ["ad_events", "deny"],
  ["ad_exposures", "deny"],
  ["ad_payments", "deny"],
  ["ad_preferences", "deny"],
  ["blocks", "deny"],
  ["content_audit", "deny"],
  ["conversations", "deny"],
  ["feed_events", "deny"],
  ["follow_requests", "deny"],
  ["messages", "deny"],
  ["notifications", "deny"],
  ["reports", "deny"],
  ["saves", "deny"],
  ["story_follows", "deny"],
  ["story_saves", "deny"],
  ["warnings", "deny"],
];

/** The two userB rows, fully hardcoded. */
const USERB_ROWS: Array<{
  table: string;
  action: RlsAction;
  expected: RlsVerdict;
  policy: string;
}> = [
  {
    table: "posts",
    action: "SELECT",
    expected: "allow",
    policy: "Posts respect visibility and status",
  },
  {
    table: "profiles",
    action: "SELECT",
    expected: "deny",
    policy: "Profiles respect blocks and privacy",
  },
];

/** Aggregate counts, pinned. */
const TOTAL_CASES = 476;
const VERDICT_COUNTS: Record<RlsVerdict, number> = { allow: 235, deny: 241 };
const ROLE_COUNTS: Record<RlsRole, number> = {
  anon: 136,
  userA: 196,
  userB: 2,
  admin: 18,
  service_role: 124,
};
const ACTION_COUNTS: Record<RlsAction, number> = {
  SELECT: 157,
  INSERT: 123,
  UPDATE: 106,
  DELETE: 90,
};

const TABLE_SET: ReadonlySet<string> = new Set(EXPECTED_TABLES);
const ROLE_SET: ReadonlySet<string> = new Set(EXPECTED_ROLES);
const ACTION_SET: ReadonlySet<string> = new Set(EXPECTED_ACTIONS);
const UID_VALUES: ReadonlySet<string> = new Set(Object.values(EXPECTED_UIDS));
const CONTEXT_KEY_SET: ReadonlySet<string> = new Set(EXPECTED_CONTEXT_KEYS);
const STATUS_SET: ReadonlySet<string> = new Set(STATUS_VOCABULARY);

const MATRIX: readonly RlsTestCase[] = RLS_TEST_MATRIX;

function contextStatusFields(context: RlsContext): Array<string | undefined> {
  return [
    context.status,
    context.visibility,
    context.campaign_status,
    context.parent_post?.status,
    context.parent_post?.visibility,
  ];
}

// ---------------------------------------------------------------------------
// Exported constants — frozen, exact, and in the declared order
// ---------------------------------------------------------------------------

describe("exported constants", () => {
  it("RLS_TABLES matches the hardcoded 31-table list exactly, in order", () => {
    expect([...RLS_TABLES]).toEqual([...EXPECTED_TABLES]);
  });

  it("RLS_ROLES matches the hardcoded role list exactly, in order", () => {
    expect([...RLS_ROLES]).toEqual([...EXPECTED_ROLES]);
  });

  it("RLS_ACTIONS matches the hardcoded action list exactly, in order", () => {
    expect([...RLS_ACTIONS]).toEqual([...EXPECTED_ACTIONS]);
  });

  it("RLS_UIDS matches the hardcoded identities exactly", () => {
    expect({ ...RLS_UIDS }).toEqual(EXPECTED_UIDS);
  });

  const frozenRows: Array<[label: string, value: unknown]> = [
    ["RLS_TABLES", RLS_TABLES],
    ["RLS_ROLES", RLS_ROLES],
    ["RLS_ACTIONS", RLS_ACTIONS],
    ["RLS_UIDS", RLS_UIDS],
    ["RLS_TEST_MATRIX", RLS_TEST_MATRIX],
  ];

  it.each(frozenRows)("%s is frozen", (_label, value) => {
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("every table name is lowercase snake_case", () => {
    for (const table of RLS_TABLES) expect(table).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("RLS_TABLES contains no duplicates", () => {
    expect(new Set(RLS_TABLES).size).toBe(EXPECTED_TABLES.length);
  });

  it("RLS_ROLES contains no duplicates", () => {
    expect(new Set(RLS_ROLES).size).toBe(EXPECTED_ROLES.length);
  });

  it("RLS_ACTIONS contains no duplicates", () => {
    expect(new Set(RLS_ACTIONS).size).toBe(EXPECTED_ACTIONS.length);
  });

  it("RLS_UIDS values are distinct", () => {
    const values = Object.values(RLS_UIDS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("RLS_UIDS values look like uid-* identifiers", () => {
    for (const value of Object.values(RLS_UIDS)) expect(value).toMatch(/^uid-[A-Z]+$/);
  });
});

// ---------------------------------------------------------------------------
// Aggregate counts — the matrix is exactly this big, in these proportions
// ---------------------------------------------------------------------------

describe("matrix size and distribution", () => {
  it(`contains exactly ${TOTAL_CASES} cases`, () => {
    expect(MATRIX).toHaveLength(TOTAL_CASES);
  });

  const verdictRows: Array<[RlsVerdict, number]> = [
    ["allow", VERDICT_COUNTS.allow],
    ["deny", VERDICT_COUNTS.deny],
  ];

  it.each(verdictRows)("exactly %i cases expect %s", (expected, count) => {
    expect(MATRIX.filter((c) => c.expected === expected)).toHaveLength(count);
  });

  it("allow + deny accounts for every case", () => {
    expect(VERDICT_COUNTS.allow + VERDICT_COUNTS.deny).toBe(TOTAL_CASES);
  });

  const roleRows: Array<[RlsRole, number]> = (Object.keys(ROLE_COUNTS) as RlsRole[]).map((role) => [
    role,
    ROLE_COUNTS[role],
  ]);

  it.each(roleRows)("exactly %i cases for role %s", (role, count) => {
    expect(MATRIX.filter((c) => c.role === role)).toHaveLength(count);
  });

  it("role counts sum to the total", () => {
    const sum = Object.values(ROLE_COUNTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(TOTAL_CASES);
  });

  const actionRows: Array<[RlsAction, number]> = (Object.keys(ACTION_COUNTS) as RlsAction[]).map(
    (action) => [action, ACTION_COUNTS[action]],
  );

  it.each(actionRows)("exactly %i cases for action %s", (action, count) => {
    expect(MATRIX.filter((c) => c.action === action)).toHaveLength(count);
  });

  it("action counts sum to the total", () => {
    const sum = Object.values(ACTION_COUNTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(TOTAL_CASES);
  });

  const tableCountRows = EXPECTED_TABLES.map((table) => [table, TABLE_COUNTS[table] ?? 0] as const);

  it.each(tableCountRows)("exactly %i cases for table %s", (table, count) => {
    expect(MATRIX.filter((c) => c.table === table)).toHaveLength(count);
  });

  it("table counts sum to the total", () => {
    const sum = EXPECTED_TABLES.reduce((acc, table) => acc + (TABLE_COUNTS[table] ?? 0), 0);
    expect(sum).toBe(TOTAL_CASES);
  });

  it("every case names a known table", () => {
    for (const c of MATRIX) expect(TABLE_SET.has(c.table)).toBe(true);
  });

  it("the matrix covers all 31 tables and no others", () => {
    expect([...new Set(MATRIX.map((c) => c.table))].sort()).toEqual([...EXPECTED_TABLES].sort());
  });
});

// ---------------------------------------------------------------------------
// Uniqueness — the real key is (table, role, action, description)
// ---------------------------------------------------------------------------

describe("case uniqueness", () => {
  it("(table, role, action, description) is unique across all cases", () => {
    const keys = MATRIX.map((c) => `${c.table}|${c.role}|${c.action}|${c.description}`);
    expect(new Set(keys).size).toBe(TOTAL_CASES);
  });

  it("(table, role, action) is NOT unique — multiple row contexts share a policy slot", () => {
    const triples = new Set(MATRIX.map((c) => `${c.table}|${c.role}|${c.action}`));
    expect(triples.size).toBe(379);
    expect(triples.size).toBeLessThan(TOTAL_CASES);
  });

  it("every duplicate (table, role, action) slot differs by description", () => {
    const byTriple = new Map<string, RlsTestCase[]>();
    for (const c of MATRIX) {
      const key = `${c.table}|${c.role}|${c.action}`;
      byTriple.set(key, [...(byTriple.get(key) ?? []), c]);
    }
    for (const group of byTriple.values()) {
      expect(new Set(group.map((c) => c.description)).size).toBe(group.length);
    }
  });

  it("descriptions repeat across tables in exactly the 5 hardcoded groups", () => {
    // Descriptions are unique per (table, role, action, description) — verified
    // above — but the same prose is intentionally reused across tables for the
    // same kind of rule. These 5 groups are the complete set of repeats.
    const byDescription = new Map<string, RlsTestCase[]>();
    for (const c of MATRIX) {
      byDescription.set(c.description, [...(byDescription.get(c.description) ?? []), c]);
    }
    const repeated = [...byDescription.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([description, group]) => ({
        description,
        count: group.length,
        slots: group.map((c) => `${c.table}/${c.role}/${c.action}`).sort(),
      }))
      .sort((a, b) => a.description.localeCompare(b.description));

    expect(repeated.map((r) => [r.description, r.count])).toEqual([
      ["Cannot comment as another user", 2],
      ["Cannot insert as another user", 4],
      ["Cannot insert for others", 4],
      ["Curated table, no client INSERT", 2],
      ["No DELETE policy on warnings", 2],
    ]);
    expect(repeated[0]?.slots).toEqual(["comments/userA/INSERT", "news_comments/userA/INSERT"]);
    expect(repeated[1]?.slots).toEqual([
      "content_audit/userA/INSERT",
      "feed_events/userA/INSERT",
      "posts/userA/INSERT",
      "profiles/userA/INSERT",
    ]);
    expect(repeated[2]?.slots).toEqual([
      "ad_exposures/userA/INSERT",
      "ad_preferences/userA/INSERT",
      "story_follows/userA/INSERT",
      "story_saves/userA/INSERT",
    ]);
    expect(repeated[3]?.slots).toEqual([
      "story_relevant_people/userA/INSERT",
      "trending_topics/userA/INSERT",
    ]);
    expect(repeated[4]?.slots).toEqual(["warnings/admin/DELETE", "warnings/userA/DELETE"]);
    // 476 cases - 9 repeated occurrences = 467 distinct descriptions.
    expect(new Set(MATRIX.map((c) => c.description)).size).toBe(467);
  });
});

// ---------------------------------------------------------------------------
// Per-case structural validation (one test per case)
// ---------------------------------------------------------------------------

describe("every case is structurally valid", () => {
  // Pass the index so frozenness can be asserted on the original matrix entry
  // (the `{ i, ...c }` spread produces a fresh, unfrozen object).
  const cases = MATRIX.map((c, i) => ({ i, ...c }));

  it.each(cases)("#$i $role $action on $table — $description", (c) => {
    // Independently hardcoded vocabularies.
    expect(TABLE_SET.has(c.table)).toBe(true);
    expect(ROLE_SET.has(c.role)).toBe(true);
    expect(ACTION_SET.has(c.action)).toBe(true);
    expect(c.expected === "allow" || c.expected === "deny").toBe(true);

    // Descriptions and policy labels are meaningful prose.
    expect(c.description.trim()).toBe(c.description);
    expect(c.description.length).toBeGreaterThanOrEqual(10);
    expect(c.policy.trim()).toBe(c.policy);
    expect(c.policy.length).toBeGreaterThanOrEqual(10);

    // Context is a plain object whose keys all belong to the interface.
    expect(typeof c.context).toBe("object");
    expect(Array.isArray(c.context)).toBe(false);
    for (const key of Object.keys(c.context)) expect(CONTEXT_KEY_SET.has(key)).toBe(true);

    // Every uid-valued context field references a canonical identity.
    for (const value of Object.values(c.context)) {
      if (typeof value === "string" && value.startsWith("uid-")) {
        expect(UID_VALUES.has(value)).toBe(true);
      }
    }

    // Every status/visibility-ish field uses the hardcoded vocabulary.
    for (const status of contextStatusFields(c.context)) {
      if (status !== undefined) expect(STATUS_SET.has(status)).toBe(true);
    }

    // Boolean context fields are real booleans.
    for (const [key, value] of Object.entries(c.context)) {
      if (key.startsWith("is_") || key.startsWith("viewer_")) {
        if (key !== "viewer_id") expect(typeof value).toBe("boolean");
      }
    }

    // parent_post rows carry a complete post fact record.
    if (c.context.parent_post !== undefined) {
      const parent = c.context.parent_post;
      expect(typeof parent.author_id).toBe("string");
      expect(STATUS_SET.has(parent.status)).toBe(true);
      expect(STATUS_SET.has(parent.visibility)).toBe(true);
    }

    // Deny-by-default: anon never writes, regardless of table.
    if (c.role === "anon" && c.action !== "SELECT") expect(c.expected).toBe("deny");

    // service_role bypasses RLS: always allowed.
    if (c.role === "service_role") expect(c.expected).toBe("allow");

    // Rows are frozen — the matrix resists runtime mutation. (Asserted on the
    // original entry: the `{ i, ...c }` test-case spread is a fresh object.)
    expect(Object.isFrozen(MATRIX[c.i])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Exact row lists for the small role slices
// ---------------------------------------------------------------------------

describe("admin rows", () => {
  it("admin has exactly 18 rows in the hardcoded order", () => {
    const admin = MATRIX.filter((c) => c.role === "admin");
    expect(admin).toHaveLength(ADMIN_ROWS.length);
    expect(admin.map((c) => [c.table, c.action, c.expected])).toEqual(ADMIN_ROWS);
  });

  it("admin gains SELECT on the moderation tables and nothing else writable", () => {
    const admin = MATRIX.filter((c) => c.role === "admin");
    const writable = admin.filter((c) => c.action !== "SELECT" && c.expected === "allow");
    expect(writable).toHaveLength(0);
  });

  it("admin reads reports, warnings, admin_roles, ad_campaigns and ad_events", () => {
    const allowedSelects = MATRIX.filter(
      (c) => c.role === "admin" && c.action === "SELECT" && c.expected === "allow",
    ).map((c) => c.table);
    expect(allowedSelects.sort()).toEqual(
      [
        "ad_campaigns",
        "ad_events",
        "admin_roles",
        "reports",
        "reports",
        "warnings",
        "warnings",
      ].sort(),
    );
  });

  it("admin is denied private posts, private profiles and others' notifications", () => {
    const deniedSelects = MATRIX.filter(
      (c) => c.role === "admin" && c.action === "SELECT" && c.expected === "deny",
    ).map((c) => c.table);
    expect(deniedSelects.sort()).toEqual(["notifications", "posts", "profiles"]);
  });
});

describe("userB rows", () => {
  it("userB appears in exactly the two hardcoded rows", () => {
    const userB = MATRIX.filter((c) => c.role === "userB");
    expect(userB).toHaveLength(2);
    expect(
      userB.map((c) => ({
        table: c.table,
        action: c.action,
        expected: c.expected,
        policy: c.policy,
      })),
    ).toEqual(USERB_ROWS);
  });

  it("userB rows are read-only spot checks on posts and profiles", () => {
    for (const c of MATRIX.filter((row) => row.role === "userB")) {
      expect(c.action).toBe("SELECT");
    }
  });
});

describe("anon SELECT rows", () => {
  it("anon SELECT rows match the hardcoded ordered list exactly", () => {
    const anonSelect = MATRIX.filter((c) => c.role === "anon" && c.action === "SELECT");
    expect(anonSelect).toHaveLength(ANON_SELECT_ROWS.length);
    expect(anonSelect.map((c) => [c.table, c.expected])).toEqual(ANON_SELECT_ROWS);
  });

  it("anon reads nothing on the 17 no-public-read tables", () => {
    for (const table of ANON_NO_READ_TABLES) {
      const rows = MATRIX.filter(
        (c) => c.role === "anon" && c.action === "SELECT" && c.table === table,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const row of rows) expect(row.expected).toBe("deny");
    }
  });

  it("anon has at least one SELECT allow outside the no-read list", () => {
    const allowed = MATRIX.filter(
      (c) => c.role === "anon" && c.action === "SELECT" && c.expected === "allow",
    ).map((c) => c.table);
    expect(allowed.length).toBeGreaterThan(0);
    for (const table of allowed) expect(ANON_NO_READ_TABLES).not.toContain(table);
  });

  it("the no-public-read set and the public-read tables partition RLS_TABLES", () => {
    const publicRead = new Set(
      MATRIX.filter(
        (c) => c.role === "anon" && c.action === "SELECT" && c.expected === "allow",
      ).map((c) => c.table),
    );
    const union = new Set<string>([...ANON_NO_READ_TABLES, ...publicRead]);
    expect(union.size).toBe(EXPECTED_TABLES.length);
    for (const table of EXPECTED_TABLES) expect(union.has(table)).toBe(true);
    for (const table of ANON_NO_READ_TABLES) expect(publicRead.has(table)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Deny-by-default and bypass rules, per table
// ---------------------------------------------------------------------------

describe("anon write deny-by-default", () => {
  const writeActions = EXPECTED_ACTIONS.filter((a) => a !== "SELECT");
  it.each(
    EXPECTED_TABLES.flatMap((table) => writeActions.map((action) => [table, action] as const)),
  )("anon cannot %s on %s", (table, action) => {
    const matches = MATRIX.filter(
      (c) => c.role === "anon" && c.action === action && c.table === table,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.expected).toBe("deny");
    expect(matches[0]?.policy).toBe(`Deny by default: no anon ${action} policy exists`);
  });
});

describe("service_role bypass", () => {
  it.each(EXPECTED_TABLES)("service_role covers all 4 actions on %s exactly once", (table) => {
    const rows = MATRIX.filter((c) => c.role === "service_role" && c.table === table);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.action).sort()).toEqual([...EXPECTED_ACTIONS].sort());
    for (const row of rows) {
      expect(row.expected).toBe("allow");
      expect(row.policy).toBe("service_role bypasses row level security");
    }
  });

  it("service_role rows carry no row context (bypass ignores row state)", () => {
    for (const c of MATRIX.filter((row) => row.role === "service_role")) {
      expect(Object.keys(c.context)).toHaveLength(0);
    }
  });

  it("every service_role description names its action and table", () => {
    for (const c of MATRIX.filter((row) => row.role === "service_role")) {
      expect(c.description).toBe(`service_role bypasses ${c.action} restrictions on ${c.table}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Policy text ⇒ verdict rules
// ---------------------------------------------------------------------------

describe("policy text implies the verdict", () => {
  it("rows whose policy starts with 'No ' are always denies", () => {
    const rows = MATRIX.filter((c) => c.policy.startsWith("No "));
    expect(rows.length).toBeGreaterThan(0);
    for (const c of rows) expect(c.expected).toBe("deny");
  });

  it("rows whose policy starts with 'Deny by default' are always denies", () => {
    const rows = MATRIX.filter((c) => c.policy.startsWith("Deny by default"));
    expect(rows.length).toBe(110);
    for (const c of rows) expect(c.expected).toBe("deny");
  });

  it("rows whose policy mentions bypassing row level security are always allows", () => {
    const rows = MATRIX.filter((c) => c.policy === "service_role bypasses row level security");
    expect(rows).toHaveLength(124);
    for (const c of rows) expect(c.expected).toBe("allow");
  });

  it("no 'No <ACTION> policy on <table>' row is ever an allow", () => {
    for (const c of MATRIX) {
      const match = /^No (SELECT|INSERT|UPDATE|DELETE) policy on ([a-z_]+)$/.exec(c.policy);
      if (match) {
        expect(c.expected).toBe("deny");
        // The policy names its own table.
        expect(match[2]).toBe(c.table);
        // The policy names the action the case exercises.
        expect(match[1]).toBe(c.action);
      }
    }
  });

  it("at least one 'No ... policy' row exists per absent capability", () => {
    const policies = new Set(MATRIX.filter((c) => c.expected === "deny").map((c) => c.policy));
    expect(policies.has("No UPDATE policy on follows")).toBe(true);
    expect(policies.has("No DELETE policy on profiles")).toBe(true);
    expect(policies.has("No DELETE policy on comments")).toBe(true);
    expect(policies.has("No INSERT policy on admin_roles")).toBe(true);
    expect(policies.has("No UPDATE policy on messages")).toBe(false); // messages has a recipient UPDATE policy
  });

  it("distinct policy labels total 116", () => {
    expect(new Set(MATRIX.map((c) => c.policy)).size).toBe(116);
  });
});

// ---------------------------------------------------------------------------
// Per-table (role:action) coverage
// ---------------------------------------------------------------------------

describe("per-table role/action coverage", () => {
  const comboRows = Object.entries(TABLE_COMBOS);

  it.each(comboRows)("table %s covers exactly the hardcoded combo set", (table, combos) => {
    const actual = [
      ...new Set(MATRIX.filter((c) => c.table === table).map((c) => `${c.role}:${c.action}`)),
    ].sort();
    expect(actual).toEqual([...combos].sort());
  });

  it("every table gives userA at least one SELECT row", () => {
    for (const table of EXPECTED_TABLES) {
      const rows = MATRIX.filter(
        (c) => c.table === table && c.role === "userA" && c.action === "SELECT",
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("every table denies anon writes", () => {
    for (const table of EXPECTED_TABLES) {
      for (const action of EXPECTED_ACTIONS) {
        if (action === "SELECT") continue;
        const rows = MATRIX.filter(
          (c) => c.table === table && c.role === "anon" && c.action === action,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.expected).toBe("deny");
      }
    }
  });

  it("userA rows exist for every table", () => {
    const covered = new Set(MATRIX.filter((c) => c.role === "userA").map((c) => c.table));
    expect(covered.size).toBe(EXPECTED_TABLES.length);
  });

  it("userA can UPDATE own rows on tables that expose an UPDATE policy", () => {
    const updatable = [
      ...new Set(
        MATRIX.filter(
          (c) => c.role === "userA" && c.action === "UPDATE" && c.expected === "allow",
        ).map((c) => c.table),
      ),
    ];
    expect(updatable.sort()).toEqual(
      [
        "ad_campaigns",
        "ad_exposures",
        "ad_preferences",
        "comments",
        "messages",
        "news_comments",
        "notifications",
        "posts",
        "profiles",
        "story_follows",
        "warnings",
      ].sort(),
    );
  });

  it("userA INSERT allows exist only on tables users write to", () => {
    const insertables = [
      ...new Set(
        MATRIX.filter(
          (c) => c.role === "userA" && c.action === "INSERT" && c.expected === "allow",
        ).map((c) => c.table),
      ),
    ];
    expect(insertables.sort()).toEqual(
      [
        "ad_campaigns",
        "ad_events",
        "ad_exposures",
        "ad_payments",
        "ad_preferences",
        "blocks",
        "comment_likes",
        "comments",
        "content_audit",
        "conversations",
        "feed_events",
        "follow_requests",
        "follows",
        "messages",
        "news_comments",
        "post_likes",
        "posts",
        "profiles",
        "reports",
        "saves",
        "story_follows",
        "story_posts",
        "story_saves",
      ].sort(),
    );
  });

  it("userA DELETE allows exist only on self-owned rows", () => {
    const deletables = [
      ...new Set(
        MATRIX.filter(
          (c) => c.role === "userA" && c.action === "DELETE" && c.expected === "allow",
        ).map((c) => c.table),
      ),
    ];
    expect(deletables.sort()).toEqual(
      [
        "blocks",
        "comment_likes",
        "follow_requests",
        "follows",
        "post_likes",
        "posts",
        "saves",
        "story_follows",
        "story_saves",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Security-shape invariants worth asserting directly
// ---------------------------------------------------------------------------

describe("security-shape invariants", () => {
  it("ownership tables deny UPDATE/DELETE when the row belongs to someone else", () => {
    // Tables whose userA UPDATE policy is owner-scoped must pair an allow
    // (own row) with a deny (someone else's row).
    const ownerScoped = ["posts", "profiles", "comments", "notifications", "warnings"];
    for (const table of ownerScoped) {
      const updates = MATRIX.filter(
        (c) => c.table === table && c.role === "userA" && c.action === "UPDATE",
      );
      expect(updates.some((c) => c.expected === "allow")).toBe(true);
      expect(updates.some((c) => c.expected === "deny")).toBe(true);
    }
  });

  it("every self-vs-other pair in owner-scoped tables differs by ownership field", () => {
    // For posts: allow rows carry author_id = uid-A, deny rows uid-B (or no own row).
    const postUpdates = MATRIX.filter(
      (c) => c.table === "posts" && c.role === "userA" && c.action === "UPDATE",
    );
    expect(postUpdates).toHaveLength(2);
    expect(postUpdates[0]?.context.author_id).toBe(EXPECTED_UIDS.userA);
    expect(postUpdates[0]?.expected).toBe("allow");
    expect(postUpdates[1]?.context.author_id).toBe(EXPECTED_UIDS.userB);
    expect(postUpdates[1]?.expected).toBe("deny");
  });

  it("the only anonymous ad impression row is the viewer_id-null INSERT", () => {
    const nullViewer = MATRIX.filter((c) => c.context.viewer_id === null);
    expect(nullViewer).toHaveLength(1);
    expect(nullViewer[0]?.table).toBe("ad_events");
    expect(nullViewer[0]?.action).toBe("INSERT");
    expect(nullViewer[0]?.expected).toBe("allow");
  });

  it("17 cases model a parent post (all on comments)", () => {
    const parentRows = MATRIX.filter((c) => c.context.parent_post !== undefined);
    expect(parentRows).toHaveLength(17);
    for (const c of parentRows) expect(c.table).toBe("comments");
  });

  it("comments cases include followers-only and comments-disabled parent variants", () => {
    const parentRows = MATRIX.filter((c) => c.context.parent_post !== undefined);
    expect(parentRows.some((c) => c.context.parent_post?.visibility === "followers")).toBe(true);
    expect(parentRows.some((c) => c.context.parent_post?.comments_enabled === false)).toBe(true);
    expect(parentRows.some((c) => c.context.parent_post?.status === "archived")).toBe(true);
    expect(parentRows.some((c) => c.context.parent_post?.author_is_private === true)).toBe(true);
    expect(parentRows.some((c) => c.context.parent_post?.comments_enabled === true)).toBe(true);
  });

  it("blocks are modeled in both directions for SELECT", () => {
    const blockSelects = MATRIX.filter(
      (c) => c.table === "blocks" && c.role === "userA" && c.action === "SELECT",
    );
    expect(blockSelects).toHaveLength(3);
    expect(blockSelects.filter((c) => c.expected === "allow")).toHaveLength(2);
    expect(blockSelects.filter((c) => c.expected === "deny")).toHaveLength(1);
    // One allow as blocker, one as the blocked party.
    expect(blockSelects[0]?.context.blocker_id).toBe(EXPECTED_UIDS.userA);
    expect(blockSelects[1]?.context.blocked_id).toBe(EXPECTED_UIDS.userA);
    expect(blockSelects[2]?.context.blocker_id).toBe(EXPECTED_UIDS.userB);
  });

  it("follow_requests model both requester and followee withdrawal", () => {
    const withdrawals = MATRIX.filter(
      (c) => c.table === "follow_requests" && c.role === "userA" && c.action === "DELETE",
    );
    expect(withdrawals).toHaveLength(2);
    expect(withdrawals.every((c) => c.expected === "allow")).toBe(true);
    expect(withdrawals[0]?.context.requester_id).toBe(EXPECTED_UIDS.userA);
    expect(withdrawals[1]?.context.followee_id).toBe(EXPECTED_UIDS.userA);
  });

  it("messages distinguish sender-side, recipient-side, and non-participant UPDATE", () => {
    const updates = MATRIX.filter(
      (c) => c.table === "messages" && c.action === "UPDATE" && c.role === "userA",
    );
    expect(updates).toHaveLength(3);
    expect(updates[0]?.expected).toBe("allow");
    expect(updates[0]?.context.sender_id).toBe(EXPECTED_UIDS.userB);
    expect(updates[1]?.expected).toBe("deny");
    expect(updates[1]?.context.sender_id).toBe(EXPECTED_UIDS.userA);
    // Hardening migration 20261023090000: a recipient who is not a
    // participant of the message's conversation cannot update it either.
    expect(updates[2]?.expected).toBe("deny");
    expect(updates[2]?.context.user_a_id).toBe(EXPECTED_UIDS.userB);
    expect(updates[2]?.context.user_b_id).toBe(EXPECTED_UIDS.stranger);
  });

  it("conversations deny both UPDATE and DELETE outright", () => {
    for (const action of ["UPDATE", "DELETE"] as const) {
      const rows = MATRIX.filter(
        (c) => c.table === "conversations" && c.action === action && c.role === "userA",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.expected).toBe("deny");
    }
  });

  it("ad_packages and post_stats are read-only for users", () => {
    for (const table of ["ad_packages", "post_stats"]) {
      const userWrites = MATRIX.filter(
        (c) => c.table === table && c.role === "userA" && c.action !== "SELECT",
      );
      expect(userWrites.length).toBeGreaterThan(0);
      expect(userWrites.every((c) => c.expected === "deny")).toBe(true);
    }
  });

  it("news_stories is curated: SELECT-only for clients", () => {
    const clientWrites = MATRIX.filter(
      (c) =>
        c.table === "news_stories" &&
        (c.role === "userA" || c.role === "anon") &&
        c.action !== "SELECT",
    );
    expect(clientWrites).toHaveLength(6); // 3 anon + 3 userA write denies
    expect(clientWrites.every((c) => c.expected === "deny")).toBe(true);
  });

  it("trending_topics and story_relevant_people are curated the same way", () => {
    for (const table of ["trending_topics", "story_relevant_people"]) {
      const clientWrites = MATRIX.filter(
        (c) =>
          c.table === table && (c.role === "userA" || c.role === "anon") && c.action !== "SELECT",
      );
      expect(clientWrites.length).toBeGreaterThan(0);
      expect(clientWrites.every((c) => c.expected === "deny")).toBe(true);
    }
  });

  it("soft-delete tables hide deleted rows from others but not from the author", () => {
    for (const table of ["comments", "news_comments"]) {
      const rows = MATRIX.filter((c) => c.table === table && c.context.is_deleted === true);
      expect(rows.length).toBeGreaterThan(0);
      for (const c of rows) {
        if (c.role === "userA" && c.context.author_id === EXPECTED_UIDS.userA) {
          expect(c.expected).toBe("allow"); // own deleted row still visible to author
        } else {
          expect(c.expected).toBe("deny");
        }
      }
    }
  });

  it("private-profile visibility flips on the viewer_follows flag", () => {
    const privateProfile = MATRIX.filter(
      (c) =>
        c.table === "profiles" &&
        c.role === "userA" &&
        c.context.is_private === true &&
        c.context.user_id === EXPECTED_UIDS.stranger,
    );
    const follower = privateProfile.find((c) => c.context.viewer_follows_profile === true);
    const nonFollower = privateProfile.find((c) => c.context.viewer_follows_profile === undefined);
    expect(privateProfile).toHaveLength(2);
    expect(follower?.expected).toBe("allow");
    expect(nonFollower?.expected).toBe("deny");
  });

  it("ad_events INSERT requires an active campaign", () => {
    const inserts = MATRIX.filter(
      (c) => c.table === "ad_events" && c.action === "INSERT" && c.role === "userA",
    );
    const active = inserts.filter((c) => c.context.campaign_status === "active");
    const inactive = inserts.filter((c) => c.context.campaign_status === "paused");
    expect(inserts).toHaveLength(4);
    expect(active).toHaveLength(3);
    expect(inactive).toHaveLength(1);
    expect(inactive[0]?.expected).toBe("deny");
    // The two allowed rows are the self-identity insert and the anonymous
    // (viewer_id null) impression.
    expect(active.filter((c) => c.expected === "allow")).toHaveLength(2);
    expect(active.filter((c) => c.context.viewer_id === null)).toHaveLength(1);
  });

  it("ad_events and ad_payments reads key off the campaign advertiser", () => {
    for (const table of ["ad_events", "ad_payments"]) {
      const rows = MATRIX.filter((c) => c.table === table && c.action === "SELECT");
      const own = rows.find((c) => c.context.campaign_advertiser_id === EXPECTED_UIDS.userA);
      const others = rows.find((c) => c.context.campaign_advertiser_id === EXPECTED_UIDS.userB);
      expect(own?.expected).toBe("allow");
      expect(others?.expected).toBe("deny");
    }
  });

  it("description lengths stay within the pinned bounds", () => {
    const lengths = MATRIX.map((c) => c.description.length);
    expect(Math.min(...lengths)).toBe(14);
    expect(Math.max(...lengths)).toBe(156);
  });

  it("policy label lengths stay within the pinned bounds", () => {
    const lengths = MATRIX.map((c) => c.policy.length);
    expect(Math.min(...lengths)).toBe(17);
  });

  it("every description is unique per case index and never empty", () => {
    for (const c of MATRIX) {
      expect(c.description.length).toBeGreaterThan(0);
      expect(/\S/.test(c.description)).toBe(true);
    }
  });

  it("no case has an unexpected expected-value spelling", () => {
    for (const c of MATRIX) expect(["allow", "deny"]).toContain(c.expected);
  });
});

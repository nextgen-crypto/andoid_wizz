/**
 * Independent RLS policy evaluator ("mini policy engine") for WIZZ.
 *
 * This module re-implements the row-level security semantics of the app as
 * plain TypeScript predicates. It is written FROM THE POLICY SQL in
 * backend/supabase/migrations (read directly from the migrations), and it
 * deliberately shares no data with backend/security/rls-matrix.ts: the only
 * thing it takes from there is a *type* (compile-time only, erased at
 * runtime). The engine never sees a matrix verdict — given
 * (table, role, action, row context) it computes allow/deny on its own, so
 * comparing its answer with the matrix's hardcoded expectations is a real
 * drift check rather than a tautology.
 *
 * Modeling notes (kept faithful to PostgreSQL/Supabase behavior):
 *
 *   - Policies are permissive and OR-ed together. A policy written without
 *     `TO <role>` applies to every role (scope "public"); policies written
 *     `TO authenticated` never apply to anon. With no applicable policy the
 *     answer is deny (deny-by-default).
 *   - service_role holds BYPASSRLS and is allowed everything.
 *   - `auth.uid()` is NULL for anon, so ownership predicates and
 *     is_following() probes simply fail for it.
 *   - SECURITY DEFINER helpers (is_following, profile_is_private, is_admin)
 *     bypass the callee's own RLS — modeled by reading context facts
 *     directly.
 *   - Plain sub-queries inside a policy ARE filtered by the referenced
 *     table's RLS for the current viewer. That matters in two places and is
 *     modeled accordingly:
 *       * comments / SELECT and INSERT probe the parent post through the
 *         posts SELECT policy (intentional per the migration comments).
 *       * follows / SELECT probes `profiles.is_private` through the
 *         profiles SELECT policy — private profiles are hidden from exactly
 *         the non-followers the probe tries to exclude, which makes the
 *         policy's "private party" branch unreachable for third parties.
 *         The engine models the filtering faithfully and therefore derives
 *         the same effective behavior.
 *   - UPDATE with USING + WITH CHECK on the same predicate is modeled as a
 *     single predicate.
 */
import type {
  RlsAction,
  RlsContext,
  RlsPostFacts,
  RlsRole,
} from "../../../backend/security/rls-matrix";

export type Verdict = "allow" | "deny";

export interface Viewer {
  readonly uid: string | null;
  readonly isAdmin: boolean;
}

/** How a viewer uid maps to each matrix role (duplicated on purpose). */
export const ROLE_VIEWERS: Readonly<Record<RlsRole, Viewer>> = Object.freeze({
  anon: Object.freeze({ uid: null, isAdmin: false }),
  userA: Object.freeze({ uid: "uid-A", isAdmin: false }),
  userB: Object.freeze({ uid: "uid-B", isAdmin: false }),
  admin: Object.freeze({ uid: "uid-ADMIN", isAdmin: true }),
  service_role: Object.freeze({ uid: "uid-SERVICE", isAdmin: false }),
});

// ---------------------------------------------------------------- primitives

function isFollowing(v: Viewer, follows: boolean | undefined): boolean {
  // is_following() is SECURITY DEFINER but still returns no rows for NULL.
  return v.uid !== null && follows === true;
}

function viewerBlocked(blocked: boolean | undefined): boolean {
  // A blocks row always names two real users; NULL never matches.
  return blocked === true;
}

// ------------------------------------------------------- per-table policies

interface ProfileRowLike {
  user_id?: string;
  is_private?: boolean;
  viewer_blocked_profile?: boolean;
  viewer_follows_profile?: boolean;
}

/** profiles / SELECT: "Profiles respect blocks and privacy". */
function profilesRowVisible(row: ProfileRowLike, v: Viewer): boolean {
  if (viewerBlocked(row.viewer_blocked_profile)) return false;
  if (row.is_private !== true) return true;
  return row.user_id === v.uid || isFollowing(v, row.viewer_follows_profile);
}

interface PostRowLike {
  author_id?: string;
  status?: string;
  visibility?: string;
  author_is_private?: boolean;
  viewer_follows_author?: boolean;
  viewer_blocked_author?: boolean;
}

/**
 * posts / SELECT: "Posts respect visibility and status".
 * Owner shortcut first, then status/visibility, then the block exclusion,
 * then the private-author gate (profile_is_private is SECURITY DEFINER).
 */
function postsRowVisible(post: PostRowLike, v: Viewer): boolean {
  if (v.uid !== null && post.author_id === v.uid) return true;
  if (post.status !== "published") return false;
  if (post.visibility !== "public" && post.visibility !== "followers") {
    return false;
  }
  if (post.visibility === "followers" && !isFollowing(v, post.viewer_follows_author)) {
    return false;
  }
  if (viewerBlocked(post.viewer_blocked_author)) return false;
  if (post.author_is_private === true && !isFollowing(v, post.viewer_follows_author)) {
    return false;
  }
  return true;
}

/** comments / SELECT: "Comments follow parent post visibility". */
function commentsRowVisible(ctx: RlsContext, v: Viewer): boolean {
  if (v.uid !== null && ctx.author_id === v.uid) return true;
  if (ctx.is_deleted === true) return false;
  const parent: RlsPostFacts | undefined = ctx.parent_post;
  // The EXISTS(...) on the parent post runs under posts RLS.
  return parent !== undefined && postsRowVisible(parent, v);
}

/** comments / INSERT: author-only plus parent post published + open + visible. */
function commentsInsertable(ctx: RlsContext, v: Viewer): boolean {
  const parent: RlsPostFacts | undefined = ctx.parent_post;
  return (
    v.uid !== null &&
    ctx.author_id === v.uid &&
    parent !== undefined &&
    parent.status === "published" &&
    parent.comments_enabled !== false &&
    postsRowVisible(parent, v)
  );
}

/**
 * follows / SELECT: "Follows respect privacy".
 *
 * The policy probes `profiles` for private parties among
 * (follower, followee). That probe only returns rows that pass the profiles
 * SELECT policy for this viewer, and a private profile row is visible only
 * to its owner and approved followers. A non-follower therefore sees no
 * private party, the `NOT EXISTS` branch passes, and the row is readable.
 */
function followsRowVisible(ctx: RlsContext, v: Viewer): boolean {
  if (v.uid !== null && (v.uid === ctx.follower_id || v.uid === ctx.followee_id)) {
    return true;
  }
  const visiblePrivateParties: boolean[] = [];
  const probes = [
    {
      party: ctx.follower_id,
      isPrivate: ctx.follower_is_private === true,
      viewerFollows: ctx.viewer_follows_follower,
    },
    {
      party: ctx.followee_id,
      isPrivate: ctx.followee_is_private === true,
      viewerFollows: ctx.viewer_follows_followee,
    },
  ];
  for (const probe of probes) {
    if (probe.party === undefined) continue;
    if (!probe.isPrivate) continue;
    const visible = profilesRowVisible(
      {
        user_id: probe.party,
        is_private: probe.isPrivate,
        viewer_follows_profile: probe.viewerFollows,
      },
      v,
    );
    if (visible) visiblePrivateParties.push(probe.viewerFollows === true);
  }
  if (visiblePrivateParties.length === 0) return true;
  return visiblePrivateParties.some((follows) => isFollowing(v, follows));
}

// ------------------------------------------------------------- rule engine

type Check = (ctx: RlsContext, v: Viewer) => boolean;

interface Rule {
  /** "public" = no TO clause (applies to anon too); "authenticated" = TO authenticated. */
  readonly scope: "public" | "authenticated";
  readonly check: Check;
}

const open = (check: Check): Rule => ({ scope: "public", check });
const auth = (check: Check): Rule => ({ scope: "authenticated", check });

const owns =
  (
    field:
      | "author_id"
      | "user_id"
      | "follower_id"
      | "blocker_id"
      | "requester_id"
      | "reporter_id"
      | "actor_id"
      | "advertiser_id"
      | "viewer_id",
  ) =>
  (ctx: RlsContext, v: Viewer): boolean =>
    v.uid !== null && ctx[field] === v.uid;

const SELECT_RULES: Readonly<Record<string, readonly Rule[]>> = {
  profiles: [open(profilesRowVisible)],
  posts: [open(postsRowVisible)],
  follows: [open(followsRowVisible)],
  comments: [open(commentsRowVisible)],
  comment_likes: [open(() => true)],
  post_likes: [open(() => true)],
  news_stories: [open(() => true)],
  story_posts: [open(() => true)],
  story_relevant_people: [open(() => true)],
  trending_topics: [open(() => true)],
  post_stats: [open(() => true)],
  ad_packages: [open(() => true)],
  news_comments: [
    open((ctx) => ctx.is_deleted !== true),
    auth((ctx, v) => v.uid !== null && ctx.author_id === v.uid),
  ],
  ad_campaigns: [
    open((ctx) => ctx.status === "active"),
    auth(owns("advertiser_id")),
    auth((_ctx, v) => v.isAdmin),
  ],
  reports: [auth(owns("reporter_id")), auth((_ctx, v) => v.isAdmin)],
  warnings: [auth(owns("user_id")), auth((_ctx, v) => v.isAdmin)],
  admin_roles: [auth((_ctx, v) => v.isAdmin)],
  saves: [auth(owns("user_id"))],
  blocks: [
    auth((ctx, v) => v.uid !== null && (ctx.blocker_id === v.uid || ctx.blocked_id === v.uid)),
  ],
  follow_requests: [
    auth((ctx, v) => v.uid !== null && (ctx.requester_id === v.uid || ctx.followee_id === v.uid)),
  ],
  conversations: [
    auth((ctx, v) => v.uid !== null && (ctx.user_a_id === v.uid || ctx.user_b_id === v.uid)),
  ],
  messages: [
    auth(
      (ctx, v) =>
        v.uid !== null &&
        (ctx.sender_id === v.uid || ctx.user_a_id === v.uid || ctx.user_b_id === v.uid),
    ),
  ],
  notifications: [auth(owns("user_id"))],
  ad_events: [auth((ctx, v) => v.uid !== null && ctx.campaign_advertiser_id === v.uid)],
  ad_exposures: [auth(owns("viewer_id"))],
  ad_payments: [auth((ctx, v) => v.uid !== null && ctx.campaign_advertiser_id === v.uid)],
  ad_preferences: [auth(owns("user_id"))],
  feed_events: [auth(owns("user_id"))],
  content_audit: [auth(owns("actor_id"))],
  story_follows: [auth(owns("user_id"))],
  story_saves: [auth(owns("user_id"))],
};

const INSERT_RULES: Readonly<Record<string, readonly Rule[]>> = {
  posts: [auth(owns("author_id"))],
  profiles: [auth(owns("user_id"))],
  follows: [auth(owns("follower_id"))],
  comments: [auth(commentsInsertable)],
  comment_likes: [auth(owns("user_id"))],
  post_likes: [auth(owns("user_id"))],
  saves: [auth(owns("user_id"))],
  blocks: [auth(owns("blocker_id"))],
  follow_requests: [auth(owns("requester_id"))],
  conversations: [
    auth((ctx, v) => v.uid !== null && (ctx.user_a_id === v.uid || ctx.user_b_id === v.uid)),
  ],
  messages: [
    auth(
      (ctx, v) =>
        v.uid !== null &&
        ctx.sender_id === v.uid &&
        (ctx.user_a_id === v.uid || ctx.user_b_id === v.uid),
    ),
  ],
  content_audit: [auth(owns("actor_id"))],
  reports: [auth(owns("reporter_id"))],
  ad_campaigns: [auth(owns("advertiser_id"))],
  ad_events: [
    auth(
      (ctx, v) =>
        v.uid !== null &&
        (ctx.viewer_id === null || ctx.viewer_id === v.uid) &&
        ctx.campaign_status === "active",
    ),
  ],
  ad_exposures: [auth(owns("viewer_id"))],
  ad_payments: [auth((ctx, v) => v.uid !== null && ctx.campaign_advertiser_id === v.uid)],
  ad_preferences: [auth(owns("user_id"))],
  feed_events: [auth(owns("user_id"))],
  news_comments: [auth(owns("author_id"))],
  story_posts: [auth((ctx, v) => v.uid !== null && ctx.post_author_id === v.uid)],
  story_follows: [auth(owns("user_id"))],
  story_saves: [auth(owns("user_id"))],
};

const UPDATE_RULES: Readonly<Record<string, readonly Rule[]>> = {
  posts: [auth(owns("author_id"))],
  profiles: [auth(owns("user_id"))],
  comments: [auth(owns("author_id"))],
  news_comments: [auth(owns("author_id"))],
  notifications: [auth(owns("user_id"))],
  warnings: [auth(owns("user_id"))],
  // "Recipients can mark messages read": USING uid <> sender AND the viewer
  // is a participant of the message's conversation (hardening migration
  // 20261023090000).
  messages: [
    auth(
      (ctx, v) =>
        v.uid !== null &&
        ctx.sender_id !== undefined &&
        ctx.sender_id !== v.uid &&
        (ctx.user_a_id === v.uid || ctx.user_b_id === v.uid),
    ),
  ],
  ad_campaigns: [auth(owns("advertiser_id"))],
  ad_exposures: [auth(owns("viewer_id"))],
  ad_preferences: [auth(owns("user_id"))],
  // FOR ALL policies on the story per-user tables.
  story_follows: [auth(owns("user_id"))],
  story_saves: [auth(owns("user_id"))],
};

const DELETE_RULES: Readonly<Record<string, readonly Rule[]>> = {
  posts: [auth(owns("author_id"))],
  follows: [auth(owns("follower_id"))],
  blocks: [auth(owns("blocker_id"))],
  follow_requests: [
    auth((ctx, v) => v.uid !== null && (ctx.requester_id === v.uid || ctx.followee_id === v.uid)),
  ],
  saves: [auth(owns("user_id"))],
  post_likes: [auth(owns("user_id"))],
  comment_likes: [auth(owns("user_id"))],
  story_follows: [auth(owns("user_id"))],
  story_saves: [auth(owns("user_id"))],
};

const RULES: Readonly<Record<RlsAction, Readonly<Record<string, readonly Rule[]>>>> = {
  SELECT: SELECT_RULES,
  INSERT: INSERT_RULES,
  UPDATE: UPDATE_RULES,
  DELETE: DELETE_RULES,
};

const ALL_ENGINE_TABLES = new Set<string>([
  ...Object.keys(SELECT_RULES),
  ...Object.keys(INSERT_RULES),
  ...Object.keys(UPDATE_RULES),
  ...Object.keys(DELETE_RULES),
]);

/** Every table the engine models a policy for (compared against RLS_TABLES in tests). */
export const POLICY_ENGINE_TABLES: readonly string[] = Object.freeze([...ALL_ENGINE_TABLES].sort());

/**
 * A well-formed row that the viewer does NOT own and that has no privacy or
 * block entanglements. Used by the invariant/defense suites as a baseline.
 */
export const NEUTRAL_CONTEXT: RlsContext = Object.freeze({
  author_id: "uid-STRANGER",
  user_id: "uid-STRANGER",
  follower_id: "uid-STRANGER",
  followee_id: "uid-STRANGER",
  blocker_id: "uid-STRANGER",
  blocked_id: "uid-STRANGER",
  requester_id: "uid-STRANGER",
  reporter_id: "uid-STRANGER",
  actor_id: "uid-STRANGER",
  viewer_id: "uid-STRANGER",
  advertiser_id: "uid-STRANGER",
  sender_id: "uid-STRANGER",
  user_a_id: "uid-STRANGER",
  user_b_id: "uid-STRANGER",
  post_author_id: "uid-STRANGER",
  campaign_advertiser_id: "uid-STRANGER",
  campaign_status: "active",
  status: "published",
  visibility: "public",
  is_deleted: false,
  parent_post: Object.freeze({
    author_id: "uid-STRANGER",
    status: "published",
    visibility: "public",
    comments_enabled: true,
  }),
});

/** Returns the neutral baseline context for a known table (throws otherwise). */
export function neutralContext(table: string): RlsContext {
  if (!ALL_ENGINE_TABLES.has(table)) {
    throw new Error(`policy engine has no rules for table "${table}"`);
  }
  return NEUTRAL_CONTEXT;
}

/** The single entry point: compute the verdict for one (table, role, action, row). */
export function evaluateRls(
  table: string,
  role: RlsRole,
  action: RlsAction,
  context: RlsContext,
): Verdict {
  if (!ALL_ENGINE_TABLES.has(table)) {
    throw new Error(`policy engine has no rules for table "${table}"`);
  }
  const v: Viewer = ROLE_VIEWERS[role];
  if (role === "service_role") return "allow"; // BYPASSRLS
  const rules: readonly Rule[] = RULES[action][table] ?? [];
  for (const rule of rules) {
    if (rule.scope === "authenticated" && v.uid === null) continue;
    if (rule.check(context, v)) return "allow";
  }
  return "deny";
}

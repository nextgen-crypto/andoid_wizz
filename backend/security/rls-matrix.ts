/**
 * Security test matrix for WIZZ RLS policies.
 *
 * Each test verifies that a specific role (anonymous, user A, user B, admin,
 * service_role) can or cannot perform a specific action on a specific table
 * for a specific row context (owner, visibility, relationships, ...).
 *
 * This is a documentation + verification artifact: the actual enforcement
 * happens in PostgreSQL via RLS policies. The expectations here are
 * HARDCODED by hand from the migration SQL in backend/supabase/migrations.
 * src/tests/security/rls.test.ts re-evaluates every case with an
 * independently written policy engine and asserts the two agree — the
 * engine never reads `expected`, so drift between this documentation and
 * the modeled policy semantics fails the suite.
 *
 * A few expectations document *effective* behavior that differs from what
 * the policy text naively suggests, because policy sub-queries on other
 * tables are themselves filtered by those tables' RLS:
 *
 *   - follows / SELECT: the policy's `profiles.is_private` probe only sees
 *     profile rows that are visible to the viewer (the 2026-10-06 hardening
 *     hides private profiles from non-followers). A private profile is
 *     therefore invisible to exactly the viewers the probe is meant to
 *     exclude, so the `NOT EXISTS (private party)` branch passes and third
 *     parties can read follow rows involving private accounts.
 *   - comments / SELECT and INSERT: the EXISTS(...) on parent posts is
 *     filtered by the posts SELECT policy, so a comment is only readable or
 *     creatable when the parent post is visible to the viewer (this one is
 *     intentional — see the policy comment in the migration).
 */

export const RLS_ROLES = Object.freeze([
  "anon",
  "userA",
  "userB",
  "admin",
  "service_role",
] as const);
export type RlsRole = (typeof RLS_ROLES)[number];

export const RLS_ACTIONS = Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"] as const);
export type RlsAction = (typeof RLS_ACTIONS)[number];

export type RlsVerdict = "allow" | "deny";

/** Every RLS-protected table in the public schema (see supabase/types.ts). */
export const RLS_TABLES = Object.freeze([
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
] as const);

/**
 * Canonical row identities. The role's viewer uid is derived independently
 * by the policy engine; these constants are what matrix rows point at.
 */
export const RLS_UIDS = Object.freeze({
  userA: "uid-A",
  userB: "uid-B",
  admin: "uid-ADMIN",
  stranger: "uid-STRANGER",
} as const);

/** Facts about a parent post row referenced by a comments row. */
export interface RlsPostFacts {
  author_id: string;
  status: string;
  visibility: string;
  author_is_private?: boolean;
  viewer_follows_author?: boolean;
  viewer_blocked_author?: boolean;
  comments_enabled?: boolean;
}

/**
 * Row + relationship context for one matrix case. Only the fields a rule
 * actually reads need to be set. The `viewer_*` flags are facts about the
 * relationship between the case's viewer and the row (blocks in either
 * direction, is_following(viewer, X)) — they are inputs to the policy, not
 * outcomes.
 */
export interface RlsContext {
  // ownership / identity columns (per table)
  author_id?: string;
  user_id?: string;
  follower_id?: string;
  followee_id?: string;
  blocker_id?: string;
  blocked_id?: string;
  requester_id?: string;
  reporter_id?: string;
  actor_id?: string;
  viewer_id?: string | null;
  advertiser_id?: string;
  sender_id?: string;
  user_a_id?: string;
  user_b_id?: string;
  /** story_posts: author of the post being linked. */
  post_author_id?: string;
  /** ad_events / ad_payments: advertiser of the referenced campaign. */
  campaign_advertiser_id?: string;
  /** ad_events: status of the referenced campaign. */
  campaign_status?: string;
  /** row state */
  status?: string;
  visibility?: string;
  is_deleted?: boolean;
  is_private?: boolean;
  /** posts rows: privacy of the AUTHOR's profile (profile_is_private()). */
  author_is_private?: boolean;
  /** follows / profiles: per-side privacy of the two accounts. */
  follower_is_private?: boolean;
  followee_is_private?: boolean;
  /** relationship facts relative to the viewer */
  viewer_follows_author?: boolean;
  viewer_follows_profile?: boolean;
  viewer_follows_follower?: boolean;
  viewer_follows_followee?: boolean;
  viewer_blocked_author?: boolean;
  viewer_blocked_profile?: boolean;
  /** comments: the parent post row (subject to posts RLS). */
  parent_post?: RlsPostFacts;
}

export interface RlsTestCase {
  table: string;
  role: RlsRole;
  action: RlsAction;
  description: string;
  expected: RlsVerdict;
  policy: string;
  context: RlsContext;
}

function allow(
  table: string,
  role: RlsRole,
  action: RlsAction,
  description: string,
  policy: string,
  context: RlsContext = {},
): RlsTestCase {
  return { table, role, action, description, expected: "allow", policy, context };
}

function deny(
  table: string,
  role: RlsRole,
  action: RlsAction,
  description: string,
  policy: string,
  context: RlsContext = {},
): RlsTestCase {
  return { table, role, action, description, expected: "deny", policy, context };
}

const { userA, userB, admin, stranger } = RLS_UIDS;

// A publicly visible post authored by a stranger (used for comments rows).
const OPEN_POST = {
  author_id: stranger,
  status: "published",
  visibility: "public",
  comments_enabled: true,
} as const;

const CASES: RlsTestCase[] = [
  // ------------------------------------------------------------------ posts
  allow(
    "posts",
    "anon",
    "SELECT",
    "Published public posts visible to anon",
    "Posts respect visibility and status",
    { author_id: stranger, status: "published", visibility: "public" },
  ),
  deny(
    "posts",
    "anon",
    "SELECT",
    "Private-visibility posts hidden from anon",
    "Posts respect visibility and status",
    { author_id: stranger, status: "published", visibility: "private" },
  ),
  deny(
    "posts",
    "anon",
    "SELECT",
    "Archived posts hidden from anon",
    "Posts respect visibility and status",
    { author_id: stranger, status: "archived", visibility: "public" },
  ),
  deny(
    "posts",
    "anon",
    "SELECT",
    "Followers-only posts hidden from anon",
    "Posts respect visibility and status",
    { author_id: stranger, status: "published", visibility: "followers" },
  ),
  deny(
    "posts",
    "anon",
    "SELECT",
    "Private author's public post hidden from anon",
    "Posts respect visibility and status",
    { author_id: stranger, status: "published", visibility: "public", author_is_private: true },
  ),
  allow(
    "posts",
    "userA",
    "SELECT",
    "Own posts always visible regardless of status and visibility",
    "Posts respect visibility and status",
    { author_id: userA, status: "archived", visibility: "private" },
  ),
  allow(
    "posts",
    "userA",
    "SELECT",
    "Other's public posts visible",
    "Posts respect visibility and status",
    { author_id: stranger, status: "published", visibility: "public" },
  ),
  deny(
    "posts",
    "userA",
    "SELECT",
    "Other's private posts hidden",
    "Posts respect visibility and status",
    { author_id: stranger, status: "published", visibility: "private" },
  ),
  deny(
    "posts",
    "userA",
    "SELECT",
    "Other's archived posts hidden",
    "Posts respect visibility and status",
    { author_id: stranger, status: "archived", visibility: "public" },
  ),
  deny(
    "posts",
    "userA",
    "SELECT",
    "Blocked author's posts hidden",
    "Posts respect visibility and status",
    { author_id: stranger, status: "published", visibility: "public", viewer_blocked_author: true },
  ),
  allow(
    "posts",
    "userA",
    "SELECT",
    "Followers-only posts visible to followers",
    "Posts respect visibility and status",
    {
      author_id: stranger,
      status: "published",
      visibility: "followers",
      viewer_follows_author: true,
    },
  ),
  deny(
    "posts",
    "userA",
    "SELECT",
    "Followers-only posts hidden from non-followers",
    "Posts respect visibility and status",
    { author_id: stranger, status: "published", visibility: "followers" },
  ),
  allow(
    "posts",
    "userA",
    "SELECT",
    "Private author's post visible to approved followers",
    "Posts respect visibility and status",
    {
      author_id: stranger,
      status: "published",
      visibility: "public",
      author_is_private: true,
      viewer_follows_author: true,
    },
  ),
  deny(
    "posts",
    "userA",
    "SELECT",
    "Private author's post hidden from non-followers",
    "Posts respect visibility and status",
    { author_id: stranger, status: "published", visibility: "public", author_is_private: true },
  ),
  allow("posts", "userA", "INSERT", "Can insert own posts", "Users can create their own posts", {
    author_id: userA,
  }),
  deny(
    "posts",
    "userA",
    "INSERT",
    "Cannot insert as another user",
    "Users can create their own posts",
    { author_id: userB },
  ),
  allow("posts", "userA", "UPDATE", "Can update own posts", "Users can update their own posts", {
    author_id: userA,
  }),
  deny(
    "posts",
    "userA",
    "UPDATE",
    "Cannot update others' posts",
    "Users can update their own posts",
    { author_id: userB },
  ),
  allow("posts", "userA", "DELETE", "Can delete own posts", "Users can delete their own posts", {
    author_id: userA,
  }),
  deny(
    "posts",
    "userA",
    "DELETE",
    "Cannot delete others' posts",
    "Users can delete their own posts",
    { author_id: userB },
  ),
  allow(
    "posts",
    "userB",
    "SELECT",
    "userB sees userA's public posts",
    "Posts respect visibility and status",
    { author_id: userA, status: "published", visibility: "public" },
  ),
  deny(
    "posts",
    "admin",
    "SELECT",
    "Admin gains no special read access to others' private posts",
    "Posts respect visibility and status",
    { author_id: stranger, status: "published", visibility: "private" },
  ),

  // --------------------------------------------------------------- profiles
  allow(
    "profiles",
    "anon",
    "SELECT",
    "Public profiles visible to anon",
    "Profiles respect blocks and privacy",
    { user_id: stranger },
  ),
  deny(
    "profiles",
    "anon",
    "SELECT",
    "Private profiles hidden from anon",
    "Profiles respect blocks and privacy",
    { user_id: stranger, is_private: true },
  ),
  allow(
    "profiles",
    "userA",
    "SELECT",
    "Own profile always visible",
    "Profiles respect blocks and privacy",
    { user_id: userA, is_private: true },
  ),
  allow(
    "profiles",
    "userA",
    "SELECT",
    "Other's public profile visible",
    "Profiles respect blocks and privacy",
    { user_id: stranger },
  ),
  deny(
    "profiles",
    "userA",
    "SELECT",
    "Blocked profile hidden",
    "Profiles respect blocks and privacy",
    { user_id: stranger, viewer_blocked_profile: true },
  ),
  allow(
    "profiles",
    "userA",
    "SELECT",
    "Private profile visible to approved followers",
    "Profiles respect blocks and privacy",
    { user_id: stranger, is_private: true, viewer_follows_profile: true },
  ),
  deny(
    "profiles",
    "userA",
    "SELECT",
    "Private profile hidden from non-followers",
    "Profiles respect blocks and privacy",
    { user_id: stranger, is_private: true },
  ),
  allow(
    "profiles",
    "userA",
    "INSERT",
    "Can insert own profile",
    "Users can insert their own profile",
    { user_id: userA },
  ),
  deny(
    "profiles",
    "userA",
    "INSERT",
    "Cannot insert as another user",
    "Users can insert their own profile",
    { user_id: userB },
  ),
  allow(
    "profiles",
    "userA",
    "UPDATE",
    "Can update own profile",
    "Users can update their own profile",
    { user_id: userA },
  ),
  deny(
    "profiles",
    "userA",
    "UPDATE",
    "Cannot update others' profiles",
    "Users can update their own profile",
    { user_id: userB },
  ),
  deny(
    "profiles",
    "userA",
    "DELETE",
    "No DELETE policy on profiles, not even own row",
    "No DELETE policy on profiles",
    { user_id: userA },
  ),
  deny(
    "profiles",
    "userB",
    "SELECT",
    "userB cannot read userA's private profile",
    "Profiles respect blocks and privacy",
    { user_id: userA, is_private: true },
  ),
  deny(
    "profiles",
    "admin",
    "SELECT",
    "Admin gains no special read access to private profiles",
    "Profiles respect blocks and privacy",
    { user_id: stranger, is_private: true },
  ),

  // ---------------------------------------------------------------- follows
  allow(
    "follows",
    "anon",
    "SELECT",
    "Public follow rows visible to anon",
    "Follows respect privacy",
    { follower_id: userA, followee_id: userB },
  ),
  allow(
    "follows",
    "anon",
    "SELECT",
    "Effective allow: the policy's is_private probe reads profiles under profiles RLS, so a private account is invisible to anon and the NOT EXISTS branch passes",
    "Follows respect privacy",
    { follower_id: userA, followee_id: userB, followee_is_private: true },
  ),
  allow(
    "follows",
    "userA",
    "SELECT",
    "Own follow relationships always visible",
    "Follows respect privacy",
    { follower_id: userA, followee_id: userB, follower_is_private: true },
  ),
  allow(
    "follows",
    "userA",
    "SELECT",
    "Effective allow: third party cannot see the private profile the policy probes, so the row is not excluded",
    "Follows respect privacy",
    { follower_id: userB, followee_id: stranger, followee_is_private: true },
  ),
  allow(
    "follows",
    "userA",
    "SELECT",
    "Follower can see rows involving a private followee",
    "Follows respect privacy",
    {
      follower_id: userA,
      followee_id: userB,
      followee_is_private: true,
      viewer_follows_followee: true,
    },
  ),
  allow(
    "follows",
    "userA",
    "INSERT",
    "Can follow as themselves",
    "Users can follow as themselves",
    { follower_id: userA, followee_id: userB },
  ),
  deny(
    "follows",
    "userA",
    "INSERT",
    "Cannot follow as another user",
    "Users can follow as themselves",
    { follower_id: userB, followee_id: userA },
  ),
  allow(
    "follows",
    "userA",
    "DELETE",
    "Can unfollow as themselves",
    "Users can unfollow as themselves",
    { follower_id: userA, followee_id: userB },
  ),
  deny(
    "follows",
    "userA",
    "DELETE",
    "Cannot unfollow as another user",
    "Users can unfollow as themselves",
    { follower_id: userB, followee_id: userA },
  ),
  deny(
    "follows",
    "userA",
    "UPDATE",
    "No UPDATE policy on follows, not even own rows",
    "No UPDATE policy on follows",
    { follower_id: userA, followee_id: userB },
  ),

  // --------------------------------------------------------------- comments
  allow(
    "comments",
    "anon",
    "SELECT",
    "Comments on visible posts visible to anon",
    "Comments follow parent post visibility",
    { author_id: userA, parent_post: OPEN_POST },
  ),
  deny(
    "comments",
    "anon",
    "SELECT",
    "Comments on private posts hidden from anon",
    "Comments follow parent post visibility",
    { author_id: userA, parent_post: { ...OPEN_POST, author_is_private: true } },
  ),
  deny(
    "comments",
    "anon",
    "SELECT",
    "Deleted comments hidden from anon",
    "Comments follow parent post visibility",
    { author_id: userA, is_deleted: true, parent_post: OPEN_POST },
  ),
  deny(
    "comments",
    "anon",
    "SELECT",
    "Comments on followers-only posts hidden from anon",
    "Comments follow parent post visibility",
    { author_id: userA, parent_post: { ...OPEN_POST, visibility: "followers" } },
  ),
  allow(
    "comments",
    "userA",
    "SELECT",
    "Own comments always visible, even soft-deleted",
    "Comments follow parent post visibility",
    { author_id: userA, is_deleted: true, parent_post: OPEN_POST },
  ),
  allow(
    "comments",
    "userA",
    "SELECT",
    "Comments on visible posts visible",
    "Comments follow parent post visibility",
    { author_id: userB, parent_post: OPEN_POST },
  ),
  deny(
    "comments",
    "userA",
    "SELECT",
    "Other's soft-deleted comments hidden",
    "Comments follow parent post visibility",
    { author_id: userB, is_deleted: true, parent_post: OPEN_POST },
  ),
  deny(
    "comments",
    "userA",
    "SELECT",
    "Comments on followers-only posts hidden from non-followers",
    "Comments follow parent post visibility",
    { author_id: userB, parent_post: { ...OPEN_POST, visibility: "followers" } },
  ),
  allow(
    "comments",
    "userA",
    "SELECT",
    "Comments on followers-only posts visible to followers",
    "Comments follow parent post visibility",
    {
      author_id: userB,
      parent_post: { ...OPEN_POST, visibility: "followers", viewer_follows_author: true },
    },
  ),
  allow(
    "comments",
    "userA",
    "INSERT",
    "Can comment on published open posts",
    "Users can comment as themselves",
    { author_id: userA, parent_post: OPEN_POST },
  ),
  deny(
    "comments",
    "userA",
    "INSERT",
    "Cannot comment as another user",
    "Users can comment as themselves",
    { author_id: userB, parent_post: OPEN_POST },
  ),
  deny(
    "comments",
    "userA",
    "INSERT",
    "Cannot comment on archived posts",
    "Users can comment as themselves",
    { author_id: userA, parent_post: { ...OPEN_POST, status: "archived" } },
  ),
  deny(
    "comments",
    "userA",
    "INSERT",
    "Cannot comment on comments-disabled posts",
    "Users can comment as themselves",
    { author_id: userA, parent_post: { ...OPEN_POST, comments_enabled: false } },
  ),
  deny(
    "comments",
    "userA",
    "INSERT",
    "Cannot comment on posts invisible to them",
    "Users can comment as themselves",
    { author_id: userA, parent_post: { ...OPEN_POST, author_is_private: true } },
  ),
  allow(
    "comments",
    "userA",
    "UPDATE",
    "Can edit or soft-delete own comments",
    "Users can edit or soft-delete their own comments",
    { author_id: userA, parent_post: OPEN_POST },
  ),
  deny(
    "comments",
    "userA",
    "UPDATE",
    "Cannot edit others' comments",
    "Users can edit or soft-delete their own comments",
    { author_id: userB, parent_post: OPEN_POST },
  ),
  deny(
    "comments",
    "userA",
    "DELETE",
    "No DELETE policy on comments, soft-delete only",
    "No DELETE policy on comments",
    { author_id: userA, parent_post: OPEN_POST },
  ),

  // ------------------------------------------------------------ post_likes
  allow(
    "post_likes",
    "anon",
    "SELECT",
    "Post likes visible to anon",
    "Post likes are viewable by everyone",
  ),
  allow("post_likes", "userA", "SELECT", "Can view likes", "Post likes are viewable by everyone"),
  allow("post_likes", "userA", "INSERT", "Can like as themselves", "Users can like as themselves", {
    user_id: userA,
  }),
  deny(
    "post_likes",
    "userA",
    "INSERT",
    "Cannot like as another user",
    "Users can like as themselves",
    { user_id: userB },
  ),
  allow(
    "post_likes",
    "userA",
    "DELETE",
    "Can unlike as themselves",
    "Users can unlike as themselves",
    { user_id: userA },
  ),
  deny(
    "post_likes",
    "userA",
    "DELETE",
    "Cannot unlike as another user",
    "Users can unlike as themselves",
    { user_id: userB },
  ),
  deny(
    "post_likes",
    "userA",
    "UPDATE",
    "No UPDATE policy on post_likes",
    "No UPDATE policy on post_likes",
    { user_id: userA },
  ),

  // --------------------------------------------------------- comment_likes
  allow(
    "comment_likes",
    "anon",
    "SELECT",
    "Comment likes visible to anon",
    "Comment likes are viewable by everyone",
  ),
  allow(
    "comment_likes",
    "userA",
    "SELECT",
    "Can view comment likes",
    "Comment likes are viewable by everyone",
  ),
  allow(
    "comment_likes",
    "userA",
    "INSERT",
    "Can like comments as themselves",
    "Users can like as themselves",
    { user_id: userA },
  ),
  deny(
    "comment_likes",
    "userA",
    "INSERT",
    "Cannot like comments as another user",
    "Users can like as themselves",
    { user_id: userB },
  ),
  allow(
    "comment_likes",
    "userA",
    "DELETE",
    "Can unlike own comment likes",
    "Users can unlike as themselves",
    { user_id: userA },
  ),
  deny(
    "comment_likes",
    "userA",
    "UPDATE",
    "No UPDATE policy on comment_likes",
    "No UPDATE policy on comment_likes",
    { user_id: userA },
  ),

  // ----------------------------------------------------------------- saves
  allow("saves", "userA", "SELECT", "Can view own saves", "Users can view their own saves", {
    user_id: userA,
  }),
  deny("saves", "userA", "SELECT", "Cannot view others' saves", "Users can view their own saves", {
    user_id: userB,
  }),
  allow(
    "saves",
    "userA",
    "INSERT",
    "Can save posts as themselves",
    "Users can save posts as themselves",
    { user_id: userA },
  ),
  deny(
    "saves",
    "userA",
    "INSERT",
    "Cannot save as another user",
    "Users can save posts as themselves",
    { user_id: userB },
  ),
  allow("saves", "userA", "DELETE", "Can unsave own saves", "Users can unsave their own saves", {
    user_id: userA,
  }),
  deny("saves", "userA", "UPDATE", "No UPDATE policy on saves", "No UPDATE policy on saves", {
    user_id: userA,
  }),

  // ---------------------------------------------------------------- blocks
  allow(
    "blocks",
    "userA",
    "SELECT",
    "Can view own blocks as blocker",
    "Users can view their own blocks",
    { blocker_id: userA, blocked_id: userB },
  ),
  allow(
    "blocks",
    "userA",
    "SELECT",
    "Can view own blocks as blocked party",
    "Users can view their own blocks",
    { blocker_id: userB, blocked_id: userA },
  ),
  deny(
    "blocks",
    "userA",
    "SELECT",
    "Cannot view others' blocks",
    "Users can view their own blocks",
    { blocker_id: userB, blocked_id: stranger },
  ),
  allow("blocks", "userA", "INSERT", "Can block as themselves", "Users can block as themselves", {
    blocker_id: userA,
    blocked_id: userB,
  }),
  deny(
    "blocks",
    "userA",
    "INSERT",
    "Cannot block as another user",
    "Users can block as themselves",
    { blocker_id: userB, blocked_id: userA },
  ),
  allow(
    "blocks",
    "userA",
    "DELETE",
    "Can unblock as themselves",
    "Users can unblock as themselves",
    { blocker_id: userA, blocked_id: userB },
  ),
  deny("blocks", "userA", "UPDATE", "No UPDATE policy on blocks", "No UPDATE policy on blocks", {
    blocker_id: userA,
    blocked_id: userB,
  }),

  // -------------------------------------------------------- follow_requests
  allow(
    "follow_requests",
    "userA",
    "SELECT",
    "Can view own requests as requester",
    "Involved users can view requests",
    { requester_id: userA, followee_id: userB },
  ),
  allow(
    "follow_requests",
    "userA",
    "SELECT",
    "Can view own requests as followee",
    "Involved users can view requests",
    { requester_id: userB, followee_id: userA },
  ),
  deny(
    "follow_requests",
    "userA",
    "SELECT",
    "Cannot view others' requests",
    "Involved users can view requests",
    { requester_id: userB, followee_id: stranger },
  ),
  allow(
    "follow_requests",
    "userA",
    "INSERT",
    "Can request as themselves",
    "Users can request as themselves",
    { requester_id: userA, followee_id: userB },
  ),
  deny(
    "follow_requests",
    "userA",
    "INSERT",
    "Cannot request as another user",
    "Users can request as themselves",
    { requester_id: userB, followee_id: userA },
  ),
  allow(
    "follow_requests",
    "userA",
    "DELETE",
    "Can withdraw own requests as requester",
    "Involved users can withdraw requests",
    { requester_id: userA, followee_id: userB },
  ),
  allow(
    "follow_requests",
    "userA",
    "DELETE",
    "Can withdraw own requests as followee",
    "Involved users can withdraw requests",
    { requester_id: userB, followee_id: userA },
  ),
  deny(
    "follow_requests",
    "userA",
    "UPDATE",
    "No UPDATE policy on follow_requests",
    "No UPDATE policy on follow_requests",
    { requester_id: userA, followee_id: userB },
  ),

  // ---------------------------------------------------------- conversations
  allow(
    "conversations",
    "userA",
    "SELECT",
    "Can view own conversations",
    "Participants can view conversations",
    { user_a_id: userA, user_b_id: userB },
  ),
  deny(
    "conversations",
    "userA",
    "SELECT",
    "Cannot view others' conversations",
    "Participants can view conversations",
    { user_a_id: userB, user_b_id: stranger },
  ),
  allow(
    "conversations",
    "userA",
    "INSERT",
    "Can create conversations they participate in",
    "Participants can open conversations",
    { user_a_id: userA, user_b_id: userB },
  ),
  deny(
    "conversations",
    "userA",
    "INSERT",
    "Cannot create conversations for others",
    "Participants can open conversations",
    { user_a_id: userB, user_b_id: stranger },
  ),
  deny(
    "conversations",
    "userA",
    "UPDATE",
    "No UPDATE policy on conversations",
    "No UPDATE policy on conversations",
    { user_a_id: userA, user_b_id: userB },
  ),
  deny(
    "conversations",
    "userA",
    "DELETE",
    "No DELETE policy on conversations",
    "No DELETE policy on conversations",
    { user_a_id: userA, user_b_id: userB },
  ),

  // -------------------------------------------------------------- messages
  allow(
    "messages",
    "userA",
    "SELECT",
    "Can read own sent messages",
    "Participants can read messages",
    { sender_id: userA, user_a_id: userA, user_b_id: userB },
  ),
  allow(
    "messages",
    "userA",
    "SELECT",
    "Can read messages received in own conversations",
    "Participants can read messages",
    { sender_id: userB, user_a_id: userA, user_b_id: userB },
  ),
  deny(
    "messages",
    "userA",
    "SELECT",
    "Cannot read others' messages",
    "Participants can read messages",
    { sender_id: userB, user_a_id: userB, user_b_id: stranger },
  ),
  allow(
    "messages",
    "userA",
    "INSERT",
    "Can send messages in own conversations",
    "Participants can send messages",
    { sender_id: userA, user_a_id: userA, user_b_id: userB },
  ),
  deny(
    "messages",
    "userA",
    "INSERT",
    "Cannot send as another user",
    "Participants can send messages",
    { sender_id: userB, user_a_id: userA, user_b_id: userB },
  ),
  deny(
    "messages",
    "userA",
    "INSERT",
    "Cannot send into conversations they are not part of",
    "Participants can send messages",
    { sender_id: userA, user_a_id: userB, user_b_id: stranger },
  ),
  allow(
    "messages",
    "userA",
    "UPDATE",
    "Recipients can mark messages read",
    "Recipients can mark messages read",
    { sender_id: userB, user_a_id: userA, user_b_id: userB },
  ),
  deny(
    "messages",
    "userA",
    "UPDATE",
    "Senders cannot update their own messages",
    "Recipients can mark messages read",
    { sender_id: userA, user_a_id: userA, user_b_id: userB },
  ),
  deny(
    "messages",
    "userA",
    "UPDATE",
    "Non-participants cannot update messages",
    "Recipients can mark messages read",
    { sender_id: userB, user_a_id: userB, user_b_id: stranger },
  ),
  deny(
    "messages",
    "userA",
    "DELETE",
    "No DELETE policy on messages",
    "No DELETE policy on messages",
    { sender_id: userA, user_a_id: userA, user_b_id: userB },
  ),

  // --------------------------------------------------------- notifications
  allow(
    "notifications",
    "userA",
    "SELECT",
    "Can view own notifications",
    "Users can view their own notifications",
    { user_id: userA },
  ),
  deny(
    "notifications",
    "userA",
    "SELECT",
    "Cannot view others' notifications",
    "Users can view their own notifications",
    { user_id: userB },
  ),
  deny(
    "notifications",
    "userA",
    "INSERT",
    "Cannot insert notifications (trigger-only)",
    "No INSERT grant, trigger-only writes",
    { user_id: userA },
  ),
  allow(
    "notifications",
    "userA",
    "UPDATE",
    "Can mark own notifications read",
    "Users can mark their own notifications read",
    { user_id: userA },
  ),
  deny(
    "notifications",
    "userA",
    "UPDATE",
    "Cannot update others' notifications",
    "Users can mark their own notifications read",
    { user_id: userB },
  ),
  deny(
    "notifications",
    "userA",
    "DELETE",
    "No DELETE policy on notifications",
    "No DELETE policy on notifications",
    { user_id: userA },
  ),
  deny(
    "notifications",
    "admin",
    "SELECT",
    "Admin cannot read other users' notifications",
    "Users can view their own notifications",
    { user_id: userA },
  ),

  // --------------------------------------------------------------- reports
  allow("reports", "userA", "SELECT", "Can view own reports", "Users can view their own reports", {
    reporter_id: userA,
  }),
  deny(
    "reports",
    "userA",
    "SELECT",
    "Cannot view others' reports",
    "Users can view their own reports",
    { reporter_id: userB },
  ),
  allow(
    "reports",
    "userA",
    "INSERT",
    "Can file reports as themselves",
    "Users can file reports as themselves",
    { reporter_id: userA },
  ),
  deny(
    "reports",
    "userA",
    "INSERT",
    "Cannot file reports as another user",
    "Users can file reports as themselves",
    { reporter_id: userB },
  ),
  deny("reports", "userA", "UPDATE", "No UPDATE policy on reports", "No UPDATE policy on reports", {
    reporter_id: userA,
  }),
  allow("reports", "admin", "SELECT", "Admin can view all reports", "Admins can view reports", {
    reporter_id: stranger,
  }),
  deny(
    "reports",
    "admin",
    "UPDATE",
    "Admin cannot update reports from the client",
    "No UPDATE policy on reports",
    { reporter_id: stranger },
  ),

  // -------------------------------------------------------------- warnings
  allow(
    "warnings",
    "userA",
    "SELECT",
    "Can view own warnings",
    "Users can view their own warnings",
    { user_id: userA },
  ),
  deny(
    "warnings",
    "userA",
    "SELECT",
    "Cannot view others' warnings",
    "Users can view their own warnings",
    { user_id: userB },
  ),
  deny(
    "warnings",
    "userA",
    "INSERT",
    "Cannot insert warnings (admin/service-role only)",
    "No INSERT grant for users",
    { user_id: userA },
  ),
  allow(
    "warnings",
    "userA",
    "UPDATE",
    "Can dismiss own warnings",
    "Users can dismiss their own warnings",
    { user_id: userA },
  ),
  deny(
    "warnings",
    "userA",
    "UPDATE",
    "Cannot dismiss others' warnings",
    "Users can dismiss their own warnings",
    { user_id: userB },
  ),
  deny(
    "warnings",
    "userA",
    "DELETE",
    "No DELETE policy on warnings",
    "No DELETE policy on warnings",
    { user_id: userA },
  ),
  allow("warnings", "admin", "SELECT", "Admin can view all warnings", "Admins can view warnings", {
    user_id: stranger,
  }),
  deny(
    "warnings",
    "admin",
    "UPDATE",
    "Admin cannot update others' warnings from the client",
    "Users can dismiss their own warnings",
    { user_id: stranger },
  ),

  // ----------------------------------------------------------- admin_roles
  deny("admin_roles", "anon", "SELECT", "Anon cannot read admin roles", "Admins read roles", {
    user_id: stranger,
  }),
  deny("admin_roles", "userA", "SELECT", "Non-admin cannot view admin roles", "Admins read roles", {
    user_id: userA,
  }),
  allow("admin_roles", "admin", "SELECT", "Admin can view admin roles", "Admins read roles", {
    user_id: admin,
  }),
  deny(
    "admin_roles",
    "userA",
    "INSERT",
    "Cannot insert admin roles (service-role only)",
    "No INSERT policy on admin_roles",
    { user_id: userA },
  ),
  deny(
    "admin_roles",
    "admin",
    "INSERT",
    "Even admins cannot insert admin roles from the client",
    "No INSERT policy on admin_roles",
    { user_id: admin },
  ),
  deny(
    "admin_roles",
    "admin",
    "UPDATE",
    "No UPDATE policy on admin_roles",
    "No UPDATE policy on admin_roles",
    { user_id: admin },
  ),
  deny(
    "admin_roles",
    "userA",
    "DELETE",
    "No DELETE policy on admin_roles",
    "No DELETE policy on admin_roles",
    { user_id: userA },
  ),

  // ----------------------------------------------------------- ad_packages
  allow(
    "ad_packages",
    "anon",
    "SELECT",
    "Ad packages visible to anon",
    "Packages viewable by everyone",
  ),
  allow(
    "ad_packages",
    "userA",
    "SELECT",
    "Ad packages visible to users",
    "Packages viewable by everyone",
  ),
  deny(
    "ad_packages",
    "userA",
    "INSERT",
    "No INSERT policy on ad_packages",
    "No INSERT policy on ad_packages",
  ),
  deny(
    "ad_packages",
    "userA",
    "UPDATE",
    "No UPDATE policy on ad_packages",
    "No UPDATE policy on ad_packages",
  ),

  // --------------------------------------------------------- ad_campaigns
  allow(
    "ad_campaigns",
    "anon",
    "SELECT",
    "Active campaigns visible to anon",
    "Active campaigns viewable by everyone",
    { advertiser_id: stranger, status: "active" },
  ),
  deny(
    "ad_campaigns",
    "anon",
    "SELECT",
    "Non-active campaigns hidden from anon",
    "Active campaigns viewable by everyone",
    { advertiser_id: stranger, status: "draft" },
  ),
  allow(
    "ad_campaigns",
    "userA",
    "SELECT",
    "Own campaigns visible",
    "Advertisers manage own campaigns",
    { advertiser_id: userA, status: "draft" },
  ),
  allow(
    "ad_campaigns",
    "userA",
    "SELECT",
    "Other's active campaigns visible to everyone",
    "Active campaigns viewable by everyone",
    { advertiser_id: stranger, status: "active" },
  ),
  deny(
    "ad_campaigns",
    "userA",
    "SELECT",
    "Others' non-active campaigns hidden",
    "Advertisers manage own campaigns",
    { advertiser_id: stranger, status: "draft" },
  ),
  allow(
    "ad_campaigns",
    "userA",
    "INSERT",
    "Can create own campaigns",
    "Advertisers create own campaigns",
    { advertiser_id: userA },
  ),
  deny(
    "ad_campaigns",
    "userA",
    "INSERT",
    "Cannot create campaigns for others",
    "Advertisers create own campaigns",
    { advertiser_id: userB },
  ),
  allow(
    "ad_campaigns",
    "userA",
    "UPDATE",
    "Can update own campaigns",
    "Advertisers update own campaigns",
    { advertiser_id: userA },
  ),
  deny(
    "ad_campaigns",
    "userA",
    "UPDATE",
    "Cannot update others' campaigns",
    "Advertisers update own campaigns",
    { advertiser_id: userB },
  ),
  deny(
    "ad_campaigns",
    "userA",
    "DELETE",
    "No DELETE policy on ad_campaigns",
    "No DELETE policy on ad_campaigns",
    { advertiser_id: userA },
  ),
  allow(
    "ad_campaigns",
    "admin",
    "SELECT",
    "Admin can view all campaigns",
    "Admins can view campaigns",
    { advertiser_id: stranger, status: "draft" },
  ),
  deny(
    "ad_campaigns",
    "admin",
    "UPDATE",
    "Admin cannot update campaigns from the client",
    "Advertisers update own campaigns",
    { advertiser_id: stranger, status: "draft" },
  ),

  // ------------------------------------------------------------ ad_events
  allow(
    "ad_events",
    "userA",
    "INSERT",
    "Can log own ad events on active campaigns",
    "Users log their own ad events",
    { viewer_id: userA, campaign_status: "active" },
  ),
  allow(
    "ad_events",
    "userA",
    "INSERT",
    "Can log anonymous impressions (viewer_id null) on active campaigns",
    "Users log their own ad events",
    { viewer_id: null, campaign_status: "active" },
  ),
  deny(
    "ad_events",
    "userA",
    "INSERT",
    "Cannot log events for others",
    "Users log their own ad events",
    { viewer_id: userB, campaign_status: "active" },
  ),
  deny(
    "ad_events",
    "userA",
    "INSERT",
    "Cannot log events for inactive campaigns",
    "Users log their own ad events",
    { viewer_id: userA, campaign_status: "paused" },
  ),
  allow(
    "ad_events",
    "userA",
    "SELECT",
    "Advertisers can view their own campaign events",
    "Advertisers view own campaign events",
    { campaign_advertiser_id: userA },
  ),
  deny(
    "ad_events",
    "userA",
    "SELECT",
    "Cannot view other campaigns' events",
    "Advertisers view own campaign events",
    { campaign_advertiser_id: userB },
  ),
  deny(
    "ad_events",
    "userA",
    "UPDATE",
    "No UPDATE policy on ad_events",
    "No UPDATE policy on ad_events",
    { viewer_id: userA },
  ),

  // --------------------------------------------------------- ad_exposures
  allow("ad_exposures", "userA", "SELECT", "Can view own exposures", "Users manage own exposures", {
    viewer_id: userA,
  }),
  deny(
    "ad_exposures",
    "userA",
    "SELECT",
    "Cannot view others' exposures",
    "Users manage own exposures",
    { viewer_id: userB },
  ),
  allow(
    "ad_exposures",
    "userA",
    "INSERT",
    "Can insert own exposures",
    "Users insert own exposures",
    { viewer_id: userA },
  ),
  deny(
    "ad_exposures",
    "userA",
    "INSERT",
    "Cannot insert for others",
    "Users insert own exposures",
    { viewer_id: userB },
  ),
  allow(
    "ad_exposures",
    "userA",
    "UPDATE",
    "Can update own exposures",
    "Users update own exposures",
    { viewer_id: userA },
  ),
  deny(
    "ad_exposures",
    "userA",
    "DELETE",
    "No DELETE policy on ad_exposures",
    "No DELETE policy on ad_exposures",
    { viewer_id: userA },
  ),

  // ----------------------------------------------------------- ad_payments
  allow(
    "ad_payments",
    "userA",
    "SELECT",
    "Can view own campaign payments",
    "Advertisers view own payments",
    { campaign_advertiser_id: userA },
  ),
  deny(
    "ad_payments",
    "userA",
    "SELECT",
    "Cannot view others' payments",
    "Advertisers view own payments",
    { campaign_advertiser_id: userB },
  ),
  allow(
    "ad_payments",
    "userA",
    "INSERT",
    "Can create payments for own campaigns",
    "Advertisers create own payments",
    { campaign_advertiser_id: userA },
  ),
  deny(
    "ad_payments",
    "userA",
    "INSERT",
    "Cannot create payments for others' campaigns",
    "Advertisers create own payments",
    { campaign_advertiser_id: userB },
  ),
  deny(
    "ad_payments",
    "userA",
    "UPDATE",
    "No UPDATE policy on ad_payments",
    "No UPDATE policy on ad_payments",
    { campaign_advertiser_id: userA },
  ),

  // -------------------------------------------------------- ad_preferences
  allow(
    "ad_preferences",
    "userA",
    "SELECT",
    "Can view own preferences",
    "Users manage own ad preferences",
    { user_id: userA },
  ),
  deny(
    "ad_preferences",
    "userA",
    "SELECT",
    "Cannot view others' preferences",
    "Users manage own ad preferences",
    { user_id: userB },
  ),
  allow(
    "ad_preferences",
    "userA",
    "INSERT",
    "Can insert own preferences",
    "Users insert own ad preferences",
    { user_id: userA },
  ),
  deny(
    "ad_preferences",
    "userA",
    "INSERT",
    "Cannot insert for others",
    "Users insert own ad preferences",
    { user_id: userB },
  ),
  allow(
    "ad_preferences",
    "userA",
    "UPDATE",
    "Can update own preferences",
    "Users update own ad preferences",
    { user_id: userA },
  ),
  deny(
    "ad_preferences",
    "userA",
    "DELETE",
    "No DELETE policy on ad_preferences",
    "No DELETE policy on ad_preferences",
    { user_id: userA },
  ),

  // ---------------------------------------------------------- feed_events
  allow(
    "feed_events",
    "userA",
    "SELECT",
    "Can view own events",
    "Users can view their own events",
    { user_id: userA },
  ),
  deny(
    "feed_events",
    "userA",
    "SELECT",
    "Cannot view others' events",
    "Users can view their own events",
    { user_id: userB },
  ),
  allow(
    "feed_events",
    "userA",
    "INSERT",
    "Can insert own events",
    "Users can track as themselves",
    { user_id: userA },
  ),
  deny(
    "feed_events",
    "userA",
    "INSERT",
    "Cannot insert as another user",
    "Users can track as themselves",
    { user_id: userB },
  ),
  deny(
    "feed_events",
    "userA",
    "UPDATE",
    "No UPDATE policy on feed_events",
    "No UPDATE policy on feed_events",
    { user_id: userA },
  ),

  // ------------------------------------------------------------ post_stats
  allow(
    "post_stats",
    "anon",
    "SELECT",
    "Post stats visible to anon",
    "Post stats are viewable by everyone",
  ),
  allow(
    "post_stats",
    "userA",
    "SELECT",
    "Post stats visible to users",
    "Post stats are viewable by everyone",
  ),
  deny(
    "post_stats",
    "userA",
    "INSERT",
    "No INSERT policy on post_stats",
    "No INSERT policy on post_stats",
  ),
  deny(
    "post_stats",
    "userA",
    "UPDATE",
    "No UPDATE policy on post_stats",
    "No UPDATE policy on post_stats",
  ),

  // --------------------------------------------------------- content_audit
  allow(
    "content_audit",
    "userA",
    "SELECT",
    "Can view own audit trail",
    "Users can view their own audit trail",
    { actor_id: userA },
  ),
  deny(
    "content_audit",
    "userA",
    "SELECT",
    "Cannot view others' audit trail",
    "Users can view their own audit trail",
    { actor_id: userB },
  ),
  allow(
    "content_audit",
    "userA",
    "INSERT",
    "Can insert own audit entries",
    "Users can log their own actions",
    { actor_id: userA },
  ),
  deny(
    "content_audit",
    "userA",
    "INSERT",
    "Cannot insert as another user",
    "Users can log their own actions",
    { actor_id: userB },
  ),
  deny(
    "content_audit",
    "userA",
    "UPDATE",
    "No UPDATE policy on content_audit",
    "No UPDATE policy on content_audit",
    { actor_id: userA },
  ),

  // --------------------------------------------------------- news_stories
  allow("news_stories", "anon", "SELECT", "Stories visible to anon", "Stories are public"),
  allow("news_stories", "userA", "SELECT", "Stories visible to users", "Stories are public"),
  deny(
    "news_stories",
    "userA",
    "INSERT",
    "Stories are curated, no client INSERT",
    "No INSERT policy on news_stories",
  ),
  deny(
    "news_stories",
    "userA",
    "UPDATE",
    "No UPDATE policy on news_stories",
    "No UPDATE policy on news_stories",
  ),
  deny(
    "news_stories",
    "userA",
    "DELETE",
    "No DELETE policy on news_stories",
    "No DELETE policy on news_stories",
  ),

  // ---------------------------------------------------------- story_posts
  allow("story_posts", "anon", "SELECT", "Story posts visible to anon", "Story posts are public"),
  allow("story_posts", "userA", "SELECT", "Story posts visible to users", "Story posts are public"),
  allow(
    "story_posts",
    "userA",
    "INSERT",
    "Can link own posts to stories",
    "Users can link their own posts",
    { post_author_id: userA },
  ),
  deny(
    "story_posts",
    "userA",
    "INSERT",
    "Cannot link others' posts",
    "Users can link their own posts",
    { post_author_id: userB },
  ),
  deny(
    "story_posts",
    "userA",
    "UPDATE",
    "No UPDATE policy on story_posts",
    "No UPDATE policy on story_posts",
    { post_author_id: userA },
  ),
  deny(
    "story_posts",
    "userA",
    "DELETE",
    "No DELETE policy on story_posts",
    "No DELETE policy on story_posts",
    { post_author_id: userA },
  ),

  // ------------------------------------------------ story_relevant_people
  allow(
    "story_relevant_people",
    "anon",
    "SELECT",
    "Relevant people visible to anon",
    "Relevant people are public",
  ),
  allow(
    "story_relevant_people",
    "userA",
    "SELECT",
    "Relevant people visible to users",
    "Relevant people are public",
  ),
  deny(
    "story_relevant_people",
    "userA",
    "INSERT",
    "Curated table, no client INSERT",
    "No INSERT policy on story_relevant_people",
  ),
  deny(
    "story_relevant_people",
    "userA",
    "UPDATE",
    "No UPDATE policy on story_relevant_people",
    "No UPDATE policy on story_relevant_people",
  ),

  // --------------------------------------------------------- story_follows
  allow(
    "story_follows",
    "userA",
    "SELECT",
    "Can view own story follows",
    "Users manage their own story follows",
    { user_id: userA },
  ),
  deny(
    "story_follows",
    "userA",
    "SELECT",
    "Cannot view others' story follows",
    "Users manage their own story follows",
    { user_id: userB },
  ),
  allow(
    "story_follows",
    "userA",
    "INSERT",
    "Can insert own story follows",
    "Users manage their own story follows",
    { user_id: userA },
  ),
  deny(
    "story_follows",
    "userA",
    "INSERT",
    "Cannot insert for others",
    "Users manage their own story follows",
    { user_id: userB },
  ),
  allow(
    "story_follows",
    "userA",
    "DELETE",
    "Can delete own story follows",
    "Users manage their own story follows",
    { user_id: userA },
  ),
  allow(
    "story_follows",
    "userA",
    "UPDATE",
    "FOR ALL policy allows updating own story follows",
    "Users manage their own story follows",
    { user_id: userA },
  ),
  deny(
    "story_follows",
    "userA",
    "UPDATE",
    "Cannot update others' story follows",
    "Users manage their own story follows",
    { user_id: userB },
  ),

  // ---------------------------------------------------------- story_saves
  allow(
    "story_saves",
    "userA",
    "SELECT",
    "Can view own story saves",
    "Users manage their own story saves",
    { user_id: userA },
  ),
  deny(
    "story_saves",
    "userA",
    "SELECT",
    "Cannot view others' story saves",
    "Users manage their own story saves",
    { user_id: userB },
  ),
  allow(
    "story_saves",
    "userA",
    "INSERT",
    "Can insert own story saves",
    "Users manage their own story saves",
    { user_id: userA },
  ),
  deny(
    "story_saves",
    "userA",
    "INSERT",
    "Cannot insert for others",
    "Users manage their own story saves",
    { user_id: userB },
  ),
  allow(
    "story_saves",
    "userA",
    "DELETE",
    "Can delete own story saves",
    "Users manage their own story saves",
    { user_id: userA },
  ),
  deny(
    "story_saves",
    "userA",
    "UPDATE",
    "Cannot update others' story saves",
    "Users manage their own story saves",
    { user_id: userB },
  ),

  // ------------------------------------------------------- trending_topics
  allow(
    "trending_topics",
    "anon",
    "SELECT",
    "Trending topics visible to anon",
    "Trending topics are public",
  ),
  allow(
    "trending_topics",
    "userA",
    "SELECT",
    "Trending topics visible to users",
    "Trending topics are public",
  ),
  deny(
    "trending_topics",
    "userA",
    "INSERT",
    "Curated table, no client INSERT",
    "No INSERT policy on trending_topics",
  ),

  // --------------------------------------------------------- news_comments
  allow(
    "news_comments",
    "anon",
    "SELECT",
    "News comments visible to anon",
    "News comments are viewable",
    { author_id: userA, is_deleted: false },
  ),
  deny(
    "news_comments",
    "anon",
    "SELECT",
    "Deleted news comments hidden from anon",
    "News comments are viewable",
    { author_id: userA, is_deleted: true },
  ),
  allow(
    "news_comments",
    "userA",
    "SELECT",
    "Own news comments visible even when deleted",
    "Authors can view their own news comments",
    { author_id: userA, is_deleted: true },
  ),
  deny(
    "news_comments",
    "userA",
    "SELECT",
    "Other's deleted news comments hidden",
    "News comments are viewable",
    { author_id: userB, is_deleted: true },
  ),
  allow(
    "news_comments",
    "userA",
    "INSERT",
    "Can comment as themselves",
    "Users can comment as themselves",
    { author_id: userA },
  ),
  deny(
    "news_comments",
    "userA",
    "INSERT",
    "Cannot comment as another user",
    "Users can comment as themselves",
    { author_id: userB },
  ),
  allow(
    "news_comments",
    "userA",
    "UPDATE",
    "Can edit own news comments",
    "Authors edit or hide their own news comments",
    { author_id: userA },
  ),
  deny(
    "news_comments",
    "userA",
    "UPDATE",
    "Cannot edit others' news comments",
    "Authors edit or hide their own news comments",
    { author_id: userB },
  ),
  deny(
    "news_comments",
    "userA",
    "DELETE",
    "No DELETE policy on news_comments",
    "No DELETE policy on news_comments",
    { author_id: userA },
  ),

  // ---------------------------------------------------------------- admin
  allow(
    "reports",
    "admin",
    "SELECT",
    "Moderation admins read the full report queue",
    "Admins can view reports",
    { reporter_id: userB },
  ),
  allow(
    "warnings",
    "admin",
    "SELECT",
    "Moderation admins read the full warning log",
    "Admins can view warnings",
    { user_id: userB },
  ),
  deny(
    "follows",
    "admin",
    "UPDATE",
    "Admin role grants no write powers on social tables",
    "No UPDATE policy on follows",
    { follower_id: admin, followee_id: userA },
  ),
  deny("reports", "admin", "DELETE", "No DELETE policy on reports", "No DELETE policy on reports", {
    reporter_id: admin,
  }),
  deny(
    "warnings",
    "admin",
    "DELETE",
    "No DELETE policy on warnings",
    "No DELETE policy on warnings",
    { user_id: admin },
  ),
  allow(
    "ad_events",
    "admin",
    "SELECT",
    "is_admin does not widen ad_events reads (admin must own the campaign)",
    "Advertisers view own campaign events",
    { campaign_advertiser_id: admin },
  ),
];

// ---------------------------------------------------------------------------

// Deny-by-default: no policy grants anon write access anywhere.
for (const table of RLS_TABLES) {
  CASES.push(
    deny(
      table,
      "anon",
      "INSERT",
      `Anon cannot INSERT on ${table}`,
      "Deny by default: no anon INSERT policy exists",
    ),
  );
  CASES.push(
    deny(
      table,
      "anon",
      "UPDATE",
      `Anon cannot UPDATE on ${table}`,
      "Deny by default: no anon UPDATE policy exists",
    ),
  );
  CASES.push(
    deny(
      table,
      "anon",
      "DELETE",
      `Anon cannot DELETE on ${table}`,
      "Deny by default: no anon DELETE policy exists",
    ),
  );
}

// Tables whose SELECT policies are all `TO authenticated`: anon reads
// nothing here (these have no public-read policy at all).
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

for (const table of ANON_NO_READ_TABLES) {
  CASES.push(
    deny(
      table,
      "anon",
      "SELECT",
      `Anon cannot SELECT on ${table}`,
      "Deny by default: no anon SELECT policy exists",
    ),
  );
}

// service_role holds BYPASSRLS: full read/write on every table.
for (const table of RLS_TABLES) {
  for (const action of RLS_ACTIONS) {
    CASES.push(
      allow(
        table,
        "service_role",
        action,
        `service_role bypasses ${action} restrictions on ${table}`,
        "service_role bypasses row level security",
      ),
    );
  }
}

export const RLS_TEST_MATRIX: RlsTestCase[] = CASES;

// Defense-in-depth: the matrix is a constant; freeze it against mutation.
Object.freeze(CASES);
for (const entry of CASES) {
  Object.freeze(entry);
}

import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  diversify,
  EMPTY_PROFILE,
  ensureExploration,
  encodeCursor,
  interleaveLanes,
  laneWeightsFor,
  scoreCandidate,
  tupleAfter,
  type FeedItem,
  type InterestProfile,
} from "./feedService";
import type { Post } from "../domain/types";

function post(id: string, overrides: Partial<Post> = {}): Post {
  return {
    id,
    authorId: "author-1",
    source: "buzz",
    caption: `caption ${id}`,
    media: [{ kind: "image", objectKey: "k", width: 10, height: 10, blurColor: "#000", alt: "" }],
    hashtags: [],
    category: "Tech",
    metrics: { likes: 0, comments: 0, shares: 0, saves: 0, views: 0 },
    createdAt: "2026-10-01T00:00:00.000Z",
    visibility: "public",
    moderationStatus: "approved",
    ...overrides,
  };
}

function item(p: Post): FeedItem {
  return {
    post: p,
    author: { id: p.authorId, username: "u", displayName: "U", avatarKey: "", verified: false },
  };
}

const NOW = Date.parse("2026-10-02T00:00:00.000Z");

describe("laneWeightsFor", () => {
  it("favors fresh content for cold-start users", () => {
    const w = laneWeightsFor(EMPTY_PROFILE);
    expect(w.fresh).toBeGreaterThan(w.personalized);
  });

  it("favors personalized content for heavy users", () => {
    const heavy: InterestProfile = {
      ...EMPTY_PROFILE,
      followingIds: Array.from({ length: 50 }, (_, i) => `a${i}`),
    };
    const w = laneWeightsFor(heavy);
    expect(w.personalized).toBeGreaterThan(w.fresh);
  });
});

describe("scoreCandidate", () => {
  it("drops muted authors and hidden posts", () => {
    const profile: InterestProfile = {
      ...EMPTY_PROFILE,
      mutedAuthorIds: ["author-1"],
      hiddenPostIds: ["p2"],
    };
    expect(scoreCandidate(item(post("p1")), 0, false, NOW, profile)).toBeNull();
    expect(scoreCandidate(item(post("p2")), 0, false, NOW, profile)).toBeNull();
  });

  it("ranks followed authors and saved categories higher", () => {
    const base = item(post("p1"));
    const followed = item(post("p2", { authorId: "followed" }));
    const profile: InterestProfile = {
      ...EMPTY_PROFILE,
      followingIds: ["followed"],
      savedCategories: ["tech"],
    };
    const a = scoreCandidate(base, 0, false, NOW, profile)!;
    const b = scoreCandidate(followed, 0, false, NOW, profile)!;
    expect(b.score).toBeGreaterThan(a.score);
  });

  it("applies the not-interested penalty", () => {
    const profile: InterestProfile = { ...EMPTY_PROFILE, notInterestedPostIds: ["p1"] };
    const penalized = scoreCandidate(item(post("p1")), 0, false, NOW, profile)!;
    const normal = scoreCandidate(item(post("p2")), 0, false, NOW, profile)!;
    expect(penalized.score).toBeLessThan(normal.score);
  });
});

describe("interleaveLanes", () => {
  it("mixes lanes by weight and skips empty lanes", () => {
    const mk = (lane: "personalized" | "fresh" | "discovery", id: string, score: number) => ({
      item: item(post(id)),
      score,
      lane,
    });
    const out = interleaveLanes(
      {
        personalized: [mk("personalized", "p1", 100)],
        fresh: [mk("fresh", "f1", 90), mk("fresh", "f2", 80)],
        discovery: [],
      },
      { personalized: 0.5, fresh: 0.3, discovery: 0.2 },
    );
    expect(out.map((s) => s.item.post.id)).toEqual(["p1", "f1", "f2"]);
  });
});

describe("diversify", () => {
  it("defers posts beyond the per-creator cap", () => {
    const items = [1, 2, 3, 4].map((n) => ({
      item: item(post(`p${n}`)),
      score: 100 - n,
      lane: "fresh" as const,
    }));
    const out = diversify(items, 2);
    expect(out.slice(0, 2).map((s) => s.item.post.id)).toEqual(["p1", "p2"]);
    expect(out.slice(2).map((s) => s.item.post.id)).toEqual(["p3", "p4"]);
  });
});

describe("ensureExploration", () => {
  it("pulls an explore item into slot 3 when the head of the feed has none", () => {
    const known = item(post("known"));
    const explore = item(post("explore", { authorId: "someone-else", category: "Sports" }));
    const profile: InterestProfile = {
      ...EMPTY_PROFILE,
      followingIds: ["author-1", "a2", "a3"],
      savedCategories: ["tech", "news"],
    };
    const ordered = [
      { item: known, score: 10, lane: "personalized" as const },
      { item: known, score: 9, lane: "personalized" as const },
      { item: known, score: 8, lane: "personalized" as const },
      { item: known, score: 7, lane: "personalized" as const },
      { item: known, score: 6, lane: "personalized" as const },
      { item: known, score: 5, lane: "personalized" as const },
      { item: explore, score: 4, lane: "discovery" as const },
    ];
    const out = ensureExploration(ordered, profile);
    expect(out[2]!.item.post.id).toBe("explore");
  });
});

describe("cursor stability", () => {
  it("round-trips encode/decode", () => {
    const cur = { id: "p1", s: 42, t: "2026-10-01", n: NOW };
    const decoded = decodeCursor(encodeCursor(cur));
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe("p1");
    expect(decoded!.s).toBe(42);
    expect(decoded!.fresh).toBe(false);
  });

  it("returns null for corrupt cursors", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });

  it("orders tuples by (score, id) after the cursor", () => {
    const cur = { id: "p1", s: 10, t: "t", n: NOW };
    expect(tupleAfter({ s: 9, t: "t", id: "p9" }, cur)).toBe(true);
    expect(tupleAfter({ s: 10, t: "t", id: "p0" }, cur)).toBe(false);
    expect(tupleAfter({ s: 10, t: "t", id: "p2" }, cur)).toBe(true);
  });
});

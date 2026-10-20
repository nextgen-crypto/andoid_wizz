import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Table-driven matrix over backend/domain/media.ts.
 *
 * `MEDIA_BASE_URL` is read once at module load for image URLs (CDN_BASE) but
 * on every call for videoUrl, so the default-base module instance is created
 * with the env stubbed empty before anything else runs, and videoUrl rows
 * re-stub the env inside the test.
 */
vi.stubEnv("MEDIA_BASE_URL", "");
const media = await import("./media");
type MediaModule = typeof media;
type Rendition = import("./media").Rendition;

const DEFAULT_BASE = "https://picsum.photos/seed";

afterEach(() => {
  // Every test that touches MEDIA_BASE_URL must leave the default base behind.
  vi.stubEnv("MEDIA_BASE_URL", "");
});

/**
 * Independent expectation model for URL assembly. Written from the documented
 * contract (rendition -> width, height derived from aspect, non-alphanumerics
 * hashed to "-"), not imported from the source under test, so a silent change
 * in media.ts fails this suite. Anchored by the literal rows below.
 */
const MODEL_WIDTH: Record<Rendition, number> = {
  thumbnail: 200,
  small: 400,
  medium: 800,
  large: 1280,
  original: 1920,
};

function modelHash(objectKey: string): string {
  let out = "";
  for (const ch of objectKey) {
    out += /[a-zA-Z0-9]/.test(ch) ? ch : "-";
  }
  return out;
}

function modelImageUrl(base: string, key: string, rendition: Rendition, aspect: number): string {
  const w = MODEL_WIDTH[rendition];
  let h = Math.round(w / aspect);
  if (Number.isNaN(h)) h = Number.NaN;
  else if (h < 1) h = 1;
  return `${base}/${modelHash(key)}/${w}/${h}`;
}

const KEYS: string[] = [
  "a",
  "hero.png",
  "posts/2026/hero.png",
  "user_1 (1).jpg",
  "file with spaces.jpg",
  "Ünïcode çhar.png",
  "",
  "weird!@#$%^&*().png",
];

const RENDITIONS: Rendition[] = ["thumbnail", "small", "medium", "large", "original"];
const ASPECTS: number[] = [1, 2, 0.5, 0.75, 1.5, 3];

describe("imageUrl — rendition/aspect grid (independent model)", () => {
  const grid: Array<[string, Rendition, number]> = [];
  for (const key of KEYS) {
    for (const rendition of RENDITIONS) {
      for (const aspect of ASPECTS) grid.push([key, rendition, aspect]);
    }
  }

  it("covers 8 keys x 5 renditions x 6 aspects", () => {
    expect(grid).toHaveLength(240);
  });

  it.each(grid)("imageUrl(%j, %s, %s)", (key, rendition, aspect) => {
    expect(media.imageUrl(key, rendition, aspect)).toBe(
      modelImageUrl(DEFAULT_BASE, key, rendition, aspect),
    );
  });
});

describe("imageUrl — literal anchors (default base)", () => {
  const rows: Array<[string, Rendition | undefined, number | undefined, string]> = [
    ["hero.png", undefined, undefined, `${DEFAULT_BASE}/hero-png/800/800`],
    ["posts/2026/hero.png", undefined, undefined, `${DEFAULT_BASE}/posts-2026-hero-png/800/800`],
    ["a", "thumbnail", undefined, `${DEFAULT_BASE}/a/200/200`],
    ["a", "small", undefined, `${DEFAULT_BASE}/a/400/400`],
    ["a", "medium", undefined, `${DEFAULT_BASE}/a/800/800`],
    ["a", "large", undefined, `${DEFAULT_BASE}/a/1280/1280`],
    ["a", "original", undefined, `${DEFAULT_BASE}/a/1920/1920`],
    ["a", "medium", 2, `${DEFAULT_BASE}/a/800/400`],
    ["a", "medium", 0.5, `${DEFAULT_BASE}/a/800/1600`],
    ["a", "medium", 3, `${DEFAULT_BASE}/a/800/267`],
    ["a", "medium", 1.5, `${DEFAULT_BASE}/a/800/533`],
    ["a", "thumbnail", 3, `${DEFAULT_BASE}/a/200/67`],
    ["a", "original", 0.75, `${DEFAULT_BASE}/a/1920/2560`],
    ["file with spaces.jpg", "small", 1, `${DEFAULT_BASE}/file-with-spaces-jpg/400/400`],
    ["user_1 (1).jpg", "large", 2, `${DEFAULT_BASE}/user-1--1--jpg/1280/640`],
    ["Ünïcode çhar.png", undefined, undefined, `${DEFAULT_BASE}/-n-code--har-png/800/800`],
    ["🔥.png", undefined, undefined, `${DEFAULT_BASE}/---png/800/800`],
    ["HTTP://X", undefined, undefined, `${DEFAULT_BASE}/HTTP---X/800/800`],
    ["a/b", "original", 1, `${DEFAULT_BASE}/a-b/1920/1920`],
    ["", undefined, undefined, `${DEFAULT_BASE}//800/800`],
    ["", "thumbnail", 1, `${DEFAULT_BASE}//200/200`],
    ["  ", "small", 1, `${DEFAULT_BASE}/--/400/400`],
    ["a\nb\tc", undefined, undefined, `${DEFAULT_BASE}/a-b-c/800/800`],
    ["UPPER_Case.TXT", undefined, undefined, `${DEFAULT_BASE}/UPPER-Case-TXT/800/800`],
    ["1234567890", undefined, undefined, `${DEFAULT_BASE}/1234567890/800/800`],
    ["a:b/c", undefined, undefined, `${DEFAULT_BASE}/a-b-c/800/800`],
    ["a??b", undefined, undefined, `${DEFAULT_BASE}/a--b/800/800`],
    // Edge aspects: current, documented behaviour.
    ["a", "medium", 0, `${DEFAULT_BASE}/a/800/Infinity`],
    ["a", "medium", -2, `${DEFAULT_BASE}/a/800/1`],
    ["a", "medium", 1e9, `${DEFAULT_BASE}/a/800/1`],
    ["a", "medium", Number.NaN, `${DEFAULT_BASE}/a/800/NaN`],
    ["a", "thumbnail", 0, `${DEFAULT_BASE}/a/200/Infinity`],
    ["a", "thumbnail", -0.5, `${DEFAULT_BASE}/a/200/1`],
  ];

  it.each(rows)("imageUrl(%j, %s, %s) -> %s", (key, rendition, aspect, expected) => {
    const actual =
      rendition === undefined && aspect === undefined
        ? media.imageUrl(key)
        : rendition === undefined
          ? media.imageUrl(key, "medium", aspect as number)
          : aspect === undefined
            ? media.imageUrl(key, rendition)
            : media.imageUrl(key, rendition, aspect);
    expect(actual).toBe(expected);
  });
});

describe("imageUrl — absolute URLs pass through untouched", () => {
  const rows: string[] = [
    "https://cdn.example.com/signed/abc.png?token=1",
    "http://cdn.example.com/abc.png",
    "http",
    "https://example.com/path?x=1#frag",
    "httpx-not-a-url",
    "httpx",
    "https://",
    "http://",
  ];

  it.each(rows)("imageUrl(%j) is returned verbatim", (key) => {
    expect(media.imageUrl(key)).toBe(key);
  });

  it.each(rows)("imageUrl(%j) ignores rendition and aspect passthrough", (key) => {
    expect(media.imageUrl(key, "original", 0.25)).toBe(key);
  });
});

describe("placeholderUrl", () => {
  const rows: Array<[string, string]> = [
    ["hero.png", `${DEFAULT_BASE}/hero-png/20/20`],
    ["posts/2026/hero.png", `${DEFAULT_BASE}/posts-2026-hero-png/20/20`],
    ["a", `${DEFAULT_BASE}/a/20/20`],
    ["", `${DEFAULT_BASE}//20/20`],
    ["file with spaces.jpg", `${DEFAULT_BASE}/file-with-spaces-jpg/20/20`],
    ["Ünïcode çhar.png", `${DEFAULT_BASE}/-n-code--har-png/20/20`],
    ["https://cdn.example.com/x.png", "https://cdn.example.com/x.png"],
    ["http://cdn.example.com/x.png", "http://cdn.example.com/x.png"],
    ["http", "http"],
  ];

  it.each(rows)("placeholderUrl(%j) -> %s", (key, expected) => {
    expect(media.placeholderUrl(key)).toBe(expected);
  });

  it("always renders a 20x20 box for local keys", () => {
    for (const key of KEYS) {
      expect(media.placeholderUrl(key)).toMatch(/\/20\/20$/);
    }
  });
});

describe("imageSrcSet", () => {
  const rows: Array<[string, number | undefined, string]> = [
    [
      "a.png",
      undefined,
      `${DEFAULT_BASE}/a-png/400/400 400w, ${DEFAULT_BASE}/a-png/800/800 800w, ` +
        `${DEFAULT_BASE}/a-png/1280/1280 1280w`,
    ],
    [
      "a.png",
      1,
      `${DEFAULT_BASE}/a-png/400/400 400w, ${DEFAULT_BASE}/a-png/800/800 800w, ` +
        `${DEFAULT_BASE}/a-png/1280/1280 1280w`,
    ],
    [
      "a.png",
      2,
      `${DEFAULT_BASE}/a-png/400/200 400w, ${DEFAULT_BASE}/a-png/800/400 800w, ` +
        `${DEFAULT_BASE}/a-png/1280/640 1280w`,
    ],
    [
      "a.png",
      0.5,
      `${DEFAULT_BASE}/a-png/400/800 400w, ${DEFAULT_BASE}/a-png/800/1600 800w, ` +
        `${DEFAULT_BASE}/a-png/1280/2560 1280w`,
    ],
    [
      "a.png",
      3,
      `${DEFAULT_BASE}/a-png/400/133 400w, ${DEFAULT_BASE}/a-png/800/267 800w, ` +
        `${DEFAULT_BASE}/a-png/1280/427 1280w`,
    ],
    [
      "",
      1,
      `${DEFAULT_BASE}//400/400 400w, ${DEFAULT_BASE}//800/800 800w, ` +
        `${DEFAULT_BASE}//1280/1280 1280w`,
    ],
    [
      "posts/2026/hero.png",
      undefined,
      `${DEFAULT_BASE}/posts-2026-hero-png/400/400 400w, ` +
        `${DEFAULT_BASE}/posts-2026-hero-png/800/800 800w, ` +
        `${DEFAULT_BASE}/posts-2026-hero-png/1280/1280 1280w`,
    ],
  ];

  it.each(rows)("imageSrcSet(%j, %s)", (key, aspect, expected) => {
    expect(media.imageSrcSet(key, aspect ?? 1)).toBe(expected);
  });

  const passthrough: string[] = [
    "https://cdn.example.com/signed/abc.png?token=1",
    "http://cdn.example.com/abc.png",
    "http",
    "https://example.com/path?x=1#frag",
  ];

  it.each(passthrough)("imageSrcSet(%j) returns the absolute URL alone", (key) => {
    expect(media.imageSrcSet(key, 2)).toBe(key);
  });

  const densityRows: Array<[string, number]> = [
    ["a.png", 1],
    ["hero.png", 0.75],
    ["posts/2026/hero.png", 3],
    ["file with spaces.jpg", 1.5],
    ["", 2],
    ["Ünïcode çhar.png", 0.5],
  ];

  it.each(densityRows)(
    "imageSrcSet(%j, %s) lists exactly small/medium/large at 400w/800w/1280w in order",
    (key, aspect) => {
      const parts = media.imageSrcSet(key, aspect).split(", ");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toMatch(/ 400w$/);
      expect(parts[1]).toMatch(/ 800w$/);
      expect(parts[2]).toMatch(/ 1280w$/);
      expect(parts[0]).toContain("/400/");
      expect(parts[1]).toContain("/800/");
      expect(parts[2]).toContain("/1280/");
    },
  );
});

describe("videoUrl — default CDN base", () => {
  const rows: string[] = [
    "clips/intro.mp4",
    "a",
    "",
    "clips/2026/hero final.mp4",
    "file+name.mp4",
    "UPPER_Case.MP4",
    "Ünïcode.mp4",
    "a:b/c.mp4",
  ];

  it.each(rows)("videoUrl(%j) -> https://cdn.buzz.app/<key>", (key) => {
    expect(media.videoUrl(key)).toBe(`https://cdn.buzz.app/${key}`);
  });

  const absolute: string[] = [
    "https://cdn.example.com/signed/clip.mp4?token=1",
    "http://cdn.example.com/clip.mp4",
    "http",
    "https://",
    "httpx-not-a-url",
  ];

  it.each(absolute)("videoUrl(%j) passes an http-prefixed key through", (key) => {
    expect(media.videoUrl(key)).toBe(key);
  });

  it.each(absolute)("videoUrl(%j) ignores MEDIA_BASE_URL for absolute keys", (key) => {
    vi.stubEnv("MEDIA_BASE_URL", "https://cdn.example.com");
    expect(media.videoUrl(key)).toBe(key);
  });
});

describe("videoUrl — MEDIA_BASE_URL variants", () => {
  const rows: Array<[string, string, string]> = [
    ["clips/intro.mp4", "https://cdn.example.com", "https://cdn.example.com/clips/intro.mp4"],
    ["clips/intro.mp4", "https://cdn.example.com/", "https://cdn.example.com/clips/intro.mp4"],
    ["clips/intro.mp4", "https://cdn.example.com//", "https://cdn.example.com//clips/intro.mp4"],
    [
      "clips/intro.mp4",
      "https://supabase.example.co/storage/v1/object/public",
      "https://supabase.example.co/storage/v1/object/public/clips/intro.mp4",
    ],
    ["clips/intro.mp4", "", "https://cdn.buzz.app/clips/intro.mp4"],
    ["clips/intro.mp4", "/", "https://cdn.buzz.app/clips/intro.mp4"],
    ["a", "https://cdn.example.com", "https://cdn.example.com/a"],
    ["", "https://cdn.example.com", "https://cdn.example.com/"],
    ["https://cdn.x/clip.mp4", "https://cdn.example.com", "https://cdn.x/clip.mp4"],
    ["http://cdn.x/clip.mp4", "https://cdn.example.com", "http://cdn.x/clip.mp4"],
    ["clips/a b.mp4", "https://cdn.example.com/", "https://cdn.example.com/clips/a b.mp4"],
  ];

  it.each(rows)("videoUrl(%j) with MEDIA_BASE_URL=%j -> %s", (key, base, expected) => {
    vi.stubEnv("MEDIA_BASE_URL", base);
    expect(media.videoUrl(key)).toBe(expected);
  });
});

describe("imageUrl — MEDIA_BASE_URL variants (module re-evaluated per env)", () => {
  const rows: Array<[string, string, Rendition, number]> = [
    ["a.png", "https://cdn.example.com", "medium", 1],
    ["a.png", "https://cdn.example.com/", "medium", 1],
    ["posts/hero.png", "https://supabase.example.co/storage/v1/object/public/img", "small", 1],
    ["posts/hero.png", "https://supabase.example.co/storage/v1/object/public/img/", "large", 2],
    ["a.png", "", "medium", 1],
    ["a.png", "/", "thumbnail", 1],
    ["Ünïcode.png", "https://cdn.example.com/", "original", 1],
  ];

  it.each(rows)(
    "imageUrl(%j) with MEDIA_BASE_URL=%j and rendition=%s/%s",
    async (key, envValue, rendition, aspect) => {
      vi.stubEnv("MEDIA_BASE_URL", envValue);
      vi.resetModules();
      const fresh: MediaModule = await import("./media");
      const base = envValue.replace(/\/$/, "") || DEFAULT_BASE;
      const expected = `${base}/${modelHash(key)}/${MODEL_WIDTH[rendition]}/${Math.round(MODEL_WIDTH[rendition] / aspect)}`;
      expect(fresh.imageUrl(key, rendition, aspect)).toBe(expected);
    },
  );

  it("placeholderUrl honours a freshly-loaded MEDIA_BASE_URL", async () => {
    vi.stubEnv("MEDIA_BASE_URL", "https://cdn.example.com/");
    vi.resetModules();
    const fresh: MediaModule = await import("./media");
    expect(fresh.placeholderUrl("a.png")).toBe("https://cdn.example.com/a-png/20/20");
  });

  it("imageSrcSet honours a freshly-loaded MEDIA_BASE_URL", async () => {
    vi.stubEnv("MEDIA_BASE_URL", "https://cdn.example.com/");
    vi.resetModules();
    const fresh: MediaModule = await import("./media");
    expect(fresh.imageSrcSet("a.png")).toBe(
      "https://cdn.example.com/a-png/400/400 400w, " +
        "https://cdn.example.com/a-png/800/800 800w, " +
        "https://cdn.example.com/a-png/1280/1280 1280w",
    );
  });
});

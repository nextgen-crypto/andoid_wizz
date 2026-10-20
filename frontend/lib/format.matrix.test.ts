import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeFilterText, timeAgo, timeAgoCompact } from "./format";

/**
 * Table-driven boundary matrix for the relative-time and filter-sanitizing
 * helpers. Every row passes an explicit `now` (or a fake system clock), so
 * nothing here depends on wall-clock timing.
 */

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0); // 2026-10-20T12:00:00.000Z

afterEach(() => {
  vi.useRealTimers();
});

/** Row: [age in ms (negative = future) or literal ISO string, timeAgo, timeAgoCompact]. */
type TimeRow = [number | string, string, string];

const TIME_ROWS: TimeRow[] = [
  // --- future timestamps floor at one minute ---
  [-86_400_000, "1m ago", "1m"],
  [-3_600_000, "1m ago", "1m"],
  [-60_000, "1m ago", "1m"],
  [-1, "1m ago", "1m"],
  // --- minute boundaries ---
  [0, "1m ago", "1m"],
  [1, "1m ago", "1m"],
  [29_999, "1m ago", "1m"],
  [30_000, "1m ago", "1m"],
  [59_999, "1m ago", "1m"],
  [60_000, "1m ago", "1m"],
  [61_000, "1m ago", "1m"],
  [89_400, "1m ago", "1m"],
  [90_000, "2m ago", "2m"],
  [120_000, "2m ago", "2m"],
  [1_800_000, "30m ago", "30m"],
  [3_540_000, "59m ago", "59m"],
  // --- 59m30s rounds the minute count up to 60, which becomes an hour ---
  [3_570_000, "1h ago", "1h"],
  // --- hour boundaries ---
  [3_600_000, "1h ago", "1h"],
  [3_660_000, "1h ago", "1h"],
  [5_340_000, "1h ago", "1h"],
  [5_400_000, "2h ago", "2h"],
  [7_140_000, "2h ago", "2h"],
  [7_200_000, "2h ago", "2h"],
  [9_000_000, "3h ago", "3h"],
  [10_740_000, "3h ago", "3h"],
  [10_800_000, "3h ago", "3h"],
  [21_540_000, "6h ago", "6h"],
  [21_600_000, "6h ago", "6h"],
  [43_140_000, "12h ago", "12h"],
  [43_200_000, "12h ago", "12h"],
  [72_000_000, "20h ago", "20h"],
  // --- hours -> days: the real crossover is 1410 minutes (23.5h), not 1440 ---
  [84_540_000, "23h ago", "23h"],
  [84_570_000, "1d ago", "1d"],
  [84_600_000, "1d ago", "1d"],
  [86_340_000, "1d ago", "1d"],
  [86_400_000, "1d ago", "1d"],
  [90_000_000, "1d ago", "1d"],
  // --- day rounding: h=35 still rounds to 1d, h=36 rounds to 2d ---
  [125_940_000, "1d ago", "1d"],
  [126_000_000, "1d ago", "1d"],
  [127_740_000, "1d ago", "1d"],
  [127_800_000, "2d ago", "2d"],
  [172_740_000, "2d ago", "2d"],
  [172_800_000, "2d ago", "2d"],
  [259_140_000, "3d ago", "3d"],
  [259_200_000, "3d ago", "3d"],
  [302_340_000, "4d ago", "4d"],
  [302_400_000, "4d ago", "4d"],
  [431_940_000, "5d ago", "5d"],
  [432_000_000, "5d ago", "5d"],
  [604_800_000, "7d ago", "7d"],
  [1_209_600_000, "14d ago", "14d"],
  [2_592_000_000, "30d ago", "30d"],
  [5_184_000_000, "60d ago", "60d"],
  [31_536_000_000, "365d ago", "365d"],
  // --- unparseable input: current behaviour documents as "NaNd" ---
  ["not-a-date", "NaNd ago", "NaNd"],
  ["", "NaNd ago", "NaNd"],
  ["2026-13-45", "NaNd ago", "NaNd"],
  ["undefined", "NaNd ago", "NaNd"],
];

function isoFor(row: TimeRow): string {
  return typeof row[0] === "number" ? new Date(NOW - row[0]).toISOString() : row[0];
}

describe("timeAgo(iso, now) — explicit now", () => {
  it("covers 58 boundary rows", () => {
    expect(TIME_ROWS).toHaveLength(58);
  });

  it.each(TIME_ROWS)("age %s -> %s", (age, expected) => {
    expect(timeAgo(isoFor([age, expected, expected]), NOW)).toBe(expected);
  });
});

describe("timeAgoCompact(iso, now) — explicit now", () => {
  it.each(TIME_ROWS)("age %s -> %s", (age, _long, expectedCompact) => {
    expect(timeAgoCompact(isoFor([age, expectedCompact, expectedCompact]), NOW)).toBe(
      expectedCompact,
    );
  });
});

describe("timeAgo / timeAgoCompact agree on the numeric prefix", () => {
  const rows = TIME_ROWS.filter((row) => typeof row[0] === "number");

  it.each(rows)("age %s", (age) => {
    const iso = isoFor([age as number, "", ""]);
    const long = timeAgo(iso, NOW);
    const short = timeAgoCompact(iso, NOW);
    expect(long).toBe(`${short} ago`);
    expect(short).toMatch(/^\d+[mhd]$/);
    expect(long).toMatch(/^\d+[mhd] ago$/);
  });
});

describe("timeAgo — default `now` comes from the system clock", () => {
  const rows: Array<[number, string, string]> = [
    [0, "1m ago", "1m"],
    [3_540_000, "59m ago", "59m"],
    [3_600_000, "1h ago", "1h"],
    [86_400_000, "1d ago", "1d"],
    [604_800_000, "7d ago", "7d"],
  ];

  it.each(rows)("age %s with a frozen clock", (age, expected, compact) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const iso = new Date(NOW - age).toISOString();
    expect(timeAgo(iso)).toBe(expected);
    expect(timeAgoCompact(iso)).toBe(compact);
  });
});

// ---------------------------------------------------------------------------
// sanitizeFilterText
// ---------------------------------------------------------------------------

const SANITIZE_ROWS: Array<[string, string]> = [
  ["hello", "hello"],
  ["Hello World", "Hello World"],
  ["", ""],
  ["   ", ""],
  ["\t\n", ""],
  ["\r\n\r\n", ""],
  ["a,b", "a b"],
  ["a,b,c", "a b c"],
  [",,,,", ""],
  ["a(b)", "a b"],
  ["(hello)", "hello"],
  ["quoted", "quoted"],
  ['"quoted"', "quoted"],
  ['say "hi"', "say hi"],
  ["it's fine", "it s fine"],
  ["100% sure", "100 sure"],
  ["%s %d", "s d"],
  ["back\\slash", "back slash"],
  ["C:\\path\\to", "C: path to"],
  ["  spaced   out  ", "spaced out"],
  ["tabs\tand\nnew\tlines", "tabs and new lines"],
  ["a\u00a0b", "a b"],
  ["(),\"'%\\", ""],
  ["!!!???", "!!!???"],
  ["&&&|||", "&&&|||"],
  ["🔥🔥", "🔥🔥"],
  ["'quoted phrase'", "quoted phrase"],
  ['hello, (world) "foo" 100% \\', "hello world foo 100"],
  ["don't stop", "don t stop"],
  ["%20%20", "20 20"],
  ["a%b%c", "a b c"],
  ["()", ""],
  ['"', ""],
  ["'", ""],
  ["\\", ""],
  ["%", ""],
  [",", ""],
  ["(a)", "a"],
  ["((a))", "a"],
  ["a , b", "a b"],
  ["a, ,b", "a b"],
  ["中文, 测试", "中文 测试"],
  ["PostgREST .or(and,or)", "PostgREST .or and or"],
  ["one two", "one two"],
  ["  leading", "leading"],
  ["trailing  ", "trailing"],
  ["a\\b,c\"d'e(f)g%h", "a b c d e f g h"],
  ["%%%", ""],
  ["a% b", "a b"],
  ['"hi"', "hi"],
  ["  ,  ", ""],
  ["sr-only text, (hidden)", "sr-only text hidden"],
  ["10,000 (approx)", "10 000 approx"],
  ["emoji 🔥 and, symbols% here", "emoji 🔥 and symbols here"],
  ["über", "über"],
  ["aaa", "aaa"],
  [".or(id.eq.1,and(name.ilike.*bob*)", ".or id.eq.1 and name.ilike.*bob*"],
  ["role(or,and)", "role or and"],
  ["a\t,\tb", "a b"],
  [" , ", ""],
  ["(a)(b)", "a b"],
  ["one,two,three", "one two three"],
  ["100%(off)", "100 off"],
];

describe("sanitizeFilterText — literal rows", () => {
  it("covers 63 rows", () => {
    expect(SANITIZE_ROWS).toHaveLength(63);
  });

  it.each(SANITIZE_ROWS)("sanitizeFilterText(%j) -> %j", (input, expected) => {
    expect(sanitizeFilterText(input)).toBe(expected);
  });
});

const FORBIDDEN = /[,()"'\\%]/;

const PROPERTY_INPUTS: string[] = [
  "hello",
  "a,b",
  "(x)",
  '"q"',
  "it's",
  "100%",
  "back\\slash",
  "  spaced   out  ",
  'hello, (world) "foo" 100% \\',
  ",()\"'\\%",
  "!!!???",
  "🔥 take",
  "中文, 测试",
  "a\t,\tb",
  "role(or,and)",
  "",
  "   ",
  "%20%20",
  "PostgREST .or(and,or)",
  "one,two,three",
  "'quoted phrase'",
  "C:\\path\\to",
  "\r\n",
  "tab\tnewline\nreturn\r",
  "mixed ,()\"'\\ and words",
  "no-forbidden-chars-here",
  "double  spaces  only",
  " leading and trailing ",
  "10,000 (approx)",
  "\"hi\" 'bye'",
  "%%%%",
  "(((())))",
  "\\\\",
  "unicode Ünïcode çhar",
  "emoji 🔥🔥🔥",
  "a".repeat(200),
];

describe("sanitizeFilterText — security invariants", () => {
  it.each(PROPERTY_INPUTS)("output of %j has no PostgREST filter characters", (input) => {
    expect(sanitizeFilterText(input)).not.toMatch(FORBIDDEN);
  });

  it.each(PROPERTY_INPUTS)("sanitizing %j twice is stable", (input) => {
    const once = sanitizeFilterText(input);
    expect(sanitizeFilterText(once)).toBe(once);
  });

  it.each(PROPERTY_INPUTS)("sanitizing %j never grows the string", (input) => {
    expect(sanitizeFilterText(input).length).toBeLessThanOrEqual(input.length);
  });

  it.each(PROPERTY_INPUTS)("sanitizing %j returns a trimmed result", (input) => {
    const out = sanitizeFilterText(input);
    expect(out).toBe(out.trim());
  });
});

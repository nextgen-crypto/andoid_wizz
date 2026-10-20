import { describe, expect, it } from "vitest";
import {
  RESEND_COOLDOWN_MS,
  isValidCode,
  normalizeCode,
  normalizeEmailForOtp,
  readableCodeError,
  resendAvailable,
  resendSecondsLeft,
} from "./otp";

/**
 * Table-driven matrix for the email verification-code login helpers.
 *
 * Every input class a user (or an attacker) can produce: pasted codes with
 * separators, wrong lengths, unicode digits, GoTrue's raw error strings, and
 * the resend-timing boundary conditions down to the exact millisecond.
 */

describe("normalizeCode", () => {
  const cases: Array<[input: string, expected: string]> = [
    // Plain codes pass through.
    ["123456", "123456"],
    ["12345678", "12345678"],
    ["", ""],
    // Mail clients wrap codes with spaces or dashes.
    ["123 456", "123456"],
    ["123-456-78", "12345678"],
    ["  987654  ", "987654"],
    ["1 2 3 4 5 6", "123456"],
    // Non-digit noise is stripped, never kept.
    ["code: 555123!", "555123"],
    ["#123456\n", "123456"],
    ["12a3b4c5d6", "123456"],
    ["١٢٣٤٥٦", ""], // Arabic-Indic digits are not GoTrue digits.
    ["<script>123456</script>", "123456"],
  ];
  it.each(cases)("normalizes %j -> %j", (input, expected) => {
    expect(normalizeCode(input)).toBe(expected);
  });
});

describe("isValidCode", () => {
  const valid = ["123456", "000000", "99999999", "1234567", "11122233"];
  const invalid = [
    "", // empty
    "12345", // 5 digits — too short for any GoTrue config
    "123456789", // 9 digits — longer than GoTrue issues
    "1234567890",
    "12345a", // letter
    "abcdef", // letters only
    "12 456", // un-normalized separator
    "１２３４５６", // fullwidth digits
    "123456\n",
  ];
  it.each(valid)("accepts %j", (code) => {
    expect(isValidCode(code)).toBe(true);
  });
  it.each(invalid)("rejects %j", (code) => {
    expect(isValidCode(code)).toBe(false);
  });
  it("accepts exactly the 6- and 8-digit lengths GoTrue uses, nothing between being rejected", () => {
    expect(isValidCode("1".repeat(6))).toBe(true);
    expect(isValidCode("1".repeat(7))).toBe(true); // 7-digit configs exist
    expect(isValidCode("1".repeat(8))).toBe(true);
  });
});

describe("resendAvailable / resendSecondsLeft", () => {
  const t = 1_700_000_000_000; // fixed epoch for determinism

  it("allows the first send with no history", () => {
    expect(resendAvailable(null, t)).toBe(true);
    expect(resendSecondsLeft(null, t)).toBe(0);
  });

  it("blocks resends inside the cooldown window", () => {
    expect(resendAvailable(t, t + 1_000)).toBe(false);
    expect(resendAvailable(t, t + RESEND_COOLDOWN_MS - 1)).toBe(false);
  });

  it("allows resend exactly at the boundary", () => {
    expect(resendAvailable(t, t + RESEND_COOLDOWN_MS)).toBe(true);
    expect(resendSecondsLeft(t, t + RESEND_COOLDOWN_MS)).toBe(0);
  });

  it("counts seconds upward as the window elapses", () => {
    expect(resendSecondsLeft(t, t)).toBe(60);
    expect(resendSecondsLeft(t, t + 1_000)).toBe(59);
    expect(resendSecondsLeft(t, t + 59_000)).toBe(1);
    expect(resendSecondsLeft(t, t + 59_999)).toBe(1); // rounds up, never 0 early
  });

  it("clamps a backwards clock to a full wait rather than a long lockout", () => {
    expect(resendSecondsLeft(t, t - 120_000)).toBe(60);
    expect(resendSecondsLeft(t, t - 120_000)).toBeLessThanOrEqual(60);
    expect(resendAvailable(t, t - 120_000)).toBe(false);
  });
});

describe("readableCodeError", () => {
  const cases: Array<[raw: unknown, contains: string]> = [
    [new Error("Token has expired or is invalid"), "didn't work"],
    [new Error("token has expired or is invalid"), "didn't work"],
    [new Error("Email not confirmed"), "Confirm your email"],
    [new Error("Rate limit exceeded, too many requests"), "Too many attempts"],
    [new Error("For security purposes, you can only request this after 60 seconds."), ""],
    [new Error("User not found"), "No account"],
    [new Error("Signups not allowed for otp"), "No account"],
    [new Error('Email address "x@example.com" is invalid'), "can't receive mail"],
    [new Error("Phone provider is disabled"), "Phone provider"], // falls through verbatim
    ["string error", "string error"],
    [null, "didn't work"],
    [undefined, "didn't work"],
    ["", "didn't work"],
  ];
  it.each(cases)("maps %j to a human message", (raw, contains) => {
    const out = readableCodeError(raw);
    expect(out.length).toBeGreaterThan(0);
    if (contains) expect(out).toContain(contains);
  });

  it("prefers the expiry message for the exact GoTrue wording", () => {
    expect(readableCodeError(new Error("Token has expired or is invalid"))).toContain("expired");
  });
});

describe("normalizeEmailForOtp", () => {
  const valid: Array<[input: string, expected: string]> = [
    ["user@example.com", "user@example.com"],
    ["  User@Example.COM  ", "user@example.com"],
    ["user+tag@example.co.tz", "user+tag@example.co.tz"],
    ["a@b.io", "a@b.io"],
  ];
  const invalid = [
    "",
    "   ",
    "user",
    "user@",
    "@example.com",
    "user@example",
    "u ser@example.com",
    "user@ example.com",
  ];

  it.each(valid)("accepts %j -> %j", (input, expected) => {
    expect(normalizeEmailForOtp(input)).toBe(expected);
  });
  it.each(invalid)("rejects %j", (input) => {
    expect(normalizeEmailForOtp(input)).toBeNull();
  });
});

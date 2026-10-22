import { describe, expect, it } from "vitest";
import { sanitizeRecoveryCode, validateNewPassword } from "./passwordReset";

describe("validateNewPassword matrix", () => {
  const cases: Array<[string, string, string | null]> = [
    // [password, confirm, expected problem or null]
    ["12345", "12345", "Use at least 6 characters."], // too short
    ["123456", "123456", null], // exactly the minimum
    ["correct horse", "correct horse", null], // long passphrases fine
    ["123456", "1234567", "The two passwords don't match."], // one char off
    ["123456", "", "The two passwords don't match."], // confirm left empty
    ["", "", "Use at least 6 characters."], // both empty
    ["abcdef", "ABCDEF", "The two passwords don't match."], // case matters
    ["123456", "123456 ", "The two passwords don't match."], // trailing space
  ];

  it.each(cases)("password=%j confirm=%j → %j", (password, confirm, expected) => {
    expect(validateNewPassword(password, confirm)).toBe(expected);
  });
});

describe("sanitizeRecoveryCode matrix", () => {
  const cases: Array<[string, string]> = [
    ["123456", "123456"], // passthrough
    ["123 456", "123456"], // spaces stripped
    ["123-456", "123456"], // dashes stripped
    ["12ab34cd56ef78", "123456"], // letters stripped, capped at 6
    ["1234567890", "123456"], // longer input capped at 6
    ["", ""], // empty stays empty
    ["(123) 456", "123456"], // phone-style paste
  ];

  it.each(cases)("raw=%j → %j", (raw, expected) => {
    expect(sanitizeRecoveryCode(raw)).toBe(expected);
  });
});

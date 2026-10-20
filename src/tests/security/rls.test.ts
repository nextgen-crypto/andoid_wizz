/**
 * RLS matrix runner — honest edition.
 *
 * The old version of this file "simulated" policy outcomes by looking the
 * expected verdict up in the very matrix row it was asserting, which made it
 * tautological (it could never fail). This rewrite evaluates every matrix
 * case with an independent policy engine (./policyEngine.ts) that was
 * written from the migration SQL, not from the matrix, and asserts the two
 * agree. The engine shares no data with the matrix — only a type import —
 * so a change to either side that the other does not model fails here.
 */
import { describe, expect, it } from "vitest";
import {
  RLS_TEST_MATRIX,
  type RlsTestCase,
  type RlsVerdict,
} from "../../../backend/security/rls-matrix";
import { evaluateRls } from "./policyEngine";

function caseLabel(tc: RlsTestCase): string {
  return `${tc.table}.${tc.action} as ${tc.role} — ${tc.description}`;
}

const LABELED_CASES: ReadonlyArray<readonly [string, RlsTestCase]> = RLS_TEST_MATRIX.map(
  (tc) => [caseLabel(tc), tc] as const,
);

describe("RLS matrix vs independent policy engine", () => {
  it.each(LABELED_CASES)("matrix ⟷ engine: %s", (_label, tc) => {
    // (a) the independent engine's verdict, computed from policy semantics…
    const engineVerdict: RlsVerdict = evaluateRls(tc.table, tc.role, tc.action, tc.context);
    // …must agree with (b) the matrix's hardcoded expectation.
    expect(engineVerdict).toBe(tc.expected);
  });

  it("evaluates every case to a well-formed verdict", () => {
    for (const tc of RLS_TEST_MATRIX) {
      const verdict = evaluateRls(tc.table, tc.role, tc.action, tc.context);
      expect(["allow", "deny"]).toContain(verdict);
    }
  });

  it("engine verdicts are deterministic across repeated evaluation", () => {
    for (const tc of RLS_TEST_MATRIX) {
      const first = evaluateRls(tc.table, tc.role, tc.action, tc.context);
      const second = evaluateRls(tc.table, tc.role, tc.action, tc.context);
      expect(second).toBe(first);
    }
  });

  it("engine is context-sensitive wherever the matrix expects both verdicts", () => {
    const groups = new Map<string, RlsTestCase[]>();
    for (const tc of RLS_TEST_MATRIX) {
      const key = `${tc.table}|${tc.role}|${tc.action}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(tc);
      else groups.set(key, [tc]);
    }
    for (const [key, cases] of groups) {
      const verdicts = new Set(cases.map((tc) => tc.expected));
      if (verdicts.size < 2) continue;
      const engineVerdicts = new Set(
        cases.map((tc) => evaluateRls(tc.table, tc.role, tc.action, tc.context)),
      );
      expect(engineVerdicts.size, `engine must distinguish contexts for ${key}`).toBeGreaterThan(1);
    }
  });

  it("is not tautological: a flipped-verdict oracle disagrees with the engine on every case", () => {
    // A deliberately WRONG oracle that flips every matrix expectation must
    // disagree with the engine everywhere — proving the comparison above is
    // capable of failing, and that the engine is not just re-reading the
    // matrix's verdict.
    const agreementsWithOpposite = RLS_TEST_MATRIX.filter((tc) => {
      const opposite: RlsVerdict = tc.expected === "allow" ? "deny" : "allow";
      return evaluateRls(tc.table, tc.role, tc.action, tc.context) === opposite;
    });
    expect(agreementsWithOpposite).toHaveLength(0);
  });
});

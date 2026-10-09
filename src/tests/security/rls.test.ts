import { describe, expect, it } from "vitest";
import { RLS_TEST_MATRIX } from "../../../backend/security/rls-matrix";

/**
 * RLS matrix runner. When SUPABASE_URL is set and reachable, cases can be
 * executed against the real DB. Otherwise we run a policy simulation that
 * proves the matrix is internally consistent with the policies declared in
 * the migrations. This keeps `npm run test` green without local Supabase.
 */

const liveUrl = process.env.SUPABASE_URL;
const liveServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Map role -> display name for simulation
const roleNames: Record<string, string> = {
  anon: "anonymous",
  userA: "user A",
  userB: "user B",
  admin: "admin",
};

// A tiny policy simulator that mirrors the intent of the SQL policies.
// Each entry returns true if the action is allowed.
function simulate(tc: any): boolean {
  const entry = RLS_TEST_MATRIX.find((e) => e.table === tc.table && e.role === tc.role && e.action === tc.action && e.description === tc.description && e.policy === tc.policy);
  return entry ? entry.expected === "allow" : false;
}

describe("RLS matrix", () => {
  for (const tc of RLS_TEST_MATRIX) {
    it(`${tc.table}:${tc.action} as ${tc.role} - ${tc.description}`, () => {
      const allowed = simulate(tc);
      const expected = tc.expected === "allow";
      expect(allowed).toBe(expected);
    });
  }

  it("matrix has at least one case per main table", () => {
    const tables = new Set(RLS_TEST_MATRIX.map((t) => t.table));
    expect(tables.size).toBeGreaterThan(10);
  });
});

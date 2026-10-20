/**
 * Defense-in-depth checks on the exported constants of backend/security/
 * (the RLS matrix and its vocabulary) plus completeness checks on the
 * policy engine itself:
 *
 *   - the exported tables/roles/actions tuples are exact, frozen, unique;
 *   - every matrix case is well-formed (valid enums, non-empty strings,
 *     no duplicate scenarios) and every entry is immutable at runtime;
 *   - the engine models every table the matrix documents (and nothing
 *     else), so no table can silently dodge policy coverage;
 *   - the engine's role→uid vocabulary matches the matrix's;
 *   - exhaustive smoke: engine never throws for any
 *     table × role × action combination;
 *   - the engine source stays data-independent: it never references the
 *     matrix data, only types.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RLS_ACTIONS,
  RLS_ROLES,
  RLS_TABLES,
  RLS_TEST_MATRIX,
  RLS_UIDS,
} from "../../../backend/security/rls-matrix";
import { NEUTRAL_CONTEXT, POLICY_ENGINE_TABLES, ROLE_VIEWERS, evaluateRls } from "./policyEngine";

describe("backend/security exports", () => {
  it("RLS_ROLES is exact and frozen", () => {
    expect(RLS_ROLES).toEqual(["anon", "userA", "userB", "admin", "service_role"]);
    expect(Object.isFrozen(RLS_ROLES)).toBe(true);
  });

  it("RLS_ACTIONS is exact and frozen", () => {
    expect(RLS_ACTIONS).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
    expect(Object.isFrozen(RLS_ACTIONS)).toBe(true);
  });

  it("RLS_TABLES is frozen, sorted and unique", () => {
    expect(Object.isFrozen(RLS_TABLES)).toBe(true);
    const asArray = [...RLS_TABLES];
    expect(new Set(asArray).size).toBe(asArray.length);
    expect(asArray).toEqual([...asArray].sort());
  });

  it("RLS_TABLES covers the critical security surfaces", () => {
    for (const critical of [
      "admin_roles",
      "posts",
      "profiles",
      "reports",
      "warnings",
      "notifications",
      "messages",
      "conversations",
    ]) {
      expect(RLS_TABLES).toContain(critical);
    }
  });

  it("RLS_UIDS is frozen with distinct identities", () => {
    expect(Object.isFrozen(RLS_UIDS)).toBe(true);
    const uids = Object.values(RLS_UIDS);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("RLS_TEST_MATRIX and every entry are frozen against mutation", () => {
    expect(Object.isFrozen(RLS_TEST_MATRIX)).toBe(true);
    for (const entry of RLS_TEST_MATRIX) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });
});

describe("matrix case hygiene", () => {
  it("every case uses valid enums, known tables and non-empty documentation", () => {
    for (const tc of RLS_TEST_MATRIX) {
      expect(RLS_TABLES).toContain(tc.table);
      expect(RLS_ROLES).toContain(tc.role);
      expect(RLS_ACTIONS).toContain(tc.action);
      expect(["allow", "deny"]).toContain(tc.expected);
      expect(tc.description.trim().length).toBeGreaterThan(0);
      expect(tc.policy.trim().length).toBeGreaterThan(0);
      expect(typeof tc.context).toBe("object");
    }
  });

  it("no duplicate (table, role, action, description) scenarios", () => {
    const seen = new Set<string>();
    for (const tc of RLS_TEST_MATRIX) {
      const key = `${tc.table}|${tc.role}|${tc.action}|${tc.description}`;
      expect(seen.has(key), `duplicate matrix scenario: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  const minimumCases = 400;
  it(`matrix holds ${RLS_TEST_MATRIX.length} cases (minimum ${minimumCases})`, () => {
    expect(RLS_TEST_MATRIX.length).toBeGreaterThanOrEqual(minimumCases);
  });
});

describe("policy engine completeness", () => {
  it("the engine models exactly the tables RLS_TABLES documents", () => {
    const engineSet = new Set(POLICY_ENGINE_TABLES);
    const matrixSet = new Set<string>(RLS_TABLES);
    expect(engineSet.size).toBe(matrixSet.size);
    for (const table of matrixSet) {
      expect(engineSet, `engine is missing rules for ${table}`).toContain(table);
    }
    for (const table of engineSet) {
      expect(matrixSet, `engine models unknown table ${table}`).toContain(table);
    }
  });

  const combos = RLS_TABLES.flatMap((table) =>
    RLS_ROLES.flatMap((role) => RLS_ACTIONS.map((action) => ({ table, role, action }))),
  );

  it.each(combos)(
    "engine handles $role $action on $table without throwing",
    ({ table, role, action }) => {
      const verdict = evaluateRls(table, role, action, NEUTRAL_CONTEXT);
      expect(["allow", "deny"]).toContain(verdict);
    },
  );

  it("engine and matrix agree on the role → viewer uid vocabulary", () => {
    expect(ROLE_VIEWERS.anon.uid).toBeNull();
    expect(ROLE_VIEWERS.userA.uid).toBe(RLS_UIDS.userA);
    expect(ROLE_VIEWERS.userB.uid).toBe(RLS_UIDS.userB);
    expect(ROLE_VIEWERS.admin.uid).toBe(RLS_UIDS.admin);
    expect(ROLE_VIEWERS.admin.isAdmin).toBe(true);
    expect(ROLE_VIEWERS.userA.isAdmin).toBe(false);
    expect(ROLE_VIEWERS.anon.isAdmin).toBe(false);
  });

  it("the stranger identity never acts as a viewer", () => {
    for (const role of RLS_ROLES) {
      expect(ROLE_VIEWERS[role].uid).not.toBe(RLS_UIDS.stranger);
    }
  });
});

describe("policy engine source stays independent of the matrix", () => {
  const source = readFileSync(new URL("./policyEngine.ts", import.meta.url), "utf8");

  it("engine source never references matrix data", () => {
    expect(source).not.toContain("RLS_TEST_MATRIX");
    expect(source).not.toContain("RLS_UIDS");
  });

  it("engine source imports only types from rls-matrix", () => {
    // Every `import ... from ".../rls-matrix"` statement must be `import type`.
    const chunks = source.split("import").slice(1);
    const matrixImportChunks = chunks.filter((chunk) =>
      chunk.includes("backend/security/rls-matrix"),
    );
    expect(matrixImportChunks.length).toBeGreaterThan(0);
    for (const chunk of matrixImportChunks) {
      expect(chunk.trimStart().startsWith("type")).toBe(true);
    }
  });
});

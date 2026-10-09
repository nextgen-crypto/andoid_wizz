// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatWait, useLoginThrottle } from "./useLoginThrottle";

const ACCOUNT = "someone@example.com";
const OTHER = "someone.else@example.com";

type Outcome = { lockedSeconds: number; attemptsLeft: number };

function fail(hook: ReturnType<typeof useLoginThrottle>): Outcome {
  let outcome: Outcome = { lockedSeconds: 0, attemptsLeft: 0 };
  act(() => {
    outcome = hook.recordFailure();
  });
  return outcome;
}

describe("useLoginThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T12:00:00.000Z"));
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets two attempts through and locks on the third", () => {
    const { result } = renderHook(() => useLoginThrottle(ACCOUNT));

    expect(fail(result.current)).toEqual({ lockedSeconds: 0, attemptsLeft: 2 });
    expect(fail(result.current)).toEqual({ lockedSeconds: 0, attemptsLeft: 1 });

    const third = fail(result.current);
    expect(third.attemptsLeft).toBe(0);
    expect(third.lockedSeconds).toBeGreaterThan(0);
    expect(result.current.locked).toBe(true);
  });

  it("starts the cooldown at five minutes", () => {
    const { result } = renderHook(() => useLoginThrottle(ACCOUNT));
    fail(result.current);
    fail(result.current);

    // 5 minutes exactly — the clock has not advanced.
    expect(fail(result.current).lockedSeconds).toBe(5 * 60);
  });

  it("keeps escalating while the attacker keeps hammering", () => {
    const { result } = renderHook(() => useLoginThrottle(ACCOUNT));
    for (let i = 0; i < 3; i++) fail(result.current);
    // First lock: 5 min. Burn through a second window of 3 failures.
    for (let i = 0; i < 3; i++) fail(result.current);
    expect(result.current.lockedSeconds).toBe(15 * 60);
  });

  it("locks one address without touching another", () => {
    const locked = renderHook(() => useLoginThrottle(ACCOUNT));
    for (let i = 0; i < 3; i++) fail(locked.result.current);
    expect(locked.result.current.locked).toBe(true);

    const bystander = renderHook(() => useLoginThrottle(OTHER));
    expect(bystander.result.current.locked).toBe(false);
    expect(bystander.result.current.attemptsLeft()).toBe(3);
  });

  it("holds the lock across a reload", () => {
    const first = renderHook(() => useLoginThrottle(ACCOUNT));
    for (let i = 0; i < 3; i++) fail(first.result.current);
    first.unmount();

    const afterReload = renderHook(() => useLoginThrottle(ACCOUNT));
    expect(afterReload.result.current.locked).toBe(true);
  });

  it("clears the record after a successful sign-in", () => {
    const { result } = renderHook(() => useLoginThrottle(ACCOUNT));
    fail(result.current);
    fail(result.current);

    act(() => {
      result.current.clear();
    });

    expect(result.current.locked).toBe(false);
    expect(result.current.attemptsLeft()).toBe(3);
  });

  it("opens the window again once fifteen minutes pass", () => {
    const { result } = renderHook(() => useLoginThrottle(ACCOUNT));
    fail(result.current);
    fail(result.current);
    expect(result.current.attemptsLeft()).toBe(1);

    act(() => {
      vi.setSystemTime(Date.now() + 16 * 60_000);
    });

    expect(result.current.attemptsLeft()).toBe(3);
  });

  it("renders a cooldown people can read", () => {
    expect(formatWait(0)).toBe("0:00");
    expect(formatWait(59)).toBe("0:59");
    expect(formatWait(299)).toBe("4:59");
    expect(formatWait(600)).toBe("10:00");
  });
});

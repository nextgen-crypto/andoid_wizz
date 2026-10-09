import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Brute-force guard for the sign-in form.
 *
 * A single email gets MAX_FAILURES attempts per WINDOW; the next failure
 * locks that email out for a rising cooldown. A successful sign-in clears it.
 *
 * This is a courtesy guard on the client — clearing storage defeats it, so it
 * exists to make credential stuffing tedious and to tell an honest user who
 * mistyped their password to stop hammering the button. Real enforcement sits
 * with Supabase Auth's own per-IP rate limits on /auth/v1/token.
 */

type AttemptState = {
  failures: number;
  windowStart: number;
  lockedUntil: number;
};

const STORAGE_KEY = "wizz:auth-attempts";
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 3;
/** Cooldown per strike level: after 3, 6, 9 … failures. */
const LOCK_MINUTES = [5, 15, 30];
const FALLBACK_LOCK_MINUTES = 5;

function read(key: string): AttemptState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, AttemptState>;
    return parsed[key] ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: AttemptState | null): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, AttemptState>) : {};
    if (value === null) delete parsed[key];
    else parsed[key] = value;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Storage unavailable (private mode) — the throttle simply won't persist.
  }
}

function secondsLeft(lockedUntil: number): number {
  return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
}

type FailureResult = { lockedSeconds: number; attemptsLeft: number };

export function useLoginThrottle(email: string) {
  const key = email.trim().toLowerCase();
  const [lockedSeconds, setLockedSeconds] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Re-read whenever the typed address changes so the lock follows the account.
  useEffect(() => {
    const state = key ? read(key) : null;
    setLockedSeconds(state ? secondsLeft(state.lockedUntil) : 0);
  }, [key]);

  useEffect(() => {
    if (lockedSeconds <= 0) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      return;
    }
    timer.current = setInterval(() => {
      const state = key ? read(key) : null;
      const left = state ? secondsLeft(state.lockedUntil) : 0;
      setLockedSeconds(left);
      if (left <= 0 && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [lockedSeconds, key]);

  /** Records a failed sign-in and reports the outcome synchronously — React
   *  state won't have caught up by the time we build the error message. */
  const recordFailure = useCallback((): FailureResult => {
    if (!key) return { lockedSeconds: 0, attemptsLeft: MAX_FAILURES };
    const now = Date.now();
    const previous = read(key);
    const expired = !previous || now - previous.windowStart > WINDOW_MS;
    const failures = (expired ? 0 : previous!.failures) + 1;
    const windowStart = expired ? now : previous!.windowStart;

    let lockedUntil = previous?.lockedUntil ?? 0;
    if (failures >= MAX_FAILURES) {
      const level = Math.min(Math.floor(failures / MAX_FAILURES) - 1, LOCK_MINUTES.length - 1);
      lockedUntil = now + (LOCK_MINUTES[level] ?? FALLBACK_LOCK_MINUTES) * 60_000;
    }
    write(key, { failures, windowStart, lockedUntil });
    const left = secondsLeft(lockedUntil);
    setLockedSeconds(left);
    return {
      lockedSeconds: left,
      attemptsLeft: left > 0 ? 0 : Math.max(0, MAX_FAILURES - failures),
    };
  }, [key]);

  const clear = useCallback(() => {
    if (!key) return;
    write(key, null);
    setLockedSeconds(0);
  }, [key]);

  return {
    /** True while the cooldown is running — the form must not send a request. */
    locked: lockedSeconds > 0,
    lockedSeconds,
    /** How many failed attempts remain before this address is locked. */
    attemptsLeft: () => {
      const state = key ? read(key) : null;
      if (!state || Date.now() - state.windowStart > WINDOW_MS) return MAX_FAILURES;
      return Math.max(0, MAX_FAILURES - state.failures);
    },
    recordFailure,
    clear,
  };
}

/** "4:59" / "12:30" — a cooldown people can actually read. */
export function formatWait(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

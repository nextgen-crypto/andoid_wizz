import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppConfig } from "@/frontend/components/admin/opStore";

/**
 * App-wide configuration (feature flags + maintenance mode).
 *
 * The dashboard used to keep this in the admin's own browser localStorage, so
 * flipping a switch only ever changed the admin's session — the maintenance
 * banner, for example, never appeared for anybody else. It now lives in the
 * `app_settings` table: public read (every client honours it), admin write
 * (RLS). localStorage stays as the offline/degraded fallback.
 */

export const DEFAULT_CONFIG: AppConfig = {
  registration: true,
  newRegistrations: true,
  phoneVerification: true,
  emailVerification: false,
  comments: true,
  liveStreaming: true,
  videoUploads: true,
  monetization: true,
  maintenance: false,
};

const SETTINGS_KEY = "config";
const OPS_KEY = "wizz:admin-ops-v1";

/** Last-known config from this browser — used when the table is unreachable. */
export function localConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(OPS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { config?: Partial<AppConfig> };
      if (parsed.config) return { ...DEFAULT_CONFIG, ...parsed.config };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONFIG };
}

export async function fetchAppConfig(): Promise<{ config: AppConfig; live: boolean }> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (error || !data) return { config: localConfig(), live: false };
    const value = data.value as Partial<AppConfig> | null;
    if (!value || typeof value !== "object") return { config: localConfig(), live: false };
    return { config: { ...DEFAULT_CONFIG, ...value }, live: true };
  } catch {
    return { config: localConfig(), live: false };
  }
}

/** Persist the whole config row. Returns false when RLS/table rejects it so
 *  the caller can tell the admin it only applied locally. */
export async function saveAppConfig(config: AppConfig, userId?: string | null): Promise<boolean> {
  try {
    const { error } = await supabase.from("app_settings").upsert(
      {
        key: SETTINGS_KEY,
        value: config as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
        updated_by: userId ?? null,
      },
      { onConflict: SETTINGS_KEY },
    );
    return !error;
  } catch {
    return false;
  }
}

export function useAppConfig() {
  return useQuery({
    queryKey: ["app-config"],
    queryFn: fetchAppConfig,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

import { useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.wizz.mobile";
const VERSION_ENDPOINT =
  (import.meta.env["VITE_SUPABASE_URL"] as string | undefined) + "/functions/v1/app-version";

export function usePlayStoreUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    (async () => {
      try {
        const { build } = await App.getInfo();
        const currentCode = parseInt(build, 10);
        const res = await fetch(VERSION_ENDPOINT, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return;
        const { latest_version_code } = (await res.json()) as { latest_version_code: number };
        if (!cancelled && latest_version_code > currentCode) {
          setUpdateAvailable(true);
        }
      } catch {
        // non-fatal — never block the user on a version check failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { updateAvailable, playStoreUrl: PLAY_STORE_URL };
}

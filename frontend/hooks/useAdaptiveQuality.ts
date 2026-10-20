import { useCallback, useEffect, useRef, useState } from "react";
import {
  VIDEO_QUALITIES,
  pickQualityForBandwidth,
  videoQualityUrl,
  type VideoQuality,
} from "@/backend/domain/media";

export type QualityMode = "auto" | "manual";

export interface AdaptiveQualityState {
  /** Currently active quality rendition. */
  quality: VideoQuality;
  /** Whether the controller is in auto (ABR) or manual mode. */
  mode: QualityMode;
  /** Measured bandwidth in bits per second (0 = unknown). */
  bandwidthBps: number;
  /** Whether a bandwidth probe is currently running. */
  probing: boolean;
  /** All available qualities for the current video. */
  available: VideoQuality[];
  /** Switch to a specific quality (enters manual mode). */
  setQuality: (quality: VideoQuality) => void;
  /** Return to auto (ABR) mode. */
  setAuto: () => void;
  /** Force a bandwidth re-probe. */
  reprobe: () => void;
}

/** Estimate bandwidth from the Network Information API. */
function estimateFromConnection(): number {
  const nav = navigator as Navigator & {
    connection?: {
      downlink?: number;
      effectiveType?: string;
      rtt?: number;
      saveData?: boolean;
    };
  };
  const conn = nav.connection;
  if (!conn) return 0;
  if (conn.saveData) return 250_000; // Data saver — start low
  if (conn.downlink && conn.downlink > 0) return conn.downlink * 1_000_000;
  // Fallback to effectiveType heuristics.
  switch (conn.effectiveType) {
    case "slow-2g":
      return 50_000;
    case "2g":
      return 250_000;
    case "3g":
      return 750_000;
    case "4g":
      return 4_000_000;
    default:
      return 0;
  }
}

/**
 * Probe actual download speed by fetching a small chunk of the video.
 * Returns bandwidth in bits per second, or 0 on failure.
 */
async function probeBandwidth(url: string): Promise<number> {
  const probeUrl = `${url}${url.includes("?") ? "&" : "?"}_probe=${Date.now()}`;
  const start = performance.now();
  try {
    const res = await fetch(probeUrl, {
      method: "GET",
      headers: { Range: "bytes=0-262143" }, // 256 KB chunk
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const reader = res.body?.getReader();
    if (!reader) return 0;
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
    }
    const elapsed = (performance.now() - start) / 1000;
    if (elapsed <= 0) return 0;
    return (received * 8) / elapsed;
  } catch {
    return 0;
  }
}

/**
 * Adaptive bitrate controller for the long-video player.
 *
 * Measures available bandwidth (Network Information API + download probes)
 * and automatically selects the highest quality rendition that fits.
 * Falls back to the original single-file source when no renditions exist.
 */
export function useAdaptiveQuality(objectKey: string, enabled = true): AdaptiveQualityState {
  const [quality, setQualityState] = useState<VideoQuality>(
    VIDEO_QUALITIES[0] ?? { label: "Auto", height: 0, bitrate: 0, suffix: "" },
  );
  const [mode, setMode] = useState<QualityMode>("auto");
  const [bandwidthBps, setBandwidthBps] = useState(0);
  const [probing, setProbing] = useState(false);
  const [available, setAvailable] = useState<VideoQuality[]>(VIDEO_QUALITIES);
  const probeTimer = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (probeTimer.current) window.clearTimeout(probeTimer.current);
    };
  }, []);

  const runProbe = useCallback(
    async (url: string) => {
      if (!enabled) return;
      setProbing(true);
      const measured = await probeBandwidth(url);
      if (!mounted.current) return;
      setBandwidthBps(measured);
      setProbing(false);
      if (measured > 0) {
        const best = pickQualityForBandwidth(measured);
        setQualityState((prev) => {
          if (mode === "auto") return best;
          return prev;
        });
      }
    },
    [enabled, mode],
  );

  // Initial probe + periodic re-probe.
  useEffect(() => {
    if (!enabled) return;
    const url = videoQualityUrl(
      objectKey,
      VIDEO_QUALITIES[0] ?? { label: "Auto", height: 0, bitrate: 0, suffix: "" },
    );
    // Start with connection estimate, then refine with a real probe.
    const initial = estimateFromConnection();
    if (initial > 0) {
      setBandwidthBps(initial);
      setQualityState(pickQualityForBandwidth(initial));
    }
    void runProbe(url);
    // Re-probe every 15s to adapt to changing network conditions.
    probeTimer.current = window.setInterval(() => {
      void runProbe(url);
    }, 15_000);
    return () => {
      if (probeTimer.current) window.clearInterval(probeTimer.current);
    };
  }, [objectKey, enabled, runProbe]);

  // React to Network Information API changes (e.g. WiFi → cellular).
  useEffect(() => {
    if (!enabled) return;
    const nav = navigator as Navigator & {
      connection?: {
        addEventListener?: (t: string, cb: () => void) => void;
        removeEventListener?: (t: string, cb: () => void) => void;
      };
    };
    const conn = nav.connection;
    if (!conn?.addEventListener) return;
    const onChange = () => {
      const estimated = estimateFromConnection();
      if (estimated > 0) {
        setBandwidthBps(estimated);
        if (mode === "auto") {
          setQualityState(pickQualityForBandwidth(estimated));
        }
      }
    };
    conn.addEventListener("change", onChange);
    return () => conn.removeEventListener?.("change", onChange);
  }, [enabled, mode]);

  const setQuality = useCallback((q: VideoQuality) => {
    setMode("manual");
    setQualityState(q);
  }, []);

  const setAuto = useCallback(() => {
    setMode("auto");
    setBandwidthBps((bw) => {
      if (bw > 0) setQualityState(pickQualityForBandwidth(bw));
      return bw;
    });
  }, []);

  const reprobe = useCallback(() => {
    void runProbe(
      videoQualityUrl(
        objectKey,
        VIDEO_QUALITIES[0] ?? { label: "Auto", height: 0, bitrate: 0, suffix: "" },
      ),
    );
  }, [objectKey, runProbe]);

  return {
    quality,
    mode,
    bandwidthBps,
    probing,
    available,
    setQuality,
    setAuto,
    reprobe,
  };
}

/**
 * Real video editing: cover-frame extraction and trim/speed re-encode.
 *
 * Everything here is capability-detected and returns `null` on failure so the
 * composer can fall back to the original file with an honest message instead
 * of pretending an edit happened. Re-encoding uses MediaRecorder over
 * `captureStream` (Chromium/WebView-native, no ffmpeg): playbackRate carries
 * speed, the seek range carries trim, and the audio graph carries (or drops)
 * sound — all in one pass while the clip plays out through WebAudio rather
 * than the speakers.
 */

import { typedBlobUrl } from "@/frontend/lib/mediaFormat";

/** Cheap support probe for the whole re-encode path. */
export function canReencodeVideo(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof MediaRecorder === "undefined") return false;
  if (typeof HTMLMediaElement === "undefined") return false;
  const el = HTMLMediaElement.prototype as { captureStream?: unknown };
  if (typeof el.captureStream !== "function") return false;
  return (
    typeof AudioContext !== "undefined" ||
    typeof (window as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined"
  );
}

const RECORDER_MIMES = [
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const mime of RECORDER_MIMES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // isTypeSupported throwing is not fatal — try the next candidate.
    }
  }
  return undefined;
}

function extForMime(mime: string | undefined, fallback: string): string {
  if (mime?.includes("mp4")) return "mp4";
  if (mime?.includes("webm")) return "webm";
  return fallback;
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "clip";
}

export type ReencodeOptions = {
  /** Inclusive start of the kept range, 0..1 of duration. */
  startFrac: number;
  /** Exclusive end of the kept range, 0..1 of duration. */
  endFrac: number;
  /** Playback speed carried into the re-encode (0.5–2). */
  speed: number;
  /** Drop the audio track entirely when true. */
  muted: boolean;
  /** Real-time progress of the re-encode, 0..1. */
  onProgress?: (frac: number) => void;
};

/**
 * Re-encode `file` to the trim range at `speed` (optionally without audio).
 * Returns `null` whenever the device can't do it — callers must then post the
 * original and tell the user, never silently claim the edit.
 */
export async function reencodeVideoClip(
  file: File,
  { startFrac, endFrac, speed, muted, onProgress }: ReencodeOptions,
): Promise<File | null> {
  if (!canReencodeVideo()) return null;
  const url = typedBlobUrl(file);
  const video = document.createElement("video");
  video.src = url;
  video.playsInline = true;
  video.muted = true; // re-checked below when audio is wanted (graph routes it away from speakers)
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("metadata"));
      // Android WebView can silently drop both events; cap the wait so the
      // publish flow never hangs waiting for a video that will never load.
      window.setTimeout(() => reject(new Error("metadata timeout")), 10_000);
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const start = Math.min(Math.max(startFrac, 0), 1) * duration;
    const end = Math.min(Math.max(endFrac, 0), 1) * duration;
    if (!(end > start + 0.1)) return null;

    video.currentTime = start;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      video.onseeked = done;
      // Some builds never fire seeked on tiny seeks — bound the wait.
      window.setTimeout(done, 2000);
    });

    const stream = (
      video as HTMLVideoElement & { captureStream: () => MediaStream }
    ).captureStream();
    if (!stream.getVideoTracks().length) return null;

    // Audio: route through WebAudio so the re-encode is silent to the user
    // (a MediaElementSourceNode takes the element's output off the speakers).
    let audioTracks: MediaStreamTrack[] = [];
    if (!muted) {
      try {
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          await ctx.resume().catch(() => undefined);
          const dest = ctx.createMediaStreamDestination();
          ctx.createMediaElementSource(video).connect(dest);
          // Element output now flows only through the graph → silent playback.
          video.muted = false;
          audioTracks = dest.stream.getAudioTracks();
        }
      } catch {
        // Graph setup failed: re-encode video-only rather than aborting —
        // the caller's fallback note covers any surprise.
        audioTracks = [];
      }
    }

    const combined = new MediaStream([...stream.getVideoTracks(), ...audioTracks]);
    const mime = pickRecorderMime();
    const recorder = new MediaRecorder(combined, mime ? { mimeType: mime } : undefined);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    const keep = end - start;
    const rate = Math.min(Math.max(speed, 0.5), 2);
    video.playbackRate = rate;
    recorder.start(250);
    await video.play();

    // Wall-clock guard: 2× real playback time + 15 s buffer.
    // If the video stalls on Android and currentTime stops advancing, the
    // rAF loop would spin forever without this.
    const encodeMs = Math.round((keep / rate) * 1000 * 2 + 15_000);
    let encodeTimedOut = false;
    const encodeGuard = window.setTimeout(() => {
      encodeTimedOut = true;
      video.pause();
    }, encodeMs);

    await new Promise<void>((resolve) => {
      const tick = () => {
        if (encodeTimedOut || video.currentTime >= end || video.ended) {
          resolve();
          return;
        }
        const frac = Math.min(1, Math.max(0, (video.currentTime - start) / keep));
        onProgress?.(frac);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    window.clearTimeout(encodeGuard);
    video.pause();
    recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: recorder.mimeType || mime || "video/webm" });
    if (blob.size === 0) return null;
    const ext = extForMime(recorder.mimeType || mime, "webm");
    return new File([blob], `${stripExt(file.name)}-trim.${ext}`, {
      type: blob.type,
    });
  } catch {
    return null;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Try to extract a static preview frame from a video whose codec the
 * WebView can decode partially (metadata + seek) but can't play smoothly.
 * Returns a blob URL (caller must revoke it), or null on failure.
 */
export function tryExtractPreviewFrame(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const url = typedBlobUrl(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    let settled = false;
    const done = (result: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = window.setTimeout(() => done(null), 4_000);

    const tryDraw = () => {
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
      if (!w || !h) return done(null);
      try {
        const scale = Math.min(1, 960 / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return done(null);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // A canvas that only contains transparent pixels means the draw failed.
        const sample = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data;
        if (sample[3] === 0) return done(null);
        canvas.toBlob((blob) => {
          if (!blob) return done(null);
          done(URL.createObjectURL(blob));
        }, "image/jpeg", 0.80);
      } catch {
        done(null);
      }
    };

    video.onloadedmetadata = () => {
      video.currentTime = 0.001;
    };
    video.onseeked = () => tryDraw();
    // If seeking never fires, fall back to whatever frame is available.
    video.onloadeddata = () => {
      if (!settled) tryDraw();
    };
    video.onerror = () => done(null);
    video.src = url;
  });
}

/**
 * Generate `count` evenly-spaced JPEG thumbnail frames from a video file.
 * Returns an array of blob URLs; caller must revoke them.
 * Falls back to an empty array when the video can't be seeked.
 */
export function generateVideoThumbnails(file: File, count: number): Promise<string[]> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve([]);
    const url = typedBlobUrl(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const results: string[] = [];
    let settled = false;
    const timer = window.setTimeout(() => { settled = true; cleanup(); resolve(results); }, 15_000);

    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };

    const drawFrame = (): Promise<string | null> => new Promise((res) => {
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
      if (!w || !h) return res(null);
      try {
        const th = 72, tw = Math.round((w / h) * th);
        const canvas = document.createElement("canvas");
        canvas.width = tw; canvas.height = th;
        const ctx = canvas.getContext("2d");
        if (!ctx) return res(null);
        ctx.drawImage(video, 0, 0, tw, th);
        canvas.toBlob((blob) => res(blob ? URL.createObjectURL(blob) : null), "image/jpeg", 0.70);
      } catch { res(null); }
    });

    const seekFrames = async (duration: number) => {
      const step = duration / (count + 1);
      for (let i = 1; i <= count; i++) {
        if (settled) break;
        const target = step * i;
        await new Promise<void>((res) => {
          const guard = window.setTimeout(() => res(), 3000);
          video.onseeked = async () => {
            window.clearTimeout(guard);
            const thumb = await drawFrame();
            if (thumb) results.push(thumb);
            res();
          };
          video.currentTime = target;
        });
      }
      settled = true;
      cleanup();
      resolve(results);
    };

    video.onloadedmetadata = () => {
      const dur = video.duration;
      if (!Number.isFinite(dur) || dur <= 0) { settled = true; cleanup(); resolve([]); return; }
      void seekFrames(dur);
    };
    video.onerror = () => { settled = true; cleanup(); resolve([]); };
    video.src = url;
  });
}

/**
 * Capture the frame at `timeFrac` (or the current position) as a JPEG — the
 * video's cover/thumbnail. Returns null when no frame can be drawn.
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  timeFrac?: number,
): Promise<File | null> {
  try {
    const duration = video.duration;
    if (timeFrac !== undefined && Number.isFinite(duration) && duration > 0) {
      const target = Math.min(Math.max(timeFrac, 0), 1) * duration;
      if (Math.abs(video.currentTime - target) > 0.05) {
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
          window.setTimeout(resolve, 2000);
          video.currentTime = target;
        });
      }
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    const scale = Math.min(1, 1280 / w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob || blob.size === 0) return null;
    return new File([blob], `cover-${Date.now()}.jpg`, { type: "image/jpeg" });
  } catch {
    return null;
  }
}

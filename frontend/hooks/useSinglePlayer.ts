/**
 * App-wide single-video-playback enforcement.
 *
 * Feed cards, shorts, reels and the story viewer all register here: when one
 * element starts playing, every previously playing element is paused. The
 * registry also pauses whatever is playing while the document is hidden
 * (app backgrounded / tab switched), so two videos can never fight for the
 * audio channel.
 */

let playingEl: HTMLVideoElement | null = null;
let visibilityBound = false;

function onVisibilityChange() {
  if (document.visibilityState === "hidden" && playingEl) {
    playingEl.pause();
    playingEl = null;
  }
}

function ensureVisibilityListener() {
  if (visibilityBound || typeof document === "undefined") return;
  document.addEventListener("visibilitychange", onVisibilityChange);
  visibilityBound = true;
}

/** Claim playback for `el`, pausing whatever was playing before. */
export function claimPlayback(el: HTMLVideoElement | null): void {
  ensureVisibilityListener();
  if (playingEl && playingEl !== el) playingEl.pause();
  playingEl = el;
}

/** Give up the claim when a video pauses/unmounts (no-op for other owners). */
export function releasePlayback(el: HTMLVideoElement | null): void {
  if (playingEl === el) playingEl = null;
}

/** Pause everything the registry knows about (e.g. opening a modal viewer). */
export function pauseAllPlayback(): void {
  if (playingEl) playingEl.pause();
  playingEl = null;
}

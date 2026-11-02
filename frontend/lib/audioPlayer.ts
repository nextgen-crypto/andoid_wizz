/**
 * Browser-native audio player for in-app music tracks.
 *
 * Each call to useAudioPlayer() owns one HTMLAudioElement. If a track has no
 * real audioUrl, a synthetic WAV test tone is generated via OfflineAudioContext
 * and cached for the session — so the UI is fully functional before real CDN
 * assets are wired up. When real URLs are added to TRACKS, drop them in the
 * audioUrl field and the tone fallback is ignored automatically.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/* ── Track shape ── */

export interface Track {
  id: string;
  title: string;
  creator: string;
  /** Display string, e.g. "0:29" */
  duration: string;
  /** Numeric duration in seconds — used for test-tone generation. */
  durationSec: number;
  /** Waveform bar heights, each 1–10. */
  bars: number[];
  /**
   * Real audio URL (CDN / Supabase Storage).
   * When omitted, a sine-wave test tone is generated in-browser.
   */
  audioUrl?: string;
}

/* ── Test-tone generator ── */

// Session-scoped cache: track id → blob URL
const toneCache = new Map<string, string>();

// Deterministic frequency so each track sounds distinct
const TONE_FREQS: Record<string, number> = {
  t1: 220, // low, cool
  t2: 330, // warm mid
  t3: 440, // standard A
  t4: 396, // golden G#
  t5: 264, // soft C
};

async function generateTestTone(durationSec: number, freq: number): Promise<string> {
  const dur = Math.min(Math.max(durationSec, 1), 60);
  const sampleRate = 22050;
  const ctx = new OfflineAudioContext(1, Math.round(sampleRate * dur), sampleRate);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;

  const gain = ctx.createGain();
  // Gentle fade-in/out to avoid clicks
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(0.28, Math.min(0.08, dur * 0.1));
  gain.gain.setValueAtTime(0.28, Math.max(0, dur - 0.08));
  gain.gain.linearRampToValueAtTime(0, dur);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(0);
  osc.stop(dur);

  const buffer = await ctx.startRendering();
  const wav = encodeWav(buffer);
  return URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
}

function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const samples = buffer.getChannelData(0);
  const dataLen = samples.length * 2;
  const ab = new ArrayBuffer(44 + dataLen);
  const v = new DataView(ab);
  const sr = buffer.sampleRate;

  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };

  ws(0, "RIFF"); v.setUint32(4, 36 + dataLen, true);
  ws(8, "WAVE"); ws(12, "fmt ");
  v.setUint32(16, 16, true);   // chunk size
  v.setUint16(20, 1, true);    // PCM
  v.setUint16(22, 1, true);    // mono
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);   // 16-bit
  ws(36, "data"); v.setUint32(40, dataLen, true);

  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return ab;
}

async function resolveUrl(track: Track): Promise<string | null> {
  if (track.audioUrl) return track.audioUrl;
  if (track.durationSec <= 0) return null; // "Original audio" placeholder
  if (toneCache.has(track.id)) return toneCache.get(track.id)!;
  try {
    if (typeof OfflineAudioContext === "undefined") return null;
    const url = await generateTestTone(
      track.durationSec,
      TONE_FREQS[track.id] ?? 440,
    );
    toneCache.set(track.id, url);
    return url;
  } catch {
    return null;
  }
}

/* ── useAudioPlayer hook ── */

export interface PlayerState {
  playingId: string | null;
  loading: boolean;
  currentTime: number;
  duration: number;
  play: (track: Track) => Promise<void>;
  pause: () => void;
  toggle: (track: Track) => Promise<void>;
  seek: (sec: number) => void;
  setVolume: (zeroToOne: number) => void;
}

export function useAudioPlayer(): PlayerState {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (typeof Audio === "undefined") return;
    const audio = new Audio();
    audio.preload = "none";
    audioRef.current = audio;

    const onTime   = () => setCurrentTime(audio.currentTime);
    const onMeta   = () => setDuration(audio.duration || 0);
    const onEnded  = () => { setPlayingId(null); setCurrentTime(0); };
    const onError  = () => { setPlayingId(null); setLoading(false); };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.pause();
      audio.src = "";
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audioRef.current = null;
    };
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlayingId(null);
  }, []);

  const play = useCallback(async (track: Track) => {
    const audio = audioRef.current;
    if (!audio) return;
    setLoading(true);
    try {
      const url = await resolveUrl(track);
      if (!url) { setLoading(false); return; }
      if (audio.src !== url) {
        audio.src = url;
        audio.load();
      }
      await audio.play();
      setPlayingId(track.id);
    } catch {
      setPlayingId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = useCallback(
    async (track: Track) => {
      if (playingId === track.id) {
        pause();
      } else {
        await play(track);
      }
    },
    [playingId, play, pause],
  );

  const seek = useCallback((sec: number) => {
    if (audioRef.current) audioRef.current.currentTime = sec;
  }, []);

  const setVolume = useCallback((v: number) => {
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, v));
  }, []);

  return { playingId, loading, currentTime, duration, play, pause, toggle, seek, setVolume };
}

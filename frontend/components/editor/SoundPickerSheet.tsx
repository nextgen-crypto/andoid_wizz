import { useState, useRef } from "react";
import { Search, X, Bookmark, Pause, Play, Loader2 } from "lucide-react";
import { useEditorStore } from "@/frontend/store/editorStore";
import { MOCK_SOUNDS, type SoundTrackMeta } from "@/frontend/lib/editorTypes";
import { cn } from "@/lib/utils";

type Tab = "hot" | "for_you" | "favorites" | "recent";

const TABS: { id: Tab; label: string }[] = [
  { id: "hot", label: "Hot" },
  { id: "for_you", label: "For You" },
  { id: "favorites", label: "Favorites" },
  { id: "recent", label: "Recent" },
];

const FAV_KEY = "wizz:editor:fav-sounds";
const RECENT_KEY = "wizz:editor:recent-sounds";

function loadIds(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function saveIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Best-effort; failure is non-fatal.
  }
}

export function SoundPickerSheet({ onClose }: { onClose: () => void }) {
  const setSoundTrack = useEditorStore((s) => s.setSoundTrack);
  const project = useEditorStore((s) => s.project);

  const [tab, setTab] = useState<Tab>("for_you");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [favs, setFavs] = useState<string[]>(loadIds(FAV_KEY));
  const [recent, setRecent] = useState<string[]>(loadIds(RECENT_KEY));
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const q = query.trim().toLowerCase();

  function getPool(): SoundTrackMeta[] {
    let pool = MOCK_SOUNDS;
    if (tab === "favorites") pool = pool.filter((s) => favs.includes(s.id));
    if (tab === "recent") pool = pool.filter((s) => recent.includes(s.id));
    if (q)
      pool = pool.filter(
        (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q),
      );
    return pool;
  }

  async function preview(sound: SoundTrackMeta) {
    if (playingId === sound.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    setLoading(sound.id);
    setExpandedId(sound.id);

    if (sound.audioUrl) {
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.src = sound.audioUrl;
      await a.play().catch(() => undefined);
      setPlayingId(sound.id);
      a.onended = () => setPlayingId(null);
    } else {
      // Fallback: generate tone via OfflineAudioContext
      try {
        const hz = 220 + (sound.id.charCodeAt(1) % 5) * 55;
        const ctx = new OfflineAudioContext(1, 44100 * 3, 44100);
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = hz;
        osc.connect(ctx.destination);
        osc.start(0);
        osc.stop(3);
        const buf = await ctx.startRendering();
        const ab = new AudioBuffer({ numberOfChannels: 1, length: buf.length, sampleRate: 44100 });
        ab.copyToChannel(buf.getChannelData(0), 0);
        // Encode to WAV blob
        const wav = encodeWav(ab.getChannelData(0), 44100);
        const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
        const a = new Audio(url);
        audioRef.current = a;
        await a.play().catch(() => undefined);
        setPlayingId(sound.id);
        a.onended = () => setPlayingId(null);
      } catch {
        // Best-effort; failure is non-fatal.
      }
    }
    setLoading(null);
  }

  function applySound(sound: SoundTrackMeta) {
    audioRef.current?.pause();
    setPlayingId(null);
    const newRecent = [sound.id, ...recent.filter((r) => r !== sound.id)].slice(0, 20);
    setRecent(newRecent);
    saveIds(RECENT_KEY, newRecent);
    const totalDur = project.clips.reduce((s, c) => s + (c.trimEnd - c.trimStart) / c.speed, 0);
    setSoundTrack({
      id: sound.id,
      title: sound.title,
      artist: sound.artist,
      duration: sound.durationSec,
      src: sound.audioUrl ?? "",
      startOffset: 0,
      volume: 1,
    });
    onClose();
  }

  function toggleFav(id: string) {
    const next = favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id];
    setFavs(next);
    saveIds(FAV_KEY, next);
  }

  const pool = getPool();

  return (
    <div className="flex max-h-[85dvh] flex-col rounded-t-[28px] bg-[#1C1C1E] pb-safe">
      {/* Drag handle */}
      <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/20" />

      {/* Tabs + close */}
      <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-1">
        <div className="flex gap-0 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap",
                tab === t.id ? "border-b-2 border-white text-white" : "text-white/50",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5">
            <Search className="size-3.5 text-white/60 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-24 bg-transparent text-xs text-white outline-none placeholder:text-white/40"
            />
          </div>
          <button
            onClick={() => {
              audioRef.current?.pause();
              onClose();
            }}
            className="grid size-8 place-items-center rounded-full bg-white/10"
          >
            <X className="size-4 text-white" />
          </button>
        </div>
      </div>

      {/* List */}
      <ul className="min-h-0 flex-1 divide-y divide-white/8 overflow-y-auto px-2 pb-4">
        {pool.length === 0 && (
          <li className="py-10 text-center text-sm text-white/40">
            {tab === "favorites" ? "No saved sounds — tap ♥ to save." : "No results."}
          </li>
        )}
        {pool.map((sound) => {
          const isPlaying = playingId === sound.id;
          const isLoading = loading === sound.id;
          const isExpanded = expandedId === sound.id;
          return (
            <li key={sound.id}>
              <div
                className="flex items-center gap-3 px-2 py-3 cursor-pointer"
                onClick={() => preview(sound)}
              >
                {/* Cover art placeholder */}
                <div
                  className="size-14 shrink-0 rounded-xl"
                  style={{ background: sound.coverColor }}
                />
                {/* Meta */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-white">{sound.title}</p>
                  <p className="text-xs text-white/50">
                    {sound.artist} · {sound.posts} posts · {sound.duration}
                  </p>
                </div>
                {/* Play indicator */}
                <div
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-full",
                    isPlaying ? "bg-white text-black" : "bg-white/10 text-white",
                  )}
                >
                  {isLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="size-4 fill-current" />
                  ) : (
                    <Play className="size-4 translate-x-px fill-current" />
                  )}
                </div>
              </div>

              {/* Expanded actions */}
              {isExpanded && (
                <div className="flex items-center gap-3 px-3 pb-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFav(sound.id);
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white"
                  >
                    <Bookmark className={cn("size-4", favs.includes(sound.id) && "fill-white")} />
                    {favs.includes(sound.id) ? "Saved" : "Save"}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      applySound(sound);
                    }}
                    className="flex-1 rounded-full bg-[#FE2C55] py-2 text-sm font-bold text-white"
                  >
                    Use
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── Minimal PCM WAV encoder ── */
function encodeWav(samples: Float32Array, sr: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const write = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, samples[i]! * 32767)), true);
  }
  return buf;
}

import { create } from "zustand";
import {
  type EditorProject,
  type EditorClip,
  type SoundTrack,
  type TextLayer,
  type StickerLayer,
  type FilterPreset,
  type AdjustValues,
  EMPTY_PROJECT,
  projectDuration,
  DEFAULT_ADJUST,
} from "@/frontend/lib/editorTypes";

const MAX_HISTORY = 50;
const AUTOSAVE_KEY = "wizz:editor:autosave";

/* ─── State shape ────────────────────────────────────────────────────────── */

export interface EditorState {
  project: EditorProject;
  history: EditorProject[];        // past states (oldest first)
  future: EditorProject[];         // redo stack
  playhead: number;                // seconds in project timeline
  playing: boolean;
  zoom: number;                    // pixels per second for timeline
  selectedClipId: string | null;
  activeSheet: ActiveSheet;
  dirty: boolean;
}

export type ActiveSheet =
  | null
  | "adjust"
  | "filters"
  | "sound"
  | "speed"
  | "text"
  | "stickers"
  | "overlay"
  | "effects"
  | "captions"
  | "crop"
  | "volume"
  | "mask"
  | "opacity"
  | "voiceEffect"
  | "retouch"
  | "magic"
  | "export";

/* ─── Actions ────────────────────────────────────────────────────────────── */

interface EditorActions {
  // Project mutations (all go through history)
  setClips: (clips: EditorClip[]) => void;
  addClip: (clip: EditorClip) => void;
  removeClip: (id: string) => void;
  updateClip: (id: string, patch: Partial<EditorClip>) => void;
  reorderClips: (from: number, to: number) => void;
  splitClipAt: (clipId: string, projectTime: number) => void;
  setSoundTrack: (s: SoundTrack | null) => void;
  addTextLayer: (l: TextLayer) => void;
  updateTextLayer: (id: string, patch: Partial<TextLayer>) => void;
  removeTextLayer: (id: string) => void;
  addSticker: (s: StickerLayer) => void;
  updateSticker: (id: string, patch: Partial<StickerLayer>) => void;
  removeSticker: (id: string) => void;
  setGlobalFilter: (f: FilterPreset) => void;
  setGlobalAdjust: (a: AdjustValues) => void;

  // Playback
  setPlayhead: (t: number) => void;
  setPlaying: (v: boolean) => void;

  // UI
  setZoom: (z: number) => void;
  selectClip: (id: string | null) => void;
  openSheet: (s: ActiveSheet) => void;
  closeSheet: () => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Persistence
  resetProject: (p?: EditorProject) => void;
  autosave: () => void;
  loadAutosave: () => boolean;
}

/* ─── Helper to push a mutated project into history ─────────────────────── */

function pushHistory(
  state: EditorState,
  next: EditorProject,
): Partial<EditorState> {
  const history = [...state.history, state.project].slice(-MAX_HISTORY);
  return { project: next, history, future: [], dirty: true };
}

/* ─── Store ──────────────────────────────────────────────────────────────── */

export const useEditorStore = create<EditorState & EditorActions>()((set, get) => ({
  project: { ...EMPTY_PROJECT },
  history: [],
  future: [],
  playhead: 0,
  playing: false,
  zoom: 60,        // 60px per second default
  selectedClipId: null,
  activeSheet: null,
  dirty: false,

  /* ── Project mutations ── */

  setClips: (clips) =>
    set((s) => pushHistory(s, { ...s.project, clips })),

  addClip: (clip) =>
    set((s) => pushHistory(s, { ...s.project, clips: [...s.project.clips, clip] })),

  removeClip: (id) =>
    set((s) =>
      pushHistory(s, {
        ...s.project,
        clips: s.project.clips.filter((c) => c.id !== id),
      }),
    ),

  updateClip: (id, patch) =>
    set((s) =>
      pushHistory(s, {
        ...s.project,
        clips: s.project.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }),
    ),

  reorderClips: (from, to) =>
    set((s) => {
      const clips = [...s.project.clips];
      const [moved] = clips.splice(from, 1);
      if (!moved) return s;
      clips.splice(to, 0, moved);
      return pushHistory(s, { ...s.project, clips });
    }),

  splitClipAt: (clipId, projectTime) =>
    set((s) => {
      const clips = s.project.clips;
      const idx = clips.findIndex((c) => c.id === clipId);
      if (idx < 0) return s;
      const clip = clips[idx]!;

      // Compute project start time of this clip
      let start = 0;
      for (let i = 0; i < idx; i++) {
        const c = clips[i]!;
        start += (c.trimEnd - c.trimStart) / c.speed;
      }
      const offsetInClip = (projectTime - start) * clip.speed;
      const splitAt = clip.trimStart + offsetInClip;

      if (splitAt <= clip.trimStart || splitAt >= clip.trimEnd) return s;

      const left: EditorClip = { ...clip, id: `${clip.id}-a`, trimEnd: splitAt };
      const right: EditorClip = { ...clip, id: `${clip.id}-b`, trimStart: splitAt };
      const next = [...clips];
      next.splice(idx, 1, left, right);
      return pushHistory(s, { ...s.project, clips: next });
    }),

  setSoundTrack: (soundTrack) =>
    set((s) => pushHistory(s, { ...s.project, soundTrack })),

  addTextLayer: (l) =>
    set((s) =>
      pushHistory(s, { ...s.project, textLayers: [...s.project.textLayers, l] }),
    ),

  updateTextLayer: (id, patch) =>
    set((s) =>
      pushHistory(s, {
        ...s.project,
        textLayers: s.project.textLayers.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }),
    ),

  removeTextLayer: (id) =>
    set((s) =>
      pushHistory(s, {
        ...s.project,
        textLayers: s.project.textLayers.filter((t) => t.id !== id),
      }),
    ),

  addSticker: (sticker) =>
    set((s) =>
      pushHistory(s, { ...s.project, stickers: [...s.project.stickers, sticker] }),
    ),

  updateSticker: (id, patch) =>
    set((s) =>
      pushHistory(s, {
        ...s.project,
        stickers: s.project.stickers.map((sk) => (sk.id === id ? { ...sk, ...patch } : sk)),
      }),
    ),

  removeSticker: (id) =>
    set((s) =>
      pushHistory(s, {
        ...s.project,
        stickers: s.project.stickers.filter((sk) => sk.id !== id),
      }),
    ),

  setGlobalFilter: (globalFilter) =>
    set((s) => pushHistory(s, { ...s.project, globalFilter })),

  setGlobalAdjust: (globalAdjust) =>
    set((s) => pushHistory(s, { ...s.project, globalAdjust })),

  /* ── Playback ── */

  setPlayhead: (playhead) => {
    const dur = projectDuration(get().project.clips);
    set({ playhead: Math.max(0, Math.min(playhead, dur || 0)) });
  },

  setPlaying: (playing) => set({ playing }),

  /* ── UI ── */

  setZoom: (zoom) => set({ zoom: Math.max(20, Math.min(300, zoom)) }),

  selectClip: (selectedClipId) => set({ selectedClipId }),

  openSheet: (activeSheet) => set({ activeSheet }),

  closeSheet: () => set({ activeSheet: null }),

  /* ── History ── */

  undo: () =>
    set((s) => {
      if (!s.history.length) return s;
      const history = [...s.history];
      const prev = history.pop()!;
      return {
        project: prev,
        history,
        future: [s.project, ...s.future].slice(0, MAX_HISTORY),
        dirty: true,
      };
    }),

  redo: () =>
    set((s) => {
      if (!s.future.length) return s;
      const future = [...s.future];
      const next = future.shift()!;
      return {
        project: next,
        history: [...s.history, s.project].slice(-MAX_HISTORY),
        future,
        dirty: true,
      };
    }),

  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,

  /* ── Persistence ── */

  resetProject: (p) =>
    set({
      project: p ?? { ...EMPTY_PROJECT },
      history: [],
      future: [],
      playhead: 0,
      playing: false,
      selectedClipId: null,
      activeSheet: null,
      dirty: false,
    }),

  autosave: () => {
    const { project } = get();
    try {
      // Serialize without File objects (they can't be JSON-stringified)
      const serializable = {
        ...project,
        clips: project.clips.map(({ file, src, thumbnails, ...rest }) => rest),
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializable));
    } catch {
      // Storage full or unavailable — silently ignore
    }
  },

  loadAutosave: () => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as Partial<EditorProject>;
      // We can restore metadata but not File objects — clips will be empty
      // unless the caller re-hydrates them from the filesystem.
      if (parsed.globalFilter || parsed.textLayers || parsed.stickers) {
        set((s) => ({ project: { ...EMPTY_PROJECT, ...parsed, clips: [] }, dirty: false }));
        return true;
      }
    } catch {
      // Corrupt autosave
    }
    return false;
  },
}));

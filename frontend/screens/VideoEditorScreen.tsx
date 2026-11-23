import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { ChevronLeft, ArrowRight } from "lucide-react";
import { useEditorStore } from "@/frontend/store/editorStore";
import { PreviewCanvas } from "@/frontend/components/editor/PreviewCanvas";
import { PlaybackBar } from "@/frontend/components/editor/PlaybackBar";
import { Timeline } from "@/frontend/components/editor/Timeline";
import { MainToolbar } from "@/frontend/components/editor/MainToolbar";
import { ClipToolbar } from "@/frontend/components/editor/ClipToolbar";
import { AdjustSheet } from "@/frontend/components/editor/AdjustSheet";
import { SoundPickerSheet } from "@/frontend/components/editor/SoundPickerSheet";
import { FiltersSheet } from "@/frontend/components/editor/FiltersSheet";
import { SpeedSheet } from "@/frontend/components/editor/SpeedSheet";
import { TextSheet } from "@/frontend/components/editor/TextSheet";
import { ExportSheet } from "@/frontend/components/editor/ExportSheet";
import { BackgroundSheet } from "@/frontend/components/editor/BackgroundSheet";
import { type EditorClip } from "@/frontend/lib/editorTypes";
import { generateVideoThumbnails } from "@/frontend/lib/videoEdit";
import { typedBlobUrl } from "@/frontend/lib/mediaFormat";
import { cn } from "@/lib/utils";

/* ─── Sheet overlay wrapper ─────────────────────────────────────────────── */
function SheetOverlay({
  open,
  children,
  onDismiss,
}: {
  open: boolean;
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      {/* Scrim */}
      <button
        className="absolute inset-0 bg-black/60"
        onClick={onDismiss}
        aria-label="Close sheet"
      />
      {/* Sheet slides up from bottom */}
      <div className="absolute inset-x-0 bottom-0 animate-sheet-in">{children}</div>
    </div>
  );
}

/* ─── Discard dialog ────────────────────────────────────────────────────── */
function DiscardDialog({
  open,
  onKeep,
  onDiscard,
}: {
  open: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 px-8">
      <div className="w-full max-w-sm rounded-[28px] bg-[#1C1C1E] p-6">
        <p className="text-center text-lg font-bold text-white">Discard edits?</p>
        <p className="mt-1 text-center text-sm text-white/60">Your changes will be lost.</p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={onDiscard}
            className="w-full rounded-full bg-[#FE2C55] py-3 text-sm font-bold text-white"
          >
            Discard
          </button>
          <button
            onClick={onKeep}
            className="w-full rounded-full bg-white/10 py-3 text-sm font-semibold text-white"
          >
            Keep editing
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main screen ────────────────────────────────────────────────────────── */
export function VideoEditorScreen({ initialFile }: { initialFile?: File | null }) {
  const router = useRouter();
  const clipInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const {
    project,
    playhead,
    activeSheet,
    selectedClipId,
    dirty,
    addClip,
    updateClip,
    selectClip,
    openSheet,
    closeSheet,
    resetProject,
    autosave,
  } = useEditorStore();

  /* ── Load initial file if provided ── */
  useEffect(() => {
    resetProject();
    if (!initialFile) return;
    loadFileAsClip(initialFile).then((clip) => {
      if (clip) addClip(clip);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  /* ── Autosave on every project change ── */
  useEffect(() => {
    autosave();
  }, [project, autosave]);

  /* ── Back-button handling ── */
  const [showDiscard, setShowDiscard] = useState(false);

  function handleBack() {
    if (dirty) {
      setShowDiscard(true);
      return;
    }
    router.history.back();
  }

  /* ── File pickers ── */
  function onAddFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    files.forEach((f) =>
      loadFileAsClip(f).then((c) => {
        if (c) addClip(c);
      }),
    );
    e.target.value = "";
  }

  function onReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedClipId) return;
    loadFileAsClip(file).then((c) => {
      if (c)
        updateClip(selectedClipId, {
          file: c.file,
          src: c.src,
          nativeDuration: c.nativeDuration,
          trimEnd: c.nativeDuration,
          thumbnails: c.thumbnails,
        });
    });
    e.target.value = "";
  }

  function selectClipUnderPlayhead() {
    const { clips } = project;
    if (!clips.length) return;
    let cursor = 0;
    for (const clip of clips) {
      const dur = (clip.trimEnd - clip.trimStart) / clip.speed;
      if (playhead <= cursor + dur) {
        selectClip(clip.id);
        return;
      }
      cursor += dur;
    }
    selectClip(clips[clips.length - 1]!.id);
  }

  /* ── Revoke blob URLs when editor unmounts ── */
  useEffect(() => {
    return () => {
      for (const clip of useEditorStore.getState().project.clips) {
        if (clip.src.startsWith("blob:")) URL.revokeObjectURL(clip.src);
        for (const thumb of clip.thumbnails) {
          if (thumb !== clip.src && thumb.startsWith("blob:")) URL.revokeObjectURL(thumb);
        }
      }
    };
  }, []);

  const isClipSelected = selectedClipId !== null;

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden bg-black"
      style={{ userSelect: "none", WebkitUserSelect: "none", height: "100dvh" }}
    >
      {/* ── Top bar ── */}
      <div className="flex shrink-0 items-center justify-between px-4 pt-safe pb-1">
        <button
          onClick={handleBack}
          aria-label="Back"
          className="grid size-14 place-items-center rounded-full bg-[#2C2C2E] text-white active:scale-95"
        >
          <ChevronLeft className="size-6" />
        </button>
        <button
          onClick={() => openSheet("export")}
          aria-label="Next"
          className="grid size-14 place-items-center rounded-full bg-[#FE2C55] text-white active:scale-95"
        >
          <ArrowRight className="size-6" />
        </button>
      </div>

      {/* ── Preview canvas — takes all remaining vertical space ── */}
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden px-2 py-1">
        {/* height:100% + aspectRatio 9/16 = width auto-derived from height */}
        <PreviewCanvas className="h-full w-auto max-w-full" />
      </div>

      {/* ── Playback bar ── */}
      <PlaybackBar />

      {/* ── Timeline ── */}
      <div className="shrink-0">
        <Timeline
          onAddClip={() => clipInputRef.current?.click()}
          onAddSound={() => openSheet("sound")}
          clipInputRef={clipInputRef}
        />
      </div>

      {/* ── Bottom toolbar — padded above Android nav bar ── */}
      <div
        className="shrink-0 border-t border-white/10 bg-black"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
      >
        {isClipSelected ? (
          <ClipToolbar onReplace={() => replaceInputRef.current?.click()} />
        ) : (
          <MainToolbar onEditClip={selectClipUnderPlayhead} />
        )}
      </div>

      {/* Hidden file inputs */}
      <input
        ref={clipInputRef}
        type="file"
        accept="video/*,image/*"
        multiple
        className="sr-only"
        onChange={onAddFiles}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept="video/*,image/*"
        className="sr-only"
        onChange={onReplaceFile}
      />

      {/* ── Sheets ── */}
      <SheetOverlay open={activeSheet === "adjust"} onDismiss={closeSheet}>
        <AdjustSheet onClose={closeSheet} />
      </SheetOverlay>
      <SheetOverlay open={activeSheet === "filters"} onDismiss={closeSheet}>
        <FiltersSheet onClose={closeSheet} />
      </SheetOverlay>
      <SheetOverlay open={activeSheet === "sound"} onDismiss={closeSheet}>
        <SoundPickerSheet onClose={closeSheet} />
      </SheetOverlay>
      <SheetOverlay open={activeSheet === "speed"} onDismiss={closeSheet}>
        <SpeedSheet onClose={closeSheet} />
      </SheetOverlay>
      <SheetOverlay open={activeSheet === "text"} onDismiss={closeSheet}>
        <TextSheet onClose={closeSheet} />
      </SheetOverlay>
      <SheetOverlay open={activeSheet === "export"} onDismiss={closeSheet}>
        <ExportSheet
          onClose={closeSheet}
          onPost={(url) => {
            closeSheet();
            // Navigate to post screen — pass the exported URL
            void router.navigate({ to: "/" });
          }}
        />
      </SheetOverlay>
      <SheetOverlay open={activeSheet === "background"} onDismiss={closeSheet}>
        <BackgroundSheet onClose={closeSheet} />
      </SheetOverlay>
      {/* Stub sheets for AI tools */}
      {(
        [
          "magic",
          "captions",
          "overlay",
          "effects",
          "crop",
          "volume",
          "mask",
          "opacity",
          "voiceEffect",
          "retouch",
        ] as const
      ).map((id) => (
        <SheetOverlay key={id} open={activeSheet === id} onDismiss={closeSheet}>
          <StubSheet name={id} onClose={closeSheet} />
        </SheetOverlay>
      ))}

      {/* ── Discard dialog ── */}
      <DiscardDialog
        open={showDiscard}
        onKeep={() => setShowDiscard(false)}
        onDiscard={() => {
          resetProject();
          router.history.back();
        }}
      />
    </div>
  );
}

/* ─── Generic stub sheet for AI tools ─────────────────────────────────────── */
const SHEET_LABELS: Record<string, string> = {
  magic: "Magic AI",
  captions: "Auto Captions",
  overlay: "Overlay (PiP)",
  effects: "Visual Effects",
  crop: "Crop & Zoom",
  volume: "Volume",
  mask: "Mask",
  opacity: "Opacity",
  voiceEffect: "Voice Effect",
  retouch: "Retouch",
};

function StubSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const label = SHEET_LABELS[name] ?? name;
  const { project, selectedClipId, updateClip, openSheet } = useEditorStore();
  const clip = project.clips.find((c) => c.id === selectedClipId);

  // Volume is fully functional
  if (name === "volume" && clip) {
    return (
      <div className="rounded-t-[28px] bg-[#1C1C1E] px-5 pb-safe">
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/20" />
        <div className="flex items-center justify-between pt-4 pb-3">
          <p className="text-base font-bold text-white">Volume</p>
          <button
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full bg-white/10"
          >
            <span className="text-white text-xs font-bold">✓</span>
          </button>
        </div>
        <div className="space-y-4 pb-4">
          <div>
            <div className="mb-1 flex justify-between text-xs text-white/60">
              <span>Clip audio</span>
              <span>{Math.round(clip.volume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              value={clip.volume * 100}
              onChange={(e) => updateClip(clip.id, { volume: Number(e.target.value) / 100 })}
              className="w-full"
              style={{ accentColor: "#FE2C55" }}
            />
          </div>
          <button
            onClick={() => updateClip(clip.id, { muted: !clip.muted })}
            className={cn(
              "w-full rounded-full py-2.5 text-sm font-semibold",
              clip.muted ? "bg-[#FE2C55] text-white" : "bg-[#2C2C2E] text-white/70",
            )}
          >
            {clip.muted ? "Unmute clip" : "Mute clip"}
          </button>
        </div>
      </div>
    );
  }

  // Opacity is fully functional
  if (name === "opacity" && clip) {
    return (
      <div className="rounded-t-[28px] bg-[#1C1C1E] px-5 pb-safe">
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/20" />
        <div className="flex items-center justify-between pt-4 pb-3">
          <p className="text-base font-bold text-white">Opacity</p>
          <button
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full bg-white/10"
          >
            <span className="text-white text-xs font-bold">✓</span>
          </button>
        </div>
        <div className="pb-4">
          <div className="mb-1 flex justify-between text-xs text-white/60">
            <span>Opacity</span>
            <span>{Math.round(clip.opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={clip.opacity * 100}
            onChange={(e) => updateClip(clip.id, { opacity: Number(e.target.value) / 100 })}
            className="w-full"
            style={{ accentColor: "#FE2C55" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-t-[28px] bg-[#1C1C1E] px-5 pb-safe">
      <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/20" />
      <div className="flex items-center justify-between pt-4 pb-4">
        <p className="text-base font-bold text-white">{label}</p>
        <button
          onClick={onClose}
          className="grid size-8 place-items-center rounded-full bg-white/10"
        >
          <span className="text-white text-sm">✕</span>
        </button>
      </div>
      <div className="flex flex-col items-center gap-3 pb-8">
        <div className="grid size-16 place-items-center rounded-full bg-white/5">
          <span className="text-3xl">🪄</span>
        </div>
        <p className="text-center text-sm text-white/50">
          {label} will be available in a future update.
        </p>
      </div>
    </div>
  );
}

/* ─── Helper: load a File into an EditorClip ────────────────────────────── */
async function loadFileAsClip(file: File): Promise<EditorClip | null> {
  // The main src blob URL — kept alive for the entire editor session.
  // NEVER revoke this until the editor unmounts.
  const src = typedBlobUrl(file);
  console.log(
    "[editor] loadFileAsClip",
    file.name,
    file.type,
    `${(file.size / 1024).toFixed(0)} KB`,
    src.slice(-30),
  );

  let duration = 0;

  const isVideo =
    file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|ogv|3gp|mkv|avi|ts)$/i.test(file.name);
  if (isVideo) {
    // Use a SEPARATE URL for the metadata probe so revoking the probe URL
    // never kills the main src that the <video> player will use.
    const probeUrl = typedBlobUrl(file);
    duration = await new Promise<number>((resolve) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.playsInline = true;
      let settled = false;
      const done = (dur: number) => {
        if (settled) return;
        settled = true;
        resolve(dur);
      };
      v.addEventListener(
        "loadedmetadata",
        () => {
          console.log("[editor] probe OK dur:", v.duration);
          done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
        },
        { once: true },
      );
      v.addEventListener(
        "error",
        () => {
          console.log("[editor] probe FAIL code:", v.error?.code, v.error?.message);
          done(0);
        },
        { once: true },
      );
      // 8-second safety valve in case events never fire (codec not supported)
      window.setTimeout(() => done(0), 8000);
      v.src = probeUrl;
    });
    URL.revokeObjectURL(probeUrl); // Safe: only revokes the probe copy
    // If probe returned 0 (codec can't be detected), use a large fallback so
    // the clip is still editable; PreviewCanvas will fix the real duration
    // once loadedmetadata fires on the display video element.
    if (duration === 0) duration = 60;
  } else {
    duration = 5; // still images shown for 5 s
  }

  // Thumbnails: generateVideoThumbnails creates its own internal URL and revokes it.
  // For images we reuse src (it's already a JPEG-compatible blob URL from attachPhoto).
  let thumbnails: string[] = [];
  try {
    if (file.type.startsWith("video/")) {
      thumbnails = await generateVideoThumbnails(file, 8);
    } else {
      thumbnails = [src]; // image preview = the clip itself
    }
  } catch {
    /* thumbnails is fine empty */
  }

  const clip: EditorClip = {
    id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    file,
    src,
    nativeDuration: duration,
    trimStart: 0,
    trimEnd: duration,
    speed: 1,
    volume: 1,
    muted: false,
    filter: "none",
    adjust: {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      brilliance: 0,
      sharpness: 0,
      highlight: 0,
      shadow: 0,
      temperature: 0,
      tint: 0,
      fade: 0,
      vignette: 0,
      grain: 0,
    },
    keyframes: [],
    cropX: 0,
    cropY: 0,
    cropScale: 1,
    opacity: 1,
    thumbnails,
  };
  return clip;
}

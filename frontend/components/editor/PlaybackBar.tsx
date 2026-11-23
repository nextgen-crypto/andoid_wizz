import { Pause, Play, Maximize2, RotateCcw, RotateCw } from "lucide-react";
import { useEditorStore } from "@/frontend/store/editorStore";
import { projectDuration } from "@/frontend/lib/editorTypes";
import { cn } from "@/lib/utils";

function fmt(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PlaybackBar({ onFullscreen }: { onFullscreen?: () => void }) {
  const { project, playhead, playing, selectedClipId, setPlaying, undo, redo, canUndo, canRedo } =
    useEditorStore();

  const dur = projectDuration(project.clips);

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      {/* Timecode */}
      <div className="min-w-[90px] text-xs tabular-nums">
        <span className="font-semibold text-white">{fmt(playhead)}</span>
        <span className="text-white/40"> / {fmt(dur)}</span>
      </div>

      {/* Play/pause */}
      <button
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => setPlaying(!playing)}
        className="mx-auto grid size-10 place-items-center rounded-full bg-white/10 text-white active:scale-95"
      >
        {playing ? (
          <Pause className="size-5 fill-white" />
        ) : (
          <Play className="size-5 translate-x-0.5 fill-white" />
        )}
      </button>

      {/* Right controls */}
      <div className="flex items-center gap-1">
        {selectedClipId && (
          <button
            aria-label="Add keyframe"
            className="grid size-8 place-items-center rounded-full bg-white/10 text-white/80 text-sm font-bold"
          >
            ◇+
          </button>
        )}
        <button
          aria-label="Undo"
          disabled={!canUndo()}
          onClick={undo}
          className={cn(
            "grid size-8 place-items-center rounded-full bg-white/10",
            canUndo() ? "text-white" : "text-white/30",
          )}
        >
          <RotateCcw className="size-4" />
        </button>
        <button
          aria-label="Redo"
          disabled={!canRedo()}
          onClick={redo}
          className={cn(
            "grid size-8 place-items-center rounded-full bg-white/10",
            canRedo() ? "text-white" : "text-white/30",
          )}
        >
          <RotateCw className="size-4" />
        </button>
        <button
          aria-label="Fullscreen preview"
          onClick={onFullscreen}
          className="grid size-8 place-items-center rounded-full bg-white/10 text-white"
        >
          <Maximize2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

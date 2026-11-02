import { useState } from "react";
import { Check } from "lucide-react";
import { useEditorStore } from "@/frontend/store/editorStore";
import { cn } from "@/lib/utils";

const PRESETS = [0.5, 1, 2, 3] as const;

export function SpeedSheet({ onClose }: { onClose: () => void }) {
  const { project, selectedClipId, updateClip } = useEditorStore();
  const clip = project.clips.find((c) => c.id === selectedClipId);
  const [speed, setSpeed] = useState(clip?.speed ?? 1);

  function apply(s: number) {
    const clamped = Math.max(0.1, Math.min(10, s));
    setSpeed(clamped);
    if (clip) updateClip(clip.id, { speed: clamped });
  }

  return (
    <div className="rounded-t-[28px] bg-[#1C1C1E] px-5 pb-safe">
      <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/20" />
      <div className="flex items-center justify-between pt-4 pb-3">
        <p className="text-base font-bold text-white">Speed</p>
        <button onClick={onClose} className="grid size-8 place-items-center rounded-full bg-white/10">
          <Check className="size-4 text-white" />
        </button>
      </div>

      {/* Preset chips */}
      <div className="flex gap-2 pb-4">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => apply(p)}
            className={cn(
              "flex-1 rounded-full py-2 text-sm font-bold transition-colors",
              Math.abs(speed - p) < 0.01
                ? "bg-[#FE2C55] text-white"
                : "bg-[#2C2C2E] text-white/70",
            )}
          >
            {p}×
          </button>
        ))}
      </div>

      {/* Fine-grained slider */}
      <div className="pb-2">
        <div className="mb-1 flex justify-between text-xs text-white/50">
          <span>0.1×</span>
          <span className="font-bold text-white">{speed.toFixed(2)}×</span>
          <span>10×</span>
        </div>
        <input
          type="range"
          min={0.1}
          max={10}
          step={0.1}
          value={speed}
          onChange={(e) => apply(Number(e.target.value))}
          className="w-full"
          style={{ accentColor: "#FE2C55" }}
        />
      </div>

      {/* Curve speed ramps (stub) */}
      <button className="mb-4 w-full rounded-xl bg-[#2C2C2E] py-3 text-sm font-semibold text-white/50">
        Curve speed ramp (coming soon)
      </button>
    </div>
  );
}

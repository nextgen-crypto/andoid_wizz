import { useState } from "react";
import { Check } from "lucide-react";
import { useEditorStore } from "@/frontend/store/editorStore";
import { type FilterPreset, adjustToCssFilter, DEFAULT_ADJUST } from "@/frontend/lib/editorTypes";
import { cn } from "@/lib/utils";

const PRESETS: { id: FilterPreset; label: string; color: string }[] = [
  { id: "none", label: "None", color: "#3a3a3a" },
  { id: "vivid", label: "Vivid", color: "#4a2060" },
  { id: "warm", label: "Warm", color: "#6b3000" },
  { id: "cool", label: "Cool", color: "#003060" },
  { id: "bw", label: "B&W", color: "#1a1a1a" },
  { id: "film", label: "Film", color: "#2a1a00" },
  { id: "fade", label: "Fade", color: "#3a3a50" },
  { id: "chrome", label: "Chrome", color: "#202040" },
  { id: "pro", label: "Pro", color: "#101020" },
  { id: "matte", label: "Matte", color: "#2a2a30" },
  { id: "golden", label: "Golden", color: "#4a2a00" },
];

export function FiltersSheet({ onClose }: { onClose: () => void }) {
  const { project, setGlobalFilter, selectedClipId, updateClip } = useEditorStore();
  const clip = project.clips.find((c) => c.id === selectedClipId);
  const current = clip ? clip.filter : project.globalFilter;

  const [local, setLocal] = useState<FilterPreset>(current);
  const [intensity, setIntensity] = useState(100);

  function select(f: FilterPreset) {
    setLocal(f);
    if (clip) updateClip(clip.id, { filter: f });
    else setGlobalFilter(f);
  }

  return (
    <div className="flex flex-col rounded-t-[28px] bg-[#1C1C1E] pb-safe">
      <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/20" />
      <div className="flex items-center justify-between px-5 pt-3 pb-2">
        <p className="text-base font-bold text-white">Filters</p>
        <button
          onClick={onClose}
          className="grid size-8 place-items-center rounded-full bg-white/10"
        >
          <Check className="size-4 text-white" />
        </button>
      </div>

      {/* Filter strip */}
      <div className="overflow-x-auto px-4 no-scrollbar">
        <div className="flex gap-3 pb-4">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => select(p.id)}
              className="flex shrink-0 flex-col items-center gap-1.5"
            >
              <div
                className={cn(
                  "size-[72px] rounded-xl",
                  local === p.id && "ring-[3px] ring-white ring-offset-2 ring-offset-[#1C1C1E]",
                )}
                style={{
                  background: p.color,
                  filter: adjustToCssFilter(DEFAULT_ADJUST, p.id),
                }}
              />
              <span
                className={cn(
                  "text-[11px]",
                  local === p.id ? "font-bold text-white" : "text-white/60",
                )}
              >
                {p.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Intensity slider */}
      <div className="px-5 pb-4">
        <div className="mb-1 flex items-center justify-between text-xs text-white/60">
          <span>Intensity</span>
          <span>{intensity}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
          className="w-full"
          style={{ accentColor: "#FE2C55" }}
        />
      </div>
    </div>
  );
}

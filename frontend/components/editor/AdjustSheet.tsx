import { useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { useEditorStore } from "@/frontend/store/editorStore";
import { DEFAULT_ADJUST, type AdjustValues } from "@/frontend/lib/editorTypes";
import { cn } from "@/lib/utils";

type AdjustKey = keyof AdjustValues;

interface Param {
  key: AdjustKey;
  label: string;
  icon: string;
  min: number;
  max: number;
}

const PARAMS: Param[] = [
  { key: "brightness",  label: "Brightness",  icon: "☀️", min: -100, max: 100 },
  { key: "contrast",    label: "Contrast",    icon: "◐",  min: -100, max: 100 },
  { key: "saturation",  label: "Saturation",  icon: "🎨", min: -100, max: 100 },
  { key: "brilliance",  label: "Brilliance",  icon: "✨", min: -100, max: 100 },
  { key: "sharpness",   label: "Sharpness",   icon: "🔍", min: 0,    max: 100 },
  { key: "highlight",   label: "Highlight",   icon: "🔆", min: -100, max: 100 },
  { key: "shadow",      label: "Shadow",      icon: "🌑", min: -100, max: 100 },
  { key: "temperature", label: "Temp",        icon: "🌡",  min: -100, max: 100 },
  { key: "tint",        label: "Tint",        icon: "💜", min: -100, max: 100 },
  { key: "fade",        label: "Fade",        icon: "🌫", min: 0,    max: 100 },
  { key: "vignette",    label: "Vignette",    icon: "⬤",  min: 0,    max: 100 },
  { key: "grain",       label: "Grain",       icon: "⠿",  min: 0,    max: 100 },
];

export function AdjustSheet({ onClose }: { onClose: () => void }) {
  const { project, setGlobalAdjust, selectedClipId, updateClip } = useEditorStore();
  const clip = project.clips.find((c) => c.id === selectedClipId);
  const initial = clip ? clip.adjust : project.globalAdjust;

  const [local, setLocal] = useState<AdjustValues>({ ...initial });
  const [activeKey, setActiveKey] = useState<AdjustKey>("brightness");
  const [applyAll, setApplyAll] = useState(false);

  const hasChanges = (Object.keys(local) as AdjustKey[]).some(
    (k) => local[k] !== DEFAULT_ADJUST[k],
  );

  function update(key: AdjustKey, val: number) {
    setLocal((prev) => ({ ...prev, [key]: val }));
    // Live preview
    const next = { ...local, [key]: val };
    if (clip && !applyAll) {
      updateClip(clip.id, { adjust: next });
    } else {
      setGlobalAdjust(next);
      if (applyAll) {
        useEditorStore
          .getState()
          .project.clips.forEach((c) => updateClip(c.id, { adjust: next }));
      }
    }
  }

  function handleReset() {
    setLocal({ ...DEFAULT_ADJUST });
    if (clip && !applyAll) updateClip(clip.id, { adjust: { ...DEFAULT_ADJUST } });
    else setGlobalAdjust({ ...DEFAULT_ADJUST });
  }

  function handleApply() {
    if (clip && !applyAll) updateClip(clip.id, { adjust: local });
    else setGlobalAdjust(local);
    onClose();
  }

  const activeParam = PARAMS.find((p) => p.key === activeKey)!;
  const val = local[activeKey];

  return (
    <div className="flex flex-col rounded-t-[28px] bg-[#1C1C1E] pb-safe">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <button
          onClick={handleReset}
          disabled={!hasChanges}
          className={cn(
            "flex items-center gap-1.5 text-sm font-semibold",
            hasChanges ? "text-white/70" : "text-white/30",
          )}
        >
          <RotateCcw className="size-4" /> Reset
        </button>
        <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
        <button
          onClick={handleApply}
          className="grid size-8 place-items-center rounded-full bg-white/10 text-white"
        >
          <Check className="size-4" />
        </button>
      </div>

      {/* Slider for active param */}
      <div className="px-5 py-3">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-semibold text-white">{activeParam.label}</span>
          <span className="tabular-nums text-white/60">{val > 0 ? `+${val}` : val}</span>
        </div>
        <input
          type="range"
          min={activeParam.min}
          max={activeParam.max}
          value={val}
          onChange={(e) => update(activeKey, Number(e.target.value))}
          className="w-full accent-[#FE2C55]"
          style={{ accentColor: "#FE2C55" }}
          aria-label={activeParam.label}
        />
      </div>

      {/* Param tiles */}
      <div className="overflow-x-auto px-4 no-scrollbar">
        <div className="flex gap-2 pb-3">
          {PARAMS.map((p) => {
            const isActive = p.key === activeKey;
            const isDirty = local[p.key] !== DEFAULT_ADJUST[p.key];
            return (
              <button
                key={p.key}
                onClick={() => setActiveKey(p.key)}
                className={cn(
                  "flex shrink-0 flex-col items-center gap-1 rounded-2xl px-3 py-2.5 transition-colors",
                  isActive ? "ring-2 ring-white bg-white/10" : "bg-[#2C2C2E]",
                )}
              >
                <span className="text-xl">{p.icon}</span>
                <span className="text-[10px] font-semibold text-white">{p.label}</span>
                {isDirty && (
                  <span className="size-1.5 rounded-full bg-white" />
                )}
              </button>
            );
          })}
          {/* Auto adjust */}
          <button
            onClick={() => {
              const auto: AdjustValues = {
                ...DEFAULT_ADJUST,
                brightness: 10, contrast: 8, saturation: 12, brilliance: 5,
              };
              setLocal(auto);
              if (clip && !applyAll) updateClip(clip.id, { adjust: auto });
              else setGlobalAdjust(auto);
            }}
            className="flex shrink-0 flex-col items-center gap-1 rounded-2xl bg-[#2C2C2E] px-3 py-2.5"
          >
            <span className="text-xl">🪄</span>
            <span className="text-[10px] font-semibold text-white">Auto</span>
          </button>
        </div>
      </div>

      {/* Apply to all toggle */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
        <span className="text-sm text-white/70">Apply to all clips</span>
        <button
          role="switch"
          aria-checked={applyAll}
          onClick={() => setApplyAll(!applyAll)}
          className={cn(
            "relative h-6 w-11 rounded-full transition-colors",
            applyAll ? "bg-[#FE2C55]" : "bg-white/20",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
              applyAll ? "left-[22px]" : "left-0.5",
            )}
          />
        </button>
      </div>
    </div>
  );
}

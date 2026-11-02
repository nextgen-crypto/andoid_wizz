import {
  ChevronDown, Scissors, ImagePlus, Trash2, Gauge, Crop,
  Zap, UserX, Image, Wand2, Volume2, RefreshCw,
  SlidersHorizontal, Filter, FastForward, Camera,
  CircleOff, EyeOff, Mic, Sliders,
} from "lucide-react";
import { useEditorStore } from "@/frontend/store/editorStore";
import { cn } from "@/lib/utils";

type ClipTool = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
  disabled?: boolean;
};

export function ClipToolbar({
  onReplace,
}: {
  onReplace: () => void;
}) {
  const {
    project, playhead, selectedClipId,
    selectClip, openSheet, removeClip, splitClipAt,
  } = useEditorStore();
  const clip = project.clips.find((c) => c.id === selectedClipId);

  function handleDelete() {
    if (!selectedClipId) return;
    removeClip(selectedClipId);
    selectClip(null);
  }

  function handleSplit() {
    if (!selectedClipId) return;
    splitClipAt(selectedClipId, playhead);
  }

  const tools: ClipTool[] = [
    { id: "split",       label: "Split",       icon: Scissors,       action: handleSplit },
    { id: "replace",     label: "Replace",     icon: ImagePlus,      action: onReplace },
    { id: "delete",      label: "Delete",      icon: Trash2,         action: handleDelete },
    { id: "speed",       label: "Speed",       icon: Gauge,          action: () => openSheet("speed") },
    { id: "crop",        label: "Crop",        icon: Crop,           action: () => openSheet("crop") },
    { id: "effects",     label: "Effects",     icon: Zap,            action: () => openSheet("effects") },
    { id: "cutout",      label: "Cutout",      icon: UserX,          action: () => {} },
    { id: "background",  label: "Background",  icon: Image,          action: () => {} },
    { id: "magic",       label: "Magic",       icon: Wand2,          action: () => openSheet("magic") },
    { id: "volume",      label: "Volume",      icon: Volume2,        action: () => openSheet("volume") },
    { id: "noise",       label: "Reduce noise",icon: RefreshCw,      action: () => {} },
    { id: "rotate",      label: "Rotate",      icon: RefreshCw,      action: () => {} },
    { id: "retouch",     label: "Retouch",     icon: SlidersHorizontal, action: () => openSheet("retouch") },
    { id: "clip-filters",label: "Filters",     icon: Filter,         action: () => openSheet("filters") },
    { id: "clip-adjust", label: "Adjust",      icon: Sliders,        action: () => openSheet("adjust") },
    { id: "reverse",     label: "Reverse",     icon: FastForward,    action: () => {} },
    { id: "freeze",      label: "Freeze",      icon: Camera,         action: () => {} },
    { id: "mask",        label: "Mask",        icon: CircleOff,      action: () => openSheet("mask") },
    { id: "opacity",     label: "Opacity",     icon: EyeOff,         action: () => openSheet("opacity") },
    { id: "voice",       label: "Voice effect",icon: Mic,            action: () => openSheet("voiceEffect") },
  ];

  return (
    <div className="flex items-center overflow-x-auto gap-1 px-2 py-2 no-scrollbar">
      {/* Collapse button */}
      <button
        onClick={() => selectClip(null)}
        aria-label="Deselect clip"
        className="flex shrink-0 flex-col items-center gap-1 rounded-2xl bg-[#2C2C2E] px-3 py-2.5"
      >
        <ChevronDown className="size-5 text-white" />
        <span className="text-[11px] font-semibold text-white">Done</span>
      </button>

      {tools.map((t) => (
        <button
          key={t.id}
          onClick={t.action}
          disabled={t.disabled}
          className={cn(
            "flex shrink-0 flex-col items-center gap-1 rounded-2xl bg-[#2C2C2E] px-3 py-2.5",
            "transition-colors active:scale-95",
            t.disabled && "opacity-40",
            t.id === "delete" && "bg-red-900/40",
          )}
        >
          <t.icon className={cn("size-5 text-white", t.id === "delete" && "text-red-400")} />
          <span className={cn("text-[11px] font-semibold text-white", t.id === "delete" && "text-red-400")}>
            {t.label}
          </span>
        </button>
      ))}
    </div>
  );
}

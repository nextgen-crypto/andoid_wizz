import {
  Music, Type, Sparkles, WandSparkles, Captions, Layers,
  Sticker, Sliders, Filter, SlidersHorizontal, Zap,
  Scissors,
} from "lucide-react";
import type { ActiveSheet } from "@/frontend/store/editorStore";
import { useEditorStore } from "@/frontend/store/editorStore";
import { cn } from "@/lib/utils";

const TOOLS: {
  id: ActiveSheet;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  needsSound?: boolean;
}[] = [
  { id: "filters",   label: "Filters",    icon: Filter },
  { id: "adjust",    label: "Adjust",     icon: Sliders },
  { id: "sound",     label: "Sound",      icon: Music },
  { id: "text",      label: "Text",       icon: Type },
  { id: "effects",   label: "Effects",    icon: Zap },
  { id: "magic",     label: "Magic",      icon: WandSparkles },
  { id: "captions",  label: "Captions",   icon: Captions },
  { id: "overlay",   label: "Overlay",    icon: Layers },
  { id: "stickers",  label: "Stickers",   icon: Sticker },
  // "Edit" opens clip toolbar by selecting clip under playhead
];

export function MainToolbar({
  onEditClip,
}: {
  onEditClip: () => void;
}) {
  const { openSheet, project, selectedClipId } = useEditorStore();
  const hasSoundTrack = !!project.soundTrack;

  return (
    <div className="flex items-center overflow-x-auto gap-1 px-2 py-2 no-scrollbar">
      {/* Edit — selects clip under playhead */}
      <ToolButton
        label="Edit"
        icon={Scissors}
        onClick={onEditClip}
        active={selectedClipId !== null}
      />
      {TOOLS.map((t) => (
        <ToolButton
          key={t.id}
          label={t.label}
          icon={t.icon}
          disabled={!!(t.needsSound && !hasSoundTrack)}
          onClick={() => openSheet(t.id)}
        />
      ))}
      <ToolButton
        label="Sound sync"
        icon={SlidersHorizontal}
        disabled={!hasSoundTrack}
        onClick={() => {}}
      />
    </div>
  );
}

function ToolButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  active,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex shrink-0 flex-col items-center gap-1 rounded-2xl px-3 py-2.5",
        "transition-colors active:scale-95",
        active ? "bg-white/20" : "bg-[#2C2C2E]",
        disabled && "opacity-40",
      )}
    >
      <Icon className="size-5 text-white" />
      <span className="text-[11px] font-semibold text-white">{label}</span>
    </button>
  );
}

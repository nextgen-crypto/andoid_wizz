import { useState } from "react";
import { Check } from "lucide-react";
import { useEditorStore } from "@/frontend/store/editorStore";
import { type TextLayer, projectDuration } from "@/frontend/lib/editorTypes";
import { cn } from "@/lib/utils";

const COLORS = [
  "#ffffff",
  "#000000",
  "#ffee00",
  "#ff3366",
  "#00ccff",
  "#66ff88",
  "#ff9900",
  "#cc44ff",
];
const FONTS_SIZE = [18, 24, 32, 42] as const;
const ANIMS = ["none", "fade", "slide", "pop"] as const;

export function TextSheet({ onClose }: { onClose: () => void }) {
  const { project, playhead, addTextLayer } = useEditorStore();
  const [text, setText] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [fontSize, setFontSize] = useState<number>(24);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [bg, setBg] = useState<TextLayer["bg"]>("none");
  const [animIn, setAnimIn] = useState<TextLayer["animIn"]>("fade");

  function add() {
    if (!text.trim()) return;
    const dur = projectDuration(project.clips);
    const layer: TextLayer = {
      id: `txt-${Date.now()}`,
      text: text.trim(),
      x: 0.5,
      y: 0.4,
      scale: 1,
      rotation: 0,
      color,
      fontSize,
      bold,
      italic,
      align: "center",
      bg,
      animIn,
      animOut: "none",
      startTime: playhead,
      endTime: Math.min(playhead + 5, dur || 10),
    };
    addTextLayer(layer);
    onClose();
  }

  return (
    <div className="rounded-t-[28px] bg-[#1C1C1E] px-4 pb-safe">
      <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/20" />
      <div className="flex items-center justify-between pt-4 pb-3">
        <p className="text-base font-bold text-white">Add Text</p>
        <button
          onClick={onClose}
          className="grid size-8 place-items-center rounded-full bg-white/10"
        >
          <Check className="size-4 text-white" />
        </button>
      </div>

      {/* Text input */}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type something…"
        maxLength={120}
        autoFocus
        className="w-full rounded-xl border border-white/15 bg-[#2C2C2E] px-4 py-3 text-lg text-white outline-none placeholder:text-white/30 focus:border-white/40"
      />

      {/* Colors */}
      <div className="mt-3 flex gap-2">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            style={{ backgroundColor: c }}
            className={cn(
              "size-7 rounded-full border-2 transition-transform",
              color === c ? "border-white scale-110" : "border-transparent",
            )}
          />
        ))}
      </div>

      {/* Font size row */}
      <div className="mt-3 flex items-center gap-2">
        {FONTS_SIZE.map((fs) => (
          <button
            key={fs}
            onClick={() => setFontSize(fs)}
            className={cn(
              "flex-1 rounded-full py-1.5 text-sm font-bold transition-colors",
              fontSize === fs ? "bg-white text-black" : "bg-[#2C2C2E] text-white/70",
            )}
          >
            {fs}px
          </button>
        ))}
        <button
          onClick={() => setBold(!bold)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-bold transition-colors",
            bold ? "bg-white text-black" : "bg-[#2C2C2E] text-white/70",
          )}
        >
          B
        </button>
        <button
          onClick={() => setItalic(!italic)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-bold italic transition-colors",
            italic ? "bg-white text-black" : "bg-[#2C2C2E] text-white/70",
          )}
        >
          I
        </button>
      </div>

      {/* Background style */}
      <div className="mt-3 flex gap-2">
        {(["none", "dark", "light"] as const).map((b) => (
          <button
            key={b}
            onClick={() => setBg(b)}
            className={cn(
              "flex-1 rounded-full py-1.5 text-xs font-semibold transition-colors",
              b === "dark" ? "bg-black/60 text-white" : "",
              b === "light" ? "bg-white text-black" : "",
              b === "none" ? "bg-[#2C2C2E] text-white/70" : "",
              bg === b && "ring-2 ring-[#FE2C55]",
            )}
          >
            {b === "none" ? "No bg" : b === "dark" ? "Dark" : "Light"}
          </button>
        ))}
      </div>

      {/* Animation */}
      <div className="mt-3 flex gap-2">
        {ANIMS.map((a) => (
          <button
            key={a}
            onClick={() => setAnimIn(a)}
            className={cn(
              "flex-1 rounded-full py-1.5 text-xs font-semibold capitalize transition-colors",
              animIn === a ? "bg-[#FE2C55] text-white" : "bg-[#2C2C2E] text-white/70",
            )}
          >
            {a}
          </button>
        ))}
      </div>

      <button
        onClick={add}
        disabled={!text.trim()}
        className="mt-4 mb-2 w-full rounded-full bg-[#FE2C55] py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        Add to Video
      </button>
    </div>
  );
}

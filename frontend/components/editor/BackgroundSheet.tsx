import { useEditorStore } from "@/frontend/store/editorStore";
import { cn } from "@/lib/utils";

const SOLID_COLORS = [
  "#000000",
  "#ffffff",
  "#1a1a2e",
  "#0f3460",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#16a34a",
  "#0891b2",
  "#d97706",
  "#374151",
  "#f9fafb",
];

export function BackgroundSheet({ onClose }: { onClose: () => void }) {
  const { project, setBgColor } = useEditorStore();
  const current = project.bgColor ?? "#000000";
  const isTransparent = current === "transparent";

  return (
    <div className="rounded-t-[28px] bg-[#1C1C1E] px-4 pb-safe">
      <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/20" />
      <div className="pt-4 pb-3">
        <p className="text-base font-bold text-white">Canvas Background</p>
        <p className="mt-0.5 text-xs text-white/50">Visible where no clip fills the frame</p>
      </div>

      {/* Transparent option */}
      <button
        onClick={() => {
          setBgColor("transparent");
          onClose();
        }}
        className={cn(
          "mb-3 flex w-full items-center gap-3 rounded-2xl border p-3 transition-colors",
          isTransparent ? "border-[#FE2C55] bg-[#FE2C55]/10" : "border-white/10 bg-[#2C2C2E]",
        )}
      >
        <span
          className="size-8 shrink-0 rounded-lg border border-white/20"
          style={{
            backgroundImage: "repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 0 0 / 12px 12px",
          }}
        />
        <span className="text-sm font-semibold text-white">Transparent</span>
        {isTransparent && <span className="ml-auto text-xs font-bold text-[#FE2C55]">✓</span>}
      </button>

      {/* Solid colors grid */}
      <p className="mb-2 text-xs font-semibold text-white/50 uppercase tracking-wide">
        Solid Colors
      </p>
      <div className="grid grid-cols-6 gap-2 pb-4">
        {SOLID_COLORS.map((c) => {
          const active = current === c && !isTransparent;
          return (
            <button
              key={c}
              onClick={() => {
                setBgColor(c);
                onClose();
              }}
              className={cn(
                "aspect-square rounded-xl border-2 transition-transform active:scale-95",
                active ? "border-[#FE2C55] scale-110" : "border-transparent",
              )}
              style={{ backgroundColor: c }}
            />
          );
        })}
      </div>
    </div>
  );
}

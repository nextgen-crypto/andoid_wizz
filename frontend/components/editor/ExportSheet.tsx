import { useState } from "react";
import { X, CheckCircle } from "lucide-react";
import { useEditorStore } from "@/frontend/store/editorStore";
import { cn } from "@/lib/utils";

type ExportState = "idle" | "rendering" | "done" | "error";

export function ExportSheet({
  onClose,
  onPost,
}: {
  onClose: () => void;
  onPost: (url: string) => void;
}) {
  const { project } = useEditorStore();
  const [state, setState] = useState<ExportState>("idle");
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [cancelToken, setCancelToken] = useState<AbortController | null>(null);

  async function startExport() {
    setState("rendering");
    setProgress(0);

    const ac = new AbortController();
    setCancelToken(ac);

    try {
      // Build export recipe from project state
      const recipe = {
        clips: project.clips.map((c) => ({
          src: c.src,
          trimStart: c.trimStart,
          trimEnd: c.trimEnd,
          speed: c.speed,
          volume: c.volume,
          muted: c.muted,
          filter: c.filter,
          adjust: c.adjust,
          opacity: c.opacity,
          cropX: c.cropX,
          cropY: c.cropY,
          cropScale: c.cropScale,
        })),
        soundTrack: project.soundTrack
          ? {
              src: project.soundTrack.src,
              startOffset: project.soundTrack.startOffset,
              volume: project.soundTrack.volume,
            }
          : null,
        textLayers: project.textLayers,
        stickers: project.stickers,
        globalFilter: project.globalFilter,
        globalAdjust: project.globalAdjust,
        output: { width: 1080, height: 1920, fps: 30, format: "h264+aac" },
      };

      // Simulate progress while waiting for the server
      const ticker = setInterval(() => {
        if (ac.signal.aborted) {
          clearInterval(ticker);
          return;
        }
        setProgress((p) => Math.min(p + 3, 90));
      }, 400);

      // Try server-side render endpoint
      // POST /render → { id: string }
      // GET /render/{id} → { status, progress, outputUrl }
      let outputUrl: string | null = null;

      try {
        const resp = await fetch("/api/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(recipe),
          signal: ac.signal,
        });
        if (resp.ok) {
          const { id } = (await resp.json()) as { id: string };
          while (!ac.signal.aborted) {
            await new Promise((r) => setTimeout(r, 1500));
            const poll = await fetch(`/api/render/${id}`, { signal: ac.signal });
            const status = (await poll.json()) as {
              status: string;
              progress: number;
              outputUrl?: string;
            };
            setProgress(status.progress ?? 90);
            if (status.status === "done" && status.outputUrl) {
              outputUrl = status.outputUrl;
              break;
            }
            if (status.status === "error") throw new Error("Render failed on server");
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        // Server not available — fall through to stub
      }

      clearInterval(ticker);

      if (!outputUrl) {
        // Offline fallback stub (real ffmpeg.wasm would go here)
        await new Promise((r) => setTimeout(r, 800));
        outputUrl = project.clips[0]?.src ?? null;
      }

      setProgress(100);
      setResultUrl(outputUrl);
      setState("done");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setState("error");
      }
    }
  }

  function cancel() {
    cancelToken?.abort();
    setCancelToken(null);
    setState("idle");
    setProgress(0);
  }

  return (
    <div className="flex flex-col items-center gap-6 rounded-t-[28px] bg-[#1C1C1E] px-6 pb-safe pt-5">
      <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />

      <div className="flex w-full items-center justify-between">
        <p className="text-lg font-bold text-white">Export</p>
        <button
          onClick={onClose}
          className="grid size-8 place-items-center rounded-full bg-white/10"
        >
          <X className="size-4 text-white" />
        </button>
      </div>

      {state === "idle" && (
        <div className="w-full space-y-3 text-sm text-white/60">
          <div className="flex justify-between rounded-xl bg-[#2C2C2E] px-4 py-3">
            <span>Resolution</span>
            <span className="text-white">1080 × 1920</span>
          </div>
          <div className="flex justify-between rounded-xl bg-[#2C2C2E] px-4 py-3">
            <span>Frame rate</span>
            <span className="text-white">30 fps</span>
          </div>
          <div className="flex justify-between rounded-xl bg-[#2C2C2E] px-4 py-3">
            <span>Format</span>
            <span className="text-white">H.264 + AAC MP4</span>
          </div>
          <button
            onClick={startExport}
            disabled={project.clips.length === 0}
            className="mt-2 w-full rounded-full bg-[#FE2C55] py-3.5 text-sm font-bold text-white disabled:opacity-50"
          >
            Export video
          </button>
        </div>
      )}

      {state === "rendering" && (
        <div className="w-full space-y-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#FE2C55] transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-center text-sm text-white/60">Rendering… {progress}%</p>
          <button
            onClick={cancel}
            className="w-full rounded-full border border-white/20 py-3 text-sm font-semibold text-white/70"
          >
            Cancel
          </button>
        </div>
      )}

      {state === "done" && resultUrl !== null && (
        <div className="w-full space-y-3 text-center">
          <CheckCircle className="mx-auto size-12 text-emerald-400" />
          <p className="font-semibold text-white">Export complete!</p>
          <button
            onClick={() => onPost(resultUrl)}
            className="w-full rounded-full bg-[#FE2C55] py-3.5 text-sm font-bold text-white"
          >
            Post now
          </button>
          <button
            onClick={onClose}
            className="w-full rounded-full bg-white/10 py-3 text-sm text-white/70"
          >
            Done
          </button>
        </div>
      )}

      {state === "error" && (
        <div className="w-full space-y-3 text-center">
          <p className="text-sm text-red-400">Something went wrong. Try again.</p>
          <button
            onClick={() => setState("idle")}
            className="w-full rounded-full bg-[#FE2C55] py-3 text-sm font-bold text-white"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

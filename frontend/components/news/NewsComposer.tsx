import { useState, useRef } from "react";
import { Image, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/frontend/hooks/useSession";
import { useAuthGate } from "@/frontend/hooks/useAuthGate";
import { cn } from "@/lib/utils";

export function NewsComposer({ onPosted }: { onPosted?: () => void }) {
  const { user } = useSession();
  const requireAuth = useAuthGate();
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function publish() {
    const text = draft.trim();
    if (!text && !imagePreview) return;
    if (!requireAuth()) return;
    setPosting(true);
    try {
      const { data, error } = await supabase
        .from("posts")
        .insert({ author_id: user!.id, caption: text || "Photo update", status: "published" })
        .select("id")
        .single();
      if (error) throw error;
      setDraft("");
      setImagePreview(null);
      toast("Posted to News.");
      onPosted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post. Try again.");
    } finally {
      setPosting(false);
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be under 10MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-sm font-bold text-foreground">
          {(user?.email?.[0] ?? "W").toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What's happening?"
            aria-label="Post to News"
            rows={3}
            className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          />
          {imagePreview && (
            <div className="relative mt-2">
              <img src={imagePreview} alt="Upload preview" className="max-h-64 rounded-xl border border-border object-cover" />
              <button
                onClick={() => { setImagePreview(null); if (fileRef.current) fileRef.current.value = ""; }}
                aria-label="Remove image"
                className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/60 text-white"
              >
                <X className="size-4" />
              </button>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <button
              onClick={() => fileRef.current?.click()}
              aria-label="Add image"
              className="rounded-full p-2 text-brand hover:bg-secondary"
            >
              <Image className="size-5" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            <button
              onClick={() => void publish()}
              disabled={(!draft.trim() && !imagePreview) || posting}
              className={cn(
                "rounded-full bg-brand px-5 py-2 text-sm font-bold text-brand-foreground transition-opacity",
                (!draft.trim() && !imagePreview) || posting ? "opacity-50" : "hover:bg-brand/90",
              )}
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useRef } from "react";
import { Image, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/frontend/hooks/useSession";
import { useAuthGate } from "@/frontend/hooks/useAuthGate";
import { useServerFn } from "@tanstack/react-start";
import { fetchPostingCapabilities } from "@/backend/api/posts.functions";
import { uploadStoredObject, uploadAndSign } from "@/frontend/lib/storageUpload";
import { cn } from "@/lib/utils";

/** Extract #hashtags from the draft, lowercased and de-duplicated. */
function extractHashtags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\s+/)
        .map((w) => w.replace(/^#/, "").toLowerCase())
        .filter((w) => w.length > 1 && /^[\p{L}\p{N}_]+$/u.test(w)),
    ),
  ].slice(0, 20);
}

export function NewsComposer({ onPosted }: { onPosted?: () => void }) {
  const { user } = useSession();
  const requireAuth = useAuthGate();
  const inspectPostingSchema = useServerFn(fetchPostingCapabilities);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function uploadPhoto(): Promise<{ path: string; url: string | null } | null> {
    if (!photo || !user) return null;
    const path = `${user.id}/news-${Date.now()}.jpg`;
    const capabilities = await inspectPostingSchema();
    if (capabilities.media) {
      await uploadStoredObject("post-images", path, photo);
      return { path, url: null };
    }
    return { path, url: await uploadAndSign("post-images", path, photo, { width: 1280 }) };
  }

  async function publish() {
    const text = draft.trim();
    if (!text && !photo) return;
    if (!requireAuth()) return;
    setPosting(true);
    try {
      const uploaded = await uploadPhoto();
      const hashtags = extractHashtags(text);
      const { error } = await supabase.from("posts").insert({
        author_id: user!.id,
        caption: text || "Photo update",
        // Posts created here belong to the News feed, which filters on this
        // exact category — without it the post silently never appears.
        category: "News",
        image_url: uploaded?.url ?? null,
        ...(uploaded?.path ? { image_path: uploaded.path } : {}),
        hashtags,
        status: "published",
      });
      if (error) throw error;
      setDraft("");
      setPhoto(null);
      setImagePreview(null);
      if (fileRef.current) fileRef.current.value = "";
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
    setPhoto(file);
    setImagePreview(URL.createObjectURL(file));
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
              <img
                src={imagePreview}
                alt="Upload preview"
                className="max-h-64 rounded-xl border border-border object-cover"
              />
              <button
                onClick={() => {
                  setPhoto(null);
                  setImagePreview(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
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
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFile}
            />
            <button
              onClick={() => void publish()}
              disabled={(!draft.trim() && !photo) || posting}
              className={cn(
                "rounded-full bg-brand px-5 py-2 text-sm font-bold text-brand-foreground transition-opacity",
                (!draft.trim() && !photo) || posting ? "opacity-50" : "hover:bg-brand/90",
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

import { useState, useRef } from "react";
import { Image, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/frontend/hooks/useSession";
import { useAuthGate } from "@/frontend/hooks/useAuthGate";
import { useServerFn } from "@tanstack/react-start";
import { fetchPostingCapabilities } from "@/backend/api/posts.functions";
import { uploadStoredObject, uploadAndSign } from "@/frontend/lib/storageUpload";
import {
  extOf,
  friendlyPublishError,
  MEDIA_EXTS,
  mimeMismatch,
  typedBlobUrl,
} from "@/frontend/lib/mediaFormat";
import { Capacitor } from "@capacitor/core";
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
    // Label the object with the file's own (known) extension — an unfiltered
    // GIF/SVG/HEIC pick must not be filed as `.jpg`. Storage resolves the type.
    const ext = extOf(photo);
    const path = `${user.id}/news-${Date.now()}.${MEDIA_EXTS.image.has(ext) ? ext : "jpg"}`;
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
      if (Capacitor.isNativePlatform()) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session && (session.expires_at ?? 0) - Math.floor(Date.now() / 1000) < 60) {
            await supabase.auth.refreshSession();
          }
        } catch {
          /* non-fatal */
        }
      }
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
      toast.error(friendlyPublishError(e, "Could not post. Try again."));
    } finally {
      setPosting(false);
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Android providers hand real images out as application/* or with no type
    // at all — only a MIME that positively names another kind rejects.
    if (mimeMismatch(file, "image")) {
      toast.error("Please choose an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be under 10MB.");
      return;
    }
    setPhoto(file);
    const prelimUrl = typedBlobUrl(file);
    setImagePreview(prelimUrl);
    void (async () => {
      try {
        const bitmap = await Promise.race<ImageBitmap>([
          createImageBitmap(file),
          new Promise<never>((_, reject) =>
            window.setTimeout(() => reject(new Error("timeout")), 3000),
          ),
        ]);
        const scale = Math.min(1, 2048 / Math.max(bitmap.width || 1, bitmap.height || 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round((bitmap.width || 800) * scale);
        canvas.height = Math.round((bitmap.height || 800) * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          bitmap.close();
          return;
        }
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, "image/jpeg", 0.92),
        );
        if (!blob) return;
        const upgradedUrl = URL.createObjectURL(blob);
        setImagePreview((cur) => {
          if (cur !== prelimUrl) {
            URL.revokeObjectURL(upgradedUrl);
            return cur;
          }
          URL.revokeObjectURL(prelimUrl);
          return upgradedUrl;
        });
      } catch {
        /* keep prelimUrl */
      }
    })();
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
                  // Revoke via functional setter so we always get the current
                  // URL even if the background canvas upgrade already swapped it.
                  setImagePreview((cur) => {
                    if (cur) URL.revokeObjectURL(cur);
                    return null;
                  });
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

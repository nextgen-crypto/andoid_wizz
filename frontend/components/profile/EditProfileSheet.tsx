import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2 } from "lucide-react";
import { Sheet } from "@/frontend/components/overlays/Sheet";
import { CropSheet } from "@/frontend/components/create/CropSheet";
import { uploadAndSign } from "@/frontend/lib/storageUpload";
import { friendlyPublishError } from "@/frontend/lib/mediaFormat";
import type { MyProfile } from "@/frontend/hooks/useMyProfile";
import { supabase } from "@/integrations/supabase/client";

/** Try the browser's Face Detection API (available on Android WebView / Chrome). */
async function detectFaceCenter(blobUrl: string): Promise<{ x: number; y: number } | null> {
  const FaceDetectorCtor = (window as unknown as Record<string, unknown>)["FaceDetector"] as
    | (new (opts?: unknown) => {
        detect: (
          img: HTMLImageElement,
        ) => Promise<{ boundingBox: { x: number; y: number; width: number; height: number } }[]>;
      })
    | undefined;
  if (!FaceDetectorCtor) return null;
  try {
    const detector = new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 1 });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      const timer = window.setTimeout(() => reject(new Error("timeout")), 5000);
      el.onload = () => {
        window.clearTimeout(timer);
        resolve(el);
      };
      el.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("error"));
      };
      el.src = blobUrl;
    });
    const faces = await detector.detect(img);
    if (!faces.length) return null;
    // Pick the largest face by bounding-box area
    const face = [...faces].sort(
      (a, b) =>
        b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height,
    )[0]!;
    const bb = face.boundingBox;
    return {
      x: (bb.x + bb.width / 2) / img.naturalWidth,
      // Shift up slightly: center crop on forehead rather than nose-bridge
      y: Math.max(0.05, (bb.y + bb.height * 0.35) / img.naturalHeight),
    };
  } catch {
    return null;
  }
}

export function EditProfileSheet({
  open,
  onClose,
  userId,
  profile,
  fallbackName,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  profile: MyProfile | null;
  fallbackName: string | null;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Crop-sheet state
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<{ x: number; y: number } | undefined>(undefined);
  const cropBlobRef = useRef<string | null>(null); // tracks the revocable blob URL

  useEffect(() => {
    if (!open) return;
    setDisplayName(profile?.display_name ?? fallbackName ?? "");
    setUsername(profile?.username ?? "");
    setBio(profile?.bio ?? "");
    setIsPrivate(profile?.is_private ?? false);
    setAvatarUrl(profile?.avatar_url ?? null);
    setError(null);
    setNotice(null);
  }, [open, profile, fallbackName]);

  // Revoke the crop blob URL whenever the crop sheet closes
  useEffect(() => {
    if (cropSrc) return;
    if (cropBlobRef.current) {
      URL.revokeObjectURL(cropBlobRef.current);
      cropBlobRef.current = null;
    }
  }, [cropSrc]);

  async function pickAvatar(file: File) {
    setError(null);
    try {
      // Pre-read into memory so the blob URL is not backed by a content:// URI
      // (Android WebView can silently fail to render lazy URI-backed blobs).
      // Guard with a timeout — content:// arrayBuffer() can hang forever on some devices.
      const ab = await Promise.race<ArrayBuffer>([
        file.arrayBuffer(),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error("arrayBuffer timeout")), 5000),
        ),
      ]);
      const mime = file.type || "image/jpeg";
      const blob = new Blob([ab], { type: mime });
      const url = URL.createObjectURL(blob);
      cropBlobRef.current = url;
      setCropTarget(undefined);
      setCropSrc(url);

      // Run face detection concurrently — updates the initial position once ready
      detectFaceCenter(url)
        .then((center) => {
          // Default: center horizontally, 38% from top (typical head/face zone)
          setCropTarget(center ?? { x: 0.5, y: 0.38 });
        })
        .catch(() => {
          setCropTarget({ x: 0.5, y: 0.38 });
        });
    } catch (e) {
      setError(friendlyPublishError(e, "Could not load that picture."));
    }
  }

  async function handleCropDone(file: File) {
    setCropSrc(null);
    setUploading(true);
    setError(null);
    try {
      setAvatarUrl(
        await uploadAndSign("avatars", `${userId}/avatar-${Date.now()}.jpg`, file, {
          upsert: true,
          width: 400,
        }),
      );
    } catch (e) {
      setError(friendlyPublishError(e, "Could not upload that picture."));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    const cleanUsername = username.trim().replace(/^@/, "").toLowerCase();
    try {
      if (!displayName.trim()) throw new Error("Please add a name.");
      if (!cleanUsername) throw new Error("Please add a username.");

      const payload = {
        id: userId,
        username: cleanUsername,
        display_name: displayName.trim(),
        bio: bio.trim(),
        avatar_url: avatarUrl,
        is_private: isPrivate,
      };
      const { error: upsertError } = await supabase.from("profiles").upsert(payload);
      if (upsertError) throw upsertError;

      await supabase.auth.updateUser({
        data: { full_name: displayName.trim(), avatar_url: avatarUrl },
      });

      await queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      setNotice("Profile updated.");
      setTimeout(onClose, 500);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "";
      setError(
        raw.includes("duplicate")
          ? "That username is already taken."
          : friendlyPublishError(e, "Could not save your profile."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Edit profile">
        <div className="max-h-[70dvh] space-y-4 overflow-y-auto pb-2">
          <div className="flex items-center gap-3">
            <div className="relative">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Your profile picture"
                  className="size-16 rounded-2xl border border-border object-cover"
                />
              ) : (
                <span className="grid size-16 place-items-center rounded-2xl bg-brand text-lg font-bold text-brand-foreground">
                  {(displayName || "B").slice(0, 1).toUpperCase()}
                </span>
              )}
              <button
                onClick={() => fileRef.current?.click()}
                aria-label="Change profile picture"
                className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full bg-brand text-brand-foreground"
              >
                {uploading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Camera className="size-3.5" />
                )}
              </button>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Profile picture</p>
              <p className="text-xs text-muted-foreground">JPG or PNG, up to 5 MB.</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void pickAvatar(file);
                e.target.value = "";
              }}
            />
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Bio</span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={280}
              placeholder="Tell people what you post about"
              className="mt-1 w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand"
            />
            <span className="mt-1 block text-right text-[11px] text-muted-foreground">
              {bio.length}/280
            </span>
          </label>

          <div className="flex items-center gap-3 rounded-xl bg-secondary px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">Private account</span>
              <span className="block text-xs text-muted-foreground">
                Only approved followers see your posts
              </span>
            </span>
            <button
              role="switch"
              aria-checked={isPrivate}
              aria-label="Private account"
              onClick={() => setIsPrivate((v) => !v)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${isPrivate ? "bg-brand" : "bg-border"}`}
            >
              <span
                className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${isPrivate ? "left-[22px]" : "left-0.5"}`}
              />
            </button>
          </div>

          {error && <p className="text-xs font-semibold text-live">{error}</p>}
          {notice && <p className="text-xs font-semibold text-brand">{notice}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 rounded-full bg-secondary py-2.5 text-sm font-semibold text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || uploading}
              className="flex-1 rounded-full bg-brand py-2.5 text-sm font-bold text-brand-foreground disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </Sheet>

      {/* Avatar crop sheet — 1:1 forced, circular overlay, face-detected position */}
      {cropSrc && (
        <CropSheet
          open={Boolean(cropSrc)}
          onClose={() => setCropSrc(null)}
          imageSrc={cropSrc}
          onDone={handleCropDone}
          forcedAspect="1:1"
          circularPreview
          {...(cropTarget ? { initialTargetNorm: cropTarget } : {})}
        />
      )}
    </>
  );
}

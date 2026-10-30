import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { invalidateHomeCache } from "@/backend/api/home.functions";
import { fetchPostingCapabilities } from "@/backend/api/posts.functions";
import {
  AtSign,
  Camera,
  Check,
  ChevronRight,
  Clock,
  Crop,
  FolderOpen,
  ImagePlus,
  Link2,
  Loader2,
  MapPin,
  Mic,
  MicOff,
  Music,
  RefreshCw,
  Share2,
  Square,
  Users,
  Video,
  X,
} from "lucide-react";
import { Sheet } from "@/frontend/components/overlays/Sheet";
import {
  removeStoredObjects,
  uploadAndSign,
  uploadStoredObject,
} from "@/frontend/lib/storageUpload";
import {
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  bakeOrOriginal,
  captureVideoThumbnail,
  extOf,
  friendlyPublishError,
  mimeMismatch,
  probeVideoMetadata,
  resolveUploadMime,
  sizeError,
  type VideoMetadata,
} from "@/frontend/lib/mediaFormat";
import { extractHashtags } from "@/frontend/lib/hashtags";
import { BeautyCameraSheet } from "@/frontend/components/camera/BeautyCameraSheet";
import { CropSheet } from "@/frontend/components/create/CropSheet";
import {
  PhotoStep,
  StoryStep,
  ToggleRow,
  TRACKS,
  VideoStep,
} from "@/frontend/components/create/creationEngineSteps";

export { TRACKS };
import {
  applyFilterToFile,
  filterCss,
  filterPresets,
} from "@/frontend/components/camera/beautyFilters";
import { useSession } from "@/frontend/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import type { CreateKind } from "@/frontend/components/home/nav-items";
import { createActions } from "@/frontend/components/home/nav-items";

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;
const DRAFT_KEY_PREFIX = "wizz:create:drafts";

function draftKey(userId: string | null): string {
  return `${DRAFT_KEY_PREFIX}:${userId ?? "anonymous"}`;
}
const CATEGORIES = ["For You", "Trending", "Sports", "Music", "Tech", "Style", "Food", "Travel"];
const AUDIENCES = ["Public", "Followers", "Private"] as const;

const TEXT_BACKGROUNDS = ["#7c3aed", "#0f766e", "#1d4ed8", "#b45309", "#be123c", "#111827"];
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

type PhotoAdjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
};

function adjustmentFilterCss(adjust: PhotoAdjustments): string {
  return [
    adjust.brightness ? `brightness(${(1 + adjust.brightness / 100).toFixed(2)})` : "",
    adjust.contrast ? `contrast(${(1 + adjust.contrast / 100).toFixed(2)})` : "",
    adjust.saturation ? `saturate(${(1 + adjust.saturation / 100).toFixed(2)})` : "",
    adjust.temperature > 0 ? `sepia(${(adjust.temperature / 250).toFixed(2)})` : "",
    adjust.temperature < 0 ? `hue-rotate(${(adjust.temperature / 2).toFixed(0)}deg)` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

type Step =
  | "hub"
  | "photo"
  | "video"
  | "story"
  | "text"
  | "live-setup"
  | "live-room"
  | "composer"
  | "publishing"
  | "success"
  | "drafts";

interface Draft {
  id: string;
  kind: Exclude<CreateKind, "more">;
  mediaHint: "none" | "photo" | "video" | "text";
  caption: string;
  location: string;
  tags: string;
  category: string;
  audience: (typeof AUDIENCES)[number];
  allowComments: boolean;
  allowSharing: boolean;
  schedule: string;
  textBackground: string;
  storyOverlays: string[];
  createdAt: string;
}

function loadDrafts(userId: string | null): Draft[] {
  const read = (key: string): Draft[] => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
      return Array.isArray(parsed) ? (parsed as Draft[]) : [];
    } catch {
      return [];
    }
  };
  const own = read(draftKey(userId));
  if (!userId) return own;
  // Carry drafts created before sign-in into the first authenticated session.
  const anonymous = read(draftKey(null));
  return [...own, ...anonymous.filter((draft) => !own.some((item) => item.id === draft.id))].slice(
    0,
    20,
  );
}

const TITLES: Record<Step, string> = {
  hub: "Create",
  photo: "Photo",
  video: "Video",
  story: "Story",
  text: "Text",
  "live-setup": "Live setup",
  "live-room": "Live",
  composer: "New post",
  publishing: "Publishing",
  success: "Published",
  drafts: "Drafts",
};

export function CreationEngine({
  open,
  initial,
  onClose,
}: {
  open: boolean;
  initial: CreateKind | null;
  onClose: () => void;
}) {
  const { user, loading: sessionLoading } = useSession();
  const queryClient = useQueryClient();
  const bustCache = useServerFn(invalidateHomeCache);
  const inspectPostingSchema = useServerFn(fetchPostingCapabilities);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("hub");
  const [kind, setKind] = useState<Exclude<CreateKind, "more">>("photo");

  // media
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [presetId, setPresetId] = useState("none");
  const [intensity, setIntensity] = useState(100);
  const [adjust, setAdjust] = useState({
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
  });
  const [camera, setCamera] = useState<null | "photo" | "short">(null);
  const [cropping, setCropping] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoThumbnail, setVideoThumbnail] = useState<Blob | null>(null);
  const [videoPosterUrl, setVideoPosterUrl] = useState<string | null>(null);
  const videoSelectionRef = useRef(0);
  const [videoMeta, setVideoMeta] = useState<VideoMetadata | null>(null);
  // False while the metadata probe runs: the preview stays optimistic until the
  // probe *settles* — only a settled failure flips `playable` off.
  const [videoProbeDone, setVideoProbeDone] = useState(false);
  const [trim, setTrim] = useState<[number, number]>([0, 100]);
  const [speed, setSpeed] = useState<number>(1);
  const [muted, setMuted] = useState(false);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [textBody, setTextBody] = useState("");
  const [textBg, setTextBg] = useState(TEXT_BACKGROUNDS[0]!);
  const [storyOverlays, setStoryOverlays] = useState<string[]>([]);

  // composer
  const [caption, setCaption] = useState("");
  const [location, setLocation] = useState("");
  const [tags, setTags] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0] ?? "For You");
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]>("Public");
  const [allowComments, setAllowComments] = useState(true);
  const [allowSharing, setAllowSharing] = useState(true);
  const [schedule, setSchedule] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);

  // live
  const [liveTitle, setLiveTitle] = useState("");
  const [liveCategory, setLiveCategory] = useState(CATEGORIES[1] ?? "Trending");
  const [liveMic, setLiveMic] = useState(true);
  const [liveBeauty, setLiveBeauty] = useState(40);
  const [liveComments, setLiveComments] = useState(true);
  const [viewers, setViewers] = useState(12);
  const [liveChat, setLiveChat] = useState<string[]>(["Welcome to the stream!"]);
  const [liveReacts, setLiveReacts] = useState(0);

  useEffect(() => {
    if (!open) return;
    clearPhoto();
    clearVideo();
    setCamera(null);
    setCropping(false);
    setTextBody("");
    setTextBg(TEXT_BACKGROUNDS[0]!);
    setStoryOverlays([]);
    setCaption("");
    setLocation("");
    setTags("");
    setCategory(CATEGORIES[0] ?? "For You");
    setAudience("Public");
    setAllowComments(true);
    setAllowSharing(true);
    setSchedule("");
    setLiveTitle("");
    setLiveCategory(CATEGORIES[1] ?? "Trending");
    setLiveMic(true);
    setLiveBeauty(40);
    setLiveComments(true);
    setViewers(12);
    setLiveChat(["Welcome to the stream!"]);
    setLiveReacts(0);
    setProgress(0);
    setError(null);
    setStep(initial && initial !== "more" ? mapKind(initial) : "hub");
    if (initial && initial !== "more") setKind(initial);
    try {
      const pending = localStorage.getItem("wizz:pending-track");
      if (pending && TRACKS.some((t) => t.id === pending)) {
        setTrackId(pending);
        localStorage.removeItem("wizz:pending-track");
      }
    } catch {
      // storage unavailable
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !initial || initial === "more") return;
    setKind(initial);
    setStep(mapKind(initial));
  }, [initial, open]);

  useEffect(() => {
    if (step !== "live-room") return;
    const v = window.setInterval(() => setViewers((x) => x + Math.floor(Math.random() * 4)), 2500);
    const c = window.setInterval(
      () =>
        setLiveChat((prev) =>
          ["Nice!", "Love this", "Hello from Dar", "Big fan", "Waaaa"]
            .slice(0, 1)
            .concat(prev)
            .slice(0, 8),
        ),
      4000,
    );
    return () => {
      window.clearInterval(v);
      window.clearInterval(c);
    };
  }, [step]);

  // Revoke only the URL that actually changed. The old combined cleanup fired
  // whenever *either* URL changed and revoked both — updating the photo killed
  // a healthy video preview (revoked blob → broken-image icon before publish).
  useEffect(
    () => () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    },
    [photoUrl],
  );
  useEffect(
    () => () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    },
    [videoUrl],
  );
  useEffect(
    () => () => {
      if (videoPosterUrl) URL.revokeObjectURL(videoPosterUrl);
    },
    [videoPosterUrl],
  );

  function mapKind(k: CreateKind): Step {
    if (k === "photo" || k === "video" || k === "story" || k === "text") return k;
    if (k === "live") return "live-setup";
    return "hub";
  }

  function pick(kindNext: Exclude<CreateKind, "more">) {
    if (kindNext !== kind) {
      clearPhoto();
      clearVideo();
      setCaption("");
      setTextBody("");
      setLocation("");
      setTags("");
      setSchedule("");
      setAudience("Public");
      setAllowComments(true);
      setAllowSharing(true);
      setStoryOverlays([]);
    }
    setKind(kindNext);
    setError(null);
    setStep(mapKind(kindNext));
  }

  function attachPhoto(file: File) {
    // Attach-time diagnosis: untyped Android picks are the recurring failure.
    console.log("[attach] photo", file.name, file.type, file.size);
    if (file.size > IMAGE_MAX_BYTES) {
      setError(sizeError("image"));
      return;
    }
    if (mimeMismatch(file, "image")) {
      setError("That file is not an image.");
      return;
    }
    // Decode test (catches formats this WebView can't render) with a deadline:
    // some Android builds fire neither onload nor onerror — that used to leave
    // the picker silently doing nothing. On timeout, attach optimistically:
    // every format is postable, worst case the local preview renders blank.
    let settled = false;
    let timer = 0;
    const attach = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      let nextUrl: string;
      try {
        nextUrl = URL.createObjectURL(file);
      } catch (e) {
        // Never leave the picker silent: say so instead of doing nothing.
        console.error("[attach] photo blob url failed", e);
        setError("Couldn't open that photo on this device. Try a JPEG or PNG.");
        return;
      }
      setError(null);
      setPhoto(file);
      setPhotoUrl(nextUrl);
    };
    try {
      const testUrl = URL.createObjectURL(file);
      const testImg = new Image();
      timer = window.setTimeout(() => {
        URL.revokeObjectURL(testUrl);
        attach();
      }, 8000);
      testImg.onload = () => {
        URL.revokeObjectURL(testUrl);
        attach();
      };
      testImg.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        URL.revokeObjectURL(testUrl);
        setError("This image format isn't supported by your browser. Try a JPEG or PNG.");
      };
      testImg.src = testUrl;
    } catch (e) {
      console.error("[attach] photo probe failed", e);
      attach();
    }
  }

  function attachVideo(file: File) {
    // Attach-time diagnosis: name/type/size show exactly what the picker gave.
    console.log("[attach] video", file.name, file.type, file.size);
    if (file.size > VIDEO_MAX_BYTES) {
      setError(sizeError("video"));
      return;
    }
    if (mimeMismatch(file, "video")) {
      setError("That file is not a video.");
      return;
    }
    setError(null);
    const selection = ++videoSelectionRef.current;
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    setVideoThumbnail(null);
    setVideoPosterUrl(null);
    setVideoMeta(null);
    setVideoProbeDone(false);
    setTrim([0, 100]);
    void probeVideoMetadata(file).then((meta) => {
      if (selection !== videoSelectionRef.current) return;
      setVideoMeta(meta);
      setVideoProbeDone(true);
    });
    void captureVideoThumbnail(file).then((thumbnail) => {
      if (selection !== videoSelectionRef.current || !thumbnail) return;
      setVideoThumbnail(thumbnail);
      setVideoPosterUrl(URL.createObjectURL(thumbnail));
    });
  }

  function clearPhoto() {
    setPhoto(null);
    setPhotoUrl(null);
    setPresetId("none");
    setIntensity(100);
    setAdjust({ brightness: 0, contrast: 0, saturation: 0, temperature: 0 });
  }

  function clearVideo() {
    videoSelectionRef.current += 1;
    setVideoFile(null);
    setVideoUrl(null);
    setVideoThumbnail(null);
    setVideoPosterUrl(null);
    setVideoMeta(null);
    setVideoProbeDone(false);
    setTrim([0, 100]);
    setSpeed(1);
    setMuted(false);
    setTrackId(null);
  }

  const preset = filterPresets.find((p) => p.id === presetId) ?? filterPresets[0]!;
  const photoAdjustmentFilter = useMemo(() => adjustmentFilterCss(adjust), [adjust]);
  const photoFilter = useMemo(
    () =>
      [filterCss(preset.settings, preset.extra, intensity / 100), photoAdjustmentFilter]
        .filter(Boolean)
        .join(" "),
    [preset, intensity, photoAdjustmentFilter],
  );

  function goComposer() {
    if (kind === "text" && !textBody.trim() && !caption.trim()) {
      setError("Write something first.");
      return;
    }
    if (kind === "photo" && !photo) {
      setError("Add a photo first — camera or gallery.");
      return;
    }
    if (kind === "video" && !videoFile) {
      setError("Record or upload a clip first.");
      return;
    }
    if (kind === "story" && !photo && !videoFile && !textBody.trim()) {
      setError("Add a photo, video, or text to your story first.");
      return;
    }
    setError(null);
    setCaption((c) => c || textBody.trim());
    setStep("composer");
  }

  function saveDraft(): boolean {
    const drafts = loadDrafts(user?.id ?? null);
    const draft: Draft = {
      id: `d-${Date.now()}`,
      kind,
      mediaHint:
        kind === "text" || (kind === "story" && textBody.trim() && !photo && !videoFile)
          ? "text"
          : photo
            ? "photo"
            : videoFile
              ? "video"
              : "none",
      caption: caption || textBody,
      location,
      tags,
      category,
      audience,
      allowComments,
      allowSharing,
      schedule,
      textBackground: textBg,
      storyOverlays,
      createdAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(
        draftKey(user?.id ?? null),
        JSON.stringify([draft, ...drafts].slice(0, 20)),
      );
      setDraftRevision((revision) => revision + 1);
      onClose();
      return true;
    } catch {
      setError("This browser could not save the draft.");
      return false;
    }
  }

  async function publish() {
    if (sessionLoading) {
      setError("Restoring your session. Try again in a moment.");
      return;
    }
    if (!user) {
      setError("Sign in to publish.");
      return;
    }
    const text = (kind === "text" ? textBody || caption : caption).trim();
    if (!text) {
      setError("Write a caption first.");
      return;
    }

    const requestedSchedule = kind === "story" ? "" : schedule;
    const scheduledAt = requestedSchedule ? new Date(requestedSchedule) : null;
    if (
      scheduledAt &&
      (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now())
    ) {
      setError("Choose a schedule time in the future.");
      return;
    }

    setBusy(true);
    setError(null);
    setStep("publishing");
    setProgress(8);
    const uploadedPaths: string[] = [];
    let postCommitted = false;
    try {
      const capabilities = await inspectPostingSchema();
      if (videoFile && !capabilities.video) {
        throw new Error("Video posts need the latest media migration in Supabase.");
      }
      if ((audience !== "Public" || !allowComments) && !capabilities.settings) {
        throw new Error("Post privacy settings need the latest SQL migration.");
      }
      if (!allowSharing && !capabilities.full) {
        throw new Error("Sharing controls need the latest posting-integrity migration.");
      }
      if (scheduledAt && !capabilities.full) {
        throw new Error("Scheduling needs the latest posting-integrity migration.");
      }
      if (kind === "story" && !capabilities.full) {
        throw new Error("24-hour stories need the latest posting-integrity migration.");
      }

      setProgress(12);
      const stamp = Date.now();
      let imagePath: string | null = null;
      let videoPath: string | null = null;
      let imageUrl: string | null = null;
      let legacyVideoUrl: string | null = null;
      let thumbnailPath: string | null = null;
      let legacyThumbnailUrl: string | null = null;
      let probedMeta: VideoMetadata | null = null;

      if (photo && (kind === "photo" || kind === "story")) {
        const baked = await bakeOrOriginal(photo, (file) =>
          applyFilterToFile(
            file,
            preset.settings,
            [preset.extra, photoAdjustmentFilter].filter(Boolean).join(" ") || undefined,
            intensity / 100,
          ),
        );
        const bakedFile = baked instanceof File ? baked : photo;
        // Never forward an empty or application/* type: canvas output and
        // Android picks both arrive untyped, and a failed bake hands the
        // original file straight back with whatever type it had.
        const photoMime = resolveUploadMime(baked, "image", extOf(photo));
        const imageExtension = photoMime === "image/jpeg" ? "jpg" : extOf(bakedFile) || "bin";
        imagePath = `${user.id}/post-${stamp}.${imageExtension}`;
        uploadedPaths.push(imagePath);
        setProgress(35);
        if (capabilities.media) {
          await uploadStoredObject("post-images", imagePath, baked, { contentType: photoMime });
        } else {
          imageUrl = await uploadAndSign("post-images", imagePath, baked, {
            contentType: photoMime,
            width: 1280,
          });
        }
        setProgress(65);
      }

      if (videoFile && (kind === "video" || kind === "story")) {
        setProgress(35);
        const extension = extOf(videoFile) || "mp4";
        // The probe is the authority: tapping Publish before it settles used to
        // store a row with no content_type/dimensions, so re-probe instead of
        // trusting whatever state happens to be there.
        probedMeta = videoMeta ?? (await probeVideoMetadata(videoFile));
        if (!videoMeta) setVideoMeta(probedMeta);
        // Publishing may begin before the optimistic background capture has
        // settled; make one final best-effort capture so fast taps do not
        // produce a video row with no poster.
        const capturedThumbnail = videoThumbnail ?? (await captureVideoThumbnail(videoFile));
        // `video/mov` is not a real MIME type — resolve from type/extension.
        const videoMime = resolveUploadMime(videoFile, "video", extension);
        videoPath = `${user.id}/video-${stamp}.${extension}`;
        uploadedPaths.push(videoPath);
        if (capabilities.media) {
          await uploadStoredObject("post-images", videoPath, videoFile, {
            contentType: videoMime,
          });
        } else {
          const upload = await supabase.storage.from("post-images").upload(videoPath, videoFile, {
            contentType: videoMime,
          });
          if (upload.error) throw upload.error;
          const signed = await supabase.storage
            .from("post-images")
            .createSignedUrl(videoPath, TEN_YEARS);
          if (signed.error) throw signed.error;
          legacyVideoUrl = signed.data.signedUrl;
        }
        if (capturedThumbnail) {
          thumbnailPath = `${user.id}/thumbnail-${stamp}.jpg`;
          uploadedPaths.push(thumbnailPath);
          if (capabilities.media) {
            await uploadStoredObject("post-images", thumbnailPath, capturedThumbnail, {
              contentType: "image/jpeg",
            });
          } else {
            legacyThumbnailUrl = await uploadAndSign(
              "post-images",
              thumbnailPath,
              capturedThumbnail,
              {
                contentType: "image/jpeg",
                width: 1280,
              },
            );
          }
        }
        setProgress(65);
      }

      setProgress(82);
      const hashtags = extractHashtags(text, tags);
      const basePost = {
        author_id: user.id,
        caption: text,
        image_url: capabilities.media ? null : imageUrl,
        hashtags,
        location: location.trim() || null,
        category: kind === "story" ? "For You" : category,
        ...(capabilities.media
          ? {
              // All media columns are NOT NULL DEFAULT '' and their CHECKs
              // explicitly sanction "" — null would violate NOT NULL, so ""
              // is the schema's marker for "this post has no image/video".
              image_path: imagePath ?? "",
              ...(videoPath ? { video_path: videoPath, video_url: "" } : {}),
              ...(thumbnailPath ? { thumbnail_path: thumbnailPath, thumbnail_url: "" } : {}),
            }
          : legacyVideoUrl
            ? {
                video_url: legacyVideoUrl,
                ...(legacyThumbnailUrl ? { thumbnail_url: legacyThumbnailUrl } : {}),
              }
            : {}),
        ...(capabilities.settings
          ? {
              visibility: audience.toLowerCase(),
              comments_enabled: allowComments,
            }
          : {}),
        ...(capabilities.types && probedMeta
          ? {
              content_type: probedMeta.contentType,
              video_width: probedMeta.width,
              video_height: probedMeta.height,
            }
          : {}),
      };
      const post = capabilities.full
        ? {
            ...basePost,
            status: scheduledAt ? "scheduled" : "published",
            allow_sharing: allowSharing,
            scheduled_at: scheduledAt?.toISOString() ?? null,
            content_kind: kind === "story" ? "story" : "post",
            story_expires_at:
              kind === "story" ? new Date(Date.now() + STORY_TTL_MS).toISOString() : null,
            story_overlays: kind === "story" ? storyOverlays : [],
            story_background: kind === "story" ? textBg : null,
          }
        : basePost;

      const { error: insertError } = await supabase.from("posts").insert(post);
      if (insertError) {
        if ((legacyVideoUrl || videoPath) && /video_(?:url|path)/.test(insertError.message)) {
          throw new Error("Video posts need the latest media migration in Supabase.");
        }
        if (insertError.message.includes("column") || insertError.code === "PGRST204") {
          throw new Error(
            "This post needs the latest posting-integrity migration before it can be saved safely.",
          );
        }
        throw insertError;
      }

      postCommitted = true;
      setProgress(100);
      // Bust server caches first, then refetch mounted home/profile queries.
      // A server-cache outage must not skip this browser's invalidations: doing
      // so would leave a successfully committed post looking unpublished.
      try {
        await bustCache();
      } catch {
        // Server TTLs remain the fallback; client queries still refresh below.
      }
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["home"] }),
        queryClient.invalidateQueries({ queryKey: ["my-posts"] }),
        queryClient.invalidateQueries({ queryKey: ["my-stats"] }),
        queryClient.invalidateQueries({ queryKey: ["profile-posts"] }),
        queryClient.invalidateQueries({ queryKey: ["profile-stats"] }),
      ]);
      setStep("success");
    } catch (e) {
      // On-device debugging: the UI shows friendlyPublishError below, the
      // console keeps the raw cause.
      console.error("[publish]", e);
      if (!postCommitted) {
        await removeStoredObjects("post-images", uploadedPaths).catch(() => undefined);
      }
      setError(friendlyPublishError(e));
      setStep("composer");
    } finally {
      setBusy(false);
    }
  }

  const drafts = useMemo(() => {
    void draftRevision;
    return step === "drafts" ? loadDrafts(user?.id ?? null) : [];
  }, [draftRevision, step, user?.id]);

  return (
    <>
      <Sheet
        open={open && !camera}
        onClose={() => {
          if (!busy) onClose();
        }}
        title={
          step === "hub" ? "Create" : step === "success" && schedule ? "Scheduled" : TITLES[step]
        }
      >
        {step !== "hub" && step !== "publishing" && step !== "success" && (
          <button
            onClick={() => setStep("hub")}
            className="mb-2 rounded-full bg-secondary px-4 py-1.5 text-xs font-semibold text-foreground"
          >
            ← All options
          </button>
        )}

        {step === "hub" && (
          <div className="flex flex-col gap-0.5">
            {createActions.map(({ kind: k, label, hint, Icon }) =>
              k === "more" ? (
                <button
                  key={k}
                  onClick={() => setStep("drafts")}
                  className="press flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-secondary"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary">
                    <Icon className="size-5 text-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold leading-tight text-foreground">
                      {label}
                    </span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ) : (
                <button
                  key={k}
                  onClick={() => pick(k)}
                  className="press flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-secondary"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary">
                    <Icon className="size-5 text-brand" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold leading-tight text-foreground">
                      {label}
                    </span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ),
            )}
          </div>
        )}

        {step === "photo" && (
          <PhotoStep
            photoUrl={photoUrl}
            photoFilter={photoFilter}
            presetId={presetId}
            setPresetId={setPresetId}
            intensity={intensity}
            setIntensity={setIntensity}
            adjust={adjust}
            setAdjust={setAdjust}
            onCamera={() => setCamera("photo")}
            onUpload={() => fileRef.current?.click()}
            onContinue={goComposer}
            onCrop={() => setCropping(true)}
            error={error}
          />
        )}

        {step === "video" && (
          <VideoStep
            videoUrl={videoUrl}
            posterUrl={videoPosterUrl}
            playable={videoFile ? videoMeta !== null || !videoProbeDone : true}
            detectedType={videoMeta?.contentType ?? null}
            trim={trim}
            setTrim={setTrim}
            speed={speed}
            setSpeed={setSpeed}
            muted={muted}
            setMuted={setMuted}
            trackId={trackId}
            setTrackId={setTrackId}
            onRecord={() => setCamera("short")}
            onUpload={() => videoRef.current?.click()}
            onContinue={goComposer}
            error={error}
          />
        )}

        {step === "story" && (
          <StoryStep
            photoUrl={photoUrl}
            videoUrl={videoUrl}
            posterUrl={videoPosterUrl}
            textBody={textBody}
            textBg={textBg}
            overlays={storyOverlays}
            toggleOverlay={(o) =>
              setStoryOverlays((prev) =>
                prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o],
              )
            }
            onPhoto={() => fileRef.current?.click()}
            onVideo={() => videoRef.current?.click()}
            onText={() => {
              clearPhoto();
              clearVideo();
              setCaption("");
              setLocation("");
              setTags("");
              setSchedule("");
              setKind("story");
              setStep("text");
            }}
            onContinue={goComposer}
            error={error}
          />
        )}

        {step === "text" && (
          <div>
            <div className="grid grid-cols-6 gap-2 px-2 py-2">
              {TEXT_BACKGROUNDS.map((bg) => (
                <button
                  key={bg}
                  aria-label={`Background ${bg}`}
                  onClick={() => setTextBg(bg)}
                  style={{ backgroundColor: bg }}
                  className={`size-9 rounded-full ${textBg === bg ? "ring-2 ring-brand ring-offset-2 ring-offset-background" : ""}`}
                />
              ))}
            </div>
            <div className="px-2 py-1">
              <div
                className="animate-scale-in grid min-h-44 place-items-center rounded-2xl p-5"
                style={{ backgroundColor: textBg }}
              >
                <textarea
                  value={textBody}
                  onChange={(e) => setTextBody(e.target.value)}
                  rows={4}
                  maxLength={500}
                  placeholder="Say something…"
                  className="w-full resize-none bg-transparent text-center text-lg font-bold text-white outline-none placeholder:text-white/60"
                />
              </div>
              {error && <p className="mt-2 text-xs font-semibold text-live">{error}</p>}
              <button
                onClick={goComposer}
                disabled={!textBody.trim()}
                className="mt-3 w-full rounded-full bg-brand py-2.5 text-sm font-bold text-brand-foreground disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === "live-setup" && (
          <div className="space-y-3 px-1 py-1">
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">Title</span>
              <input
                value={liveTitle}
                onChange={(e) => setLiveTitle(e.target.value)}
                placeholder="Friday night hangout"
                className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">Category</span>
                <select
                  value={liveCategory}
                  onChange={(e) => setLiveCategory(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <div>
                <span className="text-xs font-semibold text-muted-foreground">Microphone</span>
                <div className="mt-1 flex gap-2">
                  <button
                    onClick={() => setLiveMic(true)}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-xl py-2.5 text-xs font-semibold ${liveMic ? "bg-brand text-brand-foreground" : "bg-secondary"}`}
                  >
                    <Mic className="size-4" /> On
                  </button>
                  <button
                    onClick={() => setLiveMic(false)}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-xl py-2.5 text-xs font-semibold ${!liveMic ? "bg-brand text-brand-foreground" : "bg-secondary"}`}
                  >
                    <MicOff className="size-4" /> Off
                  </button>
                </div>
              </div>
            </div>
            <label className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs text-muted-foreground">
                Beauty {liveBeauty}%
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={liveBeauty}
                onChange={(e) => setLiveBeauty(Number(e.target.value))}
                className="w-full"
                aria-label="Beauty level"
              />
            </label>
            <ToggleRow
              title="Allow comments"
              desc="Viewers can chat"
              checked={liveComments}
              onChange={setLiveComments}
            />
            <button
              onClick={() => setStep("live-room")}
              disabled={!liveTitle.trim()}
              className="w-full rounded-full bg-live py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              Start live
            </button>
          </div>
        )}

        {step === "live-room" && (
          <div className="overflow-hidden rounded-2xl bg-media">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="rounded-full bg-live px-3 py-1 text-xs font-bold text-white">
                LIVE · {viewers}
              </span>
              <span className="truncate px-2 text-xs font-semibold text-white">
                {liveTitle || "Untitled live"}
              </span>
              <button
                aria-label="End live"
                onClick={() => setStep("success")}
                className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold text-white"
              >
                End
              </button>
            </div>
            <div className="grid h-56 place-items-center">
              <Camera className="size-10 text-white/40" />
            </div>
            <div className="max-h-32 space-y-1 overflow-y-auto px-3 py-2">
              {liveChat.map((m, i) => (
                <p key={i} className="text-xs text-white/90">
                  <span className="font-bold">Guest:</span> {m}
                </p>
              ))}
            </div>
            <div className="flex items-center gap-2 px-3 pb-3">
              <button
                onClick={() => setLiveReacts((n) => n + 1)}
                className="press flex-1 rounded-full bg-white/15 py-2 text-sm font-bold text-white"
              >
                React {liveReacts > 0 ? `· ${liveReacts}` : ""}
              </button>
              <button
                aria-label="Share live"
                onClick={() => setLiveReacts((n) => n + 1)}
                className="grid size-10 place-items-center rounded-full bg-white/15"
              >
                <Share2 className="size-4 text-white" />
              </button>
            </div>
          </div>
        )}

        {step === "composer" && (
          <div className="space-y-3 pb-2">
            {(photoUrl || videoUrl || (kind === "text" && textBody)) && (
              <div className="flex items-center gap-3 rounded-2xl bg-secondary p-2.5">
                {photoUrl && (
                  <img
                    src={photoUrl}
                    alt="Preview"
                    style={{ filter: photoFilter }}
                    className="size-14 rounded-xl object-cover"
                  />
                )}
                {videoUrl && !photoUrl && (
                  <video
                    src={videoUrl}
                    poster={videoPosterUrl ?? undefined}
                    muted
                    playsInline
                    className="size-14 rounded-xl object-cover"
                  />
                )}
                {kind === "text" && !photoUrl && (
                  <span
                    className="grid size-14 place-items-center rounded-xl p-1 text-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: textBg }}
                  >
                    {textBody.slice(0, 24)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold capitalize">{kind} preview</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {kind === "story" ? "Disappears after 24 hours" : `Audience: ${audience}`}
                  </p>
                </div>
              </div>
            )}
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">Caption</span>
              <textarea
                value={kind === "text" ? textBody : caption}
                onChange={(e) =>
                  kind === "text" ? setTextBody(e.target.value) : setCaption(e.target.value)
                }
                rows={3}
                maxLength={500}
                placeholder="Write a caption…"
                className="mt-1 w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none focus:border-brand"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">Location</span>
                <span className="mt-1 flex items-center gap-1.5 rounded-xl border border-border bg-secondary px-3 py-2.5">
                  <MapPin className="size-4 shrink-0 text-muted-foreground" />
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Add location"
                    className="w-full bg-transparent text-sm outline-none"
                  />
                </span>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">Category</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">Tags & hashtags</span>
              <span className="mt-1 flex items-center gap-1.5 rounded-xl border border-border bg-secondary px-3 py-2.5">
                <AtSign className="size-4 shrink-0 text-muted-foreground" />
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="travel, @friend"
                  className="w-full bg-transparent text-sm outline-none"
                />
              </span>
            </label>
            <div>
              <span className="text-xs font-semibold text-muted-foreground">Audience</span>
              <div className="mt-1 flex gap-1.5">
                {AUDIENCES.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAudience(a)}
                    className={`flex-1 rounded-full py-2 text-xs font-semibold ${audience === a ? "bg-brand text-brand-foreground" : "bg-secondary text-foreground"}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <ToggleRow title="Allow comments" checked={allowComments} onChange={setAllowComments} />
            <ToggleRow title="Allow sharing" checked={allowSharing} onChange={setAllowSharing} />
            {kind !== "story" && (
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">
                  Schedule (optional)
                </span>
                <span className="mt-1 flex items-center gap-1.5 rounded-xl border border-border bg-secondary px-3 py-2.5">
                  <Clock className="size-4 shrink-0 text-muted-foreground" />
                  <input
                    type="datetime-local"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                    className="w-full bg-transparent text-sm outline-none"
                  />
                </span>
              </label>
            )}
            {error && !user && !sessionLoading ? (
              <div className="rounded-xl bg-secondary p-3 text-xs">
                <p className="font-semibold text-live">{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    if (saveDraft()) window.location.assign("/auth");
                  }}
                  className="mt-2 rounded-full bg-foreground px-3 py-1.5 font-bold text-background"
                >
                  Save draft & sign in
                </button>
              </div>
            ) : (
              error && <p className="text-xs font-semibold text-live">{error}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={saveDraft}
                className="flex-1 rounded-full bg-secondary py-2.5 text-sm font-semibold"
              >
                Save draft
              </button>
              <button
                onClick={publish}
                disabled={busy}
                className="flex-1 rounded-full bg-brand py-2.5 text-sm font-bold text-brand-foreground disabled:opacity-60"
              >
                {busy ? "Publishing…" : schedule ? "Schedule" : "Publish"}
              </button>
            </div>
          </div>
        )}

        {step === "publishing" && (
          <div className="px-2 py-10 text-center">
            {videoPosterUrl && (
              <img
                src={videoPosterUrl}
                alt="Video thumbnail"
                className="mx-auto mb-4 size-20 rounded-2xl object-cover"
              />
            )}
            {/* CSS transform-only spinner: cheap on slow/low-end devices, no layout jank */}
            <Loader2
              className="mx-auto size-8 animate-spin [animation-duration:0.9s] text-brand"
              strokeWidth={2.5}
            />
            <p className="mt-3 text-[15px] font-semibold">Publishing your {kind}…</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Please wait — you'll stay on this screen until it's done.
            </p>
          </div>
        )}

        {step === "success" && (
          <div className="px-2 py-8 text-center">
            <span className="animate-scale-in mx-auto grid size-14 place-items-center rounded-full bg-brand">
              <Check className="size-7 text-brand-foreground" />
            </span>
            <p className="mt-3 text-[15px] font-semibold">
              {kind === "live"
                ? "Stream ended"
                : schedule && kind !== "story"
                  ? "Your post is scheduled"
                  : "Your post is live"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {kind === "story"
                ? "Your story disappears in 24 hours."
                : schedule
                  ? `It will publish ${new Date(schedule).toLocaleString()}.`
                  : "Thanks for sharing with your people."}
            </p>
            <div className="mt-4 flex gap-2">
              <Link
                to="/profile"
                onClick={onClose}
                className="flex-1 rounded-full bg-secondary py-2.5 text-sm font-semibold"
              >
                View profile
              </Link>
              <button
                onClick={() => {
                  clearPhoto();
                  clearVideo();
                  setStep("hub");
                  setTextBody("");
                  setCaption("");
                  setLocation("");
                  setTags("");
                  setCategory(CATEGORIES[0] ?? "For You");
                  setAudience("Public");
                  setAllowComments(true);
                  setAllowSharing(true);
                  setSchedule("");
                }}
                className="flex-1 rounded-full bg-brand py-2.5 text-sm font-bold text-brand-foreground"
              >
                Create more
              </button>
            </div>
          </div>
        )}

        {step === "drafts" && (
          <div>
            {drafts.length === 0 ? (
              <div className="px-2 py-8 text-center">
                <FolderOpen className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-2 text-[15px] font-semibold">No drafts yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Unfinished posts wait for you here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {drafts.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-2 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold capitalize">
                        {d.kind} · {d.caption.slice(0, 40) || "Untitled"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(d.createdAt).toLocaleDateString()}
                      </span>
                    </span>
                    <button
                      onClick={() => {
                        clearPhoto();
                        clearVideo();
                        const mediaHint =
                          d.mediaHint ??
                          (d.kind === "text" ? "text" : d.kind === "photo" ? "photo" : "none");
                        const isText = mediaHint === "text";
                        setKind(d.kind);
                        setCaption(isText ? "" : d.caption);
                        setTextBody(isText ? d.caption : "");
                        setLocation(d.location);
                        setTags(d.tags);
                        setCategory(d.category);
                        setAudience(d.audience);
                        setAllowComments(d.allowComments ?? true);
                        setAllowSharing(d.allowSharing ?? true);
                        setSchedule(d.kind === "story" ? "" : (d.schedule ?? ""));
                        setTextBg(d.textBackground ?? TEXT_BACKGROUNDS[0]!);
                        setStoryOverlays(d.storyOverlays ?? []);
                        setStep(
                          isText
                            ? d.kind === "story"
                              ? "text"
                              : "composer"
                            : mediaHint === "video"
                              ? "video"
                              : d.kind === "live"
                                ? "live-setup"
                                : d.kind,
                        );
                      }}
                      className="rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold"
                    >
                      Resume
                    </button>
                    <button
                      aria-label="Delete draft"
                      onClick={() => {
                        try {
                          localStorage.setItem(
                            draftKey(user?.id ?? null),
                            JSON.stringify(
                              loadDrafts(user?.id ?? null).filter((x) => x.id !== d.id),
                            ),
                          );
                          setDraftRevision((revision) => revision + 1);
                        } catch {
                          setError("This browser could not update drafts.");
                        }
                      }}
                      className="rounded-full p-1.5 hover:bg-secondary"
                    >
                      <X className="size-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              if (step === "story") clearVideo();
              attachPhoto(f);
              if (step === "hub") {
                setKind("photo");
                setStep("photo");
              }
            }
            e.target.value = "";
          }}
        />
        <input
          ref={videoRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              if (step === "story") clearPhoto();
              attachVideo(f);
              if (step === "hub" || step === "story") {
                setKind(step === "story" ? "story" : "video");
                setStep("video");
              }
            }
            e.target.value = "";
          }}
        />
      </Sheet>

      <BeautyCameraSheet
        open={camera !== null}
        mode={camera === "short" ? "short" : "photo"}
        onClose={() => setCamera(null)}
        onCapture={(f) => {
          // Empty MIME (some camera builds) and application/* labels both
          // defer to the extension; only a MIME naming the other kind decides.
          const looksVideo = mimeMismatch(f, "image") && !mimeMismatch(f, "video");
          if (looksVideo) attachVideo(f);
          else attachPhoto(f);
          setCamera(null);
        }}
      />
      {cropping && photoUrl && (
        <CropSheet
          open
          onClose={() => setCropping(false)}
          imageSrc={photoUrl}
          onDone={(f) => {
            attachPhoto(f);
            setCropping(false);
          }}
        />
      )}
    </>
  );
}

// Re-exported so tree-shaken icon imports stay referenced in one place.
export { AtSign, Clock, FolderOpen, Link2, MapPin, Mic, Music, RefreshCw, Users };

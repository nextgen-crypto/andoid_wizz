import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { invalidateHomeCache } from "@/backend/api/home.functions";
import { fetchPostingCapabilities, type PostingCapabilities } from "@/backend/api/posts.functions";
import {
  AtSign,
  Camera,
  Check,
  ChevronRight,
  Clock,
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
import { canReencodeVideo, reencodeVideoClip, tryExtractPreviewFrame } from "@/frontend/lib/videoEdit";
import { applyOverlaysToFile, type PhotoOverlay } from "@/frontend/lib/overlayBaker";
import { extractHashtags } from "@/frontend/lib/hashtags";
import { BeautyCameraSheet } from "@/frontend/components/camera/BeautyCameraSheet";
import { CropSheet } from "@/frontend/components/create/CropSheet";
import {
  HubCard,
  PhotoStep,
  StoryStep,
  ToggleRow,
  TRACKS,
  VideoStep,
} from "@/frontend/components/create/creationEngineSteps";

export { TRACKS };
import {
  applyFilterAndTransformToFile,
  applyFilterToFile,
  filterCss,
  filterPresets,
} from "@/frontend/components/camera/beautyFilters";
import { useSession } from "@/frontend/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import type { CreateKind } from "@/frontend/components/home/nav-items";
import { createActions } from "@/frontend/components/home/nav-items";
import { cn } from "@/lib/utils";

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;
const MAX_PHOTO_COUNT = 10;
const DRAFT_KEY_PREFIX = "wizz:create:drafts";

function draftKey(userId: string | null): string {
  return `${DRAFT_KEY_PREFIX}:${userId ?? "anonymous"}`;
}

const CATEGORIES = ["For You", "Trending", "Sports", "Music", "Tech", "Style", "Food", "Travel"];
const AUDIENCES = ["Public", "Followers", "Private"] as const;
const TEXT_BACKGROUNDS = ["#7c3aed", "#0f766e", "#1d4ed8", "#b45309", "#be123c", "#111827"];
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

/** Accent colours that map each create mode to a brand hue. */
const HUB_ACCENTS: Partial<Record<string, string>> = {
  photo: "#7c3aed",
  video: "#0891b2",
  story: "#db2777",
  text: "#d97706",
  live: "#dc2626",
  more: "#6b7280",
};

export type PhotoAdjustments = {
  brightness:  number;  // -100 .. 100
  contrast:    number;  // -100 .. 100
  saturation:  number;  // -100 .. 100
  temperature: number;  // -100 .. 100  warm/cool via sepia + hue
  exposure:    number;  // -100 .. 100  multiplicative brightness
  highlights:  number;  // -50  .. 50   approx via brightness
  shadows:     number;  // -50  .. 50   approx via brightness
  tint:        number;  // -50  .. 50   green-magenta via hue-rotate
  sharpness:   number;  //  0   .. 100  approx via contrast
  vignette:    number;  //  0   .. 100  radial overlay (not CSS filter)
  fade:        number;  //  0   .. 100  saturation wash-out
};

export const DEFAULT_ADJUST: PhotoAdjustments = {
  brightness: 0, contrast: 0, saturation: 0, temperature: 0,
  exposure: 0, highlights: 0, shadows: 0, tint: 0,
  sharpness: 0, vignette: 0, fade: 0,
};

function adjustmentFilterCss(a: PhotoAdjustments): string {
  // Brightness: base + exposure (additive effect)
  const bright = 1 + (a.brightness + a.exposure) / 100;
  // Contrast: base + sharpness approximation
  const cont = 1 + (a.contrast + a.sharpness * 0.35) / 100;
  // Saturation: reduced by fade
  const sat = Math.max(0, 1 + (a.saturation - a.fade * 0.55) / 100);
  // Highlights/shadows: opposing tiny brightness nudges
  const hlNudge = 1 + (-a.highlights * 0.003 + a.shadows * 0.002);

  const parts: string[] = [];
  if (Math.abs(bright - 1) > 0.005) parts.push(`brightness(${bright.toFixed(3)})`);
  if (Math.abs(cont  - 1) > 0.005) parts.push(`contrast(${cont.toFixed(3)})`);
  if (Math.abs(sat   - 1) > 0.005) parts.push(`saturate(${sat.toFixed(3)})`);
  if (a.temperature > 0)  parts.push(`sepia(${(a.temperature / 250).toFixed(3)})`);
  if (a.temperature < 0)  parts.push(`hue-rotate(${(a.temperature / 2).toFixed(1)}deg)`);
  if (a.tint !== 0)       parts.push(`hue-rotate(${(a.tint * 0.8).toFixed(1)}deg)`);
  if (Math.abs(hlNudge - 1) > 0.005) parts.push(`brightness(${hlNudge.toFixed(3)})`);
  return parts.join(" ");
}

export type VideoAdjust = { brightness: number; contrast: number; saturation: number };
export const DEFAULT_VIDEO_ADJUST: VideoAdjust = { brightness: 0, contrast: 0, saturation: 0 };

function videoAdjustCss(a: VideoAdjust): string {
  const parts: string[] = [];
  if (a.brightness) parts.push(`brightness(${(1 + a.brightness / 100).toFixed(3)})`);
  if (a.contrast)   parts.push(`contrast(${(1 + a.contrast / 100).toFixed(3)})`);
  if (a.saturation) parts.push(`saturate(${(1 + a.saturation / 100).toFixed(3)})`);
  return parts.join(" ");
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
  const anonymous = read(draftKey(null));
  return [...own, ...anonymous.filter((draft) => !own.some((item) => item.id === draft.id))].slice(
    0,
    20,
  );
}

// Module-level cache so a successful probe survives multiple publish attempts
// within the same page session. On Android the first call may fail due to a
// transient RPC/network error; subsequent calls (or the fallback) use this.
let _capabilitiesCache: PostingCapabilities | null = null;

// Full-schema fallback: assume all columns exist (migrations are applied in prod).
// Used when every probe attempt fails so the user can still publish.
const FULL_CAPABILITIES: PostingCapabilities = {
  video: true, media: true, settings: true, full: true, types: true,
  imagePaths: true, sharing: true, scheduling: true, stories: true,
  likes: true, saves: true, integrity: true,
};

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
  initialTrackId = null,
  initialSourceUser = null,
  onClose,
}: {
  open: boolean;
  initial: CreateKind | null;
  initialTrackId?: string | null;
  initialSourceUser?: string | null;
  onClose: () => void;
}) {
  const { user, loading: sessionLoading } = useSession();
  const queryClient = useQueryClient();
  const bustCache = useServerFn(invalidateHomeCache);
  const inspectPostingSchema = useServerFn(fetchPostingCapabilities);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const pickMode = useRef<{ replace: number | null }>({ replace: null });

  const [step, setStep] = useState<Step>("hub");
  const [kind, setKind] = useState<Exclude<CreateKind, "more">>("photo");

  // multi-photo carousel
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [activePhoto, setActivePhoto] = useState(0);
  const photo = photos[activePhoto] ?? null;
  const photoUrl = photoUrls[activePhoto] ?? null;
  const [presetId, setPresetId] = useState("none");
  const [intensity, setIntensity] = useState(100);
  const [adjust, setAdjust] = useState<PhotoAdjustments>(DEFAULT_ADJUST);
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [flip, setFlip] = useState<{ h: boolean; v: boolean }>({ h: false, v: false });
  const [photoOverlays, setPhotoOverlays] = useState<PhotoOverlay[]>([]);
  const [camera, setCamera] = useState<null | "photo" | "short">(null);
  const [cropping, setCropping] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoThumbnail, setVideoThumbnail] = useState<Blob | null>(null);
  const [videoPosterUrl, setVideoPosterUrl] = useState<string | null>(null);
  const videoSelectionRef = useRef(0);
  const [videoMeta, setVideoMeta] = useState<VideoMetadata | null>(null);
  const [videoProbeDone, setVideoProbeDone] = useState(false);
  const [trim, setTrim] = useState<[number, number]>([0, 100]);
  const [speed, setSpeed] = useState<number>(1);
  const [muted, setMuted] = useState(false);
  const [videoAdjust, setVideoAdjust] = useState<VideoAdjust>(DEFAULT_VIDEO_ADJUST);
  const [origVolume, setOrigVolume] = useState(100);
  const [musicVolume, setMusicVolume] = useState(80);
  const [proxyFrameUrl, setProxyFrameUrl] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [stage, setStage] = useState<"trim" | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [textBody, setTextBody] = useState("");
  const [textBg, setTextBg] = useState(TEXT_BACKGROUNDS[0]!);
  const [storyOverlays, setStoryOverlays] = useState<string[]>([]);

  // composer fields
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
    // Pre-select a track from the "Use this sound" button on any feed card,
    // or restore a pending track saved before auth redirect.
    if (initialTrackId && TRACKS.some((t) => t.id === initialTrackId)) {
      setTrackId(initialTrackId);
    } else {
      try {
        const pending = localStorage.getItem("wizz:pending-track");
        if (pending && TRACKS.some((t) => t.id === pending)) {
          setTrackId(pending);
          localStorage.removeItem("wizz:pending-track");
        }
      } catch {
        // storage unavailable
      }
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

  function revokePhotoUrl(index: number) {
    setPhotoUrls((urls) => {
      const url = urls[index];
      if (url) URL.revokeObjectURL(url);
      return urls;
    });
  }

  useEffect(() => {
    if (open) return;
    return () => {
      setPhotoUrls((urls) => {
        for (const url of urls) URL.revokeObjectURL(url);
        return urls;
      });
    };
  }, [open]);

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

  function attachPhoto(file: File, replaceIndex?: number) {
    console.log("[attach] photo", file.name, file.type, file.size);
    if (file.size > IMAGE_MAX_BYTES) {
      setError(sizeError("image"));
      return;
    }
    if (mimeMismatch(file, "image")) {
      setError("That file is not an image.");
      return;
    }
    const atCapacity = replaceIndex === undefined && photos.length >= MAX_PHOTO_COUNT;
    if (atCapacity) {
      setError(`A post can carry at most ${MAX_PHOTO_COUNT} photos.`);
      return;
    }

    // Build the display URL: try createImageBitmap → canvas → JPEG first so that
    // formats the WebView can decode (HEIF, AVIF, BMP…) are always displayable
    // even when <img src={blobUrl}> would silently fail.
    // The original file is always kept for upload regardless of what happens here.
    void (async () => {
      let displayUrl: string;
      try {
        const bitmap = await Promise.race<ImageBitmap>([
          createImageBitmap(file),
          new Promise<never>((_, reject) =>
            window.setTimeout(() => reject(new Error("bitmap timeout")), 8000),
          ),
        ]);
        const MAX_PX = 2048;
        const scale = Math.min(1, MAX_PX / Math.max(bitmap.width || 1, bitmap.height || 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round((bitmap.width || 800) * scale);
        canvas.height = Math.round((bitmap.height || 800) * scale);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          const blob = await new Promise<Blob | null>((res) =>
            canvas.toBlob(res, "image/jpeg", 0.92),
          );
          displayUrl = blob ? URL.createObjectURL(blob) : URL.createObjectURL(file);
        } else {
          bitmap.close();
          displayUrl = URL.createObjectURL(file);
        }
      } catch {
        // createImageBitmap not supported or format can't be decoded — fall back
        // to a direct blob URL; the <img> onError fallback handles any residual
        // display failures gracefully.
        displayUrl = URL.createObjectURL(file);
      }

      setError(null);
      if (replaceIndex !== undefined) {
        revokePhotoUrl(replaceIndex);
        setPhotos((prev) => {
          const next = [...prev];
          next[replaceIndex] = file;
          return next;
        });
        setPhotoUrls((prev) => {
          const next = [...prev];
          next[replaceIndex] = displayUrl;
          return next;
        });
        setActivePhoto(replaceIndex);
        return;
      }
      setPhotos((prev) => [...prev, file]);
      setPhotoUrls((prev) => [...prev, displayUrl]);
      setActivePhoto((prev) => (photos.length === 0 ? 0 : prev));
    })();
  }

  function attachVideo(file: File) {
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
    const blobUrl = URL.createObjectURL(file);
    setVideoUrl(blobUrl);
    setVideoThumbnail(null);
    setVideoPosterUrl(null);
    setVideoMeta(null);
    setVideoProbeDone(false);
    setProxyFrameUrl(null);
    setTrim([0, 100]);
    void probeVideoMetadata(file).then((meta) => {
      if (selection !== videoSelectionRef.current) return;
      setVideoMeta(meta);
      setVideoProbeDone(true);
      // If probe returns null the codec is unsupported — try static frame extraction
      // so VideoStep can show a real thumbnail instead of a black screen.
      if (!meta) {
        void tryExtractPreviewFrame(file).then((url) => setProxyFrameUrl(url));
      }
    });
    void captureVideoThumbnail(file).then((thumbnail) => {
      if (selection !== videoSelectionRef.current || !thumbnail) return;
      setVideoThumbnail(thumbnail);
      setVideoPosterUrl(URL.createObjectURL(thumbnail));
    });
  }

  function clearPhoto() {
    for (const url of photoUrls) URL.revokeObjectURL(url);
    setPhotos([]);
    setPhotoUrls([]);
    setActivePhoto(0);
    setPresetId("none");
    setIntensity(100);
    setAdjust(DEFAULT_ADJUST);
    setRotate(0);
    setFlip({ h: false, v: false });
    setPhotoOverlays([]);
  }

  function removePhoto(index: number) {
    revokePhotoUrl(index);
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoUrls((prev) => prev.filter((_, i) => i !== index));
    setActivePhoto((prev) => {
      const after = photos.length - 1;
      if (after <= 0) return 0;
      return Math.max(0, Math.min(prev > index ? prev - 1 : prev, after - 1));
    });
  }

  function movePhoto(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= photos.length) return;
    setPhotos((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
    setPhotoUrls((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
    setActivePhoto(target);
  }

  function clearVideo() {
    videoSelectionRef.current += 1;
    setVideoFile(null);
    if (proxyFrameUrl) URL.revokeObjectURL(proxyFrameUrl);
    setVideoUrl(null);
    setVideoThumbnail(null);
    setVideoPosterUrl(null);
    setVideoMeta(null);
    setVideoProbeDone(false);
    setTrim([0, 100]);
    setSpeed(1);
    setMuted(false);
    setVideoAdjust(DEFAULT_VIDEO_ADJUST);
    setOrigVolume(100);
    setMusicVolume(80);
    setProxyFrameUrl(null);
    setTrackId(null);
    setCoverFile(null);
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
  // CSS transform for live preview (does NOT affect upload — baking uses rotate/flip directly)
  const photoTransform = useMemo(() => {
    const parts: string[] = [];
    if (rotate) parts.push(`rotate(${rotate}deg)`);
    if (flip.h) parts.push("scaleX(-1)");
    if (flip.v) parts.push("scaleY(-1)");
    return parts.join(" ") || undefined;
  }, [rotate, flip]);
  const videoAdjustFilter = useMemo(() => videoAdjustCss(videoAdjust), [videoAdjust]);

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
      // Probe capabilities with one retry. On Android the RPC can fail on the
      // first attempt due to a cold-start network timeout, so retry once before
      // falling back to cached or assumed-full schema.
      let capabilities: PostingCapabilities = _capabilitiesCache ?? FULL_CAPABILITIES;
      if (!_capabilitiesCache) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            capabilities = await inspectPostingSchema();
            _capabilitiesCache = capabilities;
            break;
          } catch {
            // On last attempt keep the FULL_CAPABILITIES default already set above
          }
        }
      }
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
      let imagePaths: string[] = [];
      let videoPath: string | null = null;
      let thumbnailPath: string | null = null;
      let imageUrl: string | null = null;
      let legacyVideoUrl: string | null = null;
      let legacyThumbnailUrl: string | null = null;
      let probedMeta: VideoMetadata | null = null;

      if (photos.length > 0 && (kind === "photo" || kind === "story")) {
        const selection =
          kind === "story" || !capabilities.imagePaths ? photos.slice(0, 1) : photos;
        if (selection.length < photos.length) {
          toast(
            `This build supports ${selection.length === 1 ? "one photo per post" : `${selection.length} photos`} — extra selections weren't uploaded.`,
          );
        }
        const bakedPaths: string[] = [];
        for (let i = 0; i < selection.length; i++) {
          const current = selection[i]!;
          const extraCss =
            [preset.extra, photoAdjustmentFilter].filter(Boolean).join(" ") || undefined;
          const baked = await bakeOrOriginal(current, (file) =>
            applyFilterAndTransformToFile(
              file,
              preset.settings,
              extraCss,
              intensity / 100,
              rotate,
              flip,
            ),
          );
          const withFilter = baked instanceof File ? baked : current;
          // Second canvas pass: bake text + sticker overlays on top of filter result
          const bakedFile =
            photoOverlays.length > 0
              ? await applyOverlaysToFile(withFilter, photoOverlays).catch(() => withFilter)
              : withFilter;
          const photoMime = resolveUploadMime(bakedFile, "image", extOf(current));
          const imageExtension = photoMime === "image/jpeg" ? "jpg" : extOf(bakedFile) || "bin";
          const suffix = selection.length > 1 ? `-${i + 1}` : "";
          const path = `${user.id}/post-${stamp}${suffix}.${imageExtension}`;
          bakedPaths.push(path);
          uploadedPaths.push(path);
          setProgress(20 + Math.round((45 * (i + 1)) / selection.length));
          if (capabilities.media) {
            await uploadStoredObject("post-images", path, baked, { contentType: photoMime });
          } else if (i === 0) {
            imageUrl = await uploadAndSign("post-images", path, baked, {
              contentType: photoMime,
              width: 1280,
            });
          }
        }
        imagePath = bakedPaths[0] ?? null;
        imagePaths = bakedPaths;
        setProgress(65);
      }

      if (videoFile && (kind === "video" || kind === "story")) {
        setProgress(28);
        const wantsTrim = trim[0] > 0 || trim[1] < 100;
        const wantsEdit = wantsTrim || speed !== 1 || muted;
        let uploadFile = videoFile;
        let videoNote: string | null = null;
        if (wantsEdit && canReencodeVideo()) {
          setStage("trim");
          const edited = await reencodeVideoClip(videoFile, {
            startFrac: trim[0] / 100,
            endFrac: trim[1] / 100,
            speed,
            muted,
            onProgress: (frac) => setProgress(28 + Math.round(frac * 24)),
          });
          if (edited) {
            uploadFile = edited;
          } else {
            videoNote = "Trim couldn't be applied on this device — posting the full clip.";
          }
        } else if (wantsEdit) {
          videoNote =
            "Trim, speed and mute aren't supported on this device — posting the full clip.";
        }
        if (videoNote) toast.warning(videoNote, { duration: 5000 });
        setStage(null);
        setProgress(52);
        const uploadExt = extOf(uploadFile) || extOf(videoFile) || "mp4";
        probedMeta =
          uploadFile === videoFile
            ? (videoMeta ?? (await probeVideoMetadata(videoFile)))
            : await probeVideoMetadata(uploadFile);
        if (!videoMeta) setVideoMeta(probedMeta);
        const capturedThumbnail = coverFile ?? videoThumbnail ?? (await captureVideoThumbnail(videoFile));
        const videoMime = resolveUploadMime(uploadFile, "video", uploadExt);
        videoPath = `${user.id}/video-${stamp}.${uploadExt}`;
        uploadedPaths.push(videoPath);
        if (capabilities.media) {
          await uploadStoredObject("post-images", videoPath, uploadFile, {
            contentType: videoMime,
          });
        } else {
          const upload = await supabase.storage.from("post-images").upload(videoPath, uploadFile, {
            contentType: videoMime,
          });
          if (upload.error) throw upload.error;
          const signed = await supabase.storage
            .from("post-images")
            .createSignedUrl(videoPath, TEN_YEARS);
          if (signed.error) throw signed.error;
          legacyVideoUrl = signed.data.signedUrl;
        }
        setProgress(62);
        if (capturedThumbnail) {
          try {
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
                { contentType: "image/jpeg", width: 1280 },
              );
            }
          } catch {
            thumbnailPath = null;
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
              image_path: imagePath ?? "",
              ...(capabilities.imagePaths && imagePaths.length > 0
                ? { image_paths: imagePaths }
                : {}),
              ...(videoPath ? { video_path: videoPath, video_url: "" } : {}),
              ...(thumbnailPath ? { thumbnail_path: thumbnailPath } : {}),
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
      try {
        await bustCache();
      } catch {
        // server TTL stays as fallback
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
        {/* Back button for all non-root steps */}
        {step !== "hub" && step !== "publishing" && step !== "success" && (
          <button
            onClick={() => setStep("hub")}
            className="mb-3 rounded-full bg-secondary px-4 py-1.5 text-xs font-semibold text-foreground"
          >
            ← All options
          </button>
        )}

        {/* ── HUB ── Instagram/TikTok-style 2×N grid */}
        {step === "hub" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {createActions
                .filter(({ kind: k }) => k !== "more")
                .map(({ kind: k, label, hint, Icon }) => (
                  <HubCard
                    key={k}
                    icon={Icon}
                    label={label}
                    hint={hint}
                    accent={HUB_ACCENTS[k] ?? "#6b7280"}
                    onClick={() => pick(k as Exclude<CreateKind, "more">)}
                  />
                ))}
            </div>
            {/* Drafts row */}
            <button
              onClick={() => setStep("drafts")}
              className="press flex w-full items-center gap-3 rounded-2xl bg-secondary px-4 py-3 text-left"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                <FolderOpen className="size-5 text-muted-foreground" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">Drafts</span>
                <span className="text-xs text-muted-foreground">Resume unfinished posts</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </div>
        )}

        {/* ── PHOTO ── */}
        {step === "photo" && (
          <PhotoStep
            photoUrl={photoUrl}
            photoUrls={photoUrls}
            activePhoto={activePhoto}
            setActivePhoto={setActivePhoto}
            removePhoto={removePhoto}
            movePhoto={movePhoto}
            maxPhotos={MAX_PHOTO_COUNT}
            photoFilter={photoFilter}
            photoTransform={photoTransform}
            vignetteStrength={adjust.vignette}
            presetId={presetId}
            setPresetId={setPresetId}
            intensity={intensity}
            setIntensity={setIntensity}
            adjust={adjust}
            setAdjust={setAdjust}
            rotate={rotate}
            setRotate={setRotate}
            flip={flip}
            setFlip={setFlip}
            overlays={photoOverlays}
            setOverlays={setPhotoOverlays}
            onCamera={() => setCamera("photo")}
            onUpload={() => {
              pickMode.current = { replace: activePhoto };
              fileRef.current?.click();
            }}
            onAddMore={() => {
              pickMode.current = { replace: null };
              fileRef.current?.click();
            }}
            onContinue={goComposer}
            onCrop={() => setCropping(true)}
            error={error}
          />
        )}

        {/* ── VIDEO ── */}
        {step === "video" && (
          <VideoStep
            videoUrl={videoUrl}
            proxyFrameUrl={proxyFrameUrl}
            playable={videoFile ? videoMeta !== null || !videoProbeDone : true}
            duration={videoMeta?.durationSeconds ?? null}
            detectedType={videoMeta?.contentType ?? null}
            trim={trim}
            setTrim={setTrim}
            speed={speed}
            setSpeed={setSpeed}
            muted={muted}
            setMuted={setMuted}
            videoAdjust={videoAdjust}
            setVideoAdjust={setVideoAdjust}
            origVolume={origVolume}
            setOrigVolume={setOrigVolume}
            musicVolume={musicVolume}
            setMusicVolume={setMusicVolume}
            trackId={trackId}
            setTrackId={setTrackId}
            coverSet={coverFile !== null}
            onSetCover={setCoverFile}
            canTrim={canReencodeVideo()}
            onRecord={() => setCamera("short")}
            onUpload={() => videoRef.current?.click()}
            onContinue={goComposer}
            error={error}
          />
        )}

        {/* ── STORY ── */}
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
            onClearMedia={() => {
              clearPhoto();
              clearVideo();
            }}
            onPhoto={() => {
              // Switching to photo mode — clear text so the image preview wins.
              setTextBody("");
              fileRef.current?.click();
            }}
            onVideo={() => {
              setTextBody("");
              videoRef.current?.click();
            }}
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

        {/* ── TEXT ── */}
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

        {/* ── LIVE SETUP ── */}
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

        {/* ── LIVE ROOM ── */}
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

        {/* ── COMPOSER ── */}
        {step === "composer" && (
          <div className="space-y-3 pb-2">
            {/* Media preview chip */}
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
                  /* autoPlay + muted so the thumbnail loads on Android without user gesture */
                  <video
                    src={videoUrl}
                    poster={videoPosterUrl ?? undefined}
                    autoPlay
                    muted
                    playsInline
                    loop
                    preload="auto"
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
                {/* Quick edit back */}
                <button
                  onClick={() =>
                    setStep(
                      kind === "photo" ? "photo" : kind === "video" ? "video" : kind === "text" ? "text" : "story",
                    )
                  }
                  className="ml-auto shrink-0 rounded-full bg-background px-3 py-1.5 text-xs font-semibold"
                >
                  Edit
                </button>
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
              <span className="text-xs font-semibold text-muted-foreground">Tags &amp; hashtags</span>
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

            {/* ── Music track picker (all post types) ── */}
            {kind !== "story" && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Music className="size-3.5" /> Add a sound
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {/* "None" chip */}
                  <button
                    onClick={() => setTrackId(null)}
                    className={cn(
                      "shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
                      trackId === null ? "bg-brand text-brand-foreground" : "bg-secondary",
                    )}
                  >
                    No sound
                  </button>
                  {TRACKS.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTrackId(trackId === t.id ? null : t.id)}
                      className={cn(
                        "shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
                        trackId === t.id ? "bg-brand text-brand-foreground" : "bg-secondary",
                      )}
                    >
                      {trackId === t.id ? `♪ ${t.title}` : t.title}
                    </button>
                  ))}
                </div>
                {trackId && (
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Music className="size-3" />
                    {TRACKS.find((t) => t.id === trackId)?.title} ·{" "}
                    {TRACKS.find((t) => t.id === trackId)?.creator}
                  </p>
                )}
              </div>
            )}

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
                  Save draft &amp; sign in
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

        {/* ── PUBLISHING ── */}
        {step === "publishing" && (
          <div className="px-2 py-10 text-center">
            {photoUrl && (
              <img
                src={photoUrl}
                alt="Photo being published"
                style={{ filter: photoFilter }}
                className="mx-auto mb-4 size-20 rounded-2xl object-cover"
              />
            )}
            {videoPosterUrl && (
              <img
                src={videoPosterUrl}
                alt="Video thumbnail"
                className="mx-auto mb-4 size-20 rounded-2xl object-cover"
              />
            )}
            <Loader2
              className="mx-auto size-8 animate-spin [animation-duration:0.9s] text-brand"
              strokeWidth={2.5}
            />
            <p className="mt-3 text-[15px] font-semibold">Publishing your {kind}…</p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label="Publish progress"
              className="mx-auto mt-4 h-1.5 w-56 overflow-hidden rounded-full bg-secondary"
            >
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-xs tabular-nums text-muted-foreground">
              {stage === "trim"
                ? "Re-encoding clip (trim/speed)…"
                : progress >= 100
                  ? "Published — refreshing your feed…"
                  : progress >= 82
                    ? "Saving post…"
                    : progress >= 65
                      ? "Upload complete — processing media…"
                      : `Uploading media · ${progress}%`}
            </p>
          </div>
        )}

        {/* ── SUCCESS ── */}
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

        {/* ── DRAFTS ── */}
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

        {/* ── Hidden file pickers ── */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) {
              const replaceIndex = pickMode.current.replace;
              pickMode.current = { replace: null };
              if (step === "story") clearVideo();
              if (replaceIndex !== null) {
                attachPhoto(files[0]!, replaceIndex);
              } else {
                for (const f of files) attachPhoto(f);
              }
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
          const looksVideo = mimeMismatch(f, "image") && !mimeMismatch(f, "video");
          if (looksVideo) attachVideo(f);
          else attachPhoto(f, step === "photo" && photos.length > 0 ? activePhoto : undefined);
          setCamera(null);
        }}
      />

      {cropping && photoUrl && (
        <CropSheet
          open
          onClose={() => setCropping(false)}
          imageSrc={photoUrl}
          onDone={(f) => {
            attachPhoto(f, activePhoto);
            setCropping(false);
          }}
        />
      )}
    </>
  );
}

export { AtSign, Clock, FolderOpen, Link2, MapPin, Mic, Music, RefreshCw, Users };

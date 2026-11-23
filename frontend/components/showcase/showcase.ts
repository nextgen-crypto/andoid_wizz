import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ShowcaseSlide {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  bgFrom: string;
  bgTo: string;
  accent: string;
  cta: string;
  linkUrl: string;
  active: boolean;
  createdAt: string;
}

const KEY = "wizz:showcase-v1";

type SlideRow = {
  id: string;
  title: string;
  subtitle: string;
  image_url: string;
  bg_from: string;
  bg_to: string;
  accent: string;
  cta: string;
  link_url: string;
  active: boolean;
  sort_order: number;
  created_at: string;
};

function fromRow(r: SlideRow): ShowcaseSlide {
  return {
    id: r.id,
    title: r.title,
    subtitle: r.subtitle ?? "",
    imageUrl: r.image_url ?? "",
    bgFrom: r.bg_from ?? "#171208",
    bgTo: r.bg_to ?? "#4a3413",
    accent: r.accent ?? "#f59e0b",
    cta: r.cta ?? "Play now",
    linkUrl: r.link_url ?? "",
    active: Boolean(r.active),
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

function toRow(
  s: ShowcaseSlide,
  sortOrder: number,
): Omit<SlideRow, "created_at"> & {
  created_at: string;
} {
  return {
    id: s.id,
    title: s.title,
    subtitle: s.subtitle,
    image_url: s.imageUrl,
    bg_from: s.bgFrom,
    bg_to: s.bgTo,
    accent: s.accent,
    cta: s.cta,
    link_url: s.linkUrl,
    active: s.active,
    sort_order: sortOrder,
    created_at: s.createdAt,
  };
}

/** Local mirror — same-tab instant updates and an offline fallback. */
export function getSlides(): ShowcaseSlide[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as ShowcaseSlide[];
  } catch {
    return [];
  }
}

function cacheSlides(slides: ShowcaseSlide[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(slides));
  } catch {
    // ignore
  }
}

export function notifySlides() {
  window.dispatchEvent(new CustomEvent("showcase-changed"));
}

/**
 * Slides live in the `showcase_slides` table (public read, admin write) so a
 * banner added in the dashboard shows up in the Android app too — they used to
 * be stored in this browser's localStorage only, which is why the web preview
 * worked and the app never saw them. localStorage stays as the mirror.
 */
export async function fetchSlides(): Promise<{ slides: ShowcaseSlide[]; live: boolean }> {
  try {
    const { data, error } = await supabase
      .from("showcase_slides")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(50);
    if (error || !data) return { slides: getSlides(), live: false };
    const slides = (data as SlideRow[]).map(fromRow);
    cacheSlides(slides);
    return { slides, live: true };
  } catch {
    return { slides: getSlides(), live: false };
  }
}

/** Write the whole set to the server (mirrored locally first so the admin's
 *  own preview never lags). Returns false when RLS/table rejects the write. */
export async function saveSlides(slides: ShowcaseSlide[]): Promise<boolean> {
  cacheSlides(slides);
  notifySlides();
  try {
    const { data: existing, error: readError } = await supabase
      .from("showcase_slides")
      .select("id");
    if (readError) return false;
    const ids = new Set(slides.map((s) => s.id));
    const stale = (existing ?? []).map((r) => r.id).filter((id) => !ids.has(id));
    if (stale.length > 0) {
      const { error } = await supabase.from("showcase_slides").delete().in("id", stale);
      if (error) return false;
    }
    if (slides.length > 0) {
      // Highest sort_order first: the list is rendered newest-first.
      const { error } = await supabase
        .from("showcase_slides")
        .upsert(slides.map((s, i) => toRow(s, slides.length - i)));
      if (error) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function activeSlides(): ShowcaseSlide[] {
  return getSlides().filter((s) => s.active);
}

/** Live list of active showcase slides for feed display. Mount-gated so SSR
 *  (no localStorage) and hydration render identically, then refreshed from
 *  the server so every device converges on the same banners. */
export function useShowcase(): ShowcaseSlide[] {
  const [slides, setSlides] = useState<ShowcaseSlide[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) setSlides(activeSlides());
    };
    refresh();
    fetchSlides()
      .then(({ slides: remote }) => {
        if (!cancelled) setSlides(remote.filter((s) => s.active));
      })
      .catch(refresh);
    window.addEventListener("showcase-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("showcase-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return slides;
}

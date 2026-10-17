import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CommentsSheet } from "./CommentsSheet";

interface CommentsCtxValue {
  /** The single post whose comments sheet is open. Only one at a time. */
  openPostId: string | null;
  openComments: (postId: string) => void;
  closeComments: () => void;
}

const Ctx = createContext<CommentsCtxValue | null>(null);

/**
 * Global "open comments" state. Exactly one <CommentsSheet /> is mounted here,
 * at the app root, so the sheet always layers over the bottom nav and only one
 * can ever exist. Sections call `openComments(postId)` instead of rendering
 * their own sheet.
 */
export function CommentsProvider({ children }: { children: ReactNode }) {
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const openComments = useCallback((postId: string) => setOpenPostId(postId), []);
  const closeComments = useCallback(() => setOpenPostId(null), []);
  const value = useMemo(
    () => ({ openPostId, openComments, closeComments }),
    [openPostId, openComments, closeComments],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <CommentsSheet />
    </Ctx.Provider>
  );
}

export function useComments(): CommentsCtxValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useComments must be used within a CommentsProvider");
  return ctx;
}

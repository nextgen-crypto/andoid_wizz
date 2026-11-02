import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { VideoEditorScreen } from "@/frontend/screens/VideoEditorScreen";
import { takePendingEditorFile } from "@/frontend/lib/editorPendingFile";

function EditorPage() {
  // useState initializer runs ONCE on mount — not on every re-render.
  // takePendingEditorFile() is a one-shot function; calling it on re-renders
  // (which happen after addClip updates the store) would return null and
  // trigger resetProject(), wiping the just-loaded clip.
  const [initialFile] = useState(() => takePendingEditorFile());
  return <VideoEditorScreen initialFile={initialFile} />;
}

export const Route = createFileRoute("/editor")({
  head: () => ({
    meta: [{ title: "WIZZ Editor" }],
  }),
  component: EditorPage,
});

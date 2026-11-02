import { createFileRoute } from "@tanstack/react-router";
import { VideoEditorScreen } from "@/frontend/screens/VideoEditorScreen";
import { takePendingEditorFile } from "@/frontend/lib/editorPendingFile";

function EditorPage() {
  const initialFile = takePendingEditorFile();
  return <VideoEditorScreen initialFile={initialFile} />;
}

export const Route = createFileRoute("/editor")({
  head: () => ({
    meta: [{ title: "WIZZ Editor" }],
  }),
  component: EditorPage,
});

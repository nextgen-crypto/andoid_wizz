import { createFileRoute } from "@tanstack/react-router";
import {
  PostDetailScreen,
  PostDetailPending,
  PostDetailError,
} from "@/frontend/screens/PostDetailScreen";

export const Route = createFileRoute("/post/$postId")({
  head: () => ({
    meta: [
      { title: "WIZZ — Post" },
      { name: "description", content: "Post and conversation." },
      { property: "og:title", content: "WIZZ — Post" },
      { property: "og:type", content: "article" },
    ],
  }),
  pendingComponent: PostDetailPending,
  errorComponent: PostDetailError,
  component: PostDetailScreen,
});

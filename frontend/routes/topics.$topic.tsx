import { createFileRoute } from "@tanstack/react-router";
import { TopicScreen, TopicPending, TopicError } from "@/frontend/screens/TopicScreen";

export const Route = createFileRoute("/topics/$topic")({
  head: () => ({
    meta: [
      { title: "WIZZ — Topic" },
      { name: "description", content: "Posts and discussions about this topic." },
      { property: "og:title", content: "WIZZ — Topic" },
      { property: "og:type", content: "website" },
    ],
  }),
  pendingComponent: TopicPending,
  errorComponent: TopicError,
  component: TopicScreen,
});

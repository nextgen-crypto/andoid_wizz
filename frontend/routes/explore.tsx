import { createFileRoute } from "@tanstack/react-router";
import { ExploreScreen, ExplorePending, ExploreError } from "@/frontend/screens/ExploreScreen";

export const Route = createFileRoute("/explore")({
  head: () => ({
    meta: [
      { title: "WIZZ — Explore" },
      { name: "description", content: "Discover trending topics, people, and discussions." },
      { property: "og:title", content: "WIZZ — Explore" },
      { property: "og:type", content: "website" },
    ],
  }),
  pendingComponent: ExplorePending,
  errorComponent: ExploreError,
  component: ExploreScreen,
});

import { createFileRoute } from "@tanstack/react-router";
import { BookmarksScreen, BookmarksPending, BookmarksError } from "@/frontend/screens/BookmarksScreen";

export const Route = createFileRoute("/bookmarks")({
  head: () => ({
    meta: [
      { title: "WIZZ — Bookmarks" },
      { name: "description", content: "Your saved stories and posts." },
      { property: "og:title", content: "WIZZ — Bookmarks" },
      { property: "og:type", content: "website" },
    ],
  }),
  pendingComponent: BookmarksPending,
  errorComponent: BookmarksError,
  component: BookmarksScreen,
});

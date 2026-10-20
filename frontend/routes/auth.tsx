import { createFileRoute } from "@tanstack/react-router";
import { AuthScreen } from "@/frontend/screens/AuthScreen";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Join WIZZ — Create your account or sign in" },
      {
        name: "description",
        content:
          "Create a WIZZ account or sign in with email or Google to follow creators, post photos and shorts, and keep your feed everywhere.",
      },
      { property: "og:title", content: "Join WIZZ — Create your account or sign in" },
      {
        property: "og:description",
        content:
          "Sign up or sign in to WIZZ to follow creators, post photos and shorts, and save what you love.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthScreen,
});

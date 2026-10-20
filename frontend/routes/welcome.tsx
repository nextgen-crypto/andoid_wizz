import { createFileRoute } from "@tanstack/react-router";
import { WelcomeScreen } from "@/frontend/screens/WelcomeScreen";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome to WIZZ — See what happens inside" },
      {
        name: "description",
        content:
          "A quick tour of WIZZ: live stories, trending topics, full-screen shorts and the creators you follow, all in one mobile feed.",
      },
      { property: "og:title", content: "Welcome to WIZZ — See what happens inside" },
      {
        property: "og:description",
        content:
          "Live stories, trending topics, full-screen shorts and creators you follow — take the WIZZ tour.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WelcomeScreen,
});

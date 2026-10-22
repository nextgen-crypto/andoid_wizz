import { createFileRoute } from "@tanstack/react-router";
import { PrivacyScreen } from "@/frontend/screens/PrivacyScreen";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — WIZZ" },
      {
        name: "description",
        content:
          "What WIZZ collects, why it collects it, and how to ask for deletion of your account and data.",
      },
      { property: "og:title", content: "Privacy Policy — WIZZ" },
      {
        property: "og:description",
        content: "What WIZZ collects, why, and how to ask for deletion of your data.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: PrivacyScreen,
});

import { createFileRoute } from "@tanstack/react-router";
import { TermsScreen } from "@/frontend/screens/TermsScreen";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — WIZZ" },
      {
        name: "description",
        content: "Terms of Service governing your use of the WIZZ app and platform.",
      },
      { property: "og:title", content: "Terms of Service — WIZZ" },
      {
        property: "og:description",
        content: "Terms of Service governing your use of the WIZZ app and platform.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: TermsScreen,
});

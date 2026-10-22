import { createFileRoute } from "@tanstack/react-router";
import { DeleteAccountScreen } from "@/frontend/screens/DeleteAccountScreen";

export const Route = createFileRoute("/delete-account")({
  head: () => ({
    meta: [
      { title: "Delete your WIZZ account" },
      {
        name: "description",
        content:
          "How to request deletion of your WIZZ account and data: the steps, what is deleted, and what is kept and for how long.",
      },
      { property: "og:title", content: "Delete your WIZZ account" },
      {
        property: "og:description",
        content: "Steps to delete your WIZZ account, what is deleted, and what is kept.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: DeleteAccountScreen,
});

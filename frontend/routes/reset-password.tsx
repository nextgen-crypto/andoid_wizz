import { createFileRoute } from "@tanstack/react-router";
import { ResetPasswordScreen } from "@/frontend/screens/ResetPasswordScreen";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset your password — WIZZ" },
      {
        name: "description",
        content: "Choose a new password for your WIZZ account.",
      },
      { property: "og:title", content: "Reset your password — WIZZ" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ResetPasswordScreen,
});

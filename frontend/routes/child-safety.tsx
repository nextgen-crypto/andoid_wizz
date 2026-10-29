import { createFileRoute } from "@tanstack/react-router";
import { ChildSafetyScreen } from "@/frontend/screens/ChildSafetyScreen";

export const Route = createFileRoute("/child-safety")({
  head: () => ({
    meta: [
      { title: "Child Safety Standards — WIZZ" },
      {
        name: "description",
        content: "WIZZ standards against child sexual abuse and exploitation (CSAE).",
      },
      { property: "og:title", content: "Child Safety Standards — WIZZ" },
      {
        property: "og:description",
        content: "WIZZ standards against child sexual abuse and exploitation (CSAE).",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ChildSafetyScreen,
});

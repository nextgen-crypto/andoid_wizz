import { defineConfig } from "vitest/config";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsConfigPaths()],
  test: {
    environment: "node",
    include: [
      "backend/**/*.test.ts",
      "frontend/**/*.test.ts",
      "frontend/**/*.test.tsx",
      "src/tests/**/*.test.ts",
    ],
  },
});

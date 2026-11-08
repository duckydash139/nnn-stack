import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          environment: "node",
          exclude: ["tests/**/*.dom.journey.test.ts"],
          include: ["tests/**/*.journey.test.ts"],
          name: "api",
        },
      },
      {
        test: {
          environment: "happy-dom",
          include: ["tests/**/*.dom.journey.test.ts"],
          name: "dom",
          server: { deps: { inline: ["foldkit"] } },
          setupFiles: ["./support/foldkit-setup.ts"],
        },
      },
    ],
  },
});

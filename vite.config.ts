/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: {
  env: Record<string, string | undefined>;
};

export default defineConfig(({ mode }) => {
  const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
  const isUserPagesRepo = repositoryName?.toLowerCase() === "picksan.github.io";
  const base =
    mode === "production" && repositoryName && !isUserPagesRepo ? `/${repositoryName}/` : "/";

  return {
    base,
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
    },
    test: {
      environment: "node",
    },
  };
});

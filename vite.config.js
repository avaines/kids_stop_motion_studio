import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs work on both a custom domain and /repository-name/.
  base: "./",
  build: {
    target: "es2020",
    sourcemap: true,
    assetsInlineLimit: 0
  }
});

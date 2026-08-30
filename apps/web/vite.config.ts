import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      // Short click/open tracking routes. Regex-anchored rather than a plain
      // "/l" prefix, which would also swallow /login and /lists.
      "^/l/.*": "http://localhost:3000",
      "^/o/.*": "http://localhost:3000",
    },
  },
});

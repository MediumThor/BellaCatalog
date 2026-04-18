import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /**
     * Firebase Storage download URLs are often not CORS-enabled for browser `fetch` / WebGL
     * from localhost. Proxying through the dev server makes requests same-origin so `fetch` →
     * blob → ImageBitmap is usable for Three.js textures.
     */
    proxy: {
      "/__firebase_storage": {
        target: "https://firebasestorage.googleapis.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__firebase_storage/, ""),
      },
    },
  },
});

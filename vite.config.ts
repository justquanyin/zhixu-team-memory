import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      deny: [
        "**/.env",
        "**/.env.*",
        "**/.runtime/**",
        "**/.git/**",
        "**/*.pem",
        "**/*.key",
        "**/*.crt",
      ],
    },
  },
  build: { outDir: "dist" },
});

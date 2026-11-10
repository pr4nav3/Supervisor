import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  // The two pages that load the app. Without this the first start scans every .html under the
  // folder, including the voice and webcam Python environments, and stalls.
  optimizeDeps: {
    entries: ["index.html", "scripts/mac-ui-check/mock.html"],
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    // Not the app: watching the Python environments (tens of thousands of files) and the
    // worker builds held the server up for minutes before it answered.
    watch: {
      ignored: ["**/src-tauri/**", "**/.venv*/**", "**/build/**", "**/notes/**"],
    },
  },
});


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
      // The training set under webcam_worker/train is 100k+ files; watching it pins a CPU core.
      ignored: ["**/src-tauri/**", "**/.venv*/**", "**/build/**", "**/notes/**", "**/webcam_worker/train/**", "**/vendor/**"],
    },
  },
});


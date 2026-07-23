import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.projectloom",
  appName: "Loom",
  // Vite build output — wrapped as-is, no embedded server (client-only app).
  webDir: "dist",
  android: {
    // Keep the WebView background 1-bit black to match the theme on load.
    backgroundColor: "#000000",
  },
};

export default config;

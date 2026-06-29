import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "../package.json";

export default defineManifest({
  manifest_version: 3,
  name: "Quickeee Visual Price Intelligence",
  version: pkg.version,
  description:
    "Phase 1 — extract and display the real product from a Quickeee product page.",
  minimum_chrome_version: "114",
  action: {
    default_title: "Quickeee Visual Price Intelligence",
    default_icon: {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    },
  },
  // Clicking the toolbar icon opens a docked side panel that stays open while
  // you browse (see background: openPanelOnActionClick).
  side_panel: { default_path: "index.html" },
  icons: {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  // Phase 1 needs: read the active tab + inject a reader (activeTab/scripting),
  // and call the Quickeee catalog API directly (host permission below).
  permissions: ["activeTab", "scripting", "tabs", "storage", "sidePanel"],
  host_permissions: [
    "https://quickeee.com/*",
    "https://*.quickeee.com/*",
    "https://api.quickeee.com/*",
    // Phase 2 — local discovery backend (SerpApi proxy). Portless = any port.
    "http://localhost/*",
    "http://127.0.0.1/*",
    // Phase 3 — fetch product images (Quickeee CDN + competitor thumbnails)
    // so the in-extension dHash image-similarity check (Step 4) can run.
    "https://*/*",
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
});

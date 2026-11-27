import fs from "node:fs";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";

const sidebarPath = new URL("./src/generated/sidebar.json", import.meta.url);
const sidebar = fs.existsSync(sidebarPath)
  ? JSON.parse(fs.readFileSync(sidebarPath, "utf8"))
  : [];

export default defineConfig({
  site: "https://rangoonpulse.khzaw.dev",
  base: "/docs",
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "rangoonpulse",
      description: "Operating reference for the rangoonpulse Talos Kubernetes homelab.",
      favicon: "/favicon.svg",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/khzaw/rangoonpulse",
        },
      ],
      sidebar,
      customCss: [
        "@fontsource/ibm-plex-sans/400.css",
        "@fontsource/ibm-plex-sans/500.css",
        "@fontsource/ibm-plex-sans/600.css",
        "@fontsource/ibm-plex-mono/400.css",
        "@fontsource/ibm-plex-mono/500.css",
        "./src/styles/rangoonpulse.css",
      ],
      components: {
        SiteTitle: "./src/components/SiteTitle.astro",
        SocialIcons: "./src/components/SocialIcons.astro",
      },
      expressiveCode: {
        themes: ["github-dark-default", "github-light-default"],
        shiki: {
          langAlias: {
            promql: "txt",
          },
        },
        styleOverrides: {
          borderRadius: "0px",
          codeFontFamily: '"Berkeley Mono", "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace',
          uiFontFamily: '"Berkeley Mono", "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace',
          codeFontSize: "0.84rem",
          frames: {
            frameBoxShadowCssValue: "none",
          },
        },
      },
      plugins: [starlightLinksValidator()],
    }),
  ],
});

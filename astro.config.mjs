import { defineConfig } from "astro/config";

// GitHub Pages serves this as a project site under /comp4020-crit4-chaliang407/,
// not the domain root, so Astro's own generated asset tags (/_astro/...)
// need that prefix or they 404 on the deployed site while still working on
// localhost. The hand-written relative hrefs in BaseLayout.astro
// (./global.css, ./card.png) already resolve correctly either way.
export default defineConfig({
  base: "/comp4020-crit4-chaliang407",
});

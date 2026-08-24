import { defineConfig } from "astro/config";

// A single page at the site root with relative hrefs needs no `base` --- it
// only bites once pages stop living at the root (see BaseLayout.astro and
// spec/README.md if that changes).
export default defineConfig({});

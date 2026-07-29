import path from 'node:path';
import type { AstroIntegration } from 'astro';

/**
 * `@kb-curio/core` Astro integration.
 *
 * Registers the framework's pages and content collection helper. **Does not
 * read `kb-curio.config.ts` here** — `astro:config:setup` runs before Vite's
 * SSR module runner is ready, so dynamic-importing the project's `.ts`
 * config throws `Vite module runner has been closed` (reproducible: see
 * `load-config.ts#loadFrom`). Config reading is deferred to the consumer's
 * `src/content.config.ts`, where Vite is fully booted. The consumer's
 * `astro.config.ts` is responsible for forwarding `site.base` from
 * `kb-curio.config.ts` into Astro's `base`.
 *
 * Routes mounted:
 *   `/`                       — index.astro
 *   `/article`                — article/index.astro (SSR, query params)
 *   `/article/[...slug]`      — article/[...slug].astro (prerender)
 *   `/rss.xml`                — rss.xml.ts (RSS endpoint)
 *
 * Content collections are *not* registered by this integration (Astro 5.18.2
 * does not expose `addContentCollection` on the integration API). Consumers
 * own `src/content.config.ts` and call `kbCurioArticleCollection()` from there
 * (see `src/content.collection.ts`).
 */
export default function kbCurio(): AstroIntegration {
  // After tsc build, this file is at <pkg>/dist/integration.js. The .astro
  // pages ship alongside the source tree at <pkg>/src/pages/, not inside
  // dist/, because tsc doesn't compile .astro files. Adjust the relative
  // path so the integration resolves the same location regardless of how
  // the package is installed (workspace symlink or npm).
  const PAGES_DIR = path.resolve(import.meta.dirname, '..', 'src', 'pages');

  return {
    name: '@kb-curio/core',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        injectRoute({
          pattern: '/',
          entrypoint: path.join(PAGES_DIR, 'index.astro'),
        });
        injectRoute({
          pattern: '/article',
          entrypoint: path.join(PAGES_DIR, 'article', 'index.astro'),
        });
        injectRoute({
          pattern: '/article/[...slug]',
          entrypoint: path.join(PAGES_DIR, 'article', '[...slug].astro'),
        });
        injectRoute({
          pattern: '/rss.xml',
          entrypoint: path.join(PAGES_DIR, 'rss.xml.ts'),
        });
      },
    },
  };
}

import kbCurio from '@kb-curio/core';
import { defineConfig } from 'astro/config';
import kbConfig from './kb-curio.config';

export default defineConfig({
  base: kbConfig.site.base,
  // `site.url` from kb-curio.config.ts is the canonical public URL.
  // Leave undefined in dev so the RSS feed falls back to the request origin.
  site: kbConfig.site.url,
  integrations: [kbCurio()],
  image: {
    service: { entrypoint: 'astro/assets/services/noop' },
  },
});

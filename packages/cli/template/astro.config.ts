import kbCurio from '@kb-curio/core';
import { defineConfig } from 'astro/config';
import kbConfig from './kb-curio.config';

export default defineConfig({
  base: kbConfig.site.base,
  // `site.url` from kb-curio.config.ts is the canonical public URL.
  // Leave undefined in dev so the RSS feed falls back to the request origin.
  site: kbConfig.site.url,
  integrations: [kbCurio()],
  // Articles reference images via raw `![](path)` in markdown — they don't
  // go through `astro:assets`'s <Image> optimizer. The default Sharp
  // service still tries to optimize every referenced image at build time
  // and requires a native dep most consumers don't have; the noop
  // service passes images through verbatim. Consumers who want responsive
  // variants can `pnpm add sharp` and switch to the built-in sharp service.
  image: {
    service: { entrypoint: 'astro/assets/services/noop' },
  },
});

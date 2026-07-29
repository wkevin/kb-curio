import { defineConfig } from 'astro/config';
import kbCurio from './src/integration.ts';

export default defineConfig({
  integrations: [kbCurio()],
});

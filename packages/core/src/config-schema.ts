import { z } from 'zod';

/**
 * Zod schema for `kb-curio.config.ts` — the framework's project config file.
 *
 * Loaded by `packages/core/src/load-config.ts` at Astro build/dev time.
 * Scaffolded projects override `site.base`, `topics`, and `taxonomy` paths.
 *
 * Note: imports `zod` directly (not `astro:content`) so the schema is usable
 * from non-Astro contexts (CLI scripts, build tooling).
 */
export const KbCurioConfigSchema = z.object({
  site: z
    .object({
      base: z.string().default('/'),
      /**
       * Canonical public URL of the deployed site (e.g. `https://kb.example.com`).
       * Forwarded to Astro's `site` config; used by the RSS feed to build
       * absolute item links. Optional — if unset, the RSS feed falls back to
       * the request's origin, so local dev works without extra config.
       */
      url: z.string().url().optional(),
      title: z.string().default('kb-curio'),
      description: z.string().optional(),
      github: z.string().url().optional(),
    })
    .default({}),
  /** Directory (relative to project root) holding articles. */
  dataDir: z.string().default('./data'),
  /**
   * Topics — the multi-tag concept articles declare in their frontmatter.
   * Each topic has id/name/description. The `description` is what the
   * `article-fetcher` skill uses to auto-assign topics at fetch time.
   */
  topics: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .default([]),
  /** Paths (relative to project root) to taxonomy markdown files. */
  taxonomy: z
    .object({
      sources: z.string().optional(),
      tags: z.string().optional(),
      fetched: z.string().optional(),
    })
    .default({}),
  /** Optional: enable a research-output "dimensions" layer (off by default). */
  dimensions: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        icon: z.string().optional(),
      }),
    )
    .optional(),
});

export type KbCurioConfig = z.infer<typeof KbCurioConfigSchema>;

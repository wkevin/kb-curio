/// <reference types="astro/client" />
import { defineCollection, z } from 'astro:content';
import path from 'node:path';
import { glob } from 'astro/loaders';
import { loadKbCurioConfigWithRoot, loadTaxonomySet } from './load-config.ts';

/**
 * Builds the framework's `article` content collection from the consumer's
 * `kb-curio.config.ts`. Exported so consumers can wire it into their own
 * `src/content.config.ts`:
 *
 *   // consumer/src/content.config.ts
 *   import { kbCurioArticleCollection } from '@kb-curio/core/article-collection';
 *   export const collections = { article: await kbCurioArticleCollection() };
 *
 * Why a function (and not a const) instead of a `content.config.ts` inside the
 * framework: Astro 5.18.2 discovers content config by `import()`ing the
 * consumer's `<srcDir>/content.config.ts` and integrations cannot register
 * collections on the consumer's behalf (`addContentCollection` isn't exposed
 * on the integration API). The consumer must own the file; we just provide
 * the collection definition that honors the kb-curio config + taxonomy.
 */
export async function kbCurioArticleCollection() {
  const { cfg, root } = await loadKbCurioConfigWithRoot();
  const dataDir = path.join(root, cfg.dataDir);

  // Taxonomy files: sources + tags are shipped as framework canonical starters
  // (packages/core/taxonomy/) and copied into scaffolded projects by the CLI.
  // fetched.md is user-generated (maintained by the article-fetcher skill) and
  // has no framework default — it lives only in the user's project.
  const FRAMEWORK_TAXONOMY = path.resolve(import.meta.dirname, '../taxonomy');
  const taxonomyPath = (key: 'sources' | 'tags' | 'fetched'): string | null => {
    const rel = cfg.taxonomy[key];
    if (rel) return path.join(root, rel);
    if (key === 'fetched') return null; // user-only file, no framework default
    return path.join(FRAMEWORK_TAXONOMY, `${key}.md`);
  };

  const KNOWN_TAGS =
    cfg.topics.length > 0 ? loadTaxonomySet(taxonomyPath('tags') ?? '') : new Set<string>(); // empty = no validation
  const KNOWN_SOURCES = loadTaxonomySet(taxonomyPath('sources') ?? '');
  const topicIds = cfg.topics.map((t) => t.id);

  return defineCollection({
    loader: glob({
      pattern: '**/index.md',
      base: path.join(dataDir, 'article'),
    }),
    schema: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      pubDate: z.coerce.date().optional(),
      updatedDate: z.coerce.date().optional(),
      author: z.union([z.string(), z.number()]).optional(),
      url: z.string().url().optional(),
      // Source is always optional: research-log posts have no `source`, only
      // curated external articles do. When a value is present and the project
      // defines a source enum (sources.md), it must match.
      source:
        KNOWN_SOURCES.size > 0
          ? z
              .string()
              .optional()
              .refine(
                (s) => !s || KNOWN_SOURCES.has(s),
                (s) => ({ message: `source "${s}" is not listed in taxonomy/sources.md` }),
              )
          : z.string().optional(),
      topics:
        topicIds.length > 0
          ? z
              .array(z.string())
              .min(1, 'articles must declare at least one topic')
              .refine(
                (arr) => arr.every((t) => topicIds.includes(t)),
                (arr) => ({
                  message: `topics contains unknown id "${arr.find((t) => !topicIds.includes(t))}" — known: [${topicIds.join(', ')}]`,
                }),
              )
          : z.array(z.string()).default([]),
      tags:
        KNOWN_TAGS.size > 0
          ? z
              .array(z.string())
              .default([])
              .refine(
                (arr) => arr.every((t) => KNOWN_TAGS.has(t)),
                (arr) => ({
                  message: `tag "${arr.find((t) => !KNOWN_TAGS.has(t))}" is not in tags.md`,
                }),
              )
          : z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    }),
  });
}

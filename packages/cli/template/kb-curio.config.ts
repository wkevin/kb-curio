import type { KbCurioConfig } from '@kb-curio/core/config-schema';

/**
 * kb-curio project config.
 *
 * Edit me to customize your site:
 *  - site.base: URL prefix (e.g. "/kb" if hosting under a subpath)
 *  - site.url: canonical public URL (e.g. "https://kb.example.com").
 *    Used by the RSS feed to build absolute item links. Optional — if
 *    unset, the RSS feed falls back to the request origin, so local dev
 *    works without extra config.
 *  - topics: each topic has id, name, description. Articles declare
 *    `topics: [<id>...]` in their frontmatter; the article-fetcher skill
 *    auto-assigns topics by matching the article against each
 *    `description`.
 *  - taxonomy: paths to taxonomy files (relative to project root)
 */
const config: KbCurioConfig = {
  site: {
    base: '/',
    title: 'My Knowledge Base',
    description: 'A kb-curio knowledge base.',
  },
  dataDir: './data',
  topics: [
    // ← add your topics here, e.g.:
    // { id: 'technology', name: 'Technology', description: '技术相关的文章' },
    // { id: 'philosophy', name: 'Philosophy', description: '思考与方法论' },
  ],
  taxonomy: {
    sources: './data/article/sources.md',
    tags: './data/article/tags.md',
    fetched: './data/article/fetched.md',
  },
};

export default config;

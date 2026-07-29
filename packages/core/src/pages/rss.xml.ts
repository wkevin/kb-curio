import { type CollectionEntry, getCollection } from 'astro:content';
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { loadKbCurioConfig } from '../load-config';

type Article = CollectionEntry<'article'>;

export async function GET(context: APIContext) {
  const cfg = await loadKbCurioConfig();
  const base = `${cfg.site.base.replace(/\/$/, '')}/`;
  // Resolve the link origin:
  //   dev mode → always the request origin (typically http://localhost:4321),
  //     regardless of cfg.site.url. Otherwise opening the dev RSS feed in a
  //     browser would show links pointing at the production host, which the
  //     dev machine typically can't route to.
  //   build mode → Astro's `site` config (import.meta.env.SITE) if set,
  //     otherwise cfg.site.url from kb-curio.config.ts. If neither is set,
  //     fall back to the request origin (Astro fills this with a placeholder
  //     at build time — consumers should set one of the two for a useful
  //     production feed).
  const siteOrigin = import.meta.env.DEV
    ? new URL(context.request.url).origin
    : (import.meta.env.SITE ?? cfg.site.url ?? new URL(context.request.url).origin);

  // All articles, newest first.
  const articles = (await getCollection('article'))
    .filter((a: Article) => !a.data.draft)
    .sort(
      (a: Article, b: Article) => +new Date(b.data.pubDate ?? 0) - +new Date(a.data.pubDate ?? 0),
    );

  return rss({
    title: `${cfg.site.title}`,
    description: cfg.site.description ?? `${cfg.site.title} — knowledge base.`,
    site: new URL(base, siteOrigin),
    items: articles.map((a: Article) => ({
      title: a.data.title ?? a.id,
      pubDate: a.data.pubDate ?? new Date(),
      description: a.data.description ?? '',
      link: `${base}article/${a.id.replace(/^\d{6}\//, '').replace(/\.mdx?$/, '')}`,
      content: extractSummaryHtml(a.body ?? ''),
    })),
    customData: `<language>${cfg.site.title ? 'zh-cn' : 'en'}</language>`,
  });
}

/**
 * Pull **核心观点** and **延伸洞察** lists out of an article body and render
 * them as HTML for the RSS `content` field. The body (原文) is intentionally
 * excluded — RSS readers get the curated summary, not the full article.
 *
 * Body layout assumed by kb-curio articles (curated by the `article-fetcher`
 * skill): frontmatter → (optional metadata block) → **核心观点：** numbered
 * list → **延伸洞察：** numbered list → `---` → 原文. We locate the summary
 * headings anywhere in the body but never read past a `---` once a section
 * has started, so the body can't leak into the feed.
 */
function extractSummaryHtml(body: string): string {
  if (!body) return '';

  const parts: string[] = [];
  for (const heading of ['核心观点', '延伸洞察']) {
    const items = extractNumberedList(body, heading);
    if (items.length > 0) {
      const lis = items.map((t) => `<li>${escapePreservingHighlight(t)}</li>`).join('');
      parts.push(`<h3>${heading}</h3>\n<ol>${lis}</ol>`);
    }
  }
  return parts.join('\n');
}

function extractNumberedList(text: string, heading: string): string[] {
  // Find every bold heading marker `**xxx：**`, then for the requested heading
  // slice from its end up to the next heading (or end of text). Stop early at
  // a `---` separator so we never capture content from the article body.
  const headingRe = /\*\*([^*]+)：\*\*/g;
  const matches = [...text.matchAll(headingRe)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m[1].trim() !== heading) continue;
    const start = m.index + m[0].length;
    let end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const sepInBlock = /^\s*---\s*$/m.exec(text.slice(start, end));
    if (sepInBlock) end = start + sepInBlock.index;
    const block = text.slice(start, end);
    return [...block.matchAll(/^\s*\d+\.\s+(.+)$/gm)].map((x) => x[1].trim());
  }
  return [];
}

function escapePreservingHighlight(text: string): string {
  // Articles use `<span class="highlight">…</span>` for inline emphasis; preserve
  // those tags but escape everything else so stray markup in the body can't
  // break the RSS XML.
  const OPEN = 'HLSPANOPEN';
  const CLOSE = 'HLSPANCLOSE';
  return text
    .split('<span class="highlight">')
    .join(OPEN)
    .split('</span>')
    .join(CLOSE)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split(OPEN)
    .join('<span class="highlight">')
    .split(CLOSE)
    .join('</span>');
}

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

  // All articles, newest first. Sort by `effectiveDate = fetchDate ?? pubDate`
  // so the feed reflects when articles entered this collection; legacy
  // articles without fetchDate fall back to pubDate and stay in the right
  // order relative to each other.
  const effective = (a: Article): number => +new Date(a.data.fetchDate ?? a.data.pubDate ?? 0);
  const articles = (await getCollection('article'))
    .filter((a: Article) => !a.data.draft)
    .sort((a: Article, b: Article) => effective(b) - effective(a));

  // Some RSS readers defensively filter items whose pubDate is in the
  // future (handles clock skew between producer and consumer). `fetchDate`
  // is stamped at the moment article-fetcher runs — on a fast producer
  // clock that can land milliseconds ahead of a reader's "now" and hide
  // the item entirely. Cap the published date at `min(fetchDate, now)` so
  // the item is always visible. Sorting above already used the uncapped
  // fetchDate so the feed order is still "newest fetched first".
  const now = new Date();
  const cappedPubDate = (a: Article): Date => {
    const fd = a.data.fetchDate;
    if (fd && fd <= now) return fd;
    return a.data.pubDate ?? now;
  };

  return rss({
    title: `${cfg.site.title}`,
    description: cfg.site.description ?? `${cfg.site.title} — knowledge base.`,
    site: new URL(base, siteOrigin),
    items: articles.map((a: Article) => {
      const title = a.data.title ?? a.id;
      // Prefix the item title with the article's publication date
      // (`YYYY.MM.DD_<title>`) so feed-list previews surface the date
      // inline — many readers bury <pubDate> in metadata that's hidden
      // until you click through. Use the original pubDate rather than
      // the capped RSS pubDate: the date identifies *what the article
      // is*, not when the collection recorded it. Dot separators (vs
      // ISO `YYYY-MM-DD`) keep the date visually distinct from the
      // title; the underscore makes the boundary parseable.
      const datePrefix = a.data.pubDate
        ? a.data.pubDate.toISOString().slice(0, 10).replace(/-/g, '.')
        : '';
      const itemTitle = datePrefix ? `${datePrefix}_${title}` : title;
      // RSS 2.0 requires <description> on every <item>. We split the
      // curated summary into two channels:
      //   - <content:encoded>: full HTML (`summary`) — what modern readers
      //     render as the article body.
      //   - <description>: plain text, tags stripped, truncated — for
      //     strict / older readers that ignore content:encoded, and as
      //     the feed-list preview text. Frontmatter `description` wins
      //     when present (it's the author's handcrafted blurb).
      const summary = extractSummaryHtml(a.body ?? '');
      // Strip <h3> section headings entirely (otherwise their text —
      // "核心观点", "延伸洞察" — leaks into the description). Then drop
      // remaining tags and collapse whitespace.
      const stripped = summary
        .replace(/<h3>[^<]*<\/h3>\s*/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      // Truncate at a sentence boundary when possible — a hard char
      // slice(0, 280) can cut mid-word (e.g. "写原" inside "写原则而非死规则")
      // and readers parse the dangling fragment as broken XML.
      const LIMIT = 280;
      let plain = stripped;
      if (plain.length > LIMIT) {
        const head = plain.slice(0, LIMIT);
        // Find the last sentence-ending punctuation in head and cut there,
        // so the description reads as "first sentence(s)" rather than
        // "tail of the head chopped at the boundary".
        const sentenceEnd = Math.max(
          head.lastIndexOf('。'),
          head.lastIndexOf('！'),
          head.lastIndexOf('？'),
          head.lastIndexOf('. '),
          head.lastIndexOf('? '),
          head.lastIndexOf('! '),
        );
        if (sentenceEnd >= 0) {
          plain = head.slice(0, sentenceEnd + 1).trim();
        } else {
          // No sentence end in the first LIMIT chars — fall back to the
          // last whitespace so we don't cut mid-word.
          const ws = head.lastIndexOf(' ');
          plain = (ws > 80 ? head.slice(0, ws) : head).trim();
        }
      }
      const fallback = plain || title;
      return {
        title: itemTitle,
        pubDate: cappedPubDate(a),
        description: a.data.description || fallback,
        link: `${base}article/${a.id.replace(/^\d{6}\//, '').replace(/\.mdx?$/, '')}`,
        content: summary || title,
      };
    }),
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
 * has started, so the body can't leak into the feed. Both full-width (`：`)
 * and half-width (`:`) colons are accepted — older articles and some
 * LLM-generated drafts occasionally use the half-width form.
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
  // Find every bold heading marker `**xxx：**` (or `**xxx:**`), then for the
  // requested heading slice from its end up to the next heading (or end of
  // text). Stop early at a `---` separator so we never capture content from
  // the article body.
  const headingRe = /\*\*([^*]+)[：:]\*\*/g;
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

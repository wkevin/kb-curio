import type { KbCurioConfig } from '@kb-curio/core/config-schema';

/**
 * kb-curio demo config.
 *
 * Runs against the curated articles under ./data/article/. Topics below are
 * demo-only examples; the framework does not bake any topic ids in.
 */
const config: KbCurioConfig = {
  site: {
    base: '/',
    // canonical public URL of the deployed demo — forwarded to Astro's `site`
    // config and used by the RSS feed for absolute item links. Leave undefined
    // in dev so the RSS feed falls back to the request origin.
    // url: 'https://kb-curio-demo.example.com',
    title: 'kb-curio demo',
    description: 'A demo of create by kb-curio',
    github: 'https://github.com/wkevin/kb-curio',
  },
  dataDir: './data',
  topics: [
    {
      id: 'ai-reforge',
      name: 'AI 重塑开发',
      description: '关于 AI 改变开发者工作方式、流程和工具的文章',
    },
    {
      id: 'programming-agent',
      name: '编程 Agent',
      description: '关于 Claude Code、Cursor、Aider 等 AI 编程助手的文章',
    },
    {
      id: 'programming-language',
      name: '编程语言',
      description: '关于编程语言设计、演化和工程实践的文章',
    },
  ],
  taxonomy: {
    sources: './data/article/sources.md',
    tags: './data/article/tags.md',
    fetched: './data/article/fetched.md',
  },
};

export default config;

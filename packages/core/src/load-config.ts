import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import { type KbCurioConfig, KbCurioConfigSchema } from './config-schema.js';

/**
 * Find the project root by walking up from `start` looking for kb-curio.config.ts.
 * Stops at the first match. If none found, returns `start` unchanged.
 */
export function findProjectRoot(start = process.cwd(), maxDepth = 5): string {
  let dir = path.resolve(start);
  for (let i = 0; i < maxDepth; i++) {
    if (fs.existsSync(path.join(dir, 'kb-curio.config.ts'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start);
}

export interface LoadedConfig {
  cfg: KbCurioConfig;
  /** Absolute path to the project root that owns this config. */
  root: string;
}

/**
 * Load and validate a project's kb-curio.config.ts, and return the project
 * root the config was loaded from. Callers that need to resolve data paths
 * should use `root`, not `process.cwd()` — when running inside the framework
 * with KB_CURIO_PROJECT set, cwd is the framework dir but the data lives
 * in the consumer project.
 *
 * Resolution order:
 *   1. The `start` argument (if given and contains kb-curio.config.ts)
 *   2. KB_CURIO_PROJECT env var (the absolute project directory)
 *   3. Walking up from process.cwd()
 *   4. The framework's bundled default config (last-resort fallback)
 */
export async function loadKbCurioConfig(start?: string): Promise<KbCurioConfig> {
  const loaded = await loadKbCurioConfigWithRoot(start);
  return loaded.cfg;
}

export async function loadKbCurioConfigWithRoot(start?: string): Promise<LoadedConfig> {
  // 1. Explicit argument
  if (start && fs.existsSync(path.join(start, 'kb-curio.config.ts'))) {
    return {
      cfg: await loadFrom(path.join(start, 'kb-curio.config.ts')),
      root: path.resolve(start),
    };
  }
  // 2. Environment variable (used by the demo's dev script)
  const envProject = process.env.KB_CURIO_PROJECT;
  if (envProject && fs.existsSync(path.join(envProject, 'kb-curio.config.ts'))) {
    return {
      cfg: await loadFrom(path.join(envProject, 'kb-curio.config.ts')),
      root: path.resolve(envProject),
    };
  }
  // 3. Walk up from cwd
  const root = findProjectRoot(start);
  const projectConfig = path.join(root, 'kb-curio.config.ts');
  if (fs.existsSync(projectConfig)) {
    return { cfg: await loadFrom(projectConfig), root };
  }
  // 4. Last-resort framework default (inlined so the bundler can't tree-shake it)
  return {
    cfg: KbCurioConfigSchema.parse(frameworkDefaultConfig()),
    root: path.resolve(import.meta.dirname, '../..'),
  };
}

async function loadFrom(configPath: string): Promise<KbCurioConfig> {
  let mod: Record<string, unknown>;
  if (configPath.endsWith('.ts') || configPath.endsWith('.mts')) {
    // Use jiti so consumers on Node <22.6 (where native .ts imports aren't
    // available) can load .ts configs without a separate build step. Node
    // 22.6+ / 24.x load .ts natively, but jiti works across the supported
    // range (framework's engines.node is '>=20').
    const jiti = createJiti(import.meta.url, { interopDefault: true });
    mod = jiti(configPath) as Record<string, unknown>;
  } else {
    mod = (await import(/* @vite-ignore */ pathToFileURL(configPath).href)) as Record<
      string,
      unknown
    >;
  }
  const raw = (mod as { default?: unknown }).default ?? mod;
  return KbCurioConfigSchema.parse(raw);
}

function frameworkDefaultConfig(): KbCurioConfig {
  return {
    site: {
      base: '/',
      title: 'kb-curio',
      description: 'A generic knowledge-base framework.',
      github: undefined,
    },
    dataDir: './data',
    topics: [],
    taxonomy: {
      sources: undefined,
      tags: undefined,
      fetched: undefined,
    },
  };
}

/**
 * Parse a taxonomy markdown file (sections under `## heading` with `- tag` bullets)
 * into a flat Set of tag/term strings.
 */
export function loadTaxonomySet(absPath: string): Set<string> {
  if (!fs.existsSync(absPath)) return new Set();
  const raw = fs.readFileSync(absPath, 'utf8');
  const out = new Set<string>();
  for (const m of raw.matchAll(/^-\s+(.+?)\s*$/gm)) {
    const v = m[1].trim();
    if (v) out.add(v);
  }
  return out;
}

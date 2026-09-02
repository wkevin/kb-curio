# kb-curio

> 一个 monorepo，承载 **kb-curio 知识库框架** + **脚手架 CLI**，外加一个 demo 实例——把框架跑在 ~100 篇精选文章上。

`@kb-curio/core` 和 `@kb-curio/cli` 是这个 monorepo 里发布的两个 npm 包。**首次发布前**，下游用户可以用 GitHub URL 直接装（见下方"GitHub 源"），也可以用本地 monorepo 方式（见下方"本地开发"）；发布之后，外部用户可以直接 `npx @kb-curio/cli init`（见下方"npm 用户"）。

## 快速开始（npm 用户）

发布之后，外部用户不需要 clone 这个仓库：

```bash
# 一次性使用（无需全局安装）
npx -y @kb-curio/cli init my-new-kb --no-install --no-git
cd my-new-kb && pnpm install && pnpm dev
```

## 快速开始（GitHub 源 / 预发布测试）

```bash
# 一行搞定：npx 自动从 GitHub 拉源码 + 跑脚手架
# 第一次需要时（dist 不存在）会自动 pnpm install + pnpm build
npx github:wkevin/kb-curio init my-new-kb --no-install --no-git
cd my-new-kb && pnpm install && pnpm dev
```

或等效操作：

```bash
git clone https://github.com/wkevin/kb-curio
cd kb-curio
pnpm install
pnpm --filter @kb-curio/cli build

# 在 monorepo 旁边 scaffold 一个新项目（用 link: 模式连回 monorepo）
node packages/cli/dist/cli.js init ../my-new-kb --no-install --no-git
cd ../my-new-kb && pnpm install && pnpm dev
```

### 脚手架参数

| 参数           | 作用                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `[dir]`        | 目标目录（默认 `<cwd-basename>-kb`）                                                                        |
| `-n, --name`   | 项目名（默认取 `dir` 的 basename）                                                                          |
| `--use-pnpm`   | 用 pnpm 安装（默认，若 pnpm 在 PATH 上）                                                                    |
| `--use-npm`    | 用 npm 安装                                                                                                 |
| `--use-yarn`   | 用 yarn 安装                                                                                                |
| `--use-bun`    | 用 bun 安装                                                                                                 |
| `--no-install` | 跳过依赖安装                                                                                                |
| `--no-git`     | 跳过 `git init` + 首次提交                                                                                  |
| `--local`      | 强制本地 monorepo 模式(把 `@kb-curio/core` 改成 `workspace:*` 并把这个项目注册到父级 `pnpm-workspace.yaml`) |
| `--no-local`   | 强制已发布到 npm 的模式(保留 `@kb-curio/core` 为 `^0.2.0`)                                                  |
| `--force`      | 允许向非空目录写入                                                                                          |

## 项目配置

每个 kb-curio 项目（包括 `demo/`）通过 `kb-curio.config.ts` 声明自己的设置：

```ts
import type { KbCurioConfig } from '@kb-curio/core/config-schema'

export default {
  site: { base: '/', title: 'My Knowledge Base' },
  dataDir: './data',
  topics: [
    // 每个 topic 有 id（写入 frontmatter）、name（展示）、description（用于 article-fetcher 自动分类）
    { id: 'technology', name: 'Technology', description: '技术相关的文章' },
    { id: 'philosophy', name: 'Philosophy', description: '思考与方法论' },
  ],
  taxonomy: {
    sources: './data/article/sources.md',
    tags: './data/article/tags.md',
    fetched: './data/article/fetched.md',
  },
} satisfies KbCurioConfig
```

完整 schema 见 `packages/core/src/config-schema.ts`。

## Frontmatter 契约

`data/article/<YYYYMM>/<YYYYMMDD_slug>/index.md` 下的条目必须声明：

```yaml
---
title: <string> # 必填
pubDate: YYYY-MM-DD # 必填
source: social-media # 可选；取值见 sources.md
topics: [technology, philosophy] # 必填；≥1，必须在 kb-curio.config.ts#topics 中
tags: [optional] # 可选；必须存在于 tags.md
url: https://... # 可选；来源 URL
---
```

每篇文章可以归属**多个** topic。`article-fetcher` skill 在下载新文章时，会自动根据文章内容与每个 `topic.description` 匹配，分配最合适的 topic。

## 可用 skills

`.agents/skills/article-fetcher/` 和 `.agents/skills/blog-creator/` 随 `@kb-curio/core` 一起发布，并通过 `kb-curio init` 镜像到脚手架生成的项目里——发布后的镜像以真实目录形式（而非 symlink）随 tarball 一起分发。


## 目录结构

```
kb-curio/
├── packages/
│   ├── core/         @kb-curio/core — Astro 5 web framework (npm)
│   └── cli/          @kb-curio/cli — 脚手架（`kb-curio init`，npm）
│       ├── src/{cli,init,git,package-manager,sync-skills}.ts
│       └── template/                    `kb-curio init` 时复制的内容
├── demo/             framework 的参考 demo（单实例，私有）
│   └── data/
│       └── article/                     扁平 <YYYYMM>/<YYYYMMDD_slug>/ 条目（多 topic）
└── scripts/
    └── sync-demo-from-template.ts       template → demo 同步脚本
```

## 快速开始（本地开发）

```bash
# 安装 workspace 依赖
pnpm install

# 启动 demo（Astro dev server）
pnpm dev:demo
# → http://localhost:4321/

# 构建 framework + CLI
pnpm build

# 在当前仓库里用脚手架生成一个新项目（指向本地的 framework）
pnpm --filter @kb-curio/cli build
node packages/cli/dist/cli.js init ../my-new-kb --no-install --no-git
```


## 保持 demo 与 template 同步

`demo/` 是一次性脚手架生成的实例：它有自己的数据、自己的 frontmatter，**不应该**在 template 每次变更时都被重新生成。改用 sync 脚本按安全合并规则把 template 的新文件拉进来：

```bash
pnpm sync:demo:dry    # 看会改什么
pnpm sync:demo        # 实际应用
```

脚本（`scripts/sync-demo-from-template.ts`）实现了三种策略：

| 策略              | 文件                                  | 原因                                    |
| ----------------- | ------------------------------------- | --------------------------------------- |
| `copy-if-missing` | `AGENTS.md`                           | demo 也应拥有的占位文件。               |
| `report-diff`     | `sources.md`、`tags.md`、`fetched.md` | 实例本地状态——只显示 diff，不自动合并。 |
| `skip`            | `kb-curio.config.ts`、`package.json`  | 故意分叉的文件，绝不覆盖。              |

任何 drift 存在时退出码非零，所以 CI 可以在每个 PR 上跑 `pnpm sync:demo:dry`，在 template 跑在 demo 前面时失败。

## 发布

两个包通过 [Changesets](https://github.com/changesets/changesets) 发到 npm。每次改动开一个 PR 时，运行：

```bash
pnpm changeset           # 选择受影响的包与 bump 级别，写一条 markdown 到 .changeset/
```

合并到 `main` 后，`.github/workflows/release.yml` 会自动：

1. 打开或更新一个 "Version Packages" PR，汇总所有待发布的 changesets。
2. 当 "Version Packages" PR 被合入时，运行 `pnpm release`（=`changeset publish`），把新版本推上 npm，并生成 GitHub Release。
3. 校验 npm 上确实有对应 tag 的版本。

认证有两种方式，二选一：

- **NPM_TOKEN**（简单）：在 repo Settings → Secrets 添加一个 npm Automation token。workflow 默认读取 `secrets.NPM_TOKEN`。
- **npm trusted publishing**（推荐）：到 npmjs.com 给每个包打开 Trusted Publishing，绑定这个 workflow + repo，然后从 workflow 里删掉 `NODE_AUTH_TOKEN` 一行。`permissions.id-token: write` 已经预先开好。

CI 还需要 `NPM_TOKEN` 才能在合并后真正发布；要么把 token 配进 repo secrets，要么用 trusted publishing 配 npm。**当前还没有任何一个 secrets 被配齐，所以 release workflow 现在还跑不出 publish 步骤**——这是仓库准备好之后、由你手动到 npm / GitHub 完成的最后一步。

## 另见

- `AGENTS.md` — 给贡献者的指南（架构决策、开发流程）
- `demo/kb-curio.config.ts` — demo 项目配置
- `packages/cli/template/kb-curio.config.ts` — 脚手架默认配置

---
name: article-fetcher
description: |
  从 URL 抓取网络文章并保存到研究项目的标准格式。支持微博（自动抓取配图）和普通网页。
  所有文章平铺存放在 article/ 目录，分类通过 topics 多标签管理。
  使用标准 YAML frontmatter 格式，与 Astro 博客系统兼容。
  触发词：抓取文章、保存文章、收集文章、fetch article、download article
author: Kevin
version: 1.2
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
---

# Article Fetcher

你是一个文章抓取助手，负责从网络抓取文章并保存到研究项目的标准格式。

如果待抓取的是多篇文章，则每篇文章完整完成工作流程后，再执行下一篇文章的工作流程。

## 核心功能

从给定的 URL 抓取文章内容，自动判断类型并保存到 `article/` 目录。

**目录结构**：所有文章平铺存放在 `article/` 目录下，按日期命名，分类通过 topics 多标签管理。

```
article/
├── YYYYMM/YYYYMMDD_article-title/
│   ├── index.md          # 文章内容
│   └── images/           # 配图（如果有）
│       ├── image_01.jpg
│       └── image_02.jpg
├── fetched.md            # 已下载文章记录（去重用）
├── sources.md            # 信源分类
└── tags.md               # 全局标签列表
```

## 触发条件

当用户说以下内容时触发：

- "抓取这篇文章" / "保存这篇文章" / "收集这篇文章"
- "帮我下载这篇" / "fetch this article"
- 提供 URL 并说"保存"或"抓取"

## 工作流程

### 0. 去重检查

在抓取之前，先检查 URL 是否已经下载：

1. 清洗 url：如果 url 中尾部含有 `?...` 的可选参数，先去掉，仅保留使用有效的 url 部分。
2. 检查该 URL 是否已在 `article/fetched.md` 文件（如果不存在则创建）中
3. 如果已存在，提示用户并跳过抓取：
   ```
   ⚠️ 该链接已下载过：https://xxx/yyy/...
   保存在：article/???/index.md
   ```
4. 如果不存在，继续抓取流程

### 0.5 环境检查（仅对微信公众号）

在运行 Python 脚本前，先确认依赖：

1. **检查 camoufox 二进制是否存在**（按顺序）：
   - `$CAMOUFOX_PATH`（如果设置了环境变量）
   - 默认路径 `/data/software/camoufox/camoufox/camoufox`
   - 用 `ls -la <path>` 验证文件存在且可执行
   - 缺失时给出明确指引：
     ```
     ⚠️ camoufox 二进制未找到
     解决方法（任选其一）：
       1. 设置 CAMOUFOX_PATH 指向已下载的二进制
       2. 运行: python -m camoufox fetch
       3. 跳过此脚本，使用 fallback 链中的 chrome-devtools MCP
     ```
2. **检查 proxy 是否配置**：`echo $HTTP_PROXY $HTTPS_PROXY`
   - 微信公众号需要大陆出口 IP，缺失时给出提示

只有通过这两项检查（或明确跳过）后才进入 step 1。

### 1. 抓取文章（作者、发布时间、内容）

#### 需要抓取 3 类数据

1. 作者：需要区分文章是否转发、转发文章尽量抓取原文作者；需要区分作者和发布媒体，尽量抓取文章作者而不是媒体名称。
2. 发布日期(pubDate)：pubDate 必须是原文的发布日期，不是执行本 skill 抓取的日期！
3. 内容：即文章主题内容，去掉广告、侧边栏、header、footer 等无关数据。

#### 需要附带的操作元信息（非抓取数据）

抓取本身只产生以上 3 类数据。除此之外, index.md frontmatter 还需要附带 1 个**操作时间戳**, 用于追踪文件的最新操作时间:

- **fetchDate**(操作时间戳): 根据**当前操作时间**打上的时间戳(ISO 8601 格式, 如 `2026-08-29T04:23:27.000Z`)。
  - 它**不是**"抓取时间", 也**不是**"原文发布时间"(那是 pubDate);
  - 它表示 skill **执行这一刻**的时间, 后续对文章的二次编辑/更新也应该刷新这个字段。
  - **必须 timezone-aware**: fetchDate 是 skill 执行当下的真实 wall-clock 时刻,不做"对齐零点"之类的取整。直接 `now()` 不会产生"未来时间",真正会制造未来时间的只有 naive datetime + 手动拼 `'Z'` 这一类时区处理错误。正确做法:
    - Python: `datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')`
    - Node: `new Date().toISOString()`(本身即 UTC + `Z`)
    - 禁止 naive `datetime.now()` / `datetime.utcnow()` 后手动拼 `'Z'` —— 这两种都会把本地时间误标成 UTC,才是 RSS reader 把 item 当成未来时间的真正成因。
  - 注: `wechat-fetch.py` 的 `build_markdown` 只对 **pubDate** 做未来日期 cap,不动 fetchDate。

#### 抓取方式 — Fallback 链（按顺序尝试）

对 https://mp.weixin.qq.com/... 文章，使用以下回退链。当且仅当当前方法返回明确失败信号时才切换到下一个，**不要并行重试同一个 URL**。

| 优先级 | 方法 | 适用场景 | 触发 fallback 的信号 |
|---|---|---|---|
| 1 | `wechat-fetch.py` headless | 默认，camoufox 二进制存在 | 脚本退出码 ≠ 0 且 error 含 captcha / timeout / connection |
| 2 | `wechat-fetch.py --headed` | 触发验证码 | headless 模式 captcha detected |
| 3 | chrome-devtools MCP（headed） | camoufox 二进制缺失 / 下载失败 / 启动崩溃 | 步骤 0.5 报告 camoufox 缺失 或 脚本因二进制错误启动失败（exit code 2）|
| 4 | agent-browser skill headed | chrome-devtools MCP 也被风控拦截 | chrome-devtools MCP 返回 captcha 页 |

每一步执行前把上一步的失败原因打印到 stderr，便于诊断。

**Fallback 信号判断**（来自 wechat-fetch.py JSON 输出的 `error` 字段前缀）：

- `"error"` 字段含 `captcha_detected` / `环境异常` → 切到步骤 2
- `"error"` 字段含 `camoufox binary` / `BinaryNotFound` → 跳过步骤 1、2，直接到步骤 3
- `"error"` 字段含 `timeout` / `Connection` 且已重试 2 次 → 步骤 3
- 步骤 1 或 2 返回 `success=true` 但 `markdown_path` 文件 < 200 字符 → 也算失败，升级到下一级
- 步骤 0.5 报告 camoufox 缺失 → 直接跳到步骤 3

**绝对不要做的**：在同一篇文章上循环执行同一个脚本超过 2 次（避免触发更严厉的风控）。

执行方法（步骤 1 / 2 详细）：

1.  检查 system 和 pyenv 中的 python 版本，选择 3.11+ 版本
2.  检查 python 已经安装依赖（位于 `.claude/skills/article-fetcher/scripts/requirements.txt`），没有的话需要安装
3.  运行 Python 脚本（**注意：脚本位于本 skill 目录下**）：

    ```
    # 脚本完整路径：.claude/skills/article-fetcher/scripts/wechat-fetch.py
    python .claude/skills/article-fetcher/scripts/wechat-fetch.py "<url>" <temp_dir>
    ```

    - **默认 headless=True**（无头模式）
    - 如果触发了验证码，**重新运行并传入 `--headed` 参数**切换到有头模式：
      ```
      python .claude/skills/article-fetcher/scripts/wechat-fetch.py "<url>" <temp_dir> --headed
      ```
    - 有头模式下，浏览器会打开窗口让你手动通过验证码，等待内容加载完成后自动继续

其他文章，**使用 MCP 或 Agent Skill 抓取**

- 无须登录验证时：
  - fetcher mcp
  - baoyu-url-to-markdown skill
  - agent-browser skill headless 模式
- 当遇到需要登录验证的页面，推荐使用：
  - chrome devtools mcp
  - agent-browser skill headed 模式

#### Rules

1. **MCP 优先**：fetcher MCP 抓取的内容已经足够完整，尤其是微博
2. **工具选择原则**：能用简单工具（fetcher MCP）完成就不用复杂工具（chrome-devtools MCP），除非有特殊需求
3. **转载内容处理**：如果微博是从 Twitter/X 转载的（文末有 `x.com/...` 链接）：
   - 在"原文链接"部分同时列出微博和原始 Twitter 链接
   - 可以从 Twitter 链接中获取更准确的发布日期和作者信息
4. **日期获取优先级**（重要！必须严格遵守）：
   - **最高优先级**：从抓取工具返回的**明确时间字段**提取（如微博的发布时间、网页的 meta 标签等）
     - 微博：fetcher mcp 通常会返回精确的发布时间，这是最可靠的来源
     - 网页：检查 `<time>` 标签、`pubDate`、`datePublished` 等 meta 字段
   - **不要从正文内容中提取**：正文中的日期（如"2 月 24 日"）只是文章讨论的时间点，不是发布日期
   - **如果时间字段缺失**：尝试用 chrome-devtools mcp 重新抓取获取精确时间
   - **最后手段**：如果以上都没有，使用当天日期
   - ⚠️ **常见错误**：错误地将正文中提到的日期当作发布日期
5. 图片下载
   - 跳过 gif（emoji 等小图）
   - **下载图片**：创建 `images/` 子目录，使用 curl 下载所有图片
6. **内容完整性验证**：
   - 抓取后必须验证正文是否完整，不能只抓取到摘要
   - 如果正文内容少于 200 字或明显不完整，必须换用其他工具重新抓取
   - baoyu-url-to-markdown skill、chrome-devtools mcp 或 agent-browser skill 都有可能在某些网站只抓取到摘要，遇到这种情况立即切换工具
   - 对微信公众号：内容过短（< 200 字）应直接升级到 Fallback 链的下一步，而不是反复重试同一脚本（避免触发更严厉风控）

### 2. 保存文件

1. 从返回结果中提取或生成：标题，
2. 根据 pubDate 和标题创建最终目录：`article/YYYYMM/YYYYMMDD_<标题>/`
3. 把 skill 或 mcp 的输出转换到目标文件夹中：
   - 有些 skill 的输出是文件夹，则移动文件夹到最终目录即可；
   - 有些 skill 的输出是 json 或 text 文本，则写入 `index.md`

**目标文件夹结构**：

```
article/YYYYMM/YYYYMMDD_<标题>/
├── index.md          # 文章内容
└── images/           # 配图（如果有）
```

#### Rules

1. **文件夹命名**：移除不安全字符 `<>:"/\\|?*`

### 3. 生成标签（tags）和提取观点

根据文章 URL 和内容，参考 `article/tags.md` 中标签生成合适的标签(tags)。

**标签选择流程**：

1. 如果没有 `article/tags.md`，则首先复制 `tag-refer.md` 到 `article/tags.md`。
2. 如果没有 `article/sources.md`，则首先复制 `source-refer.md` 到 `article/sources.md`。
3. 读取 `article/sources.md` 获取可用信源（source）列表，并生成 source 属性，遵守下面约束：
   1. source 属性：仅选择，不新建。
   2. source 属性数量：每篇文章只有 1 个 —— 根据 URL 和内容判断
4. 读取 `article/tags.md` 获取已有标签（tag）列表，并生成 tags 属性，遵守下面约束：
   1. **优先使用已有标签**：首先从参考文件中查找可用的标签
   2. 标签可以新建，但要遵守：只有在参考文件中找不到合适标签时才创建新标签
   3. 标签数量：每篇文章 2-5 个标签 —— 根据文章内容判断
   4. 将新标签追加到 `article/tags.md` 对应分类下

生成的标签(tags)填入 index.md 文件的 YAML frontmatter 的 tags 字段中。

### 3.5 分配 topic（自动）

读取项目根目录的 `kb-curio.config.ts`，提取 `topics` 数组。

```
topics: [
  { id: 'ai-reforge', name: 'AI 重塑开发', description: '关于 AI 改变开发者工作方式的文章' },
  { id: 'agent-harness', name: 'Agent & Harness', description: '关于 Claude Code、Cursor、OpenClaw 等 Agent 系统与编排框架' },
  ...
]
```

**匹配流程**：

1. 读完文章的标题 + description + 正文前 500 字
2. 与每个 `topic.description` 做语义匹配（你在 LLM 上下文里判断，不需要调 API）
3. 至少分配 1 个 topic；如果都不明显匹配，使用 topic 数组里的第一个作为 fallback
4. 写入 frontmatter 的 `topics: [...]` 字段（值是 topic 的 `id`，不是 `name`）

**例子**：
- 文章内容是关于 Claude Code 工作流拆解 → 匹配 `agent-harness` 描述 → `topics: [agent-harness]`
- 文章内容是 AI 对行业影响 → 匹配 `ai-reforge` → `topics: [ai-reforge]`
- 文章内容是关于 Rust 类型系统 → 匹配 `programming-language` → `topics: [programming-language]`

注意：每篇文章可以归属**多个** topic（数组形式），不要只挑一个就不管了。

根据文章内容，用简练的语句提炼核心观点（不超过 5 条）、延伸洞察（不超过 3 条）插入到 index.md 中：

- **核心观点**：主要是对文章内容的直接提炼和总结。
- **延伸洞察**：基于文章内容的扩展和升华。

> ⚠️ **标题行必须用全角冒号 `：`**——`rss.xml.ts` 通过正则 `\*\*([^*]+)：\*\*` 匹配这两个粗体标题来抽取 RSS `<content>` 段。如果写成半角冒号 `**核心观点:**`，RSS feed 里这一段会整段消失（虽然页面正文渲染仍正常）。

**index.md 插入示例**（使用标准 YAML frontmatter）：

```markdown
---
title: 文章标题
url: URL
pubDate: YYYY-MM-DD
fetchDate: <datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')>  # timezone-aware UTC,例如 2026-08-29T04:23:27Z (Node `new Date().toISOString()` 也可,会带 `.000Z`)
author: <原作者名称（如有）>
source: <分类>
topics:
  - <topic-id-1>
  - <topic-id-2>
tags: []
---

**核心观点：**

1. <观点 1>
2. <观点 2>
3. <观点 3>

**延伸洞察：**

1. <洞察 1>
2. <洞察 2>
3. <洞察 3>

---

正文内容...

---

## 原文链接

URL
```

### 4. 压缩与替换图片路径（重要）

首先检查下载的图片是否大于 500KB，如果大于，则使用 ImageMagick 将所有图片压缩至 500KB 以内。

#### 流程：

1. **获取页面所有图片 URL**：使用 chrome devtools mcp 的 evaluate_script 获取页面中所有图片
2. **创建 images 目录**并下载所有图片
3. **压缩图片**：使用 ImageMagick 将所有图片压缩至 500KB 以内，参考命令：
   ```bash
   convert "$img" -resize 800x -strip -quality 70 "${img%.png}_temp.png"
   mv "${img%.png}_temp.png" "$img"
   ```
4. **按原文顺序插入正文**：这是最关键的步骤！
   - 阅读原文，确定每张图片在原文中的出现位置
   - 在每个图片对应的原文描述后面插入 `![image_XX](./images/image_XX.png)`
   - 图片必须按原文出现的顺序插入到正文的相应位置，**不能全部放在文末**
5. **删除远程 URL**：如果正文中还有远程图片 URL，用 Grep 搜索并替换为本地路径

#### Rules

#### 示例

**正确示例**：

```
原文：这里描述了一张图片...
![image_01](./images/image_01.png)

原文：另一段描述...
![image_02](./images/image_02.png)
```

**错误示例**（不要这样做）：

```
原文内容...
原文内容...

## 配图  ← 不应该单独放文末
![image_01](./images/image_01.png)
![image_02](./images/image_02.png)
```

### 5. 高亮标注重点

1. 在正文内容中，对核心观点和吸引眼球的词汇、短语、短句添加高亮。
2. 使用 `<span class="highlight">` 而非内联 style，这样可以支持 light/night 主题自动切换。

#### Rules

- 优先标注：核心观点关键词、数据、结论性语句、反常识观点。
- 总体标注的字数：被标注字数控制在整体字数的 1/20 左右。
- 每段标注的字数：每段标注控制在 20 字左右，重点标注词汇、短语、短句，避免标注长段落。
- 文件头部的"核心观点"和"延伸洞察"不进行标注

#### 示例

```markdown
<span class="highlight">重点内容</span>
```

### 6. 标记记录已下载

抓取成功后，将 URL 添加到 `article/fetched.md`：

```markdown
---
title: 已下载文章列表
draft: true
---

本文文件记录所有已抓取的文章 URL，用于去重。

- https://weibo.com/1402400261/QoIM6lglt → 20260125_ai-engineer-growth-roadmap-2026
- https://weibo.com/1402400261/QoSMoogKQ → 20260126_system-design-roadmap-8-weeks
- https://example.com/report → 20260201_ai-industry-report
```

格式：`- URL → 目录名称`（不再包含分类前缀）

### 7. git add & commit

成功抓取新文章后自动执行 git add & commit（仅包含下载的文章文件和 fetched.md），不要 git add 其他无关文件。

git log 的前缀设置为： `new article: `。

**重要**：如果一次抓取多篇文章，必须**每篇文章单独 commit**，不要合并提交。先完成第一篇文章的完整流程（保存 → 更新 fetched.md → git add & commit），再执行下一篇。

### 8. 通知用户

告诉用户文章保存的位置，例如：

```
✓ 文章已保存到: article/xxx/index.md
```

## 整体 Rules

1. 与其他 skill、mcp 的协作要积极、友好，并提示操作权限给用户确认。
2. 遇到无法抓取的时候，提示用户足够的信息，包括但不限于：
   - 是否已正确配置 proxy
   - 是否已安装正确的 skill、mcp
   - 是否已配置好 python 或 node 用来执行 scripts

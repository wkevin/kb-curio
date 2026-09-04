---
name: paper-fetcher
description: |
  从 arxiv.org/html/<id>（或 abs/<id>）抓取学术论文，保存为中英段落交替的双语研究笔记。
  与 article-fetcher 同目录布局（article/YYYYMM/YYYYMMDD_slug/），但 frontmatter
  包含 arxivId / authors / abstract / categories，body 段落采用 EN 段紧跟 ZH 段。
  触发词：抓取论文、保存论文、收录论文、fetch paper、arxiv
author: Kevin
version: 1.0
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
---

# Paper Fetcher

你是一个学术论文抓取助手，从 arxiv 抓取论文并保存为中英段落交替的双语研究笔记。

## 核心功能

从给定的 arxiv URL（或裸 arxiv id）抓取论文，生成双语段落交替的 markdown 文件。

**目录结构**：与 article-fetcher 完全一致——所有论文平铺存放在 `article/` 目录下。

```
article/
├── YYYYMM/YYYYMMDD_<slug>/
│   ├── index.md          # 论文内容（中英段落交替）
│   └── images/           # 配图（如果有）
│       ├── fig_001.png
│       └── fig_002.png
├── fetched.md            # 已抓取记录（去重用）
├── sources.md            # 信源分类
└── tags.md               # 全局标签列表
```

> ⚠️ **继承硬规则**：article 是平铺的，不要新建 `paper/` 目录。论文和文章通过 `source: academic-papers` 和 `tag: arxiv` 区分。

## 触发条件

当用户说以下内容时触发：

- "抓取这篇论文" / "保存这篇论文" / "收录这篇论文"
- 提供 arxiv URL（`arxiv.org/html/...` 或 `arxiv.org/abs/...`）
- 提供裸 arxiv id（如 `2501.01234`）

## 工作流程

### 0. 去重检查

在抓取之前，先检查 arxiv id 是否已经下载：

1. 从 URL 中提取 arxiv id（裸 id 直接用）。
3. 检查 `article/fetched.md`（如果不存在则创建）。
4. 如果已存在，跳过抓取：

```
⚠️ 该论文已下载过：https://arxiv.org/abs/<id>
保存在：article/<YYYYMM>/<YYYYMMDD_<slug>>/index.md
```

### 0.5 环境检查

在运行 Python 脚本前，确认依赖：

1. Python 3.11+ 可用：`python --version` 或 `python3 --version`
2. 依赖已安装（位置：`packages/core/skills/paper-fetcher/scripts/requirements.txt`）：
   ```
   httpx>=0.27
   beautifulsoup4>=4.12
   lxml>=5.0
   markdownify>=0.11
   ```
3. **不需要** Camoufox、不需要 proxy（arxiv 没有 WAF）
4. 缺失时给出明确指引：
   ```
   ⚠️ 依赖未安装
   解决方法：pip install -r packages/core/skills/paper-fetcher/scripts/requirements.txt
   ```

### 1. 抓取论文元数据 + 正文段落

调用 `arxiv-fetch.py`：

```
python packages/core/skills/paper-fetcher/scripts/arxiv-fetch.py "<url>" <temp_dir>
```

脚本会同时抓取 `abs/`（始终可用，提供标题/作者/摘要/日期）和 `html/`（提供正文段落 + 配图）。**无论用户传的是 `/abs/<id>` 还是裸 id，脚本都会自动改用 `/html/<id>` 来抓正文**——arxiv 现在对几乎所有论文都提供 HTML 渲染。如果用户传的是 abs URL，stderr 会输出一行 `↪ 重定向到 HTML 版本: ...` 作为确认。输出 JSON 到 stdout：

```json
{
  "success": true,
  "metadata": {
    "arxivId": "2501.01234",
    "title": "...",
    "authors": ["..."],
    "abstract": "...",
    "pubDate": "2025-01-15",
    "categories": ["cs.LG", "cs.AI"],
    "url": "https://arxiv.org/abs/2501.01234"
  },
  "sections": [
    {
      "heading": "II Anatomy of the Dexterous Hand",
      "paragraphs": [
        "Intro paragraph...",
        {"type": "subsection", "heading": "II-B Transmission System"},
        "First paragraph under II-B...",
        {"type": "figure", "index": 1, "src": "https://.../anatomy.png", "caption": "Fig. 1: ..."},
        "Next paragraph...",
        {"type": "table",  "index": 1, "caption": "TABLE I: Anatomy of Existing Dexterous Hands",
                       "markdown": "| Hand | Year | ... |\n| --- | --- | --- |\n| ... | ... | ... |"},
        "Next paragraph after table..."
      ]
    }
  ],
  "figures": [
    {"index": 1, "src": "https://...", "caption": "..."},
    {"index": 2, "src": null, "caption": "Fig. 2: timeline-only, no image in HTML build"}
  ],
  "tables": [
    {"index": 1, "caption": "TABLE I: ...", "markdown": "..."}
  ],
  "html_available": true,
  "markdown_path": "/tmp/.../index.md",
  "image_dir": "/tmp/.../images",
  "error": null
}
```

**fallback 信号**：
- `html_available=false` 是正常，老论文没有 HTML 版；只抓 abstract，没有正文段落和配图
- `success=false`：检查 `error` 字段，重试或报错

#### Rules

1. **数学公式**：arxiv html 已用 LaTeXML 渲染为 HTML/`<math>` 元素，BeautifulSoup 提取后会丢失语义但保留文本内容（运算符、变量名等）。如果有 `<math>` 标签，按文本形式保留在段中。**不要**试图反推 LaTeX 源码。
2. **图表与表格的位置 = inline markers**：每张 figure / table 在 DOM 树里的实际位置（哪个 section / subsection / 在哪两段之间）由脚本在单次 section 走读时直接记录，作为 `{"type": "figure", ...}` 或 `{"type": "table", ...}` 标记插入到 `paragraphs[]` 列表中。
   - **必须**按 inline 标记出现的位置插入正文——**不要**通过"首次文字提及"反推位置。
   - 顶层 `figures[]` / `tables[]` 数组**只**用于图片下载和数量统计，不要用它来决定插入位置。
   - 理由：论文里"Fig. 4"首次出现在 III-B 的开头，但 Fig. 4 视觉位置完全可能在 III-B 中后段；同理 TABLE I 在 II-B 视觉位置、但 prose 引用在 II-D。如果按"首次提及"插入会完全错位。
3. **figure src 不为 null 就一定能取到图**：脚本同时识别 `<img src=...>`（PNG / JPG）和 `<object data=... type="image/svg+xml">`（SVG timelines / schematics）。两种情况都会下载并落到 `images/fig_NNN.<ext>`，无需占位处理。仅当**两种元素都没有**才按 §5.4 输出 blockquote 占位（极少数情况下才会发生，例如某些 PDF-only 论文的 LaTeXML 完全丢失了某张图）。
4. **subsection 保留**：每个 subsection heading 以 `{"type": "subsection", "heading": ...}` 形式出现在 `paragraphs` 列表里，agent 翻译时要把它视作 `### <heading>` + `### <中文 heading>` 单独处理。

### 2. 段落翻译（中英交替）

**这是 paper-fetcher 与 article-fetcher 的核心差异**。

读取 step 1 输出的 `sections[]`，**逐段翻译成中文**，然后**交错排列**为：

```markdown
<English paragraph 1>

<中文翻译 1>

<English paragraph 2>

<中文翻译 2>

<English paragraph 3>

<中文翻译 3>
```

**核心约束：按段落翻译，禁止按句子拆分。** 一个英文段落里有多少个句子，中文段就有多少个句子，整体作为一对 EN/ZH 出现。不要在中文里把一段切成多个带空行的小段，也不要把多段合并成一个长段。脚本返回的每个 `paragraphs[i]`（字符串）= 1 个 EN 段，紧跟其后 1 个 ZH 段。

具体步骤：

1. **Abstract 按整段翻译**：arxiv 论文的 abstract 在 `metadata.abstract` 字段里是**单个字符串**（arxiv 端就把它压成一行返回）。把它当作正文里的一个长段落——`## Abstract · 摘要` 标题后接 1 个 EN 整段，再接 1 个 ZH 整段，**不按句子拆分**。一段 8 句的 abstract 就是 8 个 EN 句 → 1 个 ZH 段，不要切成 8 对 EN/ZH。
2. **再翻译 sections**：按顺序遍历 `sections[]`，对每个 section：
   - section heading：英文 + 中文（如 `"## 1 Introduction"` + `"## 一、引言"`）。**保持 heading 在前，中文翻译紧随其后**。
   - 每个 paragraph：英文 → 空行 → 中文（保持段落对齐）。
   - 遇到 `paragraphs[i] = {"type": "subsection", "heading": ...}`：把它当成 `### <heading>` 渲染（中英双语 heading），然后继续处理后面的段落。
3. **figure 处理**：遇到 `paragraphs[i] = {"type": "figure", "index": N, "src": ..., "caption": ...}` 时——
   - 按 marker 在 paragraphs 里的**位置**立刻插入：英文 caption → 空行 → 中文 caption → 空行 →（如有图）`![caption](./images/fig_NNN.png)`。
   - **绝对不要按"首次文字提及"反推位置**：脚本已经把 marker 嵌在正确的 DOM 段落之间了，按 paragraphs 顺序处理就是按原文位置处理。
   - 无论 `src` 是否为 null，每个 figure marker 都必须在最终 markdown 里出现。
4. **table 处理**：遇到 `paragraphs[i] = {"type": "table", "index": N, "caption": ..., "markdown": ...}` 时——
   - 同样按 marker 位置立刻插入：双语 caption（英文 + `· ` + 中文翻译）→ 空行 → `markdown` 字段原文表体。
   - 表体（行、列名、单元格）保留英文原文——学术表里的列名通常是 `EA` / `GT` / `BCPT` 这种专有缩写，强行翻译会丢精度。
5. **翻译失败/不确定**：宁可保留英文原段不翻译，也不要硬编中文。**整段对齐**比字字对译更重要。
6. **不要**把整段翻译合并成一段。1 个 EN 段 + 1 个 ZH 段 = 1 对。

> ⚠️ **段落对齐是硬约束**。如果重试翻译（比如 fetch 失败后再次翻译），**整段重新生成**，不要拼接旧的译文。

### 3. 保存文件

1. 从 `metadata.title` 提取标题，生成 slug。
2. 目录：`article/YYYYMM/YYYYMMDD_<slug>/`（YYYYMM/YYYYMMDD 从 `metadata.pubDate` 提取）。
3. 把图片目录 `image_dir/` 移动到最终目录的 `images/`。
4. 写入 `index.md`。

**目标文件夹结构**：

```
article/YYYYMM/YYYYMMDD_<slug>/
├── index.md
└── images/
    ├── fig_001.png
    └── fig_002.png
```

#### Rules

1. **文件夹命名**：移除不安全字符 `<>:"/\\|?*`，空格替换为 `-`，保留中文。
2. **slug 长度**：截断到 60 字符以内。
3. **pubDate 兜底**：如果 `metadata.pubDate` 为空，用 fetchDate 的日期。

### 4. 生成 frontmatter + 标签 + topic

#### frontmatter

```yaml
---
title: "<英文论文标题>"                     # 必须双引号（标题常含 ": "）
url: https://arxiv.org/html/<id>           # 优先 html，没有就写 abs
arxivId: "<id>"                            # 必填
authors:                                   # 数组，不是字符串
  - <Author 1>
  - <Author 2>
categories:                                # 数组
  - <cat 1>
  - <cat 2>
pubDate: <YYYY-MM-DD>
fetchDate: <datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')>  # timezone-aware UTC
source: academic-papers                    # 复用已有 source
topics:
  - paper-reading                          # 新增 topic
tags:
  - arxiv                                  # 必填
  - <从 metadata.categories 选 1-2 个主分类>
  - <从 tags.md "学术论文"分类下选 1-3 个主题词>
---
```

#### Rules

1. **arxivId 必须用字符串**（即使纯数字），避免 YAML 把它解析成数字。
2. **authors 必须用数组**——前导破折号列表，不是逗号串。
3. **title 必须用双引号包起来**——论文标题几乎都包含 `Intelligence: A Survey` 或 `Method: Approach` 这种 `: ` 子串，YAML 会把它当作 mapping 分隔符解析失败。**一律加双引号**（双引号允许中文 `·` 直接写入，单引号在某些 YAML 解析器里有转义歧义）：
   ```yaml
   title: "Attention Is All You Need"
   ```
4. **不要在 frontmatter 写 `abstract` 字段**——abstract 在正文 `## Abstract · 摘要` 双语段里已经出现，再写一遍属于冗余。
5. **topic 按内容选择**：`paper-reading` 不再是合法 topic（已被从 `kb-curio.config.ts#topics` 移除）——"这是一篇论文"这一事实已经在 `source: academic-papers` 里体现了。topic 应该按论文**实际内容**选取：
   - 与 AI 改变开发者工作方式相关 → `ai-reforge`
   - 与 Claude Code / Cursor / Aider 等 AI 编程助手相关 → `programming-agent`
   - 与编程语言设计、演化、工程实践相关 → `programming-language`
   - 与现有任何 topic 都不相关（例如纯粹的 robotics / biology / physics 论文）→ 留空 `topics: []`
6. **tag 选择流程**：
   - 必填 `arxiv`
   - 从 `metadata.categories` 选 1-2 个（如 `cs.LG` / `cs.AI`）
   - 从 `tags.md` "学术论文"分类下选 1-3 个主题词（`machine-learning` / `transformer` / `LLM` 等）
   - 共 3-6 个 tag
7. **新 tag 处理**：如果当前 `tags.md` 找不到合适主题词，可以新建（按"学术论文"分类下的命名规范），并自动追加到 `article/tags.md`。

#### 不要写任何标题头部

旧版曾在正文最上方写：

```
# Attention Is All You Need · 注意力就是你所需要的一切

作者：Ashish Vaswani, Noam Shazeer, ...

**核心观点：**
1. ...
**延伸洞察：**
1. ...
```

**新版一律不写**：

- 不要 `# 标题 · 中文标题` 大标题
- 不要作者行
- 不要 `**核心观点：**` 块
- 不要 `**延伸洞察：**` 块

文件直接从 `## Abstract · 摘要` 开始。`## Abstract` 之前唯一允许的额外段落是「术语」glossary（见下文）。

#### 术语 Glossary（在 Abstract 之前）

在正文第一行 `## Abstract · 摘要` 之前，插入一个 `**术语：**` 块，列出 **5-10 个**真正有门槛的领域专业术语（中英对照 + 一句话解释）：

```markdown
**术语：**

- **力封闭（Force-Closure）**：抓取稳定性分析中的核心判据，要求指尖接触力能抵抗任意方向的外力扰动。
- **Koopman 算子（Koopman Operator）**：将非线性动力学提升到无限维函数空间的线性算子，常用于学习耦合动力学。
- **域随机化（Domain Randomization）**：sim-to-real 迁移中通过随机化仿真参数提升策略对真实环境鲁棒性的技术。
- **几何 fabric 控制器（Geometric Fabric Controller）**：以几何方式编码运动约束（避障、关节限位）的控制律，与 RL 结合时提供物理可行性保证。
- **触觉点云（Tactile Point Cloud）**：把触觉信号映射为 3D 几何的统一表征，便于与视觉点云融合。
- **Bowden 钢索（Bowden Cable）**：腱驱动传动的核心机械元件，外套柔性护套传递拉力，使驱动器可远离关节布置。
- **肌骨骼动力学（Musculoskeletal Dynamics）**：用肌肉–腱–骨骼的生物力学建模手部，比纯刚体仿真更接近真实肌肉激活与协同。
- **Maxwell 应力（Maxwell Stress）**：介电弹性体驱动器（DEA）产生大变形的电致力机制，由电场对极化介电材料的剪切作用产生。
```

**选词标准**：

- 目标读者是有经验的工程师 / 研究者，**不是纯小白**——所以 `RNN` / `神经网络` / `卷积` 这种通用 ML 词不要列。
- 只列论文里**实际出现且理解起来需要门槛**的术语：力学概念、专有驱动/传感结构、具体算法名、跨学科名词。
- 不要堆砌同一类（如不要 3 个不同的 RL 算法都列）。
- 解释要克制（≤ 30 字/条），只点出"它是什么/为什么需要它"，不要展开综述。

---### 5. 图片压缩与定位

如果 `figures[]` 不为空（html_available=true 且抓到 figures）：

1. 检查每张图片大小，>500KB 用 ImageMagick 压缩：
   - **PNG**：`magick "$img" -resize '800x800>' -strip -define png:compression-level=9 "$img"`（保留 alpha；**不要加 -quality 70**，会让 PNG 膨胀；用 `magick` 命令而非 `convert`，避免被 zsh 解释成 `convert` 别名并误把后续 `-strip` 当文件名）
   - **JPG**：`magick "$img" -resize '800x800>' -strip -quality 70 "$img"`
   - **SVG（图占位 / 时间线）**：`magick` 不能光栅化矢量图——会损失清晰度。SVG 本身已经是压缩的紧凑 XML，跳过压缩直接保留即可。
2. 跳过 data: URL（`src=` 以 `data:` 开头的内联图）。**SVG 是允许的**：arxiv LaTeXML 用 `<object data=...svg>` 承载 timeline / schematic，下载下来就是普通 XML，可用 `<img>` 正常渲染。
3. **按 inline marker 位置插入正文**：agent 翻译时按 `paragraphs[]` 里 `{"type": "figure", ...}` 标记的**出现顺序**逐一处理——遇到 marker 就立刻插入 image + 双语 caption，然后继续处理后续段。不要按"首次文字提及"反推位置（图 4 在 III-B 中段，但 prose 里 "Fig. 4" 可能出现在 III-B 开头，**反推会错位**）。
4. **`src` 为 null 的 caption-only figure**（常见于 timeline / schematic）也必须按 inline marker 位置出现，不要丢弃。Agent 在该位置写一段明显的占位块：
   ```markdown
   > **〔图占位 · Fig. 3〕** 论文 HTML 构建未渲染此图（原文此处为按任务分类的研究图谱）。
   > Source caption: *Fig. 3: Research on Dexterous Hand*
   > *(对照原文 PDF 可补全)*

   ```
   - 使用 blockquote 让占位在视觉上明显，但不要把它放在最终段落之外的位置。
   - 如果一行引用已经足够清晰，也可以写成单行 italic：
     ```
     *Fig. 3: Research on Dexterous Hand（论文原文此处为按任务分类的研究图谱，HTML 渲染未含配图；详见下文 III-A 至 III-F 各小节叙述）*
     ```
   - **绝对不要**因为没图片就跳过该 marker——脚本之所以把 caption-only figure 也送出来，就是为了保证 markdown 里的 figure 编号连续、读者能定位到原文。

### 5.5 表格定位

如果 `tables[]` 不为空（html_available=true 且抓到 tables）：

1. **按 inline marker 位置插入正文**：agent 翻译时按 `paragraphs[]` 里 `{"type": "table", "caption": ..., "markdown": ...}` 标记的**出现顺序**处理——遇到 marker 就立刻插入 caption + 表体，然后继续处理后续段。**不要**通过"首次文字提及"反推位置。
2. 视觉位置就是 DOM 位置：例如 TABLE I 在 paper 2605.13925v2 里物理上嵌入 II-B subsection，prose 里"Table I"的首次引用却在 II-D。如果按 prose 插入会错位。
3. caption 必须双语：英文原文 + 中文翻译。
4. 表体（行、列名、单元格）保留英文原文——学术表里的列名通常是 `EA` / `GT` / `BCPT` 这种专有缩写，强行翻译会丢精度。
5. 如果某张表太宽（>8 列），可以省略部分次要列或在 caption 下注明"完整内容见原文 Table I"。

### 6. （已删除）

旧版曾在中文段中加 `<span class="highlight">` 高亮。新版**不做高亮标注**——正文里所有的强调都通过术语 glossary 与段落本身的内容来承担，不要再写 `<span class="highlight">` 标签。

### 7. 标记记录已下载

抓取成功后，将 URL 添加到 `article/fetched.md`：

```markdown
- https://arxiv.org/html/2501.01234 → 20250115_<slug>
- https://arxiv.org/abs/2501.01234 → 20250115_<slug>
```

### 8. git add & commit

成功抓取后自动执行 git add & commit（仅包含下载的论文文件和 `fetched.md`）。

git log 的前缀：`new paper: `。

**重要**：如果一次抓取多篇论文，必须**每篇单独 commit**，不要合并。

### 9. 通知用户

```
✓ 论文已保存到: article/202501/20250115_<slug>/index.md
（中英段落交替双语版，已下载 N 张图）
```

## 完整 index.md 模板示例

```markdown
---
title: Attention Is All You Need
url: https://arxiv.org/html/1706.03762
arxivId: "1706.03762"
authors:
  - Ashish Vaswani
  - Noam Shazeer
  - Niki Parmar
  - Jakob Uszkoreit
  - Llion Jones
  - Aidan N. Gomez
  - Łukasz Kaiser
  - Illia Polosukhin
categories:
  - cs.CL
  - cs.LG
pubDate: 2017-06-12
fetchDate: 2026-09-04T08:23:00Z
source: academic-papers
topics:
  - paper-reading
tags:
  - arxiv
  - cs.LG
  - cs.CL
  - transformer
---

**术语：**

- **缩放点积注意力（Scaled Dot-Product Attention）**：Transformer 的核心算子，对 Q/K/V 做内积并按 √dₖ 缩放后 softmax。
- **多头注意力（Multi-Head Attention）**：把 Q/K/V 投影到 h 个子空间并行做注意力，再拼接投影——让模型同时关注不同表示子空间。
- **位置编码（Positional Encoding）**：用 sin/cos 函数为序列中每个位置注入位置信号，让纯注意力模型补全顺序信息。
- **编码器–解码器（Encoder–Decoder）**：seq2seq 任务的通用骨架，编码器把输入压成隐状态序列，解码器自回归地生成输出。
- **掩码语言建模（Masked Language Modeling）**：预训练任务——随机遮蔽输入 token，让模型根据上下文还原。

## Abstract · 摘要

The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.

主流的序列转导模型基于复杂的循环神经网络或卷积神经网络，包括编码器和解码器。表现最好的模型还通过注意力机制连接编码器和解码器。我们提出了一种新的、简单的网络架构——Transformer，完全基于注意力机制，彻底摒弃了循环和卷积结构。

## 1 Introduction · 一、引言

Recurrent neural networks, long short-term memory and gated recurrent neural networks in particular, have been firmly established as state-of-the-art approaches in sequence modeling and transduction problems such as language modeling and machine translation.

循环神经网络，特别是长短期记忆网络和门控循环神经网络，已经在序列建模和转导任务（如语言建模和机器翻译）中确立为最先进的方法。

Numerous efforts have since continued to push the boundaries of recurrent language models and encoder-decoder architectures.

此后，许多研究继续推动循环语言模型和编码器-解码器架构的边界。

![Transformer architecture](./images/fig_001.png)

*Figure 1: The Transformer - model architecture.*

*图 1：Transformer 模型架构。*

---

## 原文链接

https://arxiv.org/html/1706.03762
```

## 整体 Rules

1. **arXiv 没有 WAF**，所以**不要**用 Camoufox / agent-browser / chrome-devtools。这些工具会引入不必要的依赖和延迟。
2. **html 版本不是所有论文都有**。arXiv 自 2024 年前后开始系统化提供 HTML 渲染，老论文（如 2017 Attention）只有 PDF/abs。脚本会自动 fallback 到 abs（只有 metadata，没有正文段落和 figures），这是正常行为。
4. **翻译对齐**：中文翻译和英文段落必须一一对应。如果 fetch 中途出错重试，**整段 body 重新生成**，不要拼接。
5. **长论文处理**：如果论文 sections 超过 30 个或总段落数 >100，可以考虑：
   - 只翻译 abstract + introduction + conclusion，其他 section 留英文
   - 分多次抓取（先 abstract，再逐 section 追加）
   - SKILL.md 提示用户考虑更长超时/分段处理
6. **与其他 skill、mcp 的协作要积极、友好**，并提示操作权限给用户确认。
7. **遇到无法抓取的时候**，提示用户足够的信息，包括但不限于：
   - 是否已正确安装 python deps
   - URL 是否合法 arxiv 链接
   - 是否配置了 proxy（一般不需要）
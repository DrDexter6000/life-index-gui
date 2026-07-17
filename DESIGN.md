---
name: Life Index
description: 数字化人生档案馆 —— 天界故事书视觉系统
authority:
  human-source: "DESIGN.md"
  machine-contract: "design/tokens.json"
  implementation-layer: "src/styles/tailwind.css"
  snippet-policy: "tokens.json component HTML/CSS snippets are reference examples only"
colors:
  void: "#0a0c12"
  gold: "#ffe792"
  cyan: "#85fff2"
  coral: "#ffb4a6"
  lavender: "#C4B6FE"
  amber: "#F9873E"
  primary-text: "#e8eaf0"
  muted: "#8a8f9c"
  secondary-text: "#818695"
  nav-capsule-bg: "rgba(0, 0, 0, 0.16)"
  glass-border: "rgba(255, 255, 255, 0.08)"
  glass-border-hover: "rgba(255, 231, 146, 0.2)"
typography:
  logo:
    fontFamily: '"Cinzel", "Noto Serif SC", Georgia, serif'
    fontSize: "clamp(1.5rem, 4vw, 2rem)"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.35em"
    textTransform: "uppercase"
  nav-logo:
    fontFamily: '"Cinzel", "Noto Serif SC", Georgia, serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.15em"
    textTransform: "uppercase"
  nav-logo-mobile:
    fontFamily: '"Cinzel", "Noto Serif SC", Georgia, serif'
    fontSize: "0.72rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.13em"
    textTransform: "uppercase"
  telemetry:
    fontFamily: '"Geist Mono", "JetBrains Mono", "Courier New", monospace'
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.04em"
  display:
    fontFamily: '"Cinzel", "Noto Serif SC", Georgia, serif'
    fontSize: "clamp(1.75rem, 5vw, 2.25rem)"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0.08em"
  brand:
    fontFamily: '"Cinzel", "Noto Serif SC", Georgia, serif'
    fontWeight: 400
    lineHeight: 1.3
  control:
    fontFamily: '"Plus Jakarta Sans", "Noto Sans SC", system-ui, sans-serif'
    fontWeight: 500
    lineHeight: 1.2
  body:
    fontFamily: '"Noto Serif SC", "Songti SC", serif'
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.8
    letterSpacing: "normal"
  field-placeholder:
    fontFamily: '"Noto Serif SC", "Songti SC", serif'
    fontSize: "clamp(0.875rem, 0.9vw, 0.9375rem)"
    fontWeight: 400
    lineHeight: 1.8
    letterSpacing: "normal"
    fontStyle: "italic"
    textTransform: "none"
    maxPageTitleRatio: 0.8
  label:
    fontFamily: '"Geist Mono", "JetBrains Mono", "Courier New", monospace'
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.08em"
    textTransform: "uppercase"
  caption:
    fontFamily: '"Geist Mono", "JetBrains Mono", "Courier New", monospace'
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.1em"
    textTransform: "uppercase"
rounded:
  icon: "12px"
  button: "16px"
  card: "24px"
  pill: "100px"
spacing:
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2.5rem"
  content-max: "800px"
  container-max: "1200px"
geometry:
  nav-clearance: "5rem"
  nav-clearance-mobile: "4rem"
  page-top-mobile: "clamp(0.75rem, 2dvh, 1.25rem)"
  page-bottom-clearance: "3rem"
  hero-height: "max(0px, calc(100dvh - var(--layout-nav-clearance)))"
  hero-welcome-top-slot: "clamp(0.5rem, 2.5dvh, 1.5rem)"
  hero-prompt-bottom-slot: "clamp(8rem, 24dvh, 16rem)"
  write-editor-min-height: "min(180px, 22dvh)"
  write-drawer-gap: "0.75rem"
surface:
  content-overlay-opacity: 0.68
  top-nav-bg-gradient: "linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.68) 58%, transparent 100%)"
  nav-blur: "blur(9px) saturate(140%)"
  chart-tooltip-blur-max: "8px"
  ether-surface: "rgba(0, 0, 0, 0.55)"
  ether-surface-hover: "rgba(0, 0, 0, 0.55)"
  ether-control: "rgba(0, 0, 0, 0.39)"
  ether-control-hover: "rgba(0, 0, 0, 0.51)"
  ether-panel: "rgba(0, 0, 0, 0.47)"
  ether-surface-light: "rgba(0, 0, 0, 0.24)"
  ether-surface-ghost: "rgba(0, 0, 0, 0.12)"
motion:
  ease-smooth: "cubic-bezier(0.23, 1, 0.32, 1)"
  micro: "300ms-420ms"
  route: "420ms"
  cinematic-layout: "800ms-1200ms"
  ether: "1200ms"
interaction:
  cursor:
    mode: "four-anchor-svg"
    asset: "/cursors/starweaver-cursor.svg"
    action-asset: "/cursors/starweaver-cursor.svg"
    press-asset: "/cursors/starweaver-cursor-press.svg"
    text-asset: "/cursors/starweaver-cursor-text.svg"
    size: "32x32"
    hotspot: "6 6"
    text-hotspot: "16 16"
    anchor-points: "A(6.2,6.3), B(26.5,16.2), C(16.3,18.1), D(11.2,26.7)"
    corner-radius: "A/B/D 2.1, C 3.15"
    fill: "#05070b"
    stroke: "#f7f5ef"
    stroke-width: "2.4"
    default: "custom, auto fallback"
    interactive: "custom, pointer fallback"
    text-inputs: "text"
    disabled: "not-allowed"
components:
  button-primary:
    backgroundColor: "transparent"
    textColor: "{colors.gold}"
    border: "1px solid rgba(255, 231, 146, 0.3)"
    rounded: "{rounded.pill}"
    padding: "12px 32px"
  button-primary-hover:
    backgroundColor: "rgba(255, 231, 146, 0.08)"
    border: "1px solid rgba(255, 231, 146, 0.5)"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    border: "1px solid rgba(255, 255, 255, 0.08)"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
  button-ghost-hover:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    border: "1px solid rgba(255, 255, 255, 0.15)"
    textColor: "{colors.primary-text}"
  glass-card:
    backgroundColor: "rgba(0, 0, 0, 0.39)"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.card}"
    padding: "24px"
  glass-card-hover:
    backgroundColor: "rgba(0, 0, 0, 0.46)"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.card}"
    padding: "24px"
  nav-desktop-capsule:
    backgroundColor: "{colors.nav-capsule-bg}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "6px"
  input-focus:
    backgroundColor: "rgba(0, 0, 0, 0.08)"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.button}"
    padding: "20px 24px"
  fab:
    backgroundColor: "transparent"
    textColor: "{colors.gold}"
    border: "1px solid rgba(255, 231, 146, 0.4)"
    rounded: "{rounded.pill}"
    size: "56px"
  fab-hover:
    border: "1px solid rgba(255, 231, 146, 0.7)"
    boxShadow: "0 0 20px rgba(255, 231, 146, 0.15)"
  chip:
    backgroundColor: "rgba(255, 255, 255, 0.03)"
    textColor: "{colors.muted}"
    border: "1px solid rgba(255, 255, 255, 0.06)"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  chip-selected:
    backgroundColor: "rgba(255, 231, 146, 0.08)"
    textColor: "{colors.gold}"
    border: "1px solid rgba(255, 231, 146, 0.2)"
---

> **Format**: Stitch-compatible machine-readable design system (YAML frontmatter + Markdown).
> **Authority split**: `DESIGN.md` is the human design authority: intent,
> rationale, owner decisions, and named rules. `design/tokens.json` is the
> machine-readable execution contract: exact tokens, structured rule metadata,
> and checkable values. `src/styles/tailwind.css` is the implementation layer.
> Component HTML/CSS snippets inside `design/tokens.json` are reference
> examples only; they cannot override structured tokens or named rules.
> If the two design documents drift, `DESIGN.md` resolves intent and
> `design/tokens.json` must be synced before implementation follows it.
> **Parallel UI/UX boundary**: DESIGN.md authorizes visual and interaction
> polish only. UI/UX sessions may touch presentational routes, components,
> styles, visual assets, and focused tests. They must not change backend
> behavior, CLI contracts, durable data authority, schemas, package/tooling, or
> product capability scope without explicit coordination through the active
> milestone/contract documents. If a design improvement needs new data or a new
> CLI/L2 capability, record it as a requirement instead of implementing a
> backend workaround.

# Design System: Life Index — The Star-Loom

## 0. Design Authority Model

The design system has three layers:

1. `DESIGN.md` defines the visual philosophy, owner decisions, named rules, and
   human-readable rationale.
2. `design/tokens.json` mirrors the enforceable parts as machine-readable
   tokens, thresholds, rule IDs, and metadata. Long HTML/CSS snippets in it are
   non-authoritative examples and may be stale.
3. `src/styles/tailwind.css` implements the tokens. Route/components should use
   semantic classes or CSS variables instead of one-off screenshot tuning.

When doing UI work, cite the relevant named rule or token before changing a
surface. If a change needs a new visual value, update `DESIGN.md` first for
intent, then `design/tokens.json` for the checkable contract.

### Brand Foundation

The retired BIS document has been folded into this design authority. Life Index
is the user's local-first memory weave: not a dashboard for Markdown files, but
a durable digital life archive whose interface carries quiet permanence,
evidence, and emotional weight.

Durable brand principles:

- **Starweaver**: the user is the person weaving life fragments into an
  enduring record.
- **Digital sovereignty**: local, plain-text, long-lived data remains more
  important than any GUI flourish.
- **Whispering Loom**: AI and automation stay quiet, helpful, and optional; they
  should never dominate the user's authorship.
- **Append-respecting memory**: edits and generated material must remain honest
  about source, provenance, and user confirmation.

Implementation values formerly carried by BIS are not independent authority.
Colors, typography, motion, material, and copy behavior in this file and
`design/tokens.json` are the active design contract.

---

## 1. Overview

**Creative North Star: "The Star-Loom (以太星轨)"**

Life Index 的 UI 必须传达一种**"宁静的永恒感"**。这里不是效率工具，而是你的数字遗迹。设计将纪念碑谷的禅意几何与东方文人的书卷气融为一体：大面积深邃虚空、低饱和度、发光的交互点，与讲究留白（计白当黑）、文字呼吸感、纸张与墨的隐喻交织在一起。

系统拒绝 SaaS 工具的工业感，拒绝 AI 产品的廉价霓虹。每一个界面都是最终品质 —— Screenshot is Spreading（截图即传播）。

**Key Characteristics:**
- **Dark-only**: 深渊背景 `#0a0c12`，无浅色模式。暗室观星的物理场景决定了主题。
- **Ether transparency**: 界面元素是悬浮在以太力场中的织线，允许星光穿透。`mix-blend-mode: screen` 仅用于装饰性边框和图标；正文文本使用多层 `text-shadow` 模拟光影穿透，禁止对正文直接使用 screen。
- **Fading borders**: 卡片边框不是均匀的 1px 线条，而是**渐变消隐线条**——四角微亮，向中部逐渐消隐至透明。
- **Restrained motion**: 使用分层时长而不是单一慢速规则：micro/control 交互 `300–420ms`，route fade 约 `420ms`，布局/电影感动效 `800–1200ms`，Ether/Zen 仪式动效约 `1200ms`。统一使用 `cubic-bezier(0.23, 1, 0.32, 1)`，禁止弹簧、弹跳、弹性效果。
- **Triple-voice typography**: 古典衬线体承载神性标题，等宽字体承载秩序与坐标，人文宋体承载情感与叙事。三种声部交织成织卷的韵律。
- **Bilingual hierarchy**: 中文主导，英文作为微型下标点缀（0.625rem，opacity 0.5，uppercase）。
- **Content-max discipline**: 核心交互区严格限制 `800px` 最大宽度并绝对居中，拒绝宽屏下的视线横向游移。
- **Page composition contract**: 页面级布局必须使用相对视口槽位管理，不用截图像素硬调。导航下方留白、标题槽、核心交互槽之间使用 `dvh`/grid/flex slot 表达；核心交互区同时声明 `width: 100%` 与 `max-width: 800px`，避免在不同浏览器或缩放下按内容宽度收缩。

---

## 2. Background System

背景由四层组成，从底到顶：

1. **视频背景层 (VideoBackground / 星轨运转)** — `z-index: -30`
   - 循环播放的星系漩涡动画视频，提供动态深空氛围；生产背景素材使用 playback-sized `1920x1080` H.264 MP4，而不是 4K 源素材
   - 视频按原始素材无滤镜播放，不使用 `brightness()` / `saturate()` / `contrast()` 纠偏；亮度控制只来自暗角、全局遮罩和 Zen dim 层
   - 视频加载前显示纯色兜底背景 `var(--color-void)`
   - 加载完成后淡入显示，过渡时间 `0.3s ease-out`
   - `prefers-reduced-motion: reduce` 下冻结视频播放在静帧；恢复普通 motion 或页面从 hidden 返回 visible 时继续播放

2. **粒子层 (ParticleCanvas / 星尘漂浮)** — `z-index: -10`
  - 低密度、低速度的漂浮粒子（25-35 个，约为旧 40-64 的 2/3）
  - 半径保持纤细（约 1.0-3.5px），以 DOM `div` + CSS `@keyframes` 渲染，由浏览器 GPU 合成器管理
  - 颜色：亮青 60%、琥珀金 20%、珊瑚 20%；不使用 shadow blur 或模糊光晕
  - 以单个清晰星点通过生命周期 alpha 淡入淡出，接近精致亮青星屑，而不是暗淡灰尘
   - 粒子即"织卷上散落的星屑"，是织星者书写时自然飘落的痕迹

3. **噪点遮罩层 (NoiseOverlay)** — `z-index: 1000`
   - opacity 精确为 `0.055` (5.5%) 的 SVG 噪点层
   - `mix-blend-mode: overlay; pointer-events: none`
   - 作用：消除深色渐变的 8-bit 色阶断层 (Banding)，赋予"纸质/胶片"微颗粒质感

4. **动态暗角 (Vignette)**
   - 叠加在视频层之上，`radial-gradient` 从中心透明过渡到边缘纯黑
  - 参数：`ellipse 60% 60% at 50% 50%, transparent 60%, rgba(0, 0, 0, 0.34) 80%, rgba(0, 0, 0, 0.86) 100%`
   - 作用：引导视觉焦点至中央内容区，增强深邃感

### Named Rules

**The Particle Sparkle Rule.** 〔advisory〕背景粒子应接近精致亮青星屑：低密度 25-35 个，半径约 1.0-3.5px，以 DOM `div` + CSS `@keyframes` 渲染，由浏览器 GPU 合成器管理。颜色：亮青 60%、琥珀金 20%、珊瑚 20%。不使用 shadow blur 或模糊光晕；通过单个清晰星点的生命周期 alpha 淡入淡出建立存在感，不得像暗灰尘或高成本霓虹尘埃。

**The Background Motion Budget Rule.** 〔advisory〕背景运动是氛围而不是主角。视频背景使用 playback-sized 1080p H.264 资产；`prefers-reduced-motion: reduce` 下必须冻结视频播放和装饰性粒子循环，恢复普通 motion 或页面从 hidden 返回 visible 时再继续播放。

---

## 3. Colors

调色板以深渊为底，三颗 celestial glow 为情绪锚点。

### Primary
- **Amber Gold (琥珀金)** (`#ffe792`): 主交互色。象征星光、编织的线与永恒的标记。用于主按钮边框、激活状态、保存仪式的光晕。在深色背景上极稀有 —— 其稀缺性是设计意图的一部分。

### Secondary
- **Cyan (空灵青)** (`#85fff2`): 思考与探索。用于统计数值、数据可视化、搜索高亮、思考类标签。如同星轨中的冷色光年。

### Tertiary
- **Coral (珊瑚粉)** (`#ffb4a6`): 关系与温度。用于情绪标签、健康统计、温馨提示。如同织卷中带有体温的丝线。

### Neutral
- **The Void (深渊)** (`#0a0c12`): 全局背景。以太虚空的底色。
- **Primary Text (主文本)** (`#e8eaf0`): headings、正文、关键信息。
- **Muted (次文本)** (`#8a8f9c`): 标签、辅助说明、占位符。通过 WCAG AA 对比度测试。
- **Secondary (辅助灰)** (`#818695`): 更弱一级的辅助信息、禁用态暗示。

### Semantic Roles
- **Lavender** (`#C4B6FE`): 图表辅助色，用于话题分布等数据可视化。
- **Amber** (`#F9873E`): 图表辅助色，用于统计数据高亮。

### Named Rules
**The One Gold Rule.** 〔advisory〕琥珀金在任意屏幕上使用面积 ≤10%。它的稀有性才是其价值。如果某个界面看起来"很金"，说明用多了。

**The Void-First Rule.** 〔advisory〕背景永远是深渊。任何试图用浅色卡片或亮色底来"提亮"的设计都是对该系统的背叛。

**The Light-Penetration Rule.** 〔advisory〕界面元素必须允许背景星光穿透。`mix-blend-mode: screen` 用于装饰性边框和图标，允许星光自然照亮边缘。但**正文文本不得使用 screen**——在视频背景的明亮星尘区域会导致对比度灾难性丢失。正文文本使用多层 `text-shadow` 模拟星光穿透感（`0 0 40px rgba(0,0,0,0.9), 0 0 80px rgba(0,0,0,0.6)`），既保证可读性又保留光影质感。

---

## 4. Typography

**三重声部字体系统 (The Triple-Voice Type System)**

为了在界面中建立静谧、空灵的视觉层级，Life Index 引入了三种字体角色。它们如同织机上的不同线轴，各司其职，交织成韵律。

| 声部 (Voice) | 字体家族 | 适用场景 | 气质 |
|:---|:---|:---|:---|
| **神性声部 (Divine)** | Cinzel / Noto Serif SC | LOGO、核心标题、仪式性文案 | 石碑雕刻、古雅织机、羽毛笔呼吸感 |
| **秩序声部 (Order)** | Geist Mono / JetBrains Mono | 坐标、时间戳、菜单项、标签 | 织机经纬刻度、精准、不妥协 |
| **叙事声部 (Narrative)** | Noto Serif SC | 正文、编辑器内容、情感文案 | 手写体温润、凡人心跳的温度 |

### Hierarchy

- **Logo** (400, `clamp(1.5rem, 4vw, 2rem)`, 1.2, letter-spacing 0.15em, uppercase):
  - `Life Index`（primary 色）+ `|`（muted，50% 透明度）+ `人生索引`（gold 色）—— Cinzel 古典衬线体
  - 左侧搭配 **Brand Orb（品牌轨道）**：22px 金色圆环 + 10px 中心金点 + 外层呼吸光环
  - 中英混排基线补偿：中文部分 `transform: translateY(-1px)` 抵消 Cinzel 与 Noto Serif SC 的基线差

- **Display** (400, `clamp(1.75rem, 5vw, 2.25rem)`, 1.3, letter-spacing 0.08em):
  - 页面主标题、欢迎词。使用古典衬线体（Cinzel / Noto Serif SC）。
  - 衬线体赋予标题"织卷扉页"的神圣感。

- **Headline** (400, 1.25rem, 1.4, letter-spacing 0.04em):
  - 卡片标题、section headers。使用秩序声部（等宽体）。
  - 如织机上的章节标记，克制而有序。

- **Body** (400, 1.0625rem, 1.8):
  - 正文、编辑器内容。使用叙事声部（人文宋体）。
  - 最大行宽限制在 65–75ch。在冷色调星轨背景中流淌出凡人心跳的温度。

- **Label** (500, 0.75rem, 1, letter-spacing 0.08em, uppercase):
  - 导航标签、按钮文字、元数据。使用秩序声部（等宽体）。
  - 导航中的英文 subscript 保持 `opacity-50`，字号降至 0.625rem；页面副标题不得使用该层级。

- **Caption / Telemetry** (400, 0.6875rem, 1.5, letter-spacing 0.1em, uppercase):
  - 日期、坐标、统计标签。使用秩序声部（等宽体）。
  - 极其克制的亮度呈现，如织机上的经纬刻度。

### Named Rules
**The Bilingual Subtitle Rule.** 〔advisory〕中英混排时，第二语言必须退居次要：更低的透明度、必要时 uppercase。页面标题区的副标题仍使用 Page Subtitle 层级，不得退到导航 micro-label 字号；导航中的英文下标才使用 0.625rem。

**The Fixed Page Incantation Rule.** 〔advisory〕写入、搜索、面板三大主页面使用固定的中英文标题组合，而不是每个 route 临时写一套单语标题。搜索页固定为“穿梭至某个时空坐标... / Warp to a space-time coordinate”，面板页固定为“星图面板 / Constellation Panel”，写入页固定为 Starweaver 夜间织线文案。语言切换时，当前语言文本成为主标题，另一语言退到副标题。

**The Voice-Layering Rule.** 〔advisory〕同一界面中，声部不得混作一团。Brand voice 负责锚定（品牌/标题），Control voice 负责动作（按钮/导航/筛选/表单），Narrative voice 负责内容（正文/写作），Order voice 只负责坐标、数值、诊断与 kicker。

**The Field Placeholder Voice Rule.** 〔advisory〕功能性输入框的 placeholder（搜索、智能检索、元数据、导入路径等）不是导航/按钮 Control voice，也不是 Order label。它应向写入页日志输入框的叙事提示靠近：使用 Narrative voice（`var(--font-narrative)`）、`--text-field-placeholder`、italic、normal letter spacing、no uppercase；placeholder 颜色保持 `var(--color-secondary)`。已输入值、字段标签和操作按钮仍保留各自声部。

**The Field Placeholder Scale Rule.** 〔advisory〕功能性 placeholder 不按页面逐个截图调参，统一消费 `--text-field-placeholder`。该 token 的最大值不得超过页面标题最小字号（`--text-page-title` 下限）的 80%；当前上限为 `0.9375rem`，低于 `1.25rem * 0.8 = 1rem`，保证 placeholder 永远退居页面标题之后。

**The Page Rhythm Rule.** 〔advisory〕页面标题、双语副标题、核心交互区必须共用页面级节奏。Route 不应在组件内部用孤立 `mt/mb` 或截图像素决定垂直位置；用固定语义槽位管理视觉重心。写入页欢迎词属于编辑器 preface，不是 hero/display title，字号不得超过 Headline 层级，副标题字号必须与搜索/面板页面副标题一致。

**The Design Contract Rule.** 〔enforced: design-sync〕`DESIGN.md` 决定视觉意图和规则优先级；`design/tokens.json` 记录可执行 token、阈值与 rule metadata；`src/styles/tailwind.css` 负责实现。`tokens.json` 中的 component HTML/CSS snippet 只是参考示例，不得覆盖 token 和 named rules。任何 UI 修改如引入新数值，必须同步这两层设计文档或明确说明未触及 token。

**The Visual Geometry Protocol.** 〔enforced: design-lint/no-arbitrary-geometry〕关键页面几何必须通过命名 token 与语义 class 管理，而不是在 TSX 中散落 arbitrary `px/vh` 调参。导航占位使用 `--layout-nav-clearance`，Hero 可见高度使用 `--layout-hero-height`，Hero 欢迎词/底部提示分别使用 `--hero-welcome-top-slot` 与 `--hero-prompt-bottom-slot`，写入框与抽屉使用 `--write-editor-min-height` 与 `--write-drawer-gap`。如需调整视觉重心，先改协议 token，再做跨宽屏/窄屏验证。

---

## 5. Elevation

系统不使用传统 Material Design 的阴影层级，也不使用厚重的玻璃材质。**深度通过"以太力场"本身传达**，由七层黑底透明度体系（The Ether Surface Hierarchy）管理：

1. **Ether Surface (`rgba(0, 0, 0, 0.39)` — Heavy)**：主卡片、搜索输入框、核心内容面片的默认底色。相对旧 `0.30` 版本透明度降低约 30%，在视频背景上提供更稳定的对比度，同时保持"以太薄膜"的通透感。
2. **Ether Surface Hover (`rgba(0, 0, 0, 0.46)`)**：Heavy 态的悬停加深，用于主卡片和搜索框 hover。
3. **Ether Control (`rgba(0, 0, 0, 0.26)` — Medium)**：次级按钮、控件、操作面片的底色。
4. **Ether Control Hover (`rgba(0, 0, 0, 0.34)`)**：Medium 态的悬停加深。
5. **Ether Panel (`rgba(0, 0, 0, 0.31)`)**：展开面板、选项卡片、下拉容器的底色。
6. **Ether Surface Light (`rgba(0, 0, 0, 0.16)` — Light)**：导航胶囊、标签栏、悬浮导航的极薄底色。
7. **Ether Surface Ghost (`rgba(0, 0, 0, 0.08)` — Ghost)**：输入框、标签、幽灵按钮的最小存在感底色。在纯 void 背景（如深色页面）可适当提升层级。

在此基础上，辅以渐变消隐边框和星光穿透：

- **渐变消隐边框**：卡片边框不是均匀的 1px 线条，而是四角微亮、向中部逐渐消隐至透明的渐变线条。实现方式：`padding: 1px` + `background: linear-gradient(...)` + `-webkit-mask` 抠出边框。
- **星光穿透（仅装饰）**：装饰性边框和图标可使用 `mix-blend-mode: screen` 让星光自然照亮边缘。正文文本使用 `text-shadow` 多层阴影模拟光影穿透，禁止对正文直接使用 screen。

### Border Vocabulary
- **Ether Card Rest**: 渐变消隐边框（四角 `rgba(255,255,255,0.12)`，中部消隐）。底色 `var(--color-ether-surface)`（Heavy）。无内阴影、无 inset highlight——厚度感与以太悬浮概念冲突。
- **Ether Card Hover**: 边框亮度提升至金色 `rgba(255,231,146,0.15)`，底色增至 `var(--color-ether-surface-hover)`（Heavy hover）。禁止任何位移上浮。
- **Zen Glow**: `box-shadow: 0 0 40px rgba(255,231,146,0.1), inset 0 0 20px rgba(255,231,146,0.05)` —— 更柔和、更弥散的金色光晕，象征"灵光正在汇聚"。
- **Save Condensation**: `box-shadow: 0 0 60px rgba(255,231,146,0.25)` —— 保存瞬间的爆发式金色光辉，随后文字如星屑向中心飘移。

### Named Rules
**The Ether Surface Rule.** 〔advisory〕所有界面背景透明度必须使用七层黑底 Ether Surface 体系，按场景选择层级：Heavy（`--color-ether-surface` / `0.39`）用于主卡片和搜索输入；Heavy hover（`--color-ether-surface-hover` / `0.46`）；Medium（`--color-ether-control` / `0.26`）用于次级按钮和控件；Medium hover（`--color-ether-control-hover` / `0.34`）；Panel（`--color-ether-panel` / `0.31`）用于展开面板和选项卡片；Light（`--color-ether-surface-light` / `0.16`）用于导航胶囊和标签栏；Ghost（`--color-ether-surface-ghost` / `0.08`）用于输入框、标签和幽灵按钮。禁止使用已废弃的白底渐变玻璃系统（glass-bg-start/end 等）。

**The No-Blur Rule.** 〔enforced: design-lint/blur-whitelist〕系统拒绝 `backdrop-filter: blur()` 作为默认材质。以太悬浮感通过极薄底色 + 渐变消隐边框 + `mix-blend-mode: screen` 实现。blur 仅用于顶部导航胶囊、移动端右上角菜单框体等小面积导航场景，半径统一 `9px`；数据图表的临时 tooltip 可作为可读性例外使用不超过 `8px` 的局部 blur。不得用于大面积卡片、页面遮罩或持久内容面板。

**The No-Heavy-Glass Rule.** 〔advisory〕卡片不再是"厚玻璃"。它们是一片片轻薄的以太薄膜，悬浮在星轨之上。用户应该能透过卡片看到背后运转的星系。

**The Content Readability Overlay Rule.** 〔advisory〕除 Hero Screen 待机首屏外，所有界面必须启用全局半透明黑色遮罩层（位于视频背景之上、粒子层之下），用于统一降低背景动画亮度并提高前景元素可读性。

**The Font Voice Rule.** 〔enforced: design-lint/font-via-var〕品牌文案使用 Brand voice：`Cinzel / Noto Serif SC`；功能按钮、导航、筛选、语言切换和表单控制使用 Control voice：`Plus Jakarta Sans / Noto Sans SC`；长文本与写作正文使用 Narrative voice：`Noto Serif SC`；等宽 Order voice 仅保留给坐标、数值、诊断、kicker 等秩序信息。

---

## 6. Interaction Tiers

界面根据织星者当下的心流状态分为三个密度层级：

1. **星图浏览 (Star Map Browsing)**
   - 信息密度中等。卡片在鼠标悬停时，边框微亮，底色微增。禁止任何位移上浮。
   - 悬停反馈由元素自身的边框亮度与底色变化承担，不在鼠标位置绘制额外光斑或尾迹。
   - 桌面端使用四锚点 Starweaver cursor：`/cursors/starweaver-cursor.svg`，32x32，hotspot `6 6`。形体只由 A/B/C/D 四点闭合：A(6.2,6.3) → B(26.5,16.2) → C(16.3,18.1) → D(11.2,26.7) → A；内部黑色 `#05070b`，白色薄描边 `#f7f5ef` / `2.4`。A/B/D 使用 `2.1` 圆角，C 使用 `3.15` 圆角（大 50%）保留内凹折点。普通区域 fallback 为 `auto`。
   - Cursor 变体沿用同一视觉语言，但必须保持语义克制：可点击元素复用 `/cursors/starweaver-cursor.svg`，由元素自身 hover/active 反馈表达可交互性，fallback 为 `pointer`；按下态使用 `/cursors/starweaver-cursor-press.svg`，轮廓轻微压实、填充暗化到 `#030407`，不使用 cyan 装饰，fallback 为 `pointer`；文本输入使用 `/cursors/starweaver-cursor-text.svg`，hotspot `16 16`，由单一融合轮廓构成清晰 I-beam（`M 12.20 6.25` 起笔，`stroke-width=1.8`），不使用 cyan 中线或重叠药丸，fallback 为 `text`。禁用控件仍保留系统 `not-allowed`。
2. **以太隐退 (The Ether Dissolve)**
  - 当织星者点击输入框时，界面进入"织造心流"：导航栏、设置键以慢速缓动曲线（800ms）优雅隐去，背景星轨调暗，界面仅留你笔下的这行字。
  - Zen 模式下方按钮区必须真实折叠到 `0`，不能留下不可输入的空白占位；输入区同步向下伸展补足这段高度，使编辑器外框在进入/退出 Zen 时保持稳定。
  - 按钮区折叠与输入区伸展必须使用同一时长和 easing，避免回弹、错拍或先后错位。
   - 编辑器边缘仅保留一环极其缓慢呼吸的金色光晕，象征"灵光正在汇聚"。

3. **星尘凝聚 (The Condensation of Stars)**
   - 完成记录的一瞬间，文字如星屑般向中心恒星核飘移。
   - 高爆发、短时长 (≤1.5s) 的"星尘凝聚"动效。这代表你刚刚写下的低语，已经凝聚成了一颗不灭的星星，落入它在星轨中该有的位置。
   - 随后界面 gently 恢复，如同一颗新星稳定运转后，星轨重新归于平静。

### Named Rules
**The Starweaver Cursor Rule.** 〔advisory〕Cursor 体验使用静态 CSS cursor 资产，不使用 DOM 跟随式假光标、持续 `pointermove`、粒子或滤镜动画。默认和可点击资产必须遵守四锚点轮廓：A/B/C/D 依次连成封闭图形，黑色填充、白色薄描边；A/B/D 为同半径圆滑转角，C 为 1.5 倍半径圆滑内凹转角。实现只在 `(pointer: fine)` 启用；普通区域 fallback 为 `auto`，按钮、链接和可点击区域 fallback 为 `pointer`，按下态使用同轮廓压实变体，文本输入、日期输入和可编辑区域使用同风格 I-beam 变体并 fallback 为 `text`，禁用控件保留 `not-allowed`。可点击态复用默认箭头，不引入额外图标或点状装饰；按下态不得使用 cyan 装饰；文本态必须是一眼读作 I-beam 的单一融合轮廓，不能由重叠药丸或分离矩形拼成。

---

## 7. Components

### Buttons
- **Shape:** Pill (`rounded-full`, 100px radius)。所有主要操作按钮均为胶囊形。
- **Primary (Cast to Sea / 执笔):** 透明背景，金色文字 (`#ffe792`)，1px 金色边框（透明度 0.3）。font-family 使用 Control voice（`Plus Jakarta Sans / Noto Sans SC`），0.75rem，letter-spacing 0.08em，uppercase。Hover 时背景微亮至 `rgba(255,231,146,0.08)`，边框亮度提升至 0.5。配合微型纸飞机/小梭子图标，象征"将思绪织入星轨"。按钮本身也是半透明的以太薄膜。
- **Save Ritual:** 保存瞬间触发 1.2s 金色边框流光动画 + 内容收缩 (`scale(0.98)`)，仪式感十足。
- **Ghost / Secondary:** 透明背景，Muted 色文字，1px 白色边框（透明度 0.08）。font-family 使用 Control voice，0.75rem。用于次级操作和筛选标签。Hover 时背景微亮至 `rgba(255,255,255,0.05)`，边框亮度提升至 0.15。

### Chips / Tags
- **Style:** Pill shape，`bg-white/5`，`border: 1px solid rgba(255,255,255,0.08)`，Muted 色文字。交互型 chip 使用 Control voice，0.75rem；非交互坐标标签可使用 Order voice。
- **Selected:** `bg-[var(--color-gold)]/10`，金色文字，金色边框（透明度 0.2）。
- **Topic Chips:** 按主题映射颜色（工事→金、求知→青、养生→珊瑚等）。

### Cards / Containers — Ether Interface
- **Corner Style:** 24px radius (`rounded-3xl`)。甚至更大，赋予柔软包裹感。
- **Background:** `var(--color-ether-surface)` (`rgba(0, 0, 0, 0.39)`) —— Heavy 层级，确保背景视频的星轨仍能穿透，但卡片/输入框可读性优先。在纯 void 场景可降至 Ghost 或 Light 层级。
- **Border:** 渐变消隐线条。四角 `rgba(255,255,255,0.12)`，向中部线性渐变至 `transparent`。
- **No Inset Highlight:** 不再使用 1px 内发光线（这会制造物理厚度感，与以太悬浮概念冲突）。
- **Internal Padding:** `24px` (`p-6`) 起步，重要卡片可到 `32px` (`p-8`)。
- **Hover:** 边框四角亮度微增至金色 (`rgba(255,231,146,0.15)`)，底色微增至 `var(--color-ether-surface-hover)` (`rgba(0,0,0,0.46)`)。禁止位移上浮。

### Inputs / Fields
- **Style:** 与 Ether Card 相同的极薄底色 + 渐变消隐边框。无底部 stroke-only 样式。
- **Focus:** 边框四角变为金色（`rgba(255,231,146,0.35)`），叠加 `0 0 30px rgba(255,231,146,0.1)` 外发光。`transition: border-color 0.3s ease, box-shadow 0.3s ease`。
- **Field Placeholder:** 搜索、智能检索、元数据、导入路径等功能性 placeholder 使用 Field Placeholder voice：Narrative font、`--text-field-placeholder`、italic、normal tracking、no uppercase，并保持 `var(--color-secondary)` 的低声量；尺寸由 Field Placeholder Scale Rule 统一约束，不允许 route 级单独放大。
- **Ether Dissolve:** 编辑器容器进入 `zen-bottle` 状态，4s 呼吸金色光晕动画，边框色在 `rgba(255,231,146,0.3)` 与 `0.6` 之间循环。
- **Search Hover:** 搜索输入框不得上浮；hover 只允许轻微底色、边框或文字亮度变化。
- **Search Date Options:** 搜索页不使用一排常驻 chips。日期筛选放入可展开的 Ether option card，提供起始/结束日期输入，并沿用秩序声部 label 与轻薄玻璃边框。

### Navigation
- **Desktop (TopNavBar / 天际线):**
  - 左侧：**Brand Orb** + `Life Index | 人生索引`（Cinzel，神性声部）。Orb 含 6s 周期呼吸动画。
  - 背景遮罩：`linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.68) 58%, transparent 100%)` —— 顶部为黑色渐变，不带蓝色相；相对旧 `0.86 / 0.52` alpha 增加约 30% 并在顶部钳制为纯黑，以避免导航下方文字与背景星轨互相抢占。
  - 菜单项使用 Control voice，胶囊容器使用 Light 层级 `var(--color-ether-surface-light)` (`rgba(0,0,0,0.16)`) + `backdrop-filter: blur(9px) saturate(140%)`，以轻磨砂玻璃而非实体底色成立。
  - 激活项为金色文字 + 胶囊背景微亮。
- **Mobile TopNav:** 窄屏顶部保留 Brand Orb + `Life Index | 人生索引` + 右侧菜单按钮，但品牌组使用 `nav-logo-mobile`，Orb 约 24px，整体视觉面积较桌面导航缩小约三分之一，并与 40px 菜单按钮在同一视觉中线对齐。窄屏页面标题到 header 的首个节奏槽使用 `page-top-mobile`，避免标题被推得过低。
- **Mobile Menu (右上角下拉):** 菜单项、英文副标、语言切换按钮必须统一使用 Control voice（`var(--font-control)`）、`0.08em` tracking 和项目导航层级字号；不能退回浏览器默认字体。弹出框体使用更不透明的深色底（约 `0.63` alpha）+ `backdrop-filter: blur(9px) saturate(140%)`，开合仍只使用轻量 opacity/transform，不使用巨幅 shadow 或 scale 组合动画。
- **Hero Screen Scroll Lock:** Hero Screen 是首屏待机场景，宽屏和窄屏都必须锁定页面滚动；未进入写入 surface 前，不允许隐藏的写入内容撑出可滚动文档高度。
- **Write Drawer Proximity:** 写入页元数据/附件抽屉属于同一 `800px` workbench，应贴着编辑器下方展开，只保留一个短节奏间距；不得被页面级 `min-height` 或 viewport slot 推到屏幕下方。
- **Mobile (BottomNavBar / 星轨栏):** 当前生产路由未渲染底部导航；如未来重新启用，必须使用顶部导航同一 `9px` nav blur token、极薄底色和 `min-h-[44px]` 触控目标。激活指示器为金色小横条 + `layoutId` 动画切换。
- **FAB (执笔 / Weave):** 右下角固定，`w-14 h-14`，透明圆形，金色边框（透明度 0.4），深色图标。Hover 时边框 glow 增强，中心出现微弱的星尘漩涡动画。

### Brand Orb（品牌轨道）
- **结构**：桌面导航 32px 容器，绝对定位居中。中心 10px 金色圆点（`box-shadow: 0 0 12px rgba(201,176,127,0.6)`）+ 22px 外环（`border: 1.5px solid rgba(201,176,127,0.25)`）+ 外层呼吸光环（`animation: orbBreathe 6s ease-in-out infinite`）。窄屏导航使用 24px / 7px / 16px / 21px 的紧凑比例。
- **动画**：`0%,100% { opacity: 0.3; transform: scale(1); }` → `50% { opacity: 0.7; transform: scale(1.08); }`

### Memory Fragment（记忆碎片）
- **出现场景**：写入待机状态（hero screen），视频背景之上。
- **内容**：随机引用历史日志片段，格式 `"引用文本" <span class="memory-date">YYYY.MM</span>`。
- **字体**：叙事声部（Noto Serif SC），0.9375rem；日期戳秩序声部（Geist Mono），0.6875rem。
- **动画**：16s 周期——4s 缓慢浮现（opacity→0.45 + 轻微 translateY 归位）、8s 停留、4s 缓慢溶解（opacity→0 + 轻微上浮）。只允许 opacity + transform，不使用 `filter: blur()` 或动画化 text-shadow。
- **频率**：每 6-9s 生成一个新碎片，随机位置分布，最多同时存在 3-4 个。

**The Memory Fragment Performance Rule.** 〔advisory〕Hero Screen 记忆碎片必须像低声浮现，而不是高成本雾化文字。碎片动画只允许 opacity + transform；禁止 `filter` / `backdrop-filter` / `blur()` 和 animated text-shadow。静态 text-shadow 可保留用于视频背景可读性，但元素必须用 `will-change: opacity, transform` 与 `contain: layout paint style` 将重绘局部化。

### Hero Screen Incantation（待机欢迎词）
- **位置**：Welcome Back / Starweaver 必须位于亮色星轨核心上方，通过 `--hero-welcome-top-slot` 控制顶部距离，不用截图像素硬编码。
- **可读性**：文字可覆盖深色星空或暗角区域；不得与视频最亮的中心团块重叠。
- **入场**：欢迎词使用 2.5s 左右的慢速 opacity 渐显与极轻微上浮归位，背后允许很淡的径向暗底以增强电影感和可读性。
- **底部提示**：Click Anywhere 提示保持原有下方槽位，不贴底，通过 `--hero-prompt-bottom-slot` 管理；不要在 TSX 中临时写 `pb-[...]` 或为了视觉平衡擅自上移到背景亮核区域。

### Fixed Write Greeting（固定写入欢迎语）
- **出现场景**：写入 The Core 顶部，编辑器上方。
- **固定文案**："夜幕已降，织星者。星轨已准备好编织你的想法。" / "The night has fallen, Starweaver. The orbits are ready to weave your thoughts."
- **双语副标题**（永远退居次要，使用 Page Subtitle 层级，muted，opacity 0.62）："The night has fallen, Starweaver. The orbits are ready to weave your thoughts."
- **字体**：中文使用叙事声部（Noto Serif SC），英文可使用秩序声部（Geist Mono，全大写），但字号必须与 Page Subtitle 层级一致。

### Panel Cards（星图面板卡片）
- **Kicker:** 秩序声部，0.6875rem，uppercase，letter-spacing 0.12em，用于英文/坐标层。
- **Title:** 主文本色。紧凑 dashboard 卡片使用 Control voice 约 1rem；章节型卡片可使用 Headline/Order voice。不得把面板小卡片标题做成页面 Display 层级。
- **Value:** 统计数字使用秩序声部、tabular feeling、金/青/珊瑚作为稀有强调。
- **Surface:** 必须使用 Ether Card 的轻薄半透明黑底与渐变消隐边框；不得给图表卡片单独设置厚重蓝灰渐变或另一套内阴影。

### The Warp Transition (超光速时空折叠)
- 切换页面（写入/搜索/面板）时，不允许硬切。搜索与面板 route 使用 opacity + 轻微 blur 淡入淡出；写入 route 使用 opacity-only fade，避免编辑入口产生不必要的模糊感。
- duration: 420-800ms, easing: `cubic-bezier(0.23, 1, 0.32, 1)`。
- **隐喻**：每一次切换，都是织星者在记忆织卷的经纬网格中进行的一场超光速穿梭。

### Signature Component — Celestial Loader
- 双轨道旋转：外环金色（2s linear infinite），内环青色（1.5s linear infinite，反向）。
- 线条宽度：1px（纤细，降低存在感）。
- 中心核心：金色圆点，呼吸缩放 + 透明度脉动。
- 加载文字：秩序声部（等宽体），`role="status"`，2s 透明度呼吸动画，tiered text（0-2s/2-5s/5s+ 三档文案自动切换）。

---

## 8. Do's and Don'ts

### Do:
- **Do** 让琥珀金保持稀有。任意屏幕上金色使用面积 ≤10%。
- **Do** 使用 `cubic-bezier(0.23, 1, 0.32, 1)` 作为所有过渡的标准缓动。
- **Do** 按 motion tier 使用时长：micro/control `300–420ms`，route fade 约 `420ms`，layout/cinematic `800–1200ms`，Zen/Ether 约 `1200ms`。Zen 模式退出与进入对称同速。
- **Do** 将核心交互区限制在 800px 最大宽度并绝对居中。
- **Do** 以中文为主、英文为辅进行导航标注。英文必须是微型下标。
- **Do** 优先使用 `transform` 和 `opacity` 做动画；必要的几何变化只能通过命名 CSS 变量、grid/flex track 或语义 class 编排，禁止在组件里临时动画化 `width`、`height`、`margin`。
- **Do** 保持粒子层低密度（≤35）、低速度、低存在感。它们是深渊中的生命感，不是主角；不要用 shadow blur 制造持续 GPU 光晕。
- **Do** 允许背景星光穿透界面元素。`mix-blend-mode: screen` 用于装饰边框和图标，正文使用 `text-shadow` 多层阴影模拟光影穿透。
- **Do** 使用渐变消隐边框替代均匀边框。四角微亮，中部消隐。

### Don't:
- **Don't** 使用 `backdrop-filter: blur()` 作为默认材质。除顶部导航胶囊、移动端菜单框体和不超过 `8px` 的临时图表 tooltip 外，优先使用深色半透明底、细边框和短 opacity/transform 动画。
- **Don't** 使用弹簧/弹跳/弹性动画。`spring`、`bounce`、`elastic` 全部被禁止。
- **Don't** 使用渐变文字（`background-clip: text`）。强调通过字重和字号实现，而非装饰性渐变。
- **Don't** 使用 `#000` 或 `#fff`。即使是中性色也要向品牌色调偏移。
- **Don't** 在组件命名中偏离 BIS 体系。保留 The Core / Recall / Archives 三个页面英文名，其余全部按 BIS 命名。
- **Don't** 将 retired local archives, prototypes, tool outputs, or historical
  workpacks 当作新的规范来源。
- **Don't** 让 Zen 模式下的非核心元素通过 `display: none` 或独立 `height: 0` 突然消失。若按钮区折叠到 `0`，必须与输入区等量、同速、同 easing 伸展绑定，保持整体编辑器轮廓稳定。
- **Don't** 直接复制粘贴 Stitch/Bolt 等 AI 生成的 code.html。必须经过转化协议。
- **Don't** 在同一层级混用三种字体声部。神性、秩序、叙事必须各司其职。
- **Don't** 对正文文本使用 `mix-blend-mode: screen`。视频明亮区域会导致可读性灾难。
- **Don't** 使用厚重的实体卡片边框和内阴影。卡片应该是轻薄的以太薄膜。
- **Don't** 在任何元素上使用鼠标悬停时的位移上浮效果（`translateY(-n px)`、`hover:translate-y`、Framer Motion `whileHover={{ y: ... }}` 等）。悬停反馈只允许边框亮度、底色、透明度或文字颜色的变化，不得产生任何位置偏移。入场动画和状态过渡中的位移不受此限制。

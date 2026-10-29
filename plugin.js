// 外观工坊 (ui-studio) — 桌面端全部外观，集中在一个面板里。
//
// 设计目标（v3）：面板里**每一项都用「它改了什么东西」命名**，不出现「皮肤 / 令牌 /
// 基线」这类机制词；不留「看不懂又看不出变化」的选项 —— 原来「高级」里那两个滑杆
// （输入框描边 / 底色）驱动的是 app 的 --dt-input-border / --dt-input-bg，但本插件
// 自己已经给 composer-surface 写死了 0.5px 发丝线，拖动它们没有任何可见变化，
// 已删除；档位改名「一键预设」并说明它等于把「疏密 / 字号 / 圆角」一次设好。
//
// 三层实现，从上到下依次覆盖：
//   1) 配色主题：系统色（浅/深两套）+ 终端 ANSI 色板，走 THEMES_AREA。注意字体：
//      macOS 上 Hermes 默认正文本来就是 SF（--dt-font-sans 里 -apple-system 那一段，
//      见 styles.css:476），本皮肤真正换掉的只有等宽（JetBrains Mono → SF Mono）。
//   2) 组件样式：10 段可单独关闭的 CSS —— 尺寸基线、毛玻璃、控件、气泡、工具卡、
//      滚动条。尺寸段覆盖的是 app 自己的设计系统变量（稳定契约），组件段用组件上
//      的 data-slot 标记（较脆，所以能逐段关）。
//   3) 档位覆盖：只写"用户碰过"的那几项，且注入在组件样式之后 → 一定压过前两层。
//
// 面：状态栏右侧「●外观」chip；⌘K 里 7 条命令。

import {
  host,
  PALETTE_AREA,
  Popover,
  PopoverContent,
  PopoverTrigger,
  requestTheme,
  STATUSBAR_AREAS,
  Switch,
  THEMES_AREA,
} from '@hermes/plugin-sdk'
import { useState, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const STYLE_ID = 'ui-studio-css'
const STORAGE_KEY = 'state.v2'
const THEME_NAME = 'apple'
const FALLBACK_THEME = 'nous'
const APPLE_BLUE = '#007AFF'

// ── 1. 配色主题（浅/深两套系统色） ────────────────────────────────────────────
// 系统色：浅色 #007AFF / 深色 #0A84FF；内容白 / #1C1C1E；
// 侧栏 #EDEDF0 / #232325；分隔线 #D6D6DB / #3A3A3C。
// 把主色按比例兑进目标色（用于给主题算浅底色 / 深底色）。
function mixHex(hex, target, ratio) {
  const parse = value => {
    const clean = String(value).replace('#', '')
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16))
  }
  const [r1, g1, b1] = parse(hex)
  const [r2, g2, b2] = parse(target)
  const to = v => Math.round(v).toString(16).padStart(2, '0')
  return '#' + to(r1 + (r2 - r1) * ratio) + to(g1 + (g2 - g1) * ratio) + to(b1 + (b2 - b1) * ratio)
}

const APPLE_THEME = {
  name: THEME_NAME,
  label: '外观优化',
  description: '中性系统配色 + SF Mono 等宽 + 连续圆角与毛玻璃',
  colors: {
    background: '#F5F5F7',
    foreground: '#1D1D1F',
    card: '#FFFFFF',
    cardForeground: '#1D1D1F',
    muted: '#F0F0F2',
    mutedForeground: '#6E6E73',
    popover: '#FFFFFF',
    popoverForeground: '#1D1D1F',
    primary: '#007AFF',
    primaryForeground: '#FFFFFF',
    secondary: '#F0F0F5',
    secondaryForeground: '#1D1D1F',
    accent: '#E5EFFD',
    accentForeground: '#1D1D1F',
    border: '#D6D6DB',
    input: '#C7C7CC',
    ring: '#007AFF',
    midground: '#007AFF',
    midgroundForeground: '#FFFFFF',
    composerRing: '#007AFF',
    destructive: '#FF3B30',
    destructiveForeground: '#FFFFFF',
    sidebarBackground: '#EDEDF0',
    sidebarBorder: '#E1E1E6',
    userBubble: '#EDEDF0',
    userBubbleBorder: '#E1E1E6',
  },
  darkColors: {
    background: '#1C1C1E',
    foreground: '#F2F2F7',
    card: '#2C2C2E',
    cardForeground: '#F2F2F7',
    muted: '#2C2C2E',
    mutedForeground: '#98989D',
    popover: '#2C2C2E',
    popoverForeground: '#F2F2F7',
    primary: '#0A84FF',
    primaryForeground: '#FFFFFF',
    secondary: '#2C2C2E',
    secondaryForeground: '#F2F2F7',
    accent: '#1B3A5C',
    accentForeground: '#F2F2F7',
    border: '#3A3A3C',
    input: '#48484A',
    ring: '#0A84FF',
    midground: '#0A84FF',
    midgroundForeground: '#FFFFFF',
    composerRing: '#0A84FF',
    destructive: '#FF453A',
    destructiveForeground: '#FFFFFF',
    sidebarBackground: '#232325',
    sidebarBorder: '#333336',
    userBubble: '#3A3A3C',
    userBubbleBorder: '#48484A',
  },
  typography: {
    fontSans:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', 'PingFang SC', system-ui, sans-serif",
    fontMono: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, 'JetBrains Mono', monospace",
    baseSize: '1rem',
    lineHeight: '1.45',
    letterSpacing: '-0.006em',
  },
  // Apple 终端「Basic」档案的 ANSI 色。
  terminal: {
    foreground: '#000000',
    cursor: '#000000',
    selectionBackground: '#B4D7FF',
    black: '#000000',
    red: '#C41A16',
    green: '#007400',
    yellow: '#826B28',
    blue: '#0000FF',
    magenta: '#A90D91',
    cyan: '#318495',
    white: '#C7C7C7',
    brightBlack: '#4C4C4C',
    brightRed: '#C41A16',
    brightGreen: '#007400',
    brightYellow: '#826B28',
    brightBlue: '#0000FF',
    brightMagenta: '#A90D91',
    brightCyan: '#318495',
    brightWhite: '#C7C7C7',
  },
  darkTerminal: {
    foreground: '#FFFFFF',
    cursor: '#FFFFFF',
    selectionBackground: '#3A5A8C',
    black: '#000000',
    red: '#FF6B60',
    green: '#5FD75F',
    yellow: '#E5C07B',
    blue: '#6B9BFF',
    magenta: '#E29BFF',
    cyan: '#6FD3E0',
    white: '#E5E5E5',
    brightBlack: '#7C7C7C',
    brightRed: '#FF8A80',
    brightGreen: '#8CE88C',
    brightYellow: '#F0D399',
    brightBlue: '#93B8FF',
    brightMagenta: '#EFB8FF',
    brightCyan: '#9CE5EE',
    brightWhite: '#FFFFFF',
  },
}

// ── 2. 组件样式段 ────────────────────────────────────────────────────────────
// 每段的 label/note 都用"它改了什么东西"来写，不出现机制词。
// 三套清新配色：一套同时管正文强调色和气泡填充色（同源，所以永远一致）。
const PALETTES = [
  { id: 'mint', label: '薄荷', bubble: '#2FB3A6', main: '#0EA598', code: '#3E9BE0', alt: '#4F9E5A', ink: '#FFFFFF', edge: 'rgba(255,255,255,0.30)' },
  { id: 'sky', label: '天空', bubble: '#3E9FE0', main: '#2E8FE0', code: '#17A9A0', alt: '#7A66E0', ink: '#FFFFFF', edge: 'rgba(255,255,255,0.30)' },
  // 丁香：深紫气泡 + 白字（跟着另外两套走），主色贴品牌靛蓝。
  { id: 'lavender', label: '丁香', bubble: '#9186F2', main: '#7C6BF0', code: '#0E9AA7', alt: '#9A3E9E', ink: '#FFFFFF', edge: 'rgba(255,255,255,0.30)' },
]

const SECTIONS = [
  {
    id: 'tokens',
    label: '字号与圆角',
    note: '字号 · 圆角 · 阴影',
    css: `
:root {
  --radius-scalar: 0.8;
  --shadow-xs: 0 1px 2px color-mix(in srgb, #000 4%, transparent);
  --shadow-sm:
    0 0 0 0.5px color-mix(in srgb, #000 6%, transparent),
    0 1px 2px color-mix(in srgb, #000 5%, transparent);
  --shadow-md:
    0 0 0 0.5px color-mix(in srgb, #000 7%, transparent),
    0 4px 14px -4px color-mix(in srgb, #000 10%, transparent),
    0 12px 32px -12px color-mix(in srgb, #000 14%, transparent);
  --shadow-nous:
    0 1px 2px -1px color-mix(in srgb, #000 8%, transparent),
    0 8px 20px -8px color-mix(in srgb, #000 10%, transparent),
    0 20px 44px -20px color-mix(in srgb, #000 14%, transparent);
  --shadow-lg:
    0 0 0 0.5px color-mix(in srgb, #000 7%, transparent),
    0 10px 30px -8px color-mix(in srgb, #000 12%, transparent);
  --shadow-composer: 0 1px 3px color-mix(in srgb, #000 4%, transparent);
  --dt-input-border: 9%;
  --dt-scrollbar-thumb: color-mix(in srgb, #000 14%, transparent);
  --ui-selection-background: color-mix(in srgb, var(--shell-accent, #007AFF) 24%, transparent);
  --conversation-text-base-size: 0.875rem;
  --conversation-tool-base-size: 0.75rem;
  --conversation-caption-base-size: 0.8125rem;
  --conversation-base-line-height: 1.3125rem;
  --conversation-turn-gap: 0.475rem;
  --turn-block-gap: 0.95rem;
  --paragraph-gap: 0.8rem;
  --tool-row-gap: 0.4rem;
  --message-text-indent: 0.85rem;
  --human-msg-line-height: 1.4;
}
:root.dark {
  --dt-input-border: 6%;
  --dt-scrollbar-thumb: color-mix(in srgb, #fff 14%, transparent);
  --ui-selection-background: color-mix(in srgb, #0A84FF 38%, transparent);
  --shadow-md:
    0 0 0 0.5px color-mix(in srgb, #000 40%, transparent),
    0 6px 18px -6px color-mix(in srgb, #000 55%, transparent),
    0 16px 40px -16px color-mix(in srgb, #000 60%, transparent);
}
`,
  },
  {
    id: 'materials',
    label: '侧栏与菜单毛玻璃',
    note: '毛玻璃与发丝线',
    css: `
:root {
  --apple-glass: saturate(180%) blur(30px);
  --apple-hairline: var(--ui-stroke-tertiary);
}
:root.dark {
  --apple-hairline: var(--ui-stroke-tertiary);
}
[data-slot="sidebar"],
[data-slot="sidebar-container"],
[data-slot="sidebar-inner"],
[data-slot="statusbar"],
[data-slot="composer-root"],
[data-slot="composer-surface"],
[data-slot="dialog-content"],
[data-slot="popover-content"],
[data-slot="dropdown-menu-content"],
[data-slot="context-menu-content"],
[data-slot="select-content"],
[data-slot="command"],
[data-slot="tooltip-content"] {
  backdrop-filter: var(--apple-glass);
  -webkit-backdrop-filter: var(--apple-glass);
}
/* 侧栏右缘的边界线不在这里画：app 自己在 Sidebar 元素上已经画了一条
   （app/chat/sidebar/index.tsx:1570，用 --sidebar-edge-border）。我原来在这叠了第二条，
   两条 1px 贴在一起看着像一条粗线。要调这条线的深浅，改 --sidebar-edge-border 就够了。 */
[data-slot="statusbar"] {
  border-top: 0.5px solid var(--apple-hairline);
}
/* —— 右列：6（会话标签条）+ 7（会话内容）一整块 ——
   6 这一行原来被切成四块：这条 strip 内部还有几层各自带底色（tablist 容器、
   拖拽区、右侧图标组），先全部刷平。
   颜色统一取纸白 #F5F5F5（= 7 里消息卡片自身的白）：之前 6 取 240 时和画布齐、
   和卡片差 5 档，看着就不是一块。现在 7 的画布、视口、thread 一起抬到纸白，
   卡片本来就是这个值，整块没有接缝。 */
/* 两套，按玻璃开关自动切：
   关玻璃 → 6 和 7 都刷纸白 #F5F5F5（一整块、纸感）；
   开玻璃 → 6 和 7 全透明、无滤镜，两边都直接贴在窗口材质上（一整块、玻璃感）。
   玻璃开着时绝不能给这两处刷实色：右列顶部 34px 落在窗口标题栏覆盖区，
   那里没有页面容器、材质由系统直接画，一刷实色就退出合成，整条退成黑（实测 0,0,0）。 */
:root:not([data-hermes-glass]) div:has(> [data-zone-tabstrip='grp-main']),
:root:not([data-hermes-glass]) [data-zone-tabstrip='grp-main'],
:root:not([data-hermes-glass]) [data-slot='composer-bounds'],
:root:not([data-hermes-glass]) [data-slot='aui_thread-viewport'],
:root:not([data-hermes-glass]) [data-slot='thread'] {
  background-color: #f5f5f5 !important;
  background-image: none !important;
}
:root[data-hermes-glass] div:has(> [data-zone-tabstrip='grp-main']),
:root[data-hermes-glass] [data-zone-tabstrip='grp-main'],
:root[data-hermes-glass] [data-slot='composer-bounds'],
:root[data-hermes-glass] [data-slot='aui_thread-viewport'],
:root[data-hermes-glass] [data-slot='thread'] {
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
:root [data-zone-tabstrip='grp-main'] {
  border: 0 !important;
  box-shadow: none !important;
}
:root [data-zone-tabstrip='grp-main'] :is(div, header, span, ul, li, a):not([role='tab']),
:root [data-zone-tabstrip='grp-main'] button:not([role='tab']) {
  background-color: transparent !important;
  background-image: none !important;
}

/* 右列标签（6）：和左列（1）用同一套药丸 —— 同样的几何、同样的强调色。
   之前左列是"白药丸"、右列是"更大更白的药丸"，两处看着不是一套。 */
:root [data-zone-tabstrip='grp-main'] [role='tab'] {
  align-self: center;
  height: 22px;
  max-height: calc(100% - 6px);
  padding-inline: 11px;
  margin-inline: 1px;
  border: 0.5px solid transparent !important;
  border-radius: 10px;
  background-color: transparent !important;
  box-shadow: none !important;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: color-mix(in srgb, var(--ui-text-primary) 56%, transparent);
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
:root [data-zone-tabstrip='grp-main'] [role='tab']:hover {
  background-color: color-mix(in srgb, #fff 20%, transparent) !important;
  border-color: transparent !important;
  color: var(--ui-text-primary);
}
/* 选中态与 1 的药丸完全同一套材质：44% 白底 + 4.5% 墨发丝边 + 顶部 1px 高光，
   不用主色平涂（平涂看着只是"上了色"，没有玻璃的厚度感）。 */
:root [data-zone-tabstrip='grp-main'] [role='tab'][data-active='true'],
:root [data-zone-tabstrip='grp-main'] [role='tab'][aria-selected='true'],
:root [data-zone-tabstrip='grp-main'] [role='tab'][data-state='active'],
:root [data-zone-tabstrip='grp-main'] [role='tab'].active {
  background-color: color-mix(in srgb, #fff 44%, transparent) !important;
  border-color: color-mix(in srgb, #000 4.5%, transparent) !important;
  color: var(--ui-text-primary) !important;
  font-weight: 600;
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 40%, transparent) !important;
}
:root.dark [data-zone-tabstrip='grp-main'] [role='tab']:hover {
  background-color: color-mix(in srgb, #fff 11%, transparent) !important;
  color: #fff;
}
:root.dark [data-zone-tabstrip='grp-main'] [role='tab'][data-active='true'],
:root.dark [data-zone-tabstrip='grp-main'] [role='tab'][aria-selected='true'],
:root.dark [data-zone-tabstrip='grp-main'] [role='tab'][data-state='active'] {
  background-color: color-mix(in srgb, #fff 16%, transparent) !important;
  border-color: color-mix(in srgb, #fff 13%, transparent) !important;
  color: #fff !important;
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 13%, transparent),
    0 1px 2px color-mix(in srgb, #000 25%, transparent) !important;
}
:root.dark [data-zone-tabstrip='grp-main'] [role='tab'] {
  color: color-mix(in srgb, #fff 52%, transparent);
}
:root.dark [data-zone-tabstrip='grp-main'] [data-slot='composer-bounds'] {
  background-color: color-mix(in srgb, #121214 96%, transparent) !important;
}

/* vibrancy 的那点"玻璃厚度"：侧栏顶部一条 1px 高光 */
:root [data-slot="sidebar"],
:root [data-slot="sidebar-inner"] {
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 55%, transparent);
}
:root.dark [data-slot="sidebar"],
:root.dark [data-slot="sidebar-inner"] {
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 6%, transparent);
}
`,
  },
  {
    id: 'controls',
    label: '按钮与输入框',
    note: '圆角与聚焦圈',
    css: `
:root [data-slot="button"] {
  border-radius: 6px;
  font-weight: 500;
  letter-spacing: -0.006em;
  transition: background-color 120ms ease, transform 90ms ease;
}
:root [data-slot="button"]:active {
  transform: scale(0.976);
}
:root [data-slot="button"][data-size="icon"],
:root [data-slot="button"][data-size="icon-xs"],
:root [data-slot="button"][data-size="icon-sm"],
:root [data-slot="button"][data-size="icon-lg"] {
  border-radius: 7px;
}
:root [data-slot="switch"] {
  border-radius: 999px;
}
:root [data-slot="switch"][data-state="checked"],
:root [data-slot="checkbox"][data-state="checked"] {
  background: #34C759;
  border-color: #34C759;
}
:root [data-slot="switch-thumb"] {
  border-radius: 999px;
  box-shadow: 0 1px 2px color-mix(in srgb, #000 25%, transparent);
}
:root [data-slot="input"],
:root [data-slot="input-group"],
:root [data-slot="command-input-wrapper"] {
  border-radius: 10px;
}
:root [data-slot="button"]:focus-visible,
:root [data-slot="input"]:focus-visible,
:root [data-slot="tabs-trigger"]:focus-visible,
:root [data-slot="switch"]:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--shell-accent, #007AFF) 32%, transparent);
}
:root [data-slot="tabs-list"] {
  border-radius: 10px;
}
:root [data-slot="tabs-trigger"] {
  border-radius: 6px;
}
`,
  },
  {
    id: 'bubbles',
    label: '气泡形状与底色',
    note: '形状与底色',
    css: `
/* 我的消息：iMessage 形状 —— 贴合内容宽度、靠右、右下角收一个小角当「尾巴」。
   app 出厂是「整栏宽的卡片」（components/assistant-ui/thread/user-message.tsx:77 的
   w-full max-w-full，外层 items-stretch），所以宽度必须自己收：否则只说一个「B」
   的消息也会撑成一条 1100px 的蓝长条（实测过）。18px + 右下 5px 是 iMessage 的比例。
   上限用百分比而不是固定 rem —— 固定 34rem 在大屏/全屏下气泡就只有 544px，看着像
   被封住了；80% 跟着消息栏一起伸缩，短消息仍然各自贴合自己的内容宽度。 */
:root [data-slot="aui_user-message-root"] .composer-human-message,
:root .composer-human-message {
  width: fit-content;
  max-width: var(--bubble-max, 80%);
  margin-left: auto;
  padding: 0.625rem 0.8125rem;
  border-width: 0;
  border-radius: 18px 18px 5px 18px;
  box-shadow: none;
  line-height: 1.35;
}
/* 配色变量与正文段同源（单独关掉正文段时气泡色仍在）。 */
${PALETTES.map((palette, index) => (index === 0 ? ":root" : ":root[data-ui-palette='" + palette.id + "']") + " {\n  --acc-main: " + palette.main + ";\n  --acc-code: " + palette.code + ";\n  --acc-alt: " + palette.alt + ";\n  --bub-fill: " + palette.bubble + ";\n  --bub-ink: " + (palette.ink || '#FFFFFF') + ";\n  --bub-edge: " + (palette.edge || 'rgba(255,255,255,0.30)') + ";\n}\n").join("")}
:root {
  --dt-user-bubble: var(--bub-fill);
  --dt-user-bubble-border: transparent;
}
/* 直接命中气泡元素。实测只改 --dt-user-bubble 令牌在这个元素上不生效（那边算出来
   的 background-color 没跟着变），所以这里再加一条直写规则兜住。 */
:root .composer-human-message {
  /* 液态玻璃：半透明本体 + 背景模糊/饱和 + 顶部高光 + 发丝外沿 + 一圈冷色投影 */
  background-color: color-mix(in srgb, var(--bub-fill) 76%, transparent) !important;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.04) 46%, rgba(255, 255, 255, 0) 78%) !important;
  backdrop-filter: blur(18px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(18px) saturate(180%) !important;
  border-color: transparent !important;
  color: var(--bub-ink, #FFFFFF) !important;
  /* 投影只留一丝：原来那圈 26% 系统蓝的冷光晕被反馈"有点重" */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.42),
    inset 0 0 0 0.5px var(--bub-edge, rgba(255, 255, 255, 0.3)),
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 3px 10px color-mix(in srgb, var(--bub-fill) 12%, transparent) !important;
}
:root.dark .composer-human-message {
  background-color: color-mix(in srgb, var(--bub-fill) 86%, transparent) !important;
}
:root .composer-human-message :is(p, li, td, th, span, a, strong, em, code) {
  color: inherit;
}

/* 悬停时才出现的那组（时间 + 恢复/停止图标）。出厂是按「浅底上的中性灰」设计的：
   time 用 --ui-text-tertiary（message-hover-time.tsx），按钮用
   --ui-text-secondary + 中性灰 hover 底（user-message.tsx:80 的
   USER_ACTION_ICON_BUTTON_CLASS）—— 压在蓝气泡上就发灰、对比度不足，而且恢复键
   是 24px、比时间的 20px 行高高出一档，看着"不是一套"（用户：「标识时间和状态的
   图标和我们现在设计的图标不兼容」）。改成白色系：时间白 82%、图标白 88%、
   hover 底换成半透明白，两个按钮都收到 20px。只作用于蓝气泡；系统灰/跟随主题
   时保持出厂（浅底上白字会看不见）。 */
:root [data-slot="aui_user-message-root"] div[class*='right-2'][class*='bottom-2'][class*='opacity-0'] {
  gap: 0.25rem;
  background-color: color-mix(in srgb, var(--bub-ink, #FFFFFF) 14%, transparent) !important;
  backdrop-filter: blur(10px);
}
:root [data-slot="aui_user-message-root"] div[class*='right-2'][class*='bottom-2'][class*='opacity-0'] time {
  color: color-mix(in srgb, var(--bub-ink, #FFFFFF) 82%, transparent);
}
:root [data-slot="aui_user-message-root"] div[class*='right-2'][class*='bottom-2'][class*='opacity-0'] button {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 6px;
  color: color-mix(in srgb, var(--bub-ink, #FFFFFF) 88%, transparent);
}
:root [data-slot="aui_user-message-root"] div[class*='right-2'][class*='bottom-2'][class*='opacity-0'] button:hover {
  color: var(--bub-ink, #FFFFFF) !important;
  background-color: color-mix(in srgb, var(--bub-ink, #FFFFFF) 22%, transparent) !important;
}
/* Codicon 的 size 走行内 font-size，只能用 !important 压 */
:root [data-slot="aui_user-message-root"] div[class*='right-2'][class*='bottom-2'][class*='opacity-0'] .codicon {
  font-size: 0.8125rem !important;
}

/* 点开气泡进入编辑态时，框里的字/占位符/发送键仍是「浅底黑字」那一套：
   编辑区 .ui-prompt-input-editor__input 带 text-foreground/95（contenteditable
   上的直接声明，压不过去的是它的继承），占位符是 styles.css:1035 的
   color-mix(--muted-foreground 60%)，发送键又是 USER_ACTION_ICON_BUTTON_CLASS
   的灰 —— 全部照浅底设计，于是蓝气泡里成了「蓝底黑字」。跟着气泡一起改成白色系。
   （编辑态的气泡同样带 .composer-human-message，所以作用域直接复用它。） */
:root .composer-human-message [data-slot="composer-rich-input"] {
  color: var(--bub-ink, #FFFFFF) !important;
  caret-color: var(--bub-ink, #FFFFFF);
}
:root .composer-human-message [data-slot="composer-rich-input"]::before {
  color: color-mix(in srgb, var(--bub-ink, #FFFFFF) 62%, transparent) !important;
}
:root .composer-human-message button[class*='text-(--ui-text-secondary)'] {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 6px;
  color: color-mix(in srgb, var(--bub-ink, #FFFFFF) 88%, transparent);
}
:root .composer-human-message button[class*='text-(--ui-text-secondary)']:hover {
  color: var(--bub-ink, #FFFFFF) !important;
  background-color: color-mix(in srgb, var(--bub-ink, #FFFFFF) 22%, transparent) !important;
}
:root .composer-human-message button[class*='text-(--ui-text-secondary)'] .codicon {
  font-size: 0.8125rem !important;
}
`,
  },
  {
    id: 'content',
    label: '工具调用与代码块',
    note: '底色 · 描边 · 圆角',
    css: `
:root [data-slot="tool-block"],
:root [data-slot="code-card"],
:root [data-slot="card-stack-surface"],
:root [data-slot="connector-card"] {
  border-radius: 10px;
}
:root [data-slot="code-card"] {
  border: 0.5px solid var(--apple-hairline);
}
:root [data-slot="code-card"] pre,
:root [data-slot="code-card"] code {
  font-family: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
  letter-spacing: 0;
}
`,
  },
  {
    id: 'system',
    label: '滚动条与弹窗',
    note: '滚动条与菜单圆角',
    css: `
:root ::-webkit-scrollbar {
  width: 9px;
  height: 9px;
}
:root ::-webkit-scrollbar-track {
  background: transparent;
}
:root ::-webkit-scrollbar-thumb {
  background: transparent;
  background-clip: content-box;
  border: 2.5px solid transparent;
  border-radius: 999px;
}
/* 静止时滑块完全不见（macOS overlay 行为）：滚动期间 html 上有 .ui-scrolling，
   或者指针悬停在滚动容器上时才出现。Chromium 不支持给滚动条伪元素做 transition，
   所以"淡出"是靠 JS 在停止滚动后延迟 900ms 摘掉那个类。 */
:root.ui-scrolling ::-webkit-scrollbar-thumb,
:root :hover::-webkit-scrollbar-thumb {
  background: var(--dt-scrollbar-thumb);
  background-clip: content-box;
  border: 2.5px solid transparent;
  border-radius: 999px;
}
:root.ui-scrolling ::-webkit-scrollbar-thumb:hover,
:root :hover::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, #000 32%, transparent);
  background-clip: content-box;
}
:root.dark.ui-scrolling ::-webkit-scrollbar-thumb:hover,
:root.dark :hover::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, #fff 30%, transparent);
  background-clip: content-box;
}
:root ::selection {
  background: var(--ui-selection-background);
}
:root [data-slot="dialog-content"],
:root [data-slot="popover-content"],
:root [data-slot="dropdown-menu-content"],
:root [data-slot="context-menu-content"],
:root [data-slot="select-content"] {
  border-radius: 12px;
  border: 0.5px solid var(--apple-hairline);
}
:root [data-slot="tooltip-content"] {
  border-radius: 7px;
  font-size: 0.6875rem;
}
`,
  },
  {
    id: 'polish',
    label: '标签条与搜索框等细节',
    note: '标签条 · 搜索框',
    css: `
:root {
  --apple-hairline: var(--ui-stroke-tertiary);
}
:root.dark {
  --apple-hairline: var(--ui-stroke-tertiary);
}
/* 搜索框：不再是无框内联文字，按 macOS NSSearchField 做（浅灰填充 + 发丝线） */
:root [data-slot="sidebar-input"] {
  height: 1.75rem;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, #000 10%, transparent);
  background: color-mix(in srgb, var(--ui-base) 6%, transparent);
  box-shadow: none;
}
:root.dark [data-slot="sidebar-input"] {
  border-color: color-mix(in srgb, #fff 12%, transparent);
}
:root [data-slot="input"],
:root [data-slot="input-group"] {
  border: 0.5px solid var(--apple-hairline);
  box-shadow: none;
}
:root [data-slot="sidebar-input"]:focus-within,
:root [data-slot="input"]:focus,
:root [data-slot="input"]:focus-visible {
  background: var(--dt-card);
  border-color: color-mix(in srgb, var(--shell-accent, #007AFF) 55%, transparent);
  box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--shell-accent, #007AFF) 26%, transparent);
}
/* ⌘N 这类快捷键提示：Apple 是次要色文字，不是两个键帽方块 */
:root [data-slot="kbd"],
:root [data-slot="kbd-group"] kbd {
  height: auto;
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: var(--dt-muted-foreground);
  font-size: 0.6875rem;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}
/* 侧栏分区标题：改成 Apple 的次要灰 + 正常字距。app 这边是
   SidebarPanelLabel（app/shell/sidebar-label.tsx）：强调色 + 全大写 + 0.16em
   字距 + 一个变色小方点——这正是「网页复刻」味最重的一处。它没有 data-slot，
   所以按 class 属性里的令牌名命中选择器（属性包含匹配，不用转义括号）。 */
:root [data-slot="sidebar"] span[class*="text-(--theme-primary)"] {
  color: var(--dt-muted-foreground);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.015em;
  text-transform: none;
}
:root [data-slot="sidebar"] span[class*="text-(--theme-primary)"] :is(span, svg) {
  color: inherit;
}
:root [data-slot="sidebar"] span[class*="text-(--theme-primary)"] > span[aria-hidden="true"] {
  background: currentColor;
  opacity: 0.4;
}

/* 侧栏选中项：强调色圆角填色（Apple 侧栏的选中表达） */
:root [data-slot="sidebar-menu-button"][data-active="true"],
:root [data-slot="sidebar-menu-sub-button"][data-active="true"] {
  background: color-mix(in srgb, var(--shell-accent, #007AFF) 13%, transparent);
  color: var(--dt-foreground);
  font-weight: 600;
}
:root.dark [data-slot="sidebar-menu-button"][data-active="true"],
:root.dark [data-slot="sidebar-menu-sub-button"][data-active="true"] {
  background: color-mix(in srgb, #0A84FF 22%, transparent);
}
/* 工具行与时间戳降噪：更小、更淡、等宽 */
:root [data-slot="tool-block"],
:root [data-slot="status-row"],
:root [data-slot="timeline-timestamp"],
:root [data-slot="aui_turn-activity"] {
  font-size: 0.75rem;
  letter-spacing: 0;
}
:root [data-slot="timeline-timestamp"] {
  color: var(--dt-muted-foreground);
}
/* —— 7b 输入栏：抬高输入区 —— 
   原来是单行高度（≈28px），显得局促。给一个约 2 行的起始高度，仍然会自动长高；
   行高固定 1.5，上下内距同步加大。 */
/* 输入区是 contenteditable 的 div，不是 textarea —— 高度由应用自己的令牌控制：
   --composer-input-min-height（默认 1.625rem ≈ 单行 26px）。改令牌即可，别去碰元素。 */
:root {
  /* 回到一行高：输入行只放文字。 */
  --composer-input-min-height: 1.75rem;
  --composer-input-max-height: 12rem;
}
/* 输入区的真实结构是一行 grid：[+ 按钮 | 输入区 | 右侧工具栏]，全挤在同一行。
   改成两行：上面整行给输入区，下面一行放「＋ / 模型 / 发送」。
   只调排布，不动 DOM：输入区跨满两列，左右两个按钮组下沉到第二行。 */
:root [data-slot='composer-fade'] > div:first-child {
  display: grid !important;
  grid-template-columns: auto 1fr auto !important;
  grid-template-rows: auto auto !important;
  row-gap: 6px !important;
  align-items: center !important;
}
:root [data-slot='composer-fade'] > div:first-child > *:nth-child(2) {
  grid-column: 1 / -1 !important;
  grid-row: 1 !important;
  padding-inline: 2px !important;
}
:root [data-slot='composer-fade'] > div:first-child > *:nth-child(1) {
  grid-column: 1 !important;
  grid-row: 2 !important;
}
:root [data-slot='composer-fade'] > div:first-child > *:nth-child(3) {
  grid-column: 3 !important;
  grid-row: 2 !important;
}
/* 顶部三个标签（会话/机器人/终端）= 药丸式分段控件。
   1 和 2 融成一块的前提：两块都透明（1 原来带的是应用写死的侧栏表面色，
   2 在玻璃模式下已经是透明的），再靠同一个材质显示出来，中间不留线。
   药丸高 22（条高 28 → 上下各 3px 留白，之前 24 时上下只有 2px，偏挤）。 */
:root {
  /* 应用那条 2px 主题色下划线不要：药丸本身就是选中标记。 */
  --pane-tab-active-accent: transparent;
}
/* —— 4 会话列表 ——
   两点：
   ① 选中色 —— 应用给的是浅蓝，改成中性墨 6.5%（侧栏作用域覆盖 --ui-selection-background，
      同时直接作用在行上兜底：行是 div，不是 button，之前选择器写错了所以一直没生效）。
   ② 圆角 —— 应用默认 2px，太硬；统一 6px。
   悬停只作用在未选中的行，且只用 3.5% 墨；行内任何层级都不再叠第二层底色
   （之前鼠标划过标题会出现一条灰条，就是内层元素被单独刷了一层）。 */
:root [data-slot='sidebar'] {
  --ui-selection-background: color-mix(in srgb, var(--ui-text-primary) 6.5%, transparent);
}
/* 会话行是 div[data-slot='context-menu-trigger']，选中态不带 data-active，
   而是靠强调色上色 —— 所以直接在这块作用域里把强调色换成中性墨，行自己就变灰。
   圆角应用默认 8px，这里收到 6px。 */
:root [data-sessions-mode] {
  /* 会话行的选中底色真的是这个变量（行 class 里写着 bg-(--ui-row-active-background)）：
     应用给的是强调色 12.6% alpha，换成中性墨 6.5%。 */
  --ui-row-active-background: color-mix(in srgb, var(--acc-main, #0EA598) 9%, transparent);
  --ui-selection-background: color-mix(in srgb, var(--ui-text-primary) 6.5%, transparent);
}
:root [data-sessions-mode] [data-slot='context-menu-trigger'] {
  /* 整窗统一到 12px（行高 44，12px 才看得出"圆"） */
  border-radius: 12px !important;
}
:root [data-sessions-mode] [data-slot='context-menu-trigger'] > span {
  border-radius: 12px !important;
}
:root [data-slot='sidebar'] [data-active='true'] {
  background-color: color-mix(in srgb, var(--acc-main, #0EA598) 9%, transparent) !important;
  border-radius: 6px !important;
  color: var(--ui-text-primary) !important;
}
:root [data-slot='sidebar'] [data-active='true'] :is(span, small, time, p) {
  color: color-mix(in srgb, var(--ui-text-primary) 52%, transparent) !important;
}
:root [data-slot='sidebar'] [data-active='true'] :is(.font-semibold, [class*='font-semibold'], strong) {
  color: var(--ui-text-primary) !important;
}
:root [data-slot='sidebar'] [data-sidebar='menu-button']:not([data-active='true']):hover {
  background-color: color-mix(in srgb, var(--ui-text-primary) 3.5%, transparent) !important;
  border-radius: 6px !important;
}
:root [data-slot='sidebar'] [data-active='true'] :is(div, span, a):hover,
:root [data-slot='sidebar'] [data-sidebar='menu-button'] :is(div, span, a):hover {
  background-color: transparent !important;
}

/* —— 7 AI 回复署名行（头像 + 名称） ——
   注入在 aui_assistant-message-content 里，和下方的工具条/正文同一条左基线
   （那层有 13.6px 内距，插在里面才真正对齐，不是靠猜偏移）。
   头像 18px 线稿（三种可选），名称 11.5px/600，颜色都比正文弱一档。 */
[data-ui-avatar='1'] {
  display: flex !important;
  align-items: center !important;
  gap: 9px !important;
  height: var(--ui-avatar-size, 36px) !important;
  margin: 0 0 12px 0 !important;
  user-select: none !important;
}
[data-ui-avatar='1'] .ui-avatar-icon {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: var(--ui-avatar-size, 36px) !important;
  height: var(--ui-avatar-size, 36px) !important;
  flex: 0 0 var(--ui-avatar-size, 36px) !important;
  /* 圆框只当底：人物铺满整格（图内留白仅 2%），肩、鳍、喷水等不规则部分会自然超出圆周 */
  border-radius: 50% !important;
  overflow: visible !important;
  position: relative !important;
  z-index: 0 !important;
  background-color: color-mix(in srgb, var(--ui-text-primary, #111) 4.5%, transparent) !important;
  box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--ui-text-primary, #111) 12%, transparent) !important;
}
/* 动画头像本体：一块雪碧图，背景位移在整格上跳 */
[data-ui-avatar='1'] .ui-avatar-sprite {
  width: var(--ui-avatar-size, 36px) !important;
  height: var(--ui-avatar-size, 36px) !important;
  display: block !important;
  background-repeat: no-repeat !important;
  /* 注意：这里不能写 !important —— 基础规则里的 !important 会压过 keyframes 的位移，
     动画会整段卡在第 0 帧（实测三态都停在 0px 0px）。 */
  background-position: 0 0;
  background-size: calc(4 * var(--ui-avatar-size, 36px)) calc(3 * var(--ui-avatar-size, 36px)) !important;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.08)) !important;
}
[data-ui-avatar='1'] .ui-avatar-sprite {
  animation: uiAvIdle 5.2s steps(1, end) infinite !important;
}
/* 「工作中」不靠 JS 判定：宿主给每条正在跑的消息渲染一个隐藏标记
   <span data-slot="aui_message-streaming-marker" data-message-streaming="true">
   （assistant-message.tsx 的 StreamingMarker，跟的是 message.status === 'running'）。
   它跟着真实运行状态走，长时间思考或跑工具时依然在，不会像「文本有变化」那样误判成待机。 */
html:has([data-slot="aui_message-streaming-marker"][data-message-streaming="true"]) [data-ui-avatar='1'] .ui-avatar-sprite:not([data-state='click']),
/* 兜底：万一 slot 改名但这个属性还在，第二条仍能命中 */
html:has([data-message-streaming="true"]) [data-ui-avatar='1'] .ui-avatar-sprite:not([data-state='click']) {
  animation: uiAvWork 0.8s steps(4) infinite !important;
}
[data-ui-avatar='1'] .ui-avatar-sprite[data-state='click'] {
  animation: uiAvClick 0.9s steps(1, end) 1 forwards !important;
}
@keyframes uiAvIdle {
  0%, 90% { background-position: 0 0; }
  92% { background-position: calc(-1 * var(--ui-avatar-size, 36px)) 0; }
  93.5% { background-position: calc(-2 * var(--ui-avatar-size, 36px)) 0; }
  95% { background-position: calc(-3 * var(--ui-avatar-size, 36px)) 0; }
  96.5%, 100% { background-position: 0 0; }
}
@keyframes uiAvWork {
  from { background-position: 0 calc(-1 * var(--ui-avatar-size, 36px)); }
  to { background-position: calc(-4 * var(--ui-avatar-size, 36px)) calc(-1 * var(--ui-avatar-size, 36px)); }
}
@keyframes uiAvClick {
  /* 四帧显式排开、末帧停在 -3b：不能用 steps(4) 跑到 -4b —— 那是空白格，
     forwards 会把它停住，点一下头像就消失一瞬。 */
  0% { background-position: 0 calc(-2 * var(--ui-avatar-size, 36px)); }
  25% { background-position: calc(-1 * var(--ui-avatar-size, 36px)) calc(-2 * var(--ui-avatar-size, 36px)); }
  50% { background-position: calc(-2 * var(--ui-avatar-size, 36px)) calc(-2 * var(--ui-avatar-size, 36px)); }
  75%, 100% { background-position: calc(-3 * var(--ui-avatar-size, 36px)) calc(-2 * var(--ui-avatar-size, 36px)); }
}
@media (prefers-reduced-motion: reduce) {
  [data-ui-avatar='1'] .ui-avatar-sprite {
    animation: none !important;
  }
}
[data-ui-avatar='1'] .ui-avatar-icon img,
[data-ui-avatar='1'] .ui-avatar-icon svg {
  width: 100% !important;
  height: 100% !important;
  display: block !important;
  object-fit: contain !important;
  object-position: 50% 50% !important;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.08)) !important;
}
@keyframes uiAvatarBreathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}
@media (prefers-reduced-motion: reduce) {
  [data-ui-avatar='1'] .ui-avatar-icon {
    animation: none !important;
  }
}

:root[data-ui-avatar-off] [data-ui-avatar='1'] {
  display: none !important;
}

/* 用户消息里的图片跟着气泡靠右。
   图片实际是 markdown 渲染的 <p><span data-slot='aui_markdown-image'><button><img>，
   外层 <p> 是满宽的块，所以要让 <p> 文本右对齐 + 图片 margin-left:auto 才推得动。 */
[data-role='user'] p:has([data-slot='aui_markdown-image']),
[data-role='user'] :is([data-slot='aui_markdown-image'], [data-slot='aui_user-message-root']) p:has(img) {
  text-align: right !important;
}
[data-role='user'] :is([data-slot='aui_markdown-image'], aui_zoomable-image) {
  margin-left: auto !important;
  margin-right: 0 !important;
  display: inline-block !important;
}
[data-role='user'] img {
  display: block !important;
  margin-left: auto !important;
  margin-right: 0 !important;
}

/* —— 4 列表分区标题（已置顶 / 会话 / 上周 / 定时任务）上色 ——
   这些小标题是"弱化层"，只加一点主色：前面那个 8px 方块给主色，
   文字用主色兑墨（55%），保持弱于正文、但看得出颜色。 */
[data-sidebar='group'] [class*='section-label'] {
  color: color-mix(in srgb, var(--acc-main, #0EA598) 88%, var(--ui-text-primary)) !important;
}
/* 前面的 8px 实心方块换成 3×10 的圆头竖条，比方块精致，也更像"分区标记"。 */
[data-sidebar='group'] [class*='section-label'] span.dither,
[data-sidebar='group'] [class*='section-label'] span[class*='dither'] {
  width: 3px !important;
  height: 10px !important;
  border-radius: 2px !important;
  background-color: var(--acc-main, #0EA598) !important;
  background-image: none !important;
  opacity: 1 !important;
}
[data-sidebar='group'] [class*='section-label'] svg {
  color: color-mix(in srgb, var(--acc-main, #0EA598) 82%, var(--ui-text-primary)) !important;
  stroke: currentColor !important;
}

/* —— 2 导航图标换新 ——
   原来的 codicon 字形（机器人 / 杂物 / 手表 / 项目）语义含糊、笔画也偏粗。
   这里把字形隐藏，用 mask + 自绘 SVG 线稿顶上（24 视框、1.8 线宽、圆头圆角），
   颜色仍走 currentColor，所以主色/悬停行为不变。 */
[data-sidebar='menu-button'] i.codicon {
  font-size: 0 !important;
  width: 15px !important;
  height: 15px !important;
  display: inline-block !important;
  flex: 0 0 15px !important;
  background-color: currentColor !important;
  -webkit-mask-repeat: no-repeat !important;
          mask-repeat: no-repeat !important;
  -webkit-mask-position: center !important;
          mask-position: center !important;
  -webkit-mask-size: 15px 15px !important;
          mask-size: 15px 15px !important;
}
[data-sidebar='menu-button'] i.codicon-robot {
  -webkit-mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0nTTEyIDNINWEyIDIgMCAwIDAtMiAydjE0YTIgMiAwIDAgMCAyIDJoMTRhMiAyIDAgMCAwIDItMnYtNycvPjxwYXRoIGQ9J00xOC4zNzUgMi42MjVhMSAxIDAgMCAxIDMgM2wtOS4wMTMgOS4wMTNhMiAyIDAgMCAxLS44NTMuNTA1bC0yLjg3My44NGEuNS41IDAgMCAxLS42Mi0uNjJsLjg0LTIuODczYTIgMiAwIDAgMSAuNTA1LS44NTN6Jy8+PC9zdmc+") !important;
          mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0nTTEyIDNINWEyIDIgMCAwIDAtMiAydjE0YTIgMiAwIDAgMCAyIDJoMTRhMiAyIDAgMCAwIDItMnYtNycvPjxwYXRoIGQ9J00xOC4zNzUgMi42MjVhMSAxIDAgMCAxIDMgM2wtOS4wMTMgOS4wMTNhMiAyIDAgMCAxLS44NTMuNTA1bC0yLjg3My44NGEuNS41IDAgMCAxLS42Mi0uNjJsLjg0LTIuODczYTIgMiAwIDAgMSAuNTA1LS44NTN6Jy8+PC9zdmc+") !important;
}
[data-sidebar='menu-button'] i.codicon-symbol-misc {
  -webkit-mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0nTTkuOTM3IDE1LjVBMiAyIDAgMCAwIDguNSAxNC4wNjNsLTYuMTM1LTEuNTgyYS41LjUgMCAwIDEgMC0uOTYyTDguNSA5LjkzNkEyIDIgMCAwIDAgOS45MzcgOC41bDEuNTgyLTYuMTM1YS41LjUgMCAwIDEgLjk2MyAwTDE0LjA2MyA4LjVBMiAyIDAgMCAwIDE1LjUgOS45MzdsNi4xMzUgMS41ODFhLjUuNSAwIDAgMSAwIC45NjRMMTUuNSAxNC4wNjNhMiAyIDAgMCAwLTEuNDM3IDEuNDM3bC0xLjU4MiA2LjEzNWEuNS41IDAgMCAxLS45NjMgMHonLz48cGF0aCBkPSdNMjAgM3Y0Jy8+PHBhdGggZD0nTTIyIDVoLTQnLz48L3N2Zz4=") !important;
          mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0nTTkuOTM3IDE1LjVBMiAyIDAgMCAwIDguNSAxNC4wNjNsLTYuMTM1LTEuNTgyYS41LjUgMCAwIDEgMC0uOTYyTDguNSA5LjkzNkEyIDIgMCAwIDAgOS45MzcgOC41bDEuNTgyLTYuMTM1YS41LjUgMCAwIDEgLjk2MyAwTDE0LjA2MyA4LjVBMiAyIDAgMCAwIDE1LjUgOS45MzdsNi4xMzUgMS41ODFhLjUuNSAwIDAgMSAwIC45NjRMMTUuNSAxNC4wNjNhMiAyIDAgMCAwLTEuNDM3IDEuNDM3bC0xLjU4MiA2LjEzNWEuNS41IDAgMCAxLS45NjMgMHonLz48cGF0aCBkPSdNMjAgM3Y0Jy8+PHBhdGggZD0nTTIyIDVoLTQnLz48L3N2Zz4=") !important;
}
[data-sidebar='menu-button'] i.codicon-comment {
  -webkit-mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0nTTE0IDlhMiAyIDAgMCAxLTIgMkg2bC00IDRWNGEyIDIgMCAwIDEgMi0yaDhhMiAyIDAgMCAxIDIgMnonLz48cGF0aCBkPSdNMTggOWgyYTIgMiAwIDAgMSAyIDJ2MTFsLTQtNGgtNmEyIDIgMCAwIDEtMi0ydi0xJy8+PC9zdmc+") !important;
          mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0nTTE0IDlhMiAyIDAgMCAxLTIgMkg2bC00IDRWNGEyIDIgMCAwIDEgMi0yaDhhMiAyIDAgMCAxIDIgMnonLz48cGF0aCBkPSdNMTggOWgyYTIgMiAwIDAgMSAyIDJ2MTFsLTQtNGgtNmEyIDIgMCAwIDEtMi0ydi0xJy8+PC9zdmc+") !important;
}
[data-sidebar='menu-button'] i.codicon-files {
  -webkit-mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0nbTcuNSA0LjI3IDkgNS4xNScvPjxwYXRoIGQ9J00yMSA4YTIgMiAwIDAgMC0xLTEuNzNsLTctNGEyIDIgMCAwIDAtMiAwbC03IDRBMiAyIDAgMCAwIDMgOHY4YTIgMiAwIDAgMCAxIDEuNzNsNyA0YTIgMiAwIDAgMCAyIDBsNy00QTIgMiAwIDAgMCAyMSAxNlonLz48cGF0aCBkPSdtMy4zIDcgOC43IDUgOC43LTUnLz48cGF0aCBkPSdNMTIgMjJWMTInLz48L3N2Zz4=") !important;
          mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0nbTcuNSA0LjI3IDkgNS4xNScvPjxwYXRoIGQ9J00yMSA4YTIgMiAwIDAgMC0xLTEuNzNsLTctNGEyIDIgMCAwIDAtMiAwbC03IDRBMiAyIDAgMCAwIDMgOHY4YTIgMiAwIDAgMCAxIDEuNzNsNyA0YTIgMiAwIDAgMCAyIDBsNy00QTIgMiAwIDAgMCAyMSAxNlonLz48cGF0aCBkPSdtMy4zIDcgOC43IDUgOC43LTUnLz48cGF0aCBkPSdNMTIgMjJWMTInLz48L3N2Zz4=") !important;
}
[data-sidebar='menu-button'] i.codicon-watch {
  -webkit-mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0nMTInIGN5PScxMicgcj0nOScvPjxwYXRoIGQ9J00xMiA3djVsMyAyJy8+PC9zdmc+") !important;
          mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0nMTInIGN5PScxMicgcj0nOScvPjxwYXRoIGQ9J00xMiA3djVsMyAyJy8+PC9zdmc+") !important;
}
[data-sidebar='menu-button'] i.codicon-project {
  -webkit-mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0nMycgeT0nMycgd2lkdGg9JzcnIGhlaWdodD0nOScgcng9JzEnLz48cmVjdCB4PScxNCcgeT0nMycgd2lkdGg9JzcnIGhlaWdodD0nNScgcng9JzEnLz48cmVjdCB4PScxNCcgeT0nMTInIHdpZHRoPSc3JyBoZWlnaHQ9JzknIHJ4PScxJy8+PHJlY3QgeD0nMycgeT0nMTYnIHdpZHRoPSc3JyBoZWlnaHQ9JzUnIHJ4PScxJy8+PC9zdmc+") !important;
          mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0nMycgeT0nMycgd2lkdGg9JzcnIGhlaWdodD0nOScgcng9JzEnLz48cmVjdCB4PScxNCcgeT0nMycgd2lkdGg9JzcnIGhlaWdodD0nNScgcng9JzEnLz48cmVjdCB4PScxNCcgeT0nMTInIHdpZHRoPSc3JyBoZWlnaHQ9JzknIHJ4PScxJy8+PHJlY3QgeD0nMycgeT0nMTYnIHdpZHRoPSc3JyBoZWlnaHQ9JzUnIHJ4PScxJy8+PC9zdmc+") !important;
}

/* —— 左列上色（克制） ——
   全灰之后显得太素，加三处很轻的主色，不动文字主体：
   ① 导航菜单的图标着主色（文字仍是墨色）
   ② 选中的会话行左缘 3px 主色竖条
   ③ 顶部当前标签（会话/机器人/终端）淡主色底 + 主色文字
   主色取 --acc-main（随配色档变），三处加起来只占很小面积。 */
/* 图标外面还套了一层 span / 图标本身可能是 mask，这里把首个子节点整块染色，
   文字（第二个子节点起）不碰。 */
[data-sidebar='menu-button'] > *:first-child,
[data-sidebar='menu-button'] > *:first-child *,
[data-sidebar='menu-button'] svg {
  color: color-mix(in srgb, var(--acc-main, #0EA598) 72%, var(--ui-text-primary)) !important;
  stroke: currentColor !important;
  transition: color 0.15s ease;
}
[data-sidebar='menu-button']:hover > *:first-child,
[data-sidebar='menu-button']:hover > *:first-child *,
[data-sidebar='menu-button']:hover svg {
  color: var(--acc-main, #0EA598) !important;
}

/* 会话行不要任何彩色描边/竖条：选中就只是一层中性墨底，最干净。 */
[data-sessions-mode] [data-slot='context-menu-trigger'],
[data-sessions-mode] [data-slot='context-menu-trigger'][class*='row-active'] {
  box-shadow: none !important;
  border-color: transparent !important;
  outline: none !important;
}
:root [data-slot='pane-tab']:not([data-vertical])[aria-selected='true'],
:root [data-slot='pane-tab']:not([data-vertical])[data-state='active'],
:root [data-slot='pane-tab']:not([data-vertical]).active {
  background-color: color-mix(in srgb, var(--acc-main, #0EA598) 12%, transparent) !important;
  border-color: color-mix(in srgb, var(--acc-main, #0EA598) 16%, transparent) !important;
  color: color-mix(in srgb, var(--acc-main, #0EA598) 80%, var(--ui-text-primary)) !important;
}

/* —— 5 档案切换：按钮几何统一 ——
   原来每颗是 26×20 的扁方块，图标大小和字重也跟着档位色飘。
   统一：24×24 正方、8px 圆角、图标 15px/1.6 线宽、字母 11px/600，
   悬停 8% 墨、当前档 10% 墨 + 0.5px 内墨边，状态点加上白描边把它从底块里"抠"出来。 */
[data-slot='profile-rail'] button {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  min-height: 24px !important;
  padding: 0 !important;
  border-radius: 8px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  letter-spacing: 0.01em !important;
  line-height: 1 !important;
}
[data-slot='profile-rail'] button svg {
  width: 15px !important;
  height: 15px !important;
  stroke-width: 1.6 !important;
}
[data-slot='profile-rail'] button:not(:hover):not([aria-current='true']):not([data-active='true']) {
  background-color: transparent !important;
}
[data-slot='profile-rail'] button:hover {
  background-color: color-mix(in srgb, var(--ui-text-primary) 8%, transparent) !important;
}
[data-slot='profile-rail'] button[aria-current='true'],
[data-slot='profile-rail'] button[data-active='true'] {
  background-color: color-mix(in srgb, var(--ui-text-primary) 10%, transparent) !important;
  box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--ui-text-primary) 9%, transparent) !important;
}
/* 档案方块上的状态点（profile-status-dot / 未读汇总点）一律不碰。
   它在应用里是个内联空 span：size-1.5 的宽高对内联元素无效，实际塌成 0 宽、
   行高 16px 的盒子 —— 平时什么也看不见。任何 width/border/box-shadow 打上去，
   都会立刻让它变成一条 2×16 的竖条（再加上档案条的 grayscale 就是灰色小方块）。
   所以这里既不给尺寸，也不给保护环。 */

/* —— 5 档案切换 / 侧栏底栏 ——
   原来每个方块都带自己的档位色（浅蓝、薄荷绿），字母和插头还各自上色，
   一排里五六个色相，和整站的"中性墨 + 细线"完全不是一套。
   统一做法：方块不填色，字/图标一律墨色；只有当前档给一点点墨底，悬停更淡一点。
   状态点的颜色保留（那是语义色，不参与装饰）。 */
[data-slot='profile-rail'] [style*='background-color'],
[data-slot='profile-rail-rest-square'] {
  background-color: transparent !important;
  color: color-mix(in srgb, var(--ui-text-primary) 58%, transparent) !important;
  border-radius: 10px !important;
}
[data-slot='profile-rail'] button:hover [style*='background-color'],
[data-slot='profile-rail-rest-square']:hover {
  background-color: color-mix(in srgb, var(--ui-text-primary) 7%, transparent) !important;
  color: var(--ui-text-primary) !important;
}
/* 当前档：只加一层很淡的墨底 + 极细内描边，不靠色相区分。 */
[data-slot='profile-rail'] [aria-current='true'],
[data-slot='profile-rail'] [data-active='true'] {
  background-color: color-mix(in srgb, var(--ui-text-primary) 9%, transparent) !important;
  color: var(--ui-text-primary) !important;
  box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--ui-text-primary) 8%, transparent) !important;
}
/* 方块里的字母、图标：同一字号、同一墨色，不再跟着档位色走。 */
[data-slot='profile-rail-rest-square'],
[data-slot='profile-rail'] [style*='background-color'] {
  font-size: 12px !important;
  font-weight: 600 !important;
  letter-spacing: 0 !important;
}
[data-slot='profile-rail'] svg,
[data-sidebar='footer'] svg {
  color: color-mix(in srgb, var(--ui-text-primary) 62%, transparent) !important;
  fill: none !important;
  stroke: currentColor !important;
  stroke-width: 1.6 !important;
  transition: color 0.15s ease;
}
[data-slot='profile-rail'] button:hover svg,
[data-sidebar='footer'] button:hover svg {
  color: var(--ui-text-primary) !important;
}
[data-sidebar='footer'] button {
  border-radius: 10px !important;
}
[data-sidebar='footer'] button:not(:hover) {
  background-color: transparent !important;
}
[data-sidebar='footer'] button:hover {
  background-color: color-mix(in srgb, var(--ui-text-primary) 7%, transparent) !important;
}
/* 这三颗（首页 / 更多 / 插头）的蓝，来源既不是 background-color 也不是内联 style，
   CSS 优先级和内联强制都压不动 —— 与其继续猜，直接整条去做色：
   滤镜对 fill、currentColor、渐变、canvas 一律生效，且不改结构。
   grayscale(1) 把档位色/强调色全部归零，观感落回中性墨，和整站一致。 */
[data-slot='profile-rail'] {
  filter: grayscale(1) contrast(0.96);
}
[data-slot='profile-rail'] * {
  filter: none;
}
/* 状态点保留语义色（它不在 grayscale 之外单独处理的话会一起变灰）。 */
[data-slot='profile-rail'] [data-slot='profile-status-dot'],
[data-slot='profile-rail'] [data-status] {
  filter: none;
}

/* 首页 / 更多 / 插头这几个是普通 button，底色来自工具类（不是内联 style），
   所以上面那条按内联 style 过滤的规则没打到它们。这里按 button 统一收。 */
[data-slot='profile-rail'] button {
  background-color: transparent !important;
  box-shadow: none !important;
  color: color-mix(in srgb, var(--ui-text-primary) 62%, transparent) !important;
  border-radius: 10px !important;
}
[data-slot='profile-rail'] button:hover {
  background-color: color-mix(in srgb, var(--ui-text-primary) 7%, transparent) !important;
  color: var(--ui-text-primary) !important;
}
[data-slot='profile-rail'] button[aria-current='true'],
[data-slot='profile-rail'] button[data-active='true'] {
  background-color: color-mix(in srgb, var(--ui-text-primary) 9%, transparent) !important;
  color: var(--ui-text-primary) !important;
}
/* 那三颗的蓝是强调色派生出来的（实测 #2E8FE0，正好是调色板 sky 档的 code 色）。
   与其一个个压 class，直接在侧栏作用域把强调色换成中性墨 —— 所有派生处一起变灰。 */
[data-slot='sidebar'] {
  --ui-accent: color-mix(in srgb, var(--ui-text-primary) 78%, transparent);
  --ui-accent-secondary: color-mix(in srgb, var(--ui-text-primary) 62%, transparent);
}

/* 底部那一排（首页 / 更多 / 插头）其实在 [data-slot='sidebar-rail'] 里，
   和档案切换的 profile-rail 是两个容器 —— 之前所有规则都打在 profile-rail 上，
   所以看着"怎么改都不变"。这里把 sidebar-rail 一并收进来。 */
[data-slot='sidebar-rail'] {
  filter: grayscale(1);
}
[data-slot='sidebar-rail'] button {
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  color: color-mix(in srgb, var(--ui-text-primary) 62%, transparent) !important;
  border-radius: 10px !important;
}
[data-slot='sidebar-rail'] button:hover {
  background-color: color-mix(in srgb, var(--ui-text-primary) 7%, transparent) !important;
  color: var(--ui-text-primary) !important;
}
[data-slot='sidebar-rail'] button[aria-current='true'],
[data-slot='sidebar-rail'] button[data-active='true'] {
  background-color: color-mix(in srgb, var(--ui-text-primary) 9%, transparent) !important;
  color: var(--ui-text-primary) !important;
}
[data-slot='sidebar-rail'] button > *,
[data-slot='sidebar-rail'] button > * > * {
  background-color: transparent !important;
  background-image: none !important;
  color: inherit !important;
}
[data-slot='sidebar-rail'] svg {
  color: inherit !important;
  stroke: currentColor !important;
  fill: none !important;
  stroke-width: 1.6 !important;
}

/* 蓝底其实是 button 里面的 span 在画（按钮外壳本身透明）。
   这里对按钮的所有子节点兜底去色，字色继承外壳的墨色。 */
[data-slot='profile-rail'] button > *,
[data-slot='profile-rail-rest-square'] > * {
  background-color: transparent !important;
  background-image: none !important;
  color: inherit !important;
  box-shadow: none !important;
}
[data-slot='profile-rail'] button > * > * {
  background-color: transparent !important;
  background-image: none !important;
  color: inherit !important;
}
[data-slot='profile-rail'] button svg {
  color: inherit !important;
  stroke: currentColor !important;
  fill: none !important;
}
/* 分隔符的真实结构（profile-switcher.tsx:1184-1195）是：
     <span data-slot='profile-rail-divider' class="flex h-5 items-center gap-0.5">  ← 透明外壳
       <span class="h-3 w-px bg-(--ui-stroke-tertiary)" />                        ← 1px 发丝线
       <ConnectionGlyph />                                                         ← 网关图标
   以前这条规则把外壳整个填上 7% 墨 —— 于是每处网关分隔都变成一个 20px 高的灰方块
   （就是「档案那边凭空多出来的灰竖块」）。外壳必须保持透明，只给发丝线上色。 */
[data-slot='profile-rail-divider'] {
  background-color: transparent !important;
}
[data-slot='profile-rail-divider'] > span[class*='w-px'] {
  background-color: color-mix(in srgb, var(--ui-text-primary, #1d1d1f) 14%, transparent) !important;
}

/* —— 5 档案切换：整行做成 34 高的胶囊带，方块按钮统一 20/6，图标走同一套淡墨 —— */
[data-slot='profile-rail'] {
  min-height: 34px !important;
  padding-inline: 10px !important;
  gap: 6px !important;
  border-radius: 10px;
}
/* 几何统一在下面那条 24×24 的规则里，这里只管过渡与不透明度。 */
[data-slot='profile-rail-rest-square'],
[data-slot='profile-rail'] button {
  transition: background-color 0.15s ease, opacity 0.15s ease;
}
[data-slot='profile-rail-rest-square'] {
  opacity: 0.82;
}
/* 未悬停时一律去色：原来这些方块是蓝/绿浅底，和整体单色墨系不搭。
   侧栏最底部那一排图标不在 profile-rail 里，所以按 sidebar 的末级容器一并收。 */
[data-slot='profile-rail'] button:not(:hover),
[data-slot='profile-rail-rest-square']:not(:hover) {
  background-color: transparent !important;
  box-shadow: none !important;
}
[data-slot='profile-rail'] button:not(:hover) svg,
[data-slot='profile-rail'] button:not(:hover) svg,
[data-slot='profile-rail-rest-square']:not(:hover) svg {
  opacity: 0.9;
}
[data-slot='profile-rail-rest-square']:hover,
[data-slot='profile-rail'] button:hover {
  background-color: color-mix(in srgb, var(--ui-text-primary) 6%, transparent) !important;
  opacity: 1;
}
[data-slot='profile-rail-divider'],
[data-slot='profile-rail-gateway'] {
  opacity: 0.62;
  transition: opacity 0.15s ease;
}
[data-slot='profile-rail-divider']:hover,
[data-slot='profile-rail-gateway']:hover {
  opacity: 1;
}
/* 档案条上的状态点（含未读汇总点）保持应用原样：6px 圆点。
   以前这里压成 5×5 并加 2px 右外边距，配合上面那批 sidebar 规则会把它挤成竖条。 */
[data-slot='profile-rail'] [data-slot='profile-status-dot'],
[data-slot='profile-rail'] [data-slot='profile-rail-unreachable'] {
  filter: none;
}

:root [data-slot='pane-tab']:not([data-vertical]) {
  align-self: center;
  height: 22px;
  max-height: calc(100% - 6px);
  padding-inline: 11px;
  margin-inline: 1px;
  border: 0.5px solid transparent;
  border-radius: 10px;
  background-color: transparent;
  color: color-mix(in srgb, var(--ui-text-primary) 57%, transparent);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
  transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
:root [data-slot='pane-tab']:not([data-vertical]):hover {
  background-color: color-mix(in srgb, #fff 20%, transparent);
  color: var(--ui-text-primary);
}
:root [data-slot='sidebar'] [data-sidebar='menu-button'] {
  border-radius: 12px !important;
}
:root [data-slot='sidebar'] input,
:root [data-slot='sidebar'] [data-sidebar='input'] {
  border-radius: 12px !important;
}
:root [data-slot='pane-tab'][data-active='true']:not([data-vertical]) {
  /* 弱化：74% → 44% 白，投影减半，只留一层很淡的墨边定形 */
  background-color: color-mix(in srgb, #fff 44%, transparent);
  border-color: color-mix(in srgb, #000 4.5%, transparent);
  color: var(--ui-text-primary);
  font-weight: 600;
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 40%, transparent);
}
:root.dark [data-slot='pane-tab']:not([data-vertical]) {
  color: color-mix(in srgb, #fff 55%, transparent);
}
:root.dark [data-slot='pane-tab']:not([data-vertical]):hover {
  background-color: color-mix(in srgb, #fff 11%, transparent);
  color: #fff;
}
:root.dark [data-slot='pane-tab'][data-active='true']:not([data-vertical]) {
  background-color: color-mix(in srgb, #fff 16%, transparent);
  border-color: color-mix(in srgb, #fff 13%, transparent);
  color: #fff;
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 13%, transparent),
    0 1px 2px color-mix(in srgb, #000 25%, transparent);
}
/* 标签之间的竖分隔线是 VS Code 语言，这里不画（只去颜色，宽度不变）。 */
:root [data-slot='pane-tab']:not([data-vertical]):not(:first-child) {
  border-left-color: transparent;
}
/* 左缘对齐：2 的菜单行图标从 x=18 起（行盒 10 + 内边距 8），
   药丸左侧 17 + 自身 margin 1 才落在同一条线上。 */
:root [class*='group/pane-header'] [role='tablist'] {
  padding-left: 17px;
}
/* 融成一块：1 的底色去掉，让它和 2 一样露出同一层材质（1 原来带的是
   应用写死的 --ui-sidebar-surface-background，这就是"总是差一档"的来源）。 */
:root [class*='group/pane-header'] {
  background-color: transparent !important;
  background-image: none !important;
}
/* 1 和 2 都交给系统材质，插件一律不刷底色、不加滤镜。
   关键：侧栏原来带着一条 backdrop-filter: saturate(1.8) blur(30px)（毛玻璃名单里那组），
   标签条没有 —— 带滤镜的那块会把背后重新合成一遍，明度就和邻居差一档（实测 234 vs 238）。
   把滤镜也一起摘掉，两块就都直接贴在窗口材质上：同一个色，而且是真的"液态玻璃"，
   不是刷出来的近似色。 */
:root[data-hermes-glass] [data-slot='sidebar'],
:root[data-hermes-glass] [data-slot='statusbar'],
:root[data-hermes-glass] [class*='group/pane-header'],
:root[data-hermes-glass] [class*='bg-(--ui-sidebar-surface-background)'] {
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
/* 发送 / 语音主按钮：app 故意做成黑底高对比（PRIMARY_ICON_BTN 用 bg-foreground），
   换成 Apple 的系统蓝圆形 + 淡阴影。 */
:root [data-slot="composer-root"] button[class*="bg-foreground"] {
  background: var(--shell-accent, #007AFF);
  color: #ffffff;
  box-shadow: 0 1px 2px color-mix(in srgb, #000 16%, transparent);
}
:root [data-slot="composer-root"] button[class*="bg-foreground"]:hover {
  background: #0A7CFF;
}
:root [data-slot="composer-root"] button[class*="bg-foreground"]:disabled {
  background: color-mix(in srgb, var(--shell-accent, #007AFF) 35%, transparent);
  color: #ffffff;
}
:root.dark [data-slot="composer-root"] button[class*="bg-foreground"] {
  background: #0A84FF;
}
/* 模型选择 / Med 这类 pill 用的是三级文字色（很浅），提到二级，入口才看得见 */
:root [data-slot="composer-root"] button[class*="text-(--ui-text-tertiary)"] {
  color: var(--ui-text-secondary);
}
:root [data-slot="composer-root"] button[class*="text-(--ui-text-tertiary)"]:hover {
  color: var(--dt-foreground);
}
`,
  },
  {
    id: 'rail',
    label: '档案条',
    note: '底部档案方块',
    css: `
/* 档案条（侧栏底部那排档案方块）。
   出厂：按钮 20px（size-5）、圆角 3px、字母 9px，非活动项再乘 opacity-55 / 35；
   底色是 profileColorSoft(color, 22) 的 inline style —— 22% 再打折约等于 12%，整排发灰。
   这里统一成 26px / 圆角 8px / 字母 11px，非活动项不打折，活动项本色 42% + 双环。
   三种形态都要管到：
     (1) 默认档案：按钮自带底色 + 房子图标；
     (2) 具名档案：按钮自带底色 + 里面的字母；
     (3) 其它网关的方块（profile-rail-rest-square）：按钮里嵌一个 ProfileGlyph，
         底色在那个 span 的 inline style 上。 */
[data-slot='profile-rail'] {
  column-gap: 6px;
  row-gap: 6px;
}
[data-slot='profile-rail'] [class*='gap-1'] {
  column-gap: 6px;
}
[data-slot='profile-rail'] button,
[data-slot='profile-rail'] [class*='size-5'] {
  width: 26px;
  height: 26px;
  border-radius: 10px;
  font-size: 11px;
  letter-spacing: 0;
  opacity: 1;
}
[data-slot='profile-rail'] [class*='opacity-55'],
[data-slot='profile-rail'] [class*='opacity-35'] {
  opacity: 0.9;
}
/* 具名档案（按钮自带 inline 底色）：app 用档案名 hash 出颜色，lobo 落到
   hsl(128 68% 58%) —— 偏黄的「菜绿」，22% 洗淡后就是一块灰绿（实测 209,234,212）。
   这里把色相往薄荷方向推 22° 并轻微降饱和（实测 → 199~212,234~235,217~223），
   未选中 18% / 选中 46%。 */
[data-slot='profile-rail'] button[style*='background-color'] {
  filter: hue-rotate(22deg) saturate(0.92);
}
/* 只作用于「方块」（ProfileGlyph 这类正方形底色块）。
   :not(...) 那串是给细竖条留的活口：档案上的「有未读」标记是一个
   w-0.5 / rounded-full 的细条，以前也被这条规则接管 —— 它的 inline 底色被
   改成 currentColor 18%，于是在页面上凭空多出一个灰色竖块。 */
[data-slot='profile-rail'] button[aria-pressed='false'][style*='background-color'],
[data-slot='profile-rail'] span[style*='background-color']:not([class*='w-0']):not([class*='w-px']):not([class*='rounded-full']) {
  background-color: color-mix(in srgb, currentColor 18%, transparent) !important;
}
[data-slot='profile-rail'] span[style*='background-color']:not([class*='w-0']):not([class*='w-px']):not([class*='rounded-full']) {
  width: 26px;
  height: 26px;
  border-radius: 10px;
  font-size: 11px;
  letter-spacing: 0;
}
[data-slot='profile-rail'] button[aria-pressed='true'][style*='background-color'],
[data-slot='profile-rail'] button[aria-pressed='true'] span[style*='background-color'] {
  background-color: color-mix(in srgb, currentColor 46%, transparent) !important;
}
/* 默认档那颗是 ProfilePill（房子图标），app 不给它颜色（resolveProfileColor('default')
   返回 null）—— 于是它只剩一块几乎看不见的灰（实测 222,227,237）。这里借用主色蓝，
   让两颗方块看起来是一套。用 :not([style*='background-color']) 把两种形态分开。 */
[data-slot='profile-rail'] button[aria-pressed='false']:not([style*='background-color']) {
  background-color: color-mix(in srgb, var(--shell-accent, #007AFF) 10%, transparent) !important;
  color: #007AFF !important;
}
[data-slot='profile-rail'] button[aria-pressed='true']:not([style*='background-color']) {
  background-color: color-mix(in srgb, var(--shell-accent, #007AFF) 30%, transparent) !important;
  color: #007AFF !important;
}
[data-slot='profile-rail'] button[aria-pressed='true'] {
  box-shadow:
    0 0 0 1.5px var(--ui-panel-background),
    0 0 0 2.5px color-mix(in srgb, currentColor 50%, transparent),
    0 1px 3px color-mix(in srgb, #000 14%, transparent) !important;
}
[data-slot='profile-rail'] button svg,
[data-slot='profile-rail'] .codicon {
  font-size: 15px;
  width: 15px;
  height: 15px;
}
`
,
  },
  {
    id: 'assistant',
    label: '助手消息',
    note: '正文配色与强调',
    css: `
/* 助手消息下方的操作行（复制 / 朗读 / 重试 / 表情）与元信息行（时间、分支）。
   出厂把动作键做成「无底色、无圆角、opacity .5」的裸图标（styles.css:2427），
   图标尺寸也随手写（3.5 到 4 档不等）；消息下方那排「回到此处 / 1/2 分支」是
   12px + opacity-65 的小灰字。这里按项目里其它图标键的样子统一成 20px 圆角方
   + 浅填充 hover，元信息行统一 11px 并给可点处一个药丸热区。 */
/* 回复里的 **加粗**：中文的字重差异小，靠颜色更清楚。两条选择器覆盖 app 的两种渲染路径
   （带 .aui-md 外壳的常规路径，以及没有外壳的裸渲染版本），限定在正文块里避免碰到工具卡。 */
/* ── 回复正文的配色：只用一个强调色（品牌靛蓝 #5B6CFF），分档铺在结构元素上，
   正文文字保持中性墨色 —— 这样是"多处有颜色"而不是"满屏花"。分档：
   文字级 100%（标题 / 链接）、代码级 88%+9% 底、符号级 60%（列表点）、
   线条级 22%（标题细线 / 分割）、底色级 7%（表头）。 */
/* 标题：靛蓝 + h1/h2 收一条靛蓝细线（苹果文档那种层级感） */
/* 三套清新配色的变量（由 PALETTES 生成）：主色 / 代码色 / 辅色 / 气泡填充色。
   气泡段也放一份同样的变量，单独关掉某一段时另一段还能自己工作。 */
${PALETTES.map((palette, index) => (index === 0 ? ":root" : ":root[data-ui-palette='" + palette.id + "']") + " {\n  --acc-main: " + palette.main + ";\n  --acc-code: " + palette.code + ";\n  --acc-alt: " + palette.alt + ";\n  --bub-fill: " + palette.bubble + ";\n}\n").join("")}
[data-slot='aui_assistant-message-content'] .aui-md :where(h1, h2, h3) {
  color: var(--acc-main);
  letter-spacing: 0.01em;
}
[data-slot='aui_assistant-message-content'] .aui-md :where(h1, h2) {
  padding-block-end: 0.22em;
  border-block-end: 1px solid color-mix(in srgb, var(--acc-main) 22%, transparent);
}
/* 行内代码：靛蓝字 + 淡靛蓝底 */
[data-slot='aui_assistant-message-content'] .aui-md :where(:not(pre) > code) {
  padding: 0.12em 0.36em;
  border-radius: 5px;
  color: color-mix(in srgb, var(--acc-code) 70%, var(--ui-text-primary)) !important;
  background-color: color-mix(in srgb, var(--acc-code) 9%, transparent);
}
/* 链接：靛蓝 + 常显细下划线（用 currentColor 让下划线比字浅一档） */
[data-slot='aui_assistant-message-content'] .aui-md :where(a) {
  /* 主色直接当链接文字太浅（汽水档只有 2.35:1），兑墨到 70% 后 4.2:1 */
  color: color-mix(in srgb, var(--acc-main) 70%, var(--ui-text-primary));
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
}
[data-slot='aui_assistant-message-content'] .aui-md :where(a):hover {
  text-decoration-color: currentColor;
}
/* 列表符号：直接用强调色（原来是 60% alpha —— 浅色档位下的圆点会淡到看不见） */
[data-slot='aui_assistant-message-content'] .aui-md :where(li)::marker {
  color: var(--acc-alt);
}
/* 引用：靛蓝竖条 + 收一档字色 */
[data-slot='aui_assistant-message-content'] .aui-md :where(blockquote) {
  padding-inline-start: 0.75em;
  border-inline-start: 3px solid var(--acc-alt);
  border-radius: 0 4px 4px 0;
  color: var(--ui-text-secondary);
}
[data-slot='aui_assistant-message-content'] .aui-md :where(strong, b, span.font-semibold, span.font-bold) {
  /* 加粗用主色和墨色兑开的调子：直接上纯强调色太闹（用户反馈"太重、不舒服"）。 */
  color: color-mix(in srgb, var(--acc-main) 62%, var(--ui-text-primary)) !important;
  font-weight: 700 !important;
}
[data-slot='aui_assistant-message-content'] :where(p, li, td, blockquote, h1, h2, h3, h4) :where(strong, b, span.font-semibold, span.font-bold) {
  color: color-mix(in srgb, var(--acc-main) 62%, var(--ui-text-primary)) !important;
  font-weight: 700 !important;
}
/* 表格：苹果风＝更少的线、更松的留白、表头收成小字次级色。
   出厂已有发丝横线、无竖线、圆角 6px；这里只把它推到苹果的疏密与层级：
   外框圆角 8px、单元格 8/14、表头 600 字重 + 次级色 + 一丝极淡底、数字等宽。 */
[data-slot='aui_assistant-message-content'] .aui-md .aui-md-table {
  border-radius: 10px !important;
}
[data-slot='aui_assistant-message-content'] .aui-md .aui-md-table :where(th, td) {
  padding: 0.5rem 0.875rem !important;
}
[data-slot='aui_assistant-message-content'] .aui-md .aui-md-table :where(th) {
  font-weight: 600 !important;
  color: color-mix(in srgb, var(--acc-code) 70%, var(--ui-text-primary)) !important;
  background-color: color-mix(in srgb, var(--acc-code) 7%, transparent);
}
[data-slot='aui_assistant-message-content'] .aui-md .aui-md-table :where(thead tr) {
  border-bottom-color: color-mix(in srgb, var(--acc-code) 20%, transparent) !important;
}
[data-slot='aui_assistant-message-content'] .aui-md .aui-md-table :where(td) {
  font-variant-numeric: tabular-nums;
  color: var(--dt-foreground);
}
/* 斑马底纹：隔行兑 5% 的代码色，够看清行、又不抢眼 */
[data-slot='aui_assistant-message-content'] .aui-md .aui-md-table :where(tbody tr:nth-child(even)) {
  background-color: color-mix(in srgb, var(--acc-code) 5%, transparent);
}
[data-slot='aui_msg-actions'] button,
button[data-slot='aui_msg-reactions'] {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 6px;
  display: grid;
  place-items: center;
  opacity: 0.62;
}
[data-slot='aui_msg-actions'] button svg,
button[data-slot='aui_msg-reactions'] svg {
  width: 0.875rem;
  height: 0.875rem;
}
[data-slot='aui_msg-actions'] button:hover,
button[data-slot='aui_msg-reactions']:hover {
  background: color-mix(in srgb, var(--dt-foreground) 7%, transparent) !important;
  color: var(--dt-foreground);
  opacity: 1;
}
[data-slot='aui_msg-actions'] {
  gap: 0.25rem;
}
.checkpoint-container {
  gap: 0.375rem;
  font-size: 0.6875rem;
}
.checkpoint-restore-text {
  display: inline-flex;
  align-items: center;
  height: 1.25rem;
  padding: 0 0.375rem;
  border-radius: 6px;
  opacity: 0.72;
}
.checkpoint-restore-text:hover {
  background: color-mix(in srgb, var(--dt-foreground) 7%, transparent);
  opacity: 1;
}
.checkpoint-icon {
  opacity: 0.75;
}
`,
  },
  {
    id: 'shell',
    label: '配色应用到其他板块',
    note: '侧栏与状态栏',
    css: `
/* 外壳强调色：侧栏分区标题、状态栏圆点、选中态、聚焦圈、文本选中都吃这一支。
   关掉这一段时 --shell-accent 未定义，各处回落到原来的系统蓝。 */
:root {
  --shell-accent: var(--acc-main);
  --ui-selection-background: color-mix(in srgb, var(--acc-main) 24%, transparent);
  --theme-primary: var(--acc-main);
  --theme-midground: var(--acc-main);
  --dt-primary: var(--acc-main);
  --ui-accent: var(--acc-main);
  --ui-accent-secondary: var(--acc-main);
}`,
  },
  {
    id: 'overlay',
    label: '输入区弹层',
    note: '输入框弹出面板',
    css: `
/* 输入框上方的浮层：补全抽屉（@文件、/命令）、附件菜单、模型选择行、子代理详情。
   出厂走 composerPanelCard 那套通用卡片，圆角/阴影自成一格；这里统一到本项目的
   浮层观感：12px 圆角 + 发丝线 + 同一枚阴影，行内图标键也收成圆角方块。 */
[data-slot='composer-completion-drawer'] {
  border-radius: 12px;
  border: 0.5px solid var(--apple-hairline);
  box-shadow: var(--shadow-md);
}
[data-slot='model-menu-row-icon'] {
  border-radius: 4px;
}
[data-slot='composer-subagent-detail'],
.status-subagent-detail {
  border-radius: 10px;
  border: 0.5px solid var(--apple-hairline);
}
`,
  },
]






















// ── AI 头像 ──────────────────────────────────────────────────────────────────
// 三种线稿头像，都是 24 视框、stroke 走 currentColor，尺寸由 CSS 给（18px）。
// Waves 头像（DiceBear，CC0 1.0，https://www.dicebear.com/styles/waves/）：
// 原 SVG 是 6 层白色波纹叠在一个底色上，这里把 use/defs 展开成 5 条独立路径，
// 底色走 currentColor（= 当前主色），波纹保持白，每层单独给 CSS 动画做视差。
// 头像：AI 生成的三套原创动漫形象（自有素材，无第三方授权约束）。
//   源图/成品归档：~/Documents/AiOutput/hermes-ui/avatar-<id>-src.png / -256.png
//   内联的是 256px 透明底 WebP（质量 92）：rembg 抠图 + 去底板，人物四周留 16% 透明边。
//   容器不再裁圆（overflow:visible），所以头顶装饰/鳍都不会被切；阴影走 drop-shadow 贴人物轮廓。
// 头像动画雪碧图：4 列 × 3 行，96px 格，行为「待机 / 工作中 / 点击」。
// 生成产物与重跑脚本在 ~/Documents/AiOutput/hermes-ui/anim-deepseek/（sprite-<id>.webp + build_all.py）。
// 时序全在 CSS：待机 5.2s 一轮（眨眼约 338ms）、工作中 0.8s 一轮、点击 0.9s 播一次。
const AVATAR_SPRITES = {
  deepseek:
    'data:image/webp;base64,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',
  gpt:
    'data:image/webp;base64,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',
  claude:
    'data:image/webp;base64,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',
}
const AVATAR_STYLES = [
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'gpt', label: 'ChatGPT' },
  { id: 'claude', label: 'Claude' },
]
const DEFAULT_AVATAR_NAME = 'Hermes'

// —— 头像状态：待机 / 工作中 / 点击
// 「工作中」完全交给 CSS（:has 匹配宿主的 data-message-streaming 标记），这里只管点击这个事件态。
let avatarClicking = false

function playAvatarClick(sprite) {
  if (!sprite || avatarClicking) return
  avatarClicking = true
  sprite.setAttribute('data-state', 'click')
  let done = false
  const restore = () => {
    if (done) return
    done = true
    sprite.removeEventListener('animationend', restore)
    avatarClicking = false
    sprite.removeAttribute('data-state')
  }
  sprite.addEventListener('animationend', restore)
  setTimeout(restore, 1200)
}

if (typeof document !== 'undefined' && !window.__uiStudioAvatarWired) {
  window.__uiStudioAvatarWired = true
  document.addEventListener(
    'click',
    event => {
      const target = event.target instanceof Element ? event.target : null
      const host = target && target.closest('[data-ui-avatar="1"] .ui-avatar-icon')
      if (!host) return
      playAvatarClick(host.querySelector('.ui-avatar-sprite'))
    },
    true,
  )
}

function clearAvatar() {
  if (typeof document === 'undefined') return
  for (const head of document.querySelectorAll('[data-ui-avatar="1"]')) {
    head.remove()
  }
}

function syncAvatar() {
  if (typeof document === 'undefined') return
  if (!state.enabled || state.showAvatar === false) {
    clearAvatar()
    return
  }
  const roots = document.querySelectorAll("[data-slot='aui_assistant-message-content']")
  for (const root of roots) {
    let head = root.querySelector('[data-ui-avatar="1"]')
    if (!head) {
      head = document.createElement('div')
      head.setAttribute('data-ui-avatar', '1')
      root.prepend(head)
    }
    const sprite = AVATAR_SPRITES[state.avatar] || AVATAR_SPRITES.deepseek
    const name = (state.avatarName || DEFAULT_AVATAR_NAME).slice(0, 24)
    // 版本号参与 key：以后改头像内部结构（类名/层级）时 bump 一下，老 DOM 会被重建
    const AVATAR_REV = 11
    const key = state.avatar + '|' + name + '|' + AVATAR_REV
    if (head.getAttribute('data-key') !== key) {
      head.setAttribute('data-key', key)
      head.innerHTML =
        '<span class="ui-avatar-icon"><span class="ui-avatar-sprite" style="background-image:url(' + sprite +
        ')"></span></span><span class="ui-avatar-name"></span>'
      head.querySelector('.ui-avatar-name').textContent = name
    }
  }
}
// 注意：这里绝对不能在 document.body 上挂 MutationObserver 再去写 DOM ——
// 写入会再次触发 observer，消息流又是持续变动的，结果就是主线程被自己刷爆（界面假死）。
// 改成：计数不一致才动 DOM，靠轻量定时器 + 滚动事件补新来的消息。
let avatarTimer = null
let avatarScrollBound = false

function avatarCounts() {
  return {
    contents: document.querySelectorAll("[data-slot='aui_assistant-message-content']").length,
    heads: document.querySelectorAll("[data-ui-avatar='1']").length,
  }
}

function syncAvatarIfStale() {
  if (typeof document === 'undefined') return
  if (!state.enabled || state.showAvatar === false) return
  try {
    const { contents, heads } = avatarCounts()
    if (contents === 0) return
    if (contents === heads) return
    syncAvatar()
  } catch (error) {
    // 任何一次失败都不能让轮询停下来
  }
}

// tick 只做一件事：消息数对不上就补头像。不做 MutationObserver（写 DOM 会自激），
// 也不为单一功能另开定时器。
function tickMessages() {
  syncAvatarIfStale()
}

function startAvatar() {
  if (typeof document === 'undefined') return
  tickMessages()
  if (avatarTimer) return
  avatarTimer = setInterval(tickMessages, 1500)
  const viewport = document.querySelector("[data-slot='aui_thread-viewport']") || document.querySelector("[data-slot='thread']")
  if (viewport && !avatarScrollBound) {
    avatarScrollBound = true
    viewport.addEventListener('scroll', () => requestAnimationFrame(tickMessages), { passive: true })
    // 窗口/侧栏尺寸变了，泊位立刻重算，不等 1.5s
    window.addEventListener('resize', () => requestAnimationFrame(tickMessages), { passive: true })
  }
}







const DEFAULT_SECTIONS = () => Object.fromEntries(SECTIONS.map(section => [section.id, true]))

// 面板分组：按「主题」分，不按机制分 —— 同一个东西的开关和旋钮必须挨着，
// 否则用户会在两处看到同一个名字（以前的毛病：气泡在「观感调节」里有颜色、在
// 「生效范围」里又有一个开关；字号圆角既是档位又是开关，两处对不上）。

// ── 3. 档位 ──────────────────────────────────────────────────────────────────
// 常用 4 项（疏密 / 字号 / 圆角 / 气泡最大宽度），每项固定几档，没有连续滑杆。
// 疏密这一档带着 5 个间距变量一起缩放，省掉五个看不懂的旋钮。
const rem = value => `${+Number(value).toFixed(4)}rem`

// 组件样式段里的基线值（疏密 = 1 时就是这些值）。
const DENSITY_BASE = {
  paragraph: 0.8,
  turn: 0.95,
  turnGap: 0.475,
  tool: 0.4,
  indent: 0.85,
}
// 排版基线：正文 14px / 行高 21px（约 1.5 倍），工具行 12px，注释 13px。
const APPLE_TEXT_SIZE = 0.875
const APPLE_LINE_HEIGHT = 1.3125
const TOOL_RATIO = 0.75 / APPLE_TEXT_SIZE
const CAPTION_RATIO = 0.8125 / APPLE_TEXT_SIZE

const KNOBS = [
  {
    key: 'density',
    group: 'main',
    label: '疏密',
    hint: '段落、回复块、工具行、缩进一起缩放',
    def: 1,
    min: 0.6,
    max: 1.5,
    steps: [
      { value: 0.75, label: '紧凑' },
      { value: 1, label: '标准' },
      { value: 1.25, label: '宽松' },
    ],
    vars: {
      '--paragraph-gap': value => rem(DENSITY_BASE.paragraph * value),
      '--turn-block-gap': value => rem(DENSITY_BASE.turn * value),
      '--conversation-turn-gap': value => rem(DENSITY_BASE.turnGap * value),
      '--tool-row-gap': value => rem(DENSITY_BASE.tool * value),
      '--message-text-indent': value => rem(DENSITY_BASE.indent * value),
    },
  },
  {
    key: 'size',
    group: 'main',
    label: '字号',
    hint: '正文、工具行、注释同比例',
    def: APPLE_TEXT_SIZE,
    min: 0.8125,
    max: 1.125,
    steps: [
      { value: 0.8125, label: '小 13' },
      { value: 0.875, label: '标准 14' },
      { value: 0.9375, label: '大 15' },
      { value: 1, label: '特大 16' },
    ],
    vars: {
      '--conversation-text-base-size': value => rem(value),
      '--conversation-tool-base-size': value => rem(value * TOOL_RATIO),
      '--conversation-caption-base-size': value => rem(value * CAPTION_RATIO),
      '--conversation-base-line-height': value => rem(APPLE_LINE_HEIGHT * (value / APPLE_TEXT_SIZE)),
      '--conversation-caption-base-line-height': value => rem(value / APPLE_TEXT_SIZE),
    },
  },
  {
    key: 'radius',
    group: 'main',
    label: '圆角',
    hint: '按卡片圆角算（--radius-xl = 16px × 系数），气泡、菜单、弹窗按比例一起变',
    // 系数据此换算：--radius-xl = 1rem × 系数，所以 0.375 = 6px / 0.625 = 10px / 0.875 = 14px / 1.125 = 18px
    def: 0.625,
    min: 0,
    max: 1.4,
    steps: [
      { value: 0.375, label: '6px' },
      { value: 0.625, label: '10px' },
      { value: 0.875, label: '14px' },
      { value: 1.125, label: '18px' },
    ],
    vars: { '--radius-scalar': value => String(+value.toFixed(3)) },
  },
  {
    key: 'bubbleMax',
    group: 'main',
    label: '气泡最大宽度',
    hint: '我发的消息最宽占消息栏的比例（短消息仍各自贴合内容）',
    def: 80,
    min: 60,
    max: 100,
    steps: [
      { value: 68, label: '68%' },
      { value: 80, label: '80%' },
      { value: 92, label: '92%' },
      { value: 100, label: '100%' },
    ],
    vars: { '--bubble-max': value => `${+Number(value).toFixed(2)}%` },
  },
]

/** 吸附到最近的档位值。 */
function nearestStep(knob, value) {
  let best = knob.def
  let gap = Infinity
  for (const step of knob.steps || []) {
    const distance = Math.abs(step.value - value)
    if (distance < gap) {
      gap = distance
      best = step.value
    }
  }
  return best
}

const KNOB_BY_KEY = Object.fromEntries(KNOBS.map(knob => [knob.key, knob]))
const KNOB_DEFAULTS = () => Object.fromEntries(KNOBS.map(knob => [knob.key, knob.def]))

const PRESETS = [
  { id: 'standard', label: '标准', note: '三项全回标准', touch: {} },
  { id: 'compact', label: '紧凑', note: '字小、间距紧', touch: { density: 0.75, size: 0.8125, radius: 0.375 } },
  { id: 'relaxed', label: '宽松', note: '字大、间距松、圆角更圆', touch: { density: 1.25, size: 1, radius: 1.125 } },
]

// 三种气泡色：都比原来的 #007AFF 轻（用户反馈"颜色有点重"），同一套液态玻璃。

// 每个配色再派生一个「外壳跟着走」的主题：只换强调色一族，其余（背景/字体/终端）沿用。
function buildTheme(base, { name, label, accent }) {
  const accentize = colors => ({
    ...colors,
    primary: accent,
    ring: accent,
    midground: accent,
    composerRing: accent,
    accent: mixHex(accent, colors.background, 0.86),
  })
  return {
    ...base,
    name,
    label,
    description: base.description,
    colors: accentize(base.colors),
    darkColors: accentize(base.darkColors),
  }
}

function themeNameFor(paletteId, shellOn) {
  return shellOn ? `${THEME_NAME}-${paletteId}` : THEME_NAME
}

// ── 官方「窗口透明 › 玻璃」的驱动 ─────────────────────────────────────────────
// 应用的设置存在 localStorage 这本书里（{ mode, base, light, dark }），运行时的原生
// 材质走 window.hermesDesktop.setTranslucency(...)。这里读写的是同一份数据，等于替
// 用户在面板里调用官方设置；下次启动应用自己读这本书，效果照样在。
const TRANSLUCENCY_KEY = 'hermes.desktop.translucency.v2'
const GLASS_MATERIALS = [
  { id: 'under-window', label: '深邃' },
  { id: 'popover', label: '柔和' },
  { id: 'titlebar', label: '明亮' },
  { id: 'header', label: '透亮' },
]
const GLASS_DEFAULT_INTENSITY = 32

function glassSupported() {
  try {
    return typeof window !== 'undefined' && window.hermesDesktop?.glassSupported !== false
  } catch (err) {
    return false
  }
}

function readTranslucencyBook() {
  try {
    const raw = window.localStorage.getItem(TRANSLUCENCY_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (err) {
    return null
  }
}

function writeTranslucencyBook(values, mode) {
  const prev = readTranslucencyBook() || {}
  const merged = {
    intensity: GLASS_DEFAULT_INTENSITY,
    fade: 0,
    material: 'header',
    scope: 'sidebar',
    ...(prev.base || {}),
    ...values,
  }
  const book = { mode, base: merged, light: { ...(prev.light || {}), ...merged }, dark: { ...(prev.dark || {}), ...merged } }
  let payload = ''
  try {
    payload = JSON.stringify(book)
    window.localStorage.setItem(TRANSLUCENCY_KEY, payload)
  } catch (err) {
    console.warn('[ui-studio] 窗口透明设置没写进存档：', err)
  }
  // 同窗口内 localStorage 不会自己触发 storage 事件，应用那边只认这个事件。
  try {
    if (payload) window.dispatchEvent(new StorageEvent('storage', { key: TRANSLUCENCY_KEY, newValue: payload }))
  } catch (err) {
    console.warn('[ui-studio] 没能通知应用重读窗口透明设置：', err)
  }
  return merged
}

function applyGlass(state) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const on = Boolean(state && state.enabled && glassSupported())
  const resolved = {
    intensity: on ? Number(state.intensity) || GLASS_DEFAULT_INTENSITY : 0,
    fade: 0,
    mode: on ? 'glass' : 'clear',
    material: on ? state.material : 'header',
    scope: on ? state.scope : 'sidebar',
  }
  root.toggleAttribute('data-hermes-glass-on', on)
  root.toggleAttribute('data-hermes-glass', on)
  if (on) {
    root.style.setProperty('--translucency-glass-keep', 100 - resolved.intensity + '%')
    root.setAttribute('data-hermes-glass-scope', resolved.scope)
    const rail = document.querySelector("[data-slot='sidebar']")
    if (rail) root.style.setProperty('--glass-rail-edge', Math.max(0, Math.round(rail.getBoundingClientRect().right)) + 'px')
  } else {
    root.removeAttribute('data-hermes-glass')
    root.removeAttribute('data-hermes-glass-scope')
    root.style.removeProperty('--translucency-glass-keep')
    root.style.removeProperty('--glass-rail-edge')
  }
  try {
    window.hermesDesktop?.setTranslucency?.(resolved)
  } catch (err) {
    console.warn('[ui-studio] 原生材质没切成：', err)
  }
  try {
    const book = readTranslucencyBook()
    const values = { ...(book?.base || {}), ...(book?.light || {}) }
    const same =
      book &&
      book.mode === resolved.mode &&
      Number(values.intensity) === resolved.intensity &&
      values.material === resolved.material &&
      values.scope === resolved.scope
    if (!same) writeTranslucencyBook({ intensity: resolved.intensity, material: resolved.material, scope: resolved.scope }, resolved.mode)
  } catch (err) {
    console.warn('[ui-studio] 同步窗口透明存档失败：', err)
  }
}

// ── 状态 ─────────────────────────────────────────────────────────────────────
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function sanitize(stored) {
  const raw = stored && typeof stored === 'object' ? stored : {}

  const sections = DEFAULT_SECTIONS()
  if (raw.sections && typeof raw.sections === 'object') {
    for (const section of SECTIONS) {
      if (typeof raw.sections[section.id] === 'boolean') {
        sections[section.id] = raw.sections[section.id]
      }
    }
  }

  // 只收「碰过」的档位：没碰过的不写进样式表，免得用浅色默认值压掉深色模式或
  // 特定页面自己更合适的取值。
  const values = KNOB_DEFAULTS()
  const touched = []
  const rawTuned = raw.tuned && typeof raw.tuned === 'object' ? raw.tuned : {}
  for (const key of Array.isArray(rawTuned.touched) ? rawTuned.touched : []) {
    const knob = KNOB_BY_KEY[key]
    if (!knob) {
      continue
    }
    const value = Number(rawTuned.values?.[key])
    // 老存档里可能留着连续滑杆的中间值：吸附到最近的档位，否则面板上一个都不高亮
    values[key] = Number.isFinite(value) ? nearestStep(knob, clamp(value, knob.min, knob.max)) : knob.def
    if (values[key] !== knob.def) touched.push(key)
  }

  return {
    // 新装默认开启；存档里显式关过就尊重那个选择。
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    sections,
    palette: PALETTES.some(palette => palette.id === raw.palette) ? raw.palette : 'mint',
    glassTouched: raw.glassTouched === true,
    glass: {
      // 用户没手动关过就是开（面板上按一下才会记成 glassTouched）
      enabled: raw.glassTouched ? raw.glass?.enabled === true : true,
      scope: raw.glass?.scope === 'window' ? 'window' : 'sidebar',
      material: GLASS_MATERIALS.some(m => m.id === raw.glass?.material) ? raw.glass.material : 'header',
      intensity: clamp(Number(raw.glass?.intensity) || GLASS_DEFAULT_INTENSITY, 5, 100),
    },
    avatar: AVATAR_STYLES.some(a => a.id === raw.avatar) ? raw.avatar : 'deepseek',
    avatarName: typeof raw.avatarName === 'string' && raw.avatarName.trim() ? raw.avatarName.trim().slice(0, 24) : DEFAULT_AVATAR_NAME,
    avatarSize: clamp(Number(raw.avatarSize) || 36, 36, 52),
    // AI 回复上方的头像 + 名称
    showAvatar: typeof raw.showAvatar === 'boolean' ? raw.showAvatar : true,
    petLayer: raw.petLayer !== false,
    themePinned: typeof raw.themePinned === 'boolean' ? raw.themePinned : true,
    previousTheme: typeof raw.previousTheme === 'string' ? raw.previousTheme : FALLBACK_THEME,
    tuned: { touched, values },
  }
}

let state = sanitize(null)
let snapshot = clone(state)
let persist = () => {}
const listeners = new Set()

function clone(next) {
  return {
    ...next,
    sections: { ...next.sections },
    tuned: { touched: [...next.tuned.touched], values: { ...next.tuned.values } },
  }
}

const subscribe = listener => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const read = () => snapshot

function commit(patch) {
  state = sanitize({
    ...state,
    ...patch,
    sections: { ...state.sections, ...(patch.sections ?? {}) },
    tuned: { ...state.tuned, ...(patch.tuned ?? {}) },
  })
  snapshot = clone(state)
  schedulePaint()
  schedulePersist(state)
  for (const listener of listeners) {
    listener()
  }
}

// 一帧内多次 commit（连点开关）只重画一次
let paintQueued = false
function schedulePaint() {
  if (paintQueued) return
  paintQueued = true
  const run = () => {
    paintQueued = false
    paint()
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else setTimeout(run, 16)
}

// 存档：停手 250ms 才写一次（以前每点一下写一次 storage）
let persistTimer = null
function schedulePersist(next) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    persist(next)
  }, 250)
}
function flushPersist() {
  if (!persistTimer) return
  clearTimeout(persistTimer)
  persistTimer = null
  persist(state)
}

const setKnob = (key, value) =>
  commit({
    tuned: { touched: [...new Set([...state.tuned.touched, key])], values: { ...state.tuned.values, [key]: value } },
  })

const applyPreset = preset =>
  commit({ tuned: { touched: Object.keys(preset.touch), values: { ...KNOB_DEFAULTS(), ...preset.touch } } })

/** 「恢复全部默认」：档位回标准 + 10 段样式全开 + 回到配色主题。 */
function resetAll() {
  // AI 署名也算「默认」的一部分：以前只清档位与分区，头像样式/名称/大小会留着。
  commit({
    sections: DEFAULT_SECTIONS(),
    tuned: { touched: [], values: KNOB_DEFAULTS() },
    avatar: AVATAR_STYLES[0].id,
    avatarName: DEFAULT_AVATAR_NAME,
    avatarSize: 36,
    petLayer: true,
  })
  if (state.enabled && !state.themePinned) {
    applyTheme()
  }
}

// ── 样式注入（一份 <style>：先组件样式，后档位覆盖 → 档位一定赢） ────────────
const TUNED_STYLE_ID = STYLE_ID + '-tuned'

function ensureStyleElement() {
  let element = document.getElementById(STYLE_ID)
  if (!element) {
    element = document.createElement('style')
    element.id = STYLE_ID
    document.head.appendChild(element)
  }
  return element
}

/** 档位覆盖单独一张表，永远排在静态表之后 —— 换档只重写这张（几百字节），
 *  不用把 65KB 的静态样式整张换掉（实测整张重写 1.18ms/次）。 */
function ensureTunedStyleElement() {
  const base = ensureStyleElement()
  let element = document.getElementById(TUNED_STYLE_ID)
  if (!element) {
    element = document.createElement('style')
    element.id = TUNED_STYLE_ID
    document.head.appendChild(element)
  } else if (base.nextElementSibling !== element) {
    // 静态表被重建 / 顺序被打乱时，把档位表挪回它后面
    document.head.appendChild(element)
  }
  return element
}

function tunedCss() {
  const declarations = []
  for (const knob of KNOBS) {
    if (!state.tuned.touched.includes(knob.key)) {
      continue
    }
    const value = state.tuned.values[knob.key]
    for (const [cssVar, write] of Object.entries(knob.vars)) {
      declarations.push(`  ${cssVar}: ${write(value)};`)
    }
  }
  if (declarations.length === 0) {
    return ''
  }
  const block = declarations.join('\n')
  return `/* 3. 档位覆盖 */\n:root {\n${block}\n}\n:root.dark {\n${block}\n}\n`
}

/* ── 统一层 ────────────────────────────────────────────────────────────────
   只收敛数值，不动结构。阴影两档（静态 sh-1 / 浮起 sh-2），
   选中态两种语言（导航类白玻璃 / 列表类 9% 主色）。
   注意：圆角不在这里统一 —— 统一成 8px 会让界面显得“方”，
   现有各处圆度（菜单 12 / 会话行 10 / 输入区 14 / 气泡 18）是刻意的层级。 */
const UNIFY_CSS = String.raw`
:root {
  --ui-r-ctl: 8px;
  --ui-r-row: 10px;
  --ui-r-box: 12px;
  --ui-sh-1: 0 1px 2px rgba(0, 0, 0, 0.045);
  --ui-sh-2: 0 6px 20px rgba(0, 0, 0, 0.075);
  --ui-select-glass: color-mix(in srgb, #fff 44%, transparent);
  --ui-select-glass-line: color-mix(in srgb, #000 4.5%, transparent);
  --ui-select-glass-top: inset 0 1px 0 color-mix(in srgb, #fff 40%, transparent);
}
/* 圆角·控件档 */
/* 阴影·浮起档 */
:root [role='dialog'],
:root [role='menu'],
:root [role='listbox'],
:root [data-radix-popper-content-wrapper] > * {
  box-shadow: var(--ui-sh-2) !important;
}
/* 选中态·导航类 = 白玻璃（一级菜单 / 档案按钮；两列 tab 已有同款） */
:root [data-slot='sidebar'] [data-sidebar='menu-button'][data-active='true'],
:root [data-slot='profile-rail'] button[aria-current='true'],
:root [data-slot='profile-rail'] button[data-active='true'] {
  background-color: var(--ui-select-glass) !important;
  border-color: var(--ui-select-glass-line) !important;
  box-shadow: var(--ui-select-glass-top) !important;
  color: var(--ui-text-primary) !important;
}
/* 选中态·列表类 = 9% 主色（会话行），圆角统一到行档 */
:root [data-sessions-mode] [data-slot='context-menu-trigger'],
:root [data-sessions-mode] [data-slot='context-menu-trigger'] > span,
:root [data-sessions-mode] [data-slot='context-menu-trigger'] > * {
  border-radius: var(--ui-r-row) !important;
}
/* 小字号：元信息与状态栏统一 11px，数字等宽 */
:root [data-slot='statusbar'],
:root [data-slot='statusbar'] * {
  font-size: 11px !important;
  font-variant-numeric: tabular-nums !important;
}
:root [data-sessions-mode] [data-slot='context-menu-trigger'] :is(time, small) {
  font-variant-numeric: tabular-nums !important;
}
/* 左列网格：菜单行 图标 14 + gap 6 + padding 8 → 文字 x=28，
   和会话行（pl-2 + 14px lead + gap-1.5）落在同一条竖线上。 */
:root [data-slot='sidebar'] [data-sidebar='menu-button'] {
  padding: 6px 8px !important;
  gap: 6px !important;
  min-height: 30px !important;
}
:root [data-slot='sidebar'] [data-sidebar='menu-button'] > *:first-child {
  width: 14px !important;
  height: 14px !important;
  min-width: 14px !important;
  flex: 0 0 14px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
}
/* 会话行元信息：数字等宽，右列不再左右跳 */
:root [data-sessions-mode] [data-slot='context-menu-trigger'] {
  font-variant-numeric: tabular-nums !important;
}
/* 图标线宽统一 1.7 */
:root [data-slot='button'] svg,
:root [data-slot='sidebar'] svg,
:root [data-slot='profile-rail'] svg,
:root [data-zone-tabstrip='grp-main'] svg {
  stroke-width: 1.7 !important;
}
`

/** 与分区无关、必须始终生效的几条。
    分区（SECTIONS）是当年还有分区开关时留下的：`sections[id] === false` 时整段 css
    不进样式表 —— 老存档里关过某段，新加的规则写在那一段里就会静默失效（这就是
    「未读点改了颜色却没变」的根因）。这类规则一律放这里。 */
const ALWAYS_CSS = `
/* 优化宠物层级：宠物从 z-index 60 降到 30，落在应用原有浮层（50）之下。
   只动宠物，不动浮层 —— 以前顺手把弹窗/菜单/遮罩一并抬到 70，结果对话框的
   遮罩和内容同为 70、按 DOM 顺序叠放，会话里的「更多」菜单和图片预览被自己
   那层遮罩盖住，点不动。降低一个元素永远比抬高一整堆安全。
   宠物本体没有 class / data-slot，只有内联 position:fixed + z-index:60。 */
:root[data-ui-pet-layer] div[style*="position: fixed"][style*="z-index: 60"] {
  z-index: 30 !important;
}

/* 会话状态点。应用里的点共用一个基类 size-1.5/size-1 + rounded-full，
   状态靠"额外类"区分，颜色全由类里的 token 派生，所以这里按 token/类名覆盖。

   语义（用户定的）：
     · 运行中的三档是"活的"，各用一个纯色实心、无描边 ——
       运行中 = 主色、安静运行 = 副色、后台任务 = 第三色（code）；
     · 未读是"这一轮已经出成果了"，不填色，只用中性墨描边（空心环）；
     · 草稿是弱化的空心环（四级墨，比未读细淡）；
     · 普通会话保持应用原来的灰点，不上色 —— 列表常态不该带颜色。 */

/* 侧栏里 --ui-accent 曾被压成中性墨（为压掉图标蓝），状态点派生自它会一起变灰 */
[data-slot='sidebar'] [role='status'] {
  --ui-accent: var(--acc-main, #0EA598);
}

/* 未读：无色填充 + 主色描边（空心环）。比其余空心态大一档，环也更实，
   因为它是"这一轮已经出成果了"，最该被看见，但又不该和"活的"三档抢实心。
   环厚用 border 1px + inset 0.5px 补：小元素上的 1.5px border 会被量化回 1px。

   四条都带 :not([data-slot])：档案条（profile-rail）嵌在 sidebar 里，它那个
   「未读会话」汇总点带 data-slot="profile-status-dot"，类名同样是
   size-1.5 rounded-full bg-(--ui-success)（[class*='size-1'] 连 size-1.5 一起命中）。
   会话行的点没有 data-slot。以前不加这个排除，档案方块上的未读点被这边的
   border 1px + 透明底吃成一条 2×16 的空心竖条，再被档案条的 grayscale 一滤，
   就成了「跟着档案按钮走的灰色小方块」。 */
[data-slot='sidebar'] span.rounded-full[class*='size-1'][class*='bg-(--ui-success)']:not([data-slot]) {
  background-color: transparent !important;
  width: 7px;
  height: 7px;
  border: 1px solid var(--acc-main, #0EA598) !important;
  box-shadow: inset 0 0 0 0.5px var(--acc-main, #0EA598) !important;
}

/* 安静运行（stalled）：副色实心，描边同色 = 看不见边框 */
[data-slot='sidebar'] span.rounded-full[class*='size-1'][class*='border-(--ui-accent)']:not([data-slot]) {
  background-color: var(--acc-alt, #7A66E0) !important;
  border-color: var(--acc-alt, #7A66E0) !important;
}

/* 会话行本身：相邻两行的"选中/运行中"底色贴在一起（列表没有行间距），
   两块色连成一片、看不出是两行。用 2px 透明上下边框 + background-clip: padding-box
   把底色往内收：行高不变（border-box），相邻两个高亮之间留出 4px 空隙。
   圆角同时从 rounded-md(6px) 提到 10px，与卡片/面板同一档。 */
[data-slot='sidebar'] .row-hover {
  border-top: 2px solid transparent;
  border-bottom: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 10px;
  /* 运行中的弧线（.arc-border.arc-row）贴着行边走，圆角靠变量与行同心 —— 改成 10px */
  --arc-radius: 10px;
}

/* 后台任务（turn 结束后仍在跑的终端）：第三色实心 */
[data-slot='sidebar'] span.rounded-full[class*='size-1'][class*='border-(--ui-text-tertiary)']:not([data-slot]) {
  background-color: var(--acc-code, #3E9BE0) !important;
  border-color: var(--acc-code, #3E9BE0) !important;
  box-shadow: none !important;
}



`

function cssText() {
  const parts = []
  if (state.enabled) {
    parts.push(ALWAYS_CSS.trim())
    for (const section of SECTIONS) {
      if (state.sections[section.id]) {
        parts.push(`/* 2. ui-studio · ${section.id} */\n${section.css.trim()}`)
      }
    }
    // 统一层放最后，保证同样的 !important 冲突时它赢
    parts.push(UNIFY_CSS.trim())
  }
  return parts.length > 0 ? `${parts.join('\n\n')}\n` : '/* 外观工坊：全部关闭 */\n'
}

// 滚动条的"滚动时淡入"：scroll 事件不冒泡，但能在捕获阶段收到所有滚动容器的滚动。
const SCROLL_LINGER_MS = 900
let scrollLingerTimer = null
let scrollBound = false

function onAnyScroll() {
  if (!state.enabled || !state.sections.system) {
    return
  }
  document.documentElement.classList.add('ui-scrolling')
  clearTimeout(scrollLingerTimer)
  scrollLingerTimer = setTimeout(() => {
    document.documentElement.classList.remove('ui-scrolling')
  }, SCROLL_LINGER_MS)
}

function bindScrollFade() {
  if (scrollBound) {
    return
  }
  document.addEventListener('scroll', onAnyScroll, { capture: true, passive: true })
  scrollBound = true
}

function unbindScrollFade() {
  if (!scrollBound) {
    return
  }
  document.removeEventListener('scroll', onAnyScroll, { capture: true })
  clearTimeout(scrollLingerTimer)
  document.documentElement.classList.remove('ui-scrolling')
  scrollBound = false
}

// 我们自己注册的主题（外壳那几套）。总开关关掉时要撤掉，否则 Appearance 列表里还挂着。
let pluginCtx = null
let disposeThemes = null

function dynamicContributions() {
  return [
    { id: 'theme', area: THEMES_AREA, data: APPLE_THEME },
    ...PALETTES.map(palette => ({
      id: `theme-${palette.id}`,
      area: THEMES_AREA,
      data: buildTheme(APPLE_THEME, {
        name: themeNameFor(palette.id, true),
        label: `外观优化 · ${palette.label}`,
        accent: palette.main,
      }),
    })),
  ]
}

function syncThemeRegistration() {
  if (!pluginCtx) return
  if (state.enabled && !disposeThemes) {
    disposeThemes = pluginCtx.registerMany(dynamicContributions()) || null
  } else if (!state.enabled && disposeThemes) {
    try {
      disposeThemes()
    } catch (err) {
      /* 撤注册失败不影响"样式退场" */
    }
    disposeThemes = null
  }
}

// 总开关关掉 = 和没装这个插件一样：样式表、主题、窗口透明、头像、根属性全部退场。
let releasing = false


function releaseEverything() {
  if (releasing) return
  releasing = true
  try {
    const root = document.documentElement
    const el = document.getElementById(STYLE_ID)
    if (el) el.remove()
    const tunedEl = document.getElementById(TUNED_STYLE_ID)
    if (tunedEl) tunedEl.remove()
    lastCss = ''
    lastTuned = ''
    lastAvatarKey = ''
    lastGlassKey = ''
    delete root.dataset.uiPalette
    delete root.dataset.uiSidebarTint
    delete root.dataset.uiAvatarOff
    delete root.dataset.uiPetLayer
    root.style.removeProperty('--ui-avatar-size')
    root.style.removeProperty('--radius-scalar')
    clearAvatar()
    unbindScrollFade()
    // 窗口透明：我们把原生材质改成磨砂过，就把它改回 clear；没动过就只摘自己的属性
    if (state.glass && state.glass.enabled) applyGlass({ ...state.glass, enabled: false })
    else {
      root.removeAttribute('data-hermes-glass-on')
      root.removeAttribute('data-hermes-glass')
      root.removeAttribute('data-hermes-glass-scope')
      root.style.removeProperty('--translucency-glass-keep')
      root.style.removeProperty('--glass-rail-edge')
    }
    // 外壳主题如果被我们锁过，放开并切回去；然后把自己注册的主题撤掉（Appearance 列表里就不再有它们）
    if (state.themePinned) restoreTheme()
    syncThemeRegistration()
  } finally {
    releasing = false
  }
}

function paint() {
  const root = document.documentElement
  if (!state.enabled) {
    releaseEverything()
    return
  }
  syncThemeRegistration()
  bindScrollFade()
  root.dataset.uiPalette = state.palette
  // 优化宠物层级：宠物降到普通板块层，浮层抬到它之上
  if (state.petLayer !== false) root.dataset.uiPetLayer = '1'
  else delete root.dataset.uiPetLayer

  // 头像：只有跟头像有关的项变了才去翻整页消息（以前每动一个开关都扫一遍）
  const avatarKey = [state.showAvatar !== false, state.avatar, state.avatarName, state.avatarSize].join('|')
  if (avatarKey !== lastAvatarKey) {
    lastAvatarKey = avatarKey
    root.style.setProperty('--ui-avatar-size', (state.avatarSize || 36) + 'px')
    if (state.showAvatar === false) {
      root.dataset.uiAvatarOff = '1'
      clearAvatar()
    } else {
      delete root.dataset.uiAvatarOff
      syncAvatar()
    }
  }

  // 窗口透明：同样只在设置真的变了才去碰原生材质
  const glassKey = JSON.stringify(state.glass || null)
  if (glassKey !== lastGlassKey) {
    lastGlassKey = glassKey
    applyGlass(state.glass)
  }

  const nextCss = cssText()
  if (nextCss !== lastCss) {
    ensureStyleElement().textContent = nextCss
    lastCss = nextCss
    // 静态表重建后，档位表要重新排到它后面
    lastTuned = ''
  }
  const nextTuned = tunedCss() || '/* 档位：全标准，无需覆盖 */\n'
  if (nextTuned !== lastTuned) {
    ensureTunedStyleElement().textContent = nextTuned
    lastTuned = nextTuned
  }
  // 配色或「应用到其他板块」变了 → 外壳主题跟着换（用户已放手主题时不抢）。
  if (state.enabled && state.themePinned) {
    const wanted = desiredThemeName()
    if (appliedTheme && appliedTheme !== wanted) {
      applyTheme({ silent: true, name: wanted })
    }
  }
}

// ── 主题动作 ─────────────────────────────────────────────────────────────────
let appliedTheme = null
let lastCss = ''
let lastTuned = ''
let lastAvatarKey = ''
let lastGlassKey = ''

function desiredThemeName() {
  return themeNameFor(state.palette, state.sections.shell !== false)
}

function applyTheme({ silent = false, name = desiredThemeName() } = {}) {
  if (requestTheme(name)) {
    appliedTheme = name
    commit({ themePinned: true })
    return true
  }
  if (!silent) {
    host.notify({ kind: 'error', message: '配色主题没能切换（主题名未注册？）；样式部分仍然生效。' })
  }
  return false
}

function restoreTheme() {
  const known = [THEME_NAME, ...PALETTES.map(palette => themeNameFor(palette.id, true))]
  const target =
    state.previousTheme && !known.includes(state.previousTheme) ? state.previousTheme : FALLBACK_THEME
  appliedTheme = null
  commit({ themePinned: false })
  if (!requestTheme(target)) {
    host.notify({ kind: 'warning', message: `没能切回「${target}」，可在 Settings ▸ Appearance 里手动选。` })
  }
}

function enable() {
  commit({ enabled: true })
  if (!state.themePinned) {
    applyTheme()
  }
}

function disable() {
  const wasPinned = state.themePinned
  commit({ enabled: false, themePinned: false })
  flushPersist()
  if (wasPinned) {
    restoreTheme()
  }
}

// ── 面板 ─────────────────────────────────────────────────────────────────────

// 面板分区：标题 + 内容，外框统一（以前这套 div 在面板里重复了 7 遍）
function Section({ title, children }) {
  return jsxs('div', {
    className: 'flex flex-col gap-2 pt-1',
    children: [jsx(Heading, { children: title }), ...(Array.isArray(children) ? children : [children])],
  })
}

// 档位行：几个固定选项，不做连续滑杆 —— 拖滑杆每动一格都要重写整张样式表，
// 而且用户要的本来就是「紧一点/标准/松一点」这种判断。
function StepRow({ label, hint, steps, value, onChange }) {
  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsx('span', {
        className: 'text-xs text-(--dt-foreground)',
        title: hint,
        children: label,
      }),
      jsx('div', {
        className: 'flex gap-1',
        children: steps.map(step =>
          jsx(
            Choice,
            {
              label: step.label,
              title: hint,
              active: Math.abs(Number(value) - step.value) < 0.001,
              onClick: () => onChange(step.value),
            },
            label + ':' + step.value,
          ),
        ),
      }),
    ],
  })
}

function StepKnob({ knob }) {
  const live = useSyncExternalStore(subscribe, read, read)
  return jsx(StepRow, {
    label: knob.label,
    hint: knob.hint,
    steps: knob.steps,
    value: live.tuned.values[knob.key],
    onChange: next => setKnob(knob.key, next),
  })
}

function toggleGlass(enabled) {
  const next = { ...state.glass, enabled }
  writeTranslucencyBook({ scope: next.scope, material: next.material, intensity: next.intensity }, enabled ? 'glass' : 'clear')
  commit({ glass: next, glassTouched: true })
}

function patchGlass(patch) {
  const next = { ...state.glass, ...patch }
  writeTranslucencyBook({ scope: next.scope, material: next.material, intensity: next.intensity }, 'glass')
  commit({ glass: next, glassTouched: true })
}

function SwitchRow({ label, note, checked, onChange, strong }) {
  // 关掉时整行文字压暗 + 标一个「关」，一眼能看出这块样式现在是不生效的。
  return jsxs('label', {
    className: 'flex cursor-pointer items-start justify-between gap-3 py-0.5',
    children: [
      jsxs('span', {
        className: 'flex min-w-0 flex-col',
        children: [
          jsxs('span', {
            className: strong
              ? checked
                ? 'text-[0.8125rem] font-semibold text-(--dt-foreground)'
                : 'text-[0.8125rem] font-semibold text-(--dt-muted-foreground)'
              : checked
                ? 'text-xs text-(--dt-foreground)'
                : 'text-xs text-(--dt-muted-foreground)',
            children: [label, itemsOffMarker(checked)],
          }),
          note
            ? jsx('span', {
                className: checked
                  ? 'text-[0.625rem] leading-snug text-(--dt-muted-foreground)'
                  : 'text-[0.625rem] leading-snug text-(--dt-muted-foreground) opacity-60',
                children: note,
              })
            : null,
        ],
      }),
      jsx(Switch, { checked: checked, onCheckedChange: onChange }),
    ],
  })
}

function itemsOffMarker(checked) {
  return checked ? null : jsx('span', { className: 'ml-1 text-[0.625rem]', children: '（关）' })
}

// 选中态必须一眼看出来：填主色 + 白字 + 字重 600。
// 之前只用描边换色，--dt-primary 在某些上下文里取不到值，结果选没选中看不出来。
function Choice({ active, label, title, onClick }) {
  return jsx('button', {
    type: 'button',
    title: title,
    'aria-pressed': active ? 'true' : 'false',
    className:
      'flex-1 rounded-sm border px-2 py-1 text-[0.6875rem] transition-colors ' +
      (active
        ? 'border-transparent'
        : 'border-(--dt-border) text-(--dt-muted-foreground) hover:bg-(--chrome-action-hover)'),
    style: active
      ? {
          background: 'var(--dt-primary, #5B6CFF)',
          color: 'var(--dt-primary-foreground, #fff)',
          fontWeight: 600,
        }
      : undefined,
    onClick: onClick,
    children: label,
  })
}

// 分类标题：居中，左右各一条发丝线把这一组框住。原来只有 10px 灰字，
// 挤在选项里认不出来；现在 12px/600 + 两条线，组与组的分界靠它，不再另画 border。
function Heading({ children }) {
  return jsxs('div', {
    className: 'flex items-center gap-2 pt-1',
    children: [
      jsx('span', { className: 'h-px flex-1', style: { background: 'var(--dt-border)' } }),
      jsx('span', {
        style: {
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          color: 'color-mix(in srgb, var(--dt-foreground) 68%, transparent)',
          whiteSpace: 'nowrap',
        },
        children: children,
      }),
      jsx('span', { className: 'h-px flex-1', style: { background: 'var(--dt-border)' } }),
    ],
  })
}

function Panel({ variant } = {}) {
  const live = useSyncExternalStore(subscribe, read, read)
  // variant='wide' 是给「设置 › 外观」页用的：那里是一整栏，不要固定 288px 宽、不要自带滚动。
  const wide = variant === 'wide'
  const typeKnobs = KNOBS.filter(knob => knob.key !== 'bubbleMax')
  const mineKnobs = KNOBS.filter(knob => knob.key === 'bubbleMax')

  return jsxs('div', {
    className: wide
      ? 'flex w-full flex-col gap-3'
      : 'flex max-h-[70vh] w-72 flex-col gap-3 overflow-y-auto pr-1',
    children: [
      // 1. 总开关 + 恢复默认：两者都是「整套」级别的操作，放在同一个板块里
      jsxs('div', {
        className: 'flex flex-col gap-1',
        children: [
          jsx(SwitchRow, {
            label: '启用外观优化',
            // 不能写成「SF 字体」：macOS 上 Hermes 默认的 --dt-font-sans 就是
            // 'Segoe WPC','Segoe UI',-apple-system,… —— 前两个在 macOS 上不存在，
            // 实际落到 -apple-system = SF。所以正文本来就是这个字体，写「换成 SF」
            // 是假承诺；真正变的是等宽（默认首选 app 自带的 JetBrains Mono，本皮肤
            // 改成 SF Mono）、行高 1.45（默认 1.5）、字距 -0.006em（默认 0）。
            note: '系统配色与字体',
            strong: true,
            checked: live.enabled,
            onChange: () => (live.enabled ? disable() : enable()),
          }),
          jsxs('div', {
            className: 'flex items-center justify-between gap-3 pt-0.5',
            children: [
              jsx('p', {
                className: 'text-[0.625rem] leading-snug text-(--dt-muted-foreground)',
                children: '蓝点 = 改过的值',
              }),
              jsx('button', {
                type: 'button',
                className:
                  'rounded-sm px-1.5 py-0.5 text-[0.6875rem] text-(--dt-muted-foreground) ' +
                  'hover:bg-(--chrome-action-hover) hover:text-(--dt-foreground)',
                onClick: () => resetAll(),
                children: '恢复默认',
              }),
            ],
          }),
        ],
      }),

      // 2. 配色：一套同时管正文强调色和气泡色
      jsxs(Section, {
        title: '配色',
        children: [          jsx('div', {
            className: 'flex gap-1',
            children: PALETTES.map(palette =>
              jsx(
                Choice,
                {
                  label: palette.label,
                  active: live.palette === palette.id,
                  onClick: () => commit({ palette: palette.id }),
                },
                palette.id
              )
            ),
          }),
        ],
      }),

      // 3. 窗口透明：直接读写官方同名设置（scope / material / intensity 三档）
      jsxs(Section, {
        title: '窗口透明',
        children: [          glassSupported()
            ? jsxs('div', {
                className: 'flex flex-col gap-1',
                children: [
                  jsx(SwitchRow, {
                    label: '透明背景',
                    note: '系统原生磨砂 · 桌面透出',
                    checked: live.glass.enabled,
                    onChange: () => toggleGlass(!live.glass.enabled),
                  }),
                  live.glass.enabled
                    ? jsxs('div', {
                        className: 'flex flex-col gap-1',
                        children: [
                          jsx('span', { className: 'text-xs text-(--dt-foreground)', children: '范围' }),
                          jsx('div', {
                            className: 'flex gap-1',
                            children: [
                              jsx(Choice, { label: '仅侧栏', active: live.glass.scope === 'sidebar', onClick: () => patchGlass({ scope: 'sidebar' }) }, 'sidebar'),
                              jsx(Choice, { label: '整个窗口', active: live.glass.scope === 'window', onClick: () => patchGlass({ scope: 'window' }) }, 'window'),
                            ],
                          }),
                          jsx('span', { className: 'text-xs text-(--dt-foreground)', children: '强度' }),
                          jsx('div', {
                            className: 'flex gap-1',
                            children: [{ label: '淡', value: 25 }, { label: '中', value: 45 }, { label: '浓', value: 65 }].map(step =>
                              jsx(Choice, { label: step.label, active: Math.abs(live.glass.intensity - step.value) <= 6, onClick: () => patchGlass({ intensity: step.value }) }, 'int' + step.value)
                            ),
                          }),
                        ],
                      })
                    : null,
                ],
              })
            : jsx('span', { className: 'text-[0.625rem] leading-snug text-(--dt-muted-foreground)', children: '这台机器不支持系统材质，这一组已跳过。' }),
        ],
      }),

      // 4. 排版：三组档位
      jsxs(Section, {
        title: '排版',
        children: [          ...typeKnobs.map(knob => jsx(StepKnob, { knob }, knob.key)),
        ],
      }),

      // 4b. AI 署名：头像样式 + 名称
      jsxs(Section, {
        title: 'AI 署名',
        children: [          jsx(SwitchRow, {
            label: '显示头像与名称',
            note: '关掉只留正文',
            checked: live.showAvatar !== false,
            onChange: () => commit({ showAvatar: live.showAvatar === false }),
          }),
          // 关掉「显示头像与名称」时这几个子项一起收起（与「窗口透明」同一套做法）
          live.showAvatar !== false
            ? jsxs('div', {
                className: 'flex flex-col gap-2',
                children: [
                  jsx('div', {
                    className: 'flex gap-1',
                    children: AVATAR_STYLES.map(style =>
                      jsx(
                        Choice,
                        {
                          label: style.label,
                          active: live.avatar === style.id,
                          onClick: () => commit({ avatar: style.id }),
                        },
                        style.id
                      )
                    ),
                  }),
                  jsxs('div', {
                    className: 'flex flex-col gap-1',
                    children: [
                      jsxs('div', {
                        className: 'flex items-baseline justify-between gap-3',
                        children: [
                          jsx('span', { className: 'text-xs text-(--dt-foreground)', children: '名称' }),
                          jsx('span', {
                            className: 'font-mono text-[0.625rem] tabular-nums text-(--dt-muted-foreground)',
                            children: (live.avatarName || DEFAULT_AVATAR_NAME).length + '/24',
                          }),
                        ],
                      }),
                      jsx('input', {
                        type: 'text',
                        value: live.avatarName || DEFAULT_AVATAR_NAME,
                        maxLength: 24,
                        placeholder: '显示名称',
                        onChange: event => commit({ avatarName: String(event.target.value).slice(0, 24) }),
                        className:
                          'w-full rounded-sm border border-(--dt-border) bg-transparent px-2 py-1 ' +
                          'text-xs text-(--dt-foreground) outline-none focus:border-(--dt-muted-foreground)',
                      }),
                    ],
                  }),
                  jsx(StepRow, {
                    label: '头像大小',
                    hint: '雪碧图不用重做，像素级缩放',
                    steps: [
                      { value: 36, label: '小 36' },
                      { value: 42, label: '中 42' },
                      { value: 48, label: '大 48' },
                    ],
                    value: live.avatarSize || 36,
                    onChange: value => commit({ avatarSize: value }),
                  }),
                ],
              })
            : null,
        ],
      }),

      // 5. 我的消息：最大宽度
      jsxs(Section, {
        title: '我的消息',
        children: [          ...mineKnobs.map(knob => jsx(StepKnob, { knob }, knob.key)),
        ],
      }),

      // 5.5 宠物：只控制层级
      jsxs(Section, {
        title: '宠物',
        children: [          jsx(SwitchRow, {
            label: '优化宠物层级',
            note: '宠物降到和普通会话同一层，设置、弹窗、菜单都能盖住它',
            checked: live.petLayer !== false,
            onChange: value => commit({ petLayer: value }),
          }),
        ],
      }),

    ],
  })
}

function Trigger() {
  return jsxs(Popover, {
    children: [
      jsx(PopoverTrigger, {
        asChild: true,
        children: jsx('button', {
          type: 'button',
          title: '外观优化',
          className:
            'inline-flex h-full items-center gap-1.5 px-1.5 text-[0.6875rem] ' +
            'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground',
          children: [
            jsx('span', {
              className: 'inline-block size-1.5 shrink-0 rounded-full',
              style: {
                background: state.enabled ? APPLE_BLUE : 'transparent',
                boxShadow: state.enabled ? 'none' : 'inset 0 0 0 1px rgba(127,127,127,.55)',
              },
            }),
            '外观',
          ],
        }),
      }),
      jsx(PopoverContent, { align: 'end', side: 'top', className: 'w-auto p-3', children: jsx(Panel, {}) }),
    ],
  })
}

// ── 插件入口 ─────────────────────────────────────────────────────────────────

// ── 临时诊断探针（查完即删）：把侧栏圆点的实测值 POST 到本机 8791 收集器 ──────
// 打包版没有 CDP 端口，只能从渲染进程内部量。只读不写 DOM。
export default {
  id: 'ui-studio',
  name: '外观工坊',
  description: '外观优化 + 观感调节，一个面板管完；开启后状态栏「外观」或 ⌘K 打开，关掉后从「设置 › 外观」底部开启。',
  register(ctx) {
    pluginCtx = ctx
    persist = next => ctx.storage.set(STORAGE_KEY, next)
    const stored = ctx.storage.get(STORAGE_KEY, null)
    state = sanitize(stored)
    if (!stored) {
      const book = readTranslucencyBook()
      if (book) {
        const values = { ...(book.base || {}), ...(book.light || {}) }
        state = sanitize({ ...state, glass: { enabled: book.mode === 'glass', scope: values.scope, material: values.material, intensity: values.intensity } })
      }
    }
    snapshot = clone(state)

    // 关着的时候连样式表都不建：启动瞬间不该闪一下我们的皮肤
    if (state.enabled) ensureStyleElement()
    paint()
    bindScrollFade()
    startAvatar()

    ctx.onDispose(() => {
      // 卸载/热更：走和「总开关关掉」同一条退场路径，别只清一半属性
      flushPersist()
      releaseEverything()
      if (disposeThemes) {
        try { disposeThemes() } catch (err) {}
        disposeThemes = null
      }
      pluginCtx = null
      persist = () => {}
    })

    ctx.registerMany([
      // 状态栏「外观」入口：**永远注册**。它是重新打开总开关的唯一入口之一，
      // 关掉总开关时不能跟着消失（否则就只能去改配置文件了）。
      { id: 'chip', area: STATUSBAR_AREAS.right, order: 87, render: () => jsx(Trigger, {}) },
      // 同一套开关/档位也出现在「设置 › 外观」页底部（app 的 appearance.extra 插槽）
      { id: 'settings', area: 'appearance.extra', render: () => jsx(Panel, { variant: 'wide' }) },
      {
        id: 'apply',
        area: PALETTE_AREA,
        data: {
          id: 'ui-studio.apply',
          label: '外观: 打开外观优化',
          detail: () => '切换配色主题 + 打开组件样式',
          keywords: ['apple', 'macos', '皮肤', '外观', '苹果', '主题', 'skin'],
          run: () => enable(),
        },
      },
      {
        id: 'disable',
        area: PALETTE_AREA,
        data: {
          id: 'ui-studio.disable',
          label: '外观: 关掉，恢复 Hermes 原样',
          detail: () => '移除样式并还原原主题',
          keywords: ['apple', 'macos', '皮肤', '外观', '还原', '关闭', 'skin'],
          run: () => disable(),
        },
      },
      {
        id: 'palette',
        area: PALETTE_AREA,
        data: {
          id: 'ui-studio.palette',
          label: '外观: 切换配色方案（薄荷 → 天空 → 丁香）',
          detail: () => `当前：${(PALETTES.find(palette => palette.id === state.palette) ?? PALETTES[0]).label}`,
          keywords: ['apple', 'palette', '配色', '气泡'],
          run: () => commit({ palette: PALETTES[(PALETTES.findIndex(palette => palette.id === state.palette) + 1) % PALETTES.length].id }),
        },
      },
      ...PRESETS.map(preset => ({
        id: `preset.${preset.id}`,
        area: PALETTE_AREA,
        data: {
          id: `ui-studio.preset.${preset.id}`,
          label: `外观: 疏密「${preset.label}」`,
          detail: () => preset.note,
          keywords: ['外观', '疏密', '间距', preset.id, preset.label],
          run: () => applyPreset(preset),
        },
      })),
      {
        id: 'reset',
        area: PALETTE_AREA,
        data: {
          id: 'ui-studio.reset',
          label: '外观: 恢复全部默认',
          detail: () => '档位回标准 + 10 段样式全开',
          keywords: ['外观', '重置', 'reset', 'default', '默认'],
          run: () => resetAll(),
        },
      },
    ])

    // 启动时重新接管配色：本插件的主题贡献注册得比 ThemeProvider 恢复「上次选的
    // 主题」更晚，所以启动那一刻 apple 可能还解析不到，主题就静默回落到默认皮肤
    // （实测撞到过：重启后状态栏 accent 又变回 nous 的 #0053FD）。这里补一次无声
    // 接管；用户想放手，在面板里点「还原原主题」即可（themePinned=false）。
    if (state.enabled && state.themePinned) {
      applyTheme({ silent: true, name: desiredThemeName() })
    }

    // 首次装载（还没有存档）：说明怎么还原——否则用户只会看到「什么都没发生」。
    if (state.enabled && !stored) {
      host.notify({
        kind: 'info',
        message: '外观优化已应用。状态栏「外观」可调，也可一键恢复原样。',
      })
    }
  },
}

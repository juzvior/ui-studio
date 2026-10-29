# 外观工坊（ui-studio）

Hermes 桌面应用的外观插件：配色、字号/疏密/圆角/气泡宽度/头像大小、侧栏与档案栏观感、头像状态动画、窗口材质、宠物层级，全部收在「设置 › 外观」一个面板里。

插件是单个 `plugin.js`（约 375 KB，纯 ESM，无构建步骤、无外部资源，内联 15 张 base64 图）。

> **这是 AI 写的插件。**
> 代码由 Hermes Agent 在真实使用中反复改出来的，直接把本机跑着的那一份开源。
> 作者**随缘更新**，不承诺维护节奏，**不处理 issue / PR**。装、改、fork 自便，别指望有人回。

## 安装

**一行命令（推荐）**

```bash
mkdir -p ~/.hermes/desktop-plugins/ui-studio && curl -fsSL \
  https://raw.githubusercontent.com/juzvior/ui-studio/main/plugin.js \
  -o ~/.hermes/desktop-plugins/ui-studio/plugin.js
```

然后应用内按 `⌘K` → **Reload desktop plugins**（或重启应用）。

**手动方式**

1. 建目录 `~/.hermes/desktop-plugins/ui-studio/`
2. 把 `plugin.js` 放进去
3. `⌘K` → **Reload desktop plugins**

**应用内安装**

Capabilities → Plugins → 用 Git 地址 `https://github.com/juzvior/ui-studio` 安装（会先探测仓库、锁定 commit，再复制到 `~/.hermes/desktop-plugins/`）。

> 注意：`hermes plugins install <url>` 只处理「智能体插件」（需要 `plugin.yaml`），装不了只有桌面半身的插件，别用那条。

升级就是把新的 `plugin.js` 覆盖进去再 Reload；插件本身不含任何自更新代码。

## 使用

应用内打开 **设置 › 外观**：顶部是配色（薄荷 / 天空 / 丁香）与预设，下面按板块给档位（疏密、字号、圆角、气泡最大宽度、头像大小），再往下是头像动画、窗口材质、宠物层级等开关。所有改动即时生效、自动保存；底部可一键恢复默认，或关掉总开关回到应用原样。

## 兼容性

样式是按 Hermes 桌面应用当前的 `data-slot` 结构与设计变量写的。应用大版本升级若改动这些结构，个别板块可能失效；总开关关掉即可完全还原，不会残留。

## 目录

```
ui-studio/
├── plugin.js    # 插件本体（Appearance 面板 + 样式注入 + 主题注册）
├── README.md
└── LICENSE      # MIT
```

## 许可

MIT（见 `LICENSE`）。随意使用、修改、再分发。

## 说明

- 不修改应用源码，也不写任何应用文件；所有样式都在运行时注入，总开关关掉即完全还原。
- 存档保存在 Hermes 的插件 storage 里，换机器不会带过去。
- 你踩到的适配问题大概率我这边也在踩，但**不保证修、也不回 issue**。想改直接 fork，MIT 随你怎么改。

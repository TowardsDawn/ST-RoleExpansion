# ST-RoleExpansion（角色扩展）

**一套持续完善的模块化、可扩展的ST扩展插件**

![version](https://img.shields.io/badge/version-0.12.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![SillyTavern](https://img.shields.io/badge/SillyTavern-%E2%89%A5%201.18.0-8A2BE2)
![node](https://img.shields.io/badge/node-%E2%89%A5%2018-339933)
[![smoke-test](https://github.com/TowardsDawn/ST-RoleExpansion/actions/workflows/smoke-test.yml/badge.svg)](https://github.com/TowardsDawn/ST-RoleExpansion/actions/workflows/smoke-test.yml)

---

## 这是什么

| 模块 | 它做什么 | 文档 |
| --- | --- | --- |
| 👕 **衣装打扮** | 维护「现在穿什么」：七个**固定分类**（头饰 / 上衣 / 下装 / 袜子 / 鞋子 / 内衣 / 内裤）+ 自建分类，每个分类一个备选表（**英文逗号**分隔）、**分类内可多选（叠穿）**；外 / 内两组还能把整套搭配存成**套装**（同组互斥、与散装并存）；选中的衣装按 外 / 内 / 其他 三行分组注入后续对话，让模型的描写保持一致 | [modules/outfit/README.md](modules/outfit/README.md) |
| ❤️ **角色状态栏** | 维护一组状态（`生命值 8/10`、`好感度 42`…），每次生成前自动注入；模型回复里的 `<名称>值</名称>` 会被解析、更新并从正文剥离 | [modules/state/README.md](modules/state/README.md) |
| 📔 **日记** | 勾选若干聊天楼层 → 模型以角色第一人称写一篇日记 → 存成按会话隔离的 `.jsonl`；勾选任意几篇注入后续对话，成为角色「记得的事」 | [modules/journal/README.md](modules/journal/README.md) |
| 🐦 **推特** | 面板里是一张自包含的**仿推特页面**（**固定高度**：资料头钉住不动、只有推文列表内部滚）：头像 / 横幅 / 资料区由你编辑，推文正文由模型用 `<推文>…</推文>` 输出（也可以手动新增 / 编辑 / 置顶）；**点推文能进详情页**；媒体支持本地配图与 **URL 视频 / 动图**；`关注`/`🔄`/`❤️`/`🔖` 可交互并落盘 | [modules/twitter/README.md](modules/twitter/README.md) |

**四个模块共用一个面板**，入口是顶部工具栏的**羽毛图标**（世界书与用户设置之间）。

### 设计原则：扩展只当「内容供应商」，预设完全归你管

日记与衣装注入走的是酒馆原生的**有序提示词**机制（只有这两个模块用这条通道；状态栏走 `setExtensionPrompt()`，推特模块不注入任何提示词） —— 预设里放一张 `marker: true` 卡片，
它的位置、名字、启停全都在酒馆预设 UI 里管；扩展只**读**它，负责在每次生成时喂正文。

另外，状态栏与衣装各自有一个**「纳入世界书扫描」**开关（默认关，需要 `st-wi-scan-source.patch`）：
打开后同一份正文除了进提示词，还作为世界书扫描的目标文本 —— 写在状态名 / 衣装 tag 上的关键词
就能触发对应的世界书条目。它**不占提示词位置、也不经过注入通道**，只在扫描那一刻取正文。

- 不创建、不修改、不移动预设卡片
- 不调用 `/api/presets/save`，不碰你的预设文件
- 你在预设 UI 里拖位置、改名字、开关它 —— 扩展全程配合，绝不还原

### ⚠️ 一个前提：需要给 ST 打一次补丁

原版酒馆有四件事第三方扩展做不到，本扩展因此附带**四份极小的补丁**（都只做新增与放行判断，不改动原生行为）：

| 补丁 | 解决什么 | 不打会怎样 |
| --- | --- | --- |
| `patches/st-marker-prompt.patch`（净新增约 151 行） | 运行时提示词源是硬编码的，第三方 marker 卡片没有编辑铅笔、没有启停开关 | 卡片上没开关和铅笔，日记与衣装注入不生效 |
| `patches/st-journal-store.patch`（净新增约 131 行） | 没有接口能让前端写进 `chats/<角色>/`，日记没地方按角色存放 | 日记整块不可用（面板红字提示缺补丁） |
| `patches/st-twitter-assets.patch`（净新增约 182 行） | 模块需要往自己的子目录里放文件（推特的 jsonl + 头像 + 横幅 + 本地配图、**衣装的 jsonl**）；端点的子目录白名单必须是 `['twitter', 'outfit']` | 推特整块不可用（面板红字提示缺补丁）；衣装也读写不了 |
| `patches/st-wi-scan-source.patch`（净新增 44 行 / 删 1 行） | 世界书扫描只认 `extensionPrompts` 里 `scan=true` 的条目，而扩展注册的运行时正文源不在那张表里 | 状态栏与衣装面板里的「纳入世界书扫描」勾选框变灰不可用（面板会写明缺哪一枚，不静默） |

**装好扩展 ≠ 装好了**，四份补丁都需要你自己 `git apply` 一次（见[打补丁（必须）](#打补丁必须)）。

---

## 目录

- [特性](#特性)
- [环境要求](#环境要求)
- [安装](#安装)
  - [装扩展](#装扩展) ｜ [打补丁（必须）](#打补丁必须) ｜ [写预设卡片](#写预设卡片日记模块用) ｜ [验证一下](#验证一下)
- [快速开始](#快速开始)
- [界面导览](#界面导览)
- [核心机制](#核心机制)
- [模块](#模块)
- [调试与自测](#调试与自测)
- [常见问题](#常见问题)
- [已知限制](#已知限制)
- [仓库结构](#仓库结构)
- [开发说明](DEVELOPMENT.md)（面向开发者 / 接手的人）
- [许可](#许可)
## 特性

**框架**

- 纯前端、无构建步骤、无依赖：原生 ESM，丢进扩展目录就能跑
- 一个面板管所有模块：顶部羽毛图标 → 抽屉式主面板（宽度取 `--sheldWidth`、高度到输入框上方）
- **四个模块都是可拆模块**（`outfit` / `state` / `journal` / `twitter`）：删掉 `modules/<id>/` 整个目录（甚至全删），
  框架照常启动；文件在时也可以在「扩展」设置面板里单独**禁用**（刷新页面生效）。
  名录由 `modules/manifest.json` 驱动 —— 加一个模块只要放好目录 + 改这个 JSON，框架里没有任何模块名
- 模块全拿掉时：面板显示「没有可用模块」并列出两种可能（目录被删 / 被禁用），副标题变「（无模块）」，
  「扩展」设置面板里只剩框架自己的东西 —— 不会出现「空白面板 + 永远检测中」的假故障
- 「存为默认设置」/「恢复默认设置」统一管**所有模块的设置项**（快照存进酒馆的扩展设置，重启仍在）
- 配套离线自测（最小 DOM / ST 桩，**771 项断言**）+ 三份补丁自测的 e2e，CI 对 Node 18 / 20 / 22 各跑一遍

**模块**（各自成文）（按主面板里的区块顺序排列 = `modules/manifest.json` 的 `modules[]` 顺序）

| 模块 | 一句话 | 文档 |
| --- | --- | --- |
| 👕 衣装打扮 | 固定分类 + 自建分类，每个分类一个逗号分隔的备选表；**分类内多选（叠穿）**，选中的衣装按 外 / 内 / 其他 分组注入后续对话 | [modules/outfit/README.md](modules/outfit/README.md) |
| ❤️ 角色状态栏 | 维护一组状态，生成前自动注入；回复里的 `<名称>值</名称>` 被解析、更新并从正文剥离 | [modules/state/README.md](modules/state/README.md) |
| 📔 日记 | 勾选楼层 → 模型以角色第一人称写一篇日记 → 按会话存成 jsonl → 勾选任意几篇注入后续对话 | [modules/journal/README.md](modules/journal/README.md) |
| 🐦 推特 | 固定高度的仿推特页面（资料头固定、只滚推文列表）：资料区自己编辑、推文由模型输出、**点推文进详情页**、媒体支持本地配图与 URL 视频 / 动图、`关注`/`🔄`/`❤️`/`🔖` 可点并落盘；置顶最多一条，时间线新→旧 | [modules/twitter/README.md](modules/twitter/README.md) |

---

## 环境要求

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| SillyTavern | **≥ 1.18.0** | 开发与验证版本。前三枚补丁的上下文行号以 1.18.0 的 `openai.js` / `PromptManager.js` / `st-context.js` / `server-startup.js` 为基线（**四枚补丁在 1.18.0（`51ad27fb8`）与 1.19.0（`7e8663cd9`）的纯净检出上都复验过**：`git apply` 干净落地（1.19.0 上零偏移、结果文件与 1.18.0 一致；1.18.0 上新补丁带 -2 / -112 行偏移，它与其余三枚顺序无关、放最前或最后都行）），换版本前先 `git apply --check` |
| ST 接口 | Chat Completion 类 | 卡片与提示词管理器依赖 Chat Completion；文本补全类接口下面板会提示「尚未就绪」 |
| ST 补丁 | **必须应用一次** | 见下方第 2 步 |
| Node.js | ≥ 18（**仅自测需要**） | 扩展本身在浏览器里跑，装插件不需要 Node |

ST 升级或重装会覆盖 `public/scripts/*.js`，**补丁需要重新应用**。

---

## 安装

### 装扩展

把整个 `ST-RoleExpansion` 文件夹放到下列任一位置：

```text
仅当前用户：<ST>/data/<你的用户名>/extensions/ST-RoleExpansion/
所有用户　：<ST>/public/scripts/extensions/third-party/ST-RoleExpansion/
```

用 git 安装（便于后续更新）：

```bash
cd <ST>/data/<你的用户名>/extensions
git clone https://github.com/TowardsDawn/ST-RoleExpansion.git ST-RoleExpansion
```

刷新酒馆页面，在「扩展」列表里确认 **角色扩展 (Role Expansion)** 已启用。

### 打补丁（必须）

在 **ST 根目录**（含 `public/` 的那一层）执行：

```bash
git apply /path/to/ST-RoleExpansion/patches/st-marker-prompt.patch
git apply /path/to/ST-RoleExpansion/patches/st-journal-store.patch
git apply /path/to/ST-RoleExpansion/patches/st-twitter-assets.patch
git apply /path/to/ST-RoleExpansion/patches/st-wi-scan-source.patch
```

> ⚠️ **前三枚有先后**：`st-twitter-assets.patch` 锚定 `st-journal-store.patch` 往 `server-startup.js` 里加的那行 import，
> 两者**不能反**。第四枚 `st-wi-scan-source.patch` 只碰 `public/scripts/`，与它们互不干扰 —— 放最前或最后都行，
> 而且**它不用重启酒馆主进程**，`Ctrl+F5` 即可（另外两枚改了服务端，打完要重启）。

第一个补丁做了五件事（细节见[核心机制](#核心机制)）：

1. `openai.js`：新增 `registerRuntimePromptSource()` 与三张注册表；
2. `openai.js`：构建 `systemPrompts` 时合并这些运行时源，并把它们排除在通用扩展 prompt 覆盖循环之外；
3. `openai.js`：在 `populateChatCompletion()` 里把注册的 identifier **真正加进 `chatCompletion`**；
4. `PromptManager.js`：放行这些卡片的编辑与启停，`handleInspect` 增加即时预览兜底；
5. `st-context.js`：把 `registerRuntimePromptSource` 与 `promptManager` 挂到 `getContext()`。

> 第 3 条与第 5 条最容易漏，症状也最迷惑 —— 见[常见问题](#常见问题)。

第二个补丁（`st-journal-store.patch`）只做两件事：新增 `src/endpoints/role-expansion.js`
（日记读写端点，写进 `chats/<角色>/_RoleExpansion/journals/`，带路径穿越防护与原子写），
并在 `src/server-startup.js` 挂一行 `app.use('/api/role-expansion', …)`。

第三个补丁（`st-twitter-assets.patch`）也是纯新增：`src/endpoints/role-expansion-assets.js`
（模块私有资源读写：文本 + base64 图片，带子目录 / 扩展名白名单、路径穿越双保险与体积上限），
并在 `src/server-startup.js` 再挂一行。它的子目录白名单是 **`['twitter', 'outfit']`** ——
推特与衣装两个模块共用这一份端点，各写自己的子目录。

第四份补丁（`st-wi-scan-source.patch`）同样只做新增，而且**只碰前端**：在 `world-info.js` 里加一张
`extensionScanSources` 注册表（`registerWorldInfoScanSource(key, getText)` / `unregisterWorldInfoScanSource(key)`），
`checkWorldInfo()` 扫描时把每个源的正文并进世界书扫描的 haystack；`st-context.js` 把这两个函数挂到 `getContext()`。
它解决的是「扩展注入的正文扫不到」—— 状态栏与衣装的「纳入世界书扫描」开关靠它，缺它时那两个勾选框是灰的。
**它不经过任何注入通道**，所以打开扫描不会让同一段正文在提示词里出现两次。

> ⚠️ **从旧版升级上来的人（0.9.0 及更早）**：白名单那一行是从 `['twitter']` 改成 `['twitter', 'outfit']` 的
> **同行替换、不增删行**，所以补丁文件本身能 `git apply --check` 干净通过，但
> **`src/endpoints/role-expansion-assets.js` 在你机器上已经存在**，重新 `git apply` 那份补丁会失败（`already exists`）。
> 正确做法是**手动改那一行**：打开 `<酒馆>/src/endpoints/role-expansion-assets.js`，
> 把 `const ALLOWED_SUBDIRS = ['twitter'];` 改成 `const ALLOWED_SUBDIRS = ['twitter', 'outfit'];`，
> 存档后**重启酒馆主进程**。不改也能用其它三个模块，但衣装的读写会全部被服务端以 **400** 拒掉
> —— 表现与「缺补丁」**同级**：衣装面板**状态行红字**（文案直接告诉你改 `ALLOWED_SUBDIRS` 并重启酒馆）、
> 两栏置灰，写盘会弹同一条提示；控制台记一行
> `probe outfit storage: 服务端拒绝了 outfit 路径（invalid-path / 400）—— 资源端点的白名单里没有 outfit。`
> **改完那一行之后怎么让它生效**：探针每个页面只**认真探一次**并缓存结果，所以
> - 若你是在**页面已经打开着**的情况下补的补丁 / 改的白名单 → **重启酒馆主进程后再刷新页面（F5）**，
>   或者**关掉再重新打开一次「角色扩展」面板**（后者有 3 秒节流，且只在失败态下才会真的重探）；
> - **面板一直开着不动时不会自动恢复** —— 这是刻意的粒度选择（失败态不轮询），必须重新打开面板或刷新页面。

> ⚠️ 后两个补丁改的是**服务端**代码，打完必须**重启 ST 主进程**（不像前端 `scripts/*.js` 那样
> `Ctrl+F5` 就能重载）。没打补丁不会静默出错：对应模块的面板会红字写明缺哪个补丁。

也可以按补丁内容手动改那几个文件。打完补丁后 **`Ctrl+F5` 强制刷新**（浏览器会缓存 `scripts/*.js`）。

### 写预设卡片（日记模块用）

日记与衣装注入走酒馆原生的**有序提示词**：预设里各放一张 `marker: true` 卡片（标识分别是
`roleExpansionJournal` 与 `roleExpansionOutfit`），它们的位置、名字、启停全在预设 UI 里管，
扩展只**读**它们、并在每次生成时喂正文。要写入的 JSON 片段、`prompt_order` 每个块都要加一条的注意事项、
以及 `examples/preset.example.json` 怎么用，都在 [modules/journal/README.md](modules/journal/README.md)；
衣装那份在 [modules/outfit/README.md](modules/outfit/README.md)。

### 验证一下

刷新后打开控制台：

```js
roleExpansion.logMarkerSupport()
```

看到「ST 补丁已生效」即安装完成。然后去预设 UI 确认那两张卡片（日记 / 衣装）**有开关、有铅笔**。

---

## 快速开始

1. 打开顶部工具栏的**羽毛图标**（世界书与用户设置之间）。
2. 面板里是**若干个可折叠区块** —— 默认四块：**衣装打扮**、**角色状态栏**、**日记**、**推特**
   （衣装与推特两块横跨整行，推特在最下面）。
3. 各自的完整用法（假的推特页面怎么用、怎么生成日记、状态怎么写、衣装与套装怎么选、有哪些开关与坑）见模块文档：
   [modules/outfit/README.md](modules/outfit/README.md) ｜ [modules/state/README.md](modules/state/README.md) ｜
   [modules/journal/README.md](modules/journal/README.md) ｜ [modules/twitter/README.md](modules/twitter/README.md)。
   本文只讲框架与安装。

---

## 界面导览

| 入口 | 说明 |
| --- | --- |
| 顶部工具栏羽毛图标 | 主入口，位于「世界书 World Info」与「用户设置 User Settings」之间 |
| 主面板 | 与「世界书」同款的**下拉面板**：紧贴工具栏居中，宽度取 `--sheldWidth`，高度到输入框上方 |
| 「角色管理」面板 | 角色卡编辑区中 `Chat Lore` 按钮右侧的羽毛按钮，一键打开面板 |
| 「扩展」设置面板 | 「模块」表（装了哪些 / 启用禁用）、**各模块自己挂进来的设置区块**、「打开角色扩展面板」「存为默认设置」「恢复默认设置」都在这里 |

面板里是**若干个可折叠区块**：一个模块挂一块（默认四块：衣装打扮 / 角色状态栏 / 日记 / 推特；**顺序就是 `modules/manifest.json` 里 `modules[]` 的顺序**。衣装与推特两块由模块自己加 `roleEx-span-all` 横跨整行 —— 衣装在最上面那条整行，推特在最下面独占最后一行），每块内部还有自己的子区块。
模块不在时那一块就不存在 —— 不会留下空壳，也不会出现「永远检测中」的假故障。

主面板与各区块的 UI 约定（折叠箭头语义、过渡动画、两列布局、面板层级）见 [DEVELOPMENT.md](DEVELOPMENT.md) §4。
### 「存为默认设置」/「恢复默认设置」

| 按钮 | 做什么 |
| --- | --- |
| **存为默认设置** | 把**当前全部设置**（框架的 + 所有已装模块的设置项）存成新的基准。快照存在酒馆的扩展设置里，重启仍在 |
| **恢复默认设置** | 恢复到当前基准 —— 没存过 = 扩展内置默认；存过 = 你那份快照 |

- 两个按钮下方那行提示会告诉你**当前基准是哪一个**（内置值 / 你的快照）。
- 「恢复默认设置」**只动设置**，不碰日记文件（`chats/<角色>/_RoleExpansion/journals/*.jsonl`）与当前会话的状态列表。
- 想回到出厂值：控制台执行 `roleExpansion.clearCustomDefaults()`，再点一次「恢复默认设置」。
- 两者都**没有二次确认**；重置后主面板里的输入框仍显示旧值，**刷新页面**才完全同步。

---

## 核心机制

### 运行时提示词源

`marker: true` 的语义是「正文不来自预设，而由运行时按 identifier 提供」——
`World Info (after)` 就是这样：预设里只有 `{ "marker": true }`，
运行时由 `preparePromptsForChatCompletion` 推入 `{ identifier: 'worldInfoAfter', content: formatWorldInfo(...) }`。

原版 ST 的这份运行时列表是**硬编码**的，扩展无法加入自己的 identifier；
更麻烦的是它还有两处硬编码的**只读名单**，这就是第三方 marker 卡片「既没有开关、也没有编辑铅笔」的原因：

```js
// PromptManager.js
isPromptEditAllowed(prompt)   // forceEditPrompts   = charDescription/charPersonality/scenario/personaDescription/worldInfoBefore/worldInfoAfter
isPromptToggleAllowed(prompt) // forceTogglePrompts = 上面那几个 + main/chatHistory/dialogueExamples
// marker 卡片不在名单里 → 开关被禁用；不在 promptSources 里 → 编辑弹窗显示「无法在此处编辑」
```

补丁打开这条路之后，扩展侧只需一行（**已内置，你不需要写代码**）：

```js
ST_API.registerRuntimePromptSource('roleExpansionJournal', () => 当前勾选日记拼成的文本, {
    name: '角色扩展（日记）',   // 显示在卡片「正文来源」处，同时让卡片可编辑
    edit: true,                 // 允许编辑（铅笔 → 名称/身份/触发器/位置 + Prompt List 预览）
    toggle: true,               // 允许用卡片上的开关启停
});
```

衣装模块用的是同一条通道、同一个形状，只是 `identifier` 换成 `roleExpansionOutfit`、来源名换成 `角色扩展（衣装）`。

<details>
<summary><b>补丁的五处改动，以及各自缺失时的症状</b></summary>

1. **`openai.js`**：新增 `runtimePromptSources` / `extensionPromptSources` / `runtimePromptPermissions`
   注册表与 `registerRuntimePromptSource(identifier, getContent, { name, edit, toggle })`。

2. **`openai.js`**：构建 `systemPrompts` 时合并这些运行时源；并把这些 identifier
   **排除**在通用的「扩展 prompt 覆盖循环」之外，避免顶掉世界书等内容。

3. **`openai.js`**：在 `populateChatCompletion()` 里把注册的 identifier **真正加进 `chatCompletion`**
   （`for (const identifier of runtimePromptSources.keys()) await addToChatCompletion(identifier)`）。
   原版这里只有一串**硬编码**的 identifier（`worldInfoBefore/main/worldInfoAfter/charDescription/…`），
   漏了这一步，扩展卡片**即使成功取到正文也永远注入不进去** —— 症状是
   「Prompt List 里能看到日记正文，但生成时并没有它，卡片 token 数也一直是 `-`」。
   跳过逻辑由 `addToChatCompletion` 自己兜住：卡片 `enabled=false` → 跳过；
   卡片不在任何 `prompt_order` 块 → 跳过；正文为空 → 聚合阶段就不 push → 跳过。

4. **`PromptManager.js`**：`isPromptEditAllowed` / `isPromptToggleAllowed` 放行已注册的 identifier，
   并在「正文来源」处显示扩展提供的来源名；`handleInspect` 增加兜底 —— 当该条目还不在
   `promptManager.messages` 里（刚启动、或当前没有可注入内容所以被跳过）时，
   按需调 `getRuntimePromptPreviewSource()` 现场构建一份预览，**保证 Prompt List 一定能打开**。
   这份兜底预览会用 tokenizer 按**真实正文**算 token（空内容 = `Tokens: 0`，非空 = 实际数量）。

   > 为什么要兜底：`promptManager.messages` **只在构建过一次请求后才填充**，且**内容为空的条目会被跳过**，
   > 所以原版在刚启动、或当前没有可注入内容时点卡片名不会有反应（内置的 `World Info (after)` 也一样）。
   > 有了这段兜底，**任何时候点卡片名都能打开 Prompt List**，不需要先生成一次。

5. **`st-context.js`**：
   - 把 `registerRuntimePromptSource` 挂到 `getContext()` 上，让扩展能调用；
   - **把 `promptManager` 以 getter 形式暴露到 `getContext()`**（原版没有导出它，
     扩展读不到预设里的提示词/顺序，卡片逻辑会整体失效）。用 getter 是因为
     `promptManager` 在 `setupChatCompletionPromptManager()` 里才被赋值，
     直接取值会在早期拿到 `null` 并永久固化。

> ⚠️ **第 3 条与第 5 条的第二项都不能漏**。少了第 3 条，卡片虽然能显示正文却注入不进去
> （症状：Prompt List 里看得到日记，生成时却没有它，卡片右侧一直是 `-`）；
> 少了第 5 条的第二项，扩展读不到预设，`diagnoseJournalCard()` 会返回 `promptManagerExposed: false`。
> 两种情况都只需重新 `git apply` 并 `Ctrl+F5`。

**⏱️ 时序坑（扩展侧必须做两件事）**

酒馆是在 Chat Completion 初始化时（`setupChatCompletionPromptManager()` → `promptManager.render()`）
渲染预设列表的，**渲染那一刻**就决定了卡片有没有开关与铅笔。而初见顺序是：

```text
initOpenAI()        ← 里面就 setupChatCompletionPromptManager() → 预设列表【第一次渲染】
initExtensions()    ← 扩展脚本此刻才被求值、才注册运行时源
```

也就是说**第一次渲染永远早于扩展注册**。只做「模块求值阶段注册」是不够的，
表现成**「不打开任何会话就看不到铅笔和开关，随便打开一个会话它们又出现了」**
（列表只在 `CHAT_LOADED` / 发消息 / 切预设等事件里才重渲染）。

本扩展因此做两件事：

1. 在 `bootstrap()` 一开始就注册运行时源（未就绪则按 250ms 重试）；
2. 注册成功后**主动补一次列表渲染**（`patchPromptManagerFirstRender()` → `promptManager.render(false)`，
   纯展示、不写预设），并在 1.5s 后复查那一行的 DOM，仍缺控件才再补一次（有上限，不会反复重绘）。

</details>

### 只读契约（重要）

| 状态 | 扩展的行为 |
| --- | --- |
| `prompts` 里没有该 identifier | **什么都不做**，面板提示你需要写入的 JSON 片段 |
| `prompt_order` 里没有该条目 | **什么都不做**（卡片不会生效，面板显示「🔴 已停用」） |
| 卡片已存在 | 只**读**它的形态与 `enabled`；不增删字段、不改位置、不改开关 |
| 任何时候 | **不调用** `/api/presets/save`，不写入预设文件 |

**预设完全归你管，扩展只是这张卡片的一个「内容供应商」。**

「是否注入主聊天」这件事**只有预设卡片一个开关**（刻意不提供第二个开关）：开关打开 → 扩展提供正文、正常注入；
关闭 → 运行时源返回空串、不注入，面板显示「🔴 已停用（不注入）」；扩展**绝不擅自改回**你的选择。
这套契约对**日记与衣装两张卡片同时成立**；具体到各卡片的行为与诊断输出，见
[modules/journal/README.md](modules/journal/README.md) 与 [modules/outfit/README.md](modules/outfit/README.md)。

---

## 模块

一个模块 = `modules/<id>/` 一个目录，自带文档、可单独拆掉（下表按主面板里的区块顺序）：

| 模块 | id | 目录 | 用户文档 | 开发文档 |
| --- | --- | --- | --- | --- |
| 👕 衣装打扮 | `outfit` | `modules/outfit/` | [README](modules/outfit/README.md) | [DEVELOPMENT](modules/outfit/DEVELOPMENT.md) |
| ❤️ 角色状态栏 | `state` | `modules/state/` | [README](modules/state/README.md) | [DEVELOPMENT](modules/state/DEVELOPMENT.md) |
| 📔 日记 | `journal` | `modules/journal/` | [README](modules/journal/README.md) | [DEVELOPMENT](modules/journal/DEVELOPMENT.md) |
| 🐦 推特 | `twitter` | `modules/twitter/` | [README](modules/twitter/README.md) | [DEVELOPMENT](modules/twitter/DEVELOPMENT.md) |

### 装上 / 拆掉 / 禁用

| 想要 | 怎么做 |
| --- | --- |
| 拆掉某个模块 | 删掉它的整个目录（`modules/outfit/`、`modules/state/`、`modules/journal/` 或 `modules/twitter/`），刷新页面 |
| 临时不要某个模块 | 「扩展」设置面板 →「模块」区块里取消勾选（**刷新页面生效**） |
| 全部拆掉 | 插件照常启动：面板显示「没有可用模块」，副标题「（无模块）」 |
| 排查 | `roleExpansion.modules()` → 每个模块的 `installed`（目录在不在）/ `enabled`（启没启用）/ `title` |

### 自己接一个模块

1. 建 `modules/<你的 id>/index.js`，`export default` 一个描述符：`{ id, title, icon, defaults?, create(kernel) }`，
   **可选能力写在 `create(kernel)` 返回的那个对象上**（`buildPanelSection()` / `settingsBlock(kernel)` / `services`，
   以及**预留、框架目前不读**的 `debug` —— 全仓没有任何 `desc.debug` 的读取代码）；
   `settingsBlock` 早期写在描述符上的写法框架仍然兼容，但新代码请写在返回值上；
2. 在 `modules/manifest.json` 的 `modules` 数组里加一条 `{ id, path: "./<你的 id>/index.js", title, icon }`（`path` 相对清单文件）；
3. 框架启动时 `fetch` 清单并 `import` 你的入口 —— **框架里没有任何模块名**，不需要改 `index.js`。

模块可用的框架设施（`create(kernel)` 拿到的 `kernel`）、返回值约定（框架转发壳按同名调用）、
启用开关、清单缺省与降级规则见 [DEVELOPMENT.md](DEVELOPMENT.md) §1.1。

---

## 调试与自测

### 控制台 API（框架侧）

```js
roleExpansion.settings             // 当前设置（只读引用）
roleExpansion.ui                   // 共享运行时状态：各模块把运行时事实放在这里
roleExpansion.modules()            // 模块清单：installed / enabled / title / icon
roleExpansion.moduleManifest()     // 清单本身：URL、是否降级、条目
roleExpansion.openPanel()          // 打开面板
roleExpansion.toggleDrawerState()  // 开/关本抽屉（自带「打开一个时收起其他未锁定的」）
roleExpansion.layoutMainPanel()    // 重算面板位置与高度（改窗口 / 改 --sheldWidth 后手动补一次）
roleExpansion.applyPanelPin()      // 不带参数 = 从扩展设置的独立键读回锁定状态并应用一次
roleExpansion.saveAsDefaults()     // =「存为默认设置」
roleExpansion.resetToDefaults()    // =「恢复默认设置」
roleExpansion.clearCustomDefaults()// 清除自定义基准，回到扩展内置默认
roleExpansion.logMarkerSupport()   // 运行时提示词源（补丁）是否生效
roleExpansion.patchPromptManagerFirstRender() // 手动补一次预设列表首屏渲染（幂等，不写预设）
// —— 落盘：能不能写 / 写到哪 / 为什么不能（排查「写不进去」的第一步）——
roleExpansion.journalAvailability()  roleExpansion.journalPathText()  roleExpansion.journalReasonText()
roleExpansion.probeJournalStorage()  // 只读探针：真去读写一次，报回结果
roleExpansion.assetPathText()        roleExpansion.probeAssetStorage('twitter')
                                     // 衣装用同一个探针：probeAssetStorage('outfit')
// —— 模块桥接（模块不在 / 被禁用时是空壳：调用返回 undefined，不抛）——
roleExpansion.reloadTwitter()  roleExpansion.renderTwitter()  roleExpansion.describeTwitter()
roleExpansion.toggleTweetAction(id, 'like' | 'retweet' | 'bookmark')  roleExpansion.toggleTwitterFollow()
roleExpansion.reloadOutfit()   roleExpansion.renderOutfit()    roleExpansion.ensureOutfitRuntimeSource()
roleExpansion.adoptOutfitCardStateFromPreset()  roleExpansion.updateOutfitPresetCardHint()
```

各模块自己的调试入口（日记的 `probeJournalStorage()` / `diagnoseJournalCard()`、状态的 `getStateList()`、
衣装的 `ensureOutfitRuntimeSource()` …）写在各自模块文档的「调试入口」一节。

### 自测脚本

```bash
npm test            # = node tools/smoke-test.mjs —— 771 项断言，纯 Node，不需要浏览器/酒馆
npm run test:patch  # 三份补丁自测的 e2e：从 patches/*.patch 抽端点在 express 沙盒里真跑（26 + 42 + 92 项）
```

没有依赖，`node` 直接跑即可；`smoke-test.mjs` 会读取仓库自带的 `examples/preset.example.json`
（找不到时回退到开发机上仓库上一级的 `test.json`）。同一套自测在 CI 里对 Node 18 / 20 / 22 各跑一遍
（[`.github/workflows/smoke-test.yml`](.github/workflows/smoke-test.yml)）。

`test:patch` 需要酒馆根目录里的 `node_modules`（默认取开发机路径，或用 `ST_DIR` 指定），
找不到就打 `SKIP` 退出 0，所以 CI 上不跑也没关系。

覆盖范围：框架部分（面板结构 / 层级 / 折叠语义 / 模块系统 / 清单驱动 / 默认值快照 / 补丁文本）+
各模块自己的断言（见模块 DEVELOPMENT 的「自测覆盖」）。
## 常见问题

<details open>
<summary><b>卡片上没有启停开关 / 没有编辑铅笔</b></summary>

**分两步看，别混**（这是两件不同的事）：

1. **权限**：`roleExpansion.logMarkerSupport()` 或 `diagnoseJournalCard().patch`
   → 任一为 `false` 说明补丁没生效。重新
   `git apply patches/st-marker-prompt.patch`，然后 **`Ctrl+F5`**（浏览器缓存了 `scripts/*.js`）。
2. **渲染时机**：`diagnoseJournalCard().controls` 或 `probeCardControls()`
   → `patch` 全 `true` 但 `controls.edit/toggle` 为 `false`，说明是首屏渲染时机问题（补丁没问题）。
   执行 `roleExpansion.patchPromptManagerFirstRender()`，或点一下预设里的卡片即可恢复；
   `controls.listRendered: false` 表示预设列表还没渲染（当前不是 Chat Completion 类接口）。

</details>

<details>
<summary><b>卡片的 token 数一直是 <code>-</code>，而 Char Description 有数字</b></summary>

补丁少了「把运行时源真正 add 进 `chatCompletion`」那一段 —— 正文取到了却没被送出去。
重新 `git apply` 补丁即可。详见[核心机制](#核心机制)里补丁第 3 条。

</details>

<details>
<summary><b>面板提示「ST 补丁为旧版」</b></summary>

`getContext().promptManager` 不存在，说明补丁没有完整应用 —— 缺了 `st-context.js` 里
把 `promptManager` 以 getter 暴露出来的那一段。重新应用补丁并 `Ctrl+F5`。

</details>

<details>
<summary><b>日记写不出来 / 面板红字说缺补丁</b></summary>

缺 `patches/st-journal-store.patch`（服务端代码，打完要**重启酒馆主进程**），或者当前是群聊。
两种情况面板都会红字写明原因；**「还没选角色」不算出错**（面板只给一句中性提示，不打红字、不弹 Toast）。
细节见 [modules/journal/README.md](modules/journal/README.md)。

</details>

<details>
<summary><b>衣装面板红字说缺补丁，但我明明打过 <code>st-twitter-assets.patch</code></b></summary>

0.10.0 起那个端点的子目录白名单是 `['twitter', 'outfit']`。**从旧版升级上来的人**要手动改这一行：
打开 `<酒馆>/src/endpoints/role-expansion-assets.js`，把 `const ALLOWED_SUBDIRS = ['twitter'];`
改成 `const ALLOWED_SUBDIRS = ['twitter', 'outfit'];`，然后**重启酒馆主进程**。
**不要**重新 `git apply` 那份补丁 —— 那个文件已经存在，会以 `already exists` 失败。
细节见[打补丁](#打补丁必须)。

</details>

<details>
<summary><b>ST 升级后一切失效</b></summary>

升级/重装会覆盖 `public/scripts/*.js`（以及可能被覆盖的 `src/`），四份补丁都需要重新 `git apply`，
然后 `Ctrl+F5`（改了服务端那份还要重启酒馆）。

</details>

模块自身的问题（日记被写成剧情推进、状态标签不生效…）在各自模块 README 的「常见问题」里。
## 已知限制

- **预设卡片需要你手动维护**（刻意的取舍：扩展不碰预设文件）。片段见模块文档；
  改完记得在预设下拉里重新选一次该预设。
- 如果卡片上看不到启停开关与编辑铅笔，多半是浏览器还在用缓存的旧 `scripts/*.js`：
  确认补丁已应用后 **`Ctrl+F5`**；用 `roleExpansion.logMarkerSupport()` 可确认。
- **本扩展面板是抽屉栈的最底层**：它比 `#top-settings-holder`(3005) 低（z-index 3000），
  所以任何一个展开的顶部抽屉（世界书、扩展设置、用户设置…）都会**盖住**面板 ——
  这是刻意的（反过来会让别家面板用不了）。锁定（🔒）只表示「打开别的抽屉时不自动关闭本面板」，
  不改变层级。想继续用面板，把盖住它的抽屉关掉、或把面板锁上后重新点一次羽毛图标即可。
  **锁定状态会被记住**：F5 / Ctrl+F5 / 重启酒馆之后仍是锁定的（和酒馆自己的抽屉锁定一样）；
  它存在扩展设置的独立键里，所以「恢复默认设置」不会顺手解锁 —— 要解锁就自己点一下 🔒。
- 顶部工具栏图标间距由本扩展的 CSS 统一归一：各入口的 `.drawer-icon` 左右内边距归零，
  间距完全交给 `--roleEx-topbar-gap`（默认 26px）。图标是 32px 等宽，所以
  **中心间距 = 32 + gap ≈ 58px**；想更紧/更松只改这一个变量（`18px` 约 50px / `34px` 约 66px）。
  该规则带 `:has(.roleEx-top-drawer)` 守卫，只在扩展已装载时生效，并附
  `@supports not selector(:has(*))` 兜底。
- 本扩展只走 `getContext()` 暴露的接口，**不依赖任何后端 server plugin**；
  需要服务端配合的只有两处落盘（日记 jsonl、模块私有资源文件），分别由 `patches/st-journal-store.patch`
  与 `patches/st-twitter-assets.patch` 提供。
- **模块自己的限制写在模块文档里**：衣装（群聊不支持、**只有单向注入**、固定分类不可改名删除、**
  套装只属于外 / 内两组且同组互斥**、没有导入导出…）见
  [modules/outfit/README.md](modules/outfit/README.md)；推特（群聊不支持、FLV 与 URL 媒体有约束、数字没有范围校验…）见
  [modules/twitter/README.md](modules/twitter/README.md)；日记（群聊不支持、改名边界、隔离通道的推理剥块只认成块写法…）见
  [modules/journal/README.md](modules/journal/README.md)；状态（标签准入规则、新聊天状态为空…）见
  [modules/state/README.md](modules/state/README.md)。

---

## 仓库结构

```text
ST-RoleExpansion/
├── manifest.json                     酒馆扩展清单（名称 / 版本 / 加载顺序 / 最低客户端版本）
├── index.js                          框架：设置 / 抽屉与主面板 / 扩展设置面板 / 模块系统
├── modules/                          **整个目录可以删**（见「模块」）
│   ├── manifest.json                 模块清单（加/删模块只改这里 + 目录，不用动框架）
│   ├── outfit/                       衣装打扮模块（清单第一条 → 主面板最上面那块）
│   │   ├── README.md / DEVELOPMENT.md    本模块的用户文档 / 开发文档
│   │   └── index / store / inject / ui .js
│   ├── state/                        角色状态栏模块
│   │   ├── README.md / DEVELOPMENT.md
│   │   └── index / store / inject / ui .js
│   ├── journal/                      日记模块
│   │   ├── README.md / DEVELOPMENT.md
│   │   └── index / storage / floors / generate / inject / ui .js
│   └── twitter/                      推特模块
│       ├── README.md / DEVELOPMENT.md
│       └── index / store / stats / capture / render / ui .js
├── index.html                        酒馆「扩展」列表里的设置卡片模板（框架部分；模块自己往里挂区块）
├── style.css                         全部样式（统一 roleEx- 前缀）
├── patches/                          对 ST 核心的四份最小补丁（见「打补丁」）
│   ├── st-marker-prompt.patch        运行时提示词源 + marker 卡片权限
│   ├── st-journal-store.patch        日记文件读写端点
│   ├── st-twitter-assets.patch       模块私有资源（文本 + 图片）读写端点（子目录白名单 twitter / outfit）
│   └── st-wi-scan-source.patch       世界书扫描源注册表（模块正文可被世界书扫到）
├── tools/
│   ├── smoke-test.mjs                离线自测（最小 DOM / ST 桩，771 项断言）
│   ├── patch-endpoint-test.mjs       日记端点 e2e（express 沙盒，可选）
│   ├── patch-asset-test.mjs          资源端点 e2e（同上）
│   ├── patch-wiscan-test.mjs         世界书扫描源补丁：纯 LF / 可应用 / 与其余三枚顺序无关（可 SKIP）
│   └── check-filename.mjs            文件名合规校验器
├── examples/
│   └── preset.example.json           参考预设（含日记卡片，可直接导入酒馆）
├── .github/workflows/smoke-test.yml  CI：Node 18 / 20 / 22 各跑一遍自测
├── README.md                         本文：框架 / 安装 / 机制
├── DEVELOPMENT.md                    框架开发说明：架构 / 补丁 / UI 约定 / 踩坑
├── CHANGELOG.md
├── LICENSE
└── .editorconfig / .gitattributes / .gitignore / package.json
```

---

## 许可

[MIT](LICENSE) © 2026 TowardsDawn

> `patches/*.patch` 是针对 SillyTavern 本体（AGPL-3.0）源码的 diff，
> 其中含有少量上下文行。SillyTavern 本体不在本仓库内，请按其自身许可获取。

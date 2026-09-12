# ST-RoleExpansion（角色扩展）

**给 SillyTavern 加上「日记」与「角色状态栏」。**

让角色把经历过的事写成日记，并在之后的对话里记得；让生命值、好感度这类数值随剧情自动变化，
而不是你手动维护。

![version](https://img.shields.io/badge/version-0.3.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![SillyTavern](https://img.shields.io/badge/SillyTavern-%E2%89%A5%201.18.0-8A2BE2)
![node](https://img.shields.io/badge/node-%E2%89%A5%2018-339933)
[![smoke-test](https://github.com/TowardsDawn/ST-RoleExpansion/actions/workflows/smoke-test.yml/badge.svg)](https://github.com/TowardsDawn/ST-RoleExpansion/actions/workflows/smoke-test.yml)

---

## 这是什么

| 模块 | 它做什么 |
| --- | --- |
| 📔 **日记** | 勾选若干聊天楼层 → 模型以角色第一人称写一篇日记 → 存成按会话隔离的 `.jsonl`。勾选任意几篇，它们就会被注入后续对话，成为角色「记得的事」。支持导出 / 导入 / 编辑 / 删除 |
| ❤️ **角色状态栏** | 维护一组状态（`生命值 8/10`、`好感度 42`…），每次生成前自动注入；模型回复里的 `<名称>值</名称>` 会被解析、更新数值，并从正文里剥离 |

两个模块共用一个面板，入口是顶部工具栏的**羽毛图标**（世界书与用户设置之间）。

### 设计原则：扩展只当「内容供应商」，预设完全归你管

日记注入走的是酒馆原生的**有序提示词**机制 —— 预设里放一张 `marker: true` 卡片，
它的位置、名字、启停全都在酒馆预设 UI 里管；扩展只**读**它，负责在每次生成时喂正文。

- 不创建、不修改、不移动预设卡片
- 不调用 `/api/presets/save`，不碰你的预设文件
- 你在预设 UI 里拖位置、改名字、开关它 —— 扩展全程配合，绝不还原

### ⚠️ 一个前提：需要给 ST 打一次补丁

原版酒馆的「运行时提示词源」是硬编码的，第三方扩展无法加入自己的 identifier，
于是第三方 marker 卡片既没有编辑铅笔、也没有启停开关。本扩展因此附带一份**极小的补丁**
（`patches/st-marker-prompt.patch`，约 162 行，只做新增与放行判断，不改动原生行为）。

**装好扩展 ≠ 装好了**，补丁需要你自己 `git apply` 一次（见[打补丁（必须）](#打补丁必须)）。
未打补丁的症状非常具体：卡片上没有开关和编辑铅笔，日记注入不生效。

---

## 目录

- [特性](#特性)
- [环境要求](#环境要求)
- [安装](#安装)
  - [装扩展](#装扩展) ｜ [打补丁（必须）](#打补丁必须) ｜ [写预设卡片](#写预设卡片) ｜ [验证一下](#验证一下)
- [快速开始](#快速开始)
- [界面导览](#界面导览)
- [核心机制](#核心机制)
- [日记模块](#日记模块)
- [角色状态栏](#角色状态栏)
- [调试与自测](#调试与自测)
- [常见问题](#常见问题)
- [已知限制](#已知限制)
- [仓库结构](#仓库结构)
- [许可](#许可)

---

## 特性

**日记**

- 自由勾选参考楼层：逐条勾、快捷「最近 10 楼」、或按区间「第 N ~ M 楼」（0 起、两端都含，反向填写自动交换）
- 标题由模型随正文生成（`<title>` / `# 标题` / `【标题】` / `标题：…` 四种形式都能解析），也可以自己填、随时编辑
- 一篇日记 = jsonl 里的一行，天然独立，不会以「续写」形式黏在上一篇后面
- 按会话隔离：换角色、换存档互不干扰；文件名带会话 hash，真实角色名/会话名记在文件首行
- 导入 / 导出 / 单篇导出 / 编辑 / 删除，都是 jsonl，随时备份
- 主提示词完全可改，支持 `{{chatRange}}` / `{{journalRefs}}` / `{{stateList}}` 与酒馆宏

**角色状态栏**

- 状态列表增删改、批量添加、逐项编辑、清空、复制为文本、从剪贴板导入
- 发送前自动注入（深度与角色可调，模板可改）
- 自动解析回复里的 `<名称>值</名称>`、更新数值、并从正文剥离
- 按会话隔离，随聊天记录一起保存

**工程上的取舍**

- 纯前端、无构建步骤、无依赖：原生 ESM，丢进扩展目录就能跑
- 不依赖任何后端 server plugin；日记落盘走酒馆自带的 `/api/files` 接口
- 配套一份离线自测（最小 DOM / ST 桩，**200 项断言**），CI 对 Node 18 / 20 / 22 各跑一遍

---

## 环境要求

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| SillyTavern | **≥ 1.18.0** | 开发与验证版本。补丁的上下文行号以 1.18.0 的 `openai.js` / `PromptManager.js` / `st-context.js` 为基线，换版本前请先确认它能 `git apply` |
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
```

补丁做了五件事（细节见[核心机制](#核心机制)）：

1. `openai.js`：新增 `registerRuntimePromptSource()` 与三张注册表；
2. `openai.js`：构建 `systemPrompts` 时合并这些运行时源，并把它们排除在通用扩展 prompt 覆盖循环之外；
3. `openai.js`：在 `populateChatCompletion()` 里把注册的 identifier **真正加进 `chatCompletion`**；
4. `PromptManager.js`：放行这些卡片的编辑与启停，`handleInspect` 增加即时预览兜底；
5. `st-context.js`：把 `registerRuntimePromptSource` 与 `promptManager` 挂到 `getContext()`。

> 第 3 条与第 5 条最容易漏，症状也最迷惑 —— 见[常见问题](#常见问题)。

也可以按补丁内容手动改那三个文件。打完补丁后 **`Ctrl+F5` 强制刷新**（浏览器会缓存 `scripts/*.js`）。

### 写预设卡片

在你要用的**预设 JSON** 里加两处（`examples/preset.example.json` 就是照这个形态写好的，可直接导入或照抄）：

```jsonc
// 1) prompts 数组里追加一条 —— 四个字段就够，与 World Info (after) 同形
{
    "identifier": "roleExpansionJournal",
    "name": "日记（角色扩展）",
    "system_prompt": true,
    "marker": true
}
```

```jsonc
// 2) prompt_order 里【每个 character_id 块】都要加一条，位置建议紧跟 worldInfoAfter
{ "identifier": "worldInfoAfter",       "enabled": true },
{ "identifier": "roleExpansionJournal", "enabled": true },
{ "identifier": "dialogueExamples",     "enabled": true }
```

改完预设文件后，在预设下拉里**重新选一次该预设**（或刷新页面）让 ST 重新读取。

> `marker: true` 表示「正文不来自预设、由运行时提供」，所以**不要**给这条卡片写 `content`。
> 其余字段（`role` / `injection_position` / `injection_trigger` / `forbid_overrides` / `extension`）
> 都不需要。你也可以直接在预设 UI 里改它的名字、身份、触发器、位置 —— 扩展不会覆盖。
>
> 也就是说，它和 `World Info (after)` / `Char Description` / `Scenario` 一样，是「有序提示词」中的一行，
> 会在预设 UI 里作为可拖动的一行出现。
>
> `examples/preset.example.json` 里的示例卡片用的就是同一个 `identifier`，导入后扩展会把它认作
> 自己的卡片（**不会**再生成第二张）；它已经在两个 `prompt_order` 块里紧随 `worldInfoAfter` 之后、
> `enabled: true`，可以直接拖动或单独开关来验证效果。

### 验证一下

刷新后打开控制台：

```js
roleExpansion.logMarkerSupport()
```

看到「ST 补丁已生效」即安装完成。然后去预设 UI 确认那张卡片**有开关、有铅笔**。

---

## 快速开始

1. 打开顶部工具栏的**羽毛图标**，展开「日记」区块。
2. 在「参考聊天楼层」里勾选要参考的楼层（例如「最近 10 楼」，或填 `第 0 ~ 19 楼` 后点「选中区间」）。
3. 点**生成日记** —— 模型会用你当前配置的 API 写一篇，并立即存入当前会话的 jsonl。
4. 之后在日记列表里勾选任意几篇 → 打开预设里那张卡片的开关 → 这些日记就会在后续对话中注入。
5. 想让数值随剧情变化？切到「角色状态栏」区块，按「每行：`名称 值`」批量添加几项即可。

---

## 界面导览

| 入口 | 说明 |
| --- | --- |
| 顶部工具栏羽毛图标 | 主入口，位于「世界书 World Info」与「用户设置 User Settings」之间 |
| 主面板 | 与「世界书」同款的**下拉面板**：紧贴工具栏居中，宽度取 `--sheldWidth`，高度到输入框上方 |
| 「角色管理」面板 | 角色卡编辑区中 `Chat Lore` 按钮右侧的羽毛按钮，一键打开面板 |
| 「扩展」设置面板 | 显示日记卡片状态、补丁是否生效；提供「打开角色扩展面板」「启用状态栏」「恢复默认设置」 |

面板内是**两个可折叠区块**（日记 / 角色状态栏），各自还嵌套一个默认收起的子区块
（「日记主提示词（可自由修改）」/「状态注入提示词」）。面板较宽时内容自动排成两列，窄屏回退单列。

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
| `prompt_order` 里没有该条目 | **什么都不做**（卡片不会生效，面板显示「○ 已停用」） |
| 卡片已存在 | 只**读**它的形态与 `enabled`；不增删字段、不改位置、不改开关 |
| 任何时候 | **不调用** `/api/presets/save`，不写入预设文件 |

**预设完全归你管，扩展只是这张卡片的一个「内容供应商」。**

### 为什么「是否注入主聊天」只有预设卡片一个开关

扩展面板里**没有**「插入主聊天系统」开关，这是刻意的：

| 场景 | 行为 |
| --- | --- |
| 卡片开关打开 | 每次生成时扩展提供日记正文，正常注入 |
| 卡片开关关闭 | 运行时源返回空串 → 不注入；面板显示「○ 已停用（不注入）」 |
| 换会话 / 启动 | 扩展读卡片状态并同步面板显示，**绝不擅自改回**你的选择 |
| 换位置 | 直接在预设 UI 里拖动卡片；扩展**从不**改动 `prompt_order` |
| 卡片不存在 | 扩展**不会**替你创建，面板会把该写的 JSON 片段贴出来 |
| 面板「打开预设面板」按钮 | 一键打开 AI 配置侧栏去操作卡片 |

面板「注入设置」区块会实时显示当前状态：

```text
状态：● 已启用（注入中）
预设「test」· 标识 roleExpansionJournal · 位置/开关都在预设 UI 里管理
形态：marker=true（正文由扩展的运行时源提供）
预览：点预设里卡片的名字即可查看（补丁支持即时构建预览）
```

行为边界：

- 扩展对预设**只读**：不创建、不修改、不移动卡片，也不调用 `/api/presets/save`。
- 勾选变化只影响注入内容与状态文案；marker 模式下预设里始终保持空白。
- 当前接口不是 Chat Completion 时读不到提示词管理器，面板会明确提示「尚未就绪」。
- 取消全部勾选时运行时源返回空串，注入立即停止，不会残留。

---

## 日记模块

### 生成日记

1. 在「参考聊天楼层」里勾选楼层。除逐条勾选外：
   - 第一行快捷按钮：`最近 10 楼` / `全选` / `清空` / `刷新楼层`；
   - 第二行**区间选择**：填「第 `N` ~ `M` 楼」后点「选中区间」。编号与列表里的 `#号` 一致
     （**0 起、两端都含**，与酒馆 UI、`/hide` 一致）；反向填写会自动交换；
     区间内没有可用楼层时会提示，并且**不改动**当前选择。
2. （可选）在下方日记列表中勾选若干**已有日记**作为参考。
3. （可选）填标题，**会覆盖模型生成的标题**；留空即由模型生成。
4. 点「生成日记」。

**标题的解析优先级**（生成的标题不会混进正文）：

```text
用户手填的标题  >  正文里的 <title>…</title>  >  首行 # 标题 / 【标题】 / 标题：…  >  日期时间兜底
```

生成走**酒馆当前配置的 API**，与主聊天记录、状态标签解析都无关（不往聊天记录里写消息，
也不触发状态解析），完成后立即写入当前会话的 jsonl。

### 隔离生成 vs 安静生成

面板「新日记」区有一个**默认开启**的开关「**隔离生成（推荐）**」：

| 通道 | ST 侧接口 | 请求里有什么 | 何时用 |
| --- | --- | --- | --- |
| 隔离生成（默认） | `generateRaw` | **只有日记提示词本身**（一条 user 消息）：不带主聊天记录、角色卡、世界书、预设卡片 | 换模型也不会被主聊天语境带跑 |
| 安静生成（回退） | `generateQuietPrompt` + `skipWIAN` | 完整 system 提示词组 + 整条主聊天记录 + 末尾一条写日记指令 | 「隔离生成」关掉、或该接口缺失时的兜底 |

区别在于：`generateQuietPrompt` 的语义是**后台生成**（结果不进聊天记录），而不是**上下文隔离** ——
它会把整条主聊天记录一并送给模型。对指令遵循强、或对末尾 system 指令权重高的模型，它会照常写日记；
对倾向延续叙事的模型，就可能变成「接着最新剧情往下写」。隔离通道从根上避开了这件事。

> 代价：隔离是双向的 —— 角色卡描述、人格、世界书也一并被挡在外面，人设细节只能从你勾选的楼层里推断。
> 如果发现日记人设漂移，可以关掉这个开关，或在「日记主提示词」里手动补一段人设说明。

### 存储结构

```text
<ST>/data/<用户名>/user/files/RoleExpansion_journal_c_<角色hash8>_j_<会话hash8>.jsonl
例：user/files/RoleExpansion_journal_c_91aa9dee_j_67d659dc.jsonl
```

> ⚠️ **文件名必须是「单段」ASCII**。`/api/files/upload` 走 `validateAssetFileName`（正则 `^[a-zA-Z0-9_\-.]+$`）：
> 中文 / 空格 / 括号一律被拒；而且**没有任何接口能创建子目录**（ST 自己调用该接口时只传单段名）。
> 所以改成「扁平名 + 前缀」模拟层级，双 hash 保证不同会话不会撞名；
> **真实角色名与会话名记录在文件首行的会话头里**（`charDir` / `chatFile`），
> 面板日记区块下方也会显示「会话：角色 / 会话名」与完整文件名。

- **一个会话 = 一个 jsonl 文件**，不同角色、不同会话互不影响。
- **一篇日记 = 文件内的一行**，因此每篇天然独立。
- 文件第一行是会话头，导入时可据此校验来源会话；正文里的换行以 `\n` 转义保存，保证「一行一篇」不被破坏。

```json
{"__roleExpansion":"journal","id":"...","title":"...","content":"...","createdAt":0,"updatedAt":0,
 "charName":"...","userName":"...","chatId":"...","sourceMessageIds":[1,2,3],"sourceJournalIds":[],"stateSnapshot":[]}
```

### 导入 / 导出 / 编辑 / 删除

- **导出**：当前会话全部日记 → 一个 `.jsonl`（首行会话头 + 每篇一行）
- **导出所选**：只导出勾选的篇；日记条目上的「导出」导出单篇
- **导入**：选 `.jsonl`，弹窗确认「确定 = 追加到当前会话 / 取消 = 覆盖当前会话的日记」；与现有 id 冲突时自动重新分配 id
- **编辑**：标题 + 正文弹窗编辑，保存即落盘
- **删除**：单篇「删除」，或勾选后「删除所选」（二次确认，写入文件即生效）

### 主提示词

面板最下方有一个**默认收起**的区块「**日记主提示词（可自由修改）**」，内容随输入即时保存（防抖 400ms）：

| 变量 | 含义 |
| --- | --- |
| `{{chatRange}}` | 勾选的聊天楼层，渲染成 `#索引 说话人: 正文` 形式 |
| `{{journalRefs}}` | 勾选的参考日记（受「插入日记系统」开关控制） |
| `{{stateList}}` | 当前状态列表（受「状态并入日记生成提示」开关控制） |
| `{{char}}` / `{{user}}` 等 | 交给酒馆宏系统替换 |

区块内的「恢复默认」可一键还原。

> 「注入设置」区块里还有一个复选框「**插入日记系统**」：勾选后，日记列表里选中的日记会被拼进
> 上面的 `{{journalRefs}}`，作为**生成新日记时的参考**。它与「是否把日记注入主聊天」是两件事 ——
> 后者由预设里那张卡片的开关决定，见[核心机制](#核心机制)。

<details>
<summary><b>面板布局</b></summary>

日记面板自上而下：**新日记**（标题输入 + 生成按钮 + 隔离开关 + 参考楼层）→ **注入设置** → **日记列表**
→ **日记主提示词**（收起）。

「日记列表」折叠块内自上而下：计数/文件行 → 存储说明 → 日记条目列表 → 操作按钮行。

- 「参考聊天楼层」与「日记列表」各自是一个折叠块，用酒馆原生的 `.inline-drawer` 结构，
  折叠由 `script.js` 里 `$(document).on('click', '.inline-drawer-toggle', …)` 的**委托**处理器负责，
  所以刷新、重开面板都不会失效（扩展没有自己写一套折叠逻辑去和酒馆抢）。
- 日记列表的「**全选**」与「**清空**」是**两个独立按钮**：前者勾选全部，后者取消全部勾选。
- 每篇日记还有「仅此篇」按钮，可一键改为只注入这一篇。

</details>

---

## 角色状态栏

让数值跟着剧情走：维护一组状态（`生命值 8/10`、`好感度 42`…），
酒馆每次生成前自动把它们告诉模型；模型在回复里用 `<名称>值</名称>` 报告变化，
扩展负责解析、更新数值，并把标签从正文里剥掉。

- **状态列表**：按「每行 `名称 值`」批量添加，或逐项编辑 / 删除 / 清空，也可从剪贴板导入；
  「复制为文本」输出纯文本清单，方便自行粘贴到世界书
- **发送前注入**：每次生成前注入状态清单 —— **深度与角色（system / user / assistant）可调，模板可自由修改**
- **自动更新**：解析回复里的标签，更新已有项；是否收录新名称由开关决定（见下方准入规则）
- **按会话隔离**：状态存在当前会话的元数据里，随聊天记录一起保存；换角色、换存档互不影响
- **与日记联动**：可把当前状态并入日记生成提示（`{{stateList}}`），写日记时作为参考

| 设置 | 说明 |
| --- | --- |
| 启用角色状态栏 | 总开关 |
| 发送前注入状态提示 | 关闭后不再注入（标签解析仍可单独关闭） |
| 从聊天消息中剥离状态标签 | 关闭后标签仍用于更新数据，但会留在正文里 |
| 状态并入日记生成提示 | 生成日记时把当前状态塞进 `{{stateList}}` |
| 只接受已知状态名（默认开） | 模型只能更新状态列表里已有的项；关闭后，回复里的新 `<名称>值</名称>` 会自动加进列表 |

**状态注入提示词**默认内容如下（可自由修改）；注入深度与角色默认 `深度 0 / system`：

```text
当前状态：
{{stateList}}

请参考以上状态。在回答时，如有任何状态数值因剧情发生变化，请仅输出发生变化的状态项，并使用 XML 标签格式表示，例如：<生命值>8/10</生命值>。如果没有状态变化，请不要输出任何状态标签。
```

### 标签准入规则

状态标签的语法 `<名称>值</名称>` 与 HTML / 思维链标签同形，所以解析时有四道闸：

| 判据 | 作用 |
| --- | --- |
| **已在状态列表里的名称** | **一律放行** —— 你自定义的名字不受下面任何限制（13 个汉字的状态名照样能更新） |
| 长度 ≤ 12（按**码点**计） | 未知名称的第一道闸；常用汉字算 1，emoji 与扩展区汉字也各算 1 |
| 不含空白与 `- . / \` | 挡掉 HTML 属性残留、路径样式 |
| 不在 HTML / 思维链 / 工具标签黑名单内 | 挡掉 `<div>`、`<style>`、`<thinking>`、`<analysis>`、`<tool>` 这类 |

**未通过准入的标签不会从正文里删除** —— 它们原样留在消息里，只有通过准入的标签才会被剥掉。
被忽略的标签名会打到控制台，便于确认模型输出了什么。

> 状态存在会话元数据的 `chatMetadata.roleExpansion.state` 里，由酒馆核心负责读写。
> 如果你以前用过别的状态插件，数据可能存在 `chatMetadata.sillyTavernState` 键下 ——
> 本扩展在自身状态为空时会把它**迁入一次**（仅一次；原键保留，不做删除）。

---

## 调试与自测

<details>
<summary><b>控制台 API</b></summary>

```js
roleExpansion.settings            // 当前设置（只读引用）
roleExpansion.ui                  // 运行时状态：journal / selectedJournalIds / selectedFloors / generatingJournal
roleExpansion.getStateList()      // 当前会话状态数组
roleExpansion.buildJournalPrompt()// 查看实际拼接出的日记提示词
roleExpansion.reloadJournal()     // 重新从文件读取日记
roleExpansion.applyStateInjection()          // 手动重算状态注入
roleExpansion.readJournalCard()              // 读卡片形态与启停（{ ok, marker, enabled } / { ok:false, reason }）
roleExpansion.isJournalCardEnabled()         // 读预设卡片的启停状态（注入的权威开关）
roleExpansion.diagnoseJournalCard()          // 打印卡片在每个 prompt_order 块里的真实位置/开关（排查用）
roleExpansion.logMarkerSupport()             // 打印「ST 补丁是否生效」，排查卡片没有开关/铅笔
roleExpansion.probeCardControls()            // 读 DOM：那一行此刻有没有渲染出铅笔/开关（首屏问题看这个）
roleExpansion.patchPromptManagerFirstRender()// 手动再补一次首屏渲染（幂等，只渲染不写预设）
roleExpansion.openPanel()                    // 打开面板
```

`diagnoseJournalCard()` 的完整输出：

```js
roleExpansion.diagnoseJournalCard()
// → { preset, promptManagerExposed, promptManagerReady,
//     patch: { openai, toggleAllowed, editAllowed, inspectPreview, sourceRegistered },
//     controls: { listRendered, found, edit, toggle, enabled },
//     existsInPrompts, marker, promptKeys,
//     bindings: [{ character_id, index, enabled, prev, next }], enabled }
```

`bindings[*].prev / next` 会告诉你卡片前后各是谁，一眼就能看出它现在落在哪个位置。

</details>

### 自测脚本

```bash
node tools/smoke-test.mjs   # 或 npm test
```

没有依赖，`node` 直接跑即可；自测会读取仓库自带的 `examples/preset.example.json`
（找不到时回退到开发机上位于仓库上一级的 `test.json`）。同一套自测在 CI 里对
Node 18 / 20 / 22 各跑一遍（[`.github/workflows/smoke-test.yml`](.github/workflows/smoke-test.yml)）。

用最小 DOM / ST 桩（含假的提示词管理器、假预设、假角色管理面板）加载 `index.js`，**共 200 项断言**。

<details>
<summary><b>自测覆盖了什么</b></summary>

- 状态标签解析与剥离、标签更新
- 日记提示词拼接（`{{chatRange}}` / `{{journalRefs}}` / `{{stateList}}` / `{{char}}`）
- **首屏时序**：模块求值即注册运行时源；注册成功后**主动补了一次列表渲染**；
  DOM 探针在列表未渲染时如实报 `false` 且不抛异常
- **日记面板 UI**：「参考聊天楼层」「日记列表」两块都是酒馆原生 `.inline-drawer`；
  「全选」「清空」是两个独立按钮；**主提示词编辑框挂在日记面板 section 内**
- **楼层区间选择**：区间行独立一行；空/非数字输入不动已有勾选；`1~2` 命中 `{1,2}`；
  反向 `2~1` 归一化并把结果写回输入框；越界区间提示且不改动选择
- **面板结构**：主面板为「日记」「角色状态栏」两块；「状态注入提示词」子区块挂在状态面板内
- **ST 补丁自身**：含「把运行时源真正 add 进 chatCompletion」的循环与真实 token 计数，
  且不含 `/api/presets/save`
- **扩展对预设只读**：卡片不存在时不创建、不碰 `prompts`、不碰 `prompt_order`；
  刷新状态/勾选变化都不改动预设数组
- **marker 卡片与开关**：运行时源已注册并返回正确文本；**卡片 `enabled=false` 时运行时源返回空串**；
  扩展不会把 `enabled` 改回去；用户拖动过的卡片不会被挪回原位
- **生成日记时不得自注入**：`ui.generatingJournal` 置位期间运行时源返回空串；
  `quiet` 类型同样不注入（保险丝），而 `swipe` / `regenerate` / `normal` 照常注入；
  点一次「生成日记」后标志位必定复位（`finally` 生效）
- **状态模块**：旧 `sillyTavernState` 只迁移一次（原键保持原样）；
  标签准入（已知名称优先放行、长度按码点计、未通过的标签原样留在正文里）
- **日记生成通道**：默认走 `generateRaw` 且**只传 `prompt` 一个参数**；
  关掉隔离后回退到 `generateQuietPrompt` 并带上 `skipWIAN: true`；
  隔离通道同样会剥离 `<thinking>` 推理块后再解析标题
- **管理器可读性**：`getContext().promptManager` 缺失与「管理器未就绪」两种情形
  分别给出不同提示与诊断字段
- **主面板形态**：挂到 `#movingDivs`、宽度取 `--sheldWidth`、最大高度 = 视口 − 工具栏 − 输入栏 − 8、
  与角色管理同时打开时打上 `roleEx-panel-over-nav` 标记
- **文件名合规**：单段、满足 `^[a-zA-Z0-9_\-.]+$`（无中文/无路径分隔符）、双 hash 不撞名
- **标题生成**：四种形式都能正确解析，且不从正文漏进标签
- jsonl 落盘路径、行结构、单行 JSON 无损还原、读回解析

</details>

---

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
<summary><b>日记被写成了剧情推进 / 和主聊天最新内容互动</b></summary>

如果你把「隔离生成」关掉了，就会走安静生成通道（`generateQuietPrompt`）—— 它会把
**整条主聊天记录**一并送给模型，末尾再追加一条「写日记」指令；对倾向延续叙事的模型，
它就会接着最新剧情往下写。

默认的**隔离生成**（`generateRaw`，只发日记提示词本身）不会有这个问题。
如果因为需要人设细节而关掉了它，可以在「日记主提示词」里手动补一段人设说明来兼顾。

</details>

<details>
<summary><b>状态标签不生效</b></summary>

- 标签必须**成对且名称一致**：`<生命值>8/10</生命值>`
- 默认只接受**已知状态名**。模型在剧情里发明的新名称会被忽略（并保留在正文里）；
  想让它自动收录，关掉面板里的「只接受已知状态名」，或先手动建一条同名状态
- 状态注入提示词里已经给了模型格式示例，如果它长期不按格式输出，可以在「状态注入提示词」里把要求写得更硬

</details>

<details>
<summary><b>ST 升级后一切失效</b></summary>

升级/重装会覆盖 `public/scripts/*.js`，补丁需要重新 `git apply`，然后 `Ctrl+F5`。

</details>

---

## 已知限制

- **预设卡片需要你手动维护**（刻意的取舍：扩展不碰预设文件）。片段见[写预设卡片](#写预设卡片)；
  改完记得在预设下拉里重新选一次该预设。
- 如果卡片上看不到启停开关与编辑铅笔，多半是浏览器还在用缓存的旧 `scripts/*.js`：
  确认补丁已应用后 **`Ctrl+F5`**；用 `roleExpansion.logMarkerSupport()` 可确认。
- 顶部工具栏图标间距由本扩展的 CSS 统一归一：各入口的 `.drawer-icon` 左右内边距归零，
  间距完全交给 `--roleEx-topbar-gap`（默认 26px）。图标是 32px 等宽，所以
  **中心间距 = 32 + gap ≈ 58px**；想更紧/更松只改这一个变量（`18px` 约 50px / `34px` 约 66px）。
  该规则带 `:has(.roleEx-top-drawer)` 守卫，只在扩展已装载时生效，并附
  `@supports not selector(:has(*))` 兜底。
- 日记文件靠 `/api/files/upload` 覆盖写入；同一会话并发写入不排队，正常单人使用无影响。
- 状态标签的准入规则见[标签准入规则](#标签准入规则)；模型不按格式输出时状态不会更新。
- 隔离通道（默认）不走酒馆自身的推理剥离流程，扩展会自己剥掉成块的
  `<thinking>` / `<reasoning>` / `<analysis>`；如果你的推理格式是别的写法
  （例如用三反引号包裹的推理块），日记正文里可能需要手动清理。
- 状态数据存在聊天元数据里，**不会写回角色卡**；新开聊天时状态为空。

---

## 仓库结构

```text
ST-RoleExpansion/
├── manifest.json                     酒馆扩展清单（名称 / 版本 / 加载顺序 / 最低客户端版本）
├── index.js                          全部实现：日记 + 角色状态栏 + 面板 UI
├── index.html                        酒馆「扩展」列表里的设置卡片模板
├── style.css                         全部样式（统一 roleEx- 前缀）
├── patches/
│   └── st-marker-prompt.patch        对 ST 核心的最小补丁（运行时提示词源 + 卡片权限）
├── tools/
│   ├── smoke-test.mjs                离线自测（最小 DOM / ST 桩，200 项断言）
│   └── check-filename.mjs            文件名合规校验器
├── examples/
│   └── preset.example.json           参考预设（已内置日记卡片，可直接导入酒馆）
├── .github/workflows/smoke-test.yml  CI：Node 18 / 20 / 22 各跑一遍自测
├── CHANGELOG.md
├── LICENSE
└── .editorconfig / .gitattributes / .gitignore / package.json
```

---

## 许可

[MIT](LICENSE) © 2026 TowardsDawn

> `patches/st-marker-prompt.patch` 是针对 SillyTavern 本体（AGPL-3.0）源码的 diff，
> 其中含有少量上下文行。SillyTavern 本体不在本仓库内，请按其自身许可获取。

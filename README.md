# ST-RoleExpansion（角色扩展）

SillyTavern 前端扩展。当前包含两个模块，**日记**与**角色状态栏**，二者共用一个面板；
面板命名为「角色扩展」而非「日记 / 状态栏」，为后续功能预留位置。

- 无需构建步骤：原生 ESM，装进扩展目录即可用。
- 纯前端：不依赖任何后端 server plugin；日记落盘走酒馆自带的 `/api/files` 接口。
- 许可 MIT，当前版本 `0.3.0`（变更见 `CHANGELOG.md`）。
- 最低客户端版本：SillyTavern `1.18.0`（本扩展的开发与验证版本，`manifest.json` 同值）。
  补丁 `patches/st-marker-prompt.patch` 的上下文行号以 1.18.0 的 `openai.js` /
  `PromptManager.js` / `st-context.js` 为基线，换 ST 版本前请先确认它能 `git apply`。

---

## 一、安装

1. 把整个 `ST-RoleExpansion` 文件夹放到下列任一目录：
   - 仅当前用户：`<ST>/data/<你的用户名>/extensions/ST-RoleExpansion/`
   - 所有用户：`<ST>/public/scripts/extensions/third-party/ST-RoleExpansion/`

   用 git 安装（便于后续 `git pull` 更新）：

   ```bash
   cd <ST>/data/<你的用户名>/extensions
   git clone <你的仓库地址> ST-RoleExpansion
   ```
2. 刷新酒馆页面，在「扩展」列表里确认「角色扩展 (Role Expansion)」已启用。
3. 顶部工具栏会出现一个 **羽毛图标**，位置在「世界书 World Info」与「用户设置 User Settings」之间。

---

## 二、界面位置

| 入口 | 说明 |
| --- | --- |
| 顶部工具栏羽毛图标 | 主入口。位置在「世界书 World Info」与「用户设置 User Settings」之间 |
| 主面板 | 打开后是与「世界书 World Info」同款的**下拉面板**：顶部紧贴工具栏居中，宽度 `--sheldWidth`，高度到输入框上方；**z-index 4000**，高于角色管理侧栏 |
| 「角色管理」面板 | 角色卡编辑区中，`Chat Lore` 按钮右侧的羽毛按钮，一键打开面板 |
| 「扩展」设置面板 | 显示日记卡片状态、补丁是否生效；提供「打开角色扩展面板」「启用状态栏」「恢复默认设置」 |

面板内是**两个**可折叠区块：**日记** / **角色状态栏**。
两个区块各自还嵌套一个默认收起的子区块（「日记主提示词（可自由修改）」/「状态注入提示词」），
子区块挂在父区块的正文里、背景透明，视觉上从属于父面板。
面板较宽时内容自动排成两列（`auto-fit minmax(340px, 1fr)`），窄屏回退单列。

### 面板的形态与优先级

- 工具栏按钮按酒馆原生结构手写（`.drawer > .drawer-toggle`），插进 `#top-settings-holder`。
- **面板本体是 `.drawer-content`，挂在 `#movingDivs`**——酒馆给下拉/浮动面板（Author's Note / CFG / logprobs）用的容器。
  `#movingDivs > div { z-index: 4000 }`，天然高于 `#left-nav-panel` 与 `#right-nav-panel` 的 3000，
  因此与角色管理面板同时打开时压在上面（会打上 `roleEx-panel-over-nav` 标记）。
- 宽度取 `--sheldWidth`，最大高度 = 视口高 − `--topBarBlockSize` − `--bottomFormBlockSize` − 8px；
  监听 `resize`，每次打开时重算，另带 620px 兜底值。
- 头部有**锁定**（锁定时打开其它面板不自动关闭本面板）与关闭按钮；点空白处会关闭（未锁定时）。

> **为什么扩展要自己绑点击**：酒馆用的是 `$('.drawer-toggle').on('click', doNavbarIconClick)`——
> 这是**直接绑定**、没有事件委托，而扩展的抽屉是脚本运行后才插入 DOM 的，原生处理器不会认这张新抽屉。
> 所以扩展在创建抽屉时自己绑一次点击，并复用 `doNavbarIconClick`（1.18 的 `getContext()` 并未导出它，
> 因此同时内置了等价的开关实现），确保图标一定响应。

> **按钮文字竖排是怎么修掉的**：酒馆的 `.menu_button` 是 `width: min-content`，而中文可以在任意字符处断行，
> `min-content` 于是塌成**一个汉字宽**、文字逐字换行。本扩展所有 `.roleEx-btn*` 按钮都强制
> `width: fit-content` + `white-space: nowrap` + `word-break: keep-all`；设置面板里的复选框行也改成
> `flex` 布局 + `white-space: normal`，避免同类塌缩。

---

## 三、日记模块

### 3.1 存储结构（文件级隔离）

```
<ST>/data/<用户名>/user/files/RoleExpansion_journal_c_<角色hash8>_j_<会话hash8>.jsonl
例：user/files/RoleExpansion_journal_c_91aa9d3f_j_67d659ab.jsonl
```

> ⚠️ **文件名必须是「单段」ASCII**。`/api/files/upload` 走 `validateAssetFileName`
> （正则 `^[a-zA-Z0-9_\-.]+$`）：
> - 中文/空格/括号一律拒绝；
> - **不接受 `/`** —— 你的服务器那版就是在这里拦的，而且**没有任何接口能创建子目录**
>   （ST 自己调用该接口时只传单段名，见 `chats.js` 的 `${fileNamePrefix}.txt`）。
>
> 所以改成「扁平名 + 前缀」模拟层级：`RoleExpansion_journal_c_<hash8>_j_<hash8>.jsonl`，
> 前缀让同一插件/同一用途的文件在目录里排在一起，双 hash 保证不同会话不会撞名。
> **真实角色名与会话名记录在文件首行的会话头里**（`charDir` / `chatFile`），
> 面板日记区块下方也会显示「会话：角色 / 会话名」与完整文件名。

- **一个会话 = 一个 jsonl 文件**，不同角色、不同会话互不影响。
- **一篇日记 = 文件内的一行**，因此每篇天然独立，不会以续写形式接在上一篇末尾。
- 每行是一个 JSON 对象，包含：

```json
{"__roleExpansion":"journal","id":"...","title":"...","content":"...","createdAt":0,"updatedAt":0,
 "charName":"...","userName":"...","chatId":"...","sourceMessageIds":[1,2,3],"sourceJournalIds":[],"stateSnapshot":[]}
```

- 文件第一行是会话头（`{"__roleExpansion":"session",...,"charDir":"角色","chatFile":"会话名"}`），导入时可据此校验来源会话。
- 正文里的换行以 `\n` 转义保存，保证「一行一篇」不被破坏。

### 3.2 生成日记

1. 在「参考聊天楼层」里勾选楼层。除逐条勾选外：
   - 第一行是快捷按钮 `最近 10 楼` / `全选` / `清空` / `刷新楼层`；
   - 第二行是**区间选择**：填「第 `N` ~ `M` 楼」后点「选中区间」。编号与列表里的 `#号` 一致
     （**0 起、两端都含**，与酒馆 UI、`/hide` 一致）；反向填写会自动交换；
     区间内没有可用楼层时会提示，并且**不改动**当前选择。
2. （可选）在下方日记列表中勾选若干**已有日记**作为参考。
3. （可选）在标题框里填标题，**会覆盖模型生成的标题**；留空即由模型生成。默认空着。
4. 点击「生成日记」。

**标题由模型随正文一同生成**：主提示词要求它第一行输出 `<title>日记标题</title>`，第二行起是正文。
解析优先级为：

```
用户手填的标题  >  正文里的 <title>…</title>  >  首行 # 标题 / 【标题】 / 标题：…  >  日期时间兜底
```

生成的标题不会混进正文（`<title>` 标签会被剥离），可在日记列表里点「编辑」随时改。

生成走**酒馆当前配置的 API**，与主聊天记录、状态标签解析都无关（不往聊天记录里写消息，
也不触发状态解析），完成后立即写入当前会话的 jsonl。

**默认使用「隔离生成」通道**（面板「新日记」区可关）：

| 通道 | ST 侧接口 | 请求里有什么 | 何时用 |
| --- | --- | --- | --- |
| 隔离生成（默认） | `generateRaw` | **只有日记提示词本身**（一条 user 消息）：不带主聊天记录、角色卡、世界书、预设卡片 | 换模型也不会被主聊天语境带跑 |
| 安静生成（回退） | `generateQuietPrompt` + `skipWIAN` | 完整 system 提示词组 + 整条主聊天记录 + 末尾一条写日记指令 | 「隔离生成」关掉、或该接口缺失时的兜底 |

区别在于：`generateQuietPrompt` 的语义是**后台生成**（结果不进聊天记录），而不是**上下文隔离** ——
它会把整条主聊天记录一并送给模型。对指令遵循强、或对末尾 system 指令权重高的模型，它会照常写日记；
对倾向延续叙事的模型，就可能变成「接着最新剧情往下写」。隔离通道从根上避开了这件事。

### 3.3 插入方式与开关

> **架构（v0.2 起）**：**卡片由你在预设 JSON 里自己维护，扩展只负责"喂正文 + 读开关"。**
> 扩展**不创建、不修改、不移动**预设卡片，也**不再调用 `/api/presets/save`** ——
> 这样它不会和你的预设编辑互相打架，也不受"预设何时被加载/渲染"的时序影响。

| 项目 | 说明 |
| --- | --- |
| **卡片** | 你手动写进预设 JSON（片段见下）。扩展启动时只**读**它：读形态、读 `prompt_order` 里的 `enabled` |
| **正文来源** | 扩展用 `registerRuntimePromptSource('roleExpansionJournal', …)` 注册一个运行时正文源；ST 每次生成时调它取「勾选日记」拼成的文本，填进那张卡片 |
| **启停开关** | **就是那张卡片的开关**。扩展只读它，绝不改它。开＝注入，关＝运行时源返回空串、不注入 |
| **位置** | 完全由你在 `prompt_order` 里决定（也随时可在预设 UI 里拖动）。扩展不插手 |
| **插入日记系统** | 面板里唯一的开关：把勾选的日记拼进「生成新日记」的提示词，作为参考 |

#### 需要写进预设 JSON 的两处

```jsonc
// 1) prompts 数组里追加一条（四个字段就够，与 World Info (after) 同形）
{
    "identifier": "roleExpansionJournal",
    "name": "日记（角色扩展）",
    "system_prompt": true,
    "marker": true
}
```

```jsonc
// 2) prompt_order 里**每个 character_id 块**都要加一条，位置建议紧跟 worldInfoAfter
{
    "identifier": "worldInfoAfter",
    "enabled": true
},
{
    "identifier": "roleExpansionJournal",
    "enabled": true
},
{
    "identifier": "dialogueExamples",
    "enabled": true
}
```

改完预设文件后，在预设下拉里**重新选一次该预设**（或刷新页面）让 ST 重新读取。

> ⚠️ `marker: true` 表示「正文不来自预设、由运行时提供」，所以**不要**给这条卡片写 `content`。
> 其余字段（`role` / `injection_position` / `injection_trigger` / `forbid_overrides` / `extension`）
> 都不需要 —— 正文由扩展提供，角色由酒馆按 system 处理。
> 你也可以直接在预设 UI 里给这张卡片改触发器/角色，扩展不会覆盖。

> `examples/preset.example.json`（仓库里的参考预设）就是按这个形态写好的，可直接照抄。

> 也就是说，它和 `World Info (after)`、`World Info (before)`、`Char Description`、`Char Personality`、`Scenario`
> 属于同一批「有序提示词」，会在预设 UI 里作为可拖动的一行出现——**这就是 `World Info (after)` 那种插入原理**。

### 3.3.1 `marker: true` 卡片与 ST 补丁

`marker: true` 的语义是「正文不来自预设，而由运行时按 identifier 提供」——
`World Info (after)` 就是这样：预设里只有 `{"marker": true}`，运行时由
`preparePromptsForChatCompletion` 推入 `{ identifier: 'worldInfoAfter', content: formatWorldInfo(...) }`。

原版 ST 的这份运行时列表是**硬编码**的，扩展无法加入自己的 identifier。
更麻烦的是它还有两处硬编码的**只读名单**——这就是第三方 marker 卡片「既没有开关、也没有编辑铅笔」的原因：

```js
// PromptManager.js
isPromptEditAllowed(prompt)   // forceEditPrompts   = charDescription/charPersonality/scenario/personaDescription/worldInfoBefore/worldInfoAfter
isPromptToggleAllowed(prompt) // forceTogglePrompts = 上面那几个 + main/chatHistory/dialogueExamples
// marker 卡片不在名单里 → 开关被禁用；不在 promptSources 里 → 编辑弹窗显示「无法在此处编辑」
```

因此本插件附带一个**极小的 ST 补丁**（`patches/st-marker-prompt.patch`），让扩展能注册运行时正文源，
并决定这张卡片是否可编辑、是否带开关。补丁只做新增与放行判断（共 ~162 行），不改动原生行为：

1. `openai.js`：新增 `runtimePromptSources` / `extensionPromptSources` / `runtimePromptPermissions`
   注册表与 `registerRuntimePromptSource(identifier, getContent, { name, edit, toggle })`；
2. `openai.js`：构建 `systemPrompts` 时合并这些运行时源；并把这些 identifier
   **排除**在通用的「扩展 prompt 覆盖循环」之外，避免顶掉世界书等内容；
3. `openai.js`：在 `populateChatCompletion()` 里把注册的 identifier **真正加进 chatCompletion**
   （`for (const identifier of runtimePromptSources.keys()) await addToChatCompletion(identifier)`）。
   原版这里只有一串**硬编码**的 identifier（`worldInfoBefore/main/worldInfoAfter/charDescription/…`），
   不补这一步，扩展卡片**即使成功取到正文也永远注入不进去**——症状就是
   「Prompt List 里能看到日记正文，但生成时并没有它，卡片 token 数也一直是 `-`」。
   跳过逻辑由 `addToChatCompletion` 自己兜住：卡片 `enabled=false` → 跳过；
   卡片不在任何 `prompt_order` 块 → 跳过；正文为空 → 聚合阶段就不 push → 跳过。
4. `PromptManager.js`：`isPromptEditAllowed` / `isPromptToggleAllowed` 放行已注册的 identifier，
   并在「正文来源」处显示扩展提供的来源名；`handleInspect` 增加兜底 —— 当该条目还不在
   `promptManager.messages` 里（刚启动、或当前没有可注入内容所以被跳过）时，
   按需调 `getRuntimePromptPreviewSource()` 现场构建一份预览，**保证 Prompt List 一定能打开**；
   这份兜底预览会用 tokenizer 按**真实正文**算 token（空内容 = `Tokens: 0`，
   非空 = 实际数量），不再显示 `undefined`；
5. `st-context.js`：
   - 把 `registerRuntimePromptSource` 挂到 `getContext()` 上，让扩展能调用；
   - **把 `promptManager` 以 getter 形式暴露到 `getContext()`**（原版没有导出它，
     扩展读不到预设里的提示词/顺序，卡片逻辑会整体失效）。用 getter 是因为
     `promptManager` 在 `setupChatCompletionPromptManager()` 里才被赋值，
     直接取值会在早期拿到 `null` 并永久固化。

> ⚠️ **第 5 条的第二项是必须的**。如果你应用的是更早版本的补丁，
> 症状就是 `roleExpansion.diagnoseJournalCard()` 返回
> `promptManagerExposed: false / promptManagerReady: false`，
> 且面板提示「ST 补丁为旧版」。此时重新 `git apply` 本补丁并 `Ctrl+F5` 即可。
>
> ⚠️ **第 3 条也是必须的（如果你升级过本插件）**。老版本补丁漏了这一步，
> 症状很特定：Prompt List 点开**能看到日记正文**，但生成时日记并没有进请求，
> 而且这张卡片的右侧一直是 `-`（而 `Char Description` 这类卡片有数字）。
> 原因是正文只被合并进了 `prompts` 集合，却没人把它 `addToChatCompletion()`。
> 重新 `git apply` 本补丁即可；补丁生效后 card 右侧会显示与
> `Char Description` 同源的 token 数，Prompt List 里也不再是 `undefined`。

> ⏱️ **时序坑（必须两件事都做）**：酒馆是在 Chat Completion 初始化时
> （`setupChatCompletionPromptManager()` → `promptManager.render()`）渲染预设列表的，
> **渲染那一刻**就决定了卡片有没有开关与铅笔。
>
> 更关键的是先后顺序（见 ST `public/script.js` 的 `firstLoadInit`）：
>
> ```text
> initOpenAI()        ← 里面就 setupChatCompletionPromptManager() → 预设列表【第一次渲染】
> initExtensions()    ← 扩展脚本此刻才被求值、才注册运行时源
> ```
>
> 也就是说**第一次渲染永远早于扩展注册**。只做「模块求值阶段注册」是不够的：
> 那一行的渲染结果里没有我们的授权 → 表现成
> **「不打开任何会话就看不到铅笔和开关，随便打开一个会话它们又出现了」**。
> 因为列表只在 `CHAT_LOADED` / 发消息 / 切预设等事件里才重渲染。
>
> 本扩展因此做两件事：
>
> 1. 在 `bootstrap()` 一开始就注册运行时源（未就绪则按 250ms 重试）；
> 2. 注册成功后**主动补一次列表渲染**（`patchPromptManagerFirstRender()` →
>    `promptManager.render(false)`，纯展示，不写预设）；
>    并在 1.5s 后复查那一行的 DOM，仍缺控件才再补一次（有上限，不会反复重绘）。

扩展侧只需一行（已内置，无需你写代码）：

```js
ST_API.registerRuntimePromptSource('roleExpansionJournal', () => 当前勾选日记拼成的文本, {
    name: '角色扩展（日记）',   // 显示在卡片「正文来源」处，同时让卡片可编辑
    edit: true,                 // 允许编辑（铅笔 → 名称/身份/触发器/位置 + Prompt List 预览）
    toggle: true,               // 允许用卡片上的开关启停
});
```

**应用方法**（在 ST 根目录，即含 `public/` 的那一层）：

```bash
git apply /path/to/ST-RoleExpansion/patches/st-marker-prompt.patch
# 或者手动按补丁内容改 public/scripts/openai.js、PromptManager.js、st-context.js
```

- 已打补丁 → 卡片的开关与铅笔正常，点铅笔能改名称/身份/触发器/位置，
  点卡片名能打开 **Prompt List 预览**（看到当前会注入的日记正文）；
- 未打补丁 → 卡片拿不到正文（`registerRuntimePromptSource` 不存在），面板会提示需要重新应用补丁。

> ST 升级/重装会被覆盖，需要重新 `git apply`。

### 3.3.2 「是否注入主聊天」只由预设卡片控制

那张卡片上的开关就是唯一开关，**扩展面板里没有「插入主聊天系统」开关**：

| 场景 | 行为 |
| --- | --- |
| 卡片开关打开 | 每次生成时扩展提供日记正文，正常注入 |
| 卡片开关关闭 | 运行时源返回空串 → 不注入；面板显示「○ 已停用（不注入）」 |
| 换会话 / 启动 | 扩展读卡片状态并同步面板显示，**绝不擅自改回**你的 enabled 选择 |
| 换位置 | 直接在预设 UI 里拖动卡片；扩展**从不**改动 `prompt_order` |
| 卡片不存在 | 扩展**不会**替你创建，面板会直接把该写的 JSON 片段贴出来 |
| 面板「打开预设面板」按钮 | 一键打开 AI 配置侧栏去操作卡片 |

面板「注入设置」区块会实时显示：

```
状态：● 已启用（注入中）
预设「test」· 标识 roleExpansionJournal · 位置/开关都在预设 UI 里管理
形态：marker=true（正文由扩展的运行时源提供）
预览：点预设里卡片的名字即可查看（补丁支持即时构建预览）
```

> **关于「点卡片名看到的 Prompt List 预览」**：原版 ST 的 `handleInspect` 是
>
> ```js
> if (true === this.messages.hasItemWithIdentifier(promptID)) { …showPopup('inspect'); }
> ```
>
> 而 `promptManager.messages` **只在构建过一次请求后才填充**，并且**内容为空的条目会被跳过**。
> 于是：刚启动时点任何卡片都没反应（内置的 `World Info (after)` 也一样）；
> 即使生成过，只要当时没有勾选任何日记（运行时源返回空串、该条被跳过），也依然点不开。
>
> 补丁给 `handleInspect` 加了兜底：命中不了集合时，若该 identifier 是扩展注册的运行时提示词，
> 就现场构建一份预览。内容为空时**不塞任何占位文案**，直接交给 PromptManager 自己的
> `content || 'No Content'` 显示 —— 与 `World Info (after)` 等原生 marker 卡片完全一致，
> 而且不会让占位串被 tokenizer 计进 `Tokens`。
> 所以现在**任何时候点卡片名都能打开 Prompt List**，不需要先生成一次。

### Token 数显示契约

卡片的 token 数与内置卡片（`Char Description`、`Chat History`）**同源**，都来自
`PromptManager.populateTokenCounts()` —— 它在每次构建完请求后，把 `chatCompletion` 里每条消息的
`message.getTokens()` 写进计数表。所以：

| 情形 | 卡片右侧 | Prompt List 的 Tokens |
| --- | --- | --- |
| 没有勾选任何日记（运行时源返回空串 → 该条不进 chatCompletion） | `-`（与内置卡片「本次未发送」一致） | `Tokens: 0`（补丁按真实正文计数） |
| 勾选了日记（正文进入 chatCompletion） | 实际 token 数 | `Tokens: 同一个数` |

> 若这里一直是 `-` 而 `Char Description` 有数字，说明补丁少了「把运行时源 add 进 chatCompletion」
> 那一段（见 3.3.1 第 3 条）——正文取到了却没被送出去。重新 `git apply` 补丁即可。

> **为什么「占位提示词会被 Tokens 计入，却从不真正发送」**：
> 预览和真实请求用的是**两条不同的路**，唯一的汇合点是同一个「正文提供者」函数。
>
> | | 走的路 | 什么时候被执行 |
> | --- | --- | --- |
> | Prompt List 里的 `Tokens` | `handleInspect` → 兜底现造 `Message` → `tokenHandler` 数这一串字符 | 你**点开卡片名**的那一刻 |
> | 真正发给模型的内容 | `collectRuntimePromptSources()` → `systemPrompts` → `addToChatCompletion()` | 每次**生成**时 |
>
> 旧版补丁在预览那条路上加了 `content || '(当前没有可注入的内容 …)'`：这句话是一段**真实字符串**，
> tokenizer 自然把它算成若干 token（所以 `Tokens` 有数），但它**从来没有进入 `prompts` 集合**，
> 生成时自然不会被发送——于是看起来像「占位提示词被计入了上下文」。删掉它之后，
> 空内容就是空串：预览回落成 PrompManager 自己的 `No Content`、`Tokens: 0`，两条路彻底一致。

行为边界：

- 扩展对预设**只读**：不创建、不修改、不移动卡片，也不调用 `/api/presets/save`。
- 卡片不存在时面板会提示该写什么（见 3.3 的 JSON 片段），而不是替你写。
- 勾选变化只影响注入内容与状态文案；marker 模式下预设里始终保持空白。
- 当前接口不是 Chat Completion 时读不到提示词管理器，面板会明确提示「尚未就绪」。

取消全部勾选时，运行时源返回空串，注入立即停止，不会残留。
列表里每篇还有「仅此篇」按钮，可一键改为只插入这一篇。

### 3.4 示例预设卡片（`examples/preset.example.json`）

仓库里的参考预设 `examples/preset.example.json` 已内置一张示例卡片，导入后即可看到效果：

- `identifier` 用的就是插件自己的 `roleExpansionJournal`，所以扩展会把它认作自己的卡片，
  换会话/启动时自动接管，**不会**重复生成第二张。
- 卡片是 `marker: true` + `system_prompt: true`，且**只有这四个字段**（与 `World Info (after)` 完全一致）；
  扩展只读它、从不改写它（见 3.3.1 第 3 条：正文由补丁在 `populateChatCompletion()` 里注入）。
- 在两个 `prompt_order` 块（`character_id` 100000 / 100001）里都紧随 `worldInfoAfter` 之后，`enabled: true`。
- 导入后可在预设 UI 里直接拖动它、单独开关，验证与「插入主聊天系统」开关的联动。

### 3.5 导入 / 导出 / 编辑 / 删除

- **导出**：当前会话全部日记 → 一个 `.jsonl` 文件（首行会话头 + 每篇一行）。
- **导出所选**：只导出勾选的篇。
- 日记条目上的「导出」：导出单篇。
- **导入**：选择 `.jsonl`，弹窗确认「确定 = 追加到当前会话 / 取消 = 覆盖当前会话的日记」；与现有 id 冲突时会自动重新分配 id。
- **编辑**：标题 + 正文弹窗编辑，保存即落盘。
- **删除**：单篇「删除」，或勾选后「删除所选」（二次确认，写入文件即生效）。

### 3.6 主提示词

日记面板最下方有一个**默认收起**的区块「**日记主提示词（可自由修改）**」，点标题展开即可编辑，
内容随输入即时保存（防抖 400ms）。支持这些变量：

| 变量 | 含义 |
| --- | --- |
| `{{chatRange}}` | 勾选的聊天楼层，渲染成 `#索引 说话人: 正文` 形式 |
| `{{journalRefs}}` | 勾选的参考日记（受「插入日记系统」开关控制） |
| `{{stateList}}` | 当前状态列表（受「状态并入日记生成提示」开关控制） |
| `{{char}}` / `{{user}}` 等 | 交给酒馆宏系统替换 |

区块内的「恢复默认」可一键还原。

### 3.7 面板布局

日记面板自上而下：**新日记**（标题输入 + 生成按钮 + 参考楼层）→ **注入设置** → **日记列表**
→ **日记主提示词**（收起）。

「日记列表」折叠块内自上而下是：计数/文件行 → 存储说明（原「关于」面板的内容，**不含版本号**）
→ 日记条目列表 → 操作按钮行。「关于」不再单独占一个折叠面板。

- 「参考聊天楼层」与「日记列表」各自是一个折叠块，标题栏可点开/收起，默认展开。
  它们用的是酒馆原生的 `.inline-drawer` 结构，折叠由 `script.js` 里
  `$(document).on('click', '.inline-drawer-toggle', …)` 的**委托**处理器负责，
  所以刷新、重开面板都不会失效（扩展没有自己写一套折叠逻辑去和酒馆抢）。
- 日记列表的「**全选**」与「**清空**」是**两个独立按钮**：前者勾选全部，后者取消全部勾选。
- 面板内的说明文字保持一行以内；细节都在本 README 里，不占面板空间。

---

## 四、角色状态栏模块

等价于 `SillyTavern-state` 的核心能力，并做了以下取舍：

- **保留**：状态列表增删改、发送前自动注入、AI 回复中 `<名称>值</名称>` 标签的解析与剥离、按会话隔离（存于 `chatMetadata`）。
- **收紧**：标签解析默认只接受**状态列表里已有的名称**；你自定义的名称一旦在列表里就一律放行
  （不受长度与黑名单约束），只有**未知名称**才会被长度 / 形状 / HTML·思维链·工具标签黑名单过滤，
  且**未通过的标签原样留在正文里**。想让模型在剧情里自动引入新状态项，把面板里的
  「只接受已知状态名」关掉即可 —— 黑名单与形状约束对未知名称仍然生效。
- **去掉**：世界书条目的生成与提取。
- **新增**：注入提示词**可自由修改**；「状态并入日记生成提示」开关。
- 兼容迁移：若当前会话已有旧插件 `SillyTavern-state` 的 `sillyTavernState` 数据，
  会在**首次读取时迁入一次**并落一个 `legacyMigrated` 标记，此后不再重放
  （旧数据本身保持原样，不做删除）—— 因此「清空全部」之后不会被旧数据填回来。

| 设置 | 说明 |
| --- | --- |
| 启用角色状态栏 | 总开关 |
| 发送前注入状态提示 | 关闭后不再注入（标签解析仍可单独关闭） |
| 从聊天消息中剥离状态标签 | 关闭后标签仍用于更新数据，但会留在正文里 |
| 状态并入日记生成提示 | 生成日记时把当前状态塞进 `{{stateList}}` |
| 只接受已知状态名（默认开） | 模型只能更新状态列表里已有的项；关闭后，回复里的新 `<名称>值</名称>` 会自动加进列表 |

**状态注入提示词**默认内容（可改）：

```
当前状态：
{{stateList}}

请参考以上状态。在回答时，如有任何状态数值因剧情发生变化，请仅输出发生变化的状态项，并使用 XML 标签格式表示，例如：<生命值>8/10</生命值>。如果没有状态变化，请不要输出任何状态标签。
```

注入深度与注入角色（system / user / assistant）也可在面板里调整，默认 `深度 0 / system`。
它们和上面那段模板一样，都在「角色状态栏」面板内部的**「状态注入提示词」子区块**里（默认收起）。

状态列表支持「每行 `名称 值`」批量添加、逐项编辑、删除、清空、复制为文本、从剪贴板导入。
「复制为文本」输出的是纯文本状态清单，方便自行粘贴到世界书。

### 4.1 与 `SillyTavern-state` 的关系（能否删掉它）

**数据在哪**：状态存在**当前会话文件**的 `chatMetadata` 里，由酒馆核心负责读写，插件只是它的一个客户端。

| | `SillyTavern-state` | 本扩展 |
| --- | --- | --- |
| 存储键 | `chatMetadata.sillyTavernState`（`{name, value}` 数组） | `chatMetadata.roleExpansion.state` |
| 注入方式 | `generate_interceptor` 临时插一条 `System Note` 消息（**不落盘**） | `setExtensionPrompt`（深度/角色可调，模板可改） |
| 标签解析 | `MESSAGE_RECEIVED` 里解析 `<名称>值</名称>` | 同样是 `MESSAGE_RECEIVED`，同一套正则 |
| 世界书生成/提取 | 有（两个按钮） | **没有**（按需求去掉了） |

**它是怎么"被本扩展捕获"的**：`getStateList()` 里有一段一次性兼容迁移
（`migrateLegacyState()`）——当本扩展自己的 `roleExpansion.state` 还是空的时候，
把 `chatMetadata.sillyTavernState` 原样拷进来并 `saveMetadata()`。所以你在旧插件里编辑的状态
会出现在本扩展的面板里；一旦本扩展这一侧有了数据，拷贝就停止，两边各自独立。

**删掉 `SillyTavern-state` 会怎样**：

- ✅ 状态数据**不会丢**。`chatMetadata.sillyTavernState` 仍在会话 JSON 里，本扩展的
  `roleExpansion.state` 也已有一份副本；读、改、注入、标签解析全在本扩展内部完成，不依赖它。
- ✅ 它那条 `System Note` 注入消失 —— 本扩展的 `setExtensionPrompt` 注入接管，功能对等。
- ⚠️ 它独有的「**生成世界书条目**」「**从世界书提取**」两个按钮随之消失（本扩展没有这两个功能）。
- ⚠️ 它在 `extension_settings['SillyTavern-state']` 里的设置会残留在 `settings.json`，不生效也无害。
- ⚠️ **两个都开着反而更容易出问题**：双方都在 `MESSAGE_RECEIVED` 里解析并剥离标签，
  谁先跑谁解析；后跑的那个看到的正文已经没有标签了。**建议只留一个**。
- 💡 删之前最好在本扩展面板里核对一次状态列表（迁移只在
  `roleExpansion.state` 为空时发生，核对无误后就是本扩展自己的数据了）。

---

## 五、调试

浏览器控制台可用：

```js
roleExpansion.settings            // 当前设置（只读引用）
roleExpansion.ui                  // 运行时状态：journal / selectedJournalIds / selectedFloors / stateList
roleExpansion.getStateList()      // 当前会话状态数组
roleExpansion.buildJournalPrompt()// 查看实际拼接出的日记提示词
roleExpansion.reloadJournal()     // 重新从文件读取日记
roleExpansion.applyStateInjection()          // 手动重算状态注入
roleExpansion.readJournalCard()              // 读卡片形态与启停（{ ok, marker, enabled } / { ok:false, reason })
roleExpansion.isJournalCardEnabled()         // 读预设卡片的启停状态（注入的权威开关）
roleExpansion.diagnoseJournalCard()          // 打印卡片在每个 prompt_order 块里的真实位置/开关（排查用）
roleExpansion.logMarkerSupport()             // 打印「ST 补丁是否生效」，排查卡片没有开关/铅笔
roleExpansion.probeCardControls()            // 读 DOM：那一行此刻有没有渲染出铅笔/开关（首屏问题看这个）
roleExpansion.patchPromptManagerFirstRender()// 手动再补一次首屏渲染（幂等，只渲染不写预设）
roleExpansion.clearLegacyJournalInjection()  // 清理旧版本残留的临时注入
roleExpansion.openPanel()                    // 打开面板
```

### 卡片的存在性契约（重要）

| 状态 | 扩展的行为 |
| --- | --- |
| `prompts` 里没有该 identifier | **什么都不做**，面板提示你需要写入的 JSON 片段 |
| `prompt_order` 里没有该条目 | **什么都不做**（卡片不会生效，面板会显示「○ 已停用」） |
| 卡片已存在 | 只**读**它的形态与 `enabled`；不增删字段、不改位置、不改开关 |
| 任何时候 | **不调用** `/api/presets/save`，不写入预设文件 |

也就是说：**预设完全归你管，扩展只是这张卡片的一个"内容供应商"。**
想确认当前状态，随时执行：

```js
roleExpansion.diagnoseJournalCard()
// → { preset, promptManagerExposed, promptManagerReady,
//     patch: { openai, toggleAllowed, editAllowed, inspectPreview, sourceRegistered },
//     controls: { listRendered, found, edit, toggle, enabled },
//     existsInPrompts, marker, promptKeys,
//     bindings: [{ character_id, index, enabled, prev, next }], enabled }
```

`bindings[*].prev / next` 会告诉你卡片前后各是谁，一眼就能看出它现在落在哪个位置。

> 排查「卡片没有启停开关 / 没有编辑铅笔」要**分两步看，别混**：
>
> 1. `roleExpansion.logMarkerSupport()` / `diagnoseJournalCard().patch`
>    → **权限**：补丁是否生效。任一为 `false` 就要重新
>    `git apply patches/st-marker-prompt.patch` 并 `Ctrl+F5`（浏览器会缓存 `scripts/*.js`）。
> 2. `roleExpansion.diagnoseJournalCard().controls` / `roleExpansion.probeCardControls()`
>    → **眼前这一行渲染成了什么**。`patch` 全 `true` 但 `controls.edit/toggle` 为 `false`，
>    就是**首屏渲染时机**问题（补丁没毛病），
>    执行 `roleExpansion.patchPromptManagerFirstRender()` 或点一下预设里的卡片即可恢复；
>    `controls.listRendered: false` 表示预设列表还没渲染（当前不是 Chat Completion 类接口）。

### 自测脚本

```bash
node tools/smoke-test.mjs   # 或 npm test
```

没有依赖，`node` 直接跑即可；自测会读取仓库自带的 `examples/preset.example.json`
（找不到时回退到开发机上位于仓库上一级的 `test.json`）。同一套自测在 CI 里对
Node 18 / 20 / 22 各跑一遍（`.github/workflows/smoke-test.yml`）。

用最小 DOM / ST 桩（含假的提示词管理器、假预设、假角色管理面板）加载 `index.js`，共 200 项断言，覆盖：

- 状态标签解析与剥离、标签更新
- 日记提示词拼接（`{{chatRange}}` / `{{journalRefs}}` / `{{stateList}}` / `{{char}}`）
- **首屏时序**：模块求值即注册运行时源；注册成功后**主动补了一次列表渲染**；
  DOM 探针在列表未渲染时如实报 `false` 且不抛异常
- **日记面板 UI**：「参考聊天楼层」「日记列表」两块都是酒馆原生 `.inline-drawer`
  （可直接被 `$(document).on('click','.inline-drawer-toggle')` 折叠）；
  「全选」「清空」是两个独立按钮；
  **主提示词编辑框确实挂在日记面板 section 内**（防止「建了但忘了 append」导致功能凭空消失）
- **楼层区间选择**：不再有「最近 30 楼」；区间行是独立一行；
  空/非数字输入不动已有勾选；`1~2` 命中 `{1,2}`；反向 `2~1` 归一化并把结果写回输入框；
  越界区间提示且不改动选择
- **面板结构**：主面板只剩「日记」「角色状态栏」两块（「关于」已并入日记的存储说明且不含版本号）；
  「状态注入提示词」子区块确实挂在「角色状态栏」面板内
- **ST 补丁自身**：含「把运行时源真正 add 进 chatCompletion」的循环、含真实 token 计数、
  不再写 `tokens = undefined`、且不含 `/api/presets/save`
- **扩展对预设只读**：卡片不存在时不创建、不碰 `prompts`、不碰 `prompt_order`；
  卡片存在时 `readJournalCard()` 能读到形态与开关；刷新状态/勾选变化都不改动预设数组
- **marker 卡片与开关**：运行时源已注册并返回正确文本；
  **预设卡片 `enabled=false` 时运行时源返回空串**；扩展不会把 `enabled` 改回去；
  用户拖动过的卡片不会被挪回原位
- **生成日记时不得自注入**：`ui.generatingJournal` 置位期间运行时源返回空串；
  `quiet` 类型同样不注入（保险丝），而 `swipe` / `regenerate` / `normal` 照常注入；
  点一次「生成日记」后标志位必定复位（`finally` 生效）；
  源码中不得再出现从未被读取的 `TRIGGER: ['normal']` 假声明
- **状态模块的加固**：旧 `sillyTavernState` 只迁移一次（清空后不复活、遗留键保持原样）；
  标签准入（**已知名称优先放行** —— 13 汉字的自定义状态名照样能更新；未知名称才走长度 / 形状 /
  黑名单，长度按**码点**计，7 个码点的扩展区汉字 `𠮷…` 能通过；未通过的标签原样留在正文里；
  关闭「只接受已知状态名」后新名称可收录，而黑名单依然生效）
- **日记生成通道**：默认走 `generateRaw` 且**只传 `prompt` 一个参数**（不带 systemPrompt / prefill
  等上下文）、隔离模式下不再调用 `generateQuietPrompt`；关掉隔离后回退到 `generateQuietPrompt`
  并带上 `skipWIAN: true`；隔离通道同样会剥离 `<thinking>` 推理块后再解析标题
- **管理器可读性**：`getContext().promptManager` 缺失（旧版补丁）与「管理器未就绪」两种情形
  分别给出不同提示与诊断字段；正常时 `diagnoseJournalCard()` 能列出卡片的顺序绑定与前后的邻居
- 顶部抽屉：注入到 `#top-settings-holder`、绑定了自己的 click、点羽毛图标能真正展开/收起（回归测试）
- **主面板形态**：作为 `.drawer-content` 挂到 `#movingDivs`、宽度取 `--sheldWidth`、
  最大高度 = 视口 − 工具栏 − 输入栏 − 8、与角色管理同时打开时打上 `roleEx-panel-over-nav` 标记
- **文件名合规**：单段、满足 ST 的 `^[a-zA-Z0-9_\-.]+$`（无中文/无路径分隔符）、双 hash 不撞名、
  会话名仍可从会话头读回
- **标题生成**：`<title>` / `# 标题` / `【标题】` / `标题：…` 四种形式都能正确解析，且不从正文漏进标签
- jsonl 落盘路径、行结构、单行 JSON 无损还原、读回解析

---

## 六、已知限制

- **预设卡片需要你手动维护**（这是 v0.2 的刻意取舍：扩展不再碰预设文件）。
  片段见 3.3；改完记得在预设下拉里重新选一次该预设。
- 如果卡片上看不到启停开关与编辑铅笔，说明浏览器还在用缓存的旧 `scripts/*.js`：
  确认补丁已应用后 **`Ctrl+F5` 强制刷新**；用 `roleExpansion.logMarkerSupport()` 可确认。
  若 `patch` 全为 `true` 而 `controls.edit/toggle` 为 `false`，那是首屏渲染时机（不是权限）：
  执行 `roleExpansion.patchPromptManagerFirstRender()`，或打开任意会话触发一次重渲染。
- 顶部工具栏图标间距由本扩展的 CSS 统一归一：各入口的 `.drawer-icon` 左右内边距归零，
  间距完全交给 `--roleEx-topbar-gap`（默认 26px）。
  图标是 32px 等宽（`--topBarIconSize: 2em` + `fa-fw`），所以**中心间距 = 32 + gap ≈ 58px**，
  天然平均；想更紧/更松只改这一个变量（`18px` 约 50px / `34px` 约 66px）。
  该规则带 `:has(.roleEx-top-drawer)` 守卫，只在扩展已装载时生效，并附 `@supports not selector(:has(*))` 兜底。
- 日记文件靠 `/api/files/upload` 覆盖写入；同一会话并发写入不排队，正常单人使用无影响。
- 状态标签必须成对且名称一致（`<生命值>8/10</生命值>`）；模型不按格式输出时状态不会更新。
  准入规则分两类：**已在状态列表里的名称一律放行**（你自定义的名字不受长度与黑名单约束，
  13 个汉字的状态名照样能更新）；**未知名称**才需要长度 ≤ 12（按码点计，一个常用汉字算 1，
  emoji 与扩展区汉字也各算 1）、不含空白与 `- . / \`、且不在 HTML / 思维链 / 工具标签黑名单内。
  **未通过准入的标签不会从正文里删除**。若希望模型在剧情中**新增**状态项，
  请先手动建一条同名状态，或关掉「只接受已知状态名」。
- 日记生成默认依赖酒馆的 `generateRaw`（隔离通道）；该接口缺失时会自动回退到
  `generateQuietPrompt`（此时请求会带上主聊天记录）。两条通道都缺失时面板会给出提示。
- 隔离通道不走酒馆自身的推理剥离流程，扩展会自己剥掉成块的 `<thinking>` / `<reasoning>` /
  `<analysis>`；如果你的推理格式是别的写法（例如纯文本的 ` ``` ` 块），日记正文里可能需要手动清理。
- 状态数据存在聊天元数据里，不会写回角色卡；新开聊天时状态为空。

---

## 七、仓库结构

```
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

## 八、许可

MIT，见 `LICENSE`。

> `patches/st-marker-prompt.patch` 是针对 SillyTavern 本体（AGPL-3.0）源码的 diff，
> 其中含有少量上下文行。SillyTavern 本体不在本仓库内，请按其自身许可获取。

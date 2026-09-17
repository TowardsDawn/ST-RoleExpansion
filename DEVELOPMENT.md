# ST-RoleExpansion 开发说明

> 面向**接手开发的人**，以及**新会话的 AI**。
> 功能说明 / 安装步骤 / 用户 FAQ 见 [README.md](README.md)，版本变更见 [CHANGELOG.md](CHANGELOG.md)。
> 本文件只讲「实现是怎么运作的」和「改代码前必须知道什么」。

---

## 0. 三十秒速览

| | |
| --- | --- |
| 是什么 | SillyTavern 前端扩展：**日记（Journal）** + **角色状态栏（State）** |
| 形态 | 纯前端原生 ESM，**没有任何构建步骤** —— `index.js` 由酒馆直接 `import` |
| 代码规模 | `index.js` ≈ 3200 行（单文件）、`style.css` ≈ 650 行、`index.html` 40 行 |
| 运行前提 | SillyTavern ≥ 1.18.0 **且**已应用 `patches/st-marker-prompt.patch` |
| 后端 | 无。持久化全部走酒馆自带的 `/api/files/*` 与 `chatMetadata` |
| 自测 | `npm test` → `tools/smoke-test.mjs`，纯 Node、不需要浏览器（当前 244 项断言） |

接手时最该先搞明白的三件事：

1. **日记正文不在预设里**，是扩展通过 `registerRuntimePromptSource()` 在每次生成时**现算**的（§4.1）。
   预设里只有一张空的 `marker: true` 卡片，位置和启停由用户维护。
2. 日记生成有**两条通道**：默认 `generateRaw`（上下文隔离），关掉后回退 `generateQuietPrompt`（§4.2）。
   两条通道对角色卡的处理**相反**，改的时候极易踩坑。
3. **一切都按会话隔离**：状态在 `chatMetadata`，日记在 `user/files/*.jsonl`（§4.3）。

---

## 1. 仓库结构

| 路径 | 作用 | 运行必需 |
| --- | --- | :---: |
| `index.js` | 全部实现（单文件 ESM，末尾挂 `globalThis.roleExpansion`） | ✅ |
| `style.css` | 面板样式，选择器一律 `roleEx-` 前缀，避免污染酒馆 | ✅ |
| `index.html` | 酒馆「扩展程序」列表里的设置骨架（**静态**，无脚本） | ✅ |
| `manifest.json` | 扩展元数据；`minimum_client_version: 1.18.0` | ✅ |
| `patches/st-marker-prompt.patch` | 给酒馆打的最小补丁（3 个文件、12 个 hunk） | ⚠️ 需手动应用 |
| `tools/smoke-test.mjs` | 离线自测：stub DOM + ST 桩 → 加载真 `index.js` | — |
| `tools/check-filename.mjs` | 单文件排查酒馆的文件名校验 | — |
| `examples/preset.example.json` | 示例预设（含 marker 卡片），自测会校验一致性 | — |
| `README.md` / `CHANGELOG.md` | 用户文档 / 版本记录 | — |
| `.github/workflows/smoke-test.yml` | CI：Node 18 / 20 / 22 跑 `npm test` | — |
| `package.json` | `private: true`，只用来定义 `npm test` | — |
| `.editorconfig` / `.gitattributes` / `.gitignore` / `LICENSE` | 仓库配套 | — |

### `index.js` 的章节划分

单文件但**有严格分区**，改动时按注释锚点定位（`// ===...` 分隔）：

| 行（约） | 章节 |
| --- | --- |
| 149 | 通用工具（`ctx()` / `el()` / `debounce` / `stableHash` …） |
| 260 | 设置（`DEFAULT_SETTINGS` / `loadSettings` / `updateSetting` / 废弃键清理） |
| 312 | 聊天元数据（状态栏用；`getMetaRoot()` + 一次性迁移） |
| 382 | 文件存储（`/api/files` 封装 + 文件名校验） |
| 472 | 日记存储层（会话身份 hash、jsonl 编解码） |
| 596 | 日记 / 状态 运行时状态（`ui` 单例） |
| 617 | 楼层（聊天记录）选择 |
| 670 | 日记生成（模板渲染、推理块剥离、两条通道、角色卡拼装） |
| 1026 | 日记 → 主聊天注入：**运行时提示词源** |
| 1365 | 日记内容 → 预设卡片（只读关联、状态文案） |
| 1467 | 状态栏 → 主聊天注入（`setExtensionPrompt`） |
| 1489 | 状态栏：解析 AI 回复里的 `<名称>值</名称>` |
| 1613 | DOM 构建（`el()` / `q()` / `section()` / `collapsible()` / `ID`） |
| 1717 | UI：日记面板 |
| 2327 | UI：状态栏面板 |
| 2621 | 顶部抽屉 / 主面板 / 角色面板入口 |
| 2930 | 扩展设置面板（酒馆「扩展程序」里那一块） |
| 3015 | 事件绑定与启动（`bindEvents()` / `bootUI()` / `bootstrap()`） |
| 3169 | `globalThis.roleExpansion`（调试与控制台入口） |

---

## 2. 与 SillyTavern 的接触面

### 2.1 只走 `getContext()`

扩展**不 import 酒馆内部模块**（那些路径随版本就碎），一切从 `SillyTavern.getContext()` 拿：

```js
function ctx() {
    try {
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
            return SillyTavern.getContext();
        }
    } catch (e) { /* ignore */ }
    return null;      // ← 所有调用方都必须容错
}
```

用到的字段：

| 字段 | 用途 |
| --- | --- |
| `eventSource` / `eventTypes` | 事件订阅（§2.3） |
| `chat` / `chatMetadata` / `name1` / `name2` / `characterId` | 会话身份、状态存储 |
| `getCurrentChatId()` | 日记文件名 hash 的来源 |
| `getRequestHeaders()` | `/api/files/*` 的 CSRF 请求头 |
| `generateRaw` / `generateQuietPrompt` | 两条生成通道 |
| `getCharacterCardFields()` | 隔离通道补角色卡 |
| `setExtensionPrompt()` | 状态注入 |
| `registerRuntimePromptSource()` | 日记注入（**补丁新增**） |
| `promptManager`（getter） | 读预设卡片状态（**补丁新增**） |
| `renderExtensionTemplateAsync()` | 渲染 `index.html` |
| `saveSettingsDebounced` / `saveMetadataDebounced` | 持久化 |

> ⚠️ `getContext()` 每次返回**新的对象字面量**。不要缓存它的引用做身份比较，也不要假设两次调用拿到同一个对象。

### 2.2 补丁做了什么，为什么非做不可

`patches/st-marker-prompt.patch`：

| 文件 | 改什么 | 为什么扩展自己做不到 |
| --- | --- | --- |
| `openai.js` | 新增 `registerRuntimePromptSource()` 与 `runtimePromptSources` Map | 扩展无法往酒馆构造的 `systemPrompts` 里插内容 |
| `openai.js` | `populateChatCompletion()` / `preparePromptsForChatCompletion()` 里合并运行时源，并把这些 identifier 排除在「通用扩展 prompt 覆盖循环」之外 | 同上 |
| `PromptManager.js` | 让 `marker: true` 的卡片可被编辑 / 启停（`isPromptEditAllowed` / `isPromptToggleAllowed`） | 原生把 marker 卡片当只读 |
| `st-context.js` | 用 getter 把 `promptManager` 暴露进 `getContext()` | 否则扩展完全读不到预设 |

**不打补丁的降级行为**（不会崩，但功能残）：

- 日记注入链断掉（`runtimeSources` 里没有我们的条目）
- 面板上的卡片状态提示显示「补丁不完整」
- `logMarkerSupport()` / `diagnoseJournalCard()` 会在控制台打出具体缺哪一处

自测里有一条断言**直接读 patch 文件**，检查关键片段还在（防止补丁被改坏却没发现）。

### 2.3 DOM 注入点

| 注入物 | 容器 | 函数 |
| --- | --- | --- |
| 顶部工具栏抽屉（羽毛图标） | `#top-settings-holder`，插在 `#WorldInfo` 之后 | `insertDrawer()` |
| 主面板主体（`.drawer-content`） | `#movingDivs` | 同上 |
| 角色卡编辑区的入口按钮 | `#avatar_controls` 里 `Chat Lore` 右侧 | `insertCharacterPanelButton()` |
| 「扩展程序」列表里的设置区 | `#extensions_settings` | `initExtensionSettingsPanel()` |

容器**可能还没渲染**，所以都有 500ms × 20 次的重试（`bootUI()`）。

> ⚠️ 酒馆对抽屉点击是 `$('.drawer-toggle').on('click', doNavbarIconClick)` —— **直接绑定**，不认后来插入的元素。
> 所以我们的抽屉必须自己绑 click（`toggleDrawerState()`），还要自己实现「打开一个时关掉其他」（`closeOtherDrawers()`）。

事件订阅（`bindEvents()`）：

| 事件 | 干什么 |
| --- | --- |
| `CHAT_CHANGED` | 清空勾选、重算会话身份、重载日记、重做状态注入 |
| `MESSAGE_RECEIVED` | 解析并剥离状态标签 |
| `GENERATION_STARTED` | 记录生成类型（旧版酒馆可能没有，缺失时靠 `ui.generatingJournal` 兜底） |
| `OAI_PRESET_CHANGED_AFTER` / `_BEFORE` | 换预设后刷新卡片状态文案、重新确保运行时源 |
| `APP_READY` / `EXTENSION_SETTINGS_LOADED` | 初始化「扩展程序」设置区 |

---

## 3. 两条主数据流

### 3.1 日记

```
勾选楼层 ──┐
勾选日记 ──┼─→ buildJournalPrompt()  ──→ generateJournalText()  ──→ 模型
当前状态 ──┘     （模板变量替换）          ├─ generateRaw（默认，隔离）
                                          └─ generateQuietPrompt（回退）
                                                  │
                                                  ▼
                                     splitJournalResponse() 拆出 <title>
                                                  │
                                                  ▼
                     addJournalEntry() → ui.journal[] → POST /api/files/upload
                                                  │
                                                  ▼
            主聊天生成时 ← getContent() ← 把勾选的那几篇拼成正文 ← 运行时源
```

**正文是"当下算"的**。预设里那张卡片只提供「位置」和「启停开关」，不存内容。

`getContent()` 有三道闸，**顺序不能乱**：

1. `ui.generatingJournal` —— 本次就是扩展自己在写日记 → 返回空串
   （否则旧日记会被塞回"写日记"的请求，形成自反馈，并与提示词里的 `{{journalRefs}}` 重复注入）
2. `NO_JOURNAL_INJECT_TYPES.has(currentGenerationType)` —— `quiet` 类型一律不注入
   （保险丝，兜住其他扩展 / 命令发起的 quiet 生成）
3. `isJournalCardEnabledInPreset()` —— 预设里卡片被关掉 → 空串

> ⚠️ 第 2 步用**黑名单**而不是白名单。酒馆的 type 还有 `swipe` / `regenerate` / `continue`，
> 那些都是「主聊天正在生成回复」，日记理应照常在场。写成白名单（只放行 `normal`）
> 会把「重 roll」也一起挡掉，症状比原问题更隐蔽。

### 3.2 状态栏

```
MESSAGE_RECEIVED ─→ onCharacterMessageReceived()
                          │
                          ▼
              parseAndStripStateTags()      ← 三层准入（§4.4）
                          │
                ┌─────────┴─────────┐
                ▼                   ▼
        更新 chatMetadata     从正文剥掉「已接受」的标签
        .roleExpansion.state
                │
                ▼
   applyStateInjection() → setExtensionPrompt(key, text, 1 /*in-chat*/, depth, false, role)
```

状态存在 `chatMetadata.roleExpansion.state`，**不写回角色卡**。

---

## 4. 关键实现细节

### 4.1 运行时提示词源

```js
registerRuntimePromptSource('roleExpansionJournal', getContent, {
    name: '角色扩展（日记）',
    edit: true,      // 允许用户改卡片正文预览
    toggle: true,    // 允许用户开关卡片
});
```

- **注册时机**：模块求值时立刻注册，不等 `APP_READY` —— 否则首屏那次生成拿不到正文
- 注册成功后主动补一次 `promptManager.render()`，让首屏就有铅笔 / 开关图标
- `identifier` 硬编码为 `roleExpansionJournal`；预设里那张卡片的 `identifier` 必须一致

**扩展对预设是只读的**：不创建、不修改、不移动卡片，也不调用 `/api/presets/save`。
只做两件事：提供正文 + 读取 `prompt_order` 里的 `enabled`。

### 4.2 生成通道与角色卡

| 通道 | 接口 | 请求内容 | 角色卡怎么来 |
| --- | --- | --- | --- |
| 隔离（默认） | `generateRaw` | 一条 `user` 消息 = 日记提示词；角色设定非空时另加一条 `system` | **扩展自己拼**（`buildJournalCharacterBlock()`） |
| 回退 | `generateQuietPrompt({ quietToLoud: false, skipWIAN: true })` | 完整 system 提示词组 + 整条主聊天记录 | **预设卡片提供，扩展不要再拼** |

> ⚠️ 这两行的「角色卡」列是**相反**的。回退通道走完整的 promptManager 管线，
> 预设里的 `charDescription` / `personaDescription` / `scenario` 卡片本来就会注入；
> 隔离通道不经过 promptManager，所以必须自己补。
> 早期版本在两条通道上都拼，结果是回退通道角色卡重复注入。

**角色设定块**（`buildJournalCharacterBlock()`）：

- 三个独立开关：`journalCardProfile`（描述 + 性格）、`journalCardPersona`、`journalCardScenario`
- 顺序固定：**角色描述 → 性格 → 用户设定 → 场景**，整块作为 `systemPrompt` 排在提示词之前
  （`createRawPrompt()` 会把它 `unshift` 成一条 `system` 消息）
- 空字段**跳过**，不留空标题；三项全关或角色卡为空时**不传** `systemPrompt`（请求与旧行为一致）
- 只取这四项：**不带**角色主提示词覆盖、Post-History Instructions、示例对话 —— 那些属于「预设语境」
- `journalCharacterCardOverride` 非空时**整体接管**，且优先于三个开关（见 §8）

`getCharacterCardFields()` 的返回值**已经过 `baseChatReplace()`**（`{{char}}` / `{{user}}` 已换真名），
**不要**再 `substituteParams()` 一遍。

### 4.3 会话隔离存储

**文件名**（`currentChatIdentity()`）：

```
RoleExpansion_journal_c_<角色hash8>_j_<会话hash8>.jsonl
```

为什么这么畸形：`/api/files/upload` 的 `validateAssetFileName` 只接受单段 ASCII
（原始正则 `^[a-zA-Z0-9_\-.]+$`），而且**没有任何接口能创建子目录**。
所以用「扁平名 + 前缀」模拟层级，**真实角色名 / 会话名记在文件首行的会话头里**。

**jsonl 结构**：

- 第 1 行：会话头 `{ "__roleExpansion": "session", charDir, chatFile, charSlug, fileName, … }`
- 之后每行：`{ "__roleExpansion": "journal", id, title, content, createdAt, updatedAt, charName, userName, chatId, sourceMessageIds, sourceJournalIds, stateSnapshot, meta }`
- 正文里的换行以字面 `\n` 转义保存（`encodeLine()`），保证「一行一篇」不被破坏
- 解析时非法行跳过并计数（`parseJsonl()` → `{ session, entries, skipped }`）

**`chatMetadata` 侧**：

- 状态：`chatMetadata.roleExpansion.state[]`
- 一次性迁移标记：`legacyMigrated`（见 §5 第 4 条）

### 4.4 状态标签三层准入

`isStateTagName(name, isKnownName)`，**顺序绝对不能调**：

1. **已知名称 → 直接放行**（用户自定义的 13 字状态名也必须能更新）
2. 长度闸：`[...name].length > MAX_STATE_NAME_LENGTH`（12）—— **按码点**，不是 UTF-16 code unit
3. 形状闸：含空白 / `-` `.` `/` `\` 的拒绝
4. 黑名单 `NON_STATE_TAGS`：HTML 标签 + 思维链标签（`thinking` / `analysis` …）+ 工具调用标签
5. 其余 → `!isKnownName`（即「只接受已知状态名」开关关闭时才放行）

`parseAndStripStateTags()` 用**游标拼接**而不是 `String.replace(re, '')`：
**只剥离通过准入的标签**，被拒的连同内容原样留在正文里。

### 4.5 UI 构建与折叠约定

- `el(tag, attrs, children)` / `q(selector, root)` 是两个最小 DOM 辅助，**没有框架**
- `section(title, { open })` —— 面板顶层大区块，自带点击处理器（`setOpen`）
- `collapsible(title, { open })` —— 区块内小折叠，**复用酒馆原生 `.inline-drawer` + 文档级委托处理器**

**折叠与行内布局的几条铁律**：

1. **箭头方向全站统一为「收起 `down` ↓ / 展开 `up` ↑」**（酒馆自身的约定）。
   `section()` 与 `collapsible()` 必须同一套 —— 早期 `section()` 用「收起 `→` / 展开 `↓`」，
   与内层冲突：同一个 `↓` 在两个位置含义相反。
   之所以只能改外层：内层走酒馆原生处理器，它写死了 `toggleClass('down up')`，不认 `right`。
2. **初始 `display` 必须显式写死**：`open: true` → `display: block`，`open: false` → `display: none`。
   酒馆的 `.inline-drawer-content` 默认就是 `display: none`，而原生处理器只会 toggle、
   不会替我们补上「展开」。漏了这句就会出现「箭头朝上但内容收着」。
3. **flex 行里的控件必须显式防挤压**（`.roleEx-row` 是不换行的 flex 行，两个坑会叠加）：
   - 行内**文字**子元素会被压到 min-content，中文的 min-content 就是「一个字宽」→ **竖排**。
     当标签用的 `.roleEx-hint` 要加 `.roleEx-inline-label`（`nowrap` + `flex: 0 0 auto`）；
     当说明段落用的（要换行）别加。
   - 酒馆有 `.drawer-content select { width: 100% }`（0,1,1），**比 `.roleEx-num`（0,1,0）更具体**，
     所以面板里的下拉框会被撑成整行宽，把同行后面的控件顶出去。
   两者叠加的后果是：控件**明明在 DOM 里**，却被 `#roleExpansionPanel { overflow: hidden }` 裁掉，
   看不见也点不到 —— 极易被误判成「建完节点忘了挂进 DOM」（§5 第 8 条）。
   实测（1256px 视口）：修复前 `注入深度/注入角色` 标签 12×66 竖排、下拉框 620px、
   整行 803px 挤在 620px 里、「恢复默认」按钮位于 x=1053 而面板右边界 973 → 被裁；
   修复后标签 49×17、下拉框 431px、整行正好 620px、零溢出。
4. **区块展开 / 收起必须有高度过渡，而且要和 `display` 一起过渡**。
   `section()` 的 `setOpen()` 直接写 inline `display`，所以光写 `transition: height` 没用，
   必须带上 `transition-behavior: allow-discrete`；起点靠收起态的 `height: 0`，
   首次显示那一帧靠 `@starting-style`（机制见 §4.7）。
   `collapsible()` 走酒馆原生的 `slideToggle()`，本来就有动画 —— 只有 `section()` 需要我们自己做，
   漏掉的症状是**静默的**：不报错，只是「这块折叠是硬切」。
   实测时长与主面板一致（收起 751→0 约 250ms = `--animation-duration-2x`，35 帧）；
   嵌套在其它 `.roleEx-section-body` 里的区块（日记主提示词 / 状态注入提示词）同样生效。

### 4.6 面板层级：永远在抽屉栈最底层

主面板挂在 `#movingDivs` 下，而 **`#movingDivs` 自身不是层叠上下文**（`position: static` /
`z-index: auto`，酒馆只给它设了 `#movingDivs>div { z-index: 4000 }`）。
所以主面板的 `z-index` 是**拿出去和 `#top-settings-holder` 比大小**的，不是和里面的抽屉比。

| 元素 | z-index | 说明 |
| --- | --- | --- |
| `#top-settings-holder` | **3005** | 顶部所有抽屉的**同一个**层叠上下文：`#WorldInfo`、扩展设置、用户设置、背景…全在里面 |
| 主面板 `#roleExpansionPanel` | **3000** | 低于上面那个 ⇒ **任何展开的顶部抽屉都会盖住本面板** |
| `#chat` / `#sheld` | 30 | 主面板必须压在上面（3000 远大于 30） |

两条推论，改层级前必须清楚：

1. **抽屉是个整体，没有「中间层」可站**。它们在 `#top-settings-holder` 内部按 DOM 顺序互相压
   （`z-index: auto` 的定位元素之间只比顺序），对外则统一是 3005。
   所以要么整体压在上面（`z-index > 3005`，就是旧行为 4000），要么整体让到下面（`< 3005`，现在 3000）——
   做不到「低于 World Info 但高于扩展设置」。
2. **左右侧栏（`#left-nav-panel` / `#right-nav-panel`）也在 holder 里**（局部 `z-index: 3000`），
   因此它们同样在主面板之上。桌面宽度下它们只占两侧、与居中的主面板（`--sheldWidth`）不重叠，
   看不出差别；窄屏会重叠。
   > 面板上那个 `roleEx-panel-over-nav` 类现在**只是个状态标记**（`layoutMainPanel()` 打的），
   > 不再承担「压住侧栏」的职责 —— 层级已经让位给顶部抽屉了。

编辑弹窗 `.roleEx-modal` 是挂到 **`document.body`** 的（z-index 5000），不在这条链路里，
所以它照旧盖在所有抽屉之上。

### 4.7 展开 / 收起过渡

原生抽屉的展开动画是**纯 CSS 的高度离散过渡**，没有 JS 参与：

```css
.drawer-content             { height: 0;                                  /* 收起态 = 起点 */
                              transition-property: height, display;
                              transition-duration: var(--animation-duration-2x);
                              transition-behavior: allow-discrete; }
.drawer-content.openDrawer  { display: block; height: calc-size(auto, size);
                              @starting-style { height: 0; } }
#movingDivs > .drawer-content { height: unset; }     /* ← 只冲掉挂在 #movingDivs 里的面板 */
```

- `calc-size(auto, size)`：把 `height: auto` 变成**可插值**的量
- `transition-behavior: allow-discrete`：让 `display` 的切换也参与过渡（否则直接硬切）
- `@starting-style`：补上「第一次从 `display: none` 显示」那一帧的起点

**本面板正好属于被 `#movingDivs > .drawer-content` 冲掉的那一类**。§4.6 决定了它继续留在
`#movingDivs`（换来最低层级），所以必须自己把那套重写一遍 —— 见 `style.css` 里
`#movingDivs > .drawer-content.roleEx-panel` 的 `height: 0` / `transition-*`，
以及独立的 `@starting-style` 块。

改这里的注意事项：

- **不要**再把 `height: auto` 当基准 —— 那正是原来「展开很生硬」的根因（没有可插值的量，
  `display` 只能是硬切）。收起态的 `height: 0` 才是起点。
- `.openDrawer` 里先声明 `height: auto` 再声明 `calc-size(auto, size)`：老浏览器不支持后者时
  自动退回硬切，而不会把高度搞成 0。
- 时长写 `var(--animation-duration-2x)`（= 酒馆「用户设置」里动画时长的 2 倍，实测默认 250ms），
  **不要写死 ms**，否则用户改动画速度时本面板不跟随。
- 若哪天把它搬进 `#top-settings-holder`（当原生抽屉用），这一整块可以删掉 ——
  上游那套会直接生效。实测两者动画曲线与几何尺寸完全一致。

### 4.8 「默认值」是怎么定义的（存为默认设置 / 恢复默认设置）

```
DEFAULT_SETTINGS                      代码里的内置默认（唯一权威定义）
  └─ customDefaults                   「存为默认设置」的快照，存在扩展设置容器里
       └─ settings                    运行时实际生效的那份（= loadSettings 合并的结果）
```

- **快照存在 `extensionSettings['ST-RoleExpansion_defaults']`，不混进 `settings` 自身。**
  `settings` 会被 `loadSettings()` 的 `Object.assign` 合并、被「恢复默认设置」整体替换，
  把基准塞在里面迟早互相污染。用独立键还有个好处：删掉它就等于回到出厂值，
  `clearCustomDefaults()` 不需要任何额外的标记位（对比 §5 第 4 条那个「一次性迁移标记」的老坑）。
- **`baselineSettings()` = 内置默认打底 + 快照覆盖**，不是直接返回快照。
  否则新版本新增的设置键在「老快照」里不存在，用户一恢复就凭空少一项。
- 三处入口（面板两个按钮 + 控制台）都走同一组函数：
  `saveAsDefaults()` / `resetToDefaults()` / `clearCustomDefaults()`，
  `initExtensionSettingsPanel()` 里只做接线，逻辑不重复。
- `updateDefaultsHint()` 负责把「当前基准是内置值还是你的快照」写在两个按钮下面 ——
  没有这行提示，这两个按钮就是无反馈的（点了不知道成没成）。

---

## 5. 踩过的坑（改代码前必读）

| # | 症状 | 根因 | 现在的防护 |
| --- | --- | --- | --- |
| 1 | 同一个 `↓` 图标一会儿表示展开、一会儿表示收起 | `section()` 用 right/down，`collapsible()` 用 down/up，两套语义并存 | 统一为酒馆的 down/up（§4.5） |
| 2 | 折叠块「箭头朝上但内容收着」 | `open: true` 时没显式设 `display`，CSS 默认 `none` 生效 | `body.style.display = open ? 'block' : 'none'` |
| 3 | 写日记时旧日记被塞回请求（自反馈） | `PRESET_PROMPT.TRIGGER` 是一句**从未被读取**的声明，运行时源不区分生成类型 | `ui.generatingJournal` 主判据 + 类型黑名单保险丝 |
| 4 | 点「清空全部」后旧状态又复活 | 迁移判据只看「本扩展这侧为空」，而清空之后同样是空 | `legacyMigrated` 一次性标记，之后永久停用迁移通道 |
| 5 | 回复莫名少一段 | `parseAndStripStateTags` 用 `replace` 把未通过准入的标签**连同内容**删了 | 游标拼接，只删已接受的标签 |
| 6 | 已知的长状态名收不到更新 | 长度闸排在「已知名单」判据**之前** | 已知名称优先放行 |
| 7 | emoji / 扩展区汉字被算成 2 个字 | `String.length` 是 UTF-16 code unit | 改用 `[...name].length`（码点） |
| 8 | 主提示词编辑框「建了但没 append」→ 功能凭空消失 | 建完节点忘了挂进 DOM | 自测有一条断言检查它真的在面板 DOM 里 |
| 9 | 文件名带中文 / 斜杠被接口拒 | `validateAssetFileName` 只认 `^[a-zA-Z0-9_\-.]+$` | 双 hash + 扁平名，会话名记在文件首行 |
| 10 | 抽屉按钮点了没反应 | 酒馆直接绑定 `.drawer-toggle`，不认后插入的元素 | 自己绑 click + 自己管互斥 |
| 11 | Patch 打了一半，卡片没有开关/铅笔 | 上游文件被覆盖或只应用了部分 hunk | `logMarkerSupport()` 诊断 + 自测读 patch 文件校验关键片段 |
| 12 | 面板展开 / 收起是硬切，很生硬 | `#movingDivs>.drawer-content{height:unset}` 冲掉了酒馆的 `height:0` 起点，本文件又写了 `height:auto`，没有可插值的量 | 自己重写 `height:0 → calc-size(auto,size)` + `allow-discrete` + `@starting-style`（§4.7） |
| 13 | 「状态注入提示词」里的「恢复默认」按钮前端看不见（被当成「建了没 append」） | 不换行的 flex 行溢出：中文标签被压成竖排 + `.drawer-content select{width:100%}` 撑满整行，行宽 803 > 620，尾部被 `overflow:hidden` 裁掉。节点一直都在 DOM 里 | 标签加 `.roleEx-inline-label`、下拉框用 `#roleExpansionPanel select.roleEx-num` 压回可用宽度（§4.5 第 3 条） |

> 第 8、11 条值得单独强调：这个项目的失败模式**常常是静默的** ——
> 不报错、不抛异常，只是"某块 UI 不见了"或"某段内容没进去"。
> 所以自测里大量断言是针对 **DOM 结构与补丁文本**的，而不是只测纯逻辑。

---

## 6. 开发流程

### 6.1 目录与同步

| | 路径 |
| --- | --- |
| 开发仓库 | `E:\酒馆AI聊天杂项\酒馆插件\ST-RoleExpansion` |
| 酒馆安装目录 | `E:\SillyTavern\SillyTavern\data\default-user\extensions\ST-RoleExpansion` |

改完仓库后，把运行必需的文件（`index.js` / `style.css` / `index.html` / `manifest.json`）同步到安装目录，
然后 `Ctrl+F5`，**不需要重启酒馆**。

`CHANGELOG.md` / `package.json` / `.github/` / `.editorconfig` 等只存在于开发仓库，不必同步；
`patches/` 与 `tools/` 留在仓库里即可（`patches/` 是给酒馆本体打补丁用的，不在扩展运行时路径上）。

### 6.2 自测

```bash
npm test                                  # = node tools/smoke-test.mjs
node tools/check-filename.mjs "some name.jsonl"   # 排查文件名校验
```

- 纯 Node，**不需要浏览器、不需要跑酒馆**
- 原理：stub 一个最小 DOM + 酒馆桩 → `await import('../index.js')` →
  通过 `globalThis.roleExpansion` 拿内部 API 做断言
- 结尾会打印 `全部通过（共 N 项断言）`。**N 变了就是有回归**（除非你确实增删了断言）

### 6.3 提交、版本号、CI

- 提交信息用 Conventional Commits：`feat:` / `fix:` / `style:` / `docs:`
- **版本号有 4 处要一起改**：`manifest.json`、`package.json`、`README.md` 的 badge、`CHANGELOG.md` 的标题
- `CHANGELOG.md` 段落顺序：新增 / 变更 / 修复 / 测试（Keep a Changelog 风格）
- push 后 GitHub Actions 跑 Node 18 / 20 / 22 的 `npm test`

---

## 7. 调试入口

`globalThis.roleExpansion`（`index.js` 末尾暴露）：

| 成员 | 用途 |
| --- | --- |
| `settings` / `ui` | 直接查看、修改运行时状态（`ui.journal`、`ui.selectedFloors`、`ui.generatingJournal` …） |
| `logMarkerSupport()` | 打印补丁与卡片支持的完整诊断 |
| `diagnoseJournalCard()` | 卡片为什么不生效（定位到具体缺哪一环） |
| `probeCardControls()` | DOM 上的铅笔 / 开关是否真的渲染出来 |
| `isJournalCardEnabled()` / `readJournalCard()` | 读预设里卡片的状态 |
| `updatePresetCardHint()` | 手动刷新面板上的状态文案 |
| `buildJournalPrompt()` | 打印"此刻会发出去的提示词"（排查模板 / 变量） |
| `openPanel()` / `toggleDrawerState()` / `layoutMainPanel()` | UI 操作 |
| `applyStateInjection()` / `clearLegacyJournalInjection()` | 手动触发注入 |
| `getStateList()` / `splitJournalResponse()` / `currentChatIdentity()` | 纯函数，方便在控制台试 |

浏览器控制台另有 `SillyTavern.getContext()` 可以直接看酒馆侧的上下文。

---

## 8. 已知限制与预留扩展点

| 项 | 现状 |
| --- | --- |
| `journalCharacterCardOverride` | **已预留、无 UI**。非空时整体接管自动抽取的角色设定块，且优先于三个开关。将来做「可编辑覆盖」只需在面板加一个 textarea + 「恢复自动」按钮，数据层不用动 |
| 群聊 | `getCharacterCardFields()` 默认取 `this_chid`，群聊下可能取到空；没有专门处理 |
| 世界书 | 隔离通道**不**带世界书。想带需要手动调 `getContext().getWorldInfoPrompt(chat, maxContext, true)` —— `isDryRun` 必须为 `true`，否则会 emit `WORLD_INFO_ACTIVATED`，污染主聊天的世界书激活状态。第一个参数是**倒序**的消息字符串数组 |
| 多扩展冲突 | `identifier` 硬编码为 `roleExpansionJournal`，与另一个也用同名 identifier 的扩展会撞 |
| i18n | 界面文案全是硬编码简体中文，没走酒馆的 `t()` |
| 旧数据 | `chatMetadata.sillyTavernState` 只迁移一次（`legacyMigrated`），原键保留不删 |

---

## 9. 快速自检清单

改动之后，按这个顺序过一遍：

- [ ] `node --check index.js` —— 语法
- [ ] `npm test` —— 断言数是否还是 244（或你确实改过断言数）
- [ ] 涉及 UI 的改动：`Ctrl+F5` 后在酒馆里实际点一遍（自测的 DOM 是 stub，覆盖不到视觉）
- [ ] 涉及补丁的改动：确认 `patches/st-marker-prompt.patch` 里的关键片段没被动过
- [ ] 版本号 4 处是否一致
- [ ] `git status` —— 有没有忘了提交的改动

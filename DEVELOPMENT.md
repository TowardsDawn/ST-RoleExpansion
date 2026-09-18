# ST-RoleExpansion 开发说明

> 面向**接手开发的人**，以及**新会话的 AI**。
> 功能说明 / 安装步骤 / 用户 FAQ 见 [README.md](README.md)，版本变更见 [CHANGELOG.md](CHANGELOG.md)。
> 本文件只讲「实现是怎么运作的」和「改代码前必须知道什么」。

---

## 0. 三十秒速览

| | |
| --- | --- |
| 是什么 | SillyTavern 前端扩展：**日记（Journal）** + **角色状态栏（State）** + **推特（Twitter）** |
| 形态 | 纯前端原生 ESM，**没有任何构建步骤** —— `index.js` 由酒馆直接 `import`；三个功能都是 `modules/` 下的**可拆模块**（§1.1） |
| 代码规模 | 框架 `index.js` ≈ 1760 行；模块 ≈ 4300 行（twitter 1860 / journal 1830 / state 615）、`style.css` ≈ 800 行、`index.html` 47 行 |
| 运行前提 | SillyTavern ≥ 1.18.0 **且**已应用 `patches/` 下的三份补丁（`st-marker-prompt` → `st-journal-store` → `st-twitter-assets`，顺序不能反） |
| 后端 | 无自有后端。持久化 = `chatMetadata`（状态） + 补丁新增的 `/api/role-expansion/journal/*`（日记 jsonl）与 `/api/role-expansion/asset/*`（模块私有子目录：推特 jsonl + 头像 / 横幅 / 推文配图） |
| 自测 | `npm test` → `tools/smoke-test.mjs`，纯 Node、不需要浏览器（当前 394 项断言）；`npm run test:patch` 另跑两份补丁端点 |

接手时最该先搞明白的三件事：

1. **框架不认识任何模块名**：有哪些模块由 `modules/manifest.json` 决定（§1.1），模块内部细节在 `modules/<id>/DEVELOPMENT.md`。
2. **一切都按会话隔离**：模块的状态要么挂 `chatMetadata`、要么按会话分文件，不要放进全局设置里。
3. **框架只提供两条公共通道**：提示词注入与持久化，模块自己往里接（§3）。

---

## 1. 仓库结构

| 路径 | 作用 | 运行必需 |
| --- | --- | :---: |
| `index.js` | **框架**：设置/存储/抽屉/面板/扩展设置/模块系统，末尾挂 `globalThis.roleExpansion` | ✅ |
| `modules/twitter/` | 推特模块（6 个 js + 自己的 `README.md` / `DEVELOPMENT.md`）；**整个目录删掉 = 没有推特功能** | ⭕ 可拆 |
| `modules/journal/` | 日记模块（6 个 js + 自己的 `README.md` / `DEVELOPMENT.md`）；**整个目录删掉 = 没有日记功能** | ⭕ 可拆 |
| `modules/state/` | 角色状态栏模块（4 个 js + 自己的 `README.md` / `DEVELOPMENT.md`）；**整个目录删掉 = 没有状态栏功能** | ⭕ 可拆 |
| `modules/<id>/README.md` | **模块的用户文档**：怎么用、有哪些开关、有什么限制 | — |
| `modules/<id>/DEVELOPMENT.md` | **模块的开发文档**：文件划分、数据流、实现细节、自己的坑与调试入口 | — |
| `style.css` | 面板样式，选择器一律 `roleEx-` 前缀，避免污染酒馆 | ✅ |
| `index.html` | 酒馆「扩展程序」列表里的设置骨架（**静态**，无脚本） | ✅ |
| `manifest.json` | 扩展元数据；`minimum_client_version: 1.18.0` | ✅ |
| `patches/st-marker-prompt.patch` | 给酒馆打的最小补丁：运行时提示词源 + marker 卡片权限（3 个文件、12 个 hunk） | ⚠️ 需手动应用 |
| `patches/st-journal-store.patch` | 给酒馆打的最小补丁：日记文件读写端点（新增 1 个文件 + 挂载 1 行） | ⚠️ 需手动应用，**改服务端要重启酒馆** |
| `patches/st-twitter-assets.patch` | 给酒馆打的最小补丁：模块私有资源读写端点（新增 1 个文件 + 挂载 1 行） | ⚠️ 同上，且**必须打在 `st-journal-store` 之后** |
| `tools/smoke-test.mjs` | 离线自测：stub DOM + ST 桩 → 加载真 `index.js` | — |
| `tools/patch-endpoint-test.mjs` | 日记端点 e2e：从 patch 抽出端点在 express 沙盒里真跑（可 SKIP） | — |
| `tools/patch-asset-test.mjs` | 资源端点 e2e：读写删 / 覆盖 / 白名单 / 穿越 / 体积上限 | — |
| `tools/check-filename.mjs` | 单文件排查酒馆的文件名校验 | — |
| `examples/preset.example.json` | 示例预设（含 marker 卡片），自测会校验一致性 | — |
| `README.md` / `CHANGELOG.md` | 用户文档 / 版本记录 | — |
| `.github/workflows/smoke-test.yml` | CI：Node 18 / 20 / 22 跑 `npm test` | — |
| `package.json` | `private: true`，只用来定义 `npm test` | — |
| `.editorconfig` / `.gitattributes` / `.gitignore` / `LICENSE` | 仓库配套 | — |

### 1.1 模块系统：推特 / 日记 / 角色状态栏都是「插件的插件」

```
index.js                       框架：kernel + 抽屉/主面板/扩展设置面板 + 模块加载 + 事件分发
modules/manifest.json          **模块清单**（唯一的「有哪些模块」的真相），框架用 fetch 读它
modules/twitter/index.js       描述符（id/title/defaults）+ 组装 + 生命周期
                 store.js      会话身份与 jsonl 编解码 + 头像/横幅/配图的读写
                 stats.js      四个数字（浏览 / 点赞 / 转发 / 评论）的生成与 K 写法
                 capture.js    <推文> / <推文时间> 的解析、剥离与落盘
                 render.js     仿推特页面的整份 HTML（iframe 的 srcdoc，固定高度 + 只滚推文列表）
                 ui.js         推特面板（资料区 / 推文管理 / 解析设置）+ iframe 接线
modules/journal/index.js       描述符（id/title/defaults）+ 组装 + 生命周期
                  storage.js   日记存储层（会话身份 hash、jsonl 编解码）
                  floors.js    楼层（聊天记录）选择
                  generate.js  提示词拼装 + 两条生成通道 + 标题切分
                  inject.js    运行时提示词源 + 预设卡片（只读关联、诊断）
                  ui.js        日记面板 + 编辑弹窗 + 导入导出
modules/state/index.js         描述符 + 组装
               store.js        chatMetadata 读写（按会话隔离）
               inject.js      状态注入 + <名称>值</名称> 标签解析
               ui.js          状态栏面板
```

**设计目标：删掉 `modules/<id>/` 整个目录，插件其余部分照常工作。** 这条是硬约束，
`tools/smoke-test.mjs` 里有一组断言守着它的可验证部分（清单 / 开关 / 空壳不抛）。

四条约定，改模块相关代码前必读：

1. **清单文件驱动 + 动态加载**：框架里只有 `modules/manifest.json` 的路径，
   模块的名录、路径、显示名都在那个 JSON 里（`fetch(MODULE_MANIFEST_URL)` → `data.modules[]`）。
   **加模块 = 改 JSON + 放好目录，不用动 index.js**；删模块 = 删目录（清单不留也无害）。
   逐个 `await import(url)` 且包在 try/catch 里：静态 `import` 会因为一个文件缺失把整个扩展拖垮，
   动态加载失败**只记一行 info**，当作「没装」，继续加载其它模块。
   ⚠️ 清单读不到（最典型：同步时漏了 `modules/` 目录）→ 走**安全网**：按内置 id 列表猜
   `modules/<id>/index.js`，并且**把降级写在控制台 + 扩展设置面板里**（不静默）。
   自测里为此链了一个 `file://` 的 fetch 桩（见 smoke-test.mjs 顶部），被测代码不需要任何 Node 分支。

   模块可选能力（都是「有就用、没有就没有」）：
   `buildPanelSection()` 主面板区块 / `settingsBlock(kernel)` 扩展设置面板区块 /
   `services` 给别人用的服务 / `debug` 控制台入口。
   **扩展设置面板的区块由模块自己建**（框架只提供一个 `#roleEx-setting-module-blocks` 容器），
   所以「模块被拆掉却还挂着一块永远『检测中…』的 UI」这类事在结构上不可能发生。
   一个启用模块都没有时：主面板显示「没有可用模块」空状态、副标题变「（无模块）」、
   设置面板只留框架自己的东西（模块表 / 存为·恢复默认 / 打开面板）。

   > 加一个模块的最短路径：
   > 1) 建 `modules/<id>/index.js`，`export default { id, title, icon, defaults, create(kernel) }`；
   > 2) 在 `modules/manifest.json` 的 `modules[]` 里加 `{ "id": "<id>", "path": "./<id>/index.js" }`；
   > 3) 要框架在某个时机调它的函数，就在 §1.2 的「模块桥接」里加一行转发壳。
   > 只做 1+2 的话它是一个「没有界面、纯服务」的模块，也能被别人 `kernel.service("<id>")` 取用。
2. **加载完成前不能读设置**：`DEFAULT_SETTINGS` 只有框架自己的键（`modules` 开关表），
   模块的 `journal*` / `state*` 默认值由模块的 `defaults` 提供，运行时用 `moduleDefaults()`
   合并。所以 `bootstrap()` 之前是**顶层 await**：`await loadModules()` → `loadSettings()` →
   `activateModules()`（TLA 不会打乱酒馆的 `await import()` 时序，还保住了 §4.1 的首屏约定）。
3. **接口是「同名转发壳」**：框架里保留原调用点（`reloadJournal()` / `applyStateInjection()` …），
   实现在 `index.js` 的「模块桥接」章节里，函数体是 `callModule('journal', 'reloadJournal', …)`。
   模块不在 / 被禁用 / 没实现该函数 → 返回 undefined，**绝不抛**（`callModule` 里兜了 try/catch）。
   所以「模块能拆」靠的就是这层壳，加一个对外函数 = 在壳里加一行。
4. **模块之间只走服务**：`kernel.service('state').buildStateText()`。
   消费方必须自己给安全缺省（日记模块对 `getStateList` 缺省 `[]`、`buildStateText` 缺省 `''`），
   所以状态栏被拆掉时日记只是少一段状态参考，不会炸。反过来状态栏不依赖任何模块。

**启用 / 禁用**：文件在时可以在扩展设置面板的「模块」区块里禁用（存 `settings.modules`），
禁用只影响**是否实例化**（`activateModules()` 跳过），不影响它的设置默认值 ——
否则一禁用再启用，`settings` 里没有它的键，用户改过的配置会被整体覆盖，等于静默丢配置。
**改动刷新页面生效**（模块只在启动时装配一次）。

**排查入口**：`roleExpansion.modules()` 直接给 `[{ id, title, installed, enabled, disabled }]`。
`installed: false` = 目录被拆了；`installed: true & enabled: false` = 文件在但被禁用。

> 每个模块的**用户文档 / 开发文档**在 `modules/<id>/README.md` 与 `modules/<id>/DEVELOPMENT.md`；
> 本文只写框架与模块接口，模块内部（数据流、状态机、自己的坑与调试入口）都在那边。

### 1.2 框架 `index.js` 的章节划分

改动时按注释锚点定位（`// ===...` 分隔）：

| 章节 | 内容 |
| --- | --- |
| 通用工具 | `ctx()` / `el()` / `debounce` / `stableHash` / `renderTemplateString` / `getChatArray` … |
| 设置 | `DEFAULT_SETTINGS`（只剩框架键）/ `loadSettings` / `updateSetting` / **`replaceSettings()`（就地替换，绝不重新绑定，见 §5 第 8 条）** / 自定义默认值 / 废弃键清理 |
| 日记文件存储 | 补丁端点 `/api/role-expansion/journal/*` 的封装（`journalAvailability` / `pathText` / `reasonText` / 读 / 写 / 探针），模块共用所以留在框架 |
| 共享运行时状态 | `ui` 单例：**框架与模块都要读**的运行时事实（`ui.journal` / `ui.generatingJournal` / `ui.currentGenerationType` …）；单模块自用的字段不要往这里塞 |
| DOM 构建 | `el()` / `q()` / `section()` / `collapsible()` / `checkboxRow()` / `ID` |
| UI：顶部抽屉 / 主面板 | 抽屉本体、锁定、与导航面板的关系；面板区块**遍历 `activeModules()`** 挂载 |
| 扩展设置面板 | 卡片诊断槽位 + 模块清单/开关 + 存为/恢复默认 |
| 模块系统 | `MODULE_MANIFEST` / `loadModules` / `activateModules` / `service` / `callModule` / `kernel` |
| 模块桥接 | 框架 → 模块的转发壳（加模块对外函数就加在这里） |
| 事件绑定与启动 | `bindEvents()` / `bootUI()` / `bootstrap()` + `globalThis.roleExpansion` |

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
| `getRequestHeaders()` | 两个补丁端点（`/api/role-expansion/journal/*` 与 `/asset/*`）的 CSRF 请求头 |
| `characters[]` / `characterId` / `groupId` | 落点：头像文件名 → 角色聊天目录；`groupId` 非空 = 群聊 → 日记与推特都不可用（两者共用 `journalAvailability()` 这套判断） |
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

`patches/st-journal-store.patch`（只做新增，不碰任何原生逻辑）：

| 文件 | 改什么 | 为什么扩展自己做不到 |
| --- | --- | --- |
| `src/endpoints/role-expansion.js`（新增） | `POST /journal/get`、`POST /journal/save`：按 `avatar_url` 读写 `<角色聊天目录>/_RoleExpansion/journals/<单段 ASCII 名>`，带 `isPathUnderParent` 双保险与 `write-file-atomic` 原子写 | 前端没有一条接口能写进 `chats/`：`/api/files/*` 只收单段 ASCII 名，`/api/chats/*` 的路径参数会被 `sanitize-filename` 抹掉 `/`（实测 `_journal/meta` → `_journalmeta`） |
| `src/server-startup.js` | 挂一行 `app.use('/api/role-expansion', roleExpansionRouter)` | — |

> 这份补丁提供的是**框架级的存储通道**（框架侧包装成 `readJournalFile` / `writeJournalFile`，写进 `kernel`），
> 当前只有日记模块消费它；端点的校验细节、失败原因表与「不可用时怎么办」见 `modules/journal/DEVELOPMENT.md`。
> **改了这份补丁要重启酒馆主进程。**

`patches/st-twitter-assets.patch`（同样只做新增，**必须打在 `st-journal-store` 之后** —— 它锚定那份补丁往 `server-startup.js` 里加的两行；`st-marker-prompt` 与它没有依赖）：

| 文件 | 改什么 | 为什么扩展自己做不到 |
| --- | --- | --- |
| `src/endpoints/role-expansion-assets.js`（新增） | `POST /asset/{get,save,delete}`：读写 `<角色聊天目录>/_RoleExpansion/<sub>/<name>`，`sub` 与扩展名各有一张白名单，文本按 utf8、图片按 base64，带 `isPathUnderParent` 双保险、文本 16MB / 二进制 8MB 上限 | 前端没有一条接口能写进 `chats/`；`/api/files/*` 还有"单段 ASCII 名"的限制，装不下头像这类二进制 |
| `src/server-startup.js` | 再挂一行 `app.use('/api/role-expansion', roleExpansionAssetsRouter)`（同一个 mount，路由前缀 `/asset`） | — |

> 框架侧包装成 `readAssetText` / `readAssetBinary` / `writeAssetText` / `writeAssetBinary` / `deleteAssetFile`，
> 并进 `kernel`；当前消费方是推特模块（自己的 jsonl + `avatar.png` + `banner.jpg` + 每条推文的配图 `tweet-<id>.<ext>`）。
> 三个补丁的执行顺序是 marker → journal → twitter-assets。

**不打补丁的降级行为**（不会崩，但功能残）：

- 日记注入链断掉（`runtimeSources` 里没有我们的条目）
- 面板上的卡片状态提示显示「补丁不完整」
- `logMarkerSupport()` / `diagnoseJournalCard()` 会在控制台打出具体缺哪一处
- 缺服务端补丁的两个模块会**明确报出来**（都不会静默）：日记面板红字点出 `st-journal-store.patch`、
  推特面板红字点出 `st-twitter-assets.patch`（缺补丁时推特的仿推特页面整块隐藏，资料区照旧能打字但写不进去）

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
| `CHAT_CHANGED` | 清空勾选、重算会话身份、重做状态注入、后台重载日记（不看面板开没开）、`reloadTwitter()` |
| `MESSAGE_RECEIVED` | 先解析并剥离状态标签（`onCharacterMessageReceived()`），再收录推文（`onTwitterMessage()`）—— 两个各自 try/catch，一个抛不影响另一个 |
| `GENERATION_STARTED` | 记录生成类型（旧版酒馆可能没有，缺失时靠 `ui.generatingJournal` 兜底） |
| `OAI_PRESET_CHANGED_AFTER` / `_BEFORE` | 换预设后刷新卡片状态文案、重新确保运行时源 |
| `EXTENSION_SETTINGS_LOADED` | 初始化「扩展程序」设置区 |
| `APP_READY` | 初始化设置区 + 状态注入 + 清历史注入 + 确保运行时源 + 卡片状态 + 后台重载日记 + `reloadTwitter()` |
| `GENERATION_ENDED` / `_STOPPED` | 延迟 200ms 刷新一次卡片状态文案（此时预览数据才建立） |

---

## 3. 数据流总览

框架本身不产生内容，它只提供两条公共通道，模块自己往里接：

| 通道 | 框架提供什么 | 谁在用 |
| --- | --- | --- |
| **提示词注入** | `setExtensionPrompt()` 的包装 ｜ 运行时提示词源（`registerRuntimePromptSource()`，由 marker 补丁提供） | 状态模块 ｜ 日记模块（推特模块**不注入**任何提示词） |
| **持久化** | `chatMetadata`（随聊天走）｜ 补丁端点 `/api/role-expansion/journal/*`（角色聊天目录下的文本）｜ 补丁端点 `/api/role-expansion/asset/*`（模块私有子目录，文本 + 图片） | 状态模块 ｜ 日记模块 ｜ 推特模块 |

每个模块自己的完整数据流、状态机与内部约定，写在 `modules/<id>/DEVELOPMENT.md`：
[`twitter`](modules/twitter/DEVELOPMENT.md) ｜ [`journal`](modules/journal/DEVELOPMENT.md) ｜ [`state`](modules/state/DEVELOPMENT.md)。
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

### 4.2 UI 构建与折叠约定

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
   看不见也点不到 —— 极易被误判成「建完节点忘了挂进 DOM」（§5 第 7 条）。
   实测（1256px 视口）：修复前 `注入深度/注入角色` 标签 12×66 竖排、下拉框 620px，整行 803px 挤在 620px 里
   （当时这一行里还有「恢复默认」按钮，它落在 x=1053、面板右边界 973 → 被裁；那个按钮后来**已删除**，
   现在同一位置上被裁的是深度 / 角色控件）；修复后标签 49×17、下拉框 431px、整行正好 620px、零溢出。
4. **区块展开 / 收起必须有高度过渡，而且要和 `display` 一起过渡**。
   `section()` 的 `setOpen()` 直接写 inline `display`，所以光写 `transition: height` 没用，
   必须带上 `transition-behavior: allow-discrete`；起点靠收起态的 `height: 0`，
   首次显示那一帧靠 `@starting-style`（机制见 §4.4）。
   `collapsible()` 走酒馆原生的 `slideToggle()`，本来就有动画 —— 只有 `section()` 需要我们自己做，
   漏掉的症状是**静默的**：不报错，只是「这块折叠是硬切」。
   实测时长与主面板一致（收起 751→0 约 250ms = `--animation-duration-2x`，35 帧）；
   嵌套在其它 `.roleEx-section-body` 里的区块（日记主提示词 / 状态注入提示词）同样生效。
5. **嵌入内容（`iframe` / canvas）优先「固定高度 + 内部滚动」，不要「按内容量高度」**：
   `setOpen(false)` 写的是 `display: none`，里面的 `iframe` 就没有布局盒（实测
   `contentDocument.documentElement` 的 `clientHeight` 与 `scrollHeight` **全是 0**），
   而 `load` 事件照样会发 —— 在那一刻量高度只能得到 0 或按默认 300×150 视口算出的假值；
   `documentElement.scrollHeight` 还「只增不减」（内容变少也不回落）。
   真要走自适应，必须量 `body` 的 `getBoundingClientRect().height` **并且**挂两个
   `ResizeObserver`（盯元素、盯内容），还要留「量不准也够得到内容」的兜底 —— 能做，但脆。
   推特模块在 `0.7.2`/`0.8.0` 上两次踩这里，最后改成固定高度 + 只滚列表（§5 第 9 条、
   推特模块 DEVELOPMENT §7）。

### 4.3 面板层级：永远在抽屉栈最底层

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

### 4.4 展开 / 收起过渡

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

**本面板正好属于被 `#movingDivs > .drawer-content` 冲掉的那一类**。§4.3 决定了它继续留在
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

### 4.5 「默认值」是怎么定义的（存为默认设置 / 恢复默认设置）

```
DEFAULT_SETTINGS                      代码里的内置默认（唯一权威定义）
  └─ customDefaults                   「存为默认设置」的快照，存在扩展设置容器里
       └─ settings                    运行时实际生效的那份（= loadSettings 合并的结果）
```

- **快照存在 `extensionSettings['ST-RoleExpansion_defaults']`，不混进 `settings` 自身。**
  `settings` 会被 `loadSettings()` 的 `Object.assign` 合并、被「恢复默认设置」整体替换，
  把基准塞在里面迟早互相污染。用独立键还有个好处：删掉它就等于回到出厂值，
  `clearCustomDefaults()` 不需要任何额外的标记位（对比「一次性迁移标记」那个老坑 ——
  它在 [modules/state/DEVELOPMENT.md](modules/state/DEVELOPMENT.md) 的 legacy 迁移一节里）。
- **`baselineSettings()` = 内置默认打底 + 快照覆盖**，不是直接返回快照。
  否则新版本新增的设置键在「老快照」里不存在，用户一恢复就凭空少一项。
- 三处入口（面板两个按钮 + 控制台）都走同一组函数：
  `saveAsDefaults()` / `resetToDefaults()` / `clearCustomDefaults()`，
  `initExtensionSettingsPanel()` 里只做接线，逻辑不重复。
- `updateDefaultsHint()` 负责把「当前基准是内置值还是你的快照」写在两个按钮下面 ——
  没有这行提示，这两个按钮就是无反馈的（点了不知道成没成）。

---

## 5. 踩过的坑（改代码前必读）

**框架侧**（模块侧的坑在各自模块 DEVELOPMENT 里）：

| # | 症状 | 根因 | 现在的防护 |
| --- | --- | --- | --- |
| 1 | 同一个 `↓` 图标一会儿表示展开、一会儿表示收起 | `section()` 用 right/down，`collapsible()` 用 down/up，两套语义并存 | 统一为酒馆的 down/up（§4.2） |
| 2 | 折叠块「箭头朝上但内容收着」 | `open: true` 时没显式设 `display`，CSS 默认 `none` 生效 | `body.style.display = open ? 'block' : 'none'` |
| 3 | 主提示词编辑框「建了但没 append」→ 功能凭空消失 | 建完节点忘了挂进 DOM | 自测有断言检查关键节点真的在面板 DOM 里 |
| 4 | 抽屉按钮点了没反应 | 酒馆直接绑定 `.drawer-toggle`，不认后插入的元素 | 自己绑 click + 自己管互斥 |
| 5 | Patch 打了一半，卡片没有开关/铅笔 | 上游文件被覆盖或只应用了部分 hunk | `logMarkerSupport()` 诊断 + 自测读 patch 文件校验关键片段 |
| 6 | 面板展开 / 收起是硬切，很生硬 | `#movingDivs>.drawer-content{height:unset}` 冲掉了酒馆的 `height:0` 起点，本文件又写了 `height:auto`，没有可插值的量 | 自己重写 `height:0 → calc-size(auto,size)` + `allow-discrete` + `@starting-style`（§4.4） |
| 8 | 「恢复默认设置」之后，模块里的勾选框 / 提示词 / 开关**全部不生效**，而且不报错 | `loadSettings()` 与 `resetToDefaults()` 原先写的是 `settings = 新对象`（重新绑定）。模块在 `create(kernel)` 时把 `get settings()` 解构了一次，手里是**旧对象**，于是永远读不到新值 | 改成 `replaceSettings()`：清空旧键 + `Object.assign` 新内容，**对象身份永远不变**（§1.2 设置行） |
| 7 | 一行里的控件**看不见也点不到**（历史上是「恢复默认」按钮，现在是「注入深度 / 注入角色」），被误判成「建了没 append」 | 不换行的 flex 行溢出：中文标签被压成竖排（min-content = 一个字宽）+ `.drawer-content select{width:100%}` 撑满整行，尾部被 `#roleExpansionPanel{overflow:hidden}` 裁掉。节点一直都在 DOM 里 | 标签加 `.roleEx-inline-label`、下拉框用 `#roleExpansionPanel select.roleEx-num` 压回可用宽度（§4.2 第 3 条） |
| 9 | 默认收起的折叠块里，`iframe` 展开后高度还停在 240px 占位值：第一张配图很高时下面的内容再也看不到 | `section()` 收起是 `display: none` → `load` 那一刻 iframe 没有布局盒，量到 0 就被 `if (height > 0)` 跳过；再叠加 `scrolling="no"` + srcdoc 里的 `overflow: hidden`，内容彻底够不到 | 嵌入块一律**固定高度 + 内容区内部滚动**，父页面不量高度（§4.2 第 5 条）；真要做自适应才用 `ResizeObserver` + 兜底滚动条 |

> 第 3、5 条值得单独强调：这个项目的失败模式**常常是静默的** —— 不报错、不抛异常，
> 只是「某块 UI 不见了」或「某段内容没进去」。所以自测里大量断言是针对 **DOM 结构与补丁文本**的。

> 模块侧的坑（推特的高度/滚动与就地 patch、日记的自反馈注入与存储位置、状态标签误删内容与准入顺序 …）
> 见 `modules/twitter/DEVELOPMENT.md`、`modules/journal/DEVELOPMENT.md` 与 `modules/state/DEVELOPMENT.md` 的「踩过的坑」。
## 6. 开发流程

### 6.1 目录与同步

| | 路径 |
| --- | --- |
| 开发仓库 | `E:\酒馆AI聊天杂项\酒馆插件\ST-RoleExpansion` |
| 酒馆安装目录 | `E:\SillyTavern\SillyTavern\data\default-user\extensions\ST-RoleExpansion` |

改完仓库后，把运行必需的东西同步到安装目录：`index.js` / `style.css` / `index.html` / `manifest.json`，
**以及整个 `modules/` 目录**（模块是运行时的一部分；只同步 index.js 会变成「模块全都没装」）。
然后 `Ctrl+F5`，**不需要重启酒馆**。

`CHANGELOG.md` / `package.json` / `.github/` / `.editorconfig` 等只存在于开发仓库，不必同步；
`patches/` 与 `tools/` 留在仓库里即可（`patches/` 是给酒馆本体打补丁用的，不在扩展运行时路径上）。

> 改了 `patches/*.patch` 之后：在酒馆目录重新 `git apply`（**改服务端的那份还要重启酒馆**），
> 否则前端会按新协议去请求一个不存在的端点 —— 症状是日记面板红字「缺服务端补丁」。

### 6.2 自测

```bash
npm test                                  # = node tools/smoke-test.mjs（不需要酒馆）
node tools/check-filename.mjs "some name.jsonl"   # 排查文件名校验
node tools/patch-endpoint-test.mjs [酒馆根目录]   # 日记端点 e2e（26 项）
node tools/patch-asset-test.mjs   [酒馆根目录]   # 资源端点 e2e（36 项）
```

两个 e2e 脚本都需要酒馆根目录里的 `node_modules`（express / sanitize-filename /
write-file-atomic），找不到就打 `SKIP` 退出 0，所以 CI 上不跑也没关系；它们验证的是
**补丁里的那份端点源码**（直接从 `patches/*.patch` 抽正文），不是另抄一份。

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

## 7. 调试入口（框架侧）

`globalThis.roleExpansion`（`index.js` 末尾暴露）：

| 成员 | 用途 |
| --- | --- |
| `settings` / `ui` | 查看、修改运行时状态（`settings` 是所有模块设置项的合并结果） |
| `modules()` / `moduleManifest()` | 模块清单 / 清单快照（装没装、启没启用、有没有降级） |
| `openPanel()` / `toggleDrawerState()` / `layoutMainPanel()` | UI 操作 |
| `saveAsDefaults()` / `resetToDefaults()` / `clearCustomDefaults()` | 默认值快照（§4.5） |
| `logMarkerSupport()` / `patchPromptManagerFirstRender()` | 运行时提示词源（补丁）的诊断与首屏补渲染 |
| `journalAvailability()` / `probeJournalStorage()` / `journalPathText()` / `journalReasonText()` | 框架侧的日记存储层（模块消费）：能不能写、写到哪、为什么不能 |
| `assetPathText(sub, name)` / `probeAssetStorage(sub)` | 框架侧的模块私有资源层（推特消费）：路径文案 + 只读探针 |
| `reloadTwitter()` / `renderTwitter()` / `describeTwitter()` | 推特模块：重读 / 重画 / 状态快照（模块不在时是空壳） |

各模块自己的入口（日记的 `diagnoseJournalCard()`、状态的 `getStateList()` …）见模块 DEVELOPMENT 的「调试入口」。
浏览器控制台另有 `SillyTavern.getContext()` 可以直接看酒馆侧的上下文。
## 8. 已知限制

| 项 | 现状 |
| --- | --- |
| 多扩展冲突 | 运行时提示词源的 `identifier` 由各模块自己定（日记是 `roleExpansionJournal`）；与另一个用同一 identifier 的扩展会撞 |
| i18n | 界面文案全是硬编码简体中文，没走酒馆的 `t()` |
| 框架不做跨模块状态容器 | 模块之间**只**走 `kernel.service('<id>')`，对方不在时取安全缺省；框架不提供事件总线、也不替模块存数据 |
| 模块自身的限制与预留点 | 见各模块文档的「已知限制」（推特：固定高度一屏、群聊不支持、只收录纯文本推文、数字没有范围校验…；日记：群聊不支持、改名边界、隔离通道只剥成块写的推理…；状态：标签准入、新聊天状态为空…） |
## 9. 快速自检清单

改动之后，按这个顺序过一遍：

- [ ] `node --check index.js` —— 语法
- [ ] `npm test` —— 断言数是否还是 394（或你确实改过断言数）；改了补丁端点再跑一次 `npm run test:patch`
- [ ] 动了模块系统：把 `modules/<id>/` 挪走再跑一次 `npm test`（框架部分应当照常，模块相关断言会红），
      并在酒馆里确认「面板少一块 + 别的功能照常 + 控制台只多一行 info」
- [ ] 涉及 UI 的改动：`Ctrl+F5` 后在酒馆里实际点一遍（自测的 DOM 是 stub，覆盖不到视觉）
- [ ] 涉及补丁的改动：确认三份补丁（`st-marker-prompt` / `st-journal-store` / `st-twitter-assets`）都能 `git apply --check`，
      且后两份的执行顺序没反
- [ ] 版本号 4 处是否一致
- [ ] `git status` —— 有没有忘了提交的改动

# 日记模块开发说明

> 面向改 `modules/journal/` 的人。框架 / 模块系统 / 补丁 / 仓库结构见[主 DEVELOPMENT.md](../../DEVELOPMENT.md)；
> 用户视角见 [README.md](README.md)。本文件只讲这个模块内部**怎么运作**、以及**改之前必须知道什么**。

---

## 0. 文件与职责边界

| 文件 | 职责 | 落在 `create()` 返回面上的函数 |
| --- | --- | --- |
| `index.js` | 描述符（`id` / `title` / `icon` / `defaults`）+ 组装 `rt` + 框架要的两个钩子 | `buildPanelSection()` / `settingsBlock()` / `services`（见 §1.4） |
| `storage.js` | 会话身份、文件名、jsonl 编解码、读写 | `currentChatIdentity` `encodeLine` `parseJsonl` `normalizeEntry` `loadJournalFile` `saveJournalFile` |
| `floors.js` | 楼层枚举与勾选文本拼装 | `listFloors` `isSelectableMessage` `buildChatRangeText` |
| `generate.js` | 提示词拼装、两条生成通道、标题解析、条目落盘与重载 | `buildJournalPrompt` `buildJournalRefText` `buildJournalCharacterBlock` `generateJournalText` `generateJournal` `stripReasoningBlocks` `splitJournalResponse` `guessTitle` `addJournalEntry` `persistJournal` `reloadJournal` `pickedJournals` |
| `inject.js` | 运行时提示词源、预设卡片只读关联与诊断 | `PRESET_PROMPT` `NO_JOURNAL_INJECT_TYPES` `ensureRuntimePromptSource` `runtimeSourceKey` `supportsMarkerPromptCard` `isPromptManagerExposed` `getPromptManager` `isJournalCardEnabledInPreset` `buildJournalInjectionText` `readJournalCard` `adoptCardStateFromPreset` `onJournalSelectionChanged` `clearLegacyJournalInjection` `currentPresetName` `diagnoseJournalCard` `probeStPatch` `probeCardControls` `logMarkerSupport` `rerenderPromptManagerSoon` `patchPromptManagerFirstRender` `runtimeSourceRegistered` `runtimeSourceForId` `promptManagerRenderTimer` `promptManagerFirstRenderPatched` |
| `ui.js` | 面板、列表、编辑弹窗、导入导出、状态文案 | `buildJournalPanel` `renderFloors` `updateFloorSummary` `renderJournalList` `renderJournalStorageHint` `setButtonBusy` `updatePresetCardHint` `describeJournalCard` `openPresetPanel` `editJournalEntry` `deleteJournalEntries` `deleteSelectedJournals` `downloadText` `exportJournalFile` `importJournalFile` |

几条边界：

- **样式不在模块里**。日记用到的选择器全在框架的 `style.css`（`.roleEx-floors` / `.roleEx-floor*` / `.roleEx-entry*` /
  `.roleEx-modal*` / `.roleEx-fold*`，统一 `roleEx-` 前缀）。拆掉模块会留下少量死 CSS，无害。
- 模块**没有**自己的 HTML 模板，也不 `import` 任何酒馆内部模块（一切走 `kernel.ctx()`）。
- 六个文件都是 `export function create...(kernel, rt)`，没有任何文件级副作用；重复调用 `create()` 只有 `inject.js` 的几个
  模块级标记变量会被复用 —— 正常路径下 `activateModules()` 只装配一次。

---

## 1. 模块接口约定

### 1.1 描述符与 defaults

```js
export default {
    id: 'journal',
    title: '日记',
    icon: 'fa-solid fa-book',
    defaults: DEFAULTS,
    create(kernel) { … },
};
```

`DEFAULTS` 里的键**全部属于本模块**（框架的 `DEFAULT_SETTINGS` 只有框架自己的键 + `modules` 开关表；
模块默认值由 `moduleDefaults()` 合并，且**不管模块启没启用都算进来**，避免「禁用再启用时把用户改过的配置整体覆盖」）。

| 键 | 默认 | 面板 UI |
| --- | --- | --- |
| `journalMainPrompt` | 一段中文模板（源码里是字符串数组 `.join('\n')`，全文见模块 README） | ✅ 「日记主提示词」textarea（`debounce` 400ms 保存） |
| `journalInjectToJournal` | `false` | ✅「插入日记系统」 |
| `journalIsolatedGeneration` | `true` | ✅「隔离生成（推荐）」 |
| `journalCardProfile` | `true` | ✅「角色描述 + 性格」 |
| `journalCardPersona` | `true` | ✅「用户设定」 |
| `journalCardScenario` | `true` | ✅「场景」 |
| `journalRefHeader` | `'以下是已有的其他日记，仅供你保持人物口径一致，不要重复其中的内容：'` | ❌ |
| `journalInjectHeader` | `'[以下是 {{char}} 先前写下的日记，属于既有事实，请保持设定与记忆的一致性]'` | ❌ |
| `journalInjectSeparator` | `'\n\n---\n\n'` | ❌ |
| `journalInjectIncludeTitle` | `true` | ❌ |
| `journalCharacterCardOverride` | `''` | ❌ 预留入口，见 §9 |
| `journalFallbackTitle` | `'日记'` | ❌ **事实到不了**：`guessTitle()` 总有非空返回（§4.4） |

`journalMainPrompt` 默认值在 `index.js` 里以**字符串数组 `.join('\n')`** 的形式维护（改的时候别破坏缩进）。
没有 UI 的那几个键只能在控制台改 `roleExpansion.settings`（或模块自己的 `settings` 引用），
改完用「存为默认设置」可以把它们存进基准。

### 1.2 `rt` 与惰性转发

```js
create(kernel) {
    const rt = {};
    rt.storage  = createJournalStorage(kernel, rt);
    rt.floors   = createJournalFloors(kernel, rt);
    rt.generate = createJournalGenerate(kernel, rt);
    rt.inject   = createJournalInject(kernel, rt);
    rt.ui       = createJournalUi(kernel, rt);
    …
}
```

- 每个工厂都收 `(kernel, rt)`；`rt` 是**可变引用**，工厂里只挂文件、跨文件引用写成箭头函数 ——
  所以转发天然绕开创建顺序、也天然允许循环引用。
- 约定写法：`const xxx = (...args) => rt.<key>.xxx(...args);`（**调用时才取**）。
- ⚠️ **两处刻意的「直读」，这就是创建顺序的硬约束**（`index.js` 里的注释也点明了）：
  - `ui.js`：`const PRESET_PROMPT = rt.inject.PRESET_PROMPT;`、`const generateJournal = rt.generate.generateJournal;`
  - `generate.js` / `ui.js`：`const loadJournalFile = rt.storage.loadJournalFile;`、
    `const saveJournalFile = rt.storage.saveJournalFile;`、`const persistJournal = rt.generate.persistJournal;`

  所以顺序必须是 `storage → floors → generate → inject → ui`。把 `rt.x.y` 改成箭头转发，顺序约束就消失。

### 1.3 kernel 注入面（模块实际用到的）

| 分类 | 成员 |
| --- | --- |
| 通用工具 | `clone` `debounce` `uid` `stableHash` `splitLines` `textPreview` `formatTime` `safeName` `slugForFile` `stampForFileName` `pad2` `getChatArray` `renderTemplateString` `logError` `toast` `ctx` |
| ST 相关常量 | `MODULE_NAME` `PROMPT_MANAGER_PREFIX`（`'completion_'`） `EXT_PROMPT_KEY` `EXT_POSITION_IN_CHAT`（`1`） `EXT_ROLE_ASSISTANT`（`2`） `STORAGE.PREFIX`（`'RoleExpansion_journal'`） |
| 设置 | `settings`（kernel 上是 **getter**，永远拿到当前那份） / `updateSetting` |
| 共享运行时 | `ui`（长期同一个对象） |
| 日记存储 | `journalAvailability` `journalPathText` `journalReasonText` `readJournalFile` `writeJournalFile`（都在框架里，因为要用 `getRequestHeaders()` 走 `/api/role-expansion`） |
| DOM | `el` `q` `section` `iconFor` `collapsible` `checkboxRow` |
| 模块系统 | `service` |

> ⚠️ `settings` 与 `ui` 是**长期同一个对象**：工厂里解构出来长期用没问题，但**不要缓存字段快照**
> （`const prompt = settings.journalMainPrompt` 这种，模块被「恢复默认设置」后就失效了）。
> `ui` 里的日记相关字段（都在框架里初始化）：`journal[]`、`selectedJournalIds`、`selectedFloors`、
> `busy`、`generatingJournal`、`currentGenerationType`、`identity`、`journalError`、`journalNotifiedError`。

### 1.4 `create()` 的返回面

```js
return {
    id: 'journal',
    ...rt.storage, ...rt.floors, ...rt.generate, ...rt.inject, ...rt.ui,
    buildPanelSection: () => rt.ui.buildJournalPanel().section.root,
    settingsBlock: () => { … },
    services: {},
};
```

- `buildPanelSection()`：框架 `activeModules()` 挑出有它的模块，把返回的 root `append` 进 `#roleEx-scroll`；
  副标题跟着「实际挂上去的模块」走。模块没了就没有这一块。
- `settingsBlock(kernel)`：由框架 `renderModuleSettingsBlocks()` 追加进 `#roleEx-setting-module-blocks`。
  内容是「日记卡片 · `<code>roleExpansionJournal</code>`」+ 诊断文案 `#roleEx-preset-card-hint`
  + 「打开预设面板」按钮 `#roleEx-setting-open-preset`。
- `services: {}`：**日记不对外提供服务**（它是 `kernel.service('state')` 的消费方）。
  服务登记逻辑在框架：`services` 里的东西会以模块 bag 与平铺名两种粒度注册。
- 名字冲突检查：五个工厂（`storage` / `floors` / `generate` / `inject` / `ui`）展开后**没有重名**，加了新名字要先确认框架转发壳与 `globalThis.roleExpansion` 里没有同名的。
- 框架侧转发壳（叫 `callJournal(...)`）目前覆盖这些名字 —— 模块要保留它们，否则框架的调用点静默变成空操作：
  `ensureRuntimePromptSource` `patchPromptManagerFirstRender` `logMarkerSupport` `updatePresetCardHint`
  `describeJournalCard` `openPresetPanel` `reloadJournal` `renderFloors` `adoptCardStateFromPreset`
  `addJournalEntry` `persistJournal` `buildJournalPrompt` `clearLegacyJournalInjection` `diagnoseJournalCard`
  `isJournalCardEnabledInPreset` `readJournalCard` `probeCardControls` `splitJournalResponse` `currentChatIdentity`。
- ⚠️ 框架的 `bootstrap()` 第一行就调 `currentChatIdentity()`（`ui.identity = currentChatIdentity()`），
  所以 `storage.js` 的 hash 逻辑在扩展启动阶段就会跑一次。

### 1.5 跨模块依赖：只消费 `state`

```js
const buildStateText = (...a) => kernel.service('state')?.buildStateText?.(...a) ?? '';
const getStateList   = (...a) => kernel.service('state')?.getStateList?.(...a) ?? [];
```

状态模块被拆掉 / 禁用时：`{{stateList}}` → `（暂无状态）`，`stateSnapshot` 落 `[]`，不抛。
反向没有依赖（状态模块不引用日记），这也是「两个模块可以互相独立拆掉」的基础。

---

## 2. 数据流

```
勾选楼层（ui.selectedFloors）      ┐
勾选日记（ui.selectedJournalIds）  ├─→ buildJournalPrompt() ← settings.journalMainPrompt 模板
状态列表（kernel.service('state')）┘        （renderTemplateString：先替 {{chatRange}}/{{journalRefs}}/{{stateList}}，
                                             再把剩下的 {{…}} 交给 ctx().substituteParams()）
                                                     │
                                                     ▼
                                     generateJournalText(prompt)   ──→ 模型
                                        ├─ generateRaw（默认：隔离，只带 prompt + 可选 systemPrompt）
                                        └─ generateQuietPrompt（回退：quietToLoud:false, skipWIAN:true）
                                                     │
                                          stripReasoningBlocks()（两条通道都过）
                                                     ▼
              addJournalEntry()：手填标题 ? 用它 : splitJournalResponse() → guessTitle()
                                                     ▼
                     ui.journal.push(entry) → persistJournal() → storage.saveJournalFile()
                                                     │                    （整文件覆盖写）
                                                     ▼
              主聊天生成时：ST 调 getContent() → 三道闸 → buildJournalInjectionText() → 填进那张卡片
```

| 阶段 | 函数 | 要点 |
| --- | --- | --- |
| 楼层收集 | `floors.listFloors()` / `ui.renderFloors()` | 只收 `typeof msg.mes === 'string' && msg.mes.trim() !== ''`；勾选是 `Set<number>`（楼层 index）；每次渲染都剔除已不存在的 index |
| 提示词 | `generate.buildJournalPrompt()` | 三个变量**现算**；模板永远来自 `settings.journalMainPrompt`（没有硬编码后备模板） |
| 生成 | `generate.generateJournalText()` | 通道判定：`settings.journalIsolatedGeneration !== false && typeof c.generateRaw === 'function'` → `generateRaw`；否则 `typeof c.generateQuietPrompt === 'function'` → quiet；两者都没有 → `throw` |
| 入口守卫 | `generate.generateJournal()` | 先 `journalAvailability()`（不可用直接 toast 返回）；再 `ui.busy`（防重入）；再判有没有生成接口；楼层与参考日记都空时 `globalThis.confirm()` 一次 |
| 后处理 | `generate.stripReasoningBlocks()` | 两条通道的返回值都过 |
| 解析 | `generate.splitJournalResponse()` | **只在 `addJournalEntry()` 里、且调用方没给标题时**才调用 |
| 落盘 | `storage.saveJournalFile()` | 每次重写整个文件；失败 throw |
| 注入 | `inject.buildJournalInjectionText()` | ST 每次生成时**现算**，模块不缓存注入文本 |

⚠️ `generateJournal()` 里 `ui.generatingJournal = true` 的复位在 `try/finally` 内层：
中途报错也必须复位，否则**日记会从此再也注入不进去，而且没有任何提示**（见 §7 第 3 条）。

---

## 3. 会话身份、文件名与落盘

### 3.1 `currentChatIdentity()`

```js
const chatId = typeof ctx().getCurrentChatId === 'function' ? ctx().getCurrentChatId() : '';
const charName = ctx().name2 || ctx().characters?.[ctx().characterId]?.name || 'Character';
const raw = String(chatId).trim() ? String(chatId).replace(/\.jsonl$/i, '') : `__noid__/${charName}`;
const parts = raw.split('/');
const chatFile = parts.pop() || raw;               // 最后一段 = 会话文件
const charDir  = parts.pop() || charName;          // 倒数第二段 = 角色目录
const charKey = stableHash(charDir).slice(0, 8);                   // c_<8hex>
const chatKey = stableHash(`${charDir}/${chatFile}`).slice(0, 8);  // j_<8hex>
const fileName = `RoleExpansion_journal_c_${charKey}_j_${chatKey}.jsonl`;
return { id: raw, charDir, chatFile, charSlug: `c_${charKey}`, fileName };
```

- `stableHash` 是框架的 FNV-1a 32bit（hex，8 位），跨会话可重现。**hash 只与「角色名 + 会话名」有关，与目录无关** ——
  所以从 `user/files/` 搬到 `chats/<角色>/_RoleExpansion/journals/` 时文件名不变（迁移命令见模块 README）。
- chatId 拿不到（没有 `getCurrentChatId`）时退化为 `__noid__/<name2>`：此时 `charDir` 是 `__noid__`、`chatFile` 是角色名；
  同一角色的所有会话会落到同一个文件，属于已知边界。
- 返回值里**没有** `path`：目录由服务端按 `avatar_url` 推导，客户端不参与。
- 会话头里记录了 `charDir` / `chatFile` / `charSlug`，可读信息不丢。

### 3.2 落盘格式（`saveJournalFile()`）

```text
第 1 行  {"__roleExpansion":"session","version":1,"chatId":<identity.id>,"charDir":…,
          "chatFile":…,"charSlug":…,"savedAt":<ms>,"count":<N>}
第 2..N 行  {"__roleExpansion":"journal","id":…,"title":…,"content":…,"createdAt":…,"updatedAt":…,
            "charName":…,"userName":…,"chatId":…,"sourceMessageIds":[…],"sourceJournalIds":[…],
            "stateSnapshot":[…],"meta":{…}}
```

> ⚠️ 会话头里**没有** `fileName` 字段：`fileName` 只活在 `currentChatIdentity()` 的返回值里
> （早期文档常把它误写进会话头，改文档时别再照抄）。
> `exportJournalFile()` 写的会话头又是另一个变体：没有 `charSlug`、多了 `exportedAt`（对应 `saveJournalFile()` 的 `savedAt`）。

- `normalizeEntry()` 强制补全所有字段（`id` 缺失才 `uid()`，`createdAt` 缺失才 `Date.now()`，
  其它非字符串/非数组一律给空值），**读取与新增都会过一遍**。
- `sourceMessageIds` = 生成时勾选的楼层 index（升序 `Array.from(...).sort()`）；`sourceJournalIds` = 当时勾选的参考日记 id；
  `stateSnapshot` = `clone(getStateList())`（那一刻的快照，跟后续状态变化无关）。
- `encodeLine(obj) = JSON.stringify(obj).replace(/\r?\n/g, '\\n')`：`JSON.stringify` 本来就会转义字符串里的换行，
  这层 replace 是防「对象里混进裸换行」的保险。
- `parseJsonl(text)` 是**宽松**的：`__roleExpansion === 'session'` 的行当会话头（只留最后一个），
  有 `content: string` 的行当条目，其余与 JSON 解析失败都进 `skipped` 计数（`loadJournalFile()` 会 toast 一次）。
- **写 = 整文件覆盖写**（不是追加）。`ui.journal` 是内存里的真身：写失败时内存已经改了，只有 Toast 报错。
- 没有写队列：同一会话并发写就是「后写覆盖先写」。

### 3.3 端点与失败原因

框架的 `journalRequest(route, body)` 打 `POST /api/role-expansion/journal/<get|save>`，
body = `{ avatar_url, file_name }`（save 再加 `text`），请求头走 `ctx().getRequestHeaders()`。
模块拿到的只有 `{ ok, reason }` / `{ ok, text, exists }`。reason 全表：

| reason | 触发 | 文案（`journalReasonText()`，UI 与 Toast 共用） |
| --- | --- | --- |
| `group` | `ctx().groupId` 非空（`journalAvailability()`，**本地判**，不发请求） | 群聊不支持日记：日记按角色目录存放，群聊没有角色目录。 |
| `no-character` | 拿不到 `ctx().characters[characterId].avatar`（本地判） | 还没有选择角色（角色目录未知）。 |
| `patch-missing` | 端点回 **404**（酒馆对未知 `/api` 路由回 HTML） | 缺服务端补丁：对酒馆执行 `git apply patches/st-journal-store.patch` 并重启… |
| `invalid-path` | 服务端回 **400** | 服务端拒绝了日记路径（文件名或角色头像名不合法）。 |
| `too-large` | 服务端回 **413** | 日记文件超过服务端上限（16MB）。 |
| `network` | `fetch` 抛错 | 日记接口请求失败（网络错误）。 |
| `http-<code>` | 其它非 2xx | 走 `default:` 分支 → `日记读写失败：http-<code>` |
| `bad-response` | 2xx 但 `resp.json()` 抛错 | 同上（`default:` 分支） |

> 这张表以源码为准：后两条（`http-*` 之外的 `no-character` / `bad-response`）最容易在写文档时漏掉。

错误状态怎么落地：

- `ui.journalError` = 最近一次读写的 reason（成功时置 `null`）。列表为空时它决定显示原因还是「本会话还没有日记。」
- `ui.journalNotifiedError` = 最近一次**已经弹过** Toast 的 reason。`reloadJournal()` 只在 reason 变化时弹一次
  （切会话、生成后都会 reload，否则会反复弹）；`error` 变 `null` 时同步清空。
- 写失败：`saveJournalFile()` 直接 `throw new Error(journalReasonText(res.reason))`，
  由 `persistJournal()`（catch 后 toast）或 `generateJournal()` 的 catch 兜住。
- `reloadJournal()` 还会把「文件里已经不存在的日记 id」从 `ui.selectedJournalIds` 里剔掉。

### 3.4 「不回退」是设计决定

- 旧版本把日记写在 `user/files/` 根目录（扁平名 + 前缀模拟层级），走 `/api/files/*`。0.5 起整条路撤掉：
  `patch-missing` 时宁可直接报错，也不悄悄写到别处；`group` 时也不去试 `group chats/`。
- 自测里有断言**禁止源码再次出现 files 写入接口调用**，并检查端点前缀还在（`tools/smoke-test.mjs`）。
- 审计点：`probeJournalStorage()` 只读一个必然不存在的探针文件（`RoleExpansion_journal_probe.jsonl`），
  用来区分「补丁缺失」与「角色目录不可达」。

---

## 4. 生成的两条通道

| 通道 | 触发条件 | 调用 | 角色卡 |
| --- | --- | --- | --- |
| 隔离（默认） | `settings.journalIsolatedGeneration !== false` **且** `typeof ctx().generateRaw === 'function'` | `generateRaw({ prompt, systemPrompt? })` | **扩展自己拼**（`buildJournalCharacterBlock()`） |
| 回退 | 隔离关掉、或 `generateRaw` 不存在 | `generateQuietPrompt({ quietPrompt: prompt, quietToLoud: false, skipWIAN: true })` | **预设卡片提供，扩展不要再拼** |

### 4.1 为什么两条通道对角色卡的处理**相反**

- 回退通道 `generateQuietPrompt` 走完整的 promptManager 管线：请求里带着整条主聊天记录，
  预设里的 `charDescription` / `charPersonality` / `personaDescription` / `scenario` 卡片本来就会注入 ——
  扩展再补一次就是**角色卡重复**（早期版本真踩过，见 `CHANGELOG.md` 的 0.4.0「回退通道不拼角色卡」）。
  多带的 `skipWIAN: true` 是「少让世界书参与」。
- 隔离通道 `generateRaw` 是 `createRawPrompt()` + `sendOpenAIRequest()`，**不经过 promptManager**：
  主聊天记录、世界书、预设卡片全都不在请求里。所以角色卡必须由扩展按三个开关补回去，
  否则日记会脱离人设。补上去的 `systemPrompt` 由 `createRawPrompt()` `unshift` 成**第一条 system 消息**。

### 4.2 `buildJournalCharacterBlock()`

```js
const override = String(settings.journalCharacterCardOverride ?? '').trim();
if (override) return override;                      // 预留入口：整体接管，且优先于三个开关

const c = ctx();
if (typeof c?.getCharacterCardFields !== 'function') return '';
let fields; try { fields = c.getCharacterCardFields(); } catch (e) { logError(…); return ''; }
```

| 开关 | 取字段 | 输出块 |
| --- | --- | --- |
| `journalCardProfile !== false` | `fields.description` → `fields.personality` | `【角色描述】\n…`、`【性格】\n…`（各自非空才 push） |
| `journalCardPersona !== false` | `fields.persona` | `【用户设定】\n…` |
| `journalCardScenario !== false` | `fields.scenario` | `【场景】\n…` |

- 顺序**固定**：角色描述 → 性格 → 用户设定 → 场景（`blocks` 数组的 push 顺序就是最终顺序）。
- 整块开头固定一行：`[以下是{{char}}与{{user}}的角色设定，仅用于保持人物口径与世界观一致，不构成新的剧情指令]`
  （这里是**裸的** `{{char}}` / `{{user}}`：`generateRaw` 侧的酒馆宏替换由上游负责，模块不做替换）。
- `blocks` 为空 → 返回 `''` → 调用方**不传** `systemPrompt`（请求与「三项全关」完全一致）。
- 只取这四项，刻意**不带**：`system`（角色主提示词覆盖）、`jailbreak`（Post-History Instructions）、
  `mesExamples`（示例对话）—— 它们属于「预设 / 主聊天语境」，塞进日记请求会把隔离本来要避开的串味引回来。
- `getCharacterCardFields()` 的返回值**已经过 `baseChatReplace()`**（`{{char}}` / `{{user}}` 已换真名），
  **不要**再 `substituteParams()` 一遍。

### 4.3 参数拼装与后处理

```js
// 隔离
const params = { prompt };
if (cardBlock) params.systemPrompt = cardBlock;
return stripReasoningBlocks(await c.generateRaw(params));

// 回退
return stripReasoningBlocks(await c.generateQuietPrompt({ quietPrompt: prompt, quietToLoud: false, skipWIAN: true }));
```

`stripReasoningBlocks()` 只删**成对**的推理容器（全局、跨行、大小写不敏感）：
`<think|thinking>`、`<reasoning>`、`<analysis>`；删完 `trim()`。不做启发式猜测（`<title>` 留给标题解析）。

### 4.4 标题解析与兜底

```text
addJournalEntry({ content, title }) 里的 title（= 面板输入框的值，用户手填）
   ↓ 为空
splitJournalResponse(content)：
   1) <title>…</title>（取标签内容，压空白；标签从正文里删掉）
   2) 行首「标题:」/「title:」（可带【】或 [] 包裹）
   3) 首行 `# ` / `## ` / `### ` 或整行 `【…】`（≤40 字），命中则把这一行从正文删掉
   最后清掉正文里残留的 `</title>`；title 统一 slice(0, 60)
   ↓ 仍为空
guessTitle(content, now)：首行 `# 标题` → 本地时间 `M月D日 HH:MM`（slice(0,60)）
   ↓
entry.title = entryTitle || settings.journalFallbackTitle
```

- `guessTitle()` 总返回非空（日期分支兜底），所以 `journalFallbackTitle` **实际到不了**。
- 手填标题**优先于**模型给的 `<title>`，且手填时不调用 `splitJournalResponse()` ——
  因此正文里若还留着 `<title>`…`</title>`，**不会**被剥掉（除非你在面板里改过它）。
- `createdAt` / `updatedAt` 都是 `Date.now()`（同一时刻），`updatedAt` 在编辑时单独刷新。
- `addJournalEntry()` 落库后：`persistJournal()` → `renderJournalList()` → toast「已写入日记：<标题>」；返回 entry。

---

## 5. 注入机制（只读关联）

### 5.1 注册运行时正文源

```js
ctx().registerRuntimePromptSource(PRESET_PROMPT.ID, getContent, {
    name: PRESET_PROMPT.SOURCE_NAME,   // 预设卡片「正文来源」处显示
    edit: true,                        // 放开铅笔（名称/身份/触发器/位置 + Prompt List 预览）
    toggle: true,                      // 放开卡片上的启停开关
});
```

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `PRESET_PROMPT.ID` | `'roleExpansionJournal'` | 预设里的 `identifier` 必须一致 |
| `PRESET_PROMPT.NAME` | `'日记（角色扩展）'` | 诊断文案里贴给用户的 JSON 用 |
| `PRESET_PROMPT.SOURCE_NAME` | `'角色扩展（日记）'` | 卡片「正文来源」显示名 |
| `PRESET_PROMPT.ROLE` | `'assistant'` | **没有任何读取点**（老版本此处叫 `TRIGGER`，同样是假声明；自测里已有断言禁止它回来） |
| `NO_JOURNAL_INJECT_TYPES` | `new Set(['quiet'])` | 类型黑名单，见下 |

- 注册是**一次性**的：`runtimeSourceRegistered` + `runtimeSourceForId === runtimeSourceKey(ID)` 双重记忆；
  `runtimeSourceKey()` = `String(identifier).replace(/\W/g, '_')`，与 ST 侧把非单词字符换 `_` 的处理对齐。
- 注册失败（`registerRuntimePromptSource` 不是函数 / 抛错）→ 返回 `false`，由框架的 `registerRuntimeSourceEarly()`
  每 **250ms** 重试、最多 **20** 次，最后 `logMarkerSupport()` 打诊断。
- 框架在 `bootstrap()` 一开始就调（不等 `APP_READY`），因为酒馆的预设列表**第一次渲染早于扩展求值**。

### 5.2 `getContent()` 的三道闸（顺序不能乱）

```js
if (ui.generatingJournal) return '';                                    // ① 主判据：本插件自己在写日记
if (NO_JOURNAL_INJECT_TYPES.has(ui.currentGenerationType)) return '';   // ② 保险丝：quiet 一律不注入
if (!isJournalCardEnabledInPreset()) return '';                         // ③ 唯一开关：预设卡片
return buildJournalInjectionText();
```

- ① 挡的是「写日记的那次请求」：不挡的话旧日记会被当作 system 塞回写日记的请求（自反馈），
  并且会和提示词里的 `{{journalRefs}}` 重复注入。标志位由 `generateJournal()` 的 `try/finally` 保证复位。
- ② 用**黑名单**而不是白名单是刻意的：ST 的 type 还有 `swipe` / `regenerate` / `continue`，
  那些都是「主聊天正在生成回复」，日记理应照常在场；只放行 `normal` 会把「重 roll」也挡掉，症状更隐蔽。
  `ui.currentGenerationType` 由框架的 `GENERATION_STARTED` 处理器写入（事件缺失时保持 `'normal'`）。
- ③ 返回空串就等于「卡片没内容」，ST 侧会跳过（补丁的 `addToChatCompletion` 也不 push）。

### 5.3 `isJournalCardEnabledInPreset()`

```js
const pm = getPromptManager();                 // ctx().promptManager ?? null
if (!pm?.configuration) return false;
const own = entryFor(pm.activeCharacter);      // pm.getPromptOrderEntry(character, PRESET_PROMPT.ID)
if (own) return own.enabled !== false;
const dummyId = pm.configuration.promptOrder?.dummyId;
const dummy = dummyId === undefined || dummyId === null ? null : entryFor({ id: dummyId });
if (dummy) return dummy.enabled !== false;     // 角色没有独立 order 时生成实际用的是 dummy
return false;                                  // 两处都查不到 = 卡片没插进任何 prompt_order 块
```

- `entryFor()` 对「character 为 null / id 为 null / 抛错」一律返回 `null`（当成没查到，不是启用）。
- `enabled !== false`：字段缺失也算启用（与 ST 的语义一致）。
- 这是**唯一**的注入开关，模块**从不写回**；勾选变化只刷新界面（`onJournalSelectionChanged()` →
  `renderJournalList()` + `updatePresetCardHint()`），marker 模式下预设里始终保持空白。

### 5.4 拼装注入文本

```js
const header = renderTemplateString(settings.journalInjectHeader, {});   // 只走酒馆宏（{{char}}/{{user}}）
const body = picked.map(e => settings.journalInjectIncludeTitle && e.title
        ? `【${e.title}】\n${e.content}` : e.content)
    .join(settings.journalInjectSeparator || '\n\n---\n\n');
return `${header}\n\n${body}`;      // picked 为空 → ''
```

`pickedJournals()` = `ui.journal.filter(e => ui.selectedJournalIds.has(e.id))`（保留文件顺序，不再排序）。

### 5.5 首屏时序与补渲染

- 时序（酒馆 `script.js`）：`initOpenAI()` → `setupChatCompletionPromptManager()` → **预设列表第一次渲染**；
  `initExtensions()` 此刻才求值扩展、才注册运行时源 ⇒ 首次渲染查不到授权，那一行没有铅笔/开关；
  列表只在 `CHAT_LOADED` / 发消息 / 切预设等事件里重渲染 ⇒ 表现成「必须先打开一次会话」。
- `patchPromptManagerFirstRender()`（框架注册成功后调，`promptManagerFirstRenderPatched` 保证只做一次）：
  1. `rerenderPromptManagerSoon()`：清掉 `promptManagerRenderTimer`，**350ms** 后 `pm.render(false)`（纯展示）；
  2. **1500ms** 后 `probeCardControls()` 复查 DOM，`listRendered && found && (!edit || !toggle)` 才再补一次（有上限）。
- 换预设（`OAI_PRESET_CHANGED_BEFORE/_AFTER`）与 `GENERATION_ENDED` / `GENERATION_STOPPED` 后会
  `ensureRuntimePromptSource()` + `adoptCardStateFromPreset()` + `updatePresetCardHint()`，只刷新文案。
- `adoptCardStateFromPreset()` 有提前返回：`!pm.serviceSettings` 或 `!pm.getPromptById(ID)` 时什么都不做。

### 5.6 诊断函数（全部只读）

| 函数 | 看什么 |
| --- | --- |
| `supportsMarkerPromptCard()` | `typeof ctx().registerRuntimePromptSource === 'function'`（`openai.js` 补丁在不在） |
| `isPromptManagerExposed()` | `!!ctx().promptManager`（`st-context.js` 补丁在不在） |
| `getPromptManager()` | `ctx().promptManager ?? null` |
| `probeStPatch()` | 读**浏览器里正在跑的那份** `PromptManager.prototype` 的方法源码：`isPromptToggleAllowed` 是否含 `getRuntimePromptPermissions`、`isPromptEditAllowed` 是否含 `getExtensionPromptSourceName`、实例上的 `handleInspect` 是否含 `getRuntimePromptPreviewSource` |
| `probeCardControls()` | 直接查 DOM：`#completion_prompt_manager_list` 里 `li[data-pm-identifier="roleExpansionJournal"]` 有没有 `.prompt-manager-edit-action` / `.prompt-manager-toggle-action`，行 class 里有没有 `completion_prompt_manager_prompt_disabled` |
| `diagnoseJournalCard()` | 上面全部 + `existsInPrompts` / `promptKeys` / `marker` / 每个 `prompt_order` 块里的 `{ character_id, index, enabled, prev, next }`，最后 `console.info` |
| `describeJournalCard()` | 一次算出两份文案：`status`（主面板一行）与 `detail`（扩展设置面板完整诊断） |
| `logMarkerSupport()` | 把上面几项汇总成一条 `console.info` / `console.warn`（含「该 Ctrl+F5 还是该重新 apply 补丁」的指向） |

**为什么权限与控件要分开报告**：`probeStPatch()` 只能证明方法源码是新的，证明不了「屏幕上这一行是用带授权的那份代码
渲染出来的」；首屏缺控件是渲染时机问题，不是权限问题。

### 5.7 旧注入的清理

```js
ctx().setExtensionPrompt(EXT_PROMPT_KEY.JOURNAL_MAIN /* 'RoleExpansion_JournalMain' */, '', 1, 0, false, 2);
```

框架在 `APP_READY` 调一次 `clearLegacyJournalInjection()`。旧版本走过 `setExtensionPrompt` 兜底；
现在注入完全由预设卡片负责，这里只负责把可能残留的那一条清掉，避免同一段日记被注入两次。

---

## 6. UI 结构

```
section('日记', { open: true })        #roleEx-journal-section（icon: fa-solid fa-book）
├─ block #roleEx-inject-block          「提示词注入」+ #roleEx-inject-status（一行状态）
├─ block #roleEx-new-journal-block     「新日记」
│   ├─ #roleEx-journal-title           标题输入（placeholder「留空则由模型生成标题」）
│   ├─ #roleEx-generate-journal        「生成日记」按钮（+ 说明「用当前 API 独立生成，不动主聊天」）
│   ├─ checkboxRow                     「隔离生成（推荐）」
│   ├─ collapsible #roleEx-card-fold   『角色设定（隔离通道）』（默认收起）+ 3 个 checkboxRow
│   └─ collapsible #roleEx-floors-fold 『参考聊天楼层』（默认展开）
│        ├─ 快捷行（最近 10 楼 / 全选 / 清空 / 刷新楼层）
│        ├─ 区间行（#roleEx-floor-from / #roleEx-floor-to / #roleEx-floor-range-apply）
│        ├─ #roleEx-floor-summary
│        └─ #roleEx-floors             楼层复选框列表
├─ block                               「日记列表」外层容器
│   └─ collapsible #roleEx-journal-fold 『日记列表』（默认展开）
│        ├─ #roleEx-inject-journal     「插入日记系统」（第一行）
│        ├─ #roleEx-storage-hint       计数 + 落点 / 原因（white-space: pre-line）
│        ├─ #roleEx-storage-note       存储说明（html）
│        ├─ #roleEx-journal-list       条目列表
│        └─ 工具行                     #roleEx-select-all / #roleEx-clear-all / 导出 / 导出所选 / 导入 / 删除所选
└─ section('日记主提示词（可自由修改）', { open: false }) → #roleEx-journal-main-prompt（textarea rows=8）
```

约定与坑：

- 外层 `section()`（框架自建，高度过渡 + 显式 `display`）与内层 `collapsible()`（酒馆原生 `.inline-drawer`）**箭头语义必须统一**
  「收起 ↓ / 展开 ↑」；`collapsible()` 自己会把初始 `display` 写死，别指望 CSS（主 DEVELOPMENT 的「踩过的坑」第 1、2 条）。
- 勾选状态只放 `ui.selectedFloors` / `ui.selectedJournalIds`：**不进设置、不写文件、不碰预设**。
- `renderFloors()` / `reloadJournal()` 都会剔除失效的选择；`renderJournalList()` 按 `createdAt` **倒序**，
  用 `textPreview(content, 140)`、`formatTime(createdAt)`，底部一行是 `` `${content.length} 字 · 参考 N 楼` ``。
- `updateFloorSummary()` 顺带调 `renderJournalStorageHint()`（楼层变化也会刷新落点行）。
- `setButtonBusy(busy)` 直接改 `#roleEx-generate-journal` 的 `textContent`（`生成中…` / `生成日记`）与 `roleEx-busy` 类。
- 编辑弹窗 `.roleEx-modal` 挂到 `document.body`（不吃面板的 `overflow: hidden`），保存时 `updatedAt = Date.now()`。
- 「仅此篇」「全选」「清空」都只动 `ui.selectedJournalIds` 然后 `onJournalSelectionChanged()`。
- 日记主提示词**没有**单项「恢复默认」按钮（要还原走框架的「恢复默认设置」）。
- 加新的行内控件时注意 `.roleEx-row` 是不换行的 flex：文字标签可能被压成竖排、`select` 会被酒馆的
  `.drawer-content select{width:100%}` 撑满整行，溢出会被面板的 `overflow:hidden` 裁掉（主 DEVELOPMENT 的「踩过的坑」第 7 条）。

### 导入 / 导出

| 函数 | 行为 |
| --- | --- |
| `exportJournalFile(false)` | 全部条目；首行是 `{ __roleExpansion:'session', version:1, chatId, charDir, chatFile, exportedAt, count }` |
| `exportJournalFile(true)` | 只导出 `pickedJournals()`；没有勾选时 toast 提示并返回 |
| 导出文件名 | `` `${slugForFile(charDir,24)}__${slugForFile(chatFile,24)}__${stampForFileName()}.jsonl` ``（纯 ASCII，避免用户再拖回酒馆时被校验拒） |
| `downloadText()` | `Blob([text], { type:'application/x-ndjson;charset=utf-8' })` + 临时 `<a download>`，5s 后 revoke |
| 单篇导出 | `` downloadText(`${safeName(entry.title)}.jsonl`, `${encodeLine(entry)}\n`) `` —— **不带会话头** |
| `importJournalFile()` | 临时 `input[type=file][accept=".jsonl,.json,.txt"]` → `file.text()` → `parseJsonl()` → `globalThis.confirm()` 决定 `append` / `replace` → id 冲突的重新 `uid()` → `persistJournal()` |

- 导入**不校验**首行会话头，也不重写条目里的 `chatId` / `charName` / `userName`（跨会话搬日记后，这些字段仍是旧的）。
- `deleteJournalEntries(ids)`：`confirm('确定删除 N 篇日记？此操作不可撤销。')` → 过滤 `ui.journal` → 清掉对应勾选 → `persistJournal()`。

---

## 7. 踩过的坑（日记相关，已按当前代码核对）

| # | 症状 | 根因 | 现在的防护 |
| --- | --- | --- | --- |
| 1 | 同一个 ↓ 一会儿表示展开、一会儿表示收起 | `section()` 与 `collapsible()` 两套语义并存 | 统一酒馆原生 down/up；日记的四个折叠块都受影响（框架侧的坑，主 DEVELOPMENT 同号） |
| 2 | 折叠块「箭头朝上但内容收着」 | `open: true` 时没显式写 `display`，CSS 默认 `none` 生效 | `collapsible()` 里 `body.style.display = open ? 'block' : 'none'` |
| 3 | 写日记时旧日记被塞回请求（自反馈） | 运行时源不区分生成类型 | `ui.generatingJournal` 主判据 + `NO_JOURNAL_INJECT_TYPES` 保险丝，标志位 `try/finally` 复位（§5.2） |
| 4 | 主提示词编辑框「建了但没 append」→ 功能凭空消失 | 建完节点忘了挂进 DOM | 提示词区必须 `s.content.append(promptSection.root)`；自测有断言检查它真在面板 DOM 里 |
| 5 | 文件名带中文 / 斜杠被接口拒 | ST 的 `validateAssetFileName` 只认 `^[a-zA-Z0-9_\-.]+$` | 双 hash 命名（`c_<8hex>_j_<8hex>`），可读名进会话头（§3.1） |
| 6 | 补丁打了一半：卡片没有开关 / 铅笔 | 上游文件被覆盖或只应用了部分 hunk | `logMarkerSupport()` / `probeStPatch()` / `probeCardControls()` 三层诊断；自测直接读 patch 文件校验关键片段 |
| 7 | 面板展开 / 收起是硬切 | `height:unset` 冲掉了可插值的起点 | 框架自己重写 `height:0 → calc-size(auto,size)` + `allow-discrete`；日记主提示词嵌在 `.roleEx-section-body` 里同样生效 |
| 8 | 行内控件被裁掉（看着像「建了没 append」） | 不换行的 flex 行溢出 + `overflow:hidden` | 同一套 `.roleEx-row` 约定；日记的「第 N ~ M 楼」行加控件时同样要防溢出 |
| 9 | 前端写不进 `chats/` | `/api/files/*` 只收单段 ASCII；`/api/chats/*` 的路径参数过 `sanitize-filename`，`/` 被直接删掉 | 服务端补丁 `/api/role-expansion/journal/{get,save}`；没补丁时明确报 `patch-missing`，不回退（§3.4） |
| 10 | 日记放进 `chats/<角色>/` 会不会被酒馆当聊天列出来 | 酒馆列聊天的三条路径都只 `readdir` 本级、要求 `isFile()` | 落 `_RoleExpansion/journals/` 子目录，酒馆完全看不见 |
| 11 | 角色改名后日记「消失」 | 迁移条件是「旧目录存在**且**新目录不存在」，新目录已存在时整段静默跳过 | 接受这个边界（文件没丢），模块 README 给手动迁移命令 |

> 第 1、2、4、6、7、8 条在框架文档的「踩过的坑」里也有对应条目（**编号不一定相同**，两边各自独立编号）；
> 第 3、5 条是日记特有的。第 9~11 条是这次文档拆分时从旧主文档搬过来的（原统一列表里的日记条目）。
> 曾经还有一条「`PRESET_PROMPT.TRIGGER` 是从未被读取的假声明」——`TRIGGER` 已被删除，
> 自测里有一条断言禁止它回来；现在同一位置上是同样没被读取的 `PRESET_PROMPT.ROLE`（§5.1）。

另外两条本模块特有的、值得记住的：

- **写失败不回滚内存**：`ui.journal` 在 `persistJournal()` 之前就已经改了，写失败只有 Toast；
  再次 `reloadJournal()` 才会回到磁盘上的真实内容。
- **`journalFallbackTitle` 是死键**：`guessTitle()` 的日期分支保证永不为空，所以那个 `||` 永远走不到。

---

## 8. 调试入口

`globalThis.roleExpansion`（框架在 `index.js` 末尾暴露）。属于日记模块的成员（模块被拆掉时**是空壳**：
调用返回 `undefined`，不抛）：

| 成员 | 用途 |
| --- | --- |
| `reloadJournal()` | 重新从文件读取日记，并刷新列表与落点行 |
| `addJournalEntry({ content, title?, sourceMessageIds?, sourceJournalIds?, stateSnapshot? })` | 直接造一篇（会落盘） |
| `persistJournal()` | 手动把 `ui.journal` 写回文件 |
| `buildJournalPrompt()` | 打印「此刻会发出去的提示词」（排查模板 / 变量） |
| `splitJournalResponse(raw)` | 纯函数：`→ { title, content }` |
| `currentChatIdentity()` | 纯函数：`→ { id, charDir, chatFile, charSlug, fileName }` |
| `isJournalCardEnabled()` | = `isJournalCardEnabledInPreset()`，注入的权威开关 |
| `readJournalCard()` | `→ { ok:true, prompt, marker, enabled }`，或 `{ ok:false }` 且 `reason` 为 `'no-manager'` / `'no-card'` |
| `describeJournalCard()` | `→ { status, detail }`（面板那两份文案的原文） |
| `diagnoseJournalCard()` | 卡片在每个 `prompt_order` 块里的真实位置 / 开关（返回面见 §5.6） |
| `logMarkerSupport()` | 打印「ST 补丁是否生效」 |
| `probeCardControls()` | DOM：那一行此刻有没有渲染出铅笔 / 开关 |
| `patchPromptManagerFirstRender()` | 手动再补一次首屏渲染（幂等，只渲染不写预设） |
| `updatePresetCardHint()` | 手动刷新面板上的状态文案 |
| `clearLegacyJournalInjection()` | 清掉旧的 `setExtensionPrompt` 残留 |

框架侧、排查日记常配套用的：

| 成员 | 用途 |
| --- | --- |
| `journalAvailability()` | `→ { ok:true, avatarUrl }` / `{ ok:false, reason }`（`group` / `no-character`） |
| `probeJournalStorage()` | 打一次只读探针，区分「补丁缺失」与「角色目录不可达」 |
| `journalPathText(fileName)` | 落点文案 `chats/<角色>/_RoleExpansion/journals/<文件名>` |
| `journalReasonText(reason)` | reason → 人话（与 UI 共用同一份文案） |
| `modules()` | `→ [{ id, title, installed, enabled, disabled }]`：确认日记模块是被拆了还是被禁用了 |
| `settings` / `ui` | 直接看 / 改运行时状态（`ui.journal`、`ui.selectedFloors`、`ui.selectedJournalIds`、`ui.generatingJournal`、`ui.journalError`） |
| `openPanel()` / `toggleDrawerState()` / `layoutMainPanel()` | UI 操作 |

排查顺序建议：`modules()` 看模块在不在 → `journalAvailability()` / `probeJournalStorage()` 看存储能不能写 →
`logMarkerSupport()` 看补丁 → `diagnoseJournalCard()` 看卡片 → `buildJournalPrompt()` 看发出去的提示词。

---

## 9. 已知限制与预留扩展点

| 项 | 现状 |
| --- | --- |
| `journalCharacterCardOverride` | **已预留、无 UI**。非空时整体接管角色设定块，且优先于三个开关（§4.2）。将来做「可编辑覆盖」只需加一个 textarea + 「恢复自动」按钮，数据层不用动 |
| 群聊 | **日记直接不支持**：`journalAvailability()` 返回 `group`，生成入口拒绝；`getCharacterCardFields()` 默认取 `this_chid`，群聊下可能取到空 |
| 世界书 | 隔离通道**不带**世界书。想带需要手动调 `ctx().getWorldInfoPrompt(chat, maxContext, true)` —— `isDryRun` 必须为 `true`，否则会 emit `WORLD_INFO_ACTIVATED` 污染主聊天的激活状态；第一个参数是**倒序**的消息字符串数组 |
| 多扩展冲突 | `identifier` 硬编码为 `roleExpansionJournal`，与另一个也用同名 identifier 的扩展会撞 |
| chatId 缺失 | `getCurrentChatId()` 拿不到时 `charDir` 是 `__noid__`、`chatFile` 是角色名，同一角色的多个会话会落到同一个文件 |
| 写入 | 整文件覆盖写、无写队列；失败不回滚内存（§3.2 / §7） |
| 标题 | 最长 60 字符；手填标题时不做 `<title>` 剥离（§4.4） |
| 推理剥离 | 只认 `<think>` / `<thinking>` / `<reasoning>` / `<analysis>` 这几种成对标签，别的写法（如三反引号）不处理 |
| i18n | 界面文案全是硬编码简体中文，没走酒馆的 `t()` |

---

## 10. 自测覆盖

`npm test`（= `node tools/smoke-test.mjs`）用 stub DOM + 酒馆桩直接加载真 `index.js`，纯 Node、不需要浏览器。
日记相关断言散在整份脚本里，搜 `journal` / `roleExpansionJournal` / `隔离` 就能定位。覆盖到的：

- **面板结构**：日记外层区块默认展开 / 箭头 up、收起后 down + `display:none`、再点恢复；
  「参考聊天楼层」「日记列表」「角色设定（隔离通道）」都是 `.inline-drawer`（走酒馆原生委托）；
  「角色设定」默认收起；「插入日记系统」是折叠体第一行且紧挨计数行；「提示词注入」排在「新日记」之前；
  「全选」「清空」两个独立按钮（分别勾选全部 / 取消全部）；主提示词编辑框**确实挂在日记面板 section 里**
  且有 `roleEx-open` 切换；存储说明在面板内、不含版本号、指向角色聊天目录
- **楼层与区间**：没有「最近 30 楼」、保留「最近 10 楼 / 全选 / 清空 / 刷新楼层」、新增「选中区间」；
  区间输入框是 `type=number`；空 / 非数字输入不动已有勾选；`1~2` 命中 `{1,2}`；反向 `2~1` 归一化并写回输入框；
  越界区间提示且不改动原选择
- **预设卡片只读**：卡片不存在时 `readJournalCard()` 报 `no-card`、**不创建卡片**、不碰 `prompts` / `prompt_order`；
  手动写入后可读到 `marker` / `enabled`；勾选与刷新状态都不改动预设数组；扩展不会把用户拖动过的卡片挪回原位；
  卡片字段由用户决定，扩展不增删
- **运行时源（注入）**：已注册并返回正文；卡片关闭 → 空串、`isJournalCardEnabled()` 为 false、打开后恢复；
  取消勾选 → 空串，重新勾选 → 恢复；**写日记期间空串、结束后恢复**；`quiet` 空串，而 `swipe` / `regenerate` / `normal`
  照常注入；`NO_JOURNAL_INJECT_TYPES` 只含 `quiet`；`TRIGGER` 假声明不存在；写日记的置位用 `finally` 复位
- **诊断文案**：`promptManagerExposed` / `promptManagerReady` 两种缺失情形给不同提示；补丁旧版提示指向
  `st-marker-prompt.patch` + `Ctrl+F5`；`bindings` 记录前后邻居；卡片启停切换时主面板单行状态与详情块一起变
- **存储往返**：文件名是单段、满足 `^[a-zA-Z0-9_\-.]+$`、带前缀与双 hash、不同会话不同文件、以 `.jsonl` 结尾；
  中文会话名不进文件名但 `charDir` / `chatFile` 原样保留；`identity` 里没有 `path`；落点文案 = 角色聊天目录下的私有子目录；
  落盘走 `/api/role-expansion/journal/save` 且带 `avatar_url`；jsonl = 1 行会话头 + 1 篇；正文换行转义为字面 `\n`；
  单行 JSON 可无损还原；读回后篇数 / 标题 / 正文首行剥离都正确
- **标题解析**：`<title>`、`# 标题`、`【标题】`、`标题：` 四种都能解析，标签不进正文；无标题时返回空串（由调用方兜底）
- **生成 E2E**：默认 `generateRaw` 且参数只有 `prompt` / `systemPrompt`；角色设定顺序为 描述 → 性格 → 用户设定 → 场景；
  三个开关分别关掉的效果；全关 / 角色卡全空时不传 `systemPrompt`；`journalCharacterCardOverride` 整体接管且优先于开关；
  关掉隔离 → 只调 `generateQuietPrompt`，带 `skipWIAN: true` / `quietToLoud: false`，且**不**额外拼角色卡；
  隔离通道先剥推理块再解析标题
- **不可用路径**：缺补丁 → `patch-missing` + 文案指向补丁 + 提示块带 `roleEx-warn` + **不偷偷写回旧位置** + 探针不可用；
  群聊 → `group`、**不发请求**、探针不可用；切回单聊后错误清空、日记读得回来
- **源码层面**：不再有 `/api/files/` 写入调用、出现补丁端点前缀、注释点明需要 `st-journal-store.patch`；
  补丁文本含「把运行时源真正 add 进 chatCompletion」「逐条 `addToChatCompletion`」「预览 token 按真实正文算」，且不含 `/api/presets/save`
- **示例预设一致性**：`roleExpansionJournal` 卡片与 `worldInfoAfter` 字段对齐、只留最小字段、每个 `prompt_order` 块
  恰好一条且紧随 `worldInfoAfter`、`enabled: true`
- **模块系统**：日记模块加载并启用、`installed` / `enabled` / `title` 齐全、`settings.modules` 默认 `{}`、
  清单可解析且没走降级、框架源码里不硬编码模块导入路径、日记模块自带 `settingsBlock`
- **默认值**：`journalRefHeader` 等键参与「存为默认设置 → 恢复默认设置 → 清除基准 → 再恢复」的往返（回内置默认）

配套的其它自测（框架侧命令，见主 README）：

```bash
node tools/check-filename.mjs "some name.jsonl"   # 排查酒馆的文件名校验（文件名规则与日记相同）
npm run test:patch                                # 从 patches/st-journal-store.patch 抽端点在 express 沙盒里真跑
```

> 改完记得对着主 DEVELOPMENT 的「快速自检清单」过一遍，尤其是：把 `modules/journal/` 整个挪走再跑一次 `npm test`
> —— 框架部分应当照常工作，只有日记相关断言会红；断言总数变了就是有回归。

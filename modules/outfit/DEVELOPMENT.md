# 衣装模块 开发说明（`modules/outfit`）

> 面向**接手开发的人**。用户用法见 [README.md](README.md)；
> 框架、补丁、面板约定见[主 DEVELOPMENT](../../DEVELOPMENT.md)。
> 本模块与日记 / 状态栏 / 推特共用**同一套模块接口**（描述符 + `create(kernel)` + 框架侧同名转发壳），
> **整个目录可以删掉**，框架与其它模块照常工作。

---

## 0. 四个文件的职责与依赖方向

行数为 `(Get-Content <file>).Count` 的实测值（与主 DEVELOPMENT 的代码规模同一口径）：

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `index.js` | 90 | 描述符（`id` / `title` / `icon` / `defaults`）+ `create(kernel)` 组装 + `buildPanelSection()` + `settingsBlock()` |
| `store.js` | 630 | 会话身份、jsonl 编解码（分类表 + 已选 tag）、分类 / tag 模型、可用性判定、读写 |
| `inject.js` | 412 | marker 卡片的运行时正文源 + 卡片诊断（**照 `modules/journal/inject.js` 复制改名**，见 §5.4） |
| `ui.js` | 437 | 主面板区块（状态行 + 左右两栏 + 注入模板折叠块）+ 预设卡片诊断文案 |

```
modules/outfit/index.js   描述符 + 组装 + 两个框架钩子（buildPanelSection / settingsBlock）
                 store.js 存储与模型：currentIdentity / parseTagList / normalizeCatalog /
                          normalizePicked / encodeOutfitJsonl / persistChange / buildOutfitList
                 inject.js 运行时正文源 + 卡片诊断（PRESET_PROMPT.ID = roleExpansionOutfit）
                 ui.js     面板骨架 / 渲染 / 交互（全部写盘都调 store）
```

**依赖方向**：`create()` 里按 `store → inject → ui` 的顺序建（§1.4），
`ui.js` 通过**惰性转发**读同模块的其它文件（`rt.store.PARTS`、`rt.inject.PRESET_PROMPT`、
`const setCategoryTags = (...a) => rt.store.setCategoryTags(...a)`），
绕开「文件创建顺序」造成的循环依赖 —— 与推特 / 状态栏是同一套写法。
`index.js` 里那句 `rt.state.panel` 也是这个道理：DOM 引用放在运行时状态上，面板重建就整体换掉。

**本模块不依赖任何其它模块**（不调 `kernel.service()`，也不被任何模块依赖）。
拆掉整个目录：主面板少一块、「扩展」设置面板少「衣装卡片」那一块；框架桥接壳变成空操作（返回 `undefined`，不抛）。

---

## 1. 模块接口

### 1.1 描述符与 defaults

```js
export default {
    id: 'outfit',
    title: '衣装打扮',
    icon: 'fa-solid fa-shirt',
    defaults: { outfitInjectPrompt: '[以下是 {{char}} 当前的衣装打扮，请在描写与对话中保持一致]\n{{outfitList}}' },
    create(kernel) { /* … */ },
};
```

- `defaults` 里**只有一条** `outfitInjectPrompt`（注入模板，默认两行：标题行 + `{{outfitList}}`）。
  框架启动时并进 `DEFAULT_SETTINGS`，并参与「存为默认设置 / 恢复默认设置」的基准（§1.5、主 DEVELOPMENT §4.5）。
- `modules/manifest.json` 里也写了同一份 `title` / `icon`（清单里那份只作清单展示，**模块自己声明的优先**）。
- `icon` 是 Font Awesome class；`ui.js` 用框架的 `iconFor(sectionRoot, 'fa-solid fa-shirt')` 把它塞进标题行。

### 1.2 `rt.state`（模块自己的运行时状态）

| 字段 | 含义 |
| --- | --- |
| `identity` | 当前会话身份（`{ id, charDir, chatFile, fileName }`），落点文件名的来源 |
| `catalog` | 分类表：`[{ key, part, name, custom, tags }]`，建 store 时按内置固定分类补齐 |
| `picked` | `{ 分类key: 已选 tag[] }`（注入正文只看这一份） |
| `reason` | 不可用原因（`group` / `no-character` / `patch-missing` / `sub-not-allowed`），`null` = 正常 |
| `probed` | 资源通道只探一次；页面级失败态下 `armOutfitReprobe()` 会把它置回 `false`（§4.5） |
| `lastProbeAt` | 上次真探的时间戳，给重探的 3 秒节流用（`REPROBE_MIN_INTERVAL_MS`） |
| `reprobeInFlight` | 重探进行中的计数：重探自己触发的重绘不会再叠一次重探（`ui.js` 的 `reloadOutfit()` 维护） |
| `loaded` | 本会话的数据读过没有（面板与运行时源都靠它避免重复请求） |
| `autoLoadTried` | `renderOutfit()` 里那次自愈加载只做一次（§4.5） |
| `skipped` | 本次读取跳过的非法行数 |
| `skippedNote` | 给状态行用的一句话提示（`已跳过 N 行无法解析的衣装数据`），只提示一次 |
| `foldOpen` | 编辑器三个分类折叠块的展开状态 `{ outer, inner, other }`（默认全 `false`；由 `ui.js` 的 `outfitFoldOpen()` 惰性建 / 补键，语义见 §6.1） |
| `panel` | 当前面板的 DOM 引用（面板每次重建都整体换掉，所以不放工厂作用域） |

`store.js` 末尾有 `initState()`：`create()` 里传进来的 `rt.state` 会被就地归一化一次
（固定分类补齐、坏条目丢掉、类型不对的字段回默认），**重复调用无副作用** ——
所以面板在任何时候打开都能画出完整的三组。

### 1.3 kernel 注入面（模块实际用到的）

| 文件 | 取的设施 |
| --- | --- |
| `store.js` | `assetPathText` `assetReasonText` `clone` `ctx` `logError` `probeAssetStorage` `readAssetText` `splitLines` `stableHash` `toast` `uid` `writeAssetText` |
| `inject.js` | `MODULE_NAME` `PROMPT_MANAGER_PREFIX` `ctx` `logError` `renderTemplateString` `settings`（getter） |
| `ui.js` | `collapsible` `debounce` `el` `iconFor` `section` `settings`（getter） `toast` `updateSetting` |
| `index.js`（本模块的） | `el`（只用在 `settingsBlock()` 里） |

`settings` / `ui` 是**长期同一个对象**（框架用 `replaceSettings()` 就地替换内容，身份不变），
所以不要缓存它们的字段快照 —— 与推特 / 状态栏同一约定。

### 1.4 `create()` 的返回面

```js
const rt = { state: {…} };
rt.store  = createOutfitStore(kernel, rt);
rt.inject = createOutfitInject(kernel, rt);
rt.ui     = createOutfitUi(kernel, rt);

return {
    id: 'outfit',
    ...rt.store, ...rt.inject, ...rt.ui,     // 框架转发壳按同名调用（§1.5）
    buildPanelSection: () => rt.ui.buildOutfitPanel().section.root,   // 主面板区块
    settingsBlock: () => {…},                                        // 「扩展」设置面板区块
    services: {},                                                    // 不对外提供服务
};
```

- 三个工厂各返回一长串 `{ 函数…, 常量… }`；`...spread` 之后框架侧的同名壳就能调到。
- `buildPanelSection` / `settingsBlock` / `services` 三个能力都在**这个返回值上**（框架内部叫 `desc.api`）。
  `settingsBlock` 曾经是**唯一走岔的能力** —— 框架 2026-10-11 之前只在描述符上找它，导致衣装与日记的
  「扩展设置面板」区块从未渲染（见 §8 第 11 条与 CHANGELOG 0.10.0「修复」）；现在框架 api 优先、描述符回落。
- `services: {}` 是「本模块不给别人用」的显式声明（状态栏那种才需要 `kernel.service('state')`）。
- **没有 `debug`**（**预留能力，框架目前不读**）：控制台入口走框架的 `roleExpansion`（§9）。

### 1.5 框架 ↔ 模块的桥接（5 个壳 / 4 个调用点）

框架 `index.js` 的「模块桥接」章节里有 **5 个同名的转发壳**（模块不在 / 被禁用时返回 `undefined`，不抛）：

| 壳 | 模块侧实际入口 |
| --- | --- |
| `renderOutfit(...)` | `ui.js` → `renderOutfit()` |
| `reloadOutfit(...)` | `ui.js` → `reloadOutfit()`（先 `store.loadOutfit()` 再重画） |
| `ensureOutfitRuntimeSource(...)` | `inject.js` → `ensureOutfitRuntimeSource()`（`ensureRuntimePromptSource` 的别名） |
| `adoptOutfitCardStateFromPreset(...)` | `inject.js` → `adoptCardStateFromPreset` 的别名（别名理由见 §7 第 1 条） |
| `updateOutfitPresetCardHint(...)` | `ui.js` → `updateOutfitPresetCardHint()` |

框架侧的调用点（4 个）：

| 调用点 | 调了什么 |
| --- | --- |
| `onPanelOpened()`（面板每次打开 / `openPanel()` 在已打开时） | `renderOutfit()` |
| `CHAT_CHANGED` 事件 | `reloadOutfit()`（换会话换文件，面板没开也读） |
| 预设切换处理（`OAI_PRESET_CHANGED_AFTER` / `_BEFORE`，延迟 60ms） | `ensureOutfitRuntimeSource()` + `adoptOutfitCardStateFromPreset()` + `updateOutfitPresetCardHint()` |
| `globalThis.roleExpansion`（调试导出） | 上面 5 个壳全都挂出去了 |

> ⚠️ **与日记不同的地方**：日记侧的 `ensureRuntimePromptSource()` 在 `registerRuntimeSourceEarly()`
> （`bootstrap()` 里，带按帧重试）和 `APP_READY` 里都会被调；**衣装的 `ensureOutfitRuntimeSource()`
> 只在「预设切换」这一条路径上被调**，`bootstrap()` / `APP_READY` 里没有它。
> 排查「卡片在，但没有正文」时先手动 `roleExpansion.ensureOutfitRuntimeSource()` 确认一次。

---

## 2. 数据流

**编辑方向**（面板 → 磁盘）：

```
弹窗里点芯片 / 弹窗里点保存（名称 + 备选表）/ 新建分类 / 弹窗里删除分类
  → ui.js 调 store 的对应函数（togglePicked / renameCustomCategory + setCategoryTags / addCustomCategory / removeCustomCategory）
  → store 先克隆内存快照 → apply() 改内存 → saveOutfit() 整文件覆盖写
      → 成功：markLoaded() + 清掉 skippedNote → ui.js 重画（renderOutfit() 或局部 renderPreview()+renderStatus()）
      → 失败：内存回滚 + toast('error', '衣装保存失败：' + 文案)，界面被拉回真实状态
```

一次「保存」最多是**两次** store 调用、**两次**整文件写（先改名、后备选；各自只在真的改了的时候才写）——
见 §7 第 5 条。

**注入方向**（酒馆 → 扩展 → 预设卡片）：

```
每次生成：ST 调注册进来的 getContent()
  → ① findOutfitOrderEntry() 为空？ → ''
  → ② entry.enabled === false？     → ''
  → ③ buildOutfitInjectionText() 为空（一个 tag 都没选）？ → ''
  → 否则：buildOutfitList()（store 拼分组清单）→ renderTemplateString(settings.outfitInjectPrompt, { outfitList })
```

注入这一路**不写任何东西**：不写预设、不写 jsonl、不改 `settings`（`settings.outfitInjectPrompt` 只被用户改，见 §5.3）。

---

## 3. 数据模型

```js
const PARTS = [ { key: 'outer', label: '外' }, { key: 'inner', label: '内' }, { key: 'other', label: '其他' } ];

const FIXED_CATEGORIES = [
    { key: 'hat',        part: 'outer', name: '头饰' },
    { key: 'top',        part: 'outer', name: '上衣' },
    { key: 'bottom',     part: 'outer', name: '下装' },
    { key: 'socks',      part: 'outer', name: '袜子' },
    { key: 'shoes',      part: 'outer', name: '鞋子' },
    { key: 'underwear',  part: 'inner', name: '内衣' },
    { key: 'underpants', part: 'inner', name: '内裤' },
];
```

两个概念必须分清（面板上就是「左边预览 / 右边编辑」这两半）：

| 概念 | 存在哪 | 谁写 | 谁读 |
| --- | --- | --- | --- |
| `tags`（**备选表**） | `catalog[].tags` | 弹窗里的「备选」文本域 + `保存`（整表替换，§4.4） | 弹窗芯片行、预览的「未选」判断、`normalizePicked` 的过滤基准 |
| `picked`（**已选**） | `picked[key]` | 弹窗里点芯片（**即时落盘**） | **注入正文只看这一份**、预览的显示值 |

规则（都在 `store.js` 里，`ui.js` 不重复实现）：

- **固定分类的 `key` 是契约的一部分**（注入正文、预设卡片名、自测都按它写）：`name` / `part` 一律以内置定义为权威，
  不可改名、不可删除；jsonl 里缺了就按内置定义补齐，且**固定分类永远排在自定义分类前面**。
- **自定义分类**：`key` 必须是 `custom-` 前缀（新建时是 `'custom-' + uid()`）、`part` 必须是已知部分、
  `name` 不能为空，否则在归一化时**丢掉**。自建的一律落在 `other`（没有让用户挑部分的入口）。
- **分类名全局唯一**：`isCategoryNameTaken(name, exceptKey)` 把固定分类与自定义分类放在一起比；
  新建与改名都先查重（重名直接拒绝、**不写盘**）。
- `parseTagList(text)`：**只按英文逗号 `,` 切分**（与 ST 世界书的「关键字列表」一致）→ `trim()` → 丢掉空串 → **去重保序**。
  中文逗号 / 顿号不是分隔符；`normalizeTags(value)` 让字符串与数组都走同一条路再合并去重。

---

## 4. 存储（`store.js`）

### 4.1 会话身份与文件名

```js
const SUB = 'outfit';                          // 服务端子目录白名单里的名字
const PREFIX = 'RoleExpansion_outfit';         // 文件名前缀（与推特 / 日记区分开）

// currentIdentity()
charKey = stableHash(charDir).slice(0, 8);
chatKey = stableHash(charDir + '/' + chatFile).slice(0, 8);
fileName = 'RoleExpansion_outfit_c_' + charKey + '_j_' + chatKey + '.jsonl';
```

- `charDir` / `chatFile` 来自 `ctx().getCurrentChatId()`（去掉 `.jsonl` 后按 `/` 切成「角色目录 / 会话名」）；
  拿不到 chatId 时退化成 `'__noid__/' + 角色名`（与推特 / 日记同一套兜底）。
- 落点：`<user>/chats/<角色目录>/_RoleExpansion/outfit/<fileName>`，
  给人看的路径文案由框架的 `assetPathText('outfit', fileName)` 生成（不可用时是空串）。
- 文件名是**单段 ASCII**（酒馆的文件名校验），所以中文 / 空格 / 括号只进 hash；
  可读的角色目录名与会话名记在**第一行的会话头**里。

### 4.2 三行结构（`encodeOutfitJsonl()`）

```text
第 1 行  { "__roleExpansion": "outfit-session", version, chatId, charDir, chatFile, savedAt }
第 2 行  { "__roleExpansion": "outfit-catalog", categories: [{ key, part, name, custom, tags }], updatedAt }
第 3 行  { "__roleExpansion": "outfit-selection", picked: { <key>: [tag…] }, updatedAt }
```

- 三个 `__roleExpansion` 字面量分别是 `outfit-session` / `outfit-catalog` / `outfit-selection`（导出成常量 `KIND_*`）。
- 第 2 行写的是 `catalog.map(...)` 的显式字段（不整对象丢进去），第 3 行写的是**对齐后**的选择表
  （`alignSelection()`：顺序按当前备选表、丢掉已从备选表里删掉的 tag）。
- 文件结尾固定一个 `\n`；`savedAt` / `updatedAt` 都写 `Date.now()`。
- **每次落盘都是整文件覆盖写**（三行全写），没有写队列、没有局部更新。

### 4.3 读取归一化（`parseOutfitJsonl()` + `normalize*()`）

| 输入的问题 | 处理 |
| --- | --- |
| 行不是合法 JSON / 不是对象 | `skipped += 1`，跳过 |
| 行的 `__roleExpansion` 不是三个已知值 | `skipped += 1`，跳过 |
| 缺 `outfit-session` 行 | `session = null`（会话头只是记录，不影响可用） |
| 缺 `outfit-catalog` 行 / 分类条目坏 | `normalizeCatalog()`：固定分类按内置补齐；未知固定 key、非 `custom-` 前缀、`part` 未知、`name` 为空的条目丢掉；重复 key 只留第一条 |
| 备选表里有重复 / 空白 / 非字符串 | `normalizeTags()` → `parseTagList()` 清洗 |
| `picked` 里有多余 key / 多余 tag | `normalizePicked()`：补成「所有分类都在」的完整表，key 与 tag 都必须能在 catalog 里找到才留下，**顺序按备选表** |
| 有坏行 | 状态行提示一次 `已跳过 N 行无法解析的衣装数据`（`skippedNote` 只在第一次读到时写，写回成功后清空） |

同一个 `skippedNote` 不会重复刷：`loadOutfit()` 里只有 `!rt.state.skippedNote` 时才写。

### 4.4 写入：`persistChange()` 的三步约定

```js
persistChange(apply)
  → snapshot = clone(catalog) + clone(picked)
  → extra = apply()            // 内存改动；可以返回对象（例如新建分类的 key），会并进返回值
  → res = await saveOutfit()   // 整文件覆盖写
  → 失败：内存回滚到 snapshot + toast('error', '衣装保存失败：' + 文案) + 返回 { ok:false }
  → 成功：返回 { ok:true, …extra }
```

**界面只在成功后才重画**（与推特同一约定）：`ui.js` 里每个交互都是「调 store → `if (!res.ok) return;` → 重画」。
这条约定换来的是「界面永远等于真实状态」，代价是失败时用户看到的是**原地不动 + 一条 Toast**。

五个编辑入口（都走 `persistChange()`，所以失败一律回滚内存）：

| 函数 | 语义 | 拒绝理由 |
| --- | --- | --- |
| `setCategoryTags(key, rawText)` | 备选表**整表替换**，并**连带清掉**不在新表里的已选 tag | `no-category` |
| `togglePicked(key, tag)` | 选中 / 取消选中一个**备选表里存在**的 tag | `no-category` / `no-such-tag` |
| `addCustomCategory(name)` | 新建 `custom-<uid>`，落在 `other` | `empty-name` / `duplicate-name` |
| `renameCustomCategory(key, name)` | 只给自定义分类改名（固定分类返回 `no-category`） | `no-category` / `empty-name` / `duplicate-name` |
| `removeCustomCategory(key)` | 删自定义分类：备选 tag 与已选 tag 一起清掉 | `no-category` |

### 4.5 可用性判定：`outfitAvailability()` 是**同步**的

```js
function outfitAvailability() {
    if (hasGroup()) return { ok: false, reason: 'group' };        // 每次现算
    if (!hasCharacter()) return { ok: false, reason: 'no-character' };  // 每次现算
    const reason = rt.state.reason;                                // 探针结果缓存
    if (reason && AVAIL_REASONS.has(reason)) return { ok: false, reason };
    return { ok: true, reason: null };
}
```

- `group` / `no-character` **每次现算**（换会话就变）；`patch-missing`（端点 **404**）与 `sub-not-allowed`
  （端点 **400**）进不了本地判断，由 `probeOutfitStorage()` 调框架的 `probeAssetStorage('outfit')` 探一次，
  结果缓存在 `rt.state.reason` —— 这两件事在同一个页面里不会自己变，所以只探一次。
- **`invalid-path`（400）为什么能归一成 `sub-not-allowed`**（`toPageReason()`，`store.js:83-89`）：
  探针用的是**固定合法值**（合法模块名 `sub` + 端点内生成的合法文件名），而 `resolveAssetPath()` 剩下会返回 `null`
  的分支只有三种 —— `charDir`（`avatar_url` 的 basename）异常会连推特一起挂、不是衣装专有；
  `name` / `ext` / 路径穿越在固定合法值下不可能触发；**唯一还成立的解释就是 `sub` 不在
  `ALLOWED_SUBDIRS` 里**，也就是「装了旧版补丁」。旧版补丁要手改一行 + 重启酒馆，不明确报出来用户根本猜不到。
- 所以 `sub-not-allowed` 与 `patch-missing` **同级**：两者都进 `AVAIL_REASONS`（`store.js:60`），
  `outfitAvailability()` 判不可用 → 状态行是 `roleEx-hint roleEx-warn`（**红字**）、
  `.roleEx-outfit-cols` 带 **`is-disabled`**（整块置灰，`ui.js:127 / :131`）。
  文案由**模块自己的** `outfitReasonText()` 给（框架的 `assetReasonText()` 不认识这个原因），
  整句里含 `ALLOWED_SUBDIRS`、`['twitter', 'outfit']`、「重启酒馆主进程」三个关键 token（`store.js:174-182`）；
  **读失败与写失败的文案也走同一句**（`store.js:491-497` / `:520`）。
- **仍然只有「非集合」原因不置灰**：网络抖动这类 `AVAIL_REASONS` 之外的原因只 `logError` 记一笔，
  面板照常可用（真去写盘时该报的错照样报）。
- **页面级原因有一次自动重探**：`renderOutfit()` 里调 `armOutfitReprobe()`（`store.js:451-463`，`ui.js:286`）——
  只要 `rt.state.reason` 属于 `PAGE_REASONS`（= `patch-missing` / `sub-not-allowed`）就把 `probed` 置回 `false`，
  让下一次 `loadOutfit()` 真的再探一次。两次之间至少隔 `REPROBE_MIN_INTERVAL_MS = 3000`，
  且同一次重探自己触发的重绘不会再叠一次（`rt.state.reprobeInFlight`）。
  **所以用户按文档补上补丁 / 改完白名单并重启酒馆主进程之后，重新打开一次面板（或 F5）即可恢复；
  面板一直开着不动时不会自动恢复** —— 失败态刻意不做轮询，这是粒度选择，不是漏了定时器。
  `group` / `no-character` 不进这条路（它们每次现算，换会话就更新）。
- `hasCharacter()` 与框架的 `journalAvailability()` **同口径**：只认 `characters[characterId].avatar`
  （`store.js:131-135`）。**故意不拿 `name2` / `getCurrentChatId()` 兜底** —— 那会让「面板说可用、
  真去读写时框架判 `no-character`」，用户看到的是红字消失、点了才报错；落点这个概念只有一个来源，
  两处判据不一致比少一层兜底危险得多。
- `loadOutfit()` 会先探针、不通过就**直接返回**，不发注定失败的 `readAssetText`；
  同时在 `group` / `no-character` 分支里**主动清掉过期的 `reason`**（否则从群聊切回单人会话面板还是灰的）。
- `renderOutfit()` 里还有一次**自愈加载**：`!loaded && !autoLoadTried && 可用` 时补一次 `reloadOutfit()`，
  与上面的重探**同一条出口**（`if (armed || needsFirstLoad) void reloadOutfit()`）。它存在的理由是框架没在
  `APP_READY` 里调 `reloadOutfit`（§1.5），而 `autoLoadTried` 保证**只补一次**（读失败不反复重试）。

---

## 5. 注入（`inject.js`）

### 5.1 注册运行时正文源

```js
const PRESET_PROMPT = {
    ID: 'roleExpansionOutfit',        // 卡片在预设里的固定标识（契约）
    NAME: '衣装（角色扩展）',           // 写进预设 JSON 的 name
    SOURCE_NAME: '角色扩展（衣装）',    // 预设编辑弹窗里「正文来源」处显示的来源名
};

register(PRESET_PROMPT.ID, getContent, { name: PRESET_PROMPT.SOURCE_NAME, edit: true, toggle: true });
```

- `getContent` 就是 §5.2 那三道闸 + §5.3 的正文拼装。
- 幂等：`runtimePromptRegistered` + `runtimeSourceForId`（`runtimeSourceKey(ID)` = 把非单词字符换成 `_`，
  与 ST 侧的 key 规则一致）—— 同一个 identifier 只注册一次。
- `registerRuntimePromptSource` 不存在（没打 `st-marker-prompt.patch`）时返回 `false`，**不抛**。
- 注册成功后调一次 `patchPromptManagerFirstRender()`：ST 的首屏预设列表渲染发生在我们注册**之前**，
  不补这一次，那一行就没有「铅笔 / 开关」（机制与日记模块完全一样，见主 DEVELOPMENT §4.1）。

### 5.2 三道闸（顺序不能乱）

| # | 判据 | 含义 |
| :---: | --- | --- |
| ① | `findOutfitOrderEntry()` 为 `null` | 卡片没插进任何 `prompt_order` 块 → 没有开关可谈，返回空串 |
| ② | `entry.enabled === false` | 卡片自己被关掉 → 空串 |
| ③ | `buildOutfitInjectionText()` 返回空串 | 一个衣装项都没选 → 空串 |

`findOutfitOrderEntry()` 先查**当前角色**的 order，角色没有独立 order 时查**全局 dummy order**
（生成时用的是 dummy，ST 的 `promptOrder.strategy = 'global'`），两处都没有才返回 `null`。

### 5.3 正文拼装（`buildOutfitList()` + `renderTemplateString()`）

```js
buildOutfitList():                       // store.js，注入正文的「内容」那一半
  for (part of PARTS) {                  // 外 → 内 → 其他（顺序 = 渲染顺序）
      chunks = [];                       // 该部分里所有「有选中」的分类
      for (cat of catalog 里 part 相同的) {
          tags = selection[cat.key];     // selection 已按备选表顺序对齐
          if (!tags.length) continue;    // 空分类不出现
          chunks.push(cat.name + '=' + tags.join(' / '));
      }
      if (chunks.length) lines.push(part.label + '：' + chunks.join('；'));
  }
  return lines.join('\n');               // 一个都没有 = ''
```

- 行内多个分类用 `；`，同一个分类里的多个 tag 用 ` / `；**空的部分整行不出现**。
- 模板那一半在 `index.js` 的 `defaults.outfitInjectPrompt` 里，由
  `renderTemplateString(settings.outfitInjectPrompt, { outfitList: list })` 填；
  剩下的 `{{...}}` 交给酒馆的宏替换（`{{char}}` / `{{user}}`…）。
- **一个选中项都没有 → 直接返回空串**（连模板一起不注入），所以「穿什么都还没选」时主聊天完全不受影响。

### 5.4 为什么这份 marker 机制是照 `journal/inject.js` **复制**的一份

| | 说明 |
| --- | --- |
| 硬约束 | 模块必须能**单独拆除**：删掉 `modules/outfit/` 不能让日记或框架少一块。跨模块耦合只允许走 `kernel.service('<id>')`，而日记没有对外提供「marker 卡片机制」这种服务（它给的是 `buildJournalPrompt` 之类的内容函数） |
| 结果 | 两边各有一份「查 order → 读 enabled → 注册 → 首屏补渲染 → 诊断」的代码，相似度很高 |
| 代价 | 改机制要**改两处**（例如补丁改了注册 API 的语义、或 ST 换了 `promptOrder` 的字段名）。这是**有意的取舍**：宁可重复一份，也不要为了复用把两个模块绑死 |
| 边界 | 两边的差异只有 identity（`roleExpansionOutfit` / `roleExpansionJournal`）、来源名、正文拼装函数，以及下面 §7 里列的那几处别名与调用时机差异 |

`inject.js` 的对外函数：`ensureRuntimePromptSource`（+ 别名 `ensureOutfitRuntimeSource`）、
`adoptCardStateFromPreset`（+ 别名 `adoptOutfitCardStateFromPreset`）、`readOutfitCard`、`diagnoseOutfitCard`、
`isPromptManagerExposed`、`supportsMarkerPromptCard`、`probeStPatch`、`probeCardControls`、`logMarkerSupport`、
`patchPromptManagerFirstRender`、`currentPresetName`、`buildOutfitInjectionText`、`findOutfitOrderEntry`、
`isOutfitCardEnabledInPreset`、`getPromptManager` 等（诊断函数**全部只读**，绝不写预设）。

### 5.5 别名导出

`inject.js` 的返回对象末尾多两条：

```js
ensureOutfitRuntimeSource: ensureRuntimePromptSource,
adoptOutfitCardStateFromPreset: adoptCardStateFromPreset,
```

**理由**：框架的转发壳（`index.js` 的「衣装模块」小节）用的是带 `Outfit` 的名字
（`callOutfit('ensureOutfitRuntimeSource', …)` / `callOutfit('adoptOutfitCardStateFromPreset', …)`），
而 `inject.js` 内部沿用了日记的函数名。两处名字对不上就会**静默失效**
（`callModule` 找不到名字 → 返回 `undefined`，不抛），所以这里用**别名**对齐：
两个名字指向同一个函数，改任何一个名字时**必须同时改**壳与这里（§7 第 1 条）。

---

## 6. 面板结构（DOM 与 id）

```
buildOutfitPanel() → section('衣装打扮', { open: false })          ← 默认收起
  root: #roleEx-outfit-section.roleEx-span-all（iconFor: fa-solid fa-shirt）
├─ .roleEx-section-header                  [图标, 标题, 箭头]（标题行 = 折叠开关，不塞控件）
└─ .roleEx-section-body                    （直接子节点顺序是契约：状态行 → 两栏 → 注入模板折叠块）
   ├─ #roleEx-outfit-status.roleEx-hint
   │    （不可用且原因不是 no-character 时多一个 .roleEx-warn 红字；title 同步成同一句话）
   ├─ .roleEx-outfit-cols#roleEx-outfit-cols（不可用时加 .is-disabled：置灰 + pointer-events:none）
   │  ├─ #roleEx-outfit-preview                      ← flex: 0 0 55%; min-height: 12em
   │  │  ├─ .roleEx-label「预览」
   │  │  └─ #roleEx-outfit-preview-list
   │  │     ├─ .roleEx-outfit-preview-part ×3（外 / 内 / 其他）
   │  │     └─ .roleEx-outfit-preview-row
   │  │        ├─ .roleEx-outfit-preview-name（`分类名：`）
   │  │        └─ .roleEx-outfit-preview-value（未选再加 .is-empty）
   │  └─ #roleEx-outfit-editor
   │     └─ .inline-drawer.roleEx-fold.roleEx-outfit-group#roleEx-outfit-fold-<部分key> ×3   ← 默认全收起
   │        │   （部分key = outer / inner / other，标题 = 折叠块 header 上的「外 / 内 / 其他」）
   │        ├─ .roleEx-outfit-cat#roleEx-outfit-cat-<分类key>          ← 每行只有两个元素
   │        │  ├─ .roleEx-outfit-cat-name（`分类名`，超长省略号）
   │        │  └─ .roleEx-outfit-cat-btn#roleEx-outfit-edit-<分类key>  编辑（点开弹窗；固定分类也有）
   │        └─ .menu_button.roleEx-btn-sm#roleEx-outfit-add-cat `+ 新建分类`（只有 other 组才有）
   └─ .inline-drawer.roleEx-fold#roleEx-outfit-inject-fold                ← 默认收起
      ├─ .inline-drawer-toggle.inline-drawer-header.roleEx-fold-header「注入模板」
      └─ .inline-drawer-content.roleEx-fold-body
         ├─ .roleEx-hint（变量说明：{{outfitList}} 是已选的衣装；{{char}} / {{user}} 走酒馆宏）
         └─ textarea.text_pole.roleEx-textarea#roleEx-outfit-inject-prompt（rows=4）
```

分类编辑弹窗（`openCategoryModal(cat)`，**挂在 `document.body`**、一次性的、不缓存到 `rt.state`；
结构照推特 / 日记的 `.roleEx-modal`）：

```
.roleEx-modal#roleEx-outfit-modal                     ← 每次打开前先 remove 掉同名旧节点
└─ .roleEx-modal-inner
   ├─ .roleEx-modal-head「编辑「<分类名>」」
   ├─ .roleEx-outfit-modal-field                        ← 列方向 flex（标签在上、控件在下）
   │  ├─ span.roleEx-hint.roleEx-inline-label「名称」 + input.text_pole#roleEx-outfit-modal-name
   │  │     （**整段只有自定义分类才有**）
   │  └─ 以上是「名称」；下面这一段永远有 ↓
   ├─ .roleEx-outfit-modal-field
   │  ├─ span.roleEx-hint.roleEx-inline-label「备选」
   │  ├─ textarea.text_pole.roleEx-textarea#roleEx-outfit-modal-tags（rows=3）
   │  └─ .roleEx-hint「每个填一项、用英文逗号分隔；中文逗号不切分。」
   ├─ 备选表非空 → .roleEx-outfit-chips#roleEx-outfit-modal-chips
   │                 └─ .roleEx-outfit-chip（选中再加 .is-on）
   │  备选表为空 → .roleEx-hint「先在上面填备选 tag」（**没有 chips 容器**）
   └─ .roleEx-row.roleEx-wrap
      ├─ .menu_button.roleEx-btn-sm#roleEx-outfit-modal-save「保存」
      ├─ .menu_button.roleEx-btn-sm#roleEx-outfit-modal-cancel「取消」
      └─ .menu_button.roleEx-btn-sm#roleEx-outfit-modal-del「删除分类」（**只有自定义分类才有**）
```

- **`style.css` 里真正写了样式的是这些**（`roleEx-outfit-*`）：
  `.roleEx-outfit-cols`（含 `@media (max-width: 780px)` 里的竖排）、`#roleEx-outfit-preview`（55% + `min-height`）、
  `#roleEx-outfit-editor`、`.roleEx-outfit-cat`、`.roleEx-outfit-cat-name`、
  `.roleEx-outfit-modal-field`（及其 `> .text_pole { width: 100% }`）、`.roleEx-outfit-chips`、
  `.roleEx-outfit-chip`（`.is-on`）、`.roleEx-outfit-cat-btn`（`:hover`）、`.roleEx-outfit-preview-part`、
  `.roleEx-outfit-preview-row`、`.roleEx-outfit-preview-name`、`.roleEx-outfit-preview-value`（`.is-empty`）、
  `.roleEx-outfit-cols.is-disabled`；弹窗外壳（`.roleEx-modal` / `.roleEx-modal-inner` / `.roleEx-modal-head`）
  是框架的通用样式（`style.css:690 / :700 / :712`），本模块只加了 `.roleEx-outfit-modal-field`。
- **`.roleEx-outfit-group` 没有专门样式，这是有意为之**：它只是加在三个折叠块 root 上的**结构标记**
  （自测与排查时按它定位三组），外观全部来自框架的 `collapsible()` / `.roleEx-fold*`。
  0.10.1 之前那个 `.roleEx-outfit-group-head`（分组标题）已经不存在 —— 标题现在由折叠块 header 承担。
- 状态行/两栏/折叠块的顺序、`.roleEx-outfit-cols` 这个形状都是**契约**（框架与自测都按它找），改结构要连着改自测。
- 折叠块走框架的 `collapsible()`（酒馆原生 `.inline-drawer` + 文档级委托处理器），
  箭头语义「收起 ↓ / 展开 ↑」与站内一致，初始 `display` 由 `collapsible()` 自己写死（主 DEVELOPMENT §4.2 第 2 条）；
  三个分类折叠块的**展开状态自己记**（见 §6.1），注入模板那个不记（它是固定默认收起）。

### 6.1 分类折叠块的展开状态（`rt.state.foldOpen`）

```js
// ui.js：outfitFoldOpen() —— 缺的键补 false，已有的布尔值不覆盖
rt.state.foldOpen = { outer: false, inner: false, other: false };
// renderEditor()：collapsible(part.label, { open: foldOpen[part.key] === true })
//                 fold.header.addEventListener('click', () => { foldOpen[part.key] = !foldOpen[part.key]; })
```

| 事实 | 说明 |
| --- | --- |
| 默认 | 三组**全部收起**（三个键都由 `outfitFoldOpen()` 补成 `false`） |
| 谁翻转 | **只有折叠块 header 的 click**（自己绑在 `fold.header` 上）—— 不去读 `body.style.display` |
| 为什么不去读 DOM | 展开 / 收起是酒馆原生 `.inline-drawer-toggle` 委托处理器在动 DOM，动画中间态读 `display` 拿不准 |
| 记忆范围 | 存在 `rt.state` 上（不是 `settings`）：**面板重画后仍保持**（新建 / 改名 / 删除 / 点芯片触发的重画都不会把它收回去），**换会话也保留**（同一个页面生命周期内）；**刷新页面 / 重开酒馆回到全收起** |
| 不写盘 | 它只描述「界面长什么样」，和分类 / 已选数据无关 —— 与框架的界面偏好（面板锁定）同一个理由（主 DEVELOPMENT §4.6） |
| 缺键 / 脏值 | `outfitFoldOpen()` 只补 `boolean` 之外的键，不会清掉用户点过的那份 |

### 「扩展」设置面板里的那一块（`settingsBlock()`）

```
.roleEx-settings-block
├─ .roleEx-label「衣装卡片 · <code>roleExpansionOutfit</code>」
├─ .roleEx-hint#roleEx-preset-card-hint-outfit        ← 初始文案「状态：检测中…」
└─ .roleEx-row.roleEx-gap.roleEx-vcenter.roleEx-wrap
   ├─ .menu_button.roleEx-btn-sm#roleEx-setting-open-preset-outfit「打开预设面板」
   └─ .roleEx-hint「开关卡片＝启停注入；正文由扩展提供，位置与启停都在预设 UI 里管理」
```

- 诊断文案由 `ui.js` 的 `updateOutfitPresetCardHint()` 写进 `#roleEx-preset-card-hint-outfit`
  （用 `describeOutfitCard()` 的 `detail` 分支，`whiteSpace = 'pre-line'`）；元素不在就跳过。
  它覆盖三种情形：读不到 `promptManager`（补丁旧版）、提示词管理器未就绪（不是 Chat Completion 类接口）、
  以及正常态（预设名 / 标识 / 形态 / 权限 / 控件 / 位置 / 开关）。
- `#roleEx-setting-open-preset-outfit` 的 `onclick` 是 `rt.ui.openPresetPanel()`：
  点 `#ai-config-button .drawer-toggle` 打开酒馆自己的「AI Response Configuration」侧栏（已经开着就什么都不做）。
- **只有诊断，没有一个可改项** —— 卡片的内容与开关完全归预设 UI。
- **挂载方式**：这一块由框架的 `renderModuleSettingsBlocks()` 调本模块的 `settingsBlock(kernel)` 后
  `append` 进 `#roleEx-setting-module-blocks`（`index.js:1524-1550`，**api 优先、描述符回落**）。
  2026-10-11 之前框架只在描述符上找这个能力，所以这一块**一直没被挂出来**（§8 第 11 条）。

---

## 7. 与冻结规格不同 / 需要点明的实现取舍

八条都已经落地（1–4 是冻结规格核对时的取舍，5–8 是 **0.10.1 面板重做**带出来的），写在这里免得后人以为是漏改：

1. **`inject.js` 同时导出带 `Outfit` 的别名**（`ensureOutfitRuntimeSource` / `adoptOutfitCardStateFromPreset`）。
   冻结规格里只有 `ensureRuntimePromptSource` / `adoptCardStateFromPreset`；
   但框架桥接壳（`index.js` 的衣装小节）用的是**带 `Outfit` 的名字**，两个名字指向同一个函数（§5.5）。
2. **`outfitAvailability()` 是同步函数**，不是 async：`group` / `no-character` 每次现算，
   `patch-missing` / `sub-not-allowed` 探一次后缓存在 `rt.state.reason`（§4.5）。
   好处是 `renderStatus()` / `renderPreview()` / `renderEditor()` 这些**渲染路径**可以同步读可用性，
   不必为「探针还在飞」写加载态；代价是**第一次**读写要等 `probeOutfitStorage()`，
   所以 `loadOutfit()` 负责「先探针、不通过就不发注定失败的请求」；
   页面级失败态另由 `armOutfitReprobe()` 给一次重探机会（同样是同步判断，只置标志位）。
3. **`setCategoryTags()` 会连带清掉「已经不在新备选表里」的已选 tag**。
   与读取归一化（`normalizePicked()`）同一套语义：备选表是「合法值的集合」，它变了，选择表就要跟着收敛。
4. **`renderOutfit()` / `reloadOutfit()` / `updateOutfitPresetCardHint()` 是框架桥接的入口**（§1.5 的 5 个壳），
   框架侧只在 `onPanelOpened` / `CHAT_CHANGED` / 预设切换处理这三处调它们；
   `renderOutfit()` 的末尾是**唯一出口**：`armed`（失败态重探）与 `needsFirstLoad`（自愈加载）
   共用一句 `if (armed || needsFirstLoad) void reloadOutfit();` —— 自愈加载存在的理由是框架没在
   `APP_READY` 调 `reloadOutfit`（§4.5）。

> 下面 5–8 条是 **0.10.1 面板重做**（弹窗 + 折叠块 + 预览加宽）带出来的取舍：
5. **一次「保存」= 顺序执行两步写入，不做事务**：先 `renameCustomCategory()`（只有名称真的改了才调）、
   再 `setCategoryTags()`（只有备选文本真的变了才调）——**两步都成功才关窗重画**，任一步失败就停在弹窗里。
   代价是「改名成功、备选失败」时名字已经落盘（没有回滚第一笔），窗口标题也还是旧名；
   换来的是**不引入多步事务**：每一步都是既有的 `persistChange()`（内存快照 → 落盘 → 失败回滚）。
   名称的两种可预期拒绝（空名 / 重名）**放在调 store 之前**，所以它们一次盘都不写。
6. **备选表为空时不建 chips 容器**，只放一句提示 `.roleEx-hint`「先在上面填备选 tag」。
   理由：没有 tag 就没有可点的东西，一个空容器既没有语义、又会让自测的「弹窗里有 `#roleEx-outfit-modal-chips`」变成假命题。
   判据是**弹窗打开那一刻**的 `cat.tags`（不是文本域的实时内容）—— 所以「删光备选 → 存 → 重开弹窗」才会变成提示态。
7. **`buildCategoryRow(cat)` 只有一个参数**了（旧版是 `(cat, pickedTags)`）：分类行不再持有芯片，也就不需要「当前选中」这份输入。
   行里**只剩两个元素**（名称 + `编辑`），固定分类与自定义分类在这一层没有区别 ——
   名称框与 `删除分类` 由弹窗按 `cat.custom` 决定要不要建。
8. **行间距比看上去多 6px**：三个折叠块的 body 落在框架既有的 `.roleEx-fold-body > * { margin-bottom: 6px }`
   （`style.css:339`）之下，所以每行分类之间是「自己的 padding + 6px」。这是**复用 `collapsible()` 的直接结果**，
   不是漏写间距 —— 想改就改那一条通用规则（会影响所有模块的折叠体），别在这里加负 margin。

---

## 8. 踩过的坑

| # | 症状 | 根因 | 现在的防护 |
| --- | --- | --- | --- |
| 1 | 从群聊切回单人会话，面板还是灰的 | `reason` 被当成「补丁探测结果」长期留在 `rt.state` 里 | `loadOutfit()` 在 `group` / `no-character` 分支里主动清 `reason`；探针结果只保留 `patch-missing` 这类真·页面级原因 |
| 2 | 空会话一打开就一片红 | 把「还没选角色」当成了错误 | 状态行对 `no-character` 走 `quiet` 分支：不打 `roleEx-warn`、也不弹 Toast（与日记 / 推特同一决定） |
| 3 | 「界面变了、文件没变」 | 先改内存再落盘，写失败却已经重画 | 一律 `persistChange()`（先快照 → 落盘 → 失败回滚内存 + Toast），`ui.js` 只在 `res.ok` 后才重画 |
| 4 | 删掉一个 tag 再打回来，选择没恢复 | 备选表整表替换时会清掉不在新表里的已选 | 这是**有意**的（§7 第 3 条）；界面文案与 README 都写明了 |
| 5 | 点一下芯片，正在打的文字（旧版是行内输入框，现在是弹窗里的备选文本域 / 名称框）被清掉 | 芯片点击走了整块 `renderOutfit()` | 芯片点击只 `renderPreview()` + `renderStatus()` + 改该芯片的类与 title；**弹窗是独立节点，根本不在重画范围内**（0.10.1 之后这个坑自然消失，但「别在弹窗里调用 `renderOutfit()`」这条仍然成立 —— 那会连弹窗一起重建） |
| 6 | 状态行一直念「已跳过 N 行」 | 每次读都重算提示 | `skippedNote` 只写一次；`saveOutfit()` 成功后清空（写回就是整份重写，坏行已经没了） |
| 7 | 手改 JSONL 之后界面「数据没了」 | 归一化把未知 key / 不在备选表里的 tag 丢掉了 | 这是设计（§4.3）；文件仍在，面板状态行会显示坏行计数，改回去即可 |
| 8 | 卡片在，但生成时没有衣装正文 | 运行时源没注册（`ensureOutfitRuntimeSource()` 只在预设切换路径上被调）或卡片没插进 `prompt_order` | 诊断文案会分别点出「权限 / 补丁」与「位置：没有插进任何 prompt_order 块」；控制台另有 `logMarkerSupport()` |
| 9 | 面板重建后操作打在旧节点上 | DOM 引用被留在工厂作用域里 | 引用统一放 `rt.state.panel`，`panelRefs()` 每次现取 |
| 10 | 想「顺手」直接 `fetch` 端点 | 会让缺补丁 / 版本变化变成静默失败 | 一律走 `kernel` 的资源通道（`readAssetText` / `writeAssetText`）；自测断言模块源码里没有自己拼的 `fetch` |
| 11 | 「扩展」设置面板里**一直没有**衣装那块诊断区块（日记那块也没有），而面板其余部分正常 | **框架 bug**：`renderModuleSettingsBlocks()` 在**描述符**上找 `settingsBlock`，而模块把能力挂在 `create(kernel)` 的返回值（`desc.api`）上 —— 改前容器 `children.length` 恒为 `0`。看起来像「模块没写 `settingsBlock`」，其实是能力放对了位置、框架读错了地方 | 框架改成 **api 优先、描述符回落**（`index.js:1537`，2026-10-11）；本模块从一开始就把 `settingsBlock` 放在返回值上（§1.4），不需要改动。修复者实测改后容器里是 2 个 child（衣装、日记，顺序 = 清单顺序），自测已按这条钉住（§11） |

---

## 9. 调试入口

`globalThis.roleExpansion` 里属于衣装的成员（模块被拆掉时是**空壳**：调用返回 `undefined`，不抛）：

| 成员 | 用途 |
| --- | --- |
| `reloadOutfit()` | 从文件重读 jsonl 并重画（排查「文件改了 / 写进去了但界面没变」） |
| `renderOutfit()` | 只重画、不读盘 |
| `ensureOutfitRuntimeSource()` | 手动确保运行时正文源已注册（返回 `true` / `false`）—— 排查「卡片没正文」的第一步 |
| `adoptOutfitCardStateFromPreset()` / `updateOutfitPresetCardHint()` | 刷新「扩展」设置面板里那块诊断文案 |
| `settings.outfitInjectPrompt` | 注入模板（活引用，改完立即生效，不必刷新页面） |
| `assetPathText('outfit', name)` | 落点文案 `chats/<角色>/_RoleExpansion/outfit/<name>` |
| `probeAssetStorage('outfit')` | 框架侧资源通道的只读探针（区分「缺补丁」与「角色目录不可达」） |
| `journalAvailability()` | 群聊 / 没选角色 的权威判据（资源通道与日记共用同一套） |

卡片诊断的三个函数（`describeOutfitCard()` / `diagnoseOutfitCard()` / `readOutfitCard()`）**都只读**，
但**没有挂到 `roleExpansion`**（框架只转了上面那 5 个壳）—— 想看结论就看「扩展」设置面板里
「衣装卡片 · `roleExpansionOutfit`」那一块的文案，或在模块里临时打点。

控制台**调不到**（`inject.js` / `store.js` / `ui.js` 里没被框架壳转发，也没挂到 `roleExpansion`）：
`outfitAvailability` `loadOutfit` `saveOutfit` `persistChange` `setCategoryTags` `togglePicked`
`addCustomCategory` `renameCustomCategory` `removeCustomCategory` `parseTagList` `normalizeCatalog`
`normalizePicked` `encodeOutfitJsonl` `buildOutfitList` `currentIdentity` `buildOutfitPanel`
`renderStatus` `renderPreview` `renderEditor` `buildCategoryRow` `openCategoryModal` `outfitFoldOpen`
`onAddCategory` `openPresetPanel` `describeOutfitCard` `diagnoseOutfitCard` `readOutfitCard`。
需要时临时在模块里打点，或从面板上点一遍（弹窗里的 `保存` / `取消` / `删除分类` 就是那三个入口）。

控制台会自己说话的地方：

- 读 jsonl 失败：`read outfit jsonl failed <文件名> <reason>`
- 写 jsonl 失败：`write outfit jsonl failed <文件名> <reason>`
- 探针异常：`probe outfit storage failed` / `probe outfit storage: unexpected reason <reason>`
  （后者只记一笔、**不置灰面板** —— 它只覆盖 `AVAIL_REASONS` 之外的原因，例如网络抖动）
- 白名单里没有 `outfit`（旧版补丁）：`probe outfit storage: 服务端拒绝了 outfit 路径（invalid-path / 400）—— 资源端点的白名单里没有 outfit。…`
  （这一条**会**置灰面板，并把 `rt.state.reason` 记成 `sub-not-allowed`）
- 注册失败：`registerRuntimePromptSource failed`
- 补丁检测：`[ST-RoleExpansion] ST 补丁已生效（衣装）：…` / `ST 补丁不完整，衣装卡片会没有开关/铅笔。`
- 卡片诊断（`quiet: false` 时）：`[ST-RoleExpansion] 诊断：衣装卡片状态`

排查顺序建议：`roleExpansion.modules()` 看模块在不在、启没启用 → 面板状态行看原因 →
`probeAssetStorage('outfit')` → `ensureOutfitRuntimeSource()` → `reloadOutfit()` → 直接看磁盘上的 jsonl。

---

## 10. 已知限制与预留扩展点

| 项 | 现状 |
| --- | --- |
| 群聊 | **不支持**：`hasGroup()` 本地判 `group`，状态行红字、连请求都不发（衣装按角色目录存放） |
| 注入方向 | **只有单向注入**：没有标签回写、模型不能改你选的衣服（与状态栏模块相反，别混） |
| 固定分类 | `key` 是契约：不可改名、不可删除；缺了会按内置定义补齐 |
| 自定义分类 | `key` 恒为 `custom-<uid>`、`part` 恒为 `other`；只有它能改名 / 删除 |
| 分类名 | 全局唯一（固定分类也参与查重） |
| 备选表 | 只按**英文逗号**切分；中文逗号 / 顿号不是分隔符；去重保序 |
| 选择顺序 | 恒按备选表的顺序（不存点击顺序） |
| 写入 | 整文件覆盖写、无写队列；失败**回滚内存** + Toast（与推特那种「编辑 / 置顶只 toast」不同，这里五个编辑入口全走 `persistChange()`） |
| 导入 / 导出 | **没有**（日记模块那套导入导出没有搬过来） |
| 资源通道 | 依赖 `patches/st-twitter-assets.patch`，且服务端 `ALLOWED_SUBDIRS` 里必须有 `outfit`。**端点不存在**（404）→ `patch-missing`；**端点存在但白名单里没有 `outfit`**（400）→ 归一成 `sub-not-allowed`（§4.5）。两者**同级**：红字 + 两栏置灰，文案由 `outfitReasonText()` 给出「改白名单 + 重启酒馆主进程」的可照做指引；修好后**再点开一次面板就会自动重探**，不必 F5。**不回退**到别的位置 |
| 运行时源注册时机 | `ensureOutfitRuntimeSource()` 只在预设切换路径上被调（`bootstrap()` / `APP_READY` 里没有，§1.5） |
| 面板钩子 | 只有 `buildPanelSection()` 与 `settingsBlock()`：`services` 是空对象（不对外提供服务）、**没有** `debug`（预留能力，框架目前不读） |
| `rt.state.loaded` | 只在 `loadOutfit()` / `saveOutfit()` 里置 `true`，只有 `renderOutfit()` 的自愈加载读它 |
| i18n | 界面文案全是硬编码简体中文，没走酒馆的 `t()` |

预留扩展点（都没做，留个位置）：

- **标签回写**：像状态栏那样解析回复里的衣装标签并更新 `picked` —— 数据层不用动（`togglePicked` 那套够用），
  难点是「允不允许模型改用户的选择」这个设计问题。
- **按场景/时段多套**：现在一个会话只有一份 `picked`；要多套就得把第 3 行的 `picked` 换成命名集合，
  并同步改 `normalizePicked()` / `encodeOutfitJsonl()` / `buildOutfitList()`。
- **导入 / 导出**：`encodeOutfitJsonl()` 的输出本身就是可搬运的文本，缺的只是 UI。

---

## 11. 自测覆盖

`npm test`（= `node tools/smoke-test.mjs`）用 stub DOM + 酒馆桩直接加载真 `index.js`，纯 Node、不需要浏览器。
衣装相关断言散在整份脚本里，搜 **`衣装` / `outfit`**（以及 `roleEx-outfit-*` 这些 id / 类名）就能定位。
覆盖到的（**不写死断言总数** —— 那个数字会随迭代变，以脚本结尾打印的 `全部通过（共 N 项断言）` 为准）：

> 0.10.1 把编辑器从「行内输入框 + 行内芯片」改成「编辑弹窗 + 三个折叠块」，这一批断言**同步重写过**：
> 旧结构现在是按「**不存在**」断言的（`#roleEx-outfit-tags-*` / `.roleEx-outfit-group-head` /
> `.roleEx-outfit-tags` 的 CSS 规则），所以别把它们当成漏测。

- **面板结构**：清单第一条 = 主面板里的**第一块**；`#roleEx-outfit-section` 带 `roleEx-span-all` 且默认收起；
  正文的直接子节点恰好是 `[状态行, 两栏, 注入模板折叠块]`；
  两栏里 `#roleEx-outfit-preview` / `#roleEx-outfit-editor` 都在；注入模板折叠块默认收起
- **分类折叠块（0.10.1）**：编辑器里是**三个** `.inline-drawer.roleEx-fold.roleEx-outfit-group`，
  带 `#roleEx-outfit-fold-outer` / `-inner` / `-other`，**默认全部收起**（body 显式 `display:none`）；
  点 header 展开后 `rt.state.foldOpen[<key>]` 翻成 `true`，**重画后仍保持**（同一页面内）；
  「其他」组里是 `#roleEx-outfit-add-cat`，另两组没有它
- **分类行只剩两个节点（0.10.1）**：`#roleEx-outfit-cat-<分类key>` 下只有
  `.roleEx-outfit-cat-name` + `.roleEx-outfit-cat-btn#roleEx-outfit-edit-<分类key>`（文案就是 `编辑`，固定分类也有）；
  旧版的**行内**节点 `#roleEx-outfit-tags-*` / `#roleEx-outfit-chips-*` / `#roleEx-outfit-rename-*` /
  `#roleEx-outfit-del-*` **都不再存在**（断言按「不存在」钉）
- **预览区（0.10.1）**：CSS 规则里 `#roleEx-outfit-preview` 是 `flex: 0 0 55%` + `min-height: 12em`
  （自测读的是 `style.css` 文本，值逐字比对）
- **分类编辑弹窗（0.10.1）**：点 `编辑` 后 `document.body` 下出现 `.roleEx-modal#roleEx-outfit-modal`，
  里面依次是 `.roleEx-modal-head`（`编辑「<分类名>」`）、`.roleEx-outfit-modal-field`（名称，**只有自定义分类才有**）、
  `.roleEx-outfit-modal-field`（备选：`#roleEx-outfit-modal-tags` + 「用英文逗号分隔」提示）、
  芯片行 `#roleEx-outfit-modal-chips`（备选非空时）/ `.roleEx-hint`「先在上面填备选 tag」（备选为空时）、
  以及三个按钮 `#roleEx-outfit-modal-save` / `-cancel` / `-del`（`-del` 只有自定义分类才有）；
  同一时刻只允许一个弹窗（重开先 `remove()` 同名旧节点）
- **弹窗里的行为**：点芯片 → `togglePicked()` 立即落盘（成功才加/去 `.is-on`）、失败时 DOM 不动；
  `保存`：名称改了才 `renameCustomCategory()`、备选变了才 `setCategoryTags()`，**两步都成功才关窗重画**，
  失败停在弹窗里；空名 → Toast `名称不能为空`（不写盘）、重名 → Toast `已有同名分类`（不写盘）、
  两步都没变化 → 直接关窗（不产生写盘）；
  `取消`：只 `remove()` 弹窗、**零写盘**（但**不回滚**已点过的芯片）；
  `删除分类`：有 `confirm()`，确认后才 `removeCustomCategory()`，成功才关窗重画
- **芯片选中态（0.10.1）**：CSS 规则里 `.roleEx-outfit-chip.is-on` 是
  `color: var(--SmartThemeQuoteColor, #e0b000)` + `border-color: currentColor` + `background-color: var(--black30a)`
  （**背景与未选态一致**，断言不会把 `.is-on` 当成实底高亮）
- **分类模型**：七个固定分类（外 5 + 内 2）都在、顺序是 外 → 内 → 其他；
  自定义分类落在「其他」；固定分类的弹窗里**没有**名称框与 `删除分类`；
  新建重名 / 空名被拒；删除自定义分类会把它的备选 tag 与已选一起清掉
- **备选表**：英文逗号切分 + `trim` + 去空 + 去重保序；**中文逗号不切分**；
  提交是整表替换；连带清掉不在新表里的已选 tag
- **选择**：分类内多选；顺序恒按备选表（与点击先后无关）；写盘 → 读回保持一致
- **存储**：文件名是单段 ASCII、带 `RoleExpansion_outfit_` 前缀、双 hash、以 `.jsonl` 结尾、换会话换文件；
  落盘是稳定的三行（`outfit-session` / `outfit-catalog` / `outfit-selection`）；
  落点文案 = 角色聊天目录下的 `_RoleExpansion/outfit/`；走 `/api/role-expansion/asset` 且 `sub = 'outfit'`
- **归一化**：固定分类补齐；未知固定 key 丢掉；`picked` 里不在 catalog 里的 key 与不在备选表里的 tag 丢掉；
  坏行被计数并给出「已跳过 N 行」提示
- **注入**：`{{outfitList}}` 被填进模板；分组清单是「每部分一行、`分类名=a / b`、行内 `；`、空部分整行不出现」；
  一个都没选 → 空串；三道闸各自生效（没插进 order / `enabled === false` / 没选）
- **不可用路径**：
  - 群聊 → `reason = 'group'` + 红字 + **不发任何资源请求**；没选角色 → 状态行**不带** `roleEx-warn`；
    缺补丁（404）→ `patch-missing` + 状态行点出 `st-twitter-assets.patch`；
    所有不可用情形下 `.roleEx-outfit-cols` 都带 `is-disabled`
  - **`sub-not-allowed`**（旧版补丁、端点 400）一整条链都有断言：`toPageReason('invalid-path')` → `'sub-not-allowed'`
    （认得出的页面级原因原样返回、`network` 不归一）；框架侧 400 → `invalid-path` 的**两半接续**
    （探针拿到 `invalid-path` → 归一成 `sub-not-allowed` **且 `rawReason` 原样保留**）；
    渲染层红字（`roleEx-warn`）+ 文案含 `ALLOWED_SUBDIRS` / `['twitter','outfit']` / 「重启酒馆主进程」
    三个 token、且**不是**框架那句 + `is-disabled`；**探针只探一次并缓存**（第二次 `outfitAvailability()` 不再发请求）
  - **两个对照组**（证明上面那组不是恒真）：探针 `ok` → 不红字、不置灰、状态行是落点文案；
    `patch-missing` → 红字 + 置灰不变，**文案仍走框架的 `assetReasonText()`**
  - **`armOutfitReprobe()`**：刚探完 → `false`（3 秒节流）；把时钟推过 `REPROBE_MIN_INTERVAL_MS` 且原因是页面级
    → `true` 且 `rt.state.probed` 被置回 `false`；`network` / `no-character` → `false`
- **源码层面**：模块不自己拼 `fetch`（走框架的资源通道）；模块源码里没有 `<script`；
  `defaults.outfitInjectPrompt` 参与「存为默认设置 → 恢复默认设置 → 清基准」的往返
- **模块系统与「扩展」设置面板区块**：`modules/manifest.json` 里 `outfit` 已加载并启用、
  `installed` / `enabled` / `title` 齐全；`settingsBlock()` 挂在 **`create()` 返回的 api 上**（§1.4 / 主 DEVELOPMENT §1.1），
  框架自己把**恰好两块**挂进 `#roleEx-setting-module-blocks`（child[0] 衣装、child[1] 日记，
  先后 = 清单顺序；不是自测代劳、也不是模板硬编码），
  两块里的诊断元素 `#roleEx-preset-card-hint-outfit` / `#roleEx-setting-open-preset-outfit`
  **在全页各只有一份**；`updateOutfitPresetCardHint()` 在卡片不存在时也不抛（走「没找到卡片」分支并把
  `roleExpansionOutfit` 写给用户看），别名 `adoptOutfitCardStateFromPreset()` 同样会刷新文案

配套的 `npm run test:patch` 里 `tools/patch-asset-test.mjs` 从 `patches/st-twitter-assets.patch` 抽端点真跑：
`sub = 'outfit'` 现在是白名单成员，`_RoleExpansion/outfit/` 下的读写删与越权路径（`..`、非白名单 `sub`…）
都按同一套规则被拒。

> 改完记得对着主 DEVELOPMENT 的「快速自检清单」过一遍，尤其是：把 `modules/outfit/` 整个挪走再跑一次 `npm test`
> —— 框架与另外三个模块应当照常工作，只有衣装相关断言会红。

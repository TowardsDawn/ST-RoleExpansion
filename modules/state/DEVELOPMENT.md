# 角色状态栏模块 开发说明（`modules/state`）

> 面向接手改这块代码的人。框架 / 模块系统 / 面板层级等**共性**内容见主 [DEVELOPMENT.md](../../DEVELOPMENT.md)，
> 用户视角见 [README.md](./README.md)。本文只讲 `modules/state/` 这 4 个文件。

## 0. 四个文件的职责

```
index.js   描述符（id / title / icon / defaults）+ create(kernel) 组装 + services
store.js   chatMetadata 读写（按会话隔离）+ 旧键一次性迁移
inject.js  往主聊天注入状态文本 + 解析 / 剥离 <名称>值</名称> 标签
ui.js      「角色状态栏」面板（开关 / 列表 / 批量添加 / 注入提示词子区块）
```

| 文件 | 边界（不做什么） |
| --- | --- |
| `index.js` | 只做组装，不含业务逻辑：`create(kernel)` 里建 `rt.store / rt.inject / rt.ui` 三个工厂实例，再把它们的返回值平铺进 api。工厂之间**惰性转发**（`rt.<key>.xxx()` 调用时才取，绕开文件创建顺序导致的循环依赖） |
| `store.js` | 只管数据落点：不拼 DOM、不碰注入。对外 `getMetaRoot / getStateList / migrateLegacyState / saveMeta / saveMetaDebounced` |
| `inject.js` | 只管「往外说」与「往里读」：`applyStateInjection / buildStateText / isStateTagName / parseAndStripStateTags / onCharacterMessageReceived` |
| `ui.js` | 只管 DOM：`buildStatePanel / renderStateList`。数据改动一律走 `rt.store`，注入重算走 `rt.inject` |

依赖方向三条（与日记模块同一套约定）：

1. **框架设施**由 `create(kernel)` 注入并解构在工厂作用域顶部（`el` / `section` / `settings` / `ctx` / `debounce` …）；
   `settings` 与 `ui` 是**长期同一个对象**，绝不能缓存它们的字段快照。
2. **同模块跨文件**用 `rt.<key>.xxx(...)` 惰性转发。
3. **跨模块**只走 `kernel.service()`；本模块不依赖任何其它模块。

## 1. 模块接口

### 1.1 描述符

```js
export default {
    id: 'state',
    title: '角色状态栏',
    icon: 'fa-solid fa-heart-pulse',
    defaults: DEFAULTS,          // 见 §2
    create(kernel) { … },
};
```

`modules/manifest.json` 里的条目是 `{ id: 'state', path: './state/index.js', title: '角色状态栏', icon: 'fa-solid fa-heart-pulse' }`；
清单里的 title / icon 只作兜底，模块自己声明的优先。

### 1.2 `create()` 返回面

```js
return {
    id: 'state',
    ...rt.store, ...rt.inject, ...rt.ui,     // 三个工厂的函数全部平铺（框架桥接按名字找的就是这批）
    buildPanelSection: () => rt.ui.buildStatePanel().root,   // 主面板区块，框架 append 进 #roleEx-scroll
    services: {
        getStateList: rt.store.getStateList,   // → meta.state（数组本体，不是副本）
        buildStateText: rt.inject.buildStateText,
    },
};
```

- **`buildPanelSection()` 是唯一的面板钩子**：只有在 `modules/manifest.json` 里列着、且没被 `settings.modules.state = false` 禁用时，
  框架才会在挂面板时调用它（`activeModules()` → `mod.api.buildPanelSection?.()`）。
- 本模块**没有** `settingsBlock(kernel)`，也没实现 `debug`（框架那侧也没有读 `debug` 的代码）：
  所以酒馆「扩展」设置面板里**没有**状态栏的区块，控制台也没有 `roleExpansion.state.*` 命名空间。
- **`defaults` 不管启用与否都会被并进设置默认值** —— 禁用再启用不会丢用户配置（框架行为，见主文档 §1.1）。

### 1.3 框架 ↔ 模块的桥接

框架 `index.js` 的「模块桥接」章节里，状态相关的转发壳（全部 `callModule('state', fn, …)`，
模块不在 / 被禁用 / 没这个函数 → 返回 `undefined`，**绝不抛**）：

| 框架里的壳 | 何时被框架调用 |
| --- | --- |
| `applyStateInjection()` | `APP_READY`、`CHAT_CHANGED`、`resetToDefaults()` |
| `onCharacterMessageReceived()` | `MESSAGE_RECEIVED`（外层包了 try/catch，失败打 `state parse failed`） |
| `renderStateList()` | `onPanelOpened()`（面板打开 / 面板开着时切会话都会走到） |
| `getMetaRoot()` | 框架启动 `bootstrap()` 里的 `getMetaRoot()`（把元数据结构先建出来） |
| `getStateList()` | **只有** `globalThis.roleExpansion.getStateList()` 这一处。模块内部用的是自己 `rt.store.getStateList`，不走这个壳 |

> 注意 `renderStateList` / `onCharacterMessageReceived` / `getMetaRoot` **没有**挂到 `globalThis.roleExpansion`，
> 控制台能直接调到的只有 `getStateList()` 与 `applyStateInjection()`（见 §7）。

### 1.4 services：给日记模块的消费方

框架把服务登记成两种粒度（同名 bag + 平铺名），本模块的消费方是**日记模块**：

```js
// modules/journal/generate.js
const buildStateText = (...args) => kernel.service('state')?.buildStateText?.(...args) ?? '';
const getStateList   = (...args) => kernel.service('state')?.getStateList?.(...args) ?? [];
// buildJournalPrompt() 里：
const stateEnabled = settings.stateIncludeInJournal !== false;
stateList: stateEnabled ? (buildStateText() || '（暂无状态）') : '（未开启状态联动）',
```

即：`kernel.service('state')` 拿到 `services` 那个 bag；`kernel.service('buildStateText')` 也能拿到同一个函数。
**安全缺省由消费方自己给**（`?? ''` / `?? []`），所以把 `modules/state/` 整个删掉，日记只是少一段状态参考。

## 2. 设置键

`DEFAULTS` 在 `index.js` 里，是「存为默认设置」快照的基准之一。

| 键 | 默认 | 谁读它 |
| --- | --- | --- |
| `stateEnabled` | `true` | `applyStateInjection()`（注入三条件之一）、`onCharacterMessageReceived()`（总闸）、面板勾选框 |
| `stateAutoInject` | `true` | `applyStateInjection()`（注入三条件之一） |
| `stateStripTags` | `true` | `onCharacterMessageReceived()`：`!== false` 才把剥离结果写回 `last.mes` |
| `stateInjectDepth` | `0` | `applyStateInjection()` 的第 4 个参数 |
| `stateInjectRole` | `'system'` | `applyStateInjection()`：`'assistant'` → `EXT_ROLE_ASSISTANT`，`'user'` → `1`，其余 → `EXT_ROLE_SYSTEM` |
| `stateIncludeInJournal` | `true` | **日记模块**读（`journal/generate.js`），本模块不读 |
| `stateOnlyKnownNames` | `true` | `onCharacterMessageReceived()`：`!== false` 时传 `isKnownName` 判据 |
| `stateInjectPrompt` | 多行模板，见 §5 | `applyStateInjection()`，经 `renderTemplateString` 替换 `{{stateList}}` |

读法一律是「`!== false` 才算开」/「`?? 默认`」风格：设置里没有这个键时行为等于默认值。

## 3. 存储：`chatMetadata.roleExpansion.state`

| | |
| --- | --- |
| 位置 | `ctx().chatMetadata.roleExpansion.state`，`META_KEY = 'roleExpansion'`，元素 `{ name: string, value: string }` |
| 取出 | `getStateList()` → `getMetaRoot()` → `migrateLegacyState(meta)` → **返回 `meta.state` 本体**（没有 clone） |
| 因此 | 调用方拿到的是活引用：面板的批量添加 / 编辑 / 删除都是就地改数组（`items.push(...)` / `item.value = ...` / `items.splice(...)`） |
| 落盘 | `saveMeta()`：优先 `ctx().saveMetadata()`，抛错或不存在时退回 `globalThis.saveMetadata?.()`，两处失败都只 `logError` |

`getMetaRoot()` 的三层兜底（每次调用都检查）：`chatMetadata` 不存在 → 建 `{}`；
`chatMetadata[META_KEY]` 不是对象 → 整体重置成 `{ state: [] }`；`.state` 不是数组 → 重置成 `[]`。
（`ctx()` 取不到上下文时返回一个临时 `{}`，不会去碰全局。）

### 3.1 写入时机

| 场景 | 用哪个 | 为什么 |
| --- | --- | --- |
| 批量添加 / 编辑保存 / 删除 / 清空全部 | `saveMeta()` **立即** | 用户刚点的操作，没必要防抖 |
| 旧键迁移 | `saveMeta()` **立即** | 一次性动作，要确保 `legacyMigrated` 标记真的落下去 |
| 解析到标签后的数值更新 | `saveMetaDebounced`（`debounce(saveMeta, 300)`） | 连续回复 / 连点重 roll 时不反复写 |

UI 侧写完的固定三连：`saveMeta()` → `renderStateList()` → `applyStateInjection()`（解析侧是 `saveMetaDebounced()` + 同样两连）。

### 3.2 旧键迁移：`chatMetadata.sillyTavernState`

`migrateLegacyState(meta)` 在**每次 `getStateList()`** 里被调用，逻辑是：

```js
if (meta.legacyMigrated === true) return;                       // ① 一次性标记，有就永远不再进
const legacy = ctx()?.chatMetadata?.sillyTavernState;
if (Array.isArray(legacy) && legacy.length
    && (!Array.isArray(meta.state) || meta.state.length === 0)) { // ② 本扩展这侧为空才迁
    meta.state = legacy.map(x => ({ name: String(x?.name ?? ''), value: String(x?.value ?? '') }))
                       .filter(x => x.name);                     // ③ 名称为空的丢掉
}
meta.legacyMigrated = true;                                     // ④ 无论是否真的迁移过都落标记
saveMeta();
```

三个要点：

1. **`legacyMigrated` 是必须的，不能只看「本扩展这侧为空」**：用户点过「清空全部」之后本扩展这侧同样是空数组，
   而 `sillyTavernState` 还留在会话文件里 —— 没有标记的话旧数据会在下一次读取时整份复活，
   症状是「清空后一刷新，状态全回来了」。
2. **原键的数据保持原样，不做删除**（用户数据不擅自清）。迁移只读不写另一个键。
3. 标记落盘必须立即（`saveMeta()` 而不是 debounce），否则刷新太快时标记还没写下去。

### 3.3 两个「死」字段，别被误导

| 名字 | 现状 |
| --- | --- |
| ~~`META_STATE_KEY = 'roleExpansionState'`~~ | 曾是死代码：全仓没有读取点（真正的键是 `META_KEY`）。**0.5.0 整理文档时已从 `index.js` 删除** |
| ~~`ui.stateList`~~ | 同上：只有声明、没有任何写入 / 读取点，已删除。状态数据的唯一来源是 `getStateList()`；往共享 `ui` 里塞单模块自用的字段是反模式（框架那条注释也一起改了） |

## 4. 解析流程

### 4.1 入口与守卫

```text
MESSAGE_RECEIVED ─→ 框架壳 onCharacterMessageReceived()
                       │  外层 try/catch，异常打 'state parse failed'
                       ▼
       settings.stateEnabled === false        → 直接 return
       chat 数组为空 / 最后一条是 is_user      → 直接 return
       last.mes 不是 string                    → 直接 return
                       ▼
   knownNames = new Set(list.map(x => x.name))
   parseAndStripStateTags(last.mes, {
       isKnownName: settings.stateOnlyKnownNames !== false ? (n => knownNames.has(n)) : null,
   })
```

- **只看 `chat[chat.length - 1]`**（不是事件参数里的 index），也不区分是不是 swipe / 重 roll。
- 已知名单是**解析前**从当前列表构建的 `Set`：同一段正文里第一次被收录的新名称，不会在同一次解析里变成「已知」。

### 4.2 正则与游标拼接

```js
const regex = /<([^/<>\s][^<>]*)>([^<>]*)<\/\1>/g;
```

- 名称的首字符不能是 `/` `<` `>` 或空白，名称与值的其余部分都不能含 `<` `>`；闭合标签用反向引用 `\1` 要求**名称逐字符一致**。
- 匹配后 `name` / `value` 各自 `trim()`（`\1` 比对的是**原始捕获**，所以闭合处也得带同样的空格才算匹配）。
- 循环里**不改动 `out` / `cursor` 的只有一条路径**：准入失败 → `rejected.push(name || '(空名)')` + `continue`，标签连内容原样留在正文里。

```js
out += src.slice(cursor, match.index);   // 只把「上一个已接受标签结尾 → 本标签开头」之间原样搬运
cursor = regex.lastIndex;                // 已接受标签整体跳过（连标签带值一起删）
…
if (!updates.length) return { changed: false, updates, rejected, text: src };  // 一个都没接受 → 原文返回
out += src.slice(cursor);
return { changed: true, updates, rejected, text: out.replace(/\n{3,}/g, '\n\n').trim() };
```

**为什么要游标拼接而不是 `src.replace(regex, '')`**：旧实现一刀切，会把没通过准入的标签**连同内容**删掉 ——
`<thinking>推理</thinking>`、`<div>装饰</div>` 整块消失，表现为「回复莫名少一段」。
现在的契约是：**只有通过准入的标签才被剥离**。压缩连续换行与 `trim()` 也只在 `changed === true` 时做。

### 4.3 准入判据与顺序（旧主文档叫「三层准入」，绝对不要调）

旧主文档 §4.4 说的「三层」= 未知名称要过的那三道闸（长度 / 形状 / 黑名单）；代码里实际有 5 步：
**已知名单优先放行**在最前、**开关判据**在最后。

`isStateTagName(name, isKnownName)`：

```js
if (!name) return false;                                     // ⓪ 空名
if (isKnownName && isKnownName(name)) return true;           // ① 已知名称 → 直接放行
if ([...name].length > MAX_STATE_NAME_LENGTH) return false;  // ② 长度闸：> 12 拒绝
if (/[\s\-./\\]/.test(name)) return false;                   // ③ 形状闸：空白 / - . / \ 拒绝
if (NON_STATE_TAGS.has(name.toLowerCase())) return false;    // ④ 黑名单
return !isKnownName;                                         // ⑤ 未知名称由开关决定
```

顺序为什么重要：

- **① 必须在 ②③④ 之前**。用户自己在面板里建的状态名是权威数据，长度与黑名单都不该成为它的门槛 ——
  否则一个 13 字的状态名会**永远收不到更新，而且是静默失败**（只在控制台列一下被忽略的标签名）。
  实测用例：`户外露出调教进度百分比数值`（13 汉字）在「只接受已知状态名」开启时仍必须能更新。
  同理，用户把状态命名成 `plan` / `analysis` 这类黑名单词时，已知名单也让它照常工作。
- **② 按码点算**：`[...name].length` 而不是 `name.length`。JS 的 `str.length` 数的是 UTF-16 code unit，
  常用汉字是 1，但 emoji 与扩展区汉字（如 `𠮷` U+20BB7）占 2 —— 用 `.length` 会提前触发长度闸。
  反例（自测里钉住的）：`𠮷野家营业状态` 是 7 个码点 / 8 个 code unit，关闭已知名单限制后必须能通过；14 个汉字必须被挡下。
- **⑤ 落在最后**：`isKnownName` 为 `null`（面板上关了「只接受已知状态名」）才放行未知名称；
  注意**黑名单与形状闸在关闭白名单后依然生效** —— `<analysis>`、`<div>` 任何时候都不收。
- 长度闸只管**名称**，值多长都不管；`MAX_STATE_NAME_LENGTH = 12` 与 `NON_STATE_TAGS` 都由**框架**在 `kernel` 里提供
  （注释写着「状态标签准入闸的常量（状态栏模块用）」），不在这里定义。

### 4.4 更新与后续动作

```js
for (const { name, value } of updates) {
    const item = list.find(x => x.name === name);
    if (item) item.value = value;          // 同名 → 就地改值（同段正文里重复出现，后一次覆盖前一次）
    else list.push({ name, value });       // 仅「关闭只接受已知状态名」时才走得到
}
if (settings.stateStripTags !== false) last.mes = text;
saveMetaDebounced();
renderStateList();
applyStateInjection();
```

- `rejected.length` 非 0 时打一行 `console.info(`[${MODULE_NAME}] 忽略了 N 个非状态标签：`, rejected)`。
- `changed === false` 时**什么都不做**（不写、不渲染、不重算注入），所以纯聊天不会触发无谓写盘。

## 5. 注入实现

```js
c.setExtensionPrompt(
    EXT_PROMPT_KEY.STATE,       // 'RoleExpansion_State'
    text,                       // renderTemplateString(settings.stateInjectPrompt, { stateList: buildStateText() })
    EXT_POSITION_IN_CHAT,       // 1（in-chat）
    depth,                      // Math.max(0, Math.trunc(Number(settings.stateInjectDepth)))；非有限数 → 0
    false,                      // 第 5 个参数（自测桩里叫 scan）固定 false
    role,                       // 'assistant' → EXT_ROLE_ASSISTANT(2)；'user' → 1；其余 → EXT_ROLE_SYSTEM(0)
);
```

- **常量来源**：`EXT_POSITION_IN_CHAT = 1` / `EXT_ROLE_SYSTEM = 0` / `EXT_ROLE_ASSISTANT = 2` 是 `index.js` 顶部「从 ST 源码抄过来的枚举值」
  （注释里写明对应 ST 的 `extension_prompt_types` 与 `extension_prompt_roles`，为避免静态 import `script.js` 造成路径脆弱）。
- **关闭 / 禁用 / 列表为空时的清空路径**：`!stateEnabled || !stateAutoInject || !list.length` 时调用同一个 key 写入空串
  （`'' , EXT_POSITION_IN_CHAT, 0, false, EXT_ROLE_SYSTEM`），确保面板上看不到旧内容。
- **拿不到 `setExtensionPrompt` 就直接 return**（旧版酒馆 / 桩环境），不抛。
- **文本拼装**：`buildStateText()` = `list.map(i => `${i.name} ${i.value}`).join('\n')`；列表为空返回 `''`。
- **模板替换**：`renderTemplateString()` 先按 `{{stateList}}` 做**纯字符串 split/join**（不是正则，值里有 `$&` 也安全），
  剩下的 `{{char}}` / `{{user}}` 交给 `ctx().substituteParams()`（失败只 `logError` 并返回半成品）。
  服务端 / 日志里看到的就是替换后的最终文本。

**重算注入的触发点**（全部经由框架桥接壳，模块自己不在事件上挂监听）：

| 触发 | 说明 |
| --- | --- |
| `APP_READY` | 启动后第一次算 |
| `CHAT_CHANGED` | 切会话，状态列表换了，注入内容必须跟着换 |
| 面板勾选「启用」「发送前注入」 | 立即重算（另外三个开关不重算） |
| 模板输入（防抖 400ms）/ 深度 change / 角色 change | 立即重算 |
| 列表的批量添加 / 编辑保存 / 删除 / 清空 | 立即重算 |
| 解析到标签之后 | 让下一次生成就带上新数值 |
| `resetToDefaults()` | 设置被整体替换，重算一次 |

## 6. UI 约定

`buildStatePanel()` 用框架的 `section(title, { open })` / `el()` / `checkboxRow()` / `iconFor()`：

| 元素 | id / class | 语义 |
| --- | --- | --- |
| 外层区块 | `#roleEx-state-section`，图标 `fa-solid fa-heart-pulse`，`section('角色状态栏', { open: false })` | 默认收起（三个模块的一级区块都默认折叠） |
| 注入提示词子区块 | `#roleEx-state-tpl-section`，图标 `fa-solid fa-wand-magic-sparkles`，`section('状态注入提示词', { open: false })` | **挂进 `s.content` 而不是 `s.root`** —— 这样它与面板正文走同一套 10px 间距，视觉上明确属于这个面板 |
| 列表容器 | `#roleEx-state-list` + `.roleEx-list` | `renderStateList()` 的重绘目标；超过 420px 内部滚动 |
| 列表项 | `.roleEx-state-row` / `.roleEx-state-name` / `.roleEx-state-value` / `.roleEx-state-edit` | 见下 |
| 模板文本框 | `#roleEx-state-inject-prompt`（`.text_pole .roleEx-textarea`，rows=7） | 输入即时保存，防抖 400ms |
| 深度 / 角色 | `.text_pole.roleEx-num`（number min 0 max 100 / select） | 改完立即 `applyStateInjection()` |
| 五个开关 | `checkboxRow(input, label, hint)`，id 由框架随机生成 | 文案见模块 README 的开关表 |

几条与状态面板直接相关的约定：

1. **折叠箭头语义统一为酒馆原生的「收起 `down` ↓ / 展开 `up` ↑」**，初始 `display` 必须显式写死
   （`section()` 的 `setOpen()` 负责）。这两条是历史坑，改 `section()` 时别只改一半（主文档 §5 第 1、2 条）。
2. **不换行 flex 行里的文字标签必须加 `.roleEx-inline-label`**：
   「注入深度」「注入角色」两个 `span` 都是 `.roleEx-hint.roleEx-inline-label`（`white-space: nowrap` + `flex: 0 0 auto`）。
   不加的话中文会被压到 min-content = 一个字宽 → 竖排。
3. **面板里的下拉框要显式压回宽度**：酒馆的 `.drawer-content select { width: 100% }` 比 `.roleEx-num` 更具体，
   会把「注入角色」撑成整行、把同行后面的控件顶出 `overflow: hidden` 的面板（`#roleExpansionPanel select.roleEx-num` 是兜底规则）。
   这一条与上一条叠加时的症状是「控件明明在 DOM 里，却看不见也点不到」，很容易被误判成「建完节点忘了 append」。
4. **列表项的编辑态切换全是 inline `display`**：名称/值展示用 `span`、编辑用 `input`，两两互斥，
   按钮组也是 `保存/取消 ↔ 编辑/删除` 互斥（`startEdit()` / `stopEdit()`；取消 = 直接 `renderStateList()` 重绘）。
5. **`.roleEx-list` 是共用的列表容器**（状态列表与日记列表都用）：`max-height: 420px` + `overflow-y: auto`；
   状态行 `flex-wrap: wrap`，名称栏 `flex: 0 0 10.5em`、窄屏（`max-width: 600px`）`7em`。
6. **没有单项「恢复默认」按钮**：`ui.js` 里有一句注释明确「单项『恢复默认』已删除（与日记主提示词一致）：统一走扩展设置面板的『恢复默认设置』」。

## 7. 踩过的坑（按当前代码核对）

| 症状 | 根因 | 现在的防护 |
| --- | --- | --- |
| 点「清空全部」后旧状态又复活（清空 → 刷新 → 全回来） | 迁移判据只看「本扩展这侧为空」，而清空之后同样是空数组，`sillyTavernState` 仍在会话文件里 | `legacyMigrated` 一次性标记，无论是否真的迁移都落标记（§3.2） |
| 回复莫名少一段（`<thinking>…</thinking>`、HTML 整块消失） | `parseAndStripStateTags` 用 `replace(regex, '')` 一刀切，把未通过准入的标签连同内容删了 | 游标拼接，只剥离已接受的标签（§4.2） |
| 已知的长状态名（13 汉字）收不到更新，且是静默的 | 长度闸排在「已知名单」判据之前 | 已知名称优先放行（§4.3 ①） |
| emoji / 扩展区汉字被算成 2 个字 | `String.length` 是 UTF-16 code unit | 改用 `[...name].length`（码点，§4.3 ②） |
| 「状态注入提示词」里那一行控件「好像没 append」 | 不换行 flex 行溢出：中文标签被压成竖排 + `.drawer-content select{width:100%}` 撑满整行，尾部被 `#roleExpansionPanel { overflow: hidden }` 裁掉；节点一直都在 DOM 里 | 标签加 `.roleEx-inline-label`、下拉框用 `#roleExpansionPanel select.roleEx-num` 压回可用宽度（§6 第 2、3 条） |
| 同一个 `↓` 图标一会儿表示展开、一会儿表示收起 | 外层 `section()` 与内层 `collapsible()` 两套箭头语义并存 | 统一为酒馆的 `down` / `up` |
| 折叠块「箭头朝上但内容收着」 | `open: true` 时没显式设 `display`，酒馆 CSS 的 `display: none` 生效 | `setOpen()` 里箭头与 `display` 一起设 |

> 框架文档的「踩过的坑」第 7 条现在把症状写成「一行里的控件**看不见也点不到**」——
> 历史上被裁的是「恢复默认」按钮（那个按钮后来**已删除**，`ui.js` 注释里写着），现在是同行的
> 「注入深度 / 注入角色」控件。根因与防护完全一样，只是症状对象变了。

## 8. 调试入口

`globalThis.roleExpansion` 里属于状态模块的成员：

| 成员 | 用途 |
| --- | --- |
| `roleExpansion.getStateList()` | 当前会话的状态数组（**活引用**，改它等于直接改数据） |
| `roleExpansion.applyStateInjection()` | 手动重算一次注入（改完设置不生效时先试这个） |
| `roleExpansion.settings.stateInjectPrompt` 等 | `settings` 是活引用，可在控制台直接改 `state*` 键验证行为（`resetToDefaults()` 会整体替换） |

不在 `globalThis` 上、但框架里有壳的：`renderStateList()` / `onCharacterMessageReceived()` / `getMetaRoot()` ——
控制台调不到，需要时临时挂到 `roleExpansion` 上或直接在代码里打点。

其余排查手段：

- 被忽略的标签名：控制台 `[ST-RoleExpansion] 忽略了 N 个非状态标签：[…]`（`console.info`）。
- 解析异常：`MESSAGE_RECEIVED` 的 try/catch 打 `[ST-RoleExpansion] state parse failed`。
- 注入实际内容：本模块只往 ST 的注入槽写字符串，界面上没有直接展示 —— 要么在 `applyStateInjection()` 里临时打一行，要么直接看酒馆实际发出的请求体里那段模板文本。
- 数据落点：控制台 `SillyTavern.getContext().chatMetadata.roleExpansion`。

改动生效方式：模块只在启动时装配一次，**改完刷新页面**（`Ctrl+F5`）。

## 9. 已知限制与边界

| 项 | 现状 |
| --- | --- |
| 消息范围 | 只解析**最后一条**消息；历史消息里的标签不会再被处理 |
| 值的内容 | 值里不能含 `<` / `>`（正则 `[^<>]*`）；标签必须同名闭合 |
| 群聊 | 代码里**没有任何群聊判断**（不像日记模块有 `journalAvailability() → 'group'`）：状态走 `chatMetadata`，日记那条「群聊不支持」的限制与本模块无关 |
| 无上下文 | `ctx()` 拿不到上下文时 `getMetaRoot()` 返回临时 `{}`，此时 `getStateList()` 可能返回 `undefined`（调用方别假设一定是数组） |
| 旧数据 | `chatMetadata.sillyTavernState` 只迁移一次，原键保留不删 |
| 撤销 | 单项「删除」与「清空全部」都不可恢复；剥离也是就地把 `last.mes` 改写掉 |
| i18n | 界面文案全是硬编码简体中文，没走酒馆的 `t()` |
| 死代码 | `META_STATE_KEY`、`ui.stateList` 已在 0.5.0 的文档整理里删除（§3.3）；往共享 `ui` 加字段前先确认真的有两个以上读者 |

# 推特模块 开发说明（`modules/twitter`）

> 面向改 `modules/twitter/` 的人。框架 / 模块系统 / 补丁 / 仓库结构见[主 DEVELOPMENT.md](../../DEVELOPMENT.md)；
> 用户视角见 [README.md](README.md)。本文件只讲这个模块内部**怎么运作**、以及**改之前必须知道什么**。

---

## 0. 六个文件的职责与依赖方向

```
index.js   描述符（id / title / icon / defaults）+ 组装 rt + 唯一的对外钩子 buildPanelSection()
stats.js   四个数字：randomInt / makeStats（创建时随机一次）/ formatCount（K / M 显示）
store.js   会话身份与文件名、jsonl 编解码、资源通道读写、头像 / 横幅 base64 ↔ data URL
capture.js 标签契约解析与剥离、nextSeq / makeTweet / addTweet、MESSAGE_RECEIVED 入口
render.js  buildTwitterHtml()：把资料 + 推文渲染成一份自包含的 srcdoc（纯字符串拼接；escapeHtml + cssUrl 净化）
ui.js      主面板区块、iframe 接线（标签 / 关注 / 🔄 / ❤️）、资料区、推文管理、编辑器弹窗、解析设置
```

| 文件 | 边界（不做什么） |
| --- | --- |
| `index.js` | 只组装：建 `rt.state` + 五个工厂（顺序 `stats → store → capture → render → ui`），再把五个工厂的返回值平铺进 api。没有业务逻辑 |
| `stats.js` | 不碰 DOM、不碰存储；`kernel` 一个成员都不取 |
| `store.js` | 只管数据落点与编解码；不拼 HTML、不管交互 |
| `capture.js` | 只管「一段回复 → 推文对象」；渲染靠 `rt.ui.renderTwitter()`，不认识 DOM 细节 |
| `render.js` | **纯函数**：没有 DOM、没有 `kernel`（工厂体第一行是 `const { } = kernel;`），可以脱离浏览器直接调 |
| `ui.js` | 只管 DOM 与交互；数据改动一律走 `rt.store` / `rt.capture` |

依赖方向三条（与日记 / 状态同一套约定）：

1. **框架设施**在工厂作用域顶部解构（`const { el, section, settings, ctx, … } = kernel;`）；
   `settings` / `ui` 是**长期同一个对象**，**不要缓存它们的字段快照**。
2. **同模块跨文件**一律惰性转发：`const xxx = (...a) => rt.<key>.xxx(...a);`（调用时才取）。
   六个文件里**没有任何「直读」** —— 这点与日记模块不同（日记有几处必须直读、因此有硬创建顺序）；
   这里的 `stats → store → capture → render → ui` 只是 `index.js` 注释里的约定，改成箭头转发后不存在顺序约束。
3. **跨模块**：本模块**不依赖任何其它模块**，也不对外提供 `services`。

样式**不在模块里**：框架 `style.css` 里 `.roleEx-twitter-frame` / `.roleEx-twitter-field` / `.roleEx-twitter-row*`，
以及共用容器 `.roleEx-list`（`max-height: 420px` + `overflow-y: auto`）与 `.roleEx-span-all`（`grid-column: 1 / -1`）。
模块源码里没有 `<style>`（只有 srcdoc 内部那份）。

---

## 1. 模块接口

### 1.1 描述符与 defaults

```js
export default {
    id: 'twitter',
    title: '推特',
    icon: 'fa-brands fa-x-twitter',
    defaults: DEFAULTS,
    create(kernel) { … },
};
```

`modules/manifest.json` 里 twitter 是 `modules[]` 的**第一条**，所以主面板里这一块排在最上面。

| 键 | 默认 | 面板 UI | 谁读它 |
| --- | --- | --- | --- |
| `twitterCapture` | `true` | ✅「解析模型回复里的推文」 | `capture.onCharacterMessageReceived()`：`=== false` 直接 return（不解析、不剥离） |
| `twitterStripTags` | `true` | ✅「把消费掉的标签从正文里剥离」 | `capture.onCharacterMessageReceived()`：`!== false && parsed.changed` 才把 `last.mes` 换成剥离后的文本 |

两个键只被 `capture.js` 读；`ui.js` 只负责 `updateSetting()`。

### 1.2 `rt.state`（模块自己的运行时状态）

```js
rt.state = { identity, profile, tweets, avatarDataUrl, bannerDataUrl, reason, loaded, panel };
```

| 字段 | 谁写 | 谁读 |
| --- | --- | --- |
| `identity` | `store.currentChatIdentity()`（`loadTwitterData` 里也写一次） | `renderStatus()`、`persistTwitterData()`、`describeTwitter()` |
| `profile` | `loadTwitterData()` / `onProfileEdited()` / `saveAvatar` / `saveBanner` / `clear*` | 渲染 + 资料区输入框 |
| `tweets` | `loadTwitterData()` / `addTweet()` / `onCharacterMessageReceived()` / 编辑 / `togglePin` / `deleteTweet` | 渲染 + `nextSeq()` |
| `avatarDataUrl` / `bannerDataUrl` | `reloadTwitter()` / `saveAvatar` / `saveBanner` / `clear*` | `render.js`（`renderAvatar()` / `buildTwitterHtml()`） |
| `reason` | `store.loadTwitterData()` / `persistTwitterData()` | `renderStatus()` / `renderFrame()` / `describeTwitter()` |
| `loaded` | 只在 `reloadTwitter()` 里置 `true` | 只有 `describeTwitter()` |
| `panel` | `buildTwitterPanel()` 结尾 | `ui.panel()`（其它所有 DOM 操作） |

- 这些都是**单模块自用**的字段，刻意不往框架的共享 `ui` 里塞（框架那段注释写着原因）。
- 模块**读**框架 `ui` 的地方只有一处：`capture.js` 里的 `ui.generatingJournal`（本插件正在写日记时不解析推文）。

### 1.3 kernel 注入面（模块实际用到的）

| 文件 | 取到的成员 |
| --- | --- |
| `store.js` | `assetPathText` `ctx` `deleteAssetFile` `logError` `readAssetBinary` `readAssetText` `splitLines` `stableHash` `uid` `writeAssetBinary` `writeAssetText` |
| `capture.js` | `assetReasonText` `ctx` `logError` `settings` `toast` `ui` `uid` |
| `ui.js` | `assetReasonText` `checkboxRow` `collapsible` `debounce` `el` `iconFor` `logError` `section` `settings` `textPreview` `toast` `updateSetting` |
| `stats.js` / `render.js` | 一个都不用 |

> 资源通道（`readAssetText` / `writeAssetText` / `readAssetBinary` / `writeAssetBinary` / `deleteAssetFile` /
> `assetReasonText` / `assetPathText` / `probeAssetStorage`）都在**框架**里，因为要 `getRequestHeaders()` 打
> `/api/role-expansion/asset/*`。模块**不允许**自己拼 `fetch` —— 自测里有断言守着（`moduleSrc.includes('fetch(') === false`）。

### 1.4 `create()` 的返回面

```js
return {
    id: 'twitter',
    ...rt.stats, ...rt.store, ...rt.capture, ...rt.render, ...rt.ui,
    buildPanelSection: () => rt.ui.buildTwitterPanel().root,
};
```

- `buildPanelSection()` 是**唯一的面板钩子**：框架 `activeModules()` 筛出有它的模块，把 root `append` 进 `#roleEx-scroll`。
- **没有 `settingsBlock(kernel)`** → 酒馆「扩展」设置面板里**没有**推特区块（模块表里能看到它装没装 / 启没启用）。
- **没有 `services`** → 别的模块拿不到它的东西；`kernel.service('twitter')` 是 `undefined`。
- **没有 `debug`**（框架那侧也没有读 `debug` 的代码）。
- 五个工厂平铺后没有重名；加新名字前先确认框架的转发壳与 `globalThis.roleExpansion` 里没有同名的。

### 1.5 框架 ↔ 模块的桥接

框架 `index.js` 里推特相关的四个转发壳（都走 `callModule('twitter', …)`：模块不在 / 被禁用 / 没这个函数 → 返回 `undefined`，**绝不抛**）：

| 框架里的壳 | 模块函数 | 框架什么时候调 |
| --- | --- | --- |
| `onTwitterMessage()` | `capture.onCharacterMessageReceived()` | `MESSAGE_RECEIVED`（外层 try/catch，抛了打 `twitter capture failed`） |
| `reloadTwitter()` | `ui.reloadTwitter()` | `APP_READY`、`CHAT_CHANGED`（**不看面板开没开**，与日记的惰性加载不同） |
| `renderTwitter()` | `ui.renderTwitter()` | **框架里没有任何调用点** —— 只挂在 `globalThis.roleExpansion` 上（控制台 / 自测在用） |
| `describeTwitter()` | `ui.describeTwitter()` | 同上，只有 `globalThis` |

三条约定值得记住：

1. 模块内部那个入口叫 `onCharacterMessageReceived()`，与**状态模块同名**。框架按模块 id 分派（`callModule('twitter', …)`），
   所以互不影响；但改壳名时两边都要对得上，否则调用点静默变空操作。
2. 推特的数据加载挂在 `APP_READY` / `CHAT_CHANGED` 上，**不等面板打开**；`buildTwitterPanel()` 结尾自己调一次
   `renderTwitter()` 把内存里的数据画出来。
3. `renderTwitter` 这个壳目前是「有壳无调用点」：换会话 / 启动之外的数据变化（比如你在控制台改了 `rt.state.tweets`）
   **不会**自动重画，得自己调 `roleExpansion.renderTwitter()`。要让它有用就得在框架里加调用点。

---

## 2. 数据流

```
MESSAGE_RECEIVED ──框架壳 onTwitterMessage()──▶ onCharacterMessageReceived()
   │ 守卫（顺序即代码顺序）：
   │   settings.twitterCapture === false      → return
   │   ui.generatingJournal                    → return（本插件写日记的那次生成不解析）
   │   ctx().groupId                           → return（群聊，本地判）
   │   chat 为空 / 最后一条 is_user / last.mes 不是 string → return
   ▼
parseTweetTags(last.mes) → { tweets:[{time,content}], changed, stripped, ignored }
   │                                    │
   │                                    └─ changed && twitterStripTags !== false → last.mes = stripped（就地改写）
   ▼
created = parsed.tweets.map(item => makeTweet(...))
   │   makeTweet()：nextSeq() / pinned:false / stats（弹窗传进来就用它，否则 makeStats() 随机一份）
   ▼
persistTwitterData()   ← 整文件覆盖写（会话头 + 资料 + 全部推文）
   ├─ 失败：tweets 回滚（filter 掉刚加的）→ logError('persist twitter failed') → toast(assetReasonText(reason)) → return
   └─ 成功：toast('已收录 N 条推文（见面板「推特」区块）。') → renderTwitter()
                                                          ├─ renderStatus()
                                                          ├─ renderFrame()   → buildTwitterHtml() → iframe.srcdoc
                                                          ├─ renderManage()
                                                          └─ fillProfileInputs()（跳过 document.activeElement）
```

| 阶段 | 函数 | 要点 |
| --- | --- | --- |
| 守卫 | `onCharacterMessageReceived()` | 只看 `chat[chat.length - 1]`，不用事件参数里的 index；群聊 / 写日记期间直接跳过 |
| 解析 | `parseTweetTags(text)` | 纯函数，返回 `{ tweets, changed, stripped, ignored }`；见 §3 |
| 剥离 | 同上 | 就地改写 `last.mes`（不是显示层隐藏）；写盘失败会**连正文一起回滚** |
| 建对象 | `makeTweet({ time, content, seq, sourceMessageIds })` | 统计数字在这里随机一次；`sourceMessageIds = [chat.length - 1]` |
| 落盘 | `store.persistTwitterData()` | 整文件覆盖写、无队列；失败时把 `reason` 落在 `rt.state.reason`（状态行随即变红） |
| 重画 | `ui.renderTwitter()` | 四个子渲染；`renderFrame()` 每次直接重建 `srcdoc` |
| 读回 | `ui.reloadTwitter()` | `loadTwitterData()` → 再读两张图 → `renderTwitter()`；`skipped > 0` 时 toast 一次 |

---

## 3. 标签契约与剥离（`capture.js`）

```js
const TWEET_OPEN = '<推文>';    const TWEET_CLOSE = '</推文>';
const TIME_OPEN  = '<推文时间>'; const TIME_CLOSE  = '</推文时间>';
const TAG_RE = /<推文时间>([\s\S]*?)<\/推文时间>|<推文>([\s\S]*?)<\/推文>/g;
```

- 一次 `exec` 循环扫出两种标签并**保持出现顺序**（`m[1]` 有值 = 时间标签），非贪婪、跨行。
- 进函数先做两个短路：`!src.includes('<推文>') && !src.includes('<推文时间>')` → 原样返回；
  一个匹配都没有 → 原样返回。
- 只认这四个**字面量**：带属性、全角、大小写变化都不匹配（这是模块对外的格式契约，改它等于换契约，
  自测里有断言检查源码里这几个字面量还在）。

**配对规则**（`pendingTime` + `orphanTimes`）：

```js
for (const item of matches) {
    if (item.isTime) {
        if (pendingTime) orphanTimes += 1;   // 时间标签连续出现时，前一个作废
        pendingTime = item.value;
        continue;
    }
    if (!item.value) { out.ignored.push('(空推文)'); continue; }   // 空推文不收录，也不消耗 pendingTime
    out.tweets.push({ time: pendingTime, content: item.value });   // 时间配给后面的第一条推文
    pendingTime = '';
}
if (pendingTime) orphanTimes += 1;            // 结尾还挂着一个时间 = 孤儿
```

**剥离规则**：

- `hasTweet`（这段正文里出现过 `<推文>`）为真：
  `stripped = src.replace(TAG_RE, '').replace(/\n{3,}/g, '\n\n').trim()`，`changed = stripped !== src.trim()` ——
  **两种标签整段清掉**，包括没配到推文的孤儿时间标签。
- `hasTweet` 为假（只有孤立时间标签）：`stripped = src`、`changed = false`、不动正文，
  `ignored` 推一条 `孤立的时间标签（整条消息没有 <推文>）`。
- `orphanTimes > 0 && hasTweet` → `ignored` 推一条 `<N> 个没配到推文的时间标签`。
- `ignored` 只在「一个推文都没收到」或「落盘成功之后」打到控制台：
  `console.info('[ST-RoleExpansion] 推特模块忽略了：', parsed.ignored)`。

**写盘失败时正文也回滚**：剥离发生在 `persistTwitterData()` 之前，所以失败分支里除了回滚 `rt.state.tweets`，还会把 `last.mes` 还原成原文 ——
源码里那个 `if` 块里是一句**两边完全一样的三元表达式**（`last.mes = last.mes === parsed.stripped ? last.mes : last.mes;`
否则标签内容既没进文件、又从聊天记录里消失了（早期版本这里有个两边完全相同的 no-op 三元，看着像 bug、实际什么也没做，已改成真回滚）。

`addTweet({ time, content, seq, sourceMessageIds })` 是「手动新增」与「捕获」共用的入口：正文 `trim()` 后为空返回
`{ ok:false, reason:'empty' }`；写盘失败会把刚 push 的条目从 `rt.state.tweets` 里删掉再返回失败结果。
**会回滚内存的只有两条写路径**：`addTweet()` 与 `onCharacterMessageReceived()`（后者用
`filter(t => !created.some(x => x.id === t.id))`）—— 编辑 / 置顶 / 删除都是「改完就写，失败只 toast」。
`reason:'empty'` 在 UI 里到不了：编辑器弹窗已经先挡了「正文不能为空。」。

---

## 4. 排序与 `seq`

```js
function sortedTweets(tweets) {
    const pinned = list.filter(t => t.pinned).sort((a, b) => (b.seq || 0) - (a.seq || 0));
    const rest = list.filter(t => !t.pinned);      // 置顶的不会同时出现在 rest 里
    rest.sort((a, b) => { const d = (Number(b.seq) || 0) - (Number(a.seq) || 0);
                          return d !== 0 ? d : (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0); });
    return pinned.slice(0, 1).concat(rest);        // 至多一条置顶
}
```

- **时间（`time`）不参与排序**，只是显示文本。
- 置顶恒在最上、且只出现一次（`pinned.slice(0, 1)`；手改 JSONL 写成多条 `pinned: true` 也只显示一条）。
- 页面（`render.js`）与推文管理列表（`ui.js`）**共用**这个函数，所以两处顺序永远一致。
- `nextSeq()` = 遍历 `rt.state.tweets` 取最大 `seq`（非有限数忽略）再 +1；`makeTweet()` 在调用方没给合法 `seq` 时用它
  （判据是 `seq !== null && seq !== undefined && seq !== '' && Number.isFinite(Number(seq))`）。
- `pinned` 只由 `ui.togglePin()` 写：先把所有条 `pinned = false`，再把目标设成 `!target.pinned`
  （再点一次 = 取消置顶）→ **代码层面保证至多一条**。
- 编辑器弹窗里 `seq` 是 `type=number, min=1, step=1`，保存时 `Math.max(1, Math.round(Number(v) || 1))`。

---

## 5. 落盘格式与手改兜底（`store.js`）

### 5.1 会话身份与文件名

```js
const chatId = ctx().getCurrentChatId();                       // 可能为空
const raw = chatId ? String(chatId).replace(/\.jsonl$/i, '') : '__noid__/' + charName;
const parts = raw.split('/');   const chatFile = parts.pop() || raw;   const charDir = parts.pop() || charName;
const charKey = stableHash(charDir).slice(0, 8);
const chatKey = stableHash(charDir + '/' + chatFile).slice(0, 8);
fileName = 'RoleExpansion_twitter' + '_c_' + charKey + '_j_' + chatKey + '.jsonl';
```

- 与日记模块同构（`charDir` / `chatFile` 都在返回面里），**前缀换成 `RoleExpansion_twitter`**，
  返回面里也**没有 `path`**（目录由服务端按 `avatar_url` 推）。
- `PREFIX` / `SUB = 'twitter'` / `AVATAR_NAME = 'avatar.png'` / `BANNER_NAME = 'banner.jpg'` 都在这个文件顶部。

### 5.2 文件结构（`encodeTwitterJsonl()`）

```text
第 1 行  {"__roleExpansion":"twitter-session","version":1,"chatId":…,"charDir":…,"chatFile":…,"savedAt":…,"count":N}
第 2 行  {"__roleExpansion":"twitter-profile","name":…,"verified":…,"handle":…,"bio":…,"meta":[…],
          "following":…,"followers":…,"followed":false,"avatar":"avatar.png","banner":"banner.jpg"}
第 3 行起 每行一条 {"__roleExpansion":"twitter","id":…,"time":…,"content":…,"seq":…,"pinned":…,
                    "liked":false,"retweeted":false,"image":"tweet-abc123.png",
                    "stats":{"view":…,"like":…,"retweet":…,"reply":…},"createdAt":…,"updatedAt":…,
                    "sourceMessageIds":[…]}
```

- 每次写都是**整文件覆盖写**：会话头 + 资料行 + 全部推文（资料行**总是**写，即使全空 → `emptyProfile()`）。
- 没有写队列：同一会话并发写 = 后写覆盖先写。
- `sourceMessageIds` 记的是捕获时那条消息的下标；手动新增是 `[]`。

### 5.3 读取容错（`parseTwitterJsonl()` + `normalize*()`）

`parseTwitterJsonl(text)` 是**宽松**的，逐行 `trim()` → `JSON.parse`：

| 行 | 处理 |
| --- | --- |
| `__roleExpansion === 'twitter-session'` | 当会话头（只留**最后一个**） |
| `__roleExpansion === 'twitter-profile'` | 过 `normalizeProfile()`（只留最后一个） |
| `typeof obj.content === 'string'` | 当推文，过 `normalizeTweet(obj, index)`（`index` = 第几条推文，1 起，用作 `seq` 兜底） |
| JSON 解析失败 / 非对象 / 其它 | `skipped += 1` |

- `normalizeProfile(src)`：取 `emptyProfile()` 的键做白名单；`verified` / `followed` 是 `=== true` 才算真；
  `meta` 会 `String()` 后去空行、`slice(0, 12)`；**不认识的字段被丢掉**（手改时加了自定义字段会发现没了）。
- `normalizeTweet(src, fallbackSeq)`：白名单字段；`id` 缺失才 `uid()`；`seq` 非有限数才用 `fallbackSeq`；`liked` / `retweeted` 同上（`=== true`）；
  `num()` 把统计数字统一成「非有限或负数 → 0，否则四舍五入」；`createdAt`/`updatedAt` 缺失兜 `Date.now()`；
  `__roleExpansion` 一律重写成 `'twitter'`。
- 读取时的那条容错链：`loadTwitterData()` 在 `readAssetText` 失败时**不抛**，返回
  `{ ok:false, reason, identity, profile: emptyProfile(), tweets: [], skipped: 0 }`，并把 `reason` 写进 `rt.state.reason`；
  成功时清 `reason` 为 `null`。
- `skipped > 0` 由 `reloadTwitter()` 弹一次「推文文件里有 N 行无法解析，已跳过。」（其他调用方不弹）。

### 5.4 图片

**两条推文配图接口**（都只动文件，不动 jsonl —— 由调用方一起写）：

| 函数 | 行为 |
| --- | --- |
| `tweetImageName(tweetId, dataUrl)` | 按 data URL 的 mime 定后缀（jpeg→jpg，webp/gif 原样，其余 png），id 洗成单段 ASCII |
| `normalizeImageName(value)` | 白名单：`^[a-zA-Z0-9_\-.]+$` 且必须以 `tweet-` 开头 —— 手改 JSONL 写路径也读不进来 |
| `loadTweetImageDataUrl(fileName)` | `readAssetBinary()` → data URL；读不到返回空串（渲染层据此不画 `<img>`） |
| `saveTweetImage(tweet, dataUrl)` | 写新文件 → 旧名后缀不同就删旧文件 → `tweet.image = 新名`；返回 `{ ok, name }` |
| `clearTweetImage(tweet)` | 删文件 + `tweet.image = ''`；返回 `{ ok, removed }` |

- 图**不写进 jsonl**，只在 `image` 字段留文件名；所以 jsonl 不会被图片撑大。
- 渲染用的 data URL 缓存在 `rt.state.tweetImages`（`文件名 → data URL`）：`reloadTwitter()` 按文件名去重后一起读，
  读不到的**不进缓存**（顺带 `console.warn` 一行），`render.js` 只在缓存里有时才画 `<img class="tweet-image">`。
- 换图时记得同步缓存：老键 `delete`、新键写进 picked 的 data URL（`ui.deleteTweet()` / 编辑保存都这么做）。

- `saveAvatar(dataUrl)` / `saveBanner(dataUrl)`：先 `writeAssetBinary(SUB, 固定名, dataUrl)`，
  成功才把资料里的 `avatar` / `banner` 设成固定文件名，再 `persistTwitterData()`。
- `clearAvatar()` / `clearBanner()`：先把资料里的文件名清空 → `deleteAssetFile(SUB, 固定名)` → `persistTwitterData()`，
  返回的是 delete 的结果。所以**删除失败也不影响资料已被清空**（图片文件可能残留在磁盘上，UI 已经不再引用它）。
- `loadAvatarDataUrl()` / `loadBannerDataUrl()`：从资料行的 `avatar` / `banner` 取文件名（可手改成同目录里的别的合规名），
  读不到 `base64` 就返回 `''`（**不当作错误**，页面退化成占位圆 / 默认渐变）。
- 上传前在 `ui.js` 用 canvas 缩图：头像 `200×200` / `image/png`，横幅 `600×200` / `image/jpeg` 质量 `0.85`。

---

## 6. 四个数字（`stats.js`）

```js
function randomInt(min, max) { /* [min, max] 闭区间整数 */ }
function makeStats() {
    const view = randomInt(500, 50000);
    const like    = Math.max(1, Math.round(view * randomInt(20, 80)  / 1000));   // 2% ~ 8%
    const retweet = Math.max(0, Math.round(like * randomInt(100, 300) / 1000));  // 10% ~ 30%
    const reply   = Math.max(0, Math.round(like * randomInt(50, 200)  / 1000));  // 5% ~ 20%
    return { view, like, retweet, reply };
}
```

- 只在 `makeTweet()` 里调用一次 —— 所以「编辑推文」不会重掷；只有新增 / 捕获会掷。
- `formatCount(value)` 分段：`<1000` 原样；`<10000` 一位小数 K（`.0` 去掉）；`<1000000` 取整 K；其余一位小数 M（`.0` 去掉）。
  例：`999` → `999`、`1234` → `1.2K`、`32400` → `32K`、`1500000` → `1.5M`。
- **UI 里刻意不给编辑入口**（面板提示与编辑器弹窗的 `statsHint` 都指向手改 JSONL）：
  数字是「既有事实」，改它只能改文件后 `刷新`。

---

## 7. iframe 方案（`render.js` + `ui.js`）

**为什么 srcdoc 里一个脚本都没有**：`iframe` 的 `sandbox` 只给了 `allow-same-origin`（**没有** `allow-scripts`），
写进去的脚本本来也不会跑；既然父页面同源、能直接读 `contentDocument`，就没有必要引入 postMessage / CSP 那套。
两条硬约定写在 `render.js` 的文件注释里：

1. `srcdoc` 里不出现任何脚本标签 —— 高度测量与标签切换全部由父页面（`ui.js`）直接操作 `contentDocument`；
2. 所有来自用户或模型的内容一律 `escapeHtml()`。

自测里两条断言守着它们：模块源码不含 `<script`；模型写的 `<b>加粗</b>` 在 `srcdoc` 里必须是 `&lt;b&gt;…`。

横幅那一处还要多一层 `cssUrl()`（源码注释写着「三道处理缺一不可」）：

```js
const bannerStyle = banner
    ? "background-image: url('" + escapeHtml(cssUrl(banner)) + "');"   // 注意是小写单引号
    : 'background: ' + DEFAULT_BANNER + ';';
```

1. `url(...)` 必须带引号 —— data URL 里的括号会让裸 `url(...)` 被判成非法 CSS；
2. 外层 `style="…"` 是双引号，CSS 里再出现一个 `"` 会把属性提前截断，所以只能用单引号；
3. 因此先 `cssUrl()` 把 URL 里的 `'` `"` `(` `)` 与空白百分号编码，再用 `escapeHtml()` 兜底。
   头像走的是 `src="…"`（属性里只有 `escapeHtml()`），不需要这一步。

**高度：固定一屏 + 内部滚动（不量高度）**

早先的实现是「按内容量高度」，父页面把 `frame.style.height` 写成内容高度、页面整块长出去。
**这条路已经废弃**，原因见下面「为什么不能量高度」，现在的形态是：

```
iframe 固定高度（style.css: .roleEx-twitter-frame { height: clamp(520px, calc(100vh - 80px), 1000px) }）
└─ body { display: flex; flex-direction: column }        ← srcdoc 里
   ├─ .tw-head { flex: 0 0 auto }                        横幅 / 头像 / 名字 / 简介 / meta / 统计 / 标签页，钉住不动
   └─ #tw-posts.tweets-container { flex: 1 1 auto; min-height: 0; overflow-y: auto }
                                                          ← **唯一的滚动容器**，只滚推文
```

- 父页面**完全不写** `style.height`，也没有 `measureFrame` / `ResizeObserver` 了：页面高度不随内容变，
  就没有「量不到 / 量晚了 / 量歪了」这一整类问题。
- **高度账本**（实测，视口 808 为例）：面板可用高度 = 视口 - 163 = 645；
  区块外的「日记」「状态栏」+ 间距 ≈ 104；本区块除 iframe 外的固定开销 ≈ 136（实测：
  标题行 33 + 三个折叠块 28×3 + 内距 / 间距 ≈ 19）。→ 想让面板**一点不滚**，iframe 只能 405px，列表几乎为零。
  所以取值是刻意让面板滚：**面板滚 ≈ 323px，把高度全留给列表**。
  - **整页高度（= 列表能有多高）** → `style.css` 的 `.roleEx-twitter-frame`：
    `clamp(520px, calc(100vh - 80px), 1000px)` —— 下限 520（矮窗口别缩没）、
    中间项是**主项**（N = 80 就是上面那笔账算出来的：面板滚 ≈ 323px 时的取值）；N 改成 ≈ 405 就是「面板不滚」。
    上限 1000（高窗口别无限长）。
  - **头占多少** → srcdoc 的 `--banner-height`（`clamp(96px, 17vh, 170px)`，跟着 iframe 高度缩）。
    其余部分（头像 72px、名字 / 简介 / meta / 统计的行高、标签页 12px 上下 padding）是固定值 ——
  （头像那 72px 是**高度中性**的：`.profile-header-row` 的负上边距与 `.profile-actions` 的上内距都是
  `calc(var(--avatar-size) / 2 …)`，只改 `--avatar-size` 不会动资料头总高，实测 64 → 72 头仍是 360px。）
    实测头总高 360~406px，**剩下的全归推文列表**。
- 实测（iframe 内宽 636px、8 条推文）：

  | 视口高 | iframe | 横幅 | 头 | **列表** | 面板自身滚动 |
  | --- | --- | --- | --- | --- | --- |
  | 808 | 728 | 124 | 360 | **368px** | ≈323px |
  | 950 | 870 | 148 | 384 | **486px** | ≈323px |
  | 1080 | 1000 | 170 | 406 | **594px** | ≈323px |
  | 1400 | 1000（封顶） | 170 | 406 | **594px** | 5px |

- 正文里之所以只剩 4 个子节点（iframe + 三个折叠块），是因为**状态 + 两个工具按钮搬进了「推文管理」**：
  那个折叠块默认收起，所以这两行平时是 0 高度（要加推文 / 看落点 / 看报错时展开它，第一行就是状态）。
  再加上三个折叠块带 `.roleEx-twitter-fold`（标题行薄一档），一共省下 ≈ 82px，
  全部转给了 iframe（横幅占 ≈ 45、列表占 ≈ 35，面板滚动量基本不变）。
- `html, body { height: 100%; overflow: hidden }`：**根视口永远不滚**，否则会出现「外面一根、列表里一根」
  两根滚动条。iframe 元素也不写 `scrolling="no"`（能滚不能滚交给 CSS，别用这个老属性）。
- 只给 `.tweets-container` 定制滚动条（6px、`var(--border)` 滑块）+ `scrollbar-gutter: stable`
  （滚动条出现 / 消失时推文不会左右跳一下）。

**为什么不能量高度**（`0.7.2` 的教训，别再走回去）：

- 折叠块**默认收起**，而 `section()` 收起写的是 `display: none` —— 此时 iframe **根本没有布局盒**：
  实测 `contentDocument.documentElement` 的 `clientHeight` 与 `scrollHeight` **全是 0**；
  而 **`load` 事件照样会发**，所以「在 load 里量一次」量到的是 0，被 `if (height > 0)` 一挡就再也不量第二次，
  高度永远停在 `240px` 占位值 —— 第一张配图很高时，下面的推文连滚动条都摸不到。
- `documentElement.scrollHeight` 还「只增不减」（它是 `max(clientHeight, 内容)`）：一旦写进 `style.height`，
  内容变少时也不会回落。要量就得量 `body` 的 `getBoundingClientRect().height`，而且必须挂
  `ResizeObserver`（元素 + 内容两层）才跟得上展开 / 拖宽 / 图片解码 —— 能work，但脆。
- 固定高度 + 内部滚动把这些前提全绕开了：**内容是多是少都不影响页面高度**。

**标签怎么切**：`srcdoc` 里没有脚本，所以每次 `load` 之后由 `wireFrame()` 重新挂一遍：

```js
doc.querySelectorAll('.nav-tab').forEach(btn => btn.addEventListener('click', () => setTab(btn.getAttribute('data-tab'))));
const follow = doc.getElementById('tw-follow');
follow?.addEventListener('click', () => toggleTwitterFollow());
doc.querySelectorAll('.tweet').forEach(card => {
    card.querySelectorAll('.tweet-action-like').forEach(n => n.addEventListener('click', () => toggleTweetAction(card.getAttribute('data-id'), 'like')));
    card.querySelectorAll('.tweet-action-retweet').forEach(n => n.addEventListener('click', () => toggleTweetAction(card.getAttribute('data-id'), 'retweet')));
});
```

`setTab(id)`：切 `.nav-tab.active`；非 `posts` 时给滚动容器 `#tw-posts` 加 `is-empty`、把 `#tw-empty` 显示出来并写
`「X」标签下还没有内容 —— 本模块只收录纯文本推文。`。**不能把 `#tw-posts` 本身藏掉**（藏了就没得滚了），
所以「藏卡片」交给 CSS：`.tweets-container.is-empty > :not(#tw-empty) { display: none }`。

**重建而不是增量更新**：`renderFrame()` 每次都把整份 `srcdoc` 换掉（`buildTwitterHtml()` 是纯函数），
所以「资料改了 / 推文加了 / 置顶变了 / 删除了」都不需要单独写 patch 逻辑，也不会漏状态。
代价是监听必须跟着 `load` 重挂 —— 这是这个方案里唯一要小心的点。

> ⚠️ **例外：三个点击交互不重建**（重建 = iframe 重载一次，点起来就不像样例那样无感）。
> `toggleTweetAction()` / `toggleTwitterFollow()` 落盘成功后就地改 DOM：`patchActionNode()` 改一个
> `textContent` + 翻 `is-active`，`patchFollowNode()` 改按钮文案 / `btn-primary` 与 `#tw-followers` 的文字。
> 失败时**什么都不用撤** —— DOM 还没动，只把内存改回去 + 弹 Toast。

**交互钩子**：`#tw-follow`（关注按钮）、`#tw-followers`（粉丝数那一段，关注时 ±1）、每条推文里的
`.tweet-action-like` / `.tweet-action-retweet`（点过的加 `is-active`，粉色 `#f91880` 只由这个类触发）。
三个都是「改内存 → `persistTwitterData()` → 失败回滚内存 + 错误 Toast / 成功**就地 patch**」，见 §10 第 9、10 条。

**页面结构**（父页面依赖这几个 id / class）：`.tw-head`（资料头，固定不动）、`#tw-nav`、
`.nav-tab[data-tab=posts|replies|media|likes]`、`#tw-posts`（滚动容器，推文卡片与 `#tw-empty` 都在它里面）、
`#tw-empty`、推文卡片 `.tweet[data-id]`；`render.js` 侧还有 `DEFAULT_BANNER`（没横幅图时的渐变底）
与 `VERIFIED_SVG`（蓝勾）。页面里 `···` / `✉` 两个按钮是**装饰**，没有任何监听（`关注` 有监听）。

---

## 8. 资源通道与补丁

- 端点在**框架**：`ASSET_ENDPOINT = '/api/role-expansion/asset'`，`POST /{get,save,delete}`，
  body = `{ avatar_url, sub, name, text | base64 }`，请求头走 `ctx().getRequestHeaders()`。
- 位置：`<user>/chats/<角色目录>/_RoleExpansion/<sub>/<name>`；`sub` 的服务端白名单目前**只有 `'twitter'`**。
- 服务端校验（`patches/st-twitter-assets.patch` 新增的 `src/endpoints/role-expansion-assets.js`，纯新增 + `server-startup.js` 挂一行）：
  单段 ASCII 文件名（`^[a-zA-Z0-9_\-.]+$`）、扩展名白名单 `.jsonl/.png/.jpg/.jpeg/.webp/.gif`、
  `isPathUnderParent` 双保险、`write-file-atomic` 原子写、文本上限 16MB / 二进制解码后 8MB。
  **改服务端的那份补丁要重启酒馆主进程。**
- ⚠️ **补丁有顺序**：`st-twitter-assets.patch` 的 `src/server-startup.js` 两个 hunk 锚定的是
  `st-journal-store.patch` 加进去的 `roleExpansionRouter` 那两行，所以必须**打在 `st-journal-store` 之后**
  （三份补丁的顺序：`st-marker-prompt` → `st-journal-store` → `st-twitter-assets`）。
- 可用性判定复用日记那套：`assetRequest()` 第一件事就是 `journalAvailability()` —— **群聊 / 没选角色在本地就判掉，连请求都不发**。
- 框架侧的 `probeAssetStorage(sub)` 只读一个必然不存在的探针名（`RoleExpansion_probe.jsonl`）；
  推特模块**没有**调用它，排查时手动 `roleExpansion.probeAssetStorage('twitter')`。

失败原因（`assetRequest()` → `rt.state.reason` → `assetReasonText()` 的文案，UI 与 Toast 共用同一份）：

| reason | 触发 | 面板红字（源码文案） |
| --- | --- | --- |
| `group` | `ctx().groupId` 非空（本地判，不发请求） | 群聊不支持：这类文件按角色目录存放，群聊没有角色目录。 |
| `no-character` | 拿不到 `characters[characterId].avatar`（本地判） | 还没有选择角色（角色目录未知）。**面板里不打红字、状态留空**（这不是本模块出错）；真去写盘时仍会拿着这句话弹 Toast。 |
| `patch-missing` | 端点回 **404** | 缺服务端补丁：对酒馆执行 git apply patches/st-twitter-assets.patch 并重启。 |
| `invalid-path` | 服务端回 **400** | 服务端拒绝了路径（模块名、文件名或角色头像名不合法）。 |
| `too-large` | 服务端回 **413** | 文件超过服务端上限（文本 16MB / 图片 8MB）。 |
| `network` | `fetch` 抛错 | 资源接口请求失败（网络错误）。 |
| `http-<code>` | 其它非 2xx | 走 `default:` 分支 → `资源读写失败：http-<code>` |
| `bad-response` | 2xx 但 `resp.json()` 抛错 | 同上（`default:` 分支） |

缺补丁时**不回退**到别的位置（与日记同一决定）：状态行红字、iframe 隐藏（`frame.style.display = 'none'`）、
资料区照旧可打字但写不进去、会弹错误 Toast。

---

## 9. 面板结构（DOM 与 id）

```
buildTwitterPanel() → section('推特', { open: false })
  root: #roleEx-twitter-section.roleEx-span-all（iconFor: fa-brands fa-x-twitter）
├─ .roleEx-section-header                 [图标, 标题, 箭头]（标题行 = 折叠开关，不塞控件）
├─ iframe #roleEx-twitter-frame           sandbox="allow-same-origin"；高度由 style.css 固定，不写 scrolling
│    └─ srcdoc: .tw-head（固定） + #tw-posts.tweets-container（唯一滚动容器；推文卡片与 #tw-empty 都在里面）
├─ collapsible 资料区（头像 / 横幅 / 文字）  默认收起 → .roleEx-twitter-row ×2 + 6 个 profileField + 认证复选框
├─ collapsible 推文管理                     默认收起 → #roleEx-twitter-status + [新增推文, 刷新]
│                                          + 提示行 + #roleEx-twitter-list.roleEx-list
│                                          （默认收起 = 这两行平时 0 高度，≈70px 全给 iframe）
└─ collapsible 解析设置                     默认收起 → 两个 checkboxRow
   （三个都带 .roleEx-twitter-fold：标题行削薄一档，只作用于本模块）
```

- 资料区字段统一走 `profileField(label, key, options)`：建 `input` 或 `textarea`（`rows` 有值就用 textarea）、
  写 `dataset.twitterField = key`、`input` 事件走 `onProfileEdited()`。
- 每个字段包在 `.roleEx-twitter-field`（**列方向** flex：标签在上、控件在下）。这里**不能**用行方向的不换行 flex：
  中文标签会被压到 min-content（一个字宽）变竖排，尾部还会被 `#roleExpansionPanel { overflow: hidden }` 裁掉
  （同状态模块的坑，主 DEVELOPMENT §5 第 7 条）。
- `fillProfileInputs()` 会跳过 `document.activeElement`（正在打字的那个不打断）；`verified` 复选框是**双写**：
  既在 `profileInputs` 里、也单独挂了 `input` 监听（`onProfileEdited('verified', checked)`）。
- 编辑器弹窗 `.roleEx-modal` 挂到 `document.body`（不吃面板的 `overflow: hidden`）；新增与编辑共用 `openTweetEditor(target)`，
  `target` 为空 = 新增（`seq` 默认 `nextSeq()`）。
- 折叠块一律用框架的 `collapsible()`（酒馆原生 `.inline-drawer`，箭头语义「收起 ↓ / 展开 ↑」），三个都默认收起。
- 状态行与资料区、管理列表的联动靠 `renderTwitter()` 一处；**唯一的例外**是那三个点击交互：
  它们走 `patchActionNode()` / `patchFollowNode()` 就地改（理由见 §7 的「例外」框），改完顺手 `renderManage()`
  把面板列表里的数字对齐。别在别处再直接改 DOM。

---

## 10. 踩过的坑

| # | 症状 | 根因 | 现在的防护 |
| --- | --- | --- | --- |
| 1 | 标签页点了没反应 | `srcdoc` 里没有脚本（`sandbox` 没给 `allow-scripts`） | 父页面在 `iframe` 的 `load` 里 `wireFrame()` 重挂 `.nav-tab` / 关注 / 🔄 / ❤️ 的监听 |
| 2 | 页面高度不够，下面的推文被裁（图一加载完就更明显） | 早先的实现「按内容量高度」：只在 `load` 量了一次，而配图（data URL）解码完 / 折叠块展开 / 面板拖宽都会改变内容高度 | 已废弃量高度这条路：iframe 固定高度、资料头固定、**只滚 `#tw-posts`**（§7）—— 内容多少都不影响页面高度 |
| 3 | 一条回复里写两个时间标签，只有一个生效 | `pendingTime` 被后一个覆盖，前一个静默作废 | `ignored` 里记 `<N> 个没配到推文的时间标签`（控制台能看到） |
| 4 | 空 `<推文></推文>` 把前面的时间「吃掉」 | 空推文 `continue` 时不清 `pendingTime` | 当前行为：时间留给**下一条**推文；`ignored` 记 `(空推文)` |
| 5 | 落盘失败后正文里的标签已经没了 | 剥离发生在 `persistTwitterData()` 之前 | 推文与正文**一起**回滚（`last.mes = originalMes`），失败弹错误 Toast（§3） |
| 6 | 删除失败却提示「已删除。」（还只在内存里删了） | `deleteTweet()` 里成功 toast 在失败分支之后**无条件**执行 | 已修：失败时把推文放回 `rt.state.tweets` 并只弹错误 Toast（带「已撤销这次删除」） |
| 7 | 手改 JSONL 加的自定义字段读回来没了 | `normalizeProfile()` / `normalizeTweet()` 是白名单 | 要长期保存新字段就得同时改 `normalize*` 与 `encode*` |
| 8 | 控制台改了数据，界面不动 | 框架的 `renderTwitter` 壳**没有任何调用点** | 自己调 `roleExpansion.renderTwitter()`；要自动化就在框架里加调用点 |
| 9 | 点关注 / 🔄 / ❤️ 后「界面变了、文件没变」 | 这类交互天生是「先改内存再落盘」 | 三个处理函数一律：改内存 → `persistTwitterData()` → 失败就回滚内存 + 错误 Toast，只有成功才动 DOM |
| 10 | 点一下能看见**刷新动画**（iframe 重载一次） | 早期实现：点完调 `renderTwitter()` 整帧重画 | 三个交互改成就地 patch，**不碰 `srcdoc`**（现在高度也与内容脱钩，重建 srcdoc 不会再伴随高度跳变） |
| 9 | 面板重建后操作打在旧节点上 | DOM 引用被留在工厂作用域里 | 引用统一放 `rt.state.panel`，`panel()` 每次现取 |
| 10 | 想「顺手」直接 `fetch` 端点或 import 酒馆内部模块 | 会让缺补丁 / 版本变化变成静默失败 | 一律走 `kernel` 的资源通道；自测断言模块源码里没有 `fetch(` / `<script` |
| 11 | 上传横幅后顶部横幅整块坏掉 / 样式失效 | 横幅是内联 `style` 里的 `url(…)`：data URL 里的括号让裸 `url()` 非法，`"` 又会把 `style="…"` 截断 | `url('…')` 带小写单引号 + 先 `cssUrl()` 百分号编码 `' " ( )` 与空白 + `escapeHtml()` 兜底（§7） |
| 12 | **展开后仿推特页面只有 240px 高**：第一张配图很高时下面的推文再也看不到，连滚动条都没有 | 折叠块默认收起（`display: none`）→ `load` 那一刻 iframe 没有布局盒、量到 0 被 `if (height > 0)` 跳过，高度永远停在占位值；再叠加 `scrolling="no"` 与 srcdoc 里的 `overflow: hidden`，内容彻底够不到 | 不再量高度：**固定高度 + 资料头固定 + 只滚 `#tw-posts`**（§7）。量高度那条路在 `0.7.2` 用 `body` rect + 双 `ResizeObserver` 补过，`0.8.0` 整个删掉 |

另外两条与写盘有关的：

- **读失败不算「还没有推文」**：`rt.state.reason` 非空时状态行是红字原因而不是「0 条推文」，
  同时 `tweets` 被清空、两张图的内存也清空 —— 看起来「数据没了」但文件还在。
- **写失败不回滚内存的路径**：编辑 / 置顶两条只 toast（内存已改，重读一次即可复原）。`addTweet()`、捕获路径与**删除**都带回滚。

---

## 11. 调试入口

`globalThis.roleExpansion` 里属于推特的成员（模块被拆掉时是**空壳**：调用返回 `undefined`，不抛）：

| 成员 | 用途 |
| --- | --- |
| `reloadTwitter()` | 从文件重读 jsonl + 两张图并重画（排查「文件改了 / 写进去了但界面没变」） |
| `renderTwitter()` | 只重画、不读盘（框架壳里目前没有调用点，控制台 / 自测在用） |
| `describeTwitter()` | 状态快照：`{ reason, loaded, tweets, pinned, fileName, path, hasAvatar, hasBanner }` |
| `settings.twitterCapture` / `settings.twitterStripTags` | 逐开关验证行为（`settings` 是活引用，改完立即生效） |
| `assetPathText('twitter', name)` | 落点文案 `chats/<角色>/_RoleExpansion/twitter/<name>` |
| `probeAssetStorage('twitter')` | 框架侧资源通道的只读探针（区分「缺补丁」与「角色目录不可达」） |
| `journalAvailability()` | 群聊 / 没选角色 的权威判据（资源通道与日记共用同一套） |

控制台**调不到**（没挂到 `roleExpansion`）的模块内部函数，需要时临时打点：
`buildTwitterPanel` `openTweetEditor` `togglePin` `deleteTweet` `wireFrame` `renderFrame`
`parseTweetTags` `addTweet` `nextSeq` `makeStats` `formatCount`。

控制台会自己说话的地方：

- 捕获忽略：`[ST-RoleExpansion] 推特模块忽略了：` + 数组（`(空推文)` / `N 个没配到推文的时间标签` / `孤立的时间标签（整条消息没有 <推文>）`）
- 读 jsonl 失败：`read twitter jsonl failed <文件名> <reason>`
- 写 jsonl 失败：`persist twitter failed <reason>`
- `MESSAGE_RECEIVED` 里抛错：框架打 `twitter capture failed`
- 图片处理失败：`twitter image upload failed`
- 解析失败行：面板 Toast「推文文件里有 N 行无法解析，已跳过。」

交互入口（调试用）：`roleExpansion.toggleTwitterFollow()`、`roleExpansion.toggleTweetAction(id, 'like'|'retweet')` —— 与主页上点击走同一条路径。

排查顺序建议：`roleExpansion.modules()` 看模块在不在、启没启用 → `describeTwitter()` 看 `reason` / 条数 →
`journalAvailability()` → `probeAssetStorage('twitter')` → `reloadTwitter()` → 直接看磁盘上的 jsonl。

---

## 12. 已知限制与预留扩展点

| 项 | 现状 |
| --- | --- |
| 群聊 | 捕获直接 `return`（`ctx().groupId`），资源通道在本地判 `group` → 面板红字、连请求都不发 |
| 消息范围 | 只解析**最后一条**消息；历史消息里的标签不会再被处理，也没有「重扫历史」的入口 |
| 时间字段 | 纯显示文本，不解析、不比较、不参与排序 |
| 推文类型 | 只有「帖子」一类；`回复 / 媒体 / 喜欢` 三个标签页恒定显示「还没有内容」 |
| 四个数字 | 创建时随机一次（弹窗预填的就是这份初值）；之后可在弹窗里改、在主页上点 🔄❤️ ±1、或手改 JSONL 后 `刷新`；没有范围校验 |
| 关注按钮 | 会改 `followers`（±1）并落 `followed` —— 这是刻意的（与样例推特的 `toggleFollow` 一致），不是 bug |
| 图片 | 头像 / 横幅固定名 `avatar.png` / `banner.jpg`；推文配图 `tweet-<推文id>.<ext>`，一条一张。都在上传前被 canvas 缩小，拿不回原图 |
| 写盘 | 整文件覆盖写、无写队列；编辑 / 置顶失败不回滚内存，删除与新增 / 捕获会回滚（§10） |
| 面板钩子 | 只有 `buildPanelSection()`：没有 `settingsBlock`（「扩展」设置面板里没有推特区块）、没有 `services`、没有 `debug` |
| `rt.state.loaded` | 只在 `reloadTwitter()` 里置 `true`，只有 `describeTwitter()` 读 |
| i18n | 界面文案全是硬编码简体中文，没走酒馆的 `t()` |

---

## 13. 自测覆盖

`npm test`（= `node tools/smoke-test.mjs`）里推特相关断言散在整份脚本里，搜 `推特` / `twitter` 就能定位；覆盖到的：

- **面板结构**：主面板三块（`#roleEx-twitter-section` 排第一、带 `roleEx-span-all`）、区块里有
  `#roleEx-twitter-frame` / `#roleEx-twitter-status` / `#roleEx-twitter-list`；
  标题行只剩 [图标, 标题, 箭头]，状态与 `新增推文`/`刷新` 都在**默认收起**的「推文管理」里
  （顺序：状态 → 按钮行 → 说明 → 列表），正文直接子节点只剩 4 个，三个折叠块都带 `roleEx-twitter-fold`
- **版面契约**：srcdoc 是固定高度的一屏（`html, body` `height:100% + overflow:hidden`）、body flex 竖排、
  `.tw-head` 不吃伸缩、`#tw-posts` 是唯一滚动容器且 `#tw-empty` 在它里面；
  iframe 高度由 CSS 写死（`clamp()`）、没有 `min-height`、**父页面完全不写 `style.height`**、不带 `scrolling`；
  切非「帖子」标签加 `is-empty`、滚动容器本身不被藏、切回来还原
- **捕获与契约**：`<推文时间>` 就近配对、正文换行原样保留、标签从正文剥离且不留多余空行、
  第二条推文 `seq` 更大（排序依据）、无时间就不显示时间行
- **数字**：浏览落在 500~50000、点赞 ≤ 8%（且 ≥1）、转发 ≤ 30%、评论 ≤ 20%；重读文件后数字不变（固化）；
  手改 JSONL 后的数字能读回，`srcdoc` 里用 K 记法显示（`1.2K` / `32K`）
- **置顶**：管理列表里有「置顶」按钮，点了之后 `pinned` 恰好一条、是想置顶的那条，`srcdoc` 里它排在前面
- **渲染**：`srcdoc` 里**没有** `<script>`；四个数字的图标都在；模型写的 HTML 被转义成 `&lt;b&gt;`
- **配图**：没配图的推文 srcdoc 里没有 `class="tweet-image"`；手改 JSONL 挂上 `image` + 假资源表里放图 → 渲染成
  `<img class="tweet-image" src="data:…">`；文件读不到时**不画** `<img>`；`image` 写成路径会被忽略；
  编辑弹窗里有「上传图片 / 清除配图」；删除推文会连配图文件一起删
- **三个交互**：关注按钮文案 / `followed` / 粉丝数 ±1；🔄❤️ 数值 ±1 与 `is-active`；三个字段都落盘；
  **点一下前后 `srcdoc` 字符串完全一致**（证明没有重建、没有刷新动画）；写盘失败时连 DOM 都没动
- **开关**：关掉剥离 → 正文里仍留着标签但照常收录；关掉解析 → 不再收录；孤立时间标签 → 不收录、不动正文
- **不可用路径**：缺补丁 → `reason = 'patch-missing'`、状态行文案点出 `st-twitter-assets.patch`、iframe `display: none`；
  群聊 → `reason = 'group'` 且**不发任何资源请求**；切回单聊 → `reason` 归 `null`；
  **没选角色 → 状态行留空、不带 `roleEx-warn`**、iframe 照旧隐藏，拿回角色后恢复正常
- **源码层面**：标签字面量（`<推文>` / `<推文时间>`）还在；模块不自己拼 `fetch`（走框架的 `/api/role-expansion/asset`）；
  模块源码不含 `<script`
- **模块系统**：清单里 twitter / journal / state 都已加载并启用

配套的 `npm run test:patch` 里还有 `tools/patch-asset-test.mjs`，从 `patches/st-twitter-assets.patch` 抽端点真跑：
落点在 `_RoleExpansion/twitter/`、`sub` 与文件名越权（`..`、路径分隔符、非白名单扩展名、`avatar_url` 带 `/`…）
与体积上限一律被拒、拒绝项不落地、角色目录改名后整个 `twitter/` 跟着走。

> 改完记得过一遍主 DEVELOPMENT 的「快速自检清单」；把 `modules/twitter/` 整个挪走再跑一次 `npm test`，
> 框架与另外两个模块应当照常，只有推特相关断言会红。

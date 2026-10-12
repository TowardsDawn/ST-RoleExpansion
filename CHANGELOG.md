# 更新日志

本文件记录 ST-RoleExpansion 的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

> `0.2.x` 及更早为本地迭代，条目依据 README 与代码整理，细节未必完整。

## [0.10.1] - 2026-10-11

### 变更

- **衣装面板重做：tag 编辑搬进独立弹窗**（结构照推特 / 日记的编辑弹窗）。分类行**只剩**「分类名 + `编辑`」
  （`#roleEx-outfit-edit-<分类key>`），点 `编辑` 打开 `.roleEx-modal#roleEx-outfit-modal`：
  **备选**文本域（`#roleEx-outfit-modal-tags`）+ 芯片行（`#roleEx-outfit-modal-chips`），
  自定义分类另有**名称**框（`#roleEx-outfit-modal-name`）与 `删除分类`（`#roleEx-outfit-modal-del`）。
  - `保存` = 先改名、后备选表（各自只在真的改了时才写盘），**两步都成功才关窗重画**；任一步失败停在弹窗里。
    名称空提示 `名称不能为空`、重名提示 `已有同名分类`（这两种不写盘）。
  - `取消` = 直接关窗、**零写盘**；点芯片本身仍是**即时写入**，所以「取消」不会撤销刚点过的选择。
  - 备选表为空时弹窗里**没有芯片行**，只显示一句 `先在上面填备选 tag`。
  - 旧版的行内节点（`#roleEx-outfit-tags-*` / `#roleEx-outfit-chips-*` / `#roleEx-outfit-rename-*` /
    `#roleEx-outfit-del-*`）与 `.roleEx-outfit-group-head` 一并消失。
- **预览区加大**：`#roleEx-outfit-preview` 从占 42% 宽改成 **55%**，并加 `min-height: 12em` 下限
  —— 编辑器三组默认收起后，预览就是这块面板的主要内容。
- **编辑器三组改成折叠块**：`#roleEx-outfit-fold-outer` / `-inner` / `-other`（走框架的 `collapsible()`），
  **默认全部收起**；展开状态记在 `rt.state.foldOpen`，**面板重画后仍保持**（刷新页面回到全收起）。
  预览区**不折叠**。
- **芯片选中态改成「字色 + 边框变黄、背景不变」**：`.roleEx-outfit-chip.is-on` 现在是
  `color: var(--SmartThemeQuoteColor, #e0b000)` + `border-color: currentColor`，背景仍是未选态的 `--black30a`
  （旧版是实底高亮）。
- 版本号 0.10.0 → 0.10.1（`manifest.json` / `package.json` / README badge / 本文件）。

## [0.10.0] - 2026-10-11

### 新增

- **新模块「衣装打扮」（`modules/outfit/`，id `outfit`，标题「衣装打扮」，图标 `fa-solid fa-shirt`）** —— 第四个可拆模块：
  维护「这一场里现在穿什么」，并把选中的衣装注入后续每一次生成。拆掉整个目录或禁用 = 没有衣装功能，框架与其它模块照常工作。
  - **三大部分与分类**：**外**（头饰 `hat` / 上衣 `top` / 下装 `bottom` / 袜子 `socks` / 鞋子 `shoes`）、
    **内**（内衣 `underwear` / 内裤 `underpants`）、**其他**（用户自建，key 恒为 `custom-<uid>`，固定落在「其他」）。
    七个固定分类的 key 是契约的一部分，**不可改名、不可删除**；JSONL 里缺了就按内置定义补齐。
  - **备选装备表**：每个分类一个输入框，**只按英文逗号 `,` 切分**（与 ST 世界书的「关键字列表」一致）→
    `trim()` → 丢掉空串 → **去重保序**；中文逗号 `，` 与顿号 `、` **不是**分隔符。提交是整表替换；
    新备选表里已经不存在的已选 tag 会**连带清掉**（与读取归一化同一套语义）。
  - **选择语义**：**分类内多选**（可以叠穿）；顺序**恒按备选表顺序**，与点击先后无关。
  - **落点**：`<user>/chats/<角色目录>/_RoleExpansion/outfit/RoleExpansion_outfit_c_<角色hash8>_j_<会话hash8>.jsonl`
    —— 换会话换文件、跟着角色目录走；走模块私有资源通道（`/api/role-expansion/asset/*`，`sub = 'outfit'`）。
    文件是**稳定三行**：`outfit-session`（会话头）/ `outfit-catalog`（分类表 + 备选 tag）/ `outfit-selection`（已选 tag）。
    读取时会归一化：固定分类补齐、未知 key 与未知 `part` 丢掉、`picked` 里不在备选表里的 tag 丢掉，
    解析失败的行会被跳过并计数（状态行提示一次「已跳过 N 行无法解析的衣装数据」）。
  - **注入**：注册运行时正文源 `roleExpansionOutfit`（`{ name: '角色扩展（衣装）', edit: true, toggle: true }`）；
    **预设里必须由用户自己加一张 `marker: true` 卡片**（`identifier` = `roleExpansionOutfit`），
    位置与启停都在预设 UI 里管 —— 扩展**不创建 / 不修改 / 不写预设**。
  - **注入正文**：`settings.outfitInjectPrompt` 模板（默认两行，含 `{{outfitList}}`）
    渲染成 `[以下是 {{char}} 当前的衣装打扮，请在描写与对话中保持一致]` + 分组清单
    （**每部分一行**，行内 `分类名=tag1 / tag2`，分类之间 `；`，**空的部分整行不出现**）；
    **一个衣装项都没选 → 整条不注入**。
  - **三道正文闸**：卡片没插进任何 `prompt_order` 块 / 卡片 `enabled === false` / 没有选中项 —— 任一不过都返回空串。
  - **降级**：群聊与缺服务端补丁是**红字**，没选角色**不打红字**（那不是本模块出错）；
    三种情况下 `.roleEx-outfit-cols` 都带 `is-disabled` 整块置灰。
- **「扩展」设置面板新增衣装区块**：卡片诊断 `#roleEx-preset-card-hint-outfit`
  + 一键打开预设面板的 `#roleEx-setting-open-preset-outfit`（只有诊断，没有任何可改项）。
- **衣装样式**：`style.css` 新增 `.roleEx-outfit-*` 一族（左右两栏、分类行、芯片、预览行、置灰态），
  窄屏（≤780px）下两栏改竖排。

### 变更

- **主面板区块顺序调整**：现在是 **衣装打扮 → 角色状态栏 → 日记 → 推特**
  （顺序取自 `modules/manifest.json` 的 `modules[]`，扩展设置面板里的「模块」表同序）。
  衣装那块带 `roleEx-span-all`，占最上面那条整行；推特那块也带，因此独占最后一行。
  面板副标题、区块 DOM 顺序都跟着清单走，框架代码没有任何改动。
- **`patches/st-twitter-assets.patch` 的子目录白名单**从 `['twitter']` 改成 `['twitter', 'outfit']`
  （**同行替换、不增删行**；三份补丁的净新增行数仍是 151 / 131 / 182，顺序仍是 marker → journal → twitter-assets）。
  ⚠️ **已经装过旧版的人不要重新 `git apply` 这份补丁** —— `src/endpoints/role-expansion-assets.js` 在 ST 里已经存在，
  会以 `already exists` 失败。正确做法：打开 `<酒馆>/src/endpoints/role-expansion-assets.js`，
  把那一行改成 `const ALLOWED_SUBDIRS = ['twitter', 'outfit'];`，然后**重启酒馆主进程**。
- 版本号 0.9.0 → 0.10.0（`manifest.json` / `package.json` / README badge / 本文件）。
- 文档：新增 `modules/outfit/README.md` 与 `modules/outfit/DEVELOPMENT.md`；
  主 README / DEVELOPMENT 里所有模块枚举（「这是什么」模块表、快速开始、界面导览、模块表、仓库结构目录树、
  补丁说明、已知限制、调试入口）都补成四个模块，并改成新的区块顺序。

### 修复

- **模块自建的「扩展设置面板」区块从来没有渲染出来过**（框架 bug，衣装与日记两块一起中招）。
  - **症状**：容器 `#roleEx-setting-module-blocks` 里一直是空的（`children.length = 0`）——
    衣装的「衣装卡片 · `roleExpansionOutfit`」诊断块与日记的卡片区块都不显示，而「扩展」面板其余部分正常。
    主面板区块、注入、落盘都不受影响，所以这个 bug 很容易被当成「模块没写 `settingsBlock`」。
  - **根因**：`renderModuleSettingsBlocks()` 在**描述符**上找 `desc.settingsBlock`，
    而模块按约定把可选能力挂在 `create(kernel)` 的返回值（`desc.api`）上。
    `buildPanelSection()` 与 `services` 本来就是按 api 读的，所以这是**唯一走岔的一处能力**。
  - **修法**：改成 **api 优先、描述符回落**（`typeof desc.api.settingsBlock === 'function' ? desc.api : desc`），
    并仍然要求 `desc.api` 存在 —— 模块被拆掉 / 被禁用时照样什么都不挂（「不会留下一块永远『检测中…』的 UI」这条保证不变）。
  - **实测**：改前容器 `children.length = 0`；改后 `= 2`（child[0] 衣装、child[1] 日记，顺序 = 清单顺序）。
  - **约定**：模块的可选能力一律挂在 `create(kernel)` 返回的 api 上；早期写在描述符上的 `settingsBlock` 写法继续兼容。

### 测试

- 自测覆盖衣装模块（`npm test`，搜 `衣装` / `outfit` 定位）：
  面板结构（清单第一条 = 主面板第一块、带 `roleEx-span-all`、默认收起、正文直接子节点三个）；
  三大部分与七个固定分类、自定义分类的改名 / 删除 / 查重；
  备选表的英文逗号切分与去重保序（**中文逗号不切分**）、连带清选；
  分类内多选与「顺序按备选表」；文件名的双 hash 前缀与三行结构；读取归一化与坏行计数；
  `{{outfitList}}` 的分组格式、空选不注入、三道正文闸；
  群聊 / 缺补丁 / 没选角色三条不可用路径的表现；
  **`sub-not-allowed`（旧版补丁、端点 400）一整条链**（`toPageReason('invalid-path')` → `sub-not-allowed` →
  红字 + 三个 token 的文案 + 置灰 + 探针只探一次的缓存），并配两个对照组（探针 ok → 不红不灰；
  `patch-missing` → 红灰不变且仍走框架文案）；失败态下的**重探**（`armOutfitReprobe()` 的 3 秒节流与生效条件）；
  以及**框架自己把恰好两块设置区块挂进 `#roleEx-setting-module-blocks`**（衣装在前、日记在后，同名 id 全页唯一）。
- `npm run test:patch` 的 `tools/patch-asset-test.mjs` 覆盖 `sub = 'outfit'` 已在白名单内
  （`_RoleExpansion/outfit/` 的读写删与越权路径按同一套规则被拒）。

## [0.9.0] - 2026-09-20

### 新增

- **推文详情页**（推特模块）：点推文的**框**（正文 / 头像 / 时间 / 媒体都算，控件区与视频不算）→ 整个 iframe 换成
  那条推文的详情页，左上角 `←` 返回。结构照样例 `twitter_tweet.html`：48px 大头像、23px 正文、
  时间行（含 `<浏览数> 查看`）、数值行 `<评论> 评论　<转帖> 转帖　<喜欢> 喜欢　<书签> 书签`、
  操作栏 `💬 🔄 ❤️ 🔖 🔗`（**旁边不带数字**）。
  - 实现方式是**每条推文预渲染一份详情页**、与主页放在同一份 srcdoc 里，进出详情只切 `display` ——
    不重建 srcdoc，所以回主页时推文列表的滚动位置还在原处，也没有重载闪动。
  - 进出详情会把视频停下来：主页那段在进详情时立刻暂停（画面没了、声音不能跟着走），返回时同理。
  - 主页卡片与详情页共用 `data-id`，`patchActionNode()` 一次把两处的数字与 `.is-active` 一起刷新：
    在哪边点赞 / 转发 / 书签，两边同步。
- **书签 `🔖`**：主页与详情页都能点（`stats.bookmark` ±1、`bookmarked` 落盘、图标变蓝）。
  **主页刻意不显示书签数**（只显示「点没点过」），数字只在详情页的数值行里；编辑器里的数字框从四个变五个。
- **分享 `🔗`**：纯图标，点了没有任何行为（与样例一致，也不写文件）。
- **媒体：URL 视频 / 动图 / 静态图**：推文行新增 `mediaUrl` 与 `mediaKind`，**只存地址、不落角色目录**。
  `.mp4` / `.webm` / `.mov` / `.m4v` / `.ogv` → `<video controls preload="metadata">`（**点击后播放**，
  同一条时间线里播一个会自动暂停另一个）；其余（`.gif` / `.png`（APNG）/ `.jpg` / 认不出）→ `<img>`，进页面自己就动。
  没有后缀的流式地址可以在编辑器里手动选类型。
  - **URL 优先**：本地配图与 URL 同时存在时渲染 URL 那张；清掉 URL 自动回到本地配图（本地文件与字段都不动）。
  - URL 只认 `http(s)`（`javascript:` / `data:` / 相对路径一律忽略）；**FLV 刻意不支持** ——
    浏览器原生播不了 `video/x-flv`，而这个页面既不给脚本、仓库也没有依赖，所以 `.flv` 不会被当成视频。

### 变更

- **主面板的区块顺序调整**：现在是 **角色状态栏 → 日记 → 推特**（顺序取自 `modules/manifest.json` 的 `modules[]`，
  扩展设置面板里的「模块」表同序）。推特那块带 `roleEx-span-all`，因此独占最后一行，
  上面两块两列并排；面板副标题、区块 DOM 顺序都跟着清单走，框架代码没有任何改动。
- **「媒体」标签从占位变成真过滤**：只列带媒体的推文（本地配图或 URL 都算）；一条都没有时才显示空态提示。
  空态文案里那句「本模块只收录纯文本推文」去掉了 —— 有了媒体之后它已经不成立。
- 主页操作行从 4 项变 6 项：`💬 n · 🔄 n · ❤️ n · 📊 n · 🔖 · 🔗`（`max-width` 400 → 460px）。
  `📊 浏览` 排在 `🔖 书签` 之前，编辑弹窗里的五个数字框同序（评论 / 转帖 / 喜欢 / 浏览 / 书签）。
- **主页卡片里的媒体（图片 / 动图 / 视频）改成「1/4 面积」预览**：宽度取卡片的一半
  （`.tweet .tweet-image, .tweet .tweet-video { width: 50% }`，高度按比例算，所以面积正好 1/4）。
  选择器带 `.tweet` 前缀 —— **只缩主页那份**，详情页里的媒体保持原尺寸。
- 管理列表每行的数字提示加上 `🔖`；带媒体的推文前面按类型显示 `🎬`（视频）/ `🖼`（URL 图）/ `📷`（本地图）。
- srcdoc 的结构从「body 直接 flex 竖排」改成两张「页」：`#tw-home`（资料头 + 列表）与
  `#tw-detail-wrap`（每条推文一份详情，默认隐藏）。

### 测试

- 自测 424 → 458 项断言：`.mp4` → `<video>`（带 `controls`、无 `autoplay`）、`.gif` → `<img>`、无后缀 + 手选类型、
  `.flv` 不算视频、URL 与本地图共存时 URL 优先、清掉 URL 回落到本地图、`javascript:` 不进 srcdoc、`has-media` 标记；
  每条推文一份详情页 + 一个返回键、数值行四项、操作栏无数字、主页 `🔖` / `🔗` 不带数字；
  点卡片进详情 / 点返回复原 / 点控件区**不跳转**、播一个视频暂停另一个、「媒体」标签只留带媒体的卡片；
  编辑器五个数字框。
- 旧的「body flex 竖排」「配图只渲染一张 `<img>`」这类断言按新结构改写为「`#tw-home` flex 竖排」
  「**主页那一段**里的 `<img>` 数量」（详情页也会各渲染一份媒体，所以媒体断言一律按主页那一段数）；
  主页媒体的 1/4 面积预览（带 `.tweet` 前缀的 50% 宽度规则在，基础 `.tweet-image` 规则里没有 `width` 覆盖）。

## [0.8.2] - 2026-09-19

### 变更

- **日记 / 角色状态栏两个模块的正文层次拉平，与推特模块统一成同一套**：正文里**只有平铺内容 + 同级折叠块** ——
  不再有 `.roleEx-block` 包裹层，也不再有一个面板嵌另一个面板（嵌套 `section()`）。三个模块的正文直接子节点现在
  都只有「平铺行 / 折叠块」两种东西，自测里对三个模块都钉了这条契约。
  - **日记**：`提示词注入` 区块 → 平铺的一行注入状态（文案自带「注入状态：」，不再需要标题）；
    `新日记` 区块 → 折叠块（默认展开）；原本嵌在它里面的「角色设定（隔离通道）」「参考聊天楼层」
    **提升为同级**；`日记列表` 去掉外层区块包裹；「日记主提示词」由**嵌套 section** 改为同级折叠块（默认收起）。
    正文直接子节点固定为 `[注入状态行, 新日记, 角色设定, 参考聊天楼层, 日记列表, 主提示词]`。
  - **角色状态栏**：原来的两个 `.roleEx-block` 拆掉 —— 五个开关**平铺**（它们本来就没有标题，不额外造一个），
    「状态列表（随会话保存）」与「状态注入提示词」成为同级折叠块（前者默认展开、后者默认收起）；
    「批量添加」仍是状态列表折叠块体内的一行小标题。
  - 新 id：`#roleEx-new-journal-fold` / `#roleEx-main-prompt-fold` / `#roleEx-state-list-fold` / `#roleEx-state-tpl-fold`
    （旧的 `#roleEx-inject-block` / `#roleEx-new-journal-block` / `#roleEx-state-tpl-section` 不再存在）。
  - 折叠块 header 没有图标位（与推特模块的折叠块一致），所以日记主提示词 / 状态注入提示词那两个魔杖图标去掉了。
- **楼层选择框改成标准区块**：原来它是一个自己画边框的框（`1px` + 圆角 + 4px 内距），现在直接给列表
  `#roleEx-floors` 加 `.roleEx-block`（底色 / 圆角 / 内距都走区块那套，与其它区块一致），
  `.roleEx-floors` 只保留它独有的 260px 高度上限与内部滚动。**是给列表本身加类，不是在外面再套一层容器** ——
  否则就是「区块里再套一个框」。
- **已在 SillyTavern 1.19.0 上复验**：三份补丁照旧干净落地；扩展用到的 `getContext()` 接口
  （`substituteParams` / `setExtensionPrompt` / `generateRaw` / `saveMetadata` / `chatMetadata` …）、
  抽屉锚点（`#top-settings-holder` / `#avatar_controls .chat_lorebook_button` / `#settings_preset_openai`）、
  补丁端点依赖的 `isPathUnderParent` 与 `validateFileName.js` 默认导出都没变，代码无需改动。
- 删掉随之失效的 CSS 规则 `.roleEx-section-body > .roleEx-section { background-color: transparent }`
  —— 它的注释写着「嵌套在外层面板正文里的子区块（日记主提示词 / 状态注入提示词）」，而这两处现在都是折叠块，
  规则没有任何选择目标了（留着会误导：它把「两层 section」当成正常写法）。

### 修复

- **两份服务端补丁的行尾混进了 CR，在 LF 检出的酒馆上 `git apply` 直接失败**：
  `st-journal-store.patch` 有 16 行、`st-twitter-assets.patch` 有 14 行带 CR（都在 `src/server-startup.js`
  那段 `import` / `app.use()` 的上下文里）—— 生成 diff 时是从真实工作区（CRLF 检出）取的上下文，于是被带进来。
  后果：Windows + `core.autocrlf=true` 的检出上「碰巧能打」（CR 恰好和文件对得上），
  Linux / macOS（或 `core.autocrlf` 未开）的 LF 检出上则报 `patch does not apply`；
  即使打上了，插入的行是 LF、上下文行是 CRLF，同一个文件混着两种行尾。
  现在三份补丁统一成纯 LF，并在 **1.18.0 与 1.19.0 的纯净检出上分别复验**：
  LF / CRLF 两种工作区里三份都能 `git apply` 干净落地（1.19.0 只带 9 行 / 1 行偏移），落盘结果与当前安装逐字节一致。
  顺手把两份服务端补丁里 **4 组「先删一行、又原样加回来」的空操作**改回上下文行（`git apply --numstat` 的删改数从 2 降到 0，净增行数不变）。

### 测试

- 自测 406 → 424 项断言：楼层选择框带 `roleEx-block` + 是「参考聊天楼层」折叠体的直接子节点 +
  它自己不再画边框（但 260px 滚动上限还在）；日记正文直接子节点的 id 序列、角色状态栏正文直接子节点的 id/class 序列、
  「角色设定 / 参考聊天楼层」与「新日记」同父（同级而非子级）、主提示词折叠块默认收起（body `display:none`）、
  「新日记」默认展开；以及一条**跨三个模块的契约断言**：任何模块的正文直接子节点里都不许出现
  `.roleEx-block`，也不许出现嵌套的 `.roleEx-section`；以及一条「三份 `.patch` 全是纯 LF、不含 CR」
  （防止再用 CRLF 工作区生成 diff —— 这条断言在注入一个 CR 后会 FAIL，已实测）。

## [0.8.1] - 2026-09-19

### 修复

- **面板锁定（🔒）现在真的会被记住**。此前它只活在内存里（`ui.panelPinned`），F5 / Ctrl+F5 / 重启酒馆主进程
  都会回到未锁定。现在点 🔒 会写进扩展设置的**独立键** `ST-RoleExpansion_ui`（随 `saveSettingsDebounced()`
  落进 `settings.json`，服务端 + 按用户），启动时由 `applyPanelPin()` 读回并应用；同时暴露
  `roleExpansion.applyPanelPin()` 作为排查入口。
  - 用独立键而不是 `settings`：锁定描述的是界面状态。「恢复默认设置」不该顺手把它解锁，
    「存为默认设置」也不该把当时锁没锁一起快照进去（与 `customDefaults` 同样的取舍，见 DEVELOPMENT §4.6）。
- **锁定的面板被别的抽屉「打开」过一次后，羽毛图标会错误地停在关闭态**（面板其实还开着，点一下才知道）。
  酒馆重置图标时找的是 `.openIcon:not(.drawerPinnedOpen)`，而此前只给面板加了 `pinnedOpen`、
  没给图标加 `drawerPinnedOpen` —— 酒馆给 World Info / 左右侧栏加的就是后者。现在两处一起设。

### 测试

- 自测 394 → 406 项断言：锁定默认状态三处一致；点 🔒 后写进独立键 + 面板 `pinnedOpen` + 图标
  `drawerPinnedOpen`；锁定不进 `settings`；清空 DOM 与内存后由启动路径读回（四处恢复）；
  取消锁定落盘 `false`；启动那处调用不带参数（防「只认内存值」回归）。

## [0.8.0] - 2026-09-18

### 变更

- **仿推特页面改成「固定高度 + 资料头固定 + 只滚推文」**。原来是父页面按内容量高度、整页跟着推文长，
  这条路在 `0.7.2` 已经证明很脆（折叠块默认收起时 iframe 没有布局盒，`load` 那一刻量到的是 0）。
  现在：
  - `style.css` 的 `.roleEx-twitter-frame` 直接写死高度
    `clamp(520px, calc(100vh - 80px), 1000px)`（用视口算，因为面板的最大高度本来就是从视口推出来的）；
    实测可见推文区：808 高的窗口 368px、950 里 486px、1080 里 594px（头固定 360~406px）。
    代价是页面比面板高，主面板自己会滚（面板只有 `视口 - 163` 那么高，里面还有另外两个模块区块，
    想让面板不滚就只能把页面压到 `100vh - 405px`，那样列表几乎为零）；
  - srcdoc 里 `body` 变成 flex 竖排：`.tw-head`（横幅 / 头像 / 名字 / 简介 / meta / 统计 / 标签页）
    `flex: 0 0 auto` 钉住不动，`#tw-posts` `flex: 1 1 auto; min-height: 0; overflow-y: auto` 成为**唯一的滚动容器**；
  - `html, body { height: 100%; overflow: hidden }` —— 根视口永不滚，避免出现两根滚动条；
    推文列表的滚动条是 6px 自定义样式 + `scrollbar-gutter: stable`（出现/消失时内容不左右跳）；
  - `measureFrame()` / `attachResizeWatchers()` / `detachResizeWatchers()` 与 `rt.state` 里的两个观测器
    **全部删除**；`renderFrame()` 不再碰 `style.height`（重建 srcdoc 也不再伴随高度跳变）；
  - 横幅高度跟着页面走（`--banner-height: clamp(96px, 17vh, 170px)`），头像 80px → 72px
    （高度中性：`modules/twitter/DEVELOPMENT.md` §7 有实测），
    头的行距也收紧了一档 —— 头总高 360~406px，其余高度全归列表。
- **区块自己的开销 218px → 136px，省下的全给 iframe**：
  - 状态行与 `新增推文` / `刷新` 两个按钮**搬进「推文管理」折叠块**（第一行是状态，第二行是两个按钮）：
    那块**默认收起**，所以这两行平时是 0 高度，要加推文 / 看落点 / 看报错时展开它。
  - 推特区块里的三个折叠块加 `.roleEx-twitter-fold`，标题行比别处薄一档（只影响本模块）。
- **「还没有选择角色」不再当出错处理**（酒馆选角色之前的常态，不是模块出问题）：
  推特模块的状态行留空、不打红字；日记模块的存储说明换成中性文案「选一个角色后才有落点。」、
  空列表照旧说「本会话还没有日记。」、`reloadJournal()` 也不再弹 Toast。
  真的去读写时仍然会拿着那句「还没有选择角色（角色目录未知）。」报错（Toast）。
- **切标签不再藏滚动容器**：`setTab()` 改成给 `#tw-posts` 加 `is-empty`，由 CSS
  `.tweets-container.is-empty > :not(#tw-empty) { display: none }` 藏掉卡片 —— 藏容器本身就没得滚了。

### 测试

- 自测 373 → 394 项断言：
  - 版面：srcdoc 是固定高度的一屏（`html, body` 都 `overflow: hidden`）/ body flex 竖排 /
    `.tw-head` 不吃伸缩 / `#tw-posts` 是唯一滚动容器且 `#tw-empty` 在它里面 /
    iframe 高度由 CSS 写死、没有 `min-height`、父页面完全不写 `style.height`、不带 `scrolling`；
  - 区块结构：标题行只剩 [图标, 标题, 箭头] / 状态与 `新增推文`/`刷新` 在「推文管理」折叠块里
    且该块 `display:none` / 正文直接子节点只剩 4 个 / 三个折叠块都带 `roleEx-twitter-fold`；
  - 切标签：非「帖子」标签加 `is-empty`、滚动容器本身不被藏、切回来还原、提示文案对得上标签名；
  - 「还没选角色」：推特状态留空且不带 `roleEx-warn`、iframe 仍隐藏、切回有角色的会话恢复正常；
    日记存储说明是中性文案且不带 `roleEx-warn`、列表空态说「本会话还没有日记。」。

## [0.7.2] - 2026-09-18

> ⚠️ 这一版修的是「按内容量高度」那条路，**已被 0.8.0 整体取代**（`measureFrame()` 与两个
> `ResizeObserver` 都删掉了，改成固定高度 + 内部滚动）。保留条目只为记录当时的症状与推理过程。

### 修复

- **展开「推特」区块后，仿推特页面只有 240px 高 —— 第一张配图很高时，下面的推文再也看不到（连滚动条都没有）**。
  根因是折叠块**默认收起**（`section()` 用 `display: none`），iframe 在 `load` 那一刻**没有布局盒**：
  实测此时 `contentDocument.documentElement` 的 `clientHeight` 与 `scrollHeight` **全是 0**，
  老代码 `if (height > 0) frame.style.height = …` 直接跳过，高度于是永远停在 `240px` 占位值；
  `scrolling="no"` 与 srcdoc 里的 `overflow: hidden` 又让内容彻底滚不到。当时是这么修的：
  - `measureFrame()` 改量 `contentDocument.body` 的 border-box 高度（永远等于内容真实高度），
    折叠中量到 0 就跳过不写，1px 内的抖动也不重写（省一次布局）；
  - 挂两个 `ResizeObserver`：外层盯 `iframe` 元素（折叠块展开 / 收起、面板拖宽、窗口缩放），
    内层盯 `contentDocument.body`（配图是 data URL，解码完才占到位）；`srcdoc` 重建时断开旧的；
  - 去掉 `scrolling="no"`，srcdoc 改成 `html { overflow-x: hidden; overflow-y: auto }` ——
    万一高度没跟上，还能在页面里滚到下面的内容，而不是被静默裁掉。
  顺带修好「内容变少时高度只增不减」与「面板拖宽后高度不跟着变」。
  （`0.8.0` 之后这些机制全部不存在了 —— 页面高度不再跟内容走，也就没有这些边界要处理。）

### 测试

- 自测 360 → 373 项断言：iframe 高度按 `body` 量、折叠中量到 0 不改高度、内容变矮要回落、
  1px 抖动不重写、两个 `ResizeObserver` 各盯谁、重建 srcdoc 时断开旧观测器、srcdoc 纵向留了滚动兜底。
- 另外用一份真实浏览器页面复现过：折叠着的 iframe 里 `scrollHeight` 确实为 0，展开后
  `ResizeObserver` 一次就把高度补成内容高度（旧写法停在 150px，内容 2612px 全被裁掉）。

## [0.7.1] - 2026-09-18

### 修复

- **资料区「认证」勾选框刷新后回到未勾选**（数据其实一直是对的）：那个复选框没带 `dataset.twitterField = 'verified'`，
  而 `fillProfileInputs()` 正是按这个标记回填的，于是它每次都被 `if (!key) continue` 跳过。现在补上标记，
  `Ctrl+F5` / 切会话 / 手改 JSONL 之后勾选框都会跟着 `verified` 走。
- **资料编辑不再可能写出残缺的资料行**：`onProfileEdited()` 与 `toggleTwitterFollow()` 原来从 `rt.state.profile`
  浅拷贝出发，若资料还没读出来（`null`）就会写出一份只剩一两个键的 `twitter-profile` 行（名字 / 简介等会被清掉）。
  现在统一先过 `normalizeProfile()`。

### 测试

- 自测 356 → 360 项断言：认证复选框带标记、默认勾选、`verified=false/true` 都能正确回填。
## [0.7.0] - 2026-09-18

### 新增

- **推文可以配图了**（图由你自己传，模型只写正文）：「新增推文」/「编辑」弹窗里多了一行 **配图**
  （`上传图片` / `清除配图`），上传时在本地缩到 1000×1000 以内（png / webp / gif 保持无损，其它转 JPEG 0.88），
  存成 `twitter/tweet-<推文id>.<ext>`，文件名记在推文行的 `image` 字段里。
  - **没配图的推文就是纯文字样式**，与以前完全一样；
  - 配图文件被删 / 读不到时**什么都不画**（不会裂图），控制台记一行；
  - 换图会删掉旧文件（后缀不同也不残留）；`清除配图` 与**删除推文**都会把图片文件一起删掉；
  - 面板「推文管理」列表里带图的推文前面有 `📷` 标记；
  - 手改 JSONL 时 `image` 只认 `tweet-` 开头的单段 ASCII 名，写路径会被忽略。

### 测试

- 自测 348 → 356 项断言：没配图不渲染 `tweet-image`、手改 JSONL 挂图后渲染成 data URL、文件读不到不画 `<img>`、
  `image` 写成路径被忽略、编辑弹窗里有配图行、删除推文连配图文件一起删。
## [0.6.2] - 2026-09-18

### 新增

- **推特主页上的 `关注` / `🔄` / `❤️` 可点了**，而且都**落盘**（不是只改显示）：
  - `关注` ⇄ `正在关注`，顺带粉丝数 ±1（与样例推特的 `toggleFollow` 一致）；状态存资料行的 `followed`。
  - `🔄 n` ⇄ `🔄 n+1`、`❤️ n` ⇄ `❤️ n+1`：初次点击数值 +1 并变粉（`#f91880`），再点 -1 恢复灰色；
    状态存推文行的 `retweeted` / `liked`（`is-active` 类就是「点过」的标记）。
  - 三个交互都是「改内存 → 落盘 → 失败回滚 + 错误 Toast」，不会出现「界面变了、文件没变」。
  - **点起来和样例一样无感**：交互只就地改 iframe 里的数字与颜色类，**不重建页面**；
    `renderFrame()` 也不再每次重置占位高度（否则重画时会看到一次「收缩 → 展开」）。
  - 调试入口：`roleExpansion.toggleTwitterFollow()` / `toggleTweetAction(id, 'like'|'retweet')`。

### 测试

- 自测 324 → 348 项断言：关注按钮文案与粉丝数 ±1、🔄❤️ 数值 ±1 与 `is-active`、三个状态字段落盘、
  写盘失败时内存回滚（重试得到 +1 而不是 +2）；以及「点一下前后 `srcdoc` 字符串一致」（没有重建 = 没有刷新动画）。
## [0.6.1] - 2026-09-18

### 变更

- **所有模块的一级折叠块改为默认收起**（推特 / 日记 / 角色状态栏）：面板打开后不再自动铺满，点标题展开。
- **推特的四个数字改为可在 UI 内编辑**：「新增推文」与「编辑」弹窗里都多了 评论 / 转发 / 点赞 / 浏览 四个数字框
  （新增时预填一份随机值，不动它就是随机的）。JSONL 里存的仍然是整数，`1.6K` 只是渲染写法；
  手改 JSONL 时写 `1.6K` 仍会被当成非法值按 0 处理。
- 推特「资料区」的**正在关注 / 粉丝改成数字输入框**，主页上按千分位显示（`3240` → `3,240`）。
- 推特推文的**点赞数不再单独用粉色**，与评论 / 转发 / 浏览一样是灰色。

### 修复

- 推特：写盘失败时**推文与正文一起回滚**（原先落盘失败后正文里的标签已经没了，而那行"回滚"代码是个两边相同的 no-op）。
- 推特：`删除`写盘失败时不再先弹错误、再无条件弹「已删除。」—— 现在会**把推文放回内存**并只弹错误 Toast（带「已撤销这次删除」）。
- 推特：清掉两个死字段（`rt.state.busy`、未使用的 `charSlug`）。

### 测试

- 自测 311 → 324 项断言：三个一级区块默认收起、资料区两个数字框、弹窗里四个数字框可改且落盘、点赞不再是粉色。
## [0.6.0] - 2026-09-18

### 新增

- **新模块「推特」**（`modules/twitter/`，可禁用、可整目录拆掉）。面板里是日记 / 状态栏**上方**、横跨整行的一级折叠块
  「推特」，内容是一张自包含的仿推特页面（`iframe` + `srcdoc`，样式与酒馆完全隔离、高度自适应
（`0.8.0` 起改成固定高度一屏 + 只滚推文列表））。
  - **资料区全由你编辑**：头像与横幅自己上传（不绑 ST 角色头像，上传时自动缩到 200×200 PNG / 600×200 JPEG）、
    名字、认证、handle、简介、meta 行、正在关注 / 粉丝数。
  - **推文正文由模型输出**：回复里写 `<推文>正文</推文>`，可选在它前面写 `<推文时间>2小时前</推文时间>`；
    扩展会捕获、把这两个标签从正文里剥掉并渲染成推文；也可以手动新增 / 编辑 / 删除 / 置顶。
  - **四个数字随机生成后固化**：浏览 500~50,000，点赞 = 浏览×2%~8%，转发 = 点赞×10%~30%，评论 = 点赞×5%~20%，
    按 `1.2K` 记法显示；UI 里不可改，只能手改 JSONL。
  - **时间线**：置顶最多一条、恒在最上且只出现一次；其余按 `seq` 从大到小（新→旧），`seq` 可在编辑弹窗里改；
    时间只是显示用，不参与排序。
  - 落点 `<user>/chats/<角色目录>/_RoleExpansion/twitter/`（一个 jsonl + `avatar.png` + `banner.jpg`），与聊天绑定、
    跟着角色走；群聊不支持，缺补丁时明确报错（不回退）。
- **第三份补丁 `patches/st-twitter-assets.patch`**（纯新增：`src/endpoints/role-expansion-assets.js` + 在
  `src/server-startup.js` 再挂一行）：给模块提供"私有资源文件"读写通道（文本 + base64 图片，子目录 / 扩展名双白名单、
  路径穿越双保险、文本 16MB / 二进制 8MB 上限）。**打完要重启酒馆主进程**，且要打在前两份之后。
- 模块自带 `modules/twitter/README.md`（用户视角）与 `modules/twitter/DEVELOPMENT.md`（开发视角），与另两个模块同一套文档约定。
- 控制台新增 `roleExpansion.reloadTwitter()` / `renderTwitter()` / `describeTwitter()` / `assetPathText()` /
  `probeAssetStorage()`。

### 修复

- **`settings` 不再被重新绑定**。`loadSettings()` 与「恢复默认设置」原先会 `settings = 新对象`，而模块在 `create(kernel)`
  时已经把 `get settings()` 解构走了 —— 结果是**模块侧在「恢复默认设置」之后完全看不到设置改动**（勾选框、提示词、
  开关都失效，而且不报错）。现在统一走 `replaceSettings()` 就地替换内容，对象身份永远不变。

### 变更

- 模块清单顺序改为「推特 / 日记 / 角色状态栏」，主面板区块与「扩展」设置面板的模块表都按这个顺序排；
  推特区块由模块自己加 `roleEx-span-all`，横跨整行。

### 测试

- 自测 270 → 311 项断言：推特的捕获与时间配对、标签剥离、孤立标签、四个数字的区间与关联、`seq` 与置顶排序、
  手改 JSONL 后读回、K 记法、正文 HTML 转义、srcdoc 里没有脚本、群聊与缺补丁两条不可用路径、面板区块顺序与全宽标记。
- 新增 `tools/patch-asset-test.mjs`（资源端点 e2e：文本 / 图片读写删、覆盖写、白名单与路径穿越拒绝、体积上限、
  角色目录改名搬迁），`npm run test:patch` 现在跑两套共 62 项。
## [0.5.0] - 2026-09-17

### 新增

- **日记搬到角色聊天目录下**：`<user>/chats/<角色目录>/_RoleExpansion/journals/`。
  日记从此跟着角色走 —— 角色改名 / 换头像时酒馆会把整个 `chats/<旧>/` 搬到新名字下，日记跟着搬；
  删除角色并勾选「删除聊天」时连根删除。而酒馆「管理聊天文件」只扫 `chats/<角色>/` 本级、
  且要求是文件，所以子目录里的 jsonl 永远不会被当成聊天文件列出来。
  代价是多一份补丁 `patches/st-journal-store.patch`（新增 `src/endpoints/role-expansion.js`
  + 在 `src/server-startup.js` 挂一行），**打完要重启酒馆主进程**。
- 排查入口：`roleExpansion.probeJournalStorage()` / `journalAvailability()` / `journalPathText()` /
  `journalReasonText()`。

### 变更

- 日记**不再走** `/api/files/*`（「扁平名 + 前缀模拟层级」那套整个撤掉）。文件名保持不变，
  所以从旧版本迁移只要把文件搬进新的 `journals/` 子目录即可（README 里有命令）。
- **群聊不再支持日记**：群聊的聊天文件在 `group chats/`，没有「角色目录」这个概念；
  面板红字说明，「生成日记」直接拒绝（不白跑一次生成）。
- 缺补丁时**不回退**到旧位置：面板红字提示缺哪一份补丁。宁可明确报错，也不悄悄写到别处。
- 删掉两个**没有任何读取点**的死字段：`META_STATE_KEY`（真正的键是 `META_KEY`）与共享 `ui` 里的 `stateList`
  （状态数据的唯一来源是 `getStateList()`）；`index.html` 里「日记保存在 `user/files/` 根目录」的提示也一并更新。

### 修复

- 日记读写失败不再伪装成「本会话还没有日记」：不可用时列表与状态行直接显示原因
  （群聊 / 缺补丁 / 路径被拒 / 超限 / 网络错），且只在原因变化时弹一次 Toast。

### 测试

- 自测 252 → 270 项断言：补丁端点在 express 沙盒里跑端到端（读 / 写 / 路径穿越 / 非法文件名 /
  角色目录搬迁）、群聊与缺补丁两条不可用路径、源码里不再有 files 接口调用。

### 文档

- **文档按模块拆分**：每个模块自带 `modules/<id>/README.md`（用户视角）与 `modules/<id>/DEVELOPMENT.md`
  （开发视角：文件划分、数据流、实现细节、自己的坑与调试入口）。
  主 `README.md` / `DEVELOPMENT.md` 只保留框架、安装、**模块列表**与**框架↔模块接口**，
  模块内部细节全部搬进模块文档，并删掉了搬走后重复、过时或与代码不符的描述。
- 全文核对了一遍易漂移的信息：版本号 4 处、断言数（270）、补丁清单（两份）、目录树、
  `modules/` 的文件列表、以及各章节交叉引用的编号。

## [0.4.0] - 2026-09-13

### 新增

- **隔离生成可以带入角色设定了**。此前 `generateRaw` 通道把角色卡一并挡在外面，
  日记容易脱离人设。现在「新日记」区多了一个**默认收起**的「角色设定（隔离通道）」折叠块，
  里面三个开关把角色卡字段拼成一条 `system` 消息，排在日记提示词之前：

  | 开关 | 取角色卡的 | 默认 |
  | --- | --- | --- |
  | 角色描述 + 性格 | `description` → `personality` | 开 |
  | 用户设定 | `persona` | 开 |
  | 场景 | `scenario` | 开 |

  注入顺序固定为 **角色描述 → 性格 → 用户设定 → 场景**；
  字段为空自动跳过（不留空标题），三项全关 = 与旧版行为一致。
  只取这四项，不带角色主提示词覆盖 / Post-History Instructions / 示例对话。

### 变更

- 隔离通道的 `generateRaw` 调用不再只传 `prompt`：角色设定非空时会多传一个 `systemPrompt`
  （`generateRaw` 内部经 `createRawPrompt()` 把它 unshift 成一条 `system` 消息）。
- **回退通道不拼角色卡**：`generateQuietPrompt` 走完整预设管线，
  角色卡由 `charDescription` / `personaDescription` / `scenario` 卡片提供，再拼一次会重复注入。
- 新增设置项 `journalCardProfile` / `journalCardPersona` / `journalCardScenario`，
  以及预留的 `journalCharacterCardOverride`（非空时整体替换自动抽取的角色设定块，
  为将来的「可编辑覆盖」留出口子；当前版本没有对应的面板 UI）。
- 注入状态提示改用 emoji 标记（`🟢 已启用（注入中）` / `🔴 已停用（不注入）`）：
  原来的 `●` / `○` 是几何符号，跟随主题文字色，不能直观表达开 / 关。
- 角色状态栏「状态名」的显示宽度由 `110px` 放宽到 `10.5em`：
  默认字号下可完整显示 10 个汉字（旧值只够 6 个，第 7 个字起被省略成 `…`）；
  改用 `em` 是为了跟随酒馆主题字号缩放。窄屏（≤600px）同步由 `70px` 放宽到 `7em`。

### 修复

- **折叠块初始状态与箭头方向不一致**：`collapsible()` 在 `open: true` 时没有主动设置 `display`，
  而酒馆的 `.inline-drawer-content` 默认就是 `display: none`（`style.css:5535`），
  于是「参考聊天楼层」「日记列表」实际是收起的、箭头却停在展开态的 `up`。
  现在图标与内容一起定初始状态：展开 = `display:block` + `up`，收起 = `display:none` + `down`。
- **面板里并存两套箭头语义**：外层 `section()`（日记 / 角色状态栏 / 各提示词区）
  此前用「收起 `→`、展开 `↓`」，与内层 `collapsible()`（收起 `↓`、展开 `↑`）冲突 ——
  同一个 `↓` 在两个位置含义相反。现统一为酒馆原生的 `down` / `up`（收起 ↓ / 展开 ↑）。
  只能改外层：内层走 `.inline-drawer` 的原生委托处理器，
  它写死了 `down`/`up` 之间的互换、不认 `right`。
  > 视觉变化：「日记」「角色状态栏」展开时的箭头由 `↓` 变为 `↑`。

### 测试

- 离线自测断言由 200 项增至 **226 项**：角色设定拼装顺序、三个开关各自生效、
  空字段跳过（不留空标题）、覆盖字段优先于开关、回退通道不重复注入、
  折叠块初始 `display` 与箭头方向（外层 `section()` 与内层 `collapsible()` 同一套语义）。
- 自测脚本在既找不到 `examples/preset.example.json` 也找不到上一级 `test.json` 时，
  改为明确跳过示例预设检查，不再抛 `ENOENT` 中断整个测试。

## [0.3.0] - 2026-09-12

### 新增

- **隔离生成通道**：日记生成默认走 `generateRaw`，请求里只有日记提示词本身
  （一条 `user` 消息），不带主聊天记录 / 角色卡 / 世界书 / 预设卡片。
  换模型不会再出现「日记被写成剧情推进」的情况。
  面板「新日记」区可关闭该开关，关闭后回退到 `generateQuietPrompt`（带 `skipWIAN`）。
- 「只接受已知状态名」开关（角色状态栏面板，默认开启）：模型只更新状态列表里已有的项。
- 仓库配套：`LICENSE`、`CHANGELOG.md`、`.editorconfig`、`.gitattributes`、
  GitHub Actions 自测工作流、`examples/preset.example.json` 示例预设。

### 修复

- **生成日记时旧日记被塞回请求**：`PRESET_PROMPT.TRIGGER` 是一句从未被读取的声明，
  运行时正文源不区分生成类型，导致写日记那一次 Quiet 请求里带着旧日记全文
  （形成自反馈，并与 `{{journalRefs}}` 重复注入）。
  现在由 `ui.generatingJournal` 标志位（主判据）+ 生成类型黑名单（保险丝）挡住。
- **旧状态数据在「清空全部」之后复活**：迁移判据只看「本扩展这侧为空」，
  而清空之后的结果同样是空数组。现在迁移只发生一次，并落 `legacyMigrated` 标记。
- **非状态标签被吞**：`<thinking>` / `<div>` 这类成对标签会被当成状态项写进列表，
  并从正文里整段删除（表现为回复莫名少一段）。现在有长度 / 形状 / 黑名单三层准入，
  且**只剥离通过准入的标签**，未通过的原样留在正文里。
- **已知的长状态名收不到更新**：长度闸排在已知名单判据之前，
  超过 12 字的自定义状态名会被静默挡下。现在已知名称优先放行。
- 扩展设置面板中「打开角色扩展面板即会自动创建」的旧文案，与 v0.2 起的只读契约不符。

### 变更

- `manifest.json` 的 `minimum_client_version` 由 `1.13.2` 提升到 `1.18.0`
  （补丁的上下文行号以 1.18.0 的 `openai.js` / `PromptManager.js` / `st-context.js` 为基线）。
- 状态标签长度限制改按**码点**计算（`[...name].length`）：一个常用汉字算 1，
  emoji 与扩展区汉字也算 1（旧实现按 UTF-16 code unit，会把它们算成 2）。
- 回退通道补上 `skipWIAN: true`，减少世界书参与。
- 加载设置时自动剔除废弃键（`journalCardAnchor` / `journalInjectRole` /
  `journalInjectToMain` / `journalPresetCard`）。

### 文档

- 面板两列阈值与 `style.css` 对齐（`minmax(340px, 1fr)`）。
- 新增「隔离生成 vs 安静生成」对照表、状态标签准入规则说明。

### 测试

- 离线自测断言由 154 项增至 **200 项**，并在结尾打印断言总数。

## [0.2.3]

### 变更

- **预设卡片改由用户手动维护**（v0.2 起的架构）：扩展只读卡片形态与 `enabled`，
  提供运行时正文源；不创建、不修改、不移动卡片，也不调用 `/api/presets/save`。
- 配套最小 ST 补丁 `patches/st-marker-prompt.patch`：新增 `registerRuntimePromptSource()`、
  把运行时正文真正加进 `chatCompletion`、放开 marker 卡片的编辑与启停、
  把 `promptManager` 以 getter 暴露到 `getContext()`。
- 日记文件名改为「单段 ASCII + 双 hash」：
  `RoleExpansion_journal_c_<hash8>_j_<hash8>.jsonl`
  （`/api/files/upload` 只接受单段 ASCII 文件名，且没有创建子目录的接口）。
- 楼层选择新增区间行「第 N ~ M 楼」；「全选」「清空」拆成两个独立按钮。
- 日记主提示词与状态注入提示词均可自由修改。

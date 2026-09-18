# 更新日志

本文件记录 ST-RoleExpansion 的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

> `0.2.x` 及更早为本地迭代，条目依据 README 与代码整理，细节未必完整。

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

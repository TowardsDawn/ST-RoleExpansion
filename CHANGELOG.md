# 更新日志

本文件记录 ST-RoleExpansion 的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

> `0.2.x` 及更早为本地迭代，条目依据 README 与代码整理，细节未必完整。

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

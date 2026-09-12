# 更新日志

本文件记录 ST-RoleExpansion 的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

> `0.2.x` 及更早为本地迭代，条目依据 README 与代码整理，细节未必完整。

<!-- 发布到 GitHub 后，建议把下面的 OWNER/REPO 换成你的仓库地址，再把版本号接上链接 -->

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

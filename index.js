/**
 * ST-RoleExpansion —— 角色扩展
 *
 * 面向 SillyTavern 1.13.2+ 的前端扩展（纯 ESM，无构建步骤）。
 *
 * 模块：
 *   1. 日记（Journal）
 *      - 使用 ST 当前配置的 API（默认走 generateRaw 隔离通道，不写入主聊天）
 *      - 可自由勾选主聊天楼层作为参考
 *      - 一篇 = 一行 JSONL，会话级文件隔离
 *      - 可选把选中的日记注入主聊天（深度 0 / assistant 角色，同 Persona Description 机制）
 *      - 可选把选中的日记注入日记生成提示词
 *      - 主提示词可自由修改、支持 jsonl 导入导出、按篇删除
 *   2. 角色状态栏（State）
 *      - 等价于 SillyTavern-state 的状态管理 / 注入 / 标签解析
 *      - 去掉了世界书生成与提取
 *      - 注入提示词可自由修改
 *      - 可选把当前状态并入日记生成提示词
 *
 * UI：
 *   - 顶部工具栏抽屉（World Info 与 User Settings 之间）
 *   - 打开时为主面板形态：与 World Info 同款的下拉面板，挂在 #movingDivs，
 *     宽度 --sheldWidth、顶部紧贴工具栏居中；z-index 4000 高于「角色管理」侧栏
 *   - 角色管理面板内提供快捷入口按钮
 */

const MODULE_NAME = 'ST-RoleExpansion';

// ---- 从 ST 源码抄过来的枚举值（避免静态 import script.js 造成路径脆弱） ----
// script.js: extension_prompt_types { NONE:-1, IN_PROMPT:0, IN_CHAT:1, BEFORE_PROMPT:2 }
// script.js: extension_prompt_roles { SYSTEM:0, USER:1, ASSISTANT:2 }
const EXT_POSITION_IN_CHAT = 1;
const EXT_ROLE_ASSISTANT = 2;
const EXT_ROLE_SYSTEM = 0;

const EXT_PROMPT_KEY = {
    JOURNAL_MAIN: 'RoleExpansion_JournalMain',
    STATE: 'RoleExpansion_State',
};

const META_KEY = 'roleExpansion';
const META_STATE_KEY = 'roleExpansionState';

const STORAGE = {
    // 日记文件放在用户目录的 user/files/ 根目录下（前端通过 /api/files 读写）。
    // 接口只接受单段 ASCII 文件名，因此用前缀模拟层级：
    //   RoleExpansion_journal_c_<hash8>_j_<hash8>.jsonl
    PREFIX: 'RoleExpansion_journal',
};

// ST PromptManager 的 DOM 前缀（openai.js 里 configuration.prefix = 'completion_'）。
// 它决定了列表容器 id 与「禁用」类名，DOM 探针要用。
const PROMPT_MANAGER_PREFIX = 'completion_';

const DEFAULT_SETTINGS = {
    // 日记
    journalMainPrompt: [
        '你是 {{char}}。请以 {{char}} 的第一人称视角，写一篇私人日记。',
        '',
        '要求：',
        '1. 严格基于下方给出的【聊天记录参考】中的事实，不要编造未发生过的重要剧情。',
        '2. 写出 {{char}} 的内心活动、情绪变化、对 {{user}} 的看法，语气与角色设定一致。',
        '3. 这是独立的一篇日记，不要承接、续写任何其他日记，不要出现"上回说到"之类的表述。',
        '4. 正文 200~500 字，不要分小标题。',
        '5. 同时为这篇日记拟一个标题。',
        '',
        '输出格式（必须严格遵守，不要输出任何额外说明）：',
        '第一行：<title>日记标题</title>',
        '第二行开始：日记正文',
        '不要在正文里重复标题，也不要出现任何 XML/HTML 标签（除了上面那一对 <title>）。',
        '',
        '【聊天记录参考】',
        '{{chatRange}}',
        '',
        '【其他日记参考】',
        '{{journalRefs}}',
        '',
        '【当前状态参考】',
        '{{stateList}}',
    ].join('\n'),
    journalRefHeader: '以下是已有的其他日记，仅供你保持人物口径一致，不要重复其中的内容：',
    journalInjectHeader: '[以下是 {{char}} 先前写下的日记，属于既有事实，请保持设定与记忆的一致性]',
    journalInjectSeparator: '\n\n---\n\n',
    journalInjectIncludeTitle: true,
    // 「是否把日记注入主聊天」由预设卡片上的开关控制，不在这里设置
    journalInjectToJournal: false,
    // 隔离生成（默认开）：日记请求只带提示词本身，走 ST 的 generateRaw 通道，
    // 不含主聊天记录 / 角色卡 / 世界书 / 预设卡片；关闭则退回 generateQuietPrompt。
    journalIsolatedGeneration: true,
    journalFallbackTitle: '日记',
    // 状态栏
    stateEnabled: true,
    stateAutoInject: true,
    stateStripTags: true,
    stateInjectDepth: 0,
    stateInjectRole: 'system',
    stateIncludeInJournal: true,
    // 只接受状态列表里已有的名称（推荐开启）。
    // 关闭后，回复里任意 <名称>值</名称> 都会被当成新状态项自动加入列表 —— 误吞风险由用户自担。
    stateOnlyKnownNames: true,
    stateInjectPrompt: [
        '当前状态：',
        '{{stateList}}',
        '',
        '请参考以上状态。在回答时，如有任何状态数值因剧情发生变化，请仅输出发生变化的状态项，并使用 XML 标签格式表示，例如：<生命值>8/10</生命值>。如果没有状态变化，请不要输出任何状态标签。',
    ].join('\n'),
};

const DEFAULT_STATE_ITEM_EXAMPLE = { name: '生命值', value: '10/10' };

/** 状态名长度上限（按码点计，见 isStateTagName）：真实状态名都很短，过长的多半是 HTML / 推理标签 */
const MAX_STATE_NAME_LENGTH = 12;

/**
 * 明确不属于状态栏的标签名（比较前统一转小写）。
 *
 * 背景：状态标签的语法 <名称>值</名称> 与 HTML / 思维链标签同形，
 * 不加约束时模型输出 <thinking>…</thinking> 或一段 HTML 片段，
 * 会被当成状态项写进列表、并从正文里删掉。
 */
const NON_STATE_TAGS = new Set([
    // HTML
    'html', 'head', 'body', 'div', 'span', 'style', 'script', 'p', 'br', 'b', 'i', 'u', 'em', 'strong', 's',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'a', 'img', 'hr', 'pre', 'code', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'font', 'small', 'big', 'center', 'iframe', 'video', 'audio', 'source', 'details',
    // 思维链 / 推理
    'thinking', 'think', 'reasoning', 'analysis', 'thought', 'thoughts', 'reflection', 'plan', 'planning', 'scratchpad', 'cot',
    // 工具调用
    'tool', 'tool_call', 'tool_calls', 'function', 'functions',
]);

/**
 * 历史版本用过、v0.2 起已废弃的设置键。
 * loadSettings() 读取时顺手剔除，避免它们永久残留在 settings.json 里。
 */
const DEPRECATED_SETTINGS_KEYS = [
    'journalCardAnchor',    // 旧版：卡片插入锚点（卡片改由用户在预设里维护）
    'journalInjectRole',    // 旧版：注入角色（改由预设卡片决定）
    'journalInjectToMain',  // 旧版：插入主聊天开关（改由预设卡片开关决定）
    'journalPresetCard',    // 旧版：写入当前预设开关（本扩展对预设只读）
];

// ============================================================================
// 通用工具
// ============================================================================

/** 拿到 ST 上下文（拿不到时返回 null，所有调用方都要容错） */
function ctx() {
    try {
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
            return SillyTavern.getContext();
        }
    } catch (e) {
        console.warn(`[${MODULE_NAME}] getContext failed`, e);
    }
    return null;
}

function toast(kind, message) {
    try {
        const t = globalThis.toastr;
        if (t && typeof t[kind] === 'function') {
            t[kind](message, MODULE_NAME);
            return;
        }
    } catch (e) {
        /* ignore */
    }
    console.log(`[${MODULE_NAME}][${kind}]`, message);
}

function logError(...args) {
    console.error(`[${MODULE_NAME}]`, ...args);
}

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatTime(ts) {
    const d = new Date(ts || Date.now());
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function stampForFileName() {
    const d = new Date();
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/**
 * 过滤掉会破坏文件名的字符（用于浏览器下载的文件名，不影响服务器上传）
 * 同时禁止路径穿越。
 */
function safeName(raw, fallback = 'unknown') {
    const s = String(raw ?? '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\.\./g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return s.length ? s.slice(0, 80) : fallback;
}

/**
 * 酒馆的 /api/files/upload 走 validateAssetFileName，原始正则为 /^[a-zA-Z0-9_\-.]+$/：
 * 允许 '/'（所以 'User Avatars/x.png' 能通过），但中文、空格、括号等一律拒绝。
 * 这里把中文/任意字符压成纯 ASCII 安全串：能保留的 ASCII 字母数字直接留，
 * 其余折叠成 '_'；再用一段稳定 hash 做唯一性后缀。
 */
function slugForFile(raw, maxLen = 40) {
    const s = String(raw ?? '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, maxLen);
    return s || 'x';
}

/** 稳定短 hash（FNV-1a 32bit），只产出 hex 字符，跨会话可重现 */
function stableHash(input) {
    const s = String(input ?? '');
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

function textPreview(text, max = 70) {
    const s = String(text ?? '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max)}…` : s;
}

function splitLines(text) {
    return String(text ?? '').split(/\r?\n/);
}

// ============================================================================
// 设置
// ============================================================================

let settings = clone(DEFAULT_SETTINGS);

function loadSettings() {
    const c = ctx();
    const container = c?.extensionSettings;
    if (!container) {
        settings = clone(DEFAULT_SETTINGS);
        return settings;
    }
    const stored = container[MODULE_NAME];
    settings = Object.assign(clone(DEFAULT_SETTINGS), stored || {});
    // 顺手剔除历史版本的废弃键（否则它们会被 Object.assign 带回内存对象，并一直留在 settings.json 里）
    let droppedDeprecated = 0;
    for (const key of DEPRECATED_SETTINGS_KEYS) {
        if (key in settings) {
            delete settings[key];
            droppedDeprecated += 1;
        }
    }
    container[MODULE_NAME] = settings;
    if (droppedDeprecated) {
        // 把清理结果落回 settings.json
        saveSettingsDebounced();
    }
    return settings;
}

const saveSettingsDebounced = debounce(() => {
    const c = ctx();
    if (typeof c?.saveSettingsDebounced === 'function') {
        c.saveSettingsDebounced();
    } else if (typeof globalThis.saveSettingsDebounced === 'function') {
        globalThis.saveSettingsDebounced();
    }
}, 400);

function updateSetting(key, value, { persist = true } = {}) {
    settings[key] = value;
    const c = ctx();
    if (c?.extensionSettings) {
        c.extensionSettings[MODULE_NAME] = settings;
    }
    if (persist) {
        saveSettingsDebounced();
    }
    return settings[key];
}

// ============================================================================
// 聊天元数据（状态栏用；按会话隔离）
// ============================================================================

function getMetaRoot() {
    const c = ctx();
    if (!c) {
        return {};
    }
    if (!c.chatMetadata) {
        c.chatMetadata = {};
    }
    if (!c.chatMetadata[META_KEY] || typeof c.chatMetadata[META_KEY] !== 'object') {
        c.chatMetadata[META_KEY] = { state: [] };
    }
    if (!Array.isArray(c.chatMetadata[META_KEY].state)) {
        c.chatMetadata[META_KEY].state = [];
    }
    return c.chatMetadata[META_KEY];
}

/**
 * 兼容旧键 SillyTavern-state 的数据：**一个会话只迁移一次**。
 *
 * ⚠️ 仅凭「本扩展这侧为空」做判据是不够的 —— 用户点面板「清空全部」之后，
 * 本扩展这侧同样是空数组，而 sillyTavernState 仍留在会话文件里（实测如此）。
 * 没有次数标记的话，旧数据会在下一次读取时整份复活，
 * 表现为「清空后一刷新，状态全回来了」。
 *
 * 所以无论这一次是否真的发生迁移，都落一个 legacyMigrated 标记，此后永久停用迁移通道；
 * 旧插件的数据本身保持原样，不做删除。
 */
function migrateLegacyState(meta) {
    if (meta.legacyMigrated === true) {
        return;
    }
    const c = ctx();
    const legacy = c?.chatMetadata?.sillyTavernState;
    if (Array.isArray(legacy) && legacy.length && (!Array.isArray(meta.state) || meta.state.length === 0)) {
        meta.state = legacy.map(x => ({ name: String(x?.name ?? ''), value: String(x?.value ?? '') })).filter(x => x.name);
    }
    meta.legacyMigrated = true;
    saveMeta();
}

function getStateList() {
    const meta = getMetaRoot();
    migrateLegacyState(meta);
    return meta.state;
}

function saveMeta() {
    const c = ctx();
    if (typeof c?.saveMetadata === 'function') {
        try {
            c.saveMetadata();
            return;
        } catch (e) {
            logError('saveMetadata failed', e);
        }
    }
    try {
        globalThis.saveMetadata?.();
    } catch (e) {
        logError('global saveMetadata failed', e);
    }
}

const saveMetaDebounced = debounce(saveMeta, 300);

// ============================================================================
// 文件存储（/api/files）
// ============================================================================

function requestHeaders(contentTypeJson = true) {
    const c = ctx();
    try {
        if (typeof c?.getRequestHeaders === 'function') {
            return c.getRequestHeaders();
        }
    } catch (e) {
        /* ignore */
    }
    return contentTypeJson ? { 'Content-Type': 'application/json' } : {};
}

function b64EncodeUtf8(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

/**
 * 酒馆 /api/files/upload 的校验规则（src/endpoints/assets.js: validateAssetFileName）
 * 原始正则为 /^[a-zA-Z0-9_\-.]+$/。
 *
 * ⚠️ 实测：部分版本的 ST（以及"没有 '/' 的字符类"这种写法）会把 '/' 一并拒绝，
 * 而且 ST 自己调用该接口时只传单段文件名（chats.js: `${fileNamePrefix}.txt`）。
 * 所以这里**只允许单段文件名**，路径分隔符一律不允许；
 * 目录层级改由文件名前缀模拟（RoleExpansion_journal_...）。
 */
const ALLOWED_FILE_NAME_RE = /^[a-zA-Z0-9_\-.]+$/;

/** 请求路径前先本地按酒馆的规则验一遍，失败时报出到底是哪个字符不合法 */
function assertUploadPathAllowed(name) {
    const value = String(name ?? '');
    if (ALLOWED_FILE_NAME_RE.test(value)) {
        return value;
    }
    const bad = Array.from(value)
        .filter(ch => !/[a-zA-Z0-9_\-.]/.test(ch))
        .map(ch => `${ch}(U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
    logError('拒绝上传：文件名含非法字符', {
        name: value,
        codepoints: bad,
        hint: '酒馆只允许 ASCII 字母数字、_、-、.，且不接受单独的 / 段以外的字符',
    });
    throw new Error(`文件名不符合酒馆规则：${value}${bad.length ? `（非法字符：${bad.join(' ')}）` : ''}`);
}

async function uploadUserFile(path, text) {
    assertUploadPathAllowed(path);
    const resp = await fetch('/api/files/upload', {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify({ name: path, data: b64EncodeUtf8(text) }),
    });
    if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        logError('上传失败', { path, status: resp.status, detail });
        throw new Error(`upload failed (${resp.status}) ${detail}（提交的文件名：${path}）`);
    }
    return resp.json().catch(() => ({}));
}

async function deleteUserFile(path) {
    const resp = await fetch('/api/files/delete', {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify({ path: `user/files/${path}` }),
    });
    return resp.ok;
}

async function readUserFile(path) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const resp = await fetch(`/user/files/${encoded}`, { method: 'GET', cache: 'no-store' });
    if (!resp.ok) {
        if (resp.status === 404) {
            return '';
        }
        throw new Error(`read failed (${resp.status})`);
    }
    return resp.text();
}

// ============================================================================
// 日记存储层：一个会话 = 一个 jsonl 文件；一篇日记 = 一行
//
// ⚠️ 文件只能放在 files/ 根目录下、且必须是单段 ASCII 名：
//    - /api/files/upload 的 validateAssetFileName 不接受 '/'；
//    - 没有任何接口能创建子目录。
// 所以用「扁平名 + 前缀」模拟层级：
//    RoleExpansion_journal_c_<角色hash>_j_<会话hash>.jsonl
// 完整可读的角色名/会话名记录在文件首行的会话头里。
// ============================================================================

function currentChatIdentity() {
    const c = ctx();
    const chatId = typeof c?.getCurrentChatId === 'function' ? c.getCurrentChatId() : '';
    const charName = c?.name2 || c?.characters?.[c?.characterId]?.name || 'Character';
    const raw = chatId && String(chatId).trim()
        ? String(chatId).replace(/\.jsonl$/i, '')
        : `__noid__/${charName}`;
    const parts = raw.split('/');
    const chatFile = parts.pop() || raw;
    const charDir = parts.pop() || charName;

    const charKey = stableHash(charDir).slice(0, 8);
    const chatKey = stableHash(`${charDir}/${chatFile}`).slice(0, 8);
    const fileName = `${STORAGE.PREFIX}_c_${charKey}_j_${chatKey}.jsonl`;

    return {
        id: raw,
        charDir,
        chatFile,
        charSlug: `c_${charKey}`,
        fileName,
        // 与接口约定一致：这是相对 user/files/ 的**单段**文件名
        path: fileName,
    };
}

function encodeLine(obj) {
    return JSON.stringify(obj).replace(/\r?\n/g, '\\n');
}

/** 解析 jsonl：返回 {session, entries}，非法行会被跳过并计数 */
function parseJsonl(text) {
    const out = { session: null, entries: [], skipped: 0 };
    if (!text) {
        return out;
    }
    for (const rawLine of splitLines(text)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        let obj = null;
        try {
            obj = JSON.parse(line);
        } catch (e) {
            out.skipped += 1;
            continue;
        }
        if (obj && obj.__roleExpansion === 'session') {
            out.session = obj;
            continue;
        }
        if (obj && typeof obj === 'object' && typeof obj.content === 'string') {
            out.entries.push(normalizeEntry(obj));
            continue;
        }
        out.skipped += 1;
    }
    return out;
}

function normalizeEntry(src) {
    return {
        __roleExpansion: 'journal',
        id: String(src.id || uid()),
        title: String(src.title ?? ''),
        content: String(src.content ?? ''),
        createdAt: Number(src.createdAt) || Date.now(),
        updatedAt: Number(src.updatedAt) || Number(src.createdAt) || Date.now(),
        charName: String(src.charName ?? ''),
        userName: String(src.userName ?? ''),
        chatId: String(src.chatId ?? ''),
        sourceMessageIds: Array.isArray(src.sourceMessageIds) ? src.sourceMessageIds : [],
        sourceJournalIds: Array.isArray(src.sourceJournalIds) ? src.sourceJournalIds : [],
        stateSnapshot: Array.isArray(src.stateSnapshot) ? src.stateSnapshot : [],
        meta: src.meta && typeof src.meta === 'object' ? src.meta : {},
    };
}

async function loadJournalFile() {
    const identity = currentChatIdentity();
    let text = '';
    try {
        text = await readUserFile(identity.path);
    } catch (e) {
        logError('read journal file failed', identity.path, e);
        return { identity, entries: [], error: String(e?.message || e) };
    }
    const parsed = parseJsonl(text);
    if (parsed.skipped) {
        toast('warning', `日记文件有 ${parsed.skipped} 行无法解析，已跳过。`);
    }
    return { identity, entries: parsed.entries };
}

async function saveJournalFile(identity, entries) {
    const lines = [];
    lines.push(encodeLine({
        __roleExpansion: 'session',
        version: 1,
        chatId: identity.id,
        charDir: identity.charDir,
        chatFile: identity.chatFile,
        charSlug: identity.charSlug,
        savedAt: Date.now(),
        count: entries.length,
    }));
    for (const entry of entries) {
        lines.push(encodeLine(entry));
    }
    await uploadUserFile(identity.path, `${lines.join('\n')}\n`);
}

// ============================================================================
// 日记 / 状态 运行时状态
// ============================================================================

const ui = {
    identity: null,
    journal: [],           // 日记条目
    selectedJournalIds: new Set(),
    selectedFloors: new Set(),
    stateList: [],         // 与 chatMetadata 同步的引用
    busy: false,
    // 本插件自己发起的那次「生成日记」正在进行中 —— 主判据见 ensureRuntimePromptSource()
    generatingJournal: false,
    panelOpen: false,
    panelPinned: false,
    outsideClickBound: false,
    drawerEl: null,        // 顶部工具栏里的 .drawer
    contentEl: null,       // 顶部工具栏里的 .drawer-content（占位）
    panelEl: null,         // #movingDivs 里的侧边栏本体
};

// ============================================================================
// 楼层（聊天记录）选择
// ============================================================================

function getChatArray() {
    const c = ctx();
    return Array.isArray(c?.chat) ? c.chat : [];
}

function isSelectableMessage(msg) {
    return msg && typeof msg === 'object' && typeof msg.mes === 'string' && msg.mes.trim() !== '';
}

function listFloors() {
    const chat = getChatArray();
    const rows = [];
    chat.forEach((msg, index) => {
        if (!isSelectableMessage(msg)) {
            return;
        }
        rows.push({
            index,
            mesId: index,
            isUser: !!msg.is_user,
            isSystem: !!msg.is_system,
            name: msg.name || (msg.is_user ? (ctx()?.name1 || 'User') : (ctx()?.name2 || 'Character')),
            preview: textPreview(msg.mes),
            swipes: Array.isArray(msg.swipes) ? msg.swipes.length : 0,
        });
    });
    return rows;
}

/** 把勾选的楼层拼成一段参考文本 */
function buildChatRangeText(selectedIndexes) {
    const chat = getChatArray();
    const name1 = ctx()?.name1 || 'User';
    const name2 = ctx()?.name2 || 'Character';
    const indexes = Array.from(selectedIndexes)
        .filter(i => Number.isInteger(i) && i >= 0 && i < chat.length)
        .sort((a, b) => a - b);
    if (!indexes.length) {
        return '（未选择任何聊天楼层）';
    }
    return indexes
        .map(i => {
            const msg = chat[i];
            const who = msg.is_user ? name1 : (msg.name || name2);
            return `#${i} ${who}: ${String(msg.mes || '').trim()}`;
        })
        .join('\n\n');
}

// ============================================================================
// 日记生成
// ============================================================================

function renderTemplateString(tpl, vars) {
    let out = String(tpl ?? '');
    for (const [key, value] of Object.entries(vars)) {
        out = out.split(`{{${key}}}`).join(String(value ?? ''));
    }
    // 剩下的 {{...}} 交给 ST 的宏替换处理（{{char}} / {{user}} 等）
    const c = ctx();
    if (typeof c?.substituteParams === 'function') {
        try {
            out = c.substituteParams(out);
        } catch (e) {
            logError('substituteParams failed', e);
        }
    }
    return out;
}

function pickedJournals() {
    return ui.journal.filter(e => ui.selectedJournalIds.has(e.id));
}

function buildJournalRefText() {
    if (settings.journalInjectToJournal !== true) {
        return '（未开启「插入日记系统」开关）';
    }
    const picked = pickedJournals();
    if (!picked.length) {
        return '（未勾选任何参考日记）';
    }
    const parts = picked.map(e => {
        const title = e.title ? `【${e.title}】\n` : '';
        return `${title}${e.content}`;
    });
    return `${settings.journalRefHeader}\n\n${parts.join('\n\n---\n\n')}`;
}

function buildStateText() {
    const list = getStateList();
    if (!list.length) {
        return '';
    }
    return list.map(item => `${item.name} ${item.value}`).join('\n');
}

function buildJournalPrompt() {
    const refsEnabled = settings.journalInjectToJournal === true;
    const stateEnabled = settings.stateIncludeInJournal !== false;
    const vars = {
        chatRange: buildChatRangeText(ui.selectedFloors),
        journalRefs: refsEnabled ? buildJournalRefText() : '（未开启「插入日记系统」开关）',
        stateList: stateEnabled ? (buildStateText() || '（暂无状态）') : '（未开启状态联动）',
    };
    return renderTemplateString(settings.journalMainPrompt, vars);
}

/**
 * 剥掉「成块的推理容器」。只处理明确是推理 / 思考的标签，不做启发式猜测，
 * 以免误删日记正文里的正常内容（<title> 不在此列，它由 splitJournalResponse 处理）。
 */
function stripReasoningBlocks(text) {
    return String(text ?? '')
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
        .trim();
}

/**
 * 生成日记文本 —— 决定用哪条通道，并统一做后处理。
 *
 * ① 隔离通道（默认，推荐）：generateRaw
 *    ST 的 createRawPrompt() 只把 prompt（这里就是日记提示词）拼成消息数组，
 *    随后直接 sendOpenAIRequest()，**不经过 promptManager**。
 *    于是请求里没有 chat history、没有角色卡 / 世界书、没有预设里的任何卡片 ——
 *    与「写一篇日记」这个任务完全匹配，换模型也不会被主聊天语境带跑。
 *
 * ② 回退通道：generateQuietPrompt
 *    它是「后台生成」而非「上下文隔离」：请求里带着整条主聊天记录。
 *    这条路径靠 ui.generatingJournal（主判据）挡住本扩展自己注入日记，
 *    并额外带上 skipWIAN: true，少让世界书参与。
 *
 * 两条路径都可能抛错（例如 generateRaw 在拿不到内容时抛 'No message generated'），
 * 由调用方的 try/catch 统一处理。
 *
 * @param {string} prompt 已渲染好的日记提示词
 * @returns {Promise<string>}
 */
async function generateJournalText(prompt) {
    const c = ctx();
    if (settings.journalIsolatedGeneration !== false && typeof c?.generateRaw === 'function') {
        return stripReasoningBlocks(await c.generateRaw({ prompt }));
    }
    if (typeof c?.generateQuietPrompt === 'function') {
        const quiet = await c.generateQuietPrompt({ quietPrompt: prompt, quietToLoud: false, skipWIAN: true });
        return stripReasoningBlocks(quiet);
    }
    throw new Error('当前酒馆没有可用的生成接口（generateRaw / generateQuietPrompt）');
}

async function generateJournal() {
    if (ui.busy) {
        toast('info', '正在生成中，请稍候…');
        return;
    }
    const c = ctx();
    if (typeof c?.generateRaw !== 'function' && typeof c?.generateQuietPrompt !== 'function') {
        toast('error', '当前酒馆没有可用的生成接口（generateRaw / generateQuietPrompt），暂时生成不了日记。');
        return;
    }
    if (!ui.selectedFloors.size && !pickedJournals().length) {
        const proceed = globalThis.confirm('尚未勾选任何聊天楼层与参考日记，仍然生成吗？');
        if (!proceed) {
            return;
        }
    }

    ui.busy = true;
    setButtonBusy(true);
    toast('info', '正在生成日记…');
    const titleInput = document.getElementById('roleEx-journal-title');
    const manualTitle = titleInput ? titleInput.value.trim() : '';
    try {
        const prompt = buildJournalPrompt();
        // 置标志位：这次 quiet 生成期间运行时正文源返回空串，旧日记不会被塞回请求
        // （见 ensureRuntimePromptSource 的判据 ①）。finally 复位 —— 中途报错也要复位，
        // 否则日记会从此再也注入不进去，而且不会有任何提示。
        ui.generatingJournal = true;
        let text;
        try {
            text = await generateJournalText(prompt);
        } finally {
            ui.generatingJournal = false;
        }
        if (!String(text ?? '').trim()) {
            toast('warning', '模型返回了空内容。');
            return;
        }
        // 标题优先级：用户手填 > 模型随正文一起生成（<title>/# 标题）> 日期兜底
        await addJournalEntry({
            content: text,
            title: manualTitle,
            sourceMessageIds: Array.from(ui.selectedFloors).sort((a, b) => a - b),
            sourceJournalIds: pickedJournals().map(e => e.id),
            stateSnapshot: clone(getStateList()),
        });
        if (titleInput) {
            titleInput.value = '';
        }
    } catch (e) {
        logError('generateJournal failed', e);
        toast('error', `日记生成失败：${e?.message || e}`);
    } finally {
        ui.busy = false;
        setButtonBusy(false);
    }
}

/**
 * 从模型输出里分离「标题」和「正文」。
 * 优先认 <title>...</title>，其次认 markdown/【】首行标题，最后退化为日期时间。
 * @returns {{title: string, content: string}}
 */
function splitJournalResponse(raw) {
    let text = String(raw ?? '').trim();
    let title = '';

    const tagged = /<title>([\s\S]*?)<\/title>/i.exec(text);
    if (tagged) {
        title = tagged[1].replace(/\s+/g, ' ').trim();
        text = `${text.slice(0, tagged.index)}${text.slice(tagged.index + tagged[0].length)}`.trim();
    }

    // 模型偶尔会把中文全角标签或书名号当标题
    if (!title) {
        const loose = /^\s*(?:[【\[]\s*)?(?:标题|title)\s*[:：]\s*(.+?)(?:\s*[】\]])?\s*$/im.exec(text);
        if (loose) {
            title = loose[1].trim();
            text = text.replace(loose[0], '').trim();
        }
    }

    if (!title) {
        const firstLine = splitLines(text)[0]?.trim() || '';
        const heading = /^#{1,3}\s*(.+)$/.exec(firstLine) || /^【(.{1,40})】$/.exec(firstLine);
        if (heading) {
            title = heading[1].trim();
            text = splitLines(text).slice(1).join('\n').trim();
        }
    }

    // 兜底：标题标签残留、正文里多余的标签一并清掉
    text = text.replace(/<\/?title>/gi, '').trim();

    return { title: title.slice(0, 60), content: text };
}

function guessTitle(content, createdAt) {
    const firstLine = splitLines(content)[0]?.trim() || '';
    const heading = /^#{1,3}\s*(.+)$/.exec(firstLine);
    if (heading && heading[1].trim()) {
        return heading[1].trim().slice(0, 60);
    }
    const d = new Date(createdAt);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

async function addJournalEntry({ content, title, sourceMessageIds = [], sourceJournalIds = [], stateSnapshot = [] }) {
    const c = ctx();
    const now = Date.now();
    // 统一在这里做兜底解析：显式标题 > 正文里的 <title>/# 标题 > 日期
    let entryTitle = String(title ?? '').trim();
    let body = String(content).trim();
    if (!entryTitle) {
        const parsed = splitJournalResponse(body);
        entryTitle = parsed.title;
        body = parsed.content;
    }
    if (!entryTitle) {
        entryTitle = guessTitle(body, now);
    }
    const entry = normalizeEntry({
        id: uid(),
        title: entryTitle || settings.journalFallbackTitle,
        content: body,
        createdAt: now,
        updatedAt: now,
        charName: c?.name2 || '',
        userName: c?.name1 || '',
        chatId: ui.identity?.id || '',
        sourceMessageIds,
        sourceJournalIds,
        stateSnapshot,
    });
    ui.journal.push(entry);
    await persistJournal();
    renderJournalList();
    toast('success', `已写入日记：${entry.title}`);
    return entry;
}

async function persistJournal() {
    if (!ui.identity) {
        ui.identity = currentChatIdentity();
    }
    try {
        await saveJournalFile(ui.identity, ui.journal);
    } catch (e) {
        logError('persist journal failed', e);
        toast('error', `日记写入失败：${e?.message || e}`);
    }
}

async function reloadJournal() {
    ui.identity = currentChatIdentity();
    const { entries, error } = await loadJournalFile();
    if (error) {
        toast('error', `读取日记失败：${error}`);
    }
    ui.journal = entries;
    // 移除已失效的选择
    const ids = new Set(entries.map(e => e.id));
    for (const sel of Array.from(ui.selectedJournalIds)) {
        if (!ids.has(sel)) {
            ui.selectedJournalIds.delete(sel);
        }
    }
    renderJournalList();
    renderJournalStorageHint();
}

// ============================================================================
// 日记 → 主聊天系统 注入（只读关联）
//
// 预设里由**用户自行**维护一张 marker: true 卡片（片段见 README 3.3）；
// 本扩展只做两件事：
//   1) 注册运行时正文源 —— ST 每次生成时调它取「勾选日记」填进那张卡片；
//   2) 读取卡片在 prompt_order 里的 enabled —— 那是「是否注入」的唯一开关。
// 扩展**不创建/不修改/不移动**卡片，也不调用 /api/presets/save。
// ============================================================================

/** 卡片在预设里的固定标识 */
const PRESET_PROMPT = {
    ID: 'roleExpansionJournal',
    NAME: '日记（角色扩展）',
    /** 预设编辑弹窗里「正文来源」处显示的来源名 */
    SOURCE_NAME: '角色扩展（日记）',
    ROLE: 'assistant',
};

/**
 * 生成类型黑名单：这些生成不注入日记正文。
 *
 * ⚠️ 用黑名单而不是白名单。ST 的 type 还有 swipe / regenerate / continue，
 * 那些都是「主聊天正在生成回复」，日记理应照常在场；若写成白名单（例如只放行 normal），
 * 会把「重 roll」「重生成」这两种场景也一起挡掉，症状比原问题更隐蔽。
 *
 * 主判据是 ui.generatingJournal（本插件自己发起的那次写日记）；
 * 这里的类型黑名单是保险丝 —— 兜住其他扩展 / 命令发起的 quiet 生成。
 */
const NO_JOURNAL_INJECT_TYPES = new Set(['quiet']);

/** 最近一次生成的类型（由 GENERATION_STARTED 更新；拿不到该事件时保持 normal） */
let currentGenerationType = 'normal';

/** 当前激活预设名（优先读 UI 选择，兜底读设置） */
function currentPresetName() {
    try {
        const text = document.querySelector('#settings_preset_openai')?.selectedOptions?.[0]?.text?.trim();
        if (text) {
            return text;
        }
    } catch (e) {
        /* ignore */
    }
    const c = ctx();
    return String(c?.chatCompletionSettings?.preset_settings_openai ?? '').trim();
}

// --- 与 ST 本体约定的运行时提示词正文源 ---------------------------------------
// 配合 patches/st-marker-prompt.patch：ST 会把注册进来的 identifier 当作
// 「正文由运行时提供」的条目，于是预设里可以放一张 marker: true 的卡片
// （和 World Info (after) 同样的形态），正文由本扩展在生成时提供。
// 补丁还会按 options 放开 marker 卡片的「编辑（铅笔 + Prompt List 预览）」与
// 「启停开关」——这样注入的开关就完全交给预设卡片自己管，面板里不再重复控制。
// 未打补丁时 registerRuntimePromptSource 不存在或忽略 options，下面会自动回退。

let runtimeSourceRegistered = false;
let runtimeSourceForId = '';

/** identifier -> ST 侧的 key（ST 会把非单词字符换成 '_'） */
function runtimeSourceKey(identifier) {
    return String(identifier).replace(/\W/g, '_');
}

/**
 * 卡片在预设里是否启用 —— 这是「是否注入主聊天」的唯一权威开关。
 *
 * 优先看当前角色的 order；角色没有独立 order 时看全局 dummy order
 * （生成时用的是 dummy，见 ST 的 promptOrder.strategy = 'global'）。
 * 两处都查不到条目时，说明卡片还没被插进任何 order → 视为未启用。
 */
function isJournalCardEnabledInPreset() {
    const pm = getPromptManager();
    if (!pm?.configuration) {
        return false;
    }
    const entryFor = (character) => {
        if (!character || character.id === null || character.id === undefined) {
            return null;
        }
        try {
            return pm.getPromptOrderEntry(character, PRESET_PROMPT.ID);
        } catch (e) {
            return null;
        }
    };
    const own = entryFor(pm.activeCharacter);
    if (own) {
        return own.enabled !== false;
    }
    const dummyId = pm.configuration.promptOrder?.dummyId;
    const dummy = dummyId === undefined || dummyId === null ? null : entryFor({ id: dummyId });
    if (dummy) {
        return dummy.enabled !== false;
    }
    return false;
}

/** 确保已向 ST 注册本扩展的运行时正文源（含编辑/开关授权） */
function ensureRuntimePromptSource() {
    const c = ctx();
    const register = c?.registerRuntimePromptSource;
    const key = runtimeSourceKey(PRESET_PROMPT.ID);
    if (typeof register !== 'function') {
        return false;
    }
    if (runtimeSourceRegistered && runtimeSourceForId === key) {
        return true;
    }
    try {
        register(PRESET_PROMPT.ID, () => {
            // ① 主判据：本次就是本插件自己发起的「生成日记」。
            //    挡住它，旧日记才不会被当作 system 塞回写日记的请求里
            //    （那会造成自反馈，并与提示词里的 {{journalRefs}} 重复注入）。
            if (ui.generatingJournal) {
                return '';
            }
            // ② 保险丝：任何 quiet 类型的生成都不注入（含其他扩展 / 命令发起的）
            if (NO_JOURNAL_INJECT_TYPES.has(currentGenerationType)) {
                return '';
            }
            // ③ 开关由预设卡片决定：卡片关掉就不再提供正文
            if (!isJournalCardEnabledInPreset()) {
                return '';
            }
            return buildJournalInjectionText();
        }, {
            name: PRESET_PROMPT.SOURCE_NAME,
            edit: true,
            toggle: true,
        });
        runtimeSourceRegistered = true;
        runtimeSourceForId = key;
        return true;
    } catch (e) {
        logError('registerRuntimePromptSource failed', e);
        return false;
    }
}

/** ST 是否支持「扩展注册运行时正文源」（即是否已应用 patches/st-marker-prompt.patch） */
function supportsMarkerPromptCard() {
    return typeof ctx()?.registerRuntimePromptSource === 'function';
}

/** ST 是否把 promptManager 暴露到了 getContext()（补丁新增；缺失时扩展读不到预设） */
function isPromptManagerExposed() {
    return !!ctx()?.promptManager;
}

/** 提示词管理器（不存在时返回 null；调用方自己决定降级行为） */
function getPromptManager() {
    return ctx()?.promptManager ?? null;
}

/**
 * 检查「在浏览器里实际运行的那份 PromptManager」是否带补丁。
 *
 * 为什么要这样做：`getContext().registerRuntimePromptSource` 只能证明 `openai.js` 是新的，
 * 而「卡片有没有开关 / 铅笔」取决于 `PromptManager.js` 的两个方法。
 * 如果浏览器缓存了旧的 `PromptManager.js`，就会出现「开关和铅笔时有时无」这种错觉。
 * 直接读函数源码字符串，可以给出一锤定音的判断。
 *
 * @returns {{exposed:boolean, patchedToggle:boolean, patchedEdit:boolean, patchedInspect:boolean}}
 */
function probeStPatch() {
    const out = { exposed: false, patchedToggle: false, patchedEdit: false, patchedInspect: false };
    try {
        const pm = getPromptManager();
        const proto = pm ? Object.getPrototypeOf(pm) : null;
        out.exposed = isPromptManagerExposed();
        const src = (name) => (typeof proto?.[name] === 'function' ? String(proto[name]) : '');
        out.patchedToggle = src('isPromptToggleAllowed').includes('getRuntimePromptPermissions');
        out.patchedEdit = src('isPromptEditAllowed').includes('getExtensionPromptSourceName');
        // handleInspect 是实例属性，不是原型方法，从实例上取
        out.patchedInspect = pm && typeof pm.handleInspect === 'function'
            ? String(pm.handleInspect).includes('getRuntimePromptPreviewSource')
            : false;
    } catch (e) {
        logError('probeStPatch failed', e);
    }
    return out;
}

/**
 * 直接从 DOM 上确认那张卡片此刻有没有渲染出「铅笔 / 启停开关」。
 *
 * 为什么要单独查 DOM：`probeStPatch()` 只能证明方法源码是新的，
 * 证明不了「当前屏幕上这一行是用带授权的那份代码渲染出来的」。
 * 首屏（还没打开任何会话）之所以缺控件，就是渲染时机问题而不是权限问题。
 *
 * @returns {{listRendered:boolean, found:boolean, edit:boolean, toggle:boolean, enabled:boolean|null}}
 */
function probeCardControls() {
    const out = { listRendered: false, found: false, edit: false, toggle: false, enabled: null };
    try {
        const list = document.getElementById(`${PROMPT_MANAGER_PREFIX}prompt_manager_list`);
        out.listRendered = !!list;
        const row = list?.querySelector?.(`li[data-pm-identifier="${PRESET_PROMPT.ID}"]`) ?? null;
        if (!row) {
            return out;
        }
        out.found = true;
        out.edit = !!row.querySelector?.('.prompt-manager-edit-action');
        out.toggle = !!row.querySelector?.('.prompt-manager-toggle-action');
        out.enabled = !String(row.className || '').includes(`${PROMPT_MANAGER_PREFIX}prompt_manager_prompt_disabled`);
    } catch (e) {
        logError('probeCardControls failed', e);
    }
    return out;
}

/** 把补丁检测结果打到控制台，便于排查「卡片没有开关 / 没有铅笔」 */
function logMarkerSupport() {
    const marker = supportsMarkerPromptCard();
    const probe = probeStPatch();
    const sourceRegistered = runtimeSourceRegistered;
    if (marker && probe.patchedToggle && probe.patchedEdit) {
        console.info(`[${MODULE_NAME}] ST 补丁已生效：`
            + `registerRuntimePromptSource=${marker}`
            + ` / PromptManager.isPromptToggleAllowed 已放行=${probe.patchedToggle}`
            + ` / isPromptEditAllowed 已放行=${probe.patchedEdit}`
            + ` / handleInspect 支持即时预览=${probe.patchedInspect}`
            + ` / 运行时源已注册=${sourceRegistered}`);
    } else {
        console.warn(`[${MODULE_NAME}] ST 补丁不完整，卡片会没有开关/铅笔。`, probe);
        if (!marker) {
            console.warn('  → getContext().registerRuntimePromptSource 不存在：openai.js 仍是旧版，'
                + '或浏览器缓存了 scripts/openai.js（Ctrl+F5）。');
        }
        if (marker && !probe.patchedToggle) {
            console.warn('  → PromptManager.isPromptToggleAllowed 没有补丁：'
                + '浏览器缓存了旧的 scripts/PromptManager.js（Ctrl+F5），或补丁只应用了一部分。');
        }
    }
    return { marker, ...probe, sourceRegistered };
}


/**
 * 卡片状态变化后刷新 UI 上的状态文案。
 * 「是否注入」是读出来的，不缓存到设置里，避免出现两份可能不一致的状态。
 */
function adoptCardStateFromPreset() {
    const pm = getPromptManager();
    if (!pm?.serviceSettings) {
        return;
    }
    if (!pm.getPromptById?.(PRESET_PROMPT.ID)) {
        return;
    }
    updatePresetCardHint();
}

/** 把当前勾选的日记拼成注入文本（不含任何包装时返回空串） */
function buildJournalInjectionText() {
    const picked = pickedJournals();
    if (!picked.length) {
        return '';
    }
    const header = renderTemplateString(settings.journalInjectHeader, {});
    const body = picked
        .map(e => (settings.journalInjectIncludeTitle && e.title ? `【${e.title}】\n${e.content}` : e.content))
        .join(settings.journalInjectSeparator || '\n\n---\n\n');
    return `${header}\n\n${body}`;
}

/**
 * 诊断：打印当前预设里这张卡片的真实状态。
 *
 * ⚠️ 本扩展**不创建、不修改、不移动**预设卡片 —— 卡片由用户在预设 JSON 里自行维护。
 * 这个函数只读，用于确认卡片是否就位、落在哪个 prompt_order 块、前后邻居是谁。
 *
 * @returns {object} 快照
 */
function diagnoseJournalCard() {
    const pm = getPromptManager();
    const probe = probeStPatch();
    const out = {
        preset: currentPresetName() || '(未识别)',
        promptManagerExposed: isPromptManagerExposed(),
        promptManagerReady: !!pm?.serviceSettings,
        // 补丁探针：直接读「浏览器里正在运行的那个 PromptManager」的方法源码，
        // 能区分「补丁没打」与「打了但渲染时机不对」
        patch: {
            openai: supportsMarkerPromptCard(),
            toggleAllowed: probe.patchedToggle,
            editAllowed: probe.patchedEdit,
            inspectPreview: probe.patchedInspect,
            sourceRegistered: runtimeSourceRegistered,
        },
        // 当前屏幕上那一行到底渲染出了什么（首屏缺控件时，看这里而不是看权限）
        controls: probeCardControls(),
        existsInPrompts: false,
        promptKeys: [],
        marker: null,
        bindings: [],
        enabled: false,
        note: '卡片由你手动写进预设 JSON；本扩展只提供正文并读取开关状态。',
    };
    if (!out.promptManagerExposed) {
        console.warn(`[${MODULE_NAME}] 诊断：getContext().promptManager 不存在。`
            + '说明 ST 补丁是旧版（只加了 registerRuntimePromptSource，没暴露 promptManager），'
            + '请重新应用 patches/st-marker-prompt.patch 并 Ctrl+F5。');
        return out;
    }
    if (!out.promptManagerReady) {
        console.warn(`[${MODULE_NAME}] 诊断：提示词管理器存在但未初始化`
            + '（promptManager.serviceSettings 为空）—— 通常是当前接口不是 Chat Completion 类。', out);
        return out;
    }
    const prompt = pm.getPromptById(PRESET_PROMPT.ID);
    if (prompt) {
        out.existsInPrompts = true;
        out.promptKeys = Object.keys(prompt);
        out.marker = prompt.marker === true;
    }
    // 每个 preset_order 块里该条目的位置
    for (const block of pm.serviceSettings.prompt_order || []) {
        const ids = (block.order || []).map(e => e?.identifier);
        const idx = ids.indexOf(PRESET_PROMPT.ID);
        if (idx === -1) {
            continue;
        }
        const prev = idx > 0 ? ids[idx - 1] : '(首位)';
        const next = idx < ids.length - 1 ? ids[idx + 1] : '(末位)';
        out.bindings.push({
            character_id: block.character_id,
            index: idx,
            enabled: block.order[idx].enabled !== false,
            prev,
            next,
        });
    }
    out.enabled = isJournalCardEnabledInPreset();
    console.info(`[${MODULE_NAME}] 诊断：日记卡片状态`, out);
    return out;
}

// ============================================================================
// 日记内容 → 预设卡片（只读关联）
//
// 本扩展**不写预设**：卡片由用户在预设 JSON 里自行维护（见 README 3.3 的片段）。
// 扩展只做两件事：
//   1) 注册运行时正文源 —— ST 每次生成时调它取日记内容，填进那张卡片；
//   2) 读取卡片在 prompt_order 里的 enabled —— 那是「是否注入」的唯一开关。
// ============================================================================

/** 读取卡片在预设里的形态（供 UI 展示）；不修改任何东西 */
function readJournalCard() {
    const pm = getPromptManager();
    if (!pm?.serviceSettings) {
        return { ok: false, reason: 'no-manager' };
    }
    const prompt = pm.getPromptById(PRESET_PROMPT.ID);
    if (!prompt) {
        return { ok: false, reason: 'no-card' };
    }
    return {
        ok: true,
        prompt,
        marker: prompt.marker === true,
        enabled: isJournalCardEnabledInPreset(),
    };
}

let promptManagerRenderTimer = null;

/**
 * 让预设 UI 的卡片重新渲染一次（例如「正文来源」提示需要更新时）。
 * 纯展示用途，不涉及任何预设内容改动。
 */
function rerenderPromptManagerSoon() {
    const pm = getPromptManager();
    if (!pm || typeof pm.render !== 'function') {
        return;
    }
    clearTimeout(promptManagerRenderTimer);
    promptManagerRenderTimer = setTimeout(() => {
        try {
            pm.render(false);
        } catch (e) {
            logError('prompt manager render failed', e);
        }
    }, 350);
}

let promptManagerFirstRenderPatched = false;

/**
 * 首屏补渲染：让「还没打开任何会话」时卡片上也有铅笔和开关。
 *
 * 时序（见 ST 的 public/script.js firstLoadInit）：
 *   initOpenAI()   ← 里面调用 setupChatCompletionPromptManager()，**首次渲染预设列表**
 *   initExtensions()  ← 扩展脚本此刻才求值、才注册运行时源
 * 也就是说首次渲染发生在我们注册**之前**，那一次 `isPromptEditAllowed /
 * isPromptToggleAllowed` 查不到授权 → 那一行没有铅笔和开关；
 * 而列表只有在 CHAT_LOADED / 发消息等事件里才会重渲染，
 * 所以表现成「必须先打开一次会话，控件才出现」。
 *
 * 注册成功后主动补一次渲染即可。纯展示用途，不写预设、不碰 prompt_order。
 */
function patchPromptManagerFirstRender() {
    if (promptManagerFirstRenderPatched) {
        return false;
    }
    promptManagerFirstRenderPatched = true;
    rerenderPromptManagerSoon();
    // 二次确认：万一 ST 的首屏渲染比我们更晚完成（把我们这版覆盖掉），
    // 再检查一次那一行到底有没有控件，缺了才补渲染。有上限，不会反复重绘。
    setTimeout(() => {
        const c = probeCardControls();
        if (c.listRendered && c.found && (!c.edit || !c.toggle)) {
            rerenderPromptManagerSoon();
        }
    }, 1500);
    return true;
}

/**
 * 清理历史上用过的临时注入。
 * 旧版本会走 `setExtensionPrompt` 兜底，现在注入完全由预设卡片负责，
 * 这里只负责把可能残留在酒馆里的那一条清掉，避免同一段日记被重复注入。
 */
function clearLegacyJournalInjection() {
    const c = ctx();
    if (typeof c?.setExtensionPrompt !== 'function') {
        return;
    }
    c.setExtensionPrompt(EXT_PROMPT_KEY.JOURNAL_MAIN, '', EXT_POSITION_IN_CHAT, 0, false, EXT_ROLE_ASSISTANT);
}

/**
 * 勾选变化：只需要刷新界面。
 * marker 模式下正文由运行时源实时取，预设里不需要写任何东西；卡片由用户维护。
 */
function onJournalSelectionChanged() {
    renderJournalList();
    updatePresetCardHint();
}

// ============================================================================
// 状态栏 → 主聊天系统 注入
// ============================================================================

function applyStateInjection() {
    const c = ctx();
    if (typeof c?.setExtensionPrompt !== 'function') {
        return;
    }
    const list = getStateList();
    if (!settings.stateEnabled || !settings.stateAutoInject || !list.length) {
        c.setExtensionPrompt(EXT_PROMPT_KEY.STATE, '', EXT_POSITION_IN_CHAT, 0, false, EXT_ROLE_SYSTEM);
        return;
    }
    const text = renderTemplateString(settings.stateInjectPrompt, { stateList: buildStateText() });
    const role = settings.stateInjectRole === 'assistant'
        ? EXT_ROLE_ASSISTANT
        : (settings.stateInjectRole === 'user' ? 1 : EXT_ROLE_SYSTEM);
    const depth = Number.isFinite(Number(settings.stateInjectDepth)) ? Math.max(0, Math.trunc(Number(settings.stateInjectDepth))) : 0;
    c.setExtensionPrompt(EXT_PROMPT_KEY.STATE, text, EXT_POSITION_IN_CHAT, depth, false, role);
}

// ============================================================================
// 状态栏：解析 AI 回复中的 <名称>值</名称> 标签
// ============================================================================

/**
 * 从一段正文里挑出「真正的状态标签」。
 *
 * 准入判据（全部满足才算），见 isStateTagName()：
 *   名称非空、长度达标、不含空白与 - . / \、不在 NON_STATE_TAGS 里；
 *   以及 options.isKnownName 存在时，名称必须已在状态列表里。
 *
 * ⚠️ 被拒绝的标签**原样留在正文里** —— 只有真正被接受的状态标签才会被剥离。
 * 旧实现用 `src.replace(regex, '')` 一刀切，会把 HTML、<thinking> 的内容一起删掉。
 *
 * @param {string} text 待解析的正文
 * @param {{ isKnownName?: (name: string) => boolean }} [options]
 * @returns {{ changed: boolean, updates: Array<{name:string,value:string}>, rejected: string[], text: string }}
 */
function parseAndStripStateTags(text, options = {}) {
    const src = String(text ?? '');
    const isKnownName = typeof options.isKnownName === 'function' ? options.isKnownName : null;
    const regex = /<([^/<>\s][^<>]*)>([^<>]*)<\/\1>/g;
    const updates = [];
    const rejected = [];
    let out = '';
    let cursor = 0;
    let match;
    while ((match = regex.exec(src)) !== null) {
        const name = match[1].trim();
        const value = match[2].trim();
        if (!isStateTagName(name, isKnownName)) {
            rejected.push(name || '(空名)');
            continue;   // 不改动 out / cursor：该标签连同内容原样保留
        }
        out += src.slice(cursor, match.index);
        cursor = regex.lastIndex;
        updates.push({ name, value });
    }
    if (!updates.length) {
        return { changed: false, updates, rejected, text: src };
    }
    out += src.slice(cursor);
    return { changed: true, updates, rejected, text: out.replace(/\n{3,}/g, '\n\n').trim() };
}

/**
 * 状态标签名的准入判断（判据说明见 parseAndStripStateTags）。
 *
 * 两个容易写错的细节：
 *
 * 1. **已知名称优先放行**。用户自己在面板里建的状态名是权威数据，长度与黑名单都不该
 *    成为它的门槛 —— 否则一个 13 字的合法状态项会永远收不到更新，而且是静默失败
 *    （只在控制台列一下被忽略的标签名）。长度/黑名单只用于**未知名称**的过滤。
 * 2. **长度按码点算，不按 UTF-16 code unit**。JS 的 `str.length` 数的是 code unit：
 *    常用汉字是 1，但 emoji 与扩展区汉字（如 𠮷 U+20BB7）会占 2，
 *    `[...name].length` 得到的才是字面字符数。
 *
 * @param {string} name 标签名（已 trim）
 * @param {((name: string) => boolean) | null} isKnownName 已知名单判据；null 表示不做该限制
 * @returns {boolean}
 */
function isStateTagName(name, isKnownName) {
    if (!name) {
        return false;
    }
    // ① 用户自定义的状态名：直接通过
    if (isKnownName && isKnownName(name)) {
        return true;
    }
    // ② 未知名称才走长度 / 形状 / 黑名单三道闸
    if ([...name].length > MAX_STATE_NAME_LENGTH) {
        return false;
    }
    if (/[\s\-./\\]/.test(name)) {
        return false;
    }
    if (NON_STATE_TAGS.has(name.toLowerCase())) {
        return false;
    }
    // 限制开启时（isKnownName 为函数）走到这里说明是未知名称 → 不通过；
    // 限制关闭时（isKnownName 为 null）→ 通过
    return !isKnownName;
}

function onCharacterMessageReceived() {
    if (!settings.stateEnabled) {
        return;
    }
    const chat = getChatArray();
    if (!chat.length) {
        return;
    }
    const last = chat[chat.length - 1];
    if (!last || last.is_user || typeof last.mes !== 'string') {
        return;
    }
    const list = getStateList();
    const knownNames = new Set(list.map(x => x.name));
    const { changed, updates, rejected, text } = parseAndStripStateTags(last.mes, {
        // 默认只更新状态列表里已有的项（面板可关闭该限制）
        isKnownName: settings.stateOnlyKnownNames !== false ? (name => knownNames.has(name)) : null,
    });
    if (rejected.length) {
        console.info(`[${MODULE_NAME}] 忽略了 ${rejected.length} 个非状态标签：`, rejected);
    }
    if (!changed) {
        return;
    }
    for (const { name, value } of updates) {
        const item = list.find(x => x.name === name);
        if (item) {
            item.value = value;
        } else {
            list.push({ name, value });
        }
    }
    if (settings.stateStripTags !== false) {
        last.mes = text;
    }
    saveMetaDebounced();
    renderStateList();
    applyStateInjection();
}

// ============================================================================
// DOM 构建
// ============================================================================

const ID = {
    drawer: 'roleExpansion-button',
    content: 'roleExpansionPanel',
    charButton: 'role_expansion_char_button',
    settingsRoot: `${MODULE_NAME}_settings`,
};

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') {
            node.className = v;
        } else if (k === 'text') {
            node.textContent = v;
        } else if (k === 'html') {
            node.innerHTML = v;
        } else if (k.startsWith('on') && typeof v === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v !== null && v !== undefined && v !== false) {
            node.setAttribute(k, v === true ? '' : String(v));
        }
    }
    for (const child of [].concat(children)) {
        if (child === null || child === undefined) {
            continue;
        }
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

function q(selector, root = document) {
    return root.querySelector(selector);
}

function section(title, { open = false } = {}) {
    const content = el('div', { class: 'roleEx-section-body' });
    const icon = el('div', { class: `fa-solid fa-circle-chevron-${open ? 'down' : 'right'} inline-drawer-icon roleEx-chevron` });
    const header = el('div', { class: 'roleEx-section-header' }, [
        el('i', { class: 'fa-solid fa-fw roleEx-section-icon' }),
        el('span', { class: 'roleEx-section-title', text: title }),
        icon,
    ]);
    const root = el('div', { class: 'roleEx-section' }, [header, content]);
    const setOpen = (value) => {
        root.classList.toggle('roleEx-open', value);
        icon.className = `fa-solid fa-circle-chevron-${value ? 'down' : 'right'} inline-drawer-icon roleEx-chevron`;
        content.style.display = value ? 'block' : 'none';
    };
    header.addEventListener('click', () => setOpen(!root.classList.contains('roleEx-open')));
    setOpen(open);
    return { root, content, setOpen };
}

function iconFor(sectionRoot, iconClass) {
    const i = q('.roleEx-section-icon', sectionRoot);
    if (i) {
        i.className = `fa-solid fa-fw ${iconClass} roleEx-section-icon`;
    }
}

/**
 * 区块内的小折叠。直接用酒馆原生的 `.inline-drawer` 结构：
 * script.js 里是 `$(document).on('click', '.inline-drawer-toggle', …)` 的委托绑定，
 * 所以后插入的节点也能折叠，动画/图标切换都是现成的。
 */
function collapsible(title, { open = true } = {}) {
    const body = el('div', { class: 'inline-drawer-content roleEx-fold-body' });
    // 原生处理器用 toggleClass('down up') 做互换，所以初始只能带其中一个状态类
    const dir = open ? 'up' : 'down';
    const icon = el('div', { class: `fa-solid fa-circle-chevron-${dir} ${dir} inline-drawer-icon` });
    const header = el('div', { class: 'inline-drawer-toggle inline-drawer-header roleEx-fold-header' }, [
        el('span', { text: title }),
        icon,
    ]);
    const root = el('div', { class: 'inline-drawer roleEx-fold' }, [header, body]);
    if (!open) {
        body.style.display = 'none';
    }
    return { root, body, header };
}

// ============================================================================
// UI：日记
// ============================================================================

function buildJournalPanel() {
    const s = section('日记', { open: true });
    s.root.setAttribute('id', 'roleEx-journal-section');
    iconFor(s.root, 'fa-solid fa-book');

    // ---- 生成区 ----
    const titleInput = el('input', {
        type: 'text',
        class: 'text_pole roleEx-input',
        id: 'roleEx-journal-title',
        placeholder: '留空则由模型生成标题',
    });
    const generateBtn = el('div', { class: 'menu_button roleEx-btn', id: 'roleEx-generate-journal', text: '生成日记' });
    generateBtn.addEventListener('click', () => generateJournal());

    const floorSummary = el('span', { class: 'roleEx-hint', id: 'roleEx-floor-summary', text: '已选 0 楼' });
    const floorsBox = el('div', { class: 'roleEx-floors', id: 'roleEx-floors' });

    const pickRecent = (n) => {
        const rows = listFloors();
        ui.selectedFloors.clear();
        for (const row of rows.slice(-n)) {
            ui.selectedFloors.add(row.index);
        }
        renderFloors();
    };

    /** 勾选「第 N 楼 ~ 第 M 楼」（编号与列表里的 #号 一致，0 起，两端都含） */
    const applyFloorRange = () => {
        const rawFrom = String(fromInput.value ?? '').trim();
        const rawTo = String(toInput.value ?? '').trim();
        if (rawFrom === '' || rawTo === '') {
            toast('warning', '请先填写起始楼与结束楼（编号同列表里的 #号，0 起）。');
            return;
        }
        let from = Math.trunc(Number(rawFrom));
        let to = Math.trunc(Number(rawTo));
        if (!Number.isFinite(from) || !Number.isFinite(to)) {
            toast('warning', '楼层编号必须是数字。');
            return;
        }
        if (from > to) {
            [from, to] = [to, from];
        }
        const rows = listFloors();
        const hit = rows.filter(r => r.index >= from && r.index <= to);
        if (!hit.length) {
            toast('warning', `第 ${from} ~ ${to} 楼里没有可用的聊天楼层。`);
            return;
        }
        ui.selectedFloors = new Set(hit.map(r => r.index));
        fromInput.value = String(from);
        toInput.value = String(to);
        renderFloors();
        toast('success', `已选中第 ${from} ~ ${to} 楼（共 ${hit.length} 楼）。`);
    };

    const quick = el('div', { class: 'roleEx-row roleEx-gap' }, [
        el('div', { class: 'menu_button roleEx-btn-sm', text: '最近 10 楼', onclick: () => pickRecent(10) }),
        el('div', {
            class: 'menu_button roleEx-btn-sm', text: '全选', onclick: () => {
                ui.selectedFloors = new Set(listFloors().map(r => r.index));
                renderFloors();
            },
        }),
        el('div', {
            class: 'menu_button roleEx-btn-sm', text: '清空', onclick: () => {
                ui.selectedFloors.clear();
                renderFloors();
            },
        }),
        el('div', { class: 'menu_button roleEx-btn-sm', text: '刷新楼层', onclick: () => renderFloors() }),
    ]);

    // 指定区间：单独占一行（放在按钮行下面）
    const fromInput = el('input', {
        type: 'number', class: 'text_pole roleEx-num', id: 'roleEx-floor-from', min: '0', placeholder: '起始',
    });
    const toInput = el('input', {
        type: 'number', class: 'text_pole roleEx-num', id: 'roleEx-floor-to', min: '0', placeholder: '结束',
    });
    const applyRangeBtn = el('div', {
        class: 'menu_button roleEx-btn-sm', id: 'roleEx-floor-range-apply', text: '选中区间', onclick: applyFloorRange,
    });
    const rangeRow = el('div', { class: 'roleEx-row roleEx-gap roleEx-vcenter' }, [
        el('span', { class: 'roleEx-hint', text: '第' }),
        fromInput,
        el('span', { class: 'roleEx-hint', text: '~' }),
        toInput,
        el('span', { class: 'roleEx-hint', text: '楼' }),
        applyRangeBtn,
    ]);

    // 参考楼层折叠（默认展开：这是生成日记的主操作区）
    const floorsFold = collapsible('参考聊天楼层', { open: true });
    floorsFold.root.setAttribute('id', 'roleEx-floors-fold');
    floorsFold.body.append(quick, rangeRow, floorSummary, floorsBox);

    // 生成通道开关（默认走隔离通道）
    const isolatedToggle = el('input', { type: 'checkbox' });
    isolatedToggle.checked = settings.journalIsolatedGeneration !== false;
    isolatedToggle.addEventListener('change', () => updateSetting('journalIsolatedGeneration', isolatedToggle.checked));

    const generate = el('div', { class: 'roleEx-block' }, [
        el('div', { class: 'roleEx-label', text: '新日记' }),
        titleInput,
        el('div', { class: 'roleEx-row roleEx-gap roleEx-vcenter' }, [
            generateBtn,
            el('span', { class: 'roleEx-hint', text: '用当前 API 独立生成，不动主聊天' }),
        ]),
        checkboxRow(isolatedToggle, '隔离生成（推荐）', '只把日记提示词发给模型：不带主聊天记录、角色卡、世界书；关闭后退回酒馆的安静生成通道'),
        floorsFold.root,
    ]);

    // ---- 注入设置 ----
    // 「是否把日记插入主聊天」完全由预设里那张卡片的开关控制（与 World Info (after) 一致），
    // 面板里只展示状态并提供跳转，不再重复控制，避免两个开关打架。
    const injectJournalToggle = el('input', { type: 'checkbox', id: 'roleEx-inject-journal' });
    injectJournalToggle.checked = settings.journalInjectToJournal === true;
    injectJournalToggle.addEventListener('change', () => {
        updateSetting('journalInjectToJournal', injectJournalToggle.checked);
        renderJournalList();
    });

    const presetCardHint = el('div', { class: 'roleEx-hint', id: 'roleEx-preset-card-hint' });

    const openPresetBtn = el('div', {
        class: 'menu_button roleEx-btn-sm',
        text: '打开预设面板',
        title: '打开「AI Response Configuration」侧栏，在那里拖动/开关日记卡片',
        onclick: () => {
            const panel = document.getElementById('left-nav-panel');
            if (panel?.classList.contains('openDrawer')) {
                return;
            }
            const toggle = document.getElementById('ai-config-button')?.querySelector('.drawer-toggle');
            toggle?.click();
        },
    });

    const inject = el('div', { class: 'roleEx-block' }, [
        el('div', { class: 'roleEx-label', text: '注入设置' }),
        presetCardHint,
        el('div', { class: 'roleEx-row roleEx-gap roleEx-vcenter' }, [
            openPresetBtn,
            el('span', { class: 'roleEx-hint', text: '开关卡片＝启停注入' }),
        ]),
        el('div', {
            class: 'roleEx-hint',
            html: '正文由扩展提供，位置与启停都在预设里管理（卡片 <code>roleExpansionJournal</code>）。',
        }),
        checkboxRow(injectJournalToggle, '插入日记系统', '作为「新日记」的参考提示词'),
    ]);

    // ---- 列表 + 工具 ----
    const list = el('div', { class: 'roleEx-list', id: 'roleEx-journal-list' });

    const selectAllBtn = el('div', {
        class: 'menu_button roleEx-btn-sm',
        id: 'roleEx-select-all',
        text: '全选',
        title: '勾选全部日记',
        onclick: () => {
            ui.journal.forEach(e => ui.selectedJournalIds.add(e.id));
            onJournalSelectionChanged();
        },
    });

    const clearAllBtn = el('div', {
        class: 'menu_button roleEx-btn-sm',
        id: 'roleEx-clear-all',
        text: '清空',
        title: '取消勾选全部日记',
        onclick: () => {
            ui.selectedJournalIds.clear();
            onJournalSelectionChanged();
        },
    });

    const tools = el('div', { class: 'roleEx-row roleEx-gap roleEx-wrap' }, [
        selectAllBtn,
        clearAllBtn,
        el('div', { class: 'menu_button roleEx-btn-sm', text: '导出', onclick: () => exportJournalFile(false) }),
        el('div', { class: 'menu_button roleEx-btn-sm', text: '导出所选', onclick: () => exportJournalFile(true) }),
        el('div', { class: 'menu_button roleEx-btn-sm', text: '导入', onclick: () => importJournalFile() }),
        el('div', { class: 'menu_button roleEx-btn-sm roleEx-danger', text: '删除所选', onclick: () => deleteSelectedJournals() }),
    ]);

    const storageHint = el('div', { class: 'roleEx-hint', id: 'roleEx-storage-hint' });

    // 「关于」的内容并进这里（去掉版本号那一行，只留下真正有用的存储说明）
    const storageNote = el('div', {
        class: 'roleEx-hint',
        id: 'roleEx-storage-note',
        html: '按会话隔离存放于 <code>user/files/RoleExpansion_journal_c_&lt;hash&gt;_j_&lt;hash&gt;.jsonl</code>：'
            + '一篇日记一行，互不续写。',
    });

    // 日记列表折叠（默认展开）
    const entriesFold = collapsible('日记列表', { open: true });
    entriesFold.root.setAttribute('id', 'roleEx-journal-fold');
    entriesFold.body.append(storageHint, storageNote, list, tools);

    const entries = el('div', { class: 'roleEx-block' }, [entriesFold.root]);

    s.content.append(generate, inject, entries);

    // 主提示词编辑器（必须挂进 s.content，否则这个区块根本不会出现在面板里）
    const mainPrompt = el('textarea', {
        class: 'text_pole roleEx-textarea',
        id: 'roleEx-journal-main-prompt',
        rows: '8',
    });
    mainPrompt.value = settings.journalMainPrompt;
    mainPrompt.addEventListener('input', debounce(() => updateSetting('journalMainPrompt', mainPrompt.value), 400));

    const promptSection = section('日记主提示词（可自由修改）', { open: false });
    iconFor(promptSection.root, 'fa-solid fa-wand-magic-sparkles');
    promptSection.content.append(
        el('div', { class: 'roleEx-hint', html: '变量：<code>{{chatRange}}</code> 参考聊天、<code>{{journalRefs}}</code> 参考日记、<code>{{stateList}}</code> 状态；<code>{{char}}</code>/<code>{{user}}</code> 走酒馆宏。' }),
        mainPrompt,
        el('div', { class: 'roleEx-row roleEx-gap' }, [
            el('div', {
                class: 'menu_button roleEx-btn-sm', text: '恢复默认', onclick: () => {
                    mainPrompt.value = DEFAULT_SETTINGS.journalMainPrompt;
                    updateSetting('journalMainPrompt', mainPrompt.value);
                    toast('success', '已恢复默认主提示词。');
                },
            }),
        ]),
    );
    s.content.append(promptSection.root);

    return { section: s, floorSummary, injectJournalToggle };
}

function checkboxRow(input, label, hint) {
    const id = `${MODULE_NAME}-${Math.random().toString(36).slice(2, 7)}`;
    input.id = id;
    const wrap = el('label', { class: 'roleEx-checkbox-row', for: id }, [
        input,
        el('div', { class: 'roleEx-checkbox-text' }, [
            el('span', { class: 'roleEx-checkbox-label', text: label }),
            hint ? el('span', { class: 'roleEx-hint', text: hint }) : null,
        ]),
    ]);
    return wrap;
}

function renderFloors() {
    const box = document.getElementById('roleEx-floors');
    const summary = document.getElementById('roleEx-floor-summary');
    if (!box) {
        return;
    }
    const rows = listFloors();
    // 清掉已不存在的选择
    const valid = new Set(rows.map(r => r.index));
    for (const i of Array.from(ui.selectedFloors)) {
        if (!valid.has(i)) {
            ui.selectedFloors.delete(i);
        }
    }
    box.innerHTML = '';
    if (!rows.length) {
        box.appendChild(el('div', { class: 'roleEx-hint', text: '当前没有可用的聊天楼层。' }));
    } else {
        for (const row of rows) {
            const cb = el('input', { type: 'checkbox' });
            cb.checked = ui.selectedFloors.has(row.index);
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    ui.selectedFloors.add(row.index);
                } else {
                    ui.selectedFloors.delete(row.index);
                }
                updateFloorSummary();
            });
            const node = el('label', { class: `roleEx-floor ${row.isUser ? 'roleEx-floor-user' : 'roleEx-floor-char'}` }, [
                cb,
                el('span', { class: 'roleEx-floor-idx', text: `#${row.index}` }),
                el('span', { class: 'roleEx-floor-name', text: row.name }),
                el('span', { class: 'roleEx-floor-text', text: row.preview }),
            ]);
            box.appendChild(node);
        }
    }
    updateFloorSummary();
}

function updateFloorSummary() {
    const summary = document.getElementById('roleEx-floor-summary');
    if (summary) {
        const picked = Array.from(ui.selectedFloors).sort((a, b) => a - b);
        summary.textContent = picked.length
            ? `已选 ${picked.length} 楼：${picked.slice(0, 12).join(', ')}${picked.length > 12 ? ' …' : ''}`
            : '已选 0 楼';
    }
    const hint = document.getElementById('roleEx-storage-hint');
    if (hint) {
        renderJournalStorageHint();
    }
}

function renderJournalList() {
    const list = document.getElementById('roleEx-journal-list');
    if (!list) {
        return;
    }
    list.innerHTML = '';
    if (!ui.journal.length) {
        list.appendChild(el('div', { class: 'roleEx-hint', text: '本会话还没有日记。' }));
    }
    const sorted = [...ui.journal].sort((a, b) => b.createdAt - a.createdAt);
    for (const entry of sorted) {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = ui.selectedJournalIds.has(entry.id);
        cb.addEventListener('change', () => {
            if (cb.checked) {
                ui.selectedJournalIds.add(entry.id);
            } else {
                ui.selectedJournalIds.delete(entry.id);
            }
            onJournalSelectionChanged();
        });

        const actions = el('div', { class: 'roleEx-entry-actions' }, [
            el('div', {
                class: 'menu_button roleEx-btn-xs', title: '编辑', text: '编辑',
                onclick: () => editJournalEntry(entry),
            }),
            el('div', {
                class: 'menu_button roleEx-btn-xs', title: '只勾选这一篇并写入预设卡片',
                text: '仅此篇', onclick: () => {
                    ui.selectedJournalIds = new Set([entry.id]);
                    onJournalSelectionChanged();
                    renderJournalList();
                    toast('success', `已改为只插入：${entry.title}`);
                },
            }),
            el('div', {
                class: 'menu_button roleEx-btn-xs', title: '单篇导出', text: '导出',
                onclick: () => downloadText(`${safeName(entry.title)}.jsonl`, `${encodeLine(entry)}\n`),
            }),
            el('div', {
                class: 'menu_button roleEx-btn-xs roleEx-danger', title: '删除', text: '删除',
                onclick: () => deleteJournalEntries([entry.id]),
            }),
        ]);

        const node = el('div', { class: `roleEx-entry ${ui.selectedJournalIds.has(entry.id) ? 'roleEx-entry-selected' : ''}` }, [
            el('div', { class: 'roleEx-entry-head' }, [
                cb,
                el('span', { class: 'roleEx-entry-title', text: entry.title || '(无标题)' }),
                el('span', { class: 'roleEx-entry-time', text: formatTime(entry.createdAt) }),
            ]),
            el('div', { class: 'roleEx-entry-body', text: textPreview(entry.content, 140) }),
            el('div', { class: 'roleEx-entry-foot' }, [
                el('span', { class: 'roleEx-hint', text: `${entry.content.length} 字 · 参考 ${entry.sourceMessageIds?.length || 0} 楼` }),
                actions,
            ]),
        ]);
        list.appendChild(node);
    }
    updateFloorSummary();
    updatePresetCardHint();
}

function renderJournalStorageHint() {
    const hint = document.getElementById('roleEx-storage-hint');
    if (!hint) {
        return;
    }
    const identity = ui.identity || currentChatIdentity();
    hint.textContent = `${ui.journal.length} 篇 · ${ui.selectedJournalIds.size} 篇已勾选`
        + `\n${identity.charDir} / ${identity.chatFile} · user/files/${identity.fileName}`;
    hint.style.whiteSpace = 'pre-line';
}

/** 预设卡片状态提示 */
function updatePresetCardHint() {
    const hint = document.getElementById('roleEx-preset-card-hint');
    if (!hint) {
        return;
    }
    const pm = getPromptManager();
    // 三种「读不到管理器」要分开讲，否则无从排查：
    //   a) 补丁是旧版 → getContext() 里没有 promptManager（需要重新应用补丁）
    //   b) 当前接口不是 Chat Completion → 管理器尚未建立
    if (!isPromptManagerExposed()) {
        hint.textContent = '状态：读取不到提示词管理器 —— ST 补丁为旧版'
            + '（未把 promptManager 暴露到 getContext()）。'
            + '请重新应用 patches/st-marker-prompt.patch 并 Ctrl+F5 强制刷新。';
        hint.style.whiteSpace = 'pre-line';
        return;
    }
    if (!pm || !pm.serviceSettings || typeof pm.getPromptById !== 'function') {
        hint.textContent = '状态：提示词管理器尚未就绪（需要选中 Chat Completion 类接口）。';
        hint.style.whiteSpace = 'pre-line';
        return;
    }
    const exists = !!pm.getPromptById(PRESET_PROMPT.ID);
    const preset = currentPresetName() || '(未识别预设)';
    const probe = probeStPatch();
    // 「卡片有没有开关/铅笔」完全取决于这两处放行；分开报告，避免"时有时无"的错觉
    const patchLine = (probe.patchedToggle && probe.patchedEdit)
        ? '权限：PromptManager 已放行（开关 + 铅笔应当可见）'
        : `权限：缺失！toggle=${probe.patchedToggle} / edit=${probe.patchedEdit} —— `
            + '浏览器里跑的 PromptManager.js 是旧版，Ctrl+F5 强制刷新；仍不行就是补丁没应用全。';
    const shape = supportsMarkerPromptCard()
        ? 'marker=true（正文由扩展的运行时源提供）'
        : 'registerRuntimePromptSource 不存在 → 卡片拿不到正文（补丁未生效）';
    if (!exists) {
        hint.textContent = `状态：预设「${preset}」里没有这张卡片。\n`
            + `本扩展不再自动创建卡片 —— 请在预设 JSON 里加入下面这一条（详见 README 3.3）：\n`
            + `  prompts:     { "identifier": "${PRESET_PROMPT.ID}", "name": "${PRESET_PROMPT.NAME}", "system_prompt": true, "marker": true }\n`
            + `  prompt_order（每个块都要加）: { "identifier": "${PRESET_PROMPT.ID}", "enabled": true }\n`
            + `位置建议紧跟在 "worldInfoAfter" 之后。\n`
            + patchLine;
        hint.style.whiteSpace = 'pre-line';
        return;
    }
    const enabled = isJournalCardEnabledInPreset();
    // 权限正确 ≠ 屏幕上这一行是用带授权的代码渲染出来的 —— 分开报告
    const controls = probeCardControls();
    let controlsLine;
    if (!controls.listRendered) {
        controlsLine = '控件：预设列表尚未渲染（切到 Chat Completion 类接口后会自动出现）';
    } else if (controls.edit && controls.toggle) {
        controlsLine = '控件：铅笔 + 开关已在该行显示';
    } else if (!controls.found) {
        controlsLine = '控件：列表里没找到这一行（卡片可能没插进当前 prompt_order 块）';
    } else {
        controlsLine = `控件：该行缺少${controls.edit ? '' : ' 铅笔'}${controls.toggle ? '' : ' 开关'}`
            + '（首屏渲染时机问题，扩展已自动补渲染；仍缺失就 Ctrl+F5 或点一下卡片）';
    }
    // 预览列表：补丁已让 handleInspect 支持按需构建，所以这里只做信息展示
    const hasInspectable = !!pm.messages?.hasItemWithIdentifier?.(PRESET_PROMPT.ID);
    hint.textContent = `状态：${enabled ? '● 已启用（注入中）' : '○ 已停用（不注入）'}`
        + `\n预设「${preset}」· 标识 ${PRESET_PROMPT.ID} · 位置与开关都在预设 UI 里管理`
        + `\n形态：${shape}`
        + `\n${patchLine}`
        + `\n${controlsLine}`
        + `\n预览：${hasInspectable
            ? '已注入过 —— 点预设里卡片的名字可查看本次内容'
            : '点预设里卡片的名字即可查看（补丁支持即时构建预览）'}`
        + (enabled ? '' : '\n要重新启用：在预设 UI 里打开这张卡片的开关');
    hint.style.whiteSpace = 'pre-line';
}

function editJournalEntry(entry) {
    const dialog = el('div', { class: 'roleEx-modal' });
    const title = el('input', { type: 'text', class: 'text_pole', value: entry.title || '' });
    const body = el('textarea', { class: 'text_pole roleEx-textarea', rows: '14' });
    body.value = entry.content;
    const close = () => dialog.remove();
    dialog.append(
        el('div', { class: 'roleEx-modal-inner' }, [
            el('div', { class: 'roleEx-modal-head' }, [
                el('span', { text: `编辑日记 ${entry.title || ''}` }),
                el('i', { class: 'fa-solid fa-xmark menu_button roleEx-btn-xs', onclick: close }),
            ]),
            el('div', { class: 'roleEx-label', text: '标题' }),
            title,
            el('div', { class: 'roleEx-label', text: '正文' }),
            body,
            el('div', { class: 'roleEx-row roleEx-gap roleEx-end' }, [
                el('div', { class: 'menu_button', text: '取消', onclick: close }),
                el('div', {
                    class: 'menu_button', text: '保存', onclick: async () => {
                        entry.title = title.value.trim() || entry.title;
                        entry.content = body.value;
                        entry.updatedAt = Date.now();
                        await persistJournal();
                        renderJournalList();
                        close();
                        toast('success', '已保存。');
                    },
                }),
            ]),
        ]),
    );
    document.body.appendChild(dialog);
}

async function deleteJournalEntries(ids) {
    const set = new Set(ids);
    const targets = ui.journal.filter(e => set.has(e.id));
    if (!targets.length) {
        return;
    }
    if (!globalThis.confirm(`确定删除 ${targets.length} 篇日记？此操作不可撤销。`)) {
        return;
    }
    ui.journal = ui.journal.filter(e => !set.has(e.id));
    for (const id of set) {
        ui.selectedJournalIds.delete(id);
    }
    await persistJournal();
    renderJournalList();
    renderJournalStorageHint();
    toast('success', `已删除 ${targets.length} 篇。`);
}

function deleteSelectedJournals() {
    if (!ui.selectedJournalIds.size) {
        toast('info', '没有勾选任何日记。');
        return;
    }
    deleteJournalEntries(Array.from(ui.selectedJournalIds));
}

// ---- 导入 / 导出（均为 jsonl，以会话为单位） ----

function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'application/x-ndjson;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportJournalFile(onlySelected) {
    const entries = onlySelected ? pickedJournals() : ui.journal;
    if (!entries.length) {
        toast('info', onlySelected ? '没有勾选任何日记。' : '本会话没有日记可导出。');
        return;
    }
    const identity = ui.identity || currentChatIdentity();
    const lines = [encodeLine({
        __roleExpansion: 'session',
        version: 1,
        chatId: identity.id,
        charDir: identity.charDir,
        chatFile: identity.chatFile,
        exportedAt: Date.now(),
        count: entries.length,
    }), ...entries.map(encodeLine)];
    // 导出名也用纯 ASCII：避免用户把导出的中文名文件再拖回 files/ 目录时触发同样的校验
    const name = `${slugForFile(identity.charDir, 24)}__${slugForFile(identity.chatFile, 24)}__${stampForFileName()}.jsonl`;
    downloadText(name, `${lines.join('\n')}\n`);
    toast('success', `已导出 ${entries.length} 篇日记。`);
}

function importJournalFile() {
    const picker = el('input', { type: 'file', accept: '.jsonl,.json,.txt' });
    picker.style.display = 'none';
    picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        picker.remove();
        if (!file) {
            return;
        }
        const text = await file.text();
        const parsed = parseJsonl(text);
        if (!parsed.entries.length) {
            toast('warning', '未从文件中解析到任何日记。');
            return;
        }
        const mode = globalThis.confirm(
            `解析到 ${parsed.entries.length} 篇日记。\n\n确定 = 追加到当前会话\n取消 = 覆盖当前会话的日记`,
        ) ? 'append' : 'replace';
        const existingIds = new Set(ui.journal.map(e => e.id));
        const incoming = parsed.entries.map(e => {
            if (existingIds.has(e.id)) {
                e.id = uid();
            }
            return e;
        });
        ui.journal = mode === 'replace' ? incoming : [...ui.journal, ...incoming];
        await persistJournal();
        renderJournalList();
        renderJournalStorageHint();
        toast('success', `已导入 ${incoming.length} 篇日记（${mode === 'replace' ? '覆盖' : '追加'}）。`);
    });
    document.body.appendChild(picker);
    picker.click();
}

// ============================================================================
// UI：状态栏
// ============================================================================

function buildStatePanel() {
    const s = section('角色状态栏', { open: true });
    s.root.setAttribute('id', 'roleEx-state-section');
    iconFor(s.root, 'fa-solid fa-heart-pulse');

    const enableToggle = el('input', { type: 'checkbox' });
    enableToggle.checked = settings.stateEnabled !== false;
    enableToggle.addEventListener('change', () => {
        updateSetting('stateEnabled', enableToggle.checked);
        applyStateInjection();
    });

    const injectToggle = el('input', { type: 'checkbox' });
    injectToggle.checked = settings.stateAutoInject !== false;
    injectToggle.addEventListener('change', () => {
        updateSetting('stateAutoInject', injectToggle.checked);
        applyStateInjection();
    });

    const stripToggle = el('input', { type: 'checkbox' });
    stripToggle.checked = settings.stateStripTags !== false;
    stripToggle.addEventListener('change', () => updateSetting('stateStripTags', stripToggle.checked));

    const journalLinkToggle = el('input', { type: 'checkbox' });
    journalLinkToggle.checked = settings.stateIncludeInJournal !== false;
    journalLinkToggle.addEventListener('change', () => updateSetting('stateIncludeInJournal', journalLinkToggle.checked));

    // 标签准入：默认只接受状态列表里已有的名称（模型只负责改值，不负责发明状态）
    const knownOnlyToggle = el('input', { type: 'checkbox' });
    knownOnlyToggle.checked = settings.stateOnlyKnownNames !== false;
    knownOnlyToggle.addEventListener('change', () => updateSetting('stateOnlyKnownNames', knownOnlyToggle.checked));

    const list = el('div', { class: 'roleEx-list' });
    list.id = 'roleEx-state-list';

    const input = el('textarea', {
        class: 'text_pole roleEx-textarea', rows: '3',
        placeholder: '每行输入「状态名 值」，例如：生命值 8/10',
    });

    const addBtn = el('div', {
        class: 'menu_button roleEx-btn', text: '添加 / 更新',
        onclick: () => {
            const text = input.value;
            if (!text.trim()) {
                return;
            }
            let modified = 0;
            for (const line of splitLines(text)) {
                const trimmed = line.trim();
                if (!trimmed) {
                    continue;
                }
                const parts = trimmed.split(/\s+/);
                if (parts.length < 2) {
                    continue;
                }
                const name = parts[0];
                const value = parts.slice(1).join(' ');
                const items = getStateList();
                const existing = items.find(it => it.name === name);
                if (existing) {
                    existing.value = value;
                } else {
                    items.push({ name, value });
                }
                modified += 1;
            }
            if (modified) {
                input.value = '';
                saveMeta();
                renderStateList();
                applyStateInjection();
                toast('success', `已更新 ${modified} 个状态项。`);
            } else {
                toast('warning', '没有解析到有效行（格式：状态名 值）。');
            }
        },
    });

    const clearBtn = el('div', {
        class: 'menu_button roleEx-btn-sm roleEx-danger', text: '清空全部',
        onclick: () => {
            if (!getStateList().length) {
                return;
            }
            if (!globalThis.confirm('确定清空当前会话的全部状态项？')) {
                return;
            }
            getStateList().length = 0;
            saveMeta();
            renderStateList();
            applyStateInjection();
        },
    });

    const exportBtn = el('div', {
        class: 'menu_button roleEx-btn-sm', text: '复制为文本',
        onclick: async () => {
            const text = buildStateText();
            if (!text) {
                toast('info', '当前没有状态项。');
                return;
            }
            try {
                await navigator.clipboard.writeText(`角色状态：\n${text}\n`);
                toast('success', '状态文本已复制到剪贴板。');
            } catch (e) {
                globalThis.prompt('请手动复制以下内容：', `角色状态：\n${text}\n`);
            }
        },
    });

    const importBtn = el('div', {
        class: 'menu_button roleEx-btn-sm', text: '从文本导入',
        onclick: async () => {
            try {
                const clip = await navigator.clipboard.readText();
                if (!clip) {
                    toast('warning', '剪贴板没有内容。');
                    return;
                }
                input.value = clip;
                toast('info', '已粘贴到输入框，请点击「添加 / 更新」。');
            } catch (e) {
                toast('warning', '无法读取剪贴板，请手动粘贴到输入框。');
            }
        },
    });

    s.content.append(
        el('div', { class: 'roleEx-block' }, [
            checkboxRow(enableToggle, '启用角色状态栏', '关闭后停止注入与标签解析'),
            checkboxRow(injectToggle, '发送前注入状态提示', '使用下方可自由修改的提示词模板'),
            checkboxRow(stripToggle, '从聊天消息中剥离状态标签', '关闭后标签仍用于更新数据，但会留在正文里'),
            checkboxRow(journalLinkToggle, '状态并入日记生成提示', '生成日记时把当前状态作为参考'),
            checkboxRow(knownOnlyToggle, '只接受已知状态名（推荐）', '模型只更新状态列表里已有的项；关闭后，回复里的新 <名称>值</名称> 会自动加进列表'),
        ]),
        el('div', { class: 'roleEx-block' }, [
            el('div', { class: 'roleEx-label', text: '状态列表（随会话保存）' }),
            list,
            el('div', { class: 'roleEx-row roleEx-gap roleEx-wrap' }, [clearBtn, exportBtn, importBtn]),
            el('div', { class: 'roleEx-label', text: '批量添加' }),
            input,
            el('div', { class: 'roleEx-row roleEx-gap' }, [addBtn]),
        ]),
    );

    // 注入提示词模板（可自由修改）—— 作为「角色状态栏」面板内部的子区块
    const tpl = el('textarea', { class: 'text_pole roleEx-textarea', id: 'roleEx-state-inject-prompt', rows: '7' });
    tpl.value = settings.stateInjectPrompt;
    tpl.addEventListener('input', debounce(() => {
        updateSetting('stateInjectPrompt', tpl.value);
        applyStateInjection();
    }, 400));

    const depthInput = el('input', { type: 'number', class: 'text_pole roleEx-num', min: '0', max: '100', value: String(settings.stateInjectDepth ?? 0) });
    depthInput.addEventListener('change', () => {
        updateSetting('stateInjectDepth', Math.max(0, Number(depthInput.value) || 0));
        applyStateInjection();
    });

    const roleSelect = el('select', { class: 'text_pole roleEx-num' });
    for (const [value, label] of [['system', 'system'], ['user', 'user'], ['assistant', 'assistant']]) {
        const opt = el('option', { value, text: label });
        if ((settings.stateInjectRole || 'system') === value) {
            opt.selected = true;
        }
        roleSelect.appendChild(opt);
    }
    roleSelect.addEventListener('change', () => {
        updateSetting('stateInjectRole', roleSelect.value);
        applyStateInjection();
    });

    const tplSection = section('状态注入提示词', { open: false });
    tplSection.root.setAttribute('id', 'roleEx-state-tpl-section');
    iconFor(tplSection.root, 'fa-solid fa-wand-magic-sparkles');
    tplSection.content.append(
        el('div', { class: 'roleEx-hint', html: '可用变量：<code>{{stateList}}</code> 会被替换为「名称 值」多行列表。' }),
        tpl,
        el('div', { class: 'roleEx-row roleEx-gap roleEx-vcenter' }, [
            el('span', { class: 'roleEx-hint', text: '注入深度' }),
            depthInput,
            el('span', { class: 'roleEx-hint', text: '注入角色' }),
            roleSelect,
            el('div', {
                class: 'menu_button roleEx-btn-sm', text: '恢复默认', onclick: () => {
                    tpl.value = DEFAULT_SETTINGS.stateInjectPrompt;
                    updateSetting('stateInjectPrompt', tpl.value);
                    applyStateInjection();
                    toast('success', '已恢复默认状态提示词。');
                },
            }),
        ]),
    );

    // 挂进 content（而不是 section root）：这样它是「角色状态栏」正文里的一员，
    // 走和外层一致的 10px 间距排列，视觉上明确属于这个面板。
    s.content.append(tplSection.root);
    return s;
}

function renderStateList() {
    const list = document.getElementById('roleEx-state-list');
    if (!list) {
        return;
    }
    list.innerHTML = '';
    const items = getStateList();
    if (!items.length) {
        list.appendChild(el('div', { class: 'roleEx-hint', text: '当前没有状态项。可在下方按「名称 值」批量添加。' }));
        return;
    }
    items.forEach((item, idx) => {
        const nameEl = el('span', { class: 'roleEx-state-name', text: item.name });
        const valueEl = el('span', { class: 'roleEx-state-value', text: item.value });
        const nameInput = el('input', { type: 'text', class: 'text_pole roleEx-state-edit', value: item.name });
        const valueInput = el('input', { type: 'text', class: 'text_pole roleEx-state-edit', value: item.value });
        nameInput.style.display = 'none';
        valueInput.style.display = 'none';

        const startEdit = () => {
            nameEl.style.display = 'none';
            valueEl.style.display = 'none';
            nameInput.style.display = '';
            valueInput.style.display = '';
            saveBtn.style.display = '';
            cancelBtn.style.display = '';
            editBtn.style.display = 'none';
            delBtn.style.display = 'none';
        };
        const stopEdit = () => {
            nameEl.style.display = '';
            valueEl.style.display = '';
            nameInput.style.display = 'none';
            valueInput.style.display = 'none';
            saveBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
            editBtn.style.display = '';
            delBtn.style.display = '';
        };

        const saveBtn = el('div', {
            class: 'menu_button roleEx-btn-xs', text: '保存', onclick: () => {
                const newName = nameInput.value.trim();
                if (!newName) {
                    toast('warning', '名称不能为空。');
                    return;
                }
                const conflict = items.find((it, i) => i !== idx && it.name === newName);
                if (conflict) {
                    toast('warning', '已有同名状态项。');
                    return;
                }
                item.name = newName;
                item.value = valueInput.value.trim();
                saveMeta();
                renderStateList();
                applyStateInjection();
            },
        });
        const cancelBtn = el('div', { class: 'menu_button roleEx-btn-xs', text: '取消', onclick: () => renderStateList() });
        const editBtn = el('div', { class: 'menu_button roleEx-btn-xs', text: '编辑', onclick: startEdit });
        const delBtn = el('div', {
            class: 'menu_button roleEx-btn-xs roleEx-danger', text: '删除', onclick: () => {
                items.splice(idx, 1);
                saveMeta();
                renderStateList();
                applyStateInjection();
            },
        });
        saveBtn.style.display = 'none';
        cancelBtn.style.display = 'none';

        list.appendChild(el('div', { class: 'roleEx-state-row' }, [
            nameEl, valueEl, nameInput, valueInput, saveBtn, cancelBtn, editBtn, delBtn,
        ]));
    });
}

function setButtonBusy(busy) {
    const btn = document.getElementById('roleEx-generate-journal');
    if (!btn) {
        return;
    }
    btn.classList.toggle('roleEx-busy', !!busy);
    btn.textContent = busy ? '生成中…' : '生成日记';
}

// ============================================================================
// UI：顶部抽屉 / 主面板 / 角色面板入口
//
// 布局说明（对齐酒馆原生做法）：
//   - 工具栏按钮：与其它入口一致，手写 .drawer > .drawer-toggle/.drawer-content 结构，
//     插进 #top-settings-holder，位置在 World Info 与 User Settings 之间。
//   - 主面板：普通下拉面板形态（与 #WorldInfo 同款），挂在 #movingDivs 里，
//     顶部紧贴工具栏居中，宽度 --sheldWidth、最大高度到输入框上方；
//     #movingDivs > div 自带 z-index 4000，高于 #left-nav-panel / #right-nav-panel 的 3000。
// ============================================================================

/** 面板最大高度的兜底值（拿不到视口高度时用） */
const PANEL_MAX_HEIGHT_FALLBACK = 620;

function insertDrawer() {
    const holder = document.getElementById('top-settings-holder');
    if (!holder) {
        return false;
    }
    document.getElementById(ID.drawer)?.remove();
    document.getElementById(ID.content)?.remove();

    const icon = el('div', {
        class: 'drawer-icon fa-solid fa-feather-pointed fa-fw closedIcon interactable',
        title: '角色扩展',
        tabindex: '0',
        role: 'button',
    });
    const toggle = el('div', { class: 'drawer-toggle drawer-header' }, [icon]);

    // 真实内容容器：和 #WorldInfo 一样是 .drawer-content，挂在 #movingDivs 下
    const content = el('div', { class: 'drawer-content closedDrawer roleEx-panel', id: ID.content });
    content.innerHTML = `
        <div class="roleEx-panel-head">
            <div class="roleEx-panel-title-box">
                <span class="roleEx-panel-title">角色扩展</span>
                <span class="roleEx-panel-sub">日记 · 状态栏</span>
            </div>
            <div class="roleEx-panel-pin" title="锁定：打开其它面板时不再自动关闭">
                <input type="checkbox" id="roleEx-panel-pin">
                <label for="roleEx-panel-pin">
                    <span class="fa-solid fa-unlock roleEx-pin-off"></span>
                    <span class="fa-solid fa-lock roleEx-pin-on"></span>
                </label>
            </div>
            <div class="roleEx-panel-close fa-solid fa-circle-xmark" title="关闭"></div>
        </div>
        <div class="roleEx-scroll" id="roleEx-scroll"></div>
    `;

    const drawer = el('div', { class: 'drawer roleEx-top-drawer', id: ID.drawer }, [toggle]);

    const wi = document.getElementById('WI-SP-button');
    if (wi && wi.parentElement === holder) {
        wi.insertAdjacentElement('afterend', drawer);
    } else {
        const userSettings = document.getElementById('user-settings-button');
        if (userSettings && userSettings.parentElement === holder) {
            holder.insertBefore(drawer, userSettings);
        } else {
            holder.appendChild(drawer);
        }
    }

    const movingDivs = document.getElementById('movingDivs') || document.body;
    movingDivs.appendChild(content);

    ui.drawerEl = drawer;
    ui.contentEl = content;
    ui.panelEl = content;

    const scroll = q('#roleEx-scroll', content);
    if (!scroll) {
        logError('panel container #roleEx-scroll not found, aborting drawer insertion');
        drawer.remove();
        content.remove();
        return false;
    }
    const journalPanel = buildJournalPanel();
    const statePanel = buildStatePanel();
    // 「关于」已并入日记面板的存储说明里（不再单独占一个折叠面板）
    scroll.append(journalPanel.section.root, statePanel.root);

    // 关键：酒馆用的是 $('.drawer-toggle').on('click', doNavbarIconClick) —— 直接绑定，
    // 没有事件委托，而本抽屉是之后才插入 DOM 的，所以原生处理器不会认这张新抽屉。
    // 这里自己绑一次点击，并复用酒馆的开关逻辑（它会顺手关掉其他非 pin 的抽屉）。
    const onToggleClick = (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        toggleDrawerState();
    };
    toggle.addEventListener('click', onToggleClick);
    icon.addEventListener('click', onToggleClick);
    icon.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleDrawerState();
        }
    });

    const pinInput = q('#roleEx-panel-pin', content);
    if (pinInput) {
        pinInput.checked = ui.panelPinned;
        pinInput.addEventListener('change', () => {
            ui.panelPinned = pinInput.checked;
            content.classList.toggle('pinnedOpen', ui.panelPinned);
        });
    }

    content.querySelector('.roleEx-panel-close')?.addEventListener('click', () => {
        if (ui.panelOpen) {
            toggleDrawerState();
        }
    });

    // 点空白处关闭（未锁定时）
    if (!ui.outsideClickBound) {
        ui.outsideClickBound = true;
        document.addEventListener('mousedown', (e) => {
            if (!ui.panelOpen || ui.panelPinned) {
                return;
            }
            const target = e.target;
            if (content.contains(target) || document.getElementById(ID.drawer)?.contains(target)) {
                return;
            }
            toggleDrawerState();
        }, true);
    }

    // 让酒馆的抽屉状态变化（比如点了别的图标）也能同步我们的面板
    const observer = new MutationObserver(() => {
        syncPanelWithDrawerState();
    });
    observer.observe(content, { attributes: true, attributeFilter: ['class'] });

    layoutMainPanel();
    window.addEventListener?.('resize', layoutMainPanel);

    return true;
}

/**
 * 计算面板的宽度与最大高度（普通下拉面板：顶部紧贴工具栏居中，延伸到输入框上方）。
 * 水平位置交给 CSS（left/right: 0 + margin: auto），这里只调尺寸。
 */
function layoutMainPanel() {
    const panel = ui.panelEl;
    if (!panel) {
        return;
    }
    const root = document.documentElement;
    const readVar = (name) => {
        try {
            return getComputedStyle(root).getPropertyValue(name).trim();
        } catch (e) {
            return '';
        }
    };
    const sheldWidth = readVar('--sheldWidth');
    const topBar = readVar('--topBarBlockSize');
    const bottomBar = readVar('--bottomFormBlockSize');
    const vh = window.innerHeight || root?.clientHeight || 0;

    if (sheldWidth) {
        panel.style.width = sheldWidth;
    }
    const topPx = parseFloat(topBar);
    const bottomPx = parseFloat(bottomBar);
    if (vh && Number.isFinite(topPx) && Number.isFinite(bottomPx)) {
        panel.style.maxHeight = `${Math.max(240, Math.round(vh - topPx - bottomPx - 8))}px`;
    } else if (vh) {
        panel.style.maxHeight = `${Math.max(240, Math.round(vh - 120))}px`;
    } else {
        panel.style.maxHeight = `${PANEL_MAX_HEIGHT_FALLBACK}px`;
    }
    // 与角色管理面板同时打开时靠 z-index（4000 > 3000）压在上面
    const charPanelOpen = document.getElementById('right-nav-panel')?.classList.contains('openDrawer') ?? false;
    panel.classList.toggle('roleEx-panel-over-nav', charPanelOpen);
}

/** 把酒馆抽屉的开关状态同步到面板（点其它图标关掉我们时也要跟着关） */
function syncPanelWithDrawerState() {
    const content = document.getElementById(ID.content);
    const panel = ui.panelEl;
    if (!content || !panel) {
        return;
    }
    const drawerOpen = content.classList.contains('openDrawer');
    if (drawerOpen === ui.panelOpen) {
        return;
    }
    ui.panelOpen = drawerOpen;
    panel.classList.toggle('openDrawer', drawerOpen);
    panel.classList.toggle('closedDrawer', !drawerOpen);
    if (drawerOpen) {
        onPanelOpened();
    }
}

/**
 * 切换本抽屉的开关状态。
 * 优先调用酒馆的 doNavbarIconClick（它会顺手收起角色管理等其他抽屉）；
 * 该函数在 1.18 的 getContext() 里并不存在，所以拿不到时就用等价的内置实现。
 * 关键是保证按钮一定有反应。
 */
function toggleDrawerState() {
    const toggle = document.getElementById(ID.drawer)?.querySelector('.drawer-toggle');
    const content = document.getElementById(ID.content);
    const panel = ui.panelEl;
    const icon = toggle?.querySelector('.drawer-icon');
    if (!content || !panel) {
        return;
    }
    const wasOpen = content.classList.contains('openDrawer');

    const navbarClick = ctx()?.doNavbarIconClick;
    if (toggle && typeof navbarClick === 'function') {
        try {
            navbarClick.call(toggle);
        } catch (e) {
            logError('doNavbarIconClick failed, falling back', e);
        }
    }

    // 原生调用可能因动画延迟才落 class；这里做一次同步兜底，确保状态一定翻转
    const nowOpen = content.classList.contains('openDrawer');
    if (nowOpen === wasOpen) {
        content.classList.toggle('closedDrawer', wasOpen);
        content.classList.toggle('openDrawer', !wasOpen);
        if (icon) {
            icon.classList.toggle('closedIcon', wasOpen);
            icon.classList.toggle('openIcon', !wasOpen);
        }
    }

    // 顺手关掉其他未固定的抽屉，保证本面板显示优先级更高
    if (!wasOpen) {
        try {
            document.querySelectorAll('.openDrawer:not(.pinnedOpen)').forEach((elm) => {
                if (elm === content || elm === panel) {
                    return;
                }
                elm.classList.remove('openDrawer');
                elm.classList.add('closedDrawer');
                const drawerRoot = elm.closest?.('.drawer');
                drawerRoot?.querySelectorAll?.('.drawer-icon.openIcon').forEach((ic) => {
                    ic.classList.remove('openIcon');
                    ic.classList.add('closedIcon');
                });
            });
        } catch (e) {
            logError('closing other drawers failed', e);
        }
    }

    const open = content.classList.contains('openDrawer');
    panel.classList.toggle('openDrawer', open);
    panel.classList.toggle('closedDrawer', !open);
    panel.style.display = open ? 'flex' : 'none';

    if (open !== ui.panelOpen) {
        ui.panelOpen = open;
        if (open) {
            layoutMainPanel();
            onPanelOpened();
        }
    }
}

async function onPanelOpened() {
    renderFloors();
    await reloadJournal();
    renderStateList();
    // 卡片由用户维护；这里只确保运行时源已注册并刷新状态文案
    ensureRuntimePromptSource();
    adoptCardStateFromPreset();
    updatePresetCardHint();
    layoutMainPanel();
}

function insertCharacterPanelButton() {
    const anchor = document.querySelector('#avatar_controls .chat_lorebook_button');
    if (!anchor) {
        return false;
    }
    document.getElementById(ID.charButton)?.remove();
    const btn = el('div', {
        id: ID.charButton,
        class: 'menu_button fa-solid fa-feather-pointed',
        title: '角色扩展（日记 / 状态栏）',
        onclick: () => openPanel(),
    });
    anchor.insertAdjacentElement('afterend', btn);
    return true;
}

function openPanel() {
    const content = document.getElementById(ID.content);
    if (!content) {
        return;
    }
    if (content.classList.contains('openDrawer')) {
        onPanelOpened();
        return;
    }
    toggleDrawerState();
}

// ============================================================================
// 扩展设置面板（酒馆「扩展」列表里的配置项）
// ============================================================================

async function initExtensionSettingsPanel(attempt = 0) {
    const container = document.getElementById('extensions_settings');
    if (!container) {
        if (attempt < 8) {
            setTimeout(() => initExtensionSettingsPanel(attempt + 1), 500);
        }
        return;
    }
    document.getElementById(ID.settingsRoot)?.remove();

    const renderTemplate = ctx()?.renderExtensionTemplateAsync;
    if (typeof renderTemplate !== 'function') {
        return;
    }

    let html = '';
    for (const base of [`third-party/${MODULE_NAME}`, MODULE_NAME]) {
        try {
            const result = await renderTemplate(base, 'index');
            if (result) {
                html = result;
                break;
            }
        } catch (e) {
            /* try next base */
        }
    }
    if (!html) {
        return;
    }

    container.insertAdjacentHTML('beforeend', html);
    const root = document.getElementById(ID.settingsRoot);
    if (!root) {
        return;
    }

    const openBtn = root.querySelector('#roleEx-setting-open');
    openBtn?.addEventListener('click', () => openPanel());

    const journalHint = root.querySelector('#roleEx-setting-journal-state');
    if (journalHint) {
        const exists = !!getPromptManager()?.getPromptById?.(PRESET_PROMPT.ID);
        journalHint.textContent = exists
            ? `日记卡片：${isJournalCardEnabledInPreset() ? '已启用（注入中）' : '已停用（不注入）'} —— 开关在预设 UI 的卡片上`
            : '日记卡片：预设里没有这张卡片 —— 本扩展只提供正文，卡片需要按 README 3.3 手动写进预设 JSON';
    }

    // 补丁检测：让「有没有打 ST 补丁」一眼可见，避免猜
    const patchHint = root.querySelector('#roleEx-setting-patch-state');
    if (patchHint) {
        const marker = supportsMarkerPromptCard();
        patchHint.textContent = marker
            ? '预设卡片补丁：已生效（卡片为 marker:true，自带启停开关与编辑铅笔 / Prompt List 预览）'
            : '预设卡片补丁：未生效 —— 卡片会退化成普通卡片；需要重新应用 patches/st-marker-prompt.patch 并刷新页面（Ctrl+F5）';
    }

    const stateToggle = root.querySelector('#roleEx-setting-state-enable');
    if (stateToggle) {
        stateToggle.checked = settings.stateEnabled !== false;
        stateToggle.addEventListener('change', () => {
            updateSetting('stateEnabled', stateToggle.checked);
            applyStateInjection();
        });
    }

    const resetBtn = root.querySelector('#roleEx-setting-reset');
    resetBtn?.addEventListener('click', () => {
        settings = clone(DEFAULT_SETTINGS);
        const c = ctx();
        if (c?.extensionSettings) {
            c.extensionSettings[MODULE_NAME] = settings;
        }
        saveSettingsDebounced();
        applyStateInjection();
        ensureRuntimePromptSource();
        updatePresetCardHint();
        toast('success', '已恢复默认设置（界面将在刷新后完全同步）。');
    });
}

// ============================================================================
// 事件绑定与启动
// ============================================================================

function bindEvents() {
    const c = ctx();
    const eventSource = c?.eventSource;
    const eventTypes = c?.event_types;
    if (!eventSource || !eventTypes) {
        return;
    }

    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        ui.selectedFloors.clear();
        ui.selectedJournalIds.clear();
        ui.identity = currentChatIdentity();
        if (ui.panelOpen) {
            onPanelOpened();
        }
        applyStateInjection();
        // 面板没打开时也把日记读进来，保证预设卡片随时有内容可提供
        scheduleBackgroundJournalLoad();
    });

    eventSource.on(eventTypes.MESSAGE_RECEIVED, () => {
        try {
            onCharacterMessageReceived();
        } catch (e) {
            logError('state parse failed', e);
        }
    });

    // 记录生成类型：安静生成（本插件写日记的那次调用）不注入日记正文。
    // 见 NO_JOURNAL_INJECT_TYPES 处的说明。GENERATION_STARTED 在旧版本里可能不存在，
    // 缺失时跳过即可 —— 此时由 ui.generatingJournal 这个主判据兜底。
    if (eventTypes.GENERATION_STARTED) {
        eventSource.on(eventTypes.GENERATION_STARTED, (type) => {
            currentGenerationType = type || 'normal';
        });
    }

    eventSource.on(eventTypes.EXTENSION_SETTINGS_LOADED, () => initExtensionSettingsPanel());

    // 换预设（或预设被重新加载）后，刷新状态文案（卡片内容由运行时源提供，无需改动预设）
    const onPresetChanged = () => {
        setTimeout(() => {
            ensureRuntimePromptSource();
            adoptCardStateFromPreset();
            updatePresetCardHint();
        }, 60);
    };
    if (eventTypes.OAI_PRESET_CHANGED_AFTER) {
        eventSource.on(eventTypes.OAI_PRESET_CHANGED_AFTER, onPresetChanged);
    }
    if (eventTypes.OAI_PRESET_CHANGED_BEFORE) {
        eventSource.on(eventTypes.OAI_PRESET_CHANGED_BEFORE, onPresetChanged);
    }

    eventSource.on(eventTypes.APP_READY, () => {
        initExtensionSettingsPanel();
        applyStateInjection();
        clearLegacyJournalInjection();
        ensureRuntimePromptSource();
        adoptCardStateFromPreset();
        updatePresetCardHint();
        scheduleBackgroundJournalLoad();
    });

    // 生成结束后刷新一次状态文案（此时预览数据才建立）
    for (const evt of ['GENERATION_ENDED', 'GENERATION_STOPPED']) {
        if (eventTypes[evt]) {
            eventSource.on(eventTypes[evt], () => {
                setTimeout(() => {
                    adoptCardStateFromPreset();
                    updatePresetCardHint();
                }, 200);
            });
        }
    }
}

const scheduleBackgroundJournalLoad = debounce(async () => {
    if (ui.panelOpen) {
        return;
    }
    await reloadJournal();
    updatePresetCardHint();
}, 600);

/**
 * 尽早注册运行时正文源。
 *
 * ⚠️ 时序很关键：酒馆是在 Chat Completion 初始化时渲染预设列表的
 * （`setupChatCompletionPromptManager()` → `promptManager.render()`），
 * 而渲染时就决定了那张卡片有没有「启停开关 / 编辑铅笔」。
 * 如果等到 APP_READY 才注册，首屏渲染拿不到授权 → 开关和铅笔会消失，
 * 直到下一次 re-render（进入会话、发消息等）才恢复。
 *
 * 所以这里在模块求值后立刻注册；registerRuntimePromptSource 尚未就绪时按帧重试。
 */
function registerRuntimeSourceEarly(tries = 0) {
    if (ensureRuntimePromptSource()) {
        // 注册成功必须马上补一次预设列表渲染：首次渲染早于扩展激活，
        // 不补的话「不打开会话就看不到铅笔和开关」。
        patchPromptManagerFirstRender();
        return true;
    }
    if (tries >= 20) {
        logMarkerSupport();
        return false;
    }
    setTimeout(() => registerRuntimeSourceEarly(tries + 1), 250);
    return false;
}

function bootstrap() {
    loadSettings();
    ui.identity = currentChatIdentity();
    getMetaRoot(); // 确保元数据结构存在
    // 先注册运行时源，再谈界面 —— 否则预设首屏渲染拿不到卡片授权
    registerRuntimeSourceEarly();
    bindEvents();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootUI, { once: true });
    } else {
        bootUI();
    }
}

function bootUI() {
    logMarkerSupport();
    if (!insertDrawer()) {
        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            if (insertDrawer() || tries > 20) {
                clearInterval(timer);
            }
        }, 500);
    }
    if (!insertCharacterPanelButton()) {
        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            if (insertCharacterPanelButton() || tries > 20) {
                clearInterval(timer);
            }
        }, 500);
    }
}

bootstrap();

// 暴露给控制台调试
globalThis.roleExpansion = {
    get settings() {
        return settings;
    },
    ui,
    openPanel,
    reloadJournal,
    addJournalEntry,
    persistJournal,
    applyStateInjection,
    clearLegacyJournalInjection,
    isJournalCardEnabled: isJournalCardEnabledInPreset,
    readJournalCard,
    logMarkerSupport,
    diagnoseJournalCard,
    probeCardControls,
    patchPromptManagerFirstRender,
    updatePresetCardHint,
    toggleDrawerState,
    layoutMainPanel,
    splitJournalResponse,
    getStateList,
    buildJournalPrompt,
    currentChatIdentity,
};

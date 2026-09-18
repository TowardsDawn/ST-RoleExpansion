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
 *      - 状态列表维护、生成前注入、<名称>值</名称> 标签的解析与剥离（按会话隔离）
 *      - 注入提示词、注入深度与角色均可自由调整
 *      - 可选把当前状态并入日记生成提示词
 *
 * UI：
 *   - 顶部工具栏抽屉（World Info 与 User Settings 之间）
 *   - 打开时为主面板形态：与 World Info 同款的下拉面板，挂在 #movingDivs，
 *     宽度 --sheldWidth、顶部紧贴工具栏居中；z-index 3000 低于 #top-settings-holder(3005)，
 *     所以永远处在抽屉栈最底层 —— 任何展开的顶部抽屉都会盖住本面板
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

const STORAGE = {
    // 日记文件名（单段 ASCII）：c_<角色hash8> = 角色目录，j_<会话hash8> = 会话文件。
    // 落点见「日记文件存储」章节：
    //   <user>/chats/<角色目录>/_RoleExpansion/journals/<这个文件名>
    PREFIX: 'RoleExpansion_journal',
};

// ST PromptManager 的 DOM 前缀（openai.js 里 configuration.prefix = 'completion_'）。
// 它决定了列表容器 id 与「禁用」类名，DOM 探针要用。
const PROMPT_MANAGER_PREFIX = 'completion_';

/**
 * 框架自己的设置默认值。
 *
 * ⚠️ 模块的设置键（journal* / state*）**不在这里** —— 它们跟着模块走，见 modules/<id>/index.js
 * 里的 defaults，运行时由 moduleDefaults() 合并进来。模块被拆掉/禁用时，这些键自然消失，
 * 框架不需要认识它们。
 */
const DEFAULT_SETTINGS = {
    // 模块启用开关：{ journal: false } 表示「文件在但不启用」；不写 = 启用
    modules: {},
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

function getChatArray() {
    const c = ctx();
    return Array.isArray(c?.chat) ? c.chat : [];
}

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
 * 日记文件名必须是单段 ASCII：服务端补丁沿用酒馆 validateAssetFileName 的同一条规则
 * （原始正则为 /^[a-zA-Z0-9_\-.]+$/），中文、空格、括号等一律被拒。
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

// 「存为默认设置」把当前配置快照存进扩展设置容器的**另一个键**，不混进 settings 自身：
// settings 会被 Object.assign 合并、被「恢复默认设置」整体替换，基准混在里面迟早互相污染。
// 用另一个键还有个好处：清掉它（clearCustomDefaults）就等于回到出厂值，不需要额外标记位。
const CUSTOM_DEFAULTS_KEY = `${MODULE_NAME}_defaults`;

/** 用户用「存为默认设置」保存的基准；null = 用内置 DEFAULT_SETTINGS */
let customDefaults = null;

/**
 * 当前的「默认值」= 内置默认打底 + 自定义基准覆盖。
 * 之所以打底而不是直接用快照：新版本新增的设置键，老快照里没有，
 * 直接返回快照会让这些新键凭空消失。
 */
function defaultSettings() {
    // 「默认值」= 框架默认 + 已加载模块的默认（禁用中的模块也算：否则一禁用再启用，
    // 用户改过的键会因为 settings 里没有它而被整体覆盖掉，等于静默丢配置）
    return Object.assign(clone(DEFAULT_SETTINGS), moduleDefaults());
}

function baselineSettings() {
    const base = defaultSettings();
    return customDefaults ? Object.assign(base, clone(customDefaults)) : base;
}

function loadSettings() {
    const c = ctx();
    const container = c?.extensionSettings;
    if (!container) {
        settings = baselineSettings();
        return settings;
    }
    // 自定义基准必须在合并之前读出来 —— 它决定「默认值」到底是什么
    customDefaults = container[CUSTOM_DEFAULTS_KEY] || null;
    const stored = container[MODULE_NAME];
    settings = Object.assign(baselineSettings(), stored || {});
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

/** 把当前配置存为「默认设置」—— 之后「恢复默认设置」会恢复到这份快照 */
function saveAsDefaults() {
    customDefaults = clone(settings);
    const c = ctx();
    if (c?.extensionSettings) {
        c.extensionSettings[CUSTOM_DEFAULTS_KEY] = customDefaults;
    }
    saveSettingsDebounced();
    updateDefaultsHint();
    return customDefaults;
}

/** 清除自定义基准，回到扩展内置默认值（控制台出口，避免存了之后没有回头路） */
function clearCustomDefaults() {
    customDefaults = null;
    const c = ctx();
    if (c?.extensionSettings) {
        delete c.extensionSettings[CUSTOM_DEFAULTS_KEY];
    }
    saveSettingsDebounced();
    updateDefaultsHint();
}

/** 恢复到当前基准（内置默认，或用户「存为默认设置」的快照） */
function resetToDefaults() {
    settings = baselineSettings();
    const c = ctx();
    if (c?.extensionSettings) {
        c.extensionSettings[MODULE_NAME] = settings;
    }
    saveSettingsDebounced();
    applyStateInjection();
    ensureRuntimePromptSource();
    updatePresetCardHint();
    updateDefaultsHint();
    return settings;
}

/** 扩展设置面板里那行说明：当前「默认」是内置值，还是你存过的快照 */
function updateDefaultsHint() {
    const el = document.getElementById('roleEx-setting-defaults-hint');
    if (!el) {
        return;
    }
    el.textContent = customDefaults
        ? '当前「默认」= 你保存的自定义基准（「恢复默认设置」恢复到它；清除：控制台执行 roleExpansion.clearCustomDefaults()）'
        : '当前「默认」= 扩展内置值。点「存为默认设置」可把当前配置存成新的基准。';
}

// ============================================================================
// 日记文件存储（/api/role-expansion/journal/*，需要 patches/st-journal-store.patch）
// ============================================================================
// 落点：<user>/chats/<角色目录>/_RoleExpansion/journals/RoleExpansion_journal_c_<h8>_j_<h8>.jsonl
//   - 酒馆「列聊天文件」的全部代码路径（chats.js /search、chats.js /recent、
//     characters.js /chats）都只扫 chats/<角色>/ 本级、且要求 isFile()，
//     所以这个子目录里的文件不会被当成聊天文件列出来或加载；
//   - 角色改名/换头像时 chats/<旧>/ 会被 cpSync(recursive) 整体搬到新名字下，日记跟着走；
//     删除角色并勾选「删除聊天」时被 rm(recursive) 连根删除 —— 与「角色的私人物品」语义一致。
// ⚠️ 必须有服务端补丁：原生接口没有任何办法让前端写进 chats/
//    （/api/files/* 只接受单段 ASCII 名；/api/chats/* 的路径参数会被 sanitize-filename 抹掉 '/'）。
//    没打补丁就明确报错（reason = patch-missing），**不做**「悄悄写回 user/files」的回退；
//    群聊没有角色目录，直接判为不可用（reason = group）。

/** 补丁挂载的端点前缀 */
const JOURNAL_ENDPOINT = '/api/role-expansion/journal';

/** 角色聊天目录下的插件私有子目录（与服务端补丁里的常量一致） */
const JOURNAL_DIR_NAME = '_RoleExpansion';

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

/** 当前角色的头像文件名；群聊（没有角色目录）返回空串 */
function currentAvatarUrl() {
    const c = ctx();
    if (c?.groupId) {
        return '';
    }
    const ch = c?.characters?.[c?.characterId];
    return ch?.avatar ? String(ch.avatar) : '';
}

/**
 * 日记功能当前可不可用。这里只做本地判断 —— 补丁缺失要等真的发一次请求才知道。
 * @returns {{ ok: true, avatarUrl: string } | { ok: false, reason: string }}
 */
function journalAvailability() {
    if (ctx()?.groupId) {
        return { ok: false, reason: 'group' };
    }
    const avatarUrl = currentAvatarUrl();
    if (!avatarUrl) {
        return { ok: false, reason: 'no-character' };
    }
    return { ok: true, avatarUrl };
}

/** 失败原因 → 给人看的说明（UI 与 Toast 共用一份文案，避免两处各写一遍） */
function journalReasonText(reason) {
    switch (String(reason ?? '')) {
        case 'group':
            return '群聊不支持日记：日记按角色目录存放，群聊没有角色目录。';
        case 'no-character':
            return '还没有选择角色（角色目录未知）。';
        case 'patch-missing':
            return '缺服务端补丁：对酒馆执行 git apply patches/st-journal-store.patch 并重启，日记才能写进聊天目录。';
        case 'invalid-path':
            return '服务端拒绝了日记路径（文件名或角色头像名不合法）。';
        case 'too-large':
            return '日记文件超过服务端上限（16MB）。';
        case 'network':
            return '日记接口请求失败（网络错误）。';
        default:
            return '日记读写失败：' + String(reason ?? '未知原因');
    }
}

/** 日记文件在磁盘上的位置（给人看；不可用时返回空串） */
function journalPathText(fileName) {
    const avail = journalAvailability();
    if (!avail.ok) {
        return '';
    }
    return 'chats/' + String(avail.avatarUrl).replace(/\.png$/i, '') + '/' + JOURNAL_DIR_NAME + '/journals/' + fileName;
}

/**
 * 调一次日记端点。
 * @returns {Promise<{ ok: true, data: any } | { ok: false, reason: string }>}
 */
async function journalRequest(route, body) {
    const avail = journalAvailability();
    if (!avail.ok) {
        return { ok: false, reason: avail.reason };
    }

    let resp = null;
    try {
        resp = await fetch(JOURNAL_ENDPOINT + '/' + route, {
            method: 'POST',
            headers: requestHeaders(),
            body: JSON.stringify(Object.assign({ avatar_url: avail.avatarUrl }, body)),
        });
    } catch (e) {
        logError('日记接口请求失败', route, e);
        return { ok: false, reason: 'network' };
    }

    // 没打补丁时，酒馆对未知的 /api 路由回 404（HTML）—— 以此判为「补丁缺失」
    if (resp.status === 404) {
        return { ok: false, reason: 'patch-missing' };
    }
    if (!resp.ok) {
        if (resp.status === 400) {
            return { ok: false, reason: 'invalid-path' };
        }
        if (resp.status === 413) {
            return { ok: false, reason: 'too-large' };
        }
        return { ok: false, reason: 'http-' + resp.status };
    }

    try {
        return { ok: true, data: await resp.json() };
    } catch (e) {
        return { ok: false, reason: 'bad-response' };
    }
}

/** 读日记文件：{ ok: true, text, exists } / { ok: false, reason } */
async function readJournalFile(fileName) {
    const res = await journalRequest('get', { file_name: fileName });
    if (!res.ok) {
        return res;
    }
    return { ok: true, text: String(res.data?.text ?? ''), exists: !!res.data?.exists };
}

/** 写日记文件：{ ok: true } / { ok: false, reason } */
async function writeJournalFile(fileName, text) {
    const res = await journalRequest('save', { file_name: fileName, text });
    return res.ok ? { ok: true } : res;
}

/**
 * 日记存储的健康探针（控制台排查第一步，不写任何东西）：
 * 读一个必然不存在的探针文件名，能拿到 200 就说明补丁在、角色目录也可达。
 */
async function probeJournalStorage() {
    const avail = journalAvailability();
    if (!avail.ok) {
        return { ok: false, reason: avail.reason, text: journalReasonText(avail.reason) };
    }
    const probeName = STORAGE.PREFIX + '_probe.jsonl';
    const res = await readJournalFile(probeName);
    return res.ok
        ? { ok: true, reason: null, text: '日记存储可用：' + journalPathText(probeName) }
        : { ok: false, reason: res.reason, text: journalReasonText(res.reason) };
}

// ============================================================================
// 日记 / 状态 运行时状态
// ============================================================================

const ui = {
    identity: null,
    // 最近一次日记读写的失败原因（'group' / 'patch-missing' / …）；null = 正常
    journalError: null,
    journalNotifiedError: null,
    journal: [],           // 日记条目
    selectedJournalIds: new Set(),
    selectedFloors: new Set(),
    busy: false,
    // 本插件自己发起的那次「生成日记」正在进行中 —— 主判据见 ensureRuntimePromptSource()
    generatingJournal: false,
    // 本次生成是什么类型（normal / quiet / swipe …）：框架的 GENERATION_STARTED 写、日记模块读。
    // 跨模块的运行时事实，所以放共享运行时里，而不是某个模块内部。
    currentGenerationType: 'normal',
    panelOpen: false,
    panelPinned: false,
    outsideClickBound: false,
    drawerEl: null,        // 顶部工具栏里的 .drawer
    contentEl: null,       // 顶部工具栏里的 .drawer-content（占位）
    panelEl: null,         // #movingDivs 里的侧边栏本体
};

// ============================================================================
// DOM 构建
// ============================================================================

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

/**
 * 面板顶层的大折叠区块（日记 / 角色状态栏 / 各提示词区）。
 *
 * ⚠️ 箭头方向必须与内层 collapsible()、以及酒馆原生折叠块保持一致：
 *   收起 = down（chevron-down）、展开 = up（chevron-up）。
 * 这里**不能**用 right / 展开朝下那套更常见的约定 —— 内层 collapsible() 走的是
 * 酒馆 `.inline-drawer` 的原生委托处理器，那个处理器写死 `toggleClass('down up')`，
 * 不认 right；两套语义并存的话，同一个 ↓ 图标会一会儿表示展开、一会儿表示收起。
 */
function section(title, { open = false } = {}) {
    const content = el('div', { class: 'roleEx-section-body' });
    const icon = el('div', { class: `fa-solid fa-circle-chevron-${open ? 'up' : 'down'} inline-drawer-icon roleEx-chevron` });
    const header = el('div', { class: 'roleEx-section-header' }, [
        el('i', { class: 'fa-solid fa-fw roleEx-section-icon' }),
        el('span', { class: 'roleEx-section-title', text: title }),
        icon,
    ]);
    const root = el('div', { class: 'roleEx-section' }, [header, content]);
    const setOpen = (value) => {
        root.classList.toggle('roleEx-open', value);
        icon.className = `fa-solid fa-circle-chevron-${value ? 'up' : 'down'} inline-drawer-icon roleEx-chevron`;
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
 *
 * ⚠️ 初始 display 必须在这里显式写死，不能交给 CSS。
 * 酒馆的 `.inline-drawer-content { display: none }`（style.css:5535）默认就是收起状态，
 * 而原生处理器只会 toggle —— 它不知道初始状态，也没法替我们补上「展开」。
 * 所以 `open: true` 时若不主动显示，就会出现「箭头朝上（展开态）但内容实际收着」，
 * 与 `open: false` 的折叠块方向正好相反，看起来就像箭头写反了。两份状态必须一起设。
 *
 * 方向约定跟随酒馆原生：收起 = `down`（chevron-down）、展开 = `up`（chevron-up），
 * 与 index.html 里那些初始 `down` + `display:none` 的折叠块一致。
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
    // 图标与内容一起定初始状态。slideToggle 展开后本来也会把它改成 block，
    // 这里只是把「第一次点击之前」那段窗口补齐。
    body.style.display = open ? 'block' : 'none';
    return { root, body, header };
}

// ============================================================================
// UI：顶部抽屉 / 主面板 / 角色面板入口
//
// 布局说明（对齐酒馆原生做法）：
//   - 工具栏按钮：与其它入口一致，手写 .drawer > .drawer-toggle/.drawer-content 结构，
//     插进 #top-settings-holder，位置在 World Info 与 User Settings 之间。
//   - 主面板：普通下拉面板形态（与 #WorldInfo 同款），挂在 #movingDivs 里，
//     顶部紧贴工具栏居中，宽度 --sheldWidth、最大高度到输入框上方；
//     #movingDivs 自身不是层叠上下文，面板的 z-index(3000) 直接和 #top-settings-holder(3005)
//     比大小 —— 低于它就等于在抽屉栈最底层，任何展开的顶部抽屉都能盖住本面板。
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
                <span class="roleEx-panel-sub" id="roleEx-panel-sub">启动中…</span>
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
    // 每个**已启用**的模块自己造一个区块挂进来（「关于」并进了日记模块的存储说明里）。
    // 模块被拆掉 / 被禁用时，这里自然就没有它的区块 —— 框架不需要认识任何具体模块。
    const mounted = [];
    for (const mod of activeModules()) {
        const sectionEl = mod.api.buildPanelSection?.();
        if (sectionEl) {
            scroll.append(sectionEl);
            mounted.push(mod);
        }
    }
    // 副标题跟着「实际挂上去的模块」走：全拆/全禁用时不能还写着「日记 · 状态栏」
    const sub = q('#roleEx-panel-sub', content);
    if (sub) {
        sub.textContent = mounted.length
            ? mounted.map(m => m.title || m.id).join(' · ')
            : '（无模块）';
    }
    // 空面板要有解释：否则「模块都被拆了」看起来就是「插件坏了」
    if (!mounted.length) {
        scroll.append(el('div', { class: 'roleEx-block roleEx-empty-state' }, [
            el('div', { class: 'roleEx-label', text: '没有可用模块' }),
            el('div', {
                class: 'roleEx-hint',
                html: '本插件的功能都由可拆模块提供，现在一个都没启用。两种可能：<br>'
                    + '① <code>modules/</code> 目录下的模块被删掉了（或没同步过来）；<br>'
                    + '② 模块文件在，但在酒馆的「扩展」设置面板 →「模块」区块里被禁用了。<br>'
                    + '去那里看一眼即可：控制台 <code>roleExpansion.modules()</code> 会直接告诉你哪一个是哪种情况。',
            }),
        ]));
    }

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
    // 与角色管理面板同时打开时打个标记（层级已让位：面板在抽屉栈最底层，这里只作状态标记）
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

    // 模块自带的区块（谁有谁渲染；一个模块都没有时这里就是空的）
    renderModuleSettingsBlocks(root);
    // 日记模块会把卡片诊断写进它自己建的那个 #roleEx-preset-card-hint
    updatePresetCardHint();

    root.querySelector('#roleEx-setting-save-defaults')?.addEventListener('click', () => {
        saveAsDefaults();
        toast('success', '已把当前配置存为默认设置 —— 之后「恢复默认设置」会恢复到它。');
    });

    root.querySelector('#roleEx-setting-reset')?.addEventListener('click', () => {
        resetToDefaults();
        toast('success', '已恢复默认设置（界面将在刷新后完全同步）。');
    });

    // 「当前默认是内置值还是你存的快照」必须看得见，否则这两个按钮是无反馈的
    updateDefaultsHint();

    // 已加载模块：装了没 / 启没启用 / 一键启用禁用（拆掉模块目录是正常用法，不是故障）
    renderModuleRows(root);
}

// ============================================================================
// 模块桥接：框架 → 模块的转发壳
//
// 框架里原有的调用点（事件、抽屉、设置面板）保持原样，靠这层同名壳转给模块。
// 这样「模块被拆掉」时框架不会炸，只是变成空操作（下面的 MODULES 查找会拿到 undefined）。
// ============================================================================

function callJournal(fn, ...args) { return callModule('journal', fn, ...args); }
function callState(fn, ...args) { return callModule('state', fn, ...args); }

// —— 日记模块 ——
function ensureRuntimePromptSource(...a) { return callJournal('ensureRuntimePromptSource', ...a); }
function patchPromptManagerFirstRender(...a) { return callJournal('patchPromptManagerFirstRender', ...a); }
function logMarkerSupport(...a) { return callJournal('logMarkerSupport', ...a); }
function updatePresetCardHint(...a) { return callJournal('updatePresetCardHint', ...a); }
function describeJournalCard(...a) { return callJournal('describeJournalCard', ...a); }
function openPresetPanel(...a) { return callJournal('openPresetPanel', ...a); }
function reloadJournal(...a) { return callJournal('reloadJournal', ...a); }
function renderFloors(...a) { return callJournal('renderFloors', ...a); }
function adoptCardStateFromPreset(...a) { return callJournal('adoptCardStateFromPreset', ...a); }
function addJournalEntry(...a) { return callJournal('addJournalEntry', ...a); }
function persistJournal(...a) { return callJournal('persistJournal', ...a); }
function buildJournalPrompt(...a) { return callJournal('buildJournalPrompt', ...a); }
function clearLegacyJournalInjection(...a) { return callJournal('clearLegacyJournalInjection', ...a); }
function diagnoseJournalCard(...a) { return callJournal('diagnoseJournalCard', ...a); }
function isJournalCardEnabledInPreset(...a) { return callJournal('isJournalCardEnabledInPreset', ...a); }
function readJournalCard(...a) { return callJournal('readJournalCard', ...a); }
function probeCardControls(...a) { return callJournal('probeCardControls', ...a); }
function splitJournalResponse(...a) { return callJournal('splitJournalResponse', ...a); }
function currentChatIdentity(...a) { return callJournal('currentChatIdentity', ...a); }

// —— 角色状态栏模块 ——
function applyStateInjection(...a) { return callState('applyStateInjection', ...a); }
function renderStateList(...a) { return callState('renderStateList', ...a); }
function onCharacterMessageReceived(...a) { return callState('onCharacterMessageReceived', ...a); }
function getStateList(...a) { return callState('getStateList', ...a); }
function getMetaRoot(...a) { return callState('getMetaRoot', ...a); }

// ============================================================================
// 模块系统：日记 / 角色状态栏都是「可拆模块」
//
// 设计目标：**删掉 modules/<id>/ 整个目录，插件其余部分照常工作**。
//   - 加载：动态 import + try/catch —— 文件不在就当作「没装」，只记一行日志。
//     （必须动态：静态 import 会因为一个文件缺失把整个扩展拖垮。）
//   - 启用：文件在但可以在扩展设置面板里禁用（存 settings.modules，刷新页面生效）。
//     禁用只影响「是否实例化」，不影响它的设置默认值 —— 否则一禁用再启用，
//     settings 里没有它的键，用户改过的配置会被整体覆盖，等于静默丢配置。
//   - 接口：框架通过下面的转发壳调用模块公开函数；模块反向只用 create(kernel) 拿到的那份设施。
//   - 服务：模块之间只走 service()，对方不在时消费方负责取安全缺省。
// ============================================================================

/**
 * 模块清单文件（`modules/manifest.json`，相对本文件解析）。
 * 框架**不认识任何具体模块**：加模块只改这个 JSON，不用动 index.js。
 * 清单里的 path 相对清单文件本身，所以在那里写 `./journal/index.js`。
 */
const MODULE_MANIFEST_URL = new URL('./modules/manifest.json', import.meta.url);

/**
 * 读不到清单时的**安全网**：正常路径永远是清单驱动，只有清单文件缺失/读坏才会用到它。
 * 最典型的场景是「同步到酒馆时漏了 modules/ 目录」—— 那时整个插件都不该变成哑巴，
 * 所以按 modules/<id>/index.js 的约定路径再试一次，并在控制台与控制台面板里明确报出来。
 */
const MODULE_FALLBACK_IDS = ['journal', 'state'];

/** 已解析的清单条目（loadModuleManifest() 填） */
let moduleManifest = [];
/** 是否走了降级路径（安全网） */
let manifestDegraded = false;

/** 读清单：fetch 相对本文件的 modules/manifest.json，失败则降级 + 明确告警 */
async function loadModuleManifest() {
    try {
        const res = await fetch(MODULE_MANIFEST_URL);
        if (!res.ok) {
            throw new Error('HTTP ' + res.status);
        }
        const data = await res.json();
        const entries = (Array.isArray(data?.modules) ? data.modules : [])
            .filter(e => e && typeof e.id === 'string' && e.id && typeof e.path === 'string' && e.path)
            .map(e => ({ id: e.id, path: e.path, title: e.title || e.id, icon: e.icon || '' }));
        if (!entries.length) {
            throw new Error('清单里没有有效条目');
        }
        moduleManifest = entries;
    } catch (e) {
        manifestDegraded = true;
        console.warn('[' + MODULE_NAME + '] 模块清单读取失败（' + MODULE_MANIFEST_URL.href + '）：' + e.message
            + '\n  → 降级：按内置 id 列表 ' + MODULE_FALLBACK_IDS.join(' / ') + ' 猜 modules/<id>/index.js。'
            + '\n  → 最常见原因：同步到酒馆时漏了 modules/ 目录（清单也在里面）。');
        moduleManifest = MODULE_FALLBACK_IDS.map(id => ({ id, path: './' + id + '/index.js', title: id, icon: '' }));
    }
    return moduleManifest;
}

/** 清单条目 → 真实 URL（相对清单文件解析） */
function moduleUrl(entry) {
    return new URL(entry.path, MODULE_MANIFEST_URL);
}

/** 清单快照（调试用）：url / 是否降级 / 条目 */
function moduleManifestInfo() {
    return { url: MODULE_MANIFEST_URL.href, degraded: manifestDegraded, entries: moduleManifest };
}

/** 已加载的模块：id -> 模块描述符（default 导出） */
const MODULES = new Map();
/** 已加载但被禁用的模块 id */
const DISABLED_MODULES = new Set();
/** 模块服务表：服务名 -> { id, fn } */
const SERVICES = new Map();

/** 动态加载清单里的模块；缺文件 / 导出不合法都只记一行，不中断其它模块 */
async function loadModules() {
    await loadModuleManifest();
    for (const entry of moduleManifest) {
        if (MODULES.has(entry.id)) {
            continue;
        }
        const url = moduleUrl(entry);
        let mod = null;
        try {
            mod = await import(url.href);
        } catch (e) {
            // 「拆掉模块目录」是正常用法，不是错误：一条 info 就够了
            console.info('[' + MODULE_NAME + '] 模块「' + entry.id + '」未安装（' + url.pathname + ' 加载失败），跳过。');
            continue;
        }
        const desc = mod?.default;
        if (!desc || typeof desc.create !== 'function') {
            logError('模块 ' + entry.id + ' 的 default 导出不合法（需要一个带 create(kernel) 的对象）');
            continue;
        }
        // 清单里的 title / icon 只作兜底：模块自己声明的优先
        MODULES.set(entry.id, { ...desc, id: entry.id, title: desc.title || entry.title, icon: desc.icon || entry.icon });
    }
}

/** 模块是否启用：settings.modules 里显式 false 才算禁用（默认启用） */
function isModuleEnabled(id) {
    return settings.modules?.[id] !== false;
}

/**
 * 各模块的设置默认值（**不管启用与否**都算进来，见文件头那条说明）。
 * 函数声明提升，所以「设置」章节里的 defaultSettings() 可以先调用它。
 */
function moduleDefaults() {
    const out = {};
    MODULES.forEach((desc) => {
        Object.assign(out, clone(desc.defaults || {}));
    });
    return out;
}

/** 实例化启用中的模块，并登记它们提供的服务 */
function activateModules() {
    MODULES.forEach((desc, id) => {
        if (desc.api) {
            return;
        }
        if (!isModuleEnabled(id)) {
            DISABLED_MODULES.add(id);
            return;
        }
        try {
            desc.api = desc.create(kernel);
        } catch (e) {
            logError('模块 ' + id + ' 初始化失败，已跳过', e);
            return;
        }
        // 服务登记两种粒度，都支持：
        //   kernel.service('state').buildStateText()   ← 模块 bag（推荐，读起来知道是谁提供的）
        //   kernel.service('buildStateText')()         ← 平铺的服务名
        const bag = desc.api?.services || {};
        if (Object.keys(bag).length) {
            SERVICES.set(id, { id, bag });
        }
        for (const [name, fn] of Object.entries(bag)) {
            SERVICES.set(name, { id, fn });
        }
    });
}

/** 按名字取服务（模块之间唯一的耦合方式）；没装 / 被禁用 / 没这个名字 → undefined */
function service(name) {
    const entry = SERVICES.get(name);
    return entry ? (entry.bag ?? entry.fn) : undefined;
}

/** 有面板区块的已启用模块（抽屉按这个顺序挂区块） */
function activeModules() {
    return [...MODULES.values()].filter(m => m.api && typeof m.api.buildPanelSection === 'function');
}

/** 框架 → 模块的统一入口：模块不在 / 被禁用 / 没这个函数 → 空操作，绝不抛 */
function callModule(id, fn, ...args) {
    const api = MODULES.get(id)?.api;
    const f = api?.[fn];
    if (typeof f !== 'function') {
        return undefined;
    }
    try {
        return f.apply(api, args);
    } catch (e) {
        logError('模块 ' + id + '.' + fn + '() 调用失败', e);
        return undefined;
    }
}

/** 模块清单快照：装了没、启没启用（扩展设置面板与 roleExpansion.modules() 都用它） */
function moduleStatus() {
    return moduleManifest.map((entry) => {
        const desc = MODULES.get(entry.id);
        return {
            id: entry.id,
            title: desc?.title || entry.title || null,
            installed: !!desc,
            enabled: !!desc?.api,
            disabled: DISABLED_MODULES.has(entry.id),
        };
    });
}

/**
 * 让「已启用模块」往扩展设置面板里塞自己的区块（可选能力）：
 *   descriptor.settingsBlock(kernel) → DOM 节点
 * 框架不关心谁有、长什么样；模块没装 / 被禁用时对应区块自然不存在 ——
 * 这样「模块被拆掉却还挂着一块永远『检测中…』的 UI」就不可能发生。
 */
function renderModuleSettingsBlocks(root) {
    const box = root.querySelector('#roleEx-setting-module-blocks');
    if (!box) {
        return;
    }
    box.textContent = '';
    MODULES.forEach((desc) => {
        if (!desc.api || typeof desc.settingsBlock !== 'function') {
            return;
        }
        try {
            const node = desc.settingsBlock(kernel);
            if (node) {
                box.append(node);
            }
        } catch (e) {
            logError('模块 ' + desc.id + ' 的设置面板区块构建失败', e);
        }
    });
}

/** 扩展设置面板里的「模块」区块：装了哪些、启没启用、以及启用开关 */
function renderModuleRows(root) {
    const box = root.querySelector('#roleEx-setting-modules');
    if (!box) {
        return;
    }
    box.textContent = '';
    if (manifestDegraded) {
        // 降级是**可见**的：不然「清单没同步过来」会伪装成「模块都没装」，很难查
        box.append(el('div', { class: 'roleEx-hint roleEx-danger', text: '模块清单读取失败，已降级为内置 id 列表 —— 多半是同步时漏了 modules/ 目录（清单也在里面）。改完刷新页面。' }));
    }
    for (const info of moduleStatus()) {
        const cb = el('input', { type: 'checkbox', id: 'roleEx-mod-' + info.id });
        cb.checked = info.enabled;
        cb.disabled = !info.installed;
        cb.addEventListener('change', () => {
            updateSetting('modules', Object.assign({}, settings.modules, { [info.id]: cb.checked }));
            toast('success', '「' + (info.title || info.id) + '」已' + (cb.checked ? '启用' : '禁用') + ' —— 刷新页面生效。');
        });
        box.append(checkboxRow(cb,
            info.installed ? (info.title || info.id) : info.id + '（未安装）',
            info.installed
                ? (info.enabled ? '已加载并启用' : '文件在，但当前被禁用')
                : '目录 modules/' + info.id + '/ 不存在 —— 拆掉模块是正常用法，不是故障'));
    }
}

/**
 * 注入给模块的那份设施。
 * ⚠️ settings / ui 必须是**长期同一个对象**：模块会把它们解构到工厂作用域里长期使用，
 *   所以框架绝不能在运行时换对象（resetToDefaults() 也是就地改写，不重新赋值）。
 */
const kernel = {
    // 通用工具
    clone, debounce, uid, stableHash, splitLines, textPreview, formatTime,
    safeName, slugForFile, stampForFileName, pad2, getChatArray, renderTemplateString,
    logError, toast, ctx,
    // 与酒馆接口相关的常量（模块拼 DOM id / 调 setExtensionPrompt 都要用）
    MODULE_NAME, PROMPT_MANAGER_PREFIX, EXT_PROMPT_KEY, EXT_POSITION_IN_CHAT,
    EXT_ROLE_SYSTEM, EXT_ROLE_ASSISTANT, META_KEY, STORAGE,
    // 状态标签准入闸的常量（状态栏模块用）
    MAX_STATE_NAME_LENGTH, NON_STATE_TAGS,
    // DOM 构建
    el, q, section, iconFor, collapsible, checkboxRow, ID,
    // 设置（settings 走 getter，永远拿当前那份）
    get settings() { return settings; },
    updateSetting, saveSettingsDebounced,
    // 共享运行时（ui.journal / ui.generatingJournal / ui.currentGenerationType …）：只放**框架与模块都要读**的事实；
    // 单模块自用的字段放在模块自己那侧，别往这里塞（历史上有过 ui.stateList 这种没有任何读者的字段）
    ui,
    // 日记文件存储（走 /api/role-expansion，需要补丁）
    journalAvailability, journalPathText, journalReasonText, readJournalFile, writeJournalFile,
    probeJournalStorage,
    // 模块系统
    service,
};


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
            ui.currentGenerationType = type || 'normal';
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

// 模块加载 / 设置读取 / 模块实例化必须在 bootstrap 之前完成，而且是**顶层 await**：
//   - 酒馆与自测都是 `await import(本文件)`，TLA 不会打乱调用方时序，
//     反而保住了老约定「扩展在模块求值阶段就把运行时正文源注册好」（见 §4.1 首屏时序）；
//   - 设置的「默认值」= 框架默认 + 各模块默认，所以必须先加载模块再 loadSettings()。
await loadModules();
loadSettings();
activateModules();

function bootstrap() {
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
    // —— 框架自己的 ——
    openPanel,
    toggleDrawerState,
    layoutMainPanel,
    saveAsDefaults,
    resetToDefaults,
    clearCustomDefaults,
    /** 已加载 / 已启用 / 未安装 的模块清单（排查「模块是不是被拆了」的第一步） */
    modules: moduleStatus,
    /** 模块清单本身：URL / 是否降级 / 条目 */
    moduleManifest: moduleManifestInfo,
    /** 日记存储：可用性（群聊 / 缺补丁）、落点文案、探针 —— 排查「日记写不进去」的第一步 */
    journalAvailability,
    journalPathText,
    journalReasonText,
    probeJournalStorage,
    // —— 模块提供的（模块不在时是空壳：调用返回 undefined，不抛）——
    // 想确认某个名字到底有没有，看 roleExpansion.modules() 里的 installed / enabled
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
    splitJournalResponse,
    getStateList,
    buildJournalPrompt,
    currentChatIdentity,
    describeJournalCard,
};

/**
 * 静态自测：用最小 DOM/ST 桩加载 index.js，验证纯逻辑与环境初始化不抛异常。
 * 运行： node tools/smoke-test.mjs
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const listeners = new Map();
/** element -> click 处理器列表（用于模拟真实点击） */
const clickHandlers = new Map();

/** 给需要按 id 查找的场景准备的极简注册表 */
const registry = new Map();

function makeEl(tag = 'div') {
    const node = {
        tagName: String(tag).toUpperCase(),
        id: '',
        className: '',
        style: {},
        dataset: {},
        value: '',
        checked: false,
        textContent: '',
        _innerHTML: '',
        children: [],
        files: [],
        parentElement: null,
        classList: {
            _set: new Set(),
            add(...c) { c.forEach(x => this._set.add(x)); },
            remove(...c) { c.forEach(x => this._set.delete(x)); },
            contains(c) { return this._set.has(c); },
            toggle(c, force) {
                const on = force === undefined ? !this._set.has(c) : !!force;
                if (on) { this._set.add(c); } else { this._set.delete(c); }
                return on;
            },
        },
        setAttribute(k, v) {
            this[k] = v;
            if (k === 'id' && v) {
                registry.set(v, this);
            }
        },
        getAttribute(k) { return this[k]; },
        removeAttribute(k) { delete this[k]; },
        appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
        append(...c) { c.forEach(x => this.appendChild(x)); },
        remove() {
            if (this.parentElement) {
                const i = this.parentElement.children.indexOf(this);
                if (i !== -1) {
                    this.parentElement.children.splice(i, 1);
                }
            }
        },
        insertAdjacentElement(_pos, node) { this.parentElement?.appendChild(node); return node; },
        insertBefore(node, ref) {
            const i = ref ? this.children.indexOf(ref) : -1;
            if (i === -1) {
                return this.appendChild(node);
            }
            this.children.splice(i, 0, node);
            node.parentElement = this;
            return node;
        },
        insertAdjacentHTML() { },
        querySelector(sel) {
            if (sel.startsWith('#')) {
                const want = sel.slice(1);
                return this.children.find(c => c.id === want) ?? bySelector.get(sel) ?? null;
            }
            if (bySelector.has(sel)) {
                return bySelector.get(sel);
            }
            if (sel === '.drawer-toggle') {
                return this.children.find(c => String(c.className).includes('drawer-toggle')) ?? null;
            }
            if (sel === '.drawer-icon') {
                return this.children.find(c => String(c.className).includes('drawer-icon')) ?? null;
            }
            // 区块标题行里的箭头：模块要把状态 / 工具插到它前面
            if (sel === '.roleEx-chevron') {
                return this.children.find(c => String(c.className).includes('roleEx-chevron')) ?? null;
            }
            return null;
        },
        querySelectorAll() { return []; },
        addEventListener(type, fn) {
            if (type === 'click') {
                const list = clickHandlers.get(this) || [];
                list.push(fn);
                clickHandlers.set(this, list);
            }
            listeners.set(`${this.id || this.tagName}:${type}`, fn);
        },
        removeEventListener() { },
        dispatchEvent() { return true; },
        click() {
            for (const fn of clickHandlers.get(this) || []) {
                fn({ preventDefault() { }, stopPropagation() { } });
            }
        },
        closest(sel) {
            let node = this;
            while (node) {
                if (sel === '.drawer' && String(node.className).includes('drawer')) {
                    return node;
                }
                node = node.parentElement;
            }
            return null;
        },
        getElementsByTagName() { return []; },
        focus() { },
    };
    // innerHTML 赋值时，把其中的 id="..." 解析成真实子节点（够面板用）
    Object.defineProperty(node, 'innerHTML', {
        get() { return this._innerHTML; },
        set(html) {
            this._innerHTML = String(html);
            // 只按完整的 id="..." 建节点，别把 id="xxxheader" 误判成 xxx
            for (const m of String(html).matchAll(/(?:^|\s)id="([^"]+)"/g)) {
                const child = makeEl('div');
                child.setAttribute('id', m[1]);
                child.className = m[1];
                this.appendChild(child);
            }
        },
    });
    return node;
}

/** 让 stub 能按选择器找到固定节点 */
const bySelector = new Map();

// ---- 造出酒馆顶部工具栏与角色卡编辑区的骨架，让 extension 真正注入抽屉 ----
const domHolder = makeEl('div');
domHolder.setAttribute('id', 'top-settings-holder');
const domWiButton = makeEl('div');
domWiButton.setAttribute('id', 'WI-SP-button');
domWiButton.className = 'drawer';
domHolder.appendChild(domWiButton);
registry.set('top-settings-holder', domHolder);
registry.set('WI-SP-button', domWiButton);

const domLoreButton = makeEl('div');
domLoreButton.className = 'chat_lorebook_button menu_button';
const domAvatarControls = makeEl('div');
domAvatarControls.setAttribute('id', 'avatar_controls');
domAvatarControls.appendChild(domLoreButton);
registry.set('avatar_controls', domAvatarControls);
bySelector.set('#avatar_controls .chat_lorebook_button', domLoreButton);

// 主面板容器（#movingDivs）与角色管理面板：用来验证主面板形态与优先级标记
const domMovingDivs = makeEl('div');
domMovingDivs.setAttribute('id', 'movingDivs');
registry.set('movingDivs', domMovingDivs);
const domRightNav = makeEl('div');
domRightNav.setAttribute('id', 'right-nav-panel');
domRightNav.className = 'drawer-content';
registry.set('right-nav-panel', domRightNav);

globalThis.document = {
    readyState: 'complete',
    body: makeEl('body'),
    head: makeEl('head'),
    documentElement: Object.assign(makeEl('html'), { clientHeight: 738, clientWidth: 1533 }),
    createElement: (t) => makeEl(t),
    createTextNode: (t) => ({ textContent: t }),
    getElementById: (id) => registry.get(id) || null,
    querySelector: (sel) => bySelector.get(sel) || null,
    querySelectorAll: () => [],
    addEventListener: () => { },
};

globalThis.window = globalThis;
globalThis.innerWidth = 1533;
globalThis.innerHeight = 738;
globalThis.addEventListener = () => { };
globalThis.removeEventListener = () => { };
Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => { }, readText: async () => '' } },
    configurable: true,
    writable: true,
});
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.TextEncoder = TextEncoder;
globalThis.URL = URL;
globalThis.Blob = class { constructor() { } };
globalThis.MutationObserver = class { observe() { } disconnect() { } };
globalThis.getComputedStyle = () => ({
    getPropertyValue(name) {
        if (name === '--sheldWidth') {
            return ' 900px';
        }
        if (name === '--topBarBlockSize') {
            return ' 40px';
        }
        if (name === '--bottomFormBlockSize') {
            return ' 70px';
        }
        return '';
    },
});
globalThis.confirm = () => true;
globalThis.alert = () => { };
globalThis.prompt = () => '';
globalThis.toastr = { info: () => { }, success: () => { }, warning: () => { }, error: () => { } };

/** 假的「服务器文件系统」，用于验证 jsonl 落盘/读回 */
const fakeFs = new Map();
/** 服务端补丁是否可用：false 模拟「没打补丁」—— 酒馆对未知 /api 路由回 404（HTML） */
let journalEndpointAvailable = true;
/** 端点调用记录 */
const journalCalls = [];
/** 模块私有资源（推特模块用它存 jsonl + 头像 + 横幅）：key = '<sub>|<name>' */
const assetFs = new Map();
const assetCalls = [];
globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.startsWith('/api/role-expansion/journal/')) {
        const body = JSON.parse(options.body || '{}');
        journalCalls.push({ route: u, body });
        if (!journalEndpointAvailable) {
            return { ok: false, status: 404, text: async () => 'Cannot POST ' + u, json: async () => ({}) };
        }
        const key = `${body.avatar_url}|${body.file_name}`;
        if (u.endsWith('/get')) {
            return { ok: true, status: 200, text: async () => '', json: async () => ({ exists: fakeFs.has(key), text: fakeFs.get(key) || '' }) };
        }
        fakeFs.set(key, String(body.text));
        return { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true }) };
    }
    if (u.startsWith('/api/role-expansion/asset/')) {
        const body = JSON.parse(options.body || '{}');
        assetCalls.push({ route: u, body });
        if (!journalEndpointAvailable) {
            return { ok: false, status: 404, text: async () => 'Cannot POST ' + u, json: async () => ({}) };
        }
        const key = String(body.sub) + '|' + String(body.name);
        const isText = String(body.name || '').endsWith('.jsonl');
        if (u.endsWith('/get')) {
            const exists = assetFs.has(key);
            const stored = assetFs.get(key) || '';
            return { ok: true, status: 200, text: async () => '', json: async () => (isText
                ? { exists, text: stored }
                : { exists, base64: stored, mime: String(body.name).endsWith('.jpg') ? 'image/jpeg' : 'image/png' }) };
        }
        if (u.endsWith('/delete')) {
            return { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true, removed: assetFs.delete(key) }) };
        }
        assetFs.set(key, String(body.text !== undefined ? body.text : body.base64));
        return { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true, bytes: 1 }) };
    }
    return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
};

const chat = [
    { is_user: true, name: '我', mes: '  你好啊  ' },
    { is_user: false, name: '角色', mes: '普通消息' },
    { is_user: false, name: '角色', mes: '你也好。<生命值>8/10</生命值><金币>99</金币>' },
];

const extensionSettings = {};
const chatMetadata = {};

/** 假的提示词管理器 + 假预设设置，用于验证「预设卡片」路径 */
const DUMMY_ID = 100001;
/** 角色卡字段：隔离通道随日记带入的角色设定来源；测试里可整体替换 */
let cardFields = {
    description: '银发，惯用短刀。',
    personality: '寡言，但护短。',
    persona: '同行者，话痨。',
    scenario: '雨夜的驿站。',
};

const fakeSettings = {
    preset_settings_openai: 'Default',
    prompts: [
        { identifier: 'main', name: 'Main Prompt', system_prompt: true, role: 'system', content: 'x' },
        { identifier: 'chatHistory', name: 'Chat History', marker: true },
        { identifier: 'jailbreak', name: 'Post-History Instructions', system_prompt: true, role: 'system', content: 'y' },
    ],
    prompt_order: [
        { character_id: DUMMY_ID, order: [{ identifier: 'main', enabled: true }, { identifier: 'worldInfoAfter', enabled: true }, { identifier: 'chatHistory', enabled: true }, { identifier: 'jailbreak', enabled: true }] },
    ],
};
let renderCount = 0;
/** 模拟 ST 侧的运行时正文源注册表 */
const runtimeSources = new Map();
const promptManager = {
    configuration: { prefix: 'completion_', promptOrder: { strategy: 'global', dummyId: DUMMY_ID } },
    serviceSettings: fakeSettings,
    activeCharacter: { id: 100000, name: '角色' },
    getPromptById(id) {
        return this.serviceSettings.prompts.find(p => p.identifier === id) ?? null;
    },
    getPromptOrderForCharacter(character) {
        let entry = this.serviceSettings.prompt_order.find(l => String(l.character_id) === String(character?.id));
        if (!entry) {
            entry = { character_id: character?.id, order: [] };
            this.serviceSettings.prompt_order.push(entry);
        }
        return entry.order;
    },
    /** 与 ST PromptManager.getPromptOrderEntry 一致：按 identifier 查条目，不存在返回 null */
    getPromptOrderEntry(character, identifier) {
        return this.getPromptOrderForCharacter(character).find(e => e.identifier === identifier) ?? null;
    },
    render() {
        renderCount += 1;
    },
};

globalThis.SillyTavern = {
    getContext: () => ({
        chat,
        chatMetadata,
        extensionSettings,
        name1: '我',
        name2: '角色',
        characterId: 0,
        // 群聊时为 selected_group；日记按角色目录存放，群聊没有角色目录（见 journalAvailability）
        groupId: null,
        characters: [{ name: '角色', avatar: '测试角色.png', chat: '角色/测试会话.jsonl' }],
        getCharacterCardFields: () => ({ ...cardFields }),
        getCurrentChatId: () => '角色/测试会话.jsonl',
        saveMetadata: () => { },
        saveSettingsDebounced: () => { },
        chatCompletionSettings: fakeSettings,
        promptManager,
        /** 模拟 ST 打上补丁后的 API；测试里可动态增删以覆盖两条分支 */
        registerRuntimePromptSource: (identifier, getContent) => {
            runtimeSources.set(String(identifier), getContent);
        },
        setExtensionPrompt: (key, value, position, depth, scan, role) => {
            captured[key] = { value, position, depth, scan, role };
        },
        substituteParams: (s) => String(s).replace(/\{\{char\}\}/g, '角色').replace(/\{\{user\}\}/g, '我'),
        generateQuietPrompt: async (params) => {
            quietCalls.push(params);
            return '# 测试\n这是日记正文。';
        },
        /** 隔离通道：ST 的 generateRaw —— 只发 prompt 本身，不带任何聊天上下文 */
        generateRaw: async (params) => {
            rawCalls.push(params);
            return nextRawText ?? '# 测试\n这是日记正文。';
        },
        renderExtensionTemplateAsync: async () => '',
        eventSource: {
            on: (evt, fn) => { (map[evt] = map[evt] || []).push(fn); },
            off: () => { },
        },
        event_types: {
            APP_READY: 'app_ready',
            CHAT_CHANGED: 'chat_id_changed',
            MESSAGE_RECEIVED: 'message_received',
            EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded',
            OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after',
            GENERATION_STARTED: 'generation_started',
        },
    }),
};

const map = {};
const captured = {};
/** 生成通道的调用记录（验证隔离 / 回退两条路径） */
const rawCalls = [];
const quietCalls = [];
/** 临时覆盖隔离通道的返回文本（用于验证推理块剥离） */
let nextRawText = null;

/** 触发所有注册在该事件上的监听器 */
function emit(type, ...args) {
    for (const fn of map[type] || []) {
        fn(...args);
    }
}

let failed = 0;
let total = 0;
function check(label, actual, expected) {
    total += 1;
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        failed += 1;
        console.log(`FAIL  ${label}\n      期望 ${JSON.stringify(expected)}\n      实际 ${JSON.stringify(actual)}`);
    } else {
        console.log(`ok    ${label}`);
    }
}

/** 深度优先收集满足 pred 的节点（stub DOM 没有 querySelectorAll，用它代替） */
const allNodes = (root, pred, out) => {
    const acc = out || [];
    const stack = [root];
    while (stack.length) {
        const node = stack.shift();
        if (!node) continue;
        if (pred(node)) acc.push(node);
        for (const child of (node.children || [])) stack.push(child);
    }
    return acc;
};

// 模块清单是 fetch 来的（浏览器里走酒馆的扩展路由）。自测在 Node 里跑，
// 这里把 file:// 的 fetch 接到 fs 上 —— 被测代码本身不需要任何 Node 专用分支。
// ⚠️ 必须**链在**上面那个 ST 桩之后：file:// 自己接 fs，其余（/api/files/*）原样转发，
//    否则会把桩顶掉，落盘相关断言会集体假失败。
const stFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input), 'http://localhost/');
    if (url.protocol === 'file:') {
        const text = readFileSync(fileURLToPath(url), 'utf8');
        return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
    }
    return stFetch(input, init);
};

await import('../index.js');
// ⚠️ 关键时序：运行时源必须在模块求值时就注册好，
// 否则预设首屏渲染拿不到「可编辑 / 可开关」授权，F5 后铅笔和开关会消失。
check('模块求值后立刻注册了运行时正文源（不依赖 APP_READY）',
    runtimeSources.has('roleExpansionJournal'), true);
// 首次渲染发生在 initOpenAI()（早于扩展激活），那一次拿不到授权；
// 必须主动补一次渲染，否则「不打开会话就看不到铅笔和开关」。
await new Promise(resolve => setTimeout(resolve, 450));
check('注册成功后主动补了一次提示词列表渲染（首屏就有铅笔/开关）', renderCount >= 1, true);
check('DOM 探针在列表未渲染时如实报 false（不抛异常）',
    globalThis.roleExpansion.probeCardControls(), { listRendered: false, found: false, edit: false, toggle: false, enabled: null });
// 新行为：模型只更新「已知状态名」。先按真实流程建立状态列表（等价于用户在面板里加过这两项）。
globalThis.roleExpansion.getStateList().push({ name: '生命值', value: '10/10' }, { name: '金币', value: '0' });
emit('message_received', chat.length - 1, 'normal');

const api = globalThis.roleExpansion;
check('模块导出 roleExpansion', typeof api, 'object');
check('默认设置：插入日记系统开关默认关闭', api.settings.journalInjectToJournal, false);
check('已删除旧模式的设置项（插入主聊天开关）', 'journalInjectToMain' in api.settings, false);
check('已删除旧模式的设置项（写入当前预设开关）', 'journalPresetCard' in api.settings, false);

const list = api.getStateList();
check('状态解析：生命值', list.find(x => x.name === '生命值')?.value, '8/10');
check('状态解析：金币', list.find(x => x.name === '金币')?.value, '99');
check('状态标签已从正文剥离', chat[2].mes, '你也好。');
check('无标签消息不受影响', chat[1].mes, '普通消息');

const prompt = api.buildJournalPrompt();
check('日记提示词含角色宏替换', prompt.includes('请以 角色 的第一人称'), true);
check('日记提示词含勾选楼层占位', prompt.includes('未选择任何聊天楼层'), true);
check('日记提示词注入状态列表', prompt.includes('生命值 8/10'), true);

api.ui.journal = [{
    id: 'j1', title: '标题A', content: '正文A', createdAt: 1, sourceMessageIds: [0], sourceJournalIds: [],
}];
api.ui.selectedJournalIds = new Set(['j1']);

// ============================================================================
// 以下：卡片由「用户在预设 JSON 里维护」—— 扩展只读关联，绝不写预设
// ============================================================================
promptManager.serviceSettings.prompts = promptManager.serviceSettings.prompts.filter(p => p.identifier !== 'roleExpansionJournal');
for (const list of promptManager.serviceSettings.prompt_order) {
    list.order = list.order.filter(e => e.identifier !== 'roleExpansionJournal');
}
api.ui.journal = [{ id: 'j1', title: '标题A', content: '正文A', createdAt: 1, sourceMessageIds: [0], sourceJournalIds: [] }];
api.ui.selectedJournalIds = new Set(['j1']);
delete captured.RoleExpansion_JournalMain;

const promptsRef = promptManager.serviceSettings.prompts;
const ordersRef = promptManager.serviceSettings.prompt_order;
const promptsSnapshot = JSON.stringify(promptsRef);
const ordersSnapshot = JSON.stringify(ordersRef);

// 卡片不存在时：扩展什么都不做（不创建）
const missing = api.readJournalCard();
check('卡片不存在时 readJournalCard 报 no-card', missing.reason, 'no-card');
check('卡片不存在时不会创建卡片', !!promptManager.getPromptById('roleExpansionJournal'), false);
check('卡片不存在时也不会碰 prompts 数组', JSON.stringify(promptsRef), promptsSnapshot);
check('卡片不存在时也不会碰 prompt_order', JSON.stringify(ordersRef), ordersSnapshot);
check('旧临时注入已被清理', captured.RoleExpansion_JournalMain?.value ?? '', '');

// 用户按 README 片段手动写入卡片（模拟真实操作）
promptsRef.push({
    identifier: 'roleExpansionJournal',
    name: '日记（角色扩展）',
    system_prompt: true,
    marker: true,
});
const dummyOrder = promptManager.getPromptOrderForCharacter({ id: DUMMY_ID });
const wiAfterIdx = dummyOrder.findIndex(e => e.identifier === 'worldInfoAfter');
dummyOrder.splice(wiAfterIdx + 1, 0, { identifier: 'roleExpansionJournal', enabled: true });
const activeOrder = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
activeOrder.push({ identifier: 'roleExpansionJournal', enabled: true });

const afterManual = api.readJournalCard();
check('手动写入后 readJournalCard 成功', afterManual.ok, true);
check('读到卡片为 marker', afterManual.marker, true);
check('读到卡片已启用', afterManual.enabled, true);

// 关键：扩展对预设是只读的 —— 任何操作都不应改动 prompts / prompt_order
const promptsSnapshot2 = JSON.stringify(promptsRef);
const ordersSnapshot2 = JSON.stringify(ordersRef);
api.updatePresetCardHint();
api.readJournalCard();
check('勾选/刷新状态不会改动 prompts 数组', JSON.stringify(promptsRef), promptsSnapshot2);
check('勾选/刷新状态不会改动 prompt_order', JSON.stringify(ordersRef), ordersSnapshot2);

check('已向 ST 注册运行时正文源', runtimeSources.has('roleExpansionJournal'), true);
check('运行时源在生成时给出日记正文', runtimeSources.get('roleExpansionJournal')().includes('正文A'), true);

const card = promptManager.getPromptById('roleExpansionJournal');
check('卡片字段由用户决定，扩展不增删', Object.keys(card).sort().join(','), 'identifier,marker,name,system_prompt');

// 用户把卡片拖到别处 —— 扩展当然也不会管（它根本不写 order）
const cardIdx = dummyOrder.findIndex(e => e.identifier === 'roleExpansionJournal');
const moved = dummyOrder.splice(cardIdx, 1)[0];
dummyOrder.unshift(moved);
const ordersSnapshot3 = JSON.stringify(ordersRef);
api.updatePresetCardHint();
api.readJournalCard();
check('扩展不会把用户拖动过的卡片挪回原位',
    dummyOrder.findIndex(e => e.identifier === 'roleExpansionJournal'), 0);
check('扩展不会为此改动 order', JSON.stringify(ordersRef), ordersSnapshot3);
// 复原位置，后续断言更直观
const backIdx = dummyOrder.findIndex(e => e.identifier === 'roleExpansionJournal');
dummyOrder.splice(backIdx, 1);
dummyOrder.splice(wiAfterIdx + 1, 0, moved);

// ---- 用户在预设里关掉卡片：扩展必须尊重这个开关，不再供文 ----
dummyOrder.find(e => e.identifier === 'roleExpansionJournal').enabled = false;
activeOrder.find(e => e.identifier === 'roleExpansionJournal').enabled = false;
check('预设卡片关掉后运行时源返回空串', runtimeSources.get('roleExpansionJournal')(), '');
check('预设卡片关闭后能读到「未启用」状态', api.isJournalCardEnabled(), false);

// ---- 用户在预设里重新打开：恢复供文 ----
dummyOrder.find(e => e.identifier === 'roleExpansionJournal').enabled = true;
activeOrder.find(e => e.identifier === 'roleExpansionJournal').enabled = true;
check('预设卡片打开后运行时源恢复正文', runtimeSources.get('roleExpansionJournal')().includes('正文A'), true);
check('预设卡片打开后能读到「已启用」状态', api.isJournalCardEnabled(), true);

// ---- 取消勾选：内容被清空但卡片条目保留 ----
api.ui.selectedJournalIds = new Set();
check('取消勾选后运行时源返回空串（等于停止注入）', runtimeSources.get('roleExpansionJournal')(), '');

// ---- 重新勾选：内容回来 ----
api.ui.selectedJournalIds = new Set(['j1']);
check('重新勾选后运行时源恢复正文', runtimeSources.get('roleExpansionJournal')().includes('正文A'), true);

// ---- 生成日记自身时，不得把自己的旧日记塞回请求（主判据 + 保险丝） ----
// 主判据：ui.generatingJournal —— 本插件自己发起的那次 Quiet 生成
api.ui.generatingJournal = true;
check('写日记期间运行时源返回空串（旧日记不会被塞回请求）',
    runtimeSources.get('roleExpansionJournal')(), '');
api.ui.generatingJournal = false;
check('写日记结束后运行时源恢复正文',
    runtimeSources.get('roleExpansionJournal')().includes('正文A'), true);

// 保险丝：GENERATION_STARTED 记录的生成类型（兜住其他扩展 / 命令发起的安静生成）
emit('generation_started', 'quiet');
check('quiet 生成时运行时源返回空串',
    runtimeSources.get('roleExpansionJournal')(), '');
// 黑名单不得误伤「重 roll / 重生成」—— 这两个同样是主聊天在生成回复
emit('generation_started', 'swipe');
check('swipe（重 roll）仍照常注入', runtimeSources.get('roleExpansionJournal')().includes('正文A'), true);
emit('generation_started', 'regenerate');
check('regenerate 仍照常注入', runtimeSources.get('roleExpansionJournal')().includes('正文A'), true);
emit('generation_started', 'normal');
check('normal 生成时运行时源恢复正文', runtimeSources.get('roleExpansionJournal')().includes('正文A'), true);

// 静态回归：假声明已移除、判据方向是黑名单
const extensionSrc = readFileSync(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8');

// 模块被拆出去之后，一部分「源码级」断言必须连模块一起看（否则一拆就假失败）。
// 目录整体不存在（全拆了）也要能跑，所以这里容错。
let moduleSrc = '';
try {
    const moduleDir = fileURLToPath(new URL('../modules', import.meta.url));
    for (const rel of readdirSync(moduleDir, { recursive: true })) {
        if (String(rel).endsWith('.js')) {
            moduleSrc += readFileSync(join(moduleDir, String(rel)), 'utf8');
        }
    }
} catch (e) {
    moduleSrc = '';
}
const allSrc = extensionSrc + moduleSrc;
check('已移除从未被读取的 TRIGGER 假声明', extensionSrc.includes("TRIGGER: ['normal']"), false);
check('生成类型黑名单存在且只含 quiet',
    /const NO_JOURNAL_INJECT_TYPES = new Set\(\['quiet'\]\)/.test(allSrc), true);
check('写日记时置位标志位并用 finally 复位',
    allSrc.includes('ui.generatingJournal = true') && allSrc.includes('ui.generatingJournal = false'), true);

// ---- 状态文案：区分「管理器未就绪 / 预览未就绪 / 预览就绪」 ----
const fakeHint = makeEl('div');
fakeHint.setAttribute('id', 'roleEx-preset-card-hint');
registry.set('roleEx-preset-card-hint', fakeHint);
api.updatePresetCardHint();
check('提示不再误报「没有提示词管理器」', fakeHint.textContent.includes('没有提示词管理器'), false);
check('未注入过时提示可点卡片名查看', fakeHint.textContent.includes('点预设里卡片的名字即可查看'), true);
check('状态显示已启用', fakeHint.textContent.includes('已启用（注入中）'), true);
check('启用状态带 🟢 标记（换符号时记得同步 README）',
    fakeHint.textContent.includes('🟢 已启用（注入中）'), true);

// 主面板只留一行状态；详情块（上面那个 fakeHint）搬到了酒馆「扩展」设置面板
const fakeStatus = makeEl('div');
fakeStatus.setAttribute('id', 'roleEx-inject-status');
registry.set('roleEx-inject-status', fakeStatus);
api.updatePresetCardHint();
check('主面板「提示词注入」显示单行状态', fakeStatus.textContent, '注入状态：🟢 已启用（注入中）');
const savedOrderGetter = promptManager.getPromptOrderEntry;
promptManager.getPromptOrderEntry = () => ({ enabled: false });
api.updatePresetCardHint();
check('卡片停用时该行跟着变（同一次计算，不会两处说法不一致）',
    fakeStatus.textContent, '注入状态：🔴 已停用（不注入）');
promptManager.getPromptOrderEntry = savedOrderGetter;
api.updatePresetCardHint();
registry.delete('roleEx-inject-status');

// 模拟「生成过一次」：messages 里有该 identifier
promptManager.messages = {
    hasItemWithIdentifier: (id) => id === 'roleExpansionJournal',
};
api.updatePresetCardHint();
check('注入过后提示查看本次内容', fakeHint.textContent.includes('可查看本次内容'), true);
promptManager.messages = null;

// 三种「读不到管理器」的措辞要能区分开，否则无从排查
const savedPm = globalThis.SillyTavern.getContext;

// a) 补丁是旧版：getContext() 里根本没有 promptManager（这是本次修的真实故障）
globalThis.SillyTavern.getContext = () => ({ ...savedPm(), promptManager: null });
api.updatePresetCardHint();
check('补丁旧版时提示「ST 补丁为旧版」', fakeHint.textContent.includes('ST 补丁为旧版'), true);
check('并提示重新应用补丁 + Ctrl+F5', fakeHint.textContent.includes('st-marker-prompt.patch'), true);
const diagNoPm = api.diagnoseJournalCard();
check('诊断里 promptManagerExposed=false', diagNoPm.promptManagerExposed, false);
check('诊断里 promptManagerReady=false', diagNoPm.promptManagerReady, false);

// b) 补丁已更新，但管理器还没建立（当前接口不是 Chat Completion）
globalThis.SillyTavern.getContext = () => ({ ...savedPm(), promptManager: {} });
api.updatePresetCardHint();
check('管理器未就绪时提示「尚未就绪」', fakeHint.textContent.includes('尚未就绪'), true);
const diagNotReady = api.diagnoseJournalCard();
check('诊断里 promptManagerExposed=true', diagNotReady.promptManagerExposed, true);
check('诊断里 promptManagerReady=false', diagNotReady.promptManagerReady, false);

// c) 一切正常
globalThis.SillyTavern.getContext = savedPm;
const diagOk = api.diagnoseJournalCard();
check('诊断里 promptManagerReady=true', diagOk.promptManagerReady, true);
check('诊断里能看到卡片存在', diagOk.existsInPrompts, true);
check('诊断里能看到卡片的顺序绑定', diagOk.bindings.length > 0, true);
check('诊断里 bindings 记录了前后邻居',
    diagOk.bindings.every(b => typeof b.prev === 'string' && typeof b.next === 'string'), true);
registry.delete('roleEx-preset-card-hint');

api.applyStateInjection();
check('状态注入：角色=system(0)', captured.RoleExpansion_State?.role, 0);
check('状态注入正文含状态', captured.RoleExpansion_State?.value.includes('生命值 8/10'), true);

// ---- jsonl 落盘往返（文件名必须是「单段」且符合 ST 的 ^[a-zA-Z0-9_\-.]+$） ----
const identity = api.currentChatIdentity();
const ST_NAME_RE = /^[a-zA-Z0-9_\-.]+$/;
check('文件名是单段（不含路径分隔符）', identity.fileName.includes('/'), false);
check('文件名符合 ST 的校验正则', ST_NAME_RE.test(identity.fileName), true);
check('文件名带固定前缀便于归组', identity.fileName.startsWith('RoleExpansion_journal_'), true);
check('文件名带角色/会话双 hash（保证互不冲突）',
    /^RoleExpansion_journal_c_[0-9a-f]{8}_j_[0-9a-f]{8}\.jsonl$/.test(identity.fileName), true);
check('两个不同会话会落到不同文件', (() => {
    const a = identity.fileName;
    const b = `RoleExpansion_journal_c_${identity.charSlug.replace('c_', '')}_j_deadbeef.jsonl`;
    return a !== b;
})(), true);
check('文件名以 .jsonl 结尾', identity.fileName.endsWith('.jsonl'), true);
check('会话名仍保留可读信息（记录在文件首行）', identity.charDir === '角色' && identity.chatFile === '测试会话', true);
check('identity 不再有「相对 user/files 的路径」这个概念', 'path' in identity, false);
check('落点文案 = 角色聊天目录下的私有子目录',
    api.journalPathText(identity.fileName), `chats/测试角色/_RoleExpansion/journals/${identity.fileName}`);

const safeKey = `测试角色.png|${identity.fileName}`;
api.ui.journal = [];
await api.addJournalEntry({ content: '# 标题B\n第一行正文\n第二行正文', sourceMessageIds: [0, 2] });
const fileText = fakeFs.get(safeKey) || '';
check('落盘走补丁端点 /api/role-expansion/journal/save',
    journalCalls.some(c => c.route === '/api/role-expansion/journal/save'), true);
check('落盘时带 avatar_url（服务端据此推导角色目录）',
    journalCalls.find(c => c.route === '/api/role-expansion/journal/save')?.body.avatar_url, '测试角色.png');
check('落盘 key = 头像 + 文件名', Array.from(fakeFs.keys())[0], safeKey);
check('会话头记录了可读会话名',
    JSON.parse(fileText.trim().split('\n')[0]).chatFile, '测试会话');
check('jsonl 行数 = 1 行会话头 + 1 篇日记', fileText.trim().split('\n').length, 2);
const line2 = fileText.trim().split('\n')[1];
check('正文换行被转义为字面 \\n（不破坏 jsonl 结构）', line2.includes(String.raw`\n`) && !line2.includes('\n'), true);
check('单行 JSON 可无损还原为对象', JSON.parse(line2).content, '第一行正文\n第二行正文');

// ---- 标题由模型随正文一起生成 ----
const parsedTitle = api.splitJournalResponse('<title>雨夜</title>\n她说她不生气。\n其实她只是怕。');
check('解析 <title> 标签作为标题', parsedTitle.title, '雨夜');
check('正文里不再残留 title 标签', parsedTitle.content, '她说她不生气。\n其实她只是怕。');
check('解析 markdown 首行标题', api.splitJournalResponse('# 别离\n正文一\n正文二').title, '别离');
check('解析【】首行标题', api.splitJournalResponse('【深夜】\n正文一').title, '深夜');
check('解析「标题：」形式', api.splitJournalResponse('标题：未寄出的信\n正文一').title, '未寄出的信');
check('无标题时退回空串（由调用方兜底日期）', api.splitJournalResponse('只有正文').title, '');

await api.reloadJournal();
check('读回后日记篇数', api.ui.journal.length, 1);
check('读回后标题（从 # 首行提取）', api.ui.journal[0].title, '标题B');
check('读回后正文首行已剥离', api.ui.journal[0].content.split('\n')[0], '第一行正文');

// 模型给的 <title> 会被落成日记标题，正文不含标签
api.ui.journal = [];
await api.addJournalEntry({ content: '<title>雨夜</title>\n她说她不生气。' });
check('addJournalEntry 采用模型给的标题', api.ui.journal[0].title, '雨夜');
check('标题标签不进正文', api.ui.journal[0].content, '她说她不生气。');

// ---- 示例预设（仓库里的参考预设）一致性 ----
// 优先用仓库内自带的示例（clone 下来就能跑自测），找不到时回退到开发机上仓库上一级的 test.json。
// 两者都没有（例如在不含 examples/ 的安装目录里跑自测）时明确跳过，而不是抛 ENOENT 中断整个测试。
const presetCandidates = [
    new URL('../examples/preset.example.json', import.meta.url),
    new URL('../../test.json', import.meta.url),
];
const foundPreset = presetCandidates.find(u => existsSync(u));
if (!foundPreset) {
    console.log('skip  示例预设一致性检查（未找到 examples/preset.example.json 或上一级 test.json；安装目录里属正常）');
} else {
    const preset = JSON.parse(readFileSync(fileURLToPath(foundPreset), 'utf8'));
    const sampleCard = (preset.prompts || []).find(p => p.identifier === 'roleExpansionJournal');
    check('示例预设：存在示例卡片', !!sampleCard, true);
    check('示例预设：卡片 system_prompt=true（Ordered Prompts 通道）', sampleCard?.system_prompt, true);
    check('示例预设：卡片 marker=true（正文由扩展运行时提供，形如 World Info (after)）', sampleCard?.marker, true);
    check('示例预设：卡片与 World Info (after) 字段完全对齐',
        Object.keys(sampleCard).sort().join(','),
        Object.keys((preset.prompts || []).find(p => p.identifier === 'worldInfoAfter')).sort().join(','));
    check('示例预设：卡片只保留最小字段',
        Object.keys(sampleCard).sort().join(','), 'identifier,marker,name,system_prompt');
    check('示例预设：identifier 与插件约定一致（可被扩展接管且不会重复生成）',
        sampleCard?.identifier === 'roleExpansionJournal', true);
    for (const block of preset.prompt_order || []) {
        const ids = block.order.map(e => e.identifier);
        const cardIdx = ids.indexOf('roleExpansionJournal');
        check(`示例预设：cid ${block.character_id} 卡片恰好一条`, ids.filter(x => x === 'roleExpansionJournal').length, 1);
        check(`示例预设：cid ${block.character_id} 卡片紧随 World Info (after) 之后`,
            cardIdx === ids.indexOf('worldInfoAfter') + 1, true);
        check(`示例预设：cid ${block.character_id} 卡片不再落在 charDescription 之后`,
            cardIdx === ids.indexOf('charDescription') + 1, false);
        check(`示例预设：cid ${block.character_id} 卡片未落在 chatHistory 之后`,
            cardIdx === ids.indexOf('chatHistory') + 1, false);
        check(`示例预设：cid ${block.character_id} 卡片 enabled=true`, block.order[cardIdx]?.enabled, true);
    }
}

// ---- 上传路径预校验（模拟 ST 的 validateAssetFileName：允许 '/'，但只允许 ASCII） ----
const ST_FILE_NAME_RE = /^[a-zA-Z0-9_\-./]+$/;
const chineseIdentity = api.currentChatIdentity();
check('中文会话名不进入文件名', ST_FILE_NAME_RE.test(chineseIdentity.path), true);
check('文件名里不含中文', /[\u4e00-\u9fa5]/.test(chineseIdentity.path), false);
check('中文会话路径仍可回溯（charDir/chatFile 原样保留）',
    chineseIdentity.charDir === '角色' && chineseIdentity.chatFile === '测试会话', true);

// ---- ST 补丁自身的回归检查（正文取到了却注入不进去 = 补丁漏了关键一段） ----
const patchText = readFileSync(fileURLToPath(new URL('../patches/st-marker-prompt.patch', import.meta.url)), 'utf8');
check('补丁：把注册的运行时源真正加进 chatCompletion（否则卡片永远注入不进去）',
    patchText.includes('for (const identifier of runtimePromptSources.keys())'), true);
check('补丁：逐条调用 addToChatCompletion（避免与相对位置循环重复添加）',
    patchText.includes('if (chatCompletion.has(identifier)) continue;'), true);
check('补丁：Prompt List 兜底预览按真实正文算 token（空内容=0，非 undefined）',
    patchText.includes('countTokenAsyncFn'), true);
check('补丁：不再把预览 token 写成 undefined', patchText.includes('previewMessage.tokens = undefined'), false);
check('补丁：没有引入 /api/presets/save（扩展侧对预设只读）', patchText.includes('/api/presets/save'), false);

// ---- 「注入设置」区块搬家：主面板不再有它，详情与跳转都进了扩展设置面板 ----
check('主面板不再有「注入设置」区块（整块已搬走）', allSrc.includes("text: '注入设置'"), false);
check('「打开预设面板」的接线还在（模块里：journal/ui.js 的 openPresetPanel）',
    allSrc.includes('function openPresetPanel()'), true);
const templateHtml = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
check('扩展设置面板模板只留一个「模块区块」容器（内容由模块自己建）',
    templateHtml.includes('id="roleEx-setting-module-blocks"'), true);
check('模板里没有硬编码的日记卡片诊断块（模块不在时不该残留「检测中…」）',
    templateHtml.includes('roleEx-preset-card-hint') || templateHtml.includes('roleEx-setting-open-preset'), false);
check('日记模块自带 settingsBlock（卡片诊断 + 打开预设面板都在模块里）',
    moduleSrc.includes('settingsBlock: () =>') && moduleSrc.includes("id: 'roleEx-setting-open-preset'"), true);
check('扩展设置面板不再保留旧的两条提示（已并入详情块，避免重复）',
    templateHtml.includes('roleEx-setting-journal-state') || templateHtml.includes('roleEx-setting-patch-state'), false);

// ---- 日记面板：两个区块可折叠（用酒馆原生 .inline-drawer，靠 document 级委托折叠） ----
const floorsFold = registry.get('roleEx-floors-fold');
const journalFold = registry.get('roleEx-journal-fold');
check('「参考聊天楼层」是 .inline-drawer（原生委托能折叠它）',
    String(floorsFold?.className).includes('inline-drawer'), true);
check('「参考聊天楼层」的标题头是直接子级的 .inline-drawer-header',
    String(floorsFold?.children?.find?.(c => String(c.className).includes('inline-drawer-header'))?.className).includes('inline-drawer-toggle'), true);
check('「日记列表」是 .inline-drawer', String(journalFold?.className).includes('inline-drawer'), true);
check('折叠图标初始为 up + fa-circle-chevron-up（原生用 toggleClass 互换）',
    String(floorsFold?.children?.[0]?.children?.find?.(c => String(c.className).includes('inline-drawer-icon'))?.className).includes('fa-circle-chevron-up'), true);

// ---- 角色设定三开关收在一个默认收起的折叠块里 ----
const cardFold = registry.get('roleEx-card-fold');
const cardFoldBody = cardFold?.children?.[1];
// 酒馆的 .inline-drawer-content 默认 display:none，所以展开态的块必须自己写 display:block。
// 只靠 CSS 默认的话会出现「图标朝上但内容收着」，与收起态的块方向相反，看着就像箭头写反。
check('「参考聊天楼层」默认展开（body 显式 display:block，不靠 CSS 默认）',
    floorsFold?.children?.[1]?.style?.display, 'block');
check('「日记列表」默认展开（body 显式 display:block，不靠 CSS 默认）',
    journalFold?.children?.[1]?.style?.display, 'block');

// ---- 「插入日记系统」从「注入设置」搬进「日记列表」，且排在「M 篇 · N 篇已勾选」上方 ----
const injectRow = registry.get('roleEx-inject-journal-row');
const listBody = journalFold?.children?.[1];
check('「插入日记系统」行在「日记列表」折叠体内', (listBody?.children || []).includes(injectRow), true);
check('它是折叠体的第一行，紧挨着计数行（勾选 → 用途 → 现状）',
    listBody?.children?.[0] === injectRow && listBody?.children?.[1] === registry.get('roleEx-storage-hint'), true);
check('该行读作「插入日记系统 / 作为「新日记」的参考提示词」',
    JSON.stringify([injectRow?.children?.[1]?.children?.[0]?.textContent, injectRow?.children?.[1]?.children?.[1]?.textContent]),
    JSON.stringify(['插入日记系统', '作为「新日记」的参考提示词']));
check('「角色设定（隔离通道）」也是 .inline-drawer', String(cardFold?.className).includes('inline-drawer'), true);
check('角色设定折叠的标题文案', cardFold?.children?.[0]?.children?.[0]?.textContent, '角色设定（隔离通道）');
check('角色设定的折叠图标初始为 down（收起态，与「参考聊天楼层」相反）',
    String(cardFold?.children?.[0]?.children?.find?.(c => String(c.className).includes('inline-drawer-icon'))?.className).includes('fa-circle-chevron-down'), true);
check('角色设定折叠默认收起（body 被设成 display:none）', cardFoldBody?.style?.display, 'none');
check('角色设定折叠体内有三个开关行',
    (cardFoldBody?.children || []).filter(c => String(c?.className).includes('roleEx-checkbox-row')).length, 3);

// ---- 外层 section 与内层 collapsible 必须用同一套箭头语义（收起 down / 展开 up） ----
const journalSectionEl = registry.get('roleEx-journal-section');
const journalSectionHead = journalSectionEl?.children?.[0];
const journalChevron = journalSectionHead?.children?.find?.(c => String(c.className).includes('roleEx-chevron'));
check('「日记」外层区块默认收起（所有模块的一级区块都默认折叠）', journalSectionEl?.children?.[1]?.style?.display, 'none');
check('默认收起时箭头是 down（不再用 right / 展开朝下那套）',
    String(journalChevron?.className).includes('fa-circle-chevron-down'), true);
journalSectionHead?.click();
check('点开后箭头变 up', String(journalChevron?.className).includes('fa-circle-chevron-up'), true);
check('点开后正文 display:block', journalSectionEl?.children?.[1]?.style?.display, 'block');
journalSectionHead?.click();
check('再点一次收起（还原现场）', journalSectionEl?.children?.[1]?.style?.display, 'none');
// 后面的断言都只读 DOM 结构，不需要它可见 —— 让它保持收起（顺便验证「默认折叠」这条约定）

// ---- 日记面板新增「提示词注入」区块，且必须排在「新日记」之上 ----
const journalBody = journalSectionEl?.children?.[1];
const injectBlockEl = registry.get('roleEx-inject-block');
const newJournalBlockEl = registry.get('roleEx-new-journal-block');
check('日记面板新增「提示词注入」区块', !!injectBlockEl, true);
check('「提示词注入」排在「新日记」之前',
    (journalBody?.children || []).indexOf(injectBlockEl) !== -1
    && (journalBody?.children || []).indexOf(injectBlockEl) < (journalBody?.children || []).indexOf(newJournalBlockEl), true);

// ---- 日记面板：「全选」「清空」是两个独立按钮（不再合并成一个会变文案的按钮） ----
const selectAllBtn = registry.get('roleEx-select-all');
const clearAllBtn = registry.get('roleEx-clear-all');
check('「全选」按钮存在', !!selectAllBtn, true);
check('「清空」按钮存在', !!clearAllBtn, true);
check('「全选」文案固定', selectAllBtn?.textContent, '全选');
check('「清空」文案固定', clearAllBtn?.textContent, '清空');
api.ui.journal = [{ id: 'a', title: 'A', content: 'x', createdAt: 1 }, { id: 'b', title: 'B', content: 'y', createdAt: 2 }];
api.ui.selectedJournalIds = new Set();
selectAllBtn?.click();
check('点「全选」勾选全部', api.ui.selectedJournalIds.size, 2);
check('点「全选」后文案不变', selectAllBtn?.textContent, '全选');
clearAllBtn?.click();
check('点「清空」取消全部勾选', api.ui.selectedJournalIds.size, 0);

// ---- 参考聊天楼层：去掉「最近 30 楼」，新增「第 N ~ M 楼」区间行 ----
const floorsFoldEl = registry.get('roleEx-floors-fold');
const floorButtons = [];
(function collect(node) {
    for (const child of node?.children || []) {
        if (String(child.className || '').includes('menu_button')) {
            floorButtons.push(String(child.textContent));
        }
        collect(child);
    }
})(floorsFoldEl);
check('楼层区不再有「最近 30 楼」', floorButtons.includes('最近 30 楼'), false);
check('楼层区保留「最近 10 楼」', floorButtons.includes('最近 10 楼'), true);
check('楼层区保留「全选 / 清空 / 刷新楼层」',
    ['全选', '清空', '刷新楼层'].every(t => floorButtons.includes(t)), true);
check('楼层区新增「选中区间」按钮', floorButtons.includes('选中区间'), true);
const fromInput = registry.get('roleEx-floor-from');
const toInput = registry.get('roleEx-floor-to');
check('区间起点输入框存在（number）', fromInput?.type, 'number');
check('区间终点输入框存在（number）', toInput?.type, 'number');
check('区间行内含起点 / 终点 / 应用按钮',
    [fromInput, toInput, registry.get('roleEx-floor-range-apply')].every(n => fromInput?.parentElement?.children?.includes(n)), true);
const foldBody = fromInput?.parentElement?.parentElement;
check('区间行单独占一行，且排在按钮行下面',
    String(foldBody?.className || '').includes('roleEx-fold-body')
    && foldBody?.children?.[1] === fromInput.parentElement
    && foldBody?.children?.[0] !== fromInput.parentElement, true);

// 空输入 / 非法输入都要给提示且不改动选择，不抛异常
api.ui.selectedFloors = new Set([9999]);
fromInput.value = '';
toInput.value = '';
registry.get('roleEx-floor-range-apply')?.click();
check('区间为空时不改动已有勾选', api.ui.selectedFloors.size, 1);
fromInput.value = 'abc';
toInput.value = '3';
registry.get('roleEx-floor-range-apply')?.click();
check('区间非数字时不改动已有勾选', api.ui.selectedFloors.size, 1);

// 正常区间：贴子里共有 3 楼（0/1/2），选 1~2 应得到 {1,2}
fromInput.value = '1';
toInput.value = '2';
registry.get('roleEx-floor-range-apply')?.click();
check('选中第 1~2 楼', Array.from(api.ui.selectedFloors).sort((a, b) => a - b), [1, 2]);
// 反向填写自动交换
fromInput.value = '2';
toInput.value = '1';
registry.get('roleEx-floor-range-apply')?.click();
check('反向填也得到同一区间', Array.from(api.ui.selectedFloors).sort((a, b) => a - b), [1, 2]);
check('应用后把归一化结果写回输入框', fromInput.value, '1');
check('终点输入框也同步为归一化后的值', toInput.value, '2');
// 越界区间：没有任何可用楼层 → 保持原选择不动
fromInput.value = '5';
toInput.value = '9';
registry.get('roleEx-floor-range-apply')?.click();
check('越界区间不改动原选择', Array.from(api.ui.selectedFloors).sort((a, b) => a - b), [1, 2]);

// ---- 日记面板：主提示词编辑器必须真的挂在面板里（曾出现过「建了但没 append」→ 功能凭空消失） ----
const mainPromptEl = registry.get('roleEx-journal-main-prompt');
check('日记主提示词编辑框存在', !!mainPromptEl, true);
check('编辑框里是当前设置的主提示词', mainPromptEl?.value, api.settings.journalMainPrompt);
const promptChain = [];
for (let n = mainPromptEl; n; n = n.parentElement) {
    promptChain.push(n.id || String(n.className || ''));
}
check('编辑框一路挂到日记面板 section 上（不是悬空的孤立节点）',
    promptChain.includes('roleEx-journal-section'), true);
check('主提示词区块默认收起但可点开（section 自带 roleEx-open 切换）',
    String(registry.get('roleEx-journal-section')?.children?.[0]?.className || '').includes('roleEx-section-header'), true);

// ---- 「关于」面板已取消：内容并入日记面板的存储说明，且不带版本号 ----
const storageNote = registry.get('roleEx-storage-note');
check('存储说明在日记面板里', !!storageNote, true);
check('存储说明不含版本号', /版本|version/i.test(String(storageNote?.innerHTML ?? '')), false);
const noteText = String(storageNote?.innerHTML ?? '');
check('存储说明指向角色聊天目录下的私有子目录',
    noteText.includes('chats/&lt;角色&gt;/_RoleExpansion/journals/RoleExpansion_journal') && noteText.includes('一篇日记一行'), true);
const scrollEl = registry.get('roleEx-scroll');
check('主面板里是「推特」「日记」「角色状态栏」三块', scrollEl?.children?.length, 3);
check('推特区块排在最上面（模块清单顺序）', String(scrollEl?.children?.[0]?.id || ''), 'roleEx-twitter-section');
check('推特区块横跨整行（roleEx-span-all）', scrollEl?.children?.[0]?.classList?.contains('roleEx-span-all'), true);
check('推特区块里有 iframe / 状态行 / 推文管理列表',
    !!registry.get('roleEx-twitter-frame') && !!registry.get('roleEx-twitter-status') && !!registry.get('roleEx-twitter-list'), true);

// ---- 「状态注入提示词」是「角色状态栏」面板内部的子区块 ----
const tplSectionEl = registry.get('roleEx-state-tpl-section');
check('状态注入提示词区块存在', !!tplSectionEl, true);
const tplChain = [];
for (let n = tplSectionEl; n; n = n.parentElement) {
    tplChain.push(n.id || '');
}
check('它挂在角色状态栏面板内（而不是和面板平级）', tplChain.includes('roleEx-state-section'), true);
check('注入提示词文本框能在其中被找到', !!registry.get('roleEx-state-inject-prompt'), true);

// ---- 顶部抽屉：按钮必须绑上自己的点击（酒馆是直接绑定 .drawer-toggle，不会认后插入的抽屉） ----
const clickListeners = Array.from(listeners.keys()).filter(k => k.endsWith(':click'));
check('抽屉按钮自己绑了 click（酒馆原生绑定不会覆盖后插入的抽屉）', clickListeners.length >= 2, true);
check('抽屉已插入到 World Info 之后', domHolder.children[1]?.id ?? registry.get('roleExpansion-button')?.id, 'roleExpansion-button');

// ---- 主面板：普通下拉面板形态（挂在 #movingDivs、与 #WorldInfo 同款） ----
const sidePanel = registry.get('roleExpansionPanel');
check('面板已挂到 #movingDivs', domMovingDivs.children.includes(sidePanel), true);
check('面板用的是 .drawer-content（与 #WorldInfo 同款）', String(sidePanel?.className).includes('drawer-content'), true);
check('面板初始为关闭（不带 openDrawer）', String(sidePanel?.className).includes('closedDrawer'), true);
check('面板带 roleEx-panel 类（z-index 由这条规则压到抽屉栈之下，不用 #movingDivs > div 的 4000）', String(sidePanel?.className).includes('roleEx-panel'), true);
check('面板宽度取 --sheldWidth', sidePanel?.style.width, '900px');
check('面板高度上限 = 视口 - 工具栏 - 输入栏 - 8（738-40-70-8）', sidePanel?.style.maxHeight, '620px');

// 角色管理面板打开时打上状态标记（面板层级已不靠 z-index 争抢，标记只作状态记录）
domRightNav.classList.add('openDrawer');
api.layoutMainPanel();
check('角色管理打开时打上标记', sidePanel?.classList.contains('roleEx-panel-over-nav'), true);
domRightNav.classList.remove('openDrawer');
api.layoutMainPanel();
check('角色管理关闭后标记清除', sidePanel?.classList.contains('roleEx-panel-over-nav'), false);

// ---- 羽毛图标点击：面板必须跟着开关 ----
const injectedDrawer = registry.get('roleExpansion-button');
const injectedContent = registry.get('roleExpansionPanel');
injectedContent?.classList.add('closedDrawer');
check('注入的抽屉能被找到', !!injectedDrawer && !!injectedContent, true);
check('初始为关闭', injectedContent?.classList.contains('closedDrawer'), true);
const liveIcon = injectedDrawer?.querySelector('.drawer-toggle')?.children?.[0];
check('羽毛图标可被定位', !!liveIcon, true);
liveIcon?.click();
check('点击羽毛图标后面板打开', injectedContent?.classList.contains('openDrawer'), true);
check('点击羽毛图标后图标变为 openIcon', liveIcon?.classList.contains('openIcon'), true);
check('点击后面板 display 切到 flex', injectedContent?.style.display, 'flex');
liveIcon?.click();
check('再点一次面板收起', injectedContent?.classList.contains('closedDrawer'), true);
check('再点一次面板 display 切回 none', injectedContent?.style.display, 'none');

// ---- 抽屉开关：直接调用也不依赖酒馆原生处理器 ----
api.toggleDrawerState();
check('直接调用后面板展开', sidePanel.classList.contains('openDrawer'), true);
check('直接调用后图标切换为 openIcon', liveIcon?.classList.contains('openIcon'), true);

api.toggleDrawerState();
check('再次调用收起', sidePanel.classList.contains('closedDrawer'), true);
check('再次调用图标回到 closedIcon', liveIcon?.classList.contains('closedIcon'), true);

// ============================================================================
// 端到端①：默认走隔离通道 generateRaw
// ============================================================================
api.ui.journal = [];
api.ui.selectedJournalIds = new Set();
api.ui.generatingJournal = false;
rawCalls.length = 0;
quietCalls.length = 0;
const promptBefore = api.buildJournalPrompt();
registry.get('roleEx-generate-journal')?.click();
await new Promise(resolve => setTimeout(resolve, 300));
check('生成日记结束后标志位已复位（finally 生效）', api.ui.generatingJournal, false);
check('生成日记已入库', api.ui.journal.length, 1);
check('生成日记不产生勾选副作用（不会顺手把新日记注入主聊天）', api.ui.selectedJournalIds.size, 0);
check('默认走隔离通道 generateRaw', rawCalls.length, 1);
check('隔离模式下不再调用 generateQuietPrompt', quietCalls.length, 0);
check('交给 generateRaw 的就是渲染好的日记提示词', rawCalls[0]?.prompt, promptBefore);
check('参数只有 prompt 与 systemPrompt（不带 prefill 等其它上下文）',
    Object.keys(rawCalls[0] ?? {}).join(','), 'prompt,systemPrompt');
check('角色设定按 描述 → 性格 → 用户设定 → 场景 的顺序拼装',
    String(rawCalls[0]?.systemPrompt ?? '').match(/【(角色描述|性格|用户设定|场景)】/g)?.join(','),
    '【角色描述】,【性格】,【用户设定】,【场景】');
check('角色设定走 systemPrompt（不是混进日记提示词）', String(rawCalls[0]?.systemPrompt ?? '').includes('银发'), true);
check('日记提示词本身不含角色设定', String(rawCalls[0]?.prompt ?? '').includes('银发'), false);

// ============================================================================
// 端到端①b：角色卡三开关（描述+性格 / 用户设定 / 场景）与预留覆盖字段
// ============================================================================
const rawSystem = () => String(rawCalls[0]?.systemPrompt ?? '');

// 关掉「角色描述 + 性格」→ 这两项都不在，其它两项不受影响
api.ui.journal = [];
rawCalls.length = 0;
api.settings.journalCardProfile = false;
registry.get('roleEx-generate-journal')?.click();
await new Promise(resolve => setTimeout(resolve, 300));
check('关掉「角色描述 + 性格」后两者都不注入', /【角色描述】|【性格】/.test(rawSystem()), false);
check('关掉「角色描述 + 性格」不影响用户设定与场景',
    /【用户设定】/.test(rawSystem()) && /【场景】/.test(rawSystem()), true);
api.settings.journalCardProfile = true;

// 只留「角色描述 + 性格」
api.ui.journal = [];
rawCalls.length = 0;
api.settings.journalCardPersona = false;
api.settings.journalCardScenario = false;
registry.get('roleEx-generate-journal')?.click();
await new Promise(resolve => setTimeout(resolve, 300));
check('关掉用户设定与场景后两者都不注入', /【用户设定】|【场景】/.test(rawSystem()), false);
check('只留「角色描述 + 性格」时两者都在',
    /【角色描述】/.test(rawSystem()) && /【性格】/.test(rawSystem()), true);
api.settings.journalCardPersona = true;
api.settings.journalCardScenario = true;

// 三项全关 → 与旧版行为一致（完全不传 systemPrompt）
api.ui.journal = [];
rawCalls.length = 0;
api.settings.journalCardProfile = false;
api.settings.journalCardPersona = false;
api.settings.journalCardScenario = false;
registry.get('roleEx-generate-journal')?.click();
await new Promise(resolve => setTimeout(resolve, 300));
check('三项全关时不传 systemPrompt（回到旧版行为）', Object.keys(rawCalls[0] ?? {}).join(','), 'prompt');
api.settings.journalCardProfile = true;
api.settings.journalCardPersona = true;
api.settings.journalCardScenario = true;

// 角色卡对应字段为空 → 不产生空标题，也不传 systemPrompt
const savedCardFields = { ...cardFields };
cardFields = { description: '', personality: '', persona: '', scenario: '' };
api.ui.journal = [];
rawCalls.length = 0;
registry.get('roleEx-generate-journal')?.click();
await new Promise(resolve => setTimeout(resolve, 300));
check('角色卡字段全为空时不传 systemPrompt（不留空标题）',
    Object.keys(rawCalls[0] ?? {}).join(','), 'prompt');
cardFields = savedCardFields;

// 只有一个字段有值 → 只出现那一个标题
cardFields = { description: '', personality: '', persona: '', scenario: '雨夜的驿站。' };
api.ui.journal = [];
rawCalls.length = 0;
registry.get('roleEx-generate-journal')?.click();
await new Promise(resolve => setTimeout(resolve, 300));
check('只有场景有值时就只输出场景标题',
    rawSystem().match(/【(角色描述|性格|用户设定|场景)】/g)?.join(','), '【场景】');
cardFields = savedCardFields;

// 预留字段：非空时整体接管
api.ui.journal = [];
rawCalls.length = 0;
api.settings.journalCharacterCardOverride = '【自定义设定】\n这是用户自己写的。';
registry.get('roleEx-generate-journal')?.click();
await new Promise(resolve => setTimeout(resolve, 300));
check('journalCharacterCardOverride 非空时整体接管角色设定块',
    rawCalls[0]?.systemPrompt, '【自定义设定】\n这是用户自己写的。');

// 预留字段优先于三个开关（即使三项全关也照样注入）
api.ui.journal = [];
rawCalls.length = 0;
api.settings.journalCardProfile = false;
api.settings.journalCardPersona = false;
api.settings.journalCardScenario = false;
registry.get('roleEx-generate-journal')?.click();
await new Promise(resolve => setTimeout(resolve, 300));
check('覆盖字段优先于三个开关（全关也照样注入）',
    rawCalls[0]?.systemPrompt, '【自定义设定】\n这是用户自己写的。');
api.settings.journalCardProfile = true;
api.settings.journalCardPersona = true;
api.settings.journalCardScenario = true;
api.settings.journalCharacterCardOverride = '';

// ============================================================================
// 端到端②：关掉隔离后回退到 quiet，并带上 skipWIAN
// ============================================================================
api.ui.journal = [];
api.settings.journalIsolatedGeneration = false;
rawCalls.length = 0;
quietCalls.length = 0;
registry.get('roleEx-generate-journal')?.click();
await new Promise(resolve => setTimeout(resolve, 300));
check('关闭隔离后回退到 quiet 通道', quietCalls.length, 1);
check('回退时不调用 generateRaw', rawCalls.length, 0);
check('回退时带上 skipWIAN（少让世界书参与）', quietCalls[0]?.skipWIAN, true);
check('回退时 quietToLoud 仍为 false（结果不进主聊天）', quietCalls[0]?.quietToLoud, false);
check('回退通道不额外拼角色卡（预设已提供，避免重复注入）',
    /【角色描述】/.test(String(quietCalls[0]?.quietPrompt ?? '')), false);
api.settings.journalIsolatedGeneration = true;

// ============================================================================
// 端到端③：隔离通道也会剥离推理块
// ============================================================================
api.ui.journal = [];
nextRawText = '<thinking>先想想这一篇要怎么写</thinking>\n<title>雨夜</title>\n她说她不生气。';
rawCalls.length = 0;
registry.get('roleEx-generate-journal')?.click();
await new Promise(resolve => setTimeout(resolve, 300));
nextRawText = null;
check('隔离通道先剥推理块，再解析出标题', api.ui.journal[0]?.title, '雨夜');
check('推理块不进日记正文', api.ui.journal[0]?.content, '她说她不生气。');
check('正文里不含 thinking 残留', String(api.ui.journal[0]?.content ?? '').includes('thinking'), false);

// ============================================================================
// 9.1：旧状态数据不得在「清空全部」之后复活
// ============================================================================
chatMetadata.sillyTavernState = [{ name: '幽灵状态', value: '1' }];
chatMetadata.roleExpansion = { state: [] };   // 模拟：本扩展这侧为空、且尚未迁移过
check('首次读取：遗留数据被迁入', api.getStateList().some(x => x.name === '幽灵状态'), true);
check('迁移后落下一次性标记', chatMetadata.roleExpansion.legacyMigrated, true);

api.getStateList().length = 0;                // 等价于点面板「清空全部」
check('清空后为空', api.getStateList().length, 0);
check('再次读取时旧数据没有复活', api.getStateList().some(x => x.name === '幽灵状态'), false);
check('遗留键本身保持原样（不删除用户数据）',
    Array.isArray(chatMetadata.sillyTavernState) && chatMetadata.sillyTavernState.length, 1);

// ============================================================================
// 9.4：非状态标签不得被吞掉
// ============================================================================
chatMetadata.roleExpansion = { state: [{ name: '生命值', value: '10/10' }], legacyMigrated: true };

chat.push({
    is_user: false,
    name: '角色',
    mes: '先想了想。<thinking>她大概会拒绝</thinking>然后回答。'
        + '<声望>5</声望><div>装饰</div><生命值>7/10</生命值>',
});
emit('message_received', chat.length - 1, 'normal');
const afterTags = chat[chat.length - 1].mes;
const stateNow = api.getStateList();

check('已知状态被更新', stateNow.find(x => x.name === '生命值')?.value, '7/10');
check('已知状态标签已从正文剥离', afterTags.includes('生命值'), false);
check('思维链标签不当状态', stateNow.some(x => x.name === 'thinking'), false);
check('未知名称默认不当状态', stateNow.some(x => x.name === '声望'), false);
check('HTML 裸标签不当状态', stateNow.some(x => x.name === 'div'), false);
check('被拒绝的标签原样留在正文里（不再误删内容）',
    afterTags.includes('<thinking>她大概会拒绝</thinking>')
    && afterTags.includes('<声望>5</声望>')
    && afterTags.includes('<div>装饰</div>'), true);

// 关掉「只接受已知状态名」后，恢复旧行为：新名称自动收录
api.settings.stateOnlyKnownNames = false;
chat.push({ is_user: false, name: '角色', mes: '获得新属性。<声望>6</声望>' });
emit('message_received', chat.length - 1, 'normal');
check('关闭限制后新名称可被收录',
    api.getStateList().some(x => x.name === '声望' && x.value === '6'), true);
// 黑名单与形状约束在关闭白名单后依然生效
chat.push({ is_user: false, name: '角色', mes: '推理。<analysis>不该被吃</analysis>' });
emit('message_received', chat.length - 1, 'normal');
check('关闭限制后推理标签仍被拒绝',
    api.getStateList().some(x => x.name === 'analysis'), false);
check('关闭限制后推理标签仍保留在正文',
    chat[chat.length - 1].mes.includes('<analysis>不该被吃</analysis>'), true);
api.settings.stateOnlyKnownNames = true;

// ---- 长度闸的精确行为：已知名称优先放行、长度按码点计 ----
// ① 已知的超长名称（13 个汉字）在限制开启时仍能更新 —— 用户自定义的名字不受启发式规则约束
chatMetadata.roleExpansion = { state: [{ name: '户外露出调教进度百分比数值', value: '0' }], legacyMigrated: true };
chat.push({
    is_user: false, name: '角色',
    mes: '进度变了。<户外露出调教进度百分比数值>40%</户外露出调教进度百分比数值>',
});
emit('message_received', chat.length - 1, 'normal');
check('已知的超长状态名（13 汉字）仍能被更新',
    api.getStateList().find(x => x.name === '户外露出调教进度百分比数值')?.value, '40%');
check('该标签已从正文剥离', chat[chat.length - 1].mes, '进度变了。');

// ② 长度闸只对未知名称生效：关掉已知名单限制后单独验证它
api.settings.stateOnlyKnownNames = false;
chatMetadata.roleExpansion = { state: [{ name: '生命值', value: '10/10' }], legacyMigrated: true };

// 7 个码点 / 8 个 UTF-16 code unit → 应当通过（旧实现按 .length 会误判）
chat.push({ is_user: false, name: '角色', mes: '营业中。<𠮷野家营业状态>营业中</𠮷野家营业状态>' });
emit('message_received', chat.length - 1, 'normal');
check('扩展区汉字按码点计数：7 码点通过长度闸',
    api.getStateList().some(x => x.name === '𠮷野家营业状态' && x.value === '营业中'), true);

// 14 个汉字 → 超过 12，被长度闸挡下，且标签原样保留
chat.push({
    is_user: false, name: '角色',
    mes: '长名。<这是一个非常长的未知标签名称>值</这是一个非常长的未知标签名称>',
});
emit('message_received', chat.length - 1, 'normal');
check('14 汉字的未知名称被长度闸挡下',
    api.getStateList().some(x => x.name === '这是一个非常长的未知标签名称'), false);
check('被挡下的长标签保留在正文里',
    chat[chat.length - 1].mes.includes('<这是一个非常长的未知标签名称>值</这是一个非常长的未知标签名称>'), true);
api.settings.stateOnlyKnownNames = true;

// ---- 模块系统：日记 / 角色状态栏都是可拆模块 ----
// 「可拆」的可验证部分是：模块清单、启用开关、以及模块不在时框架给的空壳（不抛）。
// 真正「删目录」的验证在 DEVELOPMENT.md §7 的手工清单里（自测桩里没法删文件）。
const moduleList = api.modules();
check('模块清单：推特 / 日记 / 角色状态栏都已加载并启用',
    moduleList.filter(m => m.installed && m.enabled).map(m => m.id).sort().join(','), 'journal,state,twitter');
check('模块清单带 installed / enabled / title（拆掉模块时 installed 会变 false）',
    moduleList.every(m => typeof m.installed === 'boolean' && typeof m.enabled === 'boolean' && 'title' in m), true);
check('settings.modules 是模块启用开关表（默认 {} = 全部启用）',
    JSON.stringify(api.settings.modules), '{}');

// ---- 清单文件驱动：加模块只改 modules/manifest.json，不用动框架代码 ----
// 读不到清单也要能跑到结尾（那时框架会走降级路径，这几条断言会红，但不该把测试打崩）
let manifestJson = null;
try {
    manifestJson = JSON.parse(readFileSync(fileURLToPath(new URL('../modules/manifest.json', import.meta.url)), 'utf8'));
} catch (e) {
    manifestJson = null;
}
check('modules/manifest.json 可解析，条目与已加载模块一致',
    manifestJson ? JSON.stringify(manifestJson.modules.map(m => m.id).sort()) : 'manifest-missing',
    JSON.stringify(moduleList.map(m => m.id).sort()));
const manifestInfo = api.moduleManifest();
check('清单快照：url 指向 modules/manifest.json，且没走降级路径',
    manifestInfo.url.endsWith('/modules/manifest.json') && manifestInfo.degraded === false, true);
check('框架源码里不再硬编码任何模块导入路径（清单驱动）',
    /modules\/journal\/index\.js|modules\/state\/index\.js/.test(extensionSrc), false);

// ---- 面板里不再有任何单项「恢复默认」按钮 ----
// 日记主提示词 / 状态注入提示词两处都删了，统一走扩展设置面板的「恢复默认设置」。
// 注：状态注入提示词那一处的按钮其实**一直挂在 DOM 里**，只是被不换行的 flex 行顶出面板、
// 被 overflow: hidden 裁掉了 —— 那是布局问题，自测的 stub DOM 没有排版能力，测不到，
// 所以这里只能守住「别再把它加回来」。布局约定见 DEVELOPMENT.md §4.5。
const strayReset = [];
(function walk(node) {
    for (const child of node?.children || []) {
        if (String(child.className || '').includes('menu_button') && String(child.textContent).trim() === '恢复默认') {
            strayReset.push(child);
        }
        walk(child);
    }
})(registry.get('roleExpansionPanel'));
check('面板里已无单项「恢复默认」按钮', strayReset.length, 0);

// ---- 「存为默认设置」/「恢复默认设置」：基准存在扩展设置容器的独立键里 ----
const builtinRefHeader = api.settings.journalRefHeader;
api.settings.journalRefHeader = '我存的自定义默认';
api.settings.journalInjectToJournal = true;
api.saveAsDefaults();
check('存为默认设置：快照写进扩展设置容器的独立键',
    !!extensionSettings['ST-RoleExpansion_defaults'], true);
check('快照不混进 settings 自身（settings 里没有这个键）',
    'ST-RoleExpansion_defaults' in extensionSettings['ST-RoleExpansion'], false);
api.settings.journalRefHeader = '后来又被改了';
api.settings.journalInjectToJournal = false;
api.resetToDefaults();
check('「恢复默认设置」恢复到自定义默认（多个键一起）',
    JSON.stringify([api.settings.journalRefHeader, api.settings.journalInjectToJournal]),
    JSON.stringify(['我存的自定义默认', true]));
api.clearCustomDefaults();
check('清除自定义默认：独立键被删掉', 'ST-RoleExpansion_defaults' in extensionSettings, false);
api.resetToDefaults();
check('清除后再「恢复默认设置」回到内置默认', api.settings.journalRefHeader, builtinRefHeader);

// 模板层面：两个按钮都在，且「存为默认设置」在上（先存再恢复）
check('扩展设置面板模板里有「存为默认设置」，且排在「恢复默认设置」之前',
    templateHtml.indexOf('roleEx-setting-save-defaults') !== -1
    && templateHtml.indexOf('roleEx-setting-save-defaults') < templateHtml.indexOf('id="roleEx-setting-reset"'), true);

// ---- 日记存储：缺补丁 / 群聊 → 明确不可用，不做回退 ----
journalEndpointAvailable = false;
const fsSizeBefore = fakeFs.size;
await api.reloadJournal();
check('缺补丁：原因判为 patch-missing', api.ui.journalError, 'patch-missing');
check('缺补丁：文案指向补丁文件',
    api.journalReasonText(api.ui.journalError).includes('patches/st-journal-store.patch'), true);
check('缺补丁：提示块打上 roleEx-warn',
    registry.get('roleEx-storage-hint')?.classList.contains('roleEx-warn'), true);
check('缺补丁：不会偷偷写回旧位置（文件数不变）', fakeFs.size, fsSizeBefore);
const probeBad = await api.probeJournalStorage();
check('缺补丁：探针如实报不可用', probeBad.ok, false);
journalEndpointAvailable = true;

// 群聊：没有角色目录 → 直接判不可用（连请求都不该发）
const savedCtx = globalThis.SillyTavern.getContext;
globalThis.SillyTavern.getContext = () => ({ ...savedCtx(), groupId: 'group-1' });
check('群聊：可用性判为 group', api.journalAvailability(), { ok: false, reason: 'group' });
check('群聊：文案说明为什么不可用（这条仍然打红字）',
    api.journalReasonText('group').includes('群聊不支持日记'), true);
const callsBeforeGroup = journalCalls.length;
await api.reloadJournal();
check('群聊：日记不可用原因是 group', api.ui.journalError, 'group');
check('群聊：不为不可用的场景发请求', journalCalls.length, callsBeforeGroup);
const probeGroup = await api.probeJournalStorage();
check('群聊：探针如实报不可用', probeGroup.ok, false);
globalThis.SillyTavern.getContext = savedCtx;
await api.reloadJournal();
check('切回单聊：错误状态清空', api.ui.journalError, null);
check('切回单聊：日记读得回来', api.ui.journal.length, 1);

// 「还没选角色」不是出错：存储说明换成中性文案、列表空态照旧、也不打红字
const savedCtxNoChar = globalThis.SillyTavern.getContext;
globalThis.SillyTavern.getContext = () => ({ ...savedCtxNoChar(), characters: {}, characterId: undefined });
await api.reloadJournal();
check('未选角色：原因是 no-character', api.ui.journalError, 'no-character');
const noCharHint = registry.get('roleEx-storage-hint');
check('未选角色：存储说明不打红字',
    noCharHint?.classList?.contains('roleEx-warn'), false);
check('未选角色：存储说明是一句中性的话（不再打印那句「还没有选择角色…」）',
    String(noCharHint?.textContent || '').includes('选一个角色后才有落点')
        && String(noCharHint?.textContent || '').includes('还没有选择角色') === false, true);
check('未选角色：列表空态说的是「本会话还没有日记。」',
    allNodes(registry.get('roleEx-journal-list'), n => String(n?.textContent || '').includes('本会话还没有日记')).length > 0, true);
check('未选角色：列表空态不打红字',
    allNodes(registry.get('roleEx-journal-list'), n => n?.classList?.contains('roleEx-warn')).length, 0);
globalThis.SillyTavern.getContext = savedCtxNoChar;
await api.reloadJournal();
check('拿回角色后：存储说明恢复成落点文案',
    String(registry.get('roleEx-storage-hint')?.textContent || '').includes('_RoleExpansion/journals/'), true);

// ---- 源码层面：日记不再走 /api/files，落点是补丁端点 ----
check('源码里不再有 files 写入接口调用',
    /fetch\([^)]*\/api\/files\//.test(allSrc), false);
check('源码里出现补丁端点前缀',
    allSrc.includes('/api/role-expansion/journal'), true);
check('源码注释里点明需要补丁', allSrc.includes('st-journal-store.patch'), true);
// ---- 推特模块：捕获 / 剥离 / 数字固化 / 置顶 / 落盘 / 不可用 ----
const twJsonlKey = () => [...assetFs.keys()].find(k => k.startsWith('twitter|RoleExpansion_twitter_') && k.endsWith('.jsonl'));
const twRaw = () => { const key = twJsonlKey(); return key ? assetFs.get(key) : ''; };
const twTweets = () => twRaw().split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(o => o && o.__roleExpansion === 'twitter');
const twFrameHtml = () => String(registry.get('roleEx-twitter-frame')?.srcdoc || '');
function nodeByText(root, text) {
    const stack = [root];
    while (stack.length) {
        const node = stack.shift();
        if (!node) continue;
        if (String(node.textContent) === text && String(node.className || '').includes('menu_button')) return node;
        for (const child of (node.children || [])) stack.push(child);
    }
    return null;
}

chat.push({ is_user: false, name: '角色', mes: '（她掏出手机）\n<推文时间>2小时前</推文时间><推文>今天去看海了🌊\n风很大。</推文>' });
emit('message_received', chat.length - 1, 'normal');
await new Promise(r => setTimeout(r, 40));
check('推特：捕获到 1 条推文', twTweets().length, 1);
check('推特：时间是就近配对的那条', twTweets()[0]?.time, '2小时前');
check('推特：正文换行原样保留', twTweets()[0]?.content, '今天去看海了🌊\n风很大。');
check('推特：标签已从正文剥离', chat[chat.length - 1].mes.includes('<推文'), false);
check('推特：剥离后不留多余空行', /\n{3,}/.test(chat[chat.length - 1].mes), false);
check('推特：落盘在 twitter 子目录、文件名带双 hash',
    assetCalls.some(c => c.route === '/api/role-expansion/asset/save' && String(c.body.name).startsWith('RoleExpansion_twitter_c_') && c.body.sub === 'twitter'), true);
check('推特：jsonl 三行结构（会话头 + 资料 + 推文）',
    twRaw().trim().split('\n').map(l => JSON.parse(l).__roleExpansion).join(','),
    'twitter-session,twitter-profile,twitter');

const twStats = twTweets()[0].stats;
check('推特：浏览在 500~50000 之间', twStats.view >= 500 && twStats.view <= 50000, true);
check('推特：点赞与浏览关联（≤8%）', twStats.like >= 1 && twStats.like <= Math.ceil(twStats.view * 0.08), true);
check('推特：转发与点赞关联（≤30%）', twStats.retweet <= Math.ceil(twStats.like * 0.3), true);
check('推特：评论与点赞关联（≤20%）', twStats.reply <= Math.ceil(twStats.like * 0.2), true);

await api.reloadTwitter();
check('推特：重新读盘后数字不变（生成即固化）', JSON.stringify(twTweets()[0].stats), JSON.stringify(twStats));

// 手改 JSONL：既验证「数字只能手改」，也验证 K 记法
const twKey0 = twJsonlKey();
const twLines = twRaw().trim().split('\n').map(l => JSON.parse(l));
const twTarget = twLines.find(o => o.__roleExpansion === 'twitter');
twTarget.stats = { view: 32400, like: 1234, retweet: 210, reply: 60 };
assetFs.set(twKey0, twLines.map(o => JSON.stringify(o)).join('\n') + '\n');
await api.reloadTwitter();
check('推特：手改 JSONL 的数字能被读回', JSON.stringify(twTweets()[0].stats),
    JSON.stringify({ view: 32400, like: 1234, retweet: 210, reply: 60 }));
check('推特：srcdoc 用 K 记法显示（1.2K / 32K）',
    twFrameHtml().includes('1.2K') && twFrameHtml().includes('32K'), true);

// 第二条推文（无时间）→ 新推文 seq 更大、排更上面
chat.push({ is_user: false, name: '角色', mes: '<推文>第二条推文。</推文>' });
emit('message_received', chat.length - 1, 'normal');
await new Promise(r => setTimeout(r, 40));
check('推特：第二条也收录了', twTweets().length, 2);
check('推特：新推文 seq 更大（排序依据）', twTweets()[1].seq > twTweets()[0].seq, true);
check('推特：没给时间就不显示时间那一行', twTweets()[1].time, '');

// 置顶：点管理列表里的「置顶」，只允许一条、且排在最上
const twList = registry.get('roleEx-twitter-list');
const twPinTargetId = twTweets()[1].id;
const twPinRow = (twList?.children || []).find(node => node?.dataset?.twitterId === twPinTargetId);
const pinButton = twPinRow ? nodeByText(twPinRow, '置顶') : null;
check('推特：管理列表里有「置顶」按钮', !!pinButton, true);
pinButton?.click();
await new Promise(r => setTimeout(r, 40));
check('推特：置顶生效且只有一条', twTweets().filter(t => t.pinned).length, 1);
check('推特：置顶的是刚点的那条', twTweets().find(t => t.pinned)?.id, twTweets()[1].id);
const twHtml = twFrameHtml();
check('推特：srcdoc 里置顶推文排在另一条之前',
    twHtml.indexOf('📌 置顶') !== -1 && twHtml.indexOf('📌 置顶') < twHtml.indexOf('今天去看海了'), true);
check('推特：srcdoc 里不含 <script>（高度与标签切换由父页面接管）', /<script/i.test(twHtml), false);
check('推特：srcdoc 里有四个数字（评论/转发/点赞/浏览）',
    twHtml.includes('💬') && twHtml.includes('🔄') && twHtml.includes('❤️') && twHtml.includes('📊'), true);

// ---- 一级区块默认折叠 / 资料区数字框 / 四个数字可在 UI 里改 ----
check('三个模块的一级区块都默认折叠',
    ['roleEx-twitter-section', 'roleEx-journal-section', 'roleEx-state-section']
        .every(id => registry.get(id)?.children?.[1]?.style?.display === 'none'), true);
check('推特区块的箭头默认是 down（收起态）',
    String(allNodes(registry.get('roleEx-twitter-section'), n => String(n.className).includes('roleEx-chevron'))[0]?.className || '').includes('fa-circle-chevron-down'), true);

// ---- 状态行 + 工具按钮塞进「推文管理」折叠块：那块默认收起，平时不占高度（≈70px 全给 iframe） ----
const twSectionEl = registry.get('roleEx-twitter-section');
const twHeaderEl = twSectionEl?.children?.[0];
const twBodyEl = twSectionEl?.children?.[1];
const twStatusEl = registry.get('roleEx-twitter-status');
const twManageBody = twStatusEl?.parentElement;
const twManageFoldEl = twManageBody?.parentElement;
check('推特：区块标题行只剩 [图标, 标题, 箭头]（没往折叠开关里塞控件）',
    (twHeaderEl?.children || []).length === 3 && !(twHeaderEl?.children || []).includes(twStatusEl), true);
check('推特：状态行在「推文管理」折叠块里（而且是排第一位的行）',
    String(twManageFoldEl?.children?.[0]?.children?.[0]?.textContent || ''), '推文管理');
check('推特：这个折叠块默认收起（display:none → 这两行平时不占高度）',
    twManageBody?.style?.display, 'none');
check('推特：「新增推文 / 刷新」也在这个折叠块里（顺序：状态 → 按钮行 → 说明 → 列表）',
    (twManageBody?.children || []).indexOf(twStatusEl) === 0
        && ((twManageBody?.children || [])[1]?.children || []).includes(registry.get('roleEx-twitter-add'))
        && ((twManageBody?.children || [])[1]?.children || []).includes(registry.get('roleEx-twitter-refresh'))
        && ((twManageBody?.children || [])[3]) === registry.get('roleEx-twitter-list'), true);
check('推特：正文直接子节点只剩 iframe + 三个折叠块（省下的两行给了 iframe）',
    (twBodyEl?.children || []).length === 4 && !(twBodyEl?.children || []).includes(twStatusEl), true);
check('推特：三个折叠块都带 roleEx-twitter-fold（标题行削薄那档样式）',
    allNodes(twSectionEl, n => n?.classList?.contains('roleEx-twitter-fold')).length, 3);

const twFollowersInput = allNodes(registry.get('roleEx-twitter-section'), n => n?.dataset?.twitterField === 'followers')[0];
const twFollowingInput = allNodes(registry.get('roleEx-twitter-section'), n => n?.dataset?.twitterField === 'following')[0];
check('资料区「粉丝 / 正在关注」是数字输入框',
    twFollowersInput?.type === 'number' && twFollowingInput?.type === 'number', true);

// 手改资料行的关注数 → reload → srcdoc 里按千分位显示
const twKeyProfile = twJsonlKey();
const twProfileLines = twRaw().trim().split('\n').map(l => JSON.parse(l));
const twProfileRow = twProfileLines.find(o => o.__roleExpansion === 'twitter-profile');
twProfileRow.following = '128';
twProfileRow.followers = '3240';
assetFs.set(twKeyProfile, twProfileLines.map(o => JSON.stringify(o)).join('\n') + '\n');
await api.reloadTwitter();
check('关注数按千分位显示（3240 → 3,240）', twFrameHtml().includes('3,240'), true);

// 点「编辑」→ 弹窗里四个数字可改 → 保存后落盘
const twEditRow = (registry.get('roleEx-twitter-list')?.children || []).find(node => node?.dataset?.twitterId === twPinTargetId);
const editButton = nodeByText(twEditRow, '编辑');
check('管理列表里有「编辑」按钮', !!editButton, true);
editButton?.click();
const modal = (document.body.children || []).find(node => String(node.className).includes('roleEx-modal'));
check('点「编辑」弹出编辑弹窗', !!modal, true);
const statInput = (key) => allNodes(modal, n => n?.dataset?.twitterStat === key)[0];
const modalTextarea = allNodes(modal, n => String(n.tagName) === 'TEXTAREA')[0];
check('弹窗里有四个数字输入框（评论 / 转发 / 点赞 / 浏览）',
    ['reply', 'retweet', 'like', 'view'].filter(key => !!statInput(key)).length, 4);
check('弹窗里数字已按当前值预填（不是空的）',
    ['reply', 'retweet', 'like', 'view'].every(key => String(statInput(key)?.value || '').trim() !== ''), true);
if (modalTextarea) {
    statInput('reply').value = '4242';
    statInput('like').value = '999';
    modalTextarea.value = '改过正文';
    nodeByText(modal, '保存')?.click();
    await new Promise(r => setTimeout(r, 80));
}
const twEdited = twTweets().find(t => t.id === twPinTargetId) || {};
check('UI 里改的数字写进了 JSONL', JSON.stringify([twEdited.stats?.reply, twEdited.stats?.like]), JSON.stringify([4242, 999]));
check('UI 里改的正文也落盘了', twEdited.content, '改过正文');
check('没动的那两个数字保持原值', typeof twEdited.stats?.retweet === 'number' && typeof twEdited.stats?.view === 'number', true);
check('弹窗保存后从 DOM 移除', (document.body.children || []).some(n => String(n.className).includes('roleEx-modal')), false);
const twCss = twFrameHtml().split('</style>')[0];
check('点赞 / 转发默认是灰的：粉色只由 .is-active 触发',
    twCss.includes('.tweet-action-like.is-active, .tweet-action-retweet.is-active { color: #f91880; }')
        && !/\.tweet-action-like \{ color:/.test(twCss), true);


// 模型输出里的 HTML 必须被转义，不能真的变成标签
chat.push({ is_user: false, name: '角色', mes: '<推文>试试 <b>加粗</b> 会不会生效。</推文>' });
emit('message_received', chat.length - 1, 'normal');
await new Promise(r => setTimeout(r, 40));
check('推特：正文里的 HTML 被转义', twFrameHtml().includes('&lt;b&gt;加粗&lt;/b&gt;'), true);

// 关掉剥离：标签留在正文里，但照常收录
api.settings.twitterStripTags = false;
chat.push({ is_user: false, name: '角色', mes: '<推文>不剥离测试。</推文>' });
emit('message_received', chat.length - 1, 'normal');
await new Promise(r => setTimeout(r, 40));
check('推特：关掉剥离后正文里仍留着标签', chat[chat.length - 1].mes.includes('<推文>'), true);
check('推特：关掉剥离也照常收录', twTweets().some(t => t.content === '不剥离测试。'), true);
api.settings.twitterStripTags = true;

// 孤立的时间标签：不动正文、不收录
chat.push({ is_user: false, name: '角色', mes: '<推文时间>3天前</推文时间>（只有时间标签，没有推文）' });
const twBeforeOrphan = twTweets().length;
emit('message_received', chat.length - 1, 'normal');
await new Promise(r => setTimeout(r, 40));
check('推特：孤立时间标签 → 不收录也不动正文',
    twTweets().length === twBeforeOrphan && chat[chat.length - 1].mes.includes('<推文时间>'), true);

// 总开关
api.settings.twitterCapture = false;
chat.push({ is_user: false, name: '角色', mes: '<推文>这个不该被收录。</推文>' });
emit('message_received', chat.length - 1, 'normal');
await new Promise(r => setTimeout(r, 40));
check('推特：关掉解析后不再收录', twTweets().some(t => t.content === '这个不该被收录。'), false);
api.settings.twitterCapture = true;

// 缺补丁：资源端点 404 → patch-missing，且不回退
journalEndpointAvailable = false;
await api.reloadTwitter();
check('推特：缺补丁 → 原因 patch-missing', api.describeTwitter().reason, 'patch-missing');
check('推特：状态行红字点出补丁名',
    String(registry.get('roleEx-twitter-status')?.textContent || '').includes('st-twitter-assets.patch'), true);
check('推特：状态文字同时写进 title（标题行里被省略号截断时悬停可见）',
    String(registry.get('roleEx-twitter-status')?.title || '').includes('st-twitter-assets.patch'), true);
check('推特：iframe 在不可用时藏起来', String(registry.get('roleEx-twitter-frame')?.style?.display || ''), 'none');
journalEndpointAvailable = true;

// 群聊：本地判不可用，连请求都不发
const twCallsBeforeGroup = assetCalls.length;
const savedCtx2 = globalThis.SillyTavern.getContext;
globalThis.SillyTavern.getContext = () => ({ ...savedCtx2(), groupId: 'g1' });
await api.reloadTwitter();
check('推特：群聊 → 原因 group', api.describeTwitter().reason, 'group');
check('推特：群聊时不发任何资源请求', assetCalls.length, twCallsBeforeGroup);
globalThis.SillyTavern.getContext = savedCtx2;
await api.reloadTwitter();
check('推特：切回单聊后恢复正常', api.describeTwitter().reason, null);

// 「还没选角色」不是本模块出错：状态留空、不打红字、也不弹 Toast（但真去写盘时仍会被拒）
const twSavedCtx3 = globalThis.SillyTavern.getContext;
globalThis.SillyTavern.getContext = () => ({ ...twSavedCtx3(), characters: {}, characterId: undefined });
await api.reloadTwitter();
check('推特：未选角色 → 原因 no-character', api.describeTwitter().reason, 'no-character');
check('推特：未选角色时状态行留空、不打红字',
    String(registry.get('roleEx-twitter-status')?.textContent || '') === ''
        && registry.get('roleEx-twitter-status')?.classList?.contains('roleEx-warn') === false, true);
check('推特：未选角色时 iframe 仍然藏起来（没有落点就不画页面）',
    String(registry.get('roleEx-twitter-frame')?.style?.display || ''), 'none');
globalThis.SillyTavern.getContext = twSavedCtx3;
await api.reloadTwitter();
check('推特：切回有角色的会话后恢复正常', api.describeTwitter().reason, null);

// ---- 关注 / 转发 / 点赞 的交互（点一下改数据并落盘，再点一下恢复） ----
// 交互一律**就地**改 iframe 里的一个 textContent + class，不重建 srcdoc（重建会重载 iframe = 看见刷新动画）。
// 所以断言分两层：数据层看落盘结果，渲染层先 reloadTwitter() 整帧重画再看 srcdoc。
const twProfileNow = () => twRaw().trim().split('\n').map(l => { try { return JSON.parse(l); } catch (err) { return null; } })
    .find(o => o && o.__roleExpansion === 'twitter-profile') || {};
const twById = (id) => twTweets().find(t => t.id === id) || {};

check('关注按钮初始是「关注」（带 btn-primary）',
    /class="btn btn-primary" id="tw-follow">关注</.test(twFrameHtml()), true);

const frameBeforeFollow = twFrameHtml();
const followOne = await api.toggleTwitterFollow();
check('点「关注」→ 返回 ok 且 followed 落盘为 true', followOne.ok === true && twProfileNow().followed, true);
check('点「关注」→ 粉丝数 +1', twProfileNow().followers, '3241');
check('点「关注」→ 不重建 srcdoc（没有刷新动画）', twFrameHtml(), frameBeforeFollow);
await api.reloadTwitter();
check('整帧重画后按钮是「正在关注」、不再是 btn-primary',
    /id="tw-follow">正在关注</.test(twFrameHtml()) && !/class="btn btn-primary" id="tw-follow"/.test(twFrameHtml()), true);
check('整帧重画后粉丝数也是新的（3,241）', twFrameHtml().includes('3,241'), true);
await api.toggleTwitterFollow();
check('再点一次 → followed 回到 false', twProfileNow().followed, false);
check('再点一次 → 粉丝数回到 3240', twProfileNow().followers, '3240');
await api.reloadTwitter();
check('整帧重画后回到「关注」+ btn-primary', /class="btn btn-primary" id="tw-follow">关注</.test(twFrameHtml()), true);

const twActionId = twTweets()[0].id;
const likeBase = Number(twById(twActionId).stats.like) || 0;
const frameBeforeLike = twFrameHtml();
const likeOne = await api.toggleTweetAction(twActionId, 'like');
check('点 ❤️ → 数值 +1', likeOne.ok === true && twById(twActionId).stats.like, likeBase + 1);
check('点 ❤️ → liked 落盘为 true', twById(twActionId).liked, true);
check('点 ❤️ → 不重建 srcdoc（就地改数字与 class）', twFrameHtml(), frameBeforeLike);
await api.reloadTwitter();
check('整帧重画后 ❤️ 带上 is-active（变粉）', /tweet-action-like is-active/.test(twFrameHtml()), true);
await api.toggleTweetAction(twActionId, 'like');
check('再点 ❤️ → 数值回到原值', twById(twActionId).stats.like, likeBase);
await api.reloadTwitter();
check('整帧重画后 liked 为 false 且不再 is-active',
    twById(twActionId).liked === false && !/tweet-action-like is-active/.test(twFrameHtml()), true);

const rtBase = Number(twById(twActionId).stats.retweet) || 0;
const frameBeforeRt = twFrameHtml();
await api.toggleTweetAction(twActionId, 'retweet');
check('点 🔄 → 数值 +1 且 retweeted 落盘为 true',
    twById(twActionId).stats.retweet === rtBase + 1 && twById(twActionId).retweeted === true, true);
check('点 🔄 → 不重建 srcdoc', twFrameHtml(), frameBeforeRt);
await api.reloadTwitter();
check('整帧重画后 🔄 带上 is-active', /tweet-action-retweet is-active/.test(twFrameHtml()), true);
await api.toggleTweetAction(twActionId, 'retweet');
check('再点 🔄 → 数值与标记都恢复', twById(twActionId).stats.retweet === rtBase && twById(twActionId).retweeted === false, true);
await api.reloadTwitter();
check('整帧重画后 🔄 不再是 is-active', !/tweet-action-retweet is-active/.test(twFrameHtml()), true);

// 写盘失败必须回滚，否则界面与磁盘会不一致
journalEndpointAvailable = false;
const frameBeforeFail = twFrameHtml();
const failLike = await api.toggleTweetAction(twActionId, 'like');
check('写盘失败 → 返回 ok:false', failLike.ok, false);
check('写盘失败 → srcdoc 一点没变（连 DOM 都没动）', twFrameHtml(), frameBeforeFail);
journalEndpointAvailable = true;
const retryLike = await api.toggleTweetAction(twActionId, 'like');
check('写盘失败后内存已回滚（重试得到 +1 而不是 +2）', retryLike.value, likeBase + 1);
await api.toggleTweetAction(twActionId, 'like');


// ---- 推文配图：有图渲染成 <img>，没图保持纯文字，文件读不到就不画（不裂图） ----
const twImageTags = () => (twFrameHtml().match(/class="tweet-image"/g) || []).length;
check('没有配图的推文渲染成纯文字样式（srcdoc 里没有 tweet-image）', twImageTags(), 0);

const twPngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64');
const twImgKey = twJsonlKey();
const twImgLines = twRaw().trim().split('\n').map(l => JSON.parse(l));
const twImgTweet = twImgLines.find(o => o.__roleExpansion === 'twitter');
twImgTweet.image = 'tweet-' + twImgTweet.id + '.png';
const twWriteJsonl = () => assetFs.set(twImgKey, twImgLines.map(o => JSON.stringify(o)).join('\n') + '\n');

assetFs.set('twitter|' + twImgTweet.image, twPngBase64);
twWriteJsonl();
await api.reloadTwitter();
check('配图渲染成 <img class="tweet-image">', twImageTags(), 1);
check('配图用 data URL 内联（不依赖静态路由）',
    twFrameHtml().includes('src="data:image/png;base64,' + twPngBase64), true);

assetFs.delete('twitter|' + twImgTweet.image);
await api.reloadTwitter();
check('配图文件读不到时不渲染 <img>（不会裂图）', twImageTags(), 0);

twImgTweet.image = '../../evil.png';
twWriteJsonl();
await api.reloadTwitter();
check('image 字段只认 tweet- 开头的单段 ASCII 名（写花了既不渲染、也不会漏进 srcdoc）',
    twImageTags() === 0 && twFrameHtml().includes('evil.png') === false, true);

const twImgRow = (registry.get('roleEx-twitter-list')?.children || []).find(n => n?.dataset?.twitterId === twImgTweet.id);
nodeByText(twImgRow, '编辑')?.click();
const twImgModal = (document.body.children || []).find(node => String(node.className).includes('roleEx-modal'));
check('编辑弹窗里有「配图」行（上传图片 / 清除配图）',
    !!nodeByText(twImgModal, '上传图片') && !!nodeByText(twImgModal, '清除配图'), true);
nodeByText(twImgModal, '取消')?.click();

twImgTweet.image = 'tweet-' + twImgTweet.id + '.png';
assetFs.set('twitter|' + twImgTweet.image, twPngBase64);
twWriteJsonl();
await api.reloadTwitter();
const twDelRow = (registry.get('roleEx-twitter-list')?.children || []).find(n => n?.dataset?.twitterId === twImgTweet.id);
nodeByText(twDelRow, '删除')?.click();
await new Promise(r => setTimeout(r, 80));
check('删除推文时连配图文件一起删掉', assetFs.has('twitter|' + twImgTweet.image), false);
check('删除后那条推文也没了', twTweets().some(t => t.id === twImgTweet.id), false);


// ---- 资料区「认证」复选框的回填（曾经少了 dataset 标记 → F5 后回到未勾选） ----
const twVerifiedInput = allNodes(registry.get('roleEx-twitter-section'), n => n?.dataset?.twitterField === 'verified')[0];
check('认证复选框带 dataset.twitterField 标记（fillProfileInputs 才认得出它）', !!twVerifiedInput, true);
check('默认（verified 未显式写 false）是勾选状态', twVerifiedInput?.checked, true);

const twVKey = twJsonlKey();
const twVLines = twRaw().trim().split('\n').map(l => JSON.parse(l));
const twVProfile = twVLines.find(o => o.__roleExpansion === 'twitter-profile');
const twVWrite = () => assetFs.set(twVKey, twVLines.map(o => JSON.stringify(o)).join('\n') + '\n');
twVProfile.verified = false;
twVWrite();
await api.reloadTwitter();
check('verified=false 时勾选框回到未勾选', twVerifiedInput?.checked, false);
twVProfile.verified = true;
twVWrite();
await api.reloadTwitter();
check('verified=true 时勾选框回到勾选', twVerifiedInput?.checked, true);


// ---- 仿推特页面：固定高度的一屏，资料头固定、只有推文列表内部滚 ----
// 背景（0.7.2 的 bug）：按内容量高度这条路走不通 —— 折叠块默认收起（display: none）时 iframe
// 没有布局盒，load 那一刻 scrollHeight 是 0，展开后不会再量第二次，于是页面永远停在占位高度，
// 第一张配图很高时下面的推文就再也看不到。所以改成 fixed height + 内部滚动：不量高度。
const twPaneHtml = twFrameHtml();
const twPane = twPaneHtml.slice(twPaneHtml.indexOf('class="tweets-container" id="tw-posts"'));
const twPaneUntilBody = twPane.slice(0, twPane.indexOf('</body>'));
check('推特：srcdoc 是固定高度的一屏（html/body 都 overflow: hidden，根视口不滚）',
    /html,\s*body\s*\{\s*height:\s*100%;\s*overflow:\s*hidden;\s*\}/.test(twPaneHtml), true);
check('推特：body 是 flex 竖排（头 + 列表两段）',
    /body\s*\{\s*display:\s*flex;\s*flex-direction:\s*column;/.test(twPaneHtml), true);
check('推特：资料头 .tw-head 不参与伸缩（固定不动）',
    twPaneHtml.includes('.tw-head { flex: 0 0 auto; }'), true);
check('推特：唯一的滚动容器是推文列表 #tw-posts',
    /\.tweets-container\s*\{\s*flex:\s*1 1 auto;\s*min-height:\s*0;\s*overflow-y:\s*auto;/.test(twPaneHtml), true);
check('推特：#tw-empty 在滚动容器里面（切标签时提示才出现在列表区）',
    twPaneUntilBody.includes('id="tw-empty"'), true);
check('推特：iframe 不带 scrolling="no"（能不能滚交给 CSS，不用这个老属性）',
    registry.get('roleEx-twitter-frame')?.getAttribute('scrolling'), undefined);

const twStyleSrc = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8');
const twFrameCss = twStyleSrc.slice(twStyleSrc.indexOf('.roleEx-twitter-frame {'), twStyleSrc.indexOf('}', twStyleSrc.indexOf('.roleEx-twitter-frame {')));
check('推特：iframe 高度由 CSS 写死（clamp，跟着视口），不再靠 JS 写 style.height',
    /height:\s*clamp\(/.test(twFrameCss), true);
check('推特：iframe 上不再有 min-height 占位（固定高度了）',
    /min-height/.test(twFrameCss), false);
await api.reloadTwitter();
check('推特：父页面完全不写 style.height', registry.get('roleEx-twitter-frame')?.style?.height, undefined);

// ---- 切换标签：滚动容器留在原地，只把里面的东西换成一句提示 ----
const twFrameEl = registry.get('roleEx-twitter-frame');
const twPostsEl = makeEl('div');
const twEmptyEl = makeEl('div');
const twNavButtons = ['posts', 'replies', 'likes'].map((tab) => {
    const btn = makeEl('button');
    btn.setAttribute('data-tab', tab);
    return btn;
});
twFrameEl.contentDocument = {
    body: {},
    documentElement: {},
    getElementById: (id) => (id === 'tw-posts' ? twPostsEl : (id === 'tw-empty' ? twEmptyEl : null)),
    querySelectorAll: (sel) => (sel === '.nav-tab' ? twNavButtons : []),
};
const twFrameLoad = listeners.get('roleEx-twitter-frame:load');
check('推特：iframe 的 load 事件接了线（和浏览器里同一条路径）', typeof twFrameLoad, 'function');
twFrameLoad();
check('推特：load 之后不会去量高度（没有任何 style.height 写入）', twFrameEl.style.height, undefined);
twNavButtons[2].click();
check('切到非「帖子」标签 → 滚动容器加 is-empty（里面的卡片靠 CSS 藏起来）',
    twPostsEl.classList.contains('is-empty'), true);
check('切到非「帖子」标签 → 提示显示在列表区且文案对得上标签名',
    twEmptyEl.style.display === 'block' && twEmptyEl.textContent.includes('「喜欢」'), true);
check('推特：滚动容器本身不能被藏（藏了就没得滚了）', twPostsEl.style.display, undefined);
twNavButtons[0].click();
check('切回「帖子」→ is-empty 撤掉、提示隐藏',
    twPostsEl.classList.contains('is-empty') === false && twEmptyEl.style.display === 'none', true);


// 源码层面：标签契约与端点前缀（改了名字而没改文档时能被这里挡住）
check('推特：源码里是 <推文> / <推文时间> 这套标签契约',
    allSrc.includes('<推文时间>') && allSrc.includes('<推文>') && allSrc.includes('</推文>'), true);
check('推特：走的是框架的资源通道，不自己拼 fetch',
    moduleSrc.includes('/api/role-expansion/asset') === false && allSrc.includes('/api/role-expansion/asset'), true);
const twModuleSrc = ['index', 'store', 'stats', 'capture', 'render', 'ui']
    .map(name => readFileSync(fileURLToPath(new URL('../modules/twitter/' + name + '.js', import.meta.url)), 'utf8'))
    .join('\n');
check('推特：模块源码里没有 <script>（srcdoc 里不放脚本）', twModuleSrc.includes('<script'), false);
check('推特：iframe 里三个交互都由父页面接线（wireFrame 里有对应选择器）',
    twModuleSrc.includes("getElementById('tw-follow')")
        && twModuleSrc.includes('.tweet-action-like')
        && twModuleSrc.includes('.tweet-action-retweet'), true);
check('推特：模块源码里没有自己拼 fetch（走框架的资源通道）', twModuleSrc.includes('fetch('), false);
check('推特：「还没选角色」不当错误显示（状态留空，不打红字）',
    twModuleSrc.includes("const quiet = rt.state.reason === 'no-character';"), true);


console.log(failed ? `\n${failed} / ${total} 项失败` : `\n全部通过（共 ${total} 项断言）`);
process.exit(failed ? 1 : 0);
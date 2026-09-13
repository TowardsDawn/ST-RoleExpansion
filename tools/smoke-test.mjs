/**
 * 静态自测：用最小 DOM/ST 桩加载 index.js，验证纯逻辑与环境初始化不抛异常。
 * 运行： node tools/smoke-test.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
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
globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u === '/api/files/upload') {
        const body = JSON.parse(options.body);
        fakeFs.set(body.name, Buffer.from(body.data, 'base64').toString('utf8'));
        return { ok: true, status: 200, text: async () => '', json: async () => ({ path: body.name }) };
    }
    if (u === '/api/files/delete') {
        const body = JSON.parse(options.body);
        fakeFs.delete(String(body.path).replace(/^user\/files\//, ''));
        return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    }
    if (u.startsWith('/user/files/')) {
        const path = decodeURIComponent(u.slice('/user/files/'.length));
        if (!fakeFs.has(path)) {
            return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
        }
        return { ok: true, status: 200, text: async () => fakeFs.get(path), json: async () => ({}) };
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
        characters: [{ name: '角色', chat: '角色/测试会话.jsonl' }],
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
check('已移除从未被读取的 TRIGGER 假声明', extensionSrc.includes("TRIGGER: ['normal']"), false);
check('生成类型黑名单存在且只含 quiet',
    /const NO_JOURNAL_INJECT_TYPES = new Set\(\['quiet'\]\)/.test(extensionSrc), true);
check('写日记时置位标志位并用 finally 复位',
    extensionSrc.includes('ui.generatingJournal = true') && extensionSrc.includes('ui.generatingJournal = false'), true);

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
check('文件名是单段（不含路径分隔符）', identity.path.includes('/'), false);
check('文件名符合 ST 的校验正则', ST_NAME_RE.test(identity.path), true);
check('文件名带固定前缀便于归组', identity.path.startsWith('RoleExpansion_journal_'), true);
check('文件名带角色/会话双 hash（保证互不冲突）',
    /^RoleExpansion_journal_c_[0-9a-f]{8}_j_[0-9a-f]{8}\.jsonl$/.test(identity.path), true);
check('两个不同会话会落到不同文件', (() => {
    const a = identity.path;
    const b = `RoleExpansion_journal_c_${identity.charSlug.replace('c_', '')}_j_deadbeef.jsonl`;
    return a !== b;
})(), true);
check('文件名以 .jsonl 结尾', identity.path.endsWith('.jsonl'), true);
check('会话名仍保留可读信息（记录在文件首行）', identity.charDir === '角色' && identity.chatFile === '测试会话', true);

const safePath = identity.path;
api.ui.journal = [];
await api.addJournalEntry({ content: '# 标题B\n第一行正文\n第二行正文', sourceMessageIds: [0, 2] });
const fileText = fakeFs.get(safePath) || '';
check('落盘位置正确', Array.from(fakeFs.keys())[0], safePath);
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
// 两者都没有（例如在不含 examples/ 的安装副本里跑自测）时明确跳过，而不是抛 ENOENT 中断整个测试。
const presetCandidates = [
    new URL('../examples/preset.example.json', import.meta.url),
    new URL('../../test.json', import.meta.url),
];
const foundPreset = presetCandidates.find(u => existsSync(u));
if (!foundPreset) {
    console.log('skip  示例预设一致性检查（未找到 examples/preset.example.json 或上一级 test.json；安装副本里属正常）');
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
check('「日记」外层区块默认展开', journalSectionEl?.children?.[1]?.style?.display, 'block');
check('外层区块展开时箭头是 up（不再用 right / 展开朝下那套）',
    String(journalChevron?.className).includes('fa-circle-chevron-up'), true);
journalSectionHead?.click();
check('外层区块收起后箭头变 down', String(journalChevron?.className).includes('fa-circle-chevron-down'), true);
check('外层区块收起后正文 display:none', journalSectionEl?.children?.[1]?.style?.display, 'none');
journalSectionHead?.click();
check('再次点击恢复展开（还原现场）', journalSectionEl?.children?.[1]?.style?.display, 'block');

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
check('存储说明保留文件路径与「一篇一行」', noteText.includes('user/files/RoleExpansion_journal') && noteText.includes('一篇日记一行'), true);
const scrollEl = registry.get('roleEx-scroll');
check('主面板里只剩「日记」「角色状态栏」两块（不再有关于面板）', scrollEl?.children?.length, 2);

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
check('面板带 roleEx-panel 类（z-index 走 #movingDivs > div 的 4000）', String(sidePanel?.className).includes('roleEx-panel'), true);
check('面板宽度取 --sheldWidth', sidePanel?.style.width, '900px');
check('面板高度上限 = 视口 - 工具栏 - 输入栏 - 8（738-40-70-8）', sidePanel?.style.maxHeight, '620px');

// 角色管理面板打开时打上优先级标记（z-index 4000 > 3000）
domRightNav.classList.add('openDrawer');
api.layoutMainPanel();
check('角色管理打开时标记为压在上面', sidePanel?.classList.contains('roleEx-panel-over-nav'), true);
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

console.log(failed ? `\n${failed} / ${total} 项失败` : `\n全部通过（共 ${total} 项断言）`);
process.exit(failed ? 1 : 0);

/**
 * modules/state/inject.js
 *
 * ⚠️ 主体是从 index.js 机械搬运过来的（章节：状态栏 → 主聊天系统 注入 / 状态栏：解析 AI 回复中的 <名称>值</名称> 标签），
 *    除下面的依赖头外没有改写 —— 保留原字节是为了 diff 干净、避免改坏字符串。
 *    依赖方向：框架设施由 kernel 注入；同模块跨文件用 rt.<key>.xxx 惰性转发；
 *    跨模块只走 kernel.service()，模块不在时取安全缺省。
 */

export function createStateInject(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它的字段快照）
    const { EXT_POSITION_IN_CHAT, EXT_PROMPT_KEY, EXT_ROLE_ASSISTANT, EXT_ROLE_SYSTEM, MAX_STATE_NAME_LENGTH, MODULE_NAME, NON_STATE_TAGS, ctx, getChatArray, renderTemplateString, settings, ui } = kernel;
    // 同模块、别的文件：惰性转发（调用时才取，绕开文件创建顺序的循环依赖）
    const getStateList = (...args) => rt.store.getStateList(...args);
    const renderStateList = (...args) => rt.ui.renderStateList(...args);
    const saveMetaDebounced = rt.store.saveMetaDebounced;

// 状态栏 → 主聊天系统 注入
// ============================================================================

function buildStateText() {
    const list = getStateList();
    if (!list.length) {
        return '';
    }
    return list.map(item => `${item.name} ${item.value}`).join('\n');
}

/**
 * 状态文本的**唯一**来源：注入槽与下面的「世界书扫描源」都取这一份 ——
 * 两处各拼一遍，迟早会因为改了一处而走样。
 *
 * 三道闸（总开关 / 注入开关 / 列表非空）在这里统一判：不满足就返回 ''，
 * 对注入侧的含义是「清空旧值」，对扫描侧的含义是「这段不贡献内容」。
 *
 * @returns {string}
 */
function buildStateInjectionText() {
    const list = getStateList();
    if (!settings.stateEnabled || !settings.stateAutoInject || !list.length) {
        return '';
    }
    return renderTemplateString(settings.stateInjectPrompt, { stateList: buildStateText() });
}

function applyStateInjection() {
    const c = ctx();
    if (typeof c?.setExtensionPrompt !== 'function') {
        return;
    }
    const text = buildStateInjectionText();
    // 空文本 = 上面三道闸没过（或模板被清空）→ 走清空路径，别让面板上留着上一次的状态内容。
    // 第 5 个参数保持 false：扫描源喂的是同一份文本，这里再标 scan 会让同一段正文在 haystack 里出现两次。
    if (!text) {
        c.setExtensionPrompt(EXT_PROMPT_KEY.STATE, '', EXT_POSITION_IN_CHAT, 0, false, EXT_ROLE_SYSTEM);
        return;
    }
    const role = settings.stateInjectRole === 'assistant'
        ? EXT_ROLE_ASSISTANT
        : (settings.stateInjectRole === 'user' ? 1 : EXT_ROLE_SYSTEM);
    const depth = Number.isFinite(Number(settings.stateInjectDepth)) ? Math.max(0, Math.trunc(Number(settings.stateInjectDepth))) : 0;
    c.setExtensionPrompt(EXT_PROMPT_KEY.STATE, text, EXT_POSITION_IN_CHAT, depth, false, role);
}

// 世界书扫描源：与注入**同源**（同一个 buildStateInjectionText()），但走的是另一条通道 ——
// ST 扫描时会把 scan=true 条目的正文塞进 haystack，那层不受 scan depth 截断、在所有扫描轮次都可见。
// 这里只在模块求值（工厂执行）时登记一次，不重试、不轮询：
// kernel.registerWiScanSource 对「补丁缺失 / 登记抛错」返回 false 而不抛；
// 且 getText 是每次扫描时才求值，所以补丁晚一步生效、用户中途改开关都能立刻反映。
kernel.registerWiScanSource('roleExpansionState', () => (settings.stateWIScan ? buildStateInjectionText() : ''));

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

    return { applyStateInjection, buildStateInjectionText, buildStateText, isStateTagName, onCharacterMessageReceived, parseAndStripStateTags };
}

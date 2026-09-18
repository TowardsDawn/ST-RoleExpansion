/**
 * modules/journal/inject.js
 *
 * ⚠️ 主体是从 index.js 机械搬运过来的（章节：日记 → 主聊天系统 注入（只读关联） / 日记内容 → 预设卡片（只读关联）），
 *    除下面的依赖头外没有改写 —— 保留原字节是为了 diff 干净、避免改坏字符串。
 *    依赖方向：框架设施由 kernel 注入；同模块跨文件用 rt.<key>.xxx 惰性转发；
 *    跨模块只走 kernel.service()，模块不在时取安全缺省。
 */

export function createJournalInject(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它的字段快照）
    const { EXT_POSITION_IN_CHAT, EXT_PROMPT_KEY, EXT_ROLE_ASSISTANT, ID, MODULE_NAME, PROMPT_MANAGER_PREFIX, ctx, logError, renderTemplateString, settings, ui } = kernel;
    // 同模块、别的文件：惰性转发（调用时才取，绕开文件创建顺序的循环依赖）
    const pickedJournals = (...args) => rt.generate.pickedJournals(...args);
    const renderJournalList = (...args) => rt.ui.renderJournalList(...args);
    const updatePresetCardHint = (...args) => rt.ui.updatePresetCardHint(...args);

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
// 当前生成类型由框架的 GENERATION_STARTED 处理器写进共享运行时（kernel.ui.currentGenerationType），
// 模块只读 —— 它是「这次生成是什么类型」这个跨模块事实，不是日记模块的私有状态。

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
            if (NO_JOURNAL_INJECT_TYPES.has(ui.currentGenerationType)) {
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

    return { NO_JOURNAL_INJECT_TYPES, PRESET_PROMPT, adoptCardStateFromPreset, buildJournalInjectionText, clearLegacyJournalInjection, currentPresetName, diagnoseJournalCard, ensureRuntimePromptSource, getPromptManager, isJournalCardEnabledInPreset, isPromptManagerExposed, logMarkerSupport, onJournalSelectionChanged, patchPromptManagerFirstRender, probeCardControls, probeStPatch, promptManagerFirstRenderPatched, promptManagerRenderTimer, readJournalCard, rerenderPromptManagerSoon, runtimeSourceForId, runtimeSourceKey, runtimeSourceRegistered, supportsMarkerPromptCard };
}

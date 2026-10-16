/**
 * modules/outfit/inject.js
 *
 * 与 modules/journal/inject.js 同一套「marker 卡片运行时正文源」（照搬改名）：
 *
 * 预设里由**用户自行**维护一张 marker: true 卡片（identifier = roleExpansionOutfit）；
 * 本扩展只做三件事：
 *   1) 注册运行时正文源 —— ST 每次生成时调它取当前已选的衣装，填进那张卡片；
 *   2) 读取卡片在 prompt_order 里的 enabled —— 那是「是否注入」的唯一开关；
 *   3) 可选地把**同一份正文**登记成世界书扫描源（设置 outfitWIScan 打开，见下面的「世界书扫描源」一节）。
 *
 * 扩展**不创建 / 不修改 / 不移动**卡片，不写预设文件，也不往酒馆的扩展提示词通道塞东西
 * （注入完全由那张卡片负责），更不把「是否注入」缓存进 settings。
 */

export function createOutfitInject(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它们的字段快照）
    const { MODULE_NAME, PROMPT_MANAGER_PREFIX, ctx, logError, renderTemplateString, settings } = kernel;
    // 同模块、别的文件：惰性转发（调用时才取，绕开文件创建顺序的循环依赖）
    const updateOutfitPresetCardHint = (...args) => rt.ui.updateOutfitPresetCardHint(...args);

/** 卡片在预设里的固定标识 */
const PRESET_PROMPT = {
    ID: 'roleExpansionOutfit',
    NAME: '衣装（角色扩展）',
    /** 预设编辑弹窗里「正文来源」处显示的来源名 */
    SOURCE_NAME: '角色扩展（衣装）',
};

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
// 「正文由运行时提供」的条目，于是预设里可以放一张 marker: true 的卡片，
// 正文由本扩展在生成时提供。补丁还会按 options 放开 marker 卡片的
// 「编辑（铅笔 + Prompt List 预览）」与「启停开关」——注入的开关就完全交给预设卡片自己管。
// 未打补丁时 registerRuntimePromptSource 不存在或忽略 options，下面会自动回退（返回 false）。

let runtimePromptRegistered = false;
let runtimeSourceForId = '';

/** identifier -> ST 侧的 key（ST 会把非单词字符换成 '_'） */
function runtimeSourceKey(identifier) {
    return String(identifier).replace(/\W/g, '_');
}

/** 提示词管理器（不存在时返回 null；调用方自己决定降级行为） */
function getPromptManager() {
    return ctx()?.promptManager ?? null;
}

/** ST 是否把 promptManager 暴露到了 getContext()（补丁新增；缺失时扩展读不到预设） */
function isPromptManagerExposed() {
    return !!ctx()?.promptManager;
}

/** ST 是否支持「扩展注册运行时正文源」（即是否已应用 patches/st-marker-prompt.patch） */
function supportsMarkerPromptCard() {
    return typeof ctx()?.registerRuntimePromptSource === 'function';
}

/**
 * 卡片在 prompt_order 里的条目：优先看当前角色的 order；角色没有独立 order 时看全局
 * dummy order（生成时用的是 dummy，见 ST 的 promptOrder.strategy = 'global'）。
 * 两处都查不到（卡片还没被插进任何 order）→ null。
 */
function findOutfitOrderEntry() {
    const pm = getPromptManager();
    if (!pm?.configuration) {
        return null;
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
        return own;
    }
    const dummyId = pm.configuration.promptOrder?.dummyId;
    if (dummyId === undefined || dummyId === null) {
        return null;
    }
    return entryFor({ id: dummyId });
}

/**
 * 卡片在预设里是否启用 —— 这是「是否注入主聊天」的唯一权威开关。
 * 卡片没插进任何 order（findOutfitOrderEntry() 为 null）时同样是 false。
 */
function isOutfitCardEnabledInPreset() {
    const entry = findOutfitOrderEntry();
    return !!entry && entry.enabled !== false;
}

/** 注入正文 = 模板 + 已选衣装；一个选中项都没有时返回空串 */
function buildOutfitInjectionText() {
    const list = rt.store.buildOutfitList();
    if (!list) {
        return '';
    }
    return renderTemplateString(settings.outfitInjectPrompt, { outfitList: list });
}

/** 确保已向 ST 注册本扩展的运行时正文源（含编辑 / 开关授权） */
function ensureRuntimePromptSource() {
    const c = ctx();
    const register = c?.registerRuntimePromptSource;
    const key = runtimeSourceKey(PRESET_PROMPT.ID);
    if (typeof register !== 'function') {
        return false;
    }
    if (runtimePromptRegistered && runtimeSourceForId === key) {
        return true;
    }
    // 卡片正文（组装期）与扫描正文（扫描期）**共用这一份** getContent：
    // 三道闸与正文拼装只有这一处实现，「世界书扫到的」与「卡片里注入的」永远同一份文本。
    const getContent = () => {
        // ① 卡片没插进任何 prompt_order 块 → 不注入（也就没有开关可谈）
        const entry = findOutfitOrderEntry();
        if (!entry) {
            return '';
        }
        // ② 卡片自己关掉了 → 不注入
        if (entry.enabled === false) {
            return '';
        }
        // ③ 正文为空（一个衣装项都没选）→ 不注入
        return buildOutfitInjectionText();
    };
    try {
        register(PRESET_PROMPT.ID, getContent, {
            name: PRESET_PROMPT.SOURCE_NAME,
            edit: true,
            toggle: true,
        });
        runtimePromptRegistered = true;
        runtimeSourceForId = key;
        // 卡片这条路先立起来，扫描是它的可选附加（登记失败也不影响上面那一步）
        ensureWiScanSource(getContent);
        patchPromptManagerFirstRender();
        return true;
    } catch (e) {
        logError('registerRuntimePromptSource failed', e);
        return false;
    }
}

// --- 世界书扫描源（需要 ST 侧 st-wi-scan-source 补丁） -------------------------
// 为什么必须另登记一份：世界书扫描（ST 的 checkWorldInfo()）在扫描开始时遍历 extensionPrompts，
// 只挑 scan === true 的条目把正文塞进 haystack；卡片走的是「运行时正文源」，它**不在** extensionPrompts
// 里，所以扫不到。而那一层 haystack 不受 scan depth 截断、在所有扫描轮次（含递归轮）都可见 ——
// 「衣装里的词也能触发世界书条目」只能靠这里单独登记。
//
// ⚠️ 这里有两个互不相干的开关：卡片开关管「注入主聊天」，outfitWIScan 管「参与世界书扫描」。

/** 世界书扫描源标识（刻意与卡片 identifier 同一个字符串：一个模块一个标识，排查时一眼对得上） */
const WI_SCAN_SOURCE_ID = PRESET_PROMPT.ID;

let wiScanRegistered = false;
let wiScanSourceForId = '';

/**
 * 把卡片正文源登记成世界书扫描源。
 *
 * ★ 开关只包在**外面**这一层，绝不把 settings.outfitWIScan 读进 getContent 本体：
 *   getContent 是两个通道共用的同一份，「关掉世界书扫描」不该顺带把预设卡片也变成没有正文
 *   —— 那是两个功能，不能连坐。
 *
 * 幂等与失败处理沿用本文件既有写法（runtimePromptRegistered 那一对记忆变量、失败不抛、logError）：
 * 只在运行时源注册成功之后登记一次；补丁缺失时 kernel.registerWiScanSource 返回 false
 * （它自己 warn，不抛），这里**不报错、不重试** —— 没登记上本身可降级（大不了衣装不参与世界书扫描），
 * 而「这一项不可用」由界面用 kernel.supportsWiScanSource() 明说，不静默。
 *
 * @param {() => string} getContent 卡片正文源（与组装期同一个函数）
 * @returns {boolean} 是否登记成功
 */
function ensureWiScanSource(getContent) {
    if (typeof kernel.registerWiScanSource !== 'function') {
        // 旧版框架没有这个成员：按「不支持」处理，同样不抛（界面那侧照常给出禁用说明）
        return false;
    }
    if (wiScanRegistered && wiScanSourceForId === WI_SCAN_SOURCE_ID) {
        return true;
    }
    const ok = kernel.registerWiScanSource(WI_SCAN_SOURCE_ID, () => (settings.outfitWIScan ? getContent() : ''));
    if (ok) {
        wiScanRegistered = true;
        wiScanSourceForId = WI_SCAN_SOURCE_ID;
    }
    return ok;
}

/**
 * 检查「在浏览器里实际运行的那份 PromptManager」是否带补丁。
 *
 * 为什么要这样做：`getContext().registerRuntimePromptSource` 只能证明 `openai.js` 是新的，
 * 而「卡片有没有开关 / 铅笔」取决于 `PromptManager.js` 的两个方法。
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
 * probeStPatch() 只能证明方法源码是新的，证明不了当前这一行是用带授权的那份代码渲染的。
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
    const sourceRegistered = runtimePromptRegistered;
    if (marker && probe.patchedToggle && probe.patchedEdit) {
        console.info(`[${MODULE_NAME}] ST 补丁已生效（衣装）：`
            + `registerRuntimePromptSource=${marker}`
            + ` / PromptManager.isPromptToggleAllowed 已放行=${probe.patchedToggle}`
            + ` / isPromptEditAllowed 已放行=${probe.patchedEdit}`
            + ` / handleInspect 支持即时预览=${probe.patchedInspect}`
            + ` / 运行时源已注册=${sourceRegistered}`);
    } else {
        console.warn(`[${MODULE_NAME}] ST 补丁不完整，衣装卡片会没有开关/铅笔。`, probe);
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
    updateOutfitPresetCardHint();
}

/** 读取卡片在预设里的形态（供 UI 展示）；不修改任何东西 */
function readOutfitCard() {
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
        enabled: isOutfitCardEnabledInPreset(),
    };
}

/**
 * 诊断：返回当前预设里这张卡片的真实状态（只读）。
 *
 * ⚠️ 本扩展**不创建、不修改、不移动**预设卡片 —— 卡片由用户在预设 JSON 里自行维护。
 * quiet = true 时只算不打印：渲染路径上会反复调用它，不该把控制台刷满。
 *
 * @returns {object} 快照
 */
function diagnoseOutfitCard({ quiet = false } = {}) {
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
            sourceRegistered: runtimePromptRegistered,
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
        if (!quiet) {
            console.warn(`[${MODULE_NAME}] 诊断：getContext().promptManager 不存在。`
                + '说明 ST 补丁是旧版（只加了 registerRuntimePromptSource，没暴露 promptManager），'
                + '请重新应用 patches/st-marker-prompt.patch 并 Ctrl+F5。');
        }
        return out;
    }
    if (!out.promptManagerReady) {
        if (!quiet) {
            console.warn(`[${MODULE_NAME}] 诊断：提示词管理器存在但未初始化`
                + '（promptManager.serviceSettings 为空）—— 通常是当前接口不是 Chat Completion 类。', out);
        }
        return out;
    }
    const prompt = pm.getPromptById(PRESET_PROMPT.ID);
    if (prompt) {
        out.existsInPrompts = true;
        out.promptKeys = Object.keys(prompt);
        out.marker = prompt.marker === true;
    }
    // 每个 prompt_order 块里该条目的位置
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
    out.enabled = isOutfitCardEnabledInPreset();
    if (!quiet) {
        console.info(`[${MODULE_NAME}] 诊断：衣装卡片状态`, out);
    }
    return out;
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
 *   initOpenAI()       ← 首次渲染预设列表
 *   initExtensions()   ← 扩展脚本此刻才求值、才注册运行时源
 * 首次渲染发生在我们注册**之前**，那一次查不到授权 → 那一行没有铅笔和开关；
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

    return {
        PRESET_PROMPT,
        adoptCardStateFromPreset, buildOutfitInjectionText, currentPresetName, diagnoseOutfitCard,
        ensureRuntimePromptSource, ensureWiScanSource, findOutfitOrderEntry, getPromptManager,
        isOutfitCardEnabledInPreset,
        isPromptManagerExposed, logMarkerSupport, patchPromptManagerFirstRender, probeCardControls,
        probeStPatch, promptManagerFirstRenderPatched, promptManagerRenderTimer, readOutfitCard,
        rerenderPromptManagerSoon, runtimePromptRegistered, runtimeSourceForId, runtimeSourceKey,
        supportsMarkerPromptCard,
        // 框架桥接壳用的别名（同一个函数，名字对齐 index.js 里已落地的 callOutfit 调用）
        ensureOutfitRuntimeSource: ensureRuntimePromptSource,
        adoptOutfitCardStateFromPreset: adoptCardStateFromPreset,
    };
}

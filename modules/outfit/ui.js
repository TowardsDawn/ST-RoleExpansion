/**
 * modules/outfit/ui.js
 *
 * 主面板里的「衣装打扮」区块：一行状态 + 左右两栏（左预览 / 右编辑器）+ 注入模板折叠块。
 *
 * 层次规矩与推特 / 状态栏一致：正文里是**平铺内容 + 同级折叠块**，
 * 不套 .roleEx-block、也不出现嵌套的 .roleEx-section（折叠块自己的 header 就是标题）。
 *
 * 面板只做三件事：读 store 的画、把用户操作转成 store 的调用、成功才重画。
 * 所有写盘与回滚都在 store 里（失败由它 toast），这里只负责把界面拉回真实状态。
 */

export function createOutfitUi(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它们的字段快照）
    const { collapsible, debounce, el, iconFor, section, settings, toast, updateSetting } = kernel;
    // 同模块、别的文件：惰性转发（调用时才取，绕开文件创建顺序的循环依赖）
    const PARTS = rt.store.PARTS;
    const addCustomCategory = (...args) => rt.store.addCustomCategory(...args);
    // 页面级原因（补丁 / 白名单）的重探开关：面板打开时给一次机会，见 renderOutfit()
    const armOutfitReprobe = (...args) => rt.store.armOutfitReprobe(...args);
    const getCatalog = (...args) => rt.store.getCatalog(...args);
    const getSelection = (...args) => rt.store.getSelection(...args);
    const isCategoryNameTaken = (...args) => rt.store.isCategoryNameTaken(...args);
    const loadOutfit = (...args) => rt.store.loadOutfit(...args);
    const outfitAvailability = (...args) => rt.store.outfitAvailability(...args);
    const outfitPathText = (...args) => rt.store.outfitPathText(...args);
    // 不可用文案由 store 给：sub-not-allowed（白名单里没有 outfit）框架不认识，必须本模块自己说
    const outfitReasonText = (...args) => rt.store.outfitReasonText(...args);
    const removeCustomCategory = (...args) => rt.store.removeCustomCategory(...args);
    const renameCustomCategory = (...args) => rt.store.renameCustomCategory(...args);
    const setCategoryTags = (...args) => rt.store.setCategoryTags(...args);
    const togglePicked = (...args) => rt.store.togglePicked(...args);
    const PRESET_PROMPT = rt.inject.PRESET_PROMPT;
    const currentPresetName = (...args) => rt.inject.currentPresetName(...args);
    const diagnoseOutfitCard = (...args) => rt.inject.diagnoseOutfitCard(...args);
    const isPromptManagerExposed = (...args) => rt.inject.isPromptManagerExposed(...args);
    const probeCardControls = (...args) => rt.inject.probeCardControls(...args);
    const probeStPatch = (...args) => rt.inject.probeStPatch(...args);
    const readOutfitCard = (...args) => rt.inject.readOutfitCard(...args);
    const supportsMarkerPromptCard = (...args) => rt.inject.supportsMarkerPromptCard(...args);

/** 面板里的 DOM 引用（面板每次重建都会换新，所以放在 rt.state 上） */
function panelRefs() {
    return rt.state.panel || null;
}

/** 正文里总共选中了多少个 tag */
function pickedCount() {
    const selection = getSelection();
    return Object.keys(selection).reduce((n, key) => n + selection[key].length, 0);
}

// ---------------------------------------------------------------------------
// 面板骨架
// ---------------------------------------------------------------------------

function buildOutfitPanel() {
    const s = section('衣装打扮', { open: false });
    s.root.setAttribute('id', 'roleEx-outfit-section');
    s.root.classList.add('roleEx-span-all');
    iconFor(s.root, 'fa-solid fa-shirt');

    const status = el('div', { class: 'roleEx-hint', id: 'roleEx-outfit-status', text: '衣装：读取中…' });

    const previewList = el('div', { id: 'roleEx-outfit-preview-list' });
    const preview = el('div', { id: 'roleEx-outfit-preview' }, [
        el('div', { class: 'roleEx-label', text: '预览' }),
        previewList,
    ]);
    const editor = el('div', { id: 'roleEx-outfit-editor' });
    // 形状是契约的：类名 .roleEx-outfit-cols；顺带给个 id，方便排查与自测按 id 找它
    const cols = el('div', { class: 'roleEx-outfit-cols', id: 'roleEx-outfit-cols' }, [preview, editor]);

    // 注入模板：与 settings.outfitInjectPrompt 双向同步（输入防抖 400ms 落设置）
    const promptInput = el('textarea', {
        class: 'text_pole roleEx-textarea',
        id: 'roleEx-outfit-inject-prompt',
        rows: '4',
    });
    promptInput.value = String(settings.outfitInjectPrompt ?? '');
    promptInput.addEventListener('input', debounce(() => updateSetting('outfitInjectPrompt', promptInput.value), 400));

    const injectFold = collapsible('注入模板', { open: false });
    injectFold.root.setAttribute('id', 'roleEx-outfit-inject-fold');
    injectFold.body.append(
        el('div', {
            class: 'roleEx-hint',
            html: '变量：<code>{{outfitList}}</code> 是已选的衣装；<code>{{char}}</code> / <code>{{user}}</code> 走酒馆宏。'
                + '这张卡片是否注入、落在什么位置，都由预设 UI 里的那张卡片决定。',
        }),
        promptInput,
    );

    // 正文的直接子节点顺序是契约：状态行 → 两栏 → 注入模板折叠块
    s.content.append(status, cols, injectFold.root);

    rt.state.panel = { root: s.root, status, cols, preview, previewList, editor, promptInput, injectFold };
    renderOutfit();
    return { section: s, root: s.root, status, cols, preview, previewList, editor, promptInput, injectFold };
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

function renderStatus() {
    const refs = panelRefs();
    if (!refs || !refs.status) {
        return;
    }
    const avail = outfitAvailability();
    // ⚠️ 「还没选角色」不是本模块出错（那是酒馆的常态）：不打红字。
    //    真去写盘时该报错还是会报（store 里的 toast 用的是同一份 outfitReasonText()）。
    const quiet = avail.reason === 'no-character';
    let text;
    if (!avail.ok) {
        // 文案走 store 的 outfitReasonText()：sub-not-allowed（旧版补丁的白名单里没有 outfit）
        // 框架的 assetReasonText() 不认识，而它必须让用户能照着改 + 重启酒馆
        text = '衣装：' + outfitReasonText(avail.reason);
    } else {
        const count = pickedCount();
        text = (count ? '已选 ' + count + ' 项' : '还没有选任何衣装项') + ' · ' + outfitPathText();
        if (rt.state.skippedNote) {
            text += ' · ' + rt.state.skippedNote;
        }
    }
    refs.status.className = 'roleEx-hint' + (!avail.ok && !quiet ? ' roleEx-warn' : '');
    refs.status.textContent = text;
    refs.status.title = text;
    if (refs.cols) {
        refs.cols.classList.toggle('is-disabled', !avail.ok);
    }
}

/** 预览：按 外 / 内 / 其他 分组，一行一个分类（未选的显示「未选」并弱化） */
function renderPreview() {
    const refs = panelRefs();
    const box = refs && refs.previewList;
    if (!box) {
        return;
    }
    box.textContent = '';
    const catalog = getCatalog();
    if (!catalog.length) {
        box.appendChild(el('div', { class: 'roleEx-hint', text: '还没有任何分类' }));
        return;
    }
    const selection = getSelection();
    for (const part of PARTS) {
        box.appendChild(el('div', { class: 'roleEx-outfit-preview-part', text: part.label }));
        for (const cat of catalog.filter(c => c.part === part.key)) {
            const tags = selection[cat.key] || [];
            const empty = !tags.length;
            box.appendChild(el('div', { class: 'roleEx-outfit-preview-row' }, [
                el('span', { class: 'roleEx-outfit-preview-name', text: cat.name + '：' }),
                el('span', {
                    class: 'roleEx-outfit-preview-value' + (empty ? ' is-empty' : ''),
                    text: empty ? '未选' : tags.join(' / '),
                }),
            ]));
        }
    }
}

/** 编辑器：三组分类，每个分类一行（名称 + 备选表输入框 + 芯片行）；「其他」组底部是新建按钮 */
function renderEditor() {
    const refs = panelRefs();
    const box = refs && refs.editor;
    if (!box) {
        return;
    }
    box.textContent = '';
    const catalog = getCatalog();
    const selection = getSelection();
    for (const part of PARTS) {
        const group = el('div', { class: 'roleEx-outfit-group' }, [
            el('div', { class: 'roleEx-hint roleEx-outfit-group-head', text: part.label }),
        ]);
        for (const cat of catalog.filter(c => c.part === part.key)) {
            group.appendChild(buildCategoryRow(cat, selection[cat.key] || []));
        }
        if (part.key === 'other') {
            group.appendChild(el('div', {
                class: 'menu_button roleEx-btn-sm',
                id: 'roleEx-outfit-add-cat',
                title: '新建一个自定义分类',
                text: '+ 新建分类',
                onclick: () => { void onAddCategory(); },
            }));
        }
        box.appendChild(group);
    }
}

function buildCategoryRow(cat, pickedTags) {
    const input = el('input', {
        type: 'text',
        class: 'text_pole roleEx-outfit-tags',
        id: 'roleEx-outfit-tags-' + cat.key,
        placeholder: '用英文逗号分隔，可填多个',
    });
    input.value = cat.tags.join(',');

    /** 备选表整表替换：失败时把输入框拉回真实状态（toast 由 store 统一发） */
    const commitTags = async () => {
        const previous = cat.tags.join(',');
        if (input.value === previous) {
            return;
        }
        const res = await setCategoryTags(cat.key, input.value);
        if (!res.ok) {
            input.value = previous;
            return;
        }
        renderOutfit();
    };
    input.addEventListener('change', () => { void commitTags(); });
    // 有的浏览器在 Enter 上不补 change：主动 blur 一次，把「提交」这件事做实
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
        }
    });

    const chips = el('div', { class: 'roleEx-outfit-chips', id: 'roleEx-outfit-chips-' + cat.key });
    for (const tag of cat.tags) {
        const on = pickedTags.includes(tag);
        const chip = el('span', {
            class: 'roleEx-outfit-chip' + (on ? ' is-on' : ''),
            text: tag,
            title: on ? '点击取消选择' : '点击选中',
        });
        chip.addEventListener('click', async () => {
            const res = await togglePicked(cat.key, tag);
            if (!res.ok) {
                return;
            }
            chip.classList.toggle('is-on');
            chip.title = chip.classList.contains('is-on') ? '点击取消选择' : '点击选中';
            renderPreview();
            renderStatus();
        });
        chips.appendChild(chip);
    }

    const row = el('div', { class: 'roleEx-outfit-cat', id: 'roleEx-outfit-cat-' + cat.key }, [
        el('span', { class: 'roleEx-outfit-cat-name', text: cat.name, title: cat.name }),
        input,
        chips,
    ]);
    // 固定分类不可改名 / 不可删除，只有自定义分类才有这两个按钮
    if (cat.custom) {
        row.appendChild(el('span', {
            class: 'roleEx-outfit-cat-btn',
            id: 'roleEx-outfit-rename-' + cat.key,
            title: '重命名分类',
            text: '🖊',
            onclick: () => { void onRenameCategory(cat); },
        }));
        row.appendChild(el('span', {
            class: 'roleEx-outfit-cat-btn',
            id: 'roleEx-outfit-del-' + cat.key,
            title: '删除分类',
            text: '🗑',
            onclick: () => { void onDeleteCategory(cat); },
        }));
    }
    return row;
}

/** 重画状态行 + 预览 + 编辑器（不动 settings） */
function renderOutfit() {
    const refs = panelRefs();
    if (!refs) {
        return;
    }
    renderStatus();
    renderPreview();
    renderEditor();
    updateOutfitPresetCardHint();
    // 这个函数是框架「打开面板 / 换会话后面板重开」的入口（onPanelOpened → renderOutfit）。
    // 页面级原因（缺补丁 / 白名单没有 outfit）在这里拿到一次重探机会：用户补上补丁、
    // 改完白名单并重启酒馆主进程后，不必按 F5 —— 再点开一次面板就恢复。
    // armOutfitReprobe() 自带节流与「本次重探自己触发的重绘不再叠一次」，见 store.js。
    const armed = armOutfitReprobe();
    // 数据由框架桥接的 reloadOutfit() 读；万一它还没跑（面板先于加载打开），这里补一次。
    // 一次性：跑过就不再补，免得读失败时反复重试（重探那条路由探针自己的节流兜着）。
    const needsFirstLoad = !rt.state.loaded && !rt.state.autoLoadTried && outfitAvailability().ok;
    if (needsFirstLoad) {
        rt.state.autoLoadTried = true;
    }
    if (armed || needsFirstLoad) {
        void reloadOutfit();
    }
}

/** 重新读文件再重画（框架在换会话 / 打开面板时调它） */
async function reloadOutfit() {
    // 重探自己触发的重绘不再挂一次重探；用计数器是为了并发调用（换会话）不被丢掉
    rt.state.reprobeInFlight = (rt.state.reprobeInFlight || 0) + 1;
    try {
        const res = await loadOutfit();
        renderOutfit();
        return res;
    } finally {
        rt.state.reprobeInFlight -= 1;
    }
}

// ---------------------------------------------------------------------------
// 交互
// ---------------------------------------------------------------------------

async function onAddCategory() {
    const name = globalThis.prompt('新分类名（留空取消）：');
    const clean = String(name ?? '').trim();
    if (!clean) {
        return;
    }
    if (isCategoryNameTaken(clean)) {
        toast('error', '已有同名分类');
        return;
    }
    const res = await addCustomCategory(clean);
    if (!res.ok) {
        return;
    }
    renderOutfit();
}

async function onRenameCategory(cat) {
    const name = globalThis.prompt('新的分类名（留空取消）：', cat.name);
    const clean = String(name ?? '').trim();
    if (!clean) {
        return;
    }
    if (isCategoryNameTaken(clean, cat.key)) {
        toast('error', '已有同名分类');
        return;
    }
    const res = await renameCustomCategory(cat.key, clean);
    if (!res.ok) {
        return;
    }
    renderOutfit();
}

async function onDeleteCategory(cat) {
    if (!globalThis.confirm('删除分类「' + cat.name + '」？该分类的备选 tag 与已选 tag 会一起清掉。')) {
        return;
    }
    const res = await removeCustomCategory(cat.key);
    if (!res.ok) {
        return;
    }
    renderOutfit();
}

// ---------------------------------------------------------------------------
// 预设卡片状态（与日记模块同一套读法：只读卡片，不写预设）
// ---------------------------------------------------------------------------

/**
 * 卡片状态 → 两份文案（设定面板里那一块用 detail；
 * status 留作单行摘要，供将来别处复用）。
 */
function describeOutfitCard() {
    const card = readOutfitCard();
    const diag = diagnoseOutfitCard({ quiet: true });
    if (!isPromptManagerExposed()) {
        return {
            status: '状态：⚠️ 读不到提示词管理器（补丁不完整）',
            detail: '状态：读取不到提示词管理器 —— ST 补丁为旧版'
                + '（未把 promptManager 暴露到 getContext()）。'
                + '请重新应用 patches/st-marker-prompt.patch 并 Ctrl+F5 强制刷新。',
        };
    }
    if (card.reason === 'no-manager') {
        return {
            status: '状态：⚠️ 提示词管理器未就绪（需 Chat Completion 类接口）',
            detail: '状态：提示词管理器尚未就绪（需要选中 Chat Completion 类接口）。',
        };
    }
    const preset = currentPresetName() || '(未识别预设)';
    const probe = probeStPatch();
    const patchLine = (probe.patchedToggle && probe.patchedEdit)
        ? '权限：PromptManager 已放行（开关 + 铅笔应当可见）'
        : `权限：缺失！toggle=${probe.patchedToggle} / edit=${probe.patchedEdit} —— `
            + '浏览器里跑的 PromptManager.js 是旧版，Ctrl+F5 强制刷新；仍不行就是补丁没应用全。';
    const shape = supportsMarkerPromptCard()
        ? 'marker=true（正文由扩展的运行时源提供）'
        : 'registerRuntimePromptSource 不存在 → 卡片拿不到正文（补丁未生效）';
    if (!card.ok) {
        return {
            status: '状态：⚠️ 预设里没有这张卡片',
            detail: `状态：预设「${preset}」里没有这张卡片。\n`
                + '本扩展不会自动创建卡片 —— 请在预设 JSON 里加入下面这一条：\n'
                + `  prompts:     { "identifier": "${PRESET_PROMPT.ID}", "name": "${PRESET_PROMPT.NAME}", "system_prompt": true, "marker": true }\n`
                + `  prompt_order（每个块都要加）: { "identifier": "${PRESET_PROMPT.ID}", "enabled": true }\n`
                + patchLine,
        };
    }
    const enabled = diag.enabled === true;
    const bindings = Array.isArray(diag.bindings) ? diag.bindings : [];
    const whereLine = bindings.length
        ? '位置：' + bindings.map(b => `块 ${b.character_id} 第 ${b.index + 1} 位（前 ${b.prev} / 后 ${b.next}）`).join('；')
        : '位置：没有插进任何 prompt_order 块 —— 卡片不会参与生成';
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
    return {
        status: `状态：${enabled ? '🟢 已启用（注入中）' : '🔴 已停用（不注入）'}`,
        detail: `状态：${enabled ? '🟢 已启用（注入中）' : '🔴 已停用（不注入）'}`
            + `\n预设「${preset}」· 标识 ${PRESET_PROMPT.ID} · 位置与开关都在预设 UI 里管理`
            + `\n形态：${shape}`
            + `\n${patchLine}`
            + `\n${controlsLine}`
            + `\n${whereLine}`
            + (enabled ? '' : '\n要重新启用：在预设 UI 里打开这张卡片的开关'),
    };
}

/** 把卡片状态写进扩展设置面板里本模块那一块（元素不在就跳过） */
function updateOutfitPresetCardHint() {
    const detailEl = document.getElementById('roleEx-preset-card-hint-outfit');
    if (!detailEl) {
        return;
    }
    const { detail } = describeOutfitCard();
    detailEl.textContent = detail;
    detailEl.style.whiteSpace = 'pre-line';
}

/** 打开酒馆「AI Response Configuration」侧栏 —— 衣装卡片的位置与启停都在那里管 */
function openPresetPanel() {
    const panel = document.getElementById('left-nav-panel');
    if (panel?.classList.contains('openDrawer')) {
        return;
    }
    document.getElementById('ai-config-button')?.querySelector('.drawer-toggle')?.click();
}

    return {
        buildCategoryRow, buildOutfitPanel, describeOutfitCard, openPresetPanel, pickedCount,
        reloadOutfit, renderEditor, renderOutfit, renderPreview, renderStatus, updateOutfitPresetCardHint,
    };
}

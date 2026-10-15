/**
 * modules/outfit/ui.js
 *
 * 主面板里的「衣装打扮」区块：一行状态 + 左右两栏（左预览 / 右编辑器）+ 注入模板折叠块。
 * 分类的改名 / 删除 / 改备选 tag 走独立弹窗（与推特 / 日记同款：挂 document.body，不吃面板的 overflow）。
 * 外 / 内 两组另有「套装」：编辑器里一行入口 → 一级弹窗（管理该组套装）→ 二级弹窗（编辑单个套装）。
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
    // 套装（Part C）：只有 外 / 内 两组有，见 SUIT_PARTS；契约在 store.js，这里只读列表 + 转发写操作
    const addSuit = (...args) => rt.store.addSuit(...args);
    const getPickedSuit = (...args) => rt.store.getPickedSuit(...args);
    const getSuits = (...args) => rt.store.getSuits(...args);
    const isSuitNameTaken = (...args) => rt.store.isSuitNameTaken(...args);
    const pickSuit = (...args) => rt.store.pickSuit(...args);
    const removeSuit = (...args) => rt.store.removeSuit(...args);
    const renameSuit = (...args) => rt.store.renameSuit(...args);
    const setSuitItems = (...args) => rt.store.setSuitItems(...args);
    const suitById = (...args) => rt.store.suitById(...args);
    const SUIT_CATEGORY_NAME = rt.store.SUIT_CATEGORY_NAME;
    const SUIT_ITEMS_BY_PART = rt.store.SUIT_ITEMS_BY_PART;
    const SUIT_PARTS = rt.store.SUIT_PARTS;
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

/** 预览：按 外 / 内 / 其他 分组，一行一个分类（未选的显示「未选」并弱化）；外 / 内的第一行是套装 */
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
        // 套装行只属于有套装的那两组；「其他」组一行都不多
        const suit = hasSuits(part.key) ? suitById(getPickedSuit(part.key)) : null;
        if (hasSuits(part.key)) {
            const suitName = suit ? suit.name : '';
            box.appendChild(el('div', { class: 'roleEx-outfit-preview-row' }, [
                el('span', { class: 'roleEx-outfit-preview-name', text: SUIT_CATEGORY_NAME + '：' }),
                el('span', {
                    class: 'roleEx-outfit-preview-value' + (suitName ? '' : ' is-empty'),
                    text: suitName || '未选',
                }),
            ]));
        }
        for (const cat of catalog.filter(c => c.part === part.key)) {
            // 装了套装时：散装选中项在前、该套装在这个分类里的元素在后，整体去重
            const tags = mergeTags(selection[cat.key], suitItems(suit, cat.key));
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

/** 这一组有没有套装（只有 外 / 内） */
function hasSuits(partKey) {
    return Array.isArray(SUIT_PARTS) && SUIT_PARTS.includes(partKey);
}

/** 套装在某个分类里的元素；套装不存在 / 该分类没内容都当空数组 */
function suitItems(suit, catKey) {
    const raw = suit && suit.items ? suit.items[catKey] : null;
    return Array.isArray(raw) ? raw : [];
}

/** 散装选中项在前、套装元素在后，整体去重（顺序即显示顺序） */
function mergeTags(picked, extra) {
    const out = [];
    for (const tag of [].concat(picked || [], extra || [])) {
        if (tag && !out.includes(tag)) {
            out.push(tag);
        }
    }
    return out;
}

/**
 * 编辑器：三组分类，每组一个折叠块（`外` / `内` / `其他`，**默认收起**，展开状态记在 rt.state.foldOpen）；
 * 每个分类一行（名称 + 编辑），改备选 tag / 改名 / 删除都在弹窗里做；「其他」组底部是新建按钮。
 */
function renderEditor() {
    const refs = panelRefs();
    const box = refs && refs.editor;
    if (!box) {
        return;
    }
    box.textContent = '';
    const catalog = getCatalog();
    const foldOpen = outfitFoldOpen();
    for (const part of PARTS) {
        const fold = collapsible(part.label, { open: foldOpen[part.key] === true });
        fold.root.setAttribute('id', 'roleEx-outfit-fold-' + part.key);
        fold.root.classList.add('roleEx-outfit-group');
        // 展开 / 收起本身是酒馆原生 `.inline-drawer-toggle` 委托处理器在动 DOM（动画中间态读 body.style.display
        // 拿不准），所以这里只维护自己的布尔值 —— 新建 / 改名 / 删除触发重画后，用户展开的那一组不会自己收回去。
        fold.header.addEventListener('click', () => {
            foldOpen[part.key] = !foldOpen[part.key];
        });
        // 有套装的组（外 / 内）：body 第一行是「套装」入口，形态与分类行一致
        if (hasSuits(part.key)) {
            fold.body.appendChild(buildSuitRow(part));
        }
        for (const cat of catalog.filter(c => c.part === part.key)) {
            fold.body.appendChild(buildCategoryRow(cat));
        }
        if (part.key === 'other') {
            fold.body.appendChild(el('div', {
                class: 'menu_button roleEx-btn-sm',
                id: 'roleEx-outfit-add-cat',
                title: '新建一个自定义分类',
                text: '+ 新建分类',
                onclick: () => { void onAddCategory(); },
            }));
        }
        box.appendChild(fold.root);
    }
}

/** 三组的展开状态：默认全收起，只补缺的键（不覆盖用户点过的那一份） */
function outfitFoldOpen() {
    if (!rt.state || typeof rt.state !== 'object') {
        rt.state = {};
    }
    if (!rt.state.foldOpen || typeof rt.state.foldOpen !== 'object') {
        rt.state.foldOpen = {};
    }
    for (const part of PARTS) {
        if (typeof rt.state.foldOpen[part.key] !== 'boolean') {
            rt.state.foldOpen[part.key] = false;
        }
    }
    return rt.state.foldOpen;
}

/** 分类行：名称 + 编辑独立按键（点开弹窗，见 openCategoryModal）；固定分类与自定义分类在此没有区别 */
function buildCategoryRow(cat) {
    return el('div', { class: 'roleEx-outfit-cat', id: 'roleEx-outfit-cat-' + cat.key }, [
        el('span', { class: 'roleEx-outfit-cat-name', text: cat.name, title: cat.name }),
        el('div', {
            class: 'menu_button roleEx-btn-xs',
            id: 'roleEx-outfit-edit-' + cat.key,
            title: '编辑这个分类的备选 tag',
            text: '编辑',
            onclick: () => openCategoryModal(cat),
        }),
    ]);
}

/** 套装行：与分类行同形，只是名字固定为「套装」、编辑键打开的是套装弹窗 */
function buildSuitRow(part) {
    return el('div', { class: 'roleEx-outfit-cat', id: 'roleEx-outfit-cat-suit-' + part.key }, [
        el('span', { class: 'roleEx-outfit-cat-name', text: SUIT_CATEGORY_NAME, title: SUIT_CATEGORY_NAME }),
        el('div', {
            class: 'menu_button roleEx-btn-xs',
            id: 'roleEx-outfit-suit-edit-' + part.key,
            title: '编辑这一组的套装',
            text: '编辑',
            onclick: () => openSuitModal(part),
        }),
    ]);
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

/**
 * 分类编辑弹窗（推特 / 日记同款结构：.roleEx-modal → .roleEx-modal-inner → .roleEx-modal-head）。
 *
 * 弹窗是**一次性**的：关掉即弃，不缓存引用到 rt.state；挂 document.body，不吃面板的 overflow。
 * 名称框与「删除分类」只有自定义分类才有（固定分类不可改名 / 不可删除）。
 */
function openCategoryModal(cat) {
    // 同一时刻只允许一个
    document.getElementById('roleEx-outfit-modal')?.remove();

    const modal = el('div', { class: 'roleEx-modal', id: 'roleEx-outfit-modal' });
    const inner = el('div', { class: 'roleEx-modal-inner' });
    const close = () => modal.remove();
    inner.appendChild(el('div', { class: 'roleEx-modal-head' }, [
        el('span', { text: '编辑「' + cat.name + '」' }),
        el('i', { class: 'fa-solid fa-xmark menu_button roleEx-btn-xs', onclick: close }),
    ]));

    let nameInput = null;
    if (cat.custom) {
        nameInput = el('input', { type: 'text', class: 'text_pole', id: 'roleEx-outfit-modal-name' });
        nameInput.value = cat.name;
        inner.appendChild(el('div', { class: 'roleEx-outfit-modal-field' }, [
            el('span', { class: 'roleEx-hint roleEx-inline-label', text: '名称' }),
            nameInput,
        ]));
    }

    const tagsArea = el('textarea', { class: 'text_pole roleEx-textarea', id: 'roleEx-outfit-modal-tags', rows: '3' });
    tagsArea.value = cat.tags.join(',');
    inner.appendChild(el('div', { class: 'roleEx-outfit-modal-field' }, [
        el('span', { class: 'roleEx-hint roleEx-inline-label', text: '备选' }),
        tagsArea,
        el('div', { class: 'roleEx-hint', text: '每个填一项、用英文逗号分隔；中文逗号不切分。' }),
    ]));

    // 备选表为空就没有芯片可点，用一句提示顶替芯片行
    if (!cat.tags.length) {
        inner.appendChild(el('div', { class: 'roleEx-hint', text: '先在上面填备选 tag' }));
    } else {
        const picked = getSelection()[cat.key] || [];
        const chips = el('div', { class: 'roleEx-outfit-chips', id: 'roleEx-outfit-modal-chips' });
        for (const tag of cat.tags) {
            const on = picked.includes(tag);
            const chip = el('span', {
                class: 'roleEx-outfit-chip' + (on ? ' is-on' : ''),
                text: tag,
                title: on ? '点击取消选择' : '点击选中',
            });
            // 与原先的行内芯片完全一致：成功才切状态（失败由 store toast，界面不动）
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
        inner.appendChild(chips);
    }

    /** 保存：① 改名（自定义分类）→ ② 备选表 → ③ 全部成功才关窗重画；任一步失败都停在弹窗里 */
    const save = async () => {
        if (nameInput) {
            const clean = nameInput.value.trim();
            if (clean !== cat.name) {
                if (!clean) {
                    toast('error', '名称不能为空');
                    return;
                }
                if (isCategoryNameTaken(clean, cat.key)) {
                    toast('error', '已有同名分类');
                    return;
                }
                const renamed = await renameCustomCategory(cat.key, clean);
                if (!renamed.ok) {
                    return;
                }
            }
        }
        if (tagsArea.value !== cat.tags.join(',')) {
            const saved = await setCategoryTags(cat.key, tagsArea.value);
            if (!saved.ok) {
                return;
            }
        }
        modal.remove();
        renderOutfit();
    };

    const del = async () => {
        if (!globalThis.confirm('删除分类「' + cat.name + '」？该分类的备选 tag 与已选 tag 会一起清掉。')) {
            return;
        }
        const res = await removeCustomCategory(cat.key);
        if (!res.ok) {
            return;
        }
        modal.remove();
        renderOutfit();
    };

    // 底部统一到右下角：删除分类（仅自定义）→ 取消 → 保存（与日记弹窗同款）
    const actions = el('div', { class: 'roleEx-row roleEx-gap roleEx-end' }, [
        cat.custom ? el('div', {
            class: 'menu_button roleEx-btn roleEx-danger',
            id: 'roleEx-outfit-modal-del',
            text: '删除分类',
            onclick: () => { void del(); },
        }) : null,
        el('div', {
            class: 'menu_button roleEx-btn',
            id: 'roleEx-outfit-modal-cancel',
            text: '取消',
            onclick: close,
        }),
        el('div', {
            class: 'menu_button roleEx-btn',
            id: 'roleEx-outfit-modal-save',
            text: '保存',
            onclick: () => { void save(); },
        }),
    ]);
    inner.appendChild(actions);

    // 取消 / × = 直接 remove：未保存的改动丢掉，不写盘
    modal.appendChild(inner);
    document.body.appendChild(modal);
}

// ---------------------------------------------------------------------------
// 套装（Part C）：一级弹窗 = 该组的套装列表，二级弹窗 = 编辑单个套装
// ---------------------------------------------------------------------------

/** 打开着的一级套装弹窗的「重画列表」函数；一级关掉后置空。二级弹窗改完数据靠它刷新一级 */
let suitListRefresh = null;

/**
 * 一级弹窗：管理该组的套装列表（`#roleEx-outfit-suit-modal`）。
 *
 * 与分类弹窗同款：一次性、挂 document.body、打开前先清掉同 id 的旧窗。
 * 二级弹窗叠在它上面（见 openSuitEditModal），所以重画列表只重建列表内容、不换弹窗本身。
 */
function openSuitModal(part) {
    document.getElementById('roleEx-outfit-suit-modal')?.remove();

    const modal = el('div', { class: 'roleEx-modal', id: 'roleEx-outfit-suit-modal' });
    const inner = el('div', { class: 'roleEx-modal-inner' });
    const close = () => {
        modal.remove();
        suitListRefresh = null;
    };
    inner.appendChild(el('div', { class: 'roleEx-modal-head' }, [
        el('span', { text: SUIT_CATEGORY_NAME + '（' + part.label + '）' }),
        el('i', { class: 'fa-solid fa-xmark menu_button roleEx-btn-xs', onclick: close }),
    ]));

    const list = el('div', { id: 'roleEx-outfit-suit-list' });
    // 本次渲染出来的芯片（id → 元素）：点一下只在这几颗之间换 is-on，弹窗其它部分不动
    let chips = [];
    const renderList = () => {
        list.textContent = '';
        chips = [];
        const suits = getSuits(part.key) || [];
        if (!suits.length) {
            list.appendChild(el('div', { class: 'roleEx-hint', text: '还没有套装，点下面的「+ 新建套装」加一个。' }));
            return;
        }
        const picked = getPickedSuit(part.key);
        for (const suit of suits) {
            const on = suit.id === picked;
            const chipTitle = on ? '点击取消这一组的套装' : '点击选中这个套装';
            const chip = el('span', {
                class: 'roleEx-outfit-chip' + (on ? ' is-on' : ''),
                text: suit.name,
                title: chipTitle,
            });
            // 同组互斥由 store 管：成功后按 getPickedSuit() 的结果重刷本弹窗的芯片，再重画面板预览
            chip.addEventListener('click', async () => {
                const res = await pickSuit(part.key, suit.id);
                if (!res || !res.ok) {
                    return;
                }
                const now = getPickedSuit(part.key);
                for (const entry of chips) {
                    entry.el.classList.toggle('is-on', entry.id === now);
                    entry.el.title = entry.id === now ? '点击取消这一组的套装' : '点击选中这个套装';
                }
                renderOutfit();
            });
            chips.push({ id: suit.id, el: chip });
            list.appendChild(el('div', { class: 'roleEx-outfit-suit-row', id: 'roleEx-outfit-suit-row-' + suit.id }, [
                el('span', { class: 'roleEx-outfit-suit-name', text: suit.name, title: suit.name }),
                el('div', {
                    class: 'menu_button roleEx-btn-xs',
                    id: 'roleEx-outfit-suit-edit-' + suit.id,
                    title: '编辑这个套装',
                    text: '编辑',
                    onclick: () => openSuitEditModal(part, suit.id),
                }),
                chip,
            ]));
        }
    };
    renderList();
    suitListRefresh = renderList;
    inner.appendChild(list);

    inner.appendChild(el('div', { class: 'roleEx-row roleEx-gap roleEx-end' }, [
        el('div', {
            class: 'menu_button roleEx-btn',
            id: 'roleEx-outfit-suit-add',
            text: '+ 新建套装',
            onclick: () => { void onAddSuit(part, renderList); },
        }),
    ]));

    modal.appendChild(inner);
    document.body.appendChild(modal);
}

/** 一级弹窗还开着就按最新数据重画它的列表（改完名 / 删完套装后调；没开着就什么都不做） */
function refreshSuitModal() {
    if (typeof suitListRefresh === 'function') {
        suitListRefresh();
    }
}

/** 「+ 新建套装」：prompt 取名，空串取消、重名拒绝，成功才重画一级列表 + 面板 */
async function onAddSuit(part, rerenderList) {
    const name = globalThis.prompt('新套装名（留空取消）：');
    const clean = String(name ?? '').trim();
    if (!clean) {
        return;
    }
    if (isSuitNameTaken(part.key, clean)) {
        toast('error', '已有同名套装');
        return;
    }
    const res = await addSuit(part.key, clean);
    if (!res || !res.ok) {
        return;
    }
    rerenderList();
    renderOutfit();
}

/**
 * 二级弹窗：编辑单个套装（`#roleEx-outfit-suit-edit-modal`），与一级弹窗同时存在、叠在它上面。
 *
 * 只有保存 / 删除**成功**才关窗并重画一级（名字、列表、芯片都可能变了）；
 * 取消 / × 只关窗，不写盘也不动一级。
 */
function openSuitEditModal(part, suitId) {
    const suit = suitById(suitId);
    if (!suit) {
        return;
    }
    document.getElementById('roleEx-outfit-suit-edit-modal')?.remove();

    const modal = el('div', { class: 'roleEx-modal', id: 'roleEx-outfit-suit-edit-modal' });
    const inner = el('div', { class: 'roleEx-modal-inner' });
    const close = () => modal.remove();
    inner.appendChild(el('div', { class: 'roleEx-modal-head' }, [
        el('span', { text: '编辑套装' }),
        el('i', { class: 'fa-solid fa-xmark menu_button roleEx-btn-xs', onclick: close }),
    ]));

    const nameInput = el('input', { type: 'text', class: 'text_pole', id: 'roleEx-outfit-suit-name' });
    nameInput.value = suit.name;
    inner.appendChild(el('div', { class: 'roleEx-outfit-modal-field' }, [
        el('span', { class: 'roleEx-hint roleEx-inline-label', text: '套装名' }),
        nameInput,
    ]));

    // 下属分类按 SUIT_ITEMS_BY_PART 的顺序来；显示名从 getCatalog() 取，取不到就退回 key
    const catalog = getCatalog();
    const itemInputs = [];
    for (const catKey of SUIT_ITEMS_BY_PART[part.key] || []) {
        const cat = catalog.find(c => c.key === catKey);
        const input = el('input', {
            type: 'text',
            class: 'text_pole',
            id: 'roleEx-outfit-suit-item-' + catKey,
            placeholder: '用英文逗号分隔，可填多个',
        });
        input.value = suitItems(suit, catKey).join(',');
        itemInputs.push({ catKey, input });
        inner.appendChild(el('div', { class: 'roleEx-outfit-modal-field' }, [
            el('span', { class: 'roleEx-hint roleEx-inline-label', text: cat ? cat.name : catKey }),
            input,
        ]));
    }

    /** 保存：① 校验名字 → ② 改名（名字变了才调）→ ③ 下属分类内容一次性提交；任一步失败都停在弹窗里 */
    const save = async () => {
        const clean = nameInput.value.trim();
        if (!clean) {
            toast('error', '套装名不能为空');
            return;
        }
        if (isSuitNameTaken(part.key, clean, suit.id)) {
            toast('error', '已有同名套装');
            return;
        }
        if (clean !== suit.name) {
            const renamed = await renameSuit(suit.id, clean);
            if (!renamed || !renamed.ok) {
                return;
            }
        }
        const items = {};
        for (const { catKey, input } of itemInputs) {
            items[catKey] = input.value;
        }
        const saved = await setSuitItems(suit.id, items);
        if (!saved || !saved.ok) {
            return;
        }
        modal.remove();
        refreshSuitModal();
        renderOutfit();
    };

    const del = async () => {
        if (!globalThis.confirm('删除套装「' + suit.name + '」？')) {
            return;
        }
        const res = await removeSuit(suit.id);
        if (!res || !res.ok) {
            return;
        }
        modal.remove();
        refreshSuitModal();
        renderOutfit();
    };

    inner.appendChild(el('div', { class: 'roleEx-row roleEx-gap roleEx-end' }, [
        el('div', {
            class: 'menu_button roleEx-btn roleEx-danger',
            id: 'roleEx-outfit-suit-del',
            text: '删除套装',
            onclick: () => { void del(); },
        }),
        el('div', {
            class: 'menu_button roleEx-btn',
            id: 'roleEx-outfit-suit-cancel',
            text: '取消',
            onclick: close,
        }),
        el('div', {
            class: 'menu_button roleEx-btn',
            id: 'roleEx-outfit-suit-save',
            text: '保存',
            onclick: () => { void save(); },
        }),
    ]));

    modal.appendChild(inner);
    document.body.appendChild(modal);
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
        ? '权限：PromptManager 已放行（开关 + 「编辑」应当可见）'
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

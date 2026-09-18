/**
 * modules/journal/ui.js
 *
 * ⚠️ 主体是从 index.js 机械搬运过来的（章节：UI：日记），
 *    除下面的依赖头外没有改写 —— 保留原字节是为了 diff 干净、避免改坏字符串。
 *    依赖方向：框架设施由 kernel 注入；同模块跨文件用 rt.<key>.xxx 惰性转发；
 *    跨模块只走 kernel.service()，模块不在时取安全缺省。
 */

export function createJournalUi(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它的字段快照）
    const { ID, checkboxRow, collapsible, debounce, el, formatTime, iconFor, journalPathText, journalReasonText, safeName, section, settings, slugForFile, stampForFileName, textPreview, toast, ui, uid, updateSetting } = kernel;
    // 同模块、别的文件：惰性转发（调用时才取，绕开文件创建顺序的循环依赖）
    const PRESET_PROMPT = rt.inject.PRESET_PROMPT;
    const currentChatIdentity = (...args) => rt.storage.currentChatIdentity(...args);
    const currentPresetName = (...args) => rt.inject.currentPresetName(...args);
    const encodeLine = (...args) => rt.storage.encodeLine(...args);
    const generateJournal = rt.generate.generateJournal;
    const getPromptManager = (...args) => rt.inject.getPromptManager(...args);
    const isJournalCardEnabledInPreset = (...args) => rt.inject.isJournalCardEnabledInPreset(...args);
    const isPromptManagerExposed = (...args) => rt.inject.isPromptManagerExposed(...args);
    const listFloors = (...args) => rt.floors.listFloors(...args);
    const onJournalSelectionChanged = (...args) => rt.inject.onJournalSelectionChanged(...args);
    const parseJsonl = (...args) => rt.storage.parseJsonl(...args);
    const persistJournal = rt.generate.persistJournal;
    const pickedJournals = (...args) => rt.generate.pickedJournals(...args);
    const probeCardControls = (...args) => rt.inject.probeCardControls(...args);
    const probeStPatch = (...args) => rt.inject.probeStPatch(...args);
    const supportsMarkerPromptCard = (...args) => rt.inject.supportsMarkerPromptCard(...args);

// UI：日记
// ============================================================================

function setButtonBusy(busy) {
    const btn = document.getElementById('roleEx-generate-journal');
    if (!btn) {
        return;
    }
    btn.classList.toggle('roleEx-busy', !!busy);
    btn.textContent = busy ? '生成中…' : '生成日记';
}

function buildJournalPanel() {
    const s = section('日记', { open: false });
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

    // 隔离通道下随日记带入的角色卡字段：三个独立开关，全部关掉 = 不带任何角色设定
    const cardProfileToggle = el('input', { type: 'checkbox' });
    cardProfileToggle.checked = settings.journalCardProfile !== false;
    cardProfileToggle.addEventListener('change', () => updateSetting('journalCardProfile', cardProfileToggle.checked));

    const cardPersonaToggle = el('input', { type: 'checkbox' });
    cardPersonaToggle.checked = settings.journalCardPersona !== false;
    cardPersonaToggle.addEventListener('change', () => updateSetting('journalCardPersona', cardPersonaToggle.checked));

    const cardScenarioToggle = el('input', { type: 'checkbox' });
    cardScenarioToggle.checked = settings.journalCardScenario !== false;
    cardScenarioToggle.addEventListener('change', () => updateSetting('journalCardScenario', cardScenarioToggle.checked));

    // 角色设定折叠（默认收起：三项默认全开，平时不需要动它）
    const cardSettingsFold = collapsible('角色设定（隔离通道）', { open: false });
    cardSettingsFold.root.setAttribute('id', 'roleEx-card-fold');
    cardSettingsFold.body.append(
        el('div', { class: 'roleEx-hint', text: '按顺序拼在日记提示词之前：角色描述 → 性格 → 用户设定 → 场景。字段为空时自动跳过。' }),
        checkboxRow(cardProfileToggle, '角色描述 + 性格', '角色卡 description 与 personality，描述在前、性格在后'),
        checkboxRow(cardPersonaToggle, '用户设定', '当前用户人设 persona'),
        checkboxRow(cardScenarioToggle, '场景', '角色卡 scenario'),
        el('div', { class: 'roleEx-hint', text: '三项全关 = 不带任何角色设定。回退通道的角色卡由预设卡片提供，与这三个开关无关。' }),
    );

    // ---- 提示词注入（只看状态；详情与跳转都搬到了酒馆「扩展」设置面板）----
    const injectStatus = el('div', {
        class: 'roleEx-hint',
        id: 'roleEx-inject-status',
        text: '注入状态：检测中…',
    });
    const injectBlock = el('div', { class: 'roleEx-block', id: 'roleEx-inject-block' }, [
        el('div', { class: 'roleEx-label', text: '提示词注入' }),
        injectStatus,
    ]);

    const generate = el('div', { class: 'roleEx-block', id: 'roleEx-new-journal-block' }, [
        el('div', { class: 'roleEx-label', text: '新日记' }),
        titleInput,
        el('div', { class: 'roleEx-row roleEx-gap roleEx-vcenter' }, [
            generateBtn,
            el('span', { class: 'roleEx-hint', text: '用当前 API 独立生成，不动主聊天' }),
        ]),
        checkboxRow(isolatedToggle, '隔离生成（推荐）', '只把日记提示词发给模型：不带主聊天记录、世界书；关闭后退回酒馆的安静生成通道'),
        cardSettingsFold.root,
        floorsFold.root,
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
        html: '按会话隔离存放于角色聊天目录下：'
            + '<code>chats/&lt;角色&gt;/_RoleExpansion/journals/RoleExpansion_journal_c_&lt;hash&gt;_j_&lt;hash&gt;.jsonl</code>：'
            + '一篇日记一行，互不续写。',
    });

    // 「插入日记系统」＝生成新日记时把已勾选的日记当参考提示词。
    // 它与「是否把日记注入主聊天」是两件事：后者由预设里那张卡片的开关决定（见扩展设置面板）。
    const injectJournalToggle = el('input', { type: 'checkbox', id: 'roleEx-inject-journal' });
    injectJournalToggle.checked = settings.journalInjectToJournal === true;
    injectJournalToggle.addEventListener('change', () => {
        updateSetting('journalInjectToJournal', injectJournalToggle.checked);
        renderJournalList();
    });
    const injectJournalRow = checkboxRow(injectJournalToggle, '插入日记系统', '作为「新日记」的参考提示词');
    injectJournalRow.setAttribute('id', 'roleEx-inject-journal-row');

    // 日记列表折叠（默认展开）
    const entriesFold = collapsible('日记列表', { open: true });
    entriesFold.root.setAttribute('id', 'roleEx-journal-fold');
    // 第一行放「插入日记系统」：它回答的正是"上面这些勾选拿来干什么"，
    // 排在「M 篇 · N 篇已勾选」之前，读下来正好是「勾选 → 用途 → 现状」。
    entriesFold.body.append(injectJournalRow, storageHint, storageNote, list, tools);

    const entries = el('div', { class: 'roleEx-block' }, [entriesFold.root]);

    s.content.append(injectBlock, generate, entries);

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
    // 单项「恢复默认」已去掉：要还原主提示词，用扩展设置面板里的「恢复默认设置」
    //（它会按 <存为默认设置> 保存的基准整体还原），避免面板里到处是"恢复默认"。
    promptSection.content.append(
        el('div', { class: 'roleEx-hint', html: '变量：<code>{{chatRange}}</code> 参考聊天、<code>{{journalRefs}}</code> 参考日记、<code>{{stateList}}</code> 状态；<code>{{char}}</code>/<code>{{user}}</code> 走酒馆宏。' }),
        mainPrompt,
    );
    s.content.append(promptSection.root);

    return { section: s, floorSummary, injectJournalToggle };
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
        // 同上：「还没选角色」当空列表处理，不当报错
        const reason = ui.journalError;
        const isError = !!reason && reason !== 'no-character';
        list.appendChild(el('div', {
            class: isError ? 'roleEx-hint roleEx-warn' : 'roleEx-hint',
            text: isError ? journalReasonText(reason) : '本会话还没有日记。',
        }));
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
    hint.style.whiteSpace = 'pre-line';
    const reason = ui.journalError;
    // ⚠️ 「还没选角色」不是出错（酒馆的常态）：不打红字，只说一句中性的话。
    //    别的 reason（缺补丁 / 群聊 / 网络…）照旧红字。
    if (reason === 'no-character') {
        hint.classList.remove('roleEx-warn');
        hint.textContent = `${ui.journal.length} 篇 · ${ui.selectedJournalIds.size} 篇已勾选\n选一个角色后才有落点。`;
        return;
    }
    if (reason) {
        hint.classList.add('roleEx-warn');
        hint.textContent = `${ui.journal.length} 篇 · ${ui.selectedJournalIds.size} 篇已勾选\n${journalReasonText(reason)}`;
        return;
    }
    hint.classList.remove('roleEx-warn');
    const identity = ui.identity || currentChatIdentity();
    hint.textContent = `${ui.journal.length} 篇 · ${ui.selectedJournalIds.size} 篇已勾选\n${journalPathText(identity.fileName)}`;
}

/**
 * 预设卡片状态：**同一次计算出两份文案**，避免两处各算一遍、出现不一致。
 *   - status：单行，给主面板「日记 → 提示词注入」区块
 *   - detail：完整诊断（状态 / 形态 / 权限 / 控件 / 预览），给酒馆「扩展」设置面板里的日记卡片区块
 */
function describeJournalCard() {
    const pm = getPromptManager();
    // 三种「读不到管理器」要分开讲，否则无从排查：
    //   a) 补丁是旧版 → getContext() 里没有 promptManager（需要重新应用补丁）
    //   b) 当前接口不是 Chat Completion → 管理器尚未建立
    if (!isPromptManagerExposed()) {
        return {
            status: '注入状态：⚠️ 读不到提示词管理器（补丁不完整）',
            detail: '状态：读取不到提示词管理器 —— ST 补丁为旧版'
                + '（未把 promptManager 暴露到 getContext()）。'
                + '请重新应用 patches/st-marker-prompt.patch 并 Ctrl+F5 强制刷新。',
        };
    }
    if (!pm || !pm.serviceSettings || typeof pm.getPromptById !== 'function') {
        return {
            status: '注入状态：⚠️ 提示词管理器未就绪（需 Chat Completion 类接口）',
            detail: '状态：提示词管理器尚未就绪（需要选中 Chat Completion 类接口）。',
        };
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
        return {
            status: '注入状态：⚠️ 预设里没有这张卡片',
            detail: `状态：预设「${preset}」里没有这张卡片。\n`
                + `本扩展不再自动创建卡片 —— 请在预设 JSON 里加入下面这一条（详见 README 3.3）：\n`
                + `  prompts:     { "identifier": "${PRESET_PROMPT.ID}", "name": "${PRESET_PROMPT.NAME}", "system_prompt": true, "marker": true }\n`
                + `  prompt_order（每个块都要加）: { "identifier": "${PRESET_PROMPT.ID}", "enabled": true }\n`
                + `位置建议紧跟在 "worldInfoAfter" 之后。\n`
                + patchLine,
        };
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
    return {
        status: `注入状态：${enabled ? '🟢 已启用（注入中）' : '🔴 已停用（不注入）'}`,
        detail: `状态：${enabled ? '🟢 已启用（注入中）' : '🔴 已停用（不注入）'}`
            + `\n预设「${preset}」· 标识 ${PRESET_PROMPT.ID} · 位置与开关都在预设 UI 里管理`
            + `\n形态：${shape}`
            + `\n${patchLine}`
            + `\n${controlsLine}`
            + `\n预览：${hasInspectable
                ? '已注入过 —— 点预设里卡片的名字可查看本次内容'
                : '点预设里卡片的名字即可查看（补丁支持即时构建预览）'}`
            + (enabled ? '' : '\n要重新启用：在预设 UI 里打开这张卡片的开关'),
    };
}

/**
 * 把 describeJournalCard() 的两份文案分别落地：
 *   - 主面板「日记 → 提示词注入」区块：一行状态
 *   - 酒馆「扩展」设置面板的日记卡片区块：完整诊断
 * 两个元素都可能不在 DOM 里（设置面板要等 APP_READY 后由模板渲染），所以都要容错。
 */
function updatePresetCardHint() {
    const { status, detail } = describeJournalCard();
    const statusEl = document.getElementById('roleEx-inject-status');
    if (statusEl) {
        statusEl.textContent = status;
    }
    const detailEl = document.getElementById('roleEx-preset-card-hint');
    if (detailEl) {
        detailEl.textContent = detail;
        detailEl.style.whiteSpace = 'pre-line';
    }
}

/** 打开酒馆「AI Response Configuration」侧栏 —— 日记卡片的位置与启停都在那里管 */
function openPresetPanel() {
    const panel = document.getElementById('left-nav-panel');
    if (panel?.classList.contains('openDrawer')) {
        return;
    }
    document.getElementById('ai-config-button')?.querySelector('.drawer-toggle')?.click();
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
                el('div', { class: 'menu_button roleEx-btn', text: '取消', onclick: close }),
                el('div', {
                    class: 'menu_button roleEx-btn', text: '保存', onclick: async () => {
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

    return { buildJournalPanel, deleteJournalEntries, deleteSelectedJournals, describeJournalCard, downloadText, editJournalEntry, exportJournalFile, importJournalFile, openPresetPanel, renderFloors, renderJournalList, renderJournalStorageHint, setButtonBusy, updateFloorSummary, updatePresetCardHint };
}
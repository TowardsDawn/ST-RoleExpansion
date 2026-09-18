/**
 * modules/state/ui.js
 *
 * ⚠️ 主体是从 index.js 机械搬运过来的（章节：UI：状态栏），
 *    除下面的依赖头外没有改写 —— 保留原字节是为了 diff 干净、避免改坏字符串。
 *    依赖方向：框架设施由 kernel 注入；同模块跨文件用 rt.<key>.xxx 惰性转发；
 *    跨模块只走 kernel.service()，模块不在时取安全缺省。
 */

export function createStateUi(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它的字段快照）
    const { checkboxRow, debounce, el, iconFor, section, settings, splitLines, toast, ui, updateSetting } = kernel;
    // 同模块、别的文件：惰性转发（调用时才取，绕开文件创建顺序的循环依赖）
    const applyStateInjection = (...args) => rt.inject.applyStateInjection(...args);
    const buildStateText = (...args) => rt.inject.buildStateText(...args);
    const getStateList = (...args) => rt.store.getStateList(...args);
    const saveMeta = (...args) => rt.store.saveMeta(...args);

// UI：状态栏
// ============================================================================

function buildStatePanel() {
    const s = section('角色状态栏', { open: false });
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
        // 单项「恢复默认」已删除（与日记主提示词一致）：统一走扩展设置面板的「恢复默认设置」。
        // 两个标签必须是 roleEx-inline-label：本行是**不换行**的 flex 行，
        // 普通 .roleEx-hint 会被压到 min-content（中文 = 一个字宽）→ 竖排。见 style.css 同名规则。
        el('div', { class: 'roleEx-row roleEx-gap roleEx-vcenter' }, [
            el('span', { class: 'roleEx-hint roleEx-inline-label', text: '注入深度' }),
            depthInput,
            el('span', { class: 'roleEx-hint roleEx-inline-label', text: '注入角色' }),
            roleSelect,
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

    return { buildStatePanel, renderStateList };
}

/**
 * modules/journal —— 「日记」模块（可以整个目录拆掉）
 *
 * 拆掉它之后：主面板不再有「日记」区块、扩展设置面板不再有日记卡片诊断，
 * 框架与「角色状态栏」照常工作（框架用动态 import 加载，失败就当作没装）。
 *
 * 三条接口约定：
 *   1. 框架 → 模块：框架里保留原调用点，靠 index.js「模块桥接」章节的同名转发壳
 *      调到这里 create() 返回的 api 上的同名函数（reloadJournal / renderFloors / …）。
 *   2. 模块 → 框架：只用 create(kernel) 拿到的那份 kernel（el/section/settings/ui/…）。
 *      settings 与 ui 是**长期同一个对象**，永远不要缓存它们的字段快照。
 *   3. 模块 → 别的模块：只走 kernel.service('state')，对方不在时取安全缺省。
 */
import { createJournalStorage } from './storage.js';
import { createJournalFloors } from './floors.js';
import { createJournalGenerate } from './generate.js';
import { createJournalInject } from './inject.js';
import { createJournalUi } from './ui.js';

/** 本模块的设置默认值：框架启动时并进 DEFAULT_SETTINGS，也参与「存为默认设置」的基准 */
const DEFAULTS = {
    // 日记
    journalMainPrompt: [
        '你是 {{char}}。请以 {{char}} 的第一人称视角，写一篇私人日记。',
        '',
        '要求：',
        '1. 严格基于下方给出的【聊天记录参考】中的事实，不要编造未发生过的重要剧情。',
        '2. 写出 {{char}} 的内心活动、情绪变化、对 {{user}} 的看法，语气与角色设定一致。',
        '3. 这是独立的一篇日记，不要承接、续写任何其他日记，不要出现"上回说到"之类的表述。',
        '4. 正文 200~500 字，不要分小标题。',
        '5. 同时为这篇日记拟一个标题。',
        '',
        '输出格式（必须严格遵守，不要输出任何额外说明）：',
        '第一行：<title>日记标题</title>',
        '第二行开始：日记正文',
        '不要在正文里重复标题，也不要出现任何 XML/HTML 标签（除了上面那一对 <title>）。',
        '',
        '【聊天记录参考】',
        '{{chatRange}}',
        '',
        '【其他日记参考】',
        '{{journalRefs}}',
        '',
        '【当前状态参考】',
        '{{stateList}}',
    ].join('\n'),
    journalRefHeader: '以下是已有的其他日记，仅供你保持人物口径一致，不要重复其中的内容：',
    journalInjectHeader: '[以下是 {{char}} 先前写下的日记，属于既有事实，请保持设定与记忆的一致性]',
    journalInjectSeparator: '\n\n---\n\n',
    journalInjectIncludeTitle: true,
    // 「是否把日记注入主聊天」由预设卡片上的开关控制，不在这里设置
    journalInjectToJournal: false,
    // 隔离生成（默认开）：日记请求只带提示词本身，走 ST 的 generateRaw 通道，
    // 不含主聊天记录 / 世界书 / 预设卡片；关闭则退回 generateQuietPrompt。
    journalIsolatedGeneration: true,
    // 隔离通道下「随日记带入」的角色卡字段，三个独立开关（全部关掉 = 不带任何角色设定）。
    // 注入顺序固定为：角色描述 → 性格 → 用户设定 → 场景，见 buildJournalCharacterBlock()。
    journalCardProfile: true,
    // 角色卡 description + personality（共用一个开关）
    journalCardPersona: true,
    // 当前用户人设 persona
    journalCardScenario: true,
    // 角色卡 scenario
    // 预留字段：非空时整体替换自动抽取的角色设定块（将来「可编辑覆盖」功能的入口）。
    journalCharacterCardOverride: '',
    journalFallbackTitle: '日记',
};

export default {
    id: 'journal',
    title: '日记',
    icon: 'fa-solid fa-book',
    defaults: DEFAULTS,
    create(kernel) {
        const rt = {};
        // 创建顺序有讲究：ui 会**直接读** inject.PRESET_PROMPT / generate.generateJournal
        // （常量直读，不是惰性转发），所以 inject、generate 必须先建好。
        // 其余跨文件引用一律惰性转发，因此不受顺序影响、也天然允许循环引用。
        rt.storage = createJournalStorage(kernel, rt);
        rt.floors = createJournalFloors(kernel, rt);
        rt.generate = createJournalGenerate(kernel, rt);
        rt.inject = createJournalInject(kernel, rt);
        rt.ui = createJournalUi(kernel, rt);

        return {
            id: 'journal',
            ...rt.storage,
            ...rt.floors,
            ...rt.generate,
            ...rt.inject,
            ...rt.ui,
            /** 主面板里的一个区块；框架把它 append 进 #roleEx-scroll */
            buildPanelSection: () => rt.ui.buildJournalPanel().section.root,

            /**
             * 扩展设置面板里属于日记模块的那一块：卡片诊断 + 打开预设面板。
             * 模块被拆掉 / 被禁用时这一块自然不存在 —— 框架只提供一个空容器，
             * 所以绝不会出现「模块没了还挂着一块永远『检测中…』的 UI」。
             */
            settingsBlock: () => {
                const { el } = kernel;
                const cardId = rt.inject.PRESET_PROMPT.ID;
                const btn = el('div', {
                    class: 'menu_button roleEx-btn-sm',
                    id: 'roleEx-setting-open-preset',
                    title: '打开「AI Response Configuration」侧栏，在那里拖动 / 开关日记卡片',
                    text: '打开预设面板',
                    onclick: () => rt.ui.openPresetPanel(),
                });
                return el('div', { class: 'roleEx-settings-block' }, [
                    el('div', { class: 'roleEx-label', html: '日记卡片 · <code>' + cardId + '</code>' }),
                    el('div', { class: 'roleEx-hint', id: 'roleEx-preset-card-hint', text: '状态：检测中…' }),
                    el('div', { class: 'roleEx-row roleEx-gap roleEx-vcenter roleEx-wrap' }, [
                        btn,
                        el('span', { class: 'roleEx-hint', text: '开关卡片＝启停注入；正文由扩展提供，位置与启停都在预设 UI 里管理' }),
                    ]),
                ]);
            },
            /** 本模块对外提供的服务：没有（它是 getStateList / buildStateText 的消费方） */
            services: {},
        };
    },
};

/**
 * modules/outfit —— 「衣装打扮」模块（可以整个目录拆掉）
 *
 * 拆掉它之后：主面板不再有「衣装打扮」区块、扩展设置面板不再有衣装卡片诊断，
 * 框架与其它模块照常工作（框架用动态 import 加载，失败就当作没装）。
 *
 * 三条接口约定（与日记 / 推特同一套）：
 *   1. 框架 → 模块：靠框架 index.js「模块桥接」里的同名转发壳调到这里
 *      （renderOutfit / reloadOutfit / ensureOutfitRuntimeSource /
 *        adoptOutfitCardStateFromPreset / updateOutfitPresetCardHint）。
 *   2. 模块 → 框架：只用 create(kernel) 拿到的那份 kernel。
 *   3. 模块 → 别的模块：这里**不依赖任何其它模块**。
 *
 * 数据只有一份：会话目录下的一个 jsonl（分类表 + 已选 tag），
 * 注入主聊天靠的是预设里用户自己维护的那张 marker 卡片（见 inject.js）。
 */
import { createOutfitStore } from './store.js';
import { createOutfitInject } from './inject.js';
import { createOutfitUi } from './ui.js';

/** 本模块的设置默认值：框架启动时并进 DEFAULT_SETTINGS，也参与「存为默认设置」的基准 */
const DEFAULTS = {
    // 注入模板：{{outfitList}} 是 store 拼好的正文，其余 {{...}} 交给酒馆宏
    outfitInjectPrompt: [
        '[以下是 {{char}} 当前的衣装打扮，请在描写与对话中保持一致]',
        '{{outfitList}}',
    ].join('\n'),
    // 是否把同一份卡片正文也登记成世界书扫描源（默认关：扫描那一层不受 scan depth 截断，
    // 比「注入主聊天」的影响面大得多）。需要 ST 侧 st-wi-scan-source 补丁，见 inject.js。
    outfitWIScan: false,
};

export default {
    id: 'outfit',
    title: '衣装打扮',
    icon: 'fa-solid fa-shirt',
    defaults: DEFAULTS,
    create(kernel) {
        const rt = {
            // 模块自己的运行时状态（单模块自用，不往框架的 ui 里塞）
            state: {
                identity: null,      // 当前会话身份（落点文件名）
                catalog: [],         // 分类表：store 建好时按内置固定分类补齐
                picked: {},          // { 分类key: 已选 tag[] }
                reason: null,        // 不可用原因（group / no-character / patch-missing），null = 正常
                probed: false,       // 资源通道只探一次
                loaded: false,       // 本会话的数据读过没有
                autoLoadTried: false,// renderOutfit 的自愈加载只做一次
                skipped: 0,          // 本次读取跳过的非法行数
                skippedNote: '',     // 给状态行用的一句话提示
                panel: null,         // 当前面板的 DOM 引用（面板重建就整体换掉）
            },
        };
        // 依赖顺序：store → inject → ui（ui 直接读 rt.store.PARTS / rt.inject.PRESET_PROMPT）
        rt.store = createOutfitStore(kernel, rt);
        rt.inject = createOutfitInject(kernel, rt);
        rt.ui = createOutfitUi(kernel, rt);

        return {
            id: 'outfit',
            ...rt.store,
            ...rt.inject,
            ...rt.ui,
            /** 主面板里的一个区块；框架把它 append 进 #roleEx-scroll */
            buildPanelSection: () => rt.ui.buildOutfitPanel().section.root,

            /**
             * 扩展设置面板里属于衣装模块的那一块：卡片诊断 + 打开预设面板。
             * 模块被拆掉 / 被禁用时这一块自然不存在 —— 框架只提供一个空容器。
             */
            settingsBlock: () => {
                const { el } = kernel;
                const cardId = rt.inject.PRESET_PROMPT.ID;
                return el('div', { class: 'roleEx-settings-block' }, [
                    el('div', { class: 'roleEx-label', html: '衣装卡片 · <code>' + cardId + '</code>' }),
                    el('div', { class: 'roleEx-hint', id: 'roleEx-preset-card-hint-outfit', text: '状态：检测中…' }),
                    el('div', { class: 'roleEx-row roleEx-gap roleEx-vcenter roleEx-wrap' }, [
                        el('div', {
                            class: 'menu_button roleEx-btn-sm',
                            id: 'roleEx-setting-open-preset-outfit',
                            title: '打开「AI Response Configuration」侧栏，在那里拖动 / 开关衣装卡片',
                            text: '打开预设面板',
                            onclick: () => rt.ui.openPresetPanel(),
                        }),
                        el('span', { class: 'roleEx-hint', text: '开关卡片＝启停注入；正文由扩展提供，位置与启停都在预设 UI 里管理' }),
                    ]),
                ]);
            },
            /** 本模块对外提供的服务：没有（它只提供面板与预设正文源） */
            services: {},
        };
    },
};

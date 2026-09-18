/**
 * modules/state —— 「角色状态栏」模块（可以整个目录拆掉）
 *
 * 拆掉它之后：主面板不再有「角色状态栏」区块、不再注入状态、不再解析 <名称>值</名称> 标签，
 * 框架与「日记」照常工作（日记里的 {{stateList}} 会退化成一句提示，见 journal/generate.js 的服务缺省）。
 *
 * 接口约定同 journal/index.js 顶部那段说明。
 */
import { createStateStore } from './store.js';
import { createStateInject } from './inject.js';
import { createStateUi } from './ui.js';

/** 本模块的设置默认值：框架启动时并进 DEFAULT_SETTINGS，也参与「存为默认设置」的基准 */
const DEFAULTS = {
    // 状态栏
    stateEnabled: true,
    stateAutoInject: true,
    stateStripTags: true,
    stateInjectDepth: 0,
    stateInjectRole: 'system',
    stateIncludeInJournal: true,
    // 只接受状态列表里已有的名称（推荐开启）。
    // 关闭后，回复里任意 <名称>值</名称> 都会被当成新状态项自动加入列表 —— 误吞风险由用户自担。
    stateOnlyKnownNames: true,
    stateInjectPrompt: [
        '当前状态：',
        '{{stateList}}',
        '',
        '请参考以上状态。在回答时，如有任何状态数值因剧情发生变化，请仅输出发生变化的状态项，并使用 XML 标签格式表示，例如：<生命值>8/10</生命值>。如果没有状态变化，请不要输出任何状态标签。',
    ].join('\n'),
};

export default {
    id: 'state',
    title: '角色状态栏',
    icon: 'fa-solid fa-heart-pulse',
    defaults: DEFAULTS,
    create(kernel) {
        const rt = {};
        // 被其它模块通过服务消费的就是 getStateList / buildStateText 这两个；
        // 它们分别是 store / inject 的顶层函数，所以下面全部平铺进 api。
        rt.store = createStateStore(kernel, rt);
        rt.inject = createStateInject(kernel, rt);
        rt.ui = createStateUi(kernel, rt);

        return {
            id: 'state',
            ...rt.store,
            ...rt.inject,
            ...rt.ui,
            /** 主面板里的一个区块；框架把它 append 进 #roleEx-scroll */
            buildPanelSection: () => rt.ui.buildStatePanel().root,
            /** 本模块对外提供的服务（日记模块通过 kernel.service('state') 取用） */
            services: {
                getStateList: rt.store.getStateList,
                buildStateText: rt.inject.buildStateText,
            },
        };
    },
};

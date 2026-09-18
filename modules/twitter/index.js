/**
 * modules/twitter —— 「推特」模块（可以整个目录拆掉）
 *
 * 拆掉它之后：主面板不再有「推特」区块，框架与「日记」「角色状态栏」照常工作。
 *
 * 三条接口约定（与日记/状态模块同一套）：
 *   1. 框架 → 模块：靠框架 index.js「模块桥接」里的同名转发壳调到这里
 *      （onCharacterMessageReceived / reloadTwitter / renderTwitter）。
 *   2. 模块 → 框架：只用 create(kernel) 拿到的那份 kernel。
 *   3. 模块 → 别的模块：这里**不依赖任何其它模块**。
 *
 * 数据分三类（详见模块 README）：
 *   用户编辑  → 资料区（名字/认证/handle/简介/meta/统计）+ 头像/横幅图片
 *   模型输出  → <推文>正文</推文> + <推文时间>…</推文时间>
 *   随机生成  → 评论/转发/点赞/浏览（生成即固化，只能手改 JSONL）
 * 全部存在 <user>/chats/<角色目录>/_RoleExpansion/twitter/ 下（一个 jsonl + avatar.png + banner.jpg）。
 */
import { createTwitterStats } from './stats.js';
import { createTwitterStore } from './store.js';
import { createTwitterCapture } from './capture.js';
import { createTwitterRender } from './render.js';
import { createTwitterUi } from './ui.js';

/** 本模块的设置默认值：框架启动时并进 DEFAULT_SETTINGS，也参与「存为默认设置」的基准 */
const DEFAULTS = {
    // 解析模型回复里的 <推文> / <推文时间>
    twitterCapture: true,
    // 把消费掉的标签从正文里剥离（关掉则标签留在正文里，但推文照常收录）
    twitterStripTags: true,
};

export default {
    id: 'twitter',
    title: '推特',
    icon: 'fa-brands fa-x-twitter',
    defaults: DEFAULTS,
    create(kernel) {
        const rt = {
            // 模块自己的运行时状态（单模块自用，不往框架的 ui 里塞）
            state: {
                identity: null,
                profile: null,
                tweets: [],
                tweetImages: {},   // 配图文件名 → data URL（缺的就是读不到，渲染时跳过）
                avatarDataUrl: '',
                bannerDataUrl: '',
                reason: null,      // 不可用原因（group / patch-missing / …），null = 正常
                loaded: false,
                panel: null,       // 当前面板的 DOM 引用（面板重建就整体换掉）
            },
        };
        // 依赖顺序：stats（无依赖）→ store → capture → render → ui
        rt.stats = createTwitterStats(kernel, rt);
        rt.store = createTwitterStore(kernel, rt);
        rt.capture = createTwitterCapture(kernel, rt);
        rt.render = createTwitterRender(kernel, rt);
        rt.ui = createTwitterUi(kernel, rt);

        return {
            id: 'twitter',
            ...rt.stats,
            ...rt.store,
            ...rt.capture,
            ...rt.render,
            ...rt.ui,
            /** 主面板里的一个区块；框架把它 append 进 #roleEx-scroll */
            buildPanelSection: () => rt.ui.buildTwitterPanel().root,
        };
    },
};

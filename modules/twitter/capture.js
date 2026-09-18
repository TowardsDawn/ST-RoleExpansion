/**
 * modules/twitter/capture.js
 *
 * 从模型的角色回复里捕获推文：
 *   <推文时间>2小时前</推文时间>   可选；配给它**后面的第一条** <推文>，配完即作废
 *   <推文>正文…</推文>            必填；一条回复里可以有多组
 *
 * 剥离策略：只要这条消息里出现 <推文>，就把两种标签**全部**从正文里剥掉（孤儿 <推文时间> 也不留），
 * 免得模型偶尔漏配时在正文里留下半截标签；只有孤儿的 <推文时间>（整条消息没有 <推文>）时不动正文，
 * 只在控制台记一行。统计数字在创建时随机生成一次，之后固化。
 */

export function createTwitterCapture(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它们的字段快照）
    const { assetReasonText, ctx, logError, settings, toast, ui, uid } = kernel;
    // 同模块、别的文件：惰性转发（调用时才取，绕开文件创建顺序的循环依赖）
    const makeStats = (...args) => rt.stats.makeStats(...args);
    const normalizeTweet = (...args) => rt.store.normalizeTweet(...args);
    const persistTwitterData = (...args) => rt.store.persistTwitterData(...args);
    const renderTwitter = (...args) => rt.ui.renderTwitter(...args);

/** 标签名：没写在设置里，是模块对外的格式契约，改它就等于换契约 */
const TWEET_OPEN = '<推文>';
const TWEET_CLOSE = '</推文>';
const TIME_OPEN = '<推文时间>';
const TIME_CLOSE = '</推文时间>';

/** 一次扫出两种标签，保持出现顺序 */
const TAG_RE = /<推文时间>([\s\S]*?)<\/推文时间>|<推文>([\s\S]*?)<\/推文>/g;

/** 新推文的排序序号 = 当前最大 + 1（越大越新，排在时间线越上面） */
function nextSeq() {
    let max = 0;
    for (const tweet of rt.state.tweets) {
        const n = Number(tweet?.seq);
        if (Number.isFinite(n) && n > max) {
            max = n;
        }
    }
    return max + 1;
}

/** 造一条推文（统计数字在这里随机生成，之后不再变） */
function makeTweet({ time = '', content = '', seq = null, sourceMessageIds = [], stats = null }) {
    const now = Date.now();
    const hasSeq = seq !== null && seq !== undefined && seq !== '' && Number.isFinite(Number(seq));
    const next = nextSeq();
    return normalizeTweet({
        id: uid(),
        time: String(time ?? '').trim(),
        content: String(content ?? '').trim(),
        seq: hasSeq ? Math.round(Number(seq)) : next,
        pinned: false,
        stats: stats || makeStats(),
        createdAt: now,
        updatedAt: now,
        sourceMessageIds: Array.isArray(sourceMessageIds) ? sourceMessageIds : [],
    }, nextSeq());
}

/**
 * 从一段正文里解析推文。
 * @returns {{ tweets: {time: string, content: string}[], changed: boolean, stripped: string, ignored: string[] }}
 */
function parseTweetTags(text) {
    const src = String(text ?? '');
    const out = { tweets: [], changed: false, stripped: src, ignored: [] };
    if (!src.includes(TWEET_OPEN) && !src.includes(TIME_OPEN)) {
        return out;
    }

    TAG_RE.lastIndex = 0;
    const matches = [];
    let m = null;
    while ((m = TAG_RE.exec(src)) !== null) {
        const isTime = m[1] !== undefined;
        matches.push({ isTime, value: String((isTime ? m[1] : m[2]) ?? '').trim() });
    }
    if (!matches.length) {
        return out;
    }

    const hasTweet = matches.some(x => !x.isTime);
    let pendingTime = '';
    let orphanTimes = 0;
    for (const item of matches) {
        if (item.isTime) {
            if (pendingTime) {
                orphanTimes += 1;
            }
            pendingTime = item.value;
            continue;
        }
        if (!item.value) {
            out.ignored.push('(空推文)');
            continue;
        }
        out.tweets.push({ time: pendingTime, content: item.value });
        pendingTime = '';
    }
    if (pendingTime) {
        orphanTimes += 1;
    }

    if (hasTweet) {
        // 出现 <推文> 就整段清掉这两种标签（含孤儿时间标签），并压缩多余空行
        const cleaned = src.replace(TAG_RE, '').replace(/\n{3,}/g, '\n\n').trim();
        out.stripped = cleaned;
        out.changed = cleaned !== src.trim();
    } else {
        out.ignored.push('孤立的时间标签（整条消息没有 ' + TWEET_OPEN + '）');
        out.stripped = src;
        out.changed = false;
    }
    if (orphanTimes && hasTweet) {
        out.ignored.push(orphanTimes + ' 个没配到推文的时间标签');
    }
    return out;
}

/** 收一条推文（模型捕获与「手动新增」共用）：写盘失败会回滚内存，避免 UI 与磁盘不一致 */
async function addTweet({ time = '', content = '', seq = null, sourceMessageIds = [], stats = null }) {
    const body = String(content ?? '').trim();
    if (!body) {
        return { ok: false, reason: 'empty' };
    }
    const entry = makeTweet({ time, content: body, seq, sourceMessageIds, stats });
    rt.state.tweets = [...rt.state.tweets, entry];
    const res = await persistTwitterData();
    if (!res.ok) {
        rt.state.tweets = rt.state.tweets.filter(t => t.id !== entry.id);
        return res;
    }
    renderTwitter();
    return { ok: true, tweet: entry };
}

/**
 * 框架在 MESSAGE_RECEIVED 上调这里：解析最后一条角色消息里的推文。
 * 与状态模块一样，只看最后一条消息的 mes。
 */
async function onCharacterMessageReceived() {
    if (settings.twitterCapture === false) {
        return;
    }
    if (ui.generatingJournal) {
        return;
    }
    const c = ctx();
    if (c?.groupId) {
        return;
    }
    const chat = Array.isArray(c?.chat) ? c.chat : [];
    const last = chat[chat.length - 1];
    if (!last || last.is_user || typeof last.mes !== 'string') {
        return;
    }

    const parsed = parseTweetTags(last.mes);
    if (!parsed.tweets.length) {
        if (parsed.ignored.length) {
            console.info('[ST-RoleExpansion] 推特模块忽略了：', parsed.ignored);
        }
        return;
    }

    const created = parsed.tweets.map(item => makeTweet({
        time: item.time,
        content: item.content,
        sourceMessageIds: [chat.length - 1],
    }));
    rt.state.tweets = [...rt.state.tweets, ...created];

    const originalMes = last.mes;
    if (settings.twitterStripTags !== false && parsed.changed) {
        last.mes = parsed.stripped;
    }

    const res = await persistTwitterData();
    if (!res.ok) {
        // 写盘失败：推文与正文**一起**回滚 —— 否则标签内容既没进文件、又从聊天记录里消失了
        rt.state.tweets = rt.state.tweets.filter(t => !created.some(x => x.id === t.id));
        last.mes = originalMes;
        logError('persist twitter failed', res.reason);
        toast('error', assetReasonText(res.reason));
        return;
    }

    if (parsed.ignored.length) {
        console.info('[ST-RoleExpansion] 推特模块忽略了：', parsed.ignored);
    }
    toast('success', '已收录 ' + created.length + ' 条推文（见面板「推特」区块）。');
    renderTwitter();
}

    return { addTweet, makeTweet, nextSeq, onCharacterMessageReceived, parseTweetTags };
}

/**
 * modules/outfit/store.js
 *
 * 落盘：与聊天关联的**一个** jsonl，位于
 *   <user>/chats/<角色目录>/_RoleExpansion/outfit/
 * 读写走框架的「模块私有资源」通道（补丁 patches/st-twitter-assets.patch 提供，
 * 白名单子目录名就是 outfit）。
 *
 * jsonl 行结构（可手改）：
 *   第 1 行 {"__roleExpansion":"outfit-session", …}    会话头（可读的角色 / 会话名）
 *   第 2 行 {"__roleExpansion":"outfit-catalog", …}    分类表（固定分类 + 自定义分类，各带备选 tag）
 *   第 3 行 {"__roleExpansion":"outfit-selection", …}  已选 tag（按分类）
 *
 * 两个概念分清楚（面板上就是左边预览 / 右边编辑这两半）：
 *   tags    某分类的**备选表**（逗号分隔的原文，用户随时改）——芯片行由它生成
 *   picked  该分类里**已选中**的 tag —— 注入正文只用这一份
 */

export function createOutfitStore(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它们的字段快照）
    const { assetPathText, assetReasonText, clone, ctx, logError, probeAssetStorage, readAssetText, splitLines, stableHash, toast, uid, writeAssetText } = kernel;

/** 服务端子目录名（与 role-expansion-assets.js 的白名单一致） */
const SUB = 'outfit';

/** 文件名前缀（与推特 / 日记区分开） */
const PREFIX = 'RoleExpansion_outfit';

/**
 * 三大部分。分类挂在哪个部分下，决定面板里的分组、以及注入正文的分行顺序。
 * 顺序就是渲染顺序：外 → 内 → 其他。
 */
const PARTS = [
    { key: 'outer', label: '外' },
    { key: 'inner', label: '内' },
    { key: 'other', label: '其他' },
];

const PART_KEYS = new Set(PARTS.map(p => p.key));

/**
 * 固定分类：key 是**契约的一部分**（注入正文、预设卡片、自测都按它写），
 * 不可改名、不可删除；jsonl 里缺了就按这里的定义补齐。
 */
const FIXED_CATEGORIES = [
    { key: 'hat', part: 'outer', name: '头饰' },
    { key: 'top', part: 'outer', name: '上衣' },
    { key: 'bottom', part: 'outer', name: '下装' },
    { key: 'socks', part: 'outer', name: '袜子' },
    { key: 'shoes', part: 'outer', name: '鞋子' },
    { key: 'underwear', part: 'inner', name: '内衣' },
    { key: 'underpants', part: 'inner', name: '内裤' },
];

const KIND_SESSION = 'outfit-session';
const KIND_CATALOG = 'outfit-catalog';
const KIND_SELECTION = 'outfit-selection';

/** 页面级「不可用」原因 */
const AVAIL_REASONS = new Set(['group', 'no-character', 'patch-missing', 'sub-not-allowed']);

/**
 * 由**服务端**决定的那几种原因：补丁 / 白名单修好之后，同一个页面里必须还能恢复
 * （用户按文档补上补丁、改完白名单并重启酒馆主进程，回到页面不该还要按 F5）→ 见 armOutfitReprobe()。
 * group / no-character 不在这里：它们是每次现算的。
 */
const PAGE_REASONS = new Set(['patch-missing', 'sub-not-allowed']);

/** 两次重探之间的最小间隔：面板反复开关也只是一次只读请求，不会变成高频轮询 */
const REPROBE_MIN_INTERVAL_MS = 3000;

/**
 * 探针 / 读写的失败原因 → 页面级不可用原因（认不出来时返回空串）。
 *
 * ⚠️ 'invalid-path'（端点回 400）为什么能归一成「白名单里没有 outfit」：
 * 探针用的是固定合法值（合法模块名 sub + 端点内生成的合法文件名），
 * resolveAssetPath() 剩下会返回 null 的分支里：
 *   - charDir（来自 avatar_url 的 basename）异常 → 会连推特一起挂，不是衣装专有；
 *   - sub 不在 ALLOWED_SUBDIRS → 正是「装了旧版补丁」的形态；
 *   - 其余（name / ext / 路径穿越）在固定合法值下不可能触发。
 * 旧版补丁要手改一行 + 重启酒馆，不明确报出来用户根本猜不到，所以这里必须归到页面级。
 */
function toPageReason(reason) {
    const text = String(reason ?? '');
    if (AVAIL_REASONS.has(text)) {
        return text;
    }
    return text === 'invalid-path' ? 'sub-not-allowed' : '';
}

// ---------------------------------------------------------------------------
// 会话身份 / 可用性
// ---------------------------------------------------------------------------

/** 当前会话在磁盘上的身份（与 modules/twitter/store.js 的 currentChatIdentity() 同构） */
function currentIdentity() {
    const c = ctx();
    const chatId = typeof c?.getCurrentChatId === 'function' ? c.getCurrentChatId() : '';
    const charName = c?.name2 || c?.characters?.[c?.characterId]?.name || 'Character';
    const raw = chatId && String(chatId).trim()
        ? String(chatId).replace(/\.jsonl$/i, '')
        : '__noid__/' + charName;
    const parts = raw.split('/');
    const chatFile = parts.pop() || raw;
    const charDir = parts.pop() || charName;

    const charKey = stableHash(charDir).slice(0, 8);
    const chatKey = stableHash(charDir + '/' + chatFile).slice(0, 8);

    return {
        id: raw,
        charDir,
        chatFile,
        fileName: PREFIX + '_c_' + charKey + '_j_' + chatKey + '.jsonl',
    };
}

/** 群聊：衣装按角色目录存放，群聊没有角色目录（与框架 journalAvailability 同一条判据） */
function hasGroup() {
    return !!ctx()?.groupId;
}

/**
 * 有没有「落点」（角色目录）——**严格照框架口径**，与 journalAvailability() / currentAvatarUrl() 同一条判据：
 * 认的是 `characters[characterId].avatar`，拿不到就是没有。
 *
 * 为什么不拿 name2 / getCurrentChatId() 兜底：那会让「面板说可用、真去读写时框架判 no-character」，
 * 于是每次保存只剩一句通用 Toast（用户看到的是红字消失、点了才报错）。落点这个概念只有一个来源，
 * 两处判据不一致比少一层兜底危险得多。群聊在上层单独判（hasGroup），不在这里。
 */
function hasCharacter() {
    const c = ctx();
    const ch = c?.characters?.[c?.characterId];
    return !!(ch && ch.avatar && String(ch.avatar).trim());
}

/**
 * 当前能不能读写衣装文件。
 *
 * 「群聊」「没选角色」是**每次现算**的（换会话就变）；「缺补丁 / 白名单没有 outfit」进不了本地判断，
 * 由 probeOutfitStorage() 探一次后缓存在 rt.state.reason 里（这两件事在同一个页面里不会变，
 * 所以只探一次）。没有证据时一律算可用 —— 真去写盘时该报错还是会报。
 *
 * @returns {{ ok: boolean, reason: null|'group'|'no-character'|'patch-missing'|'sub-not-allowed' }}
 */
function outfitAvailability() {
    if (hasGroup()) {
        return { ok: false, reason: 'group' };
    }
    if (!hasCharacter()) {
        return { ok: false, reason: 'no-character' };
    }
    const reason = rt.state.reason;
    if (reason && AVAIL_REASONS.has(reason)) {
        return { ok: false, reason };
    }
    return { ok: true, reason: null };
}

/** 文件在磁盘上的位置（给人看；不可用时是空串） */
function outfitPathText() {
    return assetPathText(SUB, currentIdentity().fileName);
}

/**
 * 本模块自己的「不可用 / 失败」文案。
 *
 * 框架的 assetReasonText() 不认识 sub-not-allowed（它是本模块把探针的 invalid-path 归一出来的），
 * 所以那句话必须由这里给出 —— 而且必须能让用户**直接照做**：改白名单 + 重启酒馆主进程。
 * 读、写撞上 invalid-path 时同样按这套归一（文件名是本模块生成的合法单段 ASCII，
 * 剩下的可能只有白名单），返回的 reason 字段不改，只有给人看的文案被换成可照做的那句。
 * 其余原因照旧走框架文案（群聊 / 没选角色 / 缺补丁三句都在那儿）。
 */
function outfitReasonText(reason) {
    const page = toPageReason(reason) || String(reason ?? '');
    if (page === 'sub-not-allowed') {
        return '服务端拒绝了 outfit 路径 —— 若你装的是旧版 st-twitter-assets.patch，'
            + '请把 src/endpoints/role-expansion-assets.js 里的 ALLOWED_SUBDIRS 改成 [\'twitter\', \'outfit\']，'
            + '然后重启酒馆主进程。';
    }
    return assetReasonText(page);
}

/**
 * 只读探针：确认资源通道（补丁）在不在。整个页面生命周期里只探一次 ——
 * rt.state.reason 就是它的结果缓存，outfitAvailability() 直接读那份缓存。
 */
async function probeOutfitStorage() {
    if (hasGroup() || !hasCharacter()) {
        // 这两种情况连探都不用探：本地就判不可用
        rt.state.probed = true;
        rt.state.reason = hasGroup() ? 'group' : 'no-character';
        return { ok: false, reason: rt.state.reason };
    }
    rt.state.lastProbeAt = Date.now();
    let res = null;
    try {
        res = await probeAssetStorage(SUB);
    } catch (e) {
        logError('probe outfit storage failed', e);
        rt.state.probed = true;
        return { ok: false, reason: 'probe-failed' };
    }
    rt.state.probed = true;
    const raw = res && res.ok ? '' : String(res?.reason || '');
    const page = toPageReason(raw);
    if (page) {
        if (page === 'sub-not-allowed') {
            // 明确报出来：这正是「装了旧版补丁（白名单里没有 outfit）」的形态
            logError('probe outfit storage: 服务端拒绝了 outfit 路径（invalid-path / 400）——'
                + ' 资源端点的白名单里没有 outfit。把 src/endpoints/role-expansion-assets.js 的'
                + " ALLOWED_SUBDIRS 改成 ['twitter', 'outfit']，然后重启酒馆主进程。");
        }
        rt.state.reason = page;
        return { ok: false, reason: page, rawReason: raw || null };
    }
    if (raw) {
        // 网络抖动之类：不当作「这个功能不可用」（那会让面板整块置灰），只记一笔
        logError('probe outfit storage: unexpected reason', raw);
        return { ok: false, reason: raw };
    }
    rt.state.reason = null;
    return { ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// 文本 ↔ 数据
// ---------------------------------------------------------------------------

/**
 * 逗号列表 → 去重后的 tag 数组。
 * ⚠️ 只按**英文逗号**切分（与 ST 世界书的「关键字列表」一致）：中文逗号、顿号都不是分隔符。
 */
function parseTagList(text) {
    const out = [];
    for (const raw of String(text ?? '').split(',')) {
        const tag = raw.trim();
        if (!tag || out.includes(tag)) {
            continue;
        }
        out.push(tag);
    }
    return out;
}

/** 任意来源（字符串 / 数组）的 tag 都走 parseTagList 再合并去重 */
function normalizeTags(value) {
    const out = [];
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
        for (const tag of parseTagList(item)) {
            if (!out.includes(tag)) {
                out.push(tag);
            }
        }
    }
    return out;
}

function fixedDef(key) {
    return FIXED_CATEGORIES.find(def => def.key === key) || null;
}

/** 内置的固定分类（tags 全空） */
function makeFixedCatalog() {
    return FIXED_CATEGORIES.map(def => ({
        key: def.key, part: def.part, name: def.name, custom: false, tags: [],
    }));
}

function findCategory(key) {
    return rt.state.catalog.find(c => c.key === key) || null;
}

/** 所有分类都出现、未选的为空数组的完整选择表 */
function emptyPicked(catalog) {
    const out = {};
    for (const cat of catalog) {
        out[cat.key] = [];
    }
    return out;
}

/**
 * 归一化分类表（手改 JSONL 写坏了也不会炸）：
 *   - 固定分类：name / part 一律以内置定义为权威
 *   - 自定义分类：key 必须是 custom- 前缀、part 必须是已知部分、name 不能为空，否则丢掉
 *   - 固定分类缺失按内置补齐，顺序恒为：外 → 内 → 其他（自定义按 jsonl 里的先后）
 */
function normalizeCatalog(src) {
    const list = Array.isArray(src?.categories) ? src.categories : [];
    const fixed = [];
    const customs = [];
    const seen = new Set();
    for (const item of list) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            continue;
        }
        const key = String(item.key ?? '').trim();
        if (!key || seen.has(key)) {
            continue;
        }
        const def = fixedDef(key);
        if (def) {
            seen.add(key);
            fixed.push({ key: def.key, part: def.part, name: def.name, custom: false, tags: normalizeTags(item.tags) });
            continue;
        }
        // 未知的固定 key（既不是内置分类、也不是 custom- 前缀）丢掉
        if (!key.startsWith('custom-')) {
            continue;
        }
        const part = String(item.part ?? '').trim();
        if (!PART_KEYS.has(part)) {
            continue;
        }
        const name = String(item.name ?? '').trim();
        if (!name) {
            continue;
        }
        seen.add(key);
        customs.push({ key, part, name, custom: true, tags: normalizeTags(item.tags) });
    }
    const filled = FIXED_CATEGORIES.map(def => fixed.find(c => c.key === def.key) || {
        key: def.key, part: def.part, name: def.name, custom: false, tags: [],
    });
    return filled.concat(customs);
}

/**
 * 归一化选择表：补成「所有分类都在」的完整表；不在 catalog 里的 key 与
 * 不在该分类备选表里的 tag 一律丢掉；顺序按备选表（不是点击顺序）。
 */
function normalizePicked(src, catalog) {
    const raw = src && typeof src === 'object' && !Array.isArray(src) && src.picked
        && typeof src.picked === 'object' && !Array.isArray(src.picked)
        ? src.picked
        : {};
    const out = {};
    for (const cat of catalog) {
        const value = Array.isArray(raw[cat.key]) ? raw[cat.key].join(',') : raw[cat.key];
        const chosen = parseTagList(value);
        out[cat.key] = cat.tags.filter(tag => chosen.includes(tag));
    }
    return out;
}

/** 让选择表按当前备选表重排（同时丢掉已从备选表里删掉的 tag） */
function alignSelection(catalog, picked) {
    const out = {};
    for (const cat of catalog) {
        const chosen = Array.isArray(picked?.[cat.key]) ? picked[cat.key] : [];
        out[cat.key] = cat.tags.filter(tag => chosen.includes(tag));
    }
    return out;
}

/** 解析 jsonl：会话头 / 分类 / 选择；非法行跳过并计数 */
function parseOutfitJsonl(text) {
    const raw = { session: null, catalogSrc: null, pickedSrc: null, skipped: 0 };
    for (const rawLine of splitLines(text)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        let obj = null;
        try {
            obj = JSON.parse(line);
        } catch (e) {
            raw.skipped += 1;
            continue;
        }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            raw.skipped += 1;
            continue;
        }
        if (obj.__roleExpansion === KIND_SESSION) {
            raw.session = obj;
        } else if (obj.__roleExpansion === KIND_CATALOG) {
            raw.catalogSrc = obj;
        } else if (obj.__roleExpansion === KIND_SELECTION) {
            raw.pickedSrc = obj;
        } else {
            raw.skipped += 1;
        }
    }
    const catalog = normalizeCatalog(raw.catalogSrc);
    return {
        session: raw.session,
        catalog,
        picked: normalizePicked(raw.pickedSrc, catalog),
        skipped: raw.skipped,
    };
}

/** 写回整个文件（会话头 + 分类表 + 选择表，稳定三行） */
function encodeOutfitJsonl(identity, catalog, picked) {
    const now = Date.now();
    const selection = alignSelection(catalog, picked);
    return [
        JSON.stringify({
            __roleExpansion: KIND_SESSION,
            version: 1,
            chatId: identity.id,
            charDir: identity.charDir,
            chatFile: identity.chatFile,
            savedAt: now,
        }),
        JSON.stringify({
            __roleExpansion: KIND_CATALOG,
            categories: catalog.map(c => ({
                key: c.key, part: c.part, name: c.name, custom: c.custom === true, tags: c.tags.slice(),
            })),
            updatedAt: now,
        }),
        JSON.stringify({ __roleExpansion: KIND_SELECTION, picked: selection, updatedAt: now }),
    ].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// 读 / 写
// ---------------------------------------------------------------------------

/** 内置固定分类 + 全空选择（文件不存在 / 读不到时用） */
function resetToEmpty() {
    rt.state.catalog = makeFixedCatalog();
    rt.state.picked = emptyPicked(rt.state.catalog);
}

/** 本次会话的数据是否已经读过一遍（面板与运行时源都靠它避免重复请求） */
function markLoaded() {
    rt.state.loaded = true;
}

/**
 * 给「页面级」不可用原因一次**重新探测**的机会（面板打开 / 换会话时由 ui 调）。
 *
 * 为什么必须有它：页面级原因一旦写进 rt.state.reason，只有探针能把它置回 null，
 * 而探针只在 `!probed` 时才真发请求 —— 于是用户补上补丁 / 改完白名单并重启服务端后，
 * 同一个页面里面板还是红的，必须 F5 才恢复。
 *
 * 粒度与代价：
 *   - 只对 PAGE_REASONS 生效（群聊 / 没选角色是每次现算的，不在这里管，也不受影响）；
 *   - 一次重探 = 一个只读请求（框架的 probeAssetStorage 读一个探针文件），不是写；
 *   - 同一次重探自己触发的重绘不会再叠一次（rt.state.reprobeInFlight 由 ui 的 reloadOutfit 维护）；
 *   - 两次之间至少隔 REPROBE_MIN_INTERVAL_MS，所以「面板反复开关」也只是每 3 秒最多一次；
 *   - 旧 reason 先留着不擦，探针回来之前面板不会先闪一下绿。
 *
 * @returns {boolean} true = 这次确实挂了重探，调用方应当发一次 reloadOutfit()
 */
function armOutfitReprobe() {
    if (!PAGE_REASONS.has(rt.state.reason)) {
        return false;
    }
    if (rt.state.reprobeInFlight) {
        return false;
    }
    if (Date.now() - (rt.state.lastProbeAt || 0) < REPROBE_MIN_INTERVAL_MS) {
        return false;
    }
    rt.state.probed = false;   // 让下一次 loadOutfit() 真的去探
    return true;
}

/** 读整个 jsonl（文件不存在 = 空数据，不是错误） */
async function loadOutfit() {
    const identity = currentIdentity();
    rt.state.identity = identity;

    if (hasGroup() || !hasCharacter()) {
        // 这两种「不可用」跟着会话走：过期的缓存必须清掉，否则切回单人会话还是灰的
        rt.state.reason = hasGroup() ? 'group' : 'no-character';
        resetToEmpty();
        return { ok: false, reason: rt.state.reason, identity, skipped: 0 };
    }
    if (rt.state.reason === 'group' || rt.state.reason === 'no-character') {
        rt.state.reason = null;
    }
    if (!rt.state.probed) {
        await probeOutfitStorage();
    }
    if (rt.state.reason) {
        resetToEmpty();
        return { ok: false, reason: rt.state.reason, identity, skipped: 0 };
    }

    const res = await readAssetText(SUB, identity.fileName);
    if (!res.ok) {
        // 读也会撞上「白名单没有 outfit」（文件名由本模块生成，一定是合法单段 ASCII），
        // 所以这里走同一套归一：拿到的页面级原因与探针一致。
        const page = toPageReason(res.reason);
        if (page) {
            rt.state.reason = page;
        }
        logError('read outfit jsonl failed', identity.fileName, res.reason);
        resetToEmpty();
        return { ok: false, reason: page || res.reason, identity, skipped: 0 };
    }

    const parsed = parseOutfitJsonl(res.text);
    rt.state.catalog = parsed.catalog;
    rt.state.picked = parsed.picked;
    rt.state.skipped = parsed.skipped;
    if (parsed.skipped > 0 && !rt.state.skippedNote) {
        // 只提示一次：同一份文件里的坏行不必每次读都念叨一遍
        rt.state.skippedNote = '已跳过 ' + parsed.skipped + ' 行无法解析的衣装数据';
    }
    markLoaded();
    return { ok: true, reason: null, identity, skipped: parsed.skipped };
}

/** 写回 jsonl（整文件覆盖写） */
async function saveOutfit() {
    const identity = rt.state.identity || currentIdentity();
    rt.state.identity = identity;
    const text = encodeOutfitJsonl(identity, rt.state.catalog, rt.state.picked);
    const res = await writeAssetText(SUB, identity.fileName, text);
    if (!res.ok) {
        logError('write outfit jsonl failed', identity.fileName, res.reason);
        return { ok: false, reason: res.reason, text: outfitReasonText(res.reason) };
    }
    // 写回之后就重新生成过整份文件：坏行没了，「跳过 N 行」的提示可以撤掉
    rt.state.skippedNote = '';
    markLoaded();
    return { ok: true, reason: null };
}

/**
 * 改内存 → 落盘 → 失败回滚内存并 toast；**成功才让 UI 重画**（三步约定，与推特一致）。
 * apply() 里做内存改动，可以返回一个对象，它的字段会并进返回值（例如新建分类的 key）。
 */
async function persistChange(apply) {
    const snapshot = {
        catalog: clone(rt.state.catalog),
        picked: clone(rt.state.picked),
    };
    const extra = apply() || null;
    const res = await saveOutfit();
    if (!res.ok) {
        rt.state.catalog = snapshot.catalog;
        rt.state.picked = snapshot.picked;
        toast('error', '衣装保存失败：' + res.text);
        return { ok: false, reason: res.reason, text: res.text };
    }
    return Object.assign({ ok: true, reason: null, text: '' }, extra);
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

/** 分类数组，顺序恒为：外（固定）→ 内（固定）→ 其他（自定义，按 jsonl 里的顺序） */
function getCatalog() {
    return rt.state.catalog.slice();
}

/** 已选 tag：每个数组只含选中的项，顺序按该分类的备选表；所有分类都在（未选的是空数组） */
function getSelection() {
    return alignSelection(rt.state.catalog, rt.state.picked);
}

/** 名字是否已被别的分类占用（固定分类与自定义分类一起比） */
function isCategoryNameTaken(name, exceptKey = '') {
    const clean = String(name ?? '').trim();
    if (!clean) {
        return false;
    }
    return rt.state.catalog.some(c => c.key !== exceptKey && c.name === clean);
}

/**
 * 注入用的正文（**不含** index.js 里那个模板）：
 * 每部分一行，行内 `分类名=tag1 / tag2`，分类之间用 `；`；
 * 空的部分整行不出现；一个选中项都没有时返回空串。
 */
function buildOutfitList() {
    const selection = getSelection();
    const lines = [];
    for (const part of PARTS) {
        const chunks = [];
        for (const cat of rt.state.catalog) {
            if (cat.part !== part.key) {
                continue;
            }
            const tags = selection[cat.key] || [];
            if (!tags.length) {
                continue;
            }
            chunks.push(cat.name + '=' + tags.join(' / '));
        }
        if (chunks.length) {
            lines.push(part.label + '：' + chunks.join('；'));
        }
    }
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 编辑（一律走 persistChange）
// ---------------------------------------------------------------------------

/** 该分类的备选表整表替换；备选表里已经不存在的 tag，连带从选择里清掉 */
function setCategoryTags(key, rawText) {
    const cat = findCategory(key);
    if (!cat) {
        return Promise.resolve({ ok: false, reason: 'no-category' });
    }
    const tags = parseTagList(rawText);
    return persistChange(() => {
        rt.state.catalog = rt.state.catalog.map(c => (c.key === key ? Object.assign({}, c, { tags }) : c));
        rt.state.picked[key] = tags.filter(tag => (rt.state.picked[key] || []).includes(tag));
    });
}

/** 选中 / 取消选中一个备选 tag */
function togglePicked(key, tag) {
    const cat = findCategory(key);
    const name = String(tag ?? '');
    if (!cat || !cat.tags.includes(name)) {
        return Promise.resolve({ ok: false, reason: 'no-such-tag' });
    }
    return persistChange(() => {
        const current = rt.state.picked[key] || [];
        const next = current.includes(name) ? current.filter(t => t !== name) : current.concat([name]);
        rt.state.picked[key] = cat.tags.filter(t => next.includes(t));
    });
}

/** 新建自定义分类（空名 / 重名直接拒绝，不写盘） */
function addCustomCategory(name) {
    const clean = String(name ?? '').trim();
    if (!clean) {
        return Promise.resolve({ ok: false, reason: 'empty-name' });
    }
    if (isCategoryNameTaken(clean)) {
        return Promise.resolve({ ok: false, reason: 'duplicate-name' });
    }
    const key = 'custom-' + uid();
    return persistChange(() => {
        rt.state.catalog = rt.state.catalog.concat([{
            key, part: 'other', name: clean, custom: true, tags: [],
        }]);
        rt.state.picked[key] = [];
        return { key };
    });
}

/** 重命名自定义分类（固定分类不给改） */
function renameCustomCategory(key, name) {
    const cat = findCategory(key);
    const clean = String(name ?? '').trim();
    if (!cat || !cat.custom) {
        return Promise.resolve({ ok: false, reason: 'no-category' });
    }
    if (!clean) {
        return Promise.resolve({ ok: false, reason: 'empty-name' });
    }
    if (isCategoryNameTaken(clean, key)) {
        return Promise.resolve({ ok: false, reason: 'duplicate-name' });
    }
    return persistChange(() => {
        rt.state.catalog = rt.state.catalog.map(c => (c.key === key ? Object.assign({}, c, { name: clean }) : c));
    });
}

/** 删除自定义分类：备选 tag 与已选 tag 一起清掉 */
function removeCustomCategory(key) {
    const cat = findCategory(key);
    if (!cat || !cat.custom) {
        return Promise.resolve({ ok: false, reason: 'no-category' });
    }
    return persistChange(() => {
        rt.state.catalog = rt.state.catalog.filter(c => c.key !== key);
        delete rt.state.picked[key];
    });
}

// ---------------------------------------------------------------------------
// 工厂里的状态初始化（重复调用无副作用）
// ---------------------------------------------------------------------------

(function initState() {
    if (!rt.state || typeof rt.state !== 'object') {
        rt.state = {};
    }
    // 固定分类先补齐、坏条目先丢掉：面板在任何时候打开都能画出完整的三组
    rt.state.catalog = normalizeCatalog({ categories: rt.state.catalog });
    rt.state.picked = normalizePicked({ picked: rt.state.picked }, rt.state.catalog);
    if (!rt.state.identity) {
        rt.state.identity = null;
    }
    if (!rt.state.reason || !AVAIL_REASONS.has(rt.state.reason)) {
        rt.state.reason = null;
    }
    if (typeof rt.state.probed !== 'boolean') {
        rt.state.probed = false;
    }
    if (typeof rt.state.lastProbeAt !== 'number') {
        rt.state.lastProbeAt = 0;
    }
    if (typeof rt.state.reprobeInFlight !== 'number') {
        rt.state.reprobeInFlight = 0;
    }
    if (typeof rt.state.loaded !== 'boolean') {
        rt.state.loaded = false;
    }
    if (typeof rt.state.skipped !== 'number') {
        rt.state.skipped = 0;
    }
    if (typeof rt.state.skippedNote !== 'string') {
        rt.state.skippedNote = '';
    }
}());

    return {
        AVAIL_REASONS, FIXED_CATEGORIES, KIND_CATALOG, KIND_SELECTION, KIND_SESSION, PAGE_REASONS, PARTS, PART_KEYS,
        PREFIX, REPROBE_MIN_INTERVAL_MS, SUB,
        addCustomCategory, alignSelection, armOutfitReprobe, buildOutfitList, currentIdentity, emptyPicked,
        encodeOutfitJsonl, findCategory, getCatalog, getSelection, isCategoryNameTaken, loadOutfit, makeFixedCatalog,
        normalizeCatalog, normalizePicked, normalizeTags, outfitAvailability, outfitPathText, outfitReasonText,
        parseOutfitJsonl, parseTagList, persistChange, probeOutfitStorage, removeCustomCategory, renameCustomCategory,
        resetToEmpty, saveOutfit, setCategoryTags, toPageReason, togglePicked,
    };
}

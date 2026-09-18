/**
 * modules/twitter/store.js
 *
 * 落盘：与聊天关联的一个 jsonl + 两张图片，都在
 *   <user>/chats/<角色目录>/_RoleExpansion/twitter/
 * 读写走框架的「模块私有资源」通道（补丁 patches/st-twitter-assets.patch 提供）。
 *
 * jsonl 行结构（可手改）：
 *   第 1 行  {"__roleExpansion":"twitter-session", …}  会话头（可读的角色/会话名）
 *   第 2 行  {"__roleExpansion":"twitter-profile", …}  资料区（用户编辑的部分）
 *   之后每行 {"__roleExpansion":"twitter", …}          一条推文
 */

export function createTwitterStore(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它们的字段快照）
    const { assetPathText, ctx, deleteAssetFile, logError, readAssetBinary, readAssetText, splitLines, stableHash, uid, writeAssetBinary, writeAssetText } = kernel;

/** 服务端子目录名（与 role-expansion-assets.js 的白名单一致） */
const SUB = 'twitter';

/** 文件名前缀（与日记区分开） */
const PREFIX = 'RoleExpansion_twitter';

/** 推文配图：一条推文一张，名字固定成 tweet-<推文id>.<ext>（换图会删掉另一个后缀的旧文件） */
const TWEET_IMAGE_PREFIX = 'tweet-';

/** 手改 JSONL 写花了也不会去读奇怪的东西：只认单段 ASCII 名，而且必须是 tweet- 开头 */
function normalizeImageName(value) {
    const name = String(value ?? '').trim();
    if (!/^[a-zA-Z0-9_\-.]+$/.test(name) || !name.startsWith(TWEET_IMAGE_PREFIX)) {
        return '';
    }
    return name;
}

/** 头像 / 横幅固定用这两个名字：换图即覆盖，不会残留旧文件 */
const AVATAR_NAME = 'avatar.png';
const BANNER_NAME = 'banner.jpg';

const KIND_SESSION = 'twitter-session';
const KIND_PROFILE = 'twitter-profile';
const KIND_TWEET = 'twitter';

function currentChatIdentity() {
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

/** 资料区的空值（首次使用时写进 jsonl 的第二行） */
function emptyProfile() {
    return {
        name: '',
        verified: true,
        handle: '',
        bio: '',
        meta: [],
        following: '0',
        followers: '0',
        followed: false,   // 「关注」按钮点过没有（点一下会顺带把 followers +1）
        avatar: '',
        banner: '',
    };
}

/** 把任意输入整理成一份可用的资料对象（手改 JSONL 写坏了也不会炸） */
function normalizeProfile(src) {
    const base = emptyProfile();
    if (!src || typeof src !== 'object') {
        return base;
    }
    const meta = Array.isArray(src.meta) ? src.meta : [];
    return {
        name: String(src.name ?? base.name),
        verified: src.verified !== false,
        handle: String(src.handle ?? base.handle),
        bio: String(src.bio ?? base.bio),
        meta: meta.map(x => String(x ?? '')).filter(x => x.trim() !== '').slice(0, 12),
        following: String(src.following ?? base.following),
        followers: String(src.followers ?? base.followers),
        followed: src.followed === true,
        avatar: String(src.avatar ?? ''),
        banner: String(src.banner ?? ''),
    };
}

/** 一条推文（手改 JSONL 也走这里兜底） */
function normalizeTweet(src, fallbackSeq) {
    const stats = src && typeof src.stats === 'object' && src.stats ? src.stats : {};
    const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; };
    return {
        __roleExpansion: KIND_TWEET,
        id: String(src?.id || uid()),
        time: String(src?.time ?? ''),
        content: String(src?.content ?? ''),
        seq: Number.isFinite(Number(src?.seq)) ? Math.round(Number(src.seq)) : fallbackSeq,
        pinned: src?.pinned === true,
        image: normalizeImageName(src?.image),   // 配图文件名；空 = 纯文字推文
        liked: src?.liked === true,           // 点过「❤️ 点赞」（点一下 +1、再点 -1）
        retweeted: src?.retweeted === true,   // 点过「🔄 转发」（同上）
        stats: {
            view: num(stats.view),
            like: num(stats.like),
            retweet: num(stats.retweet),
            reply: num(stats.reply),
        },
        createdAt: Number(src?.createdAt) || Date.now(),
        updatedAt: Number(src?.updatedAt) || Number(src?.createdAt) || Date.now(),
        sourceMessageIds: Array.isArray(src?.sourceMessageIds) ? src.sourceMessageIds : [],
    };
}

/** 解析 jsonl：会话头 / 资料 / 推文；非法行跳过并计数 */
function parseTwitterJsonl(text) {
    const out = { session: null, profile: null, tweets: [], skipped: 0 };
    if (!text) {
        return out;
    }
    let index = 0;
    for (const rawLine of splitLines(text)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        let obj = null;
        try {
            obj = JSON.parse(line);
        } catch (e) {
            out.skipped += 1;
            continue;
        }
        if (!obj || typeof obj !== 'object') {
            out.skipped += 1;
            continue;
        }
        if (obj.__roleExpansion === KIND_SESSION) {
            out.session = obj;
            continue;
        }
        if (obj.__roleExpansion === KIND_PROFILE) {
            out.profile = normalizeProfile(obj);
            continue;
        }
        if (typeof obj.content === 'string') {
            index += 1;
            out.tweets.push(normalizeTweet(obj, index));
            continue;
        }
        out.skipped += 1;
    }
    return out;
}

/** 写回整个文件（会话头 + 资料 + 全部推文） */
function encodeTwitterJsonl(identity, profile, tweets) {
    const lines = [];
    lines.push(JSON.stringify({
        __roleExpansion: KIND_SESSION,
        version: 1,
        chatId: identity.id,
        charDir: identity.charDir,
        chatFile: identity.chatFile,
        savedAt: Date.now(),
        count: tweets.length,
    }));
    lines.push(JSON.stringify(Object.assign({ __roleExpansion: KIND_PROFILE }, profile)));
    for (const tweet of tweets) {
        lines.push(JSON.stringify(Object.assign({}, tweet, { __roleExpansion: KIND_TWEET })));
    }
    return lines.join('\n') + '\n';
}

/** 读整个 jsonl（文件不存在 = 空数据，不是错误） */
async function loadTwitterData() {
    const identity = currentChatIdentity();
    rt.state.identity = identity;
    const res = await readAssetText(SUB, identity.fileName);
    if (!res.ok) {
        rt.state.reason = res.reason;
        logError('read twitter jsonl failed', identity.fileName, res.reason);
        return { ok: false, reason: res.reason, identity, profile: emptyProfile(), tweets: [], skipped: 0 };
    }
    rt.state.reason = null;
    const parsed = parseTwitterJsonl(res.text);
    return {
        ok: true,
        reason: null,
        identity,
        profile: parsed.profile || emptyProfile(),
        tweets: parsed.tweets,
        skipped: parsed.skipped,
    };
}

/** 写回 jsonl（整文件覆盖写） */
async function persistTwitterData() {
    const identity = rt.state.identity || currentChatIdentity();
    rt.state.identity = identity;
    const text = encodeTwitterJsonl(identity, rt.state.profile || emptyProfile(), rt.state.tweets);
    const res = await writeAssetText(SUB, identity.fileName, text);
    if (!res.ok) {
        rt.state.reason = res.reason;
        return res;
    }
    rt.state.reason = null;
    return { ok: true };
}

/** 图片 → data URL（读不到就返回空串，不当作错误） */
async function loadAvatarDataUrl() {
    const name = rt.state.profile?.avatar;
    if (!name) {
        return '';
    }
    const res = await readAssetBinary(SUB, name);
    return res.ok && res.exists && res.base64
        ? 'data:' + (res.mime || 'image/png') + ';base64,' + res.base64
        : '';
}

async function loadBannerDataUrl() {
    const name = rt.state.profile?.banner;
    if (!name) {
        return '';
    }
    const res = await readAssetBinary(SUB, name);
    return res.ok && res.exists && res.base64
        ? 'data:' + (res.mime || 'image/jpeg') + ';base64,' + res.base64
        : '';
}

/** 存头像 / 横幅（data URL）；固定文件名，换图即覆盖 */
async function saveAvatar(dataUrl) {
    const res = await writeAssetBinary(SUB, AVATAR_NAME, String(dataUrl || ''));
    if (!res.ok) {
        return res;
    }
    rt.state.profile = Object.assign({}, rt.state.profile || emptyProfile(), { avatar: AVATAR_NAME });
    rt.state.avatarDataUrl = String(dataUrl || '');
    return await persistTwitterData();
}

async function saveBanner(dataUrl) {
    const res = await writeAssetBinary(SUB, BANNER_NAME, String(dataUrl || ''));
    if (!res.ok) {
        return res;
    }
    rt.state.profile = Object.assign({}, rt.state.profile || emptyProfile(), { banner: BANNER_NAME });
    rt.state.bannerDataUrl = String(dataUrl || '');
    return await persistTwitterData();
}

/** 删掉头像 / 横幅（同时把资料里的文件名清空） */
async function clearAvatar() {
    rt.state.profile = Object.assign({}, rt.state.profile || emptyProfile(), { avatar: '' });
    rt.state.avatarDataUrl = '';
    const res = await deleteAssetFile(SUB, AVATAR_NAME);
    await persistTwitterData();
    return res;
}

async function clearBanner() {
    rt.state.profile = Object.assign({}, rt.state.profile || emptyProfile(), { banner: '' });
    rt.state.bannerDataUrl = '';
    const res = await deleteAssetFile(SUB, BANNER_NAME);
    await persistTwitterData();
    return res;
}

/**
 * 配图的文件名：按 data URL 的 mime 定后缀（jpeg → jpg，其余 png/webp/gif 原样，认不出就当 png）。
 * 推文 id 里可能有 '-' 之类，先洗一遍，保证是单段 ASCII。
 */
function tweetImageName(tweetId, dataUrl) {
    const mime = String(dataUrl || '').slice(5).split(';')[0].toLowerCase();
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'png';
    const safeId = String(tweetId ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
    return TWEET_IMAGE_PREFIX + safeId + '.' + ext;
}

/** 读一张配图 → data URL（读不到返回空串，调用方据此不渲染 <img>） */
async function loadTweetImageDataUrl(fileName) {
    const name = normalizeImageName(fileName);
    if (!name) {
        return '';
    }
    const res = await readAssetBinary(SUB, name);
    return res.ok && res.exists && res.base64
        ? 'data:' + (res.mime || 'image/png') + ';base64,' + res.base64
        : '';
}

/** 存配图：写新文件 → 旧后缀不同就删掉旧文件 → 字段指向新名。**不落盘 jsonl**（调用方一起写） */
async function saveTweetImage(tweet, dataUrl) {
    const next = tweetImageName(tweet && tweet.id, dataUrl);
    const previous = normalizeImageName(tweet && tweet.image);
    const res = await writeAssetBinary(SUB, next, String(dataUrl || ''));
    if (!res.ok) {
        return res;
    }
    if (previous && previous !== next) {
        await deleteAssetFile(SUB, previous);
    }
    tweet.image = next;
    return { ok: true, name: next };
}

/** 删掉配图（文件 + 字段）。**不落盘 jsonl** */
async function clearTweetImage(tweet) {
    const previous = normalizeImageName(tweet && tweet.image);
    if (tweet) {
        tweet.image = '';
    }
    if (previous) {
        await deleteAssetFile(SUB, previous);
    }
    return { ok: true, removed: previous };
}

/** 磁盘上的路径（给人看） */
function twitterPathText(fileName) {
    return assetPathText(SUB, fileName || rt.state.identity?.fileName || '');
}

    return {
        AVATAR_NAME, BANNER_NAME, KIND_PROFILE, KIND_SESSION, KIND_TWEET, PREFIX, SUB,
        TWEET_IMAGE_PREFIX, clearAvatar, clearBanner, clearTweetImage, currentChatIdentity, emptyProfile, encodeTwitterJsonl,
        loadTweetImageDataUrl, normalizeImageName, saveTweetImage, tweetImageName,
        loadAvatarDataUrl, loadBannerDataUrl, loadTwitterData, normalizeProfile, normalizeTweet,
        parseTwitterJsonl, persistTwitterData, saveAvatar, saveBanner, twitterPathText,
    };
}

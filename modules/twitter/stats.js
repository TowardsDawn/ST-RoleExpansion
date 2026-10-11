/**
 * modules/twitter/stats.js
 *
 * 五个数字（评论 / 转发 / 点赞 / 书签 / 浏览）在**推文创建时**随机生成一次，之后固化在 JSONL 里；
 * 面板的「编辑推文」弹窗可以逐个改（见模块 README 的「三个来源」）。
 *
 * 另外这里是「媒体 URL 算图片还是视频」的唯一判据：**只分两种** ——
 * 视频要 <video controls> 点击播放，其余都当图片（GIF / APNG 由 <img> 自己动，静态 png/jpg 也一样）。
 * 刻意不认 flv：浏览器原生播不了 video/x-flv，而这个模块的 iframe 不给脚本、仓库也没有依赖。
 */

export function createTwitterStats(kernel, rt) {
/** [min, max] 闭区间内的整数 */
function randomInt(min, max) {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/**
 * 生成一组互相关联的数字（不会出现「0 浏览却有 5.4K 点赞」这种穿帮）：
 *   浏览 500~50,000；点赞 = 浏览 × 2%~8%；转发 = 点赞 × 10%~30%；评论 = 点赞 × 5%~20%
 */
function makeStats() {
    const view = randomInt(500, 50000);
    const like = Math.max(1, Math.round(view * randomInt(20, 80) / 1000));
    const retweet = Math.max(0, Math.round(like * randomInt(100, 300) / 1000));
    const reply = Math.max(0, Math.round(like * randomInt(50, 200) / 1000));
    // 书签比转发再低一档（点赞的 1%~6%）：它只是「收藏数」，天生小于点赞
    const bookmark = Math.max(0, Math.round(like * randomInt(10, 60) / 1000));
    return { view, like, retweet, reply, bookmark };
}

/** 认作「视频」的后缀。刻意不含 flv —— 浏览器原生播不了，见文件头说明 */
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

/** 从 URL 猜媒体类型：查不到后缀（或后缀不认识）就按图片处理 */
function mediaKindFromUrl(url) {
    const clean = String(url ?? '').trim().split('#')[0].split('?')[0];
    const match = /\.([a-zA-Z0-9]+)$/.exec(clean);
    const ext = match ? match[1].toLowerCase() : '';
    return VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image';
}

/** 编辑器里显式指定优先（无后缀的流式地址用得上）；没指定就按后缀猜 */
function normalizeMediaKind(value, url) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === 'video' || raw === 'image') {
        return raw;
    }
    return mediaKindFromUrl(url);
}

/** 1234 → 1.2K；32400 → 32K；999 → 999（与样例推特的写法一致） */
function formatCount(value) {
    const n = Number(value) || 0;
    if (n < 1000) {
        return String(n);
    }
    if (n < 10000) {
        return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    if (n < 1000000) {
        const thousands = Math.round(n / 1000);
        // 999999 这种取整到 1000K 的，进位成 1M 更自然
        return thousands >= 1000 ? (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M' : thousands + 'K';
    }
    return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

    return { formatCount, makeStats, mediaKindFromUrl, normalizeMediaKind, randomInt };
}

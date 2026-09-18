/**
 * modules/twitter/stats.js
 *
 * 四个数字（评论 / 转发 / 点赞 / 浏览）在**推文创建时**随机生成一次，之后固化：
 * 只能手改 JSONL，UI 里不提供编辑（刻意的 —— 见模块 README 的「三个来源」）。
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
    return { view, like, retweet, reply };
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

    return { formatCount, makeStats, randomInt };
}

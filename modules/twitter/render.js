/**
 * modules/twitter/render.js
 *
 * 把资料 + 推文渲染成一份**自包含的 HTML 文档**（iframe 的 srcdoc）。
 *
 * 布局：固定高度的一屏 —— body 是 flex 竖排，.tw-head（资料头）不伸缩、钉住不动，
 * 只有 #tw-posts.tweets-container 内部滚。所以内容是多是少都不会改变页面高度。
 *
 * 两条硬约定：
 *   1. srcdoc 里**不出现任何脚本标签** —— 高度测量与标签切换都由父页面（ui.js）通过
 *      allow-same-origin 直接操作 contentDocument 完成。这样既不依赖 iframe 内联脚本，
 *      也不必和 CSP / postMessage 打交道。
 *   2. 所有来自用户或模型的内容一律 escapeHtml —— 它们只是文本，不允许变成标签。
 *
 * 排序：置顶推文（至多一条）在最上，其余按 seq 从大到小（新 → 旧）。
 * 分隔：沿用推特原生的 1px 底边线，区块之间没有额外间距（无缝衔接）。
 */

export function createTwitterRender(kernel, rt) {
    const { } = kernel;
    const formatCount = (...args) => rt.stats.formatCount(...args);

/** 认证徽章（样例推特里的那个蓝勾） */
const VERIFIED_SVG = '<svg class="verified-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25a3.606 3.606 0 0 0-1.336-.25c-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z"/></svg>';

/** 顶部横幅的默认底色（没上传横幅图时用） */
const DEFAULT_BANNER = 'linear-gradient(135deg, #1d9bf0 0%, #8b5cf6 50%, #ec4899 100%)';

/**
 * 把一段 URL 塞进 CSS 前先做净化：引号 / 括号 / 空白一律百分号编码。
 * data URL 里这些字符会让 `url(...)` 或外层 style="…" 提前收尾（内联样式用的是双引号）。
 */
function cssUrl(value) {
    return String(value ?? '').replace(/['"()\s]/g, (ch) => {
        return '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
    });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 资料区的关注数 / 粉丝数：能解析出数字就按千分位显示（3240 → 3,240），否则原样 */
function countText(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        return '0';
    }
    const digits = raw.replace(/[^\d]/g, '');
    return digits ? Number(digits).toLocaleString('en-US') : raw;
}

/** 置顶在最上，其余 seq 从大到小（新→旧）；seq 相同时按创建时间兜底 */
function sortedTweets(tweets) {
    const list = Array.isArray(tweets) ? [...tweets] : [];
    const pinned = list.filter(t => t.pinned).sort((a, b) => (b.seq || 0) - (a.seq || 0));
    const rest = list.filter(t => !t.pinned);
    rest.sort((a, b) => {
        const d = (Number(b.seq) || 0) - (Number(a.seq) || 0);
        return d !== 0 ? d : (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });
    return pinned.slice(0, 1).concat(rest);
}

/** 头像：有图用图，没图就是一个实心圆（与样例的占位一致） */
function renderAvatar(imgClass) {
    const url = rt.state.avatarDataUrl;
    return url
        ? '<img class="' + imgClass + '" src="' + escapeHtml(url) + '" alt="头像">'
        : '<div class="' + imgClass + '-placeholder"></div>';
}

function renderTweet(tweet, profile) {
    const name = escapeHtml(profile.name || '（未命名）');
    const handle = escapeHtml(profile.handle || '');
    const time = String(tweet.time || '').trim();
    const content = escapeHtml(tweet.content);
    const stats = tweet.stats || {};
    const parts = [];

    parts.push('<div class="tweet" data-id="' + escapeHtml(tweet.id) + '">');
    parts.push('  <div class="tweet-avatar">' + renderAvatar('tweet-avatar-img') + '</div>');
    parts.push('  <div class="tweet-body">');
    if (tweet.pinned) {
        parts.push('    <div class="tweet-pinned">📌 置顶</div>');
    }
    parts.push('    <div class="tweet-header">');
    parts.push('      <span class="tweet-name">' + name + '</span>');
    if (handle) {
        parts.push('      <span class="tweet-handle">' + handle + '</span>');
    }
    if (time) {
        parts.push('      <span class="tweet-time">· ' + escapeHtml(time) + '</span>');
    }
    parts.push('    </div>');
    parts.push('    <div class="tweet-content">' + content + '</div>');
    const imageUrl = tweet.image ? String((rt.state.tweetImages || {})[tweet.image] || '') : '';
    if (imageUrl) {
        parts.push('    <img class="tweet-image" src="' + escapeHtml(imageUrl) + '" alt="配图">');
    }
    parts.push('    <div class="tweet-actions">');
    parts.push('      <span title="评论">💬 ' + escapeHtml(formatCount(stats.reply)) + '</span>');
    const retweetClass = 'tweet-action-retweet' + (tweet.retweeted ? ' is-active' : '');
    const likeClass = 'tweet-action-like' + (tweet.liked ? ' is-active' : '');
    parts.push('      <span class="' + retweetClass + '" title="转发">🔄 ' + escapeHtml(formatCount(stats.retweet)) + '</span>');
    parts.push('      <span class="' + likeClass + '" title="点赞">❤️ ' + escapeHtml(formatCount(stats.like)) + '</span>');
    parts.push('      <span title="浏览">📊 ' + escapeHtml(formatCount(stats.view)) + '</span>');
    parts.push('    </div>');
    parts.push('  </div>');
    parts.push('</div>');
    return parts.join('\n');
}

/** 整份文档的样式：基本照搬样例推特，只去掉媒体与交互相关的部分 */
function buildStyles() {
    return [
        ':root {',
        '  --bg-primary: #000000;',
        '  --bg-secondary: #16181c;',
        '  --bg-hover: #1d1f23;',
        '  --text-primary: #e7e9ea;',
        '  --text-secondary: #71767b;',
        '  --accent: #1d9bf0;',
        '  --border: #2f3336;',
        '  --verified: #1d9bf0;',
        // 头像尺寸：改它**不会**改变资料头总高 —— .profile-header-row 的上边距、
        // .profile-actions 的上内距都写成 calc(var(--avatar-size) / 2 …)，涨的一半正好被负边距吃掉。
        '  --avatar-size: 72px;',
        // 横幅跟着 iframe 高度走：窗口矮的时候别让头把推文区吃光
        '  --banner-height: clamp(96px, 17vh, 170px);',
        '  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
        '}',
        '* { margin: 0; padding: 0; box-sizing: border-box; }',
        // 固定高度的一屏：整页（含资料头）都不滚，只有推文列表 #tw-posts 内部滚
        'html, body { height: 100%; overflow: hidden; }',
        'body { display: flex; flex-direction: column; font-family: var(--font-sans); background: var(--bg-primary); color: var(--text-primary); }',
        '.tw-head { flex: 0 0 auto; }',
        '.profile-banner { width: 100%; height: var(--banner-height); background-size: cover; background-position: center; }',
        '.profile-header-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 0 16px; position: relative; margin-top: calc(var(--avatar-size) / -2 - 4px); margin-bottom: 8px; }',
        '.profile-avatar-wrapper { width: var(--avatar-size); height: var(--avatar-size); border-radius: 50%; border: 4px solid var(--bg-primary); overflow: hidden; background-color: var(--bg-secondary); flex-shrink: 0; }',
        '.profile-avatar-wrapper img { width: 100%; height: 100%; object-fit: cover; }',
        '.avatar-placeholder { width: 100%; height: 100%; background: var(--bg-secondary); }',
        '.profile-actions { display: flex; gap: 8px; padding-top: calc(var(--avatar-size) / 2 + 4px); flex-wrap: wrap; justify-content: flex-end; }',
        '.btn { display: inline-flex; align-items: center; justify-content: center; padding: 8px 16px; border-radius: 9999px; font-size: 14px; font-weight: 700; border: 1px solid var(--border); background: transparent; color: var(--text-primary); white-space: nowrap; }',
        '.btn-primary { background: var(--text-primary); color: var(--bg-primary); border-color: var(--text-primary); }',
        '.profile-info { padding: 0 16px 10px; }',
        '.profile-name-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }',
        '.profile-name { font-size: 20px; font-weight: 800; line-height: 1.2; }',
        '.verified-icon { width: 20px; height: 20px; fill: var(--verified); color: var(--verified); flex-shrink: 0; }',
        '.profile-handle { font-size: 15px; color: var(--text-secondary); margin-top: 2px; }',
        '.profile-bio { font-size: 15px; line-height: 1.4; margin-top: 8px; white-space: pre-wrap; word-break: break-word; }',
        '.profile-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; font-size: 14px; color: var(--text-secondary); }',
        '.profile-meta span { display: inline-flex; align-items: center; gap: 4px; }',
        '.profile-stats { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 8px; font-size: 14px; }',
        '.profile-stats span { color: var(--text-secondary); }',
        '.profile-stats strong { color: var(--text-primary); }',
        '.nav-tabs { display: flex; border-bottom: 1px solid var(--border); margin-top: 4px; }',
        '.nav-tab { flex: 1; text-align: center; padding: 12px 0; font-size: 14px; font-weight: 500; color: var(--text-secondary); cursor: pointer; position: relative; border: none; background: none; font-family: inherit; }',
        '.nav-tab.active { color: var(--text-primary); font-weight: 700; }',
        '.nav-tab.active::after { content: ""; position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 56px; height: 4px; background: var(--accent); border-radius: 9999px; }',
        '.tweets-container { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; }',
        // 非「帖子」标签：除了那句提示，列表区里的东西一律藏起来
        '.tweets-container.is-empty > :not(#tw-empty) { display: none; }',
        '.tweet { display: flex; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }',
        '.tweet-avatar { width: 40px; height: 40px; border-radius: 50%; background-color: var(--bg-secondary); flex-shrink: 0; overflow: hidden; }',
        '.tweet-avatar img { width: 100%; height: 100%; object-fit: cover; }',
        '.tweet-avatar-img-placeholder { width: 100%; height: 100%; background: var(--bg-secondary); }',
        '.tweet-body { flex: 1; min-width: 0; }',
        '.tweet-pinned { color: var(--text-secondary); font-size: 13px; margin-bottom: 2px; }',
        '.tweet-header { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: 14px; margin-bottom: 2px; }',
        '.tweet-name { font-weight: 700; }',
        '.tweet-handle, .tweet-time { color: var(--text-secondary); }',
        '.tweet-content { font-size: 15px; line-height: 1.4; word-break: break-word; white-space: pre-wrap; }',
        '.tweet-image { margin-top: 8px; border-radius: 16px; border: 1px solid var(--border); max-width: 100%; height: auto; display: block; }',
        '.tweet-actions { display: flex; justify-content: space-between; max-width: 400px; margin-top: 8px; font-size: 13px; color: var(--text-secondary); }',
        '.tweet-actions span { display: inline-flex; align-items: center; gap: 4px; }',
        '.tweet-action-like, .tweet-action-retweet { cursor: pointer; user-select: none; transition: color 0.2s; }',
        '.tweet-action-like:hover, .tweet-action-retweet:hover { color: #f91880; }',
        '.tweet-action-like.is-active, .tweet-action-retweet.is-active { color: #f91880; }',
        '.tw-empty { padding: 32px 16px; text-align: center; color: var(--text-secondary); font-size: 14px; line-height: 1.6; }',
        '.tweets-container::-webkit-scrollbar { width: 6px; }',
        '.tweets-container::-webkit-scrollbar-track { background: transparent; }',
        '.tweets-container::-webkit-scrollbar-thumb { background: var(--border); border-radius: 6px; }',
        '.tweets-container::-webkit-scrollbar-thumb:hover { background: var(--text-secondary); }',
    ].join('\n');
}

/** 标签页（可点：由父页面接管 click，切 .active 与显隐） */
function renderTabs() {
    const tabs = [
        { id: 'posts', label: '帖子' },
        { id: 'replies', label: '回复' },
        { id: 'media', label: '媒体' },
        { id: 'likes', label: '喜欢' },
    ];
    const parts = ['<div class="nav-tabs" id="tw-nav">'];
    for (const tab of tabs) {
        const cls = tab.id === 'posts' ? 'nav-tab active' : 'nav-tab';
        parts.push('  <button class="' + cls + '" data-tab="' + tab.id + '">' + tab.label + '</button>');
    }
    parts.push('</div>');
    return parts.join('\n');
}

/**
 * 生成完整文档。
 * @param {{ profile: object, tweets: object[] }} data
 */
function buildTwitterHtml(data) {
    const profile = data?.profile || {};
    const tweets = sortedTweets(data?.tweets || []);
    const banner = rt.state.bannerDataUrl;
    // ⚠️ 三道处理缺一不可：
    //   1) url 必须带引号 —— data URL 里的括号会让裸 url(...) 被判为非法 CSS；
    //   2) 这里只能用小写单引号 —— 外层 style="…" 是双引号，CSS 里再出现一个 " 会截断属性；
    //   3) 所以必须先 cssUrl() 把 URL 里的 ' " ( ) 与空白百分号编码掉，再用 escapeHtml 兜底。
    const bannerStyle = banner
        ? "background-image: url('" + escapeHtml(cssUrl(banner)) + "');"
        : 'background: ' + DEFAULT_BANNER + ';';

    const meta = Array.isArray(profile.meta) ? profile.meta : [];
    const parts = [];
    parts.push('<!DOCTYPE html>');
    parts.push('<html lang="zh-CN">');
    parts.push('<head>');
    parts.push('<meta charset="UTF-8">');
    parts.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    parts.push('<style>');
    parts.push(buildStyles());
    parts.push('</style>');
    parts.push('</head>');
    parts.push('<body>');
    // —— 固定不动的资料头（横幅 / 头像 / 名字 / 简介 / meta / 统计 / 标签页）——
    // 它不吃 flex 伸缩（flex: 0 0 auto），所以它有多高就是多高，剩下的全给推文列表。
    // 想调节「头占多少」：横幅有 --banner-height（跟着 iframe 高度走），其余的是固定行高。
    parts.push('<div class="tw-head">');
    parts.push('  <div class="profile-banner" style="' + bannerStyle + '"></div>');
    parts.push('  <div class="profile-header-row">');
    parts.push('    <div class="profile-avatar-wrapper">' + renderAvatar('avatar-img') + '</div>');
    parts.push('    <div class="profile-actions">');
    parts.push('      <button class="btn">···</button>');
    parts.push('      <button class="btn">✉</button>');
    const followed = profile.followed === true;
    parts.push('      <button class="btn' + (followed ? '' : ' btn-primary') + '" id="tw-follow">' + (followed ? '正在关注' : '关注') + '</button>');
    parts.push('    </div>');
    parts.push('  </div>');
    parts.push('  <div class="profile-info">');
    parts.push('    <div class="profile-name-row">');
    parts.push('      <span class="profile-name">' + escapeHtml(profile.name || '（未命名）') + '</span>');
    if (profile.verified !== false) {
        parts.push('      ' + VERIFIED_SVG);
    }
    parts.push('    </div>');
    if (profile.handle) {
        parts.push('    <div class="profile-handle">' + escapeHtml(profile.handle) + '</div>');
    }
    if (profile.bio) {
        parts.push('    <div class="profile-bio">' + escapeHtml(profile.bio) + '</div>');
    }
    if (meta.length) {
        parts.push('    <div class="profile-meta">');
        for (const line of meta) {
            parts.push('      <span>' + escapeHtml(line) + '</span>');
        }
        parts.push('    </div>');
    }
    parts.push('    <div class="profile-stats">');
    parts.push('      <span><strong>' + escapeHtml(countText(profile.following)) + '</strong> 正在关注</span>');
    parts.push('      <span><strong id="tw-followers">' + escapeHtml(countText(profile.followers)) + '</strong> 粉丝</span>');
    parts.push('    </div>');
    parts.push('  </div>');
    parts.push(renderTabs());
    parts.push('</div>');
    // —— 唯一的滚动容器 ——
    // 只滚这里：推文再多也不会把面板撑长。切到其它标签时 setTab() 给这里加 is-empty，
    // 由 CSS 把「除 #tw-empty 之外的所有子节点」藏起来（见 buildStyles）。
    parts.push('<div class="tweets-container" id="tw-posts">');
    if (tweets.length) {
        for (const tweet of tweets) {
            parts.push(renderTweet(tweet, profile));
        }
    } else {
        parts.push('  <div class="tw-empty">还没有推文。<br>模型在回复里写 &lt;推文&gt;正文&lt;/推文&gt; 就会出现在这里，也可以在面板上手动新增。</div>');
    }
    parts.push('  <div class="tw-empty" id="tw-empty" style="display:none"></div>');
    parts.push('</div>');
    parts.push('</body>');
    parts.push('</html>');
    return parts.join('\n');
}

    return { DEFAULT_BANNER, buildTwitterHtml, countText, escapeHtml, sortedTweets };
}

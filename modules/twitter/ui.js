/**
 * modules/twitter/ui.js
 *
 * 主面板里的「推特」区块：状态行 + 工具行 + 仿推特页面（iframe）+ 三个子折叠块
 * （资料区 / 推文管理 / 解析设置）。
 *
 * iframe 的三条约定：
 *   1. srcdoc 里**没有**任何脚本标签（渲染由 render.js 负责），sandbox 只给 allow-same-origin；
 *      标签切换与三个点击交互全部由这里直接操作 contentDocument 完成。
 *   2. **固定高度**：iframe 的高度由 CSS 写死（风格见 style.css 的 .roleEx-twitter-frame），
 *      srcdoc 里是 flex 竖排 —— 资料头固定、只有推文列表 #tw-posts 内部滚。父页面不量高度。
 *   3. 每次改动都重建 srcdoc —— HTML 生成是纯函数，重建比增量 patch 简单得多，也不会漏状态。
 */

export function createTwitterUi(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它们的字段快照）
    const { assetReasonText, checkboxRow, collapsible, debounce, el, iconFor, logError, section, settings, textPreview, toast, updateSetting } = kernel;
    // 同模块、别的文件：惰性转发（调用时才取，绕开文件创建顺序的循环依赖）
    const addTweet = (...args) => rt.capture.addTweet(...args);
    const buildTwitterHtml = (...args) => rt.render.buildTwitterHtml(...args);
    const countText = (...args) => rt.render.countText(...args);
    const clearAvatar = (...args) => rt.store.clearAvatar(...args);
    const clearBanner = (...args) => rt.store.clearBanner(...args);
    const clearTweetImage = (...args) => rt.store.clearTweetImage(...args);
    const loadAvatarDataUrl = (...args) => rt.store.loadAvatarDataUrl(...args);
    const loadBannerDataUrl = (...args) => rt.store.loadBannerDataUrl(...args);
    const loadTweetImageDataUrl = (...args) => rt.store.loadTweetImageDataUrl(...args);
    const loadTwitterData = (...args) => rt.store.loadTwitterData(...args);
    const normalizeProfile = (...args) => rt.store.normalizeProfile(...args);
    const nextSeq = (...args) => rt.capture.nextSeq(...args);
    const persistTwitterData = (...args) => rt.store.persistTwitterData(...args);
    const makeStats = (...args) => rt.stats.makeStats(...args);
    const saveAvatar = (...args) => rt.store.saveAvatar(...args);
    const saveTweetImage = (...args) => rt.store.saveTweetImage(...args);
    const saveBanner = (...args) => rt.store.saveBanner(...args);
    const sortedTweets = (...args) => rt.render.sortedTweets(...args);
    const twitterPathText = (...args) => rt.store.twitterPathText(...args);
    const formatCount = (...args) => rt.stats.formatCount(...args);

/** 面板里的 DOM 引用（面板每次重建都会换新，所以放在 rt.state 上） */
function panel() {
    return rt.state.panel || null;
}

/** 状态行（在「推文管理」折叠块里）：正常 = 「N 条推文 · 落点」；真不可用 = 红字原因；还没选角色 = 留空 */
function renderStatus() {
    const refs = panel();
    if (!refs || !refs.status) {
        return;
    }
    const fileName = rt.state.identity ? rt.state.identity.fileName : '';
    // ⚠️ 「还没选角色」不是本模块出错（那是酒馆的常态）：不打红字、也不打印那句文案。
    //    真去写盘时该报错还是会报（各处理函数里的 toast 用的是同一份 assetReasonText()）。
    const quiet = rt.state.reason === 'no-character';
    const text = quiet
        ? ''
        : (rt.state.reason
            ? assetReasonText(rt.state.reason)
            : rt.state.tweets.length + ' 条推文 · ' + twitterPathText(fileName));
    refs.status.className = 'roleEx-hint' + (rt.state.reason && !quiet ? ' roleEx-warn' : '');
    refs.status.textContent = text;
    refs.status.title = text;
}

/**
 * 给 iframe 里的东西接线：标签页点击、关注按钮、每条推文的 🔄 / ❤️。
 * srcdoc 里没有脚本，所以这些监听必须由父页面在每次 load 后重新挂一遍。
 *
 * ⚠️ 这里**不再量高度**：iframe 是固定高度（style.css 的 .roleEx-twitter-frame），
 * 资料头固定、只有推文列表 #tw-posts 内部滚 —— 页面高度不随内容变，也就没有量不准的问题。
 * 高度自适应那条路走不通：折叠块默认收起（display: none）时 iframe 没有布局盒，
 * 那一刻量到的 scrollHeight 是 0，展开后又没有第二次机会（详见模块 DEVELOPMENT §7）。
 */
function wireFrame() {
    const refs = panel();
    const frame = refs && refs.frame;
    const doc = frame && frame.contentDocument;
    if (!doc) {
        return;
    }
    const posts = doc.getElementById('tw-posts');
    const empty = doc.getElementById('tw-empty');
    const labels = { replies: '回复', media: '媒体', likes: '喜欢' };

    const setTab = (id) => {
        doc.querySelectorAll('.nav-tab').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === id);
        });
        const isPosts = id === 'posts';
        // #tw-posts 是滚动容器，它本身永远在（藏了就没得滚了）；非 posts 标签只把
        // 它里面除 #tw-empty 之外的东西藏掉（CSS: .tweets-container.is-empty > :not(#tw-empty)）
        if (posts) {
            posts.classList.toggle('is-empty', !isPosts);
        }
        if (empty) {
            empty.style.display = isPosts ? 'none' : 'block';
            empty.textContent = '「' + (labels[id] || id) + '」标签下还没有内容 —— 本模块只收录纯文本推文。';
        }
    };

    doc.querySelectorAll('.nav-tab').forEach((btn) => {
        btn.addEventListener('click', () => setTab(btn.getAttribute('data-tab')));
    });

    // 关注按钮
    const followButton = doc.getElementById('tw-follow');
    if (followButton) {
        followButton.addEventListener('click', () => toggleTwitterFollow());
    }

    // 每条推文的 🔄 / ❤️（点一下 +1 变粉，再点一下 -1 恢复）
    doc.querySelectorAll('.tweet').forEach((card) => {
        const tweetId = card.getAttribute('data-id');
        card.querySelectorAll('.tweet-action-like').forEach(node => {
            node.addEventListener('click', (event) => { event.stopPropagation(); toggleTweetAction(tweetId, 'like'); });
        });
        card.querySelectorAll('.tweet-action-retweet').forEach(node => {
            node.addEventListener('click', (event) => { event.stopPropagation(); toggleTweetAction(tweetId, 'retweet'); });
        });
    });
}

/** 重建 iframe 的 srcdoc（数据没变也可以安全重复调用） */
function renderFrame() {
    const refs = panel();
    if (!refs || !refs.frame) {
        return;
    }
    if (rt.state.reason) {
        refs.frame.style.display = 'none';
        return;
    }
    refs.frame.style.display = 'block';
    // 高度是 CSS 固定的（.roleEx-twitter-frame），这里不写 style.height：
    // 重建 srcdoc 只换内容、不改页面高度，也就没有「收缩 → 展开」的跳变。
    refs.frame.srcdoc = buildTwitterHtml({ profile: rt.state.profile, tweets: rt.state.tweets });
}

/** 推文管理列表：置顶 / 编辑 / 删除 */
function renderManage() {
    const refs = panel();
    if (!refs || !refs.list) {
        return;
    }
    const list = refs.list;
    list.innerHTML = '';
    const tweets = sortedTweets(rt.state.tweets);
    if (refs.manageTitle) {
        refs.manageTitle.textContent = '推文管理（' + tweets.length + ' 条）';
    }
    if (!tweets.length) {
        list.appendChild(el('div', { class: 'roleEx-hint', text: '还没有推文。' }));
        return;
    }
    for (const tweet of tweets) {
        const stats = tweet.stats || {};
        const pinLabel = tweet.pinned ? '取消置顶' : '置顶';
        const row = el('div', { class: 'roleEx-twitter-row' }, [
            el('div', { class: 'roleEx-twitter-row-main' }, [
                el('span', { class: 'roleEx-twitter-row-time', text: tweet.time || '(无时间)' }),
                el('span', {
                    class: 'roleEx-twitter-row-preview',
                    text: (tweet.image ? '📷 ' : '') + textPreview(tweet.content, 60),
                }),
                el('span', {
                    class: 'roleEx-hint',
                    text: '💬 ' + formatCount(stats.reply) + '  🔄 ' + formatCount(stats.retweet)
                        + '  ❤️ ' + formatCount(stats.like) + '  📊 ' + formatCount(stats.view),
                }),
            ]),
            el('div', { class: 'roleEx-entry-actions' }, [
                el('div', {
                    class: 'menu_button roleEx-btn-xs',
                    title: tweet.pinned ? '取消置顶（置顶只允许一条）' : '置顶到时间线最上方',
                    text: pinLabel,
                    onclick: () => togglePin(tweet.id),
                }),
                el('div', {
                    class: 'menu_button roleEx-btn-xs',
                    title: '编辑时间 / 序号 / 正文',
                    text: '编辑',
                    onclick: () => openTweetEditor(tweet),
                }),
                el('div', {
                    class: 'menu_button roleEx-btn-xs roleEx-danger',
                    title: '删除这条推文',
                    text: '删除',
                    onclick: () => deleteTweet(tweet.id),
                }),
            ]),
        ]);
        row.dataset.twitterId = tweet.id;
        list.appendChild(row);
    }
}

/** 只重画（不动磁盘）：捕获到新推文、编辑、置顶、切会话后都走这里 */
function renderTwitter() {
    renderStatus();
    renderFrame();
    renderManage();
    fillProfileInputs();
}

/** 从磁盘读回全部内容（jsonl + 两张图片），再重画 */
async function reloadTwitter() {
    const data = await loadTwitterData();
    rt.state.tweets = data.tweets || [];
    rt.state.profile = data.profile || null;
    rt.state.loaded = true;
    if (data.ok) {
        rt.state.avatarDataUrl = await loadAvatarDataUrl();
        rt.state.bannerDataUrl = await loadBannerDataUrl();
        // 配图：一条推文一张，按文件名去重后一起读（读不到的不进缓存 → 渲染时就不画 <img>）
        const names = Array.from(new Set(rt.state.tweets.map(t => t.image).filter(Boolean)));
        const loaded = await Promise.all(names.map(async (name) => [name, await loadTweetImageDataUrl(name)]));
        const imageMap = {};
        const missingImages = [];
        for (const pair of loaded) {
            if (pair[1]) {
                imageMap[pair[0]] = pair[1];
            } else {
                missingImages.push(pair[0]);
            }
        }
        rt.state.tweetImages = imageMap;
        if (missingImages.length) {
            console.warn('[ST-RoleExpansion] 推文配图读不到（文件可能被删了）：', missingImages);
        }
        if (data.skipped) {
            toast('warning', '推文文件里有 ' + data.skipped + ' 行无法解析，已跳过。');
        }
    } else {
        rt.state.tweetImages = {};
        rt.state.avatarDataUrl = '';
        rt.state.bannerDataUrl = '';
    }
    renderTwitter();
}

/* ------------------------------- 资料区 ------------------------------- */

function profileField(label, key, options = {}) {
    const { type = 'text', placeholder = '', rows = 0, hint = '' } = options;
    const input = rows
        ? el('textarea', { class: 'text_pole roleEx-textarea', rows: String(rows), placeholder })
        : (type === 'number'
            ? el('input', { class: 'text_pole roleEx-num', type: 'number', min: '0', step: '1', placeholder })
            : el('input', { class: 'text_pole', type, placeholder }));
    input.dataset.twitterField = key;
    input.addEventListener('input', () => {
        onProfileEdited(key, input.value);
    });
    return el('div', { class: 'roleEx-twitter-field' }, [
        el('span', { class: 'roleEx-hint', text: label }),
        input,
        hint ? el('span', { class: 'roleEx-hint', text: hint }) : null,
    ]);
}

const saveProfileDebounced = debounce(async () => {
    const res = await persistTwitterData();
    if (!res.ok) {
        toast('error', assetReasonText(res.reason));
        return;
    }
    renderFrame();
}, 400);

function onProfileEdited(key, value) {
    // 从规范化后的完整资料出发：profile 还没读出来时也不会写出「只有一两个键」的资料行
    const profile = normalizeProfile(rt.state.profile);
    if (key === 'meta') {
        profile.meta = String(value).split(/\r?\n/).map(x => x.trim()).filter(x => x !== '');
    } else if (key === 'verified') {
        profile.verified = !!value;
    } else if (key === 'following' || key === 'followers') {
        // 数字输入框也可能收到 "1e3"、"-1" 这类值：只留数字
        profile[key] = String(value).replace(/[^\d]/g, '');
    } else {
        profile[key] = String(value);
    }
    rt.state.profile = profile;
    saveProfileDebounced();
}

/** 把内存里的资料写回输入框（正在输入的那个跳过，免得打断用户） */
function fillProfileInputs() {
    const refs = panel();
    if (!refs || !refs.profileInputs) {
        return;
    }
    const profile = rt.state.profile || {};
    for (const input of refs.profileInputs) {
        const key = input.dataset.twitterField;
        if (!key || input === document.activeElement) {
            continue;
        }
        if (key === 'meta') {
            input.value = Array.isArray(profile.meta) ? profile.meta.join('\n') : '';
        } else if (key === 'verified') {
            input.checked = profile.verified !== false;
        } else if (input.type === 'number') {
            // number input 塞 "3,240" 会直接变空，所以先只留数字
            input.value = String(profile[key] ?? '').replace(/[^\d]/g, '');
        } else {
            input.value = String(profile[key] ?? '');
        }
    }
}

/** 上传图片前先缩到合理尺寸：头像 200×200 PNG，横幅 600×200 JPEG(0.85) */
function downscaleImage(file, maxWidth, maxHeight, mime, quality) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            try {
                const naturalW = image.naturalWidth || maxWidth;
                const naturalH = image.naturalHeight || maxHeight;
                const scale = Math.min(1, maxWidth / naturalW, maxHeight / naturalH);
                const width = Math.max(1, Math.round(naturalW * scale));
                const height = Math.max(1, Math.round(naturalH * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(image, 0, 0, width, height);
                resolve(canvas.toDataURL(mime, quality));
            } catch (e) {
                reject(e);
            } finally {
                URL.revokeObjectURL(url);
            }
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('图片无法解码'));
        };
        image.src = url;
    });
}

/** 选一张图片 → 缩放 → 存盘（头像 / 横幅直接存，推文配图交给回调） */
function pickImage(kind, onPicked) {
    const isAvatar = kind === 'avatar';
    const isTweetImage = kind === 'tweet';
    const input = el('input', { type: 'file', accept: 'image/*' });
    input.style.display = 'none';
    input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) {
            return;
        }
        try {
            const dataUrl = isAvatar
                ? await downscaleImage(file, 200, 200, 'image/png')
                : (isTweetImage
                    // 配图：png/webp/gif 保持无损，jpeg 之类转 0.88 —— 上限 1000×1000
                    ? await downscaleImage(file, 1000, 1000, /png|webp|gif/i.test(String(file.type || '')) ? 'image/png' : 'image/jpeg', 0.88)
                    : await downscaleImage(file, 600, 200, 'image/jpeg', 0.85));
            if (isTweetImage) {
                if (typeof onPicked === 'function') {
                    onPicked(dataUrl);
                }
                return;
            }
            const res = isAvatar ? await saveAvatar(dataUrl) : await saveBanner(dataUrl);
            if (!res.ok) {
                toast('error', assetReasonText(res.reason));
                return;
            }
            toast('success', isAvatar ? '头像已更新。' : '横幅已更新。');
            renderTwitter();
        } catch (e) {
            logError('twitter image upload failed', e);
            toast('error', '图片处理失败：' + (e && e.message ? e.message : e));
        }
    });
    document.body.appendChild(input);
    input.click();
}

/* ------------------------------- 推文编辑 ------------------------------- */

/** 新增 / 编辑推文的弹窗；target 为空表示新增 */
function openTweetEditor(target) {
    const isNew = !target;
    const timeInput = el('input', { class: 'text_pole', type: 'text', placeholder: '如 2小时前 / 6月1日（可留空）' });
    const seqInput = el('input', { class: 'text_pole roleEx-num', type: 'number', min: '1', step: '1' });
    const contentArea = el('textarea', { class: 'text_pole roleEx-textarea', rows: '8', placeholder: '推文正文' });

    // 四个数字：新增时用随机生成的初值（仍可改），编辑时是当前值
    const statSeed = isNew ? makeStats() : (target.stats || {});
    const statInputs = {};
    const statField = (label, key, value) => {
        const input = el('input', { class: 'text_pole roleEx-num', type: 'number', min: '0', step: '1' });
        input.dataset.twitterStat = key;
        input.value = String(Number(value) || 0);
        statInputs[key] = input;
        return el('div', { class: 'roleEx-twitter-field' }, [
            el('span', { class: 'roleEx-hint', text: label }),
            input,
        ]);
    };
    const statsHint = el('div', {
        class: 'roleEx-hint',
        text: '四个数字在保存时若留空会按规则随机生成；JSONL 里存的是整数，`1.6K` 只是显示写法。',
    });

    // 配图：新选的图先放在内存里，保存时才写文件（新增也要等推文 id 出来）
    let pickedImage = null;
    let imageCleared = false;
    const currentImage = isNew ? '' : String(target.image || '');
    const imageState = el('span', { class: 'roleEx-hint' });
    const renderImageState = () => {
        imageState.textContent = pickedImage
            ? '已选一张新图（保存时写入）'
            : (imageCleared || !currentImage ? '当前：没有配图（纯文字推文）' : '当前：' + currentImage);
    };
    const imageRow = el('div', { class: 'roleEx-row roleEx-wrap' }, [
        el('span', { class: 'roleEx-hint roleEx-inline-label', text: '配图' }),
        el('div', {
            class: 'menu_button roleEx-btn-sm',
            title: '给这条推文配一张图（png/webp/gif 保持无损，jpeg 转 0.88，都会缩到 1000×1000 以内）',
            text: '上传图片',
            onclick: () => pickImage('tweet', (dataUrl) => {
                pickedImage = dataUrl;
                imageCleared = false;
                renderImageState();
            }),
        }),
        el('div', {
            class: 'menu_button roleEx-btn-sm roleEx-danger',
            title: '去掉这张图（变成纯文字推文）',
            text: '清除配图',
            onclick: () => {
                pickedImage = null;
                imageCleared = true;
                renderImageState();
            },
        }),
        imageState,
    ]);
    renderImageState();

    timeInput.value = isNew ? '' : String(target.time || '');
    seqInput.value = String(isNew ? nextSeq() : (target.seq || 1));
    contentArea.value = isNew ? '' : String(target.content || '');

    const modal = el('div', { class: 'roleEx-modal' }, [
        el('div', { class: 'roleEx-modal-inner' }, [
            el('div', { class: 'roleEx-modal-head', text: isNew ? '新增推文' : '编辑推文' }),
            el('div', { class: 'roleEx-twitter-field' }, [
                el('span', { class: 'roleEx-hint roleEx-inline-label', text: '时间' }),
                timeInput,
            ]),
            el('div', { class: 'roleEx-twitter-field' }, [
                el('span', { class: 'roleEx-hint roleEx-inline-label', text: '序号' }),
                seqInput,
                el('span', { class: 'roleEx-hint', text: '越大越新，排在时间线越上面（置顶恒在最上）' }),
            ]),
            contentArea,
            imageRow,
            el('div', { class: 'roleEx-row roleEx-wrap' }, [
                statField('💬 评论', 'reply', statSeed.reply),
                statField('🔄 转发', 'retweet', statSeed.retweet),
                statField('❤️ 点赞', 'like', statSeed.like),
                statField('📊 浏览', 'view', statSeed.view),
            ]),
            statsHint,
            el('div', { class: 'roleEx-row roleEx-end' }, [
                el('div', {
                    class: 'menu_button roleEx-btn',
                    text: '取消',
                    onclick: () => modal.remove(),
                }),
                el('div', {
                    class: 'menu_button roleEx-btn',
                    text: '保存',
                    onclick: () => saveEditor(),
                }),
            ]),
        ]),
    ]);

    const readStats = () => {
        const num = (key) => {
            const raw = String(statInputs[key] ? statInputs[key].value : '').trim();
            if (!raw) {
                return null;
            }
            return Math.max(0, Math.round(Number(raw) || 0));
        };
        const seeded = isNew ? makeStats() : (target.stats || {});
        const pick = (key) => {
            const value = num(key);
            return value === null ? Math.max(0, Math.round(Number(seeded[key]) || 0)) : value;
        };
        return { reply: pick('reply'), retweet: pick('retweet'), like: pick('like'), view: pick('view') };
    };

    async function saveEditor() {
        const body = contentArea.value.trim();
        if (!body) {
            toast('warning', '正文不能为空。');
            return;
        }
        const time = timeInput.value.trim();
        const seq = Math.max(1, Math.round(Number(seqInput.value) || 1));
        modal.remove();

        const stats = readStats();

        if (isNew) {
            const res = await addTweet({ time, content: body, seq, stats });
            if (!res.ok) {
                toast('error', assetReasonText(res.reason));
                return;
            }
            if (pickedImage) {
                // 配图要等推文 id 出来才能定文件名，所以这里再写一次 jsonl
                const saved = await saveTweetImage(res.tweet, pickedImage);
                if (saved.ok) {
                    rt.state.tweetImages[saved.name] = pickedImage;
                } else {
                    toast('error', assetReasonText(saved.reason));
                }
                await persistTwitterData();
            }
            toast('success', '已新增一条推文。');
            renderTwitter();
            return;
        }

        const target2 = rt.state.tweets.find(t => t.id === target.id);
        if (!target2) {
            toast('warning', '这条推文已经不在了。');
            renderTwitter();
            return;
        }
        target2.time = time;
        target2.content = body;
        target2.seq = seq;
        target2.stats = stats;
        target2.updatedAt = Date.now();

        // 配图：先改文件与字段，再和上面这些一起落盘（只写一次 jsonl）
        if (imageCleared && target2.image) {
            const previous = target2.image;
            await clearTweetImage(target2);
            delete rt.state.tweetImages[previous];
        } else if (pickedImage) {
            const previous = target2.image;
            const imageRes = await saveTweetImage(target2, pickedImage);
            if (!imageRes.ok) {
                toast('error', assetReasonText(imageRes.reason));
            } else {
                if (previous && previous !== imageRes.name) {
                    delete rt.state.tweetImages[previous];
                }
                rt.state.tweetImages[imageRes.name] = pickedImage;
            }
        }

        const res = await persistTwitterData();
        if (!res.ok) {
            toast('error', assetReasonText(res.reason));
        }
        renderTwitter();
    }

    document.body.appendChild(modal);
    contentArea.focus();
}

/* --------------------------- 推文的数据操作 --------------------------- */

/** 置顶：只允许一条，再点一次取消 */
async function togglePin(id) {
    const target = rt.state.tweets.find(t => t.id === id);
    if (!target) {
        return;
    }
    const willPin = !target.pinned;
    for (const tweet of rt.state.tweets) {
        tweet.pinned = false;
    }
    target.pinned = willPin;
    target.updatedAt = Date.now();
    const res = await persistTwitterData();
    if (!res.ok) {
        toast('error', assetReasonText(res.reason));
    }
    renderTwitter();
}

/**
 * 🔄 / ❤️：点一下数值 +1 并变粉，再点一下 -1 恢复 —— 两个字段（`retweeted` / `liked`）与数值都落盘。
 * 写盘失败就把内存改回去（否则界面与磁盘会不一致）。
 */
async function toggleTweetAction(tweetId, kind) {
    const isLike = kind === 'like';
    const flagKey = isLike ? 'liked' : 'retweeted';
    const tweet = rt.state.tweets.find(t => t.id === tweetId);
    if (!tweet) {
        return { ok: false, reason: 'not-found' };
    }
    const beforeValue = Number(tweet.stats && tweet.stats[kind]) || 0;
    const beforeFlag = tweet[flagKey] === true;
    const nextFlag = !beforeFlag;

    tweet[flagKey] = nextFlag;
    tweet.stats = Object.assign({}, tweet.stats);
    tweet.stats[kind] = Math.max(0, beforeValue + (nextFlag ? 1 : -1));
    tweet.updatedAt = Date.now();

    const res = await persistTwitterData();
    if (!res.ok) {
        // 失败时**视觉上什么都没发生过**：DOM 还没改，只要把内存改回去 + 提示
        tweet[flagKey] = beforeFlag;
        tweet.stats = Object.assign({}, tweet.stats);
        tweet.stats[kind] = beforeValue;
        toast('error', assetReasonText(res.reason));
        return { ok: false, reason: res.reason };
    }
    patchActionNode(tweetId, kind);
    renderManage();
    return { ok: true, kind, value: tweet.stats[kind], active: nextFlag };
}

/**
 * 「关注」⇄「正在关注」：顺带把粉丝数 +1 / -1（与样例推特的 toggleFollow 一致），两者都落盘。
 */
async function toggleTwitterFollow() {
    const profile = normalizeProfile(rt.state.profile);
    const beforeFlag = profile.followed === true;
    const beforeFollowers = String(profile.followers ?? '');
    const nextFlag = !beforeFlag;
    const followers = Number(beforeFollowers.replace(/[^\d]/g, '')) || 0;

    profile.followed = nextFlag;
    profile.followers = String(Math.max(0, followers + (nextFlag ? 1 : -1)));
    rt.state.profile = profile;

    const res = await persistTwitterData();
    if (!res.ok) {
        rt.state.profile = Object.assign({}, rt.state.profile, {
            followed: beforeFlag,
            followers: beforeFollowers,
        });
        toast('error', assetReasonText(res.reason));
        return { ok: false, reason: res.reason };
    }
    patchFollowNode();
    fillProfileInputs();
    return { ok: true, followed: nextFlag, followers: profile.followers };
}

/**
 * 就地更新 iframe 里那条推文的 🔄 / ❤️：只改一个 textContent + 一个 class，**不重建 srcdoc**。
 * 重建会让 iframe 整个重载一次，点起来就不像样例那样无感了。
 */
function patchActionNode(tweetId, kind) {
    const refs = panel();
    const doc = refs && refs.frame && refs.frame.contentDocument;
    const tweet = rt.state.tweets.find(t => t.id === tweetId);
    if (!doc || !tweet) {
        return;
    }
    const card = doc.querySelector('.tweet[data-id="' + tweetId + '"]');
    if (!card) {
        return;
    }
    const isLike = kind === 'like';
    const node = card.querySelector(isLike ? '.tweet-action-like' : '.tweet-action-retweet');
    if (!node) {
        return;
    }
    node.textContent = (isLike ? '❤️ ' : '🔄 ') + formatCount(tweet.stats && tweet.stats[kind]);
    node.classList.toggle('is-active', tweet[isLike ? 'liked' : 'retweeted'] === true);
}

/** 就地更新关注按钮与粉丝数（同样不重建 srcdoc） */
function patchFollowNode() {
    const refs = panel();
    const doc = refs && refs.frame && refs.frame.contentDocument;
    if (!doc) {
        return;
    }
    const profile = rt.state.profile || {};
    const followed = profile.followed === true;
    const button = doc.getElementById('tw-follow');
    if (button) {
        button.textContent = followed ? '正在关注' : '关注';
        button.classList.toggle('btn-primary', !followed);
    }
    const followers = doc.getElementById('tw-followers');
    if (followers) {
        followers.textContent = countText(profile.followers);
    }
}

async function deleteTweet(id) {
    if (!globalThis.confirm('确定删除这条推文？此操作不可撤销。')) {
        return;
    }
    const removed = rt.state.tweets.find(t => t.id === id);
    if (!removed) {
        return;
    }
    rt.state.tweets = rt.state.tweets.filter(t => t.id !== id);
    const res = await persistTwitterData();
    if (!res.ok) {
        // 写盘失败就放回内存（顺序由 seq 决定，放回末尾照样会排到正确位置），别让 UI 与磁盘不一致
        rt.state.tweets = [...rt.state.tweets, removed];
        toast('error', assetReasonText(res.reason) + '（已撤销这次删除）');
        renderTwitter();
        return;
    }
    if (removed.image) {
        const imageName = removed.image;
        await clearTweetImage(removed);
        delete rt.state.tweetImages[imageName];
    }
    toast('success', '已删除。');
    renderTwitter();
}

/* ------------------------------- 面板 ------------------------------- */

/** 主面板里的「推特」区块（横跨整行，排在其它模块之上） */
function buildTwitterPanel() {
    const s = section('推特', { open: false });
    s.root.setAttribute('id', 'roleEx-twitter-section');
    s.root.classList.add('roleEx-span-all');
    iconFor(s.root, 'fa-brands fa-x-twitter');

    // —— 状态行 + 工具按钮：都放进「推文管理」折叠块里 ——
    // 那个折叠块**默认收起**，所以这两行平时不占高度（换算成 iframe 的可用高度 ≈ 70px），
    // 需要加推文 / 看落点 / 看报错时再展开它（展开后第一行就是状态）。
    const status = el('div', { class: 'roleEx-hint', id: 'roleEx-twitter-status' });
    const addButton = el('div', {
        class: 'menu_button roleEx-btn',
        id: 'roleEx-twitter-add',
        title: '手动加一条推文（模型不配合时用）',
        text: '新增推文',
        onclick: () => openTweetEditor(null),
    });
    const refreshButton = el('div', {
        class: 'menu_button roleEx-btn',
        id: 'roleEx-twitter-refresh',
        title: '从文件重新读一次',
        text: '刷新',
        onclick: () => reloadTwitter(),
    });

    // 高度由 CSS 写死（.roleEx-twitter-frame），srcdoc 里 flex 竖排：资料头固定，只有推文列表滚。
    // 不给 scrolling="no"：能不能滚交给 CSS，别用这个老属性（它只会把视口钉死，以后想改都难）。
    const frame = el('iframe', {
        class: 'roleEx-twitter-frame',
        id: 'roleEx-twitter-frame',
        sandbox: 'allow-same-origin',
        title: '仿推特页面',
    });
    frame.addEventListener('load', () => wireFrame());

    // —— 资料区（头像 / 横幅 / 文字）——
    const avatarButton = el('div', {
        class: 'menu_button roleEx-btn-sm',
        title: '上传头像（会自动缩到 200×200 PNG；不动 ST 角色头像）',
        text: '上传头像',
        onclick: () => pickImage('avatar'),
    });
    const avatarClear = el('div', {
        class: 'menu_button roleEx-btn-sm roleEx-danger',
        title: '清除头像（回到空白圆）',
        text: '清除',
        onclick: async () => { await clearAvatar(); renderTwitter(); },
    });
    const bannerButton = el('div', {
        class: 'menu_button roleEx-btn-sm',
        title: '上传横幅（会自动缩到 600×200 JPEG）',
        text: '上传横幅',
        onclick: () => pickImage('banner'),
    });
    const bannerClear = el('div', {
        class: 'menu_button roleEx-btn-sm roleEx-danger',
        title: '清除横幅（回到默认渐变）',
        text: '清除',
        onclick: async () => { await clearBanner(); renderTwitter(); },
    });

    const verifiedToggle = el('input', { type: 'checkbox' });
    // ⚠️ 必须和 profileField() 建的控件一样带上标记：fillProfileInputs() 就是按它回填 checked 的，
    // 少了这一行，Ctrl+F5 之后勾选框会回到未勾选（数据其实是对的）。
    verifiedToggle.dataset.twitterField = 'verified';
    const profileInputs = [];
    const nameField = profileField('名字', 'name', { placeholder: '显示名' });
    const handleField = profileField('handle', 'handle', { placeholder: '@xxx' });
    const bioField = profileField('简介', 'bio', { rows: 3, placeholder: '一行一句，可留空' });
    const metaField = profileField('meta', 'meta', { rows: 4, placeholder: '📍 東京 / 神奈川\n🔗 site.com\n🎈 出生于4月15日\n📅 2023年12月加入', hint: '每行一条' });
    const followingField = profileField('正在关注', 'following', { type: 'number', placeholder: '128', hint: '数字；主页上会按千分位显示' });
    const followersField = profileField('粉丝', 'followers', { type: 'number', placeholder: '3240', hint: '数字；主页上会按千分位显示' });
    for (const field of [nameField, handleField, bioField, metaField, followingField, followersField]) {
        const input = field.querySelector('input, textarea');
        if (input) {
            profileInputs.push(input);
        }
    }
    profileInputs.push(verifiedToggle);

    const profileFold = collapsible('资料区（头像 / 横幅 / 文字）', { open: false });
    profileFold.root.classList.add('roleEx-twitter-fold');   // 标题行削薄（见 style.css），省下的高度给 iframe
    profileFold.body.append(
        el('div', { class: 'roleEx-row' }, [
            el('span', { class: 'roleEx-hint roleEx-inline-label', text: '头像' }),
            avatarButton, avatarClear,
            el('span', { class: 'roleEx-hint', text: '不动 ST 角色头像；存成 twitter/avatar.png' }),
        ]),
        el('div', { class: 'roleEx-row' }, [
            el('span', { class: 'roleEx-hint roleEx-inline-label', text: '横幅' }),
            bannerButton, bannerClear,
            el('span', { class: 'roleEx-hint', text: '留空则用默认渐变；存成 twitter/banner.jpg' }),
        ]),
        nameField,
        el('div', { class: 'roleEx-twitter-field' }, [
            el('span', { class: 'roleEx-hint roleEx-inline-label', text: '认证' }),
            verifiedToggle,
            el('span', { class: 'roleEx-hint', text: '勾选 = 名字后面显示蓝勾' }),
        ]),
        handleField,
        bioField,
        metaField,
        followingField,
        followersField,
    );
    verifiedToggle.addEventListener('input', () => onProfileEdited('verified', verifiedToggle.checked));

    // —— 推文管理 ——
    const list = el('div', { class: 'roleEx-list', id: 'roleEx-twitter-list' });
    const manageFold = collapsible('推文管理', { open: false });
    manageFold.root.classList.add('roleEx-twitter-fold');
    const manageTitle = manageFold.header.querySelector('span');
    manageFold.body.append(
        status,
        el('div', { class: 'roleEx-row roleEx-gap' }, [addButton, refreshButton]),
        el('div', {
            class: 'roleEx-hint',
            id: 'roleEx-twitter-manage-hint',
            text: '每篇推文的 💬🔄❤️📊 在创建时随机生成，之后可以随时「编辑」改，也可以直接手改 JSONL（落点见上方状态行）。',
        }),
        list,
    );

    // —— 解析设置 ——
    const captureToggle = el('input', { type: 'checkbox' });
    captureToggle.checked = settings.twitterCapture !== false;
    captureToggle.addEventListener('change', () => updateSetting('twitterCapture', captureToggle.checked));
    const stripToggle = el('input', { type: 'checkbox' });
    stripToggle.checked = settings.twitterStripTags !== false;
    stripToggle.addEventListener('change', () => updateSetting('twitterStripTags', stripToggle.checked));
    const settingsFold = collapsible('解析设置', { open: false });
    settingsFold.root.classList.add('roleEx-twitter-fold');
    settingsFold.body.append(
        checkboxRow(captureToggle, '解析模型回复里的推文', '识别 <推文>…</推文> 与 <推文时间>…</推文时间>'),
        checkboxRow(stripToggle, '把消费掉的标签从正文里剥离', '关掉则标签留在正文里，但推文照常收录'),
    );

    s.content.append(
        frame,
        profileFold.root,
        manageFold.root,
        settingsFold.root,
    );

    rt.state.panel = { root: s.root, status, frame, list, profileInputs, manageTitle, profileFold, manageFold, settingsFold };
    renderTwitter();
    return { section: s, root: s.root, frame, list };
}

/** 给控制台/自测看的状态快照 */
function describeTwitter() {
    return {
        reason: rt.state.reason,
        loaded: rt.state.loaded,
        tweets: rt.state.tweets.length,
        pinned: rt.state.tweets.filter(t => t.pinned).length,
        fileName: rt.state.identity ? rt.state.identity.fileName : '',
        path: twitterPathText(rt.state.identity ? rt.state.identity.fileName : ''),
        hasAvatar: !!rt.state.avatarDataUrl,
        hasBanner: !!rt.state.bannerDataUrl,
    };
}

    return {
        buildTwitterPanel, deleteTweet, describeTwitter, openTweetEditor, patchActionNode,
        patchFollowNode, reloadTwitter,
        renderFrame, renderManage, renderStatus, renderTwitter, togglePin, toggleTweetAction,
        toggleTwitterFollow, wireFrame,
    };
}

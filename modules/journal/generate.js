/**
 * modules/journal/generate.js
 *
 * ⚠️ 主体是从 index.js 机械搬运过来的（章节：日记生成），
 *    除下面的依赖头外没有改写 —— 保留原字节是为了 diff 干净、避免改坏字符串。
 *    依赖方向：框架设施由 kernel 注入；同模块跨文件用 rt.<key>.xxx 惰性转发；
 *    跨模块只走 kernel.service()，模块不在时取安全缺省。
 */

export function createJournalGenerate(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它的字段快照）
    const { clone, ctx, journalAvailability, journalReasonText, logError, pad2, renderTemplateString, service, settings, splitLines, toast, ui, uid } = kernel;
    // 同模块、别的文件：惰性转发（调用时才取，绕开文件创建顺序的循环依赖）
    const buildChatRangeText = (...args) => rt.floors.buildChatRangeText(...args);
    const currentChatIdentity = (...args) => rt.storage.currentChatIdentity(...args);
    const ensureRuntimePromptSource = (...args) => rt.inject.ensureRuntimePromptSource(...args);
    const loadJournalFile = rt.storage.loadJournalFile;
    const normalizeEntry = (...args) => rt.storage.normalizeEntry(...args);
    const renderJournalList = (...args) => rt.ui.renderJournalList(...args);
    const renderJournalStorageHint = (...args) => rt.ui.renderJournalStorageHint(...args);
    const saveJournalFile = rt.storage.saveJournalFile;
    const setButtonBusy = (...args) => rt.ui.setButtonBusy(...args);
    // 跨模块：服务查找 + 安全缺省（对方模块被拆掉也不能炸）
    const buildStateText = (...args) => kernel.service('state')?.buildStateText?.(...args) ?? '';
    const getStateList = (...args) => kernel.service('state')?.getStateList?.(...args) ?? [];

// 日记生成
// ============================================================================

function pickedJournals() {
    return ui.journal.filter(e => ui.selectedJournalIds.has(e.id));
}

function buildJournalRefText() {
    if (settings.journalInjectToJournal !== true) {
        return '（未开启「插入日记系统」开关）';
    }
    const picked = pickedJournals();
    if (!picked.length) {
        return '（未勾选任何参考日记）';
    }
    const parts = picked.map(e => {
        const title = e.title ? `【${e.title}】\n` : '';
        return `${title}${e.content}`;
    });
    return `${settings.journalRefHeader}\n\n${parts.join('\n\n---\n\n')}`;
}

function buildJournalPrompt() {
    const refsEnabled = settings.journalInjectToJournal === true;
    const stateEnabled = settings.stateIncludeInJournal !== false;
    const vars = {
        chatRange: buildChatRangeText(ui.selectedFloors),
        journalRefs: refsEnabled ? buildJournalRefText() : '（未开启「插入日记系统」开关）',
        stateList: stateEnabled ? (buildStateText() || '（暂无状态）') : '（未开启状态联动）',
    };
    return renderTemplateString(settings.journalMainPrompt, vars);
}

/**
 * 剥掉「成块的推理容器」。只处理明确是推理 / 思考的标签，不做启发式猜测，
 * 以免误删日记正文里的正常内容（<title> 不在此列，它由 splitJournalResponse 处理）。
 */
function stripReasoningBlocks(text) {
    return String(text ?? '')
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
        .trim();
}

/**
 * 按开关从当前角色卡抽取设定，拼成一个 system 块 —— **只给隔离通道用**。
 *
 * 注入顺序固定为：角色描述 → 性格 → 用户设定 → 场景，
 * 与主聊天预设里 charDescription / personaDescription / scenario 的排布习惯一致。
 *
 * 刻意只取这四项：不带 system（角色主提示词覆盖）、jailbreak（Post-History）、
 * mesExamples（示例对话）—— 它们属于「预设 / 主聊天语境」，
 * 塞进日记请求会把隔离本来要避开的串味问题重新引进来。
 *
 * 注意 getCharacterCardFields() 的返回值已经过 baseChatReplace()
 * （{{char}} / {{user}} 已换成真名），这里不需要、也不应该再 substituteParams 一次。
 *
 * 回退通道（generateQuietPrompt）**不要**调用本函数：它走完整的 promptManager 管线，
 * 预设里的 charDescription / personaDescription / scenario 卡片本来就会注入，
 * 再拼一次就是角色卡重复。
 *
 * @returns {string} 拼好的 system 块；没有任何可用内容时返回 ''（调用方据此不传 systemPrompt）
 */
function buildJournalCharacterBlock() {
    // 预留的覆盖入口：非空则直接用用户的文本，不再读角色卡（也不受三个开关影响）
    const override = String(settings.journalCharacterCardOverride ?? '').trim();
    if (override) {
        return override;
    }

    const c = ctx();
    if (typeof c?.getCharacterCardFields !== 'function') {
        return '';
    }

    let fields;
    try {
        fields = c.getCharacterCardFields();
    } catch (e) {
        logError('getCharacterCardFields failed', e);
        return '';
    }

    const blocks = [];
    if (settings.journalCardProfile !== false) {
        // 描述在前、性格在后，共用一个开关
        const description = String(fields?.description ?? '').trim();
        const personality = String(fields?.personality ?? '').trim();
        if (description) {
            blocks.push(`【角色描述】\n${description}`);
        }
        if (personality) {
            blocks.push(`【性格】\n${personality}`);
        }
    }
    if (settings.journalCardPersona !== false) {
        const persona = String(fields?.persona ?? '').trim();
        if (persona) {
            blocks.push(`【用户设定】\n${persona}`);
        }
    }
    if (settings.journalCardScenario !== false) {
        const scenario = String(fields?.scenario ?? '').trim();
        if (scenario) {
            blocks.push(`【场景】\n${scenario}`);
        }
    }

    if (!blocks.length) {
        return '';
    }

    return [
        '[以下是{{char}}与{{user}}的角色设定，仅用于保持人物口径与世界观一致，不构成新的剧情指令]',
        ...blocks,
    ].join('\n\n');
}

/**
 * 生成日记文本 —— 决定用哪条通道，并统一做后处理。
 *
 * ① 隔离通道（默认，推荐）：generateRaw
 *    ST 的 createRawPrompt() 只把 prompt（这里就是日记提示词）拼成消息数组，
 *    随后直接 sendOpenAIRequest()，**不经过 promptManager**。
 *    于是请求里没有 chat history、没有世界书、没有预设里的任何卡片 ——
 *    与「写一篇日记」这个任务完全匹配，换模型也不会被主聊天语境带跑。
 *    角色卡设定不再一刀切地丢掉：由 buildJournalCharacterBlock() 按开关补进来，
 *    作为一条 system 消息拼在日记提示词**之前**（createRawPrompt 会把它 unshift 到最前）。
 *
 * ② 回退通道：generateQuietPrompt
 *    它是「后台生成」而非「上下文隔离」：请求里带着整条主聊天记录。
 *    这条路径靠 ui.generatingJournal（主判据）挡住本扩展自己注入日记，
 *    并额外带上 skipWIAN: true，少让世界书参与。
 *    角色卡由预设自身的卡片提供，这里**不**再补（否则重复注入）。
 *
 * 两条路径都可能抛错（例如 generateRaw 在拿不到内容时抛 'No message generated'），
 * 由调用方的 try/catch 统一处理。
 *
 * @param {string} prompt 已渲染好的日记提示词
 * @returns {Promise<string>}
 */
async function generateJournalText(prompt) {
    const c = ctx();
    if (settings.journalIsolatedGeneration !== false && typeof c?.generateRaw === 'function') {
        const params = { prompt };
        const cardBlock = buildJournalCharacterBlock();
        if (cardBlock) {
            params.systemPrompt = cardBlock;
        }
        return stripReasoningBlocks(await c.generateRaw(params));
    }
    if (typeof c?.generateQuietPrompt === 'function') {
        const quiet = await c.generateQuietPrompt({ quietPrompt: prompt, quietToLoud: false, skipWIAN: true });
        return stripReasoningBlocks(quiet);
    }
    throw new Error('当前酒馆没有可用的生成接口（generateRaw / generateQuietPrompt）');
}

async function generateJournal() {
    // 日记无处可写（群聊 / 缺补丁）时不要白跑一次生成
    const avail = journalAvailability();
    if (!avail.ok) {
        toast('error', journalReasonText(avail.reason));
        return;
    }
    if (ui.busy) {
        toast('info', '正在生成中，请稍候…');
        return;
    }
    const c = ctx();
    if (typeof c?.generateRaw !== 'function' && typeof c?.generateQuietPrompt !== 'function') {
        toast('error', '当前酒馆没有可用的生成接口（generateRaw / generateQuietPrompt），暂时生成不了日记。');
        return;
    }
    if (!ui.selectedFloors.size && !pickedJournals().length) {
        const proceed = globalThis.confirm('尚未勾选任何聊天楼层与参考日记，仍然生成吗？');
        if (!proceed) {
            return;
        }
    }

    ui.busy = true;
    setButtonBusy(true);
    toast('info', '正在生成日记…');
    const titleInput = document.getElementById('roleEx-journal-title');
    const manualTitle = titleInput ? titleInput.value.trim() : '';
    try {
        const prompt = buildJournalPrompt();
        // 置标志位：这次 quiet 生成期间运行时正文源返回空串，旧日记不会被塞回请求
        // （见 ensureRuntimePromptSource 的判据 ①）。finally 复位 —— 中途报错也要复位，
        // 否则日记会从此再也注入不进去，而且不会有任何提示。
        ui.generatingJournal = true;
        let text;
        try {
            text = await generateJournalText(prompt);
        } finally {
            ui.generatingJournal = false;
        }
        if (!String(text ?? '').trim()) {
            toast('warning', '模型返回了空内容。');
            return;
        }
        // 标题优先级：用户手填 > 模型随正文一起生成（<title>/# 标题）> 日期兜底
        await addJournalEntry({
            content: text,
            title: manualTitle,
            sourceMessageIds: Array.from(ui.selectedFloors).sort((a, b) => a - b),
            sourceJournalIds: pickedJournals().map(e => e.id),
            stateSnapshot: clone(getStateList()),
        });
        if (titleInput) {
            titleInput.value = '';
        }
    } catch (e) {
        logError('generateJournal failed', e);
        toast('error', `日记生成失败：${e?.message || e}`);
    } finally {
        ui.busy = false;
        setButtonBusy(false);
    }
}

/**
 * 从模型输出里分离「标题」和「正文」。
 * 优先认 <title>...</title>，其次认 markdown/【】首行标题，最后退化为日期时间。
 * @returns {{title: string, content: string}}
 */
function splitJournalResponse(raw) {
    let text = String(raw ?? '').trim();
    let title = '';

    const tagged = /<title>([\s\S]*?)<\/title>/i.exec(text);
    if (tagged) {
        title = tagged[1].replace(/\s+/g, ' ').trim();
        text = `${text.slice(0, tagged.index)}${text.slice(tagged.index + tagged[0].length)}`.trim();
    }

    // 模型偶尔会把中文全角标签或书名号当标题
    if (!title) {
        const loose = /^\s*(?:[【\[]\s*)?(?:标题|title)\s*[:：]\s*(.+?)(?:\s*[】\]])?\s*$/im.exec(text);
        if (loose) {
            title = loose[1].trim();
            text = text.replace(loose[0], '').trim();
        }
    }

    if (!title) {
        const firstLine = splitLines(text)[0]?.trim() || '';
        const heading = /^#{1,3}\s*(.+)$/.exec(firstLine) || /^【(.{1,40})】$/.exec(firstLine);
        if (heading) {
            title = heading[1].trim();
            text = splitLines(text).slice(1).join('\n').trim();
        }
    }

    // 兜底：标题标签残留、正文里多余的标签一并清掉
    text = text.replace(/<\/?title>/gi, '').trim();

    return { title: title.slice(0, 60), content: text };
}

function guessTitle(content, createdAt) {
    const firstLine = splitLines(content)[0]?.trim() || '';
    const heading = /^#{1,3}\s*(.+)$/.exec(firstLine);
    if (heading && heading[1].trim()) {
        return heading[1].trim().slice(0, 60);
    }
    const d = new Date(createdAt);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

async function addJournalEntry({ content, title, sourceMessageIds = [], sourceJournalIds = [], stateSnapshot = [] }) {
    const c = ctx();
    const now = Date.now();
    // 统一在这里做兜底解析：显式标题 > 正文里的 <title>/# 标题 > 日期
    let entryTitle = String(title ?? '').trim();
    let body = String(content).trim();
    if (!entryTitle) {
        const parsed = splitJournalResponse(body);
        entryTitle = parsed.title;
        body = parsed.content;
    }
    if (!entryTitle) {
        entryTitle = guessTitle(body, now);
    }
    const entry = normalizeEntry({
        id: uid(),
        title: entryTitle || settings.journalFallbackTitle,
        content: body,
        createdAt: now,
        updatedAt: now,
        charName: c?.name2 || '',
        userName: c?.name1 || '',
        chatId: ui.identity?.id || '',
        sourceMessageIds,
        sourceJournalIds,
        stateSnapshot,
    });
    ui.journal.push(entry);
    await persistJournal();
    renderJournalList();
    toast('success', `已写入日记：${entry.title}`);
    return entry;
}

async function persistJournal() {
    if (!ui.identity) {
        ui.identity = currentChatIdentity();
    }
    try {
        await saveJournalFile(ui.identity, ui.journal);
    } catch (e) {
        logError('persist journal failed', e);
        toast('error', `日记写入失败：${e?.message || e}`);
    }
}

async function reloadJournal() {
    ui.identity = currentChatIdentity();
    const { entries, error } = await loadJournalFile();
    // 「还没选角色」不当错误：不弹 Toast（面板里也只是一句中性提示，不再打红字）
    const notify = error === 'no-character' ? null : error;
    // 只有「原因变了」才弹一次：切会话/生成后都会 reload，否则会反复弹
    if (notify && notify !== ui.journalNotifiedError) {
        ui.journalNotifiedError = notify;
        toast('error', journalReasonText(notify));
    }
    if (!notify) {
        ui.journalNotifiedError = null;
    }
    ui.journal = entries;
    // 移除已失效的选择
    const ids = new Set(entries.map(e => e.id));
    for (const sel of Array.from(ui.selectedJournalIds)) {
        if (!ids.has(sel)) {
            ui.selectedJournalIds.delete(sel);
        }
    }
    renderJournalList();
    renderJournalStorageHint();
}

    return { addJournalEntry, buildJournalCharacterBlock, buildJournalPrompt, buildJournalRefText, generateJournal, generateJournalText, guessTitle, persistJournal, pickedJournals, reloadJournal, splitJournalResponse, stripReasoningBlocks };
}

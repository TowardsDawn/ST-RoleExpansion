/**
 * modules/journal/storage.js
 *
 * ⚠️ 主体是从 index.js 机械搬运过来的（章节：日记存储层：一个会话 = 一个 jsonl 文件；一篇日记 = 一行），
 *    除下面的依赖头外没有改写 —— 保留原字节是为了 diff 干净、避免改坏字符串。
 *    依赖方向：框架设施由 kernel 注入；同模块跨文件用 rt.<key>.xxx 惰性转发；
 *    跨模块只走 kernel.service()，模块不在时取安全缺省。
 */

export function createJournalStorage(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它的字段快照）
    const { STORAGE, ctx, journalAvailability, journalReasonText, logError, readJournalFile, settings, splitLines, stableHash, toast, ui, uid, writeJournalFile } = kernel;

// 日记存储层：一个会话 = 一个 jsonl 文件；一篇日记 = 一行
//
// 落点：<user>/chats/<角色目录>/_RoleExpansion/journals/RoleExpansion_journal_c_<角色hash>_j_<会话hash>.jsonl
//    - 读写走服务端补丁的 /api/role-expansion（见 index.js「日记文件存储」章节）：
//      群聊与「没打补丁」都明确不可用，不做回退，原因由 UI 说清楚；
//    - 文件名必须是单段 ASCII（服务端沿用酒馆的文件名规则），所以角色/会话只进 hash，
//      完整可读的角色名/会话名记录在文件首行的会话头里。
// ============================================================================

function currentChatIdentity() {
    const c = ctx();
    const chatId = typeof c?.getCurrentChatId === 'function' ? c.getCurrentChatId() : '';
    const charName = c?.name2 || c?.characters?.[c?.characterId]?.name || 'Character';
    const raw = chatId && String(chatId).trim()
        ? String(chatId).replace(/\.jsonl$/i, '')
        : `__noid__/${charName}`;
    const parts = raw.split('/');
    const chatFile = parts.pop() || raw;
    const charDir = parts.pop() || charName;

    const charKey = stableHash(charDir).slice(0, 8);
    const chatKey = stableHash(`${charDir}/${chatFile}`).slice(0, 8);
    const fileName = `${STORAGE.PREFIX}_c_${charKey}_j_${chatKey}.jsonl`;

    return {
        id: raw,
        charDir,
        chatFile,
        charSlug: `c_${charKey}`,
        fileName,
        // 单段 ASCII 文件名；所在目录由服务端补丁按 avatar_url 推导
    };
}

function encodeLine(obj) {
    return JSON.stringify(obj).replace(/\r?\n/g, '\\n');
}

/** 解析 jsonl：返回 {session, entries}，非法行会被跳过并计数 */
function parseJsonl(text) {
    const out = { session: null, entries: [], skipped: 0 };
    if (!text) {
        return out;
    }
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
        if (obj && obj.__roleExpansion === 'session') {
            out.session = obj;
            continue;
        }
        if (obj && typeof obj === 'object' && typeof obj.content === 'string') {
            out.entries.push(normalizeEntry(obj));
            continue;
        }
        out.skipped += 1;
    }
    return out;
}

function normalizeEntry(src) {
    return {
        __roleExpansion: 'journal',
        id: String(src.id || uid()),
        title: String(src.title ?? ''),
        content: String(src.content ?? ''),
        createdAt: Number(src.createdAt) || Date.now(),
        updatedAt: Number(src.updatedAt) || Number(src.createdAt) || Date.now(),
        charName: String(src.charName ?? ''),
        userName: String(src.userName ?? ''),
        chatId: String(src.chatId ?? ''),
        sourceMessageIds: Array.isArray(src.sourceMessageIds) ? src.sourceMessageIds : [],
        sourceJournalIds: Array.isArray(src.sourceJournalIds) ? src.sourceJournalIds : [],
        stateSnapshot: Array.isArray(src.stateSnapshot) ? src.stateSnapshot : [],
        meta: src.meta && typeof src.meta === 'object' ? src.meta : {},
    };
}

async function loadJournalFile() {
    const identity = currentChatIdentity();

    // 不可用（群聊 / 缺补丁）时不要假装「文件是空的」：把原因带出去，让 UI 说清楚
    const avail = journalAvailability();
    if (!avail.ok) {
        ui.journalError = avail.reason;
        return { identity, entries: [], error: avail.reason };
    }

    const res = await readJournalFile(identity.fileName);
    if (!res.ok) {
        ui.journalError = res.reason;
        logError('read journal file failed', identity.fileName, res.reason);
        return { identity, entries: [], error: res.reason };
    }
    ui.journalError = null;
    const text = res.text;
    const parsed = parseJsonl(text);
    if (parsed.skipped) {
        toast('warning', `日记文件有 ${parsed.skipped} 行无法解析，已跳过。`);
    }
    return { identity, entries: parsed.entries };
}

async function saveJournalFile(identity, entries) {
    const lines = [];
    lines.push(encodeLine({
        __roleExpansion: 'session',
        version: 1,
        chatId: identity.id,
        charDir: identity.charDir,
        chatFile: identity.chatFile,
        charSlug: identity.charSlug,
        savedAt: Date.now(),
        count: entries.length,
    }));
    for (const entry of entries) {
        lines.push(encodeLine(entry));
    }
    const res = await writeJournalFile(identity.fileName, lines.join('\n') + '\n');
    if (!res.ok) {
        ui.journalError = res.reason;
        throw new Error(journalReasonText(res.reason));
    }
    ui.journalError = null;
}

    return { currentChatIdentity, encodeLine, loadJournalFile, normalizeEntry, parseJsonl, saveJournalFile };
}

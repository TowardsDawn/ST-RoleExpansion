/**
 * modules/journal/floors.js
 *
 * ⚠️ 主体是从 index.js 机械搬运过来的（章节：楼层（聊天记录）选择），
 *    除下面的依赖头外没有改写 —— 保留原字节是为了 diff 干净、避免改坏字符串。
 *    依赖方向：框架设施由 kernel 注入；同模块跨文件用 rt.<key>.xxx 惰性转发；
 *    跨模块只走 kernel.service()，模块不在时取安全缺省。
 */

export function createJournalFloors(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它的字段快照）
    const { ctx, getChatArray, settings, textPreview, ui } = kernel;

// 楼层（聊天记录）选择
// ============================================================================

function isSelectableMessage(msg) {
    return msg && typeof msg === 'object' && typeof msg.mes === 'string' && msg.mes.trim() !== '';
}

function listFloors() {
    const chat = getChatArray();
    const rows = [];
    chat.forEach((msg, index) => {
        if (!isSelectableMessage(msg)) {
            return;
        }
        rows.push({
            index,
            mesId: index,
            isUser: !!msg.is_user,
            isSystem: !!msg.is_system,
            name: msg.name || (msg.is_user ? (ctx()?.name1 || 'User') : (ctx()?.name2 || 'Character')),
            preview: textPreview(msg.mes),
            swipes: Array.isArray(msg.swipes) ? msg.swipes.length : 0,
        });
    });
    return rows;
}

/** 把勾选的楼层拼成一段参考文本 */
function buildChatRangeText(selectedIndexes) {
    const chat = getChatArray();
    const name1 = ctx()?.name1 || 'User';
    const name2 = ctx()?.name2 || 'Character';
    const indexes = Array.from(selectedIndexes)
        .filter(i => Number.isInteger(i) && i >= 0 && i < chat.length)
        .sort((a, b) => a - b);
    if (!indexes.length) {
        return '（未选择任何聊天楼层）';
    }
    return indexes
        .map(i => {
            const msg = chat[i];
            const who = msg.is_user ? name1 : (msg.name || name2);
            return `#${i} ${who}: ${String(msg.mes || '').trim()}`;
        })
        .join('\n\n');
}

    return { buildChatRangeText, isSelectableMessage, listFloors };
}

/**
 * modules/state/store.js
 *
 * ⚠️ 主体是从 index.js 机械搬运过来的（章节：聊天元数据（状态栏用；按会话隔离）），
 *    除下面的依赖头外没有改写 —— 保留原字节是为了 diff 干净、避免改坏字符串。
 *    依赖方向：框架设施由 kernel 注入；同模块跨文件用 rt.<key>.xxx 惰性转发；
 *    跨模块只走 kernel.service()，模块不在时取安全缺省。
 */

export function createStateStore(kernel, rt) {
    // 框架注入（settings / ui 是长期同一个对象，不要缓存它的字段快照）
    const { META_KEY, ctx, debounce, logError, settings, ui } = kernel;

// 聊天元数据（状态栏用；按会话隔离）
// ============================================================================

function getMetaRoot() {
    const c = ctx();
    if (!c) {
        return {};
    }
    if (!c.chatMetadata) {
        c.chatMetadata = {};
    }
    if (!c.chatMetadata[META_KEY] || typeof c.chatMetadata[META_KEY] !== 'object') {
        c.chatMetadata[META_KEY] = { state: [] };
    }
    if (!Array.isArray(c.chatMetadata[META_KEY].state)) {
        c.chatMetadata[META_KEY].state = [];
    }
    return c.chatMetadata[META_KEY];
}

/**
 * 兼容旧位置的状态数据键（`chatMetadata.sillyTavernState`）：**一个会话只迁移一次**。
 *
 * ⚠️ 仅凭「本扩展这侧为空」做判据是不够的 —— 用户点面板「清空全部」之后，
 * 本扩展这侧同样是空数组，而 sillyTavernState 仍留在会话文件里（实测如此）。
 * 没有次数标记的话，旧数据会在下一次读取时整份复活，
 * 表现为「清空后一刷新，状态全回来了」。
 *
 * 所以无论这一次是否真的发生迁移，都落一个 legacyMigrated 标记，此后永久停用迁移通道；
 * 原键的数据本身保持原样，不做删除。
 */
function migrateLegacyState(meta) {
    if (meta.legacyMigrated === true) {
        return;
    }
    const c = ctx();
    const legacy = c?.chatMetadata?.sillyTavernState;
    if (Array.isArray(legacy) && legacy.length && (!Array.isArray(meta.state) || meta.state.length === 0)) {
        meta.state = legacy.map(x => ({ name: String(x?.name ?? ''), value: String(x?.value ?? '') })).filter(x => x.name);
    }
    meta.legacyMigrated = true;
    saveMeta();
}

function getStateList() {
    const meta = getMetaRoot();
    migrateLegacyState(meta);
    return meta.state;
}

function saveMeta() {
    const c = ctx();
    if (typeof c?.saveMetadata === 'function') {
        try {
            c.saveMetadata();
            return;
        } catch (e) {
            logError('saveMetadata failed', e);
        }
    }
    try {
        globalThis.saveMetadata?.();
    } catch (e) {
        logError('global saveMetadata failed', e);
    }
}

const saveMetaDebounced = debounce(saveMeta, 300);

    return { getMetaRoot, getStateList, migrateLegacyState, saveMeta, saveMetaDebounced };
}

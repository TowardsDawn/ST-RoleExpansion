/**
 * 单文件校验：把一个文件名按 ST 的 validateAssetFileName 规则逐字符过一遍。
 * 用法： node tools/check-filename.mjs "<name>"
 * 不给参数时用内置样例。
 */
/* eslint-disable no-console */

const samples = process.argv.slice(2);
if (!samples.length) {
    samples.push('RoleExpansion/journal/c_Seraphina_91aa9d/j_Seraphina_-_2026-08-17_15h28m47s_67d659.jsonl');
}

/** 与 ST src/endpoints/assets.js:validateAssetFileName 完全一致 */
const ST_RE = /^[a-zA-Z0-9_\-.]+$/;
/** 同一个字符类，但额外允许路径分隔符（便于诊断） */
const PATH_RE = /^[a-zA-Z0-9_\-./]+$/;

for (const name of samples) {
    console.log('=== ' + name);
    console.log('  ST 正则通过      :', ST_RE.test(name));
    console.log('  允许斜杠后通过    :', PATH_RE.test(name));
    console.log('  长度             :', name.length);
    console.log('  纯可打印 ASCII    :', /^[\x20-\x7E]*$/.test(name));
    const bad = [];
    for (const ch of name) {
        if (!/[a-zA-Z0-9_\-./]/.test(ch)) {
            bad.push(`${JSON.stringify(ch)} U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
        }
    }
    console.log('  非白名单字符      :', bad.length ? bad.join(', ') : '(无)');
    console.log('  尾部码点         :', Array.from(name).slice(-4).map(c => c.codePointAt(0)).join(' '));
}

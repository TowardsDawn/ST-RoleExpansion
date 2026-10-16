/**
 * ST 侧补丁自测：patches/st-wi-scan-source.patch（世界书扫描正文源注册表）
 *
 * 做法：把 ST 仓库的每个受支持 tag（1.18.0 = README 声明的最低版本，1.19.0 = 当前开发版本）
 * 用 `git archive` + `tar` 各导出一份干净树（LF 检出，每次都用 -c core.autocrlf=false
 * 压掉系统级 autocrlf=true），在那里面用 `git apply` 真跑补丁，再直接读文件断言：
 *   补丁纯 LF；能在两个版本上分别独立应用；应用后 world-info.js 出现
 *   registerWorldInfoScanSource / unregisterWorldInfoScanSource / extensionScanSources，
 *   且新循环落在 checkWorldInfo 内、原 extensionPrompts 循环之后；
 *   st-context.js 的 import 与 getContext 各挂一处；
 *   与另外三枚补丁顺序无关（本补丁放最前、放最后各跑一遍，两个版本都必须成功）。
 *
 * 坑 1：在 git 仓库内部执行 `git apply` 会静默 no-op，所以临时树必须落在任何仓库
 *       之外（git worktree 产生的目录仍属于仓库，不能用）。这里用 os.tmpdir() 下的
 *       mkdtemp 目录，并在动手前断言它不在任何 git 仓库里。
 * 坑 2：受限沙箱里子进程默认的管道 stdio 会 EPERM，所以子进程的输出一律接到一个
 *       普通文件描述符上，而不是 pipe。
 *
 * 注：另外三枚补丁彼此之间有先后要求（twitter-assets 的 server-startup.js 锚点依赖
 *     journal-store 先加的那行 import），与本补丁无关；本测试只跑需求要求的两个顺序：
 *     顺序 A = [本补丁, marker, journal, twitter]，顺序 B = [marker, journal, twitter, 本补丁]。
 *     换言之：本补丁与其余三枚顺序无关，其余三枚内部 journal 必须先于 twitter。
 *
 * 用法：node tools/patch-wiscan-test.mjs [ST_DIR]
 *   ST_DIR 默认取环境变量 ST_DIR，再退到本机开发路径；缺 ST 仓库/git/任一 tag 时打印
 *   SKIP + 原因并退出 0（CI 友好，与另外两个 patch 测试同款）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const stDir = process.argv[2] || process.env.ST_DIR || 'E:\\SillyTavern\\SillyTavern';
/** README 声明的最低版本 + 当前开发版本，两枚都要复验 */
const TAGS = ['1.18.0', '1.19.0'];
const PATCH = path.join(repo, 'patches', 'st-wi-scan-source.patch');
const OTHERS = ['st-marker-prompt.patch', 'st-journal-store.patch', 'st-twitter-assets.patch'];
const OTHERS_PATH = OTHERS.map(n => path.join(repo, 'patches', n));
const WI = ['public', 'scripts', 'world-info.js'];
const CTX = ['public', 'scripts', 'st-context.js'];

const results = [];
const check = (name, cond, extra) => results.push([cond ? 'PASS' : 'FAIL', name, extra || '']);

let scratch = null;
const cleanup = () => { if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); };
const skip = (msg) => { cleanup(); console.log('SKIP ' + msg); process.exit(0); };

if (!fs.existsSync(PATCH)) skip('找不到 ' + PATCH);
for (const name of OTHERS) {
    if (!fs.existsSync(path.join(repo, 'patches', name))) skip('找不到另外三枚补丁之一：' + name);
}
if (!fs.existsSync(path.join(stDir, '.git'))) skip('ST_DIR 不是 git 仓库（缺 .git）：' + stDir);
if (!fs.existsSync(path.join(stDir, ...WI))) skip('ST_DIR 不像是酒馆根目录：' + stDir);

scratch = fs.mkdtempSync(path.join(os.tmpdir(), 're-wiscan-test-'));
let cmdSeq = 0;
/** 跑一个子进程，输出走文件描述符（不用 pipe，受限沙箱里 pipe 会 EPERM） */
const run = (file, args, cwd = scratch) => {
    const log = path.join(scratch, 'cmd-' + (++cmdSeq) + '.log');
    const fd = fs.openSync(log, 'w');
    let status = 0;
    try {
        execFileSync(file, args, { cwd, stdio: ['ignore', fd, fd] });
    } catch (error) {
        status = typeof error.status === 'number' ? error.status : -1;
    } finally {
        fs.closeSync(fd);
    }
    const out = fs.readFileSync(log, 'utf8').trim();
    fs.rmSync(log, { force: true });
    return { status, out };
};

if (run('git', ['--version']).status !== 0) skip('找不到可用的 git（本测试需要 git apply）');
const tagRev = {};
const missingTags = [];
for (const tag of TAGS) {
    const r = run('git', ['-C', stDir, 'rev-parse', '--verify', 'refs/tags/' + tag + '^{commit}']);
    if (r.status === 0) tagRev[tag] = r.out; else missingTags.push(tag);
}
if (missingTags.length) skip('ST 仓库里没有这些 tag：' + missingTags.join(', ') + '（' + stDir + '）');

const lastLine = (text) => text.split('\n').filter(Boolean).pop() || '';
const offsetsOf = (text) => text.split('\n').map(l => l.trim()).filter(l => l.includes('offset')).join('; ');

/** 导出某个 tag 的 pristine 树；core.autocrlf=false 保证 LF 检出 */
const extractPristine = (tag, name) => {
    const dest = path.join(scratch, name);
    fs.mkdirSync(dest, { recursive: true });
    const tarFile = path.join(scratch, name + '.tar');
    const a = run('git', ['-c', 'core.autocrlf=false', '-C', stDir, 'archive', '--format=tar', '-o', tarFile, tag]);
    if (a.status !== 0) return { dest, error: 'git archive ' + tag + ' 失败：' + (lastLine(a.out) || 'status=' + a.status) };
    const x = run('tar', ['-xf', tarFile, '-C', dest]);
    if (x.status !== 0) return { dest, error: 'tar 解包失败：' + (lastLine(x.out) || 'status=' + x.status) };
    fs.rmSync(tarFile, { force: true });
    return { dest };
};

const applyPatch = (tree, patchFile) =>
    run('git', ['-c', 'core.autocrlf=false', 'apply', '--verbose', patchFile], tree);

const readFile = (tree, parts) => fs.readFileSync(path.join(tree, ...parts), 'utf8');
const rmTree = (tree) => { if (tree) fs.rmSync(tree, { recursive: true, force: true }); };
const countOf = (text, re) => (text.match(re) || []).length;

/** 应用后的内容断言：新循环必须在 checkWorldInfo 内、且在原 extensionPrompts 循环之后 */
const assertApplied = (label, tree) => {
    const wi = readFile(tree, WI);
    const ctx = readFile(tree, CTX);
    const lines = wi.split('\n');
    const declAt = lines.findIndex(l => l.startsWith('export async function checkWorldInfo('));
    const extAt = lines.findIndex(l => l === '    for (const key of Object.keys(context.extensionPrompts)) {');
    const newAt = lines.findIndex(l => l === '    for (const [key, getText] of extensionScanSources) {');
    const extEndAt = extAt < 0 ? -1 : lines.findIndex((l, i) => i > extAt && l === '    }');
    // checkWorldInfo 的结束标志：它之后第一个顶格 '}'；新循环必须在它之前
    const fnEndAt = declAt < 0 ? -1 : lines.findIndex((l, i) => i > declAt && l === '}');
    const between = extEndAt < 0 || newAt < 0 ? [] : lines.slice(extEndAt + 1, newAt);

    check(label + '：world-info.js 有 extensionScanSources 注册表', wi.includes('const extensionScanSources = new Map();'));
    check(label + '：world-info.js 导出 registerWorldInfoScanSource',
        /export function registerWorldInfoScanSource\(key, getText\) \{/.test(wi));
    check(label + '：world-info.js 导出 unregisterWorldInfoScanSource',
        /export function unregisterWorldInfoScanSource\(key\) \{/.test(wi));
    check(label + '：新循环在 checkWorldInfo 内', declAt >= 0 && newAt > declAt && (fnEndAt < 0 || newAt < fnEndAt),
        'checkWorldInfo@' + (declAt + 1) + ' 新循环@' + (newAt + 1) + ' 函数结束@' + (fnEndAt + 1));
    check(label + '：新循环在原 extensionPrompts 循环之后', extAt >= 0 && newAt > extAt,
        'extensionPrompts 循环@' + (extAt + 1) + ' 新循环@' + (newAt + 1));
    check(label + '：新循环紧跟 extensionPrompts 循环（中间只有注释）',
        between.length > 0 && between.every(l => l.trim() === '' || l.trim().startsWith('//')), between.length + ' 行');
    check(label + '：st-context.js import 里带上两个名字',
        /import \{[^}]*\bregisterWorldInfoScanSource\b[^}]*\} from '\.\/world-info\.js';/.test(ctx));
    check(label + '：st-context.js getContext 里挂上两个名字',
        /\bgetWorldInfoPrompt,\n\s+registerWorldInfoScanSource,\n\s+unregisterWorldInfoScanSource,/.test(ctx));
    check(label + '：两个名字在 st-context.js 各出现 2 次（import + getContext）',
        countOf(ctx, /\bregisterWorldInfoScanSource\b/g) === 2
        && countOf(ctx, /\bunregisterWorldInfoScanSource\b/g) === 2,
        'register=' + countOf(ctx, /\bregisterWorldInfoScanSource\b/g)
        + ' unregister=' + countOf(ctx, /\bunregisterWorldInfoScanSource\b/g));
    return { wi, ctx };
};

/** 在某个 tag 的干净树里按给定顺序跑一遍补丁 */
const applySequence = (label, tag, patchFiles) => {
    const t = extractPristine(tag, label);
    if (t.error) {
        check(label + '：导出 pristine ' + tag + ' 树', false, t.error);
        return null;
    }
    for (const p of patchFiles) {
        const r = applyPatch(t.dest, p);
        check(label + '：应用 ' + path.basename(p), r.status === 0, r.status === 0 ? '' : lastLine(r.out));
    }
    return t.dest;
};

/** 一个 tag 的全套复验：独立应用 + 两种顺序 + 内容断言 */
const verifyTag = (tag) => {
    const pristine = extractPristine(tag, 'pristine-' + tag);
    check(tag + '：导出 pristine 树（tag = ' + tagRev[tag].slice(0, 9) + '）', !pristine.error, pristine.error || '');
    if (pristine.error) return;

    const toplevel = run('git', ['-C', pristine.dest, 'rev-parse', '--show-toplevel']);
    check(tag + '：临时树不在任何 git 仓库内（否则 git apply 会静默 no-op）', toplevel.status !== 0, lastLine(toplevel.out));
    check(tag + '：pristine 检出是 LF', !fs.readFileSync(path.join(pristine.dest, ...WI)).includes(13)
        && !fs.readFileSync(path.join(pristine.dest, ...CTX)).includes(13));

    const wiBefore = readFile(pristine.dest, WI);
    check(tag + '：pristine 的 world-info.js 还没有注册表', !wiBefore.includes('extensionScanSources'));
    const solo = applyPatch(pristine.dest, PATCH);
    check(tag + '：补丁可独立应用（git apply）', solo.status === 0,
        solo.status === 0 ? offsetsOf(solo.out) : lastLine(solo.out));
    const wiAfter = readFile(pristine.dest, WI);
    check(tag + '：独立应用真的写进了文件（不是静默 no-op）', wiAfter !== wiBefore && wiAfter.includes('extensionScanSources'));
    assertApplied(tag + ' 独立应用', pristine.dest);
    rmTree(pristine.dest);

    const treeA = applySequence(tag + ' 顺序A-本补丁最前', tag, [PATCH, ...OTHERS_PATH]);
    const treeB = applySequence(tag + ' 顺序B-本补丁最后', tag, [...OTHERS_PATH, PATCH]);
    if (!treeA || !treeB) return;

    assertApplied(tag + ' 顺序A', treeA);
    assertApplied(tag + ' 顺序B', treeB);

    const wiA = readFile(treeA, WI);
    const wiB = readFile(treeB, WI);
    const ctxA = readFile(treeA, CTX);
    const ctxB = readFile(treeB, CTX);
    check(tag + '：两种顺序得到完全相同的 world-info.js', wiA === wiB);
    check(tag + '：两种顺序得到完全相同的 st-context.js', ctxA === ctxB);
    check(tag + '：顺序 B 的 st-context.js 同时带上 marker 补丁的 registerRuntimePromptSource',
        ctxB.includes('registerRuntimePromptSource'));
    rmTree(treeA);
    rmTree(treeB);
};

try {
    const patchBytes = fs.readFileSync(PATCH);
    const patchText = patchBytes.toString('utf8');
    check('补丁文件不含 CR（纯 LF）', !patchBytes.includes(13));
    check('补丁以 LF 结尾', patchBytes[patchBytes.length - 1] === 10);
    check('补丁路径相对 ST 仓库根（diff --git a/public/scripts/...）',
        patchText.includes('diff --git a/public/scripts/world-info.js b/public/scripts/world-info.js')
        && patchText.includes('diff --git a/public/scripts/st-context.js b/public/scripts/st-context.js'));
    check('补丁只动了那两个文件', (patchText.match(/^diff --git /gm) || []).length === 2);

    for (const tag of TAGS) verifyTag(tag);
} catch (error) {
    check('自测脚本未抛异常', false, String((error && error.message) || error));
} finally {
    cleanup();
}

const fails = results.filter(r => r[0] === 'FAIL');
console.log(results.map(r => r[0] + '  ' + r[1] + (r[2] ? '   [' + r[2] + ']' : '')).join('\n'));
console.log('');
console.log('世界书扫描源补丁自测：共 ' + results.length + ' 项，失败 ' + fails.length + ' 项');
process.exit(fails.length ? 1 : 0);

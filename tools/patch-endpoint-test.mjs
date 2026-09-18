/**
 * 补丁端点端到端自测（可选，需要本机有酒馆安装目录的 node_modules）
 *
 * 从 patches/st-journal-store.patch 里抽出 src/endpoints/role-expansion.js，
 * 在一个临时 express 沙盒里真起一个服务，验证：
 *   读 / 写 / 原子写无残留 / 路径穿越与非法文件名一律 400 /
 *   酒馆自己的列聊天逻辑看不见它 / 角色目录改名搬迁后日记跟着走。
 *
 * 用法：node tools/patch-endpoint-test.mjs [ST_DIR]
 *   ST_DIR 默认取环境变量 ST_DIR，再退到本机开发路径；缺失时打印 SKIP 并退出 0（CI 友好）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const stDir = process.argv[2] || process.env.ST_DIR || 'E:\\SillyTavern\\SillyTavern';
const patchPath = path.join(repo, 'patches', 'st-journal-store.patch');
const BS = String.fromCharCode(92);

const skip = (msg) => { console.log('SKIP ' + msg); process.exit(0); };
if (!fs.existsSync(patchPath)) skip('找不到 ' + patchPath);
if (!fs.existsSync(path.join(stDir, 'node_modules', 'express'))) skip('ST_DIR 下没有 node_modules/express：' + stDir);
if (!fs.existsSync(path.join(stDir, 'src', 'middleware', 'validateFileName.js'))) skip('ST_DIR 不像是酒馆根目录：' + stDir);

/** 从补丁里抽出新文件正文 */
function extractNewFile(patchText, filePath) {
    const lines = patchText.split('\n');
    const head = lines.findIndex(l => l.startsWith('diff --git a/' + filePath));
    if (head < 0) throw new Error('补丁里没有 ' + filePath);
    const body = [];
    let inHunk = false;
    for (let i = head + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('diff --git ')) break;
        if (line.startsWith('@@')) { inHunk = true; continue; }
        if (!inHunk) continue;
        if (!line.startsWith('+')) continue;
        body.push(line.slice(1));
    }
    return body.join('\n') + '\n';
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 're-patch-test-'));
const stubs = path.join(root, 'stubs');
fs.mkdirSync(path.join(stubs, 'endpoints'), { recursive: true });
fs.mkdirSync(path.join(stubs, 'middleware'), { recursive: true });
fs.mkdirSync(path.join(stubs, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(stubs, 'endpoints', 'role-expansion.js'), extractNewFile(fs.readFileSync(patchPath, 'utf8'), 'src/endpoints/role-expansion.js'));
fs.copyFileSync(path.join(stDir, 'src', 'middleware', 'validateFileName.js'), path.join(stubs, 'middleware', 'validateFileName.js'));
fs.writeFileSync(path.join(stubs, 'util.js'), 'import path from "node:path";\n'
    + 'export function isPathUnderParent(parentPath, childPath) {\n'
    + '    const n1 = path.normalize(parentPath);\n'
    + '    const n2 = path.normalize(childPath);\n'
    + '    const rel = path.relative(n1, n2);\n'
    + '    return rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);\n'
    + '}\n');
for (const pkg of ['express', 'sanitize-filename', 'write-file-atomic']) {
    const link = path.join(stubs, 'node_modules', pkg);
    if (!fs.existsSync(link)) fs.symlinkSync(path.join(stDir, 'node_modules', pkg), link, 'junction');
}

const express = (await import(pathToFileURL(path.join(stubs, 'node_modules', 'express', 'index.js')).href)).default;
const { router } = await import(pathToFileURL(path.join(stubs, 'endpoints', 'role-expansion.js')).href);

const CHATS = path.join(root, 'chats');
const CHAR = '樱井 奈奈';
const CHAR_DIR = path.join(CHATS, CHAR);
fs.mkdirSync(CHAR_DIR, { recursive: true });
const CHAT_FILE = CHAR + ' - 2026-01-01@00h00m00s000ms.jsonl';
fs.writeFileSync(path.join(CHAR_DIR, CHAT_FILE), '{"mes":"hi"}\n');

const app = express();
app.use(express.json({ limit: '64mb' }));
app.use((req, res, next) => { req.user = { directories: { chats: CHATS }, profile: { handle: 'default-user' } }; next(); });
app.use('/api/role-expansion', router);
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = 'http://127.0.0.1:' + server.address().port + '/api/role-expansion';
const FILE = 'RoleExpansion_journal_c_1a2b3c4d_j_5e6f7a8b.jsonl';
const expectFile = path.join(CHAR_DIR, '_RoleExpansion', 'journals', FILE);

const post = async (route, body) => {
    const r = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const raw = await r.text();
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { data = raw.slice(0, 60); }
    return { status: r.status, data };
};
const results = [];
const check = (name, cond, extra) => results.push([cond ? 'PASS' : 'FAIL', name, extra || '']);

const textBody = '{"__roleExpansion":"session"}\n{"__roleExpansion":"journal","content":"第一篇"}\n';
const s1 = await post('/journal/save', { avatar_url: CHAR + '.png', file_name: FILE, text: textBody });
check('save 写入成功', s1.status === 200 && s1.data && s1.data.ok === true, JSON.stringify(s1.data));
check('落点 = chats/<角色>/_RoleExpansion/journals/<名>', fs.existsSync(expectFile));
check('内容逐字一致', fs.readFileSync(expectFile, 'utf8') === textBody);
const dirFiles = fs.readdirSync(path.dirname(expectFile));
check('目录里只有目标文件（无 atomic 临时残留）', dirFiles.length === 1 && dirFiles[0] === FILE, dirFiles.join(','));
const g1 = await post('/journal/get', { avatar_url: CHAR + '.png', file_name: FILE });
check('get 读回一致', g1.status === 200 && g1.data.text === textBody && g1.data.exists === true);
const g2 = await post('/journal/get', { avatar_url: CHAR + '.png', file_name: 'RoleExpansion_journal_c_0_j_0.jsonl' });
check('get 不存在 → exists:false + 空串', g2.status === 200 && g2.data.exists === false && g2.data.text === '');

const bad = [
    ['file_name 带 /', { file_name: 'a/b.jsonl' }],
    ['file_name 穿越 ..', { file_name: '../evil.jsonl' }],
    ['file_name 反斜杠穿越', { file_name: '..' + BS + 'evil.jsonl' }],
    ['file_name 绝对路径', { file_name: '/evil.jsonl' }],
    ['file_name 非 .jsonl', { file_name: 'evil.txt' }],
    ['file_name 以点开头', { file_name: '.hidden.jsonl' }],
    ['file_name 中文', { file_name: '日记.jsonl' }],
    ['file_name 空', { file_name: '' }],
    ['file_name 过长', { file_name: 'a'.repeat(300) + '.jsonl' }],
    ['avatar_url 带 /', { avatar_url: 'a/b.png', file_name: FILE }],
    ['avatar_url 反斜杠', { avatar_url: 'a' + BS + 'b.png', file_name: FILE }],
    ['avatar_url 空', { avatar_url: '', file_name: FILE }],
    ['avatar_url 纯 .png', { avatar_url: '.png', file_name: FILE }],
];
for (const item of bad) {
    const body = Object.assign({ avatar_url: CHAR + '.png', file_name: FILE, text: 'x' }, item[1]);
    const r = await post('/journal/save', body);
    check('拒绝 ' + item[0], r.status === 400, 'status=' + r.status);
}
check('chats 下没有多出无关目录', fs.readdirSync(CHATS).join(',') === CHAR, fs.readdirSync(CHATS).join(','));
check('chats 根没有被写入', !fs.existsSync(path.join(CHATS, 'evil.jsonl')));
const t1 = await post('/journal/save', { avatar_url: CHAR + '.png', file_name: FILE, text: 123 });
check('text 非字符串 → 400', t1.status === 400, 'status=' + t1.status);

const dirents = fs.readdirSync(CHAR_DIR, { withFileTypes: true });
const searchFiles = fs.readdirSync(CHAR_DIR).filter(f => path.extname(f) === '.jsonl');
const charsChats = dirents.filter(e => e.isFile() && path.extname(e.name) === '.jsonl').map(e => e.name);
check('chats.js /search 看不到日记', searchFiles.length === 1 && searchFiles[0] === CHAT_FILE, searchFiles.join(','));
check('characters.js /chats 看不到日记', charsChats.length === 1 && charsChats[0] === CHAT_FILE, charsChats.join(','));

const NEW_DIR = path.join(CHATS, '樱井奈奈1');
fs.cpSync(CHAR_DIR, NEW_DIR, { recursive: true });
fs.rmSync(CHAR_DIR, { recursive: true, force: true });
check('角色目录改名搬迁后日记跟着走', fs.existsSync(path.join(NEW_DIR, '_RoleExpansion', 'journals', FILE)));
const s2 = await post('/journal/save', { avatar_url: '新角色.png', file_name: FILE, text: 'x\n' });
check('角色目录不存在时 save 自建并成功', s2.status === 200 && fs.existsSync(path.join(CHATS, '新角色', '_RoleExpansion', 'journals', FILE)));

server.close();
fs.rmSync(root, { recursive: true, force: true });
const fails = results.filter(r => r[0] === 'FAIL');
console.log(results.map(r => r[0] + '  ' + r[1] + (r[2] ? '   [' + r[2] + ']' : '')).join('\n'));
console.log('');
console.log('补丁端点自测：共 ' + results.length + ' 项，失败 ' + fails.length + ' 项');
process.exit(fails.length ? 1 : 0);

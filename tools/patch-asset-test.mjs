/**
 * 资源端点端到端自测（可选，需要本机有酒馆安装目录的 node_modules）
 *
 * 测的是 patches/st-twitter-assets.patch 引入的 /api/role-expansion/asset/{get,save,delete}：
 * 文本与 base64 图片的读写删、覆盖写、白名单与路径穿越拒绝、体积上限、
 * 酒馆自己的「列聊天」逻辑看不见这些文件、角色目录改名后整个 twitter/ 跟着走。
 *
 * 用法：node tools/patch-asset-test.mjs [ST_DIR]      （或 npm run test:patch 跑全部）
 *   ST_DIR 默认取环境变量 ST_DIR，再退到本机开发路径；缺失时打印 SKIP 并退出 0（CI 友好）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const stDir = process.argv[2] || process.env.ST_DIR || 'E:\\SillyTavern\\SillyTavern';
const BS = String.fromCharCode(92);
const results = [];
const check = (name, cond, extra) => results.push([cond ? 'PASS' : 'FAIL', name, extra || '']);

const skip = (msg) => { console.log('SKIP ' + msg); process.exit(0); };
const patchPath = path.join(repo, 'patches', 'st-twitter-assets.patch');
if (!fs.existsSync(patchPath)) skip('找不到 ' + patchPath);
if (!fs.existsSync(path.join(stDir, 'node_modules', 'express'))) skip('ST_DIR 下没有 node_modules/express：' + stDir);
if (!fs.existsSync(path.join(stDir, 'src', 'middleware', 'validateFileName.js'))) skip('ST_DIR 不像是酒馆根目录：' + stDir);

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 're-asset-'));
const stubs = path.join(root, 'stubs');
fs.mkdirSync(path.join(stubs, 'endpoints'), { recursive: true });
fs.mkdirSync(path.join(stubs, 'middleware'), { recursive: true });
fs.mkdirSync(path.join(stubs, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(stubs, 'endpoints', 'role-expansion-assets.js'), extractNewFile(fs.readFileSync(patchPath, 'utf8'), 'src/endpoints/role-expansion-assets.js'));
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
const { router } = await import(pathToFileURL(path.join(stubs, 'endpoints', 'role-expansion-assets.js')).href);

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
const DIR = path.join(CHAR_DIR, '_RoleExpansion', 'twitter');
const withAvatar = (body) => Object.assign({ avatar_url: CHAR + '.png', sub: 'twitter' }, body);
const post = async (route, body) => {
    const r = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const raw = await r.text();
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { data = raw.slice(0, 60); }
    return { status: r.status, data };
};

const JSONL = 'RoleExpansion_twitter_c_1a2b3c4d_j_5e6f7a8b.jsonl';
const body = '{"__roleExpansion":"twitter-session"}\n{"__roleExpansion":"twitter","content":"第一条"}\n';
const st1 = await post('/asset/save', withAvatar({ name: JSONL, text: body }));
check('save 文本成功', st1.status === 200 && st1.data.ok === true, JSON.stringify(st1.data));
check('文本落点 = _RoleExpansion/twitter/<名>', fs.existsSync(path.join(DIR, JSONL)));
check('文本逐字一致（不是 base64 存的）', fs.readFileSync(path.join(DIR, JSONL), 'utf8') === body);
const gt = await post('/asset/get', withAvatar({ name: JSONL }));
check('get 文本回读一致', gt.status === 200 && gt.data.exists === true && gt.data.text === body);
const gm = await post('/asset/get', withAvatar({ name: 'not-there.jsonl' }));
check('get 不存在的文件 → exists:false', gm.status === 200 && gm.data.exists === false);

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const pngPath = path.join(DIR, 'avatar.png');
const sb = await post('/asset/save', withAvatar({ name: 'avatar.png', base64: png.toString('base64') }));
check('save 图片（base64）成功', sb.status === 200 && sb.data.bytes === png.length, JSON.stringify(sb.data));
check('图片落盘字节一致', fs.existsSync(pngPath) && Buffer.compare(fs.readFileSync(pngPath), png) === 0);
const gb = await post('/asset/get', withAvatar({ name: 'avatar.png' }));
check('get 图片回 base64 + mime', gb.status === 200 && gb.data.base64 === png.toString('base64') && gb.data.mime === 'image/png');
const sd = await post('/asset/save', withAvatar({ name: 'banner.jpg', base64: 'data:image/jpeg;base64,' + png.toString('base64') }));
check('接受 data URL 前缀', sd.status === 200 && Buffer.compare(fs.readFileSync(path.join(DIR, 'banner.jpg')), png) === 0);
const gd = await post('/asset/get', withAvatar({ name: 'banner.jpg' }));
check('jpg 的 mime 正确', gd.status === 200 && gd.data.mime === 'image/jpeg');

const so = await post('/asset/save', withAvatar({ name: 'avatar.png', base64: Buffer.from([9, 9, 9]).toString('base64') }));
check('重复 save 覆盖旧文件', so.status === 200 && fs.readFileSync(pngPath).length === 3);

const d1 = await post('/asset/delete', withAvatar({ name: 'avatar.png' }));
check('delete 删掉文件', d1.status === 200 && d1.data.removed === true && !fs.existsSync(pngPath));
const d2 = await post('/asset/delete', withAvatar({ name: 'avatar.png' }));
check('再删一次 → removed:false（不报错）', d2.status === 200 && d2.data.removed === false);

const bad = [
    ['sub 不在白名单（journals）', { sub: 'journals', name: 'a.jsonl', text: 'x' }],
    ['sub 里带 ..', { sub: 'twitter' + BS + '..', name: 'a.jsonl', text: 'x' }],
    ['sub 为空', { sub: '', name: 'a.jsonl', text: 'x' }],
    ['name 带 /', { name: 'a/b.jsonl', text: 'x' }],
    ['name 穿越 ..', { name: '../evil.jsonl', text: 'x' }],
    ['name 反斜杠穿越', { name: '..' + BS + 'evil.jsonl', text: 'x' }],
    ['name 以点开头', { name: '.hidden.jsonl', text: 'x' }],
    ['name 中文', { name: '头像.png', text: 'x' }],
    ['name 空', { name: '', text: 'x' }],
    ['后缀不在白名单（.txt）', { name: 'a.txt', text: 'x' }],
    ['后缀不在白名单（.exe）', { name: 'a.exe', base64: 'AAAA' }],
    ['后缀不在白名单（.json）', { name: 'a.json', text: 'x' }],
    ['没有 text 也没有 base64', { name: 'a.jsonl' }],
    ['base64 里有非法字符', { name: 'a.png', base64: '!!!!' }],
    ['base64 解出来是空', { name: 'a.png', base64: '' }],
    ['binary 超限（8MB+）', { name: 'a.png', base64: Buffer.alloc(8 * 1024 * 1024 + 16).toString('base64') }],
    ['avatar_url 带 /', { avatar_url: 'a/b.png', name: 'a.jsonl', text: 'x' }],
    ['avatar_url 空', { avatar_url: '', name: 'a.jsonl', text: 'x' }],
];
for (const item of bad) {
    const r = await post('/asset/save', Object.assign({ avatar_url: CHAR + '.png', sub: 'twitter' }, item[1]));
    check('拒绝 ' + item[0], r.status === 400 || r.status === 413, 'status=' + r.status);
}
check('拒绝项没有写出任何文件', fs.readdirSync(DIR).sort().join(',') === JSONL + ',banner.jpg', fs.readdirSync(DIR).join(','));
check('chats 下没有多出无关目录', fs.readdirSync(CHATS).join(',') === CHAR, fs.readdirSync(CHATS).join(','));
check('没有写到 _RoleExpansion 根上', !fs.existsSync(path.join(CHAR_DIR, '_RoleExpansion', 'evil.jsonl')));

const searchFiles = fs.readdirSync(CHAR_DIR).filter(f => path.extname(f) === '.jsonl');
check('酒馆列聊天逻辑只看到会话文件', searchFiles.length === 1 && searchFiles[0] === CHAT_FILE, searchFiles.join(','));

const NEW_DIR = path.join(CHATS, '樱井奈奈1');
fs.cpSync(CHAR_DIR, NEW_DIR, { recursive: true });
fs.rmSync(CHAR_DIR, { recursive: true, force: true });
check('角色目录改名后 twitter/ 整个跟着走', fs.existsSync(path.join(NEW_DIR, '_RoleExpansion', 'twitter', 'banner.jpg')));

server.close();
fs.rmSync(root, { recursive: true, force: true });
const fails = results.filter(r => r[0] === 'FAIL');
console.log(results.map(r => r[0] + '  ' + r[1] + (r[2] ? '   [' + r[2] + ']' : '')).join('\n'));
console.log('');
console.log('资源端点自测：共 ' + results.length + ' 项，失败 ' + fails.length + ' 项');
process.exit(fails.length ? 1 : 0);

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createStorage } from './storage.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ['/', ['web/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['web/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['web/style.css', 'text/css; charset=utf-8']],
  ['/path-editor.js', ['web/path-editor.js', 'text/javascript; charset=utf-8']],
  ['/bezier-editor.js', ['web/bezier-editor.js', 'text/javascript; charset=utf-8']],
  ['/compare.js', ['web/compare.js', 'text/javascript; charset=utf-8']],
  ...['effect-controls.js','i18n.js','locale-ko.js','wave-stream.js','mp4box.all.mjs','rolldown-runtime-w6R9maHv.mjs','styp-9TIZZDLN.mjs'].map(name=>[`/${name}`,[`web/${name}`,'text/javascript; charset=utf-8']]),
  ...['ytt-document.js', 'ytt-preserve.js', 'ytt-export.js', 'ytt-merge.js', 'ytt-style-edit.js', 'ytt-preview.js', 'subtitle-import.js', 'effects.js', 'animated-ytt.js', 'project.js', 'unit-effects.js', 'unit-layout.js', 'presets.js', 'timeline.js', 'history.js', 'ass-style.js']
    .map(name => [`/src/${name}`, [`src/${name}`, 'text/javascript; charset=utf-8']]),
]);

export function makeServer({dataDir = process.env.YTT_EDITOR_DATA_DIR || join(root, 'data')} = {}) {
  const storage=createStorage(dataDir);
  return createServer(async (req, res) => {
    const host = req.headers.host ?? '';
    if (!/^127\.0\.0\.1:\d+$/.test(host)) {
      res.writeHead(403).end(); return;
    }
    let path;
    try { path = new URL(req.url, `http://${host}`).pathname; } catch { res.writeHead(400).end(); return; }
    if (path === '/api/recovery' || path === '/api/presets' || path === '/api/settings') {
      const kind=path.slice('/api/'.length);
      if (req.method === 'GET') {
        if (req.headers.origin && req.headers.origin !== `http://${host}`) { res.writeHead(403).end(); return; }
        try { const data = kind==='settings' ? JSON.stringify(await storage.settings()) : await storage.read(kind); res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(data); }
        catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500).end(); }
        return;
      }
      if (req.method !== 'PUT' || req.headers.origin !== `http://${host}` || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) { res.writeHead(403).end(); return; }
      try {
        const chunks=[]; let bytes=0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 16*1024*1024) { res.writeHead(413).end(); return; } chunks.push(chunk); }
        const text=Buffer.concat(chunks).toString('utf8');
        const data=JSON.parse(text);
        const valid = kind==='settings' ? typeof data?.directory === 'string' : kind==='recovery' ? data?.format === 'ytt-editor-project' && data.version === 1 && Array.isArray(data.tracks) : data?.format === 'ytt-editor-presets' && data.version === 1 && Array.isArray(data.presets);
        if (!valid) { res.writeHead(400).end(); return; }
        if (kind==='settings') {
          const settings=await storage.changeDirectory(data.directory);
          res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(settings));
        } else { await storage.write(kind,text); res.writeHead(204,{'Cache-Control':'no-store'}).end(); }
      } catch(error) {
        const status=error.code==='DEST_EXISTS' || error.code==='EEXIST' ? 409 : error.code==='INVALID_PATH' ? 400 : 500;
        res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify({error:status===409 ? '대상 폴더에 기존 데이터가 있거나 복사 중 충돌했습니다. 기존 파일을 확인하세요.' : status===400 ? '절대 경로를 입력하세요.' : '저장 위치를 읽거나 쓸 수 없습니다. 원본 데이터는 유지됩니다.'}));
      }
      return;
    }
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(403).end(); return; }
    const file = files.get(path);
    if (!file) { res.writeHead(404).end(); return; }
    try {
      const data = await readFile(join(root, file[0]));
      res.writeHead(200, {'Content-Type': file[1], 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; media-src 'self' blob:; img-src 'self' blob:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(500).end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = makeServer();
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log(`YTT 편집기: ${url}\n종료하려면 이 창에서 Ctrl+C를 누르세요.`);
    const candidates = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).map(dir => join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    const chrome = candidates.find(existsSync);
    if (chrome) { const child = spawn(chrome, [url], {detached: true, stdio: 'ignore'}); child.unref(); }
    else console.log('Chrome을 찾을 수 없습니다. 위 주소를 Chrome에서 직접 여세요.');
  });
}

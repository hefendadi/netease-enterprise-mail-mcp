// Targeted offline regressions, not a general IMAP protocol mock or live UAT.
import './network-guard.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { UniversalEmailMCPServer } from '../index.js';

const CONTENT = 'FICTIONAL OFFLINE ATTACHMENT';
const DIGEST = crypto.createHash('sha256').update(CONTENT).digest('hex');
function attachmentMailbox(filename = 'sample.txt') {
  const imap = new EventEmitter();
  imap.openBox = (folder, readOnly, cb) => {
    assert.equal(readOnly, true);
    cb(null, { uidvalidity: 7, messages: { total: 1 } });
  };
  imap.fetch = (uids, options) => {
    const fetch = new EventEmitter();
    queueMicrotask(() => {
      const msg = new EventEmitter(); fetch.emit('message', msg);
      msg.emit('attributes', { size: 1024, uid: 12345 });
      const stream = new PassThrough(); msg.emit('body', stream);
      const mime = [
        'From: sender@example.com', 'To: reader@example.com', 'Subject: Fictional fixture',
        'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="offline-boundary"', '',
        '--offline-boundary', 'Content-Type: text/plain', '', 'Fictional body',
        '--offline-boundary', 'Content-Type: text/plain',
        `Content-Disposition: attachment; filename="${filename}"`,
        'Content-Transfer-Encoding: base64', '', Buffer.from(CONTENT).toString('base64'),
        '--offline-boundary--', '',
      ].join('\r\n');
      stream.end(options.bodies === '' ? mime : 'Subject: Fictional fixture\r\n');
      msg.emit('end');
      queueMicrotask(() => fetch.emit('end'));
    });
    return fetch;
  };
  return imap;
}
function download(filename = 'sample.txt') {
  const server = new UniversalEmailMCPServer();
  server.withIMAP = fn => Promise.resolve().then(() => fn(attachmentMailbox(filename)));
  return server.getEmailAttachment({ uid: '12345', folder: 'INBOX', attachmentIndex: 1 });
}
function saved(result) {
  const text = result.content[0].text;
  assert.match(text, /✅ 附件已保存/);
  assert.match(text, new RegExp(`SHA256: ${DIGEST}`));
  const target = text.match(/保存路径: (.+)/)[1];
  assert.equal(fs.readFileSync(target, 'utf8'), CONTENT);
  assert.equal(fs.readFileSync(target + '.sha256', 'utf8'), `${DIGEST}  ${path.basename(target)}\n`);
  assert.equal(fs.lstatSync(target).mode & 0o777, 0o600);
  assert.equal(fs.lstatSync(target + '.sha256').mode & 0o777, 0o600);
  return target;
}
function failed(result) {
  assert.doesNotMatch(result.content[0].text, /✅ 附件已保存/);
  assert.match(result.content[0].text, /❌/);
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'netease-blocker-regression-'));
  const dir = path.join(root, 'attachments');
  fs.mkdirSync(dir, { mode: 0o700 });
  const prior = process.env.EMAIL_ATTACHMENT_DIR;
  process.env.EMAIL_ATTACHMENT_DIR = dir;
  t.after(() => {
    if (prior === undefined) delete process.env.EMAIL_ATTACHMENT_DIR;
    else process.env.EMAIL_ATTACHMENT_DIR = prior;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, dir };
}

// Child processes cross a shared start barrier before downloading the same name.
if (process.argv[2] === '--attachment-worker') {
  process.send({ ready: true });
  process.once('message', async () => {
    try { process.send({ result: await download() }); process.disconnect(); }
    catch (error) { process.send({ error: error.message }); process.disconnect(); process.exitCode = 1; }
  });
} else {
  test('normal attachment and checksum are complete, consistent and private', async t => {
    const { dir } = fixture(t);
    fs.chmodSync(dir, 0o755);
    const target = saved(await download());
    assert.equal(path.dirname(target), dir);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  });
  test('dangling attachment symlink is not followed or removed', async t => {
    const { root, dir } = fixture(t);
    const outside = path.join(root, 'outside.txt');
    const link = path.join(dir, 'sample.txt');
    fs.symlinkSync(outside, link);
    const target = saved(await download());
    assert.notEqual(target, link);
    assert.equal(fs.existsSync(outside), false);
    assert.equal(fs.readlinkSync(link), outside);
  });
  test('existing attachment is preserved and a numbered name is allocated', async t => {
    const { dir } = fixture(t);
    const existing = path.join(dir, 'sample.txt');
    fs.writeFileSync(existing, 'ORIGINAL FICTIONAL CONTENT', { mode: 0o644 });
    assert.notEqual(saved(await download()), existing);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'ORIGINAL FICTIONAL CONTENT');
    assert.equal(fs.statSync(existing).mode & 0o777, 0o644);
  });
  test('existing checksum is preserved and the new pair uses another name', async t => {
    const { dir } = fixture(t);
    const sidecar = path.join(dir, 'sample.txt.sha256');
    fs.writeFileSync(sidecar, 'ORIGINAL CHECKSUM', { mode: 0o644 });
    assert.notEqual(saved(await download()), path.join(dir, 'sample.txt'));
    assert.equal(fs.existsSync(path.join(dir, 'sample.txt')), false);
    assert.equal(fs.readFileSync(sidecar, 'utf8'), 'ORIGINAL CHECKSUM');
    assert.equal(fs.statSync(sidecar).mode & 0o777, 0o644);
  });
  test('checksum symlink never overwrites or changes the linked file', async t => {
    const { root, dir } = fixture(t);
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'ORIGINAL', { mode: 0o644 });
    const link = path.join(dir, 'sample.txt.sha256'); fs.symlinkSync(outside, link);
    saved(await download());
    assert.equal(fs.readFileSync(outside, 'utf8'), 'ORIGINAL');
    assert.equal(fs.statSync(outside).mode & 0o777, 0o644);
    assert.equal(fs.readlinkSync(link), outside);
  });
  test('a symlink leaf directory is rejected without fallback writes', async t => {
    const { root, dir } = fixture(t);
    const linked = path.join(root, 'linked'); fs.symlinkSync(dir, linked);
    process.env.EMAIL_ATTACHMENT_DIR = linked;
    failed(await download());
    assert.deepEqual(fs.readdirSync(dir), []);
  });
  test('a symlink parent directory is rejected', async t => {
    const { root, dir } = fixture(t);
    const linked = path.join(root, 'linked'); fs.symlinkSync(root, linked);
    process.env.EMAIL_ATTACHMENT_DIR = path.join(linked, 'attachments');
    failed(await download());
    assert.deepEqual(fs.readdirSync(dir), []);
  });
  test('an untrusted writable parent is rejected', async t => {
    const { root, dir } = fixture(t);
    fs.chmodSync(root, 0o777);
    failed(await download());
    assert.deepEqual(fs.readdirSync(dir), []);
    fs.chmodSync(root, 0o700);
  });
  test('new nested private directories are created safely', async t => {
    const { root } = fixture(t);
    const parent = path.join(root, 'new');
    process.env.EMAIL_ATTACHMENT_DIR = path.join(parent, 'nested');
    saved(await download());
    assert.equal(fs.statSync(parent).mode & 0o777, 0o700);
    assert.equal(fs.statSync(process.env.EMAIL_ATTACHMENT_DIR).mode & 0o777, 0o700);
  });
  test('a cached directory path cannot hide later symlink replacement', async t => {
    const { root, dir } = fixture(t);
    saved(await download());
    const moved = path.join(root, 'moved'); fs.renameSync(dir, moved);
    const outside = path.join(root, 'outside'); fs.mkdirSync(outside, { mode: 0o700 });
    fs.symlinkSync(outside, dir);
    failed(await download());
    assert.deepEqual(fs.readdirSync(outside), []);
  });
  test('same-name downloads allocate distinct complete file pairs', async t => {
    fixture(t);
    const first = saved(await download()), second = saved(await download());
    assert.notEqual(first, second);
  });
  test('concurrent processes cannot overwrite the same attachment/checksum', async t => {
    const { dir } = fixture(t);
    const children = [];
    t.after(() => { for (const child of children) if (child.exitCode === null) child.kill(); });
    const guard = fileURLToPath(new URL('./network-guard.mjs', import.meta.url));
    const makeWorker = () => {
      let release;
      const ready = new Promise(resolve => { release = resolve; });
      const result = new Promise((resolve, reject) => {
        const child = fork(fileURLToPath(import.meta.url), ['--attachment-worker'], {
          execArgv: ['--import', guard],
          env: { PATH: process.env.PATH, EMAIL_ATTACHMENT_DIR: dir, EMAIL_USER: 'reader@example.com', EMAIL_PASSWORD: 'fictional-offline-value', EMAIL_TYPE: 'netease-enterprise' },
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        children.push(child);
        let received, stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.stdout.on('data', chunk => reject(new Error('unexpected worker stdout: ' + chunk)));
        child.on('message', msg => { if (msg.ready) release(child); else if (msg.result) received = msg.result; else reject(new Error(msg.error)); });
        child.on('error', reject);
        child.on('exit', code => { if (code === 0 && received) resolve(received); else reject(new Error(`worker exit ${code}: ${stderr}`)); });
      });
      return { ready, result };
    };
    const workers = [makeWorker(), makeWorker(), makeWorker(), makeWorker()];
    const all = await Promise.all(workers.map(w => w.ready));
    for (const child of all) child.send({ go: true });
    const paths = (await Promise.all(workers.map(w => w.result))).map(saved);
    assert.equal(new Set(paths).size, 4);
    assert.equal(fs.readdirSync(dir).length, 8);
  });
  for (const [label, method, inject] of [
    ['main write', 'writeFileSync', (args, count) => typeof args[0] === 'number' && count === 1],
    ['checksum write', 'writeFileSync', (args, count) => typeof args[0] === 'number' && count === 2],
    ['file fsync', 'fsyncSync', () => true],
    ['file permissions', 'fchmodSync', args => args[1] === 0o600],
  ]) {
    test(`${label} failure never reports success and cleans only the created pair`, async t => {
      const { dir } = fixture(t);
      const existing = path.join(dir, 'existing.txt'); fs.writeFileSync(existing, 'KEEP ORIGINAL');
      const original = fs[method]; let count = 0;
      t.mock.method(fs, method, (...args) => {
        if (typeof args[0] === 'number') count++;
        if (inject(args, count)) throw Object.assign(new Error('FICTIONAL INJECTED WRITE FAILURE'), { code: 'EIO' });
        return original(...args);
      });
      failed(await download());
      assert.deepEqual(fs.readdirSync(dir), ['existing.txt']);
      assert.equal(fs.readFileSync(existing, 'utf8'), 'KEEP ORIGINAL');
    });
  }
  test('checksum reservation failure removes only our new main file', async t => {
    const { dir } = fixture(t);
    const keep = path.join(dir, 'keep.txt'); fs.writeFileSync(keep, 'KEEP');
    const original = fs.openSync;
    t.mock.method(fs, 'openSync', (...args) => {
      if (String(args[0]).endsWith('.sha256')) throw Object.assign(new Error('FICTIONAL PERMISSION DENIED'), { code: 'EACCES' });
      return original(...args);
    });
    failed(await download());
    assert.deepEqual(fs.readdirSync(dir), ['keep.txt']);
  });
  test('close failure is reported as failure and created files are cleaned', async t => {
    const { dir } = fixture(t);
    const original = fs.closeSync; let injected = false;
    t.mock.method(fs, 'closeSync', fd => {
      const file = fs.fstatSync(fd).isFile();
      original(fd);
      if (file && !injected) { injected = true; throw new Error('FICTIONAL CLOSE FAILURE'); }
    });
    failed(await download());
    assert.deepEqual(fs.readdirSync(dir), []);
  });
  test('cleanup does not delete a replacement file created by another actor', async t => {
    const { dir } = fixture(t);
    const original = fs.writeFileSync; let injected = false;
    const target = path.join(dir, 'sample.txt');
    t.mock.method(fs, 'writeFileSync', (...args) => {
      if (typeof args[0] === 'number' && !injected) {
        injected = true; fs.unlinkSync(target); original(target, 'REPLACEMENT MUST SURVIVE');
        throw new Error('FICTIONAL FAILURE AFTER PATH REPLACEMENT');
      }
      return original(...args);
    });
    failed(await download());
    assert.equal(fs.readFileSync(target, 'utf8'), 'REPLACEMENT MUST SURVIVE');
    assert.deepEqual(fs.readdirSync(dir), ['sample.txt']);
  });
  test('cleanup failure remains an explicit error and never deletes preexisting files', async t => {
    const { dir } = fixture(t);
    const keep = path.join(dir, 'keep.txt'); fs.writeFileSync(keep, 'KEEP');
    t.mock.method(fs, 'writeFileSync', (...args) => { throw new Error('FICTIONAL WRITE FAILURE'); });
    t.mock.method(fs, 'unlinkSync', () => { throw new Error('FICTIONAL CLEANUP FAILURE'); });
    const result = await download(); failed(result);
    assert.match(result.content[0].text, /清理未完成/);
    assert.equal(fs.readFileSync(keep, 'utf8'), 'KEEP');
  });

  function searchServer(mode = 'normal', subjects = ['Project update'], folderFailure = false) {
    const server = new UniversalEmailMCPServer();
    let mailbox, pendingStream;
    server.withIMAP = fn => {
      const imap = new EventEmitter(); mailbox = imap;
      // Same error listener responsibility as the real connection wrapper.
      imap.on('error', () => {});
      imap.openBox = (folder, readOnly, cb) => { assert.equal(readOnly, true); cb(null, { uidvalidity: 7, messages: { total: subjects.length } }); };
      imap.search = (criteria, cb) => {
        if (mode === 'search-timeout') return;
        if (mode === 'all-error' || (mode === 'fallback-all-error')) return cb(new Error('FICTIONAL SEARCH FAILURE'));
        if (mode === 'since-error' && criteria[0][0] === 'SINCE') return cb(new Error('FICTIONAL SINCE FAILURE'));
        cb(null, subjects.map((_, index) => index + 1));
      };
      imap.getBoxes = cb => {
        if (mode === 'folders-timeout') return;
        if (folderFailure) return cb(new Error('FICTIONAL FOLDER FAILURE'));
        cb(null, { INBOX: {}, Other: {} });
      };
      imap.fetch = uids => {
        const fetch = new EventEmitter();
        queueMicrotask(() => {
          if (mode === 'empty-error') { fetch.emit('error', new Error('')); return; }
          if (mode === 'fetch-error') { fetch.emit('error', new Error('FICTIONAL HEADER FAILURE')); fetch.emit('end'); return; }
          if (mode === 'fetch-throw') return; // handled by synchronous branch below
          if (mode === 'disconnect') return imap.emit('close');
          if (mode === 'fetch-close') return fetch.emit('close');
          if (mode === 'missing-message') return fetch.emit('end');
          for (const uid of uids) {
            const msg = new EventEmitter(); fetch.emit('message', msg);
            if (mode !== 'missing-attributes') msg.emit('attributes', { uid });
            if (mode === 'message-error') { msg.emit('error', new Error('FICTIONAL MESSAGE FAILURE')); return; }
            const stream = new PassThrough(); msg.emit('body', stream);
            if (mode === 'stream-error') { stream.destroy(new Error('FICTIONAL STREAM FAILURE')); fetch.emit('end'); return; }
            if (mode === 'stream-close') { stream.destroy(); fetch.emit('end'); return; }
            if (mode === 'unfinished-stream') { msg.emit('end'); fetch.emit('end'); return; }
            if (mode === 'late-body') {
              pendingStream = stream;
              msg.emit('end'); fetch.emit('end'); return;
            }
            if (mode === 'mid-fetch-error') stream.once('end', () => fetch.emit('error', new Error('FICTIONAL PARTIAL FETCH FAILURE')));
            stream.end(`Subject: ${subjects[uid - 1]}\r\nFrom: sender@example.com\r\nDate: ${uid === 1 ? 'Mon, 12 Oct 2026 09:00:00 +0800' : 'Mon, 12 Oct 2026 10:00:00 +0800'}\r\n\r\n`);
            if (mode !== 'missing-message-end') msg.emit('end');
            if (mode === 'mid-fetch-error') return;
          }
          fetch.emit('end');
        });
        if (mode === 'fetch-throw') throw new Error('FICTIONAL FETCH THROW');
        return fetch;
      };
      return Promise.resolve(fn(imap));
    };
    return { server, mailbox: () => mailbox, releaseBody: () => pendingStream.end('Subject: Project update\r\nFrom: sender@example.com\r\n\r\n') };
  }
  function searchText(result) { return result.content[0].text; }
  function incomplete(result) {
    const text = searchText(result);
    assert.doesNotMatch(text, /完整（已扫描全部候选）|已完整扫描，但确实没有匹配/);
    assert.match(text, /失败|部分|中断|超时/);
  }
  async function timeoutResult(server, args) {
    const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
    let last;
    globalThis.setTimeout = (callback, milliseconds) => { assert.equal(milliseconds, 30000); last = callback; return {}; };
    globalThis.clearTimeout = () => {};
    try {
      const result = server.searchEmails(args);
      await new Promise(resolve => queueMicrotask(resolve));
      assert.ok(last, 'scan/discovery must arm a timeout');
      last();
      return await result;
    } finally { globalThis.setTimeout = set; globalThis.clearTimeout = clear; }
  }
  test('normal subject scan waits for streams and keeps descending date order', async () => {
    const { server } = searchServer('normal', ['Project update one', 'Project update two']);
    const text = searchText(await server.searchEmails({ query: 'project update', from: 'sender', days: 7 }));
    assert.match(text, /完整（已扫描全部候选）/);
    assert.match(text, /扫描邮件头: 2 封/);
    assert.ok(text.indexOf('Project update two') < text.indexOf('Project update one'));
  });
  test('attributes and fetch end do not complete a still-unread header stream', async () => {
    const { server, releaseBody } = searchServer('late-body');
    let resolved = false;
    const result = server.searchEmails({ query: 'project' }).then(value => { resolved = true; return value; });
    await new Promise(resolve => queueMicrotask(resolve));
    assert.equal(resolved, false);
    releaseBody();
    const text = searchText(await result);
    assert.match(text, /完整（已扫描全部候选）/);
    assert.match(text, /Project update/);
  });
  test('a failure after one fully read header preserves the hit as partial', async () => {
    const { server } = searchServer('mid-fetch-error', ['Project update', 'Other']);
    const result = await server.searchEmails({ query: 'project' });
    incomplete(result);
    assert.match(searchText(result), /部分/);
    assert.match(searchText(result), /扫描邮件头: 1 封/);
    assert.match(searchText(result), /Project update/);
  });
  test('the existing 1000-header scan cap remains partial', async () => {
    const { server } = searchServer('normal', Array(1001).fill('Project update'));
    const result = await server.searchEmails({ query: 'project', limit: 1 });
    incomplete(result);
    assert.match(searchText(result), /扫描邮件头: 1000 封/);
  });
  test('a genuinely empty candidate range is complete', async () => {
    const { server } = searchServer('normal', []);
    const text = searchText(await server.searchEmails({ query: 'absent', days: 0 }));
    assert.match(text, /已完整扫描，但确实没有匹配/);
  });
  test('a fully scanned range with no subject matches is complete', async () => {
    const { server } = searchServer('normal', ['Meeting notification']);
    const text = searchText(await server.searchEmails({ query: 'absent' }));
    assert.match(text, /扫描邮件头: 1 封/);
    assert.match(text, /已完整扫描，但确实没有匹配/);
  });
  for (const mode of ['empty-error', 'fetch-error', 'all-error', 'fallback-all-error', 'disconnect', 'fetch-close', 'stream-error', 'stream-close', 'message-error', 'missing-message', 'missing-attributes', 'fetch-throw']) {
    test(`${mode} cannot become a complete/empty search`, async () => {
      const { server } = searchServer(mode);
      incomplete(await server.searchEmails({ query: 'project', days: mode === 'all-error' ? 0 : 7 }));
    });
  }
  test('a SINCE error remains incomplete even if ALL fallback succeeds', async () => {
    const { server } = searchServer('since-error');
    const result = await server.searchEmails({ query: 'project' });
    incomplete(result);
    assert.match(searchText(result), /SINCE/);
    assert.match(searchText(result), /Project update/);
  });
  for (const mode of ['search-timeout', 'unfinished-stream', 'missing-message-end', 'folders-timeout']) {
    test(`${mode} terminates with a timeout rather than complete`, async () => {
      const { server } = searchServer(mode);
      const result = await timeoutResult(server, { query: 'project', folder: mode === 'folders-timeout' ? 'ALL' : 'INBOX' });
      incomplete(result);
      assert.match(searchText(result), /超时/);
    });
  }
  test('successful folders plus a failed folder return partial and preserve good hits', async () => {
    const { server } = searchServer();
    const real = server.scanFolderHeaders.bind(server);
    server.scanFolderHeaders = args => args.folder === 'Other' ? Promise.reject(new Error('FICTIONAL OTHER FAILURE')) : real(args);
    const result = await server.searchEmails({ query: 'project', folder: 'ALL' });
    incomplete(result);
    assert.match(searchText(result), /部分/);
    assert.match(searchText(result), /Project update/);
  });
  test('folder discovery errors cannot become a complete/empty search', async () => {
    const { server } = searchServer('normal', ['Project update'], true);
    incomplete(await server.searchEmails({ folder: 'ALL' }));
  });
}

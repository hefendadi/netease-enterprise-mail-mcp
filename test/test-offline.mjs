// Dispatch and startup tests only; no live mailbox or MIME end-to-end coverage.
import './network-guard.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { UniversalEmailMCPServer } from '../index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const guard = fileURLToPath(new URL('./network-guard.mjs', import.meta.url));
const args = ['--import', guard];
const env = {
  PATH: process.env.PATH,
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  EMAIL_USER: 'reader@example.com',
  EMAIL_PASSWORD: 'fictional-offline-value',
  EMAIL_TYPE: 'netease-enterprise',
  ENABLE_WRITE_TOOLS: 'false',
};
let checks = 0;
function ok(label, test) {
  test();
  checks++;
  console.log(`PASS ${label}`);
}
const server = new UniversalEmailMCPServer();
const handlers = server.server._requestHandlers;
const extra = { signal: new AbortController().signal, sendNotification: async () => {}, sendRequest: async () => {} };
const invoke = (name, value) => handlers.get('tools/call')({ method: 'tools/call', params: { name, arguments: value } }, extra);
const list = () => handlers.get('tools/list')({ method: 'tools/list', params: {} }, extra);
const routes = {
  search_emails: 'searchEmails', get_email_content: 'getEmailContent',
  get_email_attachment: 'getEmailAttachment', get_recent_emails: 'getRecentEmails',
  list_folders: 'listFolders', list_supported_providers: 'listSupportedProviders',
  test_email_connection: 'testConnection', send_email: 'sendEmail',
  setup_email_account: 'setupEmailAccount', configure_email_server: 'configureEmailServer',
};
const write = ['send_email', 'setup_email_account', 'configure_email_server'];
const read = Object.keys(routes).filter(n => !write.includes(n));
const previous = process.env.ENABLE_WRITE_TOOLS;
try {
  delete process.env.ENABLE_WRITE_TOOLS;
  const listed = (await list()).tools;
  ok('default tools are exactly the seven existing read tools', () => assert.deepEqual(listed.map(t => t.name).sort(), [...read].sort()));
  for (const tool of listed) {
    ok(`${tool.name} schema has valid required property references`, () => {
      assert.equal(tool.inputSchema.type, 'object');
      for (const key of tool.inputSchema.required || []) assert.ok(key in tool.inputSchema.properties);
    });
  }
  ok('attachment schema matches integer index validation', () => {
    const schema = listed.find(t => t.name === 'get_email_attachment').inputSchema;
    assert.equal(schema.properties.attachmentIndex.type, 'integer');
    assert.equal(schema.properties.attachmentIndex.minimum, 1);
  });
  const sample = { uid: '12345', folder: 'INBOX', query: 'project update', attachmentIndex: 1 };
  for (const [name, method] of Object.entries(routes)) {
    server[method] = async value => {
      assert.deepEqual(value, sample);
      return { content: [{ type: 'text', text: `STUB:${name}` }] };
    };
  }
  for (const name of read) {
    const result = await invoke(name, sample);
    ok(`${name} dispatch and argument passthrough`, () => assert.equal(result.content[0].text, `STUB:${name}`));
  }
  for (const name of write) {
    const result = await invoke(name, sample);
    ok(`${name} is blocked before implementation`, () => assert.match(result.content[0].text, /已被安全策略禁用/));
  }
  process.env.ENABLE_WRITE_TOOLS = 'true';
  const enabled = (await list()).tools;
  ok('server configuration schema allows partial updates as implemented', () => {
    assert.deepEqual(enabled.find(t => t.name === 'configure_email_server').inputSchema.required, []);
  });
  ok('opt-in tool list is exactly the ten existing tools', () => assert.deepEqual(enabled.map(t => t.name).sort(), Object.keys(routes).sort()));
  for (const tool of enabled.filter(t => write.includes(t.name))) {
    ok(`${tool.name} schema required references`, () => {
      for (const key of tool.inputSchema.required || []) assert.ok(key in tool.inputSchema.properties);
    });
    const result = await invoke(tool.name, sample);
    ok(`${tool.name} opt-in stub dispatch`, () => assert.equal(result.content[0].text, `STUB:${tool.name}`));
  }
  const unknown = await invoke('nonexistent_tool', {});
  ok('unknown tool is handled', () => assert.match(unknown.content[0].text, /未知的工具/));
} finally {
  if (previous === undefined) delete process.env.ENABLE_WRITE_TOOLS;
  else process.env.ENABLE_WRITE_TOOLS = previous;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netease-mail-mcp-offline-'));
try {
  const imported = spawnSync(process.execPath, [...args, '--input-type=module', '-e',
    `await import(${JSON.stringify(pathToFileURL(path.join(root, 'index.js')).href)}); console.log('IMPORT_ONLY');`],
    { cwd: tmp, env, encoding: 'utf8', timeout: 5000 });
  ok('import does not start stdio service or log dotenv to stdout', () => {
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, 'IMPORT_ONLY\n');
    assert.doesNotMatch(imported.stderr, /MCP服务器已启动/);
  });

  const fixture = path.join(tmp, 'fixture with spaces');
  fs.mkdirSync(fixture);
  fs.copyFileSync(path.join(root, 'index.js'), path.join(fixture, 'index.js'));
  fs.writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(fixture, '.env'), 'EMAIL_USER=fixture@example.com\nEMAIL_TYPE=netease-enterprise\n');
  const fixtureEnv = { ...env };
  delete fixtureEnv.EMAIL_USER;
  const command = `await import(${JSON.stringify(pathToFileURL(path.join(fixture, 'index.js')).href)}); console.log(process.env.EMAIL_USER);`;
  const dotenv = spawnSync(process.execPath, [...args, '--input-type=module', '-e', command], { cwd: tmp, env: fixtureEnv, encoding: 'utf8', timeout: 5000 });
  ok('.env beside entrypoint loads from another working directory', () => {
    assert.equal(dotenv.status, 0, dotenv.stderr);
    assert.equal(dotenv.stdout, 'fixture@example.com\n');
  });
  const precedence = spawnSync(process.execPath, [...args, '--input-type=module', '-e', command], { cwd: tmp, env, encoding: 'utf8', timeout: 5000 });
  ok('process environment takes precedence over .env', () => {
    assert.equal(precedence.status, 0, precedence.stderr);
    assert.equal(precedence.stdout, 'reader@example.com\n');
  });

  const noisy = spawnSync(process.execPath, [...args, '--input-type=module', '-e', command], { cwd: tmp, env: { ...env, DOTENV_CONFIG_DEBUG: 'true', DOTENV_CONFIG_QUIET: 'false' }, encoding: 'utf8', timeout: 5000 });
  ok('dotenv debug flags cannot pollute protocol stdout', () => {
    assert.equal(noisy.status, 0, noisy.stderr);
    assert.equal(noisy.stdout, 'reader@example.com\n');
  });

  const configCommand = `const { UniversalEmailMCPServer } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'index.js')).href)}); const server = new UniversalEmailMCPServer(); const imap = server.createIMAPConnection()._config; const smtp = server.createSMTPTransporter().options; console.log(JSON.stringify({host:imap.host, port:imap.port, tls:imap.tls, verify:imap.tlsOptions.rejectUnauthorized, smtpSecure:smtp.secure}));`;
  for (const [label, settings, expected] of [
    ['default NetEase IMAP TLS configuration', {}, { host: 'imaphz.qiye.163.com', port: 993, tls: true, verify: true, smtpSecure: true }],
    ['manual IMAP host retains TLS verification', { EMAIL_IMAP_HOST: 'imap.example.com', EMAIL_IMAP_PORT: '993' }, { host: 'imap.example.com', port: 993, tls: true, verify: true, smtpSecure: true }],
    ['existing IMAP switches can disable TLS protection', { EMAIL_IMAP_SECURE: 'false', IMAP_TLS_REJECT_UNAUTHORIZED: 'false', EMAIL_IMAP_HOST: 'imap.example.com' }, { host: 'imap.example.com', port: 993, tls: false, verify: false, smtpSecure: true }],
  ]) {
    const result = spawnSync(process.execPath, [...args, '--input-type=module', '-e', configCommand], { cwd: tmp, env: { ...env, ...settings }, encoding: 'utf8', timeout: 5000 });
    ok(label, () => {
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), expected);
      assert.ok(!result.stderr.includes(env.EMAIL_PASSWORD));
    });
  }

  // Installer smoke checks isolate npm behind a stub; actual npm ci is checked separately.
  const installFixture = path.join(tmp, 'installer');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(installFixture); fs.mkdirSync(fakeBin);
  fs.copyFileSync(path.join(root, 'install.sh'), path.join(installFixture, 'install.sh'));
  fs.copyFileSync(path.join(root, '.env.example'), path.join(installFixture, '.env.example'));
  const npmStub = path.join(fakeBin, 'npm');
  fs.writeFileSync(npmStub, '#!/usr/bin/env bash\nexit 17\n', { mode: 0o755 });
  const installerEnv = { ...env, PATH: fakeBin + path.delimiter + env.PATH };
  const runInstaller = () => spawnSync('bash', [path.join(installFixture, 'install.sh')], { cwd: tmp, env: installerEnv, encoding: 'utf8', timeout: 5000 });
  const rejected = runInstaller();
  ok('installer propagates npm failure and does not create .env', () => {
    assert.equal(rejected.status, 17);
    assert.equal(fs.existsSync(path.join(installFixture, '.env')), false);
    assert.doesNotMatch(rejected.stdout, /Dependencies installed/);
  });
  fs.writeFileSync(npmStub, '#!/usr/bin/env bash\n[ "$*" = "ci --no-audit --no-fund" ] || exit 19\nexit 0\n');
  const installed = runInstaller();
  ok('installer creates only a fictional private .env template', () => {
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(fs.readFileSync(path.join(installFixture, '.env'), 'utf8'), fs.readFileSync(path.join(root, '.env.example'), 'utf8'));
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(installFixture, '.env')).mode & 0o777, 0o600);
  });
  fs.writeFileSync(path.join(installFixture, '.env'), 'EMAIL_USER=existing@example.com\n');
  const preserved = runInstaller();
  ok('installer preserves an existing .env', () => {
    assert.equal(preserved.status, 0, preserved.stderr);
    assert.equal(fs.readFileSync(path.join(installFixture, '.env'), 'utf8'), 'EMAIL_USER=existing@example.com\n');
  });

  const symlinkEntry = path.join(tmp, 'netease-enterprise-mail-mcp');
  fs.symlinkSync(path.join(root, 'index.js'), symlinkEntry);
  for (const entry of [path.join(root, 'index.js'), symlinkEntry]) {
  let initialized = false, toolsReceived = false;
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...args, entry], { cwd: tmp, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let pending = '', stderr = '', finished = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('stdio handshake timed out')); }, 5000);
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    const fail = error => { if (!finished) { finished = true; clearTimeout(timer); child.kill(); reject(error); } };
    child.on('error', fail);
    child.stderr.on('data', data => { stderr += data; });
    child.stdout.on('data', data => {
      pending += data;
      while (pending.includes('\n')) {
        const end = pending.indexOf('\n');
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try {
          const message = JSON.parse(line); // All stdout must be JSON-RPC.
          assert.equal(message.jsonrpc, '2.0');
          if (message.id === 1) {
            initialized = true;
            ok('stdio initialize reports project identity', () => assert.deepEqual(message.result.serverInfo, { name: 'netease-enterprise-mail-mcp', version: '1.2.0' }));
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
          } else if (message.id === 2) {
            toolsReceived = true;
            ok('stdio tools/list returns only default tools', () => assert.deepEqual(message.result.tools.map(t => t.name).sort(), [...read].sort()));
            child.stdin.end();
          }
        } catch (error) { fail(error); }
      }
    });
    child.on('close', code => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      try {
        assert.equal(code, 0, stderr);
        assert.equal(pending, '');
        assert.ok(initialized && toolsReceived, 'both handshake responses must arrive');
        resolve();
      } catch (error) { reject(error); }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'offline-test', version: '1.0.0' } } });
  });
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`${checks} offline dispatch/startup checks passed. No real IMAP, MIME or attachment end-to-end acceptance is claimed.`);

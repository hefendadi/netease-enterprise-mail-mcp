// V1.2-RC2 分发测试 —— 验证 CallTool 路由到 get_email_attachment 正确。
// 不依赖 mock IMAP：用 stub 方法隔离 IMAP 层，只测分发链与返回值。
// 运行：node test/test-dispatch.mjs

import { UniversalEmailMCPServer } from '../index.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

const s = new UniversalEmailMCPServer();

// ---- stub：替换 IMAP 相关方法，不碰网络 ----
const STUB_RESULT = {
  content: [{
    type: 'text',
    text: [
      '✅ 附件已保存',
      '📎 附件编号: 1 / 2',
      '📄 原始文件名: sample.pdf',
      '🔒 安全文件名: sample.pdf',
      '🧩 识别格式: PDF',
      '📁 保存路径: /tmp/dispatch-test/sample.pdf',
      '📏 字节大小: 1024 bytes (1.00 KB)',
      '🔑 SHA256: ' + 'a'.repeat(64),
      '📄 MIME 类型: application/pdf',
    ].join('\n'),
  }],
};

let called = 0;
let receivedArgs = null;
s.getEmailAttachment = async function (args) {
  called++;
  receivedArgs = args;
  return STUB_RESULT;
};

// 取真实注册的 CallTool handler（MCP SDK 内部存储）
function getHandler(method) {
  const handlers = this.server._requestHandlers || this.server.requestHandlers;
  if (handlers && typeof handlers.get === 'function') return handlers.get(method);
  if (handlers && handlers[method]) return handlers[method];
  return null;
}

async function callTool(name, args) {
  const handler = getHandler.call(s, 'tools/call');
  if (!handler) throw new Error('未找到 CallTool handler');
  // MCP SDK handler 签名为 (request, extra)
  return handler(
    { method: 'tools/call', params: { name, arguments: args } },
    { signal: new AbortController().signal, sendNotification: async () => {}, sendRequest: async () => {} }
  );
}

console.log('=== V1.2-RC2 分发测试 ===\n');

// ---- 1. get_email_attachment 分发 ----
let res, err = null;
try {
  res = await callTool('get_email_attachment', { uid: '12345', folder: 'INBOX', attachmentIndex: 1 });
} catch (e) {
  err = e;
}

check('1a: CallTool 未抛异常', !err, err ? err.message : '');
check('1b: 不再出现 result is not defined',
  err ? !String(err.message).includes('result is not defined') : true,
  err ? err.message.slice(0, 80) : '');
check('1c: 成功路由到 getEmailAttachment', called === 1, `调用次数=${called}`);
check('1d: 参数正确透传',
  receivedArgs && receivedArgs.uid === '12345' && receivedArgs.attachmentIndex === 1,
  receivedArgs ? JSON.stringify(receivedArgs) : '未收到参数');

const text = res?.content?.[0]?.text || '';
check('1e: 响应含保存路径', /保存路径: \//.test(text), '');
check('1f: 响应含 SHA256', /SHA256: [a-f0-9]{64}/.test(text), '');
check('1g: 响应含文件大小', /字节大小: \d+ bytes/.test(text), '');
check('1h: 响应不含 Base64/二进制', !/[A-Za-z0-9+/]{300,}={0,2}/.test(text), `响应 ${text.length} 字符`);

// ---- 2. 确认其他工具分发未被破坏 ----
let searchOk = true, contentOk = true;
s.searchEmails = async () => ({ content: [{ type: 'text', text: 'SEARCH_OK' }] });
s.getEmailContent = async () => ({ content: [{ type: 'text', text: 'CONTENT_OK' }] });

try {
  const r1 = await callTool('search_emails', { query: 'test' });
  searchOk = r1?.content?.[0]?.text === 'SEARCH_OK';
} catch (e) { searchOk = false; }
try {
  const r2 = await callTool('get_email_content', { uid: '1' });
  contentOk = r2?.content?.[0]?.text === 'CONTENT_OK';
} catch (e) { contentOk = false; }

check('2a: search_emails 分发正常', searchOk, '');
check('2b: get_email_content 分发正常', contentOk, '');

// ---- 3. 写工具仍被拦截（安全策略未受影响）----
let blocked = null;
try {
  const r3 = await callTool('send_email', { to: ['recipient@example.com'], subject: 't', text: 'b' });
  blocked = r3?.content?.[0]?.text || '';
} catch (e) { blocked = 'ERR:' + e.message; }
check('3a: 发信工具仍被安全策略拦截', blocked.includes('已被安全策略禁用'), blocked.slice(0, 40));

// ---- 4. 工具列表包含新工具 ----
// 注意：MCP SDK 的 tools/list handler 会做 Zod 校验，请求对象需带 method 字段
let toolNames = [];
try {
  const h = getHandler.call(s, 'tools/list');
  const lr = await h({ method: 'tools/list', params: {} }, { signal: new AbortController().signal });
  toolNames = (lr?.tools || []).map((x) => x.name);
} catch (e) { /* 忽略 */ }
check('4a: 工具列表含 get_email_attachment', toolNames.includes('get_email_attachment'), toolNames.join(', '));
check('4b: 工具列表不含 send_email', !toolNames.includes('send_email'), '');

// ---- 汇总 ----
console.log('\n' + '='.repeat(50));
console.log(`结果：${pass} 通过 / ${fail} 失败，共 ${pass + fail} 项`);
console.log('='.repeat(50));
if (fail) {
  console.log('\n失败项:');
}
process.exit(fail === 0 ? 0 : 1);
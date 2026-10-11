#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import nodemailer from 'nodemailer';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import POP3Client from 'poplib';
import dotenv from 'dotenv';
import path from 'path';
import fsMod from 'fs';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'node:url';

// 兼容两种引用名
const fs = fsMod;

// 加载环境变量
const modulePath = fileURLToPath(import.meta.url);
// dotenv environment flags can override quiet; keep its synchronous logs off MCP stdout.
const originalConsoleLog = console.log;
try {
  console.log = (...args) => console.error(...args);
  dotenv.config({ path: path.join(path.dirname(modulePath), '.env'), quiet: true });
} finally {
  console.log = originalConsoleLog;
}

// 邮箱配置映射
const EMAIL_CONFIGS = {
  'qq': {
    name: 'QQ邮箱',
    domains: ['qq.com'],
    smtp: { host: 'smtp.qq.com', port: 587, secure: false },
    imap: { host: 'imap.qq.com', port: 993, secure: true },
    pop3: { host: 'pop.qq.com', port: 995, secure: true },
    usePOP3: false
  },
  '163': {
    name: '网易邮箱',
    domains: ['163.com', '126.com', 'yeah.net'],
    smtp: { host: 'smtp.163.com', port: 465, secure: true },
    imap: { host: 'imap.163.com', port: 993, secure: true },
    pop3: { host: 'pop.163.com', port: 995, secure: true },
    usePOP3: true // 163邮箱推荐使用POP3
  },
  // 网易企业邮箱：企业域名不固定，无法按域名自动识别，必须显式指定 EMAIL_TYPE=netease-enterprise
  // 注意：SMTP 用 465/SSL 直连。企业邮箱普遍开启 IMAP/SMTP 服务后在网页端生成「客户端授权密码」，
  // 这里填授权密码而非网页登录密码；两者不通用。
  'netease-enterprise': {
    name: '网易企业邮箱',
    domains: [], // 企业域名不固定
    smtp: { host: 'smtphz.qiye.163.com', port: 465, secure: true },
    imap: { host: 'imaphz.qiye.163.com', port: 993, secure: true },
    pop3: { host: 'pophz.qiye.163.com', port: 995, secure: true },
    usePOP3: false // 用 IMAP，否则读不到分类文件夹，也无法搜索
  },
  'gmail': {
    name: 'Gmail',
    domains: ['gmail.com', 'googlemail.com'],
    smtp: { host: 'smtp.gmail.com', port: 587, secure: true }, // 从2025年5月1日起，需要OAuth认证
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    pop3: { host: 'pop.gmail.com', port: 995, secure: true },
    usePOP3: false, // Gmail推荐使用IMAP
    requiresOAuth: true, // 2025年5月1日后必须使用OAuth，不支持密码认证
    note: '需要在Gmail设置中启用POP/IMAP，Google Workspace需要管理员启用'
  },
  'outlook': {
    name: 'Outlook/Hotmail',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    smtp: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    pop3: { host: 'outlook.office365.com', port: 995, secure: true },
    usePOP3: false
  },
  'exmail': {
    name: '腾讯企业邮箱',
    domains: ['exmail.qq.com'],
    smtp: { host: 'smtp.exmail.qq.com', port: 465, secure: true },
    imap: { host: 'imap.exmail.qq.com', port: 993, secure: true },
    pop3: { host: 'pop.exmail.qq.com', port: 995, secure: true },
    usePOP3: false
  },
  'aliyun': {
    name: '阿里云邮箱',
    domains: ['aliyun.com', 'alibaba-inc.com'],
    smtp: { host: 'smtp.mxhichina.com', port: 465, secure: true },
    imap: { host: 'imap.mxhichina.com', port: 993, secure: true },
    pop3: { host: 'pop.mxhichina.com', port: 995, secure: true },
    usePOP3: false
  },
  'sina': {
    name: '新浪邮箱',
    domains: ['sina.com', 'sina.cn'],
    smtp: { host: 'smtp.sina.com', port: 587, secure: false },
    imap: { host: 'imap.sina.com', port: 993, secure: true },
    pop3: { host: 'pop.sina.com', port: 995, secure: true },
    usePOP3: false
  },
  'sohu': {
    name: '搜狐邮箱',
    domains: ['sohu.com'],
    smtp: { host: 'smtp.sohu.com', port: 25, secure: false },
    imap: { host: 'imap.sohu.com', port: 993, secure: true },
    pop3: { host: 'pop.sohu.com', port: 995, secure: true },
    usePOP3: false
  }
};

// ============ V1.2 附件处理辅助 ============
// 注意：不做 MIME 解析，沿用 simpleParser。


// ---------- 输出目录解析（可配置 + 多候选降级） ----------
// 需求明确要求：不得假设本地绝对路径在云端自动化环境同样可访问。
// 因此按优先级尝试多个候选位置，第一个可写的即生效，并回显实际使用的目录。
const ATTACH_DIR_CANDIDATES = [
  { env: 'EMAIL_ATTACHMENT_DIR', label: '环境变量指定' },
  { label: '用户目录', build: () => path.join(os.homedir(), '.workbuddy-mcp-attachments') },
  { label: '工作目录', build: () => path.join(process.cwd(), '.mcp-attachments') },
  { label: '系统临时目录', build: () => path.join(fs.realpathSync(os.tmpdir()), 'workbuddy-mcp-attachments') },
];

// Node does not expose portable openat/ACL APIs. Require POSIX ownership and
// non-following opens; never silently use weaker attachment protection.
function inspectAttachDirectory(dir, create = false) {
  if (typeof process.getuid !== 'function' || !fs.constants.O_NOFOLLOW || !fs.constants.O_DIRECTORY) {
    throw new Error('附件安全写入需要支持 POSIX 所有权及 O_NOFOLLOW 的文件系统');
  }
  const uid = process.getuid();
  const absolute = path.resolve(dir);
  const root = path.parse(absolute).root;
  if (absolute === root) throw new Error('不能将文件系统根目录作为附件目录');
  let current = root;
  const parts = absolute.slice(root.length).split(path.sep).filter(Boolean);
  let leaf;
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = path.join(current, parts[i]);
    let st;
    try { st = fs.lstatSync(current); }
    catch (error) {
      if (!create || error.code !== 'ENOENT') throw error;
      try { fs.mkdirSync(current, { mode: 0o700 }); }
      catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      st = fs.lstatSync(current);
    }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('附件目录路径含符号链接或非目录组件');
    if (st.uid !== uid && st.uid !== 0) throw new Error('附件目录的父路径所有权不可信');
    // A root-owned sticky temporary parent cannot have another user's owned
    // child renamed by an untrusted user. The private leaf must still be ours.
    const stickyRootParent = i < parts.length - 1 && st.uid === 0 && (st.mode & 0o1000);
    if ((st.mode & 0o022) && !stickyRootParent) throw new Error('附件目录父路径允许其他用户写入');
    if (i === parts.length - 1) {
      if (st.uid !== uid) throw new Error('附件目录必须属于当前用户');
      leaf = st;
    }
  }
  return { dir: absolute, stat: leaf };
}

function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }

function validateAttachDirectory(info) {
  const current = inspectAttachDirectory(info.dir);
  if (!sameFile(current.stat, info.stat) || (current.stat.mode & 0o777) !== 0o700) {
    throw new Error('附件私有目录已改变或权限不是 0700');
  }
}

function prepareAttachDirectory(dir, label) {
  const info = inspectAttachDirectory(dir, true);
  const fd = fs.openSync(info.dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    if (!sameFile(fs.fstatSync(fd), info.stat)) throw new Error('附件目录在校验期间被替换');
    fs.fchmodSync(fd, 0o700);
    info.stat = fs.fstatSync(fd);
    validateAttachDirectory(info);
    fs.accessSync(info.dir, fs.constants.W_OK);
  } finally { fs.closeSync(fd); }
  return { ...info, label };
}

function ensureAttachDir() {
  // An explicitly configured unsafe/unwritable path fails closed; a fallback
  // must not conceal an invalid security boundary selected by the operator.
  if (process.env.EMAIL_ATTACHMENT_DIR) {
    return prepareAttachDirectory(process.env.EMAIL_ATTACHMENT_DIR, '环境变量指定');
  }
  for (const cand of ATTACH_DIR_CANDIDATES.filter(c => !c.env)) {
    try { return prepareAttachDirectory(cand.build(), cand.label); }
    catch (_) { /* Only automatic default candidates may fall back. */ }
  }
  return null;
}

function getAttachDir() { return ensureAttachDir(); }

// ---------- 文件名安全处理 ----------
// 目标：阻断路径穿越（../）、绝对路径、分隔符、保留字符。
// 不能简单粗暴地全替换 —— 那会丢失可读性；这里逐类剥离并记录。
function sanitizeFilename(name, fallback) {
  let n = String(name || '').trim();
  if (!n) n = fallback || 'attachment';

  // 剥离目录成分（同时处理 / 与 \）
  n = n.split(/[/\\]/).pop() || n;
  // 去掉路径穿越序列
  n = n.replace(/\.\./g, '');
  // 移除控制字符与 shell/Windows 保留字符
  n = n.replace(/[\x00-\x1f\x7f]/g, '');
  n = n.replace(/[<>:"|?*]/g, '_');
  // 首尾的点会导致隐藏文件或特殊语义
  n = n.replace(/^\.+/, '');
  n = n.replace(/\.+$/, '');
  // 长度限制（按 UTF-8 字节）
  if (Buffer.byteLength(n, 'utf8') > 120) {
    const ext = path.extname(n).slice(0, 20);
    n = Buffer.from(n, 'utf8').slice(0, 100).toString('utf8') + ext;
  }
  return n || (fallback || 'attachment');
}

// Reserve both names before writing either file. O_EXCL also rejects dangling
// symlinks. All cleanup checks inode identity and removes only our own creations.
function saveAttachmentFiles(info, safeName, buf, digest) {
  const ext = path.extname(safeName);
  const base = ext ? safeName.slice(0, -ext.length) : safeName;
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
  for (let n = 0; n < 1000; n++) {
    const target = path.join(info.dir, n ? `${base}(${n})${ext}` : safeName);
    if (!path.resolve(target).startsWith(info.dir + path.sep)) throw new Error('附件路径越出私有目录');
    const manifest = target + '.sha256';
    const created = [];
    let reserving = true;
    try {
      for (const name of [target, manifest]) {
        validateAttachDirectory(info);
        const fd = fs.openSync(name, flags, 0o600);
        // Record the opened inode, not a later lookup through the path.
        const entry = { path: name, fd, stat: null };
        created.push(entry);
        entry.stat = fs.fstatSync(fd);
        if (!entry.stat.isFile() || entry.stat.uid !== process.getuid()) throw new Error('附件文件所有权或类型异常');
        fs.fchmodSync(fd, 0o600);
        validateAttachDirectory(info);
      }
      reserving = false;
      fs.writeFileSync(created[0].fd, buf);
      fs.writeFileSync(created[1].fd, `${digest}  ${path.basename(target)}\n`);
      for (const entry of created) {
        fs.fsyncSync(entry.fd);
        const fd = entry.fd;
        entry.fd = null;
        fs.closeSync(fd);
      }
      validateAttachDirectory(info);
      for (const entry of created) {
        const st = fs.lstatSync(entry.path);
        if (st.isSymbolicLink() || !sameFile(st, entry.stat) || (st.mode & 0o777) !== 0o600) {
          throw new Error('附件文件在写入期间被替换或权限异常');
        }
      }
      return target;
    } catch (error) {
      let cleanupError;
      for (const entry of created) {
        if (entry.fd !== null) {
          const fd = entry.fd; entry.fd = null;
          try { fs.closeSync(fd); } catch (e) { cleanupError = e; }
        }
        try {
          validateAttachDirectory(info);
          const st = fs.lstatSync(entry.path);
          if (entry.stat && !st.isSymbolicLink() && sameFile(st, entry.stat)) fs.unlinkSync(entry.path);
          else if (!entry.stat) cleanupError = new Error('无法确认新建文件身份，保留文件');
        } catch (e) { if (e.code !== 'ENOENT') cleanupError = e; }
      }
      if (cleanupError) throw new Error(`${error.message}；清理未完成: ${cleanupError.message}`);
      if (reserving && error.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error('附件文件名冲突，无法分配未占用的附件与校验文件');
}

// ---------- 格式识别（仅用于展示，不解析内容） ----------
function detectFormat(filename, contentType) {
  const n = String(filename || '').toLowerCase();
  const ct = String(contentType || '').toLowerCase();
  if (n.endsWith('.pdf') || ct.includes('pdf')) return 'PDF';
  if (/\.(xlsx|xlsm|xls)$/.test(n) || ct.includes('spreadsheet') || ct.includes('excel')) return 'XLSX';
  if (/\.(docx?|rtf)$/.test(n) || ct.includes('wordprocessing') || ct.includes('msword')) return 'DOCX';
  if (/\.(png)$/.test(n) || ct.includes('png')) return 'PNG';
  if (/\.(jpe?g)$/.test(n) || ct.includes('jpeg') || ct.includes('jpg')) return 'JPG';
  if (/\.(csv)$/.test(n) || ct.includes('csv')) return 'CSV';
  if (/\.(txt|md)$/.test(n) || ct.startsWith('text/')) return 'TEXT';
  if (/\.(zip)$/.test(n) || ct.includes('zip')) return 'ZIP';
  return 'UNKNOWN';
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
// ============ V1.1B 输出辅助 ============
// 说明：以下均为纯文本处理函数，不涉及任何 MIME 结构解析。

// 字节数格式化为易读形式
function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

// HTML 标签剥离 —— 仅在邮件没有纯文本正文时使用。
// 目的是把 HTML 变成可读纯文本，而不是返回 HTML 源码。
function stripHtmlTags(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\s*(td|th)\b[^>]*>/gi, '\t');
  s = s.replace(/<\s*\/\s*(td|th)\s*>/gi, ' ');
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\s*\/\s*(p|div|tr|li|h[1-6]|table|section|thead|tbody)\s*>/gi, '\n');
  s = s.replace(/<\s*(p|div|tr|li|h[1-6]|section)\b[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeBasicEntities(s);
  return s;
}

function decodeBasicEntities(s) {
  const map = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&ensp;': ' ', '&emsp;': ' ', '&mdash;': '—',
    '&ndash;': '–', '&hellip;': '…', '&middot;': '·', '&times;': '×', '&copy;': '©',
  };
  let out = s;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  out = out.replace(/&#(\d+);/g, (_, d) => {
    const n = parseInt(d, 10);
    return n > 0 && n < 0x110000 ? String.fromCharCode(n) : '';
  });
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, hx) => {
    const n = parseInt(hx, 16);
    return n > 0 && n < 0x110000 ? String.fromCharCode(n) : '';
  });
  return out;
}

// 正文规范化：统一换行、压缩空白，但保留段落结构
function normalizeBodyText(s) {
  if (!s) return '';
  return String(s)
    .replace(/\r\n/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]{3,}/g, '  ')
    .trim();
}
// ============ V1.1A 辅助函数 ============

// IMAP 邮件头中的 RFC2047 编码值（=?UTF-8?B?...?=）需解码为可读中文
function decodeHeaderValue(v) {
  if (!v) return '';
  try {
    if (/^=\?utf-8\?[bBqQ]\?/i.test(v)) {
      return v.replace(/=\?utf-8\?([bBqQ])\?([^?]*)\?=/gi, (_, enc, data) => {
        try {
          if (enc.toLowerCase() === 'b') return Buffer.from(data, 'base64').toString('utf8');
          return decodeURIComponent(escape(data.replace(/_/g, ' ')));
        } catch (_) { return ''; }
      }).replace(/\?=$/, '').trim();
    }
    return v;
  } catch (_) {
    return v;
  }
}

function completenessLabel(c) {
  switch (c) {
    case 'complete': return '完整（已扫描全部候选）';
    case 'partial': return '部分（存在截断或失败，结果可能不全）';
    case 'failed': return '失败（未完成任何扫描）';
    default: return '未知';
  }
}

// 格式化单条命中结果（V1.1A 不含正文，避免 token 浪费）
function formatHitV11(h) {
  const lines = [
    `📧 UID: ${h.uid}${h.uidvalidity ? ` (UIDVALIDITY: ${h.uidvalidity})` : ''}`,
    `📂 文件夹: ${h.folder}`,
    `📅 日期: ${h.date || '(未知)'}`,
    `👤 发件人: ${h.from || '(未知)'}`,
    `📝 主题: ${h.subject}`,
    `📎 附件: ${h.hasAttachment === true ? '可能有（multipart 结构）' : h.hasAttachment === false ? '无' : '未知'}`,
  ];
  if (h.messageId) lines.push(`🆔 Message-ID: ${h.messageId}`);
  lines.push('────────────────────────────────');
  return lines;
}

// 按邮件日期倒序排列（最新在前）。日期解析失败的排在最后，不丢弃。
// 邮件服务器的 UID 顺序不等于时间顺序，搜索结果必须显式按日期排序。
function sortByDateDesc(list) {
  const ts = (e) => {
    const d = e && e.date ? new Date(e.date) : null;
    return d && !isNaN(d.getTime()) ? d.getTime() : -Infinity;
  };
  return [...list].sort((a, b) => ts(b) - ts(a));
}

// ============ 安全开关 ============
// 写操作工具默认禁用：会改变邮箱状态或运行时配置。启用需显式设置
// ENABLE_WRITE_TOOLS=true。仅读工具（search/get/list/test）不受影响。
const WRITE_TOOLS = ['send_email', 'setup_email_account', 'configure_email_server'];
const READ_TOOLS = ['search_emails', 'get_email_content', 'get_email_attachment', 'get_recent_emails', 'list_folders', 'test_email_connection'];

function writeToolsEnabled() {
  return process.env.ENABLE_WRITE_TOOLS === 'true';
}

class UniversalEmailMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'netease-enterprise-mail-mcp',
        version: '1.2.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  // 根据邮箱地址或手动指定类型识别邮箱类型
  detectEmailProvider(email, manualType = null) {
    // 优先使用手动指定的邮箱类型
    if (manualType && EMAIL_CONFIGS[manualType]) {
      console.error(`使用手动指定的邮箱类型: ${manualType} (${EMAIL_CONFIGS[manualType].name})`);
      return manualType;
    }

    // 如果没有手动指定，则根据域名自动检测
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return null;
    
    for (const [provider, config] of Object.entries(EMAIL_CONFIGS)) {
      if (config.domains.includes(domain)) {
        console.error(`自动检测到邮箱类型: ${provider} (${config.name})`);
        return provider;
      }
    }
    
    console.error(`未能识别邮箱类型，域名: ${domain}`);
    return null;
  }

  // 根据邮箱类型自动配置服务器设置
  autoConfigureByProvider(provider) {
    const config = EMAIL_CONFIGS[provider];
    if (!config) {
      throw new Error(`不支持的邮箱类型: ${provider}`);
    }

    // 设置SMTP配置
    process.env.EMAIL_SMTP_HOST = config.smtp.host;
    process.env.EMAIL_SMTP_PORT = config.smtp.port.toString();
    process.env.EMAIL_SMTP_SECURE = config.smtp.secure.toString();

    // 设置IMAP配置
    process.env.EMAIL_IMAP_HOST = config.imap.host;
    process.env.EMAIL_IMAP_PORT = config.imap.port.toString();
    process.env.EMAIL_IMAP_SECURE = config.imap.secure.toString();

    // 设置POP3配置
    process.env.EMAIL_POP3_HOST = config.pop3.host;
    process.env.EMAIL_POP3_PORT = config.pop3.port.toString();
    process.env.EMAIL_POP3_SECURE = config.pop3.secure.toString();

    // 设置协议偏好
    process.env.EMAIL_USE_POP3 = config.usePOP3.toString();

    return config;
  }

  setupToolHandlers() {
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const all = [
          {
            name: 'send_email',
            description: '发送邮件',
            inputSchema: {
              type: 'object',
              properties: {
                to: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '收件人邮箱地址列表'
                },
                cc: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '抄送邮箱地址列表（可选）'
                },
                bcc: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '密送邮箱地址列表（可选）'
                },
                subject: {
                  type: 'string',
                  description: '邮件主题'
                },
                text: {
                  type: 'string',
                  description: '纯文本邮件内容'
                },
                html: {
                  type: 'string',
                  description: 'HTML格式邮件内容（可选）'
                },
                attachments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      filename: { type: 'string', description: '附件文件名' },
                      path: { type: 'string', description: '附件文件路径' },
                      content: { type: 'string', description: '附件内容(base64编码)' }
                    }
                  },
                  description: '邮件附件列表（可选）'
                }
              },
              required: ['to', 'subject', 'text']
            }
          },
          {
            name: 'get_recent_emails',
            description: '获取最近三天的邮件列表',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: '返回邮件数量限制（默认20）'
                },
                days: {
                  type: 'number',
                  description: '获取最近几天的邮件（默认3天）'
                }
              },
              required: []
            }
          },
          {
            name: 'search_emails',
            description: '按邮件标题检索（邮件头优先，不下载正文与附件）。默认搜索最近 7 天、INBOX 收件箱。可指定发件人与文件夹。结果按日期倒序返回，并报告扫描数量与完整性状态。',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: '标题关键词（大小写不敏感，留空表示不过滤标题）'
                },
                from: {
                  type: 'string',
                  description: '发件人关键词（姓名或邮箱片段，大小写不敏感，可选）'
                },
                folder: {
                  type: 'string',
                  description: '文件夹名（默认 INBOX）。传空字符串或 "ALL" 表示搜索所有文件夹'
                },
                days: {
                  type: 'number',
                  description: '限定最近几天内的邮件（默认 7，0 表示不限制）'
                },
                limit: {
                  type: 'number',
                  description: '显示结果数量（默认 20）。结果恒按邮件日期倒序返回'
                }
              },
              required: []
            }
          },

          {
            name: 'list_folders',
            description: '列出可选择的叶级文件夹及服务器返回的邮件数量。计数查询失败时返回 0，数字仅供参考。',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'get_email_content',
            description: '读取指定邮件的正文。只返回纯文本正文与附件元数据，不返回原始 HTML 与附件内容。仅需传uid；默认读取 INBOX。',
            inputSchema: {
              type: 'object',
              properties: {
                uid: {
                  type: 'string',
                  description: '邮件唯一标识符（来自 search_emails 的返回结果）'
                },
                folder: {
                  type: 'string',
                  description: '文件夹名（默认 INBOX）。读取非收件箱邮件时必须指定，否则会找不到'
                },
                maxChars: {
                  type: 'number',
                  description: '正文最大返回字符数（默认 12000；有效值限制为 200～200000，非正数或非有限值回退默认）。响应还受总长度限制，超出部分会被截断并标记'
                }
              },
              required: ['uid']
            }
          },
          {
            name: 'get_email_attachment',
            description: '获取指定邮件的单个附件并保存到本地受控目录。只返回保存路径与元数据（SHA256、类型、大小），响应中不含附件内容。附件不会被打开、执行或解压。',
            inputSchema: {
              type: 'object',
              properties: {
                uid: {
                  type: 'string',
                  description: '邮件 UID（来自 search_emails 的返回结果）'
                },
                folder: {
                  type: 'string',
                  description: '文件夹名（默认 INBOX）。读取非收件箱邮件时必须指定'
                },
                uidValidity: {
                  type: 'string',
                  description: '可选。传入 search_emails 返回的 UIDVALIDITY 以校验定位有效性，不匹配时拒绝读取'
                },
                attachmentIndex: {
                  type: 'integer',
                  minimum: 1,
                  description: '附件编号（默认 1，从1开始）。与 get_email_content 返回的附件清单 [编号] 一致'
                }
              },
              required: ['uid']
            }
          },


          {
            name: 'setup_email_account',
            description: '设置邮箱账号（自动识别邮箱类型并配置服务器）',
            inputSchema: {
              type: 'object',
              properties: {
                email: {
                  type: 'string',
                  description: '邮箱地址（虚构示例：reader@example.com）'
                },
                password: {
                  type: 'string',
                  description: '邮箱密码或授权码'
                },
                provider: {
                  type: 'string',
                  enum: ['qq', '163', 'netease-enterprise', 'gmail', 'outlook', 'exmail', 'aliyun', 'sina', 'sohu'],
                  description: '邮箱提供商（可选，不填写则自动识别）'
                }
              },
              required: ['email', 'password']
            }
          },
          {
            name: 'list_supported_providers',
            description: '列出支持的邮箱提供商',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'configure_email_server',
            description: '手动配置邮箱服务器设置（高级用户使用）',
            inputSchema: {
              type: 'object',
              properties: {
                smtpHost: {
                  type: 'string',
                  description: 'SMTP服务器地址'
                },
                smtpPort: {
                  type: 'number',
                  description: 'SMTP端口'
                },
                smtpSecure: {
                  type: 'boolean',
                  description: '是否使用SSL'
                },
                imapHost: {
                  type: 'string',
                  description: 'IMAP服务器地址'
                },
                imapPort: {
                  type: 'number',
                  description: 'IMAP端口'
                },
                imapSecure: {
                  type: 'boolean',
                  description: '是否使用SSL'
                },
                user: {
                  type: 'string',
                  description: '邮箱账号'
                },
                password: {
                  type: 'string',
                  description: '邮箱密码或授权码'
                }
              },
              required: []
            }
          },
          {
            name: 'test_email_connection',
            description: '测试邮箱服务器连接',
            inputSchema: {
              type: 'object',
              properties: {
                testType: {
                  type: 'string',
                  enum: ['smtp', 'imap', 'both'],
                  description: '测试连接类型：smtp、imap 或 both（默认 both）。SMTP 测试验证连接，不发送邮件'
                }
              },
              required: []
            }
          }
        ];

      // 写操作工具默认不出现在列表中。启用：ENABLE_WRITE_TOOLS=true
      const tools = writeToolsEnabled() ? all : all.filter((x) => !WRITE_TOOLS.includes(x.name));
      if (!writeToolsEnabled()) {
        console.error('[安全] 写操作工具已禁用: ' + WRITE_TOOLS.join(', '));
      }
      return { tools };
    });

    // 执行工具调用
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // 双保险：即使客户端缓存了工具列表，也在此拦截
      if (WRITE_TOOLS.includes(name) && !writeToolsEnabled()) {
        return {
          content: [{
            type: 'text',
            text: '❌ 工具「' + name + '」已被安全策略禁用（会修改邮箱状态或运行时配置）。\n\n如确需启用，请由管理员设置环境变量 ENABLE_WRITE_TOOLS=true 后重启 MCP。\n\n当前可用工具: ' + READ_TOOLS.join(', ')
          }]
        };
      }

      try {
        switch (name) {
          case 'send_email':
            return await this.sendEmail(args);
          case 'get_recent_emails':
            return await this.getRecentEmails(args);
          case 'search_emails':
            return await this.searchEmails(args);
          case 'list_folders':
            return await this.listFolders(args);
          case 'get_email_attachment':
            return await this.getEmailAttachment(args);
          case 'get_email_content':
            return await this.getEmailContent(args);
          case 'setup_email_account':
            return await this.setupEmailAccount(args);
          case 'list_supported_providers':
            return await this.listSupportedProviders(args);
          case 'configure_email_server':
            return await this.configureEmailServer(args);
          case 'test_email_connection':
            return await this.testConnection(args);
          default:
            throw new Error(`未知的工具: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `错误: ${error.message}`
            }
          ]
        };
      }
    });
  }

  // 创建SMTP邮件传输器
  createSMTPTransporter() {
    try {
      // 如果已经有手动配置的设置，直接使用
      if (process.env.EMAIL_SMTP_HOST || process.env.WECHAT_EMAIL_HOST) {
        const config = {
          host: process.env.EMAIL_SMTP_HOST || process.env.WECHAT_EMAIL_HOST,
          port: parseInt(process.env.EMAIL_SMTP_PORT || process.env.WECHAT_EMAIL_PORT) || 587,
          secure: (process.env.EMAIL_SMTP_SECURE || process.env.WECHAT_EMAIL_SECURE) !== 'false',
          auth: {
            user: process.env.EMAIL_USER || process.env.WECHAT_EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD || process.env.WECHAT_EMAIL_PASSWORD
          },
          connectionTimeout: 30000,
          greetingTimeout: 30000,
          socketTimeout: 30000
        };
        console.error('使用手动配置的SMTP设置:', { host: config.host, port: config.port, secure: config.secure });
        return nodemailer.createTransport(config);
      }

      // 自动配置
      const emailUser = process.env.EMAIL_USER || process.env.WECHAT_EMAIL_USER;
      const emailType = process.env.EMAIL_TYPE; // 手动指定的邮箱类型
      
      if (!emailUser) {
        throw new Error('缺少邮箱用户名配置。请设置 EMAIL_USER 环境变量。');
      }

      const provider = this.detectEmailProvider(emailUser, emailType);
      if (!provider) {
        throw new Error(`无法识别邮箱类型: ${emailUser}。如果是企业邮箱，请设置 EMAIL_TYPE 环境变量（如: 'exmail' 代表腾讯企业邮箱）`);
      }

      const emailConfig = EMAIL_CONFIGS[provider];
      const config = {
        host: emailConfig.smtp.host,
        port: emailConfig.smtp.port,
        secure: emailConfig.smtp.secure,
        auth: {
          user: emailUser,
          pass: process.env.EMAIL_PASSWORD || process.env.WECHAT_EMAIL_PASSWORD
        },
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 30000
      };

      // 验证必需的配置项
      if (!config.auth.pass) {
        throw new Error('缺少邮箱密码配置。请设置 EMAIL_PASSWORD 环境变量。');
      }

      console.error(`自动配置SMTP设置 - 邮箱类型: ${emailConfig.name}`, { host: config.host, port: config.port, secure: config.secure });
      return nodemailer.createTransport(config);
    } catch (error) {
      console.error('创建SMTP传输器失败:', error.message);
      throw error;
    }
  }

  // 创建IMAP连接
  createIMAPConnection() {
    try {
      // 如果已经有手动配置的设置，直接使用
      if (process.env.EMAIL_IMAP_HOST || process.env.WECHAT_EMAIL_HOST) {
        const config = {
          user: process.env.EMAIL_USER || process.env.WECHAT_EMAIL_USER,
          password: process.env.EMAIL_PASSWORD || process.env.WECHAT_EMAIL_PASSWORD,
          host: process.env.EMAIL_IMAP_HOST || process.env.WECHAT_EMAIL_HOST?.replace('smtp', 'imap'),
          port: parseInt(process.env.EMAIL_IMAP_PORT) || 993,
          tls: (process.env.EMAIL_IMAP_SECURE !== 'false'),
          tlsOptions: { rejectUnauthorized: process.env.IMAP_TLS_REJECT_UNAUTHORIZED !== 'false' }
        };
        console.error('使用手动配置的IMAP设置:', { host: config.host, port: config.port });
        return new Imap(config);
      }

      // 自动配置
      const emailUser = process.env.EMAIL_USER || process.env.WECHAT_EMAIL_USER;
      const emailType = process.env.EMAIL_TYPE;
      
      if (!emailUser) {
        throw new Error('缺少邮箱用户名配置。请设置 EMAIL_USER 环境变量。');
      }

      const provider = this.detectEmailProvider(emailUser, emailType);
      if (!provider) {
        throw new Error(`无法识别邮箱类型: ${emailUser}。如果是企业邮箱，请设置 EMAIL_TYPE 环境变量`);
      }

      const emailConfig = EMAIL_CONFIGS[provider];
      const config = {
        user: emailUser,
        password: process.env.EMAIL_PASSWORD || process.env.WECHAT_EMAIL_PASSWORD,
        host: emailConfig.imap.host,
        port: emailConfig.imap.port,
        tls: emailConfig.imap.secure,
        tlsOptions: { rejectUnauthorized: process.env.IMAP_TLS_REJECT_UNAUTHORIZED !== 'false' }
      };

      // 验证必需的配置项
      if (!config.password) {
        throw new Error('缺少邮箱密码配置。请设置 EMAIL_PASSWORD 环境变量。');
      }

      console.error(`自动配置IMAP设置 - 邮箱类型: ${emailConfig.name}`, { host: config.host, port: config.port });
      return new Imap(config);
    } catch (error) {
      console.error('创建IMAP连接失败:', error.message);
      throw error;
    }
  }

  // 创建POP3连接
  createPOP3Connection() {
    try {
      // 如果已经有手动配置的设置，直接使用
      if (process.env.EMAIL_POP3_HOST || process.env.WECHAT_EMAIL_HOST) {
        const config = {
          hostname: process.env.EMAIL_POP3_HOST || process.env.WECHAT_EMAIL_HOST?.replace('smtp', 'pop'),
          port: parseInt(process.env.EMAIL_POP3_PORT) || 995,
          tls: (process.env.EMAIL_POP3_SECURE !== 'false'),
          username: process.env.EMAIL_USER || process.env.WECHAT_EMAIL_USER,
          password: process.env.EMAIL_PASSWORD || process.env.WECHAT_EMAIL_PASSWORD
        };
        console.error('使用手动配置的POP3设置:', { hostname: config.hostname, port: config.port });
        return config;
      }

      // 自动配置
      const emailUser = process.env.EMAIL_USER || process.env.WECHAT_EMAIL_USER;
      const emailType = process.env.EMAIL_TYPE;
      
      if (!emailUser) {
        throw new Error('缺少邮箱用户名配置。请设置 EMAIL_USER 环境变量。');
      }

      const provider = this.detectEmailProvider(emailUser, emailType);
      if (!provider) {
        throw new Error(`无法识别邮箱类型: ${emailUser}。如果是企业邮箱，请设置 EMAIL_TYPE 环境变量`);
      }

      const emailConfig = EMAIL_CONFIGS[provider];
      const config = {
        hostname: emailConfig.pop3.host,
        port: emailConfig.pop3.port,
        tls: emailConfig.pop3.secure,
        username: emailUser,
        password: process.env.EMAIL_PASSWORD || process.env.WECHAT_EMAIL_PASSWORD
      };

      // 验证必需的配置项
      if (!config.password) {
        throw new Error('缺少邮箱密码配置。请设置 EMAIL_PASSWORD 环境变量。');
      }

      console.error(`自动配置POP3设置 - 邮箱类型: ${emailConfig.name}`, { hostname: config.hostname, port: config.port });
      return config;
    } catch (error) {
      console.error('创建POP3连接失败:', error.message);
      throw error;
    }
  }

  // 发送邮件
  async sendEmail(args) {
    const { to, cc, bcc, subject, text, html, attachments } = args;

    const transporter = this.createSMTPTransporter();

    const mailOptions = {
      from: process.env.EMAIL_USER || process.env.WECHAT_EMAIL_USER,
      to: Array.isArray(to) ? to.join(', ') : to,
      cc: cc ? (Array.isArray(cc) ? cc.join(', ') : cc) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc.join(', ') : bcc) : undefined,
      subject,
      text,
      html
    };

    // 处理附件
    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments.map(att => {
        if (att.content) {
          return {
            filename: att.filename,
            content: att.content,
            encoding: 'base64'
          };
        } else if (att.path) {
          return {
            filename: att.filename,
            path: att.path
          };
        }
        return att;
      });
    }

    const result = await transporter.sendMail(mailOptions);

    return {
      content: [
        {
          type: 'text',
          text: `邮件发送成功！\n消息ID: ${result.messageId}\n收件人: ${Array.isArray(to) ? to.join(', ') : to}\n主题: ${subject}`
        }
      ]
    };
  }

  // 获取最近的邮件列表
  async getRecentEmails(args = {}) {
    const { limit = 20, days = 3 } = args;
    
    // 自动检测邮箱类型并选择最佳协议
    const email = process.env.EMAIL_USER || process.env.WECHAT_EMAIL_USER;
    const emailType = process.env.EMAIL_TYPE;
    
    if (email) {
      const provider = this.detectEmailProvider(email, emailType);
      if (provider && EMAIL_CONFIGS[provider]) {
        const config = EMAIL_CONFIGS[provider];
        console.error(`使用${config.name}的${config.usePOP3 ? 'POP3' : 'IMAP'}协议获取邮件`);
        if (config.usePOP3) {
          return this.getRecentEmailsPOP3(args);
        }
      }
    }
    
    // 默认尝试IMAP，失败则尝试POP3
    try {
      return await this.getRecentEmailsIMAP(args);
    } catch (error) {
      console.error('IMAP失败，尝试POP3:', error.message);
      return this.getRecentEmailsPOP3(args);
    }
  }

  // 使用IMAP获取邮件列表  
  async getRecentEmailsIMAP(args = {}) {
    const { limit = 20, days = 3 } = args;
    
    // 检查是否支持IMAP
    try {
      const imap = this.createIMAPConnection();
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ IMAP功能不可用: ${error.message}\n\n建议：\n1. 检查邮箱IMAP/POP3设置\n2. 确认使用正确的授权码\n3. 尝试使用QQ邮箱等其他邮箱服务`
        }]
      };
    }
    
    return new Promise((resolve, reject) => {
      const imap = this.createIMAPConnection();

      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err, box) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          // 获取所有邮件，然后根据日期过滤
          imap.search(['ALL'], (err, results) => {
            if (err) {
              imap.end();
              return reject(err);
            }

            if (!results || results.length === 0) {
              imap.end();
              return resolve({
                content: [{
                  type: 'text',
                  text: `最近${days}天内没有找到邮件。`
                }]
              });
            }

            // 获取最近的邮件（取最后的一些邮件）
            const uids = results.slice(-Math.min(limit * 3, results.length));
            
            // 获取邮件头部信息
            const fetch = imap.fetch(uids, {
              bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
              struct: true
            });

            const emails = [];

            fetch.on('message', (msg, seqno) => {
              let headers = {};
              
              msg.on('body', (stream, info) => {
                let buffer = '';
                stream.on('data', (chunk) => {
                  buffer += chunk.toString('utf8');
                });
                stream.once('end', () => {
                  headers = Imap.parseHeader(buffer);
                });
              });

              msg.once('attributes', (attrs) => {
                emails.push({
                  uid: attrs.uid,
                  date: headers.date ? headers.date[0] : '',
                  from: headers.from ? headers.from[0] : '',
                  to: headers.to ? headers.to[0] : '',
                  subject: headers.subject ? headers.subject[0] : '(无主题)'
                });
              });
            });

            fetch.once('error', (err) => {
              imap.end();
              reject(err);
            });

            fetch.once('end', () => {
              imap.end();
              
              // 计算日期范围
              const since = new Date();
              since.setDate(since.getDate() - days);
              
              // 过滤最近几天的邮件
              const recentEmails = emails.filter(email => {
                const emailDate = new Date(email.date);
                return emailDate >= since;
              });
              
              // 按日期排序（最新的在前）
              recentEmails.sort((a, b) => new Date(b.date) - new Date(a.date));
              
              // 限制结果数量
              const limitedEmails = recentEmails.slice(0, limit);

              if (limitedEmails.length === 0) {
                resolve({
                  content: [{
                    type: 'text',
                    text: `最近${days}天内没有找到邮件。`
                  }]
                });
                return;
              }

              const emailList = limitedEmails.map(email => 
                `📧 UID: ${email.uid}\n` +
                `📅 日期: ${email.date}\n` +
                `👤 发件人: ${email.from}\n` +
                `📝 主题: ${email.subject}\n` +
                `────────────────────────────────`
              ).join('\n');

              resolve({
                content: [{
                  type: 'text',
                  text: `📬 最近${days}天的邮件列表 (共${limitedEmails.length}封):\n\n${emailList}`
                }]
              });
            });
          });
        });
      });

      imap.once('error', (err) => {
        reject(err);
      });

      imap.connect();
    });
  }

  // 使用POP3获取邮件列表
  async getRecentEmailsPOP3(args = {}) {
    const { limit = 20, days = 3 } = args;
    
    return new Promise((resolve, reject) => {
      const config = this.createPOP3Connection();
      const pop3 = new POP3Client(config.port, config.hostname, {
        enabletls: config.tls,
        debug: false
      });

      let emails = [];
      let messageCount = 0;

      pop3.on('connect', () => {
        pop3.login(config.username, config.password);
      });

      pop3.on('login', (status, data) => {
        if (status) {
          pop3.list();
        } else {
          reject(new Error('POP3登录失败: ' + data));
        }
      });

      pop3.on('list', (status, msgcount, msgnumber, data) => {
        if (status) {
          messageCount = msgcount;
          if (msgcount === 0) {
            pop3.quit();
            resolve({
              content: [{
                type: 'text',
                text: '邮箱中没有邮件。'
              }]
            });
            return;
          }

          // 获取最近的邮件（从最新的开始）
          const startMsg = Math.max(1, msgcount - limit + 1);
          const endMsg = msgcount;
          
          for (let i = endMsg; i >= startMsg; i--) {
            pop3.retr(i);
          }
        } else {
          reject(new Error('获取邮件列表失败: ' + data));
        }
      });

      pop3.on('retr', (status, msgnumber, data) => {
        if (status) {
          // 解析邮件
          simpleParser(data, (err, parsed) => {
            if (!err) {
              // 检查邮件日期是否在指定范围内
              const since = new Date();
              since.setDate(since.getDate() - days);
              
              const emailDate = new Date(parsed.date);
              if (emailDate >= since) {
                emails.push({
                  uid: msgnumber,
                  date: parsed.date ? parsed.date.toLocaleString() : '未知',
                  from: parsed.from?.text || '未知',
                  to: parsed.to?.text || '未知',
                  subject: parsed.subject || '(无主题)'
                });
              }
            }

            // 检查是否获取完所有邮件
            if (emails.length > 0 || msgnumber === Math.max(1, messageCount - limit + 1)) {
              pop3.quit();
            }
          });
        } else {
          reject(new Error(`获取邮件${msgnumber}失败: ${data}`));
        }
      });

      pop3.on('quit', (status, data) => {
        // 按日期排序（最新的在前）
        emails.sort((a, b) => new Date(b.date) - new Date(a.date));

        if (emails.length === 0) {
          resolve({
            content: [{
              type: 'text',
              text: `最近${days}天内没有找到邮件。`
            }]
          });
          return;
        }

        const emailList = emails.map(email => 
          `📧 邮件号: ${email.uid}\n` +
          `📅 日期: ${email.date}\n` +
          `👤 发件人: ${email.from}\n` +
          `📝 主题: ${email.subject}\n` +
          `────────────────────────────────`
        ).join('\n');

        resolve({
          content: [{
            type: 'text',
            text: `📬 最近${days}天的邮件列表 (共${emails.length}封，POP3协议):\n\n${emailList}`
          }]
        });
      });

      pop3.on('error', (err) => {
        reject(new Error('POP3连接错误: ' + err.message));
      });
    });
  }

  // ============ 全文搜索 ============
  // 策略：先走 IMAP 服务端索引（SEARCH TEXT/BODY），服务端无结果时回退到本地扫描正文与附件名。
  // 服务端快但覆盖取决于网易实现（是否索引附件、是否中文分词）；本地扫描慢但覆盖全。
  // 全程只读，不修改邮件状态、不落盘。

  // 包装 IMAP 回调式连接，统一控制连接生命周期，避免开关泄漏
  async withIMAP(fn) {
    const imap = this.createIMAPConnection();
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err, val) => {
        if (settled) return;
        settled = true;
        try { imap.end(); } catch (_) { /* 已断开 */ }
        err ? reject(err) : resolve(val);
      };
      imap.once('ready', () => {
        Promise.resolve(fn(imap)).then((v) => done(null, v), (e) => done(e));
      });
      imap.once('error', (e) => done(e));
      imap.connect();
    });
  }

  // 列出所有文件夹及邮件数
  // 注意：网易企业邮箱的 getBoxes 不返回 messages 字段（只有 attribs/delimiter/children/parent），
  // 因此必须对每个文件夹主动发 STATUS 查询才能拿到真实邮件数。
  async listFolders() {
    try {
      const folders = await this.withIMAP((imap) => new Promise((resolve, reject) => {
        imap.getBoxes((err, boxes) => {
          if (err) return reject(err);
          const names = [];
          const walk = (obj, prefix) => {
            for (const [name, meta] of Object.entries(obj || {})) {
              if (name === '\\Noselect') continue;
              const full = prefix ? `${prefix}/${name}` : name;
              if (meta.children) walk(meta.children, full);
              else names.push(full);
            }
          };
          walk(boxes, '');
          if (!names.length) return resolve([]);

          // 逐个 STATUS 查邮件数（含子文件夹一并计入父级）
          const out = [];
          let i = 0;
          const next = () => {
            if (i >= names.length) return resolve(out);
            const name = names[i++];
            const collect = (box) => {
              let total = box.messages?.total ?? 0;
              const children = [];
              for (const [k, v] of Object.entries(box)) {
                if (v && v.attribs && Array.isArray(v.attribs) && v.children) children.push(v);
              }
              for (const c of children) total += c.messages?.total ?? 0;
              return total;
            };
            imap.status(name, (err2, box) => {
              out.push({ name, count: err2 ? 0 : collect(box) });
              next();
            });
          };
          next();
        });
      }));

      if (!folders.length) {
        return { content: [{ type: 'text', text: '未找到任何文件夹。' }] };
      }
      folders.sort((a, b) => b.count - a.count);
      const text = folders.map((f) => `📁 ${f.name} — ${f.count} 封`).join('\n');
      return {
        content: [{
          type: 'text',
          text: `📂 共 ${folders.length} 个文件夹（按邮件数排序）:\n\n${text}\n\n提示：搜索时 folder 参数传文件夹名，空字符串或 "ALL" 表示全部文件夹。`
        }]
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ 列文件夹失败: ${error.message}` }] };
    }
  }

  // IMAP 服务端搜索
  async searchViaIMAP(query, folder, scope, limit) {
    return this.withIMAP((imap) => new Promise((resolve, reject) => {
      const box = folder || 'INBOX';
      imap.openBox(box, true, (err) => {
        if (err) return reject(err);
        // TEXT 覆盖主题+正文+附件名；BODY 仅正文；SUBJECT 仅主题
        let criteria;
        if (scope === 'subject') criteria = [['SUBJECT', query]];
        else if (scope === 'body') criteria = [['BODY', query]];
        else criteria = [['TEXT', query]];

        imap.search(criteria, (err2, uids) => {
          if (err2) return reject(err2);
          if (!uids || !uids.length) return resolve([]);
          const capped = uids.slice(-Math.min(limit * 2, uids.length));
          const fetch = imap.fetch(capped, {
            bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
            struct: true
          });
          const emails = [];
          fetch.on('message', (msg) => {
            let headers = {};
            msg.on('body', (stream) => {
              let buffer = '';
              stream.on('data', (c) => { buffer += c.toString('utf8'); });
              stream.once('end', () => { headers = Imap.parseHeader(buffer); });
            });
            msg.once('attributes', (attrs) => {
              emails.push({
                uid: attrs.uid,
                folder: box,
                date: headers.date ? headers.date[0] : '',
                from: headers.from ? headers.from[0] : '',
                subject: headers.subject ? headers.subject[0] : '(无主题)'
              });
            });
          });
          fetch.once('error', reject);
          fetch.once('end', () => resolve(emails));
        });
      });
    }));
  }

  // 本地扫描回退：两阶段策略。
  // 企业邮箱普遍邮件量大、平均单封体积不小（业务邮件常带大附件），
  // 直接拉全文扫描数百封会达到 GB 级、耗时十几分钟，必然超时。
  // 因此：阶段一只拉 HEADER（几十字节/封）做粗筛，阶段二仅对可能命中的邮件拉正文。
  //
  // ⚠️ 两个关键设计点（曾导致漏检）：
  //  1. 阶段一必须「扫完全部范围再排序截断」，绝不能边扫边停。
  //     邮件服务器返回的 UID 顺序 ≠ 时间顺序，早到的邮件可能排在后面。
  //     若边扫边停，排在后面的新邮件会被limit 截断掉，导致漏检。
  //  2. 命中结果最终按邮件日期倒序排列，保证「最近的在前」。
  //
  // ⚠️ 耗时说明（实测数据）：
  //   拉邮件头：极快（121封约 1 秒）
  //   拉正文：极慢且非线性——5 封 0.5s、10 封 14.7s、20 封 57.6s（131 MB）
  //   原因是商务邮件普遍带大附件，单封可达数 MB。
  // 因此正文扫描严格限量：候选多时只扫最新的一小批，其余靠主题命中。
  // 想要真正的全文检索，应启用本地索引（见 README「性能与局限」）。
  async searchViaLocal(query, folders, scope, limit, days) {
    const since = days > 0 ? new Date(Date.now() - days * 86400000) : null;
    const needle = query.toLowerCase();
    const hits = [];
    const HEADER_BATCH = 200;   // 每批粗筛多少封头部（体积小，可放大）
    const MAX_HEADERS = 2000;   // 单文件夹最多粗筛多少封头部（days=0 时的兜底上限）
    const BODY_BATCH = 5;       // 阶段二每批拉多少封正文（小批量才可控）
    const BODY_MAX_TOTAL = 15;  // 阶段二正文拉取总封数上限（硬上限，防止分钟级耗时）
    const needBody = scope !== 'subject';
    let bodyBudgetWarned = false;

    for (const folder of folders) {
      // 命中数已远超显示需求时才可提前结束（留足余量，避免漏检）
      if (hits.length >= Math.max(limit * 5, 40)) break;

      // ---- 阶段一：拉 HEADER 粗筛（扫完整个范围，不提前中断）----
      const candidates = [];
      let headerTruncated = false;
      try {
        await this.withIMAP((imap) => new Promise((resolve) => {
          imap.openBox(folder, true, (err) => {
            if (err) return resolve();
            // 优化：优先用服务器端 SINCE 做时间过滤。
            // 实测网易 IMAP 的 SINCE 可用且极快（可把数万封压到百封量级，耗时毫秒级），
            // 而 TEXT/SUBJECT 恒返回 0 条（服务端未建全文索引），故时间过滤只能靠 SINCE。
            // 这样把扫描范围从 2000 封压到几十~几百封，耗时从 ~56s 降到 ~8s。
            const doScan = (r) => {
              if (!r || !r.length) return resolve();
              if (r.length > MAX_HEADERS) headerTruncated = true;
              const uids = r.length > MAX_HEADERS ? r.slice(-MAX_HEADERS) : r;
              let cursor = 0;

              const next = () => {
                if (cursor >= uids.length) return resolve();
                const slice = uids.slice(cursor, cursor + HEADER_BATCH);
                cursor += HEADER_BATCH;
                const fetch = imap.fetch(slice, {
                  bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE CONTENT-TYPE)',
                  struct: false
                });
                const pending = [];
                fetch.on('message', (msg) => {
                  let hdr = '';
                  msg.on('body', (s) => {
                    const chunks = [];
                    s.on('data', (c) => chunks.push(c));
                    s.once('end', () => { hdr = Buffer.concat(chunks).toString('utf8'); });
                  });
                  msg.once('attributes', (attrs) => {
                    pending.push(Promise.resolve().then(() => {
                      const h = Imap.parseHeader(hdr);
                      return {
                        uid: attrs.uid,
                        subject: h.subject ? h.subject[0] : '',
                        from: h.from ? h.from[0] : '',
                        date: h.date ? h.date[0] : ''
                      };
                    }));
                  });
                });
                fetch.once('error', () => resolve());
                fetch.once('end', () => {
                  Promise.all(pending).then((rows) => {
                    for (const row of rows) {
                      const d = row.date ? new Date(row.date) : null;
                      if (since && d && !isNaN(d) && d < since) continue;
                      // 头部命中直接进结果（收集全阶段，最后统一排序截断）
                      if (row.subject.toLowerCase().includes(needle)) {
                        hits.push({
                          uid: row.uid, folder,
                          date: row.date, from: row.from,
                          subject: row.subject || '(无主题)',
                          matchedOn: '主题'
                        });
                      } else if (needBody) {
                        // 头部没命中，列为正文候选
                        candidates.push(row);
                      }
                    }
                    next();
                  });
                });
              };
              next();
            };

            // days>0 时先尝试 SINCE（服务端时间过滤，快且省带宽）；
            // 若服务器不支持或返回异常，回退到 ALL 再由本地按日期截断。
            if (since) {
              imap.search([['SINCE', since]], (err2, r) => {
                if (err2 || !r) {
                  imap.search([['ALL']], (err3, r3) => doScan(r3));
                } else {
                  doScan(r);
                }
              });
            } else {
              imap.search([['ALL']], (err3, r3) => doScan(r3));
            }
          });
        }));
      } catch (_) {
        continue;
      }

      // 主题命中已足够多时，跳过正文扫描（正文拉取很慢，且没有必要）
      if (!needBody || candidates.length === 0 || hits.length >= Math.max(limit * 5, 40)) continue;

      // ---- 阶段二：只对候选邮件拉正文匹配 ----
      // 硬性预算：最多拉 BODY_MAX_TOTAL 封正文。超出则停止并告知用户，
      // 因为拉正文耗时非线性（20 封≈58s），不设限会拖到分钟级。
      const bodyNeeded = Math.max(limit * 2, 5);
      const toFetch = sortByDateDesc(candidates);
      let cursor = 0;
      let bodyFetched = 0;
      while (cursor < toFetch.length && hits.length < bodyNeeded && bodyFetched < BODY_MAX_TOTAL) {
        const slice = toFetch.slice(cursor, cursor + BODY_BATCH).slice(0, BODY_MAX_TOTAL - bodyFetched);
        cursor += BODY_BATCH;
        bodyFetched += slice.length;
        let fetched = [];
        try {
          fetched = await this.withIMAP((imap) => new Promise((resolve) => {
            imap.openBox(folder, true, (err) => {
              if (err) return resolve([]);
              const byUid = new Map(toFetch.map((c) => [c.uid, c]));
              const fetch = imap.fetch(slice.map((c) => c.uid), { bodies: '', struct: false });
              const pending = [];
              fetch.on('message', (msg) => {
                let raw = Buffer.alloc(0);
                msg.on('body', (s) => {
                  const chunks = [];
                  s.on('data', (c) => chunks.push(c));
                  s.once('end', () => { raw = Buffer.concat(chunks); });
                });
                msg.once('attributes', (attrs) => {
                  const meta = byUid.get(attrs.uid) || {};
                  pending.push(
                    simpleParser(raw).then(
                      (parsed) => ({ meta, parsed }),
                      () => null
                    )
                  );
                });
              });
              fetch.once('error', () => resolve([]));
              fetch.once('end', () => { Promise.all(pending).then((rs) => resolve(rs.filter(Boolean))); });
            });
          }));
        } catch (_) {
          break;
        }

        for (const { meta, parsed } of fetched) {
          const headers = parsed.headers || {};
          const plainText = parsed.text || '';
          const htmlPart = parsed.html || '';
          const attachments = (parsed.attachments || []).map((a) => a.filename || '').join('\n');
          const hay = `${plainText}\n${htmlPart}\n${attachments}`;
          if (!hay.toLowerCase().includes(needle)) continue;
          hits.push({
            uid: meta.uid,
            folder,
            date: headers.date || meta.date || '',
            from: headers.from?.text || meta.from || '',
            subject: headers.subject || meta.subject || '(无主题)',
            matchedOn: [
              plainText.toLowerCase().includes(needle) ? '正文' : null,
              attachments.toLowerCase().includes(needle) ? '附件名' : null
            ].filter(Boolean).join('、') || '正文'
          });
        }
        // 候选还有剩余但预算已用完 → 记录下来，在结果中提示用户
        if (cursor < toFetch.length && hits.length >= bodyNeeded) bodyBudgetWarned = true;
        if (cursor < toFetch.length && bodyFetched >= BODY_MAX_TOTAL) bodyBudgetWarned = true;
      }
    }
    if (bodyBudgetWarned) hits.truncatedByBodyBudget = true;
    return hits;
  }

  // 从原始邮件里粗提取 HTML 正文（用于正文范围匹配，避免为纯HTML 邮件重复走完整解析）
  parsedHtml(raw) {
    const s = raw.toString('utf8');
    const m = s.match(/<html[\s\S]*?<\/html>/i) || s.match(/<body[\s\S]*?<\/body>/i);
    return m ? m[0] : '';
  }

  // [V1.0 基准实现，保留用于性能对比] legacy searchEmails
  async searchEmails(args = {}) {
    const { query, folder = '', limit = 20, days = 30, scope = 'all', mode = 'auto' } = args;

    if (!query) {
      return { content: [{ type: 'text', text: '❌ 缺少搜索关键词。' }] };
    }

    const searchAll = folder === '' || String(folder).toUpperCase() === 'ALL';
    const usedModes = [];

    try {
      // 第一步：IMAP 服务端搜索
      if (mode === 'auto' || mode === 'imap') {
        try {
          const r = await this.searchViaIMAP(query, searchAll ? 'INBOX' : folder, scope, limit);
          if (r.length) {
            usedModes.push('IMAP 服务端索引');
            let list = r;
            if (days > 0) {
              const since = Date.now() - days * 86400000;
              list = list.filter((e) => !e.date || new Date(e.date).getTime() >= since);
            }
            if (list.length) {
              const sorted = sortByDateDesc(list);
              const shown = sorted.slice(0, limit);
              const notes = [];
              if (sorted.length > shown.length) {
                notes.push(`共命中 ${sorted.length} 封，已按日期倒序显示最近 ${shown.length} 封。如需查看更早的，请缩小 days 或直接搜单号。`);
              }
              return { content: [{ type: 'text', text: this.formatSearchResults(shown, query, usedModes, notes.join('\n')) }] };
            }
          }
          usedModes.push('IMAP 服务端无结果');
        } catch (e) {
          usedModes.push(`IMAP 服务端搜索失败(${e.message})`);
        }
        if (mode === 'imap') {
          return { content: [{ type: 'text', text: this.formatSearchResults([], query, usedModes, '服务端模式已指定，未启用本地回退。') }] };
        }
      }

      // 第二步：本地扫描回退
      let targets = [];
      if (searchAll) {
        const folders = await this.listFoldersRaw();
        // 优先扫有邮件的文件夹，跳过明显系统目录
        targets = folders
          .filter((f) => f.count > 0)
          .sort((a, b) => b.count - a.count)
          .map((f) => f.name);
      } else {
        targets = [folder];
      }

      const hits = await this.searchViaLocal(query, targets, scope, limit, days);
      usedModes.push('本地扫描正文与附件名');
      // 统一按邮件日期倒序（最新的在前），再按 limit 截断。
      // 必须在收集完全部命中后排序——服务器返回的 UID 顺序不代表时间顺序。
      const sorted = sortByDateDesc(hits);
      const shown = sorted.slice(0, limit);
      const notes = [];
      if (sorted.length > shown.length) {
        notes.push(`共命中 ${sorted.length} 封，已按日期倒序显示最近 ${shown.length} 封。如需查看更早的，请缩小 days 或直接搜单号。`);
      }
      if (searchAll) {
        notes.push('本次搜索覆盖全部文件夹。');
      }
      if (hits.truncatedByBodyBudget) {
        notes.push('⚠️ 正文检索范围已触达上限（为避免超时）。主题命中结果完整；正文命中可能不全。建议缩小时间范围，或用「只搜标题」快速定位。');
      }
      return { content: [{ type: 'text', text: this.formatSearchResults(shown, query, usedModes, notes.join('\n')) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ 搜索失败: ${error.message}` }] };
    }
  }

  // 搜索入口（V1.1A）：邮件头优先，不下载正文。
  // 默认值：最近 7 天、INBOX、仅主题。
  async searchEmails(args = {}) {
    return this.searchEmailsV11({
      query: args.query || '',
      from: args.from || '',
      folder: args.folder === undefined ? 'INBOX' : args.folder,
      days: args.days === undefined ? 7 : Number(args.days),
      limit: args.limit === undefined ? 20 : Number(args.limit),
    });
  }


// ============ V1.1A 标题优先检索 ============
// 设计要点（与 V1.0 的本质区别）：
//  1. 只读邮件头（HEADER.FIELDS），绝不触碰正文与附件 —— 性能与token 的关键。
//  2. 关键词过滤完全在 MCP 内部完成，不依赖服务端 TEXT/SUBJECT（实测网易恒返回空）。
//  3. 服务端只负责 SINCE 时间过滤，把候选集缩小到可控范围。
//  4. 明确区分「无匹配」与「未完成」，绝不用空结果掩盖失败。
async searchEmailsV11(args = {}) {
    const { query = '', from = '', folder = 'INBOX', days = 7, limit = 20 } = args;

    const started = Date.now();
    const searchAll = folder === '' || String(folder).toUpperCase() === 'ALL';

    // 诊断信息：用于区分「无匹配」与「未完成」
    const diag = {
      scanned: 0,
      matched: 0,
      foldersScanned: [],
      foldersFailed: [],
      truncated: false,
    };

    try {
      // 1. 确定要扫哪些文件夹
      let targets = [];
      if (searchAll) {
        const folders = await this.listFoldersRaw();
        // 不按 count 过滤 —— 计数异常的文件夹若被静默跳过，会造成「看起来搜全了其实没有」。
        targets = folders.map((f) => f.name);
      } else {
        targets = [folder];
      }

      // 2. 逐个文件夹扫描邮件头
      const allHits = [];
      for (const f of targets) {
        try {
          const r = await this.scanFolderHeaders({
            folder: f, days, query, from,
            limit: Math.max(limit * 5, 100),
          });
          diag.scanned += r.scanned;
          if (!r.error || r.scanned > 0) diag.foldersScanned.push(f);
          if (r.error) diag.foldersFailed.push({ folder: f, error: r.error });
          if (r.truncated) diag.truncated = true;
          allHits.push(...r.hits);
        } catch (e) {
          diag.foldersFailed.push({ folder: f, error: e.message });
        }
      }

      // 3. 内部过滤 + 排序 + 截断
      let hits = allHits;
      if (query) hits = hits.filter((h) => h.subject.toLowerCase().includes(query.toLowerCase()));
      if (from) hits = hits.filter((h) => h.from.toLowerCase().includes(from.toLowerCase()));

      const sorted = sortByDateDesc(hits);
      diag.matched = sorted.length;
      const shown = sorted.slice(0, limit);
      if (sorted.length > shown.length) diag.truncated = true;

      // 4. 完整性判定 —— 关键：不能把失败说成「没有邮件」
      const searchFailed = diag.foldersFailed.length > 0;
      const nothingScanned = diag.scanned === 0 && diag.foldersScanned.length === 0;
      let completeness;
      if (nothingScanned) completeness = 'failed';
      else if (searchFailed || diag.truncated) completeness = 'partial';
      else completeness = 'complete';

      const elapsed = ((Date.now() - started) / 1000).toFixed(2);
      const lines = [];
      lines.push(`🔍 搜索完成（耗时 ${elapsed}s）`);
      lines.push(`📂 扫描文件夹: ${diag.foldersScanned.length}${searchAll ? '（全部）' : ''}`);
      lines.push(`📨 扫描邮件头: ${diag.scanned} 封`);
      lines.push(`✅ 匹配结果: ${diag.matched} 封（显示 ${shown.length} 封）`);
      lines.push(`📊 完整性: ${completenessLabel(completeness)}`);

      if (searchFailed) {
        lines.push('');
        lines.push('⚠️ 以下文件夹扫描失败（结果不完整）:');
        diag.foldersFailed.forEach((f) => lines.push(`   ✗ ${f.folder}: ${f.error}`));
      }
      if (diag.truncated) {
        lines.push('');
        lines.push('⚠️ 结果已截断：匹配数超过显示上限，或文件夹邮件数超过扫描上限。');
        lines.push('   建议缩小 days 范围，或指定具体 folder。');
      }
      if (completeness === 'failed') {
        lines.push('');
        lines.push('❌ 未完成任何扫描。这不是「没有邮件」，而是搜索失败，请检查邮箱连接与配置。');
      }
      if (hits.length === 0 && completeness === 'complete') {
        lines.push('');
        lines.push('ℹ️ 已完整扫描，但确实没有匹配的邮件。');
      }

      if (shown.length) {
        lines.push('');
        for (const h of shown) lines.push(...formatHitV11(h));
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ 搜索失败: ${error.message}\n\n这不是「没有邮件」，而是搜索未能完成。请检查邮箱连接与配置。`,
        }],
      };
    }
  }

  // 扫描单个文件夹的邮件头。只读 HEADER，不下载正文/附件。
  async scanFolderHeaders({ folder, days, query, from, limit }) {
    return this.withIMAP((imap) => new Promise((resolve) => {
      const hits = [];
      let scanned = 0, truncated = false, uidvalidity = null, totalInBox = 0;
      let settled = false, timer, fallbackError = null;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        imap.removeListener('end', interrupted);
        imap.removeListener('close', interrupted);
        imap.removeListener('error', finish);
        resolve({ hits, scanned, truncated, uidvalidity, totalInBox, ...(error || fallbackError ? { error: (error || fallbackError).message || 'IMAP 扫描失败' } : {}) });
      };
      const interrupted = () => finish(new Error('IMAP 扫描连接中断'));
      const activity = () => {
        clearTimeout(timer);
        if (!settled) timer = setTimeout(() => finish(new Error('IMAP 扫描超时（30 秒无响应）')), 30000);
      };
      imap.on('end', interrupted);
      imap.on('close', interrupted);
      imap.on('error', finish);
      activity();

      const runScan = (uids) => {
        if (settled) return;
        if (!Array.isArray(uids) || uids.some(uid => !Number.isInteger(uid) || uid < 1) || new Set(uids).size !== uids.length) {
          return finish(new Error('IMAP 搜索未返回有效的 UID 列表'));
        }
        if (!uids.length) return finish();
        truncated = uids.length > 1000;
        const scanUids = truncated ? uids.slice(-1000) : uids;
        let cursor = 0;
        const next = () => {
          if (settled) return;
          if (cursor >= scanUids.length) return finish();
          const slice = scanUids.slice(cursor, cursor + 200);
          cursor += 200;
          const expected = new Set(slice), seen = new Set(), records = [];
          let fetchEnded = false, advanced = false;
          activity();
          const advance = () => {
            if (settled || !fetchEnded || advanced) return;
            if (records.length !== slice.length) return finish(new Error('邮件头读取中断：返回邮件数量不足'));
            if (!records.every(r => r.complete)) return;
            if (seen.size !== expected.size) return finish(new Error('邮件头读取中断：UID 不完整'));
            advanced = true;
            next();
          };
          let fetch;
          try {
            fetch = imap.fetch(slice, {
              bodies: 'HEADER.FIELDS (DATE FROM TO SUBJECT MESSAGE-ID CONTENT-TYPE)',
              struct: false,
            });
          } catch (error) { return finish(error); }
          fetch.on('error', finish);
          fetch.on('close', () => { if (!fetchEnded) finish(new Error('邮件头读取中断')); });
          fetch.on('message', (msg) => {
            if (settled) return;
            activity();
            const record = { attrs: null, chunks: [], streams: 0, endedStreams: 0, ended: false, complete: false };
            records.push(record);
            const complete = () => {
              if (settled || record.complete || !record.ended) return;
              if (!record.attrs || !record.streams) return finish(new Error('邮件头读取缺少属性或正文流'));
              if (record.endedStreams !== record.streams) return;
              try {
                const uid = record.attrs.uid;
                if (!expected.has(uid) || seen.has(uid)) throw new Error('邮件头 UID 不匹配或重复');
                const h = Imap.parseHeader(Buffer.concat(record.chunks).toString('utf8'));
                const subject = h.subject ? decodeHeaderValue(h.subject[0]) : '';
                const contentType = h['content-type'] ? decodeHeaderValue(h['content-type'][0]) : '';
                const row = {
                  uid, folder, uidvalidity,
                  messageId: h['message-id'] ? decodeHeaderValue(h['message-id'][0]) : null,
                  date: h.date ? h.date[0] : '',
                  from: h.from ? decodeHeaderValue(h.from[0]) : '',
                  to: h.to ? decodeHeaderValue(h.to[0]) : '',
                  subject: subject || '(无主题)',
                  hasAttachment: /multipart\/mixed/i.test(contentType) ? true : null,
                };
                record.complete = true;
                seen.add(uid);
                scanned++;
                if ((!query || row.subject.toLowerCase().includes(query.toLowerCase())) &&
                    (!from || row.from.toLowerCase().includes(from.toLowerCase()))) hits.push(row);
                advance();
              } catch (error) { finish(error); }
            };
            msg.on('error', finish);
            msg.on('close', () => { if (!record.ended) finish(new Error('邮件头消息中断')); });
            msg.on('body', (stream) => {
              if (settled) return;
              record.streams++;
              let ended = false;
              stream.on('error', finish);
              stream.on('data', (chunk) => {
                if (settled) return;
                activity();
                try { record.chunks.push(Buffer.from(chunk)); }
                catch (error) { finish(error); }
              });
              stream.once('end', () => { ended = true; record.endedStreams++; activity(); complete(); });
              stream.once('close', () => { if (!ended) finish(new Error('邮件头流未完整读取')); });
            });
            msg.once('attributes', (attrs) => { record.attrs = attrs; activity(); complete(); });
            msg.once('end', () => { record.ended = true; activity(); complete(); });
          });
          fetch.once('end', () => { fetchEnded = true; activity(); advance(); });
        };
        next();
      };
      const searchAll = () => {
        if (settled) return;
        activity();
        try {
          imap.search([['ALL']], (error, uids) => {
            if (settled) return;
            if (error) return finish(error);
            activity(); runScan(uids);
          });
        } catch (error) { finish(error); }
      };
      try {
        imap.openBox(folder, true, (error, box) => {
          if (settled) return;
          if (error) return finish(new Error(`打开文件夹失败: ${error.message}`));
          uidvalidity = box?.uidvalidity || null;
          totalInBox = box?.messages?.total || 0;
          activity();
          if (days > 0) {
            try {
              imap.search([['SINCE', new Date(Date.now() - days * 86400000)]], (err, uids) => {
                if (settled) return;
                if (err || !Array.isArray(uids)) {
                  fallbackError = new Error(`IMAP SINCE 搜索失败，已回退 ALL，结果可能不完整: ${err?.message || '无有效 UID 列表'}`);
                  searchAll();
                } else { activity(); runScan(uids); }
              });
            } catch (error) { finish(error); }
          } else searchAll();
        });
      } catch (error) { finish(error); }
    }));
  }

  // listFolders 的内部版本，返回结构化数据供搜索使用
  async listFoldersRaw() {
    return this.withIMAP((imap) => new Promise((resolve, reject) => {
      let settled = false;
      const done = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        imap.removeListener('end', interrupted);
        imap.removeListener('close', interrupted);
        imap.removeListener('error', done);
        error ? reject(error) : resolve(value);
      };
      const interrupted = () => done(new Error('IMAP 文件夹检索连接中断'));
      const timer = setTimeout(() => done(new Error('IMAP 文件夹检索超时（30 秒无响应）')), 30000);
      imap.on('end', interrupted);
      imap.on('close', interrupted);
      imap.on('error', done);
      try {
        imap.getBoxes((err, boxes) => {
          if (settled) return;
          if (err) return done(err);
          try {
            if (!boxes || typeof boxes !== 'object') throw new Error('IMAP 未返回有效的文件夹列表');
            const out = [];
            const walk = (obj, prefix) => {
              for (const [name, meta] of Object.entries(obj || {})) {
                if (name === '\\Noselect') continue;
                const full = prefix ? `${prefix}/${name}` : name;
                if (meta.children) walk(meta.children, full);
                else out.push({ name: full, count: meta.messages?.total ?? 0 });
              }
            };
            walk(boxes, '');
            done(null, out);
          } catch (error) { done(error); }
        });
      } catch (error) { done(error); }
    }));
  }

  formatSearchResults(list, query, usedModes, note) {
    const head = `🔍 关键词「${query}」— 命中 ${list.length} 封\n🔎 检索方式: ${usedModes.join(' → ')}\n`;
    if (!list.length) {
      return head + (note ? `\n${note}` : '\n\n未找到匹配邮件。可尝试：换关键词、用更短的词、扩大 days 范围，或用 list_folders 查看邮件分布。');
    }
    const body = list
      .map((e) => {
        const lines = [`📧 UID: ${e.uid}`, `📂 文件夹: ${e.folder || 'INBOX'}`];
        if (e.matchedOn) lines.push(`🎯 命中: ${e.matchedOn}`);
        lines.push(`📅 ${e.date || '(未知日期)'}`);
        lines.push(`👤 ${e.from || '(未知发件人)'}`);
        lines.push(`📝 ${e.subject || '(无主题)'}`);
        lines.push('────────────────────────────────');
        return lines.join('\n');
      })
      .join('\n\n');
    return head + '\n' + body + (note ? `\n\n${note}` : '');
  }

  // [V1.1A 旧实现，保留用于输出体积对比] legacy getEmailContent
  async getEmailContent(args) {
    const { uid } = args;

    return new Promise((resolve, reject) => {
      const imap = this.createIMAPConnection();

      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err, box) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          // 获取指定UID的邮件
          const fetch = imap.fetch([uid], {
            bodies: '',
            struct: true
          });

          fetch.on('message', (msg, seqno) => {
            msg.on('body', (stream, info) => {
              simpleParser(stream, (err, parsed) => {
                imap.end();
                
                if (err) {
                  return reject(err);
                }

                let content = `📧 邮件详情 (UID: ${uid})\n`;
                content += `────────────────────────────────\n`;
                content += `📅 日期: ${parsed.date || '未知'}\n`;
                content += `👤 发件人: ${parsed.from?.text || '未知'}\n`;
                content += `👥 收件人: ${parsed.to?.text || '未知'}\n`;
                
                if (parsed.cc) {
                  content += `📋 抄送: ${parsed.cc.text}\n`;
                }
                
                content += `📝 主题: ${parsed.subject || '(无主题)'}\n`;
                content += `────────────────────────────────\n`;
                
                // 邮件内容
                if (parsed.text) {
                  content += `📄 文本内容:\n${parsed.text}\n`;
                }
                
                if (parsed.html && parsed.html !== parsed.text) {
                  content += `🌐 HTML内容:\n${parsed.html}\n`;
                }

                // 附件信息
                if (parsed.attachments && parsed.attachments.length > 0) {
                  content += `📎 附件列表:\n`;
                  parsed.attachments.forEach((att, index) => {
                    content += `  ${index + 1}. ${att.filename || '未命名'} (${att.size || 0} bytes)\n`;
                  });
                }

                resolve({
                  content: [{
                    type: 'text',
                    text: content
                  }]
                });
              });
            });
          });

          fetch.once('error', (err) => {
            imap.end();
            reject(err);
          });
        });
      });

      imap.once('error', (err) => {
        reject(err);
      });

      imap.connect();
    });
  }

// 获取指定邮件正文（V1.1B）
  // 相比旧版的关键改进：
  //  1. 只返回纯文本正文，不再返回原始 HTML —— 旧版把 HTML 全文一并输出，浪费大量 token
  //  2. 附件只返回元数据（文件名/类型/大小），绝不输出 Buffer/Base64 内容
  //  3. 正文默认上限 12000 字符，超出标记 truncated=true
  //  4. 读取前做大小预检，超大邮件直接报错，避免内存与网络风险
  //  5. 支持指定 folder（旧版硬编码 INBOX，导致非 INBOX 邮件无法读取）
  //  6. 响应最终再做一次长度保护，确保 MCP 返回不会超限
  async getEmailContent(args = {}) {
    const {
      uid,
      folder = 'INBOX',   // 旧版硬编码 INBOX，此处放开但默认不变，保持兼容
      maxChars = 12000,
    } = args;

    if (uid === undefined || uid === null || uid === '') {
      return {
        content: [{ type: 'text', text: '❌ 缺少 uid 参数。\n\n请先用 search_emails 查询邮件的 UID，再调用本工具。' }],
      };
    }
    if (!Number.isInteger(Number(uid))) {
      return { content: [{ type: 'text', text: `❌ uid 必须是整数，收到: ${uid}` }] };
    }

    // 正文上限保护：允许调用方调整，但设硬上限避免误传导致失控
    const HARD_MAX = 200000;
    let cap = Number(maxChars);
    if (!Number.isFinite(cap) || cap <= 0) cap = 12000;
    cap = Math.min(Math.max(cap, 200), HARD_MAX);

    // 超大邮件预检阈值。simpleParser 会把整封邮件（含附件）读进内存，
    // 所以超过这个大小直接拒绝，避免内存/网络风险。
    const SIZE_LIMIT = 20 * 1024 * 1024; // 20 MB

    try {
      return await this.withIMAP((imap) => new Promise((resolve) => {
        imap.openBox(folder, true, (err) => {
          if (err) {
            return resolve({
              content: [{
                type: 'text',
                text: `❌ 打开文件夹「${folder}」失败: ${err.message}\n\n请用 list_folders 确认可用的文件夹名。`,
              }],
            });
          }

          // 第一步：只取 UID 的 RFC822.SIZE 与结构，不下载内容 —— 用于大小预检
          // 预检只取邮件头（RFC822.SIZE 随 header 一起返回），
          // 不请求整封邮件，因此预检阶段零正文下载。
          const probe = imap.fetch([Number(uid)], {
            bodies: 'HEADER.FIELDS (DATE FROM SUBJECT)',
            struct: false,
          });
          let probed = false;
          let msgSize = 0;

          probe.on('message', (msg) => {
            msg.once('attributes', (attrs) => {
              probed = true;
              // node-imap 把 RFC822.SIZE 放在 size 字段
              msgSize = Number(attrs.size || attrs.rfc822size || 0);
            });
          });
          probe.once('error', () => resolve({
            content: [{ type: 'text', text: `❌ 读取邮件信息失败（UID ${uid} @ ${folder}）。该邮件可能不存在或已被删除。` }],
          }));

          probe.once('end', () => {
            if (!probed) {
              return resolve({
                content: [{
                  type: 'text',
                  text: `❌ 未找到 UID ${uid}（文件夹「${folder}」）。\n\n可能原因：该邮件已被删除或移动，或该 UID 属于其他文件夹。\n建议：重新用 search_emails 确认 UID 与文件夹。`,
                }],
              });
            }

            // 大小预检 —— 不允许无限制读取
            if (msgSize > SIZE_LIMIT) {
              return resolve({
                content: [{
                  type: 'text',
                  text: [
                    `❌ 邮件过大，已拒绝读取（UID ${uid} @ ${folder}）`,
                    '',
                    `📦 邮件大小: ${(msgSize / 1024 / 1024).toFixed(2)} MB，超过安全上限 ${(SIZE_LIMIT / 1024 / 1024).toFixed(0)} MB`,
                    '',
                    '原因：该工具需完整解析邮件（含附件），超大邮件会造成明显内存与网络开销。',
                    '建议：请到邮箱客户端直接查看，或改用 search_emails 仅获取元数据。',
                  ].join('\n'),
                }],
              });
            }

            // 第二步：通过预检后才实际下载并解析
            const fetch = imap.fetch([Number(uid)], { bodies: '', struct: false });
            let handled = false;

            fetch.on('message', (msg) => {
              msg.on('body', (stream) => {
                handled = true;
                simpleParser(stream, (perr, parsed) => {
                  if (perr) {
                    return resolve({
                      content: [{ type: 'text', text: `❌ 解析邮件失败（UID ${uid} @ ${folder}）: ${perr.message}` }],
                    });
                  }

                  // ---- 正文：只用纯文本，不返回原始 HTML ----
                  let body = parsed.text || '';
                  let usedFallback = false;

                  // 无纯文本时从 HTML 提取纯文本（不返回 HTML 源码）
                  if (!body.trim() && parsed.html) {
                    body = stripHtmlTags(parsed.html);
                    usedFallback = true;
                  }
                  body = normalizeBodyText(body);

                  const totalChars = body.length;
                  const truncated = totalChars > cap;
                  const shownBody = truncated ? body.slice(0, cap) : body;

                  // ---- 附件：只取元数据，绝不输出内容 ----
                  const atts = (parsed.attachments || []).map((a) => ({
                    filename: a.filename || '未命名',
                    contentType: a.contentType || 'application/octet-stream',
                    size: a.size || 0,
                  }));
                  const totalAttBytes = atts.reduce((n, a) => n + a.size, 0);

                  // ---- 组装结构化输出 ----
                  const L = [];
                  L.push(`📧 邮件正文 (UID ${uid} @ ${folder})`);
                  L.push('─'.repeat(32));
                  L.push(`📅 日期: ${parsed.date || '未知'}`);
                  L.push(`👤 发件人: ${parsed.from?.text || '未知'}`);
                  L.push(`👥 收件人: ${parsed.to?.text || '未知'}`);
                  if (parsed.cc) L.push(`📋 抄送: ${parsed.cc.text}`);
                  L.push(`📝 主题: ${parsed.subject || '(无主题)'}`);
                  L.push('─'.repeat(32));

                  L.push(`📏 正文长度: ${totalChars} 字符${usedFallback ? '（由 HTML 提取）' : ''}`);
                  if (truncated) {
                    L.push(`✂️ 已截断: 仅显示前 ${cap} 字符 / 实际 ${totalChars} 字符（truncated=true）`);
                    L.push(`   如需更多内容，请提高 maxChars 参数（当前上限 ${HARD_MAX}）`);
                  } else {
                    L.push('✂️ 截断: 否（truncated=false）');
                  }

                  L.push('─'.repeat(32));
                  L.push('📎 附件:');
                  if (atts.length === 0) {
                    L.push('   （无）');
                  } else {
                    L.push(`   共 ${atts.length} 个，合计 ${formatBytes(totalAttBytes)}`);
                    atts.forEach((a, i) => {
                      // 编号与 get_email_attachment 的 attachmentIndex 对应（1-based）
                      L.push(`   [${i + 1}] ${a.filename}`);
                      L.push(`      类型: ${a.contentType} | 大小: ${formatBytes(a.size)}`);
                    });
                    L.push('   说明: 可用 get_email_attachment 按 [编号] 获取指定附件。');
                  }

                  L.push('─'.repeat(32));
                  L.push('📄 正文:');
                  L.push(shownBody || '(正文为空)');

                  if (truncated) {
                    L.push('');
                    L.push('【正文已截断，以上为前 ' + cap + ' 字符】');
                  }

                  let text = L.join('\n');

                  // ---- 最终长度保护 ----
                  const RESPONSE_LIMIT = 120000;
                  if (text.length > RESPONSE_LIMIT) {
                    text = text.slice(0, RESPONSE_LIMIT) +
                      `\n\n【响应超长已强制截断，最终长度 ${RESPONSE_LIMIT} 字符】`;
                  }

                  resolve({ content: [{ type: 'text', text }] });
                });
              });
            });

            fetch.once('error', () => {
              if (!handled) {
                resolve({
                  content: [{ type: 'text', text: `❌ 下载邮件失败（UID ${uid} @ ${folder}）。` }],
                });
              }
            });
            fetch.once('end', () => {
              if (!handled) {
                resolve({
                  content: [{ type: 'text', text: `❌ 未找到 UID ${uid}（文件夹「${folder}」）。` }],
                });
              }
            });
          });
        });
      }));
    } catch (error) {
      return {
        content: [{ type: 'text', text: `❌ 读取正文失败: ${error.message}` }],
      };
    }
  }

// 获取指定邮件的单个附件（V1.2）
  // 沿用 V1.1B 的 IMAP 连接与 simpleParser，不自写 MIME 解析。
  // 只提取指定编号的附件，其余附件内容一律不输出。
  // 附件落盘到受控目录，响应中只返回元数据与路径，绝不返回二进制内容。
  async getEmailAttachment(args = {}) {
    const {
      folder = 'INBOX',
      uid,
      uidValidity,
      attachmentIndex = 1,   // 1-based，与 get_email_content 中的附件编号一致
    } = args;

    const ATTACH_SIZE_LIMIT = 10 * 1024 * 1024;  // 单附件 10MB
    const MAIL_SIZE_LIMIT = 20 * 1024 * 1024;    // 整封邮件 20MB（沿用 V1.1B）

    if (uid === undefined || uid === null || uid === '') {
      return { content: [{ type: 'text', text: '❌ 缺少 uid 参数。\n\n请先用 search_emails 查询邮件 UID。' }] };
    }
    if (!Number.isInteger(Number(uid))) {
      return { content: [{ type: 'text', text: `❌ uid 必须是整数，收到: ${uid}` }] };
    }
    const idx = Number(attachmentIndex);
    if (!Number.isInteger(idx) || idx < 1) {
      return { content: [{ type: 'text', text: `❌ attachmentIndex 必须是 ≥1 的整数，收到: ${attachmentIndex}\n\n附件编号从 1 开始，与 get_email_content 返回的附件清单一致。` }] };
    }

    // 输出目录预检
    let dirInfo;
    try { dirInfo = getAttachDir(); }
    catch (error) {
      return { content: [{ type: 'text', text: `❌ 附件目录安全校验失败: ${error.message}` }] };
    }
    if (!dirInfo) {
      return {
        content: [{
          type: 'text',
          text: [
            '❌ 无法确定可用的附件输出目录。',
            '',
            '已尝试的候选位置均不可写。',
            '解决方案：设置环境变量 EMAIL_ATTACHMENT_DIR 指向一个可写目录后重启 MCP。',
          ].join('\n'),
        }],
      };
    }

    try {
      return await this.withIMAP((imap) => new Promise((resolve) => {
        imap.openBox(folder, true, (err, box) => {
          if (err) {
            return resolve({ content: [{ type: 'text', text: `❌ 打开文件夹「${folder}」失败: ${err.message}\n\n请用 list_folders 确认文件夹名。` }] });
          }

          const currentUidValidity = box.uidvalidity || null;

          // 预检：只取头部，拿 RFC822.SIZE，不下载正文
          const probe = imap.fetch([Number(uid)], {
            bodies: 'HEADER.FIELDS (DATE FROM SUBJECT MESSAGE-ID)',
            struct: false,
          });
          let probed = false;
          let msgSize = 0;
          let hdr = '';

          probe.on('message', (msg) => {
            msg.once('attributes', (attrs) => {
              probed = true;
              msgSize = Number(attrs.size || attrs.rfc822size || 0);
            });
            msg.on('body', (s) => {
              const chunks = [];
              s.on('data', (c) => chunks.push(c));
              s.once('end', () => { hdr = Buffer.concat(chunks).toString('utf8'); });
            });
          });
          probe.once('error', () => resolve({
            content: [{ type: 'text', text: `❌ 读取邮件信息失败（UID ${uid} @ ${folder}）。邮件可能不存在或已被删除。` }],
          }));

          probe.once('end', () => {
            if (!probed) {
              return resolve({
                content: [{ type: 'text', text: `❌ 未找到 UID ${uid}（文件夹「${folder}」）。\n\n可能原因：邮件已删除/移动，或该 UID 属于其他文件夹。\n建议：重新用 search_emails 确认 UID 与文件夹。` }],
              });
            }

            // UIDVALIDITY 校验 —— 防止 UID 已被复用导致读错邮件
            if (uidValidity !== undefined && uidValidity !== null && uidValidity !== '' && currentUidValidity) {
              if (Number(uidValidity) !== Number(currentUidValidity)) {
                return resolve({
                  content: [{
                    type: 'text',
                    text: [
                      `❌ UIDVALIDITY 不匹配，已中止读取（UID ${uid} @ ${folder}）`,
                      '',
                      `   调用方提供: ${uidValidity}`,
                      `   服务器当前: ${currentUidValidity}`,
                      '',
                      'UIDVALIDITY 变化意味着服务器上的 UID 已被重新分配。',
                      '继续按旧 UID 读取有读到其他邮件的风险，因此已拒绝。',
                      '建议：重新用 search_emails 获取最新的 UID 与 UIDVALIDITY。',
                    ].join('\n'),
                  }],
                });
              }
            }

            if (msgSize > MAIL_SIZE_LIMIT) {
              return resolve({
                content: [{
                  type: 'text',
                  text: [
                    `❌ 邮件过大，已拒绝处理（UID ${uid} @ ${folder}）`,
                    '',
                    `📦 邮件大小: ${(msgSize / 1024 / 1024).toFixed(2)} MB，超过上限 ${(MAIL_SIZE_LIMIT / 1024 / 1024).toFixed(0)} MB`,
                    '',
                    '说明：本工具需完整解析邮件以提取附件，超大邮件会造成明显内存与网络开销。',
                    '建议：改用 get_email_content 仅获取附件元数据，或到邮箱客户端手动下载。',
                  ].join('\n'),
                }],
              });
            }

            // 下载并解析
            const fetch = imap.fetch([Number(uid)], { bodies: '', struct: false });
            let handled = false;

            fetch.on('message', (msg) => {
              msg.on('body', (stream) => {
                handled = true;
                simpleParser(stream, (perr, parsed) => {
                  if (perr) {
                    return resolve({ content: [{ type: 'text', text: `❌ 解析邮件失败（UID ${uid} @ ${folder}）: ${perr.message}` }] });
                  }

                  const atts = parsed.attachments || [];

                  if (atts.length === 0) {
                    return resolve({
                      content: [{ type: 'text', text: `📭 该邮件无附件（UID ${uid} @ ${folder}）。` }],
                    });
                  }

                  if (idx > atts.length) {
                    return resolve({
                      content: [{
                        type: 'text',
                        text: [
                          `❌ 附件编号 ${idx} 不存在（UID ${uid} @ ${folder}）`,
                          '',
                          `该邮件共有 ${atts.length} 个附件，可用编号 1 ~ ${atts.length}：`,
                          ...atts.map((a, i) => `   ${i + 1}. ${sanitizeFilename(a.filename, `附件${i + 1}`)} (${formatBytes(a.size || 0)})`),
                        ].join('\n'),
                      }],
                    });
                  }

                  const att = atts[idx - 1];
                  const buf = att.content || Buffer.alloc(0);
                  const size = buf.length;

                  // 单附件大小上限
                  if (size > ATTACH_SIZE_LIMIT) {
                    return resolve({
                      content: [{
                        text: [
                          `❌ 附件过大，已拒绝保存（编号 ${idx}）`,
                          '',
                          `📦 文件名: ${sanitizeFilename(att.filename)}`,
                          `📦 大小: ${formatBytes(size)}，超过单附件上限 ${(ATTACH_SIZE_LIMIT / 1024 / 1024).toFixed(0)} MB`,
                          '',
                          '说明：可改用 get_email_content 查看该附件的元数据，或到邮箱客户端手动下载。',
                        ].join('\n'),
                        type: 'text',
                      }],
                    });
                  }

                  // 文件名安全处理
                  const safeName = sanitizeFilename(att.filename, `附件${idx}`);
                  const digest = sha256(buf);
                  const fmt = detectFormat(att.filename, att.contentType);
                  let resolvedTarget;
                  try {
                    resolvedTarget = saveAttachmentFiles(dirInfo, safeName, buf, digest);
                  } catch (werr) {
                    return resolve({
                      content: [{ type: 'text', text: `❌ 保存附件失败: ${werr.message}\n\n目录: ${dirInfo.dir}` }],
                    });
                  }

                  const L = [];
                  L.push(`✅ 附件已保存`);
                  L.push('─'.repeat(32));
                  L.push(`📎 附件编号: ${idx} / ${atts.length}`);
                  L.push(`📄 原始文件名: ${att.filename || '(无文件名)'}`);
                  L.push(`🔒 安全文件名: ${path.basename(resolvedTarget)}`);
                  L.push(`🧩 识别格式: ${fmt}`);
                  L.push(`📁 保存路径: ${resolvedTarget}`);
                  L.push(`📏 字节大小: ${size.toLocaleString()} bytes (${formatBytes(size)})`);
                  L.push(`🔑 SHA256: ${digest}`);
                  L.push(`📄 MIME 类型: ${att.contentType || '未知'}`);
                  L.push(`📂 输出目录来源: ${dirInfo.label}`);
                  L.push(`🔐 文件权限: 0600（仅当前用户可读写）`);
                  L.push('─'.repeat(32));
                  L.push('说明：');
                  L.push('· 响应中不含附件内容，需用文件读取工具打开上述路径查看');
                  L.push('· 附件未被打开、执行或解压');
                  L.push('· 同名文件不会覆盖，已自动追加序号');

                  resolve({ content: [{ type: 'text', text: L.join('\n') }] });
                });
              });
            });

            fetch.once('error', () => {
              if (!handled) resolve({ content: [{ type: 'text', text: `❌ 下载邮件失败（UID ${uid} @ ${folder}）。` }] });
            });
            fetch.once('end', () => {
              if (!handled) resolve({ content: [{ type: 'text', text: `❌ 未找到 UID ${uid}（文件夹「${folder}」）。` }] });
            });
          });
        });
      }));
    } catch (error) {
      return { content: [{ type: 'text', text: `❌ 获取附件失败: ${error.message}` }] };
    }
  }

  // 设置邮箱账号（自动配置）
  async setupEmailAccount(args) {
    const { email, password, provider } = args;

    // 设置用户名和密码
    process.env.EMAIL_USER = email;
    process.env.EMAIL_PASSWORD = password;

    let detectedProvider = provider;
    let config;

    try {
      // 如果没有指定提供商，则自动检测
      if (!detectedProvider) {
        detectedProvider = this.detectEmailProvider(email);
        if (!detectedProvider) {
          return {
            content: [{
              type: 'text',
              text: `❌ 无法识别邮箱类型: ${email}\n\n支持的邮箱类型请使用 list_supported_providers 查看，或手动指定 provider 参数。`
            }]
          };
        }
      }

      // 自动配置服务器设置
      config = this.autoConfigureByProvider(detectedProvider);

      let result = `✅ 邮箱账号设置成功！\n\n`;
      result += `📧 邮箱地址: ${email}\n`;
      result += `🏢 邮箱提供商: ${config.name}\n`;
      result += `📤 SMTP服务器: ${config.smtp.host}:${config.smtp.port} (SSL: ${config.smtp.secure})\n`;
      result += `📥 接收协议: ${config.usePOP3 ? 'POP3' : 'IMAP'}\n`;
      
      if (config.usePOP3) {
        result += `📥 POP3服务器: ${config.pop3.host}:${config.pop3.port} (SSL: ${config.pop3.secure})\n`;
      } else {
        result += `📥 IMAP服务器: ${config.imap.host}:${config.imap.port} (SSL: ${config.imap.secure})\n`;
      }

      result += `\n💡 提示: 配置已自动完成，您现在可以使用邮件功能了！`;

      return {
        content: [{
          type: 'text',
          text: result
        }]
      };

    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ 邮箱设置失败: ${error.message}`
        }]
      };
    }
  }

  // 列出支持的邮箱提供商
  async listSupportedProviders() {
    let result = `📋 支持的邮箱提供商:\n\n`;
    
    for (const [provider, config] of Object.entries(EMAIL_CONFIGS)) {
      result += `🏢 ${config.name} (${provider})\n`;
      result += `   域名: ${config.domains.join(', ')}\n`;
      result += `   推荐协议: ${config.usePOP3 ? 'POP3' : 'IMAP'}\n`;
      result += `   示例: user@${config.domains[0]}\n\n`;
    }

    result += `💡 使用方法:\n`;
    result += `1. 使用 setup_email_account 工具\n`;
    result += `2. 填写完整邮箱地址和密码/授权码\n`;
    result += `3. 系统会自动识别并配置对应的邮箱服务器\n\n`;
    result += `⚠️  注意: 请确保已在对应邮箱中开启POP3/IMAP/SMTP服务并获取授权码！`;

    return {
      content: [{
        type: 'text',
        text: result
      }]
    };
  }

  // 配置邮箱服务器
  async configureEmailServer(args) {
    const { smtpHost, smtpPort, smtpSecure, imapHost, imapPort, imapSecure, user, password } = args;

    // 更新环境变量
    if (smtpHost) process.env.EMAIL_SMTP_HOST = smtpHost;
    if (smtpPort) process.env.EMAIL_SMTP_PORT = smtpPort.toString();
    if (smtpSecure !== undefined) process.env.EMAIL_SMTP_SECURE = smtpSecure.toString();
    if (imapHost) process.env.EMAIL_IMAP_HOST = imapHost;
    if (imapPort) process.env.EMAIL_IMAP_PORT = imapPort.toString();
    if (imapSecure !== undefined) process.env.EMAIL_IMAP_SECURE = imapSecure.toString();
    if (user) process.env.EMAIL_USER = user;
    if (password) process.env.EMAIL_PASSWORD = password;

    let configInfo = '邮箱配置已更新：\n';
    configInfo += `SMTP服务器: ${process.env.EMAIL_SMTP_HOST || '未设置'}\n`;
    configInfo += `SMTP端口: ${process.env.EMAIL_SMTP_PORT || '未设置'}\n`;
    configInfo += `SMTP SSL: ${process.env.EMAIL_SMTP_SECURE || '未设置'}\n`;
    configInfo += `IMAP服务器: ${process.env.EMAIL_IMAP_HOST || '未设置'}\n`;
    configInfo += `IMAP端口: ${process.env.EMAIL_IMAP_PORT || '未设置'}\n`;
    configInfo += `IMAP SSL: ${process.env.EMAIL_IMAP_SECURE || '未设置'}\n`;
    configInfo += `用户: ${user || '未更新'}`;

    return {
      content: [
        {
          type: 'text',
          text: configInfo
        }
      ]
    };
  }

  // 测试连接
  async testConnection(args = {}) {
    const { testType = 'both' } = args;
    let results = [];

    try {
      // 测试SMTP连接
      if (testType === 'smtp' || testType === 'both') {
        try {
          const transporter = this.createSMTPTransporter();
          await transporter.verify();
          results.push('✅ SMTP服务器连接测试成功！');
        } catch (error) {
          results.push(`❌ SMTP连接测试失败: ${error.message}`);
        }
      }

      // 测试IMAP连接
      if (testType === 'imap' || testType === 'both') {
        try {
          await new Promise((resolve, reject) => {
            const imap = this.createIMAPConnection();
            
            imap.once('ready', () => {
              imap.end();
              resolve();
            });
            
            imap.once('error', (err) => {
              reject(err);
            });
            
            imap.connect();
          });
          results.push('✅ IMAP服务器连接测试成功！');
        } catch (error) {
          results.push(`❌ IMAP连接测试失败: ${error.message}`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: results.join('\n')
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ 测试失败: ${error.message}`
          }
        ]
      };
    }
  }

  async run() {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('通用邮件MCP服务器已启动');
    } catch (error) {
      console.error('MCP服务器启动失败:', error.message);
      throw error;
    }
  }
}

// 导出类供测试使用
export { UniversalEmailMCPServer };

// 如果直接运行此文件，启动服务器
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === modulePath) {
  const server = new UniversalEmailMCPServer();
  server.run().catch(console.error);
} 

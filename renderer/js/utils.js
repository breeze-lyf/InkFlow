// ============ 工具函数 ============
'use strict';

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function throttle(fn, ms) {
  let last = 0, timer = null;
  return function (...args) {
    const now = Date.now();
    const run = () => { last = Date.now(); fn.apply(this, args); };
    if (now - last >= ms) run();
    else { clearTimeout(timer); timer = setTimeout(run, ms - (now - last)); }
  };
}

// 路径工具：跨平台，统一按正斜杠处理（Windows 的 Node/Electron API 均接受 /）
const P = {
  // 归一化为正斜杠（Windows 下主进程返回 \ 分隔的路径）
  normalize(p) { return p ? p.replace(/\\/g, '/') : p; },
  basename(p) { return P.normalize(p).split('/').pop() || p; },
  dirname(p) {
    const n = P.normalize(p);
    const i = n.lastIndexOf('/');
    if (i < 0) return n;
    if (i === 0) return '/';
    // 保留 Windows 盘符根（C:/ 的目录是 C:/ 本身）
    return n.slice(0, i) || '/';
  },
  extname(p) {
    const b = P.basename(p);
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i) : '';
  },
  join(...parts) {
    return P.normalize(parts.join('/')).replace(/([^:])\/+/g, '$1/');
  },
  stem(p) {
    const b = P.basename(p);
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(0, i) : b;
  },
  // 判断绝对路径：POSIX /x、Windows C:/x 或 C:\x
  isAbsolute(p) {
    return /^([a-zA-Z]:[\\/]|\/)/.test(p);
  },
  // 解析相对路径（相对 baseDir），处理 ./ ../
  resolve(baseDir, rel) {
    const nrel = P.normalize(rel);
    if (P.isAbsolute(nrel)) return nrel;
    const nbase = P.normalize(baseDir);
    const m = nbase.match(/^([a-zA-Z]:)?\//);
    const prefix = m && m[1] ? m[1] : '';
    const stack = nbase.replace(/^[a-zA-Z]:\//, '/').split('/').filter(Boolean);
    for (const seg of nrel.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') stack.pop();
      else stack.push(seg);
    }
    return prefix + '/' + stack.join('/');
  },
};

// 模糊匹配：子序列匹配 + 打分（连续、词首加分），返回 null 或 {score, ranges}
function fuzzyMatch(query, text) {
  if (!query) return { score: 0, ranges: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let ti = 0, score = 0, streak = 0;
  const ranges = [];
  let start = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === ch) { found = ti; break; }
      ti++;
    }
    if (found === -1) return null;
    if (start === -1) start = found;
    // 打分
    if (found === 0) score += 10;
    else if (/[\s\-_/.]/.test(t[found - 1])) score += 8;
    if (ranges.length && found === ranges[ranges.length - 1] + 1) {
      streak += 1;
      score += 5 + streak * 2;
    } else {
      streak = 0;
    }
    ranges.push(found);
    ti = found + 1;
  }
  score -= (t.length - q.length) * 0.08; // 短结果优先
  return { score, ranges };
}

// 高亮命中区间，返回 HTML 字符串
function highlightRanges(text, ranges) {
  if (!ranges || !ranges.length) return escapeHtml(text);
  const set = new Set(ranges);
  let out = '';
  let inB = false;
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit && !inB) { out += '<b>'; inB = true; }
    if (!hit && inB) { out += '</b>'; inB = false; }
    out += escapeHtml(text[i]);
  }
  if (inB) out += '</b>';
  return out;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 字数统计（CJK 按字、英文按词）
function countWords(md) {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')   // 去掉代码块
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[[^\]]*\]\([^)]*\)/g, (m) => m.replace(/\]\([^)]*\)/, ']')) // 链接保留文字
    .replace(/[#>*\-+|=~^]/g, ' ');
  const cjk = (text.match(/[㐀-鿿豈-﫿]/gu) || []).length;
  const latinWords = (text.match(/[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*/g) || []).length;
  return cjk + latinWords;
}

function formatNumber(n) {
  return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

// 快捷键符号本地化：mac 用 ⌘⌥⇧，Windows/Linux 转为 Ctrl/Alt/Shift（修饰键按惯例重排）
function fmtKbd(s, isMac) {
  if (isMac || !s) return s;
  return s.replace(/[⌘⌥⇧]+/g, (mods) => {
    const parts = [];
    if (mods.includes('⌘')) parts.push('Ctrl');
    if (mods.includes('⌥')) parts.push('Alt');
    if (mods.includes('⇧')) parts.push('Shift');
    return parts.join('+') + '+';
  });
}

function toast(msg, ms = 2200) {
  const box = $('#toast');
  const item = el('div', 'toast-item', msg);
  box.appendChild(item);
  setTimeout(() => {
    item.classList.add('out');
    setTimeout(() => item.remove(), 350);
  }, ms);
}

// SVG 图标库
const ICONS = {
  file: '<svg viewBox="0 0 16 16" fill="none"><path d="M9.5 1.5h-5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-8l-3-3z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.3 1.8v3h3" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  folder: '<svg viewBox="0 0 16 16" fill="none"><path d="M1.5 4a1 1 0 0 1 1-1h3l1.5 2h6.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  caret: '<svg viewBox="0 0 10 10" fill="none"><path d="M3.5 2l3 3-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  cmd: '<svg viewBox="0 0 16 16" fill="none"><path d="M4.5 4.5h7v7h-7z" stroke="currentColor" stroke-width="1.2"/><path d="M2 2h3M2 14h3M11 2h3M11 14h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  clock: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5V8l2.5 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
};

// Sổ Chi: giao diện và logic chính.
import * as DB from './db.js';
import { parseLocal, parseBankSMS, amountFromText, norm, ymd } from './parse.js';
import { parseWithAI, testKey } from './ai.js';
import { lock, unlock, sig, findChat, sendText, editText, pin, getPinned, download, sendFile, replaceFile } from './backup.js';
import { fetchInbox, ackInbox } from './sync.js';

/* ---------- tiện ích ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const fmt = n => Math.round(n).toLocaleString('vi-VN') + '₫';
const fmtNum = n => (n ? Math.round(n).toLocaleString('vi-VN') : '');
const fmtS = n => {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + 'tr';
  if (a >= 1e3) return Math.round(n / 1e3).toLocaleString('vi-VN') + 'k';
  return String(Math.round(n));
};
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, k) => { const r = new Date(d); r.setDate(r.getDate() + k); return r; };
const mkey = d => ymd(d).slice(0, 7);
const WDN = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const W = { bank: 'Ngân hàng', cash: 'Tiền mặt' };
const TYPES = { chi: 'Chi', thu: 'Thu', chuyen: 'Chuyển ví' };

const DEF_CATS = [
  { name: 'Ăn uống', color: '#c4572f' }, { name: 'Cà phê', color: '#7b5e8c' }, { name: 'Đi lại', color: '#1f3350' },
  { name: 'Hoá đơn', color: '#5e7a3e' }, { name: 'Mua sắm', color: '#c2557a' }, { name: 'Khác', color: '#8a8372' },
];
const V2_COLORS = { 'Ăn uống': '#e8590c', 'Cà phê': '#7048e8', 'Đi lại': '#1c7ed6', 'Hoá đơn': '#2b8a3e', 'Mua sắm': '#d6336c', 'Khác': '#868e96' };
const OLD_COLORS = { 'Ăn uống': '#f59e0b', 'Cà phê': '#b45309', 'Đi lại': '#0ea5e9', 'Hoá đơn': '#8b5cf6', 'Mua sắm': '#ec4899', 'Khác': '#94a3b8' };
const ICONS = {
  food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 2-3 5s1 4 3 4v9"/>',
  cafe: '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3"/>',
  move: '<path d="M5 17h14M6 17l1.5-6h9L18 17M7.5 11 9 6h6l1.5 5"/><circle cx="8" cy="18.5" r="1.5"/><circle cx="16" cy="18.5" r="1.5"/>',
  bill: '<path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z"/>',
  shop: '<path d="M5 8h14l-1 12H6L5 8zM9 8V6a3 3 0 0 1 6 0v2"/>',
  other: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  in: '<path d="M12 5v14M5 12l7 7 7-7"/>',
};
const ICON_BY_NAME = { 'an uong': 'food', 'ca phe': 'cafe', 'di lai': 'move', 'hoa don': 'bill', 'mua sam': 'shop' };
const badge = (name, color, force) => `<span class="ic" style="background:${color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[force || ICON_BY_NAME[norm(name || '')] || 'other']}</svg></span>`;
const DEF_SET = {
  budget: 6000000, dailyBudget: 0, recurring: [], sync: { url: '', token: '' }, bankBal: null, lastBal: null, seen: [], lastSync: null, categories: DEF_CATS, open: { bank: 0, cash: 0 }, apiKey: '', model: 'claude-haiku-5-5',
  ai: true, autosave: true, altInput: false, usdVnd: 25500, price: { in: 0, out: 0 }, usage: {}, defWallet: 'cash', theme: 'auto', lastBackup: null, learned: {}, welcomed: false,
  schedCheckDays: 0, schedCheckAt: null,
  tg: { token: '', chat: '', pass: '', lastAt: null, lastSig: '', err: '', slots: [], next: 0, index: null },
};

const S = { lm: 'day', ld: ymd(new Date()), lmk: mkey(new Date()), lcat: '', q: '', tx: [], set: null, queue: [], tab: 'home', month: mkey(new Date()), wf: 'all', busy: false, C: null, pill: {} };
const el = {};

/* ---------- dữ liệu ---------- */
async function load() {
  const [tx, meta, queue] = await Promise.all([DB.getAll('tx'), DB.get('meta', 'settings'), DB.getAll('queue')]);
  S.set = Object.assign(structuredClone(DEF_SET), meta || {});
  S.set.tg = Object.assign(structuredClone(DEF_SET.tg), S.set.tg);
  const NEWC = Object.fromEntries(DEF_CATS.map(c => [c.name, c.color]));
  S.set.categories.forEach(c => { if (OLD_COLORS[c.name] === c.color || V2_COLORS[c.name] === c.color) c.color = NEWC[c.name]; });
  S.tx = tx; S.queue = queue.sort((a, b) => a.createdAt - b.createdAt);
  sortTx();
}
const sortTx = () => S.tx.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
const saveSet = () => DB.put('meta', S.set, 'settings');
const catColor = n => S.set.categories.find(c => c.name === n)?.color || '#94a3b8';
const catNames = () => S.set.categories.map(c => c.name);

function monthInfo(mk) {
  const [y, m] = mk.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const days = Array(dim).fill(0);
  S.tx.forEach(t => { if (t.type === 'chi' && !t.adjust && t.date.startsWith(mk)) days[+t.date.slice(8) - 1] += t.amount; });
  return { y, m, dim, days, total: days.reduce((a, b) => a + b, 0) };
}
const dayTotal = ds => S.tx.reduce((a, t) => a + (t.type === 'chi' && !t.adjust && t.date === ds ? t.amount : 0), 0);

function balances() {
  const b = { bank: S.set.open.bank || 0, cash: S.set.open.cash || 0 };
  S.tx.forEach(t => {
    if (t.type === 'chi') b[t.wallet] -= t.amount;
    else if (t.type === 'thu') b[t.wallet] += t.amount;
    else { b[t.wallet] -= t.amount; b[t.toWallet] += t.amount; }
  });
  return b;
}
function dlabel(ds) {
  const t = ymd(new Date());
  if (ds === t) return 'Hôm nay';
  if (ds === ymd(addDays(new Date(), -1))) return 'Hôm qua';
  return ds.slice(8) + '/' + ds.slice(5, 7);
}

/* ---------- hiển thị chung ---------- */
const dayLimit = dim => (S.set.dailyBudget > 0 ? S.set.dailyBudget : S.set.budget / dim);
function txRow(t, hideDate) {
  let title, sub, amt, cls = '', color, force = null;
  if (t.type === 'chuyen') { title = 'Chuyển ví'; sub = `${W[t.wallet]} → ${W[t.toWallet]}${hideDate ? '' : ' · ' + dlabel(t.date)}`; amt = fmt(t.amount); color = '#64748b'; force = 'swap'; }
  else {
    title = t.note || t.category; sub = `${t.category} · ${W[t.wallet]}${hideDate ? '' : ' · ' + dlabel(t.date)}`;
    amt = (t.type === 'thu' ? '+' : '−') + fmt(t.amount); cls = t.type === 'thu' ? 'in' : '';
    color = t.type === 'thu' ? 'var(--c5)' : catColor(t.category); if (t.type === 'thu') force = 'in';
  }
  return `<button class="li" data-act="edit" data-id="${t.id}">${badge(t.category, color, force)}<div class="n"><b>${esc(title)}</b><span>${esc(sub)}</span></div><div class="a ${cls}">${amt}</div></button>`;
}

/* ---------- Hôm nay ---------- */
function todayCalc() {
  const now = new Date(), info = monthInfo(mkey(now)), d = now.getDate(), budget = S.set.budget;
  const todaySp = info.days[d - 1], before = info.total - todaySp;
  const upc = upcomingTotal(now);
  const auto = Math.round((budget - before - upc) / (info.dim - d + 1));
  const fixed = S.set.dailyBudget > 0, allow = fixed ? S.set.dailyBudget : auto;
  const rec = S.tx.reduce((a, t) => a + (t.recur && t.type === 'chi' && t.date.startsWith(mkey(now)) ? t.amount : 0), 0);
  const fc = (info.total - rec) / d * info.dim + rec + upc;
  return { now, info, d, budget, todaySp, auto, fixed, allow, upc, fc, remain: allow - todaySp };
}
// Trang Tổng quan: các khối đẹp (vòng tròn, bốn khối vuông, biểu đồ 7 ngày) và sắp đến hạn.
const greet = h => (h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối');
function ringSVG(pct) {
  const r = 84, c = 2 * Math.PI * r, over = pct > 1, p = Math.min(1, pct);
  return `<svg viewBox="0 0 200 200" class="ring" aria-hidden="true"><circle cx="100" cy="100" r="${r}" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="14"/><circle cx="100" cy="100" r="${r}" fill="none" stroke="${over ? '#fecaca' : '#fff'}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(over ? 1 : p) * c} ${c}" transform="rotate(-90 100 100)"/></svg>`;
}
function weekSVG(info) {
  const now = new Date(), lim = dayLimit(info.dim);
  const days = [...Array(7)].map((_, i) => { const dt = addDays(now, i - 6); const ds = ymd(dt); return { ds, dt, v: dayTotal(ds) }; });
  const mx = Math.max(lim * 1.25, ...days.map(x => x.v), 1), Wd = 340, H = 112, base = 90, slot = Wd / 7, bw = 26;
  const ly = base - lim / mx * 70;
  let s = `<svg viewBox="0 0 ${Wd} ${H}" width="100%" role="img" aria-label="Chi tiêu 7 ngày qua"><line x1="0" x2="${Wd}" y1="${ly}" y2="${ly}" stroke="var(--fg)" stroke-opacity=".35" stroke-dasharray="3 4"/>`;
  days.forEach((x, i) => {
    const h = x.v / mx * 70, cx = i * slot + slot / 2, isT = i === 6;
    s += `<rect x="${cx - bw / 2}" y="${base - Math.max(h, x.v ? 3 : 0)}" width="${bw}" height="${Math.max(h, x.v ? 3 : 0)}" rx="8" fill="${x.v > lim ? 'var(--warn)' : 'var(--accent)'}" opacity="${isT ? 1 : .55}"/>`;
    if (x.v) s += `<text x="${cx}" y="${base - h - 5}" text-anchor="middle" style="font-size:10px;fill:var(--fg)">${fmtS(x.v)}</text>`;
    s += `<text x="${cx}" y="${base + 18}" text-anchor="middle" style="font-size:11px;${isT ? 'font-weight:700;fill:var(--fg)' : ''}">${['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][x.dt.getDay()]}</text>`;
    s += `<rect x="${i * slot}" y="0" width="${slot}" height="${H}" fill="transparent" data-act="day" data-d="${x.ds}"/>`;
  });
  return s + '</svg>';
}
const TIC = {
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  back: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
};
const tileHead = (ic, label, sub) => `<div class="th"><i class="thi"><svg viewBox="0 0 24 24" aria-hidden="true">${TIC[ic]}</svg></i><span>${label}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
const tileRow = (left, right, cls = '') => `<div class="ti ${cls}"><span>${left}</span><b>${right}</b></div>`;

function dayTile(ds, label, limit, today, icon) {
  const items = S.tx.filter(t => t.date === ds), total = dayTotal(ds), d = pd(ds);
  const over = limit > 0 && total > limit, shown = items.slice(0, 2), more = items.length - shown.length;
  const row = t => tileRow(esc(t.note || t.category), (t.type === 'thu' ? '+' : t.type === 'chuyen' ? '' : '−') + fmtS(t.amount));
  return `<button class="tile ${today ? 'today' : ''}" data-act="day" data-d="${ds}" aria-label="${label}, đã chi ${fmt(total)}">
    ${tileHead(icon, label, `${d.getDate()}/${d.getMonth() + 1}`)}
    <div class="tv ${over ? 'bad' : ''}">${fmt(total)}</div>
    ${limit > 0 ? `<div class="tbar"><i class="${over ? 'over' : ''}" style="width:${Math.min(100, total / limit * 100)}%"></i></div>` : '<div style="height:12px"></div>'}
    <div class="tl">${items.length ? shown.map(row).join('') + (more > 0 ? tileRow(`+${more} khoản nữa`, '', 'more') : '') : '<div class="ti more"><span>Chưa có khoản nào</span></div>'}</div></button>`;
}
function upcomingTile() {
  const rules = (S.set.recurring || []).filter(r => r.active);
  const list = upcomingList(30), spend = list.filter(x => x.r.type === 'chi').reduce((a, x) => a + x.r.amount, 0);
  const row = ({ r, ds }) => tileRow(`<u>${+ds.slice(8)}/${+ds.slice(5, 7)}</u> ${esc(r.name)}`, (r.type === 'thu' ? '+' : '−') + fmtS(r.amount));
  return `<button class="tile" data-act="rmanage" aria-label="Sắp đến hạn, ${list.length} khoản trong 30 ngày tới">
    ${tileHead('cal', 'Sắp đến hạn')}
    <div class="tv">${rules.length ? fmt(spend) : '—'}</div>
    <div class="tc">${rules.length ? `${list.length} khoản trong 30 ngày tới` : 'Chưa có khoản định kỳ'}</div>
    <div class="tl">${rules.length ? (list.length ? list.slice(0, 2).map(row).join('') : '<div class="ti more"><span>Không có gì trong 30 ngày</span></div>') : '<div class="ti more"><span>Thêm tiền nhà, internet... trong Cài đặt</span></div>'}</div></button>`;
}
function monthTile(c) {
  const { info, budget, d } = c, ideal = budget * d / info.dim, left = budget - info.total;
  return `<button class="tile" data-act="monthgo" aria-label="Tháng này, đã chi ${fmt(info.total)}">
    ${tileHead('chart', `Tháng ${new Date().getMonth() + 1}`)}
    <div class="tv">${fmtS(info.total)}<small> / ${fmtS(budget)}</small></div>
    <div class="tbar"><i class="${info.total > budget ? 'over' : ''}" style="width:${Math.min(100, info.total / budget * 100)}%"></i><u style="left:${Math.min(100, ideal / budget * 100)}%"></u></div>
    <div class="tl">${tileRow('Còn lại', fmtS(left), left < 0 ? 'bad' : '')}${tileRow('Dự báo cuối tháng', fmtS(c.fc), c.fc > budget ? 'bad' : '')}</div></button>`;
}


const bxN = n => `${n < 0 ? '−' : ''}${fmtNum(Math.abs(n)) || '0'}`;
const ICO = {
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.6 3.8-5.4 7-5.4s6.2 1.8 7 5.4"/>',
  bank: '<path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="12" cy="12" r="2.6"/>',
  ok: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 4 3 19h18L12 4zM12 10v4M12 17h.01"/>',
};
const bxIc = (k, sw = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k]}</svg>`;

const lvOf = r => (r > 1 ? 'over' : r >= .8 ? 'near' : 'ok');
const LVL_TXT = { ok: 'Đang tốt', near: 'Sát mức', over: 'Vượt mức' };

// Thanh tiến độ gradient có toả sáng, màu theo mức so với giới hạn (ngọc / vàng / san hô)
const gb = (r, extra = '') => `<div class="gbar lv-${lvOf(r)}"${extra}><b style="width:${Math.max(0, Math.min(100, r * 100))}%"></b></div>`;

function renderHome() {
  const c = todayCalc(), { now, info, d, todaySp, allow, remain, budget } = c;
  const pct = allow > 0 ? todaySp / allow : 1, over = remain < 0;
  S.pill.home = remain < 0 ? `Vượt ${fmtS(-remain)}` : `Còn ${fmtS(remain)}`;
  const b = balances(), tot = b.bank + b.cash, todayS = ymd(now), ydS = ymd(addDays(now, -1));
  const tone = over ? 'coral' : pct >= .8 ? 'amber' : 'emerald', status = over ? 'Vượt mức' : pct >= .8 ? 'Sát mức' : 'Đang tốt';
  const pend = S.queue.filter(q => ['ready', 'wait', 'error'].includes(q.status));
  const ready = pend.filter(q => q.status === 'ready');
  const lim = dayLimit(info.dim);

  let html = `<div class="bx"><header class="bx-head"><div><p>${WDN[now.getDay()]}, ${d} tháng ${now.getMonth() + 1}</p><h1>Hôm nay</h1></div><button class="bx-avatar" data-act="tab" data-tab="settings" aria-label="Cài đặt">${bxIc('user')}</button></header>`;
  if (!S.tx.length && !S.set.welcomed) {
    html += `<section class="bx-glass emerald" style="padding:16px"><div class="bx-eye"><span class="bx-dot"></span>Chào bạn</div><p class="sm" style="margin:8px 0 12px">Nhấn nút + rồi nhập số tiền, hoặc chọn "Nhập bằng lời" để gõ "45k phở". Muốn xem app với số liệu đầy đủ thì tạo dữ liệu mẫu.</p><div class="row2"><button class="btn" data-act="sample">Xem dữ liệu mẫu</button><button class="btn ghost" data-act="welcomed">Bắt đầu trống</button></div></section>`;
  }
  if (pend.length) {
    html += `<button class="bx-banner" data-act="goq"><span><b>${ready.length ? ready.length + ' khoản chờ xác nhận' : pend.length + ' câu chờ xử lý'}</b> · chạm để xem</span><span class="bx-badge amber">${ready.length ? 'Xác nhận' : 'Chờ mạng'}</span></button>`;
  }

  // 1. thẻ số dư
  html += `<section class="bx-card"><div class="bx-ctop"><span class="lbl">Số dư hiện tại</span><span class="bx-chip"></span></div>
    <div class="bx-total">${bxN(tot)}<small>₫</small></div>
    <div class="bx-wallets"><div class="bx-w"><div class="n">${bxIc('bank')}Ngân hàng</div><div class="v">${bxN(b.bank)}<i>₫</i></div></div><div class="bx-w"><div class="n">${bxIc('cash')}Tiền mặt</div><div class="v">${bxN(b.cash)}<i>₫</i></div></div></div></section>`;

  // 2. còn tiêu được
  html += `<section class="bx-glass bx-left ${tone}"><div class="bx-row"><div><div class="bx-eye"><span class="bx-dot"></span>${over ? 'Đã vượt ngân sách ngày' : 'Còn tiêu được hôm nay'}</div><div class="bx-big">${bxN(remain)}<small>₫</small></div></div><span class="bx-badge">${bxIc(over ? 'warn' : 'ok', 2.4)}${status}</span></div>
    <div class="bx-bar lv-${lvOf(pct)}"><b style="width:${Math.min(100, pct * 100)}%"></b></div>
    <div class="bx-meta"><span>Đã dùng ${allow > 0 ? Math.round(pct * 100) : 100}%</span><span>Ngân sách ngày ${fmt(Math.max(0, allow))}</span></div></section>`;

  // 3. bốn khối kính
  const items = ds => S.tx.filter(t => t.date === ds);
  const todayItems = items(todayS), ydItems = items(ydS), ydTot = dayTotal(ydS);
  const catSum = {}; todayItems.forEach(t => { if (t.type === 'chi' && !t.adjust) catSum[t.category] = (catSum[t.category] || 0) + t.amount; });
  const topCats = Object.entries(catSum).sort((a, b) => b[1] - a[1]).slice(0, 2), catTot = topCats.reduce((a, x) => a + x[1], 0) || 1;
  const swc = ['var(--bb-amber)', 'var(--bb-emerald)'];
  const nm = t => esc(t.note || t.category), sgn = t => (t.type === 'thu' ? '+' : '') + fmtS(t.amount);
  const upl = upcomingList(30), upTot = upl.filter(x => x.r.type === 'chi').reduce((a, x) => a + x.r.amount, 0);
  const diff = todaySp - ydTot, ideal = budget * d / info.dim, left = budget - info.total, cmpMax = Math.max(todaySp, ydTot, 1);
  html += `<div class="bx-grid">
    <section class="bx-glass bx-tile emerald" data-act="day" data-d="${todayS}" role="button" tabindex="0"><div class="bx-eye"><span class="bx-dot"></span>Hôm nay</div><div class="bx-t">${bxN(todaySp)}<small>₫</small></div><div class="bx-sub">${todayItems.length} khoản · ${allow > 0 ? Math.round(pct * 100) : 100}% ngân sách ngày</div>
      <div class="bx-stack">${topCats.map(([, v], i) => `<i style="width:${v / catTot * 100}%;background:${swc[i]}"></i>`).join('')}</div>
      <div class="bx-rows">${topCats.map(([n, v], i) => `<div class="bx-r"><span><i class="bx-sw" style="background:${swc[i]}"></i>${esc(n)}</span><span>${fmtS(v)}</span></div>`).join('')}${todayItems.slice(0, topCats.length ? 1 : 3).map(t => `<div class="bx-r"><span>${nm(t)}</span><span>${sgn(t)}</span></div>`).join('')}</div></section>
    <section class="bx-glass bx-tile amber" data-act="rmanage" role="button" tabindex="0"><div class="bx-eye"><span class="bx-dot"></span>Sắp đến hạn · 30 ngày</div><div class="bx-t">${bxN(upTot)}<small>₫</small></div><div class="bx-sub">${upl.length} khoản sắp tới</div>
      <div class="bx-rows" style="gap:5px">${upl.length ? upl.slice(0, 4).map(({ r, ds }) => `<div class="bx-r"><span>${esc(r.name)} <small style="color:var(--bb-text3)">${+ds.slice(8)}/${+ds.slice(5, 7)}</small></span><span>${(r.type === 'thu' ? '+' : '') + fmtS(r.amount)}</span></div>`).join('') : `<div class="bx-r"><span>${(S.set.recurring || []).length ? 'Không có gì trong 30 ngày' : 'Thêm tiền nhà, internet... ở Cài đặt'}</span></div>`}</div></section>
    <section class="bx-glass bx-tile indigo" data-act="day" data-d="${ydS}" role="button" tabindex="0"><div class="bx-eye"><span class="bx-dot"></span>Hôm qua</div><div class="bx-t">${bxN(ydTot)}<small>₫</small></div><div class="bx-sub">${ydItems.length} khoản</div>
      <div class="bx-cmp"><div class="bx-c"><span>Hôm qua</span><div class="bx-tr"><b style="width:${Math.max(4, ydTot / cmpMax * 100)}%;background:var(--bb-indigo)"></b></div></div><div class="bx-c"><span>Hôm nay</span><div class="bx-tr"><b style="width:${Math.max(4, todaySp / cmpMax * 100)}%;background:var(--bb-emerald)"></b></div></div></div>
      <div class="bx-rows">${ydItems.slice(0, 1).map(t => `<div class="bx-r"><span>${nm(t)}</span><span>${sgn(t)}</span></div>`).join('')}<div class="bx-r"><span>So với hôm nay</span><span class="bx-pill">${diff === 0 ? '0' : (diff > 0 ? '−' : '+') + fmtS(Math.abs(diff))}</span></div></div></section>
    <section class="bx-glass bx-tile coral" data-act="monthgo" role="button" tabindex="0"><div class="bx-eye"><span class="bx-dot"></span>Tháng ${now.getMonth() + 1}</div><div class="bx-t">${fmtS(info.total)}<small> / ${fmtS(budget)}</small></div><div class="bx-sub">Đã chi / ngân sách</div>
      <div class="bx-mbar lv-${lvOf(info.total / budget)}"><b style="width:${Math.min(100, info.total / budget * 100)}%"></b><u style="left:${Math.min(100, ideal / budget * 100)}%"></u></div><div class="bx-mbl"><span>0</span><span>Mốc lý tưởng ${fmtS(ideal)}</span></div>
      <div class="bx-rows"><div class="bx-r"><span>Còn lại</span><span${left < 0 ? ' style="color:var(--bb-coral)"' : ''}>${fmtS(left)}</span></div><div class="bx-r"><span>Dự báo cuối tháng</span><span>${fmtS(c.fc)}</span></div></div></section>
  </div>`;

  // 4. biểu đồ 7 ngày
  const days = [...Array(7)].map((_, i) => { const dt = addDays(now, i - 6), ds = ymd(dt); return { ds, dt, v: dayTotal(ds) }; });
  const scale = Math.max(Math.ceil(Math.max(lim * 1.1, ...days.map(x => x.v)) / 50) * 50, 50), H = 124;
  html += `<section class="bx-glass bx-chart indigo"><div class="bx-head2"><h2>7 ngày qua</h2><span>Hạn mức ${fmtS(lim)}/ngày</span></div>
    <div class="bx-plot"><div class="bx-limit" style="bottom:${lim / scale * H + 22}px"><em>${fmtS(lim)}</em></div>
      ${days.map((x, i) => `<div class="bx-col ${i === 6 ? 'now' : ''}" data-act="day" data-d="${x.ds}"><span class="v">${x.v ? fmtS(x.v) : ''}</span><div class="b" style="height:${x.v ? Math.max(4, x.v / scale * H) : 0}px"></div><span class="d">${['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][x.dt.getDay()]}</span></div>`).join('')}</div></section>`;

  if (pend.length) {
    html += `<section class="bx-glass bx-list amber" id="pending"><div class="bx-lh"><span class="bx-eye"><span class="bx-dot"></span>Chờ xác nhận</span><span class="bx-badge">${ready.length ? ready.length + ' sẵn sàng' : 'chờ mạng'}</span></div>` +
      pend.map(q => q.status === 'ready'
        ? `<button class="li" data-act="qopen" data-id="${q.id}"><div class="n"><b>${esc(q.text)}</b><span>Chạm để chọn danh mục và lưu</span></div><span class="chip">Xác nhận</span></button>`
        : `<div class="li"><div class="n"><b>${esc(q.text)}</b><span>${q.status === 'error' ? esc(q.error || 'Không hiểu được') : 'Chờ có mạng để xử lý'}</span></div><button class="link" data-act="qdel" data-id="${q.id}">Xoá</button></div>`).join('') + `</section>`;
  }
  if (needBackup()) {
    html += `<section class="bx-glass coral" style="padding:14px 16px"><div class="rowf"><div><b>Nhắc sao lưu</b><div class="sm">${S.set.lastBackup ? 'Đã ' + Math.floor((Date.now() - S.set.lastBackup) / 864e5) + ' ngày chưa sao lưu.' : 'Bạn chưa sao lưu lần nào.'} Dữ liệu chỉ nằm trên máy này.</div></div><button class="btn sm2" data-act="export-json">Sao lưu</button></div></section>`;
  }
  if (needSchedCheck()) {
    html += `<section class="bx-glass amber" style="padding:14px 16px"><div class="rowf"><div><b>Kiểm tra lịch chuyển tiền</b><div class="sm">Đã ${Math.floor((Date.now() - S.set.schedCheckAt) / 864e5)} ngày. Mở app ngân hàng (VietinBank iPay: Chuyển tiền → Đặt lịch chuyển tiền), xem lệnh còn chạy và đúng số tiền.</div></div><button class="btn sm2" data-act="schedok" style="white-space:nowrap">Còn chạy</button></div></section>`;
  }
  const recent = S.tx.filter(t => t.date <= todayS).slice(0, 8);
  html += `<section class="bx-glass bx-list indigo"><div class="bx-lh"><span class="bx-eye"><span class="bx-dot"></span>Gần đây</span><button class="link" data-act="tab" data-tab="log">Xem sổ</button></div>${recent.length ? recent.map(t => txRow(t)).join('') : '<div class="empty">Chưa có khoản nào. Nhấn + để thêm.</div>'}</section></div>`;
  el.home.innerHTML = html;
}
function needBackup() {
  if (S.tx.length < 5 || S.tx.every(t => t.sample)) return false;
  if (tgReady() && S.set.tg.lastAt && Date.now() - S.set.tg.lastAt < 7 * 864e5) return false;
  return !S.set.lastBackup || Date.now() - S.set.lastBackup > 7 * 864e5;
}
// Nhắc tự mở app ngân hàng xem lệnh chuyển tiền theo lịch còn chạy không (app không đọc được lệnh đó).
const needSchedCheck = () => S.set.schedCheckDays > 0 && Date.now() - (S.set.schedCheckAt || 0) > S.set.schedCheckDays * 864e5;

/* ---------- Chi tiêu định kỳ ---------- */
const lastDom = (y, m) => new Date(y, m + 1, 0).getDate();
function occurrences(r, from, to) {
  const out = [], start = pd(r.start);
  if (r.freq === 'week') {
    const d = new Date(Math.max(+from, +start));
    while (d.getDay() !== r.day) d.setDate(d.getDate() + 1);
    for (; d <= to; d.setDate(d.getDate() + 7)) out.push(ymd(d));
  } else {
    let y = from.getFullYear(), m = from.getMonth();
    while (new Date(y, m, 1) <= to) {
      const d = new Date(y, m, Math.min(r.day, lastDom(y, m)));
      if (d >= from && d >= start && d <= to) out.push(ymd(d));
      if (++m > 11) { m = 0; y++; }
    }
  }
  return out;
}
const todayMid = () => pd(ymd(new Date()));
function upcomingTotal(now) {
  const from = addDays(pd(ymd(now)), 1), to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  if (from > to) return 0;
  return (S.set.recurring || []).reduce((a, r) => a + (r.active && r.type === 'chi' ? occurrences(r, from, to).length * r.amount : 0), 0);
}
function upcomingList(days) {
  const from = addDays(todayMid(), 1), to = addDays(todayMid(), days), out = [];
  (S.set.recurring || []).forEach(r => { if (r.active) occurrences(r, from, to).forEach(ds => out.push({ r, ds })); });
  return out.sort((a, b) => a.ds.localeCompare(b.ds));
}
const monthlyEq = r => (r.freq === 'week' ? r.amount * 52 / 12 : r.amount);
const schedule = r => (r.freq === 'week' ? `Hàng tuần · ${WDN[r.day]}` : `Hàng tháng · ngày ${r.day}`);
function recurCard() {
  const rules = S.set.recurring || [], act = rules.filter(r => r.active && r.type === 'chi');
  const fixedM = act.reduce((a, r) => a + monthlyEq(r), 0), incM = rules.filter(r => r.active && r.type === 'thu').reduce((a, r) => a + monthlyEq(r), 0);
  const free = S.set.budget - fixedM, dim = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  return `<div id="recur-card"><div class="sec"><span>Chi tiêu định kỳ</span></div>
    <div class="card"><div class="tri" style="margin:0"><div><span>Cố định mỗi tháng</span><b>${fmtS(fixedM)}</b></div><div><span>Chiếm ngân sách</span><b>${S.set.budget ? Math.round(fixedM / S.set.budget * 100) : 0}%</b></div><div><span>Còn để tiêu</span><b class="${free < 0 ? 'bad' : ''}">${fmtS(free)}</b><span>≈ ${fmtS(free / dim)}/ngày</span></div></div>
      ${incM ? `<div class="sm" style="margin-top:8px">Thu định kỳ mỗi tháng khoảng ${fmtS(incM)}.</div>` : ''}</div>
    <div class="group" style="margin-top:12px">${rules.map(r => `<button class="li" data-act="redit" data-id="${r.id}" style="${r.active ? '' : 'opacity:.5'}">${badge(r.category, r.type === 'thu' ? 'var(--c5)' : catColor(r.category), r.type === 'thu' ? 'in' : null)}<div class="n"><b>${esc(r.name)}</b><span>${schedule(r)} · ${W[r.wallet]}${r.active ? '' : ' · tạm dừng'}</span></div><div class="a ${r.type === 'thu' ? 'in' : ''}">${r.type === 'thu' ? '+' : '−'}${fmt(r.amount)}</div></button>`).join('')}
      <button class="srow act" data-act="radd">Thêm khoản định kỳ<span class="chev">+</span></button>
      <label class="srow"><span>Nhắc kiểm tra lịch chuyển tiền ở ngân hàng</span><select id="s-sched" data-set="schedCheckDays">${[[0, 'Tắt'], [14, '2 tuần'], [30, 'Hằng tháng'], [90, '3 tháng']].map(([v, l]) => `<option value="${v}" ${v === S.set.schedCheckDays ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="foot">Khoản lặp lại hàng tháng hay hàng tuần tự ghi khi đến ngày. Phần chưa đến hạn được trừ khỏi ngân sách ngày để bạn biết mình thật sự tiêu được bao nhiêu.</div></div>`;
}
async function runRecurring() {
  const today = todayMid(), made = [];
  let changed = false;
  for (const r of S.set.recurring || []) {
    if (!r.active) continue;
    const from = r.last ? addDays(pd(r.last), 1) : pd(r.start);
    const occ = occurrences(r, from, today).slice(0, 400);
    if (!occ.length) continue;
    occ.forEach(ds => made.push({
      id: DB.uid(), type: r.type, date: ds, amount: r.amount, wallet: r.wallet, toWallet: null,
      category: r.type === 'thu' ? 'Khác' : r.category, note: r.name, createdAt: Date.now() + made.length, recur: r.id, ...(r.sample ? { sample: true } : {}),
    }));
    r.last = occ[occ.length - 1]; changed = true;
  }
  if (changed) { await DB.putMany('tx', made); await saveSet(); await load(); }
  return made.length;
}
function blankRule() {
  const now = new Date();
  return { id: null, type: 'chi', name: '', amount: 0, category: catNames()[0], wallet: S.set.defWallet, freq: 'month', day: now.getDate(), start: ymd(now), active: true, last: null };
}
function openRecur(id) {
  const r = id ? S.set.recurring.find(x => x.id === id) : null;
  S.R = r ? { ...r } : blankRule(); S.R.isNew = !r; S.R.err = '';
  paintRecur();
}
function paintRecur() {
  const R = S.R; if (!R) return;
  const opt = (arr, cur) => arr.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const days = R.freq === 'week' ? WDN.map((n, i) => [i, n]) : Array.from({ length: 31 }, (_, i) => [i + 1, 'Ngày ' + (i + 1)]);
  const cats = catNames().map(c => [c, c]);
  openSheet(`<h2>${R.isNew ? 'Thêm khoản định kỳ' : 'Sửa khoản định kỳ'}</h2>
    <div class="seg" style="margin-bottom:12px"><button class="${R.type === 'chi' ? 'on' : ''}" data-act="rtype" data-t="chi">Chi</button><button class="${R.type === 'thu' ? 'on' : ''}" data-act="rtype" data-t="thu">Thu (lương...)</button></div>
    <div class="field"><label for="r-name">Tên</label><input class="inp" id="r-name" data-r="name" placeholder="Tiền nhà, Internet, Netflix..." value="${esc(R.name)}"></div>
    <div class="field"><label for="r-amt">Số tiền</label><input class="inp" id="r-amt" inputmode="numeric" data-r="amount" placeholder="Ví dụ 1tr5" value="${fmtNum(R.amount)}"></div>
    <div class="cols"><div class="field"><label for="r-freq">Lặp lại</label><select class="inp" id="r-freq" data-r="freq">${opt([['month', 'Hàng tháng'], ['week', 'Hàng tuần']], R.freq)}</select></div>
    <div class="field"><label for="r-day">${R.freq === 'week' ? 'Vào thứ' : 'Vào ngày'}</label><select class="inp" id="r-day" data-r="day">${opt(days, R.day)}</select></div></div>
    <div class="cols"><div class="field"><label for="r-w">Ví</label><select class="inp" id="r-w" data-r="wallet">${opt([['bank', 'Ngân hàng'], ['cash', 'Tiền mặt']], R.wallet)}</select></div>
    ${R.type === 'chi' ? `<div class="field"><label for="r-c">Danh mục</label><select class="inp" id="r-c" data-r="category">${opt(cats, R.category)}</select></div>` : '<div></div>'}</div>
    <div class="field"><label for="r-s">Tính từ ngày</label><input type="date" class="inp" id="r-s" data-r="start" value="${esc(R.start)}"><div class="sm">${R.start < ymd(new Date()) && !R.last ? 'Các kỳ đã qua từ ngày này sẽ được ghi luôn.' : 'Các tháng ngắn hơn sẽ ghi vào ngày cuối tháng.'}</div></div>
    ${R.isNew ? '' : `<div class="rowf" style="margin-bottom:12px"><label for="r-a">Đang áp dụng</label><input type="checkbox" id="r-a" data-r="active" ${R.active ? 'checked' : ''}></div>`}
    ${R.err ? `<div class="hint bad" style="margin-bottom:8px">${esc(R.err)}</div>` : ''}
    <button class="btn" data-act="rsave">${R.isNew ? 'Thêm' : 'Lưu'}</button>${R.isNew ? '' : '<div style="height:8px"></div><button class="btn danger" data-act="rdel">Xoá khoản này</button>'}`);
}
function rField(t, final) {
  const R = S.R; if (!R) return;
  const k = t.dataset.r, isText = t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'date';
  if (!isText && !final) return;
  if (k === 'amount') { R.amount = amountFromText(t.value) || 0; if (final) t.value = fmtNum(R.amount); return; }
  if (k === 'name') { R.name = t.value; return; }
  if (k === 'active') { R.active = t.checked; return; }
  if (k === 'day') { R.day = +t.value; return; }
  R[k] = t.value;
  if (k === 'freq') { R.day = R.freq === 'week' ? pd(R.start).getDay() : pd(R.start).getDate(); paintRecur(); }
  if (k === 'start' && R.isNew) { R.day = R.freq === 'week' ? pd(R.start).getDay() : pd(R.start).getDate(); paintRecur(); }
}
async function saveRecur() {
  const R = S.R; if (!R) return;
  if (!(R.amount > 0)) { R.err = 'Nhập số tiền.'; paintRecur(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(R.start)) { R.err = 'Chọn ngày bắt đầu.'; paintRecur(); return; }
  const rule = { id: R.id || DB.uid(), type: R.type, name: R.name.trim() || (R.type === 'thu' ? 'Thu định kỳ' : R.category), amount: Math.round(R.amount), category: R.type === 'thu' ? 'Khác' : R.category, wallet: R.wallet, freq: R.freq, day: R.freq === 'week' ? +R.day % 7 : Math.min(31, Math.max(1, +R.day)), start: R.start, active: R.active, last: R.last };
  const old = S.set.recurring.find(x => x.id === rule.id);
  if (old && old.sample) rule.sample = true;
  S.set.recurring = old ? S.set.recurring.map(x => (x.id === rule.id ? rule : x)) : [...S.set.recurring, rule];
  await saveSet();
  const n = await runRecurring();
  closeSheet(); renderAll(); toast(n ? `Đã lưu, ghi ${n} khoản đến hạn` : 'Đã lưu khoản định kỳ');
}

/* ---------- Thống kê ---------- */
function calHTML(info, mk) {
  const first = (new Date(info.y, info.m - 1, 1).getDay() + 6) % 7, lim = dayLimit(info.dim), today = ymd(new Date());
  let s = '<div class="cal">' + ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(x => `<div class="dh">${x}</div>`).join('');
  for (let i = 0; i < first; i++) s += '<div></div>';
  for (let d = 1; d <= info.dim; d++) {
    const ds = `${mk}-${pad(d)}`, v = info.days[d - 1];
    if (ds > today) { s += `<div class="c fut">${d}</div>`; continue; }
    const r = v / lim, l = v === 0 ? 0 : r < .5 ? 1 : r < 1 ? 2 : r < 1.5 ? 3 : 4;
    s += `<button class="l${l} ${ds === today ? 'tdy' : ''}" data-act="day" data-d="${ds}" aria-label="Ngày ${d}, chi ${fmt(v)}">${d}<em>${v ? fmtS(v) : ''}</em></button>`;
  }
  return s + '</div><div class="legend">ít ' + [0, 1, 2, 3, 4].map(i => `<i class="l${i}" style="${i === 0 ? 'background:var(--h0)' : ''}"></i>`).join('') + ' nhiều</div>';
}
function barsSVG(info, mk) {
  const W_ = 340, H = 150, base = 126, lim = dayLimit(info.dim), mx = Math.max(lim * 1.3, ...info.days, 1);
  const slot = (W_ - 4) / info.dim, bw = Math.max(3, slot * .66), today = ymd(new Date());
  const ly = base - lim / mx * 108;
  let s = `<svg viewBox="0 0 ${W_} ${H}" width="100%" role="img" aria-label="Chi tiêu theo ngày"><line x1="0" x2="${W_}" y1="${ly}" y2="${ly}" stroke="var(--fg)" stroke-opacity=".4" stroke-dasharray="3 3"/><text x="${W_}" y="${ly - 4}" text-anchor="end">hạn mức ${fmtS(lim)}/ngày</text>`;
  info.days.forEach((v, i) => {
    const x = 2 + i * slot + (slot - bw) / 2, h = v / mx * 108, ds = `${mk}-${pad(i + 1)}`;
    if (ds > today) return;
    s += `<rect x="${x}" y="${base - h}" width="${bw}" height="${Math.max(h, v ? 2 : 0)}" rx="${Math.min(3, bw / 2)}" fill="${v > lim ? 'var(--warn)' : 'var(--accent)'}" opacity="${ds === today ? 1 : .8}"/>`;
    s += `<rect x="${2 + i * slot}" y="0" width="${slot}" height="${base + 4}" fill="transparent" data-act="day" data-d="${ds}"/>`;
    if (i === 0 || (i + 1) % 5 === 0) s += `<text x="${x + bw / 2}" y="${base + 16}" text-anchor="middle">${i + 1}</text>`;
  });
  return s + '</svg>';
}
function cumSVG(info, mk) {
  const Wd = 340, H = 130, pad_ = 6, budget = S.set.budget, isCur = mk === mkey(new Date()), upto = isCur ? new Date().getDate() : info.dim;
  const X = d => pad_ + (d - 1) / (info.dim - 1) * (Wd - 2 * pad_), Y = v => H - 18 - Math.min(v, budget * 1.4) / (budget * 1.4) * (H - 30);
  let c = 0;
  const pts = info.days.slice(0, upto).map((v, i) => { c += v; return `${X(i + 1).toFixed(1)},${Y(c).toFixed(1)}`; }).join(' ');
  const fc = c / upto * info.dim;
  let s = `<svg viewBox="0 0 ${Wd} ${H}" width="100%" role="img" aria-label="Chi tiêu luỹ kế so với ngân sách"><line x1="${X(1)}" y1="${Y(0)}" x2="${X(info.dim)}" y2="${Y(budget)}" stroke="var(--fg)" stroke-opacity=".4" stroke-dasharray="3 3"/>`;
  s += `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (isCur && upto < info.dim) s += `<line x1="${X(upto)}" y1="${Y(c)}" x2="${X(info.dim)}" y2="${Y(fc)}" stroke="var(--accent)" stroke-width="2" stroke-dasharray="2 5" stroke-linecap="round"/>`;
  s += `<circle cx="${X(upto)}" cy="${Y(c)}" r="4" fill="var(--accent)"/><text x="${X(1)}" y="${H - 3}">1</text><text x="${X(info.dim)}" y="${H - 3}" text-anchor="end">${info.dim}</text>`;
  return s + '</svg>';
}
function renderStats() {
  const mk = S.month, info = monthInfo(mk), isCur = mk === mkey(new Date());
  const [y, m] = mk.split('-').map(Number);
  S.pill.stats = 'Thống kê';
  const cats = {};
  S.tx.forEach(t => { if (t.type === 'chi' && !t.adjust && t.date.startsWith(mk)) cats[t.category] = (cats[t.category] || 0) + t.amount; });
  const list = Object.entries(cats).sort((a, b) => b[1] - a[1]), mx = list[0]?.[1] || 1;
  const upto = isCur ? new Date().getDate() : info.dim;
  const avg = info.total / Math.max(1, upto);
  let maxD = 0; info.days.forEach((v, i) => { if (v > info.days[maxD]) maxD = i; });
  const pm = new Date(y, m - 2, 1), pinfo = monthInfo(mkey(pm));
  const prevSame = pinfo.days.slice(0, Math.min(upto, pinfo.dim)).reduce((a, b) => a + b, 0);
  const dd = info.total - prevSame;
  let html = `<h1>Thống kê</h1><div class="mnav"><b style="font-size:20px">Theo tháng</b><div style="display:flex;gap:8px;align-items:center"><button data-act="mprev" aria-label="Tháng trước">‹</button><b>${m}/${y}</b><button data-act="mnext" aria-label="Tháng sau" ${isCur ? 'disabled style="opacity:.3"' : ''}>›</button></div></div>`;
  if (!info.total) html += `<div class="card empty">Tháng này chưa có khoản chi nào.</div>`;
  html += `<div class="card"><div class="rowf"><span class="lbl">Lịch nhiệt · chạm vào ngày</span><span class="chip">${fmtS(info.total)}</span></div><div style="margin-top:10px">${calHTML(info, mk)}</div></div>`;
  html += `<div class="card"><div class="lbl">Chi mỗi ngày · cột cam là ngày vượt hạn mức</div><div style="margin-top:6px">${barsSVG(info, mk)}</div></div>`;
  html += `<div class="card"><div class="lbl">Luỹ kế so với ngân sách ${fmtS(S.set.budget)}</div><div style="margin-top:6px">${cumSVG(info, mk)}</div><div class="sm">Đường nét đứt đen là ngân sách${isCur ? ', đường chấm là dự báo' : ''}.</div></div>`;
  if (info.total) {
    html += `<div class="card"><div class="lbl" style="margin-bottom:4px">Điểm đáng chú ý</div>
      <div class="li"><div class="n"><b>Trung bình ${fmt(avg)}/ngày</b><span>${upto} ngày đã tính</span></div></div>
      ${isCur ? `<div class="li" style="display:block"><div class="rowf"><b style="font-weight:500">Dự báo cuối tháng ${fmtS(info.total / upto * info.dim)}</b><span class="sm">ngân sách ${fmtS(S.set.budget)}</span></div>${gb(info.total / upto * info.dim / S.set.budget, ' style="margin:8px 0 2px"')}</div>` : ''}
      <div class="li"><div class="n"><b>Ngày chi nhiều nhất: ${maxD + 1}/${m}</b><span>${fmt(info.days[maxD])}</span></div></div>
      ${pinfo.total ? `<div class="li"><div class="n"><b>So với tháng trước cùng kỳ: ${dd >= 0 ? '+' : '−'}${fmtS(Math.abs(dd))}</b><span>${dd > 0 ? 'Đang chi nhiều hơn' : 'Đang chi ít hơn'}</span></div></div>` : ''}</div>`;
    html += `<div class="card"><div class="rowf" style="margin-bottom:4px"><span class="lbl">Theo danh mục</span><span class="sm">${isCur ? 'so với ngân sách từng mục' : ''}</span></div>${list.map(([n, v]) => {
      const bud = S.set.categories.find(c => c.name === n)?.budget || 0, r = bud ? v / bud : 0, lv = bud ? lvOf(r) : 'plain';
      return `<div class="cbar"><div class="t"><span><i class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${catColor(n)};margin-right:6px"></i>${esc(n)}</span><span>${bud ? `${fmtS(v)} / ${fmtS(bud)} · <b class="lvt-${lv}">${Math.round(r * 100)}%</b>` : `${fmtS(v)} · ${Math.round(v / info.total * 100)}%`}</span></div><div class="b lv-${lv}"><i style="width:${bud ? Math.min(100, r * 100) : v / mx * 100}%;${bud ? '' : 'background:' + catColor(n)}"></i></div></div>`;
    }).join('')}${list.some(([n]) => !S.set.categories.find(c => c.name === n)?.budget) ? '<div class="sm" style="margin-top:8px">Đặt ngân sách cho từng danh mục ở Cài đặt để thấy mức đã dùng.</div>' : ''}</div>`;
  }
  el.stats.innerHTML = html;
}

/* ---------- Ví ---------- */
function pendingBank() {
  const ps = S.queue.filter(q => q.kind === 'sms' && q.status === 'ready');
  return { n: ps.length, net: ps.reduce((a, q) => a + q.items.reduce((s, it) => s + (it.type === 'thu' ? it.amount : -it.amount), 0), 0) };
}
function balCard(b) {
  const bb = S.set.bankBal; if (!bb) return '';
  const p = pendingBank(), diff = bb.amount - (b.bank + p.net);
  return `<div class="card"><div class="rowf"><span class="lbl">Số dư theo tin nhắn ngân hàng · ${bb.date.slice(8)}/${bb.date.slice(5, 7)}</span>${diff === 0 ? '<span class="chip">Khớp với sổ</span>' : `<span class="chip warn">Lệch ${fmt(Math.abs(diff))}</span>`}</div>
    <div style="font-size:24px;font-weight:700;letter-spacing:-.02em">${fmt(bb.amount)}</div>
    <div class="sm">Sổ đang ghi ${fmt(b.bank)}${p.n ? `, chưa tính ${p.n} khoản chờ xác nhận` : ''}.${diff ? ' Nếu bạn muốn sổ khớp với ngân hàng, bấm nút dưới, app tạo một khoản "Điều chỉnh" không tính vào chi tiêu.' : ''}</div>
    ${diff ? '<div style="height:8px"></div><button class="btn ghost" data-act="balfix">Khớp số dư ngân hàng</button>' : ''}</div>`;
}
function renderWallet() {
  const b = balances(), mk = mkey(new Date()), spent = { bank: 0, cash: 0 };
  S.tx.forEach(t => { if (t.type === 'chi' && !t.adjust && t.date.startsWith(mk)) spent[t.wallet] += t.amount; });
  S.pill.wallet = 'Ví';
  const list = S.tx.filter(t => S.wf === 'all' || t.wallet === S.wf || t.toWallet === S.wf).slice(0, 40);
  const tot = b.bank + b.cash, bw = Math.max(0, b.bank), cw = Math.max(0, b.cash), sw = bw + cw || 1;
  el.wallet.innerHTML = `<h1>Ví</h1>
    <div class="hero moss"><div class="lbl">Tổng tài sản</div><div class="big">${tot < 0 ? '−' : ''}${fmtNum(Math.abs(tot)) || '0'}<small>đ</small></div>
      <div class="bar"><span style="width:${bw / sw * 100}%;background:var(--c2)"></span><span style="width:${cw / sw * 100}%;background:var(--c1)"></span></div>
      <div class="two-col" style="margin:12px 0 0">
        <div><div class="lbl"><i class="dot" style="background:var(--c2)"></i>Ngân hàng</div><div class="big ${b.bank < 0 ? 'bad' : ''}">${fmtNum(b.bank) || '0'}<small>đ</small></div><div class="lbl">Chi tháng này ${fmtS(spent.bank)}</div></div>
        <div><div class="lbl"><i class="dot" style="background:var(--c1)"></i>Tiền mặt</div><div class="big ${b.cash < 0 ? 'bad' : ''}">${fmtNum(b.cash) || '0'}<small>đ</small></div><div class="lbl">Chi tháng này ${fmtS(spent.cash)}</div></div></div></div>
    ${balCard(b)}
    <div class="row2"><button class="btn ghost" data-act="transfer">Chuyển ví</button><button class="btn ghost" data-act="adjust">Điều chỉnh số dư</button></div>
    <div class="sec"><span>Lịch sử</span></div>
    <div class="seg">${[['all', 'Tất cả'], ['bank', 'Ngân hàng'], ['cash', 'Tiền mặt']].map(([k, l]) => `<button class="${S.wf === k ? 'on' : ''}" data-act="wf" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="group" style="margin-top:12px">${list.length ? list.map(t => txRow(t)).join('') : '<div class="empty">Chưa có giao dịch.</div>'}</div>`;
}

/* ---------- Sổ: xem từng khoản theo ngày / theo tháng ---------- */
function catChips(items) {
  const sums = {};
  items.forEach(t => { if (t.type === 'chi' && !t.adjust) sums[t.category] = (sums[t.category] || 0) + t.amount; });
  const list = Object.entries(sums).sort((a, b) => b[1] - a[1]);
  return list.length ? `<div class="chips">${list.map(([n, v]) => `<span class="cc"><i style="background:${catColor(n)}"></i>${esc(n)} ${fmtS(v)}</span>`).join('')}</div>` : '';
}
function jumpChips(ds) {
  const today = ymd(new Date()), yest = ymd(addDays(new Date(), -1)), som = ds.slice(0, 8) + '01';
  const first = S.tx.reduce((m, t) => (t.date < m ? t.date : m), '9999-99-99');
  const chips = [['Hôm nay', today], ['Hôm qua', yest], [`Đầu tháng ${+som.slice(8)}/${+som.slice(5, 7)}`, som]];
  if (first !== '9999-99-99') chips.push([`Ngày đầu tiên ${+first.slice(8)}/${+first.slice(5, 7)}/${first.slice(0, 4)}`, first]);
  return `<div class="fchips">${chips.map(([l, d]) => `<button class="${d === ds ? 'on' : ''}" data-act="jump" data-d="${d}">${l}</button>`).join('')}</div>`;
}
function logDayHTML() {
  const ds = S.ld, d = pd(ds), today = ymd(new Date()), isT = ds === today;
  const items = S.tx.filter(t => t.date === ds), info = monthInfo(ds.slice(0, 7));
  const spend = dayTotal(ds), income = items.reduce((a, t) => a + (t.type === 'thu' && !t.adjust ? t.amount : 0), 0);
  const limit = isT ? todayCalc().allow : dayLimit(info.dim), pct = limit > 0 ? spend / limit * 100 : 100;
  const label = isT ? 'Hôm nay' : ds === ymd(addDays(new Date(), -1)) ? 'Hôm qua' : WDN[d.getDay()];
  return `<div class="mnav"><button data-act="dprev" aria-label="Ngày trước">‹</button><div style="text-align:center"><b style="font-size:18px">${label}</b><div class="sm">${WDN[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}</div></div><button data-act="dnext" aria-label="Ngày sau" ${isT ? 'disabled style="opacity:.3"' : ''}>›</button></div>
    ${jumpChips(ds)}
    <div class="field" style="margin:0"><label for="ld">Hoặc chọn ngày khác</label><input type="date" class="inp" id="ld" data-ld value="${ds}" max="${today}"></div>
    <div class="card"><div class="rowf"><span class="lbl">Tổng chi trong ngày</span><span class="chip ${spend > limit ? 'bad' : ''}">${spend > limit ? 'Vượt ' + fmtS(spend - limit) : 'Còn ' + fmtS(limit - spend)}</span></div>
      <div style="font-size:32px;font-weight:700;letter-spacing:-.03em;margin-top:2px">${fmt(spend)}</div>
      ${gb(limit > 0 ? spend / limit : 1)}
      <div class="sm">Ngân sách ngày ${fmt(Math.max(0, limit))} · ${items.length} khoản${income ? ' · thu +' + fmtS(income) : ''}</div>${catChips(items)}</div>
    <div class="group">${items.length ? items.map(t => txRow(t, true)).join('') : '<div class="empty">Ngày này chưa có khoản nào.</div>'}</div>
    <button class="btn ghost" data-act="addday" data-d="${ds}">Thêm khoản cho ngày này</button>`;
}
function monthItems() {
  const q = norm(S.q || '').trim();
  return S.tx.filter(t => t.date.startsWith(S.lmk) && (!S.lcat || (t.type !== 'chuyen' && t.category === S.lcat)) && (!q || norm(`${t.note} ${t.category}`).includes(q)));
}
function logMonthList() {
  const items = monthItems();
  if (!items.length) return '<div class="card empty">Không có khoản nào khớp.</div>';
  const groups = {};
  items.forEach(t => (groups[t.date] ||= []).push(t));
  return Object.keys(groups).sort().reverse().map(ds => {
    const d = pd(ds), tot = groups[ds].reduce((a, t) => a + (t.type === 'chi' && !t.adjust ? t.amount : 0), 0);
    return `<div class="sec" style="margin:8px 4px 0"><span>${WDN[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}</span><span>${tot ? fmt(tot) : ''}</span></div><div class="group">${groups[ds].map(t => txRow(t, true)).join('')}</div>`;
  }).join('');
}
function logMonthHTML() {
  const mk = S.lmk, info = monthInfo(mk), [y, m] = mk.split('-').map(Number), isCur = mk === mkey(new Date());
  const all = S.tx.filter(t => t.date.startsWith(mk));
  const income = all.reduce((a, t) => a + (t.type === 'thu' && !t.adjust ? t.amount : 0), 0);
  const active = info.days.filter(v => v > 0).length, budget = S.set.budget;
  const cats = {}; all.forEach(t => { if (t.type === 'chi' && !t.adjust) cats[t.category] = (cats[t.category] || 0) + t.amount; });
  const clist = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  return `<div class="mnav"><button data-act="lmprev" aria-label="Tháng trước">‹</button><div style="text-align:center"><b style="font-size:18px">Tháng ${m}/${y}</b><div class="sm">${isCur ? 'Tháng này' : 'Đã qua'} · ${all.length} khoản</div></div><button data-act="lmnext" aria-label="Tháng sau" ${isCur ? 'disabled style="opacity:.3"' : ''}>›</button></div>
    <div class="card"><div class="rowf"><span class="lbl">Tổng chi tháng</span><span class="chip ${info.total > budget ? 'bad' : ''}">${Math.round(info.total / budget * 100)}% ngân sách</span></div>
      <div style="font-size:32px;font-weight:700;letter-spacing:-.03em;margin-top:2px">${fmt(info.total)}</div>
      ${gb(info.total / budget)}
      <div class="tri"><div><span>Thu</span><b class="ok">+${fmtS(income)}</b></div><div><span>Ngày có chi</span><b>${active}/${info.dim}</b></div><div><span>Trung bình</span><b>${fmtS(info.total / Math.max(1, active))}/ngày</b></div></div></div>
    <div class="fchips"><button class="${!S.lcat ? 'on' : ''}" data-act="lcat" data-c="">Tất cả</button>${clist.map(([n, v]) => `<button class="${S.lcat === n ? 'on' : ''}" data-act="lcat" data-c="${esc(n)}"><i style="background:${catColor(n)}"></i>${esc(n)} ${fmtS(v)}</button>`).join('')}</div>
    <input class="inp" type="search" data-q placeholder="Tìm theo ghi chú..." value="${esc(S.q)}" aria-label="Tìm khoản">
    <div id="loglist" style="display:flex;flex-direction:column;gap:6px">${logMonthList()}</div>`;
}
function renderLog() {
  S.pill.log = 'Sổ chi';
  el.log.innerHTML = `<h1>Sổ chi</h1>
    <div class="seg"><button class="${S.lm === 'day' ? 'on' : ''}" data-act="lmode" data-m="day">Theo ngày</button><button class="${S.lm === 'month' ? 'on' : ''}" data-act="lmode" data-m="month">Theo tháng</button></div>
    ${S.lm === 'day' ? logDayHTML() : logMonthHTML()}`;
}

/* ---------- Cài đặt ---------- */
function renderSettings() {
  const s = S.set;
  S.pill.settings = 'Cài đặt';
  const last = s.lastBackup ? new Date(s.lastBackup).toLocaleDateString('vi-VN') : 'chưa lần nào';
  const row = (label, inner) => `<label class="srow"><span>${label}</span>${inner}</label>`;
  const act = (label, a, cls = '', right = '›') => `<button type="button" class="srow act ${cls}" data-act="${a}">${label}<span class="chev">${right}</span></button>`;
  const sel = (id, k, opts, cur) => `<select id="${id}" data-set="${k}">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  el.settings.innerHTML = `<h1>Cài đặt</h1>
  <div class="sec"><span>Ngân sách</span></div>
  <div class="group">${row('Ngân sách tháng', `<input id="s-budget" inputmode="numeric" data-set="budget" value="${fmtNum(s.budget)}">`)}${row('Ngân sách ngày', `<input id="s-daily" inputmode="numeric" data-set="dailyBudget" placeholder="Tự tính" value="${fmtNum(s.dailyBudget)}">`)}</div>
  <div class="foot">Để trống ngân sách ngày thì app tự tính: ngân sách còn lại chia cho số ngày còn lại. Đặt số cố định nếu bạn muốn mỗi ngày một mức như nhau.</div>
  <div class="sec"><span>Ví</span></div>
  <div class="group">${row('Số dư đầu · Ngân hàng', `<input id="s-ob" inputmode="numeric" data-set="open.bank" placeholder="0" value="${fmtNum(s.open.bank)}">`)}${row('Số dư đầu · Tiền mặt', `<input id="s-oc" inputmode="numeric" data-set="open.cash" placeholder="0" value="${fmtNum(s.open.cash)}">`)}${row('Ví mặc định', sel('s-dw', 'defWallet', [['cash', 'Tiền mặt'], ['bank', 'Ngân hàng']], s.defWallet))}</div>
  ${recurCard()}
  <div class="sec"><span>Danh mục</span></div>
  <div class="group">${s.categories.map((c, i) => `<div class="srow"><input type="color" class="swatch" data-cat="color" data-i="${i}" value="${c.color}" aria-label="Màu ${esc(c.name)}"><input class="grow" data-cat="name" data-i="${i}" value="${esc(c.name)}" aria-label="Tên danh mục" style="text-align:left"><input class="bud" inputmode="numeric" data-cat="budget" data-i="${i}" placeholder="Ngân sách" value="${fmtNum(c.budget)}" aria-label="Ngân sách ${esc(c.name)}"><button class="x" data-act="catdel" data-i="${i}" aria-label="Xoá danh mục">×</button></div>`).join('')}${act('Thêm danh mục', 'catadd', '', '+')}</div>
  <div class="sec"><span>Nhập bằng lời</span></div>
  <div class="group">${row('API key', `<input id="s-key" type="text" class="secret" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-set="apiKey" value="${esc(s.apiKey)}" placeholder="sk-ant-...">`)}${row('Model', `<input id="s-model" data-set="model" value="${esc(s.model)}" autocapitalize="off" spellcheck="false">`)}${row('Dùng API khi cần', `<input type="checkbox" id="s-ai" data-set="ai" ${s.ai ? 'checked' : ''}>`)}${row('Tự lưu khi chắc chắn', `<input type="checkbox" id="s-auto" data-set="autosave" ${s.autosave !== false ? 'checked' : ''}>`)}${act('Kiểm tra kết nối', 'testkey')}</div>
  <div class="foot" id="keymsg">Câu đơn giản app tự hiểu trên máy. Câu phức tạp mới gửi lên Anthropic, chỉ gồm câu bạn gõ, ngày hôm nay và tên danh mục. Key chỉ lưu trên máy này, không nằm trong bản sao lưu.</div>
  <div class="sec"><span>Chi phí gọi model</span></div>
  <div class="group">${(() => { const u = s.usage?.[mkey(new Date())] || { calls: 0, in: 0, out: 0, usd: 0 }, p = priceOf();
    return row('Tháng này', `<span>${u.calls} lần · ${u.in + u.out} token · ≈ ${fmtVnd(u.usd * (s.usdVnd || 25500))}</span>`) + row('Bảng giá đang dùng', `<span>${p ? '$' + p[0] + ' vào · $' + p[1] + ' ra / 1 triệu token' : 'chưa có giá cho model này'}</span>`); })()}${row('Tỷ giá (₫ mỗi USD)', `<input id="s-fx" inputmode="numeric" data-set="usdVnd" value="${fmtNum(s.usdVnd)}">`)}${row('Giá vào tuỳ chỉnh ($/1 triệu)', `<input id="s-pin" inputmode="decimal" data-set="price.in" placeholder="tự động" value="${s.price?.in || ''}">`)}${row('Giá ra tuỳ chỉnh ($/1 triệu)', `<input id="s-pout" inputmode="decimal" data-set="price.out" placeholder="tự động" value="${s.price?.out || ''}">`)}</div>
  <div class="foot">Giá mặc định theo bảng giá công khai của model; chỉ gọi model khi câu nhập phức tạp, câu đơn giản và tin ngân hàng hiểu trên máy nên miễn phí. Tỷ giá và giá chỉ để ước tính, đối chiếu hoá đơn thật ở trang Anthropic Console.</div>
  <div class="sec"><span>Tin nhắn ngân hàng</span></div>
  <div class="group">${row('Địa chỉ Worker', `<input id="s-wurl" data-set="sync.url" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="https://..." value="${esc(s.sync?.url || '')}">`)}${row('Mã đồng bộ', `<input id="s-wtok" type="text" class="secret" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-set="sync.token" value="${esc(s.sync?.token || '')}">`)}${act('Đồng bộ ngay', 'syncnow')}</div>
  <div class="foot">Phím tắt trên iPhone trích sẵn ngày, số biến động và số dư rồi gửi lên Worker của riêng bạn. Nội dung giao dịch và số tài khoản không được gửi. ${s.lastSync ? 'Đồng bộ lần cuối: ' + new Date(s.lastSync).toLocaleString('vi-VN') : 'Chưa đồng bộ lần nào.'}</div>
  <div class="sec"><span>Giao diện</span></div>
  <div class="group">${row('Chế độ màu', sel('s-theme', 'theme', [['auto', 'Theo hệ thống'], ['light', 'Sáng'], ['dark', 'Tối']], s.theme))}</div>
  <div class="sec"><span>Ứng dụng</span></div>
  <div class="group">${act('Tải bản mới nhất', 'appupdate')}</div>
  <div class="foot">Đang dùng bản <span id="appver">…</span>. Mỗi lần mở app tự kiểm tra bản mới; có bản mới ngay lúc mở thì tự tải lại, đang nhập dở thì hiện nút Tải lại.</div>
  <div class="sec"><span>Sao lưu</span></div>
  <div class="group">${act('Xuất JSON', 'export-json')}${act('Xuất CSV', 'export-csv')}${act('Nhập dữ liệu để khôi phục', 'import')}</div>
  <div class="foot">Dữ liệu nằm trên máy này. Sao lưu lần cuối: ${last}. Chọn "Lưu vào Tệp" để cất vào iCloud Drive.</div>
  <div class="sec"><span>Sao lưu tự động qua Telegram</span></div>
  <form class="group" id="tgform" action="#" autocomplete="on">${row('Mã bot', `<input id="s-tgtok" type="text" name="username" autocomplete="username" autocorrect="off" autocapitalize="off" spellcheck="false" data-set="tg.token" value="${esc(s.tg.token)}" placeholder="từ @BotFather">`)}${row('Mật khẩu sao lưu', `<input id="s-tgpass" type="password" name="password" autocomplete="current-password" autocorrect="off" autocapitalize="off" spellcheck="false" data-set="tg.pass" value="${esc(s.tg.pass)}" placeholder="nên đặt">`)}<button type="submit" class="srow act">Lưu mã bot + mật khẩu vào iPhone<span class="chev">›</span></button>${act('Chép mật khẩu', 'tgcopy')}${act(s.tg.chat ? 'Kết nối lại' : 'Kết nối', 'tgconnect')}${s.tg.chat ? act('Gửi bản sao lưu ngay', 'tgsend') : ''}${act('Khôi phục từ Telegram', 'tgrestore')}</form>
  <div class="foot" id="tgmsg">${s.tg.err ? `<span class="bad">Lần gửi gần nhất lỗi: ${esc(s.tg.err)}.</span> ` : ''}${s.tg.chat ? (s.tg.lastAt ? 'Đã gửi lần cuối: ' + new Date(s.tg.lastAt).toLocaleString('vi-VN') + '. ' : 'Đã kết nối, chưa gửi bản nào. ') : 'Tạo bot ở @BotFather, bấm Start trong bot, dán mã bot rồi bấm Kết nối. '}Mỗi khi mở app, nếu sổ có thay đổi, bot gửi cho bạn một file sao lưu. Có mật khẩu thì file được khoá trên máy trước khi gửi; quên mật khẩu thì không mở được file. Mã bot và mật khẩu chỉ lưu trên máy này.</div>
  <div class="sec"><span>Dữ liệu</span></div>
  <div class="group">${act('Tạo dữ liệu mẫu', 'sample')}${act('Xoá dữ liệu mẫu', 'unsample')}${act('Xoá toàn bộ giao dịch', 'wipe', 'bad', '')}</div>
  <div class="foot">${S.tx.length} giao dịch · ${S.queue.length} câu chờ</div>`;
  // Tên bộ nhớ đệm của service worker chính là số phiên bản (so-chi-vNN).
  window.caches?.keys().then(k => { const v = k.filter(x => x.startsWith('so-chi-v')).sort((a, b) => parseInt(b.slice(8)) - parseInt(a.slice(8)))[0]; const e = $('#appver'); if (e) e.textContent = v ? v.slice(7) : 'chưa rõ'; }).catch(() => {});
}

const RENDER = { home: renderHome, log: renderLog, stats: renderStats, wallet: renderWallet, settings: renderSettings };
function renderTab(t) { if (S.dirty?.has(t)) { S.dirty.delete(t); RENDER[t](); } }
function renderAll() { S.dirty = new Set(Object.keys(RENDER)); renderTab(S.tab); updatePill(); }
function renderAllExceptSettings() { S.dirty = new Set(['home', 'log', 'stats', 'wallet']); renderTab(S.tab); updatePill(); }

/* ---------- sheet ---------- */
function openSheet(html, mount, cls = '') {
  S.chat = cls === 'chat'; if (!S.chat) { chatTouchLock(false); dbgReset(); }
  el.sheet.innerHTML = '<div class="grab"></div>' + html;
  el.sheet.className = 'sheet on' + (cls ? ' ' + cls : ''); el.scrim.classList.add('on'); el.sheet.scrollTop = 0; $('#app').classList.add('sheetopen'); $('main').inert = true; $('.dock').inert = true;
  mount?.(el.sheet);
}
function closeSheet() {
  el.sheet.classList.remove('on'); el.scrim.classList.remove('on'); S.C = null; S.chat = false; chatTouchLock(false); S.ro?.disconnect(); S.ro = null; $('#app').classList.remove('sheetopen'); $('main').inert = false; $('.dock').inert = false;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
let toastT;
function toast(msg, undo) {
  el.toast.innerHTML = `<span>${esc(msg)}</span>` + (undo ? '<button data-act="undo">Hoàn tác</button>' : '');
  el.toast.classList.add('on'); S.undo = undo || null;
  clearTimeout(toastT); toastT = setTimeout(() => el.toast.classList.remove('on'), undo ? 6000 : 2600);
}
function dialog(title, text, okLabel, onOk, danger) {
  S.dlg = onOk;
  openSheet(`<h2>${esc(title)}</h2><p class="sm" style="margin:0 0 14px;font-size:14px">${esc(text)}</p><div class="row2"><button class="btn ghost" data-act="close">Huỷ</button><button class="btn ${danger ? 'danger' : ''}" data-act="dlg-ok">${esc(okLabel)}</button></div>`);
}

/* bàn phím số, kiểu bản gốc */
const KP = { val: '', cat: '', wallet: 'cash', off: 0 };
function openKeypad() {
  KP.val = ''; KP.cat = catNames()[0]; KP.wallet = S.set.defWallet; KP.off = 0;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'];
  openSheet(`<div class="sh"><button class="lnk" data-act="close">Huỷ</button><strong>Khoản chi mới</strong><button class="lnk b" data-act="kpsave">Lưu</button></div>
    <div class="display" id="kpdisp">0<small>đ</small></div><div class="err" id="kperr"></div>
    <div class="cats">${S.set.categories.map(c => `<button class="cat" type="button" data-act="kpcat" data-c="${esc(c.name)}" aria-pressed="${c.name === KP.cat}">${badge(c.name, c.color)}${esc(c.name)}</button>`).join('')}</div>
    <div class="segs"><div class="seg" id="kpw"><button class="${KP.wallet === 'cash' ? 'on' : ''}" data-act="kpw" data-w="cash">Tiền mặt</button><button class="${KP.wallet === 'bank' ? 'on' : ''}" data-act="kpw" data-w="bank">Ngân hàng</button></div>
    <div class="seg" id="kpd"><button class="on" data-act="kpd" data-o="0">Hôm nay</button><button data-act="kpd" data-o="1">Hôm qua</button></div></div>
    <input class="note" id="kpnote" placeholder="Ghi chú, ví dụ: phở bò" autocomplete="off">
    <div class="pad">${keys.map(k => `<button class="k${k === '⌫' || k === '000' ? ' fn' : ''}" type="button" data-act="kpkey" data-k="${k}" ${k === '⌫' ? 'aria-label="Xoá số"' : ''}>${k}</button>`).join('')}</div>
    <button class="link" style="display:block;margin:10px auto 0" data-act="nl">Nhập bằng lời hoặc dán tin nhắn ngân hàng</button>`);
}
const kpShow = () => { $('#kpdisp').innerHTML = (KP.val ? (+KP.val).toLocaleString('vi-VN') : '0') + '<small>đ</small>'; $('#kperr').textContent = ''; };
async function kpSave() {
  if (!KP.val || +KP.val <= 0) { $('#kperr').textContent = 'Nhập số tiền trước khi lưu'; return; }
  const note = ($('#kpnote').value || '').trim(), amount = +KP.val;
  await DB.put('tx', { id: DB.uid(), type: 'chi', date: ymd(addDays(new Date(), -KP.off)), amount, wallet: KP.wallet, toWallet: null, category: KP.cat, note, createdAt: Date.now() });
  if (note) {
    const key = norm(note).replace(/[^a-z0-9]+/g, ' ').trim();
    if (key.length >= 2 && key.length <= 30) { S.set.learned[key] = KP.cat; await saveSet(); }
  }
  await load(); closeSheet(); renderAll(); toast('Đã lưu ' + fmt(amount));
}

/* chi phí gọi model: token và tiền */
const PRICES = { 'claude-haiku-5-5': [0.10, 0.50], 'claude-haiku-4-5': [1, 5], 'claude-sonnet-5-5': [2, 10], 'claude-sonnet-5': [2, 10], 'claude-opus-5-5': [4, 20], 'claude-opus-5': [5, 25] };
function priceOf() {
  const cu = S.set.price || {};
  if (cu.in > 0 && cu.out > 0) return [cu.in, cu.out];
  return PRICES[S.set.model] || null;
}
function costOf(u) {
  const p = priceOf(); if (!p || !u) return null;
  const usd = (u.in * p[0] + u.out * p[1]) / 1e6;
  return { usd, vnd: usd * (S.set.usdVnd || 25500) };
}
const fmtVnd = n => (n < 10 ? n.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : Math.round(n).toLocaleString('vi-VN')) + 'đ';

/* nhập bằng lời: gửi tin nhắn, xử lý ở nền, xem lại như đoạn chat */
const AUTO_OK = 0.8;
const hhmm = t => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const sgnAmt = it => (it.type === 'thu' ? '+' : it.type === 'chuyen' ? '' : '−') + fmt(it.amount);
const cbLine = (it, id) => {
  const mid = it.type === 'chuyen' ? `${W[it.wallet]} → ${W[it.toWallet]}` : `${esc(it.note || it.category)} · ${esc(it.category)} · ${W[it.wallet]}`;
  const inner = `<span>${mid}<br><em>${dlabel(it.date)}</em></span><b class="${it.type === 'thu' ? 'in' : ''}">${sgnAmt(it)}</b>`;
  return id ? `<button class="cb-line" data-act="edit" data-id="${id}">${inner}</button>` : `<div class="cb-line">${inner}</div>`;
};
function costLine(q) {
  if (q.how === 'ai' && q.usage) {
    const c = costOf(q.usage);
    return `<div class="cb-cost">Model · ${q.usage.in} vào + ${q.usage.out} ra token${c ? ` · ≈ ${fmtVnd(c.vnd)}` : ' · chưa có bảng giá'}</div>`;
  }
  if (q.how === 'local' || q.how === 'sms') return `<div class="cb-cost">Hiểu trên máy · 0đ</div>`;
  return '';
}
function chatBubble(q) {
  const me = `<div class="cb-me">${esc(q.text)}<span class="cb-time">${hhmm(q.createdAt)}</span></div>`;
  const items = q.items || [];
  const cost = costLine(q);
  let ai = '';
  if (q.status === 'processing') ai = `<div class="cb-ai"><span class="spin"></span>Đang xử lý...</div>`;
  else if (q.status === 'wait') ai = `<div class="cb-ai">Chờ có mạng để xử lý.<div class="cb-acts"><button data-act="qretry" data-id="${q.id}">Thử lại</button><button data-act="qdel" data-id="${q.id}">Xoá</button></div></div>`;
  else if (q.status === 'error') ai = `<div class="cb-ai"><span class="bad">${esc(q.error || 'Không hiểu được câu này.')}</span><div class="cb-acts"><button data-act="qretry" data-id="${q.id}">Thử lại</button><button data-act="manual">Nhập tay</button><button data-act="qdel" data-id="${q.id}">Xoá</button></div></div>`;
  else if (q.status === 'ready') ai = `<div class="cb-ai warn"><b>Cần bạn xác nhận</b>${items.map(it => cbLine(it)).join('')}${items.find(it => it.ambiguity) ? `<div class="cb-hint">${esc(items.find(it => it.ambiguity).ambiguity)}</div>` : ''}${cost}<div class="cb-acts"><button class="pri" data-act="qopen" data-id="${q.id}">Xác nhận</button><button data-act="qdel" data-id="${q.id}">Bỏ</button></div></div>`;
  else if (q.status === 'saved') {
    const txs = (q.txIds || []).map(id => S.tx.find(t => t.id === id)).filter(Boolean);
    ai = txs.length
      ? `<div class="cb-ai ok"><b>Đã lưu</b>${txs.map(t => cbLine(t, t.id)).join('')}${cost}<div class="cb-acts"><button data-act="qundo" data-id="${q.id}">Hoàn tác</button></div></div>`
      : `<div class="cb-ai"><span class="sm">Đã lưu, nhưng khoản này sau đó đã bị xoá.</span></div>`;
  } else if (q.status === 'undone') ai = `<div class="cb-ai"><span class="sm">Đã hoàn tác.</span><div class="cb-acts"><button data-act="qopen" data-id="${q.id}">Xác nhận lại</button></div></div>`;
  return me + ai;
}
const sigOf = q => [q.status, q.text, (q.txIds || []).map(id => S.tx.some(t => t.id === id) ? 1 : 0).join(''), q.how || '', q.usage?.in || '', q.error || '', (q.items || []).length].join('|');
const chatList = () => [...S.queue].sort((a, b) => a.createdAt - b.createdAt).slice(-40);
const EMPTY_CHAT = `<div class="cb-empty">Gõ một câu như "45k phở" hay "hôm qua grab 62k bằng thẻ". App tự hiểu và lưu ở nền, bạn không cần chờ. Mọi câu đã gửi nằm lại ở đây để xem lại.</div>`;
function chatLogHTML() {
  const list = chatList();
  if (!list.length) return EMPTY_CHAT;
  let last = '';
  return list.map(q => {
    const d = ymd(new Date(q.createdAt)), sep = d !== last ? `<div class="cb-day">${dlabel(d)}</div>` : ''; last = d;
    return sep + `<div class="cb-g" data-id="${q.id}" data-sig="${esc(sigOf(q))}">${chatBubble(q)}</div>`;
  }).join('');
}
function refreshChat() {
  if (!S.chat || !el.sheet.classList.contains('on')) return;
  const log = $('#chatlog'); if (!log) return;
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 140;
  const list = chatList(), ids = new Set(list.map(q => q.id));
  log.querySelectorAll('.cb-g').forEach(g => { if (!ids.has(g.dataset.id)) g.remove(); });
  if (!list.length) { log.innerHTML = EMPTY_CHAT; return; }
  log.querySelector('.cb-empty')?.remove();
  let prev = null, lastDay = '';
  list.forEach(q => {
    const d = ymd(new Date(q.createdAt)), sig = sigOf(q);
    let g = log.querySelector(`.cb-g[data-id="${q.id}"]`);
    if (!g) {
      g = document.createElement('div'); g.className = 'cb-g new'; g.dataset.id = q.id; g.dataset.sig = sig; g.dataset.t = Date.now(); g.innerHTML = chatBubble(q);
      if (d !== lastDay) { const sep = document.createElement('div'); sep.className = 'cb-day'; sep.textContent = dlabel(d); prev ? prev.after(sep) : log.prepend(sep); prev = sep; }
      prev ? prev.after(g) : log.prepend(g);
    } else if (g.dataset.sig !== sig) {
      g.dataset.sig = sig;
      const tmp = document.createElement('div'); tmp.innerHTML = chatBubble(q);
      const ai = tmp.querySelector('.cb-ai'), old = g.querySelector('.cb-ai');
      if (ai) { if (Date.now() - Number(g.dataset.t || 0) > 700) ai.classList.add('chg-ai'); old ? old.replaceWith(ai) : g.append(ai); } else old?.remove();
    }
    prev = g; lastDay = d;
  });
  if (stick) { S.fb = 0; requestAnimationFrame(() => log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' })); }
}
function openEntry() {
  openSheet(`<div class="chat-h"><h2>Nhập chi tiêu</h2><div class="chat-tools"><button class="link" data-act="kp">Bàn phím số</button><button class="link" data-act="manual">Nhập tay</button></div></div>
    ${DBG.on ? '<div class="dbg" id="dbg"><div class="dbg-b"><button type="button" data-dbg="fake">+15 tin thử</button><button type="button" data-dbg="copy">Chép số đo</button><button type="button" data-dbg="clr">Xoá nhật ký</button><button type="button" data-dbg="off">Ẩn bảng</button></div><div class="dbg-s"></div></div>' : ''}
    <div class="chat-log" id="chatlog">${chatLogHTML()}</div>
    <div class="chat-in"><button class="clip" data-act="paste" aria-label="Dán tin nhắn ngân hàng"><svg viewBox="0 0 24 24"><path d="M9 4h6v3H9zM7 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1"/></svg></button>
      ${S.set.altInput ? '<div class="inp ce" id="q" contenteditable="plaintext-only" role="textbox" enterkeyhint="send" autocapitalize="sentences" data-ph="Gõ một câu, ví dụ 45k phở" aria-label="Câu nhập"></div>' : '<textarea class="inp" id="q" rows="1" enterkeyhint="send" autocomplete="off" placeholder="Gõ một câu, ví dụ 45k phở" aria-label="Câu nhập"></textarea>'}
      <button class="send" data-act="send" aria-label="Gửi"><svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button></div>`, sh => {
    const log = $('#chatlog', sh); log.scrollTop = log.scrollHeight;
    // khung co giãn (bàn phím mở/đóng): giữ nguyên tin ở đáy, nội dung được đẩy lên hoặc hạ xuống theo khung
    // (nhớ khoảng cách tới đáy rồi đặt lại, không cộng trừ độ lệch vì trình duyệt có thể đã tự kẹp vị trí cuộn)
    // chỉ ghi nhận vị trí khi chính ngón tay cuộn (đang chạm hoặc đang trôi quán tính); cuộn do khung co giãn hay do code thì bỏ qua để không lệch dần
    // chạm nhẹ (không kéo) hoặc khung đang co giãn thì không tính, vì chạm ra ngoài để cất bàn phím cũng làm danh sách xê dịch
    S.fb = 0; let touching = false, dragged = false, tEnd = 0, mine = -1, ch = log.clientHeight;
    log.addEventListener('touchstart', () => { touching = true; dragged = false; }, { passive: true });
    log.addEventListener('touchmove', () => { dragged = true; }, { passive: true });
    log.addEventListener('touchend', () => { touching = false; tEnd = dragged ? Date.now() : 0; }, { passive: true });
    log.addEventListener('scroll', () => {
      const resized = log.clientHeight !== ch; ch = log.clientHeight;
      if (!resized && dragged && (touching || Date.now() - tEnd < 1500) && Math.abs(log.scrollTop - mine) > 1) S.fb = log.scrollHeight - log.scrollTop - log.clientHeight;
    }, { passive: true });
    S.ro?.disconnect(); S.ro = new ResizeObserver(() => { const fb = S.fb < 40 ? 0 : S.fb, t = log.scrollHeight - log.clientHeight - fb; if (Math.abs(t - log.scrollTop) >= 1) { log.scrollTop = t; mine = log.scrollTop; } }); S.ro.observe(log);
    chatTouchLock(true); dbgMount(sh);
    // không tự mở bàn phím: trên iPhone, bàn phím tự bật rồi bị vuốt đóng làm danh sách kẹt cuộn tới khi chạm lại một lần
    const q = $('#q', sh);
    $('.chat-h h2', sh).addEventListener('click', dbgTap);
    // chạm vào ô nhập: tự chọn ô với preventScroll để iOS không đẩy cả trang lên (đẩy trang làm khung nhảy và giật khi cất bàn phím)
    let qy = 0; q.addEventListener('touchstart', e => { qy = e.touches[0].clientY; }, { passive: true });
    q.addEventListener('touchend', e => {
      if (document.activeElement === q || Math.abs(e.changedTouches[0].clientY - qy) > 10) return;
      e.preventDefault();
      // iOS bỏ qua preventScroll và vẫn đẩy trang nếu thấy ô nhập ở thấp. Nên trong lúc chọn ô, tạm đưa hàng nhập lên cao (ẩn đi)
      // để iOS thấy ô đã nằm gọn trong vùng nhìn, không đẩy trang. Bàn phím lên xong thì trả hàng nhập về
      const row = q.closest('.chat-in'), r = row.getBoundingClientRect();
      row.style.transition = 'none'; row.style.opacity = '0'; row.style.transform = `translateY(${Math.round(90 - r.top)}px)`;
      S.rowHide = row; clearTimeout(S.rowT); S.rowT = setTimeout(rowShow, 450);
      q.focus({ preventScroll: true });
      if (q.isContentEditable) { const r = document.createRange(); r.selectNodeContents(q); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      else q.setSelectionRange(q.value.length, q.value.length);
    }, { passive: false });
    q.addEventListener('input', () => { if (q.isContentEditable) { if (!q.textContent) q.innerHTML = ''; return; } q.style.height = 'auto'; q.style.height = Math.min(110, q.scrollHeight) + 'px'; });
    sh.addEventListener('mousedown', e => { if (e.target.closest('.chat-log button, .chat-in button')) e.preventDefault(); });
    q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromInput(); } });
  }, 'chat');
}
/* khi khung chat mở: chỉ danh sách tin nhắn được cuộn. Mọi cú kéo khác (kể cả ngoài khung) bị chặn để iOS không kéo trôi cả vùng nhìn */
function chatTouchLock(on) {
  if (on === !!S.lock) return; S.lock = on;
  if (on) {
    S.ts = e => { S.y0 = e.touches[0].clientY; S.kbDis = false; dbgStart(e); };
    S.tm = e => {
      const t = e.target, l = $('#chatlog'), dy = e.touches[0].clientY - S.y0; let why = '';
      if (dy > 36 && !S.kbDis && $('#app').classList.contains('kbopen')) { S.kbDis = true; kbClose(); } // vuốt xuống: cất bàn phím
      if (t.closest && t.closest('textarea') && t.scrollHeight > t.clientHeight + 1) why = '';
      else if (t.closest && t.closest('.dbg')) return;
      else if (!l || !(t.closest && t.closest('.chat-log'))) why = 'ngoài log';
      else {
        const atTop = l.scrollTop <= 0, atBottom = l.scrollTop + l.clientHeight >= l.scrollHeight - 1;
        why = l.scrollHeight <= l.clientHeight + 1 ? 'không tràn' : atTop && dy > 0 ? 'ở đỉnh' : atBottom && dy < 0 ? 'ở đáy' : '';
      }
      const g = DBG.g; if (g) { if (!g.mv) g.first = why ? 'CHẶN (' + why + ')' : 'cho'; g.mv++; if (why) g.pv++; }
      if (why && !DBG.nolock) e.preventDefault();
    };
    document.addEventListener('touchstart', S.ts, { passive: true });
    document.addEventListener('touchmove', S.tm, { passive: false });
  } else {
    document.removeEventListener('touchstart', S.ts); document.removeEventListener('touchmove', S.tm);
  }
}
/* chẩn đoán cuộn (tạm thời): đo ngay trên iPhone xem cú kéo bị ai chặn, rồi bật tắt từng nghi phạm để thử */
const DBG = { on: (() => { try { return localStorage.getItem('dbgScroll') === '1'; } catch { return false; } })(), nolock: false, pan: true, mt: true, ovf: true, scrim: true, glass: true, wc: true, g: null, ev: [] };
function dbgDesc(n) {
  if (!n) return '∅';
  if (n.nodeType !== 1) return '#' + n.nodeName.toLowerCase();
  const c = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
  return n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (c ? '.' + c : '');
}
/* ghi vết từng khung hình trong 1,2 giây sau khi chọn hoặc bỏ chọn ô nhập: mốc thời gian (ms), cao vùng nhìn, độ lệch trên, đáy khung chat trên màn hình */
function dbgTrace(kind) {
  if (!DBG.on) return;
  const vv = window.visualViewport, t0 = performance.now(), tr = { kind, f: [] };
  DBG.tr = (DBG.tr || []).concat(tr).slice(-6);
  const step = () => {
    const t = Math.round(performance.now() - t0), r = el.sheet.getBoundingClientRect();
    tr.f.push(`${t}:${Math.round(vv.height)}:${Math.round(vv.offsetTop)}:${Math.round(r.bottom)}${$('#app').classList.contains('kbopen') ? '' : 'c'}`);
    if (t < 1200) requestAnimationFrame(step);
  };
  step();
}
/* chạm tiêu đề "Nhập chi tiêu" 3 lần liền để bật lại bảng chẩn đoán */
function dbgTap() {
  const now = Date.now(); DBG.taps = (DBG.taps || []).filter(t => now - t < 1200).concat(now);
  if (DBG.taps.length < 3) return;
  DBG.taps = []; DBG.on = true; try { localStorage.setItem('dbgScroll', '1'); } catch {} openEntry();
}
function dbgStart(e) {
  if (!DBG.on) return;
  const l = $('#chatlog');
  DBG.g = { tgt: dbgDesc(e.target), mv: 0, pv: 0, first: '', ls: 0, st0: l ? Math.round(l.scrollTop) : 0 };
  dbgEv('t', 'chạm ' + DBG.g.tgt);
}
/* nhật ký sự kiện theo thời gian: bàn phím, tiêu điểm, chạm, nhấc tay, iOS huỷ cử chỉ, luồng chính bị kẹt */
function dbgEv(k, s) {
  if (!DBG.on) return;
  const t = ((performance.now() - (DBG.t0 || 0)) / 1000).toFixed(1), last = DBG.ev[DBG.ev.length - 1];
  if (last && last.k === k && k !== 'vv' && (k === 'ws' || k === 'fix')) { last.s = s; last.c++; last.t2 = t; }
  else { DBG.ev.push({ k, s, t, c: 1 }); if (DBG.ev.length > 11) DBG.ev.shift(); }
  dbgRender();
}
function dbgRender() {
  const p = $('#dbg'), l = $('#chatlog'); if (!p || !l) return;
  const vv = window.visualViewport, a = document.activeElement;
  p.querySelector('.dbg-s').innerHTML = `v43 · log SH ${l.scrollHeight} CH ${l.clientHeight} ST ${Math.round(l.scrollTop)}<br>vv h ${vv ? Math.round(vv.height) : '-'} top ${vv ? Math.round(vv.offsetTop) : '-'} · scrollY ${Math.round(scrollY)} · innerH ${innerHeight} · tiêu điểm ${a && a !== document.body ? dbgDesc(a) : 'không'}`
    + `<div class="dbg-ev">${DBG.ev.map(e => `<div><i>${e.t}${e.c > 1 ? '–' + e.t2 + ' ×' + e.c : ''}</i> ${e.s}</div>`).join('') || 'Chưa có sự kiện.'}</div>`;
}
function dbgApply() {
  const l = $('#chatlog'); if (!l) return;
  l.style.touchAction = DBG.pan ? '' : 'auto';
  l.classList.toggle('nomt', !DBG.mt);
  const ss = el.sheet.style; ss.overflow = DBG.ovf ? '' : 'visible';
  el.scrim.style.touchAction = DBG.scrim ? '' : 'auto';
  ss.backdropFilter = ss.webkitBackdropFilter = DBG.glass ? '' : 'none';
  ss.willChange = DBG.wc ? '' : 'auto';
}
function dbgReset() { const ss = el.sheet.style; ss.overflow = ss.backdropFilter = ss.webkitBackdropFilter = ss.willChange = ''; el.scrim.style.touchAction = ''; }
function dbgMount(sh) {
  const p = $('#dbg', sh), l = $('#chatlog', sh); if (!p) return;
  DBG.t0 = performance.now(); DBG.ev = []; dbgApply();
  l.addEventListener('scroll', () => { if (DBG.g) DBG.g.ls++; }, { passive: true });
  if (!DBG.wired) {
    DBG.wired = true; const vv = window.visualViewport;
    addEventListener('scroll', () => { if (S.chat) dbgEv('ws', 'trang cuộn y ' + Math.round(scrollY)); }, { passive: true });
    document.addEventListener('touchend', () => { const g = DBG.g; if (S.chat && g) dbgEv('e', `nhấc · kéo ${g.mv} · đầu ${g.first || '-'} · chặn ${g.pv} · log cuộn ${g.ls} (${g.st0}→${Math.round(($('#chatlog') || {}).scrollTop || 0)})`); }, { passive: true });
    document.addEventListener('touchcancel', () => { if (S.chat) dbgEv('c', '<b>iOS HUỶ cú chạm</b>'); }, { passive: true });
    document.addEventListener('focusin', e => { if (S.chat) { dbgEv('f', 'focus ' + dbgDesc(e.target)); if (e.target.id === 'q') dbgTrace('mo'); } });
    document.addEventListener('focusout', e => { if (S.chat) { dbgEv('f', 'blur ' + dbgDesc(e.target)); if (e.target.id === 'q') dbgTrace('dong'); } });
    // gộp các lần đổi vùng nhìn liền nhau thành một dòng: cao từ→tới, độ lệch trên lớn nhất, trang cuộn lớn nhất
    if (vv) {
      const f = ev => {
        if (!S.chat) return;
        const h = Math.round(vv.height), t = Math.round(vv.offsetTop), y = Math.round(scrollY), last = DBG.ev[DBG.ev.length - 1];
        if (last && last.k === 'vv') { last.h1 = h; last.tm = Math.max(last.tm, t); last.ym = Math.max(last.ym, y); last.c++; last.t2 = ((performance.now() - DBG.t0) / 1000).toFixed(1); }
        else { dbgEv('vv', ''); Object.assign(DBG.ev[DBG.ev.length - 1], { h0: h, h1: h, tm: t, ym: y }); }
        const e = DBG.ev[DBG.ev.length - 1]; e.s = `vv cao ${e.h0}→${e.h1} · lệch trên max <b>${e.tm}</b> · trang cuộn max ${e.ym}`; dbgRender();
      };
      vv.addEventListener('resize', f); vv.addEventListener('scroll', f);
    }
    // nhịp 200ms: nếu hai nhịp cách nhau quá xa nghĩa là luồng chính của trang bị kẹt
    let last = performance.now();
    setInterval(() => { const now = performance.now(), gap = now - last; last = now; if (S.chat && $('#dbg') && gap > 600) dbgEv('lag', `<b>trang đứng ${Math.round(gap)}ms</b>`); }, 200);
  }
  p.addEventListener('click', e => {
    const b = e.target.closest('[data-dbg]'); if (!b) return; const k = b.dataset.dbg;
    if (k === 'off') { DBG.on = false; try { localStorage.setItem('dbgScroll', '0'); } catch {} p.remove(); return; }
    if (k === 'clr') { DBG.ev = []; DBG.tr = []; }
    else if (k === 'copy') {
      const txt = 'SoChi v43 ' + (navigator.userAgent.match(/OS [\d_]+/) || [''])[0] + ' innerH ' + innerHeight + '\n' + (DBG.tr || []).map(t => t.kind + ' ' + t.f.join(' ')).join('\n');
      const done = ok => { b.textContent = ok ? 'Đã chép ✓' : 'Không chép được'; setTimeout(() => { b.textContent = 'Chép số đo'; }, 1500); };
      navigator.clipboard?.writeText(txt).then(() => done(true), () => done(false)) ?? done(false);
      return;
    }
    else if (k === 'fake') {
      // tin giả chỉ để có chỗ kéo thử: chỉ nằm trên màn hình, không lưu, đóng khung là mất
      const lg = $('#chatlog'), f = document.createElement('div'); f.className = 'cb-fake';
      f.innerHTML = Array.from({ length: 15 }, (_, i) => `<div class="cb-me">Tin thử ${i + 1}: ${20 + i * 5}k cơm trưa<span class="cb-time">thử</span></div><div class="cb-ai"><b>Tin thử, không lưu</b>Ăn uống · ${20 + i * 5}.000₫</div>`).join('');
      lg.querySelector('.cb-empty')?.remove(); lg.prepend(f); lg.scrollTop = lg.scrollHeight;
    }
    dbgRender();
  });
  dbgEv('o', 'mở khung chat');
}
function rowShow() {
  const row = S.rowHide; if (!row) return; S.rowHide = null;
  row.style.transform = ''; row.style.transition = 'opacity .18s ease'; row.style.opacity = '';
}
function kbClose() {
  const q = $('#q'), app = $('#app'); q?.blur();
  if (app.classList.contains('kbopen')) { S.kbHold = Date.now() + 700; app.classList.remove('kbopen'); app.style.setProperty('--kb', '0px'); }
}
function sendFromInput() {
  const q = $('#q'); if (!q) return;
  const text = (q.isContentEditable ? q.textContent : q.value).trim(); if (!text) return;
  if (q.isContentEditable) q.innerHTML = ''; else { q.value = ''; q.style.height = 'auto'; }
  kbClose(); // gửi xong tự cất bàn phím
  sendMessage(text);
}
async function sendMessage(text) {
  const q = { id: DB.uid(), kind: 'chat', text, createdAt: Date.now(), today: ymd(new Date()), status: 'processing' };
  await DB.put('queue', q); S.queue.push(q);
  refreshChat(); renderHome();
  processEntry(q); // chạy ở nền, không chờ
}
async function commitItems(items) {
  const now = Date.now();
  const rows = items.map((it, k) => ({
    id: DB.uid(), type: it.type, date: it.date, amount: Math.round(it.amount), wallet: it.wallet,
    toWallet: it.type === 'chuyen' ? it.toWallet : null, category: it.type === 'chuyen' ? 'Chuyển ví' : it.category,
    note: (it.note || '').trim(), createdAt: now + k,
  }));
  rows.forEach(r => {
    if (r.type === 'chi' && r.note) {
      const key = norm(r.note).replace(/[^a-z0-9]+/g, ' ').trim();
      if (key.length >= 2 && key.length <= 30) S.set.learned[key] = r.category;
    }
  });
  const lk = Object.keys(S.set.learned); if (lk.length > 300) delete S.set.learned[lk[0]];
  await DB.putMany('tx', rows); await saveSet();
  return rows;
}
async function logUsage(u) {
  const mk = mkey(new Date()), c = costOf(u) || { usd: 0 };
  const m = (S.set.usage[mk] ||= { calls: 0, in: 0, out: 0, usd: 0 });
  m.calls++; m.in += u.in; m.out += u.out; m.usd += c.usd;
  await saveSet();
}
async function processEntry(q) {
  const today = pd(q.today);
  const ctx = { today, categories: S.set.categories, learned: S.set.learned, defWallet: S.set.defWallet };
  const canAI = S.set.ai && S.set.apiKey;
  let items = null;
  const sms = parseBankSMS(q.text, ctx);
  if (sms.items.length) {
    items = sms.items; q.how = 'sms';
    items.forEach(it => {
      if (S.tx.some(t => t.date === it.date && t.amount === it.amount && t.type === it.type && t.wallet === 'bank' && !t.recur)) { it.confidence = 0.6; it.ambiguity = 'Có thể trùng với khoản đã ghi, kiểm tra trước khi lưu'; }
    });
  } else {
    const local = parseLocal(q.text, ctx);
    if (local?.certain) { items = local.items; q.how = 'local'; }
    else if (canAI && navigator.onLine) {
      try { const r = await parseWithAI(q.text, { apiKey: S.set.apiKey, model: S.set.model, categories: catNames(), today }); items = r.items; q.usage = r.usage; q.how = 'ai'; await logUsage(r.usage); }
      catch (e) {
        if (local?.items.length) { items = local.items; items.forEach(it => { it.ambiguity = it.ambiguity || 'Không gọi được API, tạm hiểu trên máy'; it.confidence = Math.min(it.confidence, .6); }); }
        else if (e.kind === 'network') q.status = 'wait';
        else { q.status = 'error'; q.error = e.message; }
      }
    } else if (canAI) {
      if (local?.items.length) { items = local.items; items.forEach(it => { it.ambiguity = 'Đang mất mạng, tạm hiểu trên máy'; it.confidence = Math.min(it.confidence, .6); }); }
      else q.status = 'wait';
    } else if (local?.items.length) { items = local.items; q.how = 'local'; }
    else { q.status = 'error'; q.error = 'Câu này cần API key để hiểu. Dán key ở Cài đặt, hoặc bấm "Nhập tay".'; }
  }
  if (items) {
    q.items = items;
    const sure = S.set.autosave !== false && items.every(it => it.confidence >= AUTO_OK && !it.ambiguity && it.amount > 0 && it.date <= ymd(addDays(new Date(), 1)));
    if (sure) {
      const rows = await commitItems(items);
      q.status = 'saved'; q.txIds = rows.map(r => r.id);
    } else q.status = 'ready';
  }
  await DB.put('queue', q);
  await load(); renderAll(); refreshChat();
  if (q.status === 'saved' && !S.chat) toast(`Đã lưu ${q.items.map(sgnAmt).join(', ')}`, () => ACT.qundo({ dataset: { id: q.id } }));
  else if (q.status === 'ready' && !S.chat) toast('Có khoản cần bạn xác nhận');
}
async function processQueue() {
  if (S.busy || !navigator.onLine) return;
  const todo = S.queue.filter(q => q.status === 'wait');
  if (!todo.length) return;
  S.busy = true;
  for (const q of todo) {
    q.status = 'processing'; await DB.put('queue', q); refreshChat();
    await processEntry(q);
    if (q.status === 'wait') break;
  }
  S.busy = false; renderHome(); refreshChat();
}

/* đồng bộ tin ngân hàng từ Worker */
async function syncInbox(manual) {
  const sy = S.set.sync;
  if (!sy?.url || !sy.token) { if (manual) toast('Chưa nhập địa chỉ Worker và mã đồng bộ'); return 0; }
  if (!navigator.onLine || S.syncing) { if (manual) toast('Đang mất mạng hoặc đang đồng bộ'); return 0; }
  S.syncing = true;
  try {
    const items = await fetchInbox(sy);
    const seen = new Set([...(S.set.seen || []), ...S.queue.map(q => q.sid).filter(Boolean)]);
    const fresh = items.filter(x => !seen.has(x.id));
    const names = catNames(), cat = names.includes('Khác') ? 'Khác' : names[0];
    let last = S.set.lastBal, latest = S.set.bankBal;
    const recs = fresh.map(x => {
      const sign = x.dir === 'in' ? 1 : -1;
      const gap = last != null && x.balance != null && x.dir !== 'unknown' ? x.balance - (last + sign * x.amount) : 0;
      if (x.balance != null) { last = x.balance; if (!latest || x.ts >= latest.ts) latest = { amount: x.balance, date: x.date, ts: x.ts }; }
      const amb = x.dir === 'unknown' ? 'Không rõ thu hay chi, hãy kiểm tra' : gap ? `Số dư lệch ${fmt(Math.abs(gap))} so với tin trước, có thể sót giao dịch` : 'Chọn danh mục cho khoản này';
      return {
        id: 'sms-' + x.id, sid: x.id, kind: 'sms', status: 'ready', createdAt: x.ts,
        text: `Ngân hàng ${x.dir === 'in' ? '+' : '−'}${fmt(x.amount)} · ${x.date.slice(8)}/${x.date.slice(5, 7)}`,
        items: [{ type: x.dir === 'in' ? 'thu' : 'chi', date: x.date, amount: x.amount, category: cat, wallet: 'bank', toWallet: null, note: '', confidence: 0.6, ambiguity: amb, fromSms: true }],
      };
    });
    if (recs.length) { await DB.putMany('queue', recs); S.queue.push(...recs); }
    await ackInbox(sy, items.map(x => x.id));
    S.set.seen = [...(S.set.seen || []), ...fresh.map(x => x.id)].slice(-300);
    S.set.lastBal = last; S.set.bankBal = latest; S.set.lastSync = Date.now();
    await saveSet(); renderAll();
    if (recs.length) toast(`Có ${recs.length} giao dịch mới từ ngân hàng, chờ bạn xác nhận`);
    else if (manual) toast('Không có tin mới');
    return recs.length;
  } catch (e) {
    if (manual) toast(e.message);
    return 0;
  } finally { S.syncing = false; }
}

/* xác nhận / sửa */
const blankItem = (date, type = 'chi') => ({
  type, date: date || ymd(new Date()), amount: 0, category: catNames()[0], wallet: S.set.defWallet, toWallet: type === 'chuyen' ? (S.set.defWallet === 'bank' ? 'cash' : 'bank') : null, note: '', confidence: 1, ambiguity: null,
});
function openConfirm({ items, text, hint, mode = 'new', editId, queueId, title }) {
  S.C = { items: items.map(x => ({ ...x })), text, hint, mode, editId, queueId, title, err: '' };
  paintConfirm();
}
function itemCard(it, i, n, mode) {
  const warn = it.confidence < 0.7 || it.ambiguity;
  const cats = catNames(); if (it.category && !cats.includes(it.category)) cats.push(it.category);
  const opt = (arr, cur) => arr.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const wl = [['bank', 'Ngân hàng'], ['cash', 'Tiền mặt']];
  return `<div class="ex ${warn ? 'warn' : ''}"><div class="hd"><div class="seg" style="flex:1">${Object.entries(TYPES).map(([k, l]) => `<button class="${it.type === k ? 'on' : ''}" data-act="ctype" data-i="${i}" data-t="${k}">${l}</button>`).join('')}</div>${mode === 'new' && n > 1 ? `<button class="x" style="margin-left:8px" data-act="crm" data-i="${i}" aria-label="Bỏ khoản này">×</button>` : ''}</div>
    <input class="inp amt" inputmode="numeric" data-f="amount" data-i="${i}" value="${fmtNum(it.amount)}" placeholder="Số tiền, ví dụ 45k" aria-label="Số tiền">
    <div class="cols" style="margin-top:8px"><div class="field"><label>Ngày</label><input type="date" class="inp" data-f="date" data-i="${i}" value="${esc(it.date)}"></div>
    <div class="field"><label>${it.type === 'chuyen' ? 'Từ ví' : 'Ví'}</label><select class="inp" data-f="wallet" data-i="${i}">${opt(wl, it.wallet)}</select></div></div>
    ${it.type === 'chuyen' ? `<div class="field"><label>Đến ví</label><select class="inp" data-f="toWallet" data-i="${i}">${opt(wl, it.toWallet)}</select></div>` : `<div class="field"><label>Danh mục</label><select class="inp" data-f="category" data-i="${i}">${opt(cats.map(c => [c, c]), it.category)}</select></div>`}
    <div class="field" style="margin-bottom:0"><label>Ghi chú</label><input class="inp" data-f="note" data-i="${i}" value="${esc(it.note)}"></div>
    ${warn ? `<div class="hint">${esc(it.ambiguity || 'Chưa chắc, kiểm tra lại nhé')}</div>` : ''}</div>`;
}
function paintConfirm() {
  const C = S.C; if (!C) return;
  const isEdit = C.mode === 'edit', n = C.items.length;
  const t = C.title || (isEdit ? 'Sửa khoản' : n > 1 ? `Tôi hiểu ${n} khoản` : 'Xác nhận khoản');
  openSheet(`<h2>${esc(t)}</h2>${C.text ? `<div class="sm" style="margin:-4px 0 10px">“${esc(C.text)}”</div>` : ''}${C.hint ? `<div class="hint" style="margin:-2px 0 10px">${esc(C.hint)}</div>` : ''}
    ${C.items.map((it, i) => itemCard(it, i, n, C.mode)).join('')}
    ${C.err ? `<div class="hint bad" style="margin-bottom:8px">${esc(C.err)}</div>` : ''}
    ${!isEdit ? '<button class="link" data-act="cadd">+ Thêm khoản</button><div style="height:6px"></div>' : ''}
    <button class="btn" data-act="csave">${isEdit ? 'Lưu' : `Lưu ${n} khoản`}</button>
    ${isEdit ? '<div style="height:8px"></div><button class="btn danger" data-act="cdel">Xoá khoản này</button>' : ''}
    ${C.queueId ? '<div style="height:8px"></div><button class="btn ghost" data-act="qskip">Bỏ tin này</button>' : ''}`);
}
function fieldChange(t, final) {
  const C = S.C; if (!C) return;
  const i = +t.dataset.i, f = t.dataset.f, it = C.items[i]; if (!it) return;
  if (f === 'amount') {
    const v = amountFromText(t.value); it.amount = v || 0;
    if (final) t.value = fmtNum(it.amount);
  } else {
    it[f] = t.value;
    if (f === 'wallet' && it.type === 'chuyen') { it.toWallet = it.wallet === 'bank' ? 'cash' : 'bank'; paintConfirm(); }
  }
  if (f !== 'amount' || final) { it.confidence = Math.max(it.confidence, 0.9); if (final) it.ambiguity = null; }
}
async function saveConfirm() {
  const C = S.C; if (!C) return;
  for (const it of C.items) {
    if (!(it.amount > 0)) { C.err = 'Có khoản chưa nhập số tiền.'; paintConfirm(); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date)) { C.err = 'Có khoản chưa chọn ngày.'; paintConfirm(); return; }
    if (it.type === 'chuyen' && it.wallet === it.toWallet) { C.err = 'Hai ví chuyển phải khác nhau.'; paintConfirm(); return; }
  }
  const now = Date.now();
  const rows = C.items.map((it, k) => {
    const old = C.mode === 'edit' ? S.tx.find(x => x.id === C.editId) : null;
    const row = {
      id: old?.id || DB.uid(), type: it.type, date: it.date, amount: Math.round(it.amount), wallet: it.wallet,
      toWallet: it.type === 'chuyen' ? it.toWallet : null, category: it.type === 'chuyen' ? 'Chuyển ví' : it.category,
      note: (it.note || '').trim(), createdAt: old?.createdAt || now + k,
    };
    if (old?.adjust) row.adjust = true;
    if (old?.sample) row.sample = true;
    return row;
  });
  rows.forEach(r => {
    if (r.type === 'chi' && r.note) {
      const key = norm(r.note).replace(/[^a-z0-9]+/g, ' ').trim();
      if (key.length >= 2 && key.length <= 30) S.set.learned[key] = r.category;
    }
  });
  const lk = Object.keys(S.set.learned); if (lk.length > 300) delete S.set.learned[lk[0]];
  await DB.putMany('tx', rows); await saveSet();
  if (C.queueId) {
    const qe = S.queue.find(q => q.id === C.queueId);
    if (qe) { qe.status = 'saved'; qe.items = C.items.map(x => ({ ...x })); qe.txIds = rows.map(r => r.id); await DB.put('queue', qe); }
  }
  const n = rows.length;
  await load(); closeSheet(); renderAll(); toast(C.mode === 'edit' ? 'Đã lưu' : `Đã lưu ${n} khoản`);
}
async function deleteTx(id) {
  const t = S.tx.find(x => x.id === id); if (!t) return;
  await DB.del('tx', id); S.tx = S.tx.filter(x => x.id !== id); closeSheet(); renderAll();
  toast('Đã xoá khoản', async () => { await DB.put('tx', t); await load(); renderAll(); toast('Đã hoàn tác'); });
}

/* ngày, điều chỉnh số dư */
function openDay(ds) {
  const list = S.tx.filter(t => t.date === ds), total = dayTotal(ds), d = pd(ds);
  const lim = ds === ymd(new Date()) ? todayCalc().allow : dayLimit(monthInfo(ds.slice(0, 7)).dim);
  openSheet(`<h2>${WDN[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}</h2><div class="rowf" style="margin-bottom:2px"><span class="sm">Tổng chi trong ngày</span><b style="font-size:20px">${fmt(total)}</b></div>${lim > 0 ? gb(total / lim, ' style="margin:6px 0 4px"') + `<div class="sm" style="margin-bottom:10px">${total > lim ? 'Vượt ' + fmtS(total - lim) : 'Còn ' + fmtS(lim - total)} so với ngân sách ngày ${fmtS(lim)}</div>` : ''}
    <div class="card" style="padding-block:4px;margin-bottom:12px">${list.length ? list.map(t => txRow(t)).join('') : '<div class="empty">Ngày này chưa có khoản nào.</div>'}</div>
    <button class="btn" data-act="addday" data-d="${ds}">Thêm khoản cho ngày này</button>`);
}
function openAdjust() {
  const b = balances();
  openSheet(`<h2>Điều chỉnh số dư</h2><p class="sm" style="margin:0 0 12px;font-size:14px">Nhập số tiền thực tế bạn đang có. App tạo một khoản chênh lệch có nhãn "Điều chỉnh" và không tính vào chi tiêu.</p>
    <div class="field"><label for="aw">Ví</label><select class="inp" id="aw"><option value="cash">Tiền mặt (sổ đang ghi ${fmt(b.cash)})</option><option value="bank">Ngân hàng (sổ đang ghi ${fmt(b.bank)})</option></select></div>
    <div class="field"><label for="av">Số dư thực tế</label><input class="inp" id="av" inputmode="numeric" placeholder="Ví dụ 1tr2"></div>
    <div class="hint bad" id="aerr"></div><button class="btn" data-act="adjok">Điều chỉnh</button>`, sh => $('#av', sh).focus());
}
async function applyAdjust() {
  const w = $('#aw').value, raw = $('#av').value.trim(), v = amountFromText(raw);
  if (!raw || v == null) { $('#aerr').textContent = 'Nhập số tiền thực tế.'; return; }
  const diff = v - balances()[w];
  if (!diff) { closeSheet(); toast('Số dư đã khớp'); return; }
  await DB.put('tx', { id: DB.uid(), type: diff > 0 ? 'thu' : 'chi', date: ymd(new Date()), amount: Math.abs(diff), wallet: w, toWallet: null, category: 'Điều chỉnh', note: 'Điều chỉnh số dư', createdAt: Date.now(), adjust: true });
  await load(); closeSheet(); renderAll(); toast('Đã điều chỉnh ' + (diff > 0 ? '+' : '−') + fmt(Math.abs(diff)));
}

/* ---------- sao lưu, nhập, dữ liệu mẫu ---------- */
async function doExport(kind) {
  const stamp = ymd(new Date());
  let blob, name;
  if (kind === 'json') {
    blob = new Blob([backupJSON()], { type: 'application/json' });
    name = `so-chi-${stamp}.json`;
  } else {
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const rows = [['Ngày', 'Loại', 'Số tiền', 'Danh mục', 'Ví', 'Đến ví', 'Ghi chú'].map(q).join(',')];
    [...S.tx].sort((a, b) => a.date.localeCompare(b.date)).forEach(t => rows.push([t.date, TYPES[t.type], t.amount, t.category, W[t.wallet], t.toWallet ? W[t.toWallet] : '', t.note].map(q).join(',')));
    blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    name = `so-chi-${stamp}.csv`;
  }
  const file = new File([blob], name, { type: blob.type });
  let done = false;
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); done = true; }
  } catch (e) { if (e.name === 'AbortError') return; }
  if (!done) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  if (kind === 'json') { S.set.lastBackup = Date.now(); await saveSet(); renderHome(); renderSettings(); }
  toast('Đã xuất ' + name);
}
// Nội dung sao lưu: không có API key, mã đồng bộ và thông tin bot.
function backupJSON() {
  const { apiKey, sync, tg, ...rest } = S.set;
  return JSON.stringify({ app: 'so-chi', version: 1, exportedAt: new Date().toISOString(), settings: rest, tx: S.tx }, null, 1);
}
// Chỉ gửi khi phần dữ liệu thật đổi (không tính giờ đồng bộ, lần sao lưu...).
const dataSig = () => sig(JSON.stringify([S.tx, S.set.recurring, S.set.categories, S.set.budget, S.set.dailyBudget, S.set.open]));
const tgReady = () => !!(S.set.tg.token && S.set.tg.chat);
const TG_KEEP = 3;
let tgBusy = false;
async function tgBackup(force) {
  const g = S.set.tg;
  if (!tgReady() || tgBusy || !navigator.onLine || !S.tx.length || S.tx.every(t => t.sample)) return false;
  const s = dataSig();
  if (!force && s === g.lastSig) return false;
  tgBusy = true;
  try {
    const now = new Date(), json = backupJSON();
    const text = g.pass ? await lock(json, g.pass) : json;
    const name = `so-chi-${ymd(now)}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.json`;
    const cap = `Sổ Chi · ${S.tx.length} giao dịch · ${now.toLocaleString('vi-VN')}${g.pass ? ' · đã khoá bằng mật khẩu sao lưu' : ''}`;
    // Giữ TG_KEEP tin trong chat: chưa đủ thì gửi mới, đủ rồi thì thay file trong tin cũ nhất.
    let fileId;
    if (g.slots.length < TG_KEEP) { const m = await sendFile(g.token, g.chat, text, name, cap); g.slots.push(m.id); fileId = m.fileId; }
    else {
      const i = g.next % g.slots.length;
      try { fileId = await replaceFile(g.token, g.chat, g.slots[i], text, name, cap); }
      catch { const m = await sendFile(g.token, g.chat, text, name, cap); g.slots[i] = m.id; fileId = m.fileId; } // tin đã bị xoá tay: gửi tin mới vào ô đó
      g.next = (i + 1) % g.slots.length;
    }
    Object.assign(g, { lastAt: Date.now(), lastSig: s, err: '' });
    await tgIndex(fileId, cap);
    return true;
  } catch (e) { g.err = e.message; return false; }
  finally { tgBusy = false; await saveSet(); if (S.tab === 'settings') renderSettings(); }
}
// Tin "mục lục" được ghim: ghi mã file của bản mới nhất (và các ô) để máy mới tìm ra mà khôi phục.
// Ghim một lần, các lần sau chỉ sửa chữ nên không tạo thêm tin.
const TG_MARK = 'sochi:';
async function tgIndex(fileId, cap) {
  const g = S.set.tg;
  if (!fileId) return;
  const text = `Sổ Chi – bản sao lưu mới nhất\n${cap}\n\nĐừng xoá hay bỏ ghim tin này: app dùng nó để khôi phục từ Telegram.\n\n${TG_MARK}${JSON.stringify({ f: fileId, s: g.slots, n: g.next })}`;
  try { if (g.index) { await editText(g.token, g.chat, g.index, text); return; } } catch {} // tin mục lục bị xoá: tạo lại
  g.index = await sendText(g.token, g.chat, text);
  await pin(g.token, g.chat, g.index);
}
async function tgRestore() {
  const g = S.set.tg, m = $('#tgmsg');
  g.token = $('#s-tgtok').value.trim() || g.token; g.pass = $('#s-tgpass').value.trim() || g.pass;
  if (!g.token) { m.innerHTML = '<span class="bad">Dán mã bot trước.</span>'; return; }
  m.textContent = 'Đang tìm bản sao lưu trong Telegram...';
  try {
    const chat = g.chat || await findChat(g.token);
    const p = await getPinned(g.token, chat);
    const at = p?.text?.lastIndexOf(TG_MARK) ?? -1;
    if (at < 0) throw new Error('Chưa thấy tin ghim "bản sao lưu mới nhất" trong chat với bot');
    const idx = JSON.parse(p.text.slice(at + TG_MARK.length));
    const text = await download(g.token, idx.f);
    Object.assign(g, { chat, index: p.message_id, slots: idx.s || [], next: idx.n || 0, err: '' });
    await saveSet();
    m.textContent = 'Đã tải bản sao lưu.';
    await importText(text, true);
  } catch (e) { m.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
}
async function onImportFile(file) {
  if (file) importText(await file.text());
}
async function importText(raw, fromTg) {
  try {
    let data = JSON.parse(raw);
    if (data.app === 'so-chi' && data.enc) {
      const pass = S.set.tg.pass || prompt('Nhập mật khẩu sao lưu để mở file này');
      if (!pass) return;
      try { data = JSON.parse(await unlock(data, pass)); }
      catch (e) { toast(e.message); return; }
    }
    if (data.app !== 'so-chi' || !Array.isArray(data.tx)) throw new Error('bad');
    const ok = data.tx.filter(t => t && t.id && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.amount > 0 && ['chi', 'thu', 'chuyen'].includes(t.type));
    S.pendingImport = { data, ok, fromTg };
    dialog('Khôi phục dữ liệu?', `File có ${ok.length} giao dịch${data.exportedAt ? ' (sao lưu lúc ' + new Date(data.exportedAt).toLocaleString('vi-VN') + ')' : ''}. Dữ liệu hiện tại (${S.tx.length} giao dịch) sẽ bị thay thế.`, 'Khôi phục', doImport, true);
  } catch { toast('File không đúng định dạng của Sổ Chi'); }
}
async function doImport() {
  const { data, ok, fromTg } = S.pendingImport; const key = S.set.apiKey;
  await DB.clear('tx'); await DB.putMany('tx', ok);
  if (data.settings) { S.set = Object.assign(structuredClone(DEF_SET), data.settings, { apiKey: key, sync: S.set.sync, tg: S.set.tg }); await saveSet(); }
  await load();
  if (fromTg) { S.set.tg.lastSig = dataSig(); await saveSet(); } // vừa lấy từ Telegram về thì khỏi gửi lại y hệt
  applyTheme(); closeSheet(); renderAll(); toast(`Đã khôi phục ${ok.length} giao dịch`);
}
function sampleTx() {
  const now = new Date(), today = now.getDate();
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const tpl = [['Phở bò', 'Ăn uống', 40, 65, 'cash'], ['Cơm trưa', 'Ăn uống', 35, 60, 'cash'], ['Bún chả', 'Ăn uống', 45, 70, 'cash'], ['Bánh mì', 'Ăn uống', 20, 30, 'cash'], ['Lẩu với bạn', 'Ăn uống', 150, 260, 'bank'],
    ['Cà phê sữa', 'Cà phê', 25, 45, 'bank'], ['Trà sữa', 'Cà phê', 40, 60, 'bank'], ['Matcha latte', 'Cà phê', 45, 65, 'bank'],
    ['Grab', 'Đi lại', 35, 90, 'bank'], ['Đổ xăng', 'Đi lại', 50, 90, 'cash'], ['Gửi xe', 'Đi lại', 5, 15, 'cash'],
    ['Siêu thị', 'Mua sắm', 120, 380, 'bank'], ['Mua sách', 'Mua sắm', 90, 180, 'bank'], ['Áo thun', 'Mua sắm', 180, 350, 'bank'], ['Thuốc', 'Khác', 40, 120, 'cash']];
  const out = []; let c = Date.now();
  for (let off = 2; off >= 0; off--) {
    const first = new Date(now.getFullYear(), now.getMonth() - off, 1), y = first.getFullYear(), m = first.getMonth();
    const last = off === 0 ? today : new Date(y, m + 1, 0).getDate();
    const mk = (day, o) => { if (day <= last) out.push({ id: DB.uid(), toWallet: null, createdAt: c++, sample: true, ...o, date: `${y}-${pad(m + 1)}-${pad(day)}` }); };
    for (let d = 1; d <= last; d++) {
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const t = tpl[Math.floor(rnd() * tpl.length)];
        mk(d, { type: 'chi', amount: Math.round((t[2] + rnd() * (t[3] - t[2])) * 0.4 / 5) * 5000, category: t[1], wallet: t[4], note: t[0] });
      }
    }
    mk(1, { type: 'thu', amount: 15000000, category: 'Khác', wallet: 'bank', note: 'Lương' });
    mk(2, { type: 'chuyen', amount: 2000000, category: 'Chuyển ví', wallet: 'bank', toWallet: 'cash', note: '' });
    if (off > 0) {
      mk(1, { type: 'chi', amount: 1500000, category: 'Hoá đơn', wallet: 'bank', note: 'Tiền nhà' });
      mk(3, { type: 'chi', amount: 600000 + Math.round(rnd() * 8) * 10000, category: 'Hoá đơn', wallet: 'bank', note: 'Tiền điện' });
      mk(12, { type: 'chi', amount: 220000, category: 'Hoá đơn', wallet: 'bank', note: 'Internet' });
      mk(27, { type: 'chi', amount: 180000, category: 'Hoá đơn', wallet: 'bank', note: 'Netflix' });
    }
  }
  return out;
}
async function makeSample(reset) {
  if (reset) {
    const ids = S.tx.filter(t => t.sample).map(t => t.id); if (ids.length) await DB.delMany('tx', ids);
    const qids = S.queue.filter(q => q.sample).map(q => q.id); if (qids.length) await DB.delMany('queue', qids);
    S.set.recurring = S.set.recurring.filter(r => !r.sample); await saveSet(); await load();
  }
  await DB.putMany('tx', sampleTx());
  const som = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const base = { type: 'chi', category: 'Hoá đơn', wallet: 'bank', freq: 'month', start: som, active: true, last: null, sample: true };
  S.set.recurring = [...S.set.recurring.filter(r => !r.sample),
    { ...base, id: DB.uid(), name: 'Tiền nhà', amount: 1500000, day: 1 },
    { ...base, id: DB.uid(), name: 'Tiền điện', amount: 650000, day: 3 },
    { ...base, id: DB.uid(), name: 'Internet', amount: 220000, day: 12 },
    { ...base, id: DB.uid(), name: 'Netflix', amount: 180000, day: 27 },
    { ...base, id: DB.uid(), type: 'thu', category: 'Khác', name: 'Phụ cấp', amount: 1000000, day: 15, freq: 'month' }];
  await saveSet(); await load(); await runRecurring();
  // vài khoản từ tin nhắn ngân hàng đang chờ xác nhận
  if (!S.queue.some(q => q.sample)) {
    const t0 = ymd(new Date());
    const mkq = (id, amount, type, note) => ({ id: 'sms-' + id, sid: id, kind: 'sms', sample: true, status: 'ready', createdAt: Date.now() + amount, text: `Ngân hàng ${type === 'thu' ? '+' : '−'}${fmt(amount)} · ${t0.slice(8)}/${t0.slice(5, 7)}`, items: [{ type, date: t0, amount, category: 'Khác', wallet: 'bank', toWallet: null, note: '', confidence: 0.6, ambiguity: note, fromSms: true }] });
    const qs = [mkq('demo1', 62000, 'chi', 'Chọn danh mục cho khoản này'), mkq('demo2', 350000, 'chi', 'Chọn danh mục cho khoản này'), mkq('demo3', 500000, 'thu', 'Chọn danh mục cho khoản này')];
    await DB.putMany('queue', qs); S.queue.push(...qs);
  }
  if (!S.set.open.bank && !S.set.open.cash) S.set.open = { bank: 6000000, cash: 500000 };
  const BUD = { 'Ăn uống': 1500000, 'Cà phê': 400000, 'Đi lại': 500000, 'Hoá đơn': 2800000, 'Mua sắm': 600000 };
  S.set.categories.forEach(c => { if (!c.budget && BUD[c.name]) c.budget = BUD[c.name]; });
  S.set.welcomed = true; await saveSet(); await load(); renderAll(); toast('Đã tạo dữ liệu mẫu');
}

/* ---------- giao diện: tab, pill, theme ---------- */
const TITLES = { home: 'Hôm nay', log: 'Sổ chi', stats: 'Thống kê', wallet: 'Ví', settings: 'Cài đặt' };
function setTab(t) {
  S.tab = t; renderTab(t);
  Object.entries({ home: el.home, log: el.log, stats: el.stats, wallet: el.wallet, settings: el.settings }).forEach(([k, v]) => v.classList.toggle('on', k === t));
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  updatePill();
}
function updatePill() {
  const v = el[S.tab];
  el.pill.textContent = S.pill[S.tab] || TITLES[S.tab];
  el.pill.classList.toggle('on', v.scrollTop > 90);
}
function applyTheme() {
  const r = document.documentElement;
  if (S.set.theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', S.set.theme);
}

/* ---------- sự kiện ---------- */
const ACT = {
  tab: b => setTab(b.dataset.tab),
  add: () => openEntry(),
  kp: () => openKeypad(),
  nl: () => openEntry(),
  kpkey: b => { const k = b.dataset.k; if (k === '⌫') KP.val = KP.val.slice(0, -1); else if (KP.val.length < 10 && !(KP.val === '' && k[0] === '0')) KP.val += k; kpShow(); },
  kpcat: b => { KP.cat = b.dataset.c; document.querySelectorAll('.cat').forEach(x => x.setAttribute('aria-pressed', String(x === b))); },
  kpw: b => { KP.wallet = b.dataset.w; b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); },
  kpd: b => { KP.off = +b.dataset.o; b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); },
  kpsave: () => kpSave(),
  jump: b => { S.ld = b.dataset.d; S.lm = 'day'; renderLog(); if (b.dataset.go) setTab('log'); },
  radd: () => openRecur(null),
  redit: b => openRecur(b.dataset.id),
  rtype: b => { S.R.type = b.dataset.t; paintRecur(); },
  rsave: () => saveRecur(),
  rdel: () => { const id = S.R.id; dialog('Xoá khoản định kỳ?', 'Các khoản đã ghi trong sổ vẫn giữ nguyên, chỉ dừng tạo khoản mới.', 'Xoá', async () => { S.set.recurring = S.set.recurring.filter(r => r.id !== id); await saveSet(); closeSheet(); renderAll(); toast('Đã xoá khoản định kỳ'); }, true); },
  rmanage: () => { setTab('settings'); setTimeout(() => $('#recur-card')?.scrollIntoView({ block: 'start' }), 50); },
  reload: () => location.reload(),
  appupdate: async () => {
    if (!navigator.onLine) { toast('Đang mất mạng, chưa tải được bản mới'); return; }
    toast('Đang tải bản mới nhất...');
    try { await S.reg?.update(); } catch {}
    setTimeout(() => location.reload(), 400); // trang luôn lấy file mới từ máy chủ nên tải lại là đủ
  },
  syncnow: () => syncInbox(true),
  monthgo: () => { S.lm = 'month'; S.lmk = mkey(new Date()); S.lcat = ''; S.q = ''; renderLog(); setTab('log'); },
  goq: () => $('#pending')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
  qskip: async () => { const id = S.C?.queueId; if (!id) return; await DB.del('queue', id); S.queue = S.queue.filter(q => q.id !== id); closeSheet(); renderAll(); toast('Đã bỏ tin'); },
  balfix: async () => {
    const bb = S.set.bankBal; if (!bb) return;
    const diff = bb.amount - (balances().bank + pendingBank().net); if (!diff) return;
    await DB.put('tx', { id: DB.uid(), type: diff > 0 ? 'thu' : 'chi', date: ymd(new Date()), amount: Math.abs(diff), wallet: 'bank', toWallet: null, category: 'Điều chỉnh', note: 'Khớp số dư ngân hàng', createdAt: Date.now(), adjust: true });
    await load(); renderAll(); toast('Đã khớp số dư ngân hàng');
  },
  lmode: b => { S.lm = b.dataset.m; renderLog(); },
  dprev: () => { S.ld = ymd(addDays(pd(S.ld), -1)); renderLog(); },
  dnext: () => { const n = ymd(addDays(pd(S.ld), 1)); if (n <= ymd(new Date())) { S.ld = n; renderLog(); } },
  lmprev: () => { const [y, m] = S.lmk.split('-').map(Number); S.lmk = mkey(new Date(y, m - 2, 1)); renderLog(); },
  lmnext: () => { const [y, m] = S.lmk.split('-').map(Number); const n = mkey(new Date(y, m, 1)); if (n <= mkey(new Date())) { S.lmk = n; renderLog(); } },
  lcat: b => { S.lcat = b.dataset.c; renderLog(); },
  close: () => closeSheet(),
  send: () => sendFromInput(),
  paste: async () => {
    try { const t = (await navigator.clipboard.readText()).trim(); if (t) sendMessage(t); else toast('Bộ nhớ tạm đang trống'); }
    catch { toast('Không đọc được bộ nhớ tạm. Hãy giữ ô nhập và chọn Dán.'); }
  },
  qretry: async b => { const q = S.queue.find(x => x.id === b.dataset.id); if (!q) return; q.status = 'processing'; q.error = ''; await DB.put('queue', q); refreshChat(); processEntry(q); },
  qundo: async b => {
    const q = S.queue.find(x => x.id === b.dataset.id); if (!q) return;
    await DB.delMany('tx', q.txIds || []); q.status = 'undone'; q.txIds = []; await DB.put('queue', q);
    await load(); renderAll(); refreshChat(); toast('Đã hoàn tác');
  },
  manual: () => openConfirm({ items: [blankItem()], title: 'Nhập tay' }),
  edit: b => { const t = S.tx.find(x => x.id === b.dataset.id); if (t) openConfirm({ items: [{ ...t, confidence: 1, ambiguity: null }], mode: 'edit', editId: t.id }); },
  ctype: b => { const it = S.C.items[+b.dataset.i], t = b.dataset.t; it.type = t; if (t === 'chuyen') it.toWallet = it.wallet === 'bank' ? 'cash' : 'bank'; paintConfirm(); },
  crm: b => { S.C.items.splice(+b.dataset.i, 1); paintConfirm(); },
  cadd: () => { S.C.items.push(blankItem(S.C.items.at(-1)?.date)); paintConfirm(); },
  csave: () => saveConfirm(),
  cdel: () => deleteTx(S.C.editId),
  undo: () => { const f = S.undo; el.toast.classList.remove('on'); S.undo = null; f?.(); },
  day: b => openDay(b.dataset.d),
  addday: b => openConfirm({ items: [blankItem(b.dataset.d)], title: 'Thêm khoản' }),
  mprev: () => { const [y, m] = S.month.split('-').map(Number); S.month = mkey(new Date(y, m - 2, 1)); renderStats(); updatePill(); },
  mnext: () => { const [y, m] = S.month.split('-').map(Number); const n = mkey(new Date(y, m, 1)); if (n <= mkey(new Date())) { S.month = n; renderStats(); updatePill(); } },
  wf: b => { S.wf = b.dataset.k; renderWallet(); },
  transfer: () => openConfirm({ items: [blankItem(null, 'chuyen')], title: 'Chuyển ví' }),
  adjust: () => openAdjust(),
  adjok: () => applyAdjust(),
  qopen: b => { const q = S.queue.find(x => x.id === b.dataset.id); if (q) openConfirm({ items: q.items, text: q.text, queueId: q.id }); },
  qdel: async b => {
    const id = b.dataset.id, g = S.chat ? document.querySelector(`.cb-g[data-id="${id}"]`) : null;
    if (g) { g.style.setProperty('--h', g.offsetHeight + 'px'); g.classList.add('out'); await new Promise(r => setTimeout(r, 280)); }
    await DB.del('queue', id); S.queue = S.queue.filter(q => q.id !== id); renderHome(); refreshChat();
  },
  sample: () => makeSample(),
  welcomed: async () => { S.set.welcomed = true; await saveSet(); renderHome(); },
  unsample: async () => { const ids = S.tx.filter(t => t.sample).map(t => t.id); await DB.delMany('tx', ids); const qids = S.queue.filter(q => q.sample).map(q => q.id); if (qids.length) { await DB.delMany('queue', qids); S.queue = S.queue.filter(q => !q.sample); } S.set.recurring = S.set.recurring.filter(r => !r.sample); await saveSet(); await load(); renderAll(); toast(`Đã xoá ${ids.length} khoản mẫu`); },
  wipe: () => dialog('Xoá toàn bộ giao dịch?', 'Hành động này không hoàn tác được. Nên xuất JSON để sao lưu trước.', 'Xoá hết', async () => { await DB.clear('tx'); await DB.clear('queue'); await load(); closeSheet(); renderAll(); toast('Đã xoá'); }, true),
  'dlg-ok': () => S.dlg?.(),
  tgconnect: async () => {
    const g = S.set.tg, m = $('#tgmsg');
    if (!g.token) { m.innerHTML = '<span class="bad">Dán mã bot trước.</span>'; return; }
    m.textContent = 'Đang kết nối...';
    try {
      const chat = await findChat(g.token);
      if (chat !== g.chat) { g.slots = []; g.next = 0; g.index = null; }
      g.chat = chat;
      await sendText(g.token, g.chat, 'Sổ Chi đã kết nối. Từ giờ bot sẽ gửi file sao lưu vào đây mỗi khi sổ có thay đổi.');
      g.err = ''; g.lastSig = ''; await saveSet(); renderSettings(); toast('Đã kết nối, xem tin thử trong Telegram');
      tgBackup(true);
    } catch (e) { m.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
  },
  tgrestore: () => tgRestore(),
  tgcopy: async () => { if (!S.set.tg.pass) { toast('Chưa có mật khẩu'); return; } try { await navigator.clipboard.writeText(S.set.tg.pass); toast('Đã chép mật khẩu, dán vào app Mật khẩu hoặc Ghi chú'); } catch { toast('Không chép được'); } },
  tgsend: async () => { if (!tgReady()) { toast('Bấm Kết nối trước'); return; } toast('Đang gửi...'); toast(await tgBackup(true) ? 'Đã gửi bản sao lưu' : 'Chưa gửi được: ' + (S.set.tg.err || 'chưa có dữ liệu thật')); },
  schedok: async () => { S.set.schedCheckAt = Date.now(); await saveSet(); renderHome(); toast('Đã ghi nhận, sẽ nhắc lại sau'); },
  'export-json': () => doExport('json'),
  'export-csv': () => doExport('csv'),
  import: () => { el.file.value = ''; el.file.click(); },
  catadd: async () => { S.set.categories.push({ name: 'Danh mục mới', color: '#64748b' }); await saveSet(); renderSettings(); },
  catdel: b => {
    const c = S.set.categories[+b.dataset.i]; if (!c) return;
    if (S.set.categories.length <= 1) { toast('Cần giữ ít nhất một danh mục'); return; }
    const used = S.tx.filter(t => t.category === c.name).length;
    dialog(`Xoá danh mục "${c.name}"?`, used ? `${used} khoản đang dùng danh mục này sẽ chuyển sang "Khác".` : 'Danh mục chưa có khoản nào.', 'Xoá', async () => {
      const fb = S.set.categories.find(x => x.name === 'Khác' && x !== c)?.name || S.set.categories.find(x => x !== c).name;
      const moved = S.tx.filter(t => t.category === c.name).map(t => ({ ...t, category: fb }));
      if (moved.length) await DB.putMany('tx', moved);
      S.set.categories.splice(+b.dataset.i, 1); await saveSet(); await load(); closeSheet(); renderAll();
    }, true);
  },
  testkey: async () => {
    const m = $('#keymsg'); m.innerHTML = '<span class="spin"></span>Đang thử...';
    try { await testKey({ apiKey: S.set.apiKey, model: S.set.model }); m.innerHTML = '<span class="ok">Kết nối tốt.</span>'; }
    catch (e) { m.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
  },
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const f = ACT[b.dataset.act]; if (f) { e.preventDefault(); if (S.chat && b.closest('.chat-log, .chat-in') && document.activeElement?.id === 'q' && !['qopen', 'edit', 'manual', 'kp'].includes(b.dataset.act)) $('#q')?.focus({ preventScroll: true }); f(b, e); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.f) fieldChange(t, false);
  else if (t.dataset.r) rField(t, false);
  else if (t.dataset.q !== undefined) { S.q = t.value; const l = $('#loglist'); if (l) l.innerHTML = logMonthList(); }
});
// Form sao lưu Telegram: mã bot là "tên người dùng", mật khẩu sao lưu là "mật khẩu", để iOS lưu
// cả hai thành một mục trong app Mật khẩu và điền lại một chạm trên máy mới.
// Bấm "Lưu vào iPhone" là gửi form; vẽ lại form sau khi gửi (Safari coi form biến mất là đăng nhập xong).
document.addEventListener('submit', async e => {
  if (e.target.id !== 'tgform') return;
  e.preventDefault();
  const g = S.set.tg, tok = $('#s-tgtok').value.trim(), v = $('#s-tgpass').value.trim();
  if (tok !== g.token) { g.token = tok; g.chat = ''; }
  if (v !== g.pass) { g.pass = v; g.lastSig = ''; }
  await saveSet();
  document.activeElement?.blur();
  setTimeout(() => { renderSettings(); toast(tok && v ? 'Đã lưu. Nếu iPhone hỏi lưu mật khẩu, chọn Lưu' : 'Điền cả mã bot và mật khẩu'); }, 300);
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.f) { fieldChange(t, true); return; }
  if (t.dataset.r) { rField(t, true); return; }
  if (t.dataset.ld !== undefined) { if (t.value && t.value <= ymd(new Date())) { S.ld = t.value; renderLog(); } return; }
  if (t.dataset.set) {
    const k = t.dataset.set, num = ['budget', 'dailyBudget', 'open.bank', 'open.cash', 'usdVnd'].includes(k);
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (num) { v = amountFromText(v) || 0; t.value = fmtNum(v); }
    if (k.startsWith('price.')) S.set.price[k.slice(6)] = parseFloat(String(v).replace(',', '.')) || 0;
    else if (k.startsWith('sync.')) S.set.sync[k.slice(5)] = String(v).trim();
    else if (k.startsWith('open.')) S.set.open[k.slice(5)] = v;
    else if (k === 'schedCheckDays') { S.set.schedCheckDays = +v || 0; S.set.schedCheckAt = Date.now(); }
    else if (k.startsWith('tg.')) {
      const f = k.slice(3), nv = String(v).trim(), changed = S.set.tg[f] !== nv;
      S.set.tg[f] = nv;
      if (changed && f === 'token') S.set.tg.chat = '';
      if (changed && f === 'pass') S.set.tg.lastSig = '';
    }
    else S.set[k] = typeof v === 'string' ? v.trim() : v;
    await saveSet();
    if (k === 'theme') applyTheme();
    if (k === 'ai' || k === 'apiKey') processQueue();
    if (k.startsWith('sync.')) syncInbox(false);
    renderAllExceptSettings(); return;
  }
  if (t.dataset.cat) {
    const c = S.set.categories[+t.dataset.i]; if (!c) return;
    if (t.dataset.cat === 'color') c.color = t.value;
    else if (t.dataset.cat === 'budget') { c.budget = amountFromText(t.value) || 0; t.value = fmtNum(c.budget); }
    else {
      const nn = t.value.trim(), old = c.name;
      if (!nn || S.set.categories.some(x => x !== c && x.name === nn)) { t.value = old; toast('Tên không được trống hoặc trùng'); return; }
      c.name = nn;
      const moved = S.tx.filter(x => x.category === old).map(x => ({ ...x, category: nn }));
      if (moved.length) await DB.putMany('tx', moved);
      Object.keys(S.set.learned).forEach(k => { if (S.set.learned[k] === old) S.set.learned[k] = nn; });
      await load();
    }
    await saveSet(); renderAllExceptSettings();
  }
});

/* ---------- khởi động ---------- */
async function init() {
  Object.assign(el, {
    home: $('#v-home'), log: $('#v-log'), stats: $('#v-stats'), wallet: $('#v-wallet'), settings: $('#v-settings'),
    sheet: $('#sheet'), scrim: $('#scrim'), toast: $('#toast'), pill: $('#pill'), file: $('#file'),
  });
  try { await load(); } catch { document.body.textContent = 'Không mở được bộ nhớ của trình duyệt.'; return; }
  for (const q of S.queue.filter(x => x.status === 'processing' && Date.now() - x.createdAt > 20000)) { q.status = 'wait'; await DB.put('queue', q); }
  applyTheme();
  const nRec = await runRecurring();
  el.file.addEventListener('change', () => onImportFile(el.file.files[0]));
  ['home', 'log', 'stats', 'wallet', 'settings'].forEach(k => el[k].addEventListener('scroll', updatePill, { passive: true }));
  if (window.visualViewport) {
    const vv = window.visualViewport, app = $('#app');
    const vars = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop), open = window.innerHeight - vv.height > 120;
      if (open && S.kbHold > Date.now()) return false;
      if (!open && S.kbPre > Date.now()) return true; // vừa đặt sẵn khung cho bàn phím sắp lên: chưa bỏ khi iOS chưa kịp báo
      if (open && vv.offsetTop < 1) { const h = Math.round(window.innerHeight - vv.height); if (h !== S.kbH) { S.kbH = h; try { localStorage.setItem('kbH', h); } catch {} } }
      app.style.setProperty('--kb', kb + 'px'); app.style.setProperty('--vvh', Math.round(vv.height) + 'px'); app.style.setProperty('--vvt', Math.round(vv.offsetTop) + 'px');
      app.classList.toggle('kbopen', open);
      return open;
    };
    // đổi cỡ (bàn phím mở/đóng): cập nhật khung; danh sách tự giữ tin ở đáy nhờ ResizeObserver trong openEntry
    vv.addEventListener('resize', vars);
    // iOS đôi khi không báo đổi cỡ khi bàn phím mở lại: đo lại vài nhịp mỗi khi ô nhập được chọn hoặc bỏ chọn.
    // Chọn ô nhập là người dùng muốn gõ nên bỏ luôn khoảng chờ của lần cất bàn phím trước
    const remeasure = () => [60, 250, 500, 900, 1200].forEach(ms => setTimeout(vars, ms));
    // chọn ô nhập: đặt khung chat ngay vào chỗ phía trên bàn phím (theo chiều cao bàn phím đã đo lần trước) thay vì đợi bàn phím lên xong mới nhảy.
    // Ô nhập đã nằm trên vùng bàn phím nên iOS cũng không phải tự đẩy cả trang lên
    S.kbH = (() => { try { return +localStorage.getItem('kbH') || 0; } catch { return 0; } })() || Math.round(window.innerHeight * 0.435);
    const kbPre = S.kbPrep = () => {
      if (!S.chat || app.classList.contains('kbopen')) return;
      S.kbPre = Date.now() + 800;
      // kbanim: khung trượt lên cùng nhịp bàn phím (bàn phím iOS lên mất khoảng 0,35 giây), xong thì bỏ để các lần đo sau bám tức thì
      app.classList.add('kbanim'); clearTimeout(S.kbAnimT); S.kbAnimT = setTimeout(() => app.classList.remove('kbanim'), 650);
      app.style.setProperty('--kb', S.kbH + 'px'); app.style.setProperty('--vvh', (window.innerHeight - S.kbH) + 'px'); app.style.setProperty('--vvt', '0px');
      app.classList.add('kbopen');
    };
    // khung chỉ dịch lên khi iOS báo vùng nhìn đổi (đúng lúc bàn phím bắt đầu chạy), không đặt sẵn trước
    document.addEventListener('focusin', e => { if (e.target.id === 'q') { S.kbHold = 0; remeasure(); } });
    // bỏ chọn ô nhập (chạm ra ngoài, dấu ✓, gửi): cho khung trượt xuống ngay cùng lúc bàn phím bắt đầu cất, không đợi iOS báo xong
    document.addEventListener('focusout', e => {
      if (e.target.id !== 'q') return;
      if (app.classList.contains('kbopen')) { S.kbHold = Date.now() + 700; S.kbPre = 0; app.classList.remove('kbopen', 'kbanim'); }
      remeasure();
    });
    // dịch chuyển: chỉ cập nhật vị trí. Không kéo trang về 0 khi iOS tự đẩy trang lên lúc chọn ô nhập:
    // kéo về làm iOS nhớ sai vị trí, tới lúc cất bàn phím cả màn hình giật xuống một cái. Khung chat đã tự bám theo --kb nên không cần
    // dự phòng: nếu iOS vẫn đẩy trang thì kéo về 0, vì khi trang bị đẩy, vị trí khung tính theo số iOS báo không khớp màn hình (khung lệch, ô nhập bị che)
    vv.addEventListener('scroll', () => { vars(); if (S.chat && vv.offsetTop > 0.5) { dbgEv('fix', 'app kéo trang về 0 (lệch ' + Math.round(vv.offsetTop) + ')'); window.scrollTo(0, 0); } });
  }
  // ?demo=1 tạo dữ liệu mẫu nếu máy còn trống; ?tab=stats|wallet|settings mở thẳng tab đó
  const qs = new URLSearchParams(location.search);
  if (qs.get('demo') === 'reset') await makeSample(true); else if (qs.has('demo') && !S.tx.length) await makeSample();
  renderAll();
  if (TITLES[qs.get('tab')]) setTab(qs.get('tab'));
  if (nRec) toast(`Đã ghi ${nRec} khoản định kỳ đến hạn`);
  navigator.storage?.persist?.().catch(() => {});
  window.addEventListener('online', () => { processQueue(); syncInbox(false); setTimeout(tgBackup, 3000); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { processQueue(); syncInbox(false); runRecurring().then(n => { renderAll(); if (n) toast(`Đã ghi ${n} khoản định kỳ đến hạn`); }); setTimeout(tgBackup, 3000); } else tgBackup(); });
  processQueue(); syncInbox(false);
  // Sao lưu Telegram: lúc mở app, lúc rời app, và mỗi 10 phút khi đang dùng; chỉ gửi khi sổ đã đổi.
  setTimeout(tgBackup, 3000); setInterval(() => { if (!document.hidden) tgBackup(); }, 10 * 60 * 1000);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // Cập nhật: mỗi lần mở app hỏi máy chủ có bản mới không (sw.js đổi VERSION). Bản mới tới ngay lúc
    // vừa mở và không đang làm dở gì thì tải lại luôn; đang nhập dở thì hiện nút "Tải lại" như cũ.
    const had = !!navigator.serviceWorker.controller;
    let shownAt = Date.now();
    const idle = () => !el.sheet.classList.contains('on') && !document.activeElement?.matches?.('input,textarea,select,[contenteditable]');
    navigator.serviceWorker.register('sw.js').then(reg => {
      S.reg = reg;
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { shownAt = Date.now(); check(); } });
      setInterval(check, 30 * 60 * 1000);
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!had) return;
      if (Date.now() - shownAt < 8000 && idle()) { location.reload(); return; }
      el.toast.innerHTML = '<span>Có bản mới</span><button data-act="reload">Tải lại</button>';
      el.toast.classList.add('on'); clearTimeout(toastT);
    });
  }
}
init();

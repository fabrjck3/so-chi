// Hiểu câu tiếng Việt đơn giản ngay trên máy, không gọi API.
// Câu phức tạp (nhiều khoản, rút/chuyển, số mơ hồ) trả về certain=false để app gọi API.

// Bỏ dấu nhưng giữ nguyên độ dài chuỗi, để vị trí khớp với chuỗi gốc.
export function norm(s) {
  return s.normalize('NFC').split('').map(c => (c === 'đ' || c === 'Đ') ? 'd' : c.normalize('NFD')[0]).join('').toLowerCase();
}

const KW = {
  'Ăn uống': ['pho', 'com', 'bun', 'banh mi', 'mi', 'an', 'trua', 'toi', 'sang', 'lau', 'nuong', 'xoi', 'chao', 'hu tieu', 'pizza', 'nhau', 'bia', 'banh', 'tra com', 'an vat', 'bun bo', 'bun cha', 'mi quang'],
  'Cà phê': ['ca phe', 'cafe', 'cf', 'tra sua', 'tra', 'sinh to', 'matcha', 'highlands', 'nuoc ep', 'nuoc ngot', 'tra dao'],
  'Đi lại': ['grab', 'xe', 'xang', 'taxi', 'be', 'gui xe', 've', 'bus', 'xe buyt', 'do xang', 'gojek', 'xanh sm'],
  'Hoá đơn': ['tien dien', 'tien nuoc', 'internet', 'wifi', 'dien thoai', 'tien nha', 'thue nha', 'hoa don', 'netflix', 'spotify', 'tien dien thoai', 'cuoc', 'icloud'],
  'Mua sắm': ['mua', 'ao', 'quan', 'giay', 'shopee', 'lazada', 'tiki', 'sieu thi', 'sach', 'do', 'tui', 'my pham'],
};

const WD = { 'hai': 1, 'ba': 2, 'tu': 3, 'nam': 4, 'sau': 5, 'bay': 6 };

function pad(n) { return String(n).padStart(2, '0'); }
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const blank = (s, a, b) => s.slice(0, a) + ' '.repeat(b - a) + s.slice(b);

// Đọc số tiền từ một đoạn chữ ("45k", "1tr2", "2 triệu rưỡi", "45.000"). Trả về số nguyên hoặc null.
export function amountFromText(text) {
  const n = norm(text);
  const found = findAmounts(n);
  if (found.length) return found[0].amount;
  const digits = n.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

function findAmounts(n) {
  const out = [];
  let w = n;
  const re1 = /(\d+(?:[.,]\d+)?)\s*(trieu|tr|cu|k|nghin|ngan)(?![a-z])(?:\s*(ruoi)|(\d+))?/g;
  let m;
  while ((m = re1.exec(n))) {
    const unit = /^(trieu|tr|cu)$/.test(m[2]) ? 1e6 : 1e3;
    let base = parseFloat(m[1].replace(',', '.')) * unit;
    if (m[3]) base += unit / 2;
    if (m[4]) base += (parseInt(m[4], 10) / 10 ** m[4].length) * unit;
    out.push({ amount: Math.round(base), start: m.index, end: m.index + m[0].length, low: false });
    w = blank(w, m.index, m.index + m[0].length);
  }
  const re2 = /\d{1,3}(?:[.,]\d{3})+(?!\d)\s*(?:vnd|d)?(?![a-z])/g;
  while ((m = re2.exec(w))) {
    out.push({ amount: parseInt(m[0].replace(/[^\d]/g, ''), 10), start: m.index, end: m.index + m[0].length, low: false });
    w = blank(w, m.index, m.index + m[0].length);
  }
  const re3 = /\d{4,}\s*(?:vnd|d)?(?![a-z\d])/g;
  while ((m = re3.exec(w))) {
    out.push({ amount: parseInt(m[0].replace(/[^\d]/g, ''), 10), start: m.index, end: m.index + m[0].length, low: false });
    w = blank(w, m.index, m.index + m[0].length);
  }
  if (!out.length) {
    const re4 = /(?<![\d/])\d{1,3}(?![\d/])/g;
    const all = [...w.matchAll(re4)];
    if (all.length === 1) {
      const x = all[0];
      out.push({ amount: parseInt(x[0], 10) * 1000, start: x.index, end: x.index + x[0].length, low: true });
    } else if (all.length > 1) {
      all.forEach(x => out.push({ amount: parseInt(x[0], 10) * 1000, start: x.index, end: x.index + x[0].length, low: true }));
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function findDate(n, today) {
  const spans = [];
  let date = null;
  let m;
  const take = (re, fn) => {
    if (date) return;
    m = re.exec(n);
    if (m) { date = fn(m); spans.push([m.index, m.index + m[0].length]); }
  };
  const shift = k => { const d = new Date(today); d.setDate(d.getDate() - k); return d; };
  take(/\bhom nay\b/, () => shift(0));
  take(/\bhom qua\b/, () => shift(1));
  take(/\bhom kia\b/, () => shift(2));
  take(/\b(?:thu\s*([2-7])|thu\s*(hai|ba|tu|nam|sau|bay)|chu nhat|cn)\b/, mm => {
    const target = mm[1] ? parseInt(mm[1], 10) - 1 : mm[2] ? WD[mm[2]] : 0;
    const back = (today.getDay() - target + 7) % 7;
    return shift(back);
  });
  take(/\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?(?!\d)/, mm => {
    const d = parseInt(mm[1], 10), mo = parseInt(mm[2], 10) - 1;
    let y = mm[3] ? parseInt(mm[3], 10) : today.getFullYear();
    if (y < 100) y += 2000;
    let r = new Date(y, mo, d);
    if (!mm[3] && r > today) r = new Date(y - 1, mo, d);
    return r;
  });
  take(/\bngay\s*(\d{1,2})\b/, mm => {
    const d = parseInt(mm[1], 10);
    let r = new Date(today.getFullYear(), today.getMonth(), d);
    if (r > today) r = new Date(today.getFullYear(), today.getMonth() - 1, d);
    return r;
  });
  return { date: date || today, spans, found: !!date };
}

export function parseLocal(text, ctx) {
  const raw = text.normalize('NFC').trim();
  if (!raw) return null;
  const n = norm(raw);
  if (/\b(mai|tuan truoc|thang truoc|tuan nay|thang nay|tuan sau|va|voi|roi|sau do)\b/.test(n)) return { items: [], certain: false };
  if (/\b(chuyen(?! khoan)|rut|nap|luong|hoan|tra no|thu nhap|thuong|nhan|vay|cho vay|dieu chinh)\b/.test(n)) return { items: [], certain: false };

  const dt = findDate(n, ctx.today);
  let w = n;
  dt.spans.forEach(([a, b]) => { w = blank(w, a, b); });
  const amounts = findAmounts(w);
  if (!amounts.length) return { items: [], certain: false };
  if (amounts.length > 1) return { items: [], certain: false };
  const am = amounts[0];

  const spans = [...dt.spans, [am.start, am.end]];

  // ví
  let wallet = ctx.defWallet || 'cash';
  const wm = /\b(the|ck|chuyen khoan|momo|zalopay|ngan hang|bank|quet|visa|tai khoan|tk)\b/.exec(w);
  const cm = /\b(tien mat|tm)\b/.exec(w);
  if (wm) { wallet = 'bank'; spans.push([wm.index, wm.index + wm[0].length]); }
  else if (cm) { wallet = 'cash'; spans.push([cm.index, cm.index + cm[0].length]); }
  // bỏ chữ "bằng", "qua", "dung" đứng trước từ ví
  const filler = /\b(bang|qua|dung|tra)\b/g;
  let fm;
  while ((fm = filler.exec(w))) { if (wm || cm) spans.push([fm.index, fm.index + fm[0].length]); }

  // danh mục: học được trước, rồi bảng từ khoá
  const { cat, known } = guessCategory(w, ctx);

  // ghi chú = phần chữ còn lại
  let note = raw;
  spans.sort((a, b) => b[0] - a[0]).forEach(([a, b]) => { note = note.slice(0, a) + ' ' + note.slice(b); });
  note = note.replace(/[,.;:+]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!note) note = cat;
  note = note.charAt(0).toUpperCase() + note.slice(1);

  let rest = n;
  spans.forEach(([a, b]) => { rest = blank(rest, a, b); });
  const leftover = /\d/.test(rest);
  const certain = known && !am.low && !leftover;
  return {
    certain,
    items: [{
      type: 'chi', date: ymd(dt.date), amount: am.amount, category: cat, wallet, toWallet: null, note,
      confidence: certain ? 0.95 : 0.6,
      ambiguity: am.low ? 'Số không có đơn vị, tạm hiểu là nghìn đồng' : leftover ? 'Có số khác trong câu, kiểm tra lại số tiền' : (!known ? 'Chưa rõ danh mục' : null),
    }],
  };
}

// Đoán danh mục từ một đoạn chữ đã bỏ dấu: nơi chi đã học trước, rồi bảng từ khoá.
export function guessCategory(normText, ctx) {
  const names = ctx.categories.map(c => c.name);
  const padded = ' ' + normText.replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  let cat = null;
  for (const [k, v] of Object.entries(ctx.learned || {})) {
    if (k && padded.includes(' ' + k + ' ') && names.includes(v)) { cat = v; break; }
  }
  let known = !!cat;
  if (!cat) {
    outer: for (const [name, list] of Object.entries(KW)) {
      if (!names.includes(name)) continue;
      for (const kw of list) {
        if (padded.includes(' ' + kw + ' ')) { cat = name; known = true; break outer; }
      }
    }
  }
  if (!cat) cat = names.includes('Khác') ? 'Khác' : names[names.length - 1];
  return { cat, known };
}

// Đọc tin nhắn biến động số dư của ngân hàng, hoàn toàn trên máy, không gọi API. Hai kiểu tin:
//  - Một dòng, cách nhau bằng "|" (VietinBank thật):
//    "VietinBank:26/10/2026 20:22|TK:...|GD:-50,000 VND|SDC:1,458,839 VND|VA:...|ND:..."
//  - Nhiều dòng: "Thời gian: 15/01/2000 / Tài khoản: ... / Giao dịch: -22,000 VND / Số dư hiện tại: ... / Nội dung: ..."
// Chỉ lấy ngày, số tiền, chiều thu/chi và nội dung. Số tài khoản và số dư bị bỏ, không lưu.
function smsRecords(text) {
  const t = text.normalize('NFC'), out = [];
  const line = /(?:^|\n)[^\n|]{0,30}?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})[^\n|]*\|([^\n]*)/g;
  for (let m; (m = line.exec(t));) {
    const gd = /(?:^|\|)\s*GD\s*:\s*([+-]?)\s*([\d.,]+)/i.exec(m[4]);
    if (!gd) continue;
    out.push({ sign: gd[1], amt: gd[2], d: m[1], mo: m[2], y: m[3], note: /(?:^|\|)\s*ND\s*:\s*(.*)$/i.exec(m[4])?.[1] || '', all: norm(m[0]) });
  }
  if (out.length) return out;
  for (const b of t.split(/(?=^\s*th[oơờ]i gian\s*:)/im).filter(b => /giao d[iị]ch\s*:/i.test(norm(b)))) {
    const n = norm(b);
    const am = /giao dich\s*:\s*([+-]?)\s*([\d.,]+)/.exec(n);
    if (!am) continue;
    const dm = /thoi gian\s*:\s*[^\d]*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(n);
    // nội dung: lấy từ chữ gốc để giữ dấu, cắt đến hết dòng
    out.push({ sign: am[1], amt: am[2], d: dm?.[1], mo: dm?.[2], y: dm?.[3], note: /^\s*n[oộ]i dung\s*:\s*(.*)$/im.exec(b)?.[1] || '', all: n });
  }
  return out;
}
export function parseBankSMS(text, ctx) {
  const items = [];
  for (const r of smsRecords(text)) {
    const amount = parseInt(r.amt.replace(/[^\d]/g, ''), 10);
    if (!(amount > 0)) continue;
    const isIn = r.sign === '+' || (!r.sign && /\b(cong|nhan|\+)\b/.test(r.all));
    let date = ymd(ctx.today);
    if (r.d) {
      let y = parseInt(r.y, 10); if (y < 100) y += 2000;
      const d = new Date(y, parseInt(r.mo, 10) - 1, parseInt(r.d, 10));
      if (!isNaN(d) && d <= new Date(ctx.today.getFullYear(), ctx.today.getMonth(), ctx.today.getDate() + 1)) date = ymd(d);
    }
    let note = r.note.trim();
    note = note.replace(/\d{6,}/g, '').replace(/\s+/g, ' ').trim();
    if (/^x+$/i.test(note)) note = '';
    const g = isIn ? { cat: ctx.categories.some(c => c.name === 'Khác') ? 'Khác' : ctx.categories[0].name, known: true } : guessCategory(norm(note), ctx);
    items.push({
      type: isIn ? 'thu' : 'chi', date, amount, category: g.cat, wallet: 'bank', toWallet: null,
      note: note ? note.charAt(0).toUpperCase() + note.slice(1, 60) : (isIn ? 'Tiền vào' : 'Chi từ ngân hàng'),
      confidence: g.known ? 0.9 : 0.65,
      ambiguity: g.known ? null : 'Chưa rõ nơi chi, hãy chọn danh mục',
      fromSms: true,
    });
  }
  return { items };
}

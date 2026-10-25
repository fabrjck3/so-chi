// Gọi thẳng Anthropic API từ trình duyệt. Key do người dùng dán ở Cài đặt, chỉ lưu trên máy.
const URL = 'https://api.anthropic.com/v1/messages';
const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

export class AIError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; } // kind: 'network' | 'auth' | 'http' | 'format'
}

function pad(n) { return String(n).padStart(2, '0'); }
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function systemPrompt(today, categories) {
  return `Bạn là bộ đọc khoản chi tiêu cho app "Sổ Chi" của một người Việt. Chỉ trả về JSON hợp lệ, không thêm chữ nào khác.
Hôm nay là ${WEEKDAYS[today.getDay()]}, ${ymd(today)} (múi giờ Việt Nam).
Danh mục hợp lệ: ${categories.join(', ')}.
Ví hợp lệ: "bank" (tiền ngân hàng, thẻ, chuyển khoản, momo) và "cash" (tiền mặt). Không nói rõ thì dùng "cash".
Quy tắc số tiền VND: "k" = nghìn, "tr" hoặc "triệu" hoặc "củ" = triệu, "rưỡi" = cộng nửa đơn vị ("2 triệu rưỡi" = 2500000, "1tr2" = 1200000, "45k" = 45000). Số trần nhỏ hơn 1000 trong ngữ cảnh chi tiêu là nghìn đồng.
Quy tắc ngày: tính từ hôm nay, "hôm qua", "hôm kia", "thứ 6" (ngày gần nhất đã qua), "ngày 12". Không nói thì dùng hôm nay.
Loại khoản: "chi" (chi tiêu), "thu" (lương, nhận tiền), "chuyen" (chuyển giữa hai ví, ví dụ rút ATM là bank sang cash; khi đó điền wallet là ví nguồn và to_wallet là ví đích).
Một câu có thể có nhiều khoản, tách riêng từng khoản. Khoản chuyển ví không cần danh mục (dùng "Khác").
Nếu không chắc điều gì thì để confidence thấp (dưới 0.7) và ghi lý do ngắn vào ambiguity.
Định dạng đúng:
{"items":[{"type":"chi|thu|chuyen","date":"YYYY-MM-DD","amount_vnd":45000,"category":"...","wallet":"bank|cash","to_wallet":null,"note":"ngắn gọn","confidence":0.9,"ambiguity":null}]}`;
}

function extractJSON(text) {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw new AIError('Phản hồi không có JSON', 'format');
  try { return JSON.parse(text.slice(a, b + 1)); }
  catch { throw new AIError('Phản hồi không đọc được', 'format'); }
}

function clean(data, categories, today) {
  if (!data || !Array.isArray(data.items)) throw new AIError('Phản hồi thiếu danh sách khoản', 'format');
  const fallback = categories.includes('Khác') ? 'Khác' : categories[categories.length - 1];
  const items = data.items.map(x => {
    const amount = Math.round(Number(x.amount_vnd));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const type = ['chi', 'thu', 'chuyen'].includes(x.type) ? x.type : 'chi';
    const wallet = x.wallet === 'bank' ? 'bank' : 'cash';
    let toWallet = null;
    if (type === 'chuyen') toWallet = wallet === 'bank' ? 'cash' : 'bank';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : ymd(today);
    const conf = Math.min(1, Math.max(0, Number(x.confidence) || 0.8));
    return {
      type, date, amount, wallet, toWallet,
      category: categories.includes(x.category) ? x.category : fallback,
      note: String(x.note || '').slice(0, 80),
      confidence: conf,
      ambiguity: x.ambiguity ? String(x.ambiguity).slice(0, 120) : (categories.includes(x.category) ? null : 'Chưa rõ danh mục'),
    };
  }).filter(Boolean);
  if (!items.length) throw new AIError('Không tìm thấy khoản nào trong câu này', 'format');
  return items;
}

export async function callAPI({ apiKey, model, system, user, maxTokens = 700 }) {
  let res;
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
  } catch {
    throw new AIError('Không kết nối được', 'network');
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch { /* bỏ qua */ }
    if (res.status === 401 || res.status === 403) throw new AIError('API key không đúng hoặc bị từ chối', 'auth');
    if (res.status === 429 || res.status >= 500) throw new AIError('Dịch vụ đang bận, thử lại sau', 'network');
    throw new AIError(detail || `Lỗi ${res.status}`, 'http');
  }
  const json = await res.json();
  return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

export async function parseWithAI(text, { apiKey, model, categories, today }) {
  const out = await callAPI({ apiKey, model, system: systemPrompt(today, categories), user: text });
  return clean(extractJSON(out), categories, today);
}

export async function testKey({ apiKey, model }) {
  await callAPI({ apiKey, model, system: 'Trả lời đúng một từ: ok', user: 'ping', maxTokens: 8 });
}

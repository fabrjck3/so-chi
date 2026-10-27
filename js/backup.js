// Sao lưu tự động qua bot Telegram của riêng bạn: bot gửi file sao lưu vào cuộc trò chuyện với bạn.
// Gửi bằng FormData (yêu cầu "đơn giản", không cần preflight) vì api.telegram.org trả 501 cho OPTIONS.
// File được khoá bằng mật khẩu sao lưu ngay trên máy (PBKDF2 + AES-GCM) trước khi gửi.
const API = 'https://api.telegram.org/bot';
const ITER = 250000;
const enc = new TextEncoder();
const b64 = buf => {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function keyFrom(pass, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function lock(text, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(pass, salt), enc.encode(text));
  return JSON.stringify({ app: 'so-chi', enc: 1, iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(data) });
}

export async function unlock(obj, pass) {
  try {
    const key = await keyFrom(pass, unb64(obj.salt));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, key, unb64(obj.data)));
  } catch { throw new Error('Sai mật khẩu sao lưu'); }
}

// Dấu vân tay ngắn của dữ liệu, để chỉ gửi khi sổ thật sự thay đổi.
export function sig(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + '.' + text.length;
}

async function call(token, method, form) {
  let res;
  try { res = await fetch(API + token.trim() + '/' + method, form ? { method: 'POST', body: form } : {}); }
  catch { throw new Error('Không kết nối được tới Telegram'); }
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 404) throw new Error('Mã bot không đúng');
  if (!j.ok) throw new Error(j.description === 'Bad Request: chat not found' ? 'Chưa tìm thấy cuộc trò chuyện, hãy bấm Start trong bot' : 'Telegram báo lỗi: ' + (j.description || res.status));
  return j.result;
}

// Tìm cuộc trò chuyện của bạn với bot từ tin nhắn gần nhất (sau khi bạn bấm Start).
export async function findChat(token) {
  const ups = await call(token, 'getUpdates');
  const m = [...ups].reverse().map(u => u.message || u.my_chat_member).find(x => x?.chat?.type === 'private');
  if (!m) throw new Error('Chưa thấy tin nào. Mở bot, bấm Start rồi thử lại');
  return String(m.chat.id);
}

export async function sendText(token, chat, text) {
  const f = new FormData(); f.append('chat_id', chat); f.append('text', text);
  await call(token, 'sendMessage', f);
}

// Gửi file thành tin mới, trả về mã tin để sau này thay file trong chính tin đó.
export async function sendFile(token, chat, text, name, caption) {
  const f = new FormData(); f.append('chat_id', chat); f.append('caption', caption);
  f.append('document', new Blob([text], { type: 'application/json' }), name);
  return (await call(token, 'sendDocument', f)).message_id;
}

// Thay file trong một tin bot đã gửi. Bot chỉ xoá được tin trong 48 giờ nhưng sửa được mãi,
// nên giữ số bản cố định bằng cách thay vòng tròn thay vì gửi mới rồi xoá.
export async function replaceFile(token, chat, msgId, text, name, caption) {
  const f = new FormData(); f.append('chat_id', chat); f.append('message_id', msgId);
  f.append('media', JSON.stringify({ type: 'document', media: 'attach://file', caption }));
  f.append('file', new Blob([text], { type: 'application/json' }), name);
  await call(token, 'editMessageMedia', f);
}

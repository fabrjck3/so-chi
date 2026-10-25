// Đồng bộ tin ngân hàng từ Worker (hòm thư của riêng bạn). Chỉ có ngày, số biến động, số dư.
const base = u => u.trim().replace(/\/+$/, '');

async function call(sy, path, init = {}) {
  let res;
  try {
    res = await fetch(base(sy.url) + path, { ...init, headers: { authorization: 'Bearer ' + sy.token.trim(), ...(init.headers || {}) } });
  } catch { throw new Error('Không kết nối được tới Worker'); }
  if (res.status === 401) throw new Error('Mã đồng bộ không đúng');
  if (!res.ok) throw new Error('Worker báo lỗi ' + res.status);
  return res.json();
}

export async function fetchInbox(sy) {
  const j = await call(sy, '/sync');
  return Array.isArray(j.items) ? j.items : [];
}

export async function ackInbox(sy, ids) {
  if (!ids.length) return;
  await call(sy, '/ack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
}

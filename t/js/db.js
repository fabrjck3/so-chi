// Lưu dữ liệu trên máy bằng IndexedDB. Ba kho: tx (giao dịch), meta (cài đặt), queue (câu chờ xử lý).
const NAME = 'so-chi';
const VERSION = 1;
let dbp;

function open() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('tx', { keyPath: 'id' }).createIndex('date', 'date');
      db.createObjectStore('meta');
      db.createObjectStore('queue', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function run(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => resolve(rq && rq.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const getAll = s => run(s, 'readonly', o => o.getAll());
export const get = (s, k) => run(s, 'readonly', o => o.get(k));
export const put = (s, v, k) => run(s, 'readwrite', o => o.put(v, k));
export const del = (s, k) => run(s, 'readwrite', o => o.delete(k));
export const clear = s => run(s, 'readwrite', o => o.clear());

export function putMany(store, arr) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const o = t.objectStore(store);
    arr.forEach(v => o.put(v));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export function delMany(store, keys) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const o = t.objectStore(store);
    keys.forEach(k => o.delete(k));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

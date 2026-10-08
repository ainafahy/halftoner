// Snapshot source images, kept in IndexedDB (too large for localStorage).
// Keyed by source id; a missing or blocked database just means snapshots
// restore settings without their image.

const DB = 'halftoner';
const STORE = 'sources';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => { dbp = null; throw e; });
  }
  return dbp;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const putSource = (id, record) => run('readwrite', (s) => s.put(record, id));
export const getSource = (id) => run('readonly', (s) => s.get(id));
export const hasSource = async (id) => (await run('readonly', (s) => s.count(id))) > 0;
export const deleteSource = (id) => run('readwrite', (s) => s.delete(id));

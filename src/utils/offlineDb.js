const IDB_NAME = 'vestas_pharma_idb';
const IDB_VERSION = 2;
const SIMULATED_OFFLINE_KEY = 'vestas_simulate_offline_mode';

let dbPromise = null;

export function openOfflineDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv_store')) {
        db.createObjectStore('kv_store', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('customers')) {
        db.createObjectStore('customers', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('invoices')) {
        db.createObjectStore('invoices', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('stock_movements')) {
        db.createObjectStore('stock_movements', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sync_queue')) {
        db.createObjectStore('sync_queue', { keyPath: 'operation_id' });
      }
      if (!db.objectStoreNames.contains('sync_history')) {
        db.createObjectStore('sync_history', { keyPath: 'operation_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function idbGetAll(storeName) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(storeName, item) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(item);
    req.onsuccess = () => resolve(item);
    req.onerror = () => reject(req.error);
  });
}

export async function idbDelete(storeName, key) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbReplaceAll(storeName, items = []) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGetKv(key, fallback = null) {
  const db = await openOfflineDb();
  return new Promise((resolve) => {
    const tx = db.transaction('kv_store', 'readonly');
    const req = tx.objectStore('kv_store').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
    req.onerror = () => resolve(fallback);
  });
}

export async function idbSetKv(key, value) {
  return idbPut('kv_store', { key, value, updated_at: new Date().toISOString() });
}

export function isSimulatedOffline() {
  return localStorage.getItem(SIMULATED_OFFLINE_KEY) === 'true';
}

export function setSimulatedOffline(val) {
  localStorage.setItem(SIMULATED_OFFLINE_KEY, val ? 'true' : 'false');
  window.dispatchEvent(new CustomEvent('vestas-connectivity-change'));
}

export function isBrowserOffline() {
  return !navigator.onLine || isSimulatedOffline();
}

/**
 * Enqueues an offline transaction into IndexedDB sync_queue
 */
export async function enqueueOfflineOperation({ type, description, payload, operation_id }) {
  const opId = operation_id || `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    operation_id: opId,
    type,
    description,
    payload,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  await idbPut('sync_queue', entry);
  await saveAutomaticLocalBackup();
  window.dispatchEvent(new CustomEvent('vestas-sync-queue-updated'));
  return entry;
}

export async function getPendingSyncQueue() {
  const list = await idbGetAll('sync_queue');
  return list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export async function getSyncHistory() {
  const list = await idbGetAll('sync_history');
  return list.sort((a, b) => new Date(b.synced_at) - new Date(a.synced_at));
}

let autoBackupTimer = null;

/**
 * Automatic Local Backup in IndexedDB (debounced so it never blocks active UI operations)
 */
export function saveAutomaticLocalBackup() {
  if (autoBackupTimer) {
    clearTimeout(autoBackupTimer);
  }
  autoBackupTimer = setTimeout(async () => {
    try {
      const [settings, products, customers, invoices, stock_movements] = await Promise.all([
        idbGetKv('settings', {}),
        idbGetAll('products'),
        idbGetAll('customers'),
        idbGetAll('invoices'),
        idbGetAll('stock_movements'),
      ]);
      await idbSetKv('auto_backup_snapshot', {
        savedAt: new Date().toISOString(),
        settings,
        products,
        customers,
        invoices,
        stock_movements,
      });
    } catch {
      // ignore
    }
  }, 4000);
}

/**
 * Computes full Dashboard statistics locally from IndexedDB when working offline
 */
export async function computeLocalDashboard() {
  const [products, invoicesRaw, customers] = await Promise.all([
    idbGetAll('products'),
    idbGetAll('invoices'),
    idbGetAll('customers'),
  ]);

  const invoices = [...invoicesRaw].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const todayInvoices = invoices.filter((inv) => new Date(inv.created_at) >= new Date(todayStart));
  const salesToday = todayInvoices.reduce((sum, inv) => sum + Number(inv.grand_total || 0), 0);
  const profitToday = todayInvoices.reduce((sum, inv) => sum + Number(inv.estimated_profit || 0), 0);
  const billsToday = todayInvoices.length;

  const totalBills = invoices.length;
  const totalRevenue = invoices.reduce((sum, inv) => sum + Number(inv.grand_total || 0), 0);
  const totalProfit = invoices.reduce((sum, inv) => sum + Number(inv.estimated_profit || 0), 0);

  const lowStockProducts = products.filter(
    (p) => Number(p.stock) > 0 && Number(p.stock) <= Number(p.min_stock_level || 20)
  );
  const outOfStockProducts = products.filter((p) => Number(p.stock) <= 0);

  const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const expiredProducts = [];
  const expiringSoonProducts = [];

  for (const p of products) {
    if (p.expiry_date) {
      const expDate = new Date(p.expiry_date.length === 7 ? `${p.expiry_date}-28` : p.expiry_date);
      if (!isNaN(expDate.getTime())) {
        if (expDate < now) {
          expiredProducts.push(p);
        } else if (expDate <= ninetyDaysFromNow) {
          expiringSoonProducts.push(p);
        }
      }
    }
  }

  const totalStockValue = products.reduce(
    (sum, p) => sum + Math.max(0, Number(p.stock)) * Number(p.purchase_price || 0),
    0
  );
  const totalRetailValue = products.reduce(
    (sum, p) => sum + Math.max(0, Number(p.stock)) * Number(p.selling_price || 0),
    0
  );
  const totalReceivables = customers.reduce((sum, c) => sum + Math.max(0, Number(c.balance || 0)), 0);

  const dailyOverview = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const nextD = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1);
    const dayInvoices = invoices.filter((inv) => {
      const t = new Date(inv.created_at);
      return t >= d && t < nextD;
    });
    dailyOverview.push({
      label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      date: d.toISOString().split('T')[0],
      sales: dayInvoices.reduce((s, inv) => s + Number(inv.grand_total || 0), 0),
      profit: dayInvoices.reduce((s, inv) => s + Number(inv.estimated_profit || 0), 0),
      bills: dayInvoices.length,
    });
  }

  const weeklyOverview = [];
  for (let i = 3; i >= 0; i--) {
    const endD = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7 + 1);
    const startD = new Date(endD.getTime() - 7 * 24 * 60 * 60 * 1000);
    const wkInvoices = invoices.filter((inv) => {
      const t = new Date(inv.created_at);
      return t >= startD && t < endD;
    });
    weeklyOverview.push({
      label: `${startD.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} - ${new Date(
        endD.getTime() - 86400000
      ).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`,
      sales: wkInvoices.reduce((s, inv) => s + Number(inv.grand_total || 0), 0),
      profit: wkInvoices.reduce((s, inv) => s + Number(inv.estimated_profit || 0), 0),
      bills: wkInvoices.length,
    });
  }

  const monthlyOverview = [];
  for (let i = 5; i >= 0; i--) {
    const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const mInvoices = invoices.filter((inv) => {
      const t = new Date(inv.created_at);
      return t >= mStart && t < mEnd;
    });
    monthlyOverview.push({
      label: mStart.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      sales: mInvoices.reduce((s, inv) => s + Number(inv.grand_total || 0), 0),
      profit: mInvoices.reduce((s, inv) => s + Number(inv.estimated_profit || 0), 0),
      bills: mInvoices.length,
    });
  }

  return {
    salesToday,
    profitToday,
    billsToday,
    totalBills,
    totalRevenue,
    totalProfit,
    totalProducts: products.length,
    lowStockCount: lowStockProducts.length,
    outOfStockCount: outOfStockProducts.length,
    expiredCount: expiredProducts.length,
    expiringSoonCount: expiringSoonProducts.length,
    totalStockValue,
    totalRetailValue,
    totalCustomers: customers.length,
    totalReceivables,
    lowStockProducts: lowStockProducts.slice(0, 12),
    outOfStockProducts: outOfStockProducts.slice(0, 12),
    expiringProducts: [...expiredProducts, ...expiringSoonProducts].slice(0, 12),
    recentInvoices: invoices.slice(0, 8),
    dailyOverview,
    weeklyOverview,
    monthlyOverview,
  };
}

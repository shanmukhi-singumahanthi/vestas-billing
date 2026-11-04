import {
  idbGetAll,
  idbPut,
  idbDelete,
  idbReplaceAll,
  idbGetKv,
  idbSetKv,
  isBrowserOffline,
  enqueueOfflineOperation,
  getPendingSyncQueue,
  computeLocalDashboard,
  saveAutomaticLocalBackup,
} from './offlineDb';

const TOKEN_KEY = 'vestas_auth_token';

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function apiRequest(endpoint, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const bodyObj = options.body ? JSON.parse(options.body) : null;

  // If currently in Offline Mode, route directly to IndexedDB Offline Engine
  if (isBrowserOffline() && endpoint !== '/api/sync') {
    return handleOfflineRequest(endpoint, method, bodyObj);
  }

  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(endpoint, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        setAuthToken(null);
      }
      throw new Error(data.error || `Request failed with status ${res.status}`);
    }

    // Mirror fresh server responses into IndexedDB for seamless offline readiness
    await mirrorServerResponseToIndexedDb(endpoint, method, data);

    return data;
  } catch (err) {
    // If it was a network/connection failure (TypeError: Failed to fetch), fall back to Offline Engine
    if (err instanceof TypeError || err.message?.includes('Failed to fetch')) {
      window.dispatchEvent(new CustomEvent('vestas-connectivity-change'));
      return handleOfflineRequest(endpoint, method, bodyObj);
    }
    throw err;
  }
}

async function mirrorServerResponseToIndexedDb(endpoint, method, data) {
  try {
    if (method === 'POST' && endpoint === '/api/auth/login' && data.user) {
      await idbSetKv('owner_profile', data.user);
    } else if (method === 'GET' && endpoint === '/api/auth/me' && data.id) {
      await idbSetKv('owner_profile', data);
    } else if (endpoint === '/api/settings' && data) {
      await idbSetKv('settings', data);
    } else if (method === 'GET' && endpoint === '/api/products' && Array.isArray(data)) {
      await idbReplaceAll('products', data);
      await saveAutomaticLocalBackup();
    } else if (method === 'GET' && endpoint === '/api/customers' && Array.isArray(data)) {
      await idbReplaceAll('customers', data);
    } else if (method === 'GET' && endpoint === '/api/invoices' && Array.isArray(data)) {
      await idbReplaceAll('invoices', data);
      await saveAutomaticLocalBackup();
    } else if (method === 'GET' && endpoint.startsWith('/api/inventory/movements') && Array.isArray(data)) {
      await idbReplaceAll('stock_movements', data);
    } else if (method === 'POST' && endpoint === '/api/invoices' && data.id) {
      await idbPut('invoices', data);
      await saveAutomaticLocalBackup();
    } else if ((method === 'POST' || method === 'PUT') && endpoint.startsWith('/api/products') && data.id) {
      await idbPut('products', data);
      await saveAutomaticLocalBackup();
    }
  } catch {
    // non-blocking mirror
  }
}

/**
 * Full Offline Request Handler backed by IndexedDB
 */
async function handleOfflineRequest(endpoint, method, body) {
  // 1. Auth
  if (endpoint === '/api/auth/me') {
    const cachedUser = await idbGetKv('owner_profile', {
      id: 1,
      username: 'admin',
      fullName: 'S. Satyendranath (Proprietor)',
      role: 'owner',
    });
    return cachedUser;
  }

  if (endpoint === '/api/auth/login') {
    if (
      body &&
      body.username?.trim().toLowerCase() === 'admin' &&
      body.password === 'vestas123'
    ) {
      const user = {
        id: 1,
        username: 'admin',
        fullName: 'S. Satyendranath (Proprietor)',
        role: 'owner',
      };
      await idbSetKv('owner_profile', user);
      return { token: getAuthToken() || 'offline-owner-token', user };
    }
    throw new Error('Invalid owner credentials.');
  }

  // 2. Settings
  if (endpoint === '/api/settings') {
    const settings = await idbGetKv('settings', {
      id: 1,
      business_name: 'VESTAS PHARMACEUTICALS',
      owner_name: 'S. SATYENDRANATH (Singumahanthi Satyendra Nath)',
      tagline: 'Pharmaceutical Distributors, Wholesale & Retail Chemists',
      address:
        '27-18-92/A, 1st Floor, Ganesh Complex, Congress Office Road, Governorpet, Vijayawada, Andhra Pradesh - 520002',
      phone: '9603033345',
      email: 'ssatyendranth@gmail.com',
      gstin: '37BHCPS0456G1ZB',
      dl_no_1: 'AP/VJA/20B/104928',
      dl_no_2: 'AP/VJA/21B/104929',
      invoice_prefix: 'VP-',
      next_invoice_number: 1001,
      default_invoice_format: 'A4',
      default_gst_rate: 12,
      enable_gst: true,
      tax_inclusive: false,
      currency_symbol: '₹',
      payment_methods: ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Credit'],
      categories: [
        'Tablets',
        'Capsules',
        'Syrups',
        'Injections',
        'Ointments',
        'Drops',
        'Surgical & Consumables',
        'General Healthcare',
      ],
    });
    if (method === 'PUT' && body) {
      const merged = { ...settings, ...body, updated_at: new Date().toISOString() };
      await idbSetKv('settings', merged);
      return merged;
    }
    return settings;
  }

  // 3. Dashboard
  if (endpoint === '/api/dashboard') {
    return await computeLocalDashboard();
  }

  // 4. Products & Batches
  if (endpoint.startsWith('/api/products')) {
    const allProducts = await idbGetAll('products');

    if (method === 'GET') {
      return allProducts.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Add New Medicine / Batch while Offline
    if (method === 'POST' && endpoint === '/api/products') {
      const cleanName = (body.name || '').trim();
      const cleanBatch = (body.batch_number || '').trim();
      if (!cleanName || !cleanBatch || !body.expiry_date) {
        throw new Error('Medicine name, Batch Number, and Expiry Date are required.');
      }

      const dup = allProducts.find(
        (p) =>
          p.name.toLowerCase() === cleanName.toLowerCase() &&
          p.batch_number.toLowerCase() === cleanBatch.toLowerCase()
      );
      if (dup) {
        throw new Error(
          `Batch "${cleanBatch}" for medicine "${cleanName}" already exists in local inventory.`
        );
      }

      const clientUid = body.client_uid || `batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const tempId = Date.now();
      const newBatch = {
        id: tempId,
        client_uid: clientUid,
        name: cleanName,
        sku: (body.sku || `MED-${tempId.toString().slice(-4)}`).trim(),
        barcode: (body.barcode || '').trim(),
        hsn_code: (body.hsn_code || '3004').trim(),
        category: (body.category || 'Tablets').trim(),
        manufacturer: (body.manufacturer || '').trim(),
        batch_number: cleanBatch,
        expiry_date: body.expiry_date.trim(),
        pack_size: (body.pack_size || '10 Tabs').trim(),
        rack_location: (body.rack_location || '').trim(),
        purchase_price: Math.max(0, parseFloat(body.purchase_price || 0)),
        selling_price: Math.max(0, parseFloat(body.selling_price || 0)),
        mrp: Math.max(0, parseFloat(body.mrp || body.selling_price || 0)),
        gst_percentage: Math.max(0, parseFloat(body.gst_percentage ?? 12)),
        stock: Math.max(0, parseInt(body.stock || 0, 10)),
        min_stock_level: Math.max(0, parseInt(body.min_stock_level ?? 20, 10)),
        offline_pending: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await idbPut('products', newBatch);
      await idbPut('stock_movements', {
        id: Date.now() + 1,
        product_id: newBatch.id,
        product_name: newBatch.name,
        batch_number: newBatch.batch_number,
        movement_type: 'OFFLINE_NEW_BATCH',
        quantity_change: newBatch.stock,
        previous_stock: 0,
        new_stock: newBatch.stock,
        unit_cost: newBatch.purchase_price,
        reference_id: newBatch.sku,
        reason: 'New batch added while offline',
        performed_by: 'Owner (Offline)',
        created_at: new Date().toISOString(),
      });

      await enqueueOfflineOperation({
        type: 'CREATE_PRODUCT_BATCH',
        description: `Added batch "${newBatch.name}" (Batch: ${newBatch.batch_number}, Stock: ${newBatch.stock})`,
        payload: newBatch,
      });

      return newBatch;
    }

    // Stock Adjustment while Offline: POST /api/products/:id/stock
    const stockMatch = endpoint.match(/^\/api\/products\/(\d+)\/stock$/);
    if (method === 'POST' && stockMatch) {
      const prodId = parseInt(stockMatch[1], 10);
      const prod = allProducts.find((p) => Number(p.id) === prodId);
      if (!prod) throw new Error('Medicine batch not found in offline storage.');

      const prevStock = Number(prod.stock);
      const qtyNum = parseInt(body.quantity, 10);
      if (isNaN(qtyNum) || qtyNum < 0) {
        throw new Error('Valid non-negative quantity is required.');
      }

      let newStock = prevStock;
      let qtyChange = 0;
      const mType = body.movement_type;

      if (mType === 'PURCHASE_RESTOCK' || mType === 'MANUAL_ADD') {
        newStock = prevStock + qtyNum;
        qtyChange = qtyNum;
      } else if (mType === 'MANUAL_DEDUCT' || mType === 'DAMAGE_EXPIRY') {
        if (qtyNum > prevStock) {
          throw new Error(
            `Cannot deduct ${qtyNum} units from Batch ${prod.batch_number}; only ${prevStock} available.`
          );
        }
        newStock = prevStock - qtyNum;
        qtyChange = -qtyNum;
      } else if (mType === 'SET_EXACT') {
        newStock = qtyNum;
        qtyChange = newStock - prevStock;
      }

      const updatedBatch = {
        ...prod,
        stock: newStock,
        purchase_price:
          body.purchase_price !== undefined && body.purchase_price !== ''
            ? parseFloat(body.purchase_price)
            : Number(prod.purchase_price),
        selling_price:
          body.selling_price !== undefined && body.selling_price !== ''
            ? parseFloat(body.selling_price)
            : Number(prod.selling_price),
        mrp:
          body.mrp !== undefined && body.mrp !== '' ? parseFloat(body.mrp) : Number(prod.mrp),
        batch_number: body.batch_number ? body.batch_number.trim() : prod.batch_number,
        expiry_date: body.expiry_date ? body.expiry_date.trim() : prod.expiry_date,
        updated_at: new Date().toISOString(),
      };

      await idbPut('products', updatedBatch);

      const opId = `op-stock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await idbPut('stock_movements', {
        id: Date.now(),
        client_operation_id: opId,
        product_id: prod.id,
        product_name: updatedBatch.name,
        batch_number: updatedBatch.batch_number,
        movement_type: mType,
        quantity_change: qtyChange,
        previous_stock: prevStock,
        new_stock: newStock,
        unit_cost: updatedBatch.purchase_price,
        reference_id: body.reference_id || 'OFFLINE',
        reason: `${body.reason || mType} (Offline)`,
        performed_by: 'Owner (Offline)',
        created_at: new Date().toISOString(),
      });

      await enqueueOfflineOperation({
        operation_id: opId,
        type: 'STOCK_ADJUSTMENT',
        description: `${mType} on "${updatedBatch.name}" (Batch: ${updatedBatch.batch_number}): ${prevStock} → ${newStock}`,
        payload: {
          product_id: prod.id,
          product_name: updatedBatch.name,
          batch_number: updatedBatch.batch_number,
          movement_type: mType,
          quantity: qtyNum,
          purchase_price: updatedBatch.purchase_price,
          selling_price: updatedBatch.selling_price,
          mrp: updatedBatch.mrp,
          reference_id: body.reference_id,
          reason: body.reason,
        },
      });

      return updatedBatch;
    }

    // Edit Medicine / Price / Stock while Offline: PUT /api/products/:id
    const editMatch = endpoint.match(/^\/api\/products\/(\d+)$/);
    if (method === 'PUT' && editMatch) {
      const prodId = parseInt(editMatch[1], 10);
      const prod = allProducts.find((p) => Number(p.id) === prodId);
      if (!prod) throw new Error('Medicine batch not found in offline storage.');

      const prevStock = Number(prod.stock);
      const newStock = parseInt(body.stock ?? prevStock, 10);
      const stockDelta = newStock - prevStock;

      const updatedBatch = {
        ...prod,
        ...body,
        id: prod.id,
        purchase_price: parseFloat(body.purchase_price ?? prod.purchase_price),
        selling_price: parseFloat(body.selling_price ?? prod.selling_price),
        mrp: parseFloat(body.mrp ?? prod.mrp),
        gst_percentage: parseFloat(body.gst_percentage ?? prod.gst_percentage),
        stock: newStock,
        min_stock_level: parseInt(body.min_stock_level ?? prod.min_stock_level, 10),
        updated_at: new Date().toISOString(),
      };

      await idbPut('products', updatedBatch);

      await enqueueOfflineOperation({
        type: 'UPDATE_PRODUCT_BATCH',
        description: `Edited "${updatedBatch.name}" (Batch: ${updatedBatch.batch_number}) — Selling ₹${updatedBatch.selling_price}, Stock ${newStock}`,
        payload: {
          ...updatedBatch,
          stock_delta: stockDelta,
        },
      });

      return updatedBatch;
    }
  }

  // 5. Invoices & Offline Bill Creation
  if (endpoint === '/api/invoices/next-number') {
    const settings = await idbGetKv('settings', {
      invoice_prefix: 'VP-',
      next_invoice_number: 1001,
    });
    return {
      invoiceNumber: `${settings.invoice_prefix || 'VP-'}${settings.next_invoice_number || 1001}`,
    };
  }

  if (endpoint.startsWith('/api/invoices')) {
    const allInvoices = await idbGetAll('invoices');
    if (method === 'GET') {
      return allInvoices.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    if (method === 'POST' && endpoint === '/api/invoices') {
      const settings = await idbGetKv('settings', {
        invoice_prefix: 'VP-',
        next_invoice_number: 1001,
        enable_gst: true,
        tax_inclusive: false,
      });
      const allProducts = await idbGetAll('products');

      const prefix = settings.invoice_prefix || 'VP-';
      const nextNum = Number(settings.next_invoice_number || 1001);
      const invoiceNumber = `${prefix}${nextNum}`;
      const clientInvoiceUid =
        body.client_invoice_uid || `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const gstEnabled =
        body.enable_gst !== undefined ? Boolean(body.enable_gst) : Boolean(settings.enable_gst);
      const isTaxInclusive =
        body.tax_inclusive !== undefined
          ? Boolean(body.tax_inclusive)
          : Boolean(settings.tax_inclusive);

      let subtotal = 0;
      let totalItemTax = 0;
      let totalCost = 0;
      const savedItems = [];

      for (const item of body.items || []) {
        const qty = parseInt(item.quantity, 10);
        if (!qty || qty <= 0) throw new Error('Quantity must be at least 1.');

        const prod = allProducts.find((p) => Number(p.id) === Number(item.product_id));
        if (prod && Number(prod.stock) < qty) {
          throw new Error(
            `Insufficient stock for "${prod.name}" (Batch: ${prod.batch_number}). Available: ${prod.stock}.`
          );
        }

        const unitPrice = parseFloat(item.unit_price ?? prod?.selling_price ?? 0);
        const purchasePrice = parseFloat(item.purchase_price ?? prod?.purchase_price ?? 0);
        const mrp = parseFloat(item.mrp ?? prod?.mrp ?? unitPrice);
        const itemDiscPct = Math.max(0, Math.min(100, parseFloat(item.item_discount_percent ?? 0)));
        const gross = unitPrice * qty;
        const itemDiscAmt = +(gross * (itemDiscPct / 100)).toFixed(2);
        const afterItemDisc = +(gross - itemDiscAmt).toFixed(2);

        const gstPct = gstEnabled
          ? parseFloat(item.gst_percentage ?? prod?.gst_percentage ?? 12)
          : 0;
        let taxable = afterItemDisc;
        let gstAmt = 0;
        let lineTotal = afterItemDisc;

        if (gstEnabled && gstPct > 0) {
          if (isTaxInclusive) {
            taxable = +(afterItemDisc / (1 + gstPct / 100)).toFixed(2);
            gstAmt = +(afterItemDisc - taxable).toFixed(2);
            lineTotal = afterItemDisc;
          } else {
            taxable = afterItemDisc;
            gstAmt = +(taxable * (gstPct / 100)).toFixed(2);
            lineTotal = +(taxable + gstAmt).toFixed(2);
          }
        }

        subtotal += taxable;
        totalItemTax += gstAmt;
        totalCost += purchasePrice * qty;

        savedItems.push({
          id: Date.now() + Math.floor(Math.random() * 1000),
          product_id: prod ? prod.id : null,
          client_uid: prod?.client_uid || null,
          product_name: (item.product_name || prod?.name || 'Medicine').trim(),
          sku: item.sku || prod?.sku || '',
          hsn_code: item.hsn_code || prod?.hsn_code || '3004',
          batch_number: (item.batch_number || prod?.batch_number || 'BATCH-1').trim(),
          expiry_date: item.expiry_date || prod?.expiry_date || '',
          pack_size: item.pack_size || prod?.pack_size || '',
          quantity: qty,
          purchase_price: purchasePrice,
          unit_price: unitPrice,
          mrp,
          item_discount_percent: itemDiscPct,
          item_discount_amount: itemDiscAmt,
          gst_percentage: gstPct,
          taxable_amount: taxable,
          gst_amount: gstAmt,
          line_total: lineTotal,
        });

        // Deduct stock locally in IndexedDB
        if (prod) {
          const prevStock = Number(prod.stock);
          const newStock = Math.max(0, prevStock - qty);
          await idbPut('products', {
            ...prod,
            stock: newStock,
            updated_at: new Date().toISOString(),
          });
          await idbPut('stock_movements', {
            id: Date.now() + Math.floor(Math.random() * 10000),
            product_id: prod.id,
            product_name: prod.name,
            batch_number: prod.batch_number,
            movement_type: 'SALE (OFFLINE)',
            quantity_change: -qty,
            previous_stock: prevStock,
            new_stock: newStock,
            unit_cost: unitPrice,
            reference_id: invoiceNumber,
            reason: `Offline sale via Invoice ${invoiceNumber}`,
            performed_by: 'Owner (Offline)',
            created_at: new Date().toISOString(),
          });
        }
      }

      subtotal = +subtotal.toFixed(2);
      const discVal = Math.max(0, parseFloat(body.discount_value || 0));
      let billDiscountAmount = 0;
      if (body.discount_type === 'percent') {
        billDiscountAmount = +(subtotal * (Math.min(100, discVal) / 100)).toFixed(2);
      } else {
        billDiscountAmount = Math.min(subtotal, +discVal.toFixed(2));
      }

      const discountRatio = subtotal > 0 ? (subtotal - billDiscountAmount) / subtotal : 1;
      const taxAmount = +(totalItemTax * discountRatio).toFixed(2);
      const exactTotal = +(subtotal - billDiscountAmount + taxAmount).toFixed(2);
      const grandTotal = Math.round(exactTotal);
      const roundOff = +(grandTotal - exactTotal).toFixed(2);
      const estimatedProfit = +(subtotal - billDiscountAmount - totalCost).toFixed(2);

      const paidAmt =
        body.amount_paid !== undefined && body.amount_paid !== ''
          ? Math.max(0, parseFloat(body.amount_paid))
          : body.payment_method === 'Credit'
          ? 0
          : grandTotal;
      const balanceDue = Math.max(0, +(grandTotal - paidAmt).toFixed(2));
      const paymentStatus =
        balanceDue >= grandTotal && grandTotal > 0
          ? 'Unpaid'
          : balanceDue > 0
          ? 'Partial'
          : 'Paid';

      const custName = (body.customer_name || '').trim() || 'Walk-in Customer';
      const nowIso = body.created_at || new Date().toISOString();

      const offlineInvoice = {
        id: Date.now(),
        client_invoice_uid: clientInvoiceUid,
        invoice_number: body.invoice_number ? body.invoice_number.trim() : invoiceNumber,
        customer_id: body.customer_id || null,
        customer_name: custName,
        customer_phone: (body.customer_phone || '').trim(),
        customer_address: (body.customer_address || '').trim(),
        customer_gstin: (body.customer_gstin || '').trim(),
        customer_dl: (body.customer_dl || '').trim(),
        doctor_name: (body.doctor_name || '').trim(),
        subtotal,
        discount_amount: billDiscountAmount,
        discount_type: body.discount_type || 'amount',
        discount_value: discVal,
        tax_amount: taxAmount,
        round_off: roundOff,
        grand_total: grandTotal,
        total_cost: +totalCost.toFixed(2),
        estimated_profit: estimatedProfit,
        payment_method: body.payment_method || 'Cash',
        payment_status: paymentStatus,
        amount_paid: paidAmt,
        balance_due: balanceDue,
        notes: body.notes || '',
        offline_pending: true,
        created_by: 'Owner (Offline)',
        created_at: nowIso,
        items: savedItems,
      };

      await idbPut('invoices', offlineInvoice);
      await idbSetKv('settings', {
        ...settings,
        next_invoice_number: nextNum + 1,
      });

      await enqueueOfflineOperation({
        operation_id: clientInvoiceUid,
        type: 'CREATE_INVOICE',
        description: `Offline Invoice ${offlineInvoice.invoice_number} for ${custName} — ₹${grandTotal}`,
        payload: {
          ...body,
          client_invoice_uid: clientInvoiceUid,
          invoice_number: offlineInvoice.invoice_number,
          created_at: nowIso,
          items: savedItems,
        },
      });

      return offlineInvoice;
    }

    // Update invoice offline: PUT /api/invoices/:id
    const updInvMatch = endpoint.match(/^\/api\/invoices\/(\d+)$/);
    if (method === 'PUT' && updInvMatch) {
      const invId = parseInt(updInvMatch[1], 10);
      const existing = allInvoices.find((i) => Number(i.id) === invId);
      if (!existing) throw new Error('Invoice not found in offline storage.');
      const grandTotal = Number(existing.grand_total);
      const updatedPaid =
        body.amount_paid !== undefined && body.amount_paid !== ''
          ? Math.max(0, parseFloat(body.amount_paid))
          : body.payment_status === 'Paid'
          ? grandTotal
          : body.payment_status === 'Unpaid'
          ? 0
          : Number(existing.amount_paid);
      const updatedBalance = Math.max(0, +(grandTotal - updatedPaid).toFixed(2));
      const updated = {
        ...existing,
        invoice_number: (body.invoice_number || existing.invoice_number).trim(),
        customer_name: (body.customer_name || existing.customer_name || 'Walk-in Customer').trim(),
        customer_phone: (body.customer_phone ?? existing.customer_phone ?? '').trim(),
        payment_method: body.payment_method || existing.payment_method,
        payment_status:
          body.payment_status ||
          (updatedBalance <= 0 ? 'Paid' : updatedPaid > 0 ? 'Partial' : 'Unpaid'),
        amount_paid: updatedPaid,
        balance_due: updatedBalance,
        created_at: body.created_at ? new Date(body.created_at).toISOString() : existing.created_at,
        notes: (body.notes ?? existing.notes ?? '').trim(),
      };
      await idbPut('invoices', updated);
      return updated;
    }
  }

  // 6. Customers & Movements & Reports fallback
  if (endpoint.startsWith('/api/customers')) {
    return await idbGetAll('customers');
  }
  if (endpoint.startsWith('/api/inventory/movements')) {
    const movs = await idbGetAll('stock_movements');
    return movs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  if (endpoint.startsWith('/api/reports')) {
    const [invoices, products, customers] = await Promise.all([
      idbGetAll('invoices'),
      idbGetAll('products'),
      idbGetAll('customers'),
    ]);
    const totalSales = invoices.reduce((s, i) => s + Number(i.grand_total || 0), 0);
    const totalTax = invoices.reduce((s, i) => s + Number(i.tax_amount || 0), 0);
    const totalDiscount = invoices.reduce((s, i) => s + Number(i.discount_amount || 0), 0);
    const totalCost = invoices.reduce((s, i) => s + Number(i.total_cost || 0), 0);
    const totalProfit = invoices.reduce((s, i) => s + Number(i.estimated_profit || 0), 0);
    const totalCollected = invoices.reduce((s, i) => s + Number(i.amount_paid || 0), 0);
    const totalPending = invoices.reduce((s, i) => s + Number(i.balance_due || 0), 0);

    return {
      summary: {
        invoiceCount: invoices.length,
        totalSales,
        totalTax,
        totalDiscount,
        totalCost,
        totalProfit,
        totalCollected,
        totalPending,
      },
      invoices,
      productWiseSales: [],
      paymentBreakdown: [],
      products,
      customers,
    };
  }

  return {};
}

/**
 * Synchronizes all pending offline operations in IndexedDB with the central PostgreSQL database
 */
export async function synchronizeOfflineQueue() {
  if (isBrowserOffline()) {
    return { syncedCount: 0, pendingCount: (await getPendingSyncQueue()).length, offline: true };
  }

  const queue = await getPendingSyncQueue();
  if (queue.length === 0) {
    return { syncedCount: 0, pendingCount: 0, results: [] };
  }

  const token = getAuthToken();
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ operations: queue }),
  });

  if (!res.ok) {
    throw new Error('Failed to synchronize offline queue with central database.');
  }

  const syncData = await res.json();

  for (const r of syncData.results || []) {
    const originalOp = queue.find((q) => q.operation_id === r.operation_id);
    if (r.status === 'synced' || r.status === 'duplicate_skipped') {
      await idbDelete('sync_queue', r.operation_id);
      await idbPut('sync_history', {
        operation_id: r.operation_id,
        type: originalOp?.type || 'OPERATION',
        description: originalOp?.description || r.operation_id,
        status: r.status,
        created_at: originalOp?.created_at,
        synced_at: new Date().toISOString(),
      });
    } else if (r.status === 'error' && originalOp) {
      await idbPut('sync_queue', {
        ...originalOp,
        status: 'error',
        last_error: r.error,
      });
    }
  }

  await idbSetKv('last_sync_at', new Date().toISOString());
  window.dispatchEvent(new CustomEvent('vestas-sync-queue-updated'));
  return syncData;
}

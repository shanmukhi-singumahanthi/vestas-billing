import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'vestas-pharma-secure-jwt-secret-key-2026';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.use('/uploads', express.static(path.join(__dirname, '..', 'data')));

// Single Owner Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Session expired or invalid token. Please log in again.' });
    }
    req.user = user;
    next();
  });
}

// Health / Online Connectivity Ping
app.get('/api/ping', (req, res) => {
  res.json({ online: true, timestamp: new Date().toISOString() });
});
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', online: true, timestamp: new Date().toISOString() });
});

// ==========================================
// 1. SINGLE OWNER AUTHENTICATION ROUTES
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const db = await getDb();
    const result = await db.query(
      "SELECT * FROM users WHERE role = 'owner' AND LOWER(username) = LOWER($1)",
      [username.trim()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid owner username or password.' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid owner username or password.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, fullName: user.full_name, role: 'owner' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: 'owner',
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.query(
      'SELECT id, username, full_name, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Owner account not found.' });
    }
    const u = result.rows[0];
    res.json({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      role: 'owner',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, newUsername, fullName } = req.body;
    const db = await getDb();
    const userRes = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Owner account not found.' });
    }
    const user = userRes.rows[0];
    const valid = await bcrypt.compare(currentPassword || '', user.password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const updatedUsername = (newUsername || user.username).trim();
    const updatedFullName = (fullName || user.full_name).trim();
    const updatedHash = newPassword ? await bcrypt.hash(newPassword, 10) : user.password_hash;

    await db.query(
      'UPDATE users SET username = $1, password_hash = $2, full_name = $3 WHERE id = $4',
      [updatedUsername, updatedHash, updatedFullName, user.id]
    );

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, performed_by)
       VALUES ('SECURITY_UPDATE', 'USER', $1, $2, $3)`,
      [String(user.id), `Updated owner credentials for ${updatedUsername}`, updatedFullName]
    );

    res.json({ message: 'Owner security credentials updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. SETTINGS ROUTES
// ==========================================
app.get('/api/settings', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.query('SELECT * FROM settings WHERE id = 1');
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const s = req.body;
    const oldRes = await db.query('SELECT * FROM settings WHERE id = 1');
    const oldSettings = oldRes.rows[0] || {};

    const result = await db.query(
      `UPDATE settings SET
        business_name = $1,
        owner_name = $2,
        tagline = $3,
        address = $4,
        phone = $5,
        email = $6,
        gstin = $7,
        dl_no_1 = $8,
        dl_no_2 = $9,
        logo_url = $10,
        invoice_prefix = $11,
        next_invoice_number = $12,
        default_invoice_format = $13,
        default_gst_rate = $14,
        enable_gst = $15,
        tax_inclusive = $16,
        currency_symbol = $17,
        payment_methods = $18,
        categories = $19,
        low_stock_threshold = $20,
        printer_paper_size = $21,
        auto_print_after_save = $22,
        show_hsn_on_invoice = $23,
        show_batch_expiry_on_invoice = $24,
        show_mrp_on_invoice = $25,
        terms_and_conditions = $26,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 RETURNING *`,
      [
        s.business_name ?? oldSettings.business_name,
        s.owner_name ?? oldSettings.owner_name,
        s.tagline ?? oldSettings.tagline,
        s.address ?? oldSettings.address,
        s.phone ?? oldSettings.phone,
        s.email ?? oldSettings.email,
        s.gstin ?? oldSettings.gstin,
        s.dl_no_1 ?? oldSettings.dl_no_1,
        s.dl_no_2 ?? oldSettings.dl_no_2,
        s.logo_url ?? oldSettings.logo_url,
        s.invoice_prefix ?? oldSettings.invoice_prefix,
        Number(s.next_invoice_number ?? oldSettings.next_invoice_number),
        s.default_invoice_format ?? oldSettings.default_invoice_format,
        Number(s.default_gst_rate ?? oldSettings.default_gst_rate),
        Boolean(s.enable_gst ?? oldSettings.enable_gst),
        Boolean(s.tax_inclusive ?? oldSettings.tax_inclusive),
        s.currency_symbol ?? oldSettings.currency_symbol,
        JSON.stringify(s.payment_methods ?? oldSettings.payment_methods),
        JSON.stringify(s.categories ?? oldSettings.categories),
        Number(s.low_stock_threshold ?? oldSettings.low_stock_threshold),
        s.printer_paper_size ?? oldSettings.printer_paper_size,
        Boolean(s.auto_print_after_save ?? oldSettings.auto_print_after_save),
        Boolean(s.show_hsn_on_invoice ?? oldSettings.show_hsn_on_invoice),
        Boolean(s.show_batch_expiry_on_invoice ?? oldSettings.show_batch_expiry_on_invoice),
        Boolean(s.show_mrp_on_invoice ?? oldSettings.show_mrp_on_invoice),
        s.terms_and_conditions ?? oldSettings.terms_and_conditions,
      ]
    );

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, performed_by)
       VALUES ('UPDATE_SETTINGS', 'SETTINGS', '1', 'Updated store & billing configuration settings', $1)`,
      [req.user.fullName || req.user.username]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. DASHBOARD OVERVIEW ROUTE
// ==========================================
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const productsRes = await db.query('SELECT * FROM products ORDER BY name ASC, expiry_date ASC');
    const products = productsRes.rows;

    const invoicesRes = await db.query('SELECT * FROM invoices ORDER BY created_at DESC');
    const invoices = invoicesRes.rows;

    const customersRes = await db.query('SELECT * FROM customers');
    const customers = customersRes.rows;

    const todayInvoices = invoices.filter((inv) => new Date(inv.created_at) >= new Date(todayStart));
    const salesToday = todayInvoices.reduce((sum, inv) => sum + Number(inv.grand_total), 0);
    const profitToday = todayInvoices.reduce((sum, inv) => sum + Number(inv.estimated_profit), 0);
    const billsToday = todayInvoices.length;

    const totalBills = invoices.length;
    const totalRevenue = invoices.reduce((sum, inv) => sum + Number(inv.grand_total), 0);
    const totalProfit = invoices.reduce((sum, inv) => sum + Number(inv.estimated_profit), 0);

    const lowStockProducts = products.filter(
      (p) => Number(p.stock) > 0 && Number(p.stock) <= Number(p.min_stock_level)
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
      (sum, p) => sum + Math.max(0, Number(p.stock)) * Number(p.purchase_price),
      0
    );
    const totalRetailValue = products.reduce(
      (sum, p) => sum + Math.max(0, Number(p.stock)) * Number(p.selling_price),
      0
    );

    const totalReceivables = customers.reduce((sum, c) => sum + Math.max(0, Number(c.balance)), 0);

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
        sales: dayInvoices.reduce((s, inv) => s + Number(inv.grand_total), 0),
        profit: dayInvoices.reduce((s, inv) => s + Number(inv.estimated_profit), 0),
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
        sales: wkInvoices.reduce((s, inv) => s + Number(inv.grand_total), 0),
        profit: wkInvoices.reduce((s, inv) => s + Number(inv.estimated_profit), 0),
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
        sales: mInvoices.reduce((s, inv) => s + Number(inv.grand_total), 0),
        profit: mInvoices.reduce((s, inv) => s + Number(inv.estimated_profit), 0),
        bills: mInvoices.length,
      });
    }

    const recentInvoices = invoices.slice(0, 8);
    for (const inv of recentInvoices) {
      const itemsRes = await db.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [inv.id]);
      inv.items = itemsRes.rows;
    }

    res.json({
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
      recentInvoices,
      dailyOverview,
      weeklyOverview,
      monthlyOverview,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. PRODUCTS & MULTI-BATCH MANAGEMENT ROUTES
// ==========================================
app.get('/api/products', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const { q, category, status } = req.query;
    const result = await db.query('SELECT * FROM products ORDER BY name ASC, expiry_date ASC');
    let items = result.rows;

    if (q && q.trim()) {
      const term = q.trim().toLowerCase();
      items = items.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          p.sku.toLowerCase().includes(term) ||
          (p.barcode && p.barcode.toLowerCase().includes(term)) ||
          (p.batch_number && p.batch_number.toLowerCase().includes(term)) ||
          (p.manufacturer && p.manufacturer.toLowerCase().includes(term)) ||
          (p.category && p.category.toLowerCase().includes(term))
      );
    }

    if (category && category !== 'All') {
      items = items.filter((p) => p.category === category);
    }

    const now = new Date();
    const ninetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    if (status === 'low') {
      items = items.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= Number(p.min_stock_level));
    } else if (status === 'out') {
      items = items.filter((p) => Number(p.stock) <= 0);
    } else if (status === 'expiring') {
      items = items.filter((p) => {
        if (!p.expiry_date) return false;
        const d = new Date(p.expiry_date.length === 7 ? `${p.expiry_date}-28` : p.expiry_date);
        return d >= now && d <= ninetyDays;
      });
    } else if (status === 'expired') {
      items = items.filter((p) => {
        if (!p.expiry_date) return false;
        const d = new Date(p.expiry_date.length === 7 ? `${p.expiry_date}-28` : p.expiry_date);
        return d < now;
      });
    }

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const p = req.body;
    if (!p.name || !p.batch_number || !p.expiry_date) {
      return res.status(400).json({
        error: 'Medicine name, Batch Number, and Expiry Date are required.',
      });
    }

    const cleanName = p.name.trim();
    const cleanBatch = p.batch_number.trim();
    const cleanSku = (p.sku || `MED-${Date.now().toString().slice(-5)}`).trim();

    // Prevent combining different batches: only check if exact same medicine + exact same batch_number exists
    const existingBatch = await db.query(
      'SELECT id FROM products WHERE LOWER(name) = LOWER($1) AND LOWER(batch_number) = LOWER($2)',
      [cleanName, cleanBatch]
    );
    if (existingBatch.rows.length > 0) {
      return res.status(400).json({
        error: `Batch "${cleanBatch}" for medicine "${cleanName}" already exists. Please use a distinct batch number or edit that batch directly.`,
      });
    }

    const stockQty = Math.max(0, parseInt(p.stock ?? 0, 10));
    const purchasePrice = Math.max(0, parseFloat(p.purchase_price ?? 0));
    const sellingPrice = Math.max(0, parseFloat(p.selling_price ?? 0));
    const mrp = Math.max(0, parseFloat(p.mrp ?? sellingPrice));
    const gst = Math.max(0, parseFloat(p.gst_percentage ?? 12));
    const minStock = Math.max(0, parseInt(p.min_stock_level ?? 20, 10));

    const result = await db.query(
      `INSERT INTO products (
        client_uid, name, sku, barcode, hsn_code, category, manufacturer, batch_number,
        expiry_date, pack_size, rack_location, purchase_price, selling_price,
        mrp, gst_percentage, stock, min_stock_level
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        p.client_uid || null,
        cleanName,
        cleanSku,
        (p.barcode || '').trim(),
        (p.hsn_code || '3004').trim(),
        (p.category || 'Tablets').trim(),
        (p.manufacturer || '').trim(),
        cleanBatch,
        p.expiry_date.trim(),
        (p.pack_size || '10 Tabs').trim(),
        (p.rack_location || '').trim(),
        purchasePrice,
        sellingPrice,
        mrp,
        gst,
        stockQty,
        minStock,
      ]
    );

    const created = result.rows[0];

    await db.query(
      `INSERT INTO stock_movements (
        product_id, product_name, batch_number, movement_type, quantity_change,
        previous_stock, new_stock, unit_cost, reference_id, reason, performed_by
      ) VALUES ($1,$2,$3,'NEW_BATCH_STOCK',$4,0,$4,$5,$6,'New Medicine Batch Added',$7)`,
      [
        created.id,
        created.name,
        created.batch_number,
        stockQty,
        purchasePrice,
        created.sku,
        req.user.fullName || req.user.username,
      ]
    );

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, new_values, performed_by)
       VALUES ('CREATE_PRODUCT_BATCH', 'PRODUCT', $1, $2, $3, $4)`,
      [
        String(created.id),
        `Added medicine batch "${created.name}" (Batch: ${created.batch_number}, Exp: ${created.expiry_date}) with stock ${stockQty}, Selling ₹${sellingPrice}`,
        JSON.stringify(created),
        req.user.fullName || req.user.username,
      ]
    );

    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const productId = parseInt(req.params.id, 10);
    const p = req.body;

    const oldRes = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
    if (oldRes.rows.length === 0) {
      return res.status(404).json({ error: 'Medicine batch record not found.' });
    }
    const oldProd = oldRes.rows[0];

    const cleanName = (p.name ?? oldProd.name).trim();
    const cleanBatch = (p.batch_number ?? oldProd.batch_number).trim();

    // Ensure another record doesn't already have the exact same name + batch_number
    const dup = await db.query(
      'SELECT id FROM products WHERE LOWER(name) = LOWER($1) AND LOWER(batch_number) = LOWER($2) AND id != $3',
      [cleanName, cleanBatch, productId]
    );
    if (dup.rows.length > 0) {
      return res.status(400).json({
        error: `Another inventory record for "${cleanName}" already uses Batch Number "${cleanBatch}".`,
      });
    }

    const newStock = parseInt(p.stock ?? oldProd.stock, 10);
    if (newStock < 0 && !p.allow_negative_authorized) {
      return res.status(400).json({ error: 'Stock quantity cannot be negative.' });
    }

    const newPurchasePrice = parseFloat(p.purchase_price ?? oldProd.purchase_price);
    const newSellingPrice = parseFloat(p.selling_price ?? oldProd.selling_price);
    const newMrp = parseFloat(p.mrp ?? oldProd.mrp);
    const newGst = parseFloat(p.gst_percentage ?? oldProd.gst_percentage);
    const newMinStock = parseInt(p.min_stock_level ?? oldProd.min_stock_level, 10);

    const updatedRes = await db.query(
      `UPDATE products SET
        name = $1,
        sku = $2,
        barcode = $3,
        hsn_code = $4,
        category = $5,
        manufacturer = $6,
        batch_number = $7,
        expiry_date = $8,
        pack_size = $9,
        rack_location = $10,
        purchase_price = $11,
        selling_price = $12,
        mrp = $13,
        gst_percentage = $14,
        stock = $15,
        min_stock_level = $16,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $17 RETURNING *`,
      [
        cleanName,
        (p.sku ?? oldProd.sku).trim(),
        (p.barcode ?? oldProd.barcode ?? '').trim(),
        (p.hsn_code ?? oldProd.hsn_code ?? '3004').trim(),
        (p.category ?? oldProd.category ?? 'Tablets').trim(),
        (p.manufacturer ?? oldProd.manufacturer ?? '').trim(),
        cleanBatch,
        (p.expiry_date ?? oldProd.expiry_date).trim(),
        (p.pack_size ?? oldProd.pack_size ?? '').trim(),
        (p.rack_location ?? oldProd.rack_location ?? '').trim(),
        newPurchasePrice,
        newSellingPrice,
        newMrp,
        newGst,
        newStock,
        newMinStock,
        productId,
      ]
    );

    const updated = updatedRes.rows[0];
    const performer = req.user.fullName || req.user.username;

    if (newStock !== Number(oldProd.stock)) {
      const diff = newStock - Number(oldProd.stock);
      await db.query(
        `INSERT INTO stock_movements (
          product_id, product_name, batch_number, movement_type, quantity_change,
          previous_stock, new_stock, unit_cost, reference_id, reason, performed_by
        ) VALUES ($1,$2,$3,'PRODUCT_EDIT',$4,$5,$6,$7,$8,$9,$10)`,
        [
          productId,
          updated.name,
          updated.batch_number,
          diff,
          Number(oldProd.stock),
          newStock,
          newPurchasePrice,
          updated.sku,
          p.adjustment_reason || 'Direct batch edit',
          performer,
        ]
      );
    }

    const changes = [];
    if (Number(oldProd.selling_price) !== newSellingPrice) {
      changes.push(`Selling Price: ₹${oldProd.selling_price} → ₹${newSellingPrice}`);
    }
    if (Number(oldProd.purchase_price) !== newPurchasePrice) {
      changes.push(`Purchase Price: ₹${oldProd.purchase_price} → ₹${newPurchasePrice}`);
    }
    if (Number(oldProd.mrp) !== newMrp) {
      changes.push(`MRP: ₹${oldProd.mrp} → ₹${newMrp}`);
    }
    if (Number(oldProd.stock) !== newStock) {
      changes.push(`Stock: ${oldProd.stock} → ${newStock}`);
    }

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, old_values, new_values, performed_by)
       VALUES ($1, 'PRODUCT', $2, $3, $4, $5, $6)`,
      [
        changes.length > 0 ? 'PRICE_OR_STOCK_UPDATE' : 'UPDATE_PRODUCT',
        String(productId),
        `Updated "${updated.name}" (Batch: ${updated.batch_number})${
          changes.length ? ' — ' + changes.join(', ') : ''
        }`,
        JSON.stringify(oldProd),
        JSON.stringify(updated),
        performer,
      ]
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dedicated Stock Adjustment / Restock Purchase Endpoint
app.post('/api/products/:id/stock', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const productId = parseInt(req.params.id, 10);
    const {
      client_operation_id,
      movement_type, // 'PURCHASE_RESTOCK', 'MANUAL_ADD', 'MANUAL_DEDUCT', 'DAMAGE_EXPIRY', 'SET_EXACT'
      quantity,
      purchase_price,
      selling_price,
      mrp,
      batch_number,
      expiry_date,
      reference_id,
      reason,
    } = req.body;

    // Idempotency check if client_operation_id provided
    if (client_operation_id) {
      const dupOp = await db.query(
        'SELECT id FROM stock_movements WHERE client_operation_id = $1',
        [client_operation_id]
      );
      if (dupOp.rows.length > 0) {
        const currentProd = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
        return res.json(currentProd.rows[0]);
      }
    }

    const prodRes = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
    if (prodRes.rows.length === 0) {
      return res.status(404).json({ error: 'Medicine batch not found.' });
    }
    const prod = prodRes.rows[0];
    const prevStock = Number(prod.stock);
    const qtyNum = parseInt(quantity, 10);
    if (isNaN(qtyNum) || qtyNum < 0) {
      return res.status(400).json({ error: 'Valid non-negative quantity is required.' });
    }

    let newStock = prevStock;
    let qtyChange = 0;

    if (movement_type === 'PURCHASE_RESTOCK' || movement_type === 'MANUAL_ADD') {
      newStock = prevStock + qtyNum;
      qtyChange = qtyNum;
    } else if (movement_type === 'MANUAL_DEDUCT' || movement_type === 'DAMAGE_EXPIRY') {
      if (qtyNum > prevStock) {
        return res.status(400).json({
          error: `Cannot deduct ${qtyNum} units from Batch ${prod.batch_number}; only ${prevStock} available.`,
        });
      }
      newStock = prevStock - qtyNum;
      qtyChange = -qtyNum;
    } else if (movement_type === 'SET_EXACT') {
      newStock = qtyNum;
      qtyChange = newStock - prevStock;
    } else {
      return res.status(400).json({ error: 'Invalid stock movement type.' });
    }

    const updatedPurchasePrice =
      purchase_price !== undefined && purchase_price !== ''
        ? parseFloat(purchase_price)
        : Number(prod.purchase_price);
    const updatedSellingPrice =
      selling_price !== undefined && selling_price !== ''
        ? parseFloat(selling_price)
        : Number(prod.selling_price);
    const updatedMrp =
      mrp !== undefined && mrp !== '' ? parseFloat(mrp) : Number(prod.mrp);
    const updatedBatch = batch_number ? batch_number.trim() : prod.batch_number;
    const updatedExpiry = expiry_date ? expiry_date.trim() : prod.expiry_date;

    const updatedRes = await db.query(
      `UPDATE products SET
        stock = $1,
        purchase_price = $2,
        selling_price = $3,
        mrp = $4,
        batch_number = $5,
        expiry_date = $6,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $7 RETURNING *`,
      [
        newStock,
        updatedPurchasePrice,
        updatedSellingPrice,
        updatedMrp,
        updatedBatch,
        updatedExpiry,
        productId,
      ]
    );

    const updated = updatedRes.rows[0];
    const performer = req.user.fullName || req.user.username;

    await db.query(
      `INSERT INTO stock_movements (
        client_operation_id, product_id, product_name, batch_number, movement_type, quantity_change,
        previous_stock, new_stock, unit_cost, reference_id, reason, performed_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        client_operation_id || null,
        productId,
        updated.name,
        updatedBatch,
        movement_type,
        qtyChange,
        prevStock,
        newStock,
        updatedPurchasePrice,
        reference_id || '',
        reason || movement_type,
        performer,
      ]
    );

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, old_values, new_values, performed_by)
       VALUES ('STOCK_ADJUSTMENT', 'PRODUCT', $1, $2, $3, $4, $5)`,
      [
        String(productId),
        `${movement_type} on "${updated.name}" (Batch: ${updatedBatch}): Stock ${prevStock} → ${newStock} (${
          qtyChange >= 0 ? '+' : ''
        }${qtyChange}). Reason: ${reason || 'N/A'}`,
        JSON.stringify({
          stock: prevStock,
          purchase_price: prod.purchase_price,
          selling_price: prod.selling_price,
        }),
        JSON.stringify({
          stock: newStock,
          purchase_price: updatedPurchasePrice,
          selling_price: updatedSellingPrice,
        }),
        performer,
      ]
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk CSV / Excel Import (Preserves separate batches — never merges different batches)
app.post('/api/products/bulk-import', authenticateToken, async (req, res) => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'No product rows found to import.' });
    }
    const db = await getDb();
    const performer = req.user.fullName || req.user.username;
    let inserted = 0;
    let updated = 0;

    await db.transaction(async (tx) => {
      for (let i = 0; i < products.length; i++) {
        const row = products[i];
        const name = String(row.name || row['Product Name'] || row.product_name || '').trim();
        if (!name) continue;

        const sku = String(
          row.sku || row['Product Code'] || row['SKU'] || `MED-${1000 + i}`
        ).trim();
        const barcode = String(row.barcode || row['Barcode'] || '').trim();
        const hsn = String(row.hsn_code || row['HSN'] || row['HSN Code'] || '3004').trim();
        const category = String(row.category || row['Category'] || 'Tablets').trim();
        const manufacturer = String(row.manufacturer || row['Manufacturer'] || '').trim();
        const batch = String(
          row.batch_number || row['Batch'] || row['Batch Number'] || `BATCH-${i + 1}`
        ).trim();
        const expiry = String(
          row.expiry_date || row['Expiry'] || row['Expiry Date'] || '2028-12-31'
        ).trim();
        const packSize = String(row.pack_size || row['Pack Size'] || '10 Tabs').trim();
        const rack = String(row.rack_location || row['Rack'] || '').trim();
        const purchasePrice = Math.max(
          0,
          parseFloat(row.purchase_price ?? row['Purchase Price'] ?? 0) || 0
        );
        const sellingPrice = Math.max(
          0,
          parseFloat(row.selling_price ?? row['Selling Price'] ?? row['Rate'] ?? 0) || 0
        );
        const mrp = Math.max(
          0,
          parseFloat(row.mrp ?? row['MRP'] ?? sellingPrice) || sellingPrice
        );
        const gst = Math.max(
          0,
          parseFloat(row.gst_percentage ?? row['GST %'] ?? row['GST'] ?? 12) || 12
        );
        const stock = Math.max(
          0,
          parseInt(row.stock ?? row['Stock'] ?? row['Available Stock'] ?? 0, 10) || 0
        );
        const minStock = Math.max(
          0,
          parseInt(row.min_stock_level ?? row['Min Stock'] ?? 20, 10) || 20
        );

        // Match strictly by (name + batch_number) so different batches of the same medicine are never merged
        const existingRes = await tx.query(
          'SELECT * FROM products WHERE LOWER(name) = LOWER($1) AND LOWER(batch_number) = LOWER($2)',
          [name, batch]
        );
        if (existingRes.rows.length > 0) {
          const ex = existingRes.rows[0];
          await tx.query(
            `UPDATE products SET
              sku = $1, barcode = $2, hsn_code = $3, category = $4, manufacturer = $5,
              expiry_date = $6, pack_size = $7, rack_location = $8,
              purchase_price = $9, selling_price = $10, mrp = $11, gst_percentage = $12,
              stock = $13, min_stock_level = $14, updated_at = CURRENT_TIMESTAMP
             WHERE id = $15`,
            [
              sku,
              barcode,
              hsn,
              category,
              manufacturer,
              expiry,
              packSize,
              rack,
              purchasePrice,
              sellingPrice,
              mrp,
              gst,
              stock,
              minStock,
              ex.id,
            ]
          );
          if (stock !== Number(ex.stock)) {
            await tx.query(
              `INSERT INTO stock_movements (
                product_id, product_name, batch_number, movement_type, quantity_change,
                previous_stock, new_stock, unit_cost, reference_id, reason, performed_by
              ) VALUES ($1,$2,$3,'BULK_IMPORT_UPDATE',$4,$5,$6,$7,$8,'Bulk CSV/Excel Import',$9)`,
              [
                ex.id,
                name,
                batch,
                stock - Number(ex.stock),
                Number(ex.stock),
                stock,
                purchasePrice,
                sku,
                performer,
              ]
            );
          }
          updated++;
        } else {
          const ins = await tx.query(
            `INSERT INTO products (
              name, sku, barcode, hsn_code, category, manufacturer, batch_number,
              expiry_date, pack_size, rack_location, purchase_price, selling_price,
              mrp, gst_percentage, stock, min_stock_level
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
            [
              name,
              sku,
              barcode,
              hsn,
              category,
              manufacturer,
              batch,
              expiry,
              packSize,
              rack,
              purchasePrice,
              sellingPrice,
              mrp,
              gst,
              stock,
              minStock,
            ]
          );
          await tx.query(
            `INSERT INTO stock_movements (
              product_id, product_name, batch_number, movement_type, quantity_change,
              previous_stock, new_stock, unit_cost, reference_id, reason, performed_by
            ) VALUES ($1,$2,$3,'BULK_IMPORT_NEW',$4,0,$4,$5,$6,'Bulk CSV/Excel Import',$7)`,
            [ins.rows[0].id, name, batch, stock, purchasePrice, sku, performer]
          );
          inserted++;
        }
      }

      await tx.query(
        `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, performed_by)
         VALUES ('BULK_IMPORT', 'PRODUCT', 'BULK', $1, $2)`,
        [
          `Bulk imported medicine batches: ${inserted} new batches added, ${updated} existing batches updated`,
          performer,
        ]
      );
    });

    res.json({
      message: `Import successful: ${inserted} new batch(es) added, ${updated} updated.`,
      inserted,
      updated,
    });
  } catch (err) {
    console.error('Bulk import error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const productId = parseInt(req.params.id, 10);
    const oldRes = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
    if (oldRes.rows.length === 0) {
      return res.status(404).json({ error: 'Medicine batch not found.' });
    }
    const oldProd = oldRes.rows[0];
    await db.query('DELETE FROM products WHERE id = $1', [productId]);

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, old_values, performed_by)
       VALUES ('DELETE_PRODUCT', 'PRODUCT', $1, $2, $3, $4)`,
      [
        String(productId),
        `Deleted medicine batch "${oldProd.name}" (Batch: ${oldProd.batch_number})`,
        JSON.stringify(oldProd),
        req.user.fullName || req.user.username,
      ]
    );

    res.json({ message: 'Medicine batch deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. BILLING & INVOICES ROUTES
// ==========================================
app.get('/api/invoices/next-number', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const sRes = await db.query(
      'SELECT invoice_prefix, next_invoice_number FROM settings WHERE id = 1'
    );
    const s = sRes.rows[0] || { invoice_prefix: 'VP-', next_invoice_number: 1001 };
    res.json({
      invoiceNumber: `${s.invoice_prefix || 'VP-'}${s.next_invoice_number || 1001}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const { q, status, payment_method, from, to } = req.query;
    const invRes = await db.query('SELECT * FROM invoices ORDER BY created_at DESC');
    let invoices = invRes.rows;

    if (q && q.trim()) {
      const term = q.trim().toLowerCase();
      invoices = invoices.filter(
        (inv) =>
          inv.invoice_number.toLowerCase().includes(term) ||
          inv.customer_name.toLowerCase().includes(term) ||
          (inv.customer_phone && inv.customer_phone.toLowerCase().includes(term))
      );
    }

    if (status && status !== 'All') {
      invoices = invoices.filter((inv) => inv.payment_status === status);
    }

    if (payment_method && payment_method !== 'All') {
      invoices = invoices.filter((inv) => inv.payment_method === payment_method);
    }

    if (from) {
      const fromDate = new Date(`${from}T00:00:00`);
      invoices = invoices.filter((inv) => new Date(inv.created_at) >= fromDate);
    }

    if (to) {
      const toDate = new Date(`${to}T23:59:59.999`);
      invoices = invoices.filter((inv) => new Date(inv.created_at) <= toDate);
    }

    const allItemsRes = await db.query('SELECT * FROM invoice_items ORDER BY id ASC');
    const itemsByInvoice = {};
    for (const item of allItemsRes.rows) {
      if (!itemsByInvoice[item.invoice_id]) itemsByInvoice[item.invoice_id] = [];
      itemsByInvoice[item.invoice_id].push(item);
    }

    for (const inv of invoices) {
      inv.items = itemsByInvoice[inv.id] || [];
    }

    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const invRes = await db.query('SELECT * FROM invoices WHERE id = $1', [
      parseInt(req.params.id, 10),
    ]);
    if (invRes.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }
    const invoice = invRes.rows[0];
    const itemsRes = await db.query(
      'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id ASC',
      [invoice.id]
    );
    invoice.items = itemsRes.rows;
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Shared helper to process and save an invoice inside a DB transaction (used by both live billing and offline sync)
async function processInvoiceCreation(tx, payload, performer, isOfflineSync = false) {
  const {
    client_invoice_uid,
    invoice_number: requestedInvoiceNumber,
    customer_id,
    customer_name,
    customer_phone,
    customer_address,
    customer_gstin,
    customer_dl,
    doctor_name,
    items,
    discount_type,
    discount_value,
    enable_gst,
    tax_inclusive,
    payment_method,
    amount_paid,
    notes,
    created_at,
  } = payload;

  // 1. Idempotency check to prevent duplicate invoices during synchronization or double-click
  if (client_invoice_uid) {
    const existingByUid = await tx.query(
      'SELECT * FROM invoices WHERE client_invoice_uid = $1',
      [client_invoice_uid]
    );
    if (existingByUid.rows.length > 0) {
      const existingInv = existingByUid.rows[0];
      const existingItems = await tx.query(
        'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id ASC',
        [existingInv.id]
      );
      existingInv.items = existingItems.rows;
      existingInv._alreadySynced = true;
      return existingInv;
    }
  }

  const sRes = await tx.query('SELECT * FROM settings WHERE id = 1');
  const settings = sRes.rows[0];
  const prefix = settings.invoice_prefix || 'VP-';
  let nextNum = Number(settings.next_invoice_number || 1001);
  let invoiceNumber = requestedInvoiceNumber || `${prefix}${nextNum}`;

  const checkDup = await tx.query('SELECT id FROM invoices WHERE invoice_number = $1', [
    invoiceNumber,
  ]);
  if (checkDup.rows.length > 0) {
    invoiceNumber = `${prefix}${nextNum}-${Date.now().toString().slice(-4)}`;
  }

  let subtotal = 0;
  let totalItemTax = 0;
  let totalCost = 0;
  const preparedItems = [];

  const gstEnabled = enable_gst !== undefined ? Boolean(enable_gst) : Boolean(settings.enable_gst);
  const isTaxInclusive =
    tax_inclusive !== undefined ? Boolean(tax_inclusive) : Boolean(settings.tax_inclusive);

  for (const item of items) {
    const qty = parseInt(item.quantity, 10);
    if (!qty || qty <= 0) {
      throw new Error(`Invalid quantity for "${item.product_name || 'item'}".`);
    }

    // Try resolving product batch by id, client_uid, or (name + batch_number)
    let product = null;
    if (item.product_id && !String(item.product_id).startsWith('manual-') && !String(item.product_id).startsWith('offline-')) {
      const prodRes = await tx.query('SELECT * FROM products WHERE id = $1', [
        parseInt(item.product_id, 10),
      ]);
      if (prodRes.rows.length > 0) product = prodRes.rows[0];
    }
    if (!product && item.client_uid) {
      const prodRes = await tx.query('SELECT * FROM products WHERE client_uid = $1', [
        item.client_uid,
      ]);
      if (prodRes.rows.length > 0) product = prodRes.rows[0];
    }
    if (!product && item.product_name && item.batch_number) {
      const prodRes = await tx.query(
        'SELECT * FROM products WHERE LOWER(name) = LOWER($1) AND LOWER(batch_number) = LOWER($2)',
        [item.product_name.trim(), item.batch_number.trim()]
      );
      if (prodRes.rows.length > 0) product = prodRes.rows[0];
    }

    // Validate stock when online (for offline sync, clamp safely to 0 if needed so offline invoices are never lost)
    if (product) {
      if (!isOfflineSync && Number(product.stock) < qty) {
        throw new Error(
          `Insufficient stock for "${product.name}" (Batch: ${product.batch_number}). Available: ${product.stock}, Requested: ${qty}.`
        );
      }
    }

    const unitPrice = parseFloat(item.unit_price ?? product?.selling_price ?? 0);
    const purchasePrice = parseFloat(item.purchase_price ?? product?.purchase_price ?? 0);
    const mrp = parseFloat(item.mrp ?? product?.mrp ?? unitPrice);
    const itemDiscPct = Math.max(0, Math.min(100, parseFloat(item.item_discount_percent ?? 0)));
    const grossLine = unitPrice * qty;
    const itemDiscAmt = +(grossLine * (itemDiscPct / 100)).toFixed(2);
    const afterItemDisc = +(grossLine - itemDiscAmt).toFixed(2);

    const gstPct = gstEnabled
      ? parseFloat(item.gst_percentage ?? product?.gst_percentage ?? 12)
      : 0;
    let taxableAmount = afterItemDisc;
    let gstAmount = 0;
    let lineTotal = afterItemDisc;

    if (gstEnabled && gstPct > 0) {
      if (isTaxInclusive) {
        taxableAmount = +(afterItemDisc / (1 + gstPct / 100)).toFixed(2);
        gstAmount = +(afterItemDisc - taxableAmount).toFixed(2);
        lineTotal = afterItemDisc;
      } else {
        taxableAmount = afterItemDisc;
        gstAmount = +(taxableAmount * (gstPct / 100)).toFixed(2);
        lineTotal = +(taxableAmount + gstAmount).toFixed(2);
      }
    }

    subtotal += taxableAmount;
    totalItemTax += gstAmount;
    totalCost += purchasePrice * qty;

    preparedItems.push({
      product,
      product_name: (item.product_name || product?.name || 'Medicine').trim(),
      sku: (item.sku || product?.sku || '').trim(),
      hsn_code: (item.hsn_code || product?.hsn_code || '3004').trim(),
      batch_number: (item.batch_number || product?.batch_number || 'BATCH-1').trim(),
      expiry_date: (item.expiry_date || product?.expiry_date || '').trim(),
      pack_size: (item.pack_size || product?.pack_size || '').trim(),
      quantity: qty,
      purchase_price: purchasePrice,
      unit_price: unitPrice,
      mrp,
      item_discount_percent: itemDiscPct,
      item_discount_amount: itemDiscAmt,
      gst_percentage: gstPct,
      taxable_amount: taxableAmount,
      gst_amount: gstAmount,
      line_total: lineTotal,
    });
  }

  subtotal = +subtotal.toFixed(2);

  const discVal = Math.max(0, parseFloat(discount_value || 0));
  let billDiscountAmount = 0;
  if (discount_type === 'percent') {
    billDiscountAmount = +(subtotal * (Math.min(100, discVal) / 100)).toFixed(2);
  } else {
    billDiscountAmount = Math.min(subtotal, +discVal.toFixed(2));
  }

  const discountRatio = subtotal > 0 ? (subtotal - billDiscountAmount) / subtotal : 1;
  const finalTaxAmount = +(totalItemTax * discountRatio).toFixed(2);
  const exactTotal = +(subtotal - billDiscountAmount + finalTaxAmount).toFixed(2);
  const grandTotal = Math.round(exactTotal);
  const roundOff = +(grandTotal - exactTotal).toFixed(2);

  const netRevenueExTax = +(subtotal - billDiscountAmount).toFixed(2);
  const estimatedProfit = +(netRevenueExTax - totalCost).toFixed(2);

  // Customer name & phone are optional — never force registration
  let resolvedCustomerId =
    customer_id && !String(customer_id).startsWith('offline-')
      ? parseInt(customer_id, 10)
      : null;
  const custName = (customer_name || '').trim() || 'Walk-in Customer';
  const custPhone = (customer_phone || '').trim();
  const custAddress = (customer_address || '').trim();
  const custGstin = (customer_gstin || '').trim();
  const custDl = (customer_dl || '').trim();

  if (!resolvedCustomerId && custPhone && custName !== 'Walk-in Customer') {
    const existingCust = await tx.query('SELECT id FROM customers WHERE phone = $1', [custPhone]);
    if (existingCust.rows.length > 0) {
      resolvedCustomerId = existingCust.rows[0].id;
    } else {
      const newCust = await tx.query(
        `INSERT INTO customers (name, phone, address, gstin, dl_number)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [custName, custPhone, custAddress, custGstin, custDl]
      );
      resolvedCustomerId = newCust.rows[0].id;
    }
  }

  const paidAmt =
    amount_paid !== undefined && amount_paid !== '' && amount_paid !== null
      ? Math.max(0, parseFloat(amount_paid))
      : payment_method === 'Credit'
      ? 0
      : grandTotal;

  const balanceDue = Math.max(0, +(grandTotal - paidAmt).toFixed(2));
  let paymentStatus = 'Paid';
  if (balanceDue >= grandTotal && grandTotal > 0) {
    paymentStatus = 'Unpaid';
  } else if (balanceDue > 0) {
    paymentStatus = 'Partial';
  }

  const invInsert = await tx.query(
    `INSERT INTO invoices (
      client_invoice_uid, invoice_number, customer_id, customer_name, customer_phone, customer_address,
      customer_gstin, customer_dl, doctor_name, subtotal, discount_amount,
      discount_type, discount_value, tax_amount, round_off, grand_total,
      total_cost, estimated_profit, payment_method, payment_status,
      amount_paid, balance_due, notes, synced_from_offline, created_by, created_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
    ) RETURNING *`,
    [
      client_invoice_uid || null,
      invoiceNumber,
      resolvedCustomerId,
      custName,
      custPhone,
      custAddress,
      custGstin,
      custDl,
      (doctor_name || '').trim(),
      subtotal,
      billDiscountAmount,
      discount_type || 'amount',
      discVal,
      finalTaxAmount,
      roundOff,
      grandTotal,
      +totalCost.toFixed(2),
      estimatedProfit,
      payment_method || 'Cash',
      paymentStatus,
      paidAmt,
      balanceDue,
      (notes || '').trim(),
      Boolean(isOfflineSync),
      performer,
      created_at || new Date().toISOString(),
    ]
  );

  const savedInvoice = invInsert.rows[0];
  savedInvoice.items = [];

  for (const pi of preparedItems) {
    const itemIns = await tx.query(
      `INSERT INTO invoice_items (
        invoice_id, product_id, product_name, sku, hsn_code, batch_number,
        expiry_date, pack_size, quantity, purchase_price, unit_price, mrp,
        item_discount_percent, item_discount_amount, gst_percentage,
        taxable_amount, gst_amount, line_total
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      ) RETURNING *`,
      [
        savedInvoice.id,
        pi.product ? pi.product.id : null,
        pi.product_name,
        pi.sku,
        pi.hsn_code,
        pi.batch_number,
        pi.expiry_date,
        pi.pack_size,
        pi.quantity,
        pi.purchase_price,
        pi.unit_price,
        pi.mrp,
        pi.item_discount_percent,
        pi.item_discount_amount,
        pi.gst_percentage,
        pi.taxable_amount,
        pi.gst_amount,
        pi.line_total,
      ]
    );
    savedInvoice.items.push(itemIns.rows[0]);

    if (pi.product) {
      const freshProdRes = await tx.query('SELECT stock FROM products WHERE id = $1', [
        pi.product.id,
      ]);
      const prevStock = Number(freshProdRes.rows[0]?.stock ?? pi.product.stock);
      const newStock = Math.max(0, prevStock - pi.quantity);

      await tx.query(
        'UPDATE products SET stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newStock, pi.product.id]
      );

      await tx.query(
        `INSERT INTO stock_movements (
          product_id, product_name, batch_number, movement_type, quantity_change,
          previous_stock, new_stock, unit_cost, reference_id, reason, performed_by
        ) VALUES ($1,$2,$3,'SALE',$4,$5,$6,$7,$8,$9,$10)`,
        [
          pi.product.id,
          pi.product_name,
          pi.batch_number,
          -pi.quantity,
          prevStock,
          newStock,
          pi.unit_price,
          invoiceNumber,
          `Sold via Invoice ${invoiceNumber} to ${custName}${
            isOfflineSync ? ' (Offline Sync)' : ''
          }`,
          performer,
        ]
      );
    }
  }

  if (resolvedCustomerId) {
    await tx.query(
      `UPDATE customers SET
        total_purchases = total_purchases + $1,
        balance = balance + $2,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [grandTotal, balanceDue, resolvedCustomerId]
    );
  }

  if (!requestedInvoiceNumber) {
    await tx.query(
      'UPDATE settings SET next_invoice_number = next_invoice_number + 1 WHERE id = 1'
    );
  } else {
    // If an offline invoice had a numeric suffix >= next_invoice_number, bump next_invoice_number safely
    const numMatch = String(invoiceNumber).match(/(\d+)$/);
    if (numMatch) {
      const usedNum = parseInt(numMatch[1], 10);
      if (usedNum >= nextNum) {
        await tx.query('UPDATE settings SET next_invoice_number = $1 WHERE id = 1', [
          usedNum + 1,
        ]);
      }
    }
  }

  await tx.query(
    `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, performed_by)
     VALUES ($1, 'INVOICE', $2, $3, $4)`,
    [
      isOfflineSync ? 'SYNC_OFFLINE_INVOICE' : 'CREATE_INVOICE',
      invoiceNumber,
      `Generated Invoice ${invoiceNumber} for ${custName} — Grand Total: ₹${grandTotal} (${payment_method}, ${paymentStatus})`,
      performer,
    ]
  );

  return savedInvoice;
}

app.post('/api/invoices', authenticateToken, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Please add at least one medicine to generate a bill.' });
    }
    const db = await getDb();
    const performer = req.user.fullName || req.user.username;

    const createdInvoice = await db.transaction(async (tx) => {
      return await processInvoiceCreation(tx, req.body, performer, false);
    });

    res.status(201).json(createdInvoice);
  } catch (err) {
    console.error('Create invoice error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Update Invoice Date/Time, Customer Info, or Payment Status (supports previous days, months, and years)
app.put('/api/invoices/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const invId = parseInt(req.params.id, 10);
    const existingRes = await db.query('SELECT * FROM invoices WHERE id = $1', [invId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }
    const existing = existingRes.rows[0];
    const {
      invoice_number,
      customer_name,
      customer_phone,
      payment_method,
      payment_status,
      amount_paid,
      created_at,
      notes,
    } = req.body;

    const grandTotal = Number(existing.grand_total);
    const updatedPaid =
      amount_paid !== undefined && amount_paid !== ''
        ? Math.max(0, parseFloat(amount_paid))
        : payment_status === 'Paid'
        ? grandTotal
        : payment_status === 'Unpaid'
        ? 0
        : Number(existing.amount_paid);
    const updatedBalance = Math.max(0, +(grandTotal - updatedPaid).toFixed(2));
    const updatedStatus =
      payment_status ||
      (updatedBalance <= 0 ? 'Paid' : updatedPaid > 0 ? 'Partial' : 'Unpaid');

    const updRes = await db.query(
      `UPDATE invoices SET
        invoice_number = $1,
        customer_name = $2,
        customer_phone = $3,
        payment_method = $4,
        payment_status = $5,
        amount_paid = $6,
        balance_due = $7,
        created_at = $8,
        notes = $9
       WHERE id = $10 RETURNING *`,
      [
        (invoice_number || existing.invoice_number).trim(),
        (customer_name || existing.customer_name || 'Walk-in Customer').trim(),
        (customer_phone ?? existing.customer_phone ?? '').trim(),
        payment_method || existing.payment_method,
        updatedStatus,
        updatedPaid,
        updatedBalance,
        created_at ? new Date(created_at).toISOString() : existing.created_at,
        (notes ?? existing.notes ?? '').trim(),
        invId,
      ]
    );
    const updatedInv = updRes.rows[0];
    const itemsRes = await db.query(
      'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id ASC',
      [invId]
    );
    updatedInv.items = itemsRes.rows;
    res.json(updatedInv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/invoices/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const invId = parseInt(req.params.id, 10);
    await db.query('DELETE FROM invoices WHERE id = $1', [invId]);
    res.json({ message: 'Invoice deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 6. OFFLINE QUEUE SYNCHRONIZATION ENGINE
// ==========================================
app.post('/api/sync', authenticateToken, async (req, res) => {
  try {
    const { operations } = req.body;
    if (!Array.isArray(operations) || operations.length === 0) {
      return res.json({ syncedCount: 0, skippedDuplicates: 0, results: [] });
    }

    const db = await getDb();
    const performer = req.user.fullName || req.user.username;
    const results = [];
    let syncedCount = 0;
    let skippedDuplicates = 0;

    for (const op of operations) {
      try {
        await db.transaction(async (tx) => {
          if (op.type === 'CREATE_PRODUCT_BATCH') {
            const p = op.payload;
            const cleanName = (p.name || '').trim();
            const cleanBatch = (p.batch_number || '').trim();

            const existing = await tx.query(
              'SELECT * FROM products WHERE client_uid = $1 OR (LOWER(name) = LOWER($2) AND LOWER(batch_number) = LOWER($3))',
              [p.client_uid || `none-${Date.now()}`, cleanName, cleanBatch]
            );

            if (existing.rows.length > 0) {
              skippedDuplicates++;
              results.push({
                operation_id: op.operation_id,
                status: 'duplicate_skipped',
                entity: existing.rows[0],
              });
              return;
            }

            const ins = await tx.query(
              `INSERT INTO products (
                client_uid, name, sku, barcode, hsn_code, category, manufacturer, batch_number,
                expiry_date, pack_size, rack_location, purchase_price, selling_price,
                mrp, gst_percentage, stock, min_stock_level
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
              [
                p.client_uid || op.operation_id,
                cleanName,
                (p.sku || 'MED-OFFLINE').trim(),
                (p.barcode || '').trim(),
                (p.hsn_code || '3004').trim(),
                (p.category || 'Tablets').trim(),
                (p.manufacturer || '').trim(),
                cleanBatch,
                (p.expiry_date || '2028-12-31').trim(),
                (p.pack_size || '10 Tabs').trim(),
                (p.rack_location || '').trim(),
                parseFloat(p.purchase_price || 0),
                parseFloat(p.selling_price || 0),
                parseFloat(p.mrp || p.selling_price || 0),
                parseFloat(p.gst_percentage || 12),
                parseInt(p.stock ?? p.available_stock ?? 0, 10),
                parseInt(p.min_stock_level || 20, 10),
              ]
            );
            const created = ins.rows[0];

            await tx.query(
              `INSERT INTO stock_movements (
                client_operation_id, product_id, product_name, batch_number, movement_type, quantity_change,
                previous_stock, new_stock, unit_cost, reference_id, reason, performed_by
              ) VALUES ($1,$2,$3,$4,'OFFLINE_NEW_BATCH',$5,0,$5,$6,$7,'Synced offline new batch',$8)`,
              [
                op.operation_id,
                created.id,
                created.name,
                created.batch_number,
                Number(created.stock),
                Number(created.purchase_price),
                created.sku,
                performer,
              ]
            );

            syncedCount++;
            results.push({
              operation_id: op.operation_id,
              status: 'synced',
              entity: created,
            });
          } else if (op.type === 'UPDATE_PRODUCT_BATCH') {
            const p = op.payload;
            let targetRes = await tx.query('SELECT * FROM products WHERE id = $1', [
              parseInt(p.id, 10) || -1,
            ]);
            if (targetRes.rows.length === 0 && p.client_uid) {
              targetRes = await tx.query('SELECT * FROM products WHERE client_uid = $1', [
                p.client_uid,
              ]);
            }
            if (targetRes.rows.length === 0 && p.name && p.batch_number) {
              targetRes = await tx.query(
                'SELECT * FROM products WHERE LOWER(name) = LOWER($1) AND LOWER(batch_number) = LOWER($2)',
                [p.name.trim(), p.batch_number.trim()]
              );
            }
            if (targetRes.rows.length === 0) {
              throw new Error(`Target batch "${p.name}" (${p.batch_number}) not found for sync.`);
            }
            const current = targetRes.rows[0];

            // Apply relative stock delta if present so newer stock updates are never silently overwritten
            const prevStock = Number(current.stock);
            const stockDelta =
              p.stock_delta !== undefined
                ? parseInt(p.stock_delta, 10)
                : p.stock !== undefined
                ? parseInt(p.stock, 10) - prevStock
                : 0;
            const newStock = Math.max(0, prevStock + stockDelta);

            const upd = await tx.query(
              `UPDATE products SET
                name = $1, sku = $2, category = $3, manufacturer = $4,
                batch_number = $5, expiry_date = $6, pack_size = $7, rack_location = $8,
                purchase_price = $9, selling_price = $10, mrp = $11, gst_percentage = $12,
                stock = $13, min_stock_level = $14, updated_at = CURRENT_TIMESTAMP
               WHERE id = $15 RETURNING *`,
              [
                (p.name ?? current.name).trim(),
                (p.sku ?? current.sku).trim(),
                (p.category ?? current.category).trim(),
                (p.manufacturer ?? current.manufacturer).trim(),
                (p.batch_number ?? current.batch_number).trim(),
                (p.expiry_date ?? current.expiry_date).trim(),
                (p.pack_size ?? current.pack_size).trim(),
                (p.rack_location ?? current.rack_location).trim(),
                parseFloat(p.purchase_price ?? current.purchase_price),
                parseFloat(p.selling_price ?? current.selling_price),
                parseFloat(p.mrp ?? current.mrp),
                parseFloat(p.gst_percentage ?? current.gst_percentage),
                newStock,
                parseInt(p.min_stock_level ?? current.min_stock_level, 10),
                current.id,
              ]
            );

            if (stockDelta !== 0) {
              await tx.query(
                `INSERT INTO stock_movements (
                  client_operation_id, product_id, product_name, batch_number, movement_type, quantity_change,
                  previous_stock, new_stock, unit_cost, reference_id, reason, performed_by
                ) VALUES ($1,$2,$3,$4,'OFFLINE_EDIT_SYNC',$5,$6,$7,$8,$9,'Synced offline batch edit',$10)`,
                [
                  op.operation_id,
                  current.id,
                  upd.rows[0].name,
                  upd.rows[0].batch_number,
                  stockDelta,
                  prevStock,
                  newStock,
                  upd.rows[0].purchase_price,
                  upd.rows[0].sku,
                  performer,
                ]
              );
            }

            syncedCount++;
            results.push({
              operation_id: op.operation_id,
              status: 'synced',
              entity: upd.rows[0],
            });
          } else if (op.type === 'STOCK_ADJUSTMENT') {
            const p = op.payload;
            const dupCheck = await tx.query(
              'SELECT id FROM stock_movements WHERE client_operation_id = $1',
              [op.operation_id]
            );
            if (dupCheck.rows.length > 0) {
              skippedDuplicates++;
              results.push({ operation_id: op.operation_id, status: 'duplicate_skipped' });
              return;
            }

            let prodRes = await tx.query('SELECT * FROM products WHERE id = $1', [
              parseInt(p.product_id, 10) || -1,
            ]);
            if (prodRes.rows.length === 0 && p.product_name && p.batch_number) {
              prodRes = await tx.query(
                'SELECT * FROM products WHERE LOWER(name) = LOWER($1) AND LOWER(batch_number) = LOWER($2)',
                [p.product_name.trim(), p.batch_number.trim()]
              );
            }
            if (prodRes.rows.length === 0) {
              throw new Error('Batch not found for offline stock adjustment.');
            }
            const prod = prodRes.rows[0];
            const prevStock = Number(prod.stock);
            const qtyNum = parseInt(p.quantity, 10) || 0;
            let qtyChange = 0;
            let newStock = prevStock;

            if (p.quantity_change !== undefined) {
              qtyChange = parseInt(p.quantity_change, 10) || 0;
              newStock = Math.max(0, prevStock + qtyChange);
            } else if (p.movement_type === 'PURCHASE_RESTOCK' || p.movement_type === 'MANUAL_ADD') {
              qtyChange = qtyNum;
              newStock = prevStock + qtyNum;
            } else if (p.movement_type === 'MANUAL_DEDUCT' || p.movement_type === 'DAMAGE_EXPIRY') {
              qtyChange = -qtyNum;
              newStock = Math.max(0, prevStock - qtyNum);
            } else if (p.movement_type === 'SET_EXACT') {
              newStock = qtyNum;
              qtyChange = newStock - prevStock;
            }

            const updatedPurchasePrice =
              p.purchase_price !== undefined && p.purchase_price !== ''
                ? parseFloat(p.purchase_price)
                : Number(prod.purchase_price);
            const updatedSellingPrice =
              p.selling_price !== undefined && p.selling_price !== ''
                ? parseFloat(p.selling_price)
                : Number(prod.selling_price);
            const updatedMrp =
              p.mrp !== undefined && p.mrp !== '' ? parseFloat(p.mrp) : Number(prod.mrp);

            const upd = await tx.query(
              `UPDATE products SET
                stock = $1, purchase_price = $2, selling_price = $3, mrp = $4, updated_at = CURRENT_TIMESTAMP
               WHERE id = $5 RETURNING *`,
              [newStock, updatedPurchasePrice, updatedSellingPrice, updatedMrp, prod.id]
            );

            await tx.query(
              `INSERT INTO stock_movements (
                client_operation_id, product_id, product_name, batch_number, movement_type, quantity_change,
                previous_stock, new_stock, unit_cost, reference_id, reason, performed_by
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [
                op.operation_id,
                prod.id,
                prod.name,
                prod.batch_number,
                p.movement_type || (qtyChange >= 0 ? 'MANUAL_ADD' : 'MANUAL_DEDUCT'),
                qtyChange,
                prevStock,
                newStock,
                updatedPurchasePrice,
                p.reference_id || 'OFFLINE-SYNC',
                p.reason || 'Offline stock adjustment synced',
                performer,
              ]
            );

            syncedCount++;
            results.push({
              operation_id: op.operation_id,
              status: 'synced',
              entity: upd.rows[0],
            });
          } else if (op.type === 'CREATE_INVOICE') {
            const savedInv = await processInvoiceCreation(
              tx,
              {
                ...op.payload,
                client_invoice_uid: op.payload.client_invoice_uid || op.operation_id,
              },
              performer,
              true
            );
            if (savedInv._alreadySynced) {
              skippedDuplicates++;
              results.push({
                operation_id: op.operation_id,
                status: 'duplicate_skipped',
                entity: savedInv,
              });
            } else {
              syncedCount++;
              results.push({
                operation_id: op.operation_id,
                status: 'synced',
                entity: savedInv,
              });
            }
          }
        });
      } catch (opErr) {
        results.push({
          operation_id: op.operation_id,
          status: 'error',
          error: opErr.message,
        });
      }
    }

    res.json({
      syncedCount,
      skippedDuplicates,
      results,
    });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 7. CUSTOMERS & PAYMENTS ROUTES
// ==========================================
app.get('/api/customers', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const { q, filter } = req.query;
    const result = await db.query('SELECT * FROM customers ORDER BY name ASC');
    let customers = result.rows;

    if (q && q.trim()) {
      const term = q.trim().toLowerCase();
      customers = customers.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          (c.phone && c.phone.toLowerCase().includes(term)) ||
          (c.gstin && c.gstin.toLowerCase().includes(term)) ||
          (c.address && c.address.toLowerCase().includes(term))
      );
    }

    if (filter === 'pending') {
      customers = customers.filter((c) => Number(c.balance) > 0);
    }

    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customers/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const custId = parseInt(req.params.id, 10);
    const custRes = await db.query('SELECT * FROM customers WHERE id = $1', [custId]);
    if (custRes.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    const customer = custRes.rows[0];
    const invRes = await db.query(
      'SELECT * FROM invoices WHERE customer_id = $1 ORDER BY created_at DESC',
      [custId]
    );
    const invoices = invRes.rows;
    for (const inv of invoices) {
      const itemsRes = await db.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [
        inv.id,
      ]);
      inv.items = itemsRes.rows;
    }

    const payRes = await db.query(
      'SELECT * FROM customer_payments WHERE customer_id = $1 ORDER BY created_at DESC',
      [custId]
    );

    res.json({
      ...customer,
      invoices,
      payments: payRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/customers', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const { name, phone, email, address, gstin, dl_number, balance, notes } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Customer name is required.' });
    }
    const result = await db.query(
      `INSERT INTO customers (name, phone, email, address, gstin, dl_number, balance, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        name.trim(),
        (phone || '').trim(),
        (email || '').trim(),
        (address || '').trim(),
        (gstin || '').trim(),
        (dl_number || '').trim(),
        parseFloat(balance || 0),
        (notes || '').trim(),
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/customers/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const custId = parseInt(req.params.id, 10);
    const { name, phone, email, address, gstin, dl_number, balance, notes } = req.body;
    const oldRes = await db.query('SELECT * FROM customers WHERE id = $1', [custId]);
    if (oldRes.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    const oldC = oldRes.rows[0];
    const result = await db.query(
      `UPDATE customers SET
        name = $1, phone = $2, email = $3, address = $4, gstin = $5,
        dl_number = $6, balance = $7, notes = $8, updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 RETURNING *`,
      [
        (name ?? oldC.name).trim(),
        (phone ?? oldC.phone).trim(),
        (email ?? oldC.email).trim(),
        (address ?? oldC.address).trim(),
        (gstin ?? oldC.gstin).trim(),
        (dl_number ?? oldC.dl_number).trim(),
        parseFloat(balance ?? oldC.balance),
        (notes ?? oldC.notes).trim(),
        custId,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/customers/:id/payment', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const custId = parseInt(req.params.id, 10);
    const { amount, payment_method, invoice_id, reference_note } = req.body;
    const payAmt = parseFloat(amount);
    if (isNaN(payAmt) || payAmt <= 0) {
      return res.status(400).json({ error: 'Valid payment amount greater than 0 is required.' });
    }

    const updatedCustomer = await db.transaction(async (tx) => {
      const custRes = await tx.query('SELECT * FROM customers WHERE id = $1', [custId]);
      if (custRes.rows.length === 0) throw new Error('Customer not found.');
      const cust = custRes.rows[0];

      const newBalance = Math.max(0, +(Number(cust.balance) - payAmt).toFixed(2));
      await tx.query(
        'UPDATE customers SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newBalance, custId]
      );

      if (invoice_id) {
        const invRes = await tx.query('SELECT * FROM invoices WHERE id = $1', [
          parseInt(invoice_id, 10),
        ]);
        if (invRes.rows.length > 0) {
          const inv = invRes.rows[0];
          const newPaid = +(Number(inv.amount_paid) + payAmt).toFixed(2);
          const newDue = Math.max(0, +(Number(inv.grand_total) - newPaid).toFixed(2));
          const newStatus = newDue <= 0 ? 'Paid' : 'Partial';
          await tx.query(
            'UPDATE invoices SET amount_paid = $1, balance_due = $2, payment_status = $3 WHERE id = $4',
            [newPaid, newDue, newStatus, inv.id]
          );
        }
      } else {
        let remainingToApply = payAmt;
        const pendingInvoices = await tx.query(
          'SELECT * FROM invoices WHERE customer_id = $1 AND balance_due > 0 ORDER BY created_at ASC',
          [custId]
        );
        for (const inv of pendingInvoices.rows) {
          if (remainingToApply <= 0) break;
          const due = Number(inv.balance_due);
          const applyHere = Math.min(due, remainingToApply);
          const newPaid = +(Number(inv.amount_paid) + applyHere).toFixed(2);
          const newDue = +(due - applyHere).toFixed(2);
          const newStatus = newDue <= 0 ? 'Paid' : 'Partial';
          await tx.query(
            'UPDATE invoices SET amount_paid = $1, balance_due = $2, payment_status = $3 WHERE id = $4',
            [newPaid, newDue, newStatus, inv.id]
          );
          remainingToApply = +(remainingToApply - applyHere).toFixed(2);
        }
      }

      await tx.query(
        `INSERT INTO customer_payments (customer_id, invoice_id, amount, payment_method, reference_note)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          custId,
          invoice_id ? parseInt(invoice_id, 10) : null,
          payAmt,
          payment_method || 'Cash',
          reference_note || 'Balance payment received',
        ]
      );

      await tx.query(
        `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, performed_by)
         VALUES ('CUSTOMER_PAYMENT', 'CUSTOMER', $1, $2, $3)`,
        [
          String(custId),
          `Received ₹${payAmt} (${payment_method || 'Cash'}) from ${cust.name}. Balance: ₹${cust.balance} → ₹${newBalance}`,
          req.user.fullName || req.user.username,
        ]
      );

      const finalRes = await tx.query('SELECT * FROM customers WHERE id = $1', [custId]);
      return finalRes.rows[0];
    });

    res.json(updatedCustomer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// 8. INVENTORY MOVEMENTS & AUDIT LOGS
// ==========================================
app.get('/api/inventory/movements', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const { product_id, type } = req.query;
    const result = await db.query(
      'SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 500'
    );
    let movements = result.rows;
    if (product_id) {
      movements = movements.filter((m) => Number(m.product_id) === parseInt(product_id, 10));
    }
    if (type && type !== 'All') {
      movements = movements.filter((m) => m.movement_type === type);
    }
    res.json(movements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audit-logs', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 300');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 9. REPORTS & ANALYTICS ROUTE
// ==========================================
app.get('/api/reports', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const { from, to } = req.query;

    const invRes = await db.query('SELECT * FROM invoices ORDER BY created_at DESC');
    let invoices = invRes.rows;

    if (from) {
      const fromD = new Date(`${from}T00:00:00`);
      invoices = invoices.filter((i) => new Date(i.created_at) >= fromD);
    }
    if (to) {
      const toD = new Date(`${to}T23:59:59.999`);
      invoices = invoices.filter((i) => new Date(i.created_at) <= toD);
    }

    const invoiceIds = new Set(invoices.map((i) => i.id));
    const allItemsRes = await db.query('SELECT * FROM invoice_items');
    const filteredItems = allItemsRes.rows.filter((item) => invoiceIds.has(item.invoice_id));

    const totalSales = invoices.reduce((s, i) => s + Number(i.grand_total), 0);
    const totalTax = invoices.reduce((s, i) => s + Number(i.tax_amount), 0);
    const totalDiscount = invoices.reduce((s, i) => s + Number(i.discount_amount), 0);
    const totalCost = invoices.reduce((s, i) => s + Number(i.total_cost), 0);
    const totalProfit = invoices.reduce((s, i) => s + Number(i.estimated_profit), 0);
    const totalCollected = invoices.reduce((s, i) => s + Number(i.amount_paid), 0);
    const totalPending = invoices.reduce((s, i) => s + Number(i.balance_due), 0);

    const productSalesMap = {};
    for (const item of filteredItems) {
      const key = `${item.product_name}__${item.batch_number}`;
      if (!productSalesMap[key]) {
        productSalesMap[key] = {
          product_id: item.product_id,
          product_name: item.product_name,
          sku: item.sku,
          batch_number: item.batch_number,
          quantity_sold: 0,
          revenue: 0,
          tax_collected: 0,
          cost: 0,
          profit: 0,
        };
      }
      const entry = productSalesMap[key];
      const qty = Number(item.quantity);
      const cost = Number(item.purchase_price) * qty;
      const rev = Number(item.line_total);
      const taxable = Number(item.taxable_amount);
      entry.quantity_sold += qty;
      entry.revenue = +(entry.revenue + rev).toFixed(2);
      entry.tax_collected = +(entry.tax_collected + Number(item.gst_amount)).toFixed(2);
      entry.cost = +(entry.cost + cost).toFixed(2);
      entry.profit = +(entry.profit + (taxable - cost)).toFixed(2);
    }
    const productWiseSales = Object.values(productSalesMap).sort((a, b) => b.revenue - a.revenue);

    const paymentBreakdown = {};
    for (const inv of invoices) {
      const m = inv.payment_method || 'Cash';
      if (!paymentBreakdown[m]) {
        paymentBreakdown[m] = { method: m, count: 0, total: 0 };
      }
      paymentBreakdown[m].count += 1;
      paymentBreakdown[m].total = +(paymentBreakdown[m].total + Number(inv.grand_total)).toFixed(2);
    }

    const productsRes = await db.query('SELECT * FROM products ORDER BY name ASC, expiry_date ASC');
    const products = productsRes.rows;

    const customersRes = await db.query('SELECT * FROM customers ORDER BY total_purchases DESC');
    const customers = customersRes.rows;

    res.json({
      summary: {
        invoiceCount: invoices.length,
        totalSales: +totalSales.toFixed(2),
        totalTax: +totalTax.toFixed(2),
        totalDiscount: +totalDiscount.toFixed(2),
        totalCost: +totalCost.toFixed(2),
        totalProfit: +totalProfit.toFixed(2),
        totalCollected: +totalCollected.toFixed(2),
        totalPending: +totalPending.toFixed(2),
      },
      invoices,
      productWiseSales,
      paymentBreakdown: Object.values(paymentBreakdown),
      products,
      customers,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 10. DATABASE BACKUP & RESTORE ROUTES
// ==========================================
app.get('/api/backup', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const settings = (await db.query('SELECT * FROM settings')).rows;
    const products = (await db.query('SELECT * FROM products ORDER BY id ASC')).rows;
    const customers = (await db.query('SELECT * FROM customers ORDER BY id ASC')).rows;
    const invoices = (await db.query('SELECT * FROM invoices ORDER BY id ASC')).rows;
    const invoice_items = (await db.query('SELECT * FROM invoice_items ORDER BY id ASC')).rows;
    const stock_movements = (await db.query('SELECT * FROM stock_movements ORDER BY id ASC')).rows;
    const customer_payments = (await db.query('SELECT * FROM customer_payments ORDER BY id ASC'))
      .rows;
    const audit_logs = (await db.query('SELECT * FROM audit_logs ORDER BY id ASC')).rows;

    res.json({
      backupVersion: '2.0',
      exportedAt: new Date().toISOString(),
      business: settings[0]?.business_name || 'Vestas Pharmaceuticals',
      data: {
        settings,
        products,
        customers,
        invoices,
        invoice_items,
        stock_movements,
        customer_payments,
        audit_logs,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/restore', authenticateToken, async (req, res) => {
  try {
    const { data } = req.body;
    if (!data || !Array.isArray(data.products)) {
      return res.status(400).json({ error: 'Invalid backup file structure.' });
    }
    const db = await getDb();
    await db.transaction(async (tx) => {
      await tx.exec(`
        DELETE FROM invoice_items;
        DELETE FROM customer_payments;
        DELETE FROM stock_movements;
        DELETE FROM invoices;
        DELETE FROM customers;
        DELETE FROM products;
      `);

      for (const p of data.products || []) {
        await tx.query(
          `INSERT INTO products (
            id, client_uid, name, sku, barcode, hsn_code, category, manufacturer, batch_number,
            expiry_date, pack_size, rack_location, purchase_price, selling_price,
            mrp, gst_percentage, stock, min_stock_level
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            p.id,
            p.client_uid || null,
            p.name,
            p.sku,
            p.barcode || '',
            p.hsn_code || '3004',
            p.category || 'Tablets',
            p.manufacturer || '',
            p.batch_number,
            p.expiry_date,
            p.pack_size || '',
            p.rack_location || '',
            p.purchase_price,
            p.selling_price,
            p.mrp,
            p.gst_percentage,
            p.stock,
            p.min_stock_level || 20,
          ]
        );
      }

      for (const c of data.customers || []) {
        await tx.query(
          `INSERT INTO customers (
            id, name, phone, email, address, gstin, dl_number, balance, total_purchases, notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            c.id,
            c.name,
            c.phone || '',
            c.email || '',
            c.address || '',
            c.gstin || '',
            c.dl_number || '',
            c.balance || 0,
            c.total_purchases || 0,
            c.notes || '',
          ]
        );
      }

      for (const inv of data.invoices || []) {
        await tx.query(
          `INSERT INTO invoices (
            id, client_invoice_uid, invoice_number, customer_id, customer_name, customer_phone, customer_address,
            customer_gstin, customer_dl, doctor_name, subtotal, discount_amount,
            discount_type, discount_value, tax_amount, round_off, grand_total,
            total_cost, estimated_profit, payment_method, payment_status,
            amount_paid, balance_due, notes, synced_from_offline, created_by, created_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
          )`,
          [
            inv.id,
            inv.client_invoice_uid || null,
            inv.invoice_number,
            inv.customer_id,
            inv.customer_name,
            inv.customer_phone || '',
            inv.customer_address || '',
            inv.customer_gstin || '',
            inv.customer_dl || '',
            inv.doctor_name || '',
            inv.subtotal,
            inv.discount_amount,
            inv.discount_type || 'amount',
            inv.discount_value || 0,
            inv.tax_amount,
            inv.round_off || 0,
            inv.grand_total,
            inv.total_cost || 0,
            inv.estimated_profit || 0,
            inv.payment_method,
            inv.payment_status,
            inv.amount_paid,
            inv.balance_due,
            inv.notes || '',
            Boolean(inv.synced_from_offline),
            inv.created_by || 'Owner',
            inv.created_at || new Date().toISOString(),
          ]
        );
      }

      for (const item of data.invoice_items || []) {
        await tx.query(
          `INSERT INTO invoice_items (
            id, invoice_id, product_id, product_name, sku, hsn_code, batch_number,
            expiry_date, pack_size, quantity, purchase_price, unit_price, mrp,
            item_discount_percent, item_discount_amount, gst_percentage,
            taxable_amount, gst_amount, line_total
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
          )`,
          [
            item.id,
            item.invoice_id,
            item.product_id,
            item.product_name,
            item.sku || '',
            item.hsn_code || '3004',
            item.batch_number || '',
            item.expiry_date || '',
            item.pack_size || '',
            item.quantity,
            item.purchase_price || 0,
            item.unit_price,
            item.mrp || 0,
            item.item_discount_percent || 0,
            item.item_discount_amount || 0,
            item.gst_percentage || 12,
            item.taxable_amount || 0,
            item.gst_amount || 0,
            item.line_total,
          ]
        );
      }

      await tx.exec(`
        SELECT setval('products_id_seq', COALESCE((SELECT MAX(id) FROM products), 1));
        SELECT setval('customers_id_seq', COALESCE((SELECT MAX(id) FROM customers), 1));
        SELECT setval('invoices_id_seq', COALESCE((SELECT MAX(id) FROM invoices), 1));
        SELECT setval('invoice_items_id_seq', COALESCE((SELECT MAX(id) FROM invoice_items), 1));
      `);

      await tx.query(
        `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, performed_by)
         VALUES ('DATABASE_RESTORE', 'SYSTEM', '1', 'Restored database from backup file', $1)`,
        [req.user.fullName || req.user.username]
      );
    });

    res.json({ message: 'Database restored successfully from backup.' });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve production frontend build if accessed on port 4000 directly
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

export default app;
export { app };

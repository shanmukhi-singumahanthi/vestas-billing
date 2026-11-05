import pg from 'pg';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '..', 'data');
try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
} catch {
  // Read-only filesystem in serverless environments (e.g. Vercel)
}

let dbPromise = null;

/**
 * Unified PostgreSQL database interface.
 * Uses external PostgreSQL (Neon, Supabase, Render) if DATABASE_URL is set,
 * otherwise uses persistent on-disk PostgreSQL (PGlite) in ./data/pgdata.
 */
export async function getDb() {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    try {
      let dbInstance = null;

      const rawUrl = (process.env.DATABASE_URL || '').trim().replace(/^['"]|['"]$/g, '');

      if (rawUrl) {
        const isSsl = process.env.DATABASE_SSL !== 'false';
        const pool = new pg.Pool({
          connectionString: rawUrl,
          ssl: isSsl ? { rejectUnauthorized: false } : false,
          connectionTimeoutMillis: 15000, // Allow up to 15s for Neon compute to wake from suspended state
          idleTimeoutMillis: 30000,
          max: 10,
        });

        dbInstance = {
          query: (text, params) => pool.query(text, params),
          exec: (text) => pool.query(text),
          transaction: async (fn) => {
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              const result = await fn({
                query: (t, p) => client.query(t, p),
                exec: (t) => client.query(t),
              });
              await client.query('COMMIT');
              return result;
            } catch (err) {
              await client.query('ROLLBACK');
              throw err;
            } finally {
              client.release();
            }
          },
        };
      } else if (process.env.VERCEL) {
        throw new Error(
          'DATABASE_URL environment variable is missing on Vercel! In Vercel Project Settings > Environment Variables, add DATABASE_URL (your Neon connection string), then click Deployments > Redeploy.'
        );
      } else {
        const { PGlite } = await import('@electric-sql/pglite');
        const pgDataPath = path.join(dataDir, 'pgdata');
        const pglite = new PGlite(pgDataPath);
        await pglite.waitReady;

        dbInstance = {
          query: (text, params) => pglite.query(text, params),
          exec: (text) => pglite.exec(text),
          transaction: async (fn) => {
            return await pglite.transaction(async (tx) => {
              return await fn({
                query: (t, p) => tx.query(t, p),
                exec: (t) => tx.exec(t),
              });
            });
          },
        };
      }

      await initializeSchema(dbInstance);
      return dbInstance;
    } catch (err) {
      dbPromise = null;
      throw err;
    }
  })();

  return dbPromise;
}

async function initializeSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(150) NOT NULL,
      role VARCHAR(50) DEFAULT 'owner',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INT PRIMARY KEY DEFAULT 1,
      business_name VARCHAR(200) NOT NULL,
      owner_name VARCHAR(200) DEFAULT '',
      tagline VARCHAR(250) DEFAULT '',
      address TEXT DEFAULT '',
      phone VARCHAR(50) DEFAULT '',
      email VARCHAR(150) DEFAULT '',
      gstin VARCHAR(50) DEFAULT '',
      dl_no_1 VARCHAR(100) DEFAULT '',
      dl_no_2 VARCHAR(100) DEFAULT '',
      logo_url TEXT DEFAULT '',
      invoice_prefix VARCHAR(30) DEFAULT 'VP-',
      next_invoice_number INT DEFAULT 1001,
      default_invoice_format VARCHAR(20) DEFAULT 'A4',
      default_gst_rate NUMERIC(5,2) DEFAULT 12.00,
      enable_gst BOOLEAN DEFAULT TRUE,
      tax_inclusive BOOLEAN DEFAULT FALSE,
      currency_symbol VARCHAR(10) DEFAULT '₹',
      payment_methods JSONB DEFAULT '["Cash", "UPI", "Card", "Bank Transfer", "Credit"]',
      categories JSONB DEFAULT '["Tablets", "Capsules", "Syrups", "Injections", "Ointments", "Drops", "Surgical & Consumables", "General Healthcare"]',
      low_stock_threshold INT DEFAULT 20,
      printer_paper_size VARCHAR(20) DEFAULT 'A4',
      auto_print_after_save BOOLEAN DEFAULT FALSE,
      show_hsn_on_invoice BOOLEAN DEFAULT TRUE,
      show_batch_expiry_on_invoice BOOLEAN DEFAULT TRUE,
      show_mrp_on_invoice BOOLEAN DEFAULT TRUE,
      terms_and_conditions TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      client_uid VARCHAR(120) UNIQUE,
      name VARCHAR(250) NOT NULL,
      sku VARCHAR(100) NOT NULL,
      barcode VARCHAR(100) DEFAULT '',
      hsn_code VARCHAR(30) DEFAULT '3004',
      category VARCHAR(100) DEFAULT 'Tablets',
      manufacturer VARCHAR(200) DEFAULT '',
      batch_number VARCHAR(100) NOT NULL,
      expiry_date VARCHAR(20) NOT NULL,
      pack_size VARCHAR(80) DEFAULT '10 Tabs',
      rack_location VARCHAR(50) DEFAULT '',
      purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      selling_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      mrp NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      gst_percentage NUMERIC(5,2) NOT NULL DEFAULT 12.00,
      stock INT NOT NULL DEFAULT 0,
      min_stock_level INT NOT NULL DEFAULT 20,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      phone VARCHAR(50) DEFAULT '',
      email VARCHAR(150) DEFAULT '',
      address TEXT DEFAULT '',
      gstin VARCHAR(50) DEFAULT '',
      dl_number VARCHAR(100) DEFAULT '',
      balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      total_purchases NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      client_invoice_uid VARCHAR(120) UNIQUE,
      invoice_number VARCHAR(60) UNIQUE NOT NULL,
      customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
      customer_name VARCHAR(200) NOT NULL DEFAULT 'Walk-in Customer',
      customer_phone VARCHAR(50) DEFAULT '',
      customer_address TEXT DEFAULT '',
      customer_gstin VARCHAR(50) DEFAULT '',
      customer_dl VARCHAR(100) DEFAULT '',
      doctor_name VARCHAR(150) DEFAULT '',
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      discount_type VARCHAR(20) DEFAULT 'amount',
      discount_value NUMERIC(12,2) DEFAULT 0.00,
      tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      round_off NUMERIC(8,2) DEFAULT 0.00,
      grand_total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      total_cost NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      estimated_profit NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      payment_method VARCHAR(50) NOT NULL DEFAULT 'Cash',
      payment_status VARCHAR(30) NOT NULL DEFAULT 'Paid',
      amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      balance_due NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      notes TEXT DEFAULT '',
      synced_from_offline BOOLEAN DEFAULT FALSE,
      created_by VARCHAR(100) DEFAULT 'Owner',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id SERIAL PRIMARY KEY,
      invoice_id INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_id INT REFERENCES products(id) ON DELETE SET NULL,
      product_name VARCHAR(250) NOT NULL,
      sku VARCHAR(100) DEFAULT '',
      hsn_code VARCHAR(30) DEFAULT '3004',
      batch_number VARCHAR(100) DEFAULT '',
      expiry_date VARCHAR(20) DEFAULT '',
      pack_size VARCHAR(80) DEFAULT '',
      quantity INT NOT NULL,
      purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      unit_price NUMERIC(12,2) NOT NULL,
      mrp NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      item_discount_percent NUMERIC(5,2) DEFAULT 0.00,
      item_discount_amount NUMERIC(12,2) DEFAULT 0.00,
      gst_percentage NUMERIC(5,2) NOT NULL DEFAULT 12.00,
      taxable_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      gst_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      line_total NUMERIC(12,2) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id SERIAL PRIMARY KEY,
      client_operation_id VARCHAR(120) UNIQUE,
      product_id INT REFERENCES products(id) ON DELETE CASCADE,
      product_name VARCHAR(250) NOT NULL,
      batch_number VARCHAR(100) DEFAULT '',
      movement_type VARCHAR(50) NOT NULL,
      quantity_change INT NOT NULL,
      previous_stock INT NOT NULL,
      new_stock INT NOT NULL,
      unit_cost NUMERIC(12,2) DEFAULT 0.00,
      reference_id VARCHAR(100) DEFAULT '',
      reason TEXT DEFAULT '',
      performed_by VARCHAR(100) DEFAULT 'Owner',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customer_payments (
      id SERIAL PRIMARY KEY,
      customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      invoice_id INT REFERENCES invoices(id) ON DELETE SET NULL,
      amount NUMERIC(12,2) NOT NULL,
      payment_method VARCHAR(50) NOT NULL DEFAULT 'Cash',
      reference_note TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      action_type VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(100) DEFAULT '',
      description TEXT NOT NULL,
      old_values JSONB,
      new_values JSONB,
      performed_by VARCHAR(100) DEFAULT 'Owner',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Safe schema migrations for existing database
  await db.exec(`
    ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS client_uid VARCHAR(120);
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_invoice_uid VARCHAR(120);
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS synced_from_offline BOOLEAN DEFAULT FALSE;
    ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS client_operation_id VARCHAR(120);
  `);

  // Ensure Single Owner Account only (remove any non-owner accounts)
  await db.exec(`DELETE FROM users WHERE role != 'owner';`);
  const userCheck = await db.query('SELECT COUNT(*) as count FROM users');
  if (Number(userCheck.rows[0].count) === 0) {
    const ownerHash = await bcrypt.hash('vestas123', 10);
    await db.query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'owner')`,
      ['admin', ownerHash, 'S. Satyendranath (Proprietor)']
    );
  }

  // Seed default Vestas Pharmaceuticals settings if empty
  const settingsCheck = await db.query('SELECT COUNT(*) as count FROM settings');
  if (Number(settingsCheck.rows[0].count) === 0) {
    await db.query(
      `INSERT INTO settings (
        id, business_name, owner_name, tagline, address, phone, email, gstin, dl_no_1, dl_no_2,
        invoice_prefix, next_invoice_number, default_invoice_format, default_gst_rate,
        enable_gst, tax_inclusive, currency_symbol, low_stock_threshold, terms_and_conditions
      ) VALUES (
        1, $1, $2, $3, $4, $5, $6, $7, $8, $9,
        'VP-', 1001, 'A4', 12.00,
        TRUE, FALSE, '₹', 25, $10
      )`,
      [
        'VESTAS PHARMACEUTICALS',
        'S. SATYENDRANATH (Singumahanthi Satyendra Nath)',
        'Pharmaceutical Distributors, Wholesale & Retail Chemists',
        '27-18-92/A, 1st Floor, Ganesh Complex, Congress Office Road, Governorpet, Vijayawada, Andhra Pradesh - 520002',
        '9603033345',
        'ssatyendranth@gmail.com',
        '37BHCPS0456G1ZB',
        'AP/VJA/20B/104928',
        'AP/VJA/21B/104929',
        '1. Goods once sold will not be taken back or exchanged without valid invoice.\n2. Refrigerated & expiry medicines are strictly non-returnable.\n3. All disputes are subject to Vijayawada jurisdiction only.'
      ]
    );
  }

  // Ensure default customers exist
  const custCountRes = await db.query('SELECT COUNT(*) as count FROM customers');
  if (Number(custCountRes.rows[0].count) === 0) {
    const initialCustomers = [
      ['Sri Durga Medicals', '9848122334', 'sridurgamedicals@gmail.com', 'Besant Road, Governorpet, Vijayawada', '37AABCS1429B1Z1', 'AP/VJA/20B/88210', 0, 14200],
      ['Lakshmi Nursing Home Pharmacy', '9440199887', 'lakshminursing@gmail.com', 'Suryaraopet, Vijayawada', '37AADCL5512K1Z5', 'AP/VJA/20B/77412', 0, 28450],
      ['Ramesh Hospitals Pharmacy', '9866411223', 'pharmacy@rameshhospitals.com', 'MG Road, Vijayawada', '37AAACR4411M1Z8', 'AP/VJA/20B/99104', 0, 46900],
    ];
    for (const c of initialCustomers) {
      await db.query(
        `INSERT INTO customers (name, phone, email, address, gstin, dl_number, balance, total_purchases)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        c
      );
    }
  }

  // Check if we need to remove all old dummy medicines and load the official Vestas Pharmaceuticals catalog
  const checkRealVestas = await db.query(
    "SELECT id FROM products WHERE name IN ('TELVEST-40', 'Esvod-20', 'THIOFLEX 8', 'ZOLID-600')"
  );
  if (checkRealVestas.rows.length === 0) {
    await resetToOfficialVestasCatalog(db);
  }
}

/**
 * Completely resets and replaces all medicines and sample invoices with the official Vestas Pharmaceuticals price list
 */
export async function resetToOfficialVestasCatalog(db) {
  await db.transaction(async (tx) => {
    // 1. Delete all old dummy invoices, items, and products
    await tx.exec(`
      DELETE FROM invoice_items;
      DELETE FROM customer_payments;
      DELETE FROM stock_movements;
      DELETE FROM invoices;
      DELETE FROM products;
    `);

    // Reset sequences safely
    await tx.exec(`
      SELECT setval('products_id_seq', 1, false);
      SELECT setval('invoices_id_seq', 1, false);
      SELECT setval('invoice_items_id_seq', 1, false);
      SELECT setval('stock_movements_id_seq', 1, false);
    `);

    // 2. Insert all 13 official products from the Vestas Pharmaceuticals price card (items 15 to 27)
    // S.No | Medicine Name | MRP | Selling Rate | Purchase Rate | Pack Size
    const vestasProducts = [
      // Name, SKU, Barcode, HSN, Category, Manufacturer, Batch, Expiry, Pack Size, Rack, Purchase, Selling, MRP, GST%, Stock, MinStock
      ['Esvod-20', 'VP-ESV-20', '890123456015', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'ESV2401', '2027-12-31', '1*10', 'Rack A-1', 80.00, 89.00, 117.00, 12.00, 150, 20],
      ['OSTEOCAL-K2', 'VP-OST-K2', '890123456016', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'OST2402', '2027-11-30', '1*10', 'Rack A-2', 146.00, 163.00, 215.00, 12.00, 120, 20],
      ['PENSEN DSR', 'VP-PEN-DSR', '890123456017', '3004', 'Capsules', 'Vestas Pharmaceuticals', 'PDS2403', '2028-02-28', '1*10', 'Rack B-1', 103.00, 114.00, 150.00, 12.00, 180, 25],
      ['RADO-D', 'VP-RAD-D', '890123456018', '3004', 'Capsules', 'Vestas Pharmaceuticals', 'RAD2404', '2027-10-31', '1*10', 'Rack B-2', 76.00, 84.00, 110.00, 12.00, 140, 20],
      ['TELVEST-40', 'VP-TEL-40', '890123456019', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'TLV2405', '2028-01-31', '1*10', 'Rack C-1', 59.00, 65.00, 85.00, 12.00, 220, 30],
      ['THIOFLEX 8', 'VP-THF-8', '890123456020', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'THF2406', '2027-09-30', '1*10', 'Rack C-2', 188.00, 209.00, 275.00, 12.00, 110, 20],
      ['THIOFLEX-A4', 'VP-THF-A4', '890123456021', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'TFA2407', '2027-08-31', '1*10', 'Rack C-3', 127.00, 141.00, 185.00, 12.00, 130, 20],
      ['THIOFLEX GEL', 'VP-THF-GEL', '890123456022', '3004', 'Ointments', 'Vestas Pharmaceuticals', 'THG2408', '2027-07-31', '30GM', 'Rack D-1', 161.00, 179.00, 235.00, 12.00, 95, 15],
      ['TRACET', 'VP-TRC', '890123456023', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'TRC2409', '2028-03-31', '1*10', 'Rack A-3', 123.00, 137.00, 180.00, 12.00, 160, 25],
      ['TRIENZO', 'VP-TRZ', '890123456024', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'TRZ2410', '2027-12-31', '1*10', 'Rack A-4', 154.00, 171.00, 225.00, 12.00, 140, 20],
      ['TRIENZO-D', 'VP-TRZ-D', '890123456025', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'TZD2411', '2027-11-30', '1*10', 'Rack A-5', 154.00, 171.00, 225.00, 12.00, 150, 20],
      ['ZOLADIN-MR', 'VP-ZLD-MR', '890123456026', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'ZMR2412', '2028-04-30', '1*10', 'Rack B-3', 354.00, 394.00, 525.00, 12.00, 85, 15],
      ['ZOLID-600', 'VP-ZLD-600', '890123456027', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'Z602413', '2028-05-31', '1*10', 'Rack B-4', 253.00, 281.00, 370.00, 12.00, 105, 20],
    ];

    const prodIdMap = {};
    for (const p of vestasProducts) {
      const ins = await tx.query(
        `INSERT INTO products (
          name, sku, barcode, hsn_code, category, manufacturer, batch_number,
          expiry_date, pack_size, rack_location, purchase_price, selling_price,
          mrp, gst_percentage, stock, min_stock_level
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        p
      );
      prodIdMap[p[0]] = ins.rows[0].id;

      await tx.query(
        `INSERT INTO stock_movements (
          product_id, product_name, batch_number, movement_type, quantity_change,
          previous_stock, new_stock, unit_cost, reference_id, reason, performed_by
        ) VALUES ($1,$2,$3,'OPENING_STOCK',$4,0,$4,$5,'INIT-STOCK','Initial Stock Entry - Vestas Price List','S. Satyendranath (Proprietor)')`,
        [ins.rows[0].id, p[0], p[6], p[14], p[10]]
      );
    }

    // 3. Update settings next_invoice_number to 1004
    await tx.query("UPDATE settings SET next_invoice_number = 1004 WHERE id = 1");

    // 4. Seed clean, realistic invoices using exclusively these Vestas products across 2024, 2025, 2026
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    const makeIso = (year, monthIndex, day, hour = 11, min = 30) => {
      const dt = new Date(year, monthIndex, day, hour, min, 0);
      return dt.toISOString();
    };

    const historicalInvoices = [
      {
        invoice_number: 'VP-2024-001',
        customer_name: 'Sri Durga Medicals',
        customer_phone: '9848122334',
        customer_gstin: '37AABCS1429B1Z1',
        customer_dl: 'AP/VJA/20B/88210',
        payment_method: 'Bank Transfer',
        payment_status: 'Paid',
        created_at: makeIso(y - 2, 3, 14, 10, 45),
        items: [
          { name: 'TELVEST-40', sku: 'VP-TEL-40', batch: 'TLV2405', exp: '2028-01-31', pack: '1*10', qty: 20, purchase: 59.00, price: 65.00, mrp: 85.00, gst: 12 },
          { name: 'PENSEN DSR', sku: 'VP-PEN-DSR', batch: 'PDS2403', exp: '2028-02-28', pack: '1*10', qty: 15, purchase: 103.00, price: 114.00, mrp: 150.00, gst: 12 },
        ],
      },
      {
        invoice_number: 'VP-2024-002',
        customer_name: 'Lakshmi Nursing Home Pharmacy',
        customer_phone: '9440199887',
        customer_gstin: '37AADCL5512K1Z5',
        customer_dl: 'AP/VJA/20B/77412',
        payment_method: 'UPI',
        payment_status: 'Paid',
        created_at: makeIso(y - 2, 8, 22, 16, 15),
        items: [
          { name: 'THIOFLEX 8', sku: 'VP-THF-8', batch: 'THF2406', exp: '2027-09-30', pack: '1*10', qty: 12, purchase: 188.00, price: 209.00, mrp: 275.00, gst: 12 },
          { name: 'TRACET', sku: 'VP-TRC', batch: 'TRC2409', exp: '2028-03-31', pack: '1*10', qty: 15, purchase: 123.00, price: 137.00, mrp: 180.00, gst: 12 },
        ],
      },
      {
        invoice_number: 'VP-2025-001',
        customer_name: 'Ramesh Hospitals Pharmacy',
        customer_phone: '9866411223',
        customer_gstin: '37AAACR4411M1Z8',
        customer_dl: 'AP/VJA/20B/99104',
        payment_method: 'Bank Transfer',
        payment_status: 'Paid',
        created_at: makeIso(y - 1, 1, 18, 12, 20),
        items: [
          { name: 'ZOLID-600', sku: 'VP-ZLD-600', batch: 'Z602413', exp: '2028-05-31', pack: '1*10', qty: 10, purchase: 253.00, price: 281.00, mrp: 370.00, gst: 12 },
          { name: 'TRIENZO', sku: 'VP-TRZ', batch: 'TRZ2410', exp: '2027-12-31', pack: '1*10', qty: 10, purchase: 154.00, price: 171.00, mrp: 225.00, gst: 12 },
        ],
      },
      {
        invoice_number: 'VP-2025-002',
        customer_name: 'Vijayawada Care Clinic',
        customer_phone: '9000512345',
        customer_gstin: '',
        customer_dl: 'AP/VJA/20B/66320',
        payment_method: 'Card',
        payment_status: 'Paid',
        created_at: makeIso(y - 1, 6, 9, 18, 10),
        items: [
          { name: 'OSTEOCAL-K2', sku: 'VP-OST-K2', batch: 'OST2402', exp: '2027-11-30', pack: '1*10', qty: 8, purchase: 146.00, price: 163.00, mrp: 215.00, gst: 12 },
          { name: 'RADO-D', sku: 'VP-RAD-D', batch: 'RAD2404', exp: '2027-10-31', pack: '1*10', qty: 12, purchase: 76.00, price: 84.00, mrp: 110.00, gst: 12 },
        ],
      },
      {
        invoice_number: 'VP-2025-003',
        customer_name: 'Sri Sai Medicos',
        customer_phone: '9989077665',
        customer_gstin: '37ABFCS8821D1Z9',
        customer_dl: 'AP/VJA/20B/91002',
        payment_method: 'UPI',
        payment_status: 'Paid',
        created_at: makeIso(y - 1, 10, 27, 14, 50),
        items: [
          { name: 'THIOFLEX GEL', sku: 'VP-THF-GEL', batch: 'THG2408', exp: '2027-07-31', pack: '30GM', qty: 10, purchase: 161.00, price: 179.00, mrp: 235.00, gst: 12 },
          { name: 'THIOFLEX-A4', sku: 'VP-THF-A4', batch: 'TFA2407', exp: '2027-08-31', pack: '1*10', qty: 15, purchase: 127.00, price: 141.00, mrp: 185.00, gst: 12 },
        ],
      },
      {
        invoice_number: `VP-${y}-101`,
        customer_name: 'Governorpet Health Center',
        customer_phone: '9848055667',
        customer_gstin: '',
        customer_dl: '',
        payment_method: 'UPI',
        payment_status: 'Paid',
        created_at: makeIso(y, Math.max(0, m - 2), 11, 11, 15),
        items: [
          { name: 'Esvod-20', sku: 'VP-ESV-20', batch: 'ESV2401', exp: '2027-12-31', pack: '1*10', qty: 10, purchase: 80.00, price: 89.00, mrp: 117.00, gst: 12 },
          { name: 'TELVEST-40', sku: 'VP-TEL-40', batch: 'TLV2405', exp: '2028-01-31', pack: '1*10', qty: 25, purchase: 59.00, price: 65.00, mrp: 85.00, gst: 12 },
        ],
      },
      {
        invoice_number: `VP-${y}-102`,
        customer_name: 'Venkateswara Medical Hall',
        customer_phone: '9701233445',
        customer_gstin: '37AAECV1122P1Z2',
        customer_dl: 'AP/VJA/20B/44321',
        payment_method: 'Bank Transfer',
        payment_status: 'Paid',
        created_at: makeIso(y, Math.max(0, m - 1), 19, 15, 40),
        items: [
          { name: 'ZOLADIN-MR', sku: 'VP-ZLD-MR', batch: 'ZMR2412', exp: '2028-04-30', pack: '1*10', qty: 5, purchase: 354.00, price: 394.00, mrp: 525.00, gst: 12 },
          { name: 'PENSEN DSR', sku: 'VP-PEN-DSR', batch: 'PDS2403', exp: '2028-02-28', pack: '1*10', qty: 10, purchase: 103.00, price: 114.00, mrp: 150.00, gst: 12 },
        ],
      },
      {
        invoice_number: 'VP-1001',
        customer_name: 'P. Narasimha Rao (Walk-in)',
        customer_phone: '9885233110',
        customer_gstin: '',
        customer_dl: '',
        payment_method: 'Cash',
        payment_status: 'Paid',
        created_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        items: [
          { name: 'TRIENZO-D', sku: 'VP-TRZ-D', batch: 'TZD2411', exp: '2027-11-30', pack: '1*10', qty: 4, purchase: 154.00, price: 171.00, mrp: 225.00, gst: 12 },
          { name: 'RADO-D', sku: 'VP-RAD-D', batch: 'RAD2404', exp: '2027-10-31', pack: '1*10', qty: 6, purchase: 76.00, price: 84.00, mrp: 110.00, gst: 12 },
        ],
      },
      {
        invoice_number: 'VP-1002',
        customer_name: 'Annapurna Pharma Distributors',
        customer_phone: '9440566778',
        customer_gstin: '37AABCA7788E1Z4',
        customer_dl: 'AP/VJA/20B/55890',
        payment_method: 'UPI',
        payment_status: 'Paid',
        created_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        items: [
          { name: 'THIOFLEX 8', sku: 'VP-THF-8', batch: 'THF2406', exp: '2027-09-30', pack: '1*10', qty: 8, purchase: 188.00, price: 209.00, mrp: 275.00, gst: 12 },
          { name: 'TELVEST-40', sku: 'VP-TEL-40', batch: 'TLV2405', exp: '2028-01-31', pack: '1*10', qty: 15, purchase: 59.00, price: 65.00, mrp: 85.00, gst: 12 },
        ],
      },
      {
        invoice_number: 'VP-1003',
        customer_name: 'Walk-in Customer',
        customer_phone: '',
        customer_gstin: '',
        customer_dl: '',
        payment_method: 'Cash',
        payment_status: 'Paid',
        created_at: now.toISOString(),
        items: [
          { name: 'Esvod-20', sku: 'VP-ESV-20', batch: 'ESV2401', exp: '2027-12-31', pack: '1*10', qty: 2, purchase: 80.00, price: 89.00, mrp: 117.00, gst: 12 },
          { name: 'PENSEN DSR', sku: 'VP-PEN-DSR', batch: 'PDS2403', exp: '2028-02-28', pack: '1*10', qty: 2, purchase: 103.00, price: 114.00, mrp: 150.00, gst: 12 },
        ],
      },
    ];

    for (const inv of historicalInvoices) {
      let subtotal = 0;
      let taxAmount = 0;
      let totalCost = 0;
      const computedItems = inv.items.map((it) => {
        const taxable = +(it.price * it.qty).toFixed(2);
        const gstAmt = +(taxable * (it.gst / 100)).toFixed(2);
        const lineTotal = +(taxable + gstAmt).toFixed(2);
        subtotal += taxable;
        taxAmount += gstAmt;
        totalCost += it.purchase * it.qty;
        return { ...it, taxable, gstAmt, lineTotal };
      });
      subtotal = +subtotal.toFixed(2);
      taxAmount = +taxAmount.toFixed(2);
      const exactTotal = +(subtotal + taxAmount).toFixed(2);
      const grandTotal = Math.round(exactTotal);
      const roundOff = +(grandTotal - exactTotal).toFixed(2);
      const estProfit = +(subtotal - totalCost).toFixed(2);

      const insInv = await tx.query(
        `INSERT INTO invoices (
          client_invoice_uid, invoice_number, customer_name, customer_phone,
          customer_gstin, customer_dl, subtotal, discount_amount, tax_amount,
          round_off, grand_total, total_cost, estimated_profit, payment_method,
          payment_status, amount_paid, balance_due, created_by, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11,$12,$13,$14,$10,0,'S. Satyendranath (Proprietor)',$15)
        ON CONFLICT (invoice_number) DO NOTHING RETURNING id`,
        [
          `HIST-${inv.invoice_number}`,
          inv.invoice_number,
          inv.customer_name,
          inv.customer_phone,
          inv.customer_gstin,
          inv.customer_dl,
          subtotal,
          taxAmount,
          roundOff,
          grandTotal,
          +totalCost.toFixed(2),
          estProfit,
          inv.payment_method,
          inv.payment_status,
          inv.created_at,
        ]
      );

      if (insInv.rows.length > 0) {
        const invoiceId = insInv.rows[0].id;
        for (const ci of computedItems) {
          await tx.query(
            `INSERT INTO invoice_items (
              invoice_id, product_id, product_name, sku, hsn_code, batch_number, expiry_date,
              pack_size, quantity, purchase_price, unit_price, mrp,
              item_discount_percent, item_discount_amount, gst_percentage,
              taxable_amount, gst_amount, line_total
            ) VALUES ($1,$2,$3,$4,'3004',$5,$6,$7,$8,$9,$10,$11,0,0,$12,$13,$14,$15)`,
            [
              invoiceId,
              prodIdMap[ci.name] || null,
              ci.name,
              ci.sku,
              ci.batch,
              ci.exp,
              ci.pack,
              ci.qty,
              ci.purchase,
              ci.price,
              ci.mrp,
              ci.gst,
              ci.taxable,
              ci.gstAmt,
              ci.lineTotal,
            ]
          );
        }
      }
    }
  });
}

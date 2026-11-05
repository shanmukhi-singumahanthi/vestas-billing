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

      if (process.env.DATABASE_URL) {
        const isSsl = process.env.DATABASE_SSL !== 'false';
        const pool = new pg.Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: isSsl ? { rejectUnauthorized: false } : false,
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

  // Clean up automated test artifact rows if present
  await db.exec(`
    DELETE FROM invoices WHERE invoice_number LIKE 'VP-OFF-%';
    DELETE FROM products WHERE batch_number LIKE 'BATCH-MAN-%';
  `);

  // Seed initial medicines & customers if products table is empty (e.g., on fresh clone)
  const prodCountRes = await db.query('SELECT COUNT(*) as count FROM products');
  if (Number(prodCountRes.rows[0].count) === 0) {
    const initialProducts = [
      ['Dolo 650mg Tablet', 'MED-1001', '8901111001', '3004', 'Tablets', 'Micro Labs Ltd', 'DL2504A', '2027-11-30', '15 Tabs', 'Rack A-1', 21.5, 28.0, 33.6, 12.0, 240, 40],
      ['Dolo 650mg Tablet', 'MED-1001', '8901111001', '3004', 'Tablets', 'Micro Labs Ltd', 'DL2601B', '2028-04-30', '15 Tabs', 'Rack A-1', 22.0, 29.0, 34.5, 12.0, 120, 40],
      ['Augmentin 625 Duo Tablet', 'MED-1002', '8901111002', '3004', 'Tablets', 'GSK Pharmaceuticals', 'AUG-892B', '2027-08-31', '10 Tabs', 'Rack A-2', 142.0, 182.0, 204.5, 12.0, 95, 25],
      ['Pan-D Capsule PR', 'MED-1003', '8901111003', '3004', 'Capsules', 'Alkem Laboratories', 'PND-445', '2027-05-31', '15 Caps', 'Rack B-1', 135.0, 175.0, 210.0, 12.0, 110, 25],
      ['Azithral 500 Tablet', 'MED-1004', '8901111004', '3004', 'Tablets', 'Alembic Pharmaceuticals', 'AZT-209', '2027-06-30', '5 Tabs', 'Rack A-3', 84.0, 112.0, 132.5, 12.0, 80, 20],
      ['Telma 40 Tablet', 'MED-1005', '8901111005', '3004', 'Tablets', 'Glenmark Pharmaceuticals', 'TLM-772', '2027-10-31', '15 Tabs', 'Rack C-1', 165.0, 210.0, 245.0, 12.0, 140, 30],
      ['Monocef 1g Injection', 'MED-1006', '8901111006', '3004', 'Injections', 'Aristo Pharmaceuticals', 'MNC-109', '2027-02-28', '1 Vial', 'Rack D-1', 42.0, 58.0, 69.5, 12.0, 18, 25],
      ['Ascoril LS Syrup 100ml', 'MED-1007', '8901111007', '3004', 'Syrups', 'Glenmark Pharmaceuticals', 'ASC-331', '2027-04-30', '100 ml', 'Rack E-1', 85.0, 110.0, 129.0, 12.0, 65, 20],
      ['Glycomet-GP 2 Tablet PR', 'MED-1008', '8901111008', '3004', 'Tablets', 'USV Pvt Ltd', 'GLY-884', '2027-07-31', '15 Tabs', 'Rack C-2', 118.0, 154.0, 182.0, 12.0, 90, 25],
      ['Shelcal 500 Tablet', 'MED-1009', '8901111009', '3004', 'Tablets', 'Torrent Pharmaceuticals', 'SHL-512', '2027-09-30', '15 Tabs', 'Rack B-3', 92.0, 122.0, 144.0, 12.0, 15, 25],
    ];
    for (const p of initialProducts) {
      await db.query(
        `INSERT INTO products (
          name, sku, barcode, hsn_code, category, manufacturer, batch_number,
          expiry_date, pack_size, rack_location, purchase_price, selling_price,
          mrp, gst_percentage, stock, min_stock_level
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        p
      );
    }

    const initialCustomers = [
      ['Sri Durga Medicals', '9848122334', 'sridurgamedicals@gmail.com', 'Besant Road, Vijayawada', '37AABCS1429B1Z1', 'AP/VJA/20B/88210', 0, 14200],
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

  // Ensure comprehensive multi-year, multi-month, multi-day & up-to-date invoice history is available
  const histCheck = await db.query(
    "SELECT COUNT(*) as count FROM invoices WHERE invoice_number = 'VP-2024-001'"
  );
  if (Number(histCheck.rows[0].count) === 0) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();

    const makeIso = (year, monthIndex, day, hour = 11, min = 30) => {
      const dt = new Date(year, monthIndex, day, hour, min, 0);
      return dt.toISOString();
    };

    const historicalInvoices = [
      // Previous Years (2024 & 2025)
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
          { name: 'Augmentin 625 Duo Tablet', sku: 'MED-1002', batch: 'AUG-24A', exp: '2026-12-31', qty: 10, purchase: 142, price: 182, mrp: 204.5, gst: 12 },
          { name: 'Dolo 650mg Tablet', sku: 'MED-1001', batch: 'DL2401', exp: '2027-06-30', qty: 25, purchase: 21.5, price: 28, mrp: 33.6, gst: 12 },
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
          { name: 'Pan-D Capsule PR', sku: 'MED-1003', batch: 'PND-2409', exp: '2026-11-30', qty: 15, purchase: 135, price: 175, mrp: 210, gst: 12 },
          { name: 'Monocef 1g Injection', sku: 'MED-1006', batch: 'MNC-2408', exp: '2026-10-31', qty: 20, purchase: 42, price: 58, mrp: 69.5, gst: 12 },
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
          { name: 'Telma 40 Tablet', sku: 'MED-1005', batch: 'TLM-2501', exp: '2027-08-31', qty: 18, purchase: 165, price: 210, mrp: 245, gst: 12 },
          { name: 'Glycomet-GP 2 Tablet PR', sku: 'MED-1008', batch: 'GLY-2502', exp: '2027-05-31', qty: 12, purchase: 118, price: 154, mrp: 182, gst: 12 },
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
          { name: 'Azithral 500 Tablet', sku: 'MED-1004', batch: 'AZT-2506', exp: '2027-09-30', qty: 14, purchase: 84, price: 112, mrp: 132.5, gst: 12 },
          { name: 'Shelcal 500 Tablet', sku: 'MED-1009', batch: 'SHL-2505', exp: '2027-12-31', qty: 10, purchase: 92, price: 122, mrp: 144, gst: 12 },
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
          { name: 'Augmentin 625 Duo Tablet', sku: 'MED-1002', batch: 'AUG-892B', exp: '2027-08-31', qty: 8, purchase: 142, price: 182, mrp: 204.5, gst: 12 },
          { name: 'Ascoril LS Syrup 100ml', sku: 'MED-1007', batch: 'ASC-331', exp: '2027-04-30', qty: 15, purchase: 85, price: 110, mrp: 129, gst: 12 },
        ],
      },
      // Previous Months of Current Year
      {
        invoice_number: `VP-${y}-101`,
        customer_name: 'Governorpet Health Center',
        customer_phone: '9848055667',
        customer_gstin: '',
        customer_dl: '',
        payment_method: 'UPI',
        payment_status: 'Paid',
        created_at: makeIso(y, Math.max(0, m - 3), 11, 11, 15),
        items: [
          { name: 'Pan-D Capsule PR', sku: 'MED-1003', batch: 'PND-445', exp: '2027-05-31', qty: 6, purchase: 135, price: 175, mrp: 210, gst: 12 },
          { name: 'Dolo 650mg Tablet', sku: 'MED-1001', batch: 'DL2504A', exp: '2027-11-30', qty: 15, purchase: 21.5, price: 28, mrp: 33.6, gst: 12 },
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
        created_at: makeIso(y, Math.max(0, m - 2), 19, 15, 40),
        items: [
          { name: 'Telma 40 Tablet', sku: 'MED-1005', batch: 'TLM-772', exp: '2027-10-31', qty: 12, purchase: 165, price: 210, mrp: 245, gst: 12 },
          { name: 'Monocef 1g Injection', sku: 'MED-1006', batch: 'MNC-109', exp: '2027-02-28', qty: 15, purchase: 42, price: 58, mrp: 69.5, gst: 12 },
        ],
      },
      {
        invoice_number: `VP-${y}-103`,
        customer_name: 'K. Suryanarayana (Walk-in)',
        customer_phone: '9391044556',
        customer_gstin: '',
        customer_dl: '',
        payment_method: 'Cash',
        payment_status: 'Paid',
        created_at: makeIso(y, Math.max(0, m - 1), 16, 10, 30),
        items: [
          { name: 'Glycomet-GP 2 Tablet PR', sku: 'MED-1008', batch: 'GLY-884', exp: '2027-07-31', qty: 5, purchase: 118, price: 154, mrp: 182, gst: 12 },
          { name: 'Shelcal 500 Tablet', sku: 'MED-1009', batch: 'SHL-512', exp: '2027-09-30', qty: 4, purchase: 92, price: 122, mrp: 144, gst: 12 },
        ],
      },
      // Previous Days (4 days ago, 2 days ago, Yesterday)
      {
        invoice_number: 'VP-0998',
        customer_name: 'M. Rajyalakshmi',
        customer_phone: '9849123987',
        customer_gstin: '',
        customer_dl: '',
        payment_method: 'UPI',
        payment_status: 'Paid',
        created_at: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        items: [
          { name: 'Azithral 500 Tablet', sku: 'MED-1004', batch: 'AZT-209', exp: '2027-06-30', qty: 4, purchase: 84, price: 112, mrp: 132.5, gst: 12 },
          { name: 'Ascoril LS Syrup 100ml', sku: 'MED-1007', batch: 'ASC-331', exp: '2027-04-30', qty: 2, purchase: 85, price: 110, mrp: 129, gst: 12 },
        ],
      },
      {
        invoice_number: 'VP-0999',
        customer_name: 'Annapurna Pharma Distributors',
        customer_phone: '9440566778',
        customer_gstin: '37AABCA7788E1Z4',
        customer_dl: 'AP/VJA/20B/55890',
        payment_method: 'Card',
        payment_status: 'Paid',
        created_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        items: [
          { name: 'Augmentin 625 Duo Tablet', sku: 'MED-1002', batch: 'AUG-892B', exp: '2027-08-31', qty: 6, purchase: 142, price: 182, mrp: 204.5, gst: 12 },
          { name: 'Pan-D Capsule PR', sku: 'MED-1003', batch: 'PND-445', exp: '2027-05-31', qty: 5, purchase: 135, price: 175, mrp: 210, gst: 12 },
        ],
      },
      {
        invoice_number: 'VP-1000',
        customer_name: 'P. Narasimha Rao',
        customer_phone: '9885233110',
        customer_gstin: '',
        customer_dl: '',
        payment_method: 'Cash',
        payment_status: 'Paid',
        created_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        items: [
          { name: 'Telma 40 Tablet', sku: 'MED-1005', batch: 'TLM-772', exp: '2027-10-31', qty: 3, purchase: 165, price: 210, mrp: 245, gst: 12 },
          { name: 'Dolo 650mg Tablet', sku: 'MED-1001', batch: 'DL2504A', exp: '2027-11-30', qty: 5, purchase: 21.5, price: 28, mrp: 33.6, gst: 12 },
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

      const insInv = await db.query(
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
          await db.query(
            `INSERT INTO invoice_items (
              invoice_id, product_name, sku, hsn_code, batch_number, expiry_date,
              pack_size, quantity, purchase_price, unit_price, mrp,
              item_discount_percent, item_discount_amount, gst_percentage,
              taxable_amount, gst_amount, line_total
            ) VALUES ($1,$2,$3,'3004',$4,$5,'10 Tabs',$6,$7,$8,$9,0,0,$10,$11,$12,$13)`,
            [
              invoiceId,
              ci.name,
              ci.sku,
              ci.batch,
              ci.exp,
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
  }
}

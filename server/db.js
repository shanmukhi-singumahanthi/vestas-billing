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
        
        // Optimize for Neon / Serverless:
        // Neon compute suspends (sleeps) when idle. When waking up, connections need extra timeout
        // and background pool errors must be handled gracefully so the Node process doesn't crash.
        const pool = new pg.Pool({
          connectionString: rawUrl,
          ssl: isSsl ? { rejectUnauthorized: false } : false,
          connectionTimeoutMillis: 25000, // Allow up to 25s for Neon compute to wake from SUSPENDED state
          idleTimeoutMillis: 20000,
          max: process.env.VERCEL ? 3 : 10, // Keep pool small in serverless
        });

        // CRITICAL for Neon: When Neon suspends, it terminates idle connections.
        // Without an error handler on the pool, node-pg causes unhandled exceptions that crash the process.
        pool.on('error', (err) => {
          console.warn('[Neon/Postgres Pool] Handled idle connection drop (normal during Neon compute suspension):', err?.message || err);
        });

        // Helper to run queries with automatic retry for Neon wake-up
        const runWithRetry = async (fn, maxRetries = 3, delayMs = 1500) => {
          let lastErr = null;
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              return await fn();
            } catch (err) {
              lastErr = err;
              const msg = err?.message || String(err);
              const isNeonWaking = /timeout|Connection terminated|connection closed|ECONNRESET|ETIMEDOUT|57P01|57P03/i.test(msg);
              if (isNeonWaking && attempt < maxRetries) {
                console.log(`[Neon Wake-up] Database is unsuspending... attempt ${attempt}/${maxRetries} failed. Retrying in ${delayMs}ms...`);
                await new Promise((res) => setTimeout(res, delayMs * attempt));
                continue;
              }
              throw err;
            }
          }
          throw lastErr;
        };

        dbInstance = {
          query: (text, params) => runWithRetry(() => pool.query(text, params)),
          exec: (text) => runWithRetry(() => pool.query(text)),
          transaction: async (fn) => {
            return await runWithRetry(async () => {
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
                try {
                  await client.query('ROLLBACK');
                } catch {
                  // Client might be dead if connection dropped
                }
                throw err;
              } finally {
                client.release();
              }
            });
          },
        };
      } else if (process.env.VERCEL) {
        throw new Error(
          'DATABASE_URL environment variable is missing on Vercel! In Vercel Project Settings > Environment Variables, add DATABASE_URL (your Neon connection string), then click Deployments > Redeploy.'
        );
      } else {
        const { PGlite } = await import('@electric-sql/pglite');
        const pgDataPath = path.join(dataDir, 'pgdata');
        
        // Clean up stale postmaster.pid lock file if process was terminated abruptly
        try {
          const pidFile = path.join(pgDataPath, 'postmaster.pid');
          if (fs.existsSync(pidFile)) {
            fs.unlinkSync(pidFile);
          }
        } catch {
          // ignore
        }

        let pglite;
        try {
          pglite = new PGlite(pgDataPath);
          await pglite.waitReady;
        } catch (pgErr) {
          console.warn('PGlite on-disk load failed, falling back to in-memory store:', pgErr?.message || pgErr);
          pglite = new PGlite();
          await pglite.waitReady;
        }

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
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(50) DEFAULT 'Credit';
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transport VARCHAR(150) DEFAULT '';
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS lr_number VARCHAR(100) DEFAULT '';
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS lr_date VARCHAR(50) DEFAULT '';
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_units INT DEFAULT 0;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS free_quantity INT DEFAULT 0;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ptr NUMERIC(12,2) DEFAULT 0.00;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS mfg VARCHAR(100) DEFAULT '';
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cgst_percent NUMERIC(5,2) DEFAULT 0.00;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(12,2) DEFAULT 0.00;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS sgst_percent NUMERIC(5,2) DEFAULT 0.00;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(12,2) DEFAULT 0.00;
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

  // Seed / Sync official Vestas Pharmaceuticals settings matching the official printed bill
  const officialAddress = 'dr.no:28-1-64, 1st floor, elururoad, VIJAYAWADA';
  const officialPhone = '0866-3569652, 9603033345';
  const officialDl1 = '20B-AP/20/04/2024/4838';
  const officialDl2 = '21B-AP/20/04/2024/4838';
  const officialGstin = '37BHCPS0456G1ZB';
  const officialTerms = '1. The goods supplied in this invoice do not contravene section 18 of the drugs & cosmetics act 1940.\n2. Goods once sold will not be taken back or exchanged.\n3. Refrigerated & expiry medicines are strictly non-returnable.\n4. E.&O.E. All disputes subject to VIJAYAWADA Jurisdiction.';

  const settingsCheck = await db.query('SELECT COUNT(*) as count FROM settings');
  if (Number(settingsCheck.rows[0].count) === 0) {
    await db.query(
      `INSERT INTO settings (
        id, business_name, owner_name, tagline, address, phone, email, gstin, dl_no_1, dl_no_2,
        invoice_prefix, next_invoice_number, default_invoice_format, default_gst_rate,
        enable_gst, tax_inclusive, currency_symbol, low_stock_threshold, terms_and_conditions
      ) VALUES (
        1, $1, $2, $3, $4, $5, $6, $7, $8, $9,
        'DRV', 1001, 'A4', 12.00,
        TRUE, FALSE, '₹', 25, $10
      )`,
      [
        'VESTAS PHARMACEUTICALS',
        'S. SATYENDRANATH (Singumahanthi Satyendra Nath)',
        'Pharmaceutical Distributors, Wholesale & Retail Chemists',
        officialAddress,
        officialPhone,
        'ssatyendranth@gmail.com',
        officialGstin,
        officialDl1,
        officialDl2,
        officialTerms,
      ]
    );
  } else {
    // Keep settings synchronized with official bill details
    await db.query(
      `UPDATE settings SET
        address = $1,
        phone = $2,
        dl_no_1 = $3,
        dl_no_2 = $4,
        gstin = $5,
        terms_and_conditions = $6
      WHERE id = 1`,
      [officialAddress, officialPhone, officialDl1, officialDl2, officialGstin, officialTerms]
    );
  }

  // Clean state: ensure no dummy customers exist
  // Customers will be added directly by the owner for real clients/chemists

  // Seed the full 27 official Vestas catalog if not already populated
  const vestasCheck = await db.query(
    "SELECT COUNT(*) as count FROM products WHERE name IN ('BONEHEAL-D3', 'CAPIDOL', 'CEFSTAS inj', 'MOXIVEST-CV')"
  );

  if (Number(vestasCheck.rows[0].count) < 4) {
    await resetToOfficialVestasCatalog(db);
  }
}

/**
 * Completely resets and replaces all medicines with the complete 27 official Vestas Pharmaceuticals products.
 * Completely cleans all invoice data, customer & dues data, and resets financial analytics to a fresh start.
 */
export async function resetToOfficialVestasCatalog(db) {
  await db.transaction(async (tx) => {
    // 1. Delete all invoices, items, customer payments, customers, and old products
    await tx.exec(`
      DELETE FROM invoice_items;
      DELETE FROM customer_payments;
      DELETE FROM stock_movements;
      DELETE FROM invoices;
      DELETE FROM customers;
      DELETE FROM products;
    `);

    // Reset sequences safely
    await tx.exec(`
      SELECT setval('products_id_seq', 1, false);
      SELECT setval('customers_id_seq', 1, false);
      SELECT setval('invoices_id_seq', 1, false);
      SELECT setval('invoice_items_id_seq', 1, false);
      SELECT setval('customer_payments_id_seq', 1, false);
      SELECT setval('stock_movements_id_seq', 1, false);
    `);

    // 2. Insert all 27 official products from the Vestas Pharmaceuticals price cards (items 1 to 27)
    // S.No | Product Name | MRP | Selling Rate (PTR) | Purchase Rate (PTS) | Pack Size
    const vestasProducts = [
      // S.No 1: BONEHEAL-D3
      ['BONEHEAL-D3', 'VP-BNH-D3', '890123456001', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'BHD2401', '2028-06-30', '1*10', 'Rack A-1', 116.00, 129.00, 170.00, 12.00, 150, 20],
      // S.No 2: CAPIDOL
      ['CAPIDOL', 'VP-CPD', '890123456002', '3004', 'Ointments', 'Vestas Pharmaceuticals', 'CPD2402', '2027-12-31', '1*30GM', 'Rack D-1', 76.00, 84.00, 110.00, 12.00, 100, 15],
      // S.No 3: CEFSTAS inj
      ['CEFSTAS inj', 'VP-CFS-INJ', '890123456003', '3004', 'Injections', 'Vestas Pharmaceuticals', 'CFI2403', '2027-10-31', '1 VIAL', 'Rack E-1', 240.00, 267.00, 351.00, 12.00, 80, 15],
      // S.No 4: D3 ELITE NANO
      ['D3 ELITE NANO', 'VP-D3E-NNO', '890123456004', '3004', 'Drops', 'Vestas Pharmaceuticals', 'DEN2404', '2027-11-30', '1PACK', 'Rack A-2', 246.00, 274.00, 360.00, 12.00, 90, 15],
      // S.No 5: EBONE-OA
      ['EBONE-OA', 'VP-EBN-OA', '890123456005', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'EOA2405', '2028-03-31', '1*10', 'Rack A-3', 154.00, 171.00, 225.00, 12.00, 140, 20],
      // S.No 6: EXEDOL-P
      ['EXEDOL-P', 'VP-EXD-P', '890123456006', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'EDP2406', '2028-01-31', '1*10', 'Rack B-1', 58.00, 65.00, 85.00, 12.00, 200, 25],
      // S.No 7: EXEDOL -SP
      ['EXEDOL -SP', 'VP-EXD-SP', '890123456007', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'EDS2407', '2028-02-28', '1*10', 'Rack B-2', 100.00, 110.00, 145.00, 12.00, 180, 25],
      // S.No 8: FLUPIKEM-P
      ['FLUPIKEM-P', 'VP-FLP-P', '890123456008', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'FKP2408', '2027-09-30', '1*10', 'Rack B-3', 147.00, 163.00, 215.00, 12.00, 120, 20],
      // S.No 9: HYLAGEN-G
      ['HYLAGEN-G', 'VP-HLG-G', '890123456009', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'HLG2409', '2028-04-30', '1*10', 'Rack C-1', 274.00, 304.00, 400.00, 12.00, 80, 15],
      // S.No 10: JOCERIN-GM
      ['JOCERIN-GM', 'VP-JOC-GM', '890123456010', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'JGM2410', '2027-12-31', '1*10', 'Rack C-2', 144.00, 160.00, 210.00, 12.00, 110, 20],
      // S.No 11: KETROVEST-DT
      ['KETROVEST-DT', 'VP-KTV-DT', '890123456011', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'KDT2411', '2028-05-31', '1*10', 'Rack C-3', 85.00, 95.00, 125.00, 12.00, 150, 20],
      // S.No 12: LORNICAN-(P)
      ['LORNICAN-(P)', 'VP-LRN-P', '890123456012', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'LNP2412', '2027-11-30', '1*10', 'Rack C-4', 86.00, 95.00, 125.00, 12.00, 140, 20],
      // S.No 13: MOXIVEST-CV
      ['MOXIVEST-CV', 'VP-MXV-CV', '890123456013', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'MVC2413', '2028-06-30', '1*10', 'Rack A-4', 202.00, 224.00, 295.00, 12.00, 100, 20],
      // S.No 14: NUROVEST-NT
      ['NUROVEST-NT', 'VP-NRV-NT', '890123456014', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'NVT2414', '2028-04-30', '1*10', 'Rack A-5', 125.00, 139.00, 183.00, 12.00, 130, 20],
      // S.No 15: Esvod-20
      ['Esvod-20', 'VP-ESV-20', '890123456015', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'ESV2401', '2027-12-31', '1*10', 'Rack A-6', 80.00, 89.00, 117.00, 12.00, 150, 20],
      // S.No 16: OSTEOCAL-K2
      ['OSTEOCAL-K2', 'VP-OST-K2', '890123456016', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'OST2402', '2027-11-30', '1*10', 'Rack A-7', 146.00, 163.00, 215.00, 12.00, 120, 20],
      // S.No 17: PENSEN DSR
      ['PENSEN DSR', 'VP-PEN-DSR', '890123456017', '3004', 'Capsules', 'Vestas Pharmaceuticals', 'PDS2403', '2028-02-28', '1*10', 'Rack B-4', 103.00, 114.00, 150.00, 12.00, 180, 25],
      // S.No 18: RADO-D
      ['RADO-D', 'VP-RAD-D', '890123456018', '3004', 'Capsules', 'Vestas Pharmaceuticals', 'RAD2404', '2027-10-31', '1*10', 'Rack B-5', 76.00, 84.00, 110.00, 12.00, 140, 20],
      // S.No 19: TELVEST-40
      ['TELVEST-40', 'VP-TEL-40', '890123456019', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'TLV2405', '2028-01-31', '1*10', 'Rack C-5', 59.00, 65.00, 85.00, 12.00, 220, 30],
      // S.No 20: THIOFLEX 8
      ['THIOFLEX 8', 'VP-THF-8', '890123456020', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'THF2406', '2027-09-30', '1*10', 'Rack C-6', 188.00, 209.00, 275.00, 12.00, 110, 20],
      // S.No 21: THIOFLEX-A4
      ['THIOFLEX-A4', 'VP-THF-A4', '890123456021', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'TFA2407', '2027-08-31', '1*10', 'Rack C-7', 127.00, 141.00, 185.00, 12.00, 130, 20],
      // S.No 22: THIOFLEX GEL
      ['THIOFLEX GEL', 'VP-THF-GEL', '890123456022', '3004', 'Ointments', 'Vestas Pharmaceuticals', 'THG2408', '2027-07-31', '30GM', 'Rack D-2', 161.00, 179.00, 235.00, 12.00, 95, 15],
      // S.No 23: TRACET
      ['TRACET', 'VP-TRC', '890123456023', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'TRC2409', '2028-03-31', '1*10', 'Rack A-8', 123.00, 137.00, 180.00, 12.00, 160, 25],
      // S.No 24: TRIENZO
      ['TRIENZO', 'VP-TRZ', '890123456024', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'TRZ2410', '2027-12-31', '1*10', 'Rack A-9', 154.00, 171.00, 225.00, 12.00, 140, 20],
      // S.No 25: TRIENZO-D
      ['TRIENZO-D', 'VP-TRZ-D', '890123456025', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'TZD2411', '2027-11-30', '1*10', 'Rack A-10', 154.00, 171.00, 225.00, 12.00, 150, 20],
      // S.No 26: ZOLADIN-MR
      ['ZOLADIN-MR', 'VP-ZLD-MR', '890123456026', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'ZMR2412', '2028-04-30', '1*10', 'Rack B-6', 354.00, 394.00, 525.00, 12.00, 85, 15],
      // S.No 27: ZOLID-600
      ['ZOLID-600', 'VP-ZLD-600', '890123456027', '3004', 'Tablets', 'Vestas Pharmaceuticals', 'Z602413', '2028-05-31', '1*10', 'Rack B-7', 253.00, 281.00, 370.00, 12.00, 105, 20],
    ];

    for (const p of vestasProducts) {
      const ins = await tx.query(
        `INSERT INTO products (
          name, sku, barcode, hsn_code, category, manufacturer, batch_number,
          expiry_date, pack_size, rack_location, purchase_price, selling_price,
          mrp, gst_percentage, stock, min_stock_level
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        p
      );

      await tx.query(
        `INSERT INTO stock_movements (
          product_id, product_name, batch_number, movement_type, quantity_change,
          previous_stock, new_stock, unit_cost, reference_id, reason, performed_by
        ) VALUES ($1,$2,$3,'OPENING_STOCK',$4,0,$4,$5,'INIT-STOCK','Initial Stock Entry - Vestas Official Price List','S. Satyendranath (Proprietor)')`,
        [ins.rows[0].id, p[0], p[6], p[14], p[10]]
      );
    }

    // 3. Reset invoice counter to 1001 for clean fresh billing
    await tx.query("UPDATE settings SET next_invoice_number = 1001 WHERE id = 1");
  });
}

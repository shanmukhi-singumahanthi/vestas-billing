import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, resetToOfficialVestasCatalog } from './db.js';
import { scanBillImage, inwardBillItems } from './billScanner.js';

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

// Track latest required owner token version in memory for instant session invalidation after password reset
let minValidOwnerTokenVersion = 1;

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
    if (
      user?.role === 'owner' &&
      user?.tokenVersion &&
      Number(user.tokenVersion) < minValidOwnerTokenVersion
    ) {
      return res.status(401).json({
        error: 'Session invalidated after password change/reset. Please log in again.',
      });
    }
    req.user = user;
    next();
  });
}

// ==========================================
// ACCOUNT RECOVERY SECURITY HELPERS (HASHING, RATE LIMITING, EMAIL & SMS)
// ==========================================
const rateLimitStore = new Map();

function checkRateLimit(key, maxRequests = 5, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const entry = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs, lastRequestAt: 0 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  const prevRequestAt = entry.lastRequestAt;
  entry.lastRequestAt = now;
  rateLimitStore.set(key, entry);

  const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  return {
    allowed: entry.count <= maxRequests,
    remaining: Math.max(0, maxRequests - entry.count),
    retryAfterSec,
    secondsSinceLast: prevRequestAt ? Math.floor((now - prevRequestAt) / 1000) : 9999,
  };
}

function sha256Hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateSecureHexToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateSixDigitOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function normalizePhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  return digits;
}

function isEmailProviderConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY ||
      process.env.BREVO_API_KEY ||
      process.env.EMAIL_WEBHOOK_URL
  );
}

function isSmsProviderConfigured() {
  return Boolean(
    (process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER) ||
      process.env.FAST2SMS_API_KEY
  );
}

async function dispatchOwnerEmail({ to, subject, html, text }) {
  try {
    if (process.env.RESEND_API_KEY) {
      const fromAddr = process.env.EMAIL_FROM || 'Vestas Pharmaceuticals <onboarding@resend.dev>';
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: fromAddr, to: [to], subject, html, text }),
      });
      if (resp.ok) return { delivered: true, provider: 'resend' };
    }
    if (process.env.BREVO_API_KEY) {
      const senderEmail = process.env.EMAIL_FROM_ADDRESS || 'ssatyendranath@gmail.com';
      const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'Vestas Pharmaceuticals Security', email: senderEmail },
          to: [{ email: to }],
          subject,
          htmlContent: html,
          textContent: text,
        }),
      });
      if (resp.ok) return { delivered: true, provider: 'brevo' };
    }
    if (process.env.EMAIL_WEBHOOK_URL) {
      const resp = await fetch(process.env.EMAIL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, html, text }),
      });
      if (resp.ok) return { delivered: true, provider: 'webhook' };
    }
  } catch (err) {
    console.error('Email dispatch warning:', err.message);
  }
  return { delivered: false, provider: 'none' };
}

async function dispatchOwnerSms({ to, otp, message }) {
  const cleanDigits = normalizePhone(to);
  const e164 = cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`;
  try {
    if (
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
    ) {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const bodyParams = new URLSearchParams({
        To: e164,
        From: process.env.TWILIO_PHONE_NUMBER,
        Body: message,
      });
      const resp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: bodyParams.toString(),
        }
      );
      if (resp.ok) return { delivered: true, provider: 'twilio' };
    }
    if (process.env.FAST2SMS_API_KEY) {
      const resp = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          authorization: process.env.FAST2SMS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          route: 'q',
          message,
          language: 'english',
          flash: 0,
          numbers: cleanDigits,
        }),
      });
      if (resp.ok) return { delivered: true, provider: 'fast2sms' };
    }
  } catch (err) {
    console.error('SMS dispatch warning:', err.message);
  }
  return { delivered: false, provider: 'none', otpConfigured: isSmsProviderConfigured() };
}

export function requireOwner(req, res, next) {
  if (req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'Access denied: Proprietor / Owner authority required.' });
  }
  next();
}

// Health / Online Connectivity Ping
app.get('/api/ping', (req, res) => {
  res.json({ online: true, timestamp: new Date().toISOString() });
});

app.get('/api/health', async (req, res) => {
  try {
    const db = await getDb();
    await db.query('SELECT 1 as ok');
    res.json({
      status: 'ok',
      online: true,
      database: 'connected',
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      online: true,
      database: 'failed',
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Reset catalog to official Vestas Pharmaceuticals price list
app.post('/api/catalog/reset-official', authenticateToken, requireOwner, async (req, res) => {
  try {
    const db = await getDb();
    await resetToOfficialVestasCatalog(db);
    res.json({
      success: true,
      message: 'All 27 official Vestas Pharmaceuticals products (items 1-27) loaded successfully. All old dummy invoices, customer dues, and reports wiped clean.',
    });
  } catch (err) {
    console.error('Catalog reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Smart Bill Image OCR Scanner
app.post('/api/inventory/scan-bill-image', authenticateToken, async (req, res) => {
  try {
    const { image, apiKey } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: 'Image data (base64) is required.' });
    }
    const parsed = await scanBillImage(image, apiKey);
    res.json(parsed);
  } catch (err) {
    console.error('Scan bill error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Inward Scanned Bill & Update Stock Batch-wise
app.post('/api/inventory/inward-scanned-bill', authenticateToken, async (req, res) => {
  try {
    const { invoice_number, invoice_date, party, items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one medicine item is required to inward stock.' });
    }
    const db = await getDb();
    const result = await inwardBillItems(db, {
      invoice_number,
      invoice_date,
      party,
      items,
      performed_by: req.user.fullName || req.user.username || 'S. Satyendranath (Proprietor)',
    });
    res.json(result);
  } catch (err) {
    console.error('Inward bill error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 1. AUTHENTICATION & MULTI-ROLE ACCESS ROUTES (OWNER & WORKER)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const db = await getDb();
    const result = await db.query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
      [username.trim()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const userRole = user.role || 'worker';
    const tokenVersion = Number(user.token_version || 1);
    if (userRole === 'owner' && tokenVersion > minValidOwnerTokenVersion) {
      minValidOwnerTokenVersion = tokenVersion;
    }
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: userRole,
        tokenVersion,
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: userRole,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    const rawMsg = err?.message || (typeof err === 'string' ? err : 'Internal server error during login.');
    const isWaking = /timeout|Connection terminated|connection closed|ECONNRESET|ETIMEDOUT|suspended|57P01|57P03/i.test(rawMsg);
    const userMessage = isWaking
      ? 'Database was sleeping and is waking up (Neon serverless). Please wait 3 seconds and click Sign In again.'
      : rawMsg;
    res.status(500).json({
      error: userMessage,
      details: rawMsg,
      isWaking,
    });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.query(
      'SELECT id, username, full_name, role, token_version, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User account not found.' });
    }
    const u = result.rows[0];
    const currentVersion = Number(u.token_version || 1);
    if (u.role === 'owner' && currentVersion > minValidOwnerTokenVersion) {
      minValidOwnerTokenVersion = currentVersion;
    }
    if (req.user.tokenVersion && Number(req.user.tokenVersion) < currentVersion) {
      return res.status(401).json({
        error: 'Your session expired because the account password was changed or reset. Please sign in again.',
      });
    }
    res.json({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      role: u.role || 'worker',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Worker Management Routes (Owner Authority Only)
app.get('/api/users/workers', authenticateToken, requireOwner, async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.query(
      "SELECT id, username, full_name, role, created_at FROM users WHERE role = 'worker' ORDER BY id ASC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/workers', authenticateToken, requireOwner, async (req, res) => {
  try {
    const { username, password, full_name } = req.body || {};
    if (!username || !password || !full_name) {
      return res.status(400).json({ error: 'Staff username, password, and name are required.' });
    }
    const db = await getDb();
    const check = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
    if (check.rows.length > 0) {
      return res.status(400).json({ error: 'A user with this username already exists.' });
    }
    const hash = await bcrypt.hash(password.trim(), 10);
    const ins = await db.query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'worker') RETURNING id, username, full_name, role, created_at`,
      [username.trim(), hash, full_name.trim()]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/workers/:id', authenticateToken, requireOwner, async (req, res) => {
  try {
    const { password, full_name } = req.body || {};
    const db = await getDb();
    const targetId = parseInt(req.params.id, 10);
    if (password && password.trim()) {
      const hash = await bcrypt.hash(password.trim(), 10);
      await db.query("UPDATE users SET password_hash = $1 WHERE id = $2 AND role = 'worker'", [hash, targetId]);
    }
    if (full_name && full_name.trim()) {
      await db.query("UPDATE users SET full_name = $1 WHERE id = $2 AND role = 'worker'", [full_name.trim(), targetId]);
    }
    const updated = await db.query('SELECT id, username, full_name, role, created_at FROM users WHERE id = $1', [targetId]);
    res.json(updated.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/workers/:id', authenticateToken, requireOwner, async (req, res) => {
  try {
    const db = await getDb();
    const targetId = parseInt(req.params.id, 10);
    await db.query("DELETE FROM users WHERE id = $1 AND role = 'worker'", [targetId]);
    res.json({ success: true, message: 'Worker account deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User aliases for settings management
app.get('/api/users', authenticateToken, requireOwner, async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.query(
      "SELECT id, username, full_name, role, created_at FROM users WHERE role = 'worker' ORDER BY id ASC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', authenticateToken, requireOwner, async (req, res) => {
  try {
    const { username, password, full_name } = req.body || {};
    if (!username || !password || !full_name) {
      return res.status(400).json({ error: 'Staff username, password, and name are required.' });
    }
    const db = await getDb();
    const check = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
    if (check.rows.length > 0) {
      return res.status(400).json({ error: 'A user with this username already exists.' });
    }
    const hash = await bcrypt.hash(password.trim(), 10);
    const ins = await db.query(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'worker') RETURNING id, username, full_name, role, created_at`,
      [username.trim(), hash, full_name.trim()]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', authenticateToken, requireOwner, async (req, res) => {
  try {
    const db = await getDb();
    const targetId = parseInt(req.params.id, 10);
    await db.query("DELETE FROM users WHERE id = $1 AND role = 'worker'", [targetId]);
    res.json({ success: true, message: 'Staff worker account removed successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/password', authenticateToken, requireOwner, async (req, res) => {
  try {
    const { currentPassword, newPassword, newUsername, fullName } = req.body;
    const db = await getDb();
    const userRes = await db.query("SELECT * FROM users WHERE id = $1 AND role = 'owner'", [req.user.id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Owner account not found.' });
    }
    const user = userRes.rows[0];
    const valid = await bcrypt.compare(currentPassword || '', user.password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    if (newPassword && String(newPassword).trim().length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    const updatedUsername = (newUsername || user.username).trim();
    const updatedFullName = (fullName || user.full_name).trim();
    const isPasswordChanged = Boolean(newPassword && String(newPassword).trim());
    const updatedHash = isPasswordChanged
      ? await bcrypt.hash(String(newPassword).trim(), 10)
      : user.password_hash;
    const nextTokenVersion = isPasswordChanged
      ? Number(user.token_version || 1) + 1
      : Number(user.token_version || 1);

    await db.query(
      'UPDATE users SET username = $1, password_hash = $2, full_name = $3, token_version = $4 WHERE id = $5',
      [updatedUsername, updatedHash, updatedFullName, nextTokenVersion, user.id]
    );
    minValidOwnerTokenVersion = nextTokenVersion;

    const freshToken = jwt.sign(
      {
        id: user.id,
        username: updatedUsername,
        fullName: updatedFullName,
        role: 'owner',
        tokenVersion: nextTokenVersion,
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, performed_by)
       VALUES ('SECURITY_UPDATE', 'USER', $1, $2, $3)`,
      [
        String(user.id),
        `Updated owner credentials for ${updatedUsername}${isPasswordChanged ? ' (password changed & old sessions invalidated)' : ''}`,
        updatedFullName,
      ]
    );

    res.json({
      message: isPasswordChanged
        ? 'Owner password updated successfully. All other active sessions have been signed out.'
        : 'Owner security profile updated successfully.',
      token: freshToken,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 1B. OWNER ACCOUNT RECOVERY & VERIFICATION ROUTES (OWNER-ONLY)
// ==========================================

// Get Owner Account Security & Verification Settings
app.get('/api/auth/recovery-settings', authenticateToken, requireOwner, async (req, res) => {
  try {
    const db = await getDb();
    const [ownerRes, settingsRes] = await Promise.all([
      db.query("SELECT * FROM users WHERE role = 'owner' ORDER BY id ASC LIMIT 1"),
      db.query('SELECT email, phone FROM settings WHERE id = 1'),
    ]);
    if (ownerRes.rows.length === 0) {
      return res.status(404).json({ error: 'Owner account not found.' });
    }
    const owner = ownerRes.rows[0];
    const storeSettings = settingsRes.rows[0] || {};
    const recoveryEmail = owner.recovery_email || 'ssatyendranath@gmail.com';
    const recoveryPhone = owner.recovery_phone || '';

    res.json({
      id: owner.id,
      username: owner.username,
      fullName: owner.full_name,
      registeredBusinessEmail: storeSettings.email || 'ssatyendranath@gmail.com',
      recoveryEmail,
      emailVerified: Boolean(owner.email_verified),
      pendingEmail: owner.pending_email || '',
      recoveryPhone,
      phoneVerified: Boolean(owner.phone_verified),
      pendingPhone: owner.pending_phone || '',
      emailProviderConfigured: isEmailProviderConfigured(),
      smsProviderConfigured: isSmsProviderConfigured(),
      requiredSmsEnvVars: [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_PHONE_NUMBER',
        'or FAST2SMS_API_KEY',
      ],
      requiredEmailEnvVars: ['RESEND_API_KEY or BREVO_API_KEY'],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send Email Verification Link & 6-Digit Verification OTP to Owner Recovery Email
app.post(
  '/api/auth/recovery/email/send-verification',
  authenticateToken,
  requireOwner,
  async (req, res) => {
    try {
      const rawEmail = (req.body?.email || 'ssatyendranath@gmail.com').trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(rawEmail)) {
        return res.status(400).json({ error: 'Please enter a valid recovery email address.' });
      }

      const rl = checkRateLimit(`verify_email_owner_${req.user.id}`, 5, 15 * 60 * 1000);
      if (!rl.allowed) {
        return res.status(429).json({
          error: `Too many verification requests. Please wait ${rl.retryAfterSec} seconds before trying again.`,
        });
      }
      if (rl.secondsSinceLast < 30 && !req.body?.forceResend) {
        return res.status(429).json({
          error: `Please wait ${30 - rl.secondsSinceLast} seconds before requesting another verification email.`,
        });
      }

      const db = await getDb();
      const ownerRes = await db.query("SELECT * FROM users WHERE role = 'owner' ORDER BY id ASC LIMIT 1");
      if (ownerRes.rows.length === 0) {
        return res.status(404).json({ error: 'Owner account not found.' });
      }
      const owner = ownerRes.rows[0];

      // If changing to a different email, reset email_verified until verified
      const isDifferentEmail =
        (owner.recovery_email || '').toLowerCase() !== rawEmail.toLowerCase();
      await db.query(
        `UPDATE users SET
          recovery_email = $1,
          pending_email = $1,
          email_verified = CASE WHEN $2 THEN FALSE ELSE email_verified END
         WHERE id = $3`,
        [rawEmail, isDifferentEmail, owner.id]
      );

      // Invalidate previous unused EMAIL_VERIFY tokens
      await db.query(
        "UPDATE account_recovery_tokens SET used = TRUE WHERE user_id = $1 AND token_type = 'EMAIL_VERIFY' AND used = FALSE",
        [owner.id]
      );

      const linkToken = generateSecureHexToken(32);
      const otpCode = generateSixDigitOtp();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes

      await db.query(
        `INSERT INTO account_recovery_tokens (user_id, token_hash, token_type, target_value, expires_at)
         VALUES ($1, $2, 'EMAIL_VERIFY', $3, $4), ($1, $5, 'EMAIL_VERIFY', $3, $4)`,
        [owner.id, sha256Hash(linkToken), rawEmail, expiresAt, sha256Hash(otpCode)]
      );

      const origin =
        req.headers.origin ||
        (req.headers.host ? `${req.protocol || 'https'}://${req.headers.host}` : 'https://vestas-billing.vercel.app');
      const verificationLink = `${origin}/?verify_email_token=${linkToken}`;

      const dispatchResult = await dispatchOwnerEmail({
        to: rawEmail,
        subject: 'Verify Your Owner Recovery Email — Vestas Pharmaceuticals',
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
            <h2 style="color:#0f172a;margin-top:0;">Vestas Pharmaceuticals — Owner Account Security</h2>
            <p style="color:#334155;font-size:14px;">Click the secure link below or enter the 6-digit verification code in Settings &rarr; Account Security to verify <strong>${rawEmail}</strong> as your Owner Recovery Email:</p>
            <p style="margin:20px 0;"><a href="${verificationLink}" style="background:#0284c7;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold;display:inline-block;">Verify Recovery Email</a></p>
            <p style="color:#334155;font-size:14px;">Or enter verification OTP: <strong style="font-size:18px;letter-spacing:2px;color:#0f172a;">${otpCode}</strong></p>
            <p style="color:#64748b;font-size:12px;">This verification link and code expire in 30 minutes.</p>
          </div>
        `,
        text: `Vestas Pharmaceuticals Owner Recovery Email Verification\nVerify link: ${verificationLink}\nVerification Code: ${otpCode}\nExpires in 30 minutes.`,
      });

      await db.query(
        `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, performed_by)
         VALUES ('SEND_EMAIL_VERIFICATION', 'USER', $1, $2, $3)`,
        [
          String(owner.id),
          `Sent recovery email verification link to ${rawEmail}`,
          owner.full_name,
        ]
      );

      res.json({
        success: true,
        email: rawEmail,
        deliveredViaProvider: dispatchResult.delivered,
        provider: dispatchResult.provider,
        expiresAt,
        // Since the owner is already authenticated inside Owner Account Security Settings,
        // provide the verification link when external SMTP is not configured so the owner can verify immediately.
        verificationLink: !dispatchResult.delivered ? verificationLink : undefined,
        message: dispatchResult.delivered
          ? `Verification link and 6-digit code sent to ${rawEmail}.`
          : `Verification link generated for ${rawEmail}. Click the verification link below to complete email verification.`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Verify Owner Recovery Email via Verification Link Token or 6-Digit OTP
app.post('/api/auth/recovery/email/verify', async (req, res) => {
  try {
    const rawCode = String(req.body?.token || req.body?.otp || '').trim();
    if (!rawCode) {
      return res.status(400).json({ error: 'Verification token or 6-digit OTP is required.' });
    }

    const db = await getDb();
    const ownerRes = await db.query("SELECT * FROM users WHERE role = 'owner' ORDER BY id ASC LIMIT 1");
    if (ownerRes.rows.length === 0) {
      return res.status(404).json({ error: 'Owner account not found.' });
    }
    const owner = ownerRes.rows[0];

    const tokenHash = sha256Hash(rawCode);
    const tokenRes = await db.query(
      `SELECT * FROM account_recovery_tokens
       WHERE user_id = $1 AND token_type = 'EMAIL_VERIFY' AND used = FALSE
       ORDER BY created_at DESC`,
      [owner.id]
    );

    if (tokenRes.rows.length === 0) {
      return res.status(400).json({
        error: 'No active email verification request found. Please send a new verification link.',
      });
    }

    const matched = tokenRes.rows.find((r) => r.token_hash === tokenHash);
    if (!matched) {
      // Increment attempts on active verification tokens
      const latest = tokenRes.rows[0];
      const nextAttempts = Number(latest.attempts || 0) + 1;
      await db.query(
        'UPDATE account_recovery_tokens SET attempts = $1, used = CASE WHEN $1 >= 5 THEN TRUE ELSE used END WHERE id = $2',
        [nextAttempts, latest.id]
      );
      if (nextAttempts >= 5) {
        return res.status(429).json({
          error: 'Maximum verification attempts exceeded. Please request a new verification link.',
        });
      }
      return res.status(400).json({ error: 'Invalid verification link or OTP code.' });
    }

    if (new Date(matched.expires_at) < new Date()) {
      await db.query('UPDATE account_recovery_tokens SET used = TRUE WHERE id = $1', [matched.id]);
      return res.status(400).json({
        error: 'This verification link or code has expired. Please request a new one.',
      });
    }

    const verifiedEmail = matched.target_value || owner.recovery_email || 'ssatyendranath@gmail.com';
    await db.query(
      `UPDATE users SET recovery_email = $1, email_verified = TRUE, pending_email = '' WHERE id = $2`,
      [verifiedEmail, owner.id]
    );
    await db.query(
      "UPDATE account_recovery_tokens SET used = TRUE WHERE user_id = $1 AND token_type = 'EMAIL_VERIFY'",
      [owner.id]
    );

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, performed_by)
       VALUES ('EMAIL_VERIFIED', 'USER', $1, $2, $3)`,
      [
        String(owner.id),
        `Verified owner recovery email: ${verifiedEmail}`,
        owner.full_name,
      ]
    );

    res.json({
      success: true,
      recoveryEmail: verifiedEmail,
      emailVerified: true,
      message: `Owner recovery email (${verifiedEmail}) verified successfully. Email password recovery is now enabled.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send SMS OTP to Verify Owner Recovery Mobile Number
app.post(
  '/api/auth/recovery/phone/send-otp',
  authenticateToken,
  requireOwner,
  async (req, res) => {
    try {
      const cleanPhone = normalizePhone(req.body?.phone || '');
      if (cleanPhone.length < 10 || cleanPhone.length > 15) {
        return res.status(400).json({
          error: 'Please enter a valid 10-digit mobile number for SMS OTP verification.',
        });
      }

      const rl = checkRateLimit(`verify_phone_owner_${req.user.id}`, 5, 15 * 60 * 1000);
      if (!rl.allowed) {
        return res.status(429).json({
          error: `OTP rate limit reached. Please wait ${rl.retryAfterSec} seconds before requesting another OTP.`,
        });
      }
      if (rl.secondsSinceLast < 30 && !req.body?.forceResend) {
        return res.status(429).json({
          error: `Please wait ${30 - rl.secondsSinceLast} seconds before resending SMS OTP.`,
        });
      }

      const db = await getDb();
      const ownerRes = await db.query("SELECT * FROM users WHERE role = 'owner' ORDER BY id ASC LIMIT 1");
      if (ownerRes.rows.length === 0) {
        return res.status(404).json({ error: 'Owner account not found.' });
      }
      const owner = ownerRes.rows[0];

      const isDifferentPhone = normalizePhone(owner.recovery_phone) !== cleanPhone;
      await db.query(
        `UPDATE users SET
          recovery_phone = $1,
          pending_phone = $1,
          phone_verified = CASE WHEN $2 THEN FALSE ELSE phone_verified END
         WHERE id = $3`,
        [cleanPhone, isDifferentPhone, owner.id]
      );

      const smsConfigured = isSmsProviderConfigured();
      if (!smsConfigured && !req.body?.sandboxTest) {
        return res.status(400).json({
          error:
            'SMS provider is not configured on the server yet. Please configure Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER) or Fast2SMS (FAST2SMS_API_KEY) environment variables, or use Owner Verification Sandbox to test the OTP flow.',
          smsProviderConfigured: false,
          requiredEnvVars: [
            'TWILIO_ACCOUNT_SID',
            'TWILIO_AUTH_TOKEN',
            'TWILIO_PHONE_NUMBER',
            'or FAST2SMS_API_KEY',
          ],
        });
      }

      await db.query(
        "UPDATE account_recovery_tokens SET used = TRUE WHERE user_id = $1 AND token_type = 'PHONE_VERIFY' AND used = FALSE",
        [owner.id]
      );

      const otpCode = generateSixDigitOtp();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

      await db.query(
        `INSERT INTO account_recovery_tokens (user_id, token_hash, token_type, target_value, expires_at)
         VALUES ($1, $2, 'PHONE_VERIFY', $3, $4)`,
        [owner.id, sha256Hash(otpCode), cleanPhone, expiresAt]
      );

      const smsResult = await dispatchOwnerSms({
        to: cleanPhone,
        otp: otpCode,
        message: `Vestas Pharmaceuticals Owner Security: Your mobile verification OTP is ${otpCode}. Valid for 5 minutes. Do not share this code.`,
      });

      res.json({
        success: true,
        phone: cleanPhone,
        deliveredViaSms: smsResult.delivered,
        smsProviderConfigured: smsConfigured,
        expiresAt,
        sandboxOtp: !smsResult.delivered && req.body?.sandboxTest ? otpCode : undefined,
        message: smsResult.delivered
          ? `6-digit SMS OTP sent to +91 ${cleanPhone}. Valid for 5 minutes.`
          : `Sandbox verification OTP generated for +91 ${cleanPhone} (valid for 5 minutes).`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Verify Owner Recovery Mobile Number with 6-Digit SMS OTP
app.post(
  '/api/auth/recovery/phone/verify-otp',
  authenticateToken,
  requireOwner,
  async (req, res) => {
    try {
      const rawOtp = String(req.body?.otp || '').trim();
      if (!/^\d{6}$/.test(rawOtp)) {
        return res.status(400).json({ error: 'Please enter a valid 6-digit OTP.' });
      }

      const db = await getDb();
      const ownerRes = await db.query("SELECT * FROM users WHERE role = 'owner' ORDER BY id ASC LIMIT 1");
      if (ownerRes.rows.length === 0) {
        return res.status(404).json({ error: 'Owner account not found.' });
      }
      const owner = ownerRes.rows[0];

      const tokenRes = await db.query(
        `SELECT * FROM account_recovery_tokens
         WHERE user_id = $1 AND token_type = 'PHONE_VERIFY' AND used = FALSE
         ORDER BY created_at DESC LIMIT 1`,
        [owner.id]
      );

      if (tokenRes.rows.length === 0) {
        return res.status(400).json({
          error: 'No active mobile OTP request found. Please request a new OTP.',
        });
      }

      const tokenRow = tokenRes.rows[0];
      if (new Date(tokenRow.expires_at) < new Date()) {
        await db.query('UPDATE account_recovery_tokens SET used = TRUE WHERE id = $1', [
          tokenRow.id,
        ]);
        return res.status(400).json({
          error: 'This OTP has expired (5-minute limit). Please request a new OTP.',
        });
      }

      if (Number(tokenRow.attempts || 0) >= 5) {
        await db.query('UPDATE account_recovery_tokens SET used = TRUE WHERE id = $1', [
          tokenRow.id,
        ]);
        return res.status(429).json({
          error: 'Maximum OTP verification attempts (5) exceeded. Please request a new OTP.',
        });
      }

      if (tokenRow.token_hash !== sha256Hash(rawOtp)) {
        const nextAttempts = Number(tokenRow.attempts || 0) + 1;
        await db.query(
          'UPDATE account_recovery_tokens SET attempts = $1, used = CASE WHEN $1 >= 5 THEN TRUE ELSE used END WHERE id = $2',
          [nextAttempts, tokenRow.id]
        );
        return res.status(400).json({
          error: `Incorrect OTP code. ${Math.max(0, 5 - nextAttempts)} attempt(s) remaining.`,
        });
      }

      const verifiedPhone = tokenRow.target_value || owner.recovery_phone;
      await db.query(
        `UPDATE users SET recovery_phone = $1, phone_verified = TRUE, pending_phone = '' WHERE id = $2`,
        [verifiedPhone, owner.id]
      );
      await db.query('UPDATE account_recovery_tokens SET used = TRUE WHERE id = $1', [tokenRow.id]);

      await db.query(
        `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, performed_by)
         VALUES ('PHONE_VERIFIED', 'USER', $1, $2, $3)`,
        [
          String(owner.id),
          `Verified owner recovery mobile number: ${verifiedPhone}`,
          owner.full_name,
        ]
      );

      res.json({
        success: true,
        recoveryPhone: verifiedPhone,
        phoneVerified: true,
        message: `Mobile number (+91 ${verifiedPhone}) verified successfully. Mobile OTP password recovery is now enabled.`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ==========================================
// 1C. PUBLIC FORGOT PASSWORD & OWNER ACCOUNT RECOVERY ROUTES
// ==========================================

// A. Request Password Reset Link via Verified Recovery Email (Owner-Only, No Enumeration)
app.post('/api/auth/forgot-password/email', async (req, res) => {
  try {
    const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const clientIp =
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';
    const rl = checkRateLimit(`forgot_email_${clientIp}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return res.status(429).json({
        error: `Too many password reset requests. Please try again in ${rl.retryAfterSec} seconds.`,
      });
    }

    const db = await getDb();
    const ownerRes = await db.query("SELECT * FROM users WHERE role = 'owner' ORDER BY id ASC LIMIT 1");
    const owner = ownerRes.rows[0];

    const genericSafeResponse = {
      success: true,
      message:
        'If this email address is registered and verified for the owner account, a secure password reset link (valid for 15 minutes) has been sent.',
    };

    // Only issue a reset token if it matches the single owner account AND the owner's email is verified
    if (
      !owner ||
      !owner.email_verified ||
      !owner.recovery_email ||
      owner.recovery_email.trim().toLowerCase() !== cleanEmail
    ) {
      return res.json(genericSafeResponse);
    }

    // Check 60-second resend cooldown for active email reset token
    const recentRes = await db.query(
      `SELECT created_at FROM account_recovery_tokens
       WHERE user_id = $1 AND token_type = 'PASSWORD_RESET_EMAIL' AND used = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [owner.id]
    );
    if (recentRes.rows.length > 0) {
      const elapsedSec = Math.floor(
        (Date.now() - new Date(recentRes.rows[0].created_at).getTime()) / 1000
      );
      if (elapsedSec < 30 && !req.body?.forceResend) {
        return res.json(genericSafeResponse);
      }
    }

    // Invalidate all previous unused PASSWORD_RESET_EMAIL tokens
    await db.query(
      "UPDATE account_recovery_tokens SET used = TRUE WHERE user_id = $1 AND token_type = 'PASSWORD_RESET_EMAIL' AND used = FALSE",
      [owner.id]
    );

    const rawResetToken = generateSecureHexToken(32);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

    await db.query(
      `INSERT INTO account_recovery_tokens (user_id, token_hash, token_type, target_value, expires_at)
       VALUES ($1, $2, 'PASSWORD_RESET_EMAIL', $3, $4)`,
      [owner.id, sha256Hash(rawResetToken), cleanEmail, expiresAt]
    );

    const origin =
      req.headers.origin ||
      (req.headers.host ? `${req.protocol || 'https'}://${req.headers.host}` : 'https://vestas-billing.vercel.app');
    const resetLink = `${origin}/?reset_token=${rawResetToken}`;

    await dispatchOwnerEmail({
      to: cleanEmail,
      subject: 'Password Reset Request — Vestas Pharmaceuticals Owner Account',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
          <h2 style="color:#0f172a;margin-top:0;">Vestas Pharmaceuticals — Password Reset</h2>
          <p style="color:#334155;font-size:14px;">A password reset was requested for your Proprietor / Owner account (<strong>@${owner.username}</strong>).</p>
          <p style="margin:20px 0;"><a href="${resetLink}" style="background:#0284c7;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold;display:inline-block;">Reset Owner Password</a></p>
          <p style="color:#64748b;font-size:12px;">This single-use link expires in 15 minutes. If you did not request this, you can safely ignore this email.</p>
        </div>
      `,
      text: `Vestas Pharmaceuticals Owner Password Reset\nClick to reset your password (expires in 15 minutes): ${resetLink}`,
    });

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, performed_by)
       VALUES ('PASSWORD_RESET_REQUESTED', 'USER', $1, $2, $3)`,
      [
        String(owner.id),
        `Password reset link requested via verified recovery email (${cleanEmail})`,
        'Owner Recovery Flow',
      ]
    );

    return res.json(genericSafeResponse);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate a Password Reset Token before showing the New Password form
app.get('/api/auth/forgot-password/validate-token', async (req, res) => {
  try {
    const rawToken = String(req.query?.token || '').trim();
    if (!rawToken) {
      return res.status(400).json({ valid: false, error: 'Reset token is missing.' });
    }

    const db = await getDb();
    const tokenHash = sha256Hash(rawToken);
    const result = await db.query(
      `SELECT t.*, u.username, u.role
       FROM account_recovery_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1
         AND t.token_type IN ('PASSWORD_RESET_EMAIL', 'PASSWORD_RESET_SESSION')
         AND u.role = 'owner'
       LIMIT 1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        valid: false,
        error: 'This password reset link is invalid.',
      });
    }

    const tokenRow = result.rows[0];
    if (tokenRow.used) {
      return res.status(400).json({
        valid: false,
        error: 'This password reset link has already been used.',
      });
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      await db.query('UPDATE account_recovery_tokens SET used = TRUE WHERE id = $1', [tokenRow.id]);
      return res.status(400).json({
        valid: false,
        error: 'This password reset link has expired. Please request a new reset link.',
      });
    }

    res.json({
      valid: true,
      expiresAt: tokenRow.expires_at,
    });
  } catch (err) {
    res.status(500).json({ valid: false, error: err.message });
  }
});

// B1. Request Password Reset OTP via Verified Mobile Number (Owner-Only, No Enumeration)
app.post('/api/auth/forgot-password/mobile/send-otp', async (req, res) => {
  try {
    const cleanPhone = normalizePhone(req.body?.phone || '');
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }

    const clientIp =
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';
    const rl = checkRateLimit(`forgot_sms_${clientIp}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return res.status(429).json({
        error: `Too many OTP requests. Please wait ${rl.retryAfterSec} seconds before trying again.`,
      });
    }
    if (rl.secondsSinceLast < 60 && !req.body?.forceResend) {
      return res.status(429).json({
        error: `Please wait ${60 - rl.secondsSinceLast} seconds before requesting another OTP.`,
        cooldownRemainingSec: 60 - rl.secondsSinceLast,
      });
    }

    if (!isSmsProviderConfigured() && !req.body?.sandboxTest) {
      return res.status(400).json({
        error:
          'SMS OTP delivery requires an SMS provider (Twilio or Fast2SMS) to be configured in server environment variables. Please use Email Recovery or configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER (or FAST2SMS_API_KEY).',
        smsProviderConfigured: false,
      });
    }

    const db = await getDb();
    const ownerRes = await db.query("SELECT * FROM users WHERE role = 'owner' ORDER BY id ASC LIMIT 1");
    const owner = ownerRes.rows[0];

    const genericSafeResponse = {
      success: true,
      cooldownSeconds: 60,
      message:
        'If this mobile number is registered and verified for the owner account, a 6-digit SMS OTP (valid for 5 minutes) has been sent.',
    };

    if (
      !owner ||
      !owner.phone_verified ||
      !owner.recovery_phone ||
      normalizePhone(owner.recovery_phone) !== cleanPhone
    ) {
      return res.json(genericSafeResponse);
    }

    await db.query(
      "UPDATE account_recovery_tokens SET used = TRUE WHERE user_id = $1 AND token_type = 'PASSWORD_RESET_SMS' AND used = FALSE",
      [owner.id]
    );

    const otpCode = generateSixDigitOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

    await db.query(
      `INSERT INTO account_recovery_tokens (user_id, token_hash, token_type, target_value, expires_at)
       VALUES ($1, $2, 'PASSWORD_RESET_SMS', $3, $4)`,
      [owner.id, sha256Hash(otpCode), cleanPhone, expiresAt]
    );

    await dispatchOwnerSms({
      to: cleanPhone,
      otp: otpCode,
      message: `Vestas Pharmaceuticals Owner Password Reset OTP: ${otpCode}. Valid for 5 minutes. Do not share this code with anyone.`,
    });

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, performed_by)
       VALUES ('SMS_RESET_OTP_REQUESTED', 'USER', $1, $2, $3)`,
      [
        String(owner.id),
        'Password reset SMS OTP requested for verified owner mobile number',
        'Owner Recovery Flow',
      ]
    );

    return res.json(genericSafeResponse);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// B2. Verify Mobile Password Reset OTP on the Server & Issue Single-Use Reset Token
app.post('/api/auth/forgot-password/mobile/verify-otp', async (req, res) => {
  try {
    const cleanPhone = normalizePhone(req.body?.phone || '');
    const rawOtp = String(req.body?.otp || '').trim();
    if (!cleanPhone || !/^\d{6}$/.test(rawOtp)) {
      return res.status(400).json({ error: 'Valid mobile number and 6-digit OTP are required.' });
    }

    const clientIp =
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';
    const rl = checkRateLimit(`verify_forgot_sms_${clientIp}`, 10, 15 * 60 * 1000);
    if (!rl.allowed) {
      return res.status(429).json({
        error: `Too many OTP verification attempts. Please try again in ${rl.retryAfterSec} seconds.`,
      });
    }

    const db = await getDb();
    const ownerRes = await db.query("SELECT * FROM users WHERE role = 'owner' ORDER BY id ASC LIMIT 1");
    const owner = ownerRes.rows[0];

    if (
      !owner ||
      !owner.phone_verified ||
      !owner.recovery_phone ||
      normalizePhone(owner.recovery_phone) !== cleanPhone
    ) {
      return res.status(400).json({ error: 'Invalid or expired OTP code.' });
    }

    const tokenRes = await db.query(
      `SELECT * FROM account_recovery_tokens
       WHERE user_id = $1 AND token_type = 'PASSWORD_RESET_SMS' AND used = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [owner.id]
    );

    if (tokenRes.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired OTP code.' });
    }

    const tokenRow = tokenRes.rows[0];
    if (new Date(tokenRow.expires_at) < new Date()) {
      await db.query('UPDATE account_recovery_tokens SET used = TRUE WHERE id = $1', [tokenRow.id]);
      return res.status(400).json({
        error: 'This OTP has expired (5-minute limit). Please request a new OTP.',
      });
    }

    if (Number(tokenRow.attempts || 0) >= 5) {
      await db.query('UPDATE account_recovery_tokens SET used = TRUE WHERE id = $1', [tokenRow.id]);
      return res.status(429).json({
        error: 'Maximum OTP attempts exceeded. Please request a new OTP.',
      });
    }

    if (tokenRow.token_hash !== sha256Hash(rawOtp)) {
      const nextAttempts = Number(tokenRow.attempts || 0) + 1;
      await db.query(
        'UPDATE account_recovery_tokens SET attempts = $1, used = CASE WHEN $1 >= 5 THEN TRUE ELSE used END WHERE id = $2',
        [nextAttempts, tokenRow.id]
      );
      if (nextAttempts >= 5) {
        return res.status(429).json({
          error: 'Maximum OTP attempts exceeded. Please request a new OTP.',
        });
      }
      return res.status(400).json({
        error: `Invalid OTP code. ${Math.max(0, 5 - nextAttempts)} attempt(s) remaining.`,
      });
    }

    // Valid OTP: mark SMS OTP used and create a single-use 10-minute PASSWORD_RESET_SESSION token
    await db.query('UPDATE account_recovery_tokens SET used = TRUE WHERE id = $1', [tokenRow.id]);

    const resetSessionToken = generateSecureHexToken(32);
    const sessionExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await db.query(
      `INSERT INTO account_recovery_tokens (user_id, token_hash, token_type, target_value, expires_at)
       VALUES ($1, $2, 'PASSWORD_RESET_SESSION', $3, $4)`,
      [owner.id, sha256Hash(resetSessionToken), cleanPhone, sessionExpiresAt]
    );

    res.json({
      verified: true,
      resetToken: resetSessionToken,
      expiresAt: sessionExpiresAt,
      message: 'OTP verified successfully. You may now set a new owner password.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Complete Owner Password Reset (Using Validated Email Reset Token or Mobile OTP Reset Session Token)
app.post('/api/auth/forgot-password/reset', async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body || {};
    const rawToken = String(token || '').trim();
    if (!rawToken) {
      return res.status(400).json({ error: 'Password reset token is required.' });
    }
    if (!newPassword || String(newPassword).trim().length < 6) {
      return res.status(400).json({
        error: 'New password must be at least 6 characters long.',
      });
    }
    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      return res.status(400).json({
        error: 'New password and confirm password do not match.',
      });
    }

    const db = await getDb();
    const tokenHash = sha256Hash(rawToken);
    const tokenRes = await db.query(
      `SELECT t.*, u.username, u.full_name, u.role, u.token_version
       FROM account_recovery_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1
         AND t.token_type IN ('PASSWORD_RESET_EMAIL', 'PASSWORD_RESET_SESSION')
         AND u.role = 'owner'
       LIMIT 1`,
      [tokenHash]
    );

    if (tokenRes.rows.length === 0) {
      return res.status(400).json({
        error: 'Invalid password reset token. Please request a new password reset.',
      });
    }

    const tokenRow = tokenRes.rows[0];
    if (tokenRow.used) {
      return res.status(400).json({
        error: 'This password reset link/token has already been used.',
      });
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      await db.query('UPDATE account_recovery_tokens SET used = TRUE WHERE id = $1', [tokenRow.id]);
      return res.status(400).json({
        error: 'This password reset token has expired. Please request a new reset link or OTP.',
      });
    }

    const newHash = await bcrypt.hash(String(newPassword).trim(), 10);
    const nextTokenVersion = Number(tokenRow.token_version || 1) + 1;

    // 1. Update owner password hash & increment token_version to invalidate all existing JWT sessions
    await db.query(
      "UPDATE users SET password_hash = $1, token_version = $2 WHERE id = $3 AND role = 'owner'",
      [newHash, nextTokenVersion, tokenRow.user_id]
    );
    minValidOwnerTokenVersion = nextTokenVersion;

    // 2. Mark this reset token (and any other pending reset tokens for this user) as used
    await db.query(
      "UPDATE account_recovery_tokens SET used = TRUE WHERE user_id = $1 AND token_type IN ('PASSWORD_RESET_EMAIL', 'PASSWORD_RESET_SMS', 'PASSWORD_RESET_SESSION')",
      [tokenRow.user_id]
    );

    // 3. Log security audit trail
    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_id, description, performed_by)
       VALUES ('OWNER_PASSWORD_RESET', 'USER', $1, $2, $3)`,
      [
        String(tokenRow.user_id),
        `Owner password successfully reset via ${
          tokenRow.token_type === 'PASSWORD_RESET_EMAIL' ? 'verified recovery email link' : 'verified mobile SMS OTP'
        }. All prior sessions invalidated.`,
        tokenRow.full_name || 'Owner',
      ]
    );

    res.json({
      success: true,
      message:
        'Your owner password has been reset successfully. All previous sessions have been signed out. You can now sign in with your new password.',
    });
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

app.put('/api/settings', authenticateToken, requireOwner, async (req, res) => {
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

    const [productsRes, invoicesRes, customersRes] = await Promise.all([
      db.query('SELECT * FROM products ORDER BY name ASC, expiry_date ASC'),
      db.query('SELECT * FROM invoices ORDER BY created_at DESC'),
      db.query('SELECT * FROM customers'),
    ]);
    const products = productsRes.rows;
    const invoices = invoicesRes.rows;
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
    if (recentInvoices.length > 0) {
      const recentIds = recentInvoices.map((inv) => Number(inv.id));
      const itemsRes = await db.query(
        'SELECT * FROM invoice_items WHERE invoice_id = ANY($1::int[]) ORDER BY id ASC',
        [recentIds]
      );
      const itemsByInvoice = {};
      for (const item of itemsRes.rows) {
        if (!itemsByInvoice[item.invoice_id]) itemsByInvoice[item.invoice_id] = [];
        itemsByInvoice[item.invoice_id].push(item);
      }
      for (const inv of recentInvoices) {
        inv.items = itemsByInvoice[inv.id] || [];
      }
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

    if (invoices.length > 0) {
      const matchedIds = invoices.map((inv) => Number(inv.id));
      const allItemsRes = await db.query(
        'SELECT * FROM invoice_items WHERE invoice_id = ANY($1::int[]) ORDER BY id ASC',
        [matchedIds]
      );
      const itemsByInvoice = {};
      for (const item of allItemsRes.rows) {
        if (!itemsByInvoice[item.invoice_id]) itemsByInvoice[item.invoice_id] = [];
        itemsByInvoice[item.invoice_id].push(item);
      }
      for (const inv of invoices) {
        inv.items = itemsByInvoice[inv.id] || [];
      }
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

  // Pre-fetch all numeric product IDs in a single batch query to avoid N+1 lookups
  const numericProductIds = [
    ...new Set(
      items
        .map((it) => it.product_id)
        .filter(
          (pid) =>
            pid &&
            !String(pid).startsWith('manual-') &&
            !String(pid).startsWith('offline-')
        )
        .map((pid) => parseInt(pid, 10))
        .filter((pid) => !isNaN(pid))
    ),
  ];
  const productByIdMap = new Map();
  if (numericProductIds.length > 0) {
    const batchProdRes = await tx.query('SELECT * FROM products WHERE id = ANY($1::int[])', [
      numericProductIds,
    ]);
    for (const row of batchProdRes.rows) {
      productByIdMap.set(Number(row.id), row);
    }
  }

  for (const item of items) {
    const qty = parseInt(item.quantity, 10);
    if (!qty || qty <= 0) {
      throw new Error(`Invalid quantity for "${item.product_name || 'item'}".`);
    }

    // Try resolving product batch from pre-fetched map, client_uid, or (name + batch_number)
    let product = null;
    if (
      item.product_id &&
      !String(item.product_id).startsWith('manual-') &&
      !String(item.product_id).startsWith('offline-')
    ) {
      product = productByIdMap.get(parseInt(item.product_id, 10)) || null;
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
      const prevStock = Number(pi.product.stock);
      const newStock = Math.max(0, prevStock - pi.quantity);
      pi.product.stock = newStock;

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
    const [invRes, payRes] = await Promise.all([
      db.query('SELECT * FROM invoices WHERE customer_id = $1 ORDER BY created_at DESC', [custId]),
      db.query('SELECT * FROM customer_payments WHERE customer_id = $1 ORDER BY created_at DESC', [
        custId,
      ]),
    ]);
    const invoices = invRes.rows;
    if (invoices.length > 0) {
      const invIds = invoices.map((inv) => Number(inv.id));
      const itemsRes = await db.query(
        'SELECT * FROM invoice_items WHERE invoice_id = ANY($1::int[]) ORDER BY id ASC',
        [invIds]
      );
      const itemsByInvoice = {};
      for (const item of itemsRes.rows) {
        if (!itemsByInvoice[item.invoice_id]) itemsByInvoice[item.invoice_id] = [];
        itemsByInvoice[item.invoice_id].push(item);
      }
      for (const inv of invoices) {
        inv.items = itemsByInvoice[inv.id] || [];
      }
    }

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
app.get('/api/reports', authenticateToken, requireOwner, async (req, res) => {
  try {
    const db = await getDb();
    const { from, to } = req.query;

    const [invRes, productsRes, customersRes] = await Promise.all([
      db.query('SELECT * FROM invoices ORDER BY created_at DESC'),
      db.query('SELECT * FROM products ORDER BY name ASC, expiry_date ASC'),
      db.query('SELECT * FROM customers ORDER BY total_purchases DESC'),
    ]);
    let invoices = invRes.rows;
    const products = productsRes.rows;
    const customers = customersRes.rows;

    if (from) {
      const fromD = new Date(`${from}T00:00:00`);
      invoices = invoices.filter((i) => new Date(i.created_at) >= fromD);
    }
    if (to) {
      const toD = new Date(`${to}T23:59:59.999`);
      invoices = invoices.filter((i) => new Date(i.created_at) <= toD);
    }

    let filteredItems = [];
    if (invoices.length > 0) {
      const matchedIds = invoices.map((i) => Number(i.id));
      const allItemsRes = await db.query(
        'SELECT * FROM invoice_items WHERE invoice_id = ANY($1::int[])',
        [matchedIds]
      );
      filteredItems = allItemsRes.rows;
    }

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
app.get('/api/backup', authenticateToken, requireOwner, async (req, res) => {
  try {
    const db = await getDb();
    const [
      settingsRes,
      productsRes,
      customersRes,
      invoicesRes,
      invoiceItemsRes,
      stockMovementsRes,
      customerPaymentsRes,
      auditLogsRes,
    ] = await Promise.all([
      db.query('SELECT * FROM settings'),
      db.query('SELECT * FROM products ORDER BY id ASC'),
      db.query('SELECT * FROM customers ORDER BY id ASC'),
      db.query('SELECT * FROM invoices ORDER BY id ASC'),
      db.query('SELECT * FROM invoice_items ORDER BY id ASC'),
      db.query('SELECT * FROM stock_movements ORDER BY id ASC'),
      db.query('SELECT * FROM customer_payments ORDER BY id ASC'),
      db.query('SELECT * FROM audit_logs ORDER BY id ASC'),
    ]);
    const settings = settingsRes.rows;
    const products = productsRes.rows;
    const customers = customersRes.rows;
    const invoices = invoicesRes.rows;
    const invoice_items = invoiceItemsRes.rows;
    const stock_movements = stockMovementsRes.rows;
    const customer_payments = customerPaymentsRes.rows;
    const audit_logs = auditLogsRes.rows;

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

app.post('/api/restore', authenticateToken, requireOwner, async (req, res) => {
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

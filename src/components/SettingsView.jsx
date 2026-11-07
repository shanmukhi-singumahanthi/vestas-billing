import React, { useState, useEffect, useRef } from 'react';
import {
  Save,
  Building2,
  FileText,
  Shield,
  Database,
  Download,
  Upload,
  History,
  CheckCircle2,
  X,
  Plus,
  Users,
  UserPlus,
  Trash2,
  Lock,
} from 'lucide-react';
import { apiRequest } from '../utils/api';
import { formatDateTime } from '../utils/exportAndPdf';
import { VestasLogo } from './InvoiceModal';

export default function SettingsView({ settings = {}, onSettingsSaved, onFullRefresh }) {
  const [activeSection, setActiveSection] = useState('business'); // 'business' | 'invoice' | 'security' | 'backup' | 'audit'
  const [form, setForm] = useState({
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
    logo_url: '',
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
    low_stock_threshold: 25,
    printer_paper_size: 'A4',
    auto_print_after_save: false,
    show_hsn_on_invoice: true,
    show_batch_expiry_on_invoice: true,
    show_mrp_on_invoice: true,
    terms_and_conditions: '',
  });

  const [newMethod, setNewMethod] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Account Password Form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('admin');
  const [fullName, setFullName] = useState('S. Satyendranath (Proprietor)');
  const [newPassword, setNewPassword] = useState('');

  // Staff / Worker Accounts Management
  const [staffUsers, setStaffUsers] = useState([]);
  const [staffUsername, setStaffUsername] = useState('');
  const [staffFullName, setStaffFullName] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffRole, setStaffRole] = useState('worker');

  // Audit Logs
  const [auditLogs, setAuditLogs] = useState([]);
  const restoreInputRef = useRef(null);
  const logoInputRef = useRef(null);

  useEffect(() => {
    if (settings && settings.business_name) {
      setForm({
        ...form,
        ...settings,
        payment_methods: Array.isArray(settings.payment_methods)
          ? settings.payment_methods
          : ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Credit'],
        categories: Array.isArray(settings.categories)
          ? settings.categories
          : [
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
    }
  }, [settings]);

  useEffect(() => {
    if (activeSection === 'audit') {
      apiRequest('/api/audit-logs')
        .then((res) => setAuditLogs(res || []))
        .catch(() => {});
    }
    if (activeSection === 'security') {
      apiRequest('/api/users')
        .then((res) => setStaffUsers(res || []))
        .catch(() => {});
    }
  }, [activeSection]);

  const handleAddStaffUser = async (e) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const created = await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: staffUsername,
          full_name: staffFullName,
          password: staffPassword,
          role: staffRole,
        }),
      });
      setStaffUsers([...staffUsers, created]);
      setStaffUsername('');
      setStaffFullName('');
      setStaffPassword('');
      setStaffRole('worker');
      setFeedback({
        type: 'success',
        text: `Created ${created.role} account "${created.username}" (${created.full_name}).`,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    }
  };

  const handleDeleteStaffUser = async (id, uname) => {
    try {
      await apiRequest(`/api/users/${id}`, { method: 'DELETE' });
      setStaffUsers(staffUsers.filter((u) => u.id !== id));
      setFeedback({ type: 'success', text: `Removed staff account "${uname}".` });
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const updated = await apiRequest('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      setFeedback({ type: 'success', text: 'All business & invoice settings saved successfully!' });
      if (onSettingsSaved) onSettingsSaved(updated);
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setForm({ ...form, logo_url: ev.target.result });
    };
    reader.readAsDataURL(file);
  };

  const handleUpdateCredentials = async (e) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await apiRequest('/api/auth/password', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword,
          newUsername,
          fullName,
          newPassword,
        }),
      });
      setFeedback({ type: 'success', text: res.message });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    }
  };

  const handleDownloadBackup = async () => {
    try {
      const backupData = await apiRequest('/api/backup');
      const blob = new Blob([JSON.stringify(backupData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Vestas_Pharma_Database_Backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedback({ type: 'success', text: 'Full database backup downloaded successfully.' });
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    }
  };

  const handleRestoreBackup = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        await apiRequest('/api/restore', {
          method: 'POST',
          body: JSON.stringify(parsed),
        });
        setFeedback({
          type: 'success',
          text: 'Database restored successfully from backup file!',
        });
        if (onFullRefresh) onFullRefresh();
      } catch (err) {
        setFeedback({ type: 'error', text: err.message || 'Invalid backup file.' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-wrap items-center gap-2">
        {[
          { id: 'business', label: 'Business Profile & Logo', icon: Building2 },
          { id: 'invoice', label: 'Invoice, Tax & Categories', icon: FileText },
          { id: 'security', label: 'Account Security', icon: Shield },
          { id: 'backup', label: 'Database Backup & Restore', icon: Database },
          { id: 'audit', label: 'Price & Stock Audit Logs', icon: History },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSection(tab.id)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeSection === tab.id
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-medium ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="p-1 hover:opacity-75 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {(activeSection === 'business' || activeSection === 'invoice') && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-6 text-xs"
        >
          {activeSection === 'business' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
                <div className="flex items-center gap-4">
                  <VestasLogo logoUrl={form.logo_url} size="lg" />
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Company Logo & Brand Identity
                    </h3>
                    <p className="text-slate-500 mt-0.5">
                      Displayed on your sidebar header and printed A4 invoices
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 font-semibold text-slate-700 cursor-pointer"
                  >
                    Upload Custom Logo
                  </button>
                  {form.logo_url && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, logo_url: '' })}
                      className="px-3 py-2 rounded-xl text-red-600 hover:bg-red-50 font-semibold cursor-pointer"
                    >
                      Reset to Default Emblem
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Business / Firm Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.business_name}
                    onChange={(e) => setForm({ ...form, business_name: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 font-bold outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Owner / Proprietor Name
                  </label>
                  <input
                    type="text"
                    value={form.owner_name}
                    onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Business Subtitle / Tagline
                </label>
                <input
                  type="text"
                  value={form.tagline}
                  onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Full Business Address (Printed on Invoices)
                </label>
                <textarea
                  rows={2}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">GSTIN Number</label>
                  <input
                    type="text"
                    value={form.gstin}
                    onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Currency Symbol
                  </label>
                  <input
                    type="text"
                    value={form.currency_symbol}
                    onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Drug License No. 1 (Form 20B / 20)
                  </label>
                  <input
                    type="text"
                    value={form.dl_no_1}
                    onChange={(e) => setForm({ ...form, dl_no_1: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Drug License No. 2 (Form 21B / 21)
                  </label>
                  <input
                    type="text"
                    value={form.dl_no_2}
                    onChange={(e) => setForm({ ...form, dl_no_2: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono outline-none"
                  />
                </div>
              </div>
            </>
          )}

          {activeSection === 'invoice' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Invoice Prefix
                  </label>
                  <input
                    type="text"
                    value={form.invoice_prefix}
                    onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Next Invoice Sequence No.
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={form.next_invoice_number}
                    onChange={(e) => setForm({ ...form, next_invoice_number: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Default Invoice Print Layout
                  </label>
                  <select
                    value={form.default_invoice_format}
                    onChange={(e) => setForm({ ...form, default_invoice_format: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white outline-none"
                  >
                    <option value="A4">A4 Full Tax Invoice</option>
                    <option value="THERMAL">Thermal Receipt (80mm)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Default GST Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={form.default_gst_rate}
                    onChange={(e) => setForm({ ...form, default_gst_rate: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <label className="inline-flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.enable_gst}
                    onChange={(e) => setForm({ ...form, enable_gst: e.target.checked })}
                  />
                  Enable GST Calculation by Default
                </label>

                <label className="inline-flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.tax_inclusive}
                    onChange={(e) => setForm({ ...form, tax_inclusive: e.target.checked })}
                  />
                  Selling Prices are Tax-Inclusive
                </label>

                <label className="inline-flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.show_hsn_on_invoice}
                    onChange={(e) => setForm({ ...form, show_hsn_on_invoice: e.target.checked })}
                  />
                  Show HSN & MRP Columns on Invoice
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Payment Methods */}
                <div className="p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="font-bold text-slate-800">Configurable Payment Methods</div>
                  <div className="flex flex-wrap gap-1.5">
                    {form.payment_methods.map((m) => (
                      <span
                        key={m}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-50 text-sky-800 border border-sky-200 font-semibold"
                      >
                        {m}
                        <button
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              payment_methods: form.payment_methods.filter((x) => x !== m),
                            })
                          }
                          className="text-sky-500 hover:text-red-600 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newMethod}
                      onChange={(e) => setNewMethod(e.target.value)}
                      placeholder="Add payment method (e.g. Cheque)"
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (newMethod.trim() && !form.payment_methods.includes(newMethod.trim())) {
                          setForm({
                            ...form,
                            payment_methods: [...form.payment_methods, newMethod.trim()],
                          });
                          setNewMethod('');
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-sky-600 text-white font-semibold cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Categories */}
                <div className="p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="font-bold text-slate-800">Configurable Product Categories</div>
                  <div className="flex flex-wrap gap-1.5">
                    {form.categories.map((c) => (
                      <span
                        key={c}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold"
                      >
                        {c}
                        <button
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              categories: form.categories.filter((x) => x !== c),
                            })
                          }
                          className="text-emerald-600 hover:text-red-600 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder="Add category (e.g. Powders)"
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (newCategory.trim() && !form.categories.includes(newCategory.trim())) {
                          setForm({
                            ...form,
                            categories: [...form.categories, newCategory.trim()],
                          });
                          setNewCategory('');
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Invoice Footer Terms & Conditions
                </label>
                <textarea
                  rows={3}
                  value={form.terms_and_conditions}
                  onChange={(e) => setForm({ ...form, terms_and_conditions: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none"
                />
              </div>
            </>
          )}

          <div className="flex justify-end pt-4 border-t border-slate-200">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold shadow-xs cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving Configuration...' : 'Save Configuration Settings'}
            </button>
          </div>
        </form>
      )}

      {activeSection === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* 1. Single Owner Account Security */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-5 h-5 text-amber-600" />
              <h3 className="text-base font-bold text-slate-900">
                Single Owner Account Security
              </h3>
            </div>
            <p className="text-xs text-slate-500 mb-5">
              Exclusive proprietor login for S. Satyendranath. Update your owner username, display
              name, or password below.
            </p>

            <form onSubmit={handleUpdateCredentials} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Owner Display Name
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Owner Username</label>
                <input
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Current Password *
                </label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password to confirm changes"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  New Password (leave blank to keep current)
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none"
                />
              </div>

              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold cursor-pointer"
              >
                Update Owner Security Credentials
              </button>
            </form>
          </div>

          {/* 2. Counter Staff & Chemist Accounts (Role: Worker) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Counter Staff & Chemist Logins ({staffUsers.length})
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                Staff accounts have limited counter POS access. Wholesale purchase costs (PTS), profit margins, store settings, and report downloads are automatically hidden from staff.
              </p>
            </div>

            {/* List Existing Staff */}
            <div className="space-y-2.5">
              <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Active Staff Accounts
              </div>
              {staffUsers.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-400">
                  No separate staff accounts created yet. Default staff login: <strong>staff</strong> / <strong>staff123</strong>.
                </div>
              ) : (
                staffUsers.map((u) => (
                  <div
                    key={u.id}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-900 flex items-center gap-2">
                        {u.full_name || u.username}
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          @{u.username}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Counter Staff • POS & Invoices Only (Profits Hidden)
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete staff account for "${u.username}"?`)) {
                          handleDeleteStaffUser(u.id, u.username);
                        }
                      }}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                      title="Remove Staff Account"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Add New Staff Account Form */}
            <div className="pt-4 border-t border-slate-200">
              <div className="text-xs font-bold text-slate-800 mb-3 flex items-center gap-1.5">
                <UserPlus className="w-4 h-4 text-emerald-600" />
                Add New Staff / Chemist Account
              </div>

              <form onSubmit={handleAddStaffUser} className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Staff Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={staffFullName}
                    onChange={(e) => setStaffFullName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar (Counter Chemist)"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none focus:border-emerald-600"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Staff Username *
                    </label>
                    <input
                      type="text"
                      required
                      value={staffUsername}
                      onChange={(e) => setStaffUsername(e.target.value)}
                      placeholder="e.g. ramesh"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none focus:border-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Initial Password *
                    </label>
                    <input
                      type="password"
                      required
                      value={staffPassword}
                      onChange={(e) => setStaffPassword(e.target.value)}
                      placeholder="e.g. ramesh123"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none focus:border-emerald-600"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer transition shadow-xs"
                >
                  <UserPlus className="w-4 h-4" />
                  Create Staff Account
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {activeSection === 'backup' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center mb-4">
                <Download className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">
                Download Complete Database Backup
              </h3>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                Export all medicines, stock levels, customer records, completed invoices, payment
                histories, and settings into a single portable backup file.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadBackup}
              className="mt-6 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Download Backup (.json)
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
                <Upload className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">
                Restore Database from Backup File
              </h3>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                Restore a previously downloaded Vestas Pharmaceuticals backup file to recover all
                medicines, invoices, and customer balances.
              </p>
            </div>
            <div>
              <input
                ref={restoreInputRef}
                type="file"
                accept=".json"
                onChange={handleRestoreBackup}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => restoreInputRef.current?.click()}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                Select Backup File & Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {activeSection === 'audit' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="text-base font-bold text-slate-900">
              Security Audit Logs (Price Updates, Stock Changes & System Actions)
            </h3>
            <p className="text-xs text-slate-500">
              Chronological audit trail of every sensitive action performed in the system
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-3">Action Type</th>
                  <th className="py-3 px-3">Entity</th>
                  <th className="py-3 px-3">Audit Description</th>
                  <th className="py-3 px-4">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-400">
                      No audit events logged yet.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 text-slate-500">
                        {formatDateTime(log.created_at)}
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 font-semibold text-[11px]">
                          {log.action_type}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-600">{log.entity_type}</td>
                      <td className="py-3 px-3 font-medium text-slate-900">{log.description}</td>
                      <td className="py-3 px-4 text-slate-600">{log.performed_by}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

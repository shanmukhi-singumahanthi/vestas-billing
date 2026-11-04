import React, { useState, useMemo } from 'react';
import {
  UserPlus,
  Search,
  Edit3,
  Eye,
  IndianRupee,
  Phone,
  MapPin,
  Printer,
  X,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest } from '../utils/api';
import { formatCurrency, formatDateTime } from '../utils/exportAndPdf';

const EMPTY_CUSTOMER = {
  name: '',
  phone: '',
  email: '',
  address: '',
  gstin: '',
  dl_number: '',
  balance: 0,
  notes: '',
};

export default function CustomersView({
  customers = [],
  settings = {},
  onRefresh,
  onViewInvoice,
}) {
  const symbol = settings?.currency_symbol || '₹';
  const [search, setSearch] = useState('');
  const [balanceFilter, setBalanceFilter] = useState('All');

  // Add/Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState(EMPTY_CUSTOMER);
  const [saving, setSaving] = useState(false);

  // Customer Details & Purchase History Drawer/Modal
  const [selectedCustomerDetail, setSelectedCustomerDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Record Balance Payment Modal
  const [paymentModalCustomer, setPaymentModalCustomer] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('Cash');
  const [payNote, setPayNote] = useState('');
  const [recordingPayment, setRecordingPayment] = useState(false);

  const [feedback, setFeedback] = useState(null);

  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      if (balanceFilter === 'pending' && Number(c.balance) <= 0) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.gstin && c.gstin.toLowerCase().includes(q)) ||
        (c.address && c.address.toLowerCase().includes(q))
      );
    });
  }, [customers, search, balanceFilter]);

  const openAddModal = () => {
    setEditingCustomer(null);
    setFormData(EMPTY_CUSTOMER);
    setModalOpen(true);
  };

  const openEditModal = (c) => {
    setEditingCustomer(c);
    setFormData({
      name: c.name || '',
      phone: c.phone || '',
      email: c.email || '',
      address: c.address || '',
      gstin: c.gstin || '',
      dl_number: c.dl_number || '',
      balance: c.balance ?? 0,
      notes: c.notes || '',
    });
    setModalOpen(true);
  };

  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      if (editingCustomer) {
        await apiRequest(`/api/customers/${editingCustomer.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
        setFeedback({ type: 'success', text: `Updated customer "${formData.name}".` });
      } else {
        await apiRequest('/api/customers', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
        setFeedback({ type: 'success', text: `Added new customer "${formData.name}".` });
      }
      setModalOpen(false);
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const openCustomerHistory = async (customer) => {
    setLoadingDetail(true);
    try {
      const detail = await apiRequest(`/api/customers/${customer.id}`);
      setSelectedCustomerDetail(detail);
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setLoadingDetail(false);
    }
  };

  const openPaymentModal = (customer) => {
    setPaymentModalCustomer(customer);
    setPayAmount(String(customer.balance || ''));
    setPayMethod('Cash');
    setPayNote('Pending balance payment received');
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!paymentModalCustomer) return;
    setRecordingPayment(true);
    setFeedback(null);
    try {
      await apiRequest(`/api/customers/${paymentModalCustomer.id}/payment`, {
        method: 'POST',
        body: JSON.stringify({
          amount: parseFloat(payAmount),
          payment_method: payMethod,
          reference_note: payNote,
        }),
      });
      setFeedback({
        type: 'success',
        text: `Recorded payment of ${formatCurrency(payAmount, symbol)} from ${
          paymentModalCustomer.name
        }.`,
      });
      setPaymentModalCustomer(null);
      onRefresh();
      if (selectedCustomerDetail && selectedCustomerDetail.id === paymentModalCustomer.id) {
        openCustomerHistory(paymentModalCustomer);
      }
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setRecordingPayment(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Customer Accounts & Purchase History ({customers.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage retail & wholesale pharmacy buyers, view previous invoices, and track pending balances
          </p>
        </div>

        <button
          type="button"
          onClick={openAddModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          Add New Customer
        </button>
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

      {/* Search & Filter */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer by name, phone, GSTIN, or address..."
            className="w-full pl-10 pr-4 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 focus:border-sky-600 outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={balanceFilter}
            onChange={(e) => setBalanceFilter(e.target.value)}
            className="px-3 py-2 text-xs font-medium rounded-xl border border-slate-300 bg-white outline-none"
          >
            <option value="All">All Customers</option>
            <option value="pending">With Pending Balance Due</option>
          </select>
        </div>
      </div>

      {/* Customers Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-semibold">Customer / Pharmacy Name</th>
                <th className="py-3 px-3 font-semibold">Phone & Contact</th>
                <th className="py-3 px-3 font-semibold">GSTIN / DL No</th>
                <th className="py-3 px-3 font-semibold text-right">Total Purchases</th>
                <th className="py-3 px-3 font-semibold text-right">Pending Balance</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No customer records found.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((c) => {
                  const hasDue = Number(c.balance) > 0;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 text-xs sm:text-sm">{c.name}</div>
                        {c.address && (
                          <div className="text-[11px] text-slate-500 mt-0.5">{c.address}</div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-800">{c.phone}</div>
                        {c.email && <div className="text-[11px] text-slate-500">{c.email}</div>}
                      </td>
                      <td className="py-3 px-3 text-slate-600">
                        {c.gstin ? <div>GST: {c.gstin}</div> : null}
                        {c.dl_number ? <div>DL: {c.dl_number}</div> : null}
                        {!c.gstin && !c.dl_number && <span className="text-slate-400">Retail</span>}
                      </td>
                      <td className="py-3 px-3 text-right font-semibold text-slate-800">
                        {formatCurrency(c.total_purchases, symbol)}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full font-bold text-[11px] ${
                            hasDue
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {formatCurrency(c.balance, symbol)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openCustomerHistory(c)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Purchase History
                          </button>
                          {hasDue && (
                            <button
                              type="button"
                              onClick={() => openPaymentModal(c)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition cursor-pointer"
                            >
                              Receive Payment
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditModal(c)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                            title="Edit Customer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Customer Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {editingCustomer ? `Edit Customer: ${editingCustomer.name}` : 'Add New Customer'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Customer / Pharmacy Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone Number *</label>
                  <input
                    type="text"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    GSTIN (Optional)
                  </label>
                  <input
                    type="text"
                    value={formData.gstin}
                    onChange={(e) => setFormData({ ...formData, gstin: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Drug License No. (Optional)
                  </label>
                  <input
                    type="text"
                    value={formData.dl_number}
                    onChange={(e) => setFormData({ ...formData, dl_number: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Pending Balance ({symbol})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.balance}
                    onChange={(e) => setFormData({ ...formData, balance: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 outline-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-semibold text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold cursor-pointer"
                >
                  {saving ? 'Saving...' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer Purchase History & Invoices Modal */}
      {selectedCustomerDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {selectedCustomerDetail.name} — Purchase & Invoice History
                </h3>
                <p className="text-xs text-slate-500">
                  Phone: {selectedCustomerDetail.phone} • Total Purchases:{' '}
                  <strong>{formatCurrency(selectedCustomerDetail.total_purchases, symbol)}</strong>{' '}
                  • Pending Balance:{' '}
                  <strong className="text-red-600">
                    {formatCurrency(selectedCustomerDetail.balance, symbol)}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomerDetail(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 text-xs">
              <div>
                <h4 className="font-bold text-slate-800 uppercase tracking-wider mb-2.5">
                  Previous Invoices ({(selectedCustomerDetail.invoices || []).length})
                </h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3">Invoice No</th>
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Method & Status</th>
                        <th className="py-2.5 px-3 text-right">Grand Total</th>
                        <th className="py-2.5 px-3 text-right">Paid</th>
                        <th className="py-2.5 px-3 text-right">Balance</th>
                        <th className="py-2.5 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {(selectedCustomerDetail.invoices || []).length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-400">
                            No invoices recorded for this customer yet.
                          </td>
                        </tr>
                      ) : (
                        selectedCustomerDetail.invoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 font-bold text-sky-700">
                              {inv.invoice_number}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              {formatDateTime(inv.created_at)}
                            </td>
                            <td className="py-2.5 px-3">
                              {inv.payment_method} ({inv.payment_status})
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold">
                              {formatCurrency(inv.grand_total, symbol)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-emerald-700">
                              {formatCurrency(inv.amount_paid, symbol)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-red-600 font-semibold">
                              {formatCurrency(inv.balance_due, symbol)}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => onViewInvoice(inv)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold cursor-pointer"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                View / Reprint
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {(selectedCustomerDetail.payments || []).length > 0 && (
                <div>
                  <h4 className="font-bold text-slate-800 uppercase tracking-wider mb-2.5">
                    Balance Settlement History
                  </h4>
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="py-2 px-3">Date</th>
                          <th className="py-2 px-3">Payment Mode</th>
                          <th className="py-2 px-3">Reference Note</th>
                          <th className="py-2 px-3 text-right">Amount Paid</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {selectedCustomerDetail.payments.map((pay) => (
                          <tr key={pay.id}>
                            <td className="py-2 px-3 text-slate-600">
                              {formatDateTime(pay.created_at)}
                            </td>
                            <td className="py-2 px-3 font-semibold">{pay.payment_method}</td>
                            <td className="py-2 px-3 text-slate-600">{pay.reference_note}</td>
                            <td className="py-2 px-3 text-right font-bold text-emerald-700">
                              {formatCurrency(pay.amount, symbol)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Receive Payment Modal */}
      {paymentModalCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Receive Balance Payment
              </h3>
              <button
                type="button"
                onClick={() => setPaymentModalCustomer(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="p-6 space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-900">{paymentModalCustomer.name}</div>
                <div className="text-slate-600 mt-0.5">
                  Current Pending Balance:{' '}
                  <strong className="text-red-600">
                    {formatCurrency(paymentModalCustomer.balance, symbol)}
                  </strong>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Amount Received ({symbol}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-emerald-400 font-bold text-sm outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Payment Method</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white outline-none"
                >
                  <option value="Cash">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="Card">Card</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Reference Note</label>
                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 outline-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setPaymentModalCustomer(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-semibold text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={recordingPayment}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                >
                  {recordingPayment ? 'Recording...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

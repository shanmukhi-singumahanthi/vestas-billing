import React, { useState, useEffect, useMemo } from 'react';
import {
  PackagePlus,
  AlertTriangle,
  XCircle,
  Clock,
  History,
  Layers,
  CheckCircle2,
  X,
  ArrowUpCircle,
  ArrowDownCircle,
  Search,
} from 'lucide-react';
import { apiRequest } from '../utils/api';
import { formatCurrency, formatDateTime } from '../utils/exportAndPdf';

export default function InventoryView({ products = [], settings = {}, onRefresh }) {
  const symbol = settings?.currency_symbol || '₹';
  const [activeTab, setActiveTab] = useState('batch'); // 'batch' | 'alerts' | 'expiry' | 'history'
  const [search, setSearch] = useState('');
  const [movements, setMovements] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Stock Adjustment / Purchase Restock Modal
  const [adjustModalProduct, setAdjustModalProduct] = useState(null);
  const [movementType, setMovementType] = useState('PURCHASE_RESTOCK');
  const [quantity, setQuantity] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [mrp, setMrp] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const loadMovements = async () => {
    setLoadingHistory(true);
    try {
      const data = await apiRequest('/api/inventory/movements');
      setMovements(data || []);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadMovements();
  }, [products]);

  const now = new Date();
  const ninetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const lowStockList = useMemo(
    () => products.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= Number(p.min_stock_level)),
    [products]
  );

  const outOfStockList = useMemo(
    () => products.filter((p) => Number(p.stock) <= 0),
    [products]
  );

  const expiryList = useMemo(() => {
    return products
      .filter((p) => {
        if (!p.expiry_date) return false;
        const d = new Date(p.expiry_date.length === 7 ? `${p.expiry_date}-28` : p.expiry_date);
        return d <= ninetyDays;
      })
      .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
  }, [products]);

  const filteredBatchProducts = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.batch_number.toLowerCase().includes(q) ||
        (p.manufacturer && p.manufacturer.toLowerCase().includes(q))
    );
  }, [products, search]);

  const openAdjustModal = (product, defaultType = 'PURCHASE_RESTOCK') => {
    setAdjustModalProduct(product);
    setMovementType(defaultType);
    setQuantity('');
    setPurchasePrice(product.purchase_price ?? '');
    setSellingPrice(product.selling_price ?? '');
    setMrp(product.mrp ?? '');
    setBatchNumber(product.batch_number ?? '');
    setExpiryDate(product.expiry_date ?? '');
    setReferenceId('');
    setReason(
      defaultType === 'PURCHASE_RESTOCK'
        ? 'New supplier purchase stock received'
        : 'Manual stock audit correction'
    );
  };

  const handleStockAdjustmentSubmit = async (e) => {
    e.preventDefault();
    if (!adjustModalProduct) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await apiRequest(`/api/products/${adjustModalProduct.id}/stock`, {
        method: 'POST',
        body: JSON.stringify({
          movement_type: movementType,
          quantity: parseInt(quantity, 10),
          purchase_price: purchasePrice,
          selling_price: sellingPrice,
          mrp,
          batch_number: batchNumber,
          expiry_date: expiryDate,
          reference_id: referenceId,
          reason,
        }),
      });
      setFeedback({
        type: 'success',
        text: `Updated stock for "${adjustModalProduct.name}" and recorded audit movement.`,
      });
      setAdjustModalProduct(null);
      onRefresh();
      loadMovements();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Inventory KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => setActiveTab('batch')}
          className={`bg-white rounded-2xl border p-4 shadow-2xs cursor-pointer transition ${
            activeTab === 'batch' ? 'border-sky-600 ring-2 ring-sky-100' : 'border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase">
              Batch-Wise Stock
            </span>
            <Layers className="w-5 h-5 text-sky-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{products.length} Batches</div>
          <div className="text-xs text-slate-500 mt-0.5">Click to restock or adjust</div>
        </div>

        <div
          onClick={() => setActiveTab('alerts')}
          className={`bg-white rounded-2xl border p-4 shadow-2xs cursor-pointer transition ${
            activeTab === 'alerts' ? 'border-amber-500 ring-2 ring-amber-100' : 'border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-700 uppercase">
              Low & Out-of-Stock Alerts
            </span>
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-700 mt-2">
            {lowStockList.length} Low / {outOfStockList.length} Out
          </div>
          <div className="text-xs text-amber-600 mt-0.5">Immediate restock attention</div>
        </div>

        <div
          onClick={() => setActiveTab('expiry')}
          className={`bg-white rounded-2xl border p-4 shadow-2xs cursor-pointer transition ${
            activeTab === 'expiry' ? 'border-red-500 ring-2 ring-red-100' : 'border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-red-700 uppercase">
              Expiry Tracker (90 Days)
            </span>
            <Clock className="w-5 h-5 text-red-600" />
          </div>
          <div className="text-2xl font-bold text-red-700 mt-2">{expiryList.length} Items</div>
          <div className="text-xs text-red-600 mt-0.5">Expired or expiring within 90 days</div>
        </div>

        <div
          onClick={() => setActiveTab('history')}
          className={`bg-white rounded-2xl border p-4 shadow-2xs cursor-pointer transition ${
            activeTab === 'history'
              ? 'border-emerald-600 ring-2 ring-emerald-100'
              : 'border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-700 uppercase">
              Stock Audit History
            </span>
            <History className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700 mt-2">
            {movements.length} Records
          </div>
          <div className="text-xs text-emerald-600 mt-0.5">Complete ledger of stock changes</div>
        </div>
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

      {/* Main Content Area by Sub-tab */}
      {activeTab === 'batch' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Batch-Wise Inventory & Quick Stock Adjustment
              </h3>
              <p className="text-xs text-slate-500">
                Record new purchase stock arrivals or perform manual stock corrections with full audit logs
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search medicine or batch..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:border-sky-600 outline-none"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">Medicine Name</th>
                  <th className="py-3 px-3 font-semibold">Batch No</th>
                  <th className="py-3 px-3 font-semibold">Expiry Date</th>
                  <th className="py-3 px-3 font-semibold text-right">Purchase Price</th>
                  <th className="py-3 px-3 font-semibold text-right">Selling Price</th>
                  <th className="py-3 px-3 font-semibold text-center">Current Stock</th>
                  <th className="py-3 px-3 font-semibold text-center">Min Level</th>
                  <th className="py-3 px-4 font-semibold text-right">Stock Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredBatchProducts.map((p) => {
                  const isOut = Number(p.stock) <= 0;
                  const isLow =
                    Number(p.stock) > 0 && Number(p.stock) <= Number(p.min_stock_level);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{p.name}</div>
                        <div className="text-[11px] text-slate-500">
                          SKU: {p.sku} • {p.category}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono font-semibold text-slate-800">
                        {p.batch_number}
                      </td>
                      <td className="py-3 px-3 text-slate-700">{p.expiry_date}</td>
                      <td className="py-3 px-3 text-right text-slate-600">
                        {formatCurrency(p.purchase_price, symbol)}
                      </td>
                      <td className="py-3 px-3 text-right font-semibold text-emerald-700">
                        {formatCurrency(p.selling_price, symbol)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full font-bold text-[11px] ${
                            isOut
                              ? 'bg-red-100 text-red-700'
                              : isLow
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {p.stock}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center text-slate-500">
                        {p.min_stock_level}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openAdjustModal(p, 'PURCHASE_RESTOCK')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition cursor-pointer"
                          >
                            <PackagePlus className="w-3.5 h-3.5" />
                            + Purchase / Restock
                          </button>
                          <button
                            type="button"
                            onClick={() => openAdjustModal(p, 'MANUAL_DEDUCT')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold transition cursor-pointer"
                          >
                            Correct Stock
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'alerts' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-red-200 shadow-2xs overflow-hidden">
            <div className="p-4 bg-red-50/70 border-b border-red-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-red-800 flex items-center gap-2">
                <XCircle className="w-4 h-4" />
                Out-of-Stock Medicines ({outOfStockList.length})
              </h3>
            </div>
            <div className="divide-y divide-slate-200">
              {outOfStockList.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  Zero out-of-stock medicines!
                </div>
              ) : (
                outOfStockList.map((p) => (
                  <div key={p.id} className="p-4 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-slate-900">{p.name}</div>
                      <div className="text-slate-500 mt-0.5">
                        SKU: {p.sku} • Batch: {p.batch_number} • Min Required: {p.min_stock_level}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openAdjustModal(p, 'PURCHASE_RESTOCK')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                    >
                      + Restock Now
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-amber-200 shadow-2xs overflow-hidden">
            <div className="p-4 bg-amber-50/70 border-b border-amber-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Low-Stock Medicines ({lowStockList.length})
              </h3>
            </div>
            <div className="divide-y divide-slate-200">
              {lowStockList.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No medicines are currently in low-stock state.
                </div>
              ) : (
                lowStockList.map((p) => (
                  <div key={p.id} className="p-4 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-slate-900">{p.name}</div>
                      <div className="text-slate-500 mt-0.5">
                        Available: <strong className="text-amber-700">{p.stock}</strong> • Min
                        Threshold: {p.min_stock_level}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openAdjustModal(p, 'PURCHASE_RESTOCK')}
                      className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-semibold cursor-pointer"
                    >
                      + Add Purchase
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'expiry' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="text-base font-bold text-slate-900">
              Medicine Expiry Tracker (Expired & Near-Expiry within 90 Days)
            </h3>
            <p className="text-xs text-slate-500">
              Identify expired batches or write off expired stock safely with an audit record
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Medicine</th>
                  <th className="py-3 px-3">Batch No</th>
                  <th className="py-3 px-3">Expiry Date</th>
                  <th className="py-3 px-3 text-center">Status</th>
                  <th className="py-3 px-3 text-center">Stock Left</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {expiryList.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      No medicines are expired or expiring within the next 90 days.
                    </td>
                  </tr>
                ) : (
                  expiryList.map((p) => {
                    const expDate = new Date(
                      p.expiry_date.length === 7 ? `${p.expiry_date}-28` : p.expiry_date
                    );
                    const isExpired = expDate < now;
                    return (
                      <tr key={p.id}>
                        <td className="py-3 px-4 font-bold text-slate-900">{p.name}</td>
                        <td className="py-3 px-3 font-mono">{p.batch_number}</td>
                        <td className="py-3 px-3 font-semibold">{p.expiry_date}</td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                              isExpired
                                ? 'bg-red-100 text-red-700'
                                : 'bg-orange-100 text-orange-800'
                            }`}
                          >
                            {isExpired ? 'EXPIRED' : 'Expiring Soon'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center font-bold">{p.stock}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => openAdjustModal(p, 'DAMAGE_EXPIRY')}
                            className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-semibold cursor-pointer"
                          >
                            Write-Off / Update Batch
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Stock Movement & Adjustment Audit Ledger
              </h3>
              <p className="text-xs text-slate-500">
                Every sale, purchase restock, and manual correction is permanently logged
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-3">Medicine & Batch</th>
                  <th className="py-3 px-3">Movement Type</th>
                  <th className="py-3 px-3 text-center">Qty Change</th>
                  <th className="py-3 px-3 text-center">Prev → New Stock</th>
                  <th className="py-3 px-3">Reference / Reason</th>
                  <th className="py-3 px-4">Recorded By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loadingHistory ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400">
                      Loading stock movement history...
                    </td>
                  </tr>
                ) : movements.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400">
                      No stock movements recorded yet.
                    </td>
                  </tr>
                ) : (
                  movements.map((m) => {
                    const isPositive = Number(m.quantity_change) >= 0;
                    return (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 text-slate-600">
                          {formatDateTime(m.created_at)}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-900">{m.product_name}</div>
                          <div className="text-[11px] text-slate-500">
                            Batch: {m.batch_number || '-'}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold text-[11px]">
                            {m.movement_type}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`inline-flex items-center gap-1 font-bold ${
                              isPositive ? 'text-emerald-700' : 'text-red-600'
                            }`}
                          >
                            {isPositive ? (
                              <ArrowUpCircle className="w-3.5 h-3.5" />
                            ) : (
                              <ArrowDownCircle className="w-3.5 h-3.5" />
                            )}
                            {isPositive ? `+${m.quantity_change}` : m.quantity_change}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-slate-700">
                          {m.previous_stock} → <strong>{m.new_stock}</strong>
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {m.reference_id && (
                            <span className="font-semibold text-sky-700 mr-1.5">
                              [{m.reference_id}]
                            </span>
                          )}
                          {m.reason}
                        </td>
                        <td className="py-3 px-4 text-slate-500">{m.performed_by}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock Adjustment / Purchase Restock Modal */}
      {adjustModalProduct && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Update Stock: {adjustModalProduct.name}
                </h3>
                <p className="text-xs text-slate-500">
                  Current Stock: <strong>{adjustModalProduct.stock}</strong> • Batch:{' '}
                  {adjustModalProduct.batch_number}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustModalProduct(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleStockAdjustmentSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Adjustment / Movement Type *
                </label>
                <select
                  value={movementType}
                  onChange={(e) => setMovementType(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white font-semibold text-slate-800 outline-none"
                >
                  <option value="PURCHASE_RESTOCK">
                    + Add New Purchase / Restock Arrival
                  </option>
                  <option value="MANUAL_ADD">+ Manual Stock Addition (Audit Gain)</option>
                  <option value="MANUAL_DEDUCT">- Manual Stock Deduction (Correction)</option>
                  <option value="DAMAGE_EXPIRY">- Expired / Damaged Stock Write-Off</option>
                  <option value="SET_EXACT">= Set Exact Physical Stock Count</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-sky-800 mb-1">
                    {movementType === 'SET_EXACT'
                      ? 'New Exact Stock Quantity *'
                      : 'Quantity to Add / Deduct *'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="Enter units"
                    className="w-full px-3 py-2 rounded-lg border border-sky-400 font-bold text-sm outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Supplier Bill / Ref No.
                  </label>
                  <input
                    type="text"
                    value={referenceId}
                    onChange={(e) => setReferenceId(e.target.value)}
                    placeholder="e.g., SUP-INV-204"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 outline-none"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="text-[11px] font-bold text-slate-500 uppercase">
                  Optional: Update Batch, Expiry or Prices for this Stock
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-600 mb-1">Batch Number</label>
                    <input
                      type="text"
                      value={batchNumber}
                      onChange={(e) => setBatchNumber(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Expiry Date</label>
                    <input
                      type="date"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-600 mb-1">Purchase ({symbol})</label>
                    <input
                      type="number"
                      step="0.01"
                      value={purchasePrice}
                      onChange={(e) => setPurchasePrice(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-emerald-700 font-semibold mb-1">
                      Selling ({symbol})
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-400 bg-white font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">MRP ({symbol})</label>
                    <input
                      type="number"
                      step="0.01"
                      value={mrp}
                      onChange={(e) => setMrp(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Audit Reason / Notes *
                </label>
                <input
                  type="text"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Enter reason for audit record"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 outline-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setAdjustModalProduct(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-xs cursor-pointer"
                >
                  {submitting ? 'Updating...' : 'Confirm Stock Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

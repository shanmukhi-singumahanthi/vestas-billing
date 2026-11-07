import React, { useState, useMemo, useRef, useDeferredValue, lazy, Suspense } from 'react';
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  Upload,
  Download,
  FileSpreadsheet,
  Package,
  AlertTriangle,
  CheckCircle2,
  X,
  IndianRupee,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { apiRequest } from '../utils/api';
import { idbReplaceAll } from '../utils/offlineDb';
import {
  formatCurrency,
  exportToExcel,
  downloadProductImportTemplate,
  parseSpreadsheetFile,
  exportReportPDF,
} from '../utils/exportAndPdf';

const BillScannerModal = lazy(() => import('./BillScannerModal'));

const EMPTY_PRODUCT = {
  name: '',
  sku: '',
  barcode: '',
  hsn_code: '30049099',
  category: 'Tablets',
  manufacturer: '',
  batch_number: '',
  expiry_date: '2028-06-30',
  pack_size: '10 Tabs / Strip',
  rack_location: '',
  purchase_price: '',
  selling_price: '',
  mrp: '',
  gst_percentage: 12,
  stock: '',
  min_stock_level: 25,
};

export default function ProductsView({ products = [], settings = {}, onRefresh, user }) {
  const isWorker = user?.role === 'worker';
  const symbol = settings?.currency_symbol || '₹';
  const configuredCategories = Array.isArray(settings?.categories)
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
      ];

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  // Add / Edit Product Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [formData, setFormData] = useState(EMPTY_PRODUCT);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Delete Confirmation Modal
  const [deletingProduct, setDeletingProduct] = useState(null);
  const [showBillScanner, setShowBillScanner] = useState(false);

  const fileInputRef = useRef(null);
  const deferredSearch = useDeferredValue(search);

  const filteredProducts = useMemo(() => {
    const now = new Date();
    const ninetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const q = deferredSearch.trim().toLowerCase();

    return products.filter((p) => {
      if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;

      if (statusFilter === 'low') {
        if (!(Number(p.stock) > 0 && Number(p.stock) <= Number(p.min_stock_level))) return false;
      } else if (statusFilter === 'out') {
        if (Number(p.stock) > 0) return false;
      } else if (statusFilter === 'expiring') {
        if (!p.expiry_date) return false;
        const d = new Date(p.expiry_date.length === 7 ? `${p.expiry_date}-28` : p.expiry_date);
        if (d > ninetyDays) return false;
      }

      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.batch_number && p.batch_number.toLowerCase().includes(q)) ||
        (p.manufacturer && p.manufacturer.toLowerCase().includes(q))
      );
    });
  }, [products, deferredSearch, categoryFilter, statusFilter]);

  const openAddModal = () => {
    const nextCode = `MED-${1001 + products.length}`;
    setEditingProduct(null);
    setFormData({
      ...EMPTY_PRODUCT,
      sku: nextCode,
      gst_percentage: settings?.default_gst_rate ?? 12,
      min_stock_level: settings?.low_stock_threshold ?? 25,
    });
    setModalOpen(true);
  };

  const openAddBatchForMedicine = (product) => {
    setEditingProduct(null);
    setFormData({
      name: product.name || '',
      sku: product.sku || '',
      barcode: product.barcode || '',
      hsn_code: product.hsn_code || '3004',
      category: product.category || 'Tablets',
      manufacturer: product.manufacturer || '',
      batch_number: '',
      expiry_date: '2028-12-31',
      pack_size: product.pack_size || '10 Tabs / Strip',
      rack_location: product.rack_location || '',
      purchase_price: product.purchase_price ?? '',
      selling_price: product.selling_price ?? '',
      mrp: product.mrp ?? '',
      gst_percentage: product.gst_percentage ?? 12,
      stock: '',
      min_stock_level: product.min_stock_level ?? 25,
    });
    setModalOpen(true);
  };

  const openEditModal = (product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name || '',
      sku: product.sku || '',
      barcode: product.barcode || '',
      hsn_code: product.hsn_code || '3004',
      category: product.category || 'Tablets',
      manufacturer: product.manufacturer || '',
      batch_number: product.batch_number || '',
      expiry_date: product.expiry_date || '',
      pack_size: product.pack_size || '',
      rack_location: product.rack_location || '',
      purchase_price: product.purchase_price ?? 0,
      selling_price: product.selling_price ?? 0,
      mrp: product.mrp ?? 0,
      gst_percentage: product.gst_percentage ?? 12,
      stock: product.stock ?? 0,
      min_stock_level: product.min_stock_level ?? 20,
    });
    setModalOpen(true);
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      if (editingProduct) {
        await apiRequest(`/api/products/${editingProduct.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
        setFeedback({ type: 'success', text: `Updated "${formData.name}" successfully.` });
      } else {
        await apiRequest('/api/products', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
        setFeedback({ type: 'success', text: `Added "${formData.name}" to inventory.` });
      }
      setModalOpen(false);
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingProduct) return;
    try {
      await apiRequest(`/api/products/${deletingProduct.id}`, { method: 'DELETE' });
      setFeedback({ type: 'success', text: `Deleted "${deletingProduct.name}".` });
      setDeletingProduct(null);
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    try {
      const rows = await parseSpreadsheetFile(file);
      if (!rows || rows.length === 0) {
        setFeedback({ type: 'error', text: 'The selected file contains no rows.' });
        return;
      }
      const res = await apiRequest('/api/products/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ products: rows }),
      });
      setFeedback({
        type: 'success',
        text: res.message || `Imported ${rows.length} medicines successfully.`,
      });
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Failed to import file.' });
    } finally {
      e.target.value = '';
    }
  };

  const [isResetting, setIsResetting] = useState(false);

  const handleResetOfficialCatalog = async () => {
    if (
      !window.confirm(
        'Are you sure you want to load all 27 official Vestas Pharmaceuticals products (items 1-27)? All dummy data, old invoices, customer dues, and financial reports will be completely wiped for a clean fresh start.'
      )
    ) {
      return;
    }
    setIsResetting(true);
    setFeedback(null);
    try {
      const res = await apiRequest('/api/catalog/reset-official', { method: 'POST' });
      try {
        await idbReplaceAll('invoices', []);
        await idbReplaceAll('customers', []);
      } catch {
        // non-blocking for browser offline storage
      }
      setFeedback({
        type: 'success',
        text: res.message || 'All 27 official Vestas products loaded! Invoices and customer dues reset to zero.',
      });
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Failed to reset catalog.' });
    } finally {
      setIsResetting(false);
    }
  };

  const handleExportExcel = () => {
    const rows = filteredProducts.map((p) => {
      const row = {
        'Product Name': p.name,
        'Product Code': p.sku,
        Barcode: p.barcode || '',
        'HSN Code': p.hsn_code || '3004',
        Category: p.category,
        Manufacturer: p.manufacturer,
        'Batch Number': p.batch_number,
        'Expiry Date': p.expiry_date,
        'Pack Size': p.pack_size || '',
        Rack: p.rack_location || '',
      };
      if (!isWorker) {
        row['Purchase Price'] = Number(p.purchase_price);
      }
      row['Selling Price'] = Number(p.selling_price);
      row['MRP'] = Number(p.mrp);
      row['GST %'] = Number(p.gst_percentage);
      row['Available Stock'] = Number(p.stock);
      row['Min Stock'] = Number(p.min_stock_level);
      return row;
    });
    exportToExcel(rows, 'Medicines_Master', 'Vestas_Medicines_Master.xlsx');
  };

  const handleExportPdf = () => {
    const columns = [
      'Code',
      'Medicine Name',
      'Category',
      'Manufacturer',
      'Batch',
      'Expiry',
      ...(!isWorker ? ['Purchase (Rs.)'] : []),
      'Selling (Rs.)',
      'MRP (Rs.)',
      'GST%',
      'Stock',
    ];
    exportReportPDF({
      title: 'Medicine Master & Price List',
      subtitle: `Total Listed Medicines: ${filteredProducts.length}`,
      columns,
      rows: filteredProducts.map((p) => [
        p.sku,
        p.name,
        p.category,
        p.manufacturer || '-',
        p.batch_number,
        p.expiry_date,
        ...(!isWorker ? [Number(p.purchase_price).toFixed(2)] : []),
        Number(p.selling_price).toFixed(2),
        Number(p.mrp).toFixed(2),
        `${p.gst_percentage}%`,
        p.stock,
      ]),
      settings,
      fileName: 'Vestas_Medicine_Master.pdf',
    });
  };

  return (
    <div className="space-y-5">
      {/* Header & Action Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Medicine & Product Master ({products.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Add medicines, update selling & purchase prices, or bulk import your father's Excel/CSV product list
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleImportFile}
            className="hidden"
          />
          {!isWorker && (
            <>
              <button
                type="button"
                onClick={() => downloadProductImportTemplate()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                Import Template
              </button>
              <button
                type="button"
                disabled={isResetting}
                onClick={handleResetOfficialCatalog}
                title="Reload official 13 Vestas medicines price card"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-900 transition cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className={`w-3.5 h-3.5 text-amber-700 ${isResetting ? 'animate-spin' : ''}`} />
                {isResetting ? 'Reloading...' : 'Official Price List'}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 transition cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                Import Excel / CSV
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition cursor-pointer"
          >
            <Download className="w-4 h-4 text-sky-600" />
            Export Excel
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            Export PDF
          </button>
          <button
            type="button"
            onClick={() => setShowBillScanner(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-700 hover:to-sky-700 text-white text-xs font-bold shadow-xs transition cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            Scan Bill Image (Inward Stock)
          </button>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add New Medicine
          </button>
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

      {/* Search & Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by medicine name, code, barcode, batch, or manufacturer..."
            className="w-full pl-10 pr-4 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 focus:border-sky-600 outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-xs font-medium rounded-xl border border-slate-300 bg-white outline-none"
          >
            <option value="All">All Categories</option>
            {configuredCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs font-medium rounded-xl border border-slate-300 bg-white outline-none"
          >
            <option value="All">All Stock Levels</option>
            <option value="low">Low Stock Only</option>
            <option value="out">Out of Stock Only</option>
            <option value="expiring">Expiring / Expired</option>
          </select>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-semibold">Medicine / SKU</th>
                <th className="py-3 px-3 font-semibold">Category & Mfg</th>
                <th className="py-3 px-3 font-semibold">Batch & Expiry</th>
                {!isWorker && <th className="py-3 px-3 font-semibold text-right">Purchase</th>}
                <th className="py-3 px-3 font-semibold text-right">Selling Price</th>
                <th className="py-3 px-3 font-semibold text-right">MRP</th>
                <th className="py-3 px-3 font-semibold text-center">GST %</th>
                <th className="py-3 px-3 font-semibold text-center">Available Stock</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={isWorker ? 8 : 9} className="py-12 text-center text-slate-400">
                    No medicines found matching your filter criteria.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const isOut = Number(p.stock) <= 0;
                  const isLow =
                    Number(p.stock) > 0 && Number(p.stock) <= Number(p.min_stock_level);

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/90 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 text-xs sm:text-sm">{p.name}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Code: <span className="font-mono text-slate-700">{p.sku}</span>
                          {p.pack_size && ` • ${p.pack_size}`}
                          {p.rack_location && ` • Rack: ${p.rack_location}`}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 font-medium text-[11px]">
                          {p.category}
                        </span>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {p.manufacturer || '-'}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-mono font-semibold text-slate-800">
                          {p.batch_number}
                        </div>
                        <div className="text-[11px] text-slate-500">Exp: {p.expiry_date}</div>
                      </td>
                      {!isWorker && (
                        <td className="py-3 px-3 text-right text-slate-600 font-medium">
                          {formatCurrency(p.purchase_price, symbol)}
                        </td>
                      )}
                      <td className="py-3 px-3 text-right font-bold text-emerald-700">
                        {formatCurrency(p.selling_price, symbol)}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-500">
                        {formatCurrency(p.mrp, symbol)}
                      </td>
                      <td className="py-3 px-3 text-center text-slate-600">
                        {Number(p.gst_percentage)}%
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            isOut
                              ? 'bg-red-100 text-red-700'
                              : isLow
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {p.stock} {isOut ? '(Out)' : isLow ? '(Low)' : ''}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openAddBatchForMedicine(p)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold transition cursor-pointer"
                            title="Add another batch for this medicine"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            New Batch
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(p)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold transition cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Edit / Price
                          </button>
                          {!isWorker && (
                            <button
                              type="button"
                              onClick={() => setDeletingProduct(p)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                              title="Delete Medicine Batch"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
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

      {/* Add / Edit Product Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {editingProduct ? `Edit Medicine: ${editingProduct.name}` : 'Add New Medicine'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Medicine / Product Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., TELVEST-40 or PENSEN DSR"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-sky-600 outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Product Code / SKU *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    placeholder="MED-1001"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-sky-600 outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:border-sky-600 outline-none"
                  >
                    {configuredCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Manufacturer</label>
                  <input
                    type="text"
                    value={formData.manufacturer}
                    onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                    placeholder="e.g., Micro Labs / Cipla / Sun Pharma"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-sky-600 outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pack Size</label>
                  <input
                    type="text"
                    value={formData.pack_size}
                    onChange={(e) => setFormData({ ...formData, pack_size: e.target.value })}
                    placeholder="15 Tabs / Strip"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-sky-600 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Batch Number *</label>
                  <input
                    type="text"
                    required
                    value={formData.batch_number}
                    onChange={(e) => setFormData({ ...formData, batch_number: e.target.value })}
                    placeholder="BATCH-01"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-sky-600 outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Expiry Date *</label>
                  <input
                    type="date"
                    required
                    value={formData.expiry_date}
                    onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-sky-600 outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">HSN Code</label>
                  <input
                    type="text"
                    value={formData.hsn_code}
                    onChange={(e) => setFormData({ ...formData, hsn_code: e.target.value })}
                    placeholder="30049099"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-sky-600 outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Barcode / Rack</label>
                  <input
                    type="text"
                    value={formData.barcode}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    placeholder="Barcode No."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-sky-600 outline-none"
                  />
                </div>
              </div>

              {/* Pricing & Stock Row */}
              <div className={`p-4 rounded-xl bg-sky-50/60 border border-sky-100 grid grid-cols-2 ${isWorker ? 'sm:grid-cols-5' : 'sm:grid-cols-6'} gap-3`}>
                {!isWorker && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Purchase ({symbol}) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={formData.purchase_price}
                      onChange={(e) => setFormData({ ...formData, purchase_price: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:border-sky-600 outline-none font-semibold"
                    />
                  </div>
                )}

                <div>
                  <label className="block font-bold text-emerald-800 mb-1">
                    Selling ({symbol}) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={formData.selling_price}
                    onChange={(e) => setFormData({ ...formData, selling_price: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-emerald-400 bg-white focus:border-emerald-600 outline-none font-bold text-emerald-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">MRP ({symbol}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={formData.mrp}
                    onChange={(e) => setFormData({ ...formData, mrp: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:border-sky-600 outline-none font-semibold"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">GST %</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="28"
                    value={formData.gst_percentage}
                    onChange={(e) => setFormData({ ...formData, gst_percentage: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:border-sky-600 outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-sky-800 mb-1">Stock Qty *</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-sky-400 bg-white focus:border-sky-600 outline-none font-bold text-sky-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Min Alert</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.min_stock_level}
                    onChange={(e) => setFormData({ ...formData, min_stock_level: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:border-sky-600 outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold shadow-xs cursor-pointer"
                >
                  {saving
                    ? 'Saving...'
                    : editingProduct
                    ? 'Save Product Changes'
                    : 'Add Medicine to Inventory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingProduct && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-6">
            <div className="w-11 h-11 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">
              Delete Medicine "{deletingProduct.name}"?
            </h3>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              This will permanently remove <strong>{deletingProduct.name}</strong> (SKU:{' '}
              {deletingProduct.sku}, Batch: {deletingProduct.batch_number}) from active inventory.
              Past invoices containing this medicine will remain intact.
            </p>
            <div className="flex justify-end gap-2.5 mt-6">
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-xs font-bold text-white cursor-pointer"
              >
                Yes, Delete Medicine
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Bill Scanner & Batch Inward Modal */}
      {showBillScanner && (
        <Suspense fallback={null}>
          <BillScannerModal
            settings={settings}
            onClose={() => setShowBillScanner(false)}
            onStockUpdated={onRefresh}
          />
        </Suspense>
      )}
    </div>
  );
}

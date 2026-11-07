import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Plus,
  Trash2,
  ShoppingBag,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Barcode,
  User,
  Eye,
  Edit3,
  Layers,
  Sparkles,
} from 'lucide-react';
import BillScannerModal from './BillScannerModal';
import { apiRequest } from '../utils/api';
import { formatCurrency } from '../utils/exportAndPdf';

export default function BillingView({
  products = [],
  customers = [],
  settings = {},
  onBillCreated,
  onPreviewInvoice,
  onRefresh,
}) {
  const symbol = settings?.currency_symbol || '₹';
  const paymentMethods = Array.isArray(settings?.payment_methods)
    ? settings.payment_methods
    : ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Credit'];

  const [nextInvoiceNo, setNextInvoiceNo] = useState('VP-1001');
  const [customInvoiceNo, setCustomInvoiceNo] = useState('');
  const [invoiceDateMode, setInvoiceDateMode] = useState('live'); // 'live' | 'custom'
  const [customInvoiceDate, setCustomInvoiceDate] = useState(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
      now.getHours()
    )}:${pad(now.getMinutes())}`;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // Cart items
  const [cart, setCart] = useState([]);

  const [showBillScanner, setShowBillScanner] = useState(false);

  // Manual Medicine / New Batch Entry Form inside Billing
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualItem, setManualItem] = useState({
    name: '',
    sku: '',
    batch_number: '',
    expiry_date: '2028-06-30',
    quantity: 1,
    purchase_price: '',
    selling_price: '',
    mrp: '',
    item_discount_percent: 0,
    gst_percentage: 12,
    stock: 50,
    save_to_inventory: true,
  });

  // Customer selection (Optional — never compulsory)
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerGstin, setCustomerGstin] = useState('');
  const [customerDl, setCustomerDl] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [showExtraCustomerFields, setShowExtraCustomerFields] = useState(false);

  // Tax & Discount controls
  const [enableGst, setEnableGst] = useState(settings?.enable_gst !== false);
  const [taxInclusive, setTaxInclusive] = useState(Boolean(settings?.tax_inclusive));
  const [discountType, setDiscountType] = useState('amount'); // 'amount' | 'percent'
  const [discountValue, setDiscountValue] = useState('');

  // Payment controls
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [customAmountPaid, setCustomAmountPaid] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setEnableGst(settings?.enable_gst !== false);
    setTaxInclusive(Boolean(settings?.tax_inclusive));
  }, [settings]);

  const fetchNextNumber = async () => {
    try {
      const res = await apiRequest('/api/invoices/next-number');
      if (res.invoiceNumber) setNextInvoiceNo(res.invoiceNumber);
    } catch {
      // fallback
    }
  };

  useEffect(() => {
    fetchNextNumber();
  }, [products]);

  const categories = useMemo(() => {
    const set = new Set(['All']);
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (selectedCategory !== 'All' && p.category !== selectedCategory) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.batch_number && p.batch_number.toLowerCase().includes(q)) ||
        (p.manufacturer && p.manufacturer.toLowerCase().includes(q))
      );
    });
  }, [products, searchQuery, selectedCategory]);

  const handleSelectExistingCustomer = (custId) => {
    setSelectedCustomerId(custId);
    if (!custId) {
      setCustomerName('');
      setCustomerPhone('');
      setCustomerAddress('');
      setCustomerGstin('');
      setCustomerDl('');
      return;
    }
    const found = customers.find((c) => String(c.id) === String(custId));
    if (found) {
      setCustomerName(found.name);
      setCustomerPhone(found.phone || '');
      setCustomerAddress(found.address || '');
      setCustomerGstin(found.gstin || '');
      setCustomerDl(found.dl_number || '');
    }
  };

  const addProductBatchToBill = (product) => {
    setError('');
    const availStock = Number(product.stock || 0);
    if (availStock <= 0) {
      setError(
        `"${product.name}" (Batch: ${product.batch_number}) has 0 stock. Please select another batch or add stock.`
      );
      return;
    }

    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.product_id === product.id);
      if (existingIndex > -1) {
        const currentQty = prev[existingIndex].quantity;
        if (currentQty + 1 > availStock) {
          setError(
            `Cannot add more of "${product.name}" (Batch: ${product.batch_number}). Max available in this batch: ${availStock}.`
          );
          return prev;
        }
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: currentQty + 1,
        };
        return updated;
      }

      return [
        ...prev,
        {
          row_uid: `row-${product.id}-${Date.now()}`,
          product_id: product.id,
          client_uid: product.client_uid || null,
          product_name: product.name,
          sku: product.sku,
          hsn_code: product.hsn_code || '3004',
          batch_number: product.batch_number,
          expiry_date: product.expiry_date,
          pack_size: product.pack_size || '',
          available_stock: availStock,
          quantity: 1,
          free_quantity: 0,
          purchase_price: Number(product.purchase_price || 0),
          mrp: Number(product.mrp || product.selling_price),
          unit_price: Number(product.selling_price),
          item_discount_percent: 0,
          gst_percentage: Number(product.gst_percentage ?? settings?.default_gst_rate ?? 12),
        },
      ];
    });
  };

  const handleAddManualItem = async (e) => {
    e.preventDefault();
    setError('');
    const cleanName = manualItem.name.trim();
    const cleanBatch = manualItem.batch_number.trim();
    const qty = Math.max(1, parseInt(manualItem.quantity || 1, 10));
    const sellPrice = Math.max(0, parseFloat(manualItem.selling_price || 0));
    const purchPrice = Math.max(0, parseFloat(manualItem.purchase_price || 0));
    const mrpVal = Math.max(0, parseFloat(manualItem.mrp || sellPrice));
    const stockQty = Math.max(qty, parseInt(manualItem.stock || qty, 10));

    if (!cleanName || !cleanBatch) {
      setError('Please enter Medicine Name and Batch Number.');
      return;
    }

    let createdBatch = null;
    if (manualItem.save_to_inventory) {
      try {
        createdBatch = await apiRequest('/api/products', {
          method: 'POST',
          body: JSON.stringify({
            name: cleanName,
            sku: manualItem.sku.trim() || `MED-${Date.now().toString().slice(-4)}`,
            batch_number: cleanBatch,
            expiry_date: manualItem.expiry_date || '2028-12-31',
            purchase_price: purchPrice,
            selling_price: sellPrice,
            mrp: mrpVal,
            gst_percentage: parseFloat(manualItem.gst_percentage || 12),
            stock: stockQty,
            min_stock_level: 20,
          }),
        });
        if (onRefresh) onRefresh();
      } catch (err) {
        // If batch already exists, let user know or still add to bill
        setError(err.message);
        return;
      }
    }

    setCart((prev) => [
      ...prev,
      {
        row_uid: `manual-${Date.now()}`,
        product_id: createdBatch ? createdBatch.id : `manual-${Date.now()}`,
        client_uid: createdBatch?.client_uid || null,
        product_name: cleanName,
        sku: createdBatch?.sku || manualItem.sku || 'MANUAL',
        hsn_code: '3004',
        batch_number: cleanBatch,
        expiry_date: manualItem.expiry_date || '2028-12-31',
        pack_size: '10 Tabs',
        available_stock: createdBatch ? Number(createdBatch.stock) : 9999,
        quantity: qty,
        purchase_price: purchPrice,
        mrp: mrpVal,
        unit_price: sellPrice,
        item_discount_percent: parseFloat(manualItem.item_discount_percent || 0),
        gst_percentage: parseFloat(manualItem.gst_percentage || 12),
      },
    ]);

    setManualItem({
      name: '',
      sku: '',
      batch_number: '',
      expiry_date: '2028-06-30',
      quantity: 1,
      purchase_price: '',
      selling_price: '',
      mrp: '',
      item_discount_percent: 0,
      gst_percentage: 12,
      stock: 50,
      save_to_inventory: true,
    });
    setShowManualEntry(false);
  };

  const updateCartItem = (rowUid, field, value) => {
    setError('');
    setCart((prev) =>
      prev.map((item) => {
        if (item.row_uid !== rowUid) return item;
        if (field === 'quantity') {
          const val = parseInt(value, 10);
          if (isNaN(val) || val < 1) return { ...item, quantity: 1 };
          if (val > item.available_stock) {
            setError(
              `Only ${item.available_stock} units of "${item.product_name}" (Batch: ${item.batch_number}) are available.`
            );
            return { ...item, quantity: item.available_stock };
          }
          return { ...item, quantity: val };
        }
        if (field === 'free_quantity') {
          const val = parseInt(value, 10);
          return { ...item, free_quantity: isNaN(val) || val < 0 ? 0 : val };
        }
        if (field === 'unit_price' || field === 'mrp' || field === 'purchase_price') {
          const val = parseFloat(value);
          return { ...item, [field]: isNaN(val) || val < 0 ? 0 : val };
        }
        if (field === 'item_discount_percent') {
          const val = parseFloat(value);
          return {
            ...item,
            item_discount_percent: isNaN(val) ? 0 : Math.max(0, Math.min(100, val)),
          };
        }
        if (field === 'gst_percentage') {
          const val = parseFloat(value);
          return { ...item, gst_percentage: isNaN(val) || val < 0 ? 0 : val };
        }
        return { ...item, [field]: value };
      })
    );
  };

  const removeCartItem = (rowUid) => {
    setCart((prev) => prev.filter((item) => item.row_uid !== rowUid));
  };

  const clearBill = () => {
    setCart([]);
    setSelectedCustomerId('');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setCustomerGstin('');
    setCustomerDl('');
    setDoctorName('');
    setDiscountValue('');
    setCustomAmountPaid('');
    setCustomInvoiceNo('');
    setInvoiceDateMode('live');
    setNotes('');
    setError('');
  };

  // Real-time Bill Calculations
  const calculations = useMemo(() => {
    let subtotal = 0;
    let totalItemTax = 0;

    const computedItems = cart.map((item) => {
      const qty = Number(item.quantity || 1);
      const unitPrice = Number(item.unit_price || 0);
      const itemDiscPct = Number(item.item_discount_percent || 0);
      const gross = unitPrice * qty;
      const itemDiscAmt = +(gross * (itemDiscPct / 100)).toFixed(2);
      const afterItemDisc = +(gross - itemDiscAmt).toFixed(2);

      const gstPct = enableGst ? Number(item.gst_percentage || 0) : 0;
      let taxable = afterItemDisc;
      let gstAmt = 0;
      let lineTotal = afterItemDisc;

      if (enableGst && gstPct > 0) {
        if (taxInclusive) {
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

      return {
        ...item,
        taxable_amount: taxable,
        gst_amount: gstAmt,
        line_total: lineTotal,
      };
    });

    subtotal = +subtotal.toFixed(2);

    const discVal = Math.max(0, parseFloat(discountValue || 0));
    let billDiscountAmount = 0;
    if (discountType === 'percent') {
      billDiscountAmount = +(subtotal * (Math.min(100, discVal) / 100)).toFixed(2);
    } else {
      billDiscountAmount = Math.min(subtotal, +discVal.toFixed(2));
    }

    const discountRatio = subtotal > 0 ? (subtotal - billDiscountAmount) / subtotal : 1;
    const taxAmount = +(totalItemTax * discountRatio).toFixed(2);
    const exactGrandTotal = +(subtotal - billDiscountAmount + taxAmount).toFixed(2);
    const grandTotal = Math.round(exactGrandTotal);
    const roundOff = +(grandTotal - exactGrandTotal).toFixed(2);

    const effectivePaid =
      customAmountPaid !== ''
        ? Math.max(0, parseFloat(customAmountPaid) || 0)
        : paymentMethod === 'Credit'
        ? 0
        : grandTotal;

    const balanceDue = Math.max(0, +(grandTotal - effectivePaid).toFixed(2));
    const totalUnits = cart.reduce(
      (sum, it) => sum + (Number(it.quantity) || 0) + (Number(it.free_quantity) || 0),
      0
    );

    return {
      computedItems,
      subtotal,
      billDiscountAmount,
      taxAmount,
      roundOff,
      grandTotal,
      effectivePaid,
      balanceDue,
      totalUnits,
    };
  }, [cart, enableGst, taxInclusive, discountType, discountValue, customAmountPaid, paymentMethod]);

  const effectiveInvoiceCreatedAt = () => {
    if (invoiceDateMode === 'custom' && customInvoiceDate) {
      const parsed = new Date(customInvoiceDate);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return new Date().toISOString();
  };

  const handlePreviewDraftBill = () => {
    if (cart.length === 0) {
      setError('Add at least one medicine to preview the invoice.');
      return;
    }
    const effNo = customInvoiceNo.trim() || nextInvoiceNo;
    const draftInvoice = {
      invoice_number: `${effNo} (PREVIEW)`,
      customer_name: customerName.trim() || 'Walk-in Customer',
      customer_phone: customerPhone,
      customer_address: customerAddress,
      customer_gstin: customerGstin,
      customer_dl: customerDl,
      doctor_name: doctorName,
      subtotal: calculations.subtotal,
      discount_amount: calculations.billDiscountAmount,
      tax_amount: calculations.taxAmount,
      round_off: calculations.roundOff,
      grand_total: calculations.grandTotal,
      payment_method: paymentMethod,
      payment_status: calculations.balanceDue > 0 ? 'Partial / Credit' : 'Paid',
      amount_paid: calculations.effectivePaid,
      balance_due: calculations.balanceDue,
      created_at: effectiveInvoiceCreatedAt(),
      items: calculations.computedItems,
    };
    if (onPreviewInvoice) onPreviewInvoice(draftInvoice);
  };

  const handleSaveAndGenerateInvoice = async () => {
    setError('');
    if (cart.length === 0) {
      setError('Please add at least one medicine to the bill before finalizing.');
      return;
    }

    setSubmitting(true);
    try {
      const clientInvoiceUid = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const savedInvoice = await apiRequest('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          client_invoice_uid: clientInvoiceUid,
          invoice_number: customInvoiceNo.trim() || undefined,
          customer_id: selectedCustomerId || null,
          customer_name: customerName.trim() || 'Walk-in Customer',
          customer_phone: customerPhone,
          customer_address: customerAddress,
          customer_gstin: customerGstin,
          customer_dl: customerDl,
          doctor_name: doctorName,
          items: cart,
          discount_type: discountType,
          discount_value: parseFloat(discountValue || 0),
          enable_gst: enableGst,
          tax_inclusive: taxInclusive,
          payment_method: paymentMethod,
          amount_paid: calculations.effectivePaid,
          notes,
          created_at: effectiveInvoiceCreatedAt(),
        }),
      });

      clearBill();
      await fetchNextNumber();
      if (onBillCreated) {
        onBillCreated(savedInvoice);
      }
    } catch (err) {
      setError(err.message || 'Failed to save bill.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* LEFT PANEL: Multi-Batch Medicine Search & Manual Entry (5 cols on XL) */}
      <div className="xl:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col max-h-[860px]">
        <div className="p-4 border-b border-slate-200 bg-slate-50/70">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-600" />
              Select Medicine Batch ({filteredProducts.length})
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowBillScanner(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-700 hover:to-sky-700 text-white text-xs font-bold transition cursor-pointer"
                title="Scan Bill Image & Inward Batches"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                Scan Bill Image
              </button>
              <button
                type="button"
                onClick={() => setShowManualEntry(!showManualEntry)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                {showManualEntry ? 'Close' : 'Manual Entry'}
              </button>
            </div>
          </div>

          {/* Manual Medicine / New Batch Entry Form */}
          {showManualEntry && (
            <form
              onSubmit={handleAddManualItem}
              className="mb-3 p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-2.5 text-xs"
            >
              <div className="font-bold text-emerald-900">
                Manually Type Medicine & Batch Details
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={manualItem.name}
                  onChange={(e) => setManualItem({ ...manualItem, name: e.target.value })}
                  placeholder="Medicine Name *"
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white outline-none font-semibold"
                />
                <input
                  type="text"
                  required
                  value={manualItem.batch_number}
                  onChange={(e) => setManualItem({ ...manualItem, batch_number: e.target.value })}
                  placeholder="Batch Number *"
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white outline-none font-mono"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-500">Expiry Date *</label>
                  <input
                    type="text"
                    required
                    value={manualItem.expiry_date}
                    onChange={(e) => setManualItem({ ...manualItem, expiry_date: e.target.value })}
                    placeholder="YYYY-MM-DD"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500">Purchase ({symbol})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={manualItem.purchase_price}
                    onChange={(e) =>
                      setManualItem({ ...manualItem, purchase_price: e.target.value })
                    }
                    placeholder="0.00"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-emerald-800">
                    Selling ({symbol}) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={manualItem.selling_price}
                    onChange={(e) =>
                      setManualItem({ ...manualItem, selling_price: e.target.value })
                    }
                    placeholder="0.00"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-400 bg-white font-bold outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-500">MRP ({symbol})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={manualItem.mrp}
                    onChange={(e) => setManualItem({ ...manualItem, mrp: e.target.value })}
                    placeholder="MRP"
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-sky-800">Bill Qty *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={manualItem.quantity}
                    onChange={(e) => setManualItem({ ...manualItem, quantity: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg border border-sky-400 bg-white font-bold outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500">Disc %</label>
                  <input
                    type="number"
                    step="0.5"
                    value={manualItem.item_discount_percent}
                    onChange={(e) =>
                      setManualItem({ ...manualItem, item_discount_percent: e.target.value })
                    }
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500">Batch Stock</label>
                  <input
                    type="number"
                    min="1"
                    value={manualItem.stock}
                    onChange={(e) => setManualItem({ ...manualItem, stock: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={manualItem.save_to_inventory}
                    onChange={(e) =>
                      setManualItem({ ...manualItem, save_to_inventory: e.target.checked })
                    }
                  />
                  Also save as new batch in Inventory
                </label>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                >
                  + Add to Bill
                </button>
              </div>
            </form>
          )}

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search medicine name, batch number, code/SKU..."
              className="w-full pl-10 pr-4 py-2.5 text-xs sm:text-sm bg-white rounded-xl border border-slate-300 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pt-3 pb-1">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 transition cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-sky-600 text-white'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-slate-100 overflow-y-auto flex-1 p-2">
          {filteredProducts.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No medicine batches match "{searchQuery}". Click "Manual Medicine / Batch" above to enter it directly.
            </div>
          ) : (
            filteredProducts.map((product) => {
              const outOfStock = Number(product.stock) <= 0;
              const lowStock =
                Number(product.stock) > 0 &&
                Number(product.stock) <= Number(product.min_stock_level);
              const inCartItem = cart.find((c) => c.product_id === product.id);

              return (
                <div
                  key={product.id}
                  onClick={() => !outOfStock && addProductBatchToBill(product)}
                  className={`p-3 rounded-xl flex items-center justify-between gap-3 transition ${
                    outOfStock
                      ? 'opacity-55 bg-slate-50 cursor-not-allowed'
                      : 'hover:bg-sky-50/70 cursor-pointer'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-xs sm:text-sm text-slate-900 truncate">
                        {product.name}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-mono text-[11px] font-bold">
                        Batch: {product.batch_number}
                      </span>
                      {inCartItem && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800">
                          In Bill: {inCartItem.quantity}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-x-2.5">
                      <span>Exp: {product.expiry_date}</span>
                      <span>MRP: {formatCurrency(product.mrp, symbol)}</span>
                      <span>Code: {product.sku}</span>
                    </div>
                  </div>

                  <div className="text-right shrink-0 flex items-center gap-3">
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        {formatCurrency(product.selling_price, symbol)}
                      </div>
                      <div
                        className={`text-[11px] font-semibold ${
                          outOfStock
                            ? 'text-red-600'
                            : lowStock
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                        }`}
                      >
                        {outOfStock ? 'Out of Stock' : `Stock: ${product.stock}`}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={outOfStock}
                      onClick={(e) => {
                        e.stopPropagation();
                        addProductBatchToBill(product);
                      }}
                      className="w-8 h-8 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white flex items-center justify-center shadow-2xs transition cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT PANEL: Active POS Bill & Checkout (7 cols on XL) */}
      <div className="xl:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col">
        {/* Bill Header */}
        <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-600 text-white flex items-center justify-center">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                New Customer Bill / Tax Invoice
              </h3>
              <p className="text-xs text-slate-500">
                Auto Invoice No:{' '}
                <span className="font-bold text-sky-700">{nextInvoiceNo}</span> • All fields
                support direct manual typing
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePreviewDraftBill}
              disabled={cart.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 disabled:opacity-50 transition cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              Preview Bill
            </button>
            <button
              type="button"
              onClick={clearBill}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Invoice Number & Date Selection (Supports Live Up-to-Date or Any Previous Day, Month, or Year) */}
          <div className="bg-sky-50/60 rounded-xl p-3.5 border border-sky-200/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Invoice Number (Auto or Manual)
              </label>
              <input
                type="text"
                value={customInvoiceNo}
                onChange={(e) => setCustomInvoiceNo(e.target.value)}
                placeholder={`Auto: ${nextInvoiceNo}`}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-bold text-sky-800 focus:border-sky-600 outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Invoice Date Mode
              </label>
              <select
                value={invoiceDateMode}
                onChange={(e) => setInvoiceDateMode(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold text-slate-800 focus:border-sky-600 outline-none"
              >
                <option value="live">Up to Date (Live Current Date & Time)</option>
                <option value="custom">Select Previous Day, Month, or Year</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                {invoiceDateMode === 'live' ? 'Current Invoice Timestamp' : 'Choose Date & Time'}
              </label>
              {invoiceDateMode === 'live' ? (
                <div className="px-3 py-1.5 rounded-lg bg-white border border-emerald-200 text-emerald-800 font-semibold flex items-center justify-between">
                  <span>Live / Up-to-Date</span>
                  <button
                    type="button"
                    onClick={() => setInvoiceDateMode('custom')}
                    className="text-[11px] text-sky-600 hover:underline font-bold cursor-pointer"
                  >
                    Change Date
                  </button>
                </div>
              ) : (
                <input
                  type="datetime-local"
                  value={customInvoiceDate}
                  onChange={(e) => setCustomInvoiceDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-sky-400 bg-white font-semibold text-slate-900 outline-none"
                />
              )}
            </div>
          </div>

          {/* Customer Details (Optional — Never Compulsory) */}
          <div className="bg-slate-50/80 rounded-xl p-4 border border-slate-200/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-sky-600" />
                Customer Information (Optional — Leave blank for Walk-in Customer)
              </span>
              <button
                type="button"
                onClick={() => setShowExtraCustomerFields(!showExtraCustomerFields)}
                className="text-xs font-semibold text-sky-600 hover:text-sky-800 cursor-pointer"
              >
                {showExtraCustomerFields
                  ? 'Hide Wholesale / Doctor Fields'
                  : '+ Add GSTIN / Drug License / Doctor Name'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  Quick Fill Saved Customer (Optional)
                </label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => handleSelectExistingCustomer(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:border-sky-600 outline-none"
                >
                  <option value="">-- Direct Walk-in / Manual Type --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  Customer Name (Optional — Type Directly)
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Walk-in Customer (or type name)"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:border-sky-600 outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  Phone Number (Optional)
                </label>
                <input
                  type="text"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="Optional Mobile No."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:border-sky-600 outline-none"
                />
              </div>
            </div>

            {showExtraCustomerFields && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-200/70">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Customer Address
                  </label>
                  <input
                    type="text"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="City / Street Address"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Customer GSTIN
                  </label>
                  <input
                    type="text"
                    value={customerGstin}
                    onChange={(e) => setCustomerGstin(e.target.value)}
                    placeholder="Optional GSTIN"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Buyer Drug License
                  </label>
                  <input
                    type="text"
                    value={customerDl}
                    onChange={(e) => setCustomerDl(e.target.value)}
                    placeholder="Optional DL No."
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Prescribed By (Doctor)
                  </label>
                  <input
                    type="text"
                    value={doctorName}
                    onChange={(e) => setDoctorName(e.target.value)}
                    placeholder="Dr. Name (Optional)"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Editable Line Items Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-700 uppercase border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-2.5 font-semibold min-w-[160px]">
                      Medicine Name
                    </th>
                    <th className="py-2.5 px-2 font-semibold w-28">Batch & Exp</th>
                    <th className="py-2.5 px-1 font-semibold text-center w-14">Qty</th>
                    <th className="py-2.5 px-1 font-semibold text-center w-14 text-emerald-700 bg-emerald-50">Free</th>
                    <th className="py-2.5 px-1.5 font-semibold text-right w-20">MRP</th>
                    <th className="py-2.5 px-1.5 font-semibold text-right w-22">
                      Rate ({symbol})
                    </th>
                    <th className="py-2.5 px-1.5 font-semibold text-right w-16">Disc%</th>
                    {enableGst && (
                      <th className="py-2.5 px-1.5 font-semibold text-right w-16">GST%</th>
                    )}
                    <th className="py-2.5 px-2.5 font-semibold text-right">Total</th>
                    <th className="py-2.5 px-1.5 text-center w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {calculations.computedItems.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        Click a medicine batch on the left or click "Manual Medicine / Batch" to type directly.
                      </td>
                    </tr>
                  ) : (
                    calculations.computedItems.map((item) => (
                      <tr key={item.row_uid} className="hover:bg-slate-50">
                        <td className="py-2 px-2.5">
                          <input
                            type="text"
                            value={item.product_name}
                            onChange={(e) =>
                              updateCartItem(item.row_uid, 'product_name', e.target.value)
                            }
                            className="w-full px-2 py-1 font-bold text-slate-900 rounded-lg border border-slate-200 focus:border-sky-600 outline-none"
                          />
                          <div className="text-[10px] text-slate-400 mt-0.5 pl-1">
                            Max Avail: {item.available_stock}
                          </div>
                        </td>
                        <td className="py-2 px-2 space-y-1">
                          <input
                            type="text"
                            value={item.batch_number}
                            onChange={(e) =>
                              updateCartItem(item.row_uid, 'batch_number', e.target.value)
                            }
                            placeholder="Batch"
                            className="w-24 px-1.5 py-0.5 font-mono text-[11px] rounded border border-slate-200 focus:border-sky-600 outline-none"
                          />
                          <input
                            type="text"
                            value={item.expiry_date}
                            onChange={(e) =>
                              updateCartItem(item.row_uid, 'expiry_date', e.target.value)
                            }
                            placeholder="YYYY-MM-DD"
                            className="w-24 px-1.5 py-0.5 text-[10px] text-slate-600 rounded border border-slate-200 focus:border-sky-600 outline-none"
                          />
                        </td>
                        <td className="py-2 px-1 text-center">
                          <input
                            type="number"
                            min="1"
                            max={item.available_stock}
                            value={item.quantity}
                            onChange={(e) =>
                              updateCartItem(item.row_uid, 'quantity', e.target.value)
                            }
                            className="w-12 px-1 py-1 text-center font-bold rounded-lg border border-slate-300 focus:border-sky-600 outline-none"
                          />
                        </td>
                        <td className="py-2 px-1 text-center">
                          <input
                            type="number"
                            min="0"
                            value={item.free_quantity || 0}
                            onChange={(e) =>
                              updateCartItem(item.row_uid, 'free_quantity', e.target.value)
                            }
                            className="w-12 px-1 py-1 text-center font-bold rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 focus:border-emerald-600 outline-none"
                          />
                        </td>
                        <td className="py-2 px-1.5 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.mrp}
                            onChange={(e) => updateCartItem(item.row_uid, 'mrp', e.target.value)}
                            className="w-16 px-1.5 py-1 text-right text-slate-600 rounded-lg border border-slate-200 focus:border-sky-600 outline-none"
                          />
                        </td>
                        <td className="py-2 px-1.5 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.unit_price}
                            onChange={(e) =>
                              updateCartItem(item.row_uid, 'unit_price', e.target.value)
                            }
                            className="w-18 px-1.5 py-1 text-right font-bold text-emerald-800 rounded-lg border border-emerald-300 focus:border-emerald-600 outline-none"
                          />
                        </td>
                        <td className="py-2 px-1.5 text-right">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="100"
                            value={item.item_discount_percent}
                            onChange={(e) =>
                              updateCartItem(
                                item.row_uid,
                                'item_discount_percent',
                                e.target.value
                              )
                            }
                            className="w-14 px-1.5 py-1 text-right rounded-lg border border-slate-300 focus:border-sky-600 outline-none"
                          />
                        </td>
                        {enableGst && (
                          <td className="py-2 px-1.5 text-right">
                            <input
                              type="number"
                              step="1"
                              min="0"
                              max="28"
                              value={item.gst_percentage}
                              onChange={(e) =>
                                updateCartItem(item.row_uid, 'gst_percentage', e.target.value)
                              }
                              className="w-14 px-1.5 py-1 text-right rounded-lg border border-slate-300 focus:border-sky-600 outline-none"
                            />
                          </td>
                        )}
                        <td className="py-2 px-2.5 text-right font-bold text-slate-900">
                          {formatCurrency(item.line_total, symbol)}
                        </td>
                        <td className="py-2 px-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeCartItem(item.row_uid)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                            title="Remove item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Discounts, Tax Settings & Payment Summary */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 pt-2">
            <div className="md:col-span-6 space-y-3.5 text-xs">
              <div className="flex flex-wrap items-center gap-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <label className="inline-flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableGst}
                    onChange={(e) => setEnableGst(e.target.checked)}
                    className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  Apply GST Tax
                </label>

                {enableGst && (
                  <label className="inline-flex items-center gap-2 font-medium text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={taxInclusive}
                      onChange={(e) => setTaxInclusive(e.target.checked)}
                      className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    Rates are GST-Inclusive
                  </label>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  Additional Bill Discount (Editable)
                </label>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg border border-slate-300 p-0.5 bg-slate-50">
                    <button
                      type="button"
                      onClick={() => setDiscountType('amount')}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                        discountType === 'amount' ? 'bg-sky-600 text-white' : 'text-slate-600'
                      }`}
                    >
                      {symbol} Flat
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscountType('percent')}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                        discountType === 'percent' ? 'bg-sky-600 text-white' : 'text-slate-600'
                      }`}
                    >
                      % Percent
                    </button>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder={discountType === 'percent' ? 'Discount %' : 'Discount Amount'}
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-300 focus:border-sky-600 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Payment Method
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold text-slate-800 focus:border-sky-600 outline-none"
                  >
                    {paymentMethods.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Amount Paid ({symbol})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customAmountPaid}
                    onChange={(e) => setCustomAmountPaid(e.target.value)}
                    placeholder={`Default: ${calculations.grandTotal}`}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-sky-600 outline-none font-semibold"
                  />
                </div>
              </div>
            </div>

            {/* Right Summary Box */}
            <div className="md:col-span-6 bg-slate-50 rounded-2xl p-4 border border-slate-200 flex flex-col justify-between">
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Taxable Subtotal ({cart.length} items):</span>
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(calculations.subtotal, symbol)}
                  </span>
                </div>
                {calculations.billDiscountAmount > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Bill Discount:</span>
                    <span className="font-semibold">
                      - {formatCurrency(calculations.billDiscountAmount, symbol)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600">
                  <span>GST Tax (CGST + SGST):</span>
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(calculations.taxAmount, symbol)}
                  </span>
                </div>
                {calculations.roundOff !== 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>Round Off:</span>
                    <span>{formatCurrency(calculations.roundOff, symbol)}</span>
                  </div>
                )}

                <div className="pt-2.5 border-t border-slate-200 flex justify-between items-baseline">
                  <span className="text-sm font-bold text-slate-900">GRAND TOTAL:</span>
                  <span className="text-2xl font-bold text-sky-700">
                    {formatCurrency(calculations.grandTotal, symbol)}
                  </span>
                </div>

                {calculations.balanceDue > 0 && (
                  <div className="flex justify-between text-red-600 font-semibold pt-1">
                    <span>Balance Due (Credit):</span>
                    <span>{formatCurrency(calculations.balanceDue, symbol)}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  disabled={cart.length === 0}
                  onClick={handlePreviewDraftBill}
                  className="py-3 px-3.5 rounded-xl border border-sky-300 bg-white hover:bg-sky-50 disabled:opacity-50 text-sky-700 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Eye className="w-4 h-4" />
                  Preview
                </button>
                <button
                  type="button"
                  disabled={submitting || cart.length === 0}
                  onClick={handleSaveAndGenerateInvoice}
                  className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold text-sm shadow-sm flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  {submitting
                    ? 'Saving Invoice...'
                    : `Save & Print Invoice (${formatCurrency(calculations.grandTotal, symbol)})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bill Scanner & Batch Inward Modal */}
      {showBillScanner && (
        <BillScannerModal
          settings={settings}
          onClose={() => setShowBillScanner(false)}
          onStockUpdated={onRefresh}
        />
      )}
    </div>
  );
}

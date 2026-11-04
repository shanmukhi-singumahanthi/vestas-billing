import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Printer,
  Download,
  FileSpreadsheet,
  Calendar,
  FileText,
  Receipt,
  Edit3,
  Clock,
  Layers,
  CheckCircle2,
  X,
} from 'lucide-react';
import { apiRequest } from '../utils/api';
import {
  formatCurrency,
  formatDateTime,
  downloadInvoicePDF,
  exportToExcel,
  exportReportPDF,
} from '../utils/exportAndPdf';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export default function InvoicesView({ settings = {}, onViewInvoice }) {
  const symbol = settings?.currency_symbol || '₹';
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);

  // View Mode: 'list' | 'daily' | 'monthly' | 'yearly'
  const [viewMode, setViewMode] = useState('list');

  // Period Preset: 'all' | 'today' | 'yesterday' | 'last7days' | 'thisMonth' | 'prevMonth' | 'thisYear' | 'prevYears'
  const [periodPreset, setPeriodPreset] = useState('all');
  const [selectedYear, setSelectedYear] = useState('All');
  const [selectedMonth, setSelectedMonth] = useState('All'); // 'All' or '0'..'11'
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [methodFilter, setMethodFilter] = useState('All');

  // Edit Invoice Modal (Date / Customer / Payment Status)
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [editForm, setEditForm] = useState({
    invoice_number: '',
    customer_name: '',
    customer_phone: '',
    payment_method: 'Cash',
    payment_status: 'Paid',
    amount_paid: '',
    created_at_local: '',
    notes: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const loadInvoices = async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/api/invoices');
      setInvoices(data || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, []);

  // Available Years dynamically computed from invoices + last 5 calendar years
  const availableYears = useMemo(() => {
    const currentY = new Date().getFullYear();
    const yrSet = new Set([currentY, currentY - 1, currentY - 2, currentY - 3]);
    invoices.forEach((inv) => {
      if (inv.created_at) {
        const y = new Date(inv.created_at).getFullYear();
        if (!isNaN(y)) yrSet.add(y);
      }
    });
    return Array.from(yrSet).sort((a, b) => b - a);
  }, [invoices]);

  // Period Summary Cards across Today, Previous Days, This Month, This Year, and All Years
  const periodMetrics = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisYearStart = new Date(now.getFullYear(), 0, 1);

    let todayCount = 0,
      todayTotal = 0;
    let prevDaysCount = 0,
      prevDaysTotal = 0;
    let thisMonthCount = 0,
      thisMonthTotal = 0;
    let prevMonthCount = 0,
      prevMonthTotal = 0;
    let thisYearCount = 0,
      thisYearTotal = 0;
    let prevYearsCount = 0,
      prevYearsTotal = 0;

    invoices.forEach((inv) => {
      const dt = new Date(inv.created_at);
      const amt = Number(inv.grand_total || 0);

      if (dt >= todayStart) {
        todayCount++;
        todayTotal += amt;
      }
      if (dt >= sevenDaysAgo && dt < todayStart) {
        prevDaysCount++;
        prevDaysTotal += amt;
      }
      if (dt >= thisMonthStart) {
        thisMonthCount++;
        thisMonthTotal += amt;
      } else if (dt >= prevMonthStart && dt < thisMonthStart) {
        prevMonthCount++;
        prevMonthTotal += amt;
      }
      if (dt >= thisYearStart) {
        thisYearCount++;
        thisYearTotal += amt;
      } else {
        prevYearsCount++;
        prevYearsTotal += amt;
      }
    });

    return {
      todayCount,
      todayTotal,
      prevDaysCount,
      prevDaysTotal,
      thisMonthCount,
      thisMonthTotal,
      prevMonthCount,
      prevMonthTotal,
      thisYearCount,
      thisYearTotal,
      prevYearsCount,
      prevYearsTotal,
      yesterdayStart,
    };
  }, [invoices]);

  const applyPeriodPreset = (preset) => {
    setPeriodPreset(preset);
    setSelectedYear('All');
    setSelectedMonth('All');
    setDateFrom('');
    setDateTo('');
  };

  const filteredInvoices = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisYearStart = new Date(now.getFullYear(), 0, 1);

    return invoices.filter((inv) => {
      if (statusFilter !== 'All' && inv.payment_status !== statusFilter) return false;
      if (methodFilter !== 'All' && inv.payment_method !== methodFilter) return false;

      const dt = new Date(inv.created_at);

      // Period Preset Filter
      if (periodPreset === 'today' && dt < todayStart) return false;
      if (periodPreset === 'yesterday' && (dt < yesterdayStart || dt >= todayStart)) return false;
      if (periodPreset === 'last7days' && dt < sevenDaysAgo) return false;
      if (periodPreset === 'thisMonth' && dt < thisMonthStart) return false;
      if (periodPreset === 'prevMonth' && (dt < prevMonthStart || dt >= thisMonthStart))
        return false;
      if (periodPreset === 'thisYear' && dt < thisYearStart) return false;
      if (periodPreset === 'prevYears' && dt >= thisYearStart) return false;

      // Explicit Year Dropdown Filter
      if (selectedYear !== 'All' && dt.getFullYear() !== parseInt(selectedYear, 10)) {
        return false;
      }

      // Explicit Month Dropdown Filter
      if (selectedMonth !== 'All' && dt.getMonth() !== parseInt(selectedMonth, 10)) {
        return false;
      }

      // Explicit Custom Date Range Filter
      if (dateFrom) {
        const dFrom = new Date(`${dateFrom}T00:00:00`);
        if (dt < dFrom) return false;
      }
      if (dateTo) {
        const dTo = new Date(`${dateTo}T23:59:59.999`);
        if (dt > dTo) return false;
      }

      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        inv.invoice_number.toLowerCase().includes(q) ||
        inv.customer_name.toLowerCase().includes(q) ||
        (inv.customer_phone && inv.customer_phone.toLowerCase().includes(q)) ||
        (inv.items || []).some((it) => (it.product_name || '').toLowerCase().includes(q))
      );
    });
  }, [
    invoices,
    search,
    statusFilter,
    methodFilter,
    periodPreset,
    selectedYear,
    selectedMonth,
    dateFrom,
    dateTo,
  ]);

  const totalAmount = useMemo(
    () => filteredInvoices.reduce((s, i) => s + Number(i.grand_total || 0), 0),
    [filteredInvoices]
  );

  const totalTax = useMemo(
    () => filteredInvoices.reduce((s, i) => s + Number(i.tax_amount || 0), 0),
    [filteredInvoices]
  );

  // Grouped Summaries: Day-wise, Month-wise, Year-wise
  const dailyGroups = useMemo(() => {
    const map = {};
    filteredInvoices.forEach((inv) => {
      const dt = new Date(inv.created_at);
      const pad = (n) => String(n).padStart(2, '0');
      const dayKey = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      if (!map[dayKey]) {
        map[dayKey] = {
          key: dayKey,
          label: dt.toLocaleDateString('en-IN', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }),
          count: 0,
          subtotal: 0,
          tax: 0,
          grandTotal: 0,
          paid: 0,
          due: 0,
        };
      }
      map[dayKey].count += 1;
      map[dayKey].subtotal += Number(inv.subtotal || 0);
      map[dayKey].tax += Number(inv.tax_amount || 0);
      map[dayKey].grandTotal += Number(inv.grand_total || 0);
      map[dayKey].paid += Number(inv.amount_paid || 0);
      map[dayKey].due += Number(inv.balance_due || 0);
    });
    return Object.values(map).sort((a, b) => b.key.localeCompare(a.key));
  }, [filteredInvoices]);

  const monthlyGroups = useMemo(() => {
    const map = {};
    filteredInvoices.forEach((inv) => {
      const dt = new Date(inv.created_at);
      const y = dt.getFullYear();
      const m = dt.getMonth();
      const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;
      if (!map[monthKey]) {
        map[monthKey] = {
          key: monthKey,
          year: y,
          monthIndex: m,
          label: `${MONTH_NAMES[m]} ${y}`,
          count: 0,
          subtotal: 0,
          tax: 0,
          grandTotal: 0,
          paid: 0,
          due: 0,
        };
      }
      map[monthKey].count += 1;
      map[monthKey].subtotal += Number(inv.subtotal || 0);
      map[monthKey].tax += Number(inv.tax_amount || 0);
      map[monthKey].grandTotal += Number(inv.grand_total || 0);
      map[monthKey].paid += Number(inv.amount_paid || 0);
      map[monthKey].due += Number(inv.balance_due || 0);
    });
    return Object.values(map).sort((a, b) => b.key.localeCompare(a.key));
  }, [filteredInvoices]);

  const yearlyGroups = useMemo(() => {
    const map = {};
    filteredInvoices.forEach((inv) => {
      const dt = new Date(inv.created_at);
      const y = dt.getFullYear();
      if (!map[y]) {
        map[y] = {
          year: y,
          label: `Year ${y}`,
          count: 0,
          subtotal: 0,
          tax: 0,
          grandTotal: 0,
          paid: 0,
          due: 0,
        };
      }
      map[y].count += 1;
      map[y].subtotal += Number(inv.subtotal || 0);
      map[y].tax += Number(inv.tax_amount || 0);
      map[y].grandTotal += Number(inv.grand_total || 0);
      map[y].paid += Number(inv.amount_paid || 0);
      map[y].due += Number(inv.balance_due || 0);
    });
    return Object.values(map).sort((a, b) => b.year - a.year);
  }, [filteredInvoices]);

  const openEditModal = (inv) => {
    const dt = new Date(inv.created_at);
    const pad = (n) => String(n).padStart(2, '0');
    const localDt = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(
      dt.getHours()
    )}:${pad(dt.getMinutes())}`;
    setEditingInvoice(inv);
    setEditForm({
      invoice_number: inv.invoice_number,
      customer_name: inv.customer_name || 'Walk-in Customer',
      customer_phone: inv.customer_phone || '',
      payment_method: inv.payment_method || 'Cash',
      payment_status: inv.payment_status || 'Paid',
      amount_paid: String(inv.amount_paid ?? inv.grand_total ?? 0),
      created_at_local: localDt,
      notes: inv.notes || '',
    });
  };

  const handleSaveInvoiceEdit = async (e) => {
    e.preventDefault();
    if (!editingInvoice) return;
    setSavingEdit(true);
    try {
      await apiRequest(`/api/invoices/${editingInvoice.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          invoice_number: editForm.invoice_number,
          customer_name: editForm.customer_name,
          customer_phone: editForm.customer_phone,
          payment_method: editForm.payment_method,
          payment_status: editForm.payment_status,
          amount_paid: parseFloat(editForm.amount_paid || 0),
          created_at: new Date(editForm.created_at_local).toISOString(),
          notes: editForm.notes,
        }),
      });
      setEditingInvoice(null);
      await loadInvoices();
    } catch {
      // ignore
    } finally {
      setSavingEdit(false);
    }
  };

  const handleExportExcel = () => {
    const rows = filteredInvoices.map((inv) => ({
      'Invoice Number': inv.invoice_number,
      'Date & Time': formatDateTime(inv.created_at),
      Year: new Date(inv.created_at).getFullYear(),
      Month: MONTH_NAMES[new Date(inv.created_at).getMonth()],
      Customer: inv.customer_name,
      Phone: inv.customer_phone || '',
      Subtotal: Number(inv.subtotal),
      Discount: Number(inv.discount_amount),
      'GST Tax': Number(inv.tax_amount),
      'Grand Total': Number(inv.grand_total),
      'Payment Method': inv.payment_method,
      'Payment Status': inv.payment_status,
      'Amount Paid': Number(inv.amount_paid),
      'Balance Due': Number(inv.balance_due),
    }));
    exportToExcel(rows, 'Invoices', 'Vestas_Invoices_Register.xlsx');
  };

  const handleExportPdf = () => {
    exportReportPDF({
      title: 'Invoices & Billing Register (Up-to-Date & Historical)',
      subtitle: `Showing ${filteredInvoices.length} invoice(s) • Total Value: ${formatCurrency(
        totalAmount,
        symbol
      )}`,
      columns: [
        'Invoice No',
        'Date & Time',
        'Customer Name',
        'Phone',
        'Items',
        'Method',
        'Status',
        'Tax (Rs.)',
        'Grand Total (Rs.)',
      ],
      rows: filteredInvoices.map((inv) => [
        inv.invoice_number,
        formatDateTime(inv.created_at),
        inv.customer_name,
        inv.customer_phone || '-',
        (inv.items || []).length,
        inv.payment_method,
        inv.payment_status,
        Number(inv.tax_amount).toFixed(2),
        Number(inv.grand_total).toFixed(2),
      ]),
      settings,
      fileName: 'Vestas_Invoices_Register.pdf',
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Up-to-Date & Historical Invoice Archive ({filteredInvoices.length} Bills)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Access today&apos;s live invoices and complete records across previous days, months, and
            years • Zero AI/Token Usage
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="px-3.5 py-2 rounded-xl bg-sky-50 border border-sky-200 text-xs font-bold text-sky-800">
            Filtered Total: {formatCurrency(totalAmount, symbol)} (GST:{' '}
            {formatCurrency(totalTax, symbol)})
          </div>
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            Export Excel
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            <Download className="w-4 h-4 text-sky-600" />
            Export PDF
          </button>
        </div>
      </div>

      {/* 5 Summary Cards: Today (Up-to-Date), Previous Days, This Month, This Year, Previous Years */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div
          onClick={() => applyPeriodPreset('today')}
          className={`p-4 rounded-2xl border transition cursor-pointer ${
            periodPreset === 'today'
              ? 'bg-emerald-50 border-emerald-400 shadow-xs'
              : 'bg-white border-slate-200 hover:border-emerald-300'
          }`}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
            Today (Up to Date)
          </div>
          <div className="text-lg font-extrabold text-slate-900 mt-1">
            {formatCurrency(periodMetrics.todayTotal, symbol)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {periodMetrics.todayCount} invoice(s) generated today
          </div>
        </div>

        <div
          onClick={() => applyPeriodPreset('last7days')}
          className={`p-4 rounded-2xl border transition cursor-pointer ${
            periodPreset === 'last7days'
              ? 'bg-sky-50 border-sky-400 shadow-xs'
              : 'bg-white border-slate-200 hover:border-sky-300'
          }`}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-sky-700">
            Previous 7 Days
          </div>
          <div className="text-lg font-extrabold text-slate-900 mt-1">
            {formatCurrency(periodMetrics.prevDaysTotal + periodMetrics.todayTotal, symbol)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {periodMetrics.prevDaysCount + periodMetrics.todayCount} bill(s) in last 7 days
          </div>
        </div>

        <div
          onClick={() => applyPeriodPreset('thisMonth')}
          className={`p-4 rounded-2xl border transition cursor-pointer ${
            periodPreset === 'thisMonth'
              ? 'bg-indigo-50 border-indigo-400 shadow-xs'
              : 'bg-white border-slate-200 hover:border-indigo-300'
          }`}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
            This Month ({MONTH_NAMES[new Date().getMonth()]})
          </div>
          <div className="text-lg font-extrabold text-slate-900 mt-1">
            {formatCurrency(periodMetrics.thisMonthTotal, symbol)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {periodMetrics.thisMonthCount} bill(s) • Prev Month:{' '}
            {formatCurrency(periodMetrics.prevMonthTotal, symbol)}
          </div>
        </div>

        <div
          onClick={() => applyPeriodPreset('thisYear')}
          className={`p-4 rounded-2xl border transition cursor-pointer ${
            periodPreset === 'thisYear'
              ? 'bg-amber-50 border-amber-400 shadow-xs'
              : 'bg-white border-slate-200 hover:border-amber-300'
          }`}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
            This Year ({new Date().getFullYear()})
          </div>
          <div className="text-lg font-extrabold text-slate-900 mt-1">
            {formatCurrency(periodMetrics.thisYearTotal, symbol)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {periodMetrics.thisYearCount} invoice(s) this year
          </div>
        </div>

        <div
          onClick={() => applyPeriodPreset('prevYears')}
          className={`p-4 rounded-2xl border transition cursor-pointer ${
            periodPreset === 'prevYears'
              ? 'bg-purple-50 border-purple-400 shadow-xs'
              : 'bg-white border-slate-200 hover:border-purple-300'
          }`}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-purple-700">
            Previous Years Archive
          </div>
          <div className="text-lg font-extrabold text-slate-900 mt-1">
            {formatCurrency(periodMetrics.prevYearsTotal, symbol)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {periodMetrics.prevYearsCount} historical invoice(s)
          </div>
        </div>
      </div>

      {/* View Mode & Quick Period Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          {/* Quick Period Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {[
              { id: 'all', label: 'All Time (All Years)' },
              { id: 'today', label: 'Today (Up to Date)' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: 'last7days', label: 'Last 7 Days' },
              { id: 'thisMonth', label: 'This Month' },
              { id: 'prevMonth', label: 'Previous Month' },
              { id: 'thisYear', label: 'This Year' },
              { id: 'prevYears', label: 'Previous Years' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPeriodPreset(p.id)}
                className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                  periodPreset === p.id
                    ? 'bg-sky-600 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Grouping Mode Switcher */}
          <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-bold">
            {[
              { id: 'list', label: 'All Invoices' },
              { id: 'daily', label: 'Day-wise' },
              { id: 'monthly', label: 'Month-wise' },
              { id: 'yearly', label: 'Year-wise' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setViewMode(m.id)}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  viewMode === m.id
                    ? 'bg-white text-sky-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Detailed Filters: Search, Year, Month, From Date, To Date, Status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
          <div className="sm:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Invoice No, Customer, Phone, or Medicine..."
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-300 focus:border-sky-600 outline-none"
            />
          </div>

          <div>
            <select
              value={selectedYear}
              onChange={(e) => {
                setSelectedYear(e.target.value);
                setPeriodPreset('all');
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white outline-none font-bold text-slate-800"
            >
              <option value="All">All Years</option>
              {availableYears.map((yr) => (
                <option key={yr} value={String(yr)}>
                  Year: {yr}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(e.target.value);
                setPeriodPreset('all');
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white outline-none font-bold text-slate-800"
            >
              <option value="All">All Months</option>
              {MONTH_NAMES.map((mName, idx) => (
                <option key={mName} value={String(idx)}>
                  {mName}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 shrink-0">From:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPeriodPreset('all');
              }}
              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 shrink-0">To:</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPeriodPreset('all');
              }}
              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 outline-none"
            />
          </div>
        </div>
      </div>

      {/* GROUPED VIEW: DAY-WISE / MONTH-WISE / YEAR-WISE */}
      {viewMode !== 'list' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              {viewMode === 'daily'
                ? 'Day-wise Invoice Summary (Including Previous Days)'
                : viewMode === 'monthly'
                ? 'Month-wise Invoice Summary (Including Previous Months)'
                : 'Year-wise Invoice Summary (Including Previous Years)'}
            </h3>
            <span className="text-xs text-slate-500">
              Click &quot;View Invoices&quot; on any period row to inspect and print individual bills
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">Period</th>
                  <th className="py-3 px-3 font-semibold text-center">Total Invoices</th>
                  <th className="py-3 px-3 font-semibold text-right">Taxable Subtotal</th>
                  <th className="py-3 px-3 font-semibold text-right">GST Collected</th>
                  <th className="py-3 px-3 font-semibold text-right">Amount Paid</th>
                  <th className="py-3 px-3 font-semibold text-right">Balance Due</th>
                  <th className="py-3 px-3 font-semibold text-right">Grand Total</th>
                  <th className="py-3 px-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(viewMode === 'daily'
                  ? dailyGroups
                  : viewMode === 'monthly'
                  ? monthlyGroups
                  : yearlyGroups
                ).map((grp) => (
                  <tr key={grp.key || grp.year} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-bold text-slate-900">{grp.label}</td>
                    <td className="py-3 px-3 text-center font-bold text-sky-700">{grp.count}</td>
                    <td className="py-3 px-3 text-right">
                      {formatCurrency(grp.subtotal, symbol)}
                    </td>
                    <td className="py-3 px-3 text-right">{formatCurrency(grp.tax, symbol)}</td>
                    <td className="py-3 px-3 text-right text-emerald-700 font-semibold">
                      {formatCurrency(grp.paid, symbol)}
                    </td>
                    <td className="py-3 px-3 text-right text-red-600 font-semibold">
                      {formatCurrency(grp.due, symbol)}
                    </td>
                    <td className="py-3 px-3 text-right font-extrabold text-slate-900 text-sm">
                      {formatCurrency(grp.grandTotal, symbol)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          if (viewMode === 'daily') {
                            setDateFrom(grp.key);
                            setDateTo(grp.key);
                            setPeriodPreset('all');
                          } else if (viewMode === 'monthly') {
                            setSelectedYear(String(grp.year));
                            setSelectedMonth(String(grp.monthIndex));
                            setPeriodPreset('all');
                          } else {
                            setSelectedYear(String(grp.year));
                            setSelectedMonth('All');
                            setPeriodPreset('all');
                          }
                          setViewMode('list');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-semibold cursor-pointer"
                      >
                        View Invoices ({grp.count})
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* INVOICES LIST TABLE */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">Invoice No</th>
                  <th className="py-3 px-3 font-semibold">Date & Time (Day / Month / Year)</th>
                  <th className="py-3 px-3 font-semibold">Customer Details</th>
                  <th className="py-3 px-3 font-semibold text-center">Items</th>
                  <th className="py-3 px-3 font-semibold">Payment Mode</th>
                  <th className="py-3 px-3 font-semibold text-right">Subtotal / Tax</th>
                  <th className="py-3 px-3 font-semibold text-right">Grand Total</th>
                  <th className="py-3 px-4 font-semibold text-right">Invoice Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      Loading invoices...
                    </td>
                  </tr>
                ) : filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      No invoices found matching the selected day, month, or year filter.
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => {
                    const invDate = new Date(inv.created_at);
                    const isToday =
                      invDate.toDateString() === new Date().toDateString();

                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4">
                          <div className="font-bold text-sky-700">{inv.invoice_number}</div>
                          {isToday && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                              Today (Up-to-Date)
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-700">
                          <div className="font-semibold">{formatDateTime(inv.created_at)}</div>
                          <div className="text-[10px] text-slate-400">
                            {MONTH_NAMES[invDate.getMonth()]} {invDate.getFullYear()}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-900">{inv.customer_name}</div>
                          {inv.customer_phone && (
                            <div className="text-[11px] text-slate-500">{inv.customer_phone}</div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center font-semibold">
                          {(inv.items || []).length}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                              inv.payment_status === 'Paid'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : inv.payment_status === 'Partial'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}
                          >
                            {inv.payment_method} ({inv.payment_status})
                          </span>
                          {Number(inv.balance_due) > 0 && (
                            <div className="text-[11px] text-red-600 font-semibold mt-0.5">
                              Due: {formatCurrency(inv.balance_due, symbol)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right text-slate-600">
                          <div>Sub: {formatCurrency(inv.subtotal, symbol)}</div>
                          <div className="text-[11px] text-slate-400">
                            GST: {formatCurrency(inv.tax_amount, symbol)}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-slate-900 text-sm">
                          {formatCurrency(inv.grand_total, symbol)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onViewInvoice(inv)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-semibold transition cursor-pointer"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              View / Print
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadInvoicePDF(inv, settings, 'A4')}
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold transition cursor-pointer"
                              title="Download A4 PDF"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              A4
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadInvoicePDF(inv, settings, 'THERMAL')}
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition cursor-pointer"
                              title="Download 80mm Receipt PDF"
                            >
                              <Receipt className="w-3.5 h-3.5" />
                              80mm
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(inv)}
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-semibold transition cursor-pointer"
                              title="Edit Invoice Date / Customer / Payment Status"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
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
      )}

      {/* EDIT INVOICE DATE / STATUS MODAL */}
      {editingInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Edit Invoice Date, Customer & Payment Status
              </h3>
              <button
                type="button"
                onClick={() => setEditingInvoice(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveInvoiceEdit} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Invoice Number</label>
                <input
                  type="text"
                  required
                  value={editForm.invoice_number}
                  onChange={(e) => setEditForm({ ...editForm, invoice_number: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-sky-800 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Invoice Date & Time (Any Day, Month, or Year)
                </label>
                <input
                  type="datetime-local"
                  required
                  value={editForm.created_at_local}
                  onChange={(e) => setEditForm({ ...editForm, created_at_local: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-sky-400 font-semibold outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Customer Name</label>
                  <input
                    type="text"
                    value={editForm.customer_name}
                    onChange={(e) => setEditForm({ ...editForm, customer_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Customer Phone</label>
                  <input
                    type="text"
                    value={editForm.customer_phone}
                    onChange={(e) => setEditForm({ ...editForm, customer_phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payment Method</label>
                  <select
                    value={editForm.payment_method}
                    onChange={(e) => setEditForm({ ...editForm, payment_method: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white outline-none font-semibold"
                  >
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="Card">Card</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Credit">Credit</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payment Status</label>
                  <select
                    value={editForm.payment_status}
                    onChange={(e) => setEditForm({ ...editForm, payment_status: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white outline-none font-semibold"
                  >
                    <option value="Paid">Paid</option>
                    <option value="Partial">Partial</option>
                    <option value="Unpaid">Unpaid</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingInvoice(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

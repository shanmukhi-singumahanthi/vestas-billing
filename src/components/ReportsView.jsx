import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  FileSpreadsheet,
  Download,
  Calendar,
  TrendingUp,
  Package,
  Clock,
  Users,
  IndianRupee,
} from 'lucide-react';
import { apiRequest } from '../utils/api';
import {
  formatCurrency,
  formatDateTime,
  exportToExcel,
  exportReportPDF,
} from '../utils/exportAndPdf';

export default function ReportsView({ settings = {} }) {
  const symbol = settings?.currency_symbol || '₹';
  const [reportTab, setReportTab] = useState('sales'); // 'sales' | 'product' | 'profit' | 'stock' | 'expiry' | 'customer'
  const [datePreset, setDatePreset] = useState('month'); // 'today' | 'week' | 'month' | 'all' | 'custom'
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);

  const applyPreset = (preset) => {
    setDatePreset(preset);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const todayStr = fmt(now);

    if (preset === 'today') {
      setDateFrom(todayStr);
      setDateTo(todayStr);
    } else if (preset === 'yesterday') {
      const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      setDateFrom(fmt(yest));
      setDateTo(fmt(yest));
    } else if (preset === 'week') {
      const wkAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      setDateFrom(fmt(wkAgo));
      setDateTo(todayStr);
    } else if (preset === 'month') {
      const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateFrom(fmt(mStart));
      setDateTo(todayStr);
    } else if (preset === 'prevMonth') {
      const pmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const pmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      setDateFrom(fmt(pmStart));
      setDateTo(fmt(pmEnd));
    } else if (preset === 'year') {
      const yStart = new Date(now.getFullYear(), 0, 1);
      setDateFrom(fmt(yStart));
      setDateTo(todayStr);
    } else if (preset === 'prevYear') {
      const pyStart = new Date(now.getFullYear() - 1, 0, 1);
      const pyEnd = new Date(now.getFullYear() - 1, 11, 31);
      setDateFrom(fmt(pyStart));
      setDateTo(fmt(pyEnd));
    } else if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
    }
  };

  useEffect(() => {
    applyPreset('all');
  }, []);

  useEffect(() => {
    const fetchReports = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (dateFrom) params.set('from', dateFrom);
        if (dateTo) params.set('to', dateTo);
        const data = await apiRequest(`/api/reports?${params.toString()}`);
        setReportData(data);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchReports();
  }, [dateFrom, dateTo]);

  const summary = reportData?.summary || {
    invoiceCount: 0,
    totalSales: 0,
    totalTax: 0,
    totalDiscount: 0,
    totalCost: 0,
    totalProfit: 0,
    totalCollected: 0,
    totalPending: 0,
  };

  const now = new Date();
  const ninetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const expiryProducts = useMemo(() => {
    return (reportData?.products || []).filter((p) => {
      if (!p.expiry_date) return false;
      const d = new Date(p.expiry_date.length === 7 ? `${p.expiry_date}-28` : p.expiry_date);
      return d <= ninetyDays;
    });
  }, [reportData]);

  // Export Handlers for current active tab
  const handleExportCurrentExcel = () => {
    if (!reportData) return;
    if (reportTab === 'sales') {
      exportToExcel(
        (reportData.invoices || []).map((i) => ({
          'Invoice No': i.invoice_number,
          Date: formatDateTime(i.created_at),
          Customer: i.customer_name,
          Phone: i.customer_phone || '',
          Subtotal: Number(i.subtotal),
          Discount: Number(i.discount_amount),
          'GST Tax': Number(i.tax_amount),
          'Grand Total': Number(i.grand_total),
          'Payment Method': i.payment_method,
          Status: i.payment_status,
        })),
        'Sales_Report',
        'Vestas_Sales_Report.xlsx'
      );
    } else if (reportTab === 'product' || reportTab === 'profit') {
      exportToExcel(
        (reportData.productWiseSales || []).map((p) => ({
          'Medicine Name': p.product_name,
          SKU: p.sku,
          Batch: p.batch_number,
          'Qty Sold': p.quantity_sold,
          'Purchase Cost': p.cost,
          'Gross Revenue': p.revenue,
          'GST Collected': p.tax_collected,
          'Net Profit': p.profit,
        })),
        'Product_Profit_Report',
        'Vestas_Product_Profit_Report.xlsx'
      );
    } else if (reportTab === 'stock') {
      exportToExcel(
        (reportData.products || []).map((p) => ({
          'Medicine Name': p.name,
          SKU: p.sku,
          Category: p.category,
          Batch: p.batch_number,
          Expiry: p.expiry_date,
          'Available Stock': Number(p.stock),
          'Purchase Price': Number(p.purchase_price),
          'Selling Price': Number(p.selling_price),
          'Stock Cost Value': +(Number(p.stock) * Number(p.purchase_price)).toFixed(2),
          'Stock Retail Value': +(Number(p.stock) * Number(p.selling_price)).toFixed(2),
        })),
        'Stock_Valuation',
        'Vestas_Stock_Report.xlsx'
      );
    } else if (reportTab === 'expiry') {
      exportToExcel(
        expiryProducts.map((p) => ({
          'Medicine Name': p.name,
          SKU: p.sku,
          Batch: p.batch_number,
          'Expiry Date': p.expiry_date,
          'Stock Left': Number(p.stock),
          'Purchase Value': +(Number(p.stock) * Number(p.purchase_price)).toFixed(2),
        })),
        'Expiry_Report',
        'Vestas_Expiry_Report.xlsx'
      );
    } else if (reportTab === 'customer') {
      exportToExcel(
        (reportData.customers || []).map((c) => ({
          'Customer Name': c.name,
          Phone: c.phone,
          GSTIN: c.gstin || '',
          'Total Purchases': Number(c.total_purchases),
          'Pending Balance': Number(c.balance),
        })),
        'Customer_Report',
        'Vestas_Customer_Report.xlsx'
      );
    }
  };

  const handleExportCurrentPdf = () => {
    if (!reportData) return;
    if (reportTab === 'sales') {
      exportReportPDF({
        title: 'Sales & Billing Report',
        subtitle: `Period: ${dateFrom || 'Start'} to ${dateTo || 'Today'}`,
        summaryItems: [
          { label: 'Total Bills', value: summary.invoiceCount },
          { label: 'Total Sales', value: `Rs. ${summary.totalSales.toFixed(2)}` },
          { label: 'Total GST', value: `Rs. ${summary.totalTax.toFixed(2)}` },
          { label: 'Net Profit', value: `Rs. ${summary.totalProfit.toFixed(2)}` },
        ],
        columns: ['Invoice No', 'Date', 'Customer', 'Method', 'Status', 'Tax (Rs.)', 'Total (Rs.)'],
        rows: (reportData.invoices || []).map((i) => [
          i.invoice_number,
          formatDateTime(i.created_at),
          i.customer_name,
          i.payment_method,
          i.payment_status,
          Number(i.tax_amount).toFixed(2),
          Number(i.grand_total).toFixed(2),
        ]),
        settings,
        fileName: 'Vestas_Sales_Report.pdf',
      });
    } else if (reportTab === 'product' || reportTab === 'profit') {
      exportReportPDF({
        title: 'Product-Wise Sales & Profit Report',
        subtitle: `Period: ${dateFrom || 'Start'} to ${dateTo || 'Today'}`,
        summaryItems: [
          { label: 'Total Revenue', value: `Rs. ${summary.totalSales.toFixed(2)}` },
          { label: 'Total Purchase Cost', value: `Rs. ${summary.totalCost.toFixed(2)}` },
          { label: 'Net Profit', value: `Rs. ${summary.totalProfit.toFixed(2)}` },
        ],
        columns: [
          'Medicine Name',
          'SKU',
          'Batch',
          'Qty Sold',
          'Cost (Rs.)',
          'Revenue (Rs.)',
          'Profit (Rs.)',
        ],
        rows: (reportData.productWiseSales || []).map((p) => [
          p.product_name,
          p.sku || '-',
          p.batch_number || '-',
          p.quantity_sold,
          Number(p.cost).toFixed(2),
          Number(p.revenue).toFixed(2),
          Number(p.profit).toFixed(2),
        ]),
        settings,
        fileName: 'Vestas_Profit_Report.pdf',
      });
    } else if (reportTab === 'stock') {
      exportReportPDF({
        title: 'Stock & Valuation Report',
        columns: [
          'Medicine Name',
          'SKU',
          'Batch',
          'Expiry',
          'Stock',
          'Purchase (Rs.)',
          'Selling (Rs.)',
          'Stock Cost Value',
        ],
        rows: (reportData.products || []).map((p) => [
          p.name,
          p.sku,
          p.batch_number,
          p.expiry_date,
          p.stock,
          Number(p.purchase_price).toFixed(2),
          Number(p.selling_price).toFixed(2),
          (Number(p.stock) * Number(p.purchase_price)).toFixed(2),
        ]),
        settings,
        fileName: 'Vestas_Stock_Report.pdf',
      });
    } else if (reportTab === 'expiry') {
      exportReportPDF({
        title: 'Medicine Expiry Report (Expired & Near-Expiry)',
        columns: ['Medicine Name', 'SKU', 'Batch', 'Expiry Date', 'Stock Left', 'Cost Value'],
        rows: expiryProducts.map((p) => [
          p.name,
          p.sku,
          p.batch_number,
          p.expiry_date,
          p.stock,
          (Number(p.stock) * Number(p.purchase_price)).toFixed(2),
        ]),
        settings,
        fileName: 'Vestas_Expiry_Report.pdf',
      });
    } else if (reportTab === 'customer') {
      exportReportPDF({
        title: 'Customer Purchase & Receivables Report',
        columns: ['Customer Name', 'Phone', 'GSTIN', 'Total Purchases (Rs.)', 'Pending Balance (Rs.)'],
        rows: (reportData.customers || []).map((c) => [
          c.name,
          c.phone,
          c.gstin || '-',
          Number(c.total_purchases).toFixed(2),
          Number(c.balance).toFixed(2),
        ]),
        settings,
        fileName: 'Vestas_Customer_Report.pdf',
      });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Export Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Business Reports & Financial Analytics
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Daily, weekly & monthly sales, product-wise profit margins, stock valuation, expiry & customer reports
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportCurrentExcel}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export Report to Excel
          </button>
          <button
            type="button"
            onClick={handleExportCurrentPdf}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Export Report to PDF
          </button>
        </div>
      </div>

      {/* Report Type Selector & Date Range Filter */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'sales', label: 'Sales Report' },
            { id: 'product', label: 'Product-Wise Sales' },
            { id: 'profit', label: 'Profit & Margin Report' },
            { id: 'stock', label: 'Stock Report' },
            { id: 'expiry', label: 'Expiry Report' },
            { id: 'customer', label: 'Customer Purchases' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setReportTab(t.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                reportTab === t.id
                  ? 'bg-sky-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1 gap-0.5">
            {[
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: 'week', label: '7 Days' },
              { id: 'month', label: 'This Month' },
              { id: 'prevMonth', label: 'Prev Month' },
              { id: 'year', label: 'This Year' },
              { id: 'prevYear', label: 'Prev Year' },
              { id: 'all', label: 'All Years' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer ${
                  datePreset === p.id ? 'bg-white text-sky-700 shadow-2xs' : 'text-slate-600'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDatePreset('custom');
              setDateFrom(e.target.value);
            }}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 outline-none"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDatePreset('custom');
              setDateTo(e.target.value);
            }}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 outline-none"
          />
        </div>
      </div>

      {/* Period Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500 uppercase">Total Sales Revenue</div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {formatCurrency(summary.totalSales, symbol)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Across {summary.invoiceCount} invoice(s)
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500 uppercase">Purchase Cost (COGS)</div>
          <div className="text-xl font-bold text-slate-800 mt-1">
            {formatCurrency(summary.totalCost, symbol)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            GST Collected: {formatCurrency(summary.totalTax, symbol)}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-emerald-200 p-4 shadow-2xs">
          <div className="text-xs font-semibold text-emerald-700 uppercase">Net Profit Earned</div>
          <div className="text-xl font-bold text-emerald-700 mt-1">
            {formatCurrency(summary.totalProfit, symbol)}
          </div>
          <div className="text-[11px] text-emerald-600 mt-0.5">
            Based on Purchase vs Selling Price
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500 uppercase">
            Collected vs Pending
          </div>
          <div className="text-xl font-bold text-sky-700 mt-1">
            {formatCurrency(summary.totalCollected, symbol)}
          </div>
          <div className="text-[11px] text-red-600 font-semibold mt-0.5">
            Pending: {formatCurrency(summary.totalPending, symbol)}
          </div>
        </div>
      </div>

      {/* Report Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-400">Generating report...</div>
        ) : reportTab === 'sales' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Invoice No</th>
                  <th className="py-3 px-3">Date & Time</th>
                  <th className="py-3 px-3">Customer</th>
                  <th className="py-3 px-3">Payment Method</th>
                  <th className="py-3 px-3 text-right">Subtotal</th>
                  <th className="py-3 px-3 text-right">GST Tax</th>
                  <th className="py-3 px-3 text-right">Grand Total</th>
                  <th className="py-3 px-4 text-right">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(reportData?.invoices || []).map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-bold text-sky-700">{inv.invoice_number}</td>
                    <td className="py-3 px-3 text-slate-600">{formatDateTime(inv.created_at)}</td>
                    <td className="py-3 px-3 font-semibold">{inv.customer_name}</td>
                    <td className="py-3 px-3">
                      {inv.payment_method} ({inv.payment_status})
                    </td>
                    <td className="py-3 px-3 text-right">
                      {formatCurrency(inv.subtotal, symbol)}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {formatCurrency(inv.tax_amount, symbol)}
                    </td>
                    <td className="py-3 px-3 text-right font-bold">
                      {formatCurrency(inv.grand_total, symbol)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-700">
                      {formatCurrency(inv.estimated_profit, symbol)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : reportTab === 'product' || reportTab === 'profit' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Medicine Name</th>
                  <th className="py-3 px-3">Code / Batch</th>
                  <th className="py-3 px-3 text-center">Units Sold</th>
                  <th className="py-3 px-3 text-right">Purchase Cost</th>
                  <th className="py-3 px-3 text-right">Gross Sales Revenue</th>
                  <th className="py-3 px-4 text-right">Net Profit Earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(reportData?.productWiseSales || []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      No product sales recorded in this date range.
                    </td>
                  </tr>
                ) : (
                  reportData.productWiseSales.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-bold text-slate-900">{item.product_name}</td>
                      <td className="py-3 px-3 text-slate-600">
                        {item.sku} • {item.batch_number}
                      </td>
                      <td className="py-3 px-3 text-center font-bold">{item.quantity_sold}</td>
                      <td className="py-3 px-3 text-right text-slate-600">
                        {formatCurrency(item.cost, symbol)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-slate-900">
                        {formatCurrency(item.revenue, symbol)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-700">
                        {formatCurrency(item.profit, symbol)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : reportTab === 'stock' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Medicine Name</th>
                  <th className="py-3 px-3">Batch & Expiry</th>
                  <th className="py-3 px-3 text-center">Available Stock</th>
                  <th className="py-3 px-3 text-right">Purchase Price</th>
                  <th className="py-3 px-3 text-right">Selling Price</th>
                  <th className="py-3 px-3 text-right">Stock Cost Value</th>
                  <th className="py-3 px-4 text-right">Stock Retail Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(reportData?.products || []).map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-bold text-slate-900">{p.name}</td>
                    <td className="py-3 px-3 text-slate-600">
                      {p.batch_number} (Exp: {p.expiry_date})
                    </td>
                    <td className="py-3 px-3 text-center font-bold">{p.stock}</td>
                    <td className="py-3 px-3 text-right">
                      {formatCurrency(p.purchase_price, symbol)}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {formatCurrency(p.selling_price, symbol)}
                    </td>
                    <td className="py-3 px-3 text-right font-semibold">
                      {formatCurrency(Number(p.stock) * Number(p.purchase_price), symbol)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-700">
                      {formatCurrency(Number(p.stock) * Number(p.selling_price), symbol)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : reportTab === 'expiry' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Medicine Name</th>
                  <th className="py-3 px-3">SKU & Batch</th>
                  <th className="py-3 px-3">Expiry Date</th>
                  <th className="py-3 px-3 text-center">Stock Left</th>
                  <th className="py-3 px-4 text-right">Stock Cost Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {expiryProducts.map((p) => (
                  <tr key={p.id}>
                    <td className="py-3 px-4 font-bold text-slate-900">{p.name}</td>
                    <td className="py-3 px-3">
                      {p.sku} • {p.batch_number}
                    </td>
                    <td className="py-3 px-3 font-bold text-red-600">{p.expiry_date}</td>
                    <td className="py-3 px-3 text-center font-bold">{p.stock}</td>
                    <td className="py-3 px-4 text-right font-semibold">
                      {formatCurrency(Number(p.stock) * Number(p.purchase_price), symbol)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-3">Phone</th>
                  <th className="py-3 px-3">GSTIN / DL</th>
                  <th className="py-3 px-3 text-right">Total Purchases</th>
                  <th className="py-3 px-4 text-right">Pending Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(reportData?.customers || []).map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-bold text-slate-900">{c.name}</td>
                    <td className="py-3 px-3">{c.phone}</td>
                    <td className="py-3 px-3 text-slate-600">{c.gstin || '-'}</td>
                    <td className="py-3 px-3 text-right font-bold">
                      {formatCurrency(c.total_purchases, symbol)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-red-600">
                      {formatCurrency(c.balance, symbol)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

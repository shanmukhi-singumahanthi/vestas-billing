import React, { useState } from 'react';
import {
  IndianRupee,
  FileText,
  Package,
  AlertTriangle,
  XCircle,
  Users,
  TrendingUp,
  PlusCircle,
  Printer,
  Download,
  Eye,
  Clock,
  ArrowUpRight,
  Calendar,
} from 'lucide-react';
import { formatCurrency, formatDateTime, downloadInvoicePDF } from '../utils/exportAndPdf';

export default function DashboardView({
  dashboard,
  settings,
  onNavigate,
  onViewInvoice,
  onRefresh,
  user,
}) {
  const isWorker = user?.role === 'worker';
  const [overviewPeriod, setOverviewPeriod] = useState('daily'); // 'daily' | 'weekly' | 'monthly'
  const symbol = settings?.currency_symbol || '₹';

  if (!dashboard) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        Loading real-time pharmacy metrics...
      </div>
    );
  }

  const chartData =
    overviewPeriod === 'daily'
      ? dashboard.dailyOverview || []
      : overviewPeriod === 'weekly'
      ? dashboard.weeklyOverview || []
      : dashboard.monthlyOverview || [];

  const maxSales = Math.max(100, ...chartData.map((d) => Number(d.sales || 0)));

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Actions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            {isWorker ? 'Counter Sales Terminal' : 'Live Pharmacy Operations'}
          </div>
          <h2 className="text-xl font-bold text-slate-900">
            {isWorker
              ? `Welcome, ${user?.fullName || 'Counter Staff'}`
              : `Welcome back, ${settings?.owner_name?.split('(')[0]?.trim() || 'S. Satyendranath'}`}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {settings?.business_name || 'Vestas Pharmaceuticals'} • GSTIN:{' '}
            <span className="font-semibold text-slate-700">
              {settings?.gstin || '37BHCPS0456G1ZB'}
            </span>{' '}
            • DL: {settings?.dl_no_1 || 'AP/VJA/20B/104928'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate('billing')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold shadow-xs transition cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            New Customer Bill (POS)
          </button>
          <button
            type="button"
            onClick={() => onNavigate('products')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-xs transition cursor-pointer"
          >
            <Package className="w-4 h-4" />
            Manage Medicines
          </button>
        </div>
      </div>

      {/* 6 Core KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {isWorker ? 'Counter Bills Today' : 'Sales Today'}
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              {isWorker ? <FileText className="w-5 h-5" /> : <IndianRupee className="w-5 h-5" />}
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              {isWorker ? `${dashboard.billsToday} Bills` : formatCurrency(dashboard.salesToday, symbol)}
            </div>
            <div className="text-xs text-emerald-700 font-medium mt-1">
              {isWorker ? 'Active for new billing' : `${dashboard.billsToday} bill(s) generated today`}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Bills
            </span>
            <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">{dashboard.totalBills}</div>
            <div className="text-xs text-slate-500 mt-1">
              {isWorker ? 'In Register' : `Rev: ${formatCurrency(dashboard.totalRevenue, symbol)}`}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Products Available
            </span>
            <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">{dashboard.totalProducts}</div>
            <div className="text-xs text-slate-500 mt-1">
              {isWorker ? 'Active Batches in Stock' : `Stock Value: ${formatCurrency(dashboard.totalStockValue, symbol)}`}
            </div>
          </div>
        </div>

        <div
          onClick={() => onNavigate('inventory')}
          className="bg-white rounded-2xl border border-amber-200 p-4 shadow-2xs flex flex-col justify-between cursor-pointer hover:border-amber-300 transition"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
              Low-Stock Items
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-amber-700">{dashboard.lowStockCount}</div>
            <div className="text-xs text-amber-600 font-medium mt-1 flex items-center gap-1">
              Needs restocking <ArrowUpRight className="w-3.5 h-3.5" />
            </div>
          </div>
        </div>

        <div
          onClick={() => onNavigate('inventory')}
          className="bg-white rounded-2xl border border-red-200 p-4 shadow-2xs flex flex-col justify-between cursor-pointer hover:border-red-300 transition"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-red-700 uppercase tracking-wider">
              Out of Stock
            </span>
            <div className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
              <XCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-red-700">{dashboard.outOfStockCount}</div>
            <div className="text-xs text-red-600 font-medium mt-1 flex items-center gap-1">
              {dashboard.expiringSoonCount + dashboard.expiredCount} expiring/expired
            </div>
          </div>
        </div>

        <div
          onClick={() => onNavigate('customers')}
          className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between cursor-pointer hover:border-sky-300 transition"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Customers
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">{dashboard.totalCustomers}</div>
            <div className="text-xs text-slate-500 mt-1">
              {isWorker ? 'Customer Directory' : `Pending Dues: ${formatCurrency(dashboard.totalReceivables, symbol)}`}
            </div>
          </div>
        </div>
      </div>

      {/* Sales Overview & Stock Alerts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Daily / Weekly / Monthly Sales Overview (Owner Only) OR Staff Counter Operations (Worker) */}
        {isWorker ? (
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="pb-4 border-b border-slate-100 flex items-center gap-2">
                <FileText className="w-5 h-5 text-sky-600" />
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Counter Chemist POS Terminal
                  </h3>
                  <p className="text-xs text-slate-500">
                    Quick billing, stock lookup, and customer prescription processing
                  </p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <button
                  type="button"
                  onClick={() => onNavigate('billing')}
                  className="p-4 rounded-xl border border-sky-200 bg-sky-50/70 hover:bg-sky-100/70 text-left transition flex items-start gap-3 cursor-pointer group"
                >
                  <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-xs group-hover:scale-105 transition">
                    <PlusCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">New Customer Bill (POS)</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Fast medicine barcode / name search, GST computation & invoice print
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onNavigate('products')}
                  className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70 text-left transition flex items-start gap-3 cursor-pointer group"
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs group-hover:scale-105 transition">
                    <Package className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">Search Medicine & Stock</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Check available batch quantity, expiry dates, rack locations, and MRP
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onNavigate('invoices')}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100/70 text-left transition flex items-start gap-3 cursor-pointer group"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-700 text-white flex items-center justify-center shrink-0 shadow-xs group-hover:scale-105 transition">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">Reprint Past Invoices</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Print A4 GST tax invoices or 80mm thermal slips for customers
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onNavigate('customers')}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100/70 text-left transition flex items-start gap-3 cursor-pointer group"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-700 text-white flex items-center justify-center shrink-0 shadow-xs group-hover:scale-105 transition">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">Customers & Outstanding</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Look up buyer details, contact numbers, and record customer payments
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <div className="mt-5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px] text-slate-600 flex items-center gap-2">
              <span className="font-bold text-emerald-700">🔒 Staff Protection Active:</span>
              Wholesale purchase costs (PTS) and proprietor financial margins are hidden.
            </div>
          </div>
        ) : (
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-sky-600" />
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Sales & Profit Overview
                    </h3>
                    <p className="text-xs text-slate-500">
                      Automatic real-time revenue and profit tracking
                    </p>
                  </div>
                </div>

                <div className="inline-flex rounded-xl bg-slate-100 p-1">
                  {[
                    { id: 'daily', label: 'Daily (7D)' },
                    { id: 'weekly', label: 'Weekly (4W)' },
                    { id: 'monthly', label: 'Monthly (6M)' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setOverviewPeriod(tab.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        overviewPeriod === tab.id
                          ? 'bg-white text-sky-700 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Visual Bar Chart */}
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3 items-end min-h-[190px] pt-4 px-2">
                {chartData.map((item, idx) => {
                  const heightPct = Math.max(8, Math.round((Number(item.sales) / maxSales) * 100));
                  return (
                    <div key={idx} className="flex flex-col items-center gap-2">
                      <div className="text-[11px] font-bold text-slate-700">
                        {formatCurrency(item.sales, symbol)}
                      </div>
                      <div className="w-full max-w-[44px] h-32 bg-slate-100 rounded-xl flex items-end overflow-hidden p-1">
                        <div
                          style={{ height: `${heightPct}%` }}
                          className="w-full rounded-lg bg-gradient-to-t from-sky-600 to-emerald-500 transition-all"
                        />
                      </div>
                      <div className="text-[11px] font-semibold text-slate-600 text-center">
                        {item.label}
                      </div>
                      <div className="text-[10px] text-slate-400">{item.bills} bill(s)</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-3 gap-4 text-xs">
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/70">
                <div className="text-slate-500">Today's Net Profit</div>
                <div className="text-sm font-bold text-emerald-700 mt-0.5">
                  {formatCurrency(dashboard.profitToday, symbol)}
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/70">
                <div className="text-slate-500">Lifetime Profit</div>
                <div className="text-sm font-bold text-sky-700 mt-0.5">
                  {formatCurrency(dashboard.totalProfit, symbol)}
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/70">
                <div className="text-slate-500">Retail Stock Value</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  {formatCurrency(dashboard.totalRetailValue, symbol)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Low Stock, Out of Stock & Expiry Alerts Panel */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Stock & Expiry Alerts
                  </h3>
                  <p className="text-xs text-slate-500">
                    Medicines below minimum threshold or nearing expiry
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="text-xs font-semibold text-sky-600 hover:text-sky-800 cursor-pointer"
              >
                Manage Stock →
              </button>
            </div>

            <div className="mt-3 space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
              {dashboard.outOfStockProducts?.map((p) => (
                <div
                  key={`out-${p.id}`}
                  className="flex items-center justify-between p-3 rounded-xl bg-red-50/70 border border-red-200 text-xs"
                >
                  <div>
                    <div className="font-bold text-slate-900">{p.name}</div>
                    <div className="text-slate-500 mt-0.5">
                      SKU: {p.sku} • Batch: {p.batch_number} • Min: {p.min_stock_level}
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-red-600 text-white font-bold text-[11px]">
                    Out of Stock (0)
                  </span>
                </div>
              ))}

              {dashboard.lowStockProducts?.map((p) => (
                <div
                  key={`low-${p.id}`}
                  className="flex items-center justify-between p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-xs"
                >
                  <div>
                    <div className="font-bold text-slate-900">{p.name}</div>
                    <div className="text-slate-500 mt-0.5">
                      SKU: {p.sku} • Batch: {p.batch_number} • Min: {p.min_stock_level}
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300 font-bold text-[11px]">
                    Low: {p.stock} left
                  </span>
                </div>
              ))}

              {dashboard.expiringProducts?.map((p) => (
                <div
                  key={`exp-${p.id}`}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                >
                  <div>
                    <div className="font-bold text-slate-900">{p.name}</div>
                    <div className="text-slate-500 mt-0.5">
                      Batch: {p.batch_number} • Stock: {p.stock}
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-semibold text-[11px]">
                    <Clock className="w-3 h-3" />
                    Exp: {p.expiry_date}
                  </span>
                </div>
              ))}

              {dashboard.outOfStockProducts?.length === 0 &&
                dashboard.lowStockProducts?.length === 0 &&
                dashboard.expiringProducts?.length === 0 && (
                  <div className="py-10 text-center text-xs text-slate-400">
                    All medicines are well-stocked and within valid expiry dates.
                  </div>
                )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Transactions Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">Recent Transactions & Bills</h3>
            <p className="text-xs text-slate-500">
              Click any invoice to view, print (A4 or Thermal), or download PDF
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('invoices')}
            className="text-xs font-semibold text-sky-600 hover:text-sky-800 cursor-pointer"
          >
            View All Invoices →
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-semibold">Invoice No</th>
                <th className="py-3 px-4 font-semibold">Date & Time</th>
                <th className="py-3 px-4 font-semibold">Customer</th>
                <th className="py-3 px-4 font-semibold text-center">Items</th>
                <th className="py-3 px-4 font-semibold">Payment</th>
                <th className="py-3 px-4 font-semibold text-right">Grand Total</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(dashboard.recentInvoices || []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    No bills generated yet. Click "New Customer Bill (POS)" to create your first invoice!
                  </td>
                </tr>
              ) : (
                dashboard.recentInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-4 font-bold text-sky-700">{inv.invoice_number}</td>
                    <td className="py-3 px-4 text-slate-600">{formatDateTime(inv.created_at)}</td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{inv.customer_name}</div>
                      {inv.customer_phone && (
                        <div className="text-[11px] text-slate-500">{inv.customer_phone}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center font-medium text-slate-700">
                      {(inv.items || []).length}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          inv.payment_status === 'Paid'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : inv.payment_status === 'Partial'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                        }`}
                      >
                        {inv.payment_method} • {inv.payment_status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-slate-900">
                      {formatCurrency(inv.grand_total, symbol)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onViewInvoice(inv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold transition cursor-pointer"
                          title="View & Print Invoice"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          View / Print
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            downloadInvoicePDF(
                              inv,
                              settings,
                              settings?.default_invoice_format || 'A4'
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold transition cursor-pointer"
                          title="Download PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                          PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

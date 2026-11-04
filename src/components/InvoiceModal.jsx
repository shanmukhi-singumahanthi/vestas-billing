import React, { useState } from 'react';
import { Printer, Download, X, FileText, Receipt, CheckCircle2 } from 'lucide-react';
import {
  formatCurrency,
  formatDateTime,
  formatDateShort,
  numberToIndianWords,
  downloadInvoicePDF,
} from '../utils/exportAndPdf';

export function VestasLogo({ logoUrl, size = 'md', variant = 'mark' }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt="Vestas Pharmaceuticals Logo"
        className={size === 'lg' ? 'h-14 w-auto object-contain' : 'h-10 w-auto object-contain'}
      />
    );
  }

  if (variant === 'full') {
    const scaleClass =
      size === 'lg' ? 'w-48 h-auto' : size === 'sm' ? 'w-32 h-auto' : 'w-40 h-auto';
    return (
      <div className="inline-flex flex-col select-none">
        <svg
          viewBox="0 0 240 105"
          className={scaleClass}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Grey lower V-chevron */}
          <polygon points="140,14 218,14 179,50" fill="#73787C" />
          {/* White cutout to create the V-chevron and gap */}
          <polygon points="146,11 212,11 179,41.5" fill="#FFFFFF" />
          {/* Vermilion Red upper solid inverted triangle */}
          <polygon points="140,6 218,6 179,40" fill="#D63B24" />

          {/* "v e s t a s" lowercase wide-tracked typography */}
          <text
            x="118"
            y="77"
            textAnchor="middle"
            fill="#1E242B"
            fontFamily="Inter, 'Segoe UI', Arial, sans-serif"
            fontWeight="600"
            fontSize="36"
            letterSpacing="8"
          >
            vestas
          </text>

          {/* "PHARMACEUTICALS" uppercase wide-tracked subtext */}
          <text
            x="119"
            y="97"
            textAnchor="middle"
            fill="#2C333A"
            fontFamily="Inter, 'Segoe UI', Arial, sans-serif"
            fontWeight="500"
            fontSize="12.5"
            letterSpacing="2.4"
          >
            PHARMACEUTICALS
          </text>
        </svg>
      </div>
    );
  }

  const dims = size === 'lg' ? 'w-12 h-12' : 'w-10 h-10';
  return (
    <div
      className={`${dims} rounded-xl bg-white border border-slate-200/90 flex items-center justify-center shadow-xs shrink-0`}
    >
      <svg viewBox="0 0 64 54" className="w-8 h-7" fill="none">
        {/* Grey lower V-chevron */}
        <polygon points="6,14 58,14 32,46" fill="#73787C" />
        {/* White gap cutout */}
        <polygon points="11,11 53,11 32,37.5" fill="#FFFFFF" />
        {/* Vermilion Red upper solid triangle */}
        <polygon points="6,6 58,6 32,35.5" fill="#D63B24" />
      </svg>
    </div>
  );
}

export default function InvoiceModal({ invoice, settings = {}, onClose }) {
  const [layout, setLayout] = useState(settings.default_invoice_format || 'A4');

  if (!invoice) return null;

  const symbol = settings.currency_symbol || '₹';
  const bizName = settings.business_name || 'VESTAS PHARMACEUTICALS';
  const ownerName = settings.owner_name || 'S. SATYENDRANATH';
  const tagline = settings.tagline || 'Pharmaceutical Distributors & Wholesale Chemists';
  const address =
    settings.address ||
    '27-18-92/A, 1st Floor, Ganesh Complex, Congress Office Road, Governorpet, Vijayawada, AP - 520002';
  const phone = settings.phone || '9603033345';
  const email = settings.email || 'ssatyendranth@gmail.com';
  const gstin = settings.gstin || '37BHCPS0456G1ZB';
  const dl1 = settings.dl_no_1 || 'AP/VJA/20B/104928';
  const dl2 = settings.dl_no_2 || 'AP/VJA/21B/104929';
  const terms =
    settings.terms_and_conditions ||
    '1. Goods once sold will not be taken back without valid invoice.\n2. Refrigerated & expiry medicines are non-returnable.\n3. Subject to Vijayawada jurisdiction.';

  const showHsn = settings.show_hsn_on_invoice !== false;
  const showBatchExp = settings.show_batch_expiry_on_invoice !== false;
  const showMrp = settings.show_mrp_on_invoice !== false;

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = () => {
    downloadInvoicePDF(invoice, settings, layout);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[94vh] flex flex-col overflow-hidden">
        {/* Top Action Bar (Hidden when printing) */}
        <div className="no-print px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Invoice {invoice.invoice_number}
            </span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setLayout('A4')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
                  layout === 'A4'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                A4 Tax Invoice
              </button>
              <button
                type="button"
                onClick={() => setLayout('THERMAL')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
                  layout === 'THERMAL'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Receipt className="w-3.5 h-3.5" />
                Thermal Receipt (80mm)
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Download PDF
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white shadow-xs transition cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Print Invoice
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Document Container */}
        <div className="p-4 sm:p-8 overflow-y-auto bg-slate-100/70 flex justify-center">
          {layout === 'THERMAL' ? (
            /* 80mm Thermal Receipt Layout */
            <div
              id="printable-invoice-area"
              className="bg-white border border-slate-200 shadow-sm p-5 w-[320px] text-slate-900 font-mono text-xs leading-relaxed"
            >
              <div className="text-center border-b border-dashed border-slate-400 pb-3 mb-3">
                <div className="font-bold text-sm tracking-tight">{bizName}</div>
                <div className="text-[11px] text-slate-600 mt-0.5">{address}</div>
                <div className="text-[11px] mt-1">Ph: {phone}</div>
                <div className="text-[11px]">GSTIN: {gstin}</div>
                <div className="text-[10px] text-slate-600">
                  DL: {dl1}, {dl2}
                </div>
              </div>

              <div className="border-b border-dashed border-slate-400 pb-2 mb-2 text-[11px] space-y-0.5">
                <div className="flex justify-between font-bold">
                  <span>Inv: {invoice.invoice_number}</span>
                  <span>{formatDateShort(invoice.created_at)}</span>
                </div>
                <div>Customer: {invoice.customer_name || 'Walk-in Customer'}</div>
                {invoice.customer_phone && <div>Phone: {invoice.customer_phone}</div>}
                {invoice.doctor_name && <div>Dr: {invoice.doctor_name}</div>}
              </div>

              <table className="w-full text-[11px] border-b border-dashed border-slate-400 mb-2">
                <thead>
                  <tr className="border-b border-dashed border-slate-400 text-left">
                    <th className="py-1">Item</th>
                    <th className="py-1 text-right">Qty</th>
                    <th className="py-1 text-right">Rate</th>
                    <th className="py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dotted divide-slate-200">
                  {(invoice.items || []).map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-1.5 pr-1">
                        <div className="font-semibold">{item.product_name}</div>
                        <div className="text-[10px] text-slate-500">
                          B:{item.batch_number} Exp:{item.expiry_date}
                        </div>
                      </td>
                      <td className="py-1.5 text-right align-top">{item.quantity}</td>
                      <td className="py-1.5 text-right align-top">
                        {Number(item.unit_price).toFixed(2)}
                      </td>
                      <td className="py-1.5 text-right font-semibold align-top">
                        {Number(item.line_total).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="space-y-1 text-[11px] border-b border-dashed border-slate-400 pb-2 mb-2">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(invoice.subtotal, symbol)}</span>
                </div>
                {Number(invoice.discount_amount) > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Discount:</span>
                    <span>-{formatCurrency(invoice.discount_amount, symbol)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>GST (CGST+SGST):</span>
                  <span>{formatCurrency(invoice.tax_amount, symbol)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold pt-1 border-t border-dashed border-slate-300">
                  <span>GRAND TOTAL:</span>
                  <span>{formatCurrency(invoice.grand_total, symbol)}</span>
                </div>
              </div>

              <div className="text-[11px] space-y-0.5 mb-3">
                <div className="flex justify-between">
                  <span>Payment ({invoice.payment_method}):</span>
                  <span className="font-semibold">{invoice.payment_status}</span>
                </div>
                <div className="flex justify-between">
                  <span>Amount Paid:</span>
                  <span>{formatCurrency(invoice.amount_paid, symbol)}</span>
                </div>
                {Number(invoice.balance_due) > 0 && (
                  <div className="flex justify-between font-bold text-red-600">
                    <span>Balance Due:</span>
                    <span>{formatCurrency(invoice.balance_due, symbol)}</span>
                  </div>
                )}
              </div>

              <div className="text-center text-[10px] text-slate-500 pt-2 border-t border-dashed border-slate-400">
                <p className="font-semibold text-slate-700">Thank you for choosing {bizName}!</p>
                <p className="mt-0.5">Get well soon.</p>
              </div>
            </div>
          ) : (
            /* Standard A4 Full Tax Invoice Layout */
            <div
              id="printable-invoice-area"
              className="bg-white border border-slate-200 rounded-xl shadow-xs p-6 sm:p-8 w-full max-w-[794px] text-slate-800"
            >
              {/* Header */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pb-5 border-b-2 border-sky-600">
                <div className="flex flex-col sm:flex-row items-start gap-4">
                  <div className="bg-slate-50/70 px-3 py-2 rounded-xl border border-slate-200/80">
                    <VestasLogo logoUrl={settings.logo_url} size="md" variant="full" />
                  </div>
                  <div>
                    <h1 className="text-lg font-bold text-slate-900 tracking-tight uppercase">
                      {bizName}
                    </h1>
                    <p className="text-xs font-medium text-sky-700">{tagline}</p>
                    <p className="text-xs text-slate-600 mt-1 max-w-md leading-relaxed">
                      {address}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-700 mt-1.5 font-medium">
                      <span>Phone: {phone}</span>
                      {email && <span>Email: {email}</span>}
                      {ownerName && <span>Prop: {ownerName}</span>}
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs sm:text-right shrink-0 w-full sm:w-auto">
                  <div className="text-sm font-bold text-sky-700 uppercase tracking-wider mb-1">
                    TAX INVOICE
                  </div>
                  <div className="font-semibold text-slate-800">GSTIN: {gstin}</div>
                  <div className="text-slate-600 mt-0.5">D.L. No 1: {dl1}</div>
                  <div className="text-slate-600">D.L. No 2: {dl2}</div>
                </div>
              </div>

              {/* Customer & Invoice Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4 border-b border-slate-200 text-xs">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Billed To (Customer Details)
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    {invoice.customer_name || 'Walk-in Customer'}
                  </div>
                  {invoice.customer_phone && (
                    <div className="text-slate-600 mt-0.5">Phone: {invoice.customer_phone}</div>
                  )}
                  {invoice.customer_address && (
                    <div className="text-slate-600 mt-0.5">Address: {invoice.customer_address}</div>
                  )}
                  <div className="flex flex-wrap gap-3 mt-1 text-slate-700 font-medium">
                    {invoice.customer_gstin && <span>GSTIN: {invoice.customer_gstin}</span>}
                    {invoice.customer_dl && <span>DL No: {invoice.customer_dl}</span>}
                  </div>
                  {invoice.doctor_name && (
                    <div className="text-slate-600 mt-0.5">Prescribed By: {invoice.doctor_name}</div>
                  )}
                </div>

                <div className="sm:text-right space-y-1">
                  <div className="flex sm:justify-end gap-2">
                    <span className="text-slate-500">Invoice Number:</span>
                    <span className="font-bold text-slate-900">{invoice.invoice_number}</span>
                  </div>
                  <div className="flex sm:justify-end gap-2">
                    <span className="text-slate-500">Date & Time:</span>
                    <span className="font-medium text-slate-800">
                      {formatDateTime(invoice.created_at)}
                    </span>
                  </div>
                  <div className="flex sm:justify-end gap-2">
                    <span className="text-slate-500">Payment Mode:</span>
                    <span className="font-semibold text-slate-800">{invoice.payment_method}</span>
                  </div>
                  <div className="flex sm:justify-end gap-2">
                    <span className="text-slate-500">Status:</span>
                    <span
                      className={`font-semibold ${
                        invoice.payment_status === 'Paid'
                          ? 'text-emerald-700'
                          : invoice.payment_status === 'Partial'
                          ? 'text-amber-700'
                          : 'text-red-700'
                      }`}
                    >
                      {invoice.payment_status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div className="my-4 overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-sky-600 text-white text-left">
                      <th className="py-2 px-2.5 font-semibold rounded-tl-md">#</th>
                      <th className="py-2 px-2.5 font-semibold">Medicine / Product Description</th>
                      <th className="py-2 px-2 font-semibold">Pack</th>
                      {showHsn && <th className="py-2 px-2 font-semibold">HSN</th>}
                      {showBatchExp && <th className="py-2 px-2 font-semibold">Batch</th>}
                      {showBatchExp && <th className="py-2 px-2 font-semibold">Exp</th>}
                      <th className="py-2 px-2 font-semibold text-center">Qty</th>
                      {showMrp && <th className="py-2 px-2 font-semibold text-right">MRP</th>}
                      <th className="py-2 px-2 font-semibold text-right">Rate</th>
                      <th className="py-2 px-2 font-semibold text-right">Disc%</th>
                      <th className="py-2 px-2 font-semibold text-right">GST%</th>
                      <th className="py-2 px-2.5 font-semibold text-right rounded-tr-md">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 border-x border-b border-slate-200">
                    {(invoice.items || []).map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/80">
                        <td className="py-2 px-2.5 text-slate-500">{idx + 1}</td>
                        <td className="py-2 px-2.5 font-semibold text-slate-900">
                          {item.product_name}
                        </td>
                        <td className="py-2 px-2 text-slate-600">{item.pack_size || '-'}</td>
                        {showHsn && (
                          <td className="py-2 px-2 text-slate-600">{item.hsn_code || '3004'}</td>
                        )}
                        {showBatchExp && (
                          <td className="py-2 px-2 font-mono text-[11px] text-slate-700">
                            {item.batch_number || '-'}
                          </td>
                        )}
                        {showBatchExp && (
                          <td className="py-2 px-2 text-slate-600">{item.expiry_date || '-'}</td>
                        )}
                        <td className="py-2 px-2 text-center font-semibold text-slate-900">
                          {item.quantity}
                        </td>
                        {showMrp && (
                          <td className="py-2 px-2 text-right text-slate-500">
                            {Number(item.mrp || 0).toFixed(2)}
                          </td>
                        )}
                        <td className="py-2 px-2 text-right font-medium text-slate-800">
                          {Number(item.unit_price || 0).toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-600">
                          {Number(item.item_discount_percent || 0) > 0
                            ? `${Number(item.item_discount_percent)}%`
                            : '-'}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-600">
                          {Number(item.gst_percentage || 0)}%
                        </td>
                        <td className="py-2 px-2.5 text-right font-bold text-slate-900">
                          {formatCurrency(item.line_total, symbol)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer Totals & Signatory */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 pt-3 border-t border-slate-200 text-xs">
                <div className="sm:col-span-7 space-y-3">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <div className="text-[11px] font-semibold uppercase text-slate-400">
                      Amount in Words
                    </div>
                    <div className="font-semibold text-slate-800 mt-0.5">
                      {numberToIndianWords(invoice.grand_total)}
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-600 bg-sky-50/60 border border-sky-100 rounded-lg px-3 py-2 flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      <strong>CGST:</strong>{' '}
                      {formatCurrency(Number(invoice.tax_amount || 0) / 2, symbol)}
                    </span>
                    <span>
                      <strong>SGST:</strong>{' '}
                      {formatCurrency(Number(invoice.tax_amount || 0) / 2, symbol)}
                    </span>
                    <span>
                      <strong>Total GST:</strong> {formatCurrency(invoice.tax_amount, symbol)}
                    </span>
                  </div>

                  <div>
                    <div className="font-semibold text-slate-700 mb-1">Terms & Conditions:</div>
                    <div className="text-[11px] text-slate-500 whitespace-pre-line leading-relaxed">
                      {terms}
                    </div>
                  </div>
                </div>

                <div className="sm:col-span-5 flex flex-col justify-between">
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2">
                    <div className="flex justify-between text-slate-600">
                      <span>Taxable Subtotal:</span>
                      <span className="font-medium text-slate-900">
                        {formatCurrency(invoice.subtotal, symbol)}
                      </span>
                    </div>
                    {Number(invoice.discount_amount) > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>Discount Applied:</span>
                        <span className="font-medium">
                          - {formatCurrency(invoice.discount_amount, symbol)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-600">
                      <span>Total GST (CGST + SGST):</span>
                      <span className="font-medium text-slate-900">
                        {formatCurrency(invoice.tax_amount, symbol)}
                      </span>
                    </div>
                    {Number(invoice.round_off || 0) !== 0 && (
                      <div className="flex justify-between text-slate-500">
                        <span>Round Off:</span>
                        <span>{formatCurrency(invoice.round_off, symbol)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-bold text-sky-800 pt-2 border-t border-slate-200">
                      <span>Grand Total:</span>
                      <span>{formatCurrency(invoice.grand_total, symbol)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600 pt-1">
                      <span>Amount Paid ({invoice.payment_method}):</span>
                      <span className="font-semibold text-emerald-700">
                        {formatCurrency(invoice.amount_paid, symbol)}
                      </span>
                    </div>
                    {Number(invoice.balance_due) > 0 && (
                      <div className="flex justify-between text-red-600 font-bold">
                        <span>Balance Due:</span>
                        <span>{formatCurrency(invoice.balance_due, symbol)}</span>
                      </div>
                    )}
                  </div>

                  <div className="text-right mt-6 pt-6">
                    <div className="font-bold text-slate-800">For {bizName}</div>
                    <div className="text-[11px] text-slate-400 mt-6">Authorized Signatory</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

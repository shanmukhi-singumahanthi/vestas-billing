import React, { useState } from 'react';
import { Printer, Download, X, FileText, Receipt, CheckCircle2, Stamp } from 'lucide-react';
import {
  formatCurrency,
  formatDateTime,
  formatDateShort,
  numberToIndianWords,
  downloadInvoicePDF,
} from '../utils/exportAndPdf';

export function VestasLogo({ logoUrl, size = 'md', variant = 'mark' }) {
  const effectiveUrl = logoUrl || '/logo.png';

  if (variant === 'full') {
    const scaleClass =
      size === 'lg'
        ? 'h-16 w-auto max-w-[220px]'
        : size === 'sm'
        ? 'h-9 w-auto max-w-[140px]'
        : 'h-12 w-auto max-w-[180px]';

    return (
      <div className="inline-flex items-center select-none">
        <img
          src={effectiveUrl}
          alt="Vestas Pharmaceuticals Logo"
          className={`${scaleClass} object-contain rounded-md`}
        />
      </div>
    );
  }

  const dims = size === 'lg' ? 'w-14 h-14' : size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  return (
    <div
      className={`${dims} rounded-xl bg-white border border-slate-200/90 p-1 flex items-center justify-center shadow-xs shrink-0 overflow-hidden`}
    >
      <img
        src={effectiveUrl}
        alt="Vestas Logo"
        className="w-full h-full object-contain select-none"
      />
    </div>
  );
}

export default function InvoiceModal({ invoice, settings = {}, onClose }) {
  // Default to WHOLESALE layout matching the official physical GST invoice
  const [layout, setLayout] = useState('WHOLESALE');

  if (!invoice) return null;

  const symbol = settings.currency_symbol || '₹';
  const bizName = settings.business_name || 'VESTAS PHARMACEUTICALS';
  const address = settings.address || 'dr.no:28-1-64, 1st floor, elururoad, VIJAYAWADA';
  const phone = settings.phone || '0866-3569652';
  const gstin = settings.gstin || '37BHCPS0456G1ZB';
  const dl1 = settings.dl_no_1 || '20B-AP/20/04/2024/4838';
  const dl2 = settings.dl_no_2 || '21B-AP/20/04/2024/4838';
  const panNo = settings.pan_no || 'BHCPS0456G';

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = () => {
    downloadInvoicePDF(invoice, settings, layout);
  };

  // Compute GST slabs breakdown dynamically (0%, 5%, 12%, 18%, 28%)
  const slabs = [0, 5, 12, 18, 28];
  const slabMap = {
    0: { taxable: 0, cgstVal: 0, cgstAmt: 0, sgstVal: 0, sgstAmt: 0 },
    5: { taxable: 0, cgstVal: 0, cgstAmt: 0, sgstVal: 0, sgstAmt: 0 },
    12: { taxable: 0, cgstVal: 0, cgstAmt: 0, sgstVal: 0, sgstAmt: 0 },
    18: { taxable: 0, cgstVal: 0, cgstAmt: 0, sgstVal: 0, sgstAmt: 0 },
    28: { taxable: 0, cgstVal: 0, cgstAmt: 0, sgstVal: 0, sgstAmt: 0 },
  };

  (invoice.items || []).forEach((it) => {
    const rawGst = Number(it.gst_percentage || 0);
    const gstRate = slabs.includes(Math.round(rawGst)) ? Math.round(rawGst) : 12;
    const taxable = Number(it.taxable_amount || (Number(it.unit_price) * Number(it.quantity)));
    const gstAmt = Number(it.gst_amount || (taxable * (gstRate / 100)));
    const halfTaxable = taxable / 2;
    const halfGst = gstAmt / 2;

    if (slabMap[gstRate]) {
      slabMap[gstRate].taxable += taxable;
      slabMap[gstRate].cgstVal += halfTaxable;
      slabMap[gstRate].cgstAmt += halfGst;
      slabMap[gstRate].sgstVal += halfTaxable;
      slabMap[gstRate].sgstAmt += halfGst;
    }
  });

  const totalUnits = (invoice.items || []).reduce(
    (sum, it) => sum + (Number(it.quantity) || 0) + (Number(it.free_quantity) || 0),
    0
  );
  const totalItemsCount = (invoice.items || []).length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[96vh] flex flex-col overflow-hidden">
        {/* Top Action Bar (Hidden during printing) */}
        <div className="no-print px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Invoice {invoice.invoice_number}
            </span>

            {/* Layout selector tabs */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setLayout('WHOLESALE')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
                  layout === 'WHOLESALE'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Stamp className="w-3.5 h-3.5" />
                Wholesale GST (Official)
              </button>
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
                Retail A4
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
                Thermal (80mm)
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

        {/* Printable Invoice Container */}
        <div className="p-3 sm:p-6 overflow-y-auto bg-slate-100/70 flex justify-center">
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
                      <td className="py-1.5 text-right align-top">
                        {item.quantity} {Number(item.free_quantity) > 0 && `(+${item.free_quantity})`}
                      </td>
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
                <div className="flex justify-between">
                  <span>GST:</span>
                  <span>{formatCurrency(invoice.tax_amount, symbol)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold pt-1 border-t border-dashed border-slate-300">
                  <span>NET PAYABLE:</span>
                  <span>{formatCurrency(invoice.grand_total, symbol)}</span>
                </div>
              </div>

              <div className="text-center text-[10px] text-slate-500 pt-2 border-t border-dashed border-slate-400">
                <p className="font-semibold text-slate-700">Thank you for choosing {bizName}!</p>
              </div>
            </div>
          ) : layout === 'WHOLESALE' ? (
            /* OFFICIAL VESTAS PHARMACEUTICALS GST INVOICE LAYOUT */
            <div
              id="printable-invoice-area"
              className="bg-white border-2 border-slate-800 p-4 sm:p-6 w-full max-w-[840px] text-slate-900 font-sans text-xs shadow-md"
            >
              {/* TOP HEADER BOX */}
              <div className="grid grid-cols-12 border-b-2 border-slate-800 pb-3">
                {/* Firm Details (Left 7 cols) */}
                <div className="col-span-7 pr-3 space-y-0.5">
                  <h1 className="text-base sm:text-lg font-black tracking-wider text-slate-900 uppercase">
                    {bizName}
                  </h1>
                  <div className="text-[11px] leading-tight text-slate-800">
                    {address} &nbsp; Phone No: {phone}
                  </div>
                  <div className="text-[11px] text-slate-800">Pan No: {panNo}</div>
                  <div className="text-[11px] leading-tight text-slate-800">
                    Dl No's: {dl1}, {dl2}
                  </div>
                  <div className="text-[11px] font-bold text-slate-900">
                    GSTIN: {gstin}
                  </div>
                </div>

                {/* Title & Customer (Right 5 cols) */}
                <div className="col-span-5 pl-3 border-l border-slate-800 space-y-0.5">
                  <div className="text-center font-bold text-sm uppercase tracking-widest text-slate-900 border-b border-slate-400 pb-1 mb-1">
                    GST INVOICE
                  </div>
                  <div className="font-bold text-[11px] uppercase text-slate-900">
                    TO: {invoice.customer_name || 'Walk-in Customer'}
                  </div>
                  <div className="text-[11px] text-slate-700 leading-tight">
                    {invoice.customer_address || 'Vijayawada'}
                  </div>
                  {invoice.customer_phone && (
                    <div className="text-[11px] text-slate-700">
                      Ph No: {invoice.customer_phone}
                    </div>
                  )}
                  <div className="text-[11px] text-slate-800">
                    DL No: {invoice.customer_dl || '-'}
                  </div>
                  <div className="text-[11px] font-semibold text-slate-900">
                    GSTIN : {invoice.customer_gstin || '-'}
                  </div>
                </div>
              </div>

              {/* INVOICE METADATA ROW */}
              <div className="grid grid-cols-12 border-b border-slate-800 py-1.5 text-[11px] font-medium bg-slate-50/50">
                <div className="col-span-4">
                  <span className="text-slate-600">Inv No : </span>
                  <strong className="text-slate-900">{invoice.invoice_number}</strong>
                </div>
                <div className="col-span-4">
                  <span className="text-slate-600">Inv Date: </span>
                  <strong className="text-slate-900">
                    {invoice.created_at ? formatDateShort(invoice.created_at) : '04/11/2026'}
                  </strong>
                </div>
                <div className="col-span-4">
                  <span className="text-slate-600">Type : </span>
                  <strong className="text-slate-900">{invoice.payment_method === 'Credit' ? 'Credit' : 'Cash / Paid'}</strong>
                </div>
              </div>

              {/* MEDICINES LINE ITEMS TABLE */}
              <div className="overflow-x-auto my-1 border-b border-slate-800">
                <table className="w-full text-[10px] sm:text-[11px] text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-100 font-bold uppercase text-slate-900">
                      <th className="py-1.5 px-1 border-r border-slate-300">Mfg</th>
                      <th className="py-1.5 px-2 border-r border-slate-300">Product Name</th>
                      <th className="py-1.5 px-1 border-r border-slate-300">Packing</th>
                      <th className="py-1.5 px-1 border-r border-slate-300">HSN</th>
                      <th className="py-1.5 px-1 border-r border-slate-300">Batch No</th>
                      <th className="py-1.5 px-1 border-r border-slate-300 text-center">Exp</th>
                      <th className="py-1.5 px-1 border-r border-slate-300 text-center">Qty</th>
                      <th className="py-1.5 px-1 border-r border-slate-300 text-center bg-emerald-50">Free</th>
                      <th className="py-1.5 px-1.5 border-r border-slate-300 text-right">Rate</th>
                      <th className="py-1.5 px-1 border-r border-slate-300 text-center">Dist</th>
                      <th className="py-1.5 px-1.5 border-r border-slate-300 text-right">MRP</th>
                      <th className="py-1.5 px-1.5 border-r border-slate-300 text-right">P.T.R</th>
                      <th className="py-1.5 px-1 border-r border-slate-300 text-center">CGST%</th>
                      <th className="py-1.5 px-1.5 border-r border-slate-300 text-right">T.Amt</th>
                      <th className="py-1.5 px-1 border-r border-slate-300 text-center">SGST%</th>
                      <th className="py-1.5 px-1.5 border-r border-slate-300 text-right">T.Amt</th>
                      <th className="py-1.5 px-2 text-right">Total Amt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(invoice.items || []).map((item, idx) => {
                      const gstPct = Number(item.gst_percentage || 5);
                      const halfGstPct = +(gstPct / 2).toFixed(1);
                      const halfGstAmt = +(Number(item.gst_amount || 0) / 2).toFixed(2);
                      const expDisplay = (item.expiry_date || '').length >= 7
                        ? `${item.expiry_date.slice(5, 7)}/${item.expiry_date.slice(2, 4)}`
                        : (item.expiry_date || '03/28');

                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-1.5 px-1 border-r border-slate-200 font-mono text-[10px] text-slate-600">
                            {item.mfg || 'aas'}
                          </td>
                          <td className="py-1.5 px-2 border-r border-slate-200 font-bold text-slate-900">
                            {item.product_name}
                          </td>
                          <td className="py-1.5 px-1 border-r border-slate-200 text-slate-600">
                            {item.pack_size || '10*10'}
                          </td>
                          <td className="py-1.5 px-1 border-r border-slate-200 text-slate-600">
                            {item.hsn_code || '185'}
                          </td>
                          <td className="py-1.5 px-1 border-r border-slate-200 font-mono text-slate-800">
                            {item.batch_number || 'ASKT-26339'}
                          </td>
                          <td className="py-1.5 px-1 border-r border-slate-200 text-center text-slate-700">
                            {expDisplay}
                          </td>
                          <td className="py-1.5 px-1 border-r border-slate-200 text-center font-bold text-slate-900">
                            {item.quantity}
                          </td>
                          <td className="py-1.5 px-1 border-r border-slate-200 text-center font-bold text-emerald-700 bg-emerald-50/50">
                            {item.free_quantity !== undefined && Number(item.free_quantity) > 0 ? Number(item.free_quantity).toFixed(1) : '0.0'}
                          </td>
                          <td className="py-1.5 px-1.5 border-r border-slate-200 text-right font-medium">
                            {Number(item.purchase_price || item.unit_price).toFixed(2)}
                          </td>
                          <td className="py-1.5 px-1 border-r border-slate-200 text-center text-slate-500">
                            {Number(item.item_discount_percent || 0).toFixed(1)}
                          </td>
                          <td className="py-1.5 px-1.5 border-r border-slate-200 text-right text-slate-600">
                            {Number(item.mrp || 0).toFixed(2)}
                          </td>
                          <td className="py-1.5 px-1.5 border-r border-slate-200 text-right font-medium text-slate-800">
                            {Number(item.unit_price || item.ptr || 0).toFixed(2)}
                          </td>
                          <td className="py-1.5 px-1 border-r border-slate-200 text-center text-slate-600">
                            {halfGstPct}
                          </td>
                          <td className="py-1.5 px-1.5 border-r border-slate-200 text-right text-slate-700">
                            {halfGstAmt.toFixed(2)}
                          </td>
                          <td className="py-1.5 px-1 border-r border-slate-200 text-center text-slate-600">
                            {halfGstPct}
                          </td>
                          <td className="py-1.5 px-1.5 border-r border-slate-200 text-right text-slate-700">
                            {halfGstAmt.toFixed(2)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-black text-slate-900">
                            {Number(item.line_total).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* DUE DATE & NOTE */}
              <div className="py-1 text-[11px] text-slate-600 flex justify-between border-b border-slate-300 mb-1">
                <div>Due Date: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Note : {invoice.notes || ''}</div>
              </div>

              {/* GST BREAKDOWN & TOTALS GRID */}
              <div className="grid grid-cols-12 gap-2 py-2 border-b-2 border-slate-800 text-[11px]">
                {/* GST Slab Table (Left 6 cols) */}
                <div className="col-span-6 pr-2 border-r border-slate-400">
                  <div className="font-bold text-[10px] uppercase text-slate-700 mb-1">
                    GST Slab Breakdown
                  </div>
                  <table className="w-full text-[10px] text-right border-collapse">
                    <thead>
                      <tr className="border-b border-slate-300 text-slate-500">
                        <th className="text-left py-0.5">Slab</th>
                        <th className="py-0.5">CGST% Val</th>
                        <th className="py-0.5">CGST Amt</th>
                        <th className="py-0.5">SGST Val</th>
                        <th className="py-0.5">SGST Amt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {slabs.map((slab) => {
                        const s = slabMap[slab];
                        return (
                          <tr key={slab}>
                            <td className="text-left font-semibold text-slate-700 py-0.5">{slab}% :</td>
                            <td className="text-slate-600">{s.cgstVal.toFixed(2)}</td>
                            <td className="text-slate-800 font-medium">{s.cgstAmt.toFixed(2)}</td>
                            <td className="text-slate-600">{s.sgstVal.toFixed(2)}</td>
                            <td className="text-slate-800 font-medium">{s.sgstAmt.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Items & Counts (Mid 2 cols) */}
                <div className="col-span-2 px-2 border-r border-slate-400 text-[11px] space-y-1">
                  <div>Cases: 0</div>
                  <div>No.of Items: <strong>{totalItemsCount}</strong></div>
                  <div>No.of Units: <strong className="text-sky-800">{totalUnits}</strong></div>
                  <div>(-/+)Adjust: 0.00</div>
                  <div>Rounding : {Number(invoice.round_off || 0).toFixed(2)}</div>
                </div>

                {/* Totals Summary (Right 4 cols) */}
                <div className="col-span-4 pl-2 space-y-1 text-right">
                  <div className="flex justify-between">
                    <span className="text-slate-600">SubTotal :</span>
                    <strong className="text-slate-900">{Number(invoice.subtotal).toFixed(2)}</strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Less Disc :</span>
                    <span>{Number(invoice.discount_amount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>GST Amt :</span>
                    <strong className="text-slate-900">{Number(invoice.tax_amount).toFixed(2)}</strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Cr Amt :</span>
                    <span>0.00</span>
                  </div>
                  <div className="flex justify-between text-sm sm:text-base font-black text-slate-950 pt-1.5 border-t-2 border-slate-800">
                    <span>NET PAYABLE:</span>
                    <span>₹{Number(invoice.grand_total).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* AMOUNT IN WORDS */}
              <div className="py-2 border-b border-slate-800 font-bold text-[11px] text-slate-900 uppercase">
                {numberToIndianWords(invoice.grand_total)}
              </div>

              {/* OFFICIAL STAMPS ROW (Verified & Delivered) */}
              <div className="py-4 flex justify-around items-center border-b border-slate-300">
                {/* Checked Verified Stamp */}
                <div className="border-2 border-blue-900 text-blue-900 rounded-md px-4 py-2 font-black tracking-widest text-xs uppercase shadow-xs select-none">
                  CHECKED VERIFIED
                </div>

                {/* Delivered Stamp with Dt & Sign */}
                <div className="border-2 border-blue-900 text-blue-900 rounded-md px-4 py-1.5 font-bold text-xs uppercase shadow-xs select-none flex flex-col gap-1">
                  <div className="tracking-widest font-black text-center">DELIVERED</div>
                  <div className="text-[10px] tracking-normal font-medium">Dt.........................Sign.</div>
                </div>
              </div>

              {/* STATUTORY FOOTER */}
              <div className="pt-2 text-[10px] text-slate-600 space-y-1">
                <div>The goods supplied in this invoice do not contravene section 18 of the drugs & cosmetics act 1940.</div>
                <div className="flex justify-between items-end font-semibold text-slate-800 pt-1">
                  <div>E.&O.E &nbsp;&nbsp;&nbsp;&nbsp; Subject To VIJAYAWADA Jurisdiction</div>
                  <div className="text-right">
                    <div>For {bizName}</div>
                    <div className="text-[9px] text-slate-400 mt-4">Authorised Signatory</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Standard Retail A4 Tax Invoice Layout */
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
                    <p className="text-xs text-slate-600 mt-1 max-w-md leading-relaxed">
                      {address}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-700 mt-1 font-medium">
                      <span>Phone: {phone}</span>
                      <span>GSTIN: {gstin}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs sm:text-right shrink-0 w-full sm:w-auto">
                  <div className="text-sm font-bold text-sky-700 uppercase tracking-wider mb-1">
                    TAX INVOICE
                  </div>
                  <div className="text-slate-600">D.L. No 1: {dl1}</div>
                  <div className="text-slate-600">D.L. No 2: {dl2}</div>
                </div>
              </div>

              {/* Customer & Invoice Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4 border-b border-slate-200 text-xs">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Billed To
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    {invoice.customer_name || 'Walk-in Customer'}
                  </div>
                  {invoice.customer_address && (
                    <div className="text-slate-600 mt-0.5">{invoice.customer_address}</div>
                  )}
                  {invoice.customer_gstin && (
                    <div className="text-slate-700 font-medium mt-1">
                      GSTIN: {invoice.customer_gstin}
                    </div>
                  )}
                </div>

                <div className="sm:text-right space-y-1">
                  <div>Invoice: <strong className="text-slate-900">{invoice.invoice_number}</strong></div>
                  <div>Date: {formatDateTime(invoice.created_at)}</div>
                  <div>Payment: <strong>{invoice.payment_method}</strong> ({invoice.payment_status})</div>
                </div>
              </div>

              {/* Table */}
              <table className="w-full text-xs my-4 border-collapse">
                <thead>
                  <tr className="bg-sky-600 text-white text-left">
                    <th className="py-2 px-2.5">#</th>
                    <th className="py-2 px-2.5">Product</th>
                    <th className="py-2 px-2">Batch</th>
                    <th className="py-2 px-2">Exp</th>
                    <th className="py-2 px-2 text-center">Qty</th>
                    <th className="py-2 px-2 text-right">MRP</th>
                    <th className="py-2 px-2 text-right">Rate</th>
                    <th className="py-2 px-2 text-right">GST%</th>
                    <th className="py-2 px-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border-x border-b border-slate-200">
                  {(invoice.items || []).map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-2 px-2.5 text-slate-500">{idx + 1}</td>
                      <td className="py-2 px-2.5 font-bold text-slate-900">{item.product_name}</td>
                      <td className="py-2 px-2 font-mono text-[11px]">{item.batch_number}</td>
                      <td className="py-2 px-2">{item.expiry_date}</td>
                      <td className="py-2 px-2 text-center font-bold">{item.quantity}</td>
                      <td className="py-2 px-2 text-right text-slate-500">{Number(item.mrp || 0).toFixed(2)}</td>
                      <td className="py-2 px-2 text-right font-medium">{Number(item.unit_price).toFixed(2)}</td>
                      <td className="py-2 px-2 text-right">{Number(item.gst_percentage || 0)}%</td>
                      <td className="py-2 px-2.5 text-right font-bold">{formatCurrency(item.line_total, symbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals */}
              <div className="flex justify-between items-start pt-3 border-t border-slate-200 text-xs">
                <div className="space-y-1">
                  <div className="font-semibold text-slate-800">
                    {numberToIndianWords(invoice.grand_total)}
                  </div>
                </div>
                <div className="text-right space-y-1">
                  <div>Subtotal: <strong>{formatCurrency(invoice.subtotal, symbol)}</strong></div>
                  <div>GST: <strong>{formatCurrency(invoice.tax_amount, symbol)}</strong></div>
                  <div className="text-base font-bold text-sky-800 pt-1 border-t border-slate-200">
                    Grand Total: {formatCurrency(invoice.grand_total, symbol)}
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

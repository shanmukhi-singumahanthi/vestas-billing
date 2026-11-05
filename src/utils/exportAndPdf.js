import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export function formatCurrency(amount, symbol = '₹') {
  const num = Number(amount || 0);
  return `${symbol}${num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function numberToIndianWords(num) {
  const n = Math.round(Number(num || 0));
  if (n === 0) return 'Zero Rupees Only';

  const a = [
    '', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ',
    'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ',
    'Seventeen ', 'Eighteen ', 'Nineteen '
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const numStr = ('000000000' + n).slice(-9);
  const match = numStr.match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!match) return `${n} Rupees Only`;

  const getTwoDigits = (str) => {
    const val = Number(str);
    if (val === 0) return '';
    if (val < 20) return a[val];
    return b[str[0]] + (str[1] !== '0' ? ' ' + a[Number(str[1])] : ' ');
  };

  let str = '';
  str += Number(match[1]) !== 0 ? getTwoDigits(match[1]) + 'Crore ' : '';
  str += Number(match[2]) !== 0 ? getTwoDigits(match[2]) + 'Lakh ' : '';
  str += Number(match[3]) !== 0 ? getTwoDigits(match[3]) + 'Thousand ' : '';
  str += Number(match[4]) !== 0 ? getTwoDigits('0' + match[4]) + 'Hundred ' : '';
  str += Number(match[5]) !== 0 ? (str !== '' ? 'and ' : '') + getTwoDigits(match[5]) : '';

  return `Rupees ${str.trim()} Only`;
}

/**
 * Generates and downloads a professional PDF invoice (supports both A4 and Thermal 80mm layouts)
 */
export function downloadInvoicePDF(invoice, settings = {}, format = 'A4') {
  const bizName = settings.business_name || 'VESTAS PHARMACEUTICALS';
  const ownerName = settings.owner_name || 'S. SATYENDRANATH';
  const tagline = settings.tagline || 'Pharmaceutical Distributors & Wholesale Chemists';
  const address = settings.address || '27-18-92/A, 1st Floor, Ganesh Complex, Congress Office Road, Governorpet, Vijayawada - 520002';
  const phone = settings.phone || '9603033345';
  const email = settings.email || 'ssatyendranth@gmail.com';
  const gstin = settings.gstin || '37BHCPS0456G1ZB';
  const dl1 = settings.dl_no_1 || 'AP/VJA/20B/104928';
  const dl2 = settings.dl_no_2 || 'AP/VJA/21B/104929';
  const terms = settings.terms_and_conditions || 'Goods once sold will not be taken back without valid invoice. Subject to Vijayawada jurisdiction.';

  if (format === 'THERMAL') {
    const itemCount = (invoice.items || []).length;
    const pageHeight = Math.max(160, 120 + itemCount * 12);
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [80, pageHeight],
    });

    let y = 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(bizName, 40, y, { align: 'center' });
    y += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const addrLines = doc.splitTextToSize(address, 70);
    doc.text(addrLines, 40, y, { align: 'center' });
    y += addrLines.length * 3.2;

    doc.text(`Ph: ${phone} | GSTIN: ${gstin}`, 40, y, { align: 'center' });
    y += 3.5;
    doc.text(`DL: ${dl1}, ${dl2}`, 40, y, { align: 'center' });
    y += 3;

    doc.setLineWidth(0.2);
    doc.line(4, y, 76, y);
    y += 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(`Inv: ${invoice.invoice_number}`, 4, y);
    doc.setFont('helvetica', 'normal');
    doc.text(formatDateShort(invoice.created_at), 76, y, { align: 'right' });
    y += 4;

    doc.text(`Customer: ${invoice.customer_name || 'Walk-in'}`, 4, y);
    y += 3.5;
    if (invoice.customer_phone) {
      doc.text(`Phone: ${invoice.customer_phone}`, 4, y);
      y += 3.5;
    }

    doc.line(4, y, 76, y);
    y += 3.5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('Item', 4, y);
    doc.text('Qty', 45, y, { align: 'right' });
    doc.text('Rate', 60, y, { align: 'right' });
    doc.text('Total', 76, y, { align: 'right' });
    y += 2;
    doc.line(4, y, 76, y);
    y += 3.5;

    doc.setFont('helvetica', 'normal');
    for (const item of invoice.items || []) {
      const nameLines = doc.splitTextToSize(item.product_name, 36);
      doc.text(nameLines, 4, y);
      doc.text(String(item.quantity), 45, y, { align: 'right' });
      doc.text(Number(item.unit_price).toFixed(2), 60, y, { align: 'right' });
      doc.text(Number(item.line_total).toFixed(2), 76, y, { align: 'right' });
      y += nameLines.length * 3.2;
      doc.setFontSize(6.5);
      doc.setTextColor(100);
      doc.text(`Batch: ${item.batch_number || '-'} | Exp: ${item.expiry_date || '-'}`, 4, y);
      doc.setTextColor(0);
      doc.setFontSize(7.5);
      y += 3.5;
    }

    doc.line(4, y, 76, y);
    y += 4;

    doc.text('Subtotal:', 45, y, { align: 'right' });
    doc.text(`Rs. ${Number(invoice.subtotal).toFixed(2)}`, 76, y, { align: 'right' });
    y += 3.5;

    if (Number(invoice.discount_amount) > 0) {
      doc.text('Discount:', 45, y, { align: 'right' });
      doc.text(`-Rs. ${Number(invoice.discount_amount).toFixed(2)}`, 76, y, { align: 'right' });
      y += 3.5;
    }

    if (Number(invoice.tax_amount) > 0) {
      doc.text('GST (CGST+SGST):', 45, y, { align: 'right' });
      doc.text(`Rs. ${Number(invoice.tax_amount).toFixed(2)}`, 76, y, { align: 'right' });
      y += 3.5;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('GRAND TOTAL:', 45, y, { align: 'right' });
    doc.text(`Rs. ${Number(invoice.grand_total).toFixed(2)}`, 76, y, { align: 'right' });
    y += 4.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`Payment: ${invoice.payment_method} (${invoice.payment_status})`, 4, y);
    y += 3.5;
    doc.text(`Paid: Rs. ${Number(invoice.amount_paid).toFixed(2)} | Balance: Rs. ${Number(invoice.balance_due).toFixed(2)}`, 4, y);
    y += 5;

    doc.setFontSize(7);
    doc.text('Thank you! Wishing you good health.', 40, y, { align: 'center' });

    doc.save(`${invoice.invoice_number}_Receipt.pdf`);
    return;
  }

  // Standard A4 Full Tax Invoice Layout
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Top Accent Header Bar
  doc.setFillColor(2, 132, 199); // Sky-600 Blue
  doc.rect(0, 0, 210, 3.5, 'F');

  // Official Vestas Double-Triangle Emblem (Red Triangle + Grey Chevron V)
  // Grey lower chevron V
  doc.setFillColor(113, 113, 122);
  doc.triangle(14, 11.5, 29, 11.5, 21.5, 20.5, 'F');
  doc.setFillColor(255, 255, 255);
  doc.triangle(16.2, 11.2, 26.8, 11.2, 21.5, 17.6, 'F');
  // Red upper solid inverted triangle
  doc.setFillColor(217, 56, 30);
  doc.triangle(14, 9.5, 29, 9.5, 21.5, 18.2, 'F');

  // Company Header next to Emblem
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16.5);
  doc.setTextColor(15, 23, 42);
  doc.text(bizName.toUpperCase(), 33, 14.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  doc.text(tagline, 33, 19.8);

  const addrWrapped = doc.splitTextToSize(address, 96);
  doc.setFontSize(8.5);
  doc.text(addrWrapped, 14, 25.5);

  const nextY = 25.5 + addrWrapped.length * 4;
  doc.text(`Phone: ${phone}${email ? '  |  Email: ' + email : ''}`, 14, nextY);
  doc.text(`Proprietor: ${ownerName}`, 14, nextY + 4.5);

  // Right Box: Tax Invoice & License Details
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(132, 10, 64, 30, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(2, 132, 199);
  doc.text('TAX INVOICE', 164, 17, { align: 'center' });

  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text(`GSTIN: ${gstin}`, 136, 23.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`D.L. No 1: ${dl1}`, 136, 28.5);
  doc.text(`D.L. No 2: ${dl2}`, 136, 33.5);

  const dividerY = Math.max(nextY + 8, 44);
  doc.setDrawColor(203, 213, 225);
  doc.line(14, dividerY, 196, dividerY);

  // Customer & Invoice Metadata Section
  const metaY = dividerY + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('BILLED TO:', 14, metaY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(invoice.customer_name || 'Walk-in Customer', 14, metaY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  let custLineY = metaY + 9.5;
  if (invoice.customer_phone) {
    doc.text(`Phone: ${invoice.customer_phone}`, 14, custLineY);
    custLineY += 4;
  }
  if (invoice.customer_address) {
    const cAddr = doc.splitTextToSize(`Address: ${invoice.customer_address}`, 95);
    doc.text(cAddr, 14, custLineY);
    custLineY += cAddr.length * 4;
  }
  if (invoice.customer_gstin || invoice.customer_dl) {
    doc.text(
      `${invoice.customer_gstin ? 'GSTIN: ' + invoice.customer_gstin + '   ' : ''}${
        invoice.customer_dl ? 'DL No: ' + invoice.customer_dl : ''
      }`,
      14,
      custLineY
    );
    custLineY += 4;
  }
  if (invoice.doctor_name) {
    doc.text(`Prescribed By: ${invoice.doctor_name}`, 14, custLineY);
    custLineY += 4;
  }

  // Invoice Details Right Column
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('Invoice No:', 132, metaY);
  doc.text(invoice.invoice_number, 196, metaY, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.text('Invoice Date:', 132, metaY + 5);
  doc.text(formatDateTime(invoice.created_at), 196, metaY + 5, { align: 'right' });

  doc.text('Payment Mode:', 132, metaY + 10);
  doc.text(`${invoice.payment_method} (${invoice.payment_status})`, 196, metaY + 10, { align: 'right' });

  const tableStartY = Math.max(custLineY + 3, metaY + 16);

  // Line Items Table
  const tableColumns = [
    '#',
    'Medicine / Product Name',
    'Pack',
    'HSN',
    'Batch',
    'Expiry',
    'Qty',
    'MRP',
    'Rate',
    'Disc%',
    'GST%',
    'Total (Rs.)'
  ];

  const tableRows = (invoice.items || []).map((item, idx) => [
    idx + 1,
    item.product_name,
    item.pack_size || '-',
    item.hsn_code || '3004',
    item.batch_number || '-',
    item.expiry_date || '-',
    item.quantity,
    Number(item.mrp || 0).toFixed(2),
    Number(item.unit_price || 0).toFixed(2),
    Number(item.item_discount_percent || 0) > 0 ? `${Number(item.item_discount_percent)}%` : '-',
    `${Number(item.gst_percentage || 0)}%`,
    Number(item.line_total || 0).toFixed(2)
  ]);

  autoTable(doc, {
    startY: tableStartY,
    head: [tableColumns],
    body: tableRows,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.2,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2
    },
    headStyles: {
      fillColor: [2, 132, 199],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 42 },
      2: { cellWidth: 16 },
      3: { cellWidth: 14 },
      4: { cellWidth: 18 },
      5: { cellWidth: 16 },
      6: { cellWidth: 10, halign: 'center' },
      7: { cellWidth: 14, halign: 'right' },
      8: { cellWidth: 14, halign: 'right' },
      9: { cellWidth: 11, halign: 'right' },
      10: { cellWidth: 11, halign: 'right' },
      11: { cellWidth: 18, halign: 'right', fontStyle: 'bold' }
    }
  });

  let finalY = doc.lastAutoTable.finalY + 6;
  if (finalY > 230) {
    doc.addPage();
    finalY = 20;
  }

  // Left side: Amount in words, GST split summary & Terms
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Amount in Words:', 14, finalY);
  doc.setFont('helvetica', 'normal');
  const wordsLines = doc.splitTextToSize(numberToIndianWords(invoice.grand_total), 110);
  doc.text(wordsLines, 14, finalY + 4.5);

  const halfTax = (Number(invoice.tax_amount || 0) / 2).toFixed(2);
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Tax Breakdown:  CGST: Rs. ${halfTax}   |   SGST: Rs. ${halfTax}   |   Total GST: Rs. ${Number(
      invoice.tax_amount || 0
    ).toFixed(2)}`,
    14,
    finalY + 13
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text('Terms & Conditions:', 14, finalY + 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const termsLines = doc.splitTextToSize(terms, 110);
  doc.text(termsLines, 14, finalY + 24);

  // Right side: Totals Summary Box
  const summaryX = 132;
  let sumY = finalY;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text('Taxable Subtotal:', summaryX, sumY);
  doc.text(`Rs. ${Number(invoice.subtotal || 0).toFixed(2)}`, 196, sumY, { align: 'right' });
  sumY += 5;

  if (Number(invoice.discount_amount) > 0) {
    doc.text('Bill Discount:', summaryX, sumY);
    doc.text(`- Rs. ${Number(invoice.discount_amount).toFixed(2)}`, 196, sumY, { align: 'right' });
    sumY += 5;
  }

  doc.text('Total GST (CGST + SGST):', summaryX, sumY);
  doc.text(`Rs. ${Number(invoice.tax_amount || 0).toFixed(2)}`, 196, sumY, { align: 'right' });
  sumY += 5;

  if (Number(invoice.round_off || 0) !== 0) {
    doc.text('Round Off:', summaryX, sumY);
    doc.text(`Rs. ${Number(invoice.round_off).toFixed(2)}`, 196, sumY, { align: 'right' });
    sumY += 5;
  }

  doc.setFillColor(240, 249, 255);
  doc.setDrawColor(186, 230, 253);
  doc.roundedRect(summaryX - 2, sumY - 3.5, 68, 9, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(3, 105, 161);
  doc.text('GRAND TOTAL:', summaryX, sumY + 2.5);
  doc.text(`Rs. ${Number(invoice.grand_total || 0).toFixed(2)}`, 194, sumY + 2.5, { align: 'right' });
  sumY += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text('Amount Paid:', summaryX, sumY);
  doc.text(`Rs. ${Number(invoice.amount_paid || 0).toFixed(2)}`, 196, sumY, { align: 'right' });
  sumY += 4.5;

  if (Number(invoice.balance_due) > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(185, 28, 28);
    doc.text('Balance Due:', summaryX, sumY);
    doc.text(`Rs. ${Number(invoice.balance_due).toFixed(2)}`, 196, sumY, { align: 'right' });
    sumY += 5;
  }

  // Authorized Signatory
  const signY = Math.max(sumY + 14, finalY + 38);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`For ${bizName}`, 196, signY, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Authorized Signatory', 196, signY + 10, { align: 'right' });

  doc.save(`${invoice.invoice_number}_Vestas_Invoice.pdf`);
}

/**
 * Exports any array of objects to an Excel (.xlsx) or CSV (.csv) file
 */
export function exportToExcel(rows, sheetName = 'Sheet1', fileName = 'Vestas_Export.xlsx') {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, fileName);
}

/**
 * Downloads a clean Excel template for importing medicines
 */
export function downloadProductImportTemplate() {
  const sampleRows = [
    {
      'Product Name': 'TELVEST-40',
      'Product Code': 'VP-TEL-40',
      'Barcode': '890123456019',
      'HSN Code': '3004',
      'Category': 'Tablets',
      'Manufacturer': 'Vestas Pharmaceuticals',
      'Batch Number': 'TLV2405',
      'Expiry Date': '2028-01-31',
      'Pack Size': '1*10',
      'Rack': 'Rack C-1',
      'Purchase Price': 59.00,
      'Selling Price': 65.00,
      'MRP': 85.00,
      'GST %': 12,
      'Available Stock': 220,
      'Min Stock': 30
    },
    {
      'Product Name': 'PENSEN DSR',
      'Product Code': 'VP-PEN-DSR',
      'Barcode': '890123456017',
      'HSN Code': '3004',
      'Category': 'Capsules',
      'Manufacturer': 'Vestas Pharmaceuticals',
      'Batch Number': 'PDS2403',
      'Expiry Date': '2028-02-28',
      'Pack Size': '1*10',
      'Rack': 'Rack B-1',
      'Purchase Price': 103.00,
      'Selling Price': 114.00,
      'MRP': 150.00,
      'GST %': 12,
      'Available Stock': 180,
      'Min Stock': 25
    }
  ];
  exportToExcel(sampleRows, 'Medicine_Import_Template', 'Vestas_Medicine_Import_Template.xlsx');
}

/**
 * Parses an uploaded Excel (.xlsx/.xls) or CSV (.csv) file into JSON rows
 */
export function parseSpreadsheetFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '' });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read spreadsheet file.'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Exports a formatted PDF report table (for Sales, Profit, Stock, Expiry, or Customer reports)
 */
export function exportReportPDF({ title, subtitle, columns, rows, summaryItems = [], settings = {}, fileName = 'Vestas_Report.pdf' }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const bizName = settings.business_name || 'VESTAS PHARMACEUTICALS';

  doc.setFillColor(2, 132, 199);
  doc.rect(0, 0, 297, 3, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(`${bizName} — ${title}`, 14, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(subtitle || `Generated on ${formatDateTime(new Date().toISOString())}`, 14, 20);

  let startY = 26;
  if (summaryItems.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(3, 105, 161);
    const sumText = summaryItems.map(s => `${s.label}: ${s.value}`).join('     |     ');
    doc.text(sumText, 14, startY);
    startY += 6;
  }

  autoTable(doc, {
    startY,
    head: [columns],
    body: rows,
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 2.5,
      textColor: [30, 41, 59]
    },
    headStyles: {
      fillColor: [2, 132, 199],
      textColor: [255, 255, 255],
      fontStyle: 'bold'
    }
  });

  doc.save(fileName);
}

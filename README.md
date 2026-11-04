# Vestas Pharmaceuticals – Pharmacy Billing & Inventory Management System

Complete offline-first pharmaceutical POS billing, multi-batch inventory, and multi-year invoice management application built for **Vestas Pharmaceuticals** (Proprietor: **S. Satyendranath**, Governorpet, Vijayawada).

## Key Features
- **Single Owner Login**: Secure proprietor access (`admin` / `vestas123`) with zero AI/token dependencies.
- **Manual Data Entry & Multi-Batch Inventory**:
  - Supports multiple separate batches for the same medicine with different batch numbers, expiry dates, purchase prices, selling prices, MRPs, and stock quantities.
  - All 11 billing and stock fields are manually editable at all times; customer name and phone are optional (`Walk-in Customer` default).
- **Offline-First Architecture (IndexedDB + Service Worker + PostgreSQL)**:
  - Works both online and offline on the installed browser/device.
  - Queues offline bills, price updates, new batches, and stock adjustments locally and synchronizes safely without duplicate invoices (`client_invoice_uid` idempotency).
- **Up-to-Date & Historical Invoice Register**:
  - View, filter, edit, print (**A4 GST Invoice** & **80mm Thermal Receipt**), and download PDF/Excel across **Today (Up-to-Date)**, **Previous Days**, **Previous Months**, and **Previous Years**.

## Quick Start

```bash
npm install
npm run dev
```

- **Frontend**: `http://localhost:5173`
- **Backend API**: `http://localhost:4000`

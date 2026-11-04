import React from 'react';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  X,
  Database,
} from 'lucide-react';
import { formatDateTime } from '../utils/exportAndPdf';

export default function SyncCenterModal({
  isOpen,
  onClose,
  isOffline,
  simulatedOffline,
  onToggleSimulatedOffline,
  pendingQueue = [],
  syncHistory = [],
  syncing,
  onSyncNow,
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isOffline
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {isOffline ? <WifiOff className="w-5 h-5" /> : <Wifi className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Offline-First Storage & Synchronization Center
              </h3>
              <p className="text-xs text-slate-500">
                IndexedDB Local Storage + Central PostgreSQL Database Synchronization
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 text-xs">
          {/* Status & Controls Bar */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold text-xs ${
                    isOffline
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  }`}
                >
                  {isOffline ? 'OFFLINE MODE ACTIVE' : 'ONLINE & CONNECTED'}
                </span>
                <span className="font-semibold text-slate-700">
                  {pendingQueue.length} Pending in Queue
                </span>
              </div>
              <p className="text-slate-500 mt-1.5">
                {isOffline
                  ? 'All new bills, price edits, new batches, and stock updates are being saved locally in IndexedDB.'
                  : 'Connected to central PostgreSQL database. Offline transactions synchronize automatically.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onToggleSimulatedOffline(!simulatedOffline)}
                className={`px-3.5 py-2 rounded-xl font-bold border transition cursor-pointer ${
                  simulatedOffline
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                    : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300'
                }`}
              >
                {simulatedOffline ? 'Reconnect Internet (Go Online)' : 'Switch to Offline Mode'}
              </button>

              <button
                type="button"
                disabled={isOffline || syncing || pendingQueue.length === 0}
                onClick={onSyncNow}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white font-bold transition cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Synchronizing...' : `Sync Now (${pendingQueue.length})`}
              </button>
            </div>
          </div>

          {/* Pending Offline Queue */}
          <div>
            <h4 className="font-bold text-slate-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-600" />
              Pending Offline Transactions Queue ({pendingQueue.length})
            </h4>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Recorded Time</th>
                    <th className="py-2.5 px-3">Operation Type</th>
                    <th className="py-2.5 px-3">Transaction Details</th>
                    <th className="py-2.5 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {pendingQueue.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-400">
                        Zero pending offline transactions. Everything is synchronized with the central database.
                      </td>
                    </tr>
                  ) : (
                    pendingQueue.map((item) => (
                      <tr key={item.operation_id} className="bg-amber-50/30">
                        <td className="py-2.5 px-3 text-slate-600">
                          {formatDateTime(item.created_at)}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-amber-800">
                          {item.type}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {item.description}
                          {item.last_error && (
                            <div className="text-red-600 text-[11px] mt-0.5">
                              Error: {item.last_error}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[11px]">
                            Pending Sync
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Synchronized History */}
          <div>
            <h4 className="font-bold text-slate-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Successfully Synchronized Transactions ({syncHistory.length})
            </h4>
            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Synced At</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Description</th>
                    <th className="py-2.5 px-3 text-right">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {syncHistory.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-400">
                        No offline synchronization history yet.
                      </td>
                    </tr>
                  ) : (
                    syncHistory.slice(0, 30).map((item) => (
                      <tr key={item.operation_id}>
                        <td className="py-2.5 px-3 text-slate-500">
                          {formatDateTime(item.synced_at)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-sky-700 font-semibold">
                          {item.type}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800 font-medium">
                          {item.description}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[11px]">
                            {item.status === 'duplicate_skipped'
                              ? 'Verified (No Duplicate)'
                              : 'Synced to DB'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

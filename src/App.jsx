import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  FileText,
  Pill,
  Boxes,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  PlusCircle,
  AlertTriangle,
  ShieldCheck,
  Crown,
  Wifi,
  WifiOff,
  RefreshCw,
} from 'lucide-react';
import {
  apiRequest,
  getAuthToken,
  setAuthToken,
  synchronizeOfflineQueue,
} from './utils/api';
import {
  isBrowserOffline,
  isSimulatedOffline,
  setSimulatedOffline,
  getPendingSyncQueue,
  getSyncHistory,
} from './utils/offlineDb';
import LoginView from './components/LoginView';
import DashboardView from './components/DashboardView';
import BillingView from './components/BillingView';
import InvoicesView from './components/InvoicesView';
import ProductsView from './components/ProductsView';
import InventoryView from './components/InventoryView';
import CustomersView from './components/CustomersView';
import ReportsView from './components/ReportsView';
import SettingsView from './components/SettingsView';
import InvoiceModal, { VestasLogo } from './components/InvoiceModal';
import SyncCenterModal from './components/SyncCenterModal';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Owner Dashboard', icon: LayoutDashboard, ownerOnly: true },
  { id: 'billing', label: 'New Bill (POS)', icon: ShoppingCart },
  { id: 'invoices', label: 'Invoices & Reprint', icon: FileText },
  { id: 'products', label: 'Medicines & Batches', icon: Pill },
  { id: 'inventory', label: 'Inventory & Stock', icon: Boxes },
  { id: 'customers', label: 'Customers & Dues', icon: Users },
  { id: 'reports', label: 'Reports & Profit', icon: BarChart3, ownerOnly: true },
  { id: 'settings', label: 'Settings & Backup', icon: Settings, ownerOnly: true },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Core synchronized database state
  const [settings, setSettings] = useState({});
  const [dashboard, setDashboard] = useState(null);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);

  // Offline & Synchronization State
  const [isOffline, setIsOffline] = useState(isBrowserOffline());
  const [simOffline, setSimOffline] = useState(isSimulatedOffline());
  const [pendingQueue, setPendingQueue] = useState([]);
  const [syncHistory, setSyncHistory] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncBannerMessage, setSyncBannerMessage] = useState(null);

  // Active Invoice Preview / Print / PDF Modal
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  const refreshSyncQueueState = useCallback(async () => {
    try {
      const [q, h] = await Promise.all([getPendingSyncQueue(), getSyncHistory()]);
      setPendingQueue(q || []);
      setSyncHistory(h || []);
    } catch {
      // ignore
    }
  }, []);

  const fetchAllCoreData = useCallback(async () => {
    if (!getAuthToken()) return;
    try {
      const [settingsRes, dashRes, prodRes, custRes] = await Promise.all([
        apiRequest('/api/settings'),
        apiRequest('/api/dashboard'),
        apiRequest('/api/products'),
        apiRequest('/api/customers'),
      ]);
      setSettings(settingsRes || {});
      setDashboard(dashRes || null);
      setProducts(prodRes || []);
      setCustomers(custRes || []);
      await refreshSyncQueueState();
    } catch (err) {
      console.error('Data sync error:', err);
    }
  }, [refreshSyncQueueState]);

  const handleRunSync = useCallback(async () => {
    if (isBrowserOffline()) return;
    setSyncing(true);
    try {
      const res = await synchronizeOfflineQueue();
      if (res.syncedCount > 0 || res.skippedDuplicates > 0) {
        setSyncBannerMessage(
          `Synchronized ${res.syncedCount} offline transaction(s) to central database (${res.skippedDuplicates} duplicates prevented).`
        );
        setTimeout(() => setSyncBannerMessage(null), 6000);
      }
      await fetchAllCoreData();
    } catch (err) {
      console.error('Offline sync error:', err);
    } finally {
      setSyncing(false);
    }
  }, [fetchAllCoreData]);

  // Listen for online/offline events & sync queue updates
  useEffect(() => {
    const updateConnectivity = () => {
      const nowOff = isBrowserOffline();
      setIsOffline(nowOff);
      setSimOffline(isSimulatedOffline());
      if (!nowOff) {
        handleRunSync();
      } else {
        fetchAllCoreData();
      }
    };

    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
    window.addEventListener('vestas-connectivity-change', updateConnectivity);
    window.addEventListener('vestas-sync-queue-updated', refreshSyncQueueState);

    return () => {
      window.removeEventListener('online', updateConnectivity);
      window.removeEventListener('offline', updateConnectivity);
      window.removeEventListener('vestas-connectivity-change', updateConnectivity);
      window.removeEventListener('vestas-sync-queue-updated', refreshSyncQueueState);
    };
  }, [handleRunSync, fetchAllCoreData, refreshSyncQueueState]);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    apiRequest('/api/auth/me')
      .then((u) => {
        setUser(u);
        if (u && u.role === 'worker') {
          setActiveTab('billing');
        }
        return fetchAllCoreData();
      })
      .catch(() => {
        setAuthToken(null);
        setUser(null);
      })
      .finally(() => {
        setAuthChecking(false);
      });
  }, [fetchAllCoreData]);

  const handleLoginSuccess = (loggedInUser) => {
    setUser(loggedInUser);
    setActiveTab(loggedInUser.role === 'worker' ? 'billing' : 'dashboard');
    fetchAllCoreData();
  };

  const handleLogout = () => {
    setAuthToken(null);
    setUser(null);
  };

  const handleBillCreated = async (savedInvoice) => {
    await fetchAllCoreData();
    setSelectedInvoice(savedInvoice);
  };

  const handleToggleSimulatedOffline = (val) => {
    setSimulatedOffline(val);
  };

  if (authChecking) {
    return (
      <div className="min-h-screen pharma-app-bg flex items-center justify-center text-sm font-medium text-slate-600">
        Loading Vestas Pharmaceuticals System...
      </div>
    );
  }

  if (!user) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  const isWorker = user?.role === 'worker';
  const visibleNavItems = NAV_ITEMS.filter((item) => !(isWorker && item.ownerOnly));
  const alertCount =
    Number(dashboard?.lowStockCount || 0) + Number(dashboard?.outOfStockCount || 0);

  return (
    <div className="min-h-screen pharma-app-bg flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <div className="lg:hidden bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <VestasLogo logoUrl={settings.logo_url} size="sm" variant="full" />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSyncModalOpen(true)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 ${
              isOffline
                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}
          >
            {isOffline ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
            {isOffline ? 'Offline' : 'Online'}
            {pendingQueue.length > 0 && ` (${pendingQueue.length})`}
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-xl border border-slate-200 text-slate-700"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-68 bg-white/95 backdrop-blur-md border-r border-slate-200/90 flex flex-col justify-between transition-transform lg:translate-x-0 lg:static lg:w-64 shrink-0 shadow-xs ${
          mobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        <div>
          {/* Official Brand Header with Vestas Double-Triangle Logo */}
          <div className="px-5 py-4 border-b border-slate-100 flex flex-col items-center text-center bg-gradient-to-b from-white to-slate-50/60">
            <VestasLogo logoUrl={settings.logo_url} size="md" variant="full" />
            {isWorker ? (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-emerald-50 text-emerald-800 border-emerald-200">
                <Users className="w-3 h-3 text-emerald-600" />
                Counter Staff Edition
              </div>
            ) : (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-sky-50 text-sky-800 border-sky-200">
                <Crown className="w-3 h-3 text-amber-600" />
                Single Owner Edition
              </div>
            )}
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                    isActive
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                    {item.label}
                  </span>
                  {item.id === 'inventory' && alertCount > 0 && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isActive ? 'bg-white text-slate-900' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {alertCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom User & Offline/Online Sync Status */}
        <div className="p-4 border-t border-slate-100 space-y-3">
          <div
            onClick={() => setSyncModalOpen(true)}
            className={`p-3 rounded-xl border text-[11px] cursor-pointer transition ${
              isOffline
                ? 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100/70'
                : 'bg-emerald-50/80 border-emerald-200/80 text-emerald-800 hover:bg-emerald-100/60'
            }`}
          >
            <div className="font-bold flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                {isOffline ? (
                  <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
                ) : (
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
                {isOffline ? 'Offline Mode Active' : 'Online & Synced'}
              </span>
              {pendingQueue.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-600 text-white text-[10px] font-bold">
                  {pendingQueue.length} Pending
                </span>
              )}
            </div>
            <div className="mt-0.5 opacity-80">
              {isOffline
                ? 'Saving to local IndexedDB queue'
                : 'PostgreSQL + IndexedDB Mirror'}
            </div>
          </div>

          <div className="flex items-center justify-between px-1">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-800 truncate">{user.fullName}</div>
              <div className="text-[11px] text-slate-500">
                {isWorker ? 'Counter Staff / Chemist' : `Proprietor (@${user.username})`}
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 transition cursor-pointer"
              title="Secure Logout"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Desktop Bar */}
        <header className="bg-white/90 backdrop-blur-md border-b border-slate-200/90 px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20 shadow-2xs">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'Vestas Pharmaceuticals'}
            </h2>
            <p className="text-xs text-slate-500">
              {settings.business_name || 'Vestas Pharmaceuticals'} • Governorpet, Vijayawada •
              GSTIN: {settings.gstin || '37BHCPS0456G1ZB'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Online / Offline Mode & Queue Status Button */}
            <button
              type="button"
              onClick={() => setSyncModalOpen(true)}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                isOffline
                  ? 'bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-800'
                  : pendingQueue.length > 0
                  ? 'bg-sky-50 hover:bg-sky-100 border-sky-300 text-sky-800'
                  : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-800'
              }`}
            >
              {isOffline ? (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-600" />
                  Offline Mode ({pendingQueue.length} Queued)
                </>
              ) : pendingQueue.length > 0 ? (
                <>
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                  Sync Pending ({pendingQueue.length})
                </>
              ) : (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                  Online & Synced
                </>
              )}
            </button>

            {alertCount > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('inventory')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-xs font-semibold transition cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                {alertCount} Stock Alert(s)
              </button>
            )}

            {activeTab !== 'billing' && (
              <button
                type="button"
                onClick={() => setActiveTab('billing')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs transition cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                New Customer Bill
              </button>
            )}
          </div>
        </header>

        {/* Notification Banner when Offline or Just Synchronized */}
        {syncBannerMessage && (
          <div className="mx-4 sm:mx-6 mt-4 p-3 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center justify-between shadow-sm">
            <span>✓ {syncBannerMessage}</span>
            <button
              type="button"
              onClick={() => setSyncBannerMessage(null)}
              className="p-1 hover:opacity-80 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <main className="p-4 sm:p-6 max-w-[1600px] w-full mx-auto flex-1">
          {activeTab === 'dashboard' && (
            <DashboardView
              dashboard={dashboard}
              settings={settings}
              onNavigate={setActiveTab}
              onViewInvoice={setSelectedInvoice}
              onRefresh={fetchAllCoreData}
              user={user}
            />
          )}

          {activeTab === 'billing' && (
            <BillingView
              products={products}
              customers={customers}
              settings={settings}
              onBillCreated={handleBillCreated}
              onPreviewInvoice={setSelectedInvoice}
              onRefresh={fetchAllCoreData}
              user={user}
            />
          )}

          {activeTab === 'invoices' && (
            <InvoicesView settings={settings} onViewInvoice={setSelectedInvoice} user={user} />
          )}

          {activeTab === 'products' && (
            <ProductsView
              products={products}
              settings={settings}
              onRefresh={fetchAllCoreData}
              user={user}
            />
          )}

          {activeTab === 'inventory' && (
            <InventoryView
              products={products}
              settings={settings}
              onRefresh={fetchAllCoreData}
              user={user}
            />
          )}

          {activeTab === 'customers' && (
            <CustomersView
              customers={customers}
              settings={settings}
              onRefresh={fetchAllCoreData}
              onViewInvoice={setSelectedInvoice}
              user={user}
            />
          )}

          {activeTab === 'reports' && (!isWorker ? <ReportsView settings={settings} /> : null)}

          {activeTab === 'settings' && (!isWorker ? (
            <SettingsView
              settings={settings}
              onSettingsSaved={(newSettings) => setSettings(newSettings)}
              onFullRefresh={fetchAllCoreData}
            />
          ) : null)}
        </main>
      </div>

      {/* Invoice Print & PDF Modal */}
      {selectedInvoice && (
        <InvoiceModal
          invoice={selectedInvoice}
          settings={settings}
          onClose={() => setSelectedInvoice(null)}
        />
      )}

      {/* Offline Storage & Sync Queue Modal */}
      <SyncCenterModal
        isOpen={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        isOffline={isOffline}
        simulatedOffline={simOffline}
        onToggleSimulatedOffline={handleToggleSimulatedOffline}
        pendingQueue={pendingQueue}
        syncHistory={syncHistory}
        syncing={syncing}
        onSyncNow={handleRunSync}
      />
    </div>
  );
}

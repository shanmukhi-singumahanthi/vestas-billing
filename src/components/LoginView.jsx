import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  User,
  ArrowRight,
  AlertCircle,
  Crown,
  Phone,
  MapPin,
  Wifi,
  WifiOff,
  Download,
  Smartphone,
} from 'lucide-react';
import { VestasLogo } from './InvoiceModal';
import { apiRequest, setAuthToken } from '../utils/api';
import { isBrowserOffline } from '../utils/offlineDb';

export default function LoginView({
  onLoginSuccess,
  onOpenInstallModal,
  canNativeInstall,
  isAppInstalled,
  onTriggerNativeInstall,
}) {
  const [roleTab, setRoleTab] = useState('owner'); // 'owner' | 'worker'
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('vestas123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);
  const offline = isBrowserOffline();

  const handleRoleTabChange = (role) => {
    setRoleTab(role);
    setError('');
    if (role === 'owner') {
      setUsername('admin');
      setPassword('vestas123');
    } else {
      setUsername('staff');
      setPassword('staff123');
    }
  };

  const handleSubmit = async (e, isAutoRetry = false) => {
    if (e && e.preventDefault) e.preventDefault();
    setError('');
    setLoading(true);
    if (isAutoRetry) setIsRetrying(true);

    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAuthToken(res.token);
      onLoginSuccess(res.user);
    } catch (err) {
      const msg = err.message || '';
      const isWaking = /waking up|suspended|timeout|Connection terminated|connection closed|57P01|57P03|ECONNRESET/i.test(msg);

      if (isWaking && !isAutoRetry) {
        setError('Neon serverless database was sleeping and is waking up. Automatically retrying in 2 seconds...');
        setTimeout(() => {
          handleSubmit(null, true);
        }, 2200);
        return;
      }

      setError(msg || 'Login failed. Please check credentials or database connection.');
    } finally {
      setLoading(false);
      setIsRetrying(false);
    }
  };

  return (
    <div className="min-h-dvh pharma-login-bg flex flex-col justify-center items-center p-3 sm:p-6">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-white/20 overflow-hidden">
        {/* Left Branding & Business Card Panel */}
        <div className="lg:col-span-5 bg-gradient-to-br from-slate-900 via-slate-800 to-sky-950 text-white p-5 sm:p-8 flex flex-col justify-between relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center justify-between gap-3 mb-4 sm:mb-6">
              <div className="bg-white rounded-2xl p-2.5 sm:p-4 inline-block shadow-md">
                <VestasLogo size="sm" variant="full" />
              </div>
              <button
                type="button"
                onClick={() =>
                  canNativeInstall && onTriggerNativeInstall
                    ? onTriggerNativeInstall()
                    : onOpenInstallModal && onOpenInstallModal()
                }
                className="lg:hidden px-3 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-amber-300" />
                <span>{isAppInstalled ? 'App Guide' : 'Download App'}</span>
              </button>
            </div>

            <h2 className="text-base sm:text-lg font-bold tracking-tight text-white">
              Proprietor & Counter POS Portal
            </h2>
            <p className="text-xs text-slate-300 mt-1.5 sm:mt-2 leading-relaxed">
              Dedicated Single-Owner Pharmacy Billing, Multi-Batch Inventory & Offline-First
              Synchronization System.
            </p>

            <div className="hidden sm:block mt-6 space-y-3 text-xs">
              <div className="p-3.5 rounded-xl bg-white/10 border border-white/10 backdrop-blur-xs">
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <Crown className="w-4 h-4" />
                  Single Owner Full Authority
                </div>
                <p className="text-slate-300 text-[11px] mt-1 leading-relaxed">
                  Exclusive access for the business owner to manage billing, batch-wise stock,
                  medicine prices, profit analytics, and backups.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-white/10 border border-white/10 backdrop-blur-xs">
                <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  Online + Offline Ready
                </div>
                <p className="text-slate-300 text-[11px] mt-1 leading-relaxed">
                  Generate bills, print A4/Thermal invoices, and update stock even without internet,
                  with automatic central database synchronization.
                </p>
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-4 sm:mt-8 pt-3 sm:pt-4 border-t border-white/15 text-[11px] text-slate-300 space-y-1">
            <div className="font-bold text-orange-400 tracking-wide">S. SATYENDRANATH</div>
            <div className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-sky-400" />
              <span>9603033345 • ssatyendranth@gmail.com</span>
            </div>
            <div className="flex items-start gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                27-18-92/A, 1st Floor, Ganesh Complex, Congress Office Road, Governorpet,
                Vijayawada
              </span>
            </div>
          </div>
        </div>

        {/* Right Sign-In Form Panel */}
        <div className="lg:col-span-7 p-5 sm:p-10 bg-white flex flex-col justify-between">
          <div>
            {/* Role Portal Selector Tabs */}
            <div className="flex rounded-2xl bg-slate-100 p-1 mb-5 sm:mb-6 border border-slate-200/80">
              <button
                type="button"
                onClick={() => handleRoleTabChange('owner')}
                className={`flex-1 py-2 px-2 sm:px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  roleTab === 'owner'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Crown className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="truncate">Proprietor / Owner</span>
              </button>
              <button
                type="button"
                onClick={() => handleRoleTabChange('worker')}
                className={`flex-1 py-2 px-2 sm:px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  roleTab === 'worker'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <User className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                <span className="truncate">Counter Staff</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 mb-4 sm:mb-5">
              <div>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold border mb-1.5 ${
                    roleTab === 'owner'
                      ? 'bg-amber-50 text-amber-900 border-amber-200'
                      : 'bg-sky-50 text-sky-900 border-sky-200'
                  }`}
                >
                  {roleTab === 'owner' ? (
                    <>
                      <Crown className="w-3.5 h-3.5 text-amber-600" />
                      Proprietor Full Authority
                    </>
                  ) : (
                    <>
                      <User className="w-3.5 h-3.5 text-sky-600" />
                      Staff Counter Access (Costs Hidden)
                    </>
                  )}
                </span>
                <h1 className="text-lg sm:text-xl font-bold text-slate-900">
                  {roleTab === 'owner' ? 'Owner Sign In' : 'Counter Staff Sign In'}
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  {roleTab === 'owner'
                    ? 'Authorized executive access for S. Satyendranath (Vestas Pharmaceuticals)'
                    : 'Sales chemist terminal for retail & wholesale customer billing'}
                </p>
              </div>
              <VestasLogo size="md" />
            </div>

            {error && (
              <div
                className={`mb-5 p-3.5 rounded-xl border flex items-start gap-2.5 text-xs ${
                  error.includes('waking up')
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                <AlertCircle
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    error.includes('waking up') ? 'text-amber-600 animate-spin' : 'text-red-600'
                  }`}
                />
                <div className="flex-1">
                  <span>{error}</span>
                  {!isRetrying && (
                    <button
                      type="button"
                      onClick={() => handleSubmit(null, false)}
                      className="mt-2 block text-[11px] font-bold underline hover:opacity-80 cursor-pointer"
                    >
                      Click here to Retry Now
                    </button>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  {roleTab === 'owner' ? 'Owner Username' : 'Staff Username'}
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 outline-none transition"
                    placeholder={roleTab === 'owner' ? 'Enter owner username' : 'Enter staff username'}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 outline-none transition"
                    placeholder="Enter password"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className={`w-full py-3 px-4 rounded-xl text-white font-bold text-sm shadow-sm flex items-center justify-center gap-2 transition cursor-pointer mt-2 disabled:opacity-60 ${
                  roleTab === 'owner'
                    ? 'bg-sky-600 hover:bg-sky-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {loading
                  ? 'Signing in...'
                  : roleTab === 'owner'
                  ? 'Sign In to Owner Dashboard'
                  : 'Sign In to Counter Terminal'}
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() =>
                  canNativeInstall && onTriggerNativeInstall
                    ? onTriggerNativeInstall()
                    : onOpenInstallModal && onOpenInstallModal()
                }
                className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-800 border border-slate-200 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Smartphone className="w-4 h-4 text-sky-600" />
                <span>
                  {isAppInstalled
                    ? 'App Installed — View Mobile & PC Guide'
                    : 'Download & Install Vestas Pharma App (Phone / PC)'}
                </span>
                <Download className="w-3.5 h-3.5 text-slate-600" />
              </button>
            </form>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
              {offline ? (
                <>
                  <WifiOff className="w-4 h-4 text-amber-600" />
                  Offline Mode Ready (IndexedDB Active)
                </>
              ) : (
                <>
                  <Wifi className="w-4 h-4 text-emerald-600" />
                  Online & Offline Sync Active
                </>
              )}
            </span>
            <span className="font-mono text-[11px] text-slate-600">
              {roleTab === 'owner' ? 'Owner: admin / vestas123' : 'Staff: staff / staff123'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

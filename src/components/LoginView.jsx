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
} from 'lucide-react';
import { VestasLogo } from './InvoiceModal';
import { apiRequest, setAuthToken } from '../utils/api';
import { isBrowserOffline } from '../utils/offlineDb';

export default function LoginView({ onLoginSuccess }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('vestas123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const offline = isBrowserOffline();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAuthToken(res.token);
      onLoginSuccess(res.user);
    } catch (err) {
      setError(err.message || 'Login failed. Please check your owner credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pharma-login-bg flex flex-col justify-center items-center p-4 sm:p-6">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 bg-white rounded-3xl shadow-2xl border border-white/20 overflow-hidden">
        {/* Left Branding & Business Card Panel */}
        <div className="lg:col-span-5 bg-gradient-to-br from-slate-900 via-slate-800 to-sky-950 text-white p-7 sm:p-8 flex flex-col justify-between relative overflow-hidden">
          <div className="relative z-10">
            <div className="bg-white rounded-2xl p-4 inline-block shadow-md mb-6">
              <VestasLogo size="md" variant="full" />
            </div>

            <h2 className="text-lg font-bold tracking-tight text-white">
              Proprietor Executive Portal
            </h2>
            <p className="text-xs text-slate-300 mt-2 leading-relaxed">
              Dedicated Single-Owner Pharmacy Billing, Multi-Batch Inventory & Offline-First
              Synchronization System.
            </p>

            <div className="mt-6 space-y-3 text-xs">
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

          <div className="relative z-10 mt-8 pt-4 border-t border-white/15 text-[11px] text-slate-300 space-y-1">
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
        <div className="lg:col-span-7 p-7 sm:p-10 bg-white flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-sky-50 text-sky-800 border border-sky-200 mb-2">
                  <Crown className="w-3.5 h-3.5 text-amber-600" />
                  Single Owner Authentication
                </span>
                <h1 className="text-xl font-bold text-slate-900">Owner Sign In</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Authorized access for S. Satyendranath (Vestas Pharmaceuticals)
                </p>
              </div>
              <VestasLogo size="md" />
            </div>

            {error && (
              <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-700">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Owner Username
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 outline-none transition"
                    placeholder="Enter owner username"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Owner Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 outline-none transition"
                    placeholder="Enter owner password"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm shadow-sm flex items-center justify-center gap-2 transition cursor-pointer mt-2 disabled:opacity-60"
              >
                {loading ? 'Signing in...' : 'Sign In to Owner Dashboard'}
                <ArrowRight className="w-4 h-4" />
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
            <span>Default Owner: admin / vestas123</span>
          </div>
        </div>
      </div>
    </div>
  );
}

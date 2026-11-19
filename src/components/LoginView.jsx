import React, { useState, useEffect } from 'react';
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
  Mail,
  KeyRound,
  CheckCircle2,
  ArrowLeft,
  Clock,
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
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successBanner, setSuccessBanner] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);
  const offline = isBrowserOffline();

  // Forgot Password & Account Recovery State
  const [viewMode, setViewMode] = useState('login'); // 'login' | 'forgot' | 'reset_password'
  const [recoveryMethod, setRecoveryMethod] = useState('email'); // 'email' | 'mobile'
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [mobileOtpSent, setMobileOtpSent] = useState(false);
  const [mobileOtp, setMobileOtp] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [activeResetToken, setActiveResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryInfo, setRecoveryInfo] = useState('');

  // Countdown timer for OTP resend restriction
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Handle URL query parameters: ?verify_email_token=... or ?reset_token=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifyEmailToken = params.get('verify_email_token');
    const resetToken = params.get('reset_token');

    if (verifyEmailToken) {
      window.history.replaceState({}, document.title, window.location.pathname);
      setRecoveryLoading(true);
      apiRequest('/api/auth/recovery/email/verify', {
        method: 'POST',
        body: JSON.stringify({ token: verifyEmailToken }),
      })
        .then((res) => {
          setSuccessBanner(
            res.message ||
              'Owner recovery email verified! You can now use Email Recovery for Forgot Password.'
          );
        })
        .catch((err) => {
          setError(err.message || 'Email verification link is invalid or has expired.');
        })
        .finally(() => {
          setRecoveryLoading(false);
        });
    } else if (resetToken) {
      window.history.replaceState({}, document.title, window.location.pathname);
      setViewMode('reset_password');
      setActiveResetToken(resetToken);
      setRecoveryLoading(true);
      setRecoveryError('');
      apiRequest(`/api/auth/forgot-password/validate-token?token=${encodeURIComponent(resetToken)}`)
        .then((res) => {
          if (!res.valid) {
            setRecoveryError(res.error || 'This password reset link is invalid or has expired.');
            setActiveResetToken('');
          } else {
            setRecoveryInfo('Reset link verified. Please enter and confirm your new owner password.');
          }
        })
        .catch((err) => {
          setRecoveryError(err.message || 'This password reset link is invalid or has expired.');
          setActiveResetToken('');
        })
        .finally(() => {
          setRecoveryLoading(false);
        });
    }
  }, []);

  const handleRoleTabChange = (role) => {
    setRoleTab(role);
    setViewMode('login');
    setError('');
    setSuccessBanner('');
    if (role === 'owner') {
      setUsername('admin');
      setPassword('');
    } else {
      setUsername('staff');
      setPassword('');
    }
  };

  const handleOpenForgotPassword = () => {
    setViewMode('forgot');
    setRecoveryMethod('email');
    setRecoveryError('');
    setRecoveryInfo('');
    setError('');
    setSuccessBanner('');
  };

  // Option A: Send Email Password Reset Link
  const handleSendEmailResetLink = async (e) => {
    e.preventDefault();
    setRecoveryError('');
    setRecoveryInfo('');
    setRecoveryLoading(true);
    try {
      const res = await apiRequest('/api/auth/forgot-password/email', {
        method: 'POST',
        body: JSON.stringify({ email: recoveryEmail.trim() }),
      });
      setRecoveryInfo(
        res.message ||
          'If this email is registered and verified for the owner account, a password reset link has been sent.'
      );
    } catch (err) {
      setRecoveryError(err.message || 'Unable to process password reset request.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Option B1: Send Mobile SMS OTP
  const handleSendMobileResetOtp = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (resendCooldown > 0) return;
    setRecoveryError('');
    setRecoveryInfo('');
    setRecoveryLoading(true);
    try {
      const res = await apiRequest('/api/auth/forgot-password/mobile/send-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: recoveryPhone.trim() }),
      });
      setMobileOtpSent(true);
      setResendCooldown(res.cooldownSeconds || 60);
      setRecoveryInfo(
        res.message ||
          'If this mobile number is registered and verified for the owner account, a 6-digit SMS OTP has been sent.'
      );
    } catch (err) {
      setRecoveryError(err.message || 'Could not send SMS OTP.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Option B2: Verify Mobile SMS OTP on Server
  const handleVerifyMobileResetOtp = async (e) => {
    e.preventDefault();
    setRecoveryError('');
    setRecoveryInfo('');
    setRecoveryLoading(true);
    try {
      const res = await apiRequest('/api/auth/forgot-password/mobile/verify-otp', {
        method: 'POST',
        body: JSON.stringify({
          phone: recoveryPhone.trim(),
          otp: mobileOtp.trim(),
        }),
      });
      if (res.verified && res.resetToken) {
        setActiveResetToken(res.resetToken);
        setViewMode('reset_password');
        setRecoveryInfo('Mobile OTP verified. Create and confirm your new owner password below.');
      }
    } catch (err) {
      setRecoveryError(err.message || 'Invalid or expired OTP code.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Final Step: Submit New Owner Password
  const handleCompletePasswordReset = async (e) => {
    e.preventDefault();
    setRecoveryError('');
    setRecoveryInfo('');
    if (!newPassword || newPassword.trim().length < 6) {
      setRecoveryError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setRecoveryError('New password and confirm password do not match.');
      return;
    }

    setRecoveryLoading(true);
    try {
      const res = await apiRequest('/api/auth/forgot-password/reset', {
        method: 'POST',
        body: JSON.stringify({
          token: activeResetToken,
          newPassword,
          confirmPassword: confirmNewPassword,
        }),
      });
      setSuccessBanner(
        res.message ||
          'Your owner password has been reset successfully. Please sign in with your new password.'
      );
      setNewPassword('');
      setConfirmNewPassword('');
      setActiveResetToken('');
      setPassword('');
      setViewMode('login');
    } catch (err) {
      setRecoveryError(err.message || 'Failed to reset password. The link may have expired.');
    } finally {
      setRecoveryLoading(false);
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
              <span>9603033345 • ssatyendranath@gmail.com</span>
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

            {successBanner && (
              <div className="mb-5 p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 flex items-start gap-2.5 text-xs font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{successBanner}</span>
              </div>
            )}

            {error && viewMode === 'login' && (
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

            {/* VIEW 1: STANDARD LOGIN FORM */}
            {viewMode === 'login' && (
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
                      placeholder={
                        roleTab === 'owner' ? 'Enter owner username' : 'Enter staff username'
                      }
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
                  {roleTab === 'owner' && (
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleOpenForgotPassword}
                        className="text-xs font-bold text-sky-600 hover:text-sky-700 hover:underline cursor-pointer"
                      >
                        Forgot Password?
                      </button>
                    </div>
                  )}
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
            )}

            {/* VIEW 2: FORGOT PASSWORD (EMAIL & MOBILE OTP RECOVERY OPTIONS) */}
            {viewMode === 'forgot' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('login');
                      setRecoveryError('');
                      setRecoveryInfo('');
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to Owner Sign In
                  </button>
                  <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                    Owner-Only Recovery
                  </span>
                </div>

                {/* Recovery Method Selector: A. Email | B. Mobile Number */}
                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 border border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setRecoveryMethod('email');
                      setRecoveryError('');
                      setRecoveryInfo('');
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                      recoveryMethod === 'email'
                        ? 'bg-white text-sky-700 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Mail className="w-3.5 h-3.5" />
                    A. Recover via Email
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRecoveryMethod('mobile');
                      setRecoveryError('');
                      setRecoveryInfo('');
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                      recoveryMethod === 'mobile'
                        ? 'bg-white text-sky-700 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Phone className="w-3.5 h-3.5" />
                    B. Recover via Mobile
                  </button>
                </div>

                {recoveryError && (
                  <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span>{recoveryError}</span>
                  </div>
                )}

                {recoveryInfo && (
                  <div className="p-3 rounded-xl border border-sky-200 bg-sky-50 text-sky-900 text-xs flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                    <span>{recoveryInfo}</span>
                  </div>
                )}

                {/* Option A: Recover using Email */}
                {recoveryMethod === 'email' && (
                  <form onSubmit={handleSendEmailResetLink} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Registered & Verified Owner Recovery Email
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          required
                          value={recoveryEmail}
                          onChange={(e) => setRecoveryEmail(e.target.value)}
                          placeholder="Enter verified owner recovery email"
                          className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:border-sky-600 outline-none"
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        A single-use password reset link (valid for 15 minutes) will be sent if your
                        recovery email is verified.
                      </p>
                    </div>

                    <button
                      type="submit"
                      disabled={recoveryLoading}
                      className="w-full py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Mail className="w-4 h-4" />
                      {recoveryLoading ? 'Sending Reset Link...' : 'Send Secure Password Reset Link'}
                    </button>
                  </form>
                )}

                {/* Option B: Recover using Mobile Number (SMS OTP) */}
                {recoveryMethod === 'mobile' && (
                  <div className="space-y-3.5">
                    <form onSubmit={handleSendMobileResetOtp} className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Registered & Verified Owner Mobile Number
                        </label>
                        <div className="relative">
                          <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="tel"
                            required
                            value={recoveryPhone}
                            onChange={(e) => setRecoveryPhone(e.target.value)}
                            placeholder="Enter 10-digit verified mobile number"
                            className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:border-sky-600 outline-none"
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Sends a 6-digit SMS OTP valid for 5 minutes (requires verified mobile &
                          configured SMS provider).
                        </p>
                      </div>

                      <button
                        type="submit"
                        disabled={recoveryLoading || resendCooldown > 0}
                        className="w-full py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {resendCooldown > 0 ? (
                          <>
                            <Clock className="w-4 h-4" />
                            Resend OTP available in {resendCooldown}s
                          </>
                        ) : (
                          <>
                            <Phone className="w-4 h-4" />
                            {recoveryLoading
                              ? 'Sending OTP...'
                              : mobileOtpSent
                              ? 'Resend SMS OTP'
                              : 'Send 6-Digit SMS OTP'}
                          </>
                        )}
                      </button>
                    </form>

                    {mobileOtpSent && (
                      <form
                        onSubmit={handleVerifyMobileResetOtp}
                        className="pt-3 border-t border-slate-200 space-y-3"
                      >
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Enter 6-Digit SMS OTP
                          </label>
                          <input
                            type="text"
                            maxLength={6}
                            required
                            value={mobileOtp}
                            onChange={(e) => setMobileOtp(e.target.value.replace(/\D/g, ''))}
                            placeholder="6-digit OTP"
                            className="w-full px-4 py-2.5 text-sm font-mono tracking-widest text-center rounded-xl border border-slate-300 focus:border-emerald-600 outline-none"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={recoveryLoading || mobileOtp.length !== 6}
                          className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <KeyRound className="w-4 h-4" />
                          {recoveryLoading ? 'Verifying OTP...' : 'Verify OTP & Continue'}
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* VIEW 3: CREATE & CONFIRM NEW OWNER PASSWORD */}
            {viewMode === 'reset_password' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('login');
                      setActiveResetToken('');
                      setRecoveryError('');
                      setRecoveryInfo('');
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to Owner Sign In
                  </button>
                  <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                    Set New Owner Password
                  </span>
                </div>

                {recoveryError && (
                  <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span>{recoveryError}</span>
                  </div>
                )}

                {recoveryInfo && (
                  <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{recoveryInfo}</span>
                  </div>
                )}

                {activeResetToken ? (
                  <form onSubmit={handleCompletePasswordReset} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        New Owner Password *
                      </label>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Enter new password (min 6 characters)"
                          className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:border-sky-600 outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Confirm New Owner Password *
                      </label>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          placeholder="Confirm new password"
                          className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:border-sky-600 outline-none"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={recoveryLoading}
                      className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <KeyRound className="w-4 h-4" />
                      {recoveryLoading ? 'Updating Password...' : 'Save New Owner Password'}
                    </button>
                  </form>
                ) : (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    Please request a new password reset link or SMS OTP using the{' '}
                    <button
                      type="button"
                      onClick={handleOpenForgotPassword}
                      className="text-sky-600 font-bold underline cursor-pointer"
                    >
                      Forgot Password
                    </button>{' '}
                    screen.
                  </div>
                )}
              </div>
            )}
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
            <span className="font-mono text-[11px] text-slate-500">
              {roleTab === 'owner' ? 'Proprietor Secure Portal' : 'Counter Staff Terminal'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

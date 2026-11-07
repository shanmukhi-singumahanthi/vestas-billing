import React, { useState } from 'react';
import {
  Smartphone,
  Monitor,
  Download,
  CheckCircle2,
  X,
  Share2,
  PlusSquare,
  MoreVertical,
  Sparkles,
  WifiOff,
  ShieldCheck,
} from 'lucide-react';
import { VestasLogo } from './InvoiceModal';

export default function InstallAppModal({
  isOpen,
  onClose,
  canNativeInstall,
  isInstalled,
  onTriggerNativeInstall,
}) {
  const [selectedPlatform, setSelectedPlatform] = useState('android'); // 'android' | 'ios' | 'desktop'

  if (!isOpen) return null;

  const handleDownloadDesktopShortcut = () => {
    const appUrl = window.location.origin;
    const shortcutContent = `[InternetShortcut]\r\nURL=${appUrl}\r\nIconIndex=0\r\n`;
    const blob = new Blob([shortcutContent], { type: 'application/internet-shortcut' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Vestas Pharmaceuticals Billing.url';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-slate-900 via-slate-800 to-sky-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-xl p-1.5 shadow-sm shrink-0">
              <VestasLogo size="sm" variant="mark" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold flex items-center gap-1.5">
                Download & Install Vestas Pharma App
                <Sparkles className="w-4 h-4 text-amber-300" />
              </h3>
              <p className="text-[11px] text-slate-300">
                Works on Android Phones, iPhone/iPad & Windows/Mac PC (Online + Offline)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {/* Instant 1-Click Native Install Banner (when supported by Chrome/Edge/Android) */}
          {isInstalled ? (
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-3 text-emerald-900">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
              <div>
                <div className="font-bold text-sm">Vestas Pharma App is Installed!</div>
                <div className="text-[11px] text-emerald-700 mt-0.5">
                  You can open the app directly from your Phone Home Screen or Computer Desktop.
                </div>
              </div>
            </div>
          ) : canNativeInstall ? (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-600 to-emerald-600 text-white shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="font-bold text-sm flex items-center gap-1.5">
                  <Download className="w-4 h-4" />
                  1-Click Direct App Installation Ready
                </div>
                <div className="text-[11px] text-sky-100 mt-0.5">
                  Install the standalone Vestas Pharmaceuticals app icon directly to your device.
                </div>
              </div>
              <button
                type="button"
                onClick={onTriggerNativeInstall}
                className="px-4 py-2.5 rounded-xl bg-white text-slate-900 hover:bg-sky-50 font-black text-xs shadow-sm shrink-0 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4 text-sky-600" />
                Install App Now
              </button>
            </div>
          ) : null}

          {/* Benefits Strip */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-2.5">
              <WifiOff className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-slate-900">100% Offline Billing</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Create bills & check batches even when internet is down.
                </div>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-slate-900">Full-Screen Mobile POS</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Launches like a native app without browser address bars.
                </div>
              </div>
            </div>
          </div>

          {/* Platform Selector Tabs */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              Select Your Device to Install / Download
            </div>
            <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1 rounded-2xl border border-slate-200">
              <button
                type="button"
                onClick={() => setSelectedPlatform('android')}
                className={`py-2 px-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  selectedPlatform === 'android'
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Android Phone
              </button>
              <button
                type="button"
                onClick={() => setSelectedPlatform('ios')}
                className={`py-2 px-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  selectedPlatform === 'ios'
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                iPhone / iPad
              </button>
              <button
                type="button"
                onClick={() => setSelectedPlatform('desktop')}
                className={`py-2 px-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  selectedPlatform === 'desktop'
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Windows / PC
              </button>
            </div>
          </div>

          {/* Platform Specific Instructions & Download Actions */}
          {selectedPlatform === 'android' && (
            <div className="p-4 rounded-2xl bg-sky-50/70 border border-sky-200/80 space-y-3">
              <div className="font-bold text-slate-900 text-sm">
                Install on Android Phone / Tablet
              </div>
              {canNativeInstall ? (
                <button
                  type="button"
                  onClick={onTriggerNativeInstall}
                  className="w-full py-3 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Tap Here to Download & Install Android App
                </button>
              ) : (
                <ol className="space-y-2.5 text-slate-700 list-decimal list-inside">
                  <li>
                    Open this link in <strong>Google Chrome</strong> on your Android phone.
                  </li>
                  <li>
                    Tap the <strong>3-dots menu</strong>{' '}
                    <MoreVertical className="w-3.5 h-3.5 inline text-slate-700" /> at the top-right
                    corner of Chrome.
                  </li>
                  <li>
                    Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.
                  </li>
                  <li>
                    The <strong>Vestas Pharma</strong> app icon will appear on your phone home
                    screen!
                  </li>
                </ol>
              )}
            </div>
          )}

          {selectedPlatform === 'ios' && (
            <div className="p-4 rounded-2xl bg-sky-50/70 border border-sky-200/80 space-y-3">
              <div className="font-bold text-slate-900 text-sm">Install on iPhone or iPad</div>
              <ol className="space-y-2.5 text-slate-700 list-decimal list-inside">
                <li>
                  Open this page in <strong>Safari</strong> on your iPhone or iPad.
                </li>
                <li>
                  Tap the <strong>Share</strong> button{' '}
                  <Share2 className="w-3.5 h-3.5 inline text-sky-600" /> at the bottom of the
                  screen.
                </li>
                <li>
                  Scroll down and tap <strong>"Add to Home Screen"</strong>{' '}
                  <PlusSquare className="w-3.5 h-3.5 inline text-slate-700" />.
                </li>
                <li>
                  Tap <strong>"Add"</strong> in the top-right corner to install the full-screen
                  Vestas Pharma app.
                </li>
              </ol>
            </div>
          )}

          {selectedPlatform === 'desktop' && (
            <div className="p-4 rounded-2xl bg-sky-50/70 border border-sky-200/80 space-y-3">
              <div className="font-bold text-slate-900 text-sm">
                Install on Windows PC / Laptop / Mac
              </div>
              <div className="space-y-2 text-slate-700">
                {canNativeInstall ? (
                  <button
                    type="button"
                    onClick={onTriggerNativeInstall}
                    className="w-full py-3 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    Install Desktop App Window Now
                  </button>
                ) : (
                  <p>
                    Click the <strong>Install icon</strong> (computer with down-arrow) on the right
                    side of your Chrome or Edge address bar, or download the Desktop Launcher file
                    below:
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleDownloadDesktopShortcut}
                  className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer mt-2"
                >
                  <Download className="w-4 h-4 text-emerald-600" />
                  Download Desktop Shortcut Launcher (.url)
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
          <span className="text-slate-500">Vestas Pharmaceuticals • v3.0 Mobile & Desktop PWA</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

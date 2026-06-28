import React, { useEffect, useState } from 'react';
import { Smartphone, Monitor, Share2, Plus, Download, CheckCircle, ArrowRight, Zap, Shield, Wifi, Copy, Check } from 'lucide-react';

const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
const isAndroid = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);
const isStandalone = typeof window !== 'undefined' && (!!window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);

const FEATURES = [
  { icon: Zap, label: 'Instant access', desc: 'No app store, no waiting. Opens in seconds.' },
  { icon: Wifi, label: 'Works offline', desc: 'Core features available without internet.' },
  { icon: Shield, label: 'Always updated', desc: 'No manual updates — always the latest version.' },
];

export default function GetApp() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [installing, setInstalling] = useState(false);
  const [step, setStep] = useState(0); // for iOS stepper animation
  const [copied, setCopied] = useState(false);
  const [apk, setApk] = useState({ available: false }); // native Android app

  const platform = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';
  const appUrl = `${window.location.origin}/get-app`;

  // Set page title + track visit
  useEffect(() => {
    document.title = 'Install SmartShape Pro';
    fetch('/api/app-installs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, action: 'view' }),
    }).catch(() => {});
    return () => { document.title = 'SmartShape Pro'; };
  }, [platform]);

  // Check whether the native Android APK is available to download
  useEffect(() => {
    fetch('/api/app/android/info')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setApk(d); })
      .catch(() => {});
  }, []);

  // Capture Android install prompt + appinstalled event
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    const onInstalled = () => {
      setInstalled(true);
      fetch('/api/app-installs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'android', action: 'install' }),
      }).catch(() => {});
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // iOS step-by-step animation
  useEffect(() => {
    if (!isIOS || installed) return;
    const t = setInterval(() => setStep(s => (s + 1) % 3), 2000);
    return () => clearInterval(t);
  }, [installed]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
    } catch {
      // fallback for HTTP or older browsers
      const el = document.createElement('textarea');
      el.value = appUrl;
      el.style.position = 'fixed'; el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAndroidInstall = async () => {
    if (!deferredPrompt || installing) return;
    setInstalling(true);
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setInstalling(false);
    if (outcome === 'accepted') setInstalled(true);
  };

  return (
    <div className="min-h-screen bg-[#0f0f1a] text-white flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <header className="px-5 py-4 flex items-center gap-3 border-b border-white/8">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#e94560] to-[#f07060] flex items-center justify-center font-black text-[11px] shadow-lg shadow-[#e94560]/30">SS</div>
        <div>
          <p className="font-bold text-sm leading-tight">SmartShape Pro</p>
          <p className="text-[10px] text-white/40 leading-tight">School CRM & Field Sales</p>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center px-5 pt-10 pb-8 max-w-md mx-auto w-full">
        {/* App icon */}
        <div className="w-24 h-24 rounded-[26px] bg-gradient-to-br from-[#e94560] to-[#f07060] flex items-center justify-center text-white font-black text-3xl shadow-2xl shadow-[#e94560]/40 mb-6">
          SS
        </div>

        <h1 className="text-2xl font-extrabold text-center leading-tight mb-2">
          SmartShape Pro
        </h1>
        <p className="text-white/50 text-sm text-center mb-8">
          Your school CRM, field visits, quotations, and marketing — all in one place.
        </p>

        {/* Native Android app download (APK) — not shown on iOS (can't sideload) */}
        {!isIOS && apk.available && (
          <div className="w-full mb-6">
            <a
              href="/api/app/android"
              onClick={() => {
                fetch('/api/app-installs', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ platform: 'android', action: 'apk_download' }),
                }).catch(() => {});
              }}
              className="w-full h-14 rounded-2xl bg-gradient-to-r from-[#123c69] to-[#1d5a9e] text-white font-bold text-base flex items-center justify-center gap-3 shadow-xl shadow-[#123c69]/30 active:scale-95 transition-transform"
            >
              <Download className="h-5 w-5" />
              Download Android app{apk.size_mb ? ` · ${apk.size_mb} MB` : ''}
            </a>
            <p className="text-white/35 text-[11px] text-center mt-2">
              Android only. After downloading, tap the file and allow “Install from this source”.
            </p>
          </div>
        )}

        {/* Already installed */}
        {installed ? (
          <div className="w-full bg-emerald-500/10 border border-emerald-500/25 rounded-2xl p-5 flex items-center gap-4 mb-6">
            <CheckCircle className="h-8 w-8 text-emerald-400 shrink-0" />
            <div>
              <p className="font-bold text-emerald-400 text-sm">App is installed!</p>
              <p className="text-white/40 text-xs mt-0.5">Open it from your home screen anytime.</p>
            </div>
          </div>
        ) : (
          <>
            {/* iOS Instructions */}
            {isIOS && (
              <div className="w-full mb-6">
                <p className="text-white/60 text-xs text-center mb-4 font-medium tracking-wide uppercase">How to install on iPhone / iPad</p>
                <div className="space-y-3">
                  {[
                    { n: 1, icon: Share2,  text: 'Tap the Share button in Safari', active: step === 0 },
                    { n: 2, icon: Plus,    text: 'Scroll and tap "Add to Home Screen"', active: step === 1 },
                    { n: 3, icon: CheckCircle, text: 'Tap "Add" — done!', active: step === 2 },
                  ].map(({ n, icon: Icon, text, active }) => (
                    <div key={n} className={`flex items-center gap-3.5 px-4 py-3.5 rounded-xl border transition-all duration-500 ${
                      active
                        ? 'border-[#e94560]/50 bg-[#e94560]/10 shadow-lg shadow-[#e94560]/10'
                        : 'border-white/8 bg-white/3'
                    }`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                        active ? 'bg-[#e94560] text-white' : 'bg-white/10 text-white/40'
                      }`}>{n}</div>
                      <Icon className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-[#e94560]' : 'text-white/30'}`} />
                      <p className={`text-sm transition-colors ${active ? 'text-white font-medium' : 'text-white/50'}`}>{text}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 bg-blue-500/8 border border-blue-500/20 rounded-xl px-4 py-3 text-center">
                  <p className="text-blue-400 text-[11px] font-semibold">
                    Make sure you're viewing this page in <span className="underline">Safari</span> — other browsers don't support installation.
                  </p>
                </div>
              </div>
            )}

            {/* Android Install Button */}
            {isAndroid && (
              <div className="w-full mb-6">
                {deferredPrompt ? (
                  <button
                    onClick={handleAndroidInstall}
                    disabled={installing}
                    className="w-full h-14 rounded-2xl bg-gradient-to-r from-[#e94560] to-[#f07060] text-white font-bold text-base flex items-center justify-center gap-3 shadow-xl shadow-[#e94560]/30 active:scale-95 transition-transform disabled:opacity-70"
                  >
                    <Download className="h-5 w-5" />
                    {installing ? 'Installing…' : 'Add to Home Screen'}
                  </button>
                ) : (
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                    <Smartphone className="h-8 w-8 text-white/30 mx-auto mb-2" />
                    <p className="text-white/50 text-sm">Open this page in Chrome to install the app.</p>
                    <p className="text-white/30 text-xs mt-1">Then tap the menu → "Add to Home Screen"</p>
                  </div>
                )}
              </div>
            )}

            {/* Desktop */}
            {!isIOS && !isAndroid && (
              <div className="w-full mb-6 bg-white/4 border border-white/10 rounded-2xl p-5 text-center">
                <Monitor className="h-10 w-10 text-white/30 mx-auto mb-3" />
                <p className="text-white/60 text-sm font-medium">You're on a desktop</p>
                <p className="text-white/35 text-xs mt-1">Share this link with teachers or customers to install on their phone.</p>
                <div className="mt-4 flex items-center gap-2">
                  <div className="flex-1 bg-white/6 rounded-xl px-3 py-2.5 font-mono text-[11px] text-[#e94560] break-all text-left select-all">
                    {appUrl}
                  </div>
                  <button
                    onClick={copyLink}
                    className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center transition-all ${
                      copied ? 'bg-emerald-500/20 border border-emerald-500/40' : 'bg-white/8 border border-white/12 hover:bg-white/12'
                    }`}
                    title="Copy link"
                  >
                    {copied
                      ? <Check className="h-4 w-4 text-emerald-400" />
                      : <Copy className="h-4 w-4 text-white/40" />
                    }
                  </button>
                </div>
                {copied && (
                  <p className="text-emerald-400 text-[11px] font-semibold mt-2">Link copied!</p>
                )}
              </div>
            )}
          </>
        )}

        {/* Features */}
        <div className="w-full space-y-2.5 mb-8">
          {FEATURES.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-center gap-3.5 px-4 py-3 bg-white/3 rounded-xl">
              <div className="w-8 h-8 rounded-lg bg-[#e94560]/15 flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 text-[#e94560]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white leading-tight">{label}</p>
                <p className="text-[11px] text-white/40 leading-tight mt-0.5">{desc}</p>
              </div>
              <CheckCircle className="h-4 w-4 text-emerald-400 ml-auto shrink-0" />
            </div>
          ))}
        </div>

        {/* Login CTA */}
        <a
          href="/login"
          className="w-full h-12 rounded-xl bg-white/8 border border-white/12 text-white/70 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-white/12 transition-colors"
        >
          Already installed? Log in <ArrowRight className="h-4 w-4" />
        </a>
      </main>

      {/* Footer */}
      <footer className="text-center py-5 border-t border-white/6">
        <p className="text-white/20 text-[10px]">© 2026 SmartShape Pro · {isIOS ? 'iOS' : isAndroid ? 'Android' : 'Desktop'}</p>
      </footer>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronRight, ChevronLeft, Zap } from 'lucide-react';

const TOUR_KEY = 'smartshape_tour_done';

const STEPS = [
  {
    target: '[data-testid="admin-sidebar"]',
    title: 'Sidebar Navigation',
    desc: 'Use the sidebar to jump between modules — Quotations, Leads, Inventory, Accounts, HR and more. On mobile, tap the ☰ menu icon at the top-left.',
    position: 'right',
  },
  {
    target: '[data-testid="admin-logo"]',
    title: 'SmartShape Pro',
    desc: 'Your all-in-one business portal. Everything from sales quotations to stock management and field operations is available right here.',
    position: 'right',
  },
  {
    target: '[data-testid="theme-toggle"]',
    title: 'Dark / Light Mode',
    desc: 'Toggle the theme to suit your preference — works across the entire app and is remembered on your next visit.',
    position: 'right',
  },
  {
    target: '[data-testid="help-float-btn"]',
    title: 'Help & Support',
    desc: 'Found a bug or need help? Click this button anytime to report an issue. A notification is sent to the admin team immediately.',
    position: 'left',
  },
  {
    target: '[data-testid="admin-logout-button"]',
    title: 'Your Account',
    desc: "Your name and email are shown at the bottom of the sidebar. Click Logout when you're done for the day to keep your account secure.",
    position: 'right',
  },
];

function getTargetRect(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right };
}

function Spotlight({ rect }) {
  if (!rect) return null;
  const pad = 8;
  return (
    <div
      className="fixed inset-0 z-[900] pointer-events-none"
      style={{
        background: `radial-gradient(ellipse ${rect.width + pad * 2}px ${rect.height + pad * 2}px at ${rect.left + rect.width / 2}px ${rect.top + rect.height / 2}px, transparent 0%, rgba(0,0,0,0.75) 100%)`,
      }}
    />
  );
}

export default function GuidedTour() {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);

  // Show tour for users who haven't seen it
  useEffect(() => {
    const done = localStorage.getItem(TOUR_KEY);
    if (!done) {
      const timer = setTimeout(() => setActive(true), 1200);
      return () => clearTimeout(timer);
    }
  }, []);

  const updateRect = useCallback(() => {
    if (!active) return;
    const r = getTargetRect(STEPS[step].target);
    setRect(r);
  }, [active, step]);

  useEffect(() => {
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [updateRect]);

  const finish = () => {
    localStorage.setItem(TOUR_KEY, '1');
    setActive(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else finish();
  };

  const prev = () => { if (step > 0) setStep(s => s - 1); };

  if (!active) return null;

  const currentStep = STEPS[step];
  const isRight = currentStep.position === 'right';

  // Tooltip position: try to place next to the target, fall back to center
  let tooltipStyle = {};
  if (rect) {
    const TOOLTIP_W = 300;
    const TOOLTIP_H = 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (isRight) {
      const left = Math.min(rect.right + 16, vw - TOOLTIP_W - 16);
      const top = Math.max(16, Math.min(rect.top + rect.height / 2 - TOOLTIP_H / 2, vh - TOOLTIP_H - 16));
      tooltipStyle = { position: 'fixed', left, top };
    } else {
      const right = Math.min(vw - rect.left + 16, vw - TOOLTIP_W - 16);
      const top = Math.max(16, Math.min(rect.top + rect.height / 2 - TOOLTIP_H / 2, vh - TOOLTIP_H - 16));
      tooltipStyle = { position: 'fixed', right, top };
    }
  } else {
    tooltipStyle = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' };
  }

  return (
    <>
      {/* Dark overlay with spotlight */}
      <div className="fixed inset-0 z-[900] bg-black/70 pointer-events-auto" onClick={finish} />
      {rect && <Spotlight rect={rect} />}

      {/* Highlight ring around target */}
      {rect && (
        <div
          className="fixed z-[910] rounded-lg pointer-events-none"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: '0 0 0 4px #e94560, 0 0 0 8px rgba(233,69,96,0.3)',
            transition: 'all 0.3s ease',
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="z-[920] w-[calc(100vw-2rem)] sm:w-[300px] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden"
        style={tooltipStyle}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#e94560] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-white" />
            <span className="text-white text-sm font-bold">Quick Tour</span>
          </div>
          <button onClick={finish} className="text-white/70 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4">
          <h3 className="font-bold text-base text-[var(--text-primary)] mb-1.5">{currentStep.title}</h3>
          <p className="text-sm text-[var(--text-muted)] leading-relaxed">{currentStep.desc}</p>
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 flex items-center justify-between">
          {/* Step dots */}
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`inline-block rounded-full transition-all ${i === step ? 'w-4 h-1.5 bg-[#e94560]' : 'w-1.5 h-1.5 bg-[var(--border-color)]'}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button onClick={prev} className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors px-2 py-1.5 rounded-lg hover:bg-[var(--bg-hover)]">
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>
            )}
            <button
              onClick={next}
              className="flex items-center gap-1.5 text-xs font-semibold bg-[#e94560] text-white px-3 py-1.5 rounded-lg hover:bg-[#c73652] transition-colors"
            >
              {step === STEPS.length - 1 ? 'Done' : 'Next'}
              {step < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className="px-4 pb-3">
          <button onClick={finish} className="text-[11px] text-[var(--text-muted)] hover:underline">
            Skip tour
          </button>
        </div>
      </div>
    </>
  );
}

/** Call this to reset the tour (e.g., from a Settings page or for testing). */
export function resetTour() {
  localStorage.removeItem(TOUR_KEY);
}

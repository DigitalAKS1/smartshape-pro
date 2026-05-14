import React, { useState, useRef } from 'react';
import { HelpCircle, X, Send, CheckCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { toast } from 'sonner';

const PRIORITIES = [
  { value: 'low',    label: 'Low',    cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { value: 'medium', label: 'Medium', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  { value: 'high',   label: 'High',   cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
];

const EMPTY_FORM = { title: '', description: '', priority: 'medium', screenshot_data: null };

export default function HelpButton() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef(null);

  const card = 'bg-[var(--bg-card)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const borderCls = 'border-[var(--border-color)]';
  const inputCls = `w-full bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#e94560] transition-colors`;

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Screenshot must be under 2 MB'); return; }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setForm(f => ({ ...f, screenshot_data: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) { toast.error('Please enter an issue title'); return; }
    if (!form.description.trim()) { toast.error('Please describe the issue'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/support-tickets`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed');
      setSubmitted(true);
    } catch {
      toast.error('Failed to submit ticket — please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setTimeout(() => { setSubmitted(false); setForm(EMPTY_FORM); setFileName(''); }, 300);
  };

  const clearFile = () => {
    setFileName('');
    setForm(f => ({ ...f, screenshot_data: null }));
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <>
      {/* Floating trigger */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 lg:bottom-6 lg:right-6 z-40 w-12 h-12 rounded-full bg-[#e94560] text-white shadow-xl hover:bg-[#c73652] hover:scale-110 transition-all flex items-center justify-center"
        title="Report an issue or get help"
        data-testid="help-float-btn"
        aria-label="Help & Support"
      >
        <HelpCircle className="h-5 w-5" />
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 lg:bg-transparent lg:pointer-events-none"
          onClick={handleClose}
        />
      )}

      {/* Slide-out panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full sm:w-[400px] ${card} border-l ${borderCls} z-50 shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3.5 border-b ${borderCls} flex-shrink-0`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#e94560]/20 flex items-center justify-center flex-shrink-0">
              <HelpCircle className="h-4 w-4 text-[#e94560]" />
            </div>
            <div>
              <h2 className={`font-semibold text-sm ${textPri}`}>Report an Issue</h2>
              <p className={`text-xs ${textMuted}`}>We'll look into it right away</p>
            </div>
          </div>
          <button onClick={handleClose} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textMuted} transition-colors`} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {submitted ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-green-400" />
              </div>
              <div>
                <h3 className={`font-bold text-base ${textPri} mb-1`}>Ticket Submitted!</h3>
                <p className={`text-sm ${textMuted} max-w-xs`}>
                  Our admin team has been notified and will look into it shortly.
                </p>
              </div>
              <button
                onClick={handleClose}
                className="mt-2 px-6 py-2.5 rounded-lg bg-[#e94560] text-white text-sm font-semibold hover:bg-[#c73652] transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Title */}
              <div>
                <label className={`text-[11px] font-semibold ${textSec} uppercase tracking-wide block mb-1.5`}>
                  Issue Title <span className="text-[#e94560]">*</span>
                </label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Brief summary of the problem"
                  className={inputCls}
                  maxLength={100}
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label className={`text-[11px] font-semibold ${textSec} uppercase tracking-wide block mb-1.5`}>
                  Description <span className="text-[#e94560]">*</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What happened? What did you expect? Steps to reproduce..."
                  rows={5}
                  className={`${inputCls} resize-none`}
                  maxLength={1000}
                />
                <p className={`text-[11px] ${textMuted} mt-1 text-right`}>{form.description.length}/1000</p>
              </div>

              {/* Priority */}
              <div>
                <label className={`text-[11px] font-semibold ${textSec} uppercase tracking-wide block mb-1.5`}>
                  Priority
                </label>
                <div className="flex gap-2">
                  {PRIORITIES.map(p => (
                    <button
                      key={p.value}
                      onClick={() => setForm(f => ({ ...f, priority: p.value }))}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        form.priority === p.value
                          ? p.cls
                          : `border-[var(--border-color)] ${textMuted} hover:bg-[var(--bg-hover)]`
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Screenshot */}
              <div>
                <label className={`text-[11px] font-semibold ${textSec} uppercase tracking-wide block mb-1.5`}>
                  Screenshot <span className={textMuted}>(optional, max 2 MB)</span>
                </label>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
                <button
                  onClick={() => fileRef.current?.click()}
                  className={`w-full border-2 border-dashed rounded-xl p-5 text-center transition-colors ${
                    fileName
                      ? 'border-[#e94560]/50 bg-[#e94560]/5'
                      : `${borderCls} hover:border-[#e94560]/40 hover:bg-[#e94560]/5`
                  }`}
                >
                  {fileName ? (
                    <span className="text-sm font-medium text-[#e94560]">{fileName}</span>
                  ) : (
                    <>
                      <p className={`text-sm ${textMuted}`}>Click to upload screenshot</p>
                      <p className={`text-[11px] ${textMuted} mt-0.5`}>PNG, JPG up to 2 MB</p>
                    </>
                  )}
                </button>
                {fileName && (
                  <button
                    onClick={clearFile}
                    className={`text-[11px] ${textMuted} hover:text-red-400 mt-1.5 transition-colors`}
                  >
                    Remove screenshot
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!submitted && (
          <div className={`px-4 py-3.5 border-t ${borderCls} flex-shrink-0`}>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-[#e94560] text-white font-semibold text-sm hover:bg-[#c73652] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <><Send className="h-4 w-4" /> Submit Ticket</>
              )}
            </button>
            <p className={`text-[11px] ${textMuted} text-center mt-2`}>
              Submitting as <span className={textSec}>{user?.name || user?.email}</span>
            </p>
          </div>
        )}
      </div>
    </>
  );
}

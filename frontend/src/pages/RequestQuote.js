import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { toast } from 'sonner';
import { quoteRequests } from '../lib/api';
import { Button } from '../components/ui/button';
import DieSelectionGrid from '../components/catalogue/DieSelectionGrid';
import VideoModal from '../components/media/VideoModal';

const inputCls = 'w-full h-11 px-3 rounded-md text-sm bg-[#0f0f1a] border border-[#2d2d44] text-white placeholder:text-[#6b6b80] focus:outline-none focus:border-[#e94560]';
const labelCls = 'block text-xs font-medium text-[#a0a0b0] mb-1';

const FIELDS = [
  { key: 'name', label: 'Your name', required: true, placeholder: 'e.g. Priya Sharma' },
  { key: 'email', label: 'Email ID', required: true, type: 'email', placeholder: 'you@school.edu.in' },
  { key: 'school_name', label: 'School name', required: true, placeholder: 'e.g. Delhi Public School' },
  { key: 'city', label: 'City', placeholder: 'e.g. Jaipur' },
  { key: 'address', label: 'School address', required: true, wide: true, placeholder: 'Street, area, pincode' },
  { key: 'principal_name', label: 'Principal name (optional)', placeholder: '' },
  { key: 'phone', label: 'Contact number (optional)', type: 'tel', placeholder: '10-digit mobile' },
];

/** Public page — a school asks for a quotation, optionally picking dies from the catalogue. */
export default function RequestQuote() {
  const backendUrl = process.env.REACT_APP_BACKEND_URL;
  const [form, setForm] = useState({ name: '', email: '', school_name: '', city: '', address: '', principal_name: '', phone: '', message: '', website: '' });
  const [cat, setCat] = useState({ dies: [], logo_url: '' });
  const [showCatalogue, setShowCatalogue] = useState(false);
  const [qtyByDie, setQtyByDie] = useState({});
  const [typeTab, setTypeTab] = useState('all');
  const [videoDie, setVideoDie] = useState(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    quoteRequests.publicCatalogue().then(r => setCat(r.data || { dies: [] })).catch(() => {});
  }, []);

  const toggle = (id) => setQtyByDie(prev => {
    const next = { ...prev };
    if (next[id]) delete next[id]; else next[id] = 1;
    return next;
  });
  const setQty = (id, q) => setQtyByDie(prev => {
    const next = { ...prev };
    if (q < 1) delete next[id]; else next[id] = Math.min(q, 1000);
    return next;
  });

  const submit = async (e) => {
    e.preventDefault();
    for (const f of FIELDS) if (f.required && !form[f.key].trim()) { toast.error(`${f.label} is required`); return; }
    setSending(true);
    try {
      await quoteRequests.submit({
        ...form,
        selections: Object.entries(qtyByDie).map(([die_id, quantity]) => ({ die_id, quantity })),
      });
      setDone(true);
      window.scrollTo(0, 0);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Could not send — please try again');
    } finally { setSending(false); }
  };

  const picked = Object.keys(qtyByDie).length;

  if (done) return (
    <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center px-4">
      <div className="max-w-md text-center" data-testid="quote-request-done">
        <CheckCircle2 className="h-16 w-16 text-green-400 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-white mb-2">Request received</h1>
        <p className="text-[#a0a0b0]">Thank you! Our team will email your quotation to <b className="text-white">{form.email}</b> shortly.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a12] pb-16">
      <div className="bg-gradient-to-b from-[#1a1a2e] to-[#0a0a12] py-10 px-4 text-center">
        {cat.logo_url && <img src={cat.logo_url} alt="" className="h-14 mx-auto mb-5 object-contain" style={{ filter: 'brightness(0) invert(1)' }} />}
        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2" data-testid="request-quote-title">Request a Quotation</h1>
        <p className="text-[#a0a0b0]">Tell us about your school — we'll send you a quotation by email.</p>
      </div>

      <form onSubmit={submit} className="max-w-3xl mx-auto px-4 space-y-6">
        {/* How to */}
        <div className="rounded-lg border border-[#2d2d44] bg-[#1a1a2e] p-4 text-sm text-[#a0a0b0]" data-testid="quote-request-guide">
          <p className="flex items-center gap-2 text-white font-medium mb-2"><Info className="h-4 w-4 text-[#e94560]" /> How to request</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Fill in your name, email, school name and address.</li>
            <li><i>Optional:</i> open the catalogue and tap the dies you like; set how many of each with + / −.</li>
            <li>Press <b className="text-white">Send request</b>. You'll get a confirmation email, and our team will send your quotation.</li>
          </ol>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FIELDS.map(f => (
            <div key={f.key} className={f.wide ? 'sm:col-span-2' : ''}>
              <label className={labelCls} htmlFor={`qr-${f.key}`}>{f.label}{f.required && <span className="text-[#e94560]"> *</span>}</label>
              <input id={`qr-${f.key}`} type={f.type || 'text'} value={form[f.key]} placeholder={f.placeholder}
                onChange={e => setForm({ ...form, [f.key]: e.target.value })} className={inputCls} data-testid={`qr-${f.key}`} />
            </div>
          ))}
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="qr-message">Anything else? (optional)</label>
            <textarea id="qr-message" rows={3} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })}
              className={`${inputCls} h-auto py-2`} placeholder="e.g. we need a machine and 20 dies for Class 1–5" />
          </div>
          {/* honeypot — hidden from people, filled by bots */}
          <input type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })}
            className="hidden" aria-hidden="true" name="website" />
        </div>

        {cat.dies.length > 0 && (
          <div className="rounded-lg border border-[#2d2d44]">
            <button type="button" onClick={() => setShowCatalogue(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left text-white" data-testid="qr-toggle-catalogue">
              <span className="font-medium">Choose dies from our catalogue <span className="text-[#a0a0b0] font-normal">(optional{picked ? ` · ${picked} picked` : ''})</span></span>
              {showCatalogue ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showCatalogue && (
              <div className="p-4 border-t border-[#2d2d44]">
                <DieSelectionGrid dies={cat.dies} qtyByDie={qtyByDie} onToggle={toggle} onQtyChange={setQty}
                  backendUrl={backendUrl} typeTab={typeTab} onTypeTabChange={setTypeTab} onVideoPreview={setVideoDie}
                  offerByDie={cat.offers || {}} />
              </div>
            )}
          </div>
        )}

        <Button type="submit" disabled={sending} className="w-full h-12 bg-[#e94560] hover:bg-[#f05c75] text-white text-base" data-testid="qr-submit">
          {sending ? 'Sending…' : `Send request${picked ? ` (${picked} item${picked !== 1 ? 's' : ''})` : ''}`}
        </Button>
      </form>

      <VideoModal url={videoDie?.video_url} title={videoDie?.name} open={!!videoDie} onClose={() => setVideoDie(null)} />
    </div>
  );
}

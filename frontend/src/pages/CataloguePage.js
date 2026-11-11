import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { catalogue } from '../lib/api';
import { Button } from '../components/ui/button';
import { Check, Info } from 'lucide-react';
import { toast } from 'sonner';
import VideoModal from '../components/media/VideoModal';
import DieSelectionGrid from '../components/catalogue/DieSelectionGrid';

export default function CataloguePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  // Map of die_id -> quantity for selected dies. Presence = selected.
  const [qtyByDie, setQtyByDie] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typeTab, setTypeTab] = useState('all');
  const [videoDie, setVideoDie] = useState(null);
  const backendUrl = process.env.REACT_APP_BACKEND_URL;

  // Two steps: MAIN = what the quotation covers; OPTIONAL = extras on top (quoted separately).
  const [step, setStep] = useState('main');
  const [optQty, setOptQty] = useState({});
  const selectedDies = Object.keys(qtyByDie);
  const activeMap = step === 'main' ? qtyByDie : optQty;
  const setActiveMap = step === 'main' ? setQtyByDie : setOptQty;

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await catalogue.get(token); setData(res.data); }
      catch { toast.error('Failed to load catalogue'); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [token]);

  const handleToggleDie = (dieId) => {
    setActiveMap(prev => {
      const next = { ...prev };
      if (next[dieId] != null) { delete next[dieId]; } else { next[dieId] = 1; }
      return next;
    });
  };

  const setDieQty = (dieId, qty) => {
    const clamped = Math.max(1, parseInt(qty, 10) || 1);
    setActiveMap(prev => ({ ...prev, [dieId]: clamped }));
  };

  const handleSubmit = async () => {
    const selections = [
      ...Object.entries(qtyByDie).map(([die_id, quantity]) => ({ die_id, quantity, kind: 'main' })),
      ...Object.entries(optQty).map(([die_id, quantity]) => ({ die_id, quantity, kind: 'optional' })),
    ];
    try { await catalogue.submit(token, selections); setSubmitted(true); toast.success('Selection submitted!'); }
    catch { toast.error('Failed to submit'); }
  };

  if (loading) return <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div>;
  if (!data) return <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center"><div className="text-center"><h1 className="text-3xl text-white">Catalogue not found</h1></div></div>;

  if (submitted) return (
    <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="bg-[#10b981] rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6"><Check className="h-10 w-10 text-white" /></div>
        <h1 className="text-3xl font-bold text-white mb-4">Thank You!</h1>
        <p className="text-[#a0a0b0]">Your shape selection has been submitted successfully. We will contact you soon.</p>
      </div>
    </div>
  );

  const { quotation, package: pkg, dies: diesRaw, logo_url: logoUrl, owned = {}, offers = {} } = data;
  const dies = diesRaw || [];

  // A valid catalogue always carries its quotation. If a transient/partial response
  // (e.g. during a backend restart) omits it, show a friendly notice instead of
  // hard-crashing the whole page to a blank 500 for the school.
  if (!quotation) return (
    <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h1 className="text-3xl font-bold text-white mb-3">Catalogue unavailable</h1>
        <p className="text-[#a0a0b0]">We couldn't load this catalogue right now. Please refresh in a moment, or contact your SMARTS-SHAPES representative.</p>
        <Button onClick={() => window.location.reload()} className="mt-6 bg-[#e94560] hover:bg-[#d63651] text-white">Refresh</Button>
      </div>
    </div>
  );

  // Derive actual limits from quotation lines (what was quoted, not package defaults)
  const lines = quotation.lines || [];
  const stdLine  = lines.find(l => l.description?.toLowerCase().includes('standard die'));
  const largeLine = lines.find(l => l.description?.toLowerCase().includes('large die'));
  const stdQtyFromQuote   = stdLine?.qty  || 0;
  const largeQtyFromQuote = largeLine?.qty || 0;

  // Use quotation quantities as limits; fall back to package defaults
  const stdLimit   = stdQtyFromQuote   || pkg?.std_die_qty   || 0;
  const largeLimit = largeQtyFromQuote || pkg?.large_die_qty || 0;

  // If quoted quantities differ from package defaults → Custom Package
  const isCustom = pkg && (
    (stdQtyFromQuote   > 0 && stdQtyFromQuote   !== pkg.std_die_qty) ||
    (largeQtyFromQuote > 0 && largeQtyFromQuote !== pkg.large_die_qty)
  );
  const packageLabel = isCustom ? 'CUSTOM PACKAGE' : (pkg?.display_name || '');

  const sumQtyByType = (t) => selectedDies.reduce((sum, id) => {
    const d = dies.find(x => x.die_id === id);
    return d && d.type === t ? sum + (qtyByDie[id] || 0) : sum;
  }, 0);
  const stdSelected = sumQtyByType('standard');
  const largeSelected = sumQtyByType('large');
  const totalUnits = selectedDies.reduce((sum, id) => sum + (qtyByDie[id] || 0), 0);
  const optUnits = Object.values(optQty).reduce((sum, q) => sum + (q || 0), 0);

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      {/* Hero */}
      <div className="bg-gradient-to-b from-[#1a1a2e] to-[#0a0a12] py-12 px-4">
        <div className="max-w-6xl mx-auto text-center">
          {/* Company Logo */}
          {logoUrl && (
            <div className="mb-6">
              <img
                src={logoUrl}
                alt="SMARTS-SHAPES"
                className="h-16 mx-auto object-contain"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </div>
          )}
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-3" data-testid="catalogue-title">Dies Catalogue</h1>
          <p className="text-xl text-[#e94560] font-medium">{quotation.school_name}</p>
          {packageLabel && (
            <p className={`mt-2 text-sm font-semibold tracking-widest uppercase ${isCustom ? 'text-[#e94560]' : 'text-[#a0a0b0]'}`}>
              {packageLabel}
            </p>
          )}
        </div>
      </div>

      {/* Step bar: 1 Main (as per quotation) → 2 Optional extras */}
      <div className="sticky top-0 z-30 bg-[#1a1a2e]/95 backdrop-blur border-b border-[#2d2d44]">
        <div className="max-w-6xl mx-auto px-4 py-3 space-y-2">
          <div className="flex gap-2 text-xs font-semibold" data-testid="catalogue-steps">
            <button onClick={() => setStep('main')} className={`px-3 py-1 rounded-full ${step === 'main' ? 'bg-[#e94560] text-white' : 'bg-[#0f0f1a] text-[#a0a0b0] border border-[#2d2d44]'}`}>
              1 · Main selection
            </button>
            <button onClick={() => selectedDies.length && setStep('optional')} disabled={!selectedDies.length}
              className={`px-3 py-1 rounded-full disabled:opacity-40 ${step === 'optional' ? 'bg-amber-500 text-white' : 'bg-[#0f0f1a] text-[#a0a0b0] border border-[#2d2d44]'}`}>
              2 · Optional extras
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-4 text-sm">
              {step === 'main' ? (
                <>
                  {stdLimit > 0 && <span className="text-[#a0a0b0]">Standard: <strong className={`${stdSelected >= stdLimit ? 'text-green-400' : 'text-white'}`}>{stdSelected}/{stdLimit}</strong></span>}
                  {largeLimit > 0 && <span className="text-[#a0a0b0]">Large: <strong className={`${largeSelected >= largeLimit ? 'text-green-400' : 'text-white'}`}>{largeSelected}/{largeLimit}</strong></span>}
                  {!(stdLimit || largeLimit) && <span className="text-[#a0a0b0]">Main: <strong className="text-white">{totalUnits}</strong></span>}
                </>
              ) : (
                <span className="text-[#a0a0b0]">Main: <strong className="text-white">{totalUnits}</strong> · Optional extras: <strong className="text-amber-400">{optUnits}</strong></span>
              )}
            </div>
            <div className="flex gap-2">
              {step === 'main' ? (
                <Button onClick={() => setStep('optional')} disabled={selectedDies.length === 0} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="catalogue-next-optional">
                  Next: optional extras →
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setStep('main')} className="border-[#2d2d44] text-[#a0a0b0] bg-transparent">← Main</Button>
                  <Button onClick={handleSubmit} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="catalogue-submit-button">
                    Submit selection ({totalUnits + optUnits})
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className={`rounded-lg border p-4 text-sm ${step === 'main' ? 'border-[#2d2d44] bg-[#1a1a2e] text-[#a0a0b0]' : 'border-amber-500/40 bg-amber-500/5 text-[#d0c8b0]'}`} data-testid="catalogue-guide">
          {step === 'main' ? (
            <>
              <p className="flex items-center gap-2 text-white font-medium mb-2"><Info className="h-4 w-4 text-[#e94560]" /> Step 1 — choose your main dies (as per your quotation)</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Tap a die to select it; use <b className="text-white">+ / −</b> to set the quantity.</li>
                {(stdLimit > 0 || largeLimit > 0) && <li>Your quotation covers {[stdLimit > 0 && `${stdLimit} standard`, largeLimit > 0 && `${largeLimit} large`].filter(Boolean).join(' and ')} dies — the counter turns green when you reach it.</li>}
                {Object.keys(owned || {}).length > 0 && <li>Dies marked <span className="px-1 rounded bg-amber-500 text-white text-[11px] font-semibold">Already ordered</span> are ones you already have.</li>}
                <li>Press <b className="text-white">Next: optional extras</b>.</li>
              </ol>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-white font-medium mb-2"><Info className="h-4 w-4 text-amber-400" /> Step 2 — optional extras (not in your quotation)</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Want more dies than your quotation covers? Pick them here — they are marked <b className="text-amber-400">optional</b>.</li>
                <li>Optional extras are not ordered automatically; we'll send you a separate price for them.</li>
                <li>No extras? Just press <b className="text-white">Submit selection</b>.</li>
              </ol>
            </>
          )}
        </div>

        <DieSelectionGrid
          dies={dies}
          qtyByDie={activeMap}
          onToggle={handleToggleDie}
          onQtyChange={setDieQty}
          backendUrl={backendUrl}
          typeTab={typeTab}
          onTypeTabChange={setTypeTab}
          onVideoPreview={setVideoDie}
          ownedByDie={owned || {}}
          offerByDie={offers || {}}
        />
      </div>

      <VideoModal url={videoDie?.video_url} title={videoDie?.name} open={!!videoDie} onClose={() => setVideoDie(null)} />

      {/* Floating Submit */}
      {selectedDies.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
          {step === 'main' ? (
            <Button onClick={() => { setStep('optional'); window.scrollTo(0, 0); }} className="bg-[#e94560] hover:bg-[#f05c75] text-white text-lg px-8 py-5 rounded-full shadow-2xl shadow-[#e94560]/30" data-testid="catalogue-floating-next">
              Next: optional extras →
            </Button>
          ) : (
            <Button onClick={handleSubmit} className="bg-[#e94560] hover:bg-[#f05c75] text-white text-lg px-8 py-5 rounded-full shadow-2xl shadow-[#e94560]/30" data-testid="catalogue-floating-submit">
              <Check className="mr-2 h-5 w-5" /> Submit {totalUnits + optUnits} {totalUnits + optUnits === 1 ? 'Unit' : 'Units'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

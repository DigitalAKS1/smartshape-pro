import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { catalogue } from '../lib/api';
import { Button } from '../components/ui/button';
import { Check } from 'lucide-react';
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

  const selectedDies = Object.keys(qtyByDie);

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await catalogue.get(token); setData(res.data); }
      catch { toast.error('Failed to load catalogue'); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [token]);

  const handleToggleDie = (dieId) => {
    setQtyByDie(prev => {
      const next = { ...prev };
      if (next[dieId] != null) { delete next[dieId]; } else { next[dieId] = 1; }
      return next;
    });
  };

  const setDieQty = (dieId, qty) => {
    const clamped = Math.max(1, parseInt(qty, 10) || 1);
    setQtyByDie(prev => ({ ...prev, [dieId]: clamped }));
  };

  const handleSubmit = async () => {
    const selections = Object.entries(qtyByDie).map(([die_id, quantity]) => ({ die_id, quantity }));
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

  const { quotation, package: pkg, dies: diesRaw, logo_url: logoUrl } = data;
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

      {/* Package Info Bar */}
      <div className="sticky top-0 z-30 bg-[#1a1a2e]/95 backdrop-blur border-b border-[#2d2d44]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-4 text-sm">
            {stdLimit > 0 && <span className="text-[#a0a0b0]">Standard: <strong className={`${stdSelected >= stdLimit ? 'text-green-400' : 'text-white'}`}>{stdSelected}/{stdLimit}</strong></span>}
            {largeLimit > 0 && <span className="text-[#a0a0b0]">Large: <strong className={`${largeSelected >= largeLimit ? 'text-green-400' : 'text-white'}`}>{largeSelected}/{largeLimit}</strong></span>}
            {!pkg && <span className="text-[#a0a0b0]">Selected: <strong className="text-white">{totalUnits}</strong></span>}
          </div>
          <Button onClick={handleSubmit} disabled={selectedDies.length === 0} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="catalogue-submit-button">
            Submit Selection ({totalUnits})
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <DieSelectionGrid
          dies={dies}
          qtyByDie={qtyByDie}
          onToggle={handleToggleDie}
          onQtyChange={setDieQty}
          backendUrl={backendUrl}
          typeTab={typeTab}
          onTypeTabChange={setTypeTab}
          onVideoPreview={setVideoDie}
        />
      </div>

      <VideoModal url={videoDie?.video_url} title={videoDie?.name} open={!!videoDie} onClose={() => setVideoDie(null)} />

      {/* Floating Submit */}
      {selectedDies.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
          <Button onClick={handleSubmit} className="bg-[#e94560] hover:bg-[#f05c75] text-white text-lg px-8 py-5 rounded-full shadow-2xl shadow-[#e94560]/30" data-testid="catalogue-floating-submit">
            <Check className="mr-2 h-5 w-5" /> Submit {totalUnits} {totalUnits === 1 ? 'Unit' : 'Units'}
          </Button>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { catalogue } from '../lib/api';
import { Button } from '../components/ui/button';
import { Check, Minus, Plus, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import MediaGallery from '../components/media/MediaGallery';
import VideoModal from '../components/media/VideoModal';

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

  const { quotation, package: pkg, dies, logo_url: logoUrl } = data;

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

  // Product-type tabs (built from what the server published to this school)
  const typeTabs = [];
  const seenTypes = new Set();
  dies.forEach(d => {
    const id = d.product_type_id || 'ptype_dies';
    if (!seenTypes.has(id)) { seenTypes.add(id); typeTabs.push({ id, name: d.product_type || 'Die' }); }
  });
  const visibleDies = typeTab === 'all'
    ? dies
    : dies.filter(d => (d.product_type_id || 'ptype_dies') === typeTab);

  // Group dies by category
  const grouped = {};
  visibleDies.forEach(d => {
    const cat = d.category || d.type || 'standard';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(d);
  });

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

      {/* Product-type tabs */}
      {typeTabs.length > 1 && (
        <div className="max-w-6xl mx-auto px-4 pt-6">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            <button onClick={() => setTypeTab('all')}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-colors ${typeTab === 'all' ? 'bg-[#e94560] text-white' : 'bg-[#1a1a2e] text-[#a0a0b0] border border-[#2d2d44]'}`}>
              All
            </button>
            {typeTabs.map(t => (
              <button key={t.id} onClick={() => setTypeTab(t.id)}
                className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-colors ${typeTab === t.id ? 'bg-[#e94560] text-white' : 'bg-[#1a1a2e] text-[#a0a0b0] border border-[#2d2d44]'}`}>
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Dies Grid - grouped by category */}
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-10">
        {Object.entries(grouped).map(([cat, catDies]) => (
          <div key={cat}>
            <h2 className="text-2xl font-bold text-white mb-4 capitalize">{cat.replace(/_/g, ' ')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" data-testid={`catalogue-section-${cat}`}>
              {catDies.map((die) => {
                const isSelected = selectedDies.includes(die.die_id);
                return (
                  <div key={die.die_id} onClick={() => handleToggleDie(die.die_id)}
                    className={`relative bg-[#1a1a2e] rounded-lg overflow-hidden cursor-pointer transition-all hover:-translate-y-1 ${isSelected ? 'ring-2 ring-[#e94560] shadow-lg shadow-[#e94560]/20' : 'border border-[#2d2d44] hover:border-[#e94560]/40'}`}
                    data-testid={`die-card-${die.code}`}>
                    {/* Check badge */}
                    {isSelected && (
                      <div className="absolute top-2 right-2 z-10 bg-[#e94560] text-white rounded-full w-6 h-6 flex items-center justify-center"><Check className="h-4 w-4" /></div>
                    )}
                    {/* Die Image — tapping the photo opens the zoom lightbox (not select) */}
                    <div className="relative aspect-square bg-[#0f0f1a]" onClick={(e) => e.stopPropagation()}>
                      <MediaGallery images={die.images} alt={die.name} backendUrl={backendUrl} />
                      {die.video_url && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setVideoDie(die); }}
                          className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-medium">
                          <PlayCircle className="h-3.5 w-3.5" /> Video
                        </button>
                      )}
                    </div>
                    {/* Info */}
                    <div className="p-3">
                      <p className="font-mono text-[10px] text-[#e94560]">{die.code}</p>
                      <h3 className="text-sm font-medium text-white leading-tight mt-0.5 line-clamp-1">{die.name}</h3>
                      <p className="text-[10px] text-[#6b6b80] mt-1 capitalize">{die.type} die</p>
                      {die.description && <p className="text-[10px] text-[#8a8aa0] mt-1 line-clamp-2">{die.description}</p>}
                      {/* Quantity stepper — only when selected */}
                      {isSelected && (
                        <div className="mt-2 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                          <span className="text-[10px] text-[#a0a0b0] uppercase tracking-wide">Qty</span>
                          <div className="flex items-center gap-1">
                            <button type="button" aria-label="Decrease quantity"
                              onClick={() => setDieQty(die.die_id, (qtyByDie[die.die_id] || 1) - 1)}
                              className="w-6 h-6 rounded bg-[#0f0f1a] border border-[#2d2d44] text-white flex items-center justify-center hover:border-[#e94560]">
                              <Minus className="h-3 w-3" />
                            </button>
                            <input type="number" min="1" value={qtyByDie[die.die_id] || 1}
                              onChange={(e) => setDieQty(die.die_id, e.target.value)}
                              data-testid={`die-qty-${die.code}`}
                              className="w-12 h-6 text-center text-sm bg-[#0f0f1a] border border-[#2d2d44] rounded text-white" />
                            <button type="button" aria-label="Increase quantity"
                              onClick={() => setDieQty(die.die_id, (qtyByDie[die.die_id] || 1) + 1)}
                              className="w-6 h-6 rounded bg-[#0f0f1a] border border-[#2d2d44] text-white flex items-center justify-center hover:border-[#e94560]">
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
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

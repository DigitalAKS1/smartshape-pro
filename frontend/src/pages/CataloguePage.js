import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { catalogue } from '../lib/api';
import { Button } from '../components/ui/button';
import { Check, Package, Image } from 'lucide-react';
import { toast } from 'sonner';

export default function CataloguePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [selectedDies, setSelectedDies] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const backendUrl = process.env.REACT_APP_BACKEND_URL;

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await catalogue.get(token); setData(res.data); }
      catch { toast.error('Failed to load catalogue'); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [token]);

  const handleToggleDie = (dieId) => {
    setSelectedDies(prev => prev.includes(dieId) ? prev.filter(id => id !== dieId) : [...prev, dieId]);
  };

  const handleSubmit = async () => {
    try { await catalogue.submit(token, selectedDies); setSubmitted(true); toast.success('Selection submitted!'); }
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

  const { quotation, package: pkg, dies } = data;

  // Group dies by category
  const grouped = {};
  dies.forEach(d => {
    const cat = d.category || d.type || 'standard';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(d);
  });

  const stdSelected = selectedDies.filter(id => { const d = dies.find(x => x.die_id === id); return d && d.type === 'standard'; }).length;
  const largeSelected = selectedDies.filter(id => { const d = dies.find(x => x.die_id === id); return d && d.type === 'large'; }).length;

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      {/* Hero */}
      <div className="bg-gradient-to-b from-[#1a1a2e] to-[#0a0a12] py-12 px-4">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-3" data-testid="catalogue-title">SmartShape Dies Catalogue</h1>
          <p className="text-xl text-[#e94560] font-medium">{quotation.school_name}</p>
          <p className="text-[#a0a0b0] mt-2">{pkg.display_name}</p>
        </div>
      </div>

      {/* Package Info Bar */}
      <div className="sticky top-0 z-30 bg-[#1a1a2e]/95 backdrop-blur border-b border-[#2d2d44]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-4 text-sm">
            <span className="text-[#a0a0b0]">Standard: <strong className={`${stdSelected >= (pkg.std_die_qty || 0) ? 'text-green-400' : 'text-white'}`}>{stdSelected}/{pkg.std_die_qty || 0}</strong></span>
            <span className="text-[#a0a0b0]">Large: <strong className={`${largeSelected >= (pkg.large_die_qty || 0) ? 'text-green-400' : 'text-white'}`}>{largeSelected}/{pkg.large_die_qty || 0}</strong></span>
          </div>
          <Button onClick={handleSubmit} disabled={selectedDies.length === 0} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="catalogue-submit-button">
            Submit Selection ({selectedDies.length})
          </Button>
        </div>
      </div>

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
                    {/* Die Image */}
                    <div className="aspect-square bg-[#0f0f1a] flex items-center justify-center p-2">
                      {die.image_url ? (
                        <img src={`${backendUrl}${die.image_url}`} alt={die.name} className="w-full h-full object-contain" loading="lazy" />
                      ) : (
                        <div className="flex flex-col items-center text-[#3d3d55]">
                          <Package className="h-10 w-10 mb-1" strokeWidth={1} />
                          <span className="text-[10px]">{die.code}</span>
                        </div>
                      )}
                    </div>
                    {/* Info */}
                    <div className="p-3">
                      <p className="font-mono text-[10px] text-[#e94560]">{die.code}</p>
                      <h3 className="text-sm font-medium text-white leading-tight mt-0.5 line-clamp-1">{die.name}</h3>
                      <p className="text-[10px] text-[#6b6b80] mt-1 capitalize">{die.type} die</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Floating Submit */}
      {selectedDies.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
          <Button onClick={handleSubmit} className="bg-[#e94560] hover:bg-[#f05c75] text-white text-lg px-8 py-5 rounded-full shadow-2xl shadow-[#e94560]/30" data-testid="catalogue-floating-submit">
            <Check className="mr-2 h-5 w-5" /> Submit {selectedDies.length} Selections
          </Button>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { catalogues } from '../lib/api';
import { Button } from '../components/ui/button';
import DieSelectionGrid from '../components/catalogue/DieSelectionGrid';
import VideoModal from '../components/media/VideoModal';

const inputCls = 'w-full h-10 px-3 rounded-md text-sm bg-[#0f0f1a] border border-[#2d2d44] text-white placeholder:text-[#6b6b80] focus:outline-none focus:border-[#e94560]';

/** Public page for a Catalogue Master link (/c/:token) — no quotation needed. */
export default function CatalogueShare() {
  const { token } = useParams();
  const backendUrl = process.env.REACT_APP_BACKEND_URL;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [qtyByDie, setQtyByDie] = useState({});
  const [typeTab, setTypeTab] = useState('all');
  const [videoDie, setVideoDie] = useState(null);
  const [contact, setContact] = useState({ name: '', phone: '', message: '', email: '', school_name: '', city: '' });
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    catalogues.publicGet(token)
      .then(r => { setData(r.data); if (r.data?.submitted) setDone(true); })
      .catch(e => setError(e?.response?.data?.detail || 'This catalogue link is not available'));
  }, [token]);

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
  const picked = Object.keys(qtyByDie).length;
  const units = Object.values(qtyByDie).reduce((a, b) => a + b, 0);

  const submit = async () => {
    if (!picked) { toast.error('Choose at least one die'); return; }
    if (data.needs_contact && !contact.email.trim()) { toast.error('Enter your email so we can send the quotation'); return; }
    if (data.needs_contact && !data.school_name && !contact.school_name.trim()) { toast.error('Enter your school name'); return; }
    setSending(true);
    try {
      await catalogues.publicSubmit(token, {
        ...contact,
        selections: Object.entries(qtyByDie).map(([die_id, quantity]) => ({ die_id, quantity })),
      });
      setDone(true);
      window.scrollTo(0, 0);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not send — please try again');
    } finally { setSending(false); }
  };

  if (error) return (
    <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center px-4">
      <p className="text-[#a0a0b0] text-center">{error}</p>
    </div>
  );
  if (!data) return (
    <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#e94560] border-t-transparent" />
    </div>
  );
  if (done) return (
    <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center px-4">
      <div className="max-w-md text-center" data-testid="catalogue-share-done">
        <CheckCircle2 className="h-16 w-16 text-green-400 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-white mb-2">Selection sent</h1>
        <p className="text-[#a0a0b0]">Thank you! Our team will send your quotation shortly.</p>
      </div>
    </div>
  );

  const ownedCount = Object.keys(data.owned || {}).length;

  return (
    <div className="min-h-screen bg-[#0a0a12] pb-28">
      <div className="bg-gradient-to-b from-[#1a1a2e] to-[#0a0a12] py-10 px-4 text-center">
        {data.logo_url && <img src={data.logo_url} alt="" className="h-14 mx-auto mb-5 object-contain" style={{ filter: 'brightness(0) invert(1)' }} />}
        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2" data-testid="catalogue-share-title">{data.catalogue.name}</h1>
        {data.school_name && <p className="text-lg text-[#e94560] font-medium">{data.school_name}</p>}
        {data.catalogue.intro && <p className="text-[#a0a0b0] mt-3 max-w-2xl mx-auto whitespace-pre-line">{data.catalogue.intro}</p>}
      </div>

      <div className="max-w-6xl mx-auto px-4 space-y-6">
        <div className="rounded-lg border border-[#2d2d44] bg-[#1a1a2e] p-4 text-sm text-[#a0a0b0]" data-testid="catalogue-share-guide">
          <p className="flex items-center gap-2 text-white font-medium mb-2"><Info className="h-4 w-4 text-[#e94560]" /> How to choose</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap a die to select it; tap again to remove it.</li>
            <li>Use <b className="text-white">+ / −</b> on a selected die to set how many you need.</li>
            {ownedCount > 0 && <li>Dies marked <span className="px-1 rounded bg-amber-500 text-white text-[11px] font-semibold">Already ordered</span> are ones you have bought before.</li>}
            <li>Press <b className="text-white">Send selection</b> at the bottom. We'll reply with a quotation.</li>
          </ol>
        </div>

        <DieSelectionGrid dies={data.dies || []} qtyByDie={qtyByDie} onToggle={toggle} onQtyChange={setQty}
          backendUrl={backendUrl} typeTab={typeTab} onTypeTabChange={setTypeTab} onVideoPreview={setVideoDie}
          ownedByDie={data.owned || {}} offerByDie={data.offers || {}} />

        <div className="rounded-lg border border-[#2d2d44] bg-[#1a1a2e] p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {data.needs_contact && (
            <>
              <input className={inputCls} placeholder="Your email *" type="email" value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} data-testid="cs-email" />
              {!data.school_name && <input className={inputCls} placeholder="School name *" value={contact.school_name} onChange={e => setContact({ ...contact, school_name: e.target.value })} data-testid="cs-school" />}
              {!data.school_name && <input className={inputCls} placeholder="City" value={contact.city} onChange={e => setContact({ ...contact, city: e.target.value })} />}
            </>
          )}
          <input className={inputCls} placeholder="Your name (optional)" value={contact.name} onChange={e => setContact({ ...contact, name: e.target.value })} />
          <input className={inputCls} placeholder="Phone (optional)" value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} />
          <input className={inputCls} placeholder="Note for us (optional)" value={contact.message} onChange={e => setContact({ ...contact, message: e.target.value })} />
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 z-30 bg-[#1a1a2e]/95 backdrop-blur border-t border-[#2d2d44]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm text-[#a0a0b0]">Selected: <b className="text-white">{picked}</b> dies · <b className="text-white">{units}</b> pcs</span>
          <Button onClick={submit} disabled={!picked || sending} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="catalogue-share-submit">
            {sending ? 'Sending…' : 'Send selection'}
          </Button>
        </div>
      </div>

      <VideoModal url={videoDie?.video_url} title={videoDie?.name} open={!!videoDie} onClose={() => setVideoDie(null)} />
    </div>
  );
}

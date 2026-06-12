import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { adminContent } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import { Video, CheckCircle, XCircle } from 'lucide-react';

const FILTERS = ['pending', 'approved', 'rejected', 'all'];

export default function ContentReview() {
  const [status, setStatus] = useState('pending');
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);

  const textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]', textMuted = 'text-[var(--text-muted)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';

  const load = (st = status) => {
    setLoading(true);
    adminContent.videos(st).then(r => setVideos(r.data || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(status); /* eslint-disable-next-line */ }, [status]);

  const approve = async (id) => {
    try { await adminContent.approve(id); toast.success('Approved'); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };
  const reject = async (id) => {
    const reason = window.prompt('Reason for rejection (shown to the teacher):', '');
    if (reason === null) return;
    try { await adminContent.reject(id, reason); toast.success('Rejected'); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto space-y-5">
        <div>
          <h1 className={`text-2xl font-semibold ${textPri}`}>Teacher Content Review</h1>
          <p className={`text-sm ${textSec} mt-1`}>Approve or reject teacher video submissions. Approved videos appear in the central gallery.</p>
        </div>

        <div className={`flex gap-1 ${card} border rounded-md p-1 w-fit`}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setStatus(f)} className={`px-4 py-2 rounded text-sm font-medium capitalize ${status === f ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}>{f}</button>
          ))}
        </div>

        {loading ? <p className={textMuted}>Loading…</p> : videos.length === 0 ? (
          <div className={`${card} border rounded-md p-12 text-center`}><Video className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} /><p className={textMuted}>Nothing here</p></div>
        ) : videos.map(v => (
          <div key={v.video_id} className={`${card} border rounded-md p-4`}>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="sm:w-64 flex-shrink-0">
                {v.video_url ? <video src={v.video_url} controls poster={v.thumbnail_url} className="w-full rounded bg-black" /> : <div className="w-full h-40 bg-[var(--bg-hover)] rounded" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-medium ${textPri}`}>{v.title} <span className={`text-xs ${textMuted} capitalize`}>• {v.type}</span></p>
                <p className={`text-sm ${textSec} mt-1`}>{v.description}</p>
                <div className={`text-xs ${textMuted} mt-2 space-y-0.5`}>
                  <p>Teacher: {v.teacher_name}</p>
                  {v.machine_used && <p>Machine: {v.machine_used}</p>}
                  {v.dies_used && <p>Dies: {v.dies_used}</p>}
                  {v.competition_id && <p>Competition entry</p>}
                  <p>Status: <span className="capitalize">{v.status}</span>{v.review_note ? ` — ${v.review_note}` : ''}</p>
                </div>
                {v.status === 'pending' && (
                  <div className="flex gap-2 mt-3">
                    <Button onClick={() => approve(v.video_id)} className="bg-green-600 hover:bg-green-700 text-white"><CheckCircle className="h-4 w-4 mr-1" /> Approve</Button>
                    <Button onClick={() => reject(v.video_id)} variant="outline"><XCircle className="h-4 w-4 mr-1" /> Reject</Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </AdminLayout>
  );
}

import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Eye, CheckCircle2, XCircle, Phone } from 'lucide-react';

const CALL_OUTCOMES = [
  ['connected', 'Connected'], ['no_answer', 'No answer'], ['busy', 'Busy'],
  ['wrong_number', 'Wrong number'], ['callback', 'Asked to call back'], ['failed', 'Failed'],
];

export default function AwaitingConfirmationTab({
  orders = [], onConfirm, onReject, onLogCall, onOpenDetail,
  textPri, textSec, textMuted, inputCls, card, dlgCls,
}) {
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  const [callTarget, setCallTarget] = useState(null);
  const [callForm, setCallForm] = useState({ outcome: '', content: '' });

  const openReject = (order) => { setRejectTarget(order); setRejectReason(''); setRejectError(''); };
  const submitReject = () => {
    if (!rejectReason.trim()) { setRejectError('A reason is required to reject a selection'); return; }
    onReject(rejectTarget.order_id, rejectReason.trim());
    setRejectTarget(null);
  };

  const openCall = (order) => { setCallTarget(order); setCallForm({ outcome: '', content: '' }); };
  const submitCall = () => {
    if (!callForm.outcome) return;
    onLogCall(callTarget.order_id, callForm);
    setCallTarget(null);
  };

  if (orders.length === 0) {
    return (
      <div className={`${card} border rounded-md p-12 text-center`} data-testid="awaiting-empty">
        <p className={textMuted}>No orders awaiting confirmation right now.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="awaiting-confirmation-list">
      {orders.map(order => (
        <div key={order.order_id} className={`${card} border rounded-md p-4`} data-testid={`awaiting-order-${order.order_number}`}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-sm text-[#e94560] font-medium">{order.order_number}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border text-amber-400 bg-amber-500/10 border-amber-500/30">
                  Awaiting Confirmation
                </span>
              </div>
              <h3 className={`text-base font-medium ${textPri} truncate`}>{order.school_name}</h3>
              <div className={`flex flex-wrap items-center gap-3 mt-1 text-xs ${textMuted}`}>
                <span>{order.total_items} items</span>
                <span>{formatDate(order.created_at)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0">
              <span className={`font-mono text-base sm:text-lg font-bold ${textPri}`}>{formatCurrency(order.grand_total)}</span>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={() => onOpenDetail(order)}
                  className={`border-[var(--border-color)] ${textSec} h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3`}
                  data-testid={`edit-order-${order.order_number}`} title="View / edit items">
                  <Eye className="h-3.5 w-3.5" /><span className="hidden sm:inline ml-1">Edit</span>
                </Button>
                <Button size="sm" onClick={() => onConfirm(order.order_id)}
                  className="bg-green-600 hover:bg-green-700 text-white h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
                  data-testid={`confirm-order-${order.order_number}`} title="Confirm — reserve stock">
                  <CheckCircle2 className="h-3.5 w-3.5" /><span className="hidden sm:inline ml-1">Confirm</span>
                </Button>
                <Button size="sm" variant="outline" onClick={() => openReject(order)}
                  className="border-red-500/40 text-red-400 hover:bg-red-500/10 h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
                  data-testid={`reject-order-${order.order_number}`} title="Reject">
                  <XCircle className="h-3.5 w-3.5" /><span className="hidden sm:inline ml-1">Reject</span>
                </Button>
                <Button size="sm" variant="outline" onClick={() => openCall(order)}
                  className={`border-[var(--border-color)] ${textSec} h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3`}
                  data-testid={`call-order-${order.order_number}`} title="Log a call">
                  <Phone className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className={`${dlgCls} max-w-sm`}>
          <DialogHeader><DialogTitle className={textPri}>Reject selection</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <p className={`text-xs ${textMuted}`}>{rejectTarget?.order_number} — {rejectTarget?.school_name}</p>
            <textarea rows={3} value={rejectReason}
              onChange={e => { setRejectReason(e.target.value); setRejectError(''); }}
              placeholder="Why is this being rejected?"
              data-testid="reject-reason-input"
              className={`w-full p-2 rounded-md text-sm ${inputCls}`} />
            {rejectError && <p className="text-xs text-red-400">{rejectError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
            <Button onClick={submitReject} data-testid="reject-submit" className="bg-red-600 hover:bg-red-700 text-white">Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log a call dialog */}
      <Dialog open={!!callTarget} onOpenChange={(o) => !o && setCallTarget(null)}>
        <DialogContent className={`${dlgCls} max-w-sm`}>
          <DialogHeader><DialogTitle className={textPri}>Log a call</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <p className={`text-xs ${textMuted}`}>{callTarget?.order_number} — {callTarget?.school_name}</p>
            <select value={callForm.outcome} onChange={e => setCallForm(f => ({ ...f, outcome: e.target.value }))}
              data-testid="call-outcome-select"
              className={`w-full h-9 px-2 rounded-md text-sm ${inputCls}`}>
              <option value="">Outcome…</option>
              {CALL_OUTCOMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <textarea rows={3} value={callForm.content}
              onChange={e => setCallForm(f => ({ ...f, content: e.target.value }))}
              placeholder="What was discussed?"
              data-testid="call-content-input"
              className={`w-full p-2 rounded-md text-sm ${inputCls}`} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCallTarget(null)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
            <Button onClick={submitCall} disabled={!callForm.outcome} data-testid="call-submit" className="bg-[#e94560] hover:bg-[#f05c75] text-white">Log call</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

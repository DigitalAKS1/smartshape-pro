import React from 'react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '../ui/dialog';
import { CheckCircle, Loader2, MessageSquare } from 'lucide-react';

/**
 * Check-out dialog: visit notes + optional WhatsApp follow-up toggle.
 */
export default function VisitCheckoutDialog({
  checkoutDialog, setCheckoutDialog,
  checkoutNotes, setCheckoutNotes,
  checkoutWa, setCheckoutWa,
  handleCheckOut,
  tk, isDark,
}) {
  return (
    <Dialog
      open={checkoutDialog.open}
      onOpenChange={o => !checkoutDialog.saving && setCheckoutDialog(d => ({ ...d, open: o }))}
    >
      <DialogContent className={`${tk.dlg} border w-[calc(100vw-1rem)] sm:max-w-sm rounded-2xl`}>
        <DialogHeader>
          <DialogTitle className={tk.t1}>Check Out</DialogTitle>
          <DialogDescription className={tk.tm}>
            {checkoutDialog.plan?.school_name || checkoutDialog.plan?.lead_name || 'Visit'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className={`text-xs ${tk.tm} mb-1.5 block`}>Visit notes / outcome</Label>
            <textarea
              value={checkoutNotes}
              onChange={e => setCheckoutNotes(e.target.value)}
              rows={3}
              className={`w-full rounded-xl text-sm p-3 border resize-none focus:outline-none focus:ring-2 focus:ring-[#e94560]/30 ${tk.input}`}
              placeholder="What happened? Any follow-up needed?"
            />
          </div>

          {/* WhatsApp toggle */}
          <label className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
            checkoutWa
              ? 'border-emerald-500/40 bg-emerald-50'
              : isDark ? 'border-[var(--border-color)]' : 'border-[#e2e8f0]'
          }`}>
            <MessageSquare className={`h-4 w-4 flex-shrink-0 ${checkoutWa ? 'text-emerald-600' : tk.tm}`} />
            <div className="flex-1">
              <p className={`text-sm font-medium ${checkoutWa ? 'text-emerald-700' : tk.t1}`}>Send WhatsApp follow-up</p>
              <p className={`text-xs ${checkoutWa ? 'text-emerald-600' : tk.tm}`}>Open message dialog after check-out</p>
            </div>
            <input type="checkbox" checked={checkoutWa} onChange={e => setCheckoutWa(e.target.checked)}
              className="w-4 h-4 accent-[#e94560]" />
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost"
            onClick={() => setCheckoutDialog({ open: false, plan: null, saving: false })}
            disabled={checkoutDialog.saving}
            className={tk.tm}>
            Cancel
          </Button>
          <Button onClick={handleCheckOut} disabled={checkoutDialog.saving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-5">
            {checkoutDialog.saving
              ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Checking out…</>
              : <><CheckCircle className="h-3.5 w-3.5 mr-2" />Check Out</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

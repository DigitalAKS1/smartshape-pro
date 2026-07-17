import { toast } from 'sonner';
import { telephonyApi } from './api';

// Tiny event bus so any call button can open the global CallWidget.
const bus = new EventTarget();

export function onCallStart(cb) {
  const h = (e) => cb(e.detail);
  bus.addEventListener('call:start', h);
  return () => bus.removeEventListener('call:start', h);
}

/**
 * Place a Bonvoice call and open the live widget.
 * @param {{kind:'contact'|'lead'|'school', ref_id:string, label?:string}} args
 */
export async function startCall({ kind, ref_id, label }) {
  try {
    const { data } = await telephonyApi.placeCall({ kind, ref_id });
    toast.info('Ringing your phone… pick up to connect the call.');
    bus.dispatchEvent(new CustomEvent('call:start', {
      detail: {
        event_id: data.event_id,
        label: label || data.target_phone || 'Call',
        phone: data.target_phone || '',
        kind, ref_id,
      },
    }));
    return data;
  } catch (e) {
    toast.error(e.response?.data?.detail || 'Could not start the call');
    return null;
  }
}

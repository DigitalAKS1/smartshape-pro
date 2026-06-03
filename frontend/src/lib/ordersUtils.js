// ── Orders Management — constants & pure utilities ───────────────────────────
import { Clock, ShieldCheck, Truck, CheckCircle, XCircle } from 'lucide-react';

export const PROD_STAGES = [
  { id: 'order_created',     label: 'Order Created',     color: 'border-yellow-500/40' },
  { id: 'in_production',     label: 'In Production',     color: 'border-blue-500/40' },
  { id: 'ready_to_dispatch', label: 'Ready to Dispatch', color: 'border-purple-500/40' },
  { id: 'dispatched',        label: 'Dispatched',        color: 'border-green-500/40' },
];

export const ORDER_STATUSES = [
  { id: 'pending',   label: 'Pending',   icon: Clock,       color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30' },
  { id: 'confirmed', label: 'Confirmed', icon: ShieldCheck, color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  { id: 'dispatched',label: 'Dispatched',icon: Truck,       color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
  { id: 'delivered', label: 'Delivered', icon: CheckCircle, color: 'text-green-400 bg-green-500/10 border-green-500/30' },
  { id: 'cancelled', label: 'Cancelled', icon: XCircle,     color: 'text-red-400 bg-red-500/10 border-red-500/30' },
];

/** Build the WhatsApp dispatch tracking message */
export function buildDispatchMessage(dispatch, courierName, trackingNumber) {
  const dateStr = dispatch.dispatch_date
    ? new Date(dispatch.dispatch_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';
  return `Hello,\n\nYour order has been dispatched! Here are the details:\n\n🏫 School: ${dispatch.school_name}\n📦 Order: ${dispatch.order_number}\n🚚 Courier: ${courierName || 'N/A'}\n🔖 Tracking: ${trackingNumber || 'N/A'}\n📅 Date: ${dateStr}\n\nPlease track your shipment using the tracking number above.\n\nThank you!\nSmartShape Pro`;
}

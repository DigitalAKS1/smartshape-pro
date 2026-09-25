// Plain-words results of a WhatsApp send (statuses from backend services/wa_send.py).
const SKIP_REASONS = {
  opt_out: 'this person opted out of WhatsApp',
  no_consent: 'no WhatsApp consent on record for this school',
  not_on_whatsapp: 'this number is not on WhatsApp',
  no_sender: 'no WhatsApp number is connected (yours or the company’s)',
  bad_phone: 'this is not a mobile number',
  empty_message: 'the message is empty',
  sender_not_connected: 'that WhatsApp number is not connected',
  number_warming_up: 'the number is still warming up',
};

export function describeSkip(reason) {
  return SKIP_REASONS[reason] || reason || 'not sent';
}

export function describeSendResult(status) {
  if (status === 'sent') return { level: 'success', text: 'WhatsApp sent' };
  if (status === 'queued') {
    return { level: 'success', text: 'Queued — it goes out within business hours and the number’s limits' };
  }
  if (String(status || '').startsWith('skipped:')) {
    return { level: 'warning', text: `Not sent: ${describeSkip(String(status).slice(8))}` };
  }
  return { level: 'error', text: `Send failed${status && status !== 'failed' ? ` (${status})` : ''}` };
}

export function describeBroadcastResult(d) {
  const parts = [`${d.sent || 0} sent`];
  if (d.queued) parts.push(`${d.queued} queued for business hours / limits`);
  if (d.skipped_policy) parts.push(`${d.skipped_policy} not sent (opted out, no consent or not on WhatsApp)`);
  if (d.failed) parts.push(`${d.failed} failed`);
  let s = `Broadcast: ${parts.join(', ')}`;
  if (d.skipped_no_phone) s += `, ${d.skipped_no_phone} deal(s) with no usable phone`;
  if (d.capped_at) s += ` — capped at ${d.capped_at}, ${d.over_cap} not messaged`;
  return s;
}

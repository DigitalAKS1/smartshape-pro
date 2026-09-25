import { describeSkip, describeSendResult, describeBroadcastResult } from '../waStatus';

test('a skip reason reads in plain words', () => {
  expect(describeSkip('no_consent')).toBe('no WhatsApp consent on record for this school');
  expect(describeSkip('something_new')).toBe('something_new');
});

test('send results map to a toast level and text', () => {
  expect(describeSendResult('sent')).toEqual({ level: 'success', text: 'WhatsApp sent' });
  expect(describeSendResult('queued').level).toBe('success');
  expect(describeSendResult('queued').text).toMatch(/business hours/);
  expect(describeSendResult('skipped:opt_out')).toEqual({ level: 'warning', text: 'Not sent: this person opted out of WhatsApp' });
  expect(describeSendResult('failed').level).toBe('error');
});

test('a broadcast result names every outcome it has', () => {
  const s = describeBroadcastResult({ sent: 3, queued: 2, skipped_policy: 4, failed: 1, skipped_no_phone: 1,
    capped_at: null, over_cap: 0 });
  expect(s).toBe('Broadcast: 3 sent, 2 queued for business hours / limits, 4 not sent (opted out, no consent or '
    + 'not on WhatsApp), 1 failed, 1 deal(s) with no usable phone');
  expect(describeBroadcastResult({ sent: 0 })).toBe('Broadcast: 0 sent');
});

test('"Connect WhatsApp" goes to Settings for admins and to My WhatsApp for everyone else', () => {
  const { waLinkTarget } = require('../waStatus');
  expect(waLinkTarget(true)).toEqual({ href: '/app-settings?tab=whatsapp', label: 'Open Settings → WhatsApp' });
  expect(waLinkTarget(false)).toEqual({ href: '/me/whatsapp', label: 'My WhatsApp' });
});

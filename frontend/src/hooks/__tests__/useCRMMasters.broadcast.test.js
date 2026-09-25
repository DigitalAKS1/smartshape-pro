// WhatsApp broadcast by tag — the screen side of the fix round.
//
// The send reaches the tag roll-up's deals (D3), merged to one message per
// phone. The screen must say so in plain words, and the confirm box must quote
// the EXACT number of people from the server preview fetched right before the
// send — never a stale or guessed count. The preview and the send are mocked;
// nothing here reaches a network.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useCRMMasters, describeBroadcastReach, confirmBroadcastText } from '../useCRMMasters';
import { broadcastApi } from '../../lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;

const ok = (data) => Promise.resolve({ data });

jest.mock('../../lib/api', () => ({
  groups:            { getAll: () => Promise.resolve({ data: [] }) },
  sources:           { getAll: () => Promise.resolve({ data: [] }) },
  contactRoles:      { getAll: () => Promise.resolve({ data: [] }) },
  tags:              { getAll: () => Promise.resolve({ data: [{ tag_id: 't_gslc', name: 'GSLC 2026' }] }) },
  whatsappTemplates: { getAll: () => Promise.resolve({ data: [{ template_id: 'tpl1', name: 'Hello' }] }) },
  designations:      { getAll: () => Promise.resolve({ data: [] }) },
  dealTypes:         { getAll: () => Promise.resolve({ data: [] }) },
  activityTypes:     { getAll: () => Promise.resolve({ data: [] }) },
  broadcastApi:      { byTag: jest.fn(), previewByTag: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

const PREVIEW = { deals: 5, unique_recipients: 3, skipped_no_phone: 1, capped_at: null, over_cap: 0 };

describe('describeBroadcastReach / confirmBroadcastText', () => {
  test('says who is reached, in people and deals, including every stage', () => {
    const s = describeBroadcastReach('GSLC 2026', PREVIEW);
    expect(s).toContain('deals tagged "GSLC 2026"');
    expect(s).toContain('plus every deal (any stage, won and lost included) at a school the tag reaches');
    expect(s).toContain('3 people (5 deals)');
    expect(s).toContain('1 deal has no usable phone');
    expect(s).not.toMatch(/Capped/);
  });

  test('a cap is spelled out, never silent', () => {
    const s = describeBroadcastReach('X', { deals: 9000, unique_recipients: 6000, skipped_no_phone: 0, capped_at: 5000, over_cap: 1000 });
    expect(s).toContain('Capped at 5000: 1000 more people will NOT be messaged');
  });

  test('the confirm text leads with the exact unique-recipient count', () => {
    expect(confirmBroadcastText('GSLC 2026', PREVIEW).startsWith('Send this WhatsApp template to 3 people?')).toBe(true);
    expect(confirmBroadcastText('X', { ...PREVIEW, unique_recipients: 1 })).toMatch(/^Send this WhatsApp template to 1 person\?/);
  });
});

// ── the hook ────────────────────────────────────────────────────────────────
let api = null;
function Probe() { api = useCRMMasters(); return null; }
let root;
const set = async (fn) => { await act(async () => { await fn(); }); };

beforeEach(async () => {
  broadcastApi.previewByTag.mockReset().mockImplementation(() => ok(PREVIEW));
  broadcastApi.byTag.mockReset().mockImplementation(() => ok({ sent: 3, failed: 0, skipped: 1, total: 5, ...PREVIEW }));
  window.confirm = jest.fn(() => true);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root.render(<Probe />); });
});
afterEach(() => act(() => root.unmount()));

test('picking a tag loads the server preview for the screen', async () => {
  await set(() => api.setCampaignTag('t_gslc'));
  expect(broadcastApi.previewByTag).toHaveBeenCalledWith('t_gslc');
  expect(api.campaignPreview).toEqual(PREVIEW);
  expect(broadcastApi.byTag).not.toHaveBeenCalled();
});

test('send re-checks the preview and the confirm box quotes its exact count', async () => {
  await set(() => api.setCampaignTag('t_gslc'));
  await set(() => api.setCampaignTemplate('tpl1'));
  broadcastApi.previewByTag.mockImplementation(() => ok({ ...PREVIEW, unique_recipients: 4 }));
  await set(() => api.sendCampaign());
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(window.confirm.mock.calls[0][0]).toMatch(/^Send this WhatsApp template to 4 people\?/);
  expect(broadcastApi.byTag).toHaveBeenCalledWith({ tag_id: 't_gslc', template_id: 'tpl1' });
});

test('declining the confirm box sends nothing', async () => {
  window.confirm = jest.fn(() => false);
  await set(() => api.setCampaignTag('t_gslc'));
  await set(() => api.setCampaignTemplate('tpl1'));
  await set(() => api.sendCampaign());
  expect(broadcastApi.byTag).not.toHaveBeenCalled();
});

test('a tag that reaches nobody with a phone never asks and never sends', async () => {
  broadcastApi.previewByTag.mockImplementation(() => ok({ ...PREVIEW, unique_recipients: 0 }));
  await set(() => api.setCampaignTag('t_gslc'));
  await set(() => api.setCampaignTemplate('tpl1'));
  await set(() => api.sendCampaign());
  expect(window.confirm).not.toHaveBeenCalled();
  expect(broadcastApi.byTag).not.toHaveBeenCalled();
});

test('the result toast names every outcome the service reported (sent / queued / not sent / failed)', async () => {
  broadcastApi.byTag.mockImplementation(() => ok({ sent: 1, queued: 2, skipped_policy: 1, failed: 0,
    skipped: 1, total: 5, ...PREVIEW }));
  toast.success.mockClear();
  await set(() => api.setCampaignTag('t_gslc'));
  await set(() => api.setCampaignTemplate('tpl1'));
  await set(() => api.sendCampaign());
  expect(toast.success).toHaveBeenCalledWith('Broadcast: 1 sent, 2 queued for business hours / limits, '
    + '1 not sent (opted out, no consent or not on WhatsApp), 1 deal(s) with no usable phone');
});

test('the reach text says how many people have no WhatsApp consent on record', () => {
  expect(describeBroadcastReach('X', { ...PREVIEW, no_consent: 2 }))
    .toMatch(/ 2 people have no WhatsApp consent on record\.$/);
  expect(describeBroadcastReach('X', PREVIEW)).not.toMatch(/consent/);
});

test('a broadcast that sent nothing warns (all refused) or errors (something failed)', async () => {
  await set(() => api.setCampaignTag('t_gslc'));
  await set(() => api.setCampaignTemplate('tpl1'));
  toast.success.mockClear(); toast.warning.mockClear(); toast.error.mockClear();
  broadcastApi.byTag.mockImplementation(() => ok({ sent: 0, queued: 0, skipped_policy: 3, failed: 0, ...PREVIEW,
    skipped_no_phone: 0 }));
  await set(() => api.sendCampaign());
  expect(toast.warning).toHaveBeenCalledWith(
    'Broadcast: 0 sent, 3 not sent (opted out, no consent or not on WhatsApp)');
  broadcastApi.byTag.mockImplementation(() => ok({ sent: 0, queued: 0, skipped_policy: 0, failed: 2, ...PREVIEW,
    skipped_no_phone: 0 }));
  await set(() => api.sendCampaign());
  expect(toast.error).toHaveBeenCalledWith('Broadcast: 0 sent, 2 failed');
  expect(toast.success).not.toHaveBeenCalled();
});

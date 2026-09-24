// C2/D3: the area "New run" dialog on Offline Mail picks its piece type from
// the shared Materials catalogue. It used to be a hard-coded
// brochure|sample|newsletter|other list, and it always started on 'brochure'.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import OfflineMail from '../OfflineMail';
import { mailAreas, mailRuns, activities, mailMaterials } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../../../components/layouts/AdminLayout', () => ({
  __esModule: true, default: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../../lib/dataSync', () => ({ useDataSync: () => {} }));
// The page's other panels fetch their own data; they are not what is under test.
jest.mock('../../../components/mail/MailAddressSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/mail/ManualMailRunBuilder', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/mail/TodayPostQueue', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/mail/GapReportPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/mail/ToPostQueue', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/mail/MaterialsPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../lib/api', () => ({
  mailAreas: { getAll: jest.fn(), schools: jest.fn(), create: jest.fn(), autoAssign: jest.fn(), delete: jest.fn() },
  mailRuns: { getAll: jest.fn(), analytics: jest.fn(), create: jest.fn(), import: jest.fn(),
              updateStatus: jest.fn(), remove: jest.fn() },
  activities: { hotLeads: jest.fn() },
  mailMaterials: { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() },
}));
jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}));

// Not led by "Brochure", so the default provably follows the catalogue.
const MATERIALS = [
  { material_id: 'mm4', name: 'Kit', piece_type: 'kit', active: true },
  { material_id: 'mm5', name: 'Newsletter', piece_type: 'newsletter', active: true },
];

let container;
let root;

beforeEach(() => {
  mailAreas.getAll.mockResolvedValue({
    data: [{ area_id: 'a1', name: 'Rohini', kind: 'pincode', pincode: '110085', school_count: 2 }] });
  mailAreas.schools.mockResolvedValue({ data: [{ school_id: 's1' }, { school_id: 's2' }] });
  mailRuns.getAll.mockResolvedValue({ data: [] });
  mailRuns.analytics.mockResolvedValue({ data: { runs: [], totals: {} } });
  activities.hotLeads.mockResolvedValue({ data: { leads: [] } });
  mailMaterials.list.mockResolvedValue({ data: MATERIALS });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { if (root) root.unmount(); });
  container.remove();
  root = null;
});

const q = (id) => document.querySelector(`[data-testid="${id}"]`);

async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

async function openNewRunDialog() {
  await act(async () => {
    root = createRoot(container);
    root.render(<OfflineMail />);
    await flush();
  });
  await act(async () => {
    q('offline-mail-tab-runs').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
  });
  await act(async () => {
    q('new-run-a1').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
  });
}

test('the new-run piece picker lists the catalogue', async () => {
  await openNewRunDialog();
  const opts = Array.from(q('run-piece-type').querySelectorAll('option')).map(o => o.value);
  expect(opts).toEqual(['kit', 'newsletter']);
});

test('a new run starts on the first ACTIVE material, not a hard-coded brochure', async () => {
  await openNewRunDialog();
  expect(q('run-piece-type').value).toBe('kit');
});

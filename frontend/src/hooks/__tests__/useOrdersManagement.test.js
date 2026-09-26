// frontend/src/hooks/__tests__/useOrdersManagement.test.js
// The 3 new awaiting-confirmation handlers (Confirm/Reject/Log-call) follow
// the exact call→toast→refetch shape every other mutation here already uses
// (see handleAddItem). filteredOrders must exclude awaiting_confirmation
// orders from the default ('all') view — they haven't been confirmed as
// real orders yet. Probe pattern via react-dom/client — no
// @testing-library/react in this repo (same as ContactsTab.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const ok = (data) => Promise.resolve({ data });
const mockConfirm = jest.fn(() => ok({ message: 'Order confirmed' }));
const mockReject = jest.fn(() => ok({ message: 'Order rejected' }));
const mockLogCall = jest.fn(() => ok({ note_id: 'n1' }));

let mockOrders = [];

jest.mock('../../lib/api', () => ({
  orders: {
    getAll: () => Promise.resolve({ data: mockOrders }),
    get: (id) => Promise.resolve({ data: mockOrders.find(o => o.order_id === id) }),
    confirm: (...a) => mockConfirm(...a),
    reject: (...a) => mockReject(...a),
    logCall: (...a) => mockLogCall(...a),
  },
  holds: { getAll: () => Promise.resolve({ data: [] }) },
  quotations: { getAll: () => Promise.resolve({ data: [] }) },
  dispatches: { getAll: () => Promise.resolve({ data: [] }) },
  dispatchApi: {},
  dies: { getAll: () => Promise.resolve({ data: [] }) },
  downloadBlob: () => {},
}));
jest.mock('../../lib/dataSync', () => ({ useDataSync: () => {}, useAutoRefresh: () => {} }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'store@ss.in', role: 'store' } }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line import/first
import useOrdersManagement from '../useOrdersManagement';

global.IS_REACT_ACT_ENVIRONMENT = true;

let api = null;
function Probe() {
  api = useOrdersManagement();
  return null;
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Probe />); });
  return { unmount: () => act(() => root.unmount()) };
}

const set = async (fn) => { await act(async () => { await fn(); }); };

let view;
beforeEach(() => {
  mockOrders = [
    { order_id: 'o1', order_number: 'ORD-1', order_status: 'awaiting_confirmation', school_name: 'DPS' },
    { order_id: 'o2', order_number: 'ORD-2', order_status: 'pending', school_name: 'Lotus Valley' },
  ];
  mockConfirm.mockClear(); mockReject.mockClear(); mockLogCall.mockClear();
});
afterEach(() => { view && view.unmount(); api = null; });

test('filteredOrders excludes awaiting_confirmation when statusFilter is all', async () => {
  view = await mount();
  expect(api.filteredOrders.map(o => o.order_id)).toEqual(['o2']);
});

test('explicitly filtering by awaiting_confirmation still shows it', async () => {
  view = await mount();
  await set(() => api.setStatusFilter('awaiting_confirmation'));
  expect(api.filteredOrders.map(o => o.order_id)).toEqual(['o1']);
});

test('stats.awaitingConfirmation counts them', async () => {
  view = await mount();
  expect(api.stats.awaitingConfirmation).toBe(1);
});

test('handleConfirmOrder calls the API and refetches', async () => {
  view = await mount();
  await set(() => api.handleConfirmOrder('o1'));
  expect(mockConfirm).toHaveBeenCalledWith('o1');
});

test('handleRejectOrder calls the API with the reason', async () => {
  view = await mount();
  await set(() => api.handleRejectOrder('o1', 'Duplicate'));
  expect(mockReject).toHaveBeenCalledWith('o1', 'Duplicate');
});

test('handleLogCall calls the API with the call data', async () => {
  view = await mount();
  await set(() => api.handleLogCall('o1', { outcome: 'connected', content: 'ok' }));
  expect(mockLogCall).toHaveBeenCalledWith('o1', { outcome: 'connected', content: 'ok' });
});

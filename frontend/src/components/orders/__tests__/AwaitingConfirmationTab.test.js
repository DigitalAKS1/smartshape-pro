// frontend/src/components/orders/__tests__/AwaitingConfirmationTab.test.js
// Row actions (Confirm / Reject / Log a call / View-Edit) and the two local
// dialogs (Reject needs a reason, Log-call needs an outcome). No
// @testing-library/react in this repo — react-dom/client + act(), same
// pattern as ContactsTab.test.js / useBulkSelect.test.js.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import AwaitingConfirmationTab from '../AwaitingConfirmationTab';

global.IS_REACT_ACT_ENVIRONMENT = true;

// The real Dialog portals to document.body (outside this test's mount
// container) and traps focus; the tab's own content is what matters here,
// so it is rendered inline — same pattern as NeedsAttentionPanel.test.js.
jest.mock('../../ui/dialog', () => ({
  Dialog: ({ open, children }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
  DialogFooter: ({ children }) => <div>{children}</div>,
}));

const STYLES = { textPri: 'p', textSec: 's', textMuted: 'm', inputCls: 'i', card: 'c', dlgCls: 'd' };
const ORDERS = [
  { order_id: 'o1', order_number: 'ORD-1', school_name: 'DPS', total_items: 2, grand_total: 5000, created_at: '2026-09-25T00:00:00Z' },
];

let root, container;
let onConfirm, onReject, onLogCall, onOpenDetail;

async function mount(orders = ORDERS) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onConfirm = jest.fn();
  onReject = jest.fn();
  onLogCall = jest.fn();
  onOpenDetail = jest.fn();
  await act(async () => {
    root.render(
      <AwaitingConfirmationTab
        orders={orders}
        onConfirm={onConfirm} onReject={onReject} onLogCall={onLogCall} onOpenDetail={onOpenDetail}
        {...STYLES}
      />
    );
  });
}

const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const setValue = async (el, value) => {
  await act(async () => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

afterEach(() => { act(() => root.unmount()); document.body.removeChild(container); });

test('renders one row per order with its number and school', async () => {
  await mount();
  expect(container.querySelector('[data-testid="awaiting-order-ORD-1"]')).toBeTruthy();
  expect(container.textContent).toContain('DPS');
});

test('an empty list shows an empty state instead of a blank page', async () => {
  await mount([]);
  expect(container.textContent.toLowerCase()).toContain('no orders');
});

test('clicking Confirm calls onConfirm with the order id', async () => {
  await mount();
  await click(container.querySelector('[data-testid="confirm-order-ORD-1"]'));
  expect(onConfirm).toHaveBeenCalledWith('o1');
});

test('clicking View/Edit calls onOpenDetail with the order', async () => {
  await mount();
  await click(container.querySelector('[data-testid="edit-order-ORD-1"]'));
  expect(onOpenDetail).toHaveBeenCalledWith(ORDERS[0]);
});

test('Reject requires a reason before it will submit', async () => {
  await mount();
  await click(container.querySelector('[data-testid="reject-order-ORD-1"]'));
  await click(container.querySelector('[data-testid="reject-submit"]'));
  expect(onReject).not.toHaveBeenCalled();
  expect(container.textContent.toLowerCase()).toContain('reason');
});

test('Reject submits the typed reason', async () => {
  await mount();
  await click(container.querySelector('[data-testid="reject-order-ORD-1"]'));
  await setValue(container.querySelector('[data-testid="reject-reason-input"]'), 'Duplicate submission');
  await click(container.querySelector('[data-testid="reject-submit"]'));
  expect(onReject).toHaveBeenCalledWith('o1', 'Duplicate submission');
});

test('Log a call submits the chosen outcome and note', async () => {
  await mount();
  await click(container.querySelector('[data-testid="call-order-ORD-1"]'));
  await setValue(container.querySelector('[data-testid="call-outcome-select"]'), 'connected');
  await setValue(container.querySelector('[data-testid="call-content-input"]'), 'Will confirm 20 units');
  await click(container.querySelector('[data-testid="call-submit"]'));
  expect(onLogCall).toHaveBeenCalledWith('o1', { outcome: 'connected', content: 'Will confirm 20 units' });
});

// Rendered into jsdom via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import NeedsAttentionPanel from '../NeedsAttentionPanel';

global.IS_REACT_ACT_ENVIRONMENT = true;

// The real Dialog portals and traps focus; the panel's own content is what
// matters here, so it is rendered inline.
jest.mock('../../ui/dialog', () => ({
  Dialog: ({ open, children }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
}));

const ROWS = [
  { lead_id: 'l1', company_name: 'Delhi Public School', contact_name: 'R Sharma',
    stage: 'negotiation', deal_value: 100000, expected_value: 60000, fit_rate: 60,
    days_silent: 21, reasons: ['stuck', 'no_next_action'] },
  { lead_id: 'l2', company_name: 'Lotus Valley', stage: 'demo',
    deal_value: 50000, expected_value: 50000, fit_rate: null,
    days_silent: 3, reasons: ['overdue'] },
];

function mount(props = {}) {
  const onPick = jest.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<NeedsAttentionPanel open onOpenChange={jest.fn()} rows={ROWS} onPick={onPick} {...props} />);
  });
  return {
    onPick,
    container,
    text: () => container.textContent,
    q: (id) => container.querySelector(`[data-testid="${id}"]`),
    click: (id) => act(() => { container.querySelector(`[data-testid="${id}"]`).click(); }),
    unmount: () => act(() => root.unmount()),
  };
}

test('lists the deals in the order the server ranked them', () => {
  const v = mount();
  const ids = Array.from(v.container.querySelectorAll('[data-testid^="attention-row-"]'))
    .map(el => el.getAttribute('data-testid'));
  expect(ids).toEqual(['attention-row-l1', 'attention-row-l2']);
  v.unmount();
});

test('says why each deal is on the list, not just that it is', () => {
  const v = mount();
  expect(v.text()).toContain('Stuck in this stage');
  expect(v.text()).toContain('No next step');
  expect(v.text()).toContain('Follow-up overdue');
  v.unmount();
});

test('accounts for its own ranking where there is evidence', () => {
  const v = mount();
  expect(v.q('attention-why-l1').textContent).toContain('60% of comparable schools buy');
  v.unmount();
});

test('admits when it ranked on value alone', () => {
  const v = mount();
  expect(v.q('attention-why-l2').textContent).toMatch(/not enough comparable schools/i);
  v.unmount();
});

test('shows the real deal value, not the discounted one', () => {
  const v = mount();
  expect(v.q('attention-row-l1').textContent).toContain('1,00,000');
  v.unmount();
});

test('how long it has been silent is on the row', () => {
  const v = mount();
  expect(v.q('attention-row-l1').textContent).toContain('silent 21 days');
  v.unmount();
});

test('picking a deal hands it back so the lead can be opened', () => {
  const v = mount();
  v.click('attention-row-l2');
  expect(v.onPick).toHaveBeenCalledWith(ROWS[1]);
  v.unmount();
});

test('an empty list is good news, and says so', () => {
  const v = mount({ rows: [] });
  expect(v.q('attention-empty')).toBeTruthy();
  expect(v.text()).toMatch(/Nothing is overdue/);
  v.unmount();
});

test('closed, it renders nothing at all', () => {
  const v = mount({ open: false });
  expect(v.q('attention-list')).toBeNull();
  v.unmount();
});

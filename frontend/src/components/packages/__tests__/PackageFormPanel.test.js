// Smoke test: the package form renders a Machine Category select and
// reports changes via setForm, same pattern as the GST/description fields.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import PackageFormPanel from '../PackageFormPanel';
import { DEFAULT_FORM } from '../../../hooks/usePackageMaster';

global.IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, unmount: () => act(() => root.unmount()) };
}

afterEach(() => { document.body.innerHTML = ''; });

test('renders Machine Category select and reports changes', () => {
  const setForm = jest.fn();
  const form = { ...DEFAULT_FORM, display_name: 'Small Machine Package', items: [{ type: 'machine', name: 'Machine', qty: 1, unit_price: 10000, gst_pct: 18 }] };
  const { unmount } = mount(
    <PackageFormPanel
      editPkg={null} form={form} setForm={setForm} nameInputRef={{ current: null }}
      saving={false} onSave={jest.fn()} onDiscard={jest.fn()} onRequestDelete={jest.fn()}
      addItem={jest.fn()} removeItem={jest.fn()} updateItem={jest.fn()}
      summary={{ subtotal: 10000, gst: 1800, total: 11800 }}
      textPri="" textSec="" textMuted="" borderCls="" card="" inputCls="" bg=""
    />
  );
  const select = document.querySelector('[data-testid="pkg-machine-category-select"]');
  expect(select.value).toBe('');
  act(() => {
    select.value = 'small_machine';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(setForm).toHaveBeenCalled();
  unmount();
});

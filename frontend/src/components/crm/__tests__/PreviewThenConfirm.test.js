// Smoke tests for the shared preview -> type-to-confirm -> real-run widget
// used across the CRM Data Health panel's merge/phone/link-repair actions.
// Rendered directly into jsdom via react-dom/client (no @testing-library/react
// in this repo's node_modules — see package.json).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import PreviewThenConfirm from '../PreviewThenConfirm';

global.IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function mount(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, unmount: () => act(() => root.unmount()) };
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

afterEach(() => { document.body.innerHTML = ''; });

test('there is no confirm affordance at all before Preview is clicked', () => {
  const { container, unmount } = mount(
    <PreviewThenConfirm runDryRun={jest.fn()} runConfirm={jest.fn()} renderPreview={() => <p>preview</p>} confirmWord="CONFIRM" />
  );
  expect(container.querySelector('[data-testid="preview-confirm-word-input"]')).toBeFalsy();
  expect(container.querySelector('[data-testid="preview-confirm-run-btn"]')).toBeFalsy();
  unmount();
});

test('confirm button appears disabled once the dry-run loads, and stays disabled until the word is typed exactly', async () => {
  const runDryRun = jest.fn(() => Promise.resolve({ data: { would_change: 5 } }));
  const { container, unmount } = mount(
    <PreviewThenConfirm runDryRun={runDryRun} runConfirm={jest.fn()} renderPreview={(p) => <p data-testid="pv">{p.would_change} rows</p>} confirmWord="CONFIRM" />
  );
  act(() => container.querySelector('[data-testid="preview-confirm-preview-btn"]').click());
  await flush();
  expect(container.querySelector('[data-testid="pv"]').textContent).toBe('5 rows');
  const runBtn = container.querySelector('[data-testid="preview-confirm-run-btn"]');
  expect(runBtn.disabled).toBe(true);

  const input = container.querySelector('[data-testid="preview-confirm-word-input"]');
  act(() => setInputValue(input, 'confirm')); // wrong case
  expect(container.querySelector('[data-testid="preview-confirm-run-btn"]').disabled).toBe(true);

  act(() => setInputValue(input, 'CONFIRM'));
  expect(container.querySelector('[data-testid="preview-confirm-run-btn"]').disabled).toBe(false);
  unmount();
});

test('runConfirm is never called before runDryRun resolves', async () => {
  const runDryRun = jest.fn(() => Promise.resolve({ data: {} }));
  const runConfirm = jest.fn(() => Promise.resolve({ data: { ok: true } }));
  const { unmount } = mount(
    <PreviewThenConfirm runDryRun={runDryRun} runConfirm={runConfirm} renderPreview={() => <p>x</p>} confirmWord="CONFIRM" />
  );
  expect(runConfirm).not.toHaveBeenCalled();
  await flush();
  expect(runConfirm).not.toHaveBeenCalled(); // no preview() click happened yet
  unmount();
});

test('clicking Confirm & run after typing the word calls runConfirm(preview, reason) and renders the result', async () => {
  const runDryRun = jest.fn(() => Promise.resolve({ data: { would_change: 2 } }));
  const runConfirm = jest.fn(() => Promise.resolve({ data: { changed: 2, backup_id: 'bk1' } }));
  const onDone = jest.fn();
  const { container, unmount } = mount(
    <PreviewThenConfirm
      runDryRun={runDryRun} runConfirm={runConfirm}
      renderPreview={(p) => <p>{p.would_change}</p>}
      renderResult={(r) => <p data-testid="result-text">{r.changed} changed, backup {r.backup_id}</p>}
      confirmWord="CONFIRM" onDone={onDone}
    />
  );
  act(() => container.querySelector('[data-testid="preview-confirm-preview-btn"]').click());
  await flush();
  act(() => setInputValue(container.querySelector('[data-testid="preview-confirm-word-input"]'), 'CONFIRM'));
  await act(async () => {
    container.querySelector('[data-testid="preview-confirm-run-btn"]').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  expect(runConfirm).toHaveBeenCalledWith({ would_change: 2 }, '');
  expect(container.querySelector('[data-testid="result-text"]').textContent).toBe('2 changed, backup bk1');
  expect(onDone).toHaveBeenCalledWith({ changed: 2, backup_id: 'bk1' });
  unmount();
});

test('disablePreview keeps the Preview button disabled and shows the reason', () => {
  const { container, unmount } = mount(
    <PreviewThenConfirm runDryRun={jest.fn()} runConfirm={jest.fn()} renderPreview={() => null}
      disablePreview disabledReason="Pick a survivor first" />
  );
  const btn = container.querySelector('[data-testid="preview-confirm-preview-btn"]');
  expect(btn.disabled).toBe(true);
  expect(container.textContent).toContain('Pick a survivor first');
  unmount();
});

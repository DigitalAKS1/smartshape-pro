// Smoke tests: the Die create/edit forms render a Machine Category select
// and report changes via setNewDie/setEditForm, same pattern as the
// existing die-size/category selects.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CreateDieDialog, EditDieDialog } from '../DieFormDialog';
import { BLANK_DIE } from '../../../hooks/useInventory';

global.IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, unmount: () => act(() => root.unmount()) };
}

afterEach(() => { document.body.innerHTML = ''; });

test('create form defaults Machine Category to General and reports the change', () => {
  const setNewDie = jest.fn();
  const { unmount } = mount(
    <CreateDieDialog
      open onOpenChange={jest.fn()}
      newDie={BLANK_DIE} setNewDie={setNewDie}
      newDieImagePreview="" handleNewImageSelect={jest.fn()}
      handleCreateDie={jest.fn()} saving={false}
      inputCls="" textPri="" textSec="" textMuted="" dlgCls=""
    />
  );
  const select = document.querySelector('[data-testid="die-machine-category-select"]');
  expect(select.value).toBe('');
  act(() => {
    select.value = 'small_machine';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(setNewDie).toHaveBeenCalledWith({ ...BLANK_DIE, machine_category: 'small_machine' });
  unmount();
});

test('edit form shows the die\'s current Machine Category', () => {
  const setEditForm = jest.fn();
  const editForm = { ...BLANK_DIE, machine_category: 'small_machine' };
  const { unmount } = mount(
    <EditDieDialog
      open onOpenChange={jest.fn()}
      editTarget={{ die_id: 'die_1' }} editForm={editForm} setEditForm={setEditForm}
      handleSaveEdit={jest.fn()} saving={false}
      inputCls="" textPri="" textSec="" textMuted="" dlgCls=""
    />
  );
  const select = document.querySelector('[data-testid="die-machine-category-select"]');
  expect(select.value).toBe('small_machine');
  unmount();
});

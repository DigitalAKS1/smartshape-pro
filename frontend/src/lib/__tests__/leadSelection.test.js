// Pure lead-selection helpers behind the Leads bulk bar. They give the shared
// `selectedLeadIds` Set the same semantics useBulkSelect gives Contacts.
import {
  splitSelection, allVisibleSelected, toggleAllVisible, toggleWithRange, pruneSelection, BULK_ID_CAP,
} from '../leadSelection';

const S = (...ids) => new Set(ids);

describe('splitSelection', () => {
  test('visible = selected ids in the list, in list order; the rest are hidden', () => {
    const out = splitSelection(S('c', 'x', 'a'), ['a', 'b', 'c'], ['a', 'b', 'c', 'x']);
    expect(out).toEqual({ visible: ['a', 'c'], hiddenCount: 1, total: 3 });
  });

  test('ids missing from allIds are gone, not hidden, and are left out of the total', () => {
    const out = splitSelection(S('a', 'gone'), ['a', 'b'], ['a', 'b']);
    expect(out).toEqual({ visible: ['a'], hiddenCount: 0, total: 1 });
  });

  test('without allIds every non-visible selection counts as hidden', () => {
    expect(splitSelection(S('a', 'z'), ['a'])).toEqual({ visible: ['a'], hiddenCount: 1, total: 2 });
  });

  test('empty selection', () => {
    expect(splitSelection(new Set(), ['a'], ['a'])).toEqual({ visible: [], hiddenCount: 0, total: 0 });
  });
});

describe('header checkbox', () => {
  test('allVisibleSelected needs at least one visible row, all selected', () => {
    expect(allVisibleSelected(S('a', 'b'), ['a', 'b'])).toBe(true);
    expect(allVisibleSelected(S('a'), ['a', 'b'])).toBe(false);
    expect(allVisibleSelected(S('a'), [])).toBe(false);
  });

  test('ticking unions the visible ids in, keeping hidden selections', () => {
    expect(toggleAllVisible(S('hidden'), ['a', 'b'])).toEqual(S('hidden', 'a', 'b'));
  });

  test('unticking removes ONLY the visible ids, never the hidden ones', () => {
    // The old handler did setSelectedLeadIds(new Set()) and wiped `hidden`.
    expect(toggleAllVisible(S('hidden', 'a', 'b'), ['a', 'b'])).toEqual(S('hidden'));
  });

  test('does not mutate its input', () => {
    const prev = S('a');
    toggleAllVisible(prev, ['a', 'b']);
    expect(prev).toEqual(S('a'));
  });
});

describe('toggleWithRange', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  test('a plain click flips one id', () => {
    expect(toggleWithRange(S(), 'b')).toEqual(S('b'));
    expect(toggleWithRange(S('b'), 'b')).toEqual(S());
  });

  test('shift-click adds every id between the anchor and the click, in list order', () => {
    expect(toggleWithRange(S('b'), 'd', { shift: true, orderedIds: order, anchorId: 'b' }))
      .toEqual(S('b', 'c', 'd'));
    // Works backwards too.
    expect(toggleWithRange(S(), 'a', { shift: true, orderedIds: order, anchorId: 'c' }))
      .toEqual(S('a', 'b', 'c'));
  });

  test('shift-click with no anchor, or an anchor outside the list, is a plain flip', () => {
    expect(toggleWithRange(S(), 'c', { shift: true, orderedIds: order, anchorId: null })).toEqual(S('c'));
    expect(toggleWithRange(S(), 'c', { shift: true, orderedIds: order, anchorId: 'zz' })).toEqual(S('c'));
  });
});

describe('pruneSelection', () => {
  test('drops ids that no longer exist', () => {
    expect(pruneSelection(S('a', 'gone'), ['a', 'b'])).toEqual(S('a'));
  });

  test('returns the SAME Set when nothing was pruned, so a setState updater bails out', () => {
    const prev = S('a', 'b');
    expect(pruneSelection(prev, new Set(['a', 'b', 'c']))).toBe(prev);
  });
});

test('the cap matches the backend', () => {
  expect(BULK_ID_CAP).toBe(2000);
});

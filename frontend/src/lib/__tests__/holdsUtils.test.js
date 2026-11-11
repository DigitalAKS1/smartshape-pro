import { groupHoldsBySchool, groupHoldsByItem } from '../holdsUtils';

test('groups by school with totals, sorted by qty desc', () => {
  const holds = [
    { school_name: 'Alpha', quantity: 2, short: 0 },
    { school_name: 'Beta', quantity: 10, short: 3 },
    { school_name: 'Alpha', quantity: 4, short: 1 },
  ];
  const out = groupHoldsBySchool(holds);
  expect(out.map(g => g.school_name)).toEqual(['Beta', 'Alpha']);
  const alpha = out.find(g => g.school_name === 'Alpha');
  expect(alpha.items.length).toBe(2);
  expect(alpha.totalQty).toBe(6);
  expect(alpha.shortCount).toBe(1);
});

test('missing school becomes dash', () => {
  expect(groupHoldsBySchool([{ quantity: 1 }])[0].school_name).toBe('—');
});

test('empty', () => {
  expect(groupHoldsBySchool([])).toEqual([]);
});

test('groupHoldsByItem aggregates per die with short + suggestedQty', () => {
  const holds = [
    { die_id: 'd1', die_name: 'Star', die_code: 'S1', quantity: 3, school_name: 'A', order_number: 'O1', stock_qty: 2, reserved_qty: 11 },
    { die_id: 'd1', die_name: 'Star', die_code: 'S1', quantity: 4, school_name: 'B', order_number: 'O2', stock_qty: 2, reserved_qty: 11 },
    { die_id: 'd2', die_name: 'Heart', die_code: 'H1', quantity: 2, school_name: 'A', order_number: 'O1', stock_qty: 10, reserved_qty: 5 },
  ];
  const out = groupHoldsByItem(holds);
  expect(out[0].die_id).toBe('d1'); // most short first
  const d1 = out.find(i => i.die_id === 'd1');
  expect(d1.totalQty).toBe(7);
  expect(d1.schoolCount).toBe(2);
  expect(d1.short).toBe(9);        // reserved 11 - stock 2
  expect(d1.suggestedQty).toBe(9); // shortfall seeds the order qty
  const d2 = out.find(i => i.die_id === 'd2');
  expect(d2.short).toBe(0);
  expect(d2.suggestedQty).toBe(2); // no shortfall → total held
});

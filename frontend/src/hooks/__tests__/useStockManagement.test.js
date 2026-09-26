import { groupDiesByMachineCategory } from '../useStockManagement';

const die = (over) => ({
  die_id: 'd1', code: 'D1', name: 'Die 1',
  stock_qty: 10, reserved_qty: 0, min_level: 5,
  ...over,
});

test('groups dies by machine_category, general bucket for missing category', () => {
  const dies = [
    die({ die_id: 'd1', machine_category: 'small_machine', stock_qty: 10, reserved_qty: 0 }),
    die({ die_id: 'd2' }), // no machine_category at all
  ];
  const groups = groupDiesByMachineCategory(dies);
  expect(groups.small_machine.dieCount).toBe(1);
  expect(groups.general.dieCount).toBe(1);
});

test('a blank string machine_category is treated the same as missing (Review Focus #5)', () => {
  const dies = [die({ die_id: 'd3', machine_category: '' })];
  const groups = groupDiesByMachineCategory(dies);
  expect(groups.general.dieCount).toBe(1);
  expect(groups['']).toBeUndefined();
});

test('flags a die as low stock when available stock <= min_level', () => {
  const dies = [
    die({ die_id: 'd4', machine_category: 'small_machine', stock_qty: 5, reserved_qty: 4, min_level: 2 }), // available 1 <= 2
    die({ die_id: 'd5', machine_category: 'small_machine', stock_qty: 20, reserved_qty: 0, min_level: 2 }), // available 20 > 2
  ];
  const groups = groupDiesByMachineCategory(dies);
  const lowStockIds = groups.small_machine.lowStock.map(d => d.die_id);
  expect(lowStockIds).toEqual(['d4']);
});

import { varianceInfo, signedQty, signedQtyLabel } from '../stockMath';

test('counted higher than system → up', () => {
  expect(varianceInfo(10, 14)).toEqual({ variance: 4, direction: 'up' });
});

test('counted lower than system → down', () => {
  expect(varianceInfo(10, 7)).toEqual({ variance: -3, direction: 'down' });
});

test('equal → same', () => {
  expect(varianceInfo(10, 10)).toEqual({ variance: 0, direction: 'same' });
});

test('handles missing values as zero', () => {
  expect(varianceInfo(undefined, 5)).toEqual({ variance: 5, direction: 'up' });
});

test('signedQty: returns are positive, out is negative', () => {
  expect(signedQty('returnable_in', 8)).toBe(8);
  expect(signedQty('returned_from_sales', 3)).toBe(3);
  expect(signedQty('stock_out', 4)).toBe(-4);
  expect(signedQty('allocated_to_sales', 2)).toBe(-2);
  expect(signedQty('physical_adjustment', 5)).toBe(5);
});

test('signedQtyLabel formats sign', () => {
  expect(signedQtyLabel('returnable_in', 8)).toBe('+8');
  expect(signedQtyLabel('stock_out', 4)).toBe('-4');
  expect(signedQtyLabel('physical_adjustment', 5)).toBe('5');
});

import { labelFor, FALLBACKS } from '../lookupUtils';

describe('lookupUtils.labelFor', () => {
  test('labelFor keeps inactive labels', () => {
    const items = [{ value: 'flowers', name: 'Flowers', is_active: false }];
    expect(labelFor(items, 'flowers')).toBe('Flowers');
  });

  test('labelFor falls back to title case', () => {
    expect(labelFor([], 'giant_flowers')).toBe('Giant Flowers');
  });

  test('labelFor matches name for name-stored lists', () => {
    const items = [{ value: 'k_12_school', name: 'K-12 School' }];
    expect(labelFor(items, 'K-12 School')).toBe('K-12 School');
  });

  test('labelFor of blank is blank', () => {
    expect(labelFor([], '')).toBe('');
    expect(labelFor([], null)).toBe('');
  });
});

describe('lookupUtils.FALLBACKS', () => {
  test('school_category seed order', () => {
    expect(FALLBACKS.school_category.map(i => i.name))
      .toEqual(['Pre School', 'K-12 School', 'Franchise', 'Navodaya', 'Independent']);
  });
  test('product_category has the 14 legacy slugs', () => {
    expect(FALLBACKS.product_category).toHaveLength(14);
    expect(FALLBACKS.product_category.find(i => i.value === '3d_flowers').name).toBe('3D Flowers');
  });
  test('package_type seeds', () => {
    expect(FALLBACKS.package_type.map(i => i.name))
      .toEqual(['Machine + Dies Combo', 'Dies Only', 'Machine Only', 'Accessories']);
  });
});

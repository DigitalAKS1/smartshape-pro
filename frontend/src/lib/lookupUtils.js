// Shared helpers for the generic lookup masters (/api/lookups).
// FALLBACKS mirror the backend seeds so pickers work before the master loads.

const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const fromNames = (...names) => names.map(name => ({ value: slug(name), name, is_active: true }));

export const FALLBACKS = {
  school_category: fromNames('Pre School', 'K-12 School', 'Franchise', 'Navodaya', 'Independent'),
  product_category: [
    ['decorative', 'Decorative'], ['flowers', 'Flowers'], ['leaf', 'Leaf'], ['alphabets', 'Alphabets'],
    ['numbers', 'Numbers'], ['butterfly', 'Butterfly'], ['borders', 'Borders'],
    ['giant_flowers', 'Giant Flowers'], ['3d_flowers', '3D Flowers'], ['animals_birds', 'Animals & Birds'],
    ['snowflake', 'Snowflake'], ['fruits', 'Fruits'], ['shapes', 'Shapes'], ['other', 'Other'],
  ].map(([value, name]) => ({ value, name, is_active: true })),
  package_type: fromNames('Machine + Dies Combo', 'Dies Only', 'Machine Only', 'Accessories'),
};

// Which field a record stores for each list — mirrors backend LOOKUP_LISTS.stores.
export const STORES = { school_category: 'name', product_category: 'value', package_type: 'name' };

export const storedOf = (listKey, item) => (STORES[listKey] === 'value' ? item.value : item.name);

/** Display label for a stored value. Inactive rows still label existing records. */
export function labelFor(items, stored) {
  if (stored == null || stored === '') return '';
  const s = String(stored);
  const hit = (items || []).find(i => i.value === s) || (items || []).find(i => i.name === s);
  if (hit) return hit.name;
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

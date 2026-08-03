import { defaultScopeForRoles } from '../moduleScope';

// These cases are the JS mirror of backend/rbac.py `module_scope`'s fallback:
//   admin                      -> "all" (short-circuits before the fallback)
//   get_teams(user) == {sales} -> "own"
//   anything else              -> "all"

test('a sales-only user defaults to own records, not all', () => {
  expect(defaultScopeForRoles(['sales_person'])).toBe('own');
});

test('a non-sales single role defaults to all records', () => {
  expect(defaultScopeForRoles(['store'])).toBe('all');
  expect(defaultScopeForRoles(['accounts'])).toBe('all');
});

test('admin defaults to all records', () => {
  expect(defaultScopeForRoles(['admin'])).toBe('all');
});

test('sales plus any other team is no longer sales-only, so defaults to all', () => {
  expect(defaultScopeForRoles(['sales_person', 'store'])).toBe('all');
  expect(defaultScopeForRoles(['accounts', 'sales_person'])).toBe('all');
});

test('duplicates do not change the answer', () => {
  expect(defaultScopeForRoles(['sales_person', 'sales_person'])).toBe('own');
});

test('unknown roles are dropped, mirroring rbac.get_roles', () => {
  expect(defaultScopeForRoles(['sales_person', 'wizard'])).toBe('own');
  expect(defaultScopeForRoles(['store', 'wizard'])).toBe('all');
});

test('missing/empty roles fall back to sales_person, mirroring rbac.get_roles', () => {
  expect(defaultScopeForRoles([])).toBe('own');
  expect(defaultScopeForRoles(undefined)).toBe('own');
  expect(defaultScopeForRoles(null)).toBe('own');
  expect(defaultScopeForRoles(['wizard'])).toBe('own');
});

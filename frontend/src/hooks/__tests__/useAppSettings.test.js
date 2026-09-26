// `?tab=` deep links into App Settings: only a tab this user can see opens; anything else
// falls back to the default tab.
import { resolveTab, DEFAULT_TAB } from '../useAppSettings';

jest.mock('../../lib/api', () => ({}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const TABS = ['company', 'overview', 'email', 'whatsapp', 'security'];

test('a known tab opens', () => {
  expect(resolveTab('whatsapp', TABS)).toBe('whatsapp');
});

test('an unknown, empty or not-allowed tab falls back to the default', () => {
  expect(DEFAULT_TAB).toBe('company');
  expect(resolveTab('nonsense', TABS)).toBe('company');
  expect(resolveTab('', TABS)).toBe('company');
  expect(resolveTab(null, TABS)).toBe('company');
  expect(resolveTab('deleted', TABS)).toBe('company');          // owner-only, not in this user's list
});

test('without the default in the list, the first visible tab', () => {
  expect(resolveTab('nonsense', ['overview', 'email'])).toBe('overview');
});

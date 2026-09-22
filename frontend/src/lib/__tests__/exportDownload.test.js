/**
 * exportData.download must never write a non-CSV body to disk.
 *
 * The old implementation did `fetch(...).then(res => res.blob())` with no
 * `res.ok` check, so a 401 "Not authenticated" or a 500 stack trace was saved
 * as `contacts_export.csv`. The rep then opened a one-line nonsense file in
 * Excel, edited it, re-uploaded it — and reported that "the export is broken",
 * which it was, just not where anyone was looking.
 */
import { toast } from 'sonner';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const { exportData } = require('../api');

function mockAnchor() {
  const a = { href: '', download: '', click: jest.fn() };
  jest.spyOn(document, 'createElement').mockReturnValue(a);
  jest.spyOn(document.body, 'appendChild').mockImplementation(() => a);
  jest.spyOn(document.body, 'removeChild').mockImplementation(() => a);
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.URL.createObjectURL = jest.fn(() => 'blob:fake');
  global.URL.revokeObjectURL = jest.fn();
});

afterEach(() => jest.restoreAllMocks());

test('a successful export is downloaded', async () => {
  const a = mockAnchor();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200,
    blob: async () => new Blob(['contact_id,name\n'], { type: 'text/csv' }),
  });

  await expect(exportData.download('contacts')).resolves.toBe(true);
  expect(a.click).toHaveBeenCalledTimes(1);
  expect(a.download).toBe('contacts_export.csv');
  expect(toast.error).not.toHaveBeenCalled();
});

test('a 403 is toasted with the server reason and nothing is saved', async () => {
  const a = mockAnchor();
  const blob = jest.fn();
  global.fetch = jest.fn().mockResolvedValue({
    ok: false, status: 403, blob,
    text: async () => JSON.stringify({ detail: 'CRM access required' }),
  });

  await expect(exportData.download('contacts')).resolves.toBe(false);
  expect(a.click).not.toHaveBeenCalled();
  expect(blob).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith('CRM access required');
});

test('a 401 with a non-JSON body still refuses to write a file', async () => {
  const a = mockAnchor();
  global.fetch = jest.fn().mockResolvedValue({
    ok: false, status: 401, text: async () => 'Not authenticated',
  });

  await expect(exportData.download('contacts')).resolves.toBe(false);
  expect(a.click).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(
    expect.stringContaining('401'));
});

test('a network failure is reported, not swallowed', async () => {
  const a = mockAnchor();
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

  await expect(exportData.download('contacts')).resolves.toBe(false);
  expect(a.click).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});

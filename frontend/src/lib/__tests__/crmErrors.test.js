import { crmSaveError, contactSaveError, schoolSaveError } from '../crmErrors';

const resp = (status, data) => ({ response: { status, data } });

test('the server detail wins — it names the actual owner to go and ask', () => {
  const err = resp(403, {
    detail: 'This contact is assigned to Parul Kanchan (parul@smartshape.in) — '
          + 'ask an admin to reassign it to you before editing.',
  });
  expect(contactSaveError(err)).toContain('Parul Kanchan');
});

test('a bare 403 still says what to do, never just "Failed"', () => {
  const msg = contactSaveError(resp(403, {}));
  expect(msg).toMatch(/ask an admin/i);
  expect(msg).not.toBe('Failed');
});

test('the fallback is worded for the right kind of record', () => {
  expect(schoolSaveError(resp(403, {}))).toMatch(/school/i);
  expect(crmSaveError(resp(403, {}), 'lead')).toMatch(/lead/i);
});

test('a blank or whitespace detail does not leak through as the message', () => {
  expect(contactSaveError(resp(403, { detail: '   ' }))).toMatch(/ask an admin/i);
});

test('404 and 409 get their own instructions', () => {
  expect(contactSaveError(resp(404, {}))).toMatch(/no longer exists/i);
  expect(contactSaveError(resp(409, {}))).toMatch(/refresh/i);
});

test('a network error (no response at all) is reported as one', () => {
  expect(contactSaveError(new TypeError('Network Error'))).toMatch(/could not reach/i);
});

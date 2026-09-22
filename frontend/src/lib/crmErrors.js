/**
 * Turning a CRM API failure into a sentence a sales person can act on.
 *
 * The contact/school save toasts showed `detail || 'Failed'`. On the path that
 * actually broke — a rep editing a contact assigned to someone else — that
 * meant a bare "Not authorized to edit this contact", which tells her neither
 * why nor what to do next, so it got reported as "the CRM is throwing errors".
 *
 * The server now sends an actionable detail ("This contact is assigned to
 * Parul Kanchan (parul@…) — ask an admin to reassign it to you"), and this is
 * the client-side floor under it: any 403 that arrives without one still gets
 * an instruction rather than the word "Failed".
 */

const FALLBACK_403 = {
  contact: 'You cannot edit this contact — it is assigned to another rep, or it '
         + 'is unassigned and not at one of your schools. Ask an admin to reassign it to you.',
  school: 'You cannot edit this school — it belongs to another rep. Ask an admin '
        + 'to reassign it to you.',
  lead: 'You cannot edit this lead — it belongs to another rep. Ask an admin to '
      + 'reassign it to you.',
};

export function crmSaveError(err, kind = 'contact') {
  const status = err?.response?.status;
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (status === 403) return FALLBACK_403[kind] || FALLBACK_403.contact;
  if (status === 404) return `That ${kind} no longer exists — refresh the page.`;
  if (status === 409) return `Someone else changed this ${kind} — refresh and try again.`;
  if (!err?.response) return 'Could not reach the server — check your connection and try again.';
  return `Could not save the ${kind}. Please try again.`;
}

export const contactSaveError = (err) => crmSaveError(err, 'contact');
export const schoolSaveError = (err) => crmSaveError(err, 'school');

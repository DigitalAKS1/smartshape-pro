// Sales portal role definitions and permission matrix.
// Single source of truth — import getSalesPermissions(user.sales_role) anywhere.

export const SALES_ROLES = {
  manager: {
    label: 'Manager',
    description: 'Full access + team visibility & leave approvals',
    cls: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  },
  executive: {
    label: 'Executive',
    description: 'Standard field sales — all features',
    cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
  trainee: {
    label: 'Trainee',
    description: 'View & call assigned leads only — no quotations',
    cls: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  },
};

// What each role can do in the sales portal
const PERMS = {
  manager: {
    leads_view:       true,   // see own assigned leads list
    leads_call:       true,   // call / WhatsApp from a lead card
    leads_details:    true,   // see notes, email, source, type
    team_leads_view:  true,   // see ALL team leads (not just own)
    quotation_create: true,
    quotation_view:   true,
    visits_log:       true,
    expenses_log:     true,
    attendance:       true,
    leave_apply:      true,
    leave_approve:    true,   // can approve team members' leaves
  },
  executive: {
    leads_view:       true,
    leads_call:       true,
    leads_details:    true,
    team_leads_view:  false,
    quotation_create: true,
    quotation_view:   true,
    visits_log:       true,
    expenses_log:     true,
    attendance:       true,
    leave_apply:      true,
    leave_approve:    false,
  },
  trainee: {
    leads_view:       true,
    leads_call:       true,   // only action allowed on leads
    leads_details:    false,  // no notes / email / source shown
    team_leads_view:  false,
    quotation_create: false,
    quotation_view:   false,
    visits_log:       false,
    expenses_log:     false,
    attendance:       true,
    leave_apply:      true,
    leave_approve:    false,
  },
};

// Returns the permission set for a given sales_role string.
// Falls back to 'executive' for null/unknown roles (backward compatible).
export function getSalesPermissions(salesRole) {
  return PERMS[salesRole] || PERMS.executive;
}

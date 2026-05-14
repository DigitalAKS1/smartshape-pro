// CRM domain constants — shared across LeadsCRM, SchoolProfile, SalesLeads

export const STAGES = [
  { id: 'new',         label: 'New',         color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { id: 'contacted',   label: 'Contacted',   color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
  { id: 'demo',        label: 'Demo',        color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  { id: 'quoted',      label: 'Quoted',      color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  { id: 'negotiation', label: 'Negotiation', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  { id: 'won',         label: 'Won',         color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { id: 'retention',   label: 'Retention',   color: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
  { id: 'resell',      label: 'Resell',      color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' },
  { id: 'lost',        label: 'Lost',        color: 'bg-red-500/20 text-red-400 border-red-500/30' },
];

export const ACTIVE_STAGES = ['new', 'contacted', 'demo', 'quoted', 'negotiation'];

export const SCHOOL_TYPES = ['CBSE', 'ICSE', 'IB', 'State Board', 'Coaching', 'College'];

export const DESIGNATIONS = ['Principal', 'Admin', 'Trustee', 'Purchase Head', 'Director', 'Other'];

export const LEAD_TYPES = ['hot', 'warm', 'cold'];

export const STAGE_COLORS = {
  new:         'bg-blue-500/20 text-blue-400',
  contacted:   'bg-cyan-500/20 text-cyan-400',
  demo:        'bg-purple-500/20 text-purple-400',
  quoted:      'bg-yellow-500/20 text-yellow-400',
  negotiation: 'bg-orange-500/20 text-orange-400',
  won:         'bg-green-500/20 text-green-400',
  retention:   'bg-teal-500/20 text-teal-400',
  resell:      'bg-indigo-500/20 text-indigo-400',
  lost:        'bg-red-500/20 text-red-400',
};

export const LEAD_TYPE_COLORS = {
  hot:  'bg-red-500/20 text-red-400',
  warm: 'bg-yellow-500/20 text-yellow-400',
  cold: 'bg-blue-500/20 text-blue-400',
};

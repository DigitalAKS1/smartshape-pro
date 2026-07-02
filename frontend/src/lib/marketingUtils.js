// ── Design tokens ─────────────────────────────────────────────────────────────
export function useTk() {
  return {
    page:  'bg-[var(--bg-primary)]',
    card:  'bg-[var(--bg-card)]',
    bdr:   'border-[var(--border-color)]',
    t1:    'text-[var(--text-primary)]',
    t2:    'text-[var(--text-secondary)]',
    tm:    'text-[var(--text-muted)]',
    inp:   'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
    hov:   'hover:bg-[var(--bg-hover)]',
  };
}

// ── Campaign API → display format ─────────────────────────────────────────────
export function mapCampaign(c) {
  return {
    id: c.campaign_id,
    campaign_id: c.campaign_id,
    name: c.name,
    status: c.status || 'draft',
    audience_label: c.audience_label || 'All Contacts',
    audience_count: c.audience_count || 0,
    template_id: c.template_id || null,
    message: c.message || '',
    body_html: c.body_html || '',
    subject: c.subject || '',
    audience_filter: c.audience_filter || {},
    stats: {
      sent: c.sent_count || 0,
      delivered: c.delivered_count || 0,
      read: 0,
      failed: c.failed_count || 0,
    },
    created_at: c.created_at
      ? new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : '',
    scheduled_at: c.scheduled_at || null,
  };
}

// ── Campaign preview helper — personalize message with sample contact ──────────
export function personalize(text, contact) {
  if (!text || !contact) return text || '';
  const name = (contact.first_name || (contact.name || '').split(' ')[0] || 'Ramesh');
  const school = contact.company || 'Your School';
  return text.replace(/\{name\}/g, name).replace(/\{school_name\}/g, school);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export const STATUS_CHIP = {
  completed: 'bg-green-500/15 text-green-500',
  scheduled: 'bg-blue-500/15 text-blue-500',
  running:   'bg-yellow-500/15 text-yellow-600',
  draft:     'bg-gray-500/15 text-gray-400',
  paused:    'bg-orange-500/15 text-orange-400',
};

export function pct(num, den) { return den > 0 ? Math.round((num / den) * 100) : null; }

// ── Greeting rule helpers ─────────────────────────────────────────────────────
export function computeNext(mmdd) {
  if (!mmdd) return null;
  const [mm, dd] = mmdd.split('-').map(Number);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const thisYear = new Date(today.getFullYear(), mm - 1, dd);
  const target = thisYear >= today ? thisYear : new Date(today.getFullYear() + 1, mm - 1, dd);
  return target.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function daysTillNext(mmdd) {
  if (!mmdd) return Infinity;
  const [mm, dd] = mmdd.split('-').map(Number);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const thisYear = new Date(today.getFullYear(), mm - 1, dd);
  const target = thisYear >= today ? thisYear : new Date(today.getFullYear() + 1, mm - 1, dd);
  return Math.round((target - today) / 86400000);
}

export function mapRule(r) {
  const days = r.fixed_date ? daysTillNext(r.fixed_date) : Infinity;
  const nextLabel = r.trigger === 'birthday' ? 'Daily (each birthday)'
    : r.trigger === 'anniversary' ? 'On school anniversary'
    : days === 0 ? 'Today!' : days === 1 ? 'Tomorrow'
    : days <= 30 ? `In ${days} days` : computeNext(r.fixed_date);
  return {
    id: r.rule_id, rule_id: r.rule_id, name: r.name,
    type: r.type, category: r.category || 'Festival',
    date: r.fixed_date, trigger: r.trigger,
    active: r.is_active, audience: r.audience || 'all_contacts',
    template_body: r.template_body || '',
    sent_total: r.sent_total || 0, sent_this_year: r.sent_this_year || 0,
    is_date_fixed: r.is_date_fixed, days_till: days, next: nextLabel,
  };
}

import { Flag, Gift, BookOpen, Globe, Heart } from 'lucide-react';

export const CAT_META = {
  National: { col: 'text-orange-500', bg: 'bg-orange-500/15', Icon: Flag },
  Festival:  { col: 'text-amber-500',  bg: 'bg-amber-500/15',  Icon: Gift },
  School:    { col: 'text-blue-500',   bg: 'bg-blue-500/15',   Icon: BookOpen },
  Global:    { col: 'text-green-500',  bg: 'bg-green-500/15',  Icon: Globe },
  Personal:  { col: 'text-pink-500',   bg: 'bg-pink-500/15',   Icon: Heart },
};

export function catMeta(cat) { return CAT_META[cat] || CAT_META.Festival; }

// ── API → display shape mapper ────────────────────────────────────────────────
export const TRIGGER_LABELS = { lead_created: 'Lead Created', quotation_sent: 'Quotation Sent', manual: 'Manual' };

export function mapSeq(s) {
  const tLabel = TRIGGER_LABELS[s.trigger] || s.trigger;
  const fLabel = s.filter_designation ? ` · ${s.filter_designation}` : '';
  return {
    id: s.sequence_id,
    name: s.name,
    description: s.description || '',
    trigger: `${tLabel}${fLabel}`,
    filter_designation: s.filter_designation || '',
    sequence_id: s.sequence_id,
    trigger_raw: s.trigger,
    steps: (s.steps || []).map(st => {
      const plain = st.message_template
        ? st.message_template.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        : '';
      return {
        n: st.step_number,
        delay: st.delay_days === 0 ? 'Immediately' : `Day ${st.delay_days}`,
        label: plain ? plain.substring(0, 80) + (plain.length > 80 ? '…' : '') : `Step ${st.step_number}`,
        delay_days: st.delay_days,
        message_template: st.message_template,
        message_type: st.message_type,
        attachment_id: st.attachment_id || null,
        attachment_url: st.attachment_url || null,
        attachment_name: st.attachment_name || null,
      };
    }),
    enrolled: s.enrollment_count || 0,
    completed: s.completed_count || 0,
    active: s.is_active,
  };
}

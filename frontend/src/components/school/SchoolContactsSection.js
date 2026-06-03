import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, Mail, MessageSquare, Edit2, Plus, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';

function Badge({ label, cls }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold capitalize ${cls || 'bg-slate-100 text-slate-600'}`}>
      {label}
    </span>
  );
}

function Nil({ label = 'Not set', className = '' }) {
  return (
    <span className={`text-[11px] italic select-none ${className}`} style={{ color: '#c0ccd8' }}>
      {label}
    </span>
  );
}

function EmptyState({ label }) {
  return (
    <div className="py-16 text-center flex flex-col items-center gap-3">
      <p className="text-sm" style={{ color: '#94a3b8' }}>{label}</p>
    </div>
  );
}

function fmt(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

export default function SchoolContactsSection({
  contacts, isDark, tk,
  expandedContact, setExpandedContact,
  openAddContact, openEditContact,
}) {
  const navigate = useNavigate();

  return (
    <div className="sp-tab space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={`text-sm font-semibold ${tk.t1}`}>
            {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
          </p>
          <p className={`text-[11px] ${tk.tm} mt-0.5`}>
            {contacts.filter(c => c.converted_to_lead).length} converted to lead
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost"
            onClick={() => navigate('/leads?tab=contacts')}
            className={`${tk.tm} h-8 px-3 text-xs border ${tk.border} rounded-lg flex items-center gap-1.5`}>
            <ExternalLink className="h-3 w-3" /> Open in CRM
          </Button>
          <Button size="sm"
            onClick={openAddContact}
            className="bg-[#e94560] hover:bg-[#f05c75] text-white h-8 px-4 text-xs rounded-lg">
            <Plus className="h-3.5 w-3.5 mr-1.5" />Add Contact
          </Button>
        </div>
      </div>

      {contacts.length === 0 ? <EmptyState label="No contacts linked to this school yet." /> : (
        <div className={`${tk.card} border ${tk.border} rounded-2xl overflow-hidden divide-y ${tk.divide}`}>
          {contacts.map(c => (
            <div key={c.contact_id}>
              <div className="px-5 py-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-black ${
                  c.converted_to_lead
                    ? 'bg-emerald-500/15 text-emerald-600'
                    : isDark ? 'bg-[var(--bg-primary)] text-[var(--text-primary)]' : 'bg-[#f1f5f9] text-[#475569]'
                }`}>
                  {c.name?.charAt(0)?.toUpperCase() || '?'}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-semibold text-sm ${tk.t1}`}>{c.name}</span>
                    {c.designation && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        isDark ? 'bg-[var(--bg-primary)] text-[var(--text-secondary)]' : 'bg-[#f1f5f9] text-[#475569]'
                      }`}>{c.designation}</span>
                    )}
                    {c.converted_to_lead && <Badge label="Converted" cls="bg-emerald-50 text-emerald-700" />}
                  </div>
                  <div className="flex items-center gap-4 mt-1 flex-wrap">
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className={`text-xs ${tk.tm} hover:text-[#e94560] flex items-center gap-1 transition-colors`}>
                        <Phone className="h-3 w-3" />{c.phone}
                      </a>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className={`text-xs ${tk.tm} hover:text-[#e94560] flex items-center gap-1 truncate max-w-[180px] transition-colors`}>
                        <Mail className="h-3 w-3" />{c.email}
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {c.phone && (
                    <a href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="ghost" className="text-emerald-500 h-8 w-8 p-0" title="WhatsApp">
                        <MessageSquare className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  )}
                  <Button size="sm" variant="ghost"
                    onClick={() => openEditContact(c)}
                    className={`${tk.tm} h-8 w-8 p-0 hover:text-[#e94560]`}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost"
                    onClick={() => setExpandedContact(expandedContact === c.contact_id ? null : c.contact_id)}
                    className={`${tk.tm} h-8 px-2.5 text-xs`}>
                    {expandedContact === c.contact_id ? '↑' : '↓'}
                  </Button>
                </div>
              </div>

              {expandedContact === c.contact_id && (
                <div className={`px-5 pb-4 pt-3 ${isDark ? 'bg-[var(--bg-primary)]/50' : 'bg-[#f8fafc]'} border-t ${tk.border}`}>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <p className={`text-[10px] uppercase tracking-wider ${tk.tm} mb-0.5`}>Source</p>
                      {c.source ? <p className={`text-xs ${tk.t2}`}>{c.source}</p> : <Nil />}
                    </div>
                    <div>
                      <p className={`text-[10px] uppercase tracking-wider ${tk.tm} mb-0.5`}>Birthday</p>
                      {c.birthday ? <p className={`text-xs ${tk.t2}`}>{fmt(c.birthday)}</p> : <Nil />}
                    </div>
                    <div>
                      <p className={`text-[10px] uppercase tracking-wider ${tk.tm} mb-0.5`}>Added</p>
                      <p className={`text-xs ${tk.t2}`}>{fmt(c.created_at)}</p>
                    </div>
                    <div>
                      <p className={`text-[10px] uppercase tracking-wider ${tk.tm} mb-0.5`}>Status</p>
                      <p className={`text-xs font-medium ${c.converted_to_lead ? 'text-emerald-500' : 'text-blue-400'}`}>
                        {c.converted_to_lead ? 'Lead Created' : 'Active Contact'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-dashed border-[var(--border-color)]">
                    <p className={`text-[10px] uppercase tracking-wider ${tk.tm} mb-1`}>Notes</p>
                    {c.notes
                      ? <p className={`text-xs ${tk.t2} leading-relaxed`}>{c.notes}</p>
                      : <Nil label="No notes recorded" />}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

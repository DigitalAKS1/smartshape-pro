import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { useTheme } from '../../contexts/ThemeContext';
import { formatDate } from '../../lib/utils';
import {
  Phone, MessageSquare, Mail, Edit2, Trash2, UserPlus, Plus,
  Building2, ArrowRightCircle, Download, Upload, ChevronLeft,
  ChevronRight, ExternalLink,
} from 'lucide-react';
import { adminApi } from '../../lib/api';
import { toast } from 'sonner';

export default function ContactsTab({
  contactsList, leadsList,
  filterRole, setFilterRole,
  filterContactTag, setFilterContactTag,
  searchTerm,
  tagsList, rolesList,
  sortConfig, toggleSort, sortIndicator, sortData,
  contactPage, setContactPage, contactsPerPage,
  getRoleName,
  calcContactCompletion,
  touchAgeCls, daysSince,
  openCreateContact,
  openEditContact,
  deleteContact,
  openConvert,
  openWaForContact,
  handleContactExport,
  setContactImportOpen,
  setActiveTab,
  openDetail,
  expandedContactId,
  contactActivity,
  expandContactActivity,
  fetchData,
  user,
}) {
  const navigate = useNavigate();
  const { isDark } = useTheme();

  const card = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)]' : 'bg-white border-[var(--border-color)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  const ROLE_COLORS = {
    'Principal':      'bg-purple-500/15 text-purple-500',
    'Vice Principal': 'bg-indigo-500/15 text-indigo-500',
    'Teacher':        'bg-green-500/15 text-green-500',
    'Purchase Head':  'bg-orange-500/15 text-orange-500',
    'Admin Head':     'bg-blue-500/15 text-blue-500',
    'Director':       'bg-rose-500/15 text-rose-500',
    'Coordinator':    'bg-teal-500/15 text-teal-500',
    'Manager':        'bg-cyan-500/15 text-cyan-500',
    'Owner':          'bg-amber-500/15 text-amber-600',
  };
  const getRoleColor = (name) => ROLE_COLORS[name] || 'bg-gray-500/15 text-gray-400';

  const completionBadge = (pct, onClickFn) => {
    const cls = pct >= 80 ? 'bg-green-500/20 text-green-400' : pct >= 50 ? 'bg-yellow-500/20 text-yellow-500' : 'bg-red-500/20 text-red-400';
    return (
      <button onClick={onClickFn} title="Click to edit and complete profile"
        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${cls} cursor-pointer hover:opacity-80 transition-opacity`}>
        {pct}%
      </button>
    );
  };

  // Role counts for filter chips
  const roleCounts = {};
  contactsList.forEach(c => {
    const rn = getRoleName(c);
    if (rn) roleCounts[rn] = (roleCounts[rn] || 0) + 1;
  });
  const topRoles = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);

  let cFiltered = contactsList.filter(c => {
    if (filterRole && getRoleName(c) !== filterRole) return false;
    if (filterContactTag && !(c.tag_ids || []).includes(filterContactTag)) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return (c.name || '').toLowerCase().includes(s) || (c.phone || '').includes(s) || (c.company || '').toLowerCase().includes(s) || (c.email || '').toLowerCase().includes(s);
    }
    return true;
  });
  cFiltered = sortData(cFiltered, sortConfig.key, sortConfig.dir);
  const totalPages = Math.max(1, Math.ceil(cFiltered.length / contactsPerPage));
  const safePage = Math.min(contactPage, totalPages);
  const paginated = cFiltered.slice((safePage - 1) * contactsPerPage, safePage * contactsPerPage);

  return (
    <div className="space-y-3" data-testid="contacts-list">
      {/* Role filter chips */}
      {topRoles.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          <button
            onClick={() => { setFilterRole(''); setContactPage(1); }}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap border transition-all ${
              filterRole === ''
                ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}>
            All
            <span className={`text-[10px] font-bold px-1.5 rounded-full ${filterRole === '' ? 'bg-white/20 text-white' : 'bg-[var(--bg-primary)]'}`}>
              {contactsList.length}
            </span>
          </button>
          {topRoles.map(([role, count]) => (
            <button key={role}
              onClick={() => { setFilterRole(role); setContactPage(1); }}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap border transition-all ${
                filterRole === role
                  ? `${getRoleColor(role)} border-current`
                  : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}>
              {role}
              <span className={`text-[10px] font-bold px-1.5 rounded-full ${filterRole === role ? 'bg-current/10' : 'bg-[var(--bg-primary)]'}`}>
                {count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Tag filter chips */}
      {tagsList.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${textMuted} whitespace-nowrap`}>Tags:</span>
          <button
            onClick={() => { setFilterContactTag(''); setContactPage(1); }}
            className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap border transition-all ${
              filterContactTag === '' ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}>All</button>
          {tagsList.map(t => (
            <button key={t.tag_id}
              onClick={() => { setFilterContactTag(t.tag_id); setContactPage(1); }}
              className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap border transition-all ${
                filterContactTag === t.tag_id ? 'text-white border-transparent' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
              style={filterContactTag === t.tag_id ? { backgroundColor: t.color } : {}}>
              <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ backgroundColor: t.color }} />{t.name}
            </button>
          ))}
        </div>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleContactExport} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="export-contacts-btn">
          <Download className="mr-1 h-3 w-3" /> Export CSV
        </Button>
        <Button onClick={() => setContactImportOpen(true)} variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="import-contacts-btn">
          <Upload className="mr-1 h-3 w-3" /> Import CSV
        </Button>
        {user?.role === 'admin' && (
          <Button onClick={async () => {
            try {
              const res = await adminApi.backfillSchools();
              const d = res.data;
              toast.success(`Sync done — ${d.created_schools} schools created, ${d.linked_contacts} contacts linked`);
              fetchData();
            } catch { toast.error('Sync failed'); }
          }} variant="outline" size="sm" className="border-blue-500/40 text-blue-400 hover:bg-blue-500/10" title="Create school records from contact school names and link them">
            <Building2 className="mr-1 h-3 w-3" /> Sync Schools
          </Button>
        )}
        <span className={`text-xs ${textMuted} ml-auto`}>{cFiltered.length} contacts{searchTerm || filterRole ? ' (filtered)' : ''} • {contactsList.filter(c => c.converted_to_lead).length} converted</span>
      </div>

      {cFiltered.length === 0 ? (
        <div className={`${card} border rounded-md p-12 text-center`}>
          <UserPlus className={`h-12 w-12 mx-auto mb-3 ${textMuted}`} strokeWidth={1} />
          <p className={textMuted}>No contacts found</p>
          <Button onClick={openCreateContact} size="sm" className="mt-4 bg-[#e94560] hover:bg-[#f05c75] text-white"><Plus className="mr-1 h-3 w-3" /> Add Contact</Button>
        </div>
      ) : (
        <>
          {/* Mobile: contact cards */}
          <div className="sm:hidden space-y-2" data-testid="contacts-list-mobile">
            {paginated.map(contact => (
              <div key={contact.contact_id} className={`${card} border rounded-md p-3 flex items-start justify-between gap-2 ${contact.converted_to_lead ? 'opacity-60' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className={`${textPri} font-medium text-sm truncate`}>{contact.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {getRoleName(contact) && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${getRoleColor(getRoleName(contact))}`}>
                        {getRoleName(contact)}
                      </span>
                    )}
                    {contact.company && (
                      contact.school_id
                        ? <button onClick={e => { e.stopPropagation(); navigate(`/school-profile/${contact.school_id}`); }}
                            className="flex items-center gap-1 text-[10px] text-[#e94560] font-medium truncate max-w-[140px]">
                            <Building2 className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{contact.company}</span>
                            <ExternalLink className="h-2.5 w-2.5 flex-shrink-0 opacity-60" />
                          </button>
                        : <span className={`text-[10px] ${textMuted} flex items-center gap-1 truncate max-w-[140px]`}>
                            <Building2 className="h-3 w-3 flex-shrink-0 opacity-40" />
                            {contact.company}
                          </span>
                    )}
                  </div>
                  {(contact.tag_ids || []).length > 0 && (
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      {(contact.tag_ids || []).slice(0, 3).map(tid => {
                        const tg = tagsList.find(t => t.tag_id === tid);
                        return tg ? <span key={tid} className="text-[9px] px-1.5 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: tg.color }}>{tg.name}</span> : null;
                      })}
                      {(contact.tag_ids || []).length > 3 && <span className={`text-[9px] ${textMuted}`}>+{(contact.tag_ids || []).length - 3}</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <a href={`tel:${contact.phone}`} className={`text-xs ${textSec} flex items-center gap-1`}><Phone className="h-3 w-3" />{contact.phone}</a>
                    {contact.email && <a href={`mailto:${contact.email}`} className={`text-xs ${textSec} flex items-center gap-1 max-w-[160px] truncate`}><Mail className="h-3 w-3" />{contact.email}</a>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {contact.converted_to_lead
                      ? <span className="inline-block text-[10px] px-2 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">Converted</span>
                      : <span className="inline-block text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">Active</span>}
                    {!contact.converted_to_lead && completionBadge(calcContactCompletion(contact), () => openEditContact(contact))}
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => openWaForContact(contact)} className="text-green-500 h-9 w-9 p-0"><MessageSquare className="h-4 w-4" /></Button>
                  {!contact.converted_to_lead && <Button size="sm" variant="ghost" onClick={() => openConvert(contact)} className="text-[#e94560] h-9 w-9 p-0" data-testid={`convert-contact-${contact.contact_id}`}><ArrowRightCircle className="h-4 w-4" /></Button>}
                  <Button size="sm" variant="ghost" onClick={() => openEditContact(contact)} className={`${textSec} h-9 w-9 p-0`}><Edit2 className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteContact(contact.contact_id)} className="text-red-400 h-9 w-9 p-0"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: Table */}
          <div className={`hidden sm:block ${card} border rounded-md overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="contacts-table">
                <thead><tr className="bg-[var(--bg-primary)]">
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => toggleSort('name')}>Name{sortIndicator('name')}</th>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} cursor-pointer select-none`} onClick={() => toggleSort('phone')}>Phone{sortIndicator('phone')}</th>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden sm:table-cell cursor-pointer select-none`} onClick={() => toggleSort('email')}>Email{sortIndicator('email')}</th>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden md:table-cell cursor-pointer select-none`} onClick={() => toggleSort('company')}>School{sortIndicator('company')}</th>
                  <th className={`text-left text-xs uppercase py-3 px-3 ${textMuted} hidden lg:table-cell cursor-pointer select-none`} onClick={() => toggleSort('source')}>Source{sortIndicator('source')}</th>
                  <th className={`text-center text-xs uppercase py-3 px-3 ${textMuted} hidden xl:table-cell cursor-pointer select-none`} onClick={() => toggleSort('last_activity_date')}>Last Touch{sortIndicator('last_activity_date')}</th>
                  <th className={`text-center text-xs uppercase py-3 px-3 ${textMuted}`}>Status</th>
                  <th className={`text-right text-xs uppercase py-3 px-3 ${textMuted}`}>Actions</th>
                </tr></thead>
                <tbody>
                  {paginated.map(contact => (
                    <React.Fragment key={contact.contact_id}>
                      <tr className={`border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer ${contact.converted_to_lead ? 'opacity-55' : ''}`} data-testid={`contact-row-${contact.contact_id}`}
                        onClick={() => expandContactActivity(contact.contact_id)}>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5">
                            <p className={`${textPri} font-medium text-sm`}>{contact.name}</p>
                            {!contact.converted_to_lead && completionBadge(calcContactCompletion(contact), (e) => { e.stopPropagation(); openEditContact(contact); })}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {getRoleName(contact) && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${getRoleColor(getRoleName(contact))}`}>
                                {getRoleName(contact)}
                              </span>
                            )}
                            {(contact.tag_ids || []).slice(0, 2).map(tid => {
                              const tg = tagsList.find(t => t.tag_id === tid);
                              return tg ? <span key={tid} className="text-[9px] px-1.5 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: tg.color }}>{tg.name}</span> : null;
                            })}
                            {(contact.tag_ids || []).length > 2 && <span className={`text-[9px] ${textMuted}`}>+{(contact.tag_ids || []).length - 2}</span>}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <a href={`tel:${contact.phone}`} className={`text-sm ${textSec} hover:text-[#e94560]`}>{contact.phone}</a>
                        </td>
                        <td className={`py-2.5 px-3 hidden sm:table-cell text-sm ${textSec}`}>
                          {contact.email
                            ? <a href={`mailto:${contact.email}`} className="hover:text-[#e94560]">{contact.email}</a>
                            : <span className="text-[11px] italic" style={{ color: '#c0ccd8' }}>no email</span>}
                        </td>
                        <td className="py-2.5 px-3 hidden md:table-cell text-sm">
                          {contact.company
                            ? contact.school_id
                              ? <button onClick={e => { e.stopPropagation(); navigate(`/school-profile/${contact.school_id}`); }}
                                  className={`group flex items-center gap-1.5 max-w-[180px] text-left rounded px-1.5 py-0.5 -mx-1.5 hover:bg-[#e94560]/8 transition-colors ${textSec} hover:text-[#e94560]`}
                                  title="Open school profile">
                                  <Building2 className="h-3 w-3 flex-shrink-0 text-green-500 group-hover:text-[#e94560] transition-colors" />
                                  <span className="truncate text-xs font-medium">{contact.company}</span>
                                  <ExternalLink className="h-2.5 w-2.5 flex-shrink-0 opacity-0 group-hover:opacity-70 transition-opacity" />
                                </button>
                              : <span className={`flex items-center gap-1.5 text-xs ${textMuted}`}>
                                  <Building2 className="h-3 w-3 flex-shrink-0 opacity-40" />
                                  {contact.company}
                                </span>
                            : <span className={textMuted}>—</span>}
                        </td>
                        <td className="py-2.5 px-3 hidden lg:table-cell text-xs">
                          {contact.source
                            ? <span className={textMuted}>{contact.source}</span>
                            : <span className="italic" style={{ color: '#c0ccd8' }}>no source</span>}
                        </td>
                        <td className="py-2.5 px-3 hidden xl:table-cell text-center">
                          {contact.last_activity_date ? (
                            <span className={`text-[11px] font-medium ${touchAgeCls(contact.last_activity_date)}`}>
                              {daysSince(contact.last_activity_date) === 0 ? 'Today' : `${daysSince(contact.last_activity_date)}d ago`}
                            </span>
                          ) : <span className={`text-[11px] ${textMuted}`}>—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {contact.converted_to_lead ? (
                            <button
                              onClick={() => {
                                const l = leadsList.find(x => x.lead_id === contact.lead_id);
                                if (l) { setActiveTab('pipeline'); openDetail(l); }
                              }}
                              className="text-[10px] px-2 py-0.5 rounded bg-green-500/20 text-green-400 font-medium hover:bg-green-500/30 transition-colors cursor-pointer"
                              title="Click to view lead">
                              Lead · {leadsList.find(x => x.lead_id === contact.lead_id)?.stage || 'view'}
                            </button>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">Active</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant="ghost" onClick={() => openWaForContact(contact)} className="text-green-500 h-7 px-1.5" title="Send WhatsApp" data-testid={`wa-contact-${contact.contact_id}`}><MessageSquare className="h-3.5 w-3.5" /></Button>
                          {!contact.converted_to_lead && (
                            <Button size="sm" variant="ghost" onClick={() => openConvert(contact)} className="text-[#e94560] h-7 px-1.5" title="Convert to Lead" data-testid={`convert-contact-${contact.contact_id}`}><ArrowRightCircle className="h-3.5 w-3.5" /></Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => openEditContact(contact)} className={`${textSec} h-7 px-1.5`} data-testid={`edit-contact-${contact.contact_id}`}><Edit2 className="h-3 w-3" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteContact(contact.contact_id)} className="text-red-400 h-7 px-1.5" data-testid={`delete-contact-${contact.contact_id}`}><Trash2 className="h-3 w-3" /></Button>
                        </td>
                      </tr>
                      {expandedContactId === contact.contact_id && (
                        <tr>
                          <td colSpan="8" className={`px-4 py-3 ${isDark ? 'bg-[var(--bg-hover)]' : 'bg-[#f8fafc]'} border-t border-[var(--border-color)]`}>
                            <p className={`text-xs font-semibold ${textSec} mb-2`}>Activity Timeline</p>
                            {contactActivity.length === 0 ? (
                              <p className={`text-xs ${textMuted}`}>No marketing activity recorded yet</p>
                            ) : (
                              <div className="space-y-1.5">
                                {contactActivity.slice(0, 10).map((act, i) => (
                                  <div key={i} className="flex items-center gap-2 text-xs">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize flex-shrink-0 ${
                                      act.type === 'whatsapp' ? 'bg-green-500/20 text-green-400'
                                      : act.type === 'drip' ? 'bg-yellow-500/20 text-yellow-600'
                                      : 'bg-pink-500/20 text-pink-400'
                                    }`}>{act.type}</span>
                                    <span className={`flex-1 ${textPri} truncate`}>{act.label}</span>
                                    {act.status && <span className={`${textMuted} text-[10px] flex-shrink-0`}>{act.status}</span>}
                                    <span className={`${textMuted} flex-shrink-0`}>{act.at ? formatDate(act.at) : '—'}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between" data-testid="contacts-pagination">
              <p className={`text-xs ${textMuted}`}>Showing {(safePage - 1) * contactsPerPage + 1}–{Math.min(safePage * contactsPerPage, cFiltered.length)} of {cFiltered.length}</p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setContactPage(p => Math.max(1, p - 1))} className={`border-[var(--border-color)] ${textMuted} h-8 w-8 p-0`} data-testid="contacts-prev-page"><ChevronLeft className="h-4 w-4" /></Button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1).map((p, idx, arr) => (
                  <React.Fragment key={p}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className={`px-1 ${textMuted}`}>...</span>}
                    <Button variant={p === safePage ? 'default' : 'outline'} size="sm" onClick={() => setContactPage(p)}
                      className={`h-8 w-8 p-0 text-xs ${p === safePage ? 'bg-[#e94560] text-white' : `border-[var(--border-color)] ${textSec}`}`}
                      data-testid={`contacts-page-${p}`}>{p}</Button>
                  </React.Fragment>
                ))}
                <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setContactPage(p => Math.min(totalPages, p + 1))} className={`border-[var(--border-color)] ${textMuted} h-8 w-8 p-0`} data-testid="contacts-next-page"><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

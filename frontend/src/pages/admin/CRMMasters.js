import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { groups as groupsApi, sources as sourcesApi, contactRoles as contactRolesApi, tags as tagsApi, whatsappTemplates, broadcastApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, Building2, Tag, UserCheck, Send } from 'lucide-react';

const TABS = [
  { id: 'groups', label: 'Group Master', icon: Building2, desc: 'Trusts / parent organisations that own multiple schools' },
  { id: 'sources', label: 'Source Master', icon: Tag, desc: 'Where leads / contacts come from (Call, Exhibition, Ads, ...)' },
  { id: 'roles', label: 'Contact Roles', icon: UserCheck, desc: 'Role / designation taxonomy for school contacts (Principal, Trustee, Director, ...)' },
  { id: 'tags', label: 'Tag Master', icon: Tag, desc: 'Color-coded tags to segment leads and run targeted WhatsApp / email campaigns' },
];

export default function CRMMasters() {
  const [activeTab, setActiveTab] = useState('groups');
  const [loading, setLoading] = useState(true);
  const [groupsList, setGroupsList] = useState([]);
  const [sourcesList, setSourcesList] = useState([]);
  const [rolesList, setRolesList] = useState([]);
  const [tagsList, setTagsList] = useState([]);
  const [templatesList, setTemplatesList] = useState([]);

  // Dialogs
  const [groupOpen, setGroupOpen] = useState(false);
  const [editGroup, setEditGroup] = useState(null);
  const [groupForm, setGroupForm] = useState({ group_name: '', head_office_address: '', chairman_name: '', contact_number: '', email: '' });

  const [srcOpen, setSrcOpen] = useState(false);
  const [editSrc, setEditSrc] = useState(null);
  const [srcForm, setSrcForm] = useState({ name: '' });

  const [roleOpen, setRoleOpen] = useState(false);
  const [editRole, setEditRole] = useState(null);
  const [roleForm, setRoleForm] = useState({ name: '' });

  const [tagOpen, setTagOpen] = useState(false);
  const [editTag, setEditTag] = useState(null);
  const [tagForm, setTagForm] = useState({ name: '', color: '#6366f1' });

  // Campaign state
  const [campaignTag, setCampaignTag] = useState('');
  const [campaignTemplate, setCampaignTemplate] = useState('');
  const [campaignSending, setCampaignSending] = useState(false);

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

  const fetchAll = async () => {
    try {
      const [g, s, r, t, tmpl] = await Promise.all([
        groupsApi.getAll(),
        sourcesApi.getAll(),
        contactRolesApi.getAll(),
        tagsApi.getAll(),
        whatsappTemplates.getAll().catch(() => ({ data: [] })),
      ]);
      setGroupsList(g.data || []);
      setSourcesList(s.data || []);
      setRolesList(r.data || []);
      setTagsList(t.data || []);
      setTemplatesList(tmpl.data || []);
    } catch { toast.error('Failed to load masters'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchAll(); }, []);

  // ---- Group handlers ----
  const openNewGroup = () => { setEditGroup(null); setGroupForm({ group_name: '', head_office_address: '', chairman_name: '', contact_number: '', email: '' }); setGroupOpen(true); };
  const openEditGroup = (g) => { setEditGroup(g); setGroupForm({ group_name: g.group_name || '', head_office_address: g.head_office_address || '', chairman_name: g.chairman_name || '', contact_number: g.contact_number || '', email: g.email || '' }); setGroupOpen(true); };
  const saveGroup = async () => {
    if (!groupForm.group_name) { toast.error('Group name required'); return; }
    try {
      if (editGroup) await groupsApi.update(editGroup.group_id, groupForm);
      else await groupsApi.create(groupForm);
      toast.success(editGroup ? 'Group updated' : 'Group created');
      setGroupOpen(false); fetchAll();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const deleteGroup = async (g) => {
    if (!window.confirm(`Delete group "${g.group_name}"? Schools linked to it will lose the link.`)) return;
    try { await groupsApi.delete(g.group_id); toast.success('Deleted'); fetchAll(); }
    catch { toast.error('Delete failed'); }
  };

  // ---- Source handlers ----
  const openNewSrc = () => { setEditSrc(null); setSrcForm({ name: '' }); setSrcOpen(true); };
  const openEditSrc = (s) => { setEditSrc(s); setSrcForm({ name: s.name || '' }); setSrcOpen(true); };
  const saveSrc = async () => {
    if (!srcForm.name) { toast.error('Source name required'); return; }
    try {
      if (editSrc) await sourcesApi.update(editSrc.source_id, srcForm);
      else await sourcesApi.create(srcForm);
      toast.success(editSrc ? 'Source updated' : 'Source created');
      setSrcOpen(false); fetchAll();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const deleteSrc = async (s) => {
    if (!window.confirm(`Delete source "${s.name}"?`)) return;
    try { await sourcesApi.delete(s.source_id); toast.success('Deleted'); fetchAll(); }
    catch { toast.error('Delete failed'); }
  };

  // ---- Role handlers ----
  const openNewRole = () => { setEditRole(null); setRoleForm({ name: '' }); setRoleOpen(true); };
  const openEditRole = (r) => { setEditRole(r); setRoleForm({ name: r.name || '' }); setRoleOpen(true); };
  const saveRole = async () => {
    if (!roleForm.name) { toast.error('Role name required'); return; }
    try {
      if (editRole) await contactRolesApi.update(editRole.role_id, roleForm);
      else await contactRolesApi.create(roleForm);
      toast.success(editRole ? 'Role updated' : 'Role created');
      setRoleOpen(false); fetchAll();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const deleteRole = async (r) => {
    if (!window.confirm(`Delete role "${r.name}"?`)) return;
    try { await contactRolesApi.delete(r.role_id); toast.success('Deleted'); fetchAll(); }
    catch { toast.error('Delete failed'); }
  };

  // ---- Tag handlers ----
  const openNewTag = () => { setEditTag(null); setTagForm({ name: '', color: '#6366f1' }); setTagOpen(true); };
  const openEditTag = (t) => { setEditTag(t); setTagForm({ name: t.name || '', color: t.color || '#6366f1' }); setTagOpen(true); };
  const saveTag = async () => {
    if (!tagForm.name) { toast.error('Tag name required'); return; }
    try {
      if (editTag) await tagsApi.update(editTag.tag_id, tagForm);
      else await tagsApi.create(tagForm);
      toast.success(editTag ? 'Tag updated' : 'Tag created');
      setTagOpen(false); fetchAll();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const deleteTag = async (t) => {
    if (!window.confirm(`Delete tag "${t.name}"? Leads with this tag will lose it.`)) return;
    try { await tagsApi.delete(t.tag_id); toast.success('Deleted'); fetchAll(); }
    catch { toast.error('Delete failed'); }
  };

  const sendCampaign = async () => {
    if (!campaignTag) { toast.error('Select a tag'); return; }
    if (!campaignTemplate) { toast.error('Select a WhatsApp template'); return; }
    setCampaignSending(true);
    try {
      const res = await broadcastApi.byTag({ tag_id: campaignTag, template_id: campaignTemplate });
      toast.success(`Campaign sent: ${res.data.sent} delivered, ${res.data.failed} failed, ${res.data.skipped} skipped (no phone)`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Campaign failed');
    } finally { setCampaignSending(false); }
  };

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-96"><div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div></AdminLayout>;

  const tab = TABS.find(t => t.id === activeTab);

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="crm-masters-title">CRM Masters</h1>
          <p className={`${textSec} mt-1 text-sm`}>Manage Groups, Sources, and Contact Roles used across CRM dropdowns.</p>
        </div>

        {/* Tabs */}
        <div className={`${card} border rounded-md p-1 flex gap-1`}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              data-testid={`tab-${t.id}`}
              className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded text-sm font-medium transition-all ${activeTab === t.id ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}>
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
        <p className={`text-xs ${textMuted}`}>{tab?.desc}</p>

        {/* GROUPS */}
        {activeTab === 'groups' && (
          <div className={`${card} border rounded-md p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-medium ${textPri}`}>Groups ({groupsList.length})</h2>
              <Button onClick={openNewGroup} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-group-btn">
                <Plus className="mr-1 h-3 w-3" /> Add Group
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="groups-table">
                <thead><tr className="bg-[var(--bg-primary)]">
                  <th className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted}`}>Group Name</th>
                  <th className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted}`}>Chairman</th>
                  <th className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted} hidden md:table-cell`}>Head Office</th>
                  <th className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted} hidden sm:table-cell`}>Contact</th>
                  <th className={`text-right text-xs uppercase py-2.5 px-3 ${textMuted}`}>Actions</th>
                </tr></thead>
                <tbody>
                  {groupsList.map(g => (
                    <tr key={g.group_id} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)]" data-testid={`group-row-${g.group_id}`}>
                      <td className={`py-2.5 px-3 ${textPri} font-medium`}>{g.group_name}</td>
                      <td className={`py-2.5 px-3 ${textSec}`}>{g.chairman_name || '—'}</td>
                      <td className={`py-2.5 px-3 ${textMuted} hidden md:table-cell text-xs`}>{g.head_office_address || '—'}</td>
                      <td className={`py-2.5 px-3 ${textMuted} hidden sm:table-cell font-mono text-xs`}>{g.contact_number || '—'}</td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => openEditGroup(g)} className={`${textSec} h-7 px-1.5`} data-testid={`edit-group-${g.group_id}`}><Edit2 className="h-3 w-3" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteGroup(g)} className="text-red-400 h-7 px-1.5" data-testid={`delete-group-${g.group_id}`}><Trash2 className="h-3 w-3" /></Button>
                      </td>
                    </tr>
                  ))}
                  {groupsList.length === 0 && <tr><td colSpan="5" className={`py-12 text-center ${textMuted}`}>No groups yet — click <strong>Add Group</strong> to create the first one.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SOURCES */}
        {activeTab === 'sources' && (
          <div className={`${card} border rounded-md p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-medium ${textPri}`}>Sources ({sourcesList.length})</h2>
              <Button onClick={openNewSrc} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-source-btn">
                <Plus className="mr-1 h-3 w-3" /> Add Source
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {sourcesList.map(s => (
                <div key={s.source_id} className={`flex items-center justify-between ${card} border rounded-md p-2.5`} data-testid={`source-row-${s.source_id}`}>
                  <span className={`${textPri} text-sm`}>{s.name}</span>
                  <div className="flex">
                    <Button size="sm" variant="ghost" onClick={() => openEditSrc(s)} className={`${textSec} h-7 px-1.5`} data-testid={`edit-source-${s.source_id}`}><Edit2 className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteSrc(s)} className="text-red-400 h-7 px-1.5" data-testid={`delete-source-${s.source_id}`}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
              {sourcesList.length === 0 && <p className={`text-xs ${textMuted} col-span-full text-center py-6`}>No sources yet</p>}
            </div>
          </div>
        )}

        {/* ROLES */}
        {activeTab === 'roles' && (
          <div className={`${card} border rounded-md p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-medium ${textPri}`}>Contact Roles ({rolesList.length})</h2>
              <Button onClick={openNewRole} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-role-btn">
                <Plus className="mr-1 h-3 w-3" /> Add Role
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {rolesList.map(r => (
                <div key={r.role_id} className={`flex items-center justify-between ${card} border rounded-md p-2.5`} data-testid={`role-row-${r.role_id}`}>
                  <span className={`${textPri} text-sm`}>{r.name}</span>
                  <div className="flex">
                    <Button size="sm" variant="ghost" onClick={() => openEditRole(r)} className={`${textSec} h-7 px-1.5`} data-testid={`edit-role-${r.role_id}`}><Edit2 className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteRole(r)} className="text-red-400 h-7 px-1.5" data-testid={`delete-role-${r.role_id}`}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
              {rolesList.length === 0 && <p className={`text-xs ${textMuted} col-span-full text-center py-6`}>No roles yet</p>}
            </div>
          </div>
        )}

        {/* TAGS */}
        {activeTab === 'tags' && (
          <div className="space-y-4">
            <div className={`${card} border rounded-md p-5`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-lg font-medium ${textPri}`}>Tags ({tagsList.length})</h2>
                <Button onClick={openNewTag} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-tag-btn">
                  <Plus className="mr-1 h-3 w-3" /> Add Tag
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {tagsList.map(t => (
                  <div key={t.tag_id} className={`flex items-center justify-between ${card} border rounded-md p-2.5`} data-testid={`tag-row-${t.tag_id}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                      <span className={`${textPri} text-sm`}>{t.name}</span>
                    </div>
                    <div className="flex">
                      <Button size="sm" variant="ghost" onClick={() => openEditTag(t)} className={`${textSec} h-7 px-1.5`}><Edit2 className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteTag(t)} className="text-red-400 h-7 px-1.5"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                ))}
                {tagsList.length === 0 && <p className={`text-xs ${textMuted} col-span-full text-center py-6`}>No tags yet — create one to start segmenting leads</p>}
              </div>
            </div>

            {/* Campaign Section */}
            <div className={`${card} border rounded-md p-5`}>
              <h2 className={`text-lg font-medium ${textPri} mb-1`}>WhatsApp Campaign by Tag</h2>
              <p className={`text-xs ${textMuted} mb-4`}>Select a tag and a template to send a WhatsApp message to all leads with that tag.</p>
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <Label className={`${textSec} text-xs`}>Tag</Label>
                  <select value={campaignTag} onChange={e => setCampaignTag(e.target.value)} className={`mt-1 h-9 px-3 rounded text-sm ${inputCls} block w-48`}>
                    <option value="">Select tag...</option>
                    {tagsList.map(t => <option key={t.tag_id} value={t.tag_id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label className={`${textSec} text-xs`}>WhatsApp Template</Label>
                  <select value={campaignTemplate} onChange={e => setCampaignTemplate(e.target.value)} className={`mt-1 h-9 px-3 rounded text-sm ${inputCls} block w-56`}>
                    <option value="">Select template...</option>
                    {templatesList.map(t => <option key={t.template_id} value={t.template_id}>{t.name}</option>)}
                  </select>
                </div>
                <Button onClick={sendCampaign} disabled={campaignSending} className="bg-green-600 hover:bg-green-700 text-white h-9">
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  {campaignSending ? 'Sending...' : 'Send Campaign'}
                </Button>
              </div>
              {campaignTag && (
                <p className={`text-xs ${textMuted} mt-3`}>
                  Will send to all leads tagged <strong className={textPri}>{tagsList.find(t => t.tag_id === campaignTag)?.name}</strong> that have a phone number.
                </p>
              )}
            </div>
          </div>
        )}

        {/* TAG DIALOG */}
        <Dialog open={tagOpen} onOpenChange={setTagOpen}>
          <DialogContent className={`${dlgCls} max-w-sm`}>
            <DialogHeader><DialogTitle className={textPri}>{editTag ? 'Edit Tag' : 'Add Tag'}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label className={`${textSec} text-xs`}>Tag Name *</Label><Input value={tagForm.name} onChange={e => setTagForm({...tagForm, name: e.target.value})} className={inputCls} placeholder="e.g. Hot Prospect" /></div>
              <div>
                <Label className={`${textSec} text-xs`}>Color</Label>
                <div className="flex items-center gap-3 mt-1">
                  <input type="color" value={tagForm.color} onChange={e => setTagForm({...tagForm, color: e.target.value})} className="w-10 h-10 rounded cursor-pointer border border-[var(--border-color)]" />
                  <div className="flex gap-1.5 flex-wrap">
                    {['#e94560','#10b981','#6366f1','#f59e0b','#3b82f6','#ec4899','#14b8a6','#ef4444'].map(c => (
                      <button key={c} onClick={() => setTagForm({...tagForm, color: c})} className={`w-6 h-6 rounded-full border-2 ${tagForm.color === c ? 'border-white scale-110' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTagOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={saveTag} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{editTag ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* GROUP DIALOG */}
        <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-lg max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>{editGroup ? 'Edit Group' : 'Add Group'}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label className={`${textSec} text-xs`}>Group Name *</Label><Input value={groupForm.group_name} onChange={e => setGroupForm({...groupForm, group_name: e.target.value})} className={inputCls} placeholder="e.g. DPS Group" data-testid="group-name-input" /></div>
              <div><Label className={`${textSec} text-xs`}>Chairman / Owner</Label><Input value={groupForm.chairman_name} onChange={e => setGroupForm({...groupForm, chairman_name: e.target.value})} className={inputCls} placeholder="Mr. Sharma" /></div>
              <div><Label className={`${textSec} text-xs`}>Head Office Address</Label><Input value={groupForm.head_office_address} onChange={e => setGroupForm({...groupForm, head_office_address: e.target.value})} className={inputCls} placeholder="New Delhi, India" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Contact Number</Label><Input value={groupForm.contact_number} onChange={e => setGroupForm({...groupForm, contact_number: e.target.value})} className={inputCls} placeholder="+91 98xxxxxxxx" /></div>
                <div><Label className={`${textSec} text-xs`}>Email</Label><Input type="email" value={groupForm.email} onChange={e => setGroupForm({...groupForm, email: e.target.value})} className={inputCls} placeholder="info@dpsgroup.in" /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setGroupOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={saveGroup} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-group-btn">{editGroup ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* SOURCE DIALOG */}
        <Dialog open={srcOpen} onOpenChange={setSrcOpen}>
          <DialogContent className={`${dlgCls} max-w-sm`}>
            <DialogHeader><DialogTitle className={textPri}>{editSrc ? 'Edit Source' : 'Add Source'}</DialogTitle></DialogHeader>
            <div className="py-2">
              <Label className={`${textSec} text-xs`}>Source Name *</Label>
              <Input value={srcForm.name} onChange={e => setSrcForm({ name: e.target.value })} className={inputCls} placeholder="e.g. Exhibition" data-testid="source-name-input" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSrcOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={saveSrc} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-source-btn">{editSrc ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ROLE DIALOG */}
        <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
          <DialogContent className={`${dlgCls} max-w-sm`}>
            <DialogHeader><DialogTitle className={textPri}>{editRole ? 'Edit Role' : 'Add Contact Role'}</DialogTitle></DialogHeader>
            <div className="py-2">
              <Label className={`${textSec} text-xs`}>Role Name *</Label>
              <Input value={roleForm.name} onChange={e => setRoleForm({ name: e.target.value })} className={inputCls} placeholder="e.g. Principal" data-testid="role-name-input" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRoleOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={saveRole} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-role-btn">{editRole ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

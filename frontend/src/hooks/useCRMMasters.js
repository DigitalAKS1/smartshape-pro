import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  groups as groupsApi,
  sources as sourcesApi,
  contactRoles as contactRolesApi,
  tags as tagsApi,
  whatsappTemplates,
  broadcastApi,
  designations as designationsApi,
  dealTypes as dealTypesApi,
} from '../lib/api';

export function useCRMMasters() {
  const [loading, setLoading] = useState(true);
  const [groupsList, setGroupsList] = useState([]);
  const [sourcesList, setSourcesList] = useState([]);
  const [rolesList, setRolesList] = useState([]);
  const [tagsList, setTagsList] = useState([]);
  const [templatesList, setTemplatesList] = useState([]);
  const [designationsList, setDesignationsList] = useState([]);

  // Dialog / form state — groups
  const [groupOpen, setGroupOpen] = useState(false);
  const [editGroup, setEditGroup] = useState(null);
  const [groupForm, setGroupForm] = useState({ group_name: '', head_office_address: '', chairman_name: '', contact_number: '', email: '' });

  // sources
  const [srcOpen, setSrcOpen] = useState(false);
  const [editSrc, setEditSrc] = useState(null);
  const [srcForm, setSrcForm] = useState({ name: '' });

  // deal types
  const [dealTypesList, setDealTypesList] = useState([]);
  const [dtOpen, setDtOpen] = useState(false);
  const [editDt, setEditDt] = useState(null);
  const [dtForm, setDtForm] = useState({ name: '' });

  // roles
  const [roleOpen, setRoleOpen] = useState(false);
  const [editRole, setEditRole] = useState(null);
  const [roleForm, setRoleForm] = useState({ name: '' });

  // tags
  const [tagOpen, setTagOpen] = useState(false);
  const [editTag, setEditTag] = useState(null);
  const [tagForm, setTagForm] = useState({ name: '', color: '#6366f1' });

  // designations
  const [desOpen, setDesOpen] = useState(false);
  const [editDes, setEditDes] = useState(null);
  const [desForm, setDesForm] = useState({ name: '', department: '' });

  // campaign
  const [campaignTag, setCampaignTag] = useState('');
  const [campaignTemplate, setCampaignTemplate] = useState('');
  const [campaignSending, setCampaignSending] = useState(false);

  const fetchAll = async () => {
    try {
      const [g, s, r, t, tmpl, des, dt] = await Promise.all([
        groupsApi.getAll(),
        sourcesApi.getAll(),
        contactRolesApi.getAll(),
        tagsApi.getAll(),
        whatsappTemplates.getAll().catch(() => ({ data: [] })),
        designationsApi.getAll().catch(() => ({ data: [] })),
        dealTypesApi.getAll().catch(() => ({ data: [] })),
      ]);
      setGroupsList(g.data || []);
      setSourcesList(s.data || []);
      setRolesList(r.data || []);
      setTagsList(t.data || []);
      setTemplatesList(tmpl.data || []);
      setDesignationsList(des.data || []);
      setDealTypesList(dt.data || []);
    } catch { toast.error('Failed to load masters'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  // ── Groups ──────────────────────────────────────────────────────────────────
  const openNewGroup = () => {
    setEditGroup(null);
    setGroupForm({ group_name: '', head_office_address: '', chairman_name: '', contact_number: '', email: '' });
    setGroupOpen(true);
  };
  const openEditGroup = (g) => {
    setEditGroup(g);
    setGroupForm({ group_name: g.group_name || '', head_office_address: g.head_office_address || '', chairman_name: g.chairman_name || '', contact_number: g.contact_number || '', email: g.email || '' });
    setGroupOpen(true);
  };
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

  // ── Sources ─────────────────────────────────────────────────────────────────
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

  // ── Deal Types ──────────────────────────────────────────────────────────────
  const openNewDt = () => { setEditDt(null); setDtForm({ name: '' }); setDtOpen(true); };
  const openEditDt = (d) => { setEditDt(d); setDtForm({ name: d.name || '' }); setDtOpen(true); };
  const saveDt = async () => {
    if (!dtForm.name) { toast.error('Deal type name required'); return; }
    try {
      if (editDt) await dealTypesApi.update(editDt.deal_type_id, dtForm);
      else await dealTypesApi.create(dtForm);
      toast.success(editDt ? 'Deal type updated' : 'Deal type created');
      setDtOpen(false); fetchAll();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const deleteDt = async (d) => {
    if (!window.confirm(`Delete deal type "${d.name}"?`)) return;
    try { await dealTypesApi.delete(d.deal_type_id); toast.success('Deleted'); fetchAll(); }
    catch { toast.error('Delete failed'); }
  };

  // ── Roles ───────────────────────────────────────────────────────────────────
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

  // ── Designations ─────────────────────────────────────────────────────────────
  const openNewDes = () => { setEditDes(null); setDesForm({ name: '', department: '' }); setDesOpen(true); };
  const openEditDes = (d) => { setEditDes(d); setDesForm({ name: d.name || '', department: d.department || '' }); setDesOpen(true); };
  const saveDes = async () => {
    if (!desForm.name) { toast.error('Designation name required'); return; }
    try {
      if (editDes) await designationsApi.update(editDes.designation_id, desForm);
      else await designationsApi.create(desForm);
      toast.success(editDes ? 'Designation updated' : 'Designation created');
      setDesOpen(false); fetchAll();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const deleteDes = async (d) => {
    if (!window.confirm(`Delete designation "${d.name}"?`)) return;
    try { await designationsApi.delete(d.designation_id); toast.success('Deleted'); fetchAll(); }
    catch { toast.error('Delete failed'); }
  };

  // ── Tags ────────────────────────────────────────────────────────────────────
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

  // ── Campaign ────────────────────────────────────────────────────────────────
  const sendCampaign = async () => {
    if (!campaignTag) { toast.error('Select a tag'); return; }
    if (!campaignTemplate) { toast.error('Select a WhatsApp template'); return; }
    const tagName = tagsList.find(t => t.tag_id === campaignTag)?.name || 'this tag';
    if (!window.confirm(`Send this WhatsApp template to ALL leads tagged "${tagName}" that have a phone number?\n\nThis sends real messages and cannot be undone.`)) return;
    setCampaignSending(true);
    try {
      const res = await broadcastApi.byTag({ tag_id: campaignTag, template_id: campaignTemplate });
      toast.success(`Campaign sent: ${res.data.sent} delivered, ${res.data.failed} failed, ${res.data.skipped} skipped (no phone)`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Campaign failed');
    } finally { setCampaignSending(false); }
  };

  return {
    loading,
    // data
    groupsList, sourcesList, rolesList, tagsList, templatesList, designationsList, dealTypesList,
    // group dialog
    groupOpen, setGroupOpen, editGroup, groupForm, setGroupForm,
    openNewGroup, openEditGroup, saveGroup, deleteGroup,
    // source dialog
    srcOpen, setSrcOpen, editSrc, srcForm, setSrcForm,
    openNewSrc, openEditSrc, saveSrc, deleteSrc,
    // deal-type dialog
    dtOpen, setDtOpen, editDt, dtForm, setDtForm,
    openNewDt, openEditDt, saveDt, deleteDt,
    // role dialog
    roleOpen, setRoleOpen, editRole, roleForm, setRoleForm,
    openNewRole, openEditRole, saveRole, deleteRole,
    // designation dialog
    desOpen, setDesOpen, editDes, desForm, setDesForm,
    openNewDes, openEditDes, saveDes, deleteDes,
    // tag dialog
    tagOpen, setTagOpen, editTag, tagForm, setTagForm,
    openNewTag, openEditTag, saveTag, deleteTag,
    // campaign
    campaignTag, setCampaignTag,
    campaignTemplate, setCampaignTemplate,
    campaignSending, sendCampaign,
  };
}

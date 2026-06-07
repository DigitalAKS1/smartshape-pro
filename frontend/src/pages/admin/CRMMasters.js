import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Plus, Building2, Tag, UserCheck, Send, Briefcase, Edit2, Trash2, SlidersHorizontal, Package } from 'lucide-react';
import { toast } from 'sonner';
import { useCRMMasters } from '../../hooks/useCRMMasters';
import { pipelineSettings, schoolTypes as schoolTypesApi, interestedProducts as interestedProductsApi } from '../../lib/api';
import { STAGES } from '../../lib/crmConstants';
import MasterEntityTable from '../../components/crm/MasterEntityTable';

const TABS = [
  { id: 'groups',       label: 'Group Master',        icon: Building2, desc: 'Trusts / parent organisations that own multiple schools' },
  { id: 'sources',      label: 'Source Master',        icon: Tag,       desc: 'Where leads / contacts come from (Call, Exhibition, Ads, ...)' },
  { id: 'roles',        label: 'Contact Roles',        icon: UserCheck, desc: 'Role / designation taxonomy for school contacts (Principal, Trustee, Director, ...)' },
  { id: 'designations', label: 'Designation Master',   icon: Briefcase, desc: 'Job designations for school contacts — CEO, Principal, Vice Principal, Coordinator, ...' },
  { id: 'tags',         label: 'Tag Master',           icon: Tag,       desc: 'Color-coded tags to segment leads and run targeted WhatsApp / email campaigns' },
  { id: 'schooltypes',  label: 'School Types',         icon: Building2, desc: 'Board / type options shown in school forms — CBSE, ICSE, IB, Cambridge, ...' },
  { id: 'products',     label: 'Interested Products',  icon: Package,   desc: 'Individual / "Other" products captured on lead forms. Packages are the primary options; these accumulate from rep input — prune typos and one-offs here.' },
  { id: 'pipeline',     label: 'Pipeline Settings',    icon: SlidersHorizontal, desc: 'Win probability per stage, idle limits before a lead is "stuck", lost reasons, and the daily digest' },
];

const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
const inputCls  = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const textPri   = 'text-[var(--text-primary)]';
const textSec   = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';
const dlgCls    = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

// Accent-tinted count pill shown beside a master's title.
const CountPill = ({ n }) => (
  <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full text-xs font-semibold bg-[var(--accent-bg)] text-[#e94560]">{n}</span>
);

// Crafted empty state for name-only master tabs — icon chip + headline + subtext.
const MasterEmpty = ({ icon: Icon, title, sub }) => (
  <div className="col-span-full flex flex-col items-center text-center py-12 px-4">
    <div className="w-14 h-14 rounded-2xl bg-[var(--accent-bg)] flex items-center justify-center mb-3.5">
      <Icon className="h-6 w-6 text-[#e94560]" />
    </div>
    <p className={`text-sm font-semibold ${textPri}`}>{title}</p>
    <p className={`text-xs ${textMuted} mt-1 max-w-xs leading-relaxed`}>{sub}</p>
  </div>
);

// Shared classes for the interactive name chips (hover = crimson affordance + lift).
const chipCls = `flex items-center justify-between ${card} border rounded-md p-2.5 transition-all hover:border-[#e94560]/40 hover:shadow-[var(--shadow-sm)]`;

export default function CRMMasters() {
  const [activeTab, setActiveTab] = useState('groups');
  const m = useCRMMasters();

  // Pipeline settings (Phase 1)
  const [pipe, setPipe] = useState(null);
  const [pipeSaving, setPipeSaving] = useState(false);
  useEffect(() => { pipelineSettings.get().then(r => setPipe(r.data)).catch(() => {}); }, []);
  const savePipe = async () => {
    setPipeSaving(true);
    try {
      const payload = {
        ...pipe,
        lost_reasons: (Array.isArray(pipe.lost_reasons) ? pipe.lost_reasons : String(pipe.lost_reasons || '').split(','))
          .map(s => s.trim()).filter(Boolean),
      };
      const r = await pipelineSettings.update(payload);
      setPipe(r.data);
      toast.success('Pipeline settings saved');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Save failed');
    } finally { setPipeSaving(false); }
  };

  // School types master
  const [stList, setStList] = useState([]);
  const [newType, setNewType] = useState('');
  const loadTypes = () => schoolTypesApi.getAll().then(r => setStList(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  useEffect(() => { loadTypes(); }, []);
  const addType = async () => {
    const name = newType.trim();
    if (!name) return;
    try {
      // Use the POST response rather than an immediate refetch (which can read a
      // stale Mongo secondary and miss the just-written row).
      const r = await schoolTypesApi.create({ name });
      setNewType('');
      setStList(prev => {
        const list = prev.some(t => t.type_id === r.data.type_id) ? prev : [...prev, r.data];
        return list.slice().sort((a, b) => a.name.localeCompare(b.name));
      });
      toast.success(`Added "${name}"`);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const deleteType = async (t) => {
    if (!window.confirm(`Delete school type "${t.name}"?`)) return;
    try { await schoolTypesApi.delete(t.type_id); setStList(prev => prev.filter(x => x.type_id !== t.type_id)); }
    catch { toast.error('Delete failed'); }
  };

  // Interested products master (custom/individual entries; packages stay the primary options)
  const [ipList, setIpList] = useState([]);
  const [newProduct, setNewProduct] = useState('');
  const loadProducts = () => interestedProductsApi.getAll().then(r => setIpList(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  useEffect(() => { loadProducts(); }, []);
  const addProduct = async () => {
    const name = newProduct.trim();
    if (!name) return;
    try {
      // Use the POST response (authoritative; returns the existing doc on a
      // case-insensitive dupe) instead of an immediate refetch, which can read
      // a stale Mongo secondary and miss the just-written row.
      const r = await interestedProductsApi.create({ name });
      setNewProduct('');
      setIpList(prev => {
        const list = prev.some(p => p.product_id === r.data.product_id) ? prev : [...prev, r.data];
        return list.slice().sort((a, b) => a.name.localeCompare(b.name));
      });
      toast.success(`Added "${name}"`);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };
  const deleteProduct = async (p) => {
    if (!window.confirm(`Delete interested product "${p.name}"?`)) return;
    try { await interestedProductsApi.delete(p.product_id); setIpList(prev => prev.filter(x => x.product_id !== p.product_id)); }
    catch { toast.error('Delete failed'); }
  };

  if (m.loading) return (
    <AdminLayout>
      <div className="flex items-center justify-center h-96">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </AdminLayout>
  );

  const tab = TABS.find(t => t.id === activeTab);

  // Column definitions for each tab's MasterEntityTable
  const groupColumns = [
    { key: 'group_name',         label: 'Group Name',  primary: true },
    { key: 'chairman_name',      label: 'Chairman' },
    { key: 'head_office_address',label: 'Head Office', hidden: 'md' },
    { key: 'contact_number',     label: 'Contact',     hidden: 'sm', mono: true },
  ];

  const desColumns = [
    { key: 'name',       label: 'Designation', primary: true },
    { key: 'department', label: 'Department',  hidden: 'sm' },
    {
      key: 'is_active', label: 'Status',
      render: (d) => (
        <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${d.is_active !== false ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'}`}>
          {d.is_active !== false ? 'Active' : 'Inactive'}
        </span>
      ),
    },
  ];

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="crm-masters-title">CRM Masters</h1>
          <p className={`${textSec} mt-1 text-sm`}>Manage the shared lists — groups, sources, roles, products, tags — that power every CRM dropdown and the lead pipeline.</p>
        </div>

        {/* Tabs — single-line, content-sized, scrolls horizontally on overflow */}
        <div className={`${card} border rounded-md p-1 flex gap-1 overflow-x-auto no-scrollbar`}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} data-testid={`tab-${t.id}`}
              className={`flex-shrink-0 flex items-center justify-center gap-1.5 px-3.5 py-2 rounded text-sm font-medium whitespace-nowrap transition-all ${activeTab === t.id ? 'bg-[#e94560] text-white shadow-[var(--shadow-sm)]' : `${textSec} hover:bg-[var(--bg-hover)]`}`}>
              <t.icon className="h-4 w-4 shrink-0" /> {t.label}
            </button>
          ))}
        </div>
        <p className={`text-xs ${textMuted}`}>{tab?.desc}</p>

        {/* GROUPS */}
        {activeTab === 'groups' && (
          <div className={`${card} border rounded-md p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-medium ${textPri} flex items-center gap-2`}>Groups <CountPill n={m.groupsList.length} /></h2>
              <Button onClick={m.openNewGroup} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-group-btn">
                <Plus className="mr-1 h-3 w-3" /> Add Group
              </Button>
            </div>
            <MasterEntityTable
              columns={groupColumns}
              data={m.groupsList}
              rowKey="group_id"
              onEdit={m.openEditGroup}
              onDelete={m.deleteGroup}
              emptyMsg="No groups yet — click Add Group to create the first one."
              testIdPrefix="group"
            />
          </div>
        )}

        {/* SOURCES */}
        {activeTab === 'sources' && (
          <div className={`${card} border rounded-md p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-medium ${textPri} flex items-center gap-2`}>Sources <CountPill n={m.sourcesList.length} /></h2>
              <Button onClick={m.openNewSrc} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-source-btn">
                <Plus className="mr-1 h-3 w-3" /> Add Source
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {m.sourcesList.map(s => (
                <div key={s.source_id} className={chipCls} data-testid={`source-row-${s.source_id}`}>
                  <span className={`${textPri} text-sm`}>{s.name}</span>
                  <div className="flex">
                    <Button size="sm" variant="ghost" onClick={() => m.openEditSrc(s)} className={`${textSec} h-7 px-1.5`} data-testid={`edit-source-${s.source_id}`}><Edit2 className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => m.deleteSrc(s)} className="text-red-400 h-7 px-1.5" data-testid={`delete-source-${s.source_id}`}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
              {m.sourcesList.length === 0 && <MasterEmpty icon={Tag} title="No sources yet" sub="Add where your leads come from — Call, Exhibition, Website, Referral — to track and filter by channel." />}
            </div>
          </div>
        )}

        {/* ROLES */}
        {activeTab === 'roles' && (
          <div className={`${card} border rounded-md p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-medium ${textPri} flex items-center gap-2`}>Contact Roles <CountPill n={m.rolesList.length} /></h2>
              <Button onClick={m.openNewRole} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-role-btn">
                <Plus className="mr-1 h-3 w-3" /> Add Role
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {m.rolesList.map(r => (
                <div key={r.role_id} className={chipCls} data-testid={`role-row-${r.role_id}`}>
                  <span className={`${textPri} text-sm`}>{r.name}</span>
                  <div className="flex">
                    <Button size="sm" variant="ghost" onClick={() => m.openEditRole(r)} className={`${textSec} h-7 px-1.5`} data-testid={`edit-role-${r.role_id}`}><Edit2 className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => m.deleteRole(r)} className="text-red-400 h-7 px-1.5" data-testid={`delete-role-${r.role_id}`}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
              {m.rolesList.length === 0 && <MasterEmpty icon={UserCheck} title="No contact roles yet" sub="Add the role taxonomy for school contacts — Principal, Trustee, Director — used across CRM forms." />}
            </div>
          </div>
        )}

        {/* DESIGNATIONS */}
        {activeTab === 'designations' && (
          <div className={`${card} border rounded-md p-5`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className={`text-lg font-medium ${textPri} flex items-center gap-2`}>Designation Master <CountPill n={m.designationsList.length} /></h2>
                <p className={`text-xs ${textMuted} mt-0.5`}>Job titles used in contact forms — CEO, Principal, Coordinator, etc.</p>
              </div>
              <Button onClick={m.openNewDes} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                <Plus className="mr-1 h-3 w-3" /> Add Designation
              </Button>
            </div>
            <MasterEntityTable
              columns={desColumns}
              data={m.designationsList}
              rowKey="designation_id"
              onEdit={m.openEditDes}
              onDelete={m.deleteDes}
              emptyMsg="No designations yet — click Add Designation to create the first one."
            />
          </div>
        )}

        {/* TAGS */}
        {activeTab === 'tags' && (
          <div className="space-y-4">
            <div className={`${card} border rounded-md p-5`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-lg font-medium ${textPri} flex items-center gap-2`}>Tags <CountPill n={m.tagsList.length} /></h2>
                <Button onClick={m.openNewTag} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-tag-btn">
                  <Plus className="mr-1 h-3 w-3" /> Add Tag
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {m.tagsList.map(t => (
                  <div key={t.tag_id} className={chipCls} data-testid={`tag-row-${t.tag_id}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                      <span className={`${textPri} text-sm`}>{t.name}</span>
                    </div>
                    <div className="flex">
                      <Button size="sm" variant="ghost" onClick={() => m.openEditTag(t)} className={`${textSec} h-7 px-1.5`}><Edit2 className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => m.deleteTag(t)} className="text-red-400 h-7 px-1.5"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                ))}
                {m.tagsList.length === 0 && <MasterEmpty icon={Tag} title="No tags yet" sub="Create color-coded tags to segment leads and run targeted WhatsApp / email campaigns." />}
              </div>
            </div>

            {/* Campaign Section */}
            <div className={`${card} border rounded-md p-5`}>
              <h2 className={`text-lg font-medium ${textPri} mb-1`}>WhatsApp Campaign by Tag</h2>
              <p className={`text-xs ${textMuted} mb-4`}>Select a tag and a template to send a WhatsApp message to all leads with that tag.</p>
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <Label className={`${textSec} text-xs`}>Tag</Label>
                  <select value={m.campaignTag} onChange={e => m.setCampaignTag(e.target.value)} className={`mt-1 h-9 px-3 rounded text-sm ${inputCls} block w-48`}>
                    <option value="">Select tag...</option>
                    {m.tagsList.map(t => <option key={t.tag_id} value={t.tag_id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label className={`${textSec} text-xs`}>WhatsApp Template</Label>
                  <select value={m.campaignTemplate} onChange={e => m.setCampaignTemplate(e.target.value)} className={`mt-1 h-9 px-3 rounded text-sm ${inputCls} block w-56`}>
                    <option value="">Select template...</option>
                    {m.templatesList.map(t => <option key={t.template_id} value={t.template_id}>{t.name}</option>)}
                  </select>
                </div>
                <Button onClick={m.sendCampaign} disabled={m.campaignSending} className="bg-green-600 hover:bg-green-700 text-white h-9">
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  {m.campaignSending ? 'Sending...' : 'Send Campaign'}
                </Button>
              </div>
              {m.campaignTag && (
                <p className={`text-xs ${textMuted} mt-3`}>
                  Will send to all leads tagged <strong className={textPri}>{m.tagsList.find(t => t.tag_id === m.campaignTag)?.name}</strong> that have a phone number.
                </p>
              )}
            </div>
          </div>
        )}

        {/* PIPELINE SETTINGS */}
        {activeTab === 'pipeline' && (
          <div className={`${card} border rounded-md p-5 space-y-6`}>
            {!pipe ? (
              <p className={`text-sm ${textMuted} text-center py-6`}>Loading settings…</p>
            ) : (
              <>
                <div>
                  <h2 className={`text-lg font-medium ${textPri} mb-1`}>Win probability & idle limits per stage</h2>
                  <p className={`text-xs ${textMuted} mb-3`}>Probability drives the weighted forecast. Idle limit = days without activity before a lead is flagged "stuck".</p>
                  <div className="space-y-2">
                    {STAGES.map(s => (
                      <div key={s.id} className="flex items-center gap-3">
                        <span className={`w-28 text-sm ${textPri}`}>{s.label}</span>
                        <div className="flex items-center gap-1">
                          <Input type="number" min="0" max="100" value={pipe.stage_probabilities?.[s.id] ?? 0}
                            onChange={e => setPipe({ ...pipe, stage_probabilities: { ...pipe.stage_probabilities, [s.id]: parseInt(e.target.value) || 0 } })}
                            className={`${inputCls} w-20 h-8`} />
                          <span className={`text-xs ${textMuted}`}>% win</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Input type="number" min="0" value={pipe.stage_idle_limits?.[s.id] ?? ''}
                            onChange={e => setPipe({ ...pipe, stage_idle_limits: { ...pipe.stage_idle_limits, [s.id]: e.target.value === '' ? '' : (parseInt(e.target.value) || 0) } })}
                            className={`${inputCls} w-20 h-8`} placeholder="—" />
                          <span className={`text-xs ${textMuted}`}>days idle</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className={`${textSec} text-xs`}>Lost reasons (comma-separated)</Label>
                    <Input value={Array.isArray(pipe.lost_reasons) ? pipe.lost_reasons.join(', ') : (pipe.lost_reasons || '')}
                      onChange={e => setPipe({ ...pipe, lost_reasons: e.target.value })}
                      className={inputCls} placeholder="Price, Competitor, No budget…" />
                  </div>
                  <div>
                    <Label className={`${textSec} text-xs`}>Daily digest time (IST)</Label>
                    <Input type="time" value={pipe.digest_time || '08:00'}
                      onChange={e => setPipe({ ...pipe, digest_time: e.target.value })}
                      className={inputCls} />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" id="digest-enabled" checked={!!pipe.digest_enabled}
                    onChange={e => setPipe({ ...pipe, digest_enabled: e.target.checked })} className="rounded" />
                  <label htmlFor="digest-enabled" className={`text-sm ${textSec}`}>
                    Send the daily "needs attention" digest to reps + admin
                  </label>
                </div>
                <p className={`text-xs ${textMuted} -mt-3`}>Leave off until WhatsApp/email recipients are verified — it sends real messages.</p>

                <div className="flex justify-end">
                  <Button onClick={savePipe} disabled={pipeSaving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-pipeline-settings-btn">
                    {pipeSaving ? 'Saving…' : 'Save Pipeline Settings'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* SCHOOL TYPES */}
        {activeTab === 'schooltypes' && (
          <div className={`${card} border rounded-md p-5`}>
            <div className="flex items-center justify-between mb-4 gap-2">
              <h2 className={`text-lg font-medium ${textPri} flex items-center gap-2`}>School Types <CountPill n={stList.length} /></h2>
              <div className="flex gap-2">
                <Input value={newType} onChange={e => setNewType(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addType(); }}
                  placeholder="e.g. Cambridge" className={`${inputCls} h-9 text-sm w-44`} data-testid="new-school-type-input" />
                <Button onClick={addType} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-school-type-btn">
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {stList.map(t => (
                <div key={t.type_id} className={chipCls} data-testid={`school-type-row-${t.type_id}`}>
                  <span className={`${textPri} text-sm`}>{t.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => deleteType(t)} className="text-red-400 h-7 px-1.5" data-testid={`delete-school-type-${t.type_id}`}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {stList.length === 0 && <MasterEmpty icon={Building2} title="No school types yet" sub="Add a board or type above (e.g. Cambridge) — it'll appear in every school form's dropdown." />}
            </div>
          </div>
        )}

        {/* INTERESTED PRODUCTS */}
        {activeTab === 'products' && (
          <div className={`${card} border rounded-md p-5`}>
            <div className="flex items-center justify-between mb-4 gap-2">
              <h2 className={`text-lg font-medium ${textPri} flex items-center gap-2`}>Interested Products <CountPill n={ipList.length} /></h2>
              <div className="flex gap-2">
                <Input value={newProduct} onChange={e => setNewProduct(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addProduct(); }}
                  placeholder="e.g. Smart Board" className={`${inputCls} h-9 text-sm w-44`} data-testid="new-interested-product-input" />
                <Button onClick={addProduct} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-interested-product-btn">
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              </div>
            </div>
            <p className={`text-xs ${textMuted} mb-3`}>Packages (from Package Master) are always the primary options on lead forms — these are the extra "Individual / Other" entries reps have typed in. Delete duplicates or typos to keep the dropdown clean.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {ipList.map(p => (
                <div key={p.product_id} className={chipCls} data-testid={`interested-product-row-${p.product_id}`}>
                  <span className={`${textPri} text-sm`}>{p.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => deleteProduct(p)} className="text-red-400 h-7 px-1.5" data-testid={`delete-interested-product-${p.product_id}`}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {ipList.length === 0 && <MasterEmpty icon={Package} title="No custom products yet" sub={'These build up automatically as reps pick "Individual / Other…" on lead forms. Packages stay the primary options.'} />}
            </div>
          </div>
        )}

        {/* ── DIALOGS ─────────────────────────────────────────────────────── */}

        {/* TAG DIALOG */}
        <Dialog open={m.tagOpen} onOpenChange={m.setTagOpen}>
          <DialogContent className={`${dlgCls} max-w-sm`}>
            <DialogHeader><DialogTitle className={textPri}>{m.editTag ? 'Edit Tag' : 'Add Tag'}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label className={`${textSec} text-xs`}>Tag Name *</Label>
                <Input value={m.tagForm.name} onChange={e => m.setTagForm({...m.tagForm, name: e.target.value})} className={inputCls} placeholder="e.g. Hot Prospect" />
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Color</Label>
                <div className="flex items-center gap-3 mt-1">
                  <input type="color" value={m.tagForm.color} onChange={e => m.setTagForm({...m.tagForm, color: e.target.value})} className="w-10 h-10 rounded cursor-pointer border border-[var(--border-color)]" />
                  <div className="flex gap-1.5 flex-wrap">
                    {['#e94560','#10b981','#6366f1','#f59e0b','#3b82f6','#ec4899','#14b8a6','#ef4444'].map(c => (
                      <button key={c} onClick={() => m.setTagForm({...m.tagForm, color: c})} className={`w-6 h-6 rounded-full border-2 ${m.tagForm.color === c ? 'border-white scale-110' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => m.setTagOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={m.saveTag} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{m.editTag ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* GROUP DIALOG */}
        <Dialog open={m.groupOpen} onOpenChange={m.setGroupOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-lg max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>{m.editGroup ? 'Edit Group' : 'Add Group'}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label className={`${textSec} text-xs`}>Group Name *</Label><Input value={m.groupForm.group_name} onChange={e => m.setGroupForm({...m.groupForm, group_name: e.target.value})} className={inputCls} placeholder="e.g. DPS Group" data-testid="group-name-input" /></div>
              <div><Label className={`${textSec} text-xs`}>Chairman / Owner</Label><Input value={m.groupForm.chairman_name} onChange={e => m.setGroupForm({...m.groupForm, chairman_name: e.target.value})} className={inputCls} placeholder="Mr. Sharma" /></div>
              <div><Label className={`${textSec} text-xs`}>Head Office Address</Label><Input value={m.groupForm.head_office_address} onChange={e => m.setGroupForm({...m.groupForm, head_office_address: e.target.value})} className={inputCls} placeholder="New Delhi, India" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Contact Number</Label><Input value={m.groupForm.contact_number} onChange={e => m.setGroupForm({...m.groupForm, contact_number: e.target.value})} className={inputCls} placeholder="+91 98xxxxxxxx" /></div>
                <div><Label className={`${textSec} text-xs`}>Email</Label><Input type="email" value={m.groupForm.email} onChange={e => m.setGroupForm({...m.groupForm, email: e.target.value})} className={inputCls} placeholder="info@dpsgroup.in" /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => m.setGroupOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={m.saveGroup} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-group-btn">{m.editGroup ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* SOURCE DIALOG */}
        <Dialog open={m.srcOpen} onOpenChange={m.setSrcOpen}>
          <DialogContent className={`${dlgCls} max-w-sm`}>
            <DialogHeader><DialogTitle className={textPri}>{m.editSrc ? 'Edit Source' : 'Add Source'}</DialogTitle></DialogHeader>
            <div className="py-2">
              <Label className={`${textSec} text-xs`}>Source Name *</Label>
              <Input value={m.srcForm.name} onChange={e => m.setSrcForm({ name: e.target.value })} className={inputCls} placeholder="e.g. Exhibition" data-testid="source-name-input" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => m.setSrcOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={m.saveSrc} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-source-btn">{m.editSrc ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* DESIGNATION DIALOG */}
        <Dialog open={m.desOpen} onOpenChange={m.setDesOpen}>
          <DialogContent className={`${dlgCls} max-w-sm`}>
            <DialogHeader><DialogTitle className={textPri}>{m.editDes ? 'Edit Designation' : 'Add Designation'}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label className={`${textSec} text-xs`}>Designation Name *</Label>
                <Input value={m.desForm.name} onChange={e => m.setDesForm({ ...m.desForm, name: e.target.value })} className={inputCls} placeholder="e.g. Principal" />
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Department <span className={textMuted}>(optional)</span></Label>
                <Input value={m.desForm.department} onChange={e => m.setDesForm({ ...m.desForm, department: e.target.value })} className={inputCls} placeholder="e.g. Administration" />
              </div>
              {m.editDes && (
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="des-active" checked={m.desForm.is_active !== false} onChange={e => m.setDesForm({ ...m.desForm, is_active: e.target.checked })} className="rounded" />
                  <label htmlFor="des-active" className={`text-sm ${textSec}`}>Active</label>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => m.setDesOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={m.saveDes} className="bg-[#e94560] hover:bg-[#f05c75] text-white">{m.editDes ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ROLE DIALOG */}
        <Dialog open={m.roleOpen} onOpenChange={m.setRoleOpen}>
          <DialogContent className={`${dlgCls} max-w-sm`}>
            <DialogHeader><DialogTitle className={textPri}>{m.editRole ? 'Edit Role' : 'Add Contact Role'}</DialogTitle></DialogHeader>
            <div className="py-2">
              <Label className={`${textSec} text-xs`}>Role Name *</Label>
              <Input value={m.roleForm.name} onChange={e => m.setRoleForm({ name: e.target.value })} className={inputCls} placeholder="e.g. Principal" data-testid="role-name-input" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => m.setRoleOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
              <Button onClick={m.saveRole} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-role-btn">{m.editRole ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </AdminLayout>
  );
}

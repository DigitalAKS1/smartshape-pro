import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { modules as modulesApi, designations as desgApi } from '../../lib/api';
import { Switch } from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { toast } from 'sonner';
import { Layers, Shield, Plus, Edit2, Trash2, Users, Check } from 'lucide-react';

export default function ModuleMaster() {
  const [modules, setModules] = useState([]);
  const [designationsList, setDesignationsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('designations');
  // Designation form
  const [desgOpen, setDesgOpen] = useState(false);
  const [editDesg, setEditDesg] = useState(null);
  const [desgForm, setDesgForm] = useState({ name: '', code: '', role_level: 'sales_person', description: '', default_modules: [] });

  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

  const fetchData = async () => {
    try {
      const [m, d] = await Promise.all([modulesApi.getAll(), desgApi.getAll()]);
      setModules(m.data);
      setDesignationsList(d.data);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const handleModuleToggle = async (mod) => {
    try { await modulesApi.update(mod.module_id, { is_active: !mod.is_active }); toast.success(`${mod.display_name} ${mod.is_active ? 'disabled' : 'enabled'}`); fetchData(); }
    catch { toast.error('Failed'); }
  };

  const openCreateDesg = () => {
    setEditDesg(null);
    setDesgForm({ name: '', code: '', role_level: 'sales_person', description: '', default_modules: [] });
    setDesgOpen(true);
  };
  const openEditDesg = (d) => {
    setEditDesg(d);
    setDesgForm({ name: d.name, code: d.code, role_level: d.role_level, description: d.description || '', default_modules: d.default_modules || [] });
    setDesgOpen(true);
  };
  const handleSaveDesg = async () => {
    if (!desgForm.name || !desgForm.code) { toast.error('Name and code required'); return; }
    try {
      if (editDesg) { await desgApi.update(editDesg.designation_id, desgForm); toast.success('Designation updated'); }
      else { await desgApi.create(desgForm); toast.success('Designation created'); }
      setDesgOpen(false); fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };
  const handleDeleteDesg = async (d) => {
    if (!window.confirm(`Delete "${d.name}"?`)) return;
    try { await desgApi.delete(d.designation_id); toast.success('Deleted'); fetchData(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Cannot delete system designation'); }
  };
  const toggleDesgModule = (modName) => {
    setDesgForm(prev => ({ ...prev, default_modules: prev.default_modules.includes(modName) ? prev.default_modules.filter(m => m !== modName) : [...prev.default_modules, modName] }));
  };

  const getLevelColor = (level) => level === 'admin' ? 'bg-[#e94560]/10 text-[#e94560] border-[#e94560]/30' : 'bg-blue-500/10 text-blue-400 border-blue-500/30';

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" /></div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="module-master-title">Roles & Designations</h1>
            <p className={`${textSec} mt-1 text-sm`}>{designationsList.length} designations • {modules.filter(m => m.is_active).length} active modules</p>
          </div>
          <Button onClick={openCreateDesg} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-designation-btn">
            <Plus className="mr-1 h-3 w-3" /> Create Designation
          </Button>
        </div>

        {/* Tabs */}
        <div className={`flex gap-1 ${card} border rounded-md p-1`}>
          {['designations', 'modules'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 px-4 py-2 rounded text-sm font-medium transition-all capitalize ${activeTab === tab ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              data-testid={`tab-${tab}`}>
              {tab === 'designations' ? `Designations (${designationsList.length})` : `Modules (${modules.length})`}
            </button>
          ))}
        </div>

        {/* DESIGNATIONS TAB */}
        {activeTab === 'designations' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="designations-grid">
            {designationsList.map(d => (
              <div key={d.designation_id} className={`${card} border rounded-lg p-5 hover:-translate-y-0.5 transition-all`} data-testid={`designation-${d.code}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${getLevelColor(d.role_level)}`}>
                      <Shield className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className={`text-sm font-semibold ${textPri}`}>{d.name}</h3>
                      <p className={`text-[10px] font-mono ${textMuted}`}>{d.code}</p>
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    <Button size="sm" variant="ghost" onClick={() => openEditDesg(d)} className={`${textSec} h-7 w-7 p-0`} data-testid={`edit-desg-${d.code}`}><Edit2 className="h-3 w-3" /></Button>
                    {!d.is_system && <Button size="sm" variant="ghost" onClick={() => handleDeleteDesg(d)} className="text-red-400 h-7 w-7 p-0" data-testid={`delete-desg-${d.code}`}><Trash2 className="h-3 w-3" /></Button>}
                  </div>
                </div>
                <p className={`text-xs ${textMuted} mb-3 line-clamp-2`}>{d.description}</p>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${getLevelColor(d.role_level)}`}>
                    {d.role_level === 'admin' ? 'Admin Access' : 'Standard Access'}
                  </span>
                  <span className={`text-xs ${textMuted}`}>{(d.default_modules || []).length} modules</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-[var(--border-color)]">
                  {(d.default_modules || []).slice(0, 5).map(m => (
                    <span key={m} className={`text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-primary)] ${textMuted} border border-[var(--border-color)]`}>{m.replace(/_/g, ' ')}</span>
                  ))}
                  {(d.default_modules || []).length > 5 && <span className={`text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-primary)] ${textMuted}`}>+{d.default_modules.length - 5} more</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* MODULES TAB */}
        {activeTab === 'modules' && (
          <div className={`${card} border rounded-md overflow-hidden`}>
            <div className="p-5 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-3">
                <Layers className="h-5 w-5 text-[#e94560]" />
                <h2 className={`text-lg font-medium ${textPri}`}>Available Modules</h2>
                <span className={`text-xs ${textMuted}`}>({modules.filter(m => m.is_active).length} active / {modules.length} total)</span>
              </div>
              <p className={`text-xs ${textMuted} mt-1`}>Enable/disable modules. Disabled modules cannot be assigned to any designation.</p>
            </div>
            <div className="divide-y divide-[var(--border-color)]" data-testid="modules-list">
              {modules.map((mod) => (
                <div key={mod.module_id} className={`flex items-center justify-between px-5 py-3.5 transition-colors ${mod.is_active ? 'hover:bg-[var(--bg-hover)]' : 'opacity-50'}`} data-testid={`module-row-${mod.name}`}>
                  <div className="flex items-center gap-3">
                    <div>
                      <p className={`${textPri} font-medium text-sm`}>{mod.display_name}</p>
                      <p className={`text-xs font-mono ${textMuted}`}>{mod.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${mod.category === 'admin' ? 'bg-[#e94560]/10 text-[#e94560] border-[#e94560]/30' : 'bg-blue-500/10 text-blue-400 border-blue-500/30'}`}>{mod.category}</span>
                    <Switch checked={mod.is_active} onCheckedChange={() => handleModuleToggle(mod)} data-testid={`module-toggle-${mod.name}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DESIGNATION DIALOG */}
        <Dialog open={desgOpen} onOpenChange={setDesgOpen}>
          <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-lg max-h-[88dvh] overflow-y-auto`}>
            <DialogHeader><DialogTitle className={textPri}>{editDesg ? 'Edit Designation' : 'Create Designation'}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className={`${textSec} text-xs`}>Name *</Label><Input value={desgForm.name} onChange={e => setDesgForm({...desgForm, name: e.target.value})} className={inputCls} placeholder="Sales Head" data-testid="desg-name-input" /></div>
                <div><Label className={`${textSec} text-xs`}>Code *</Label><Input value={desgForm.code} onChange={e => setDesgForm({...desgForm, code: e.target.value.toLowerCase().replace(/\s+/g, '_')})} className={`${inputCls} font-mono`} placeholder="sales_head" disabled={!!editDesg?.is_system} data-testid="desg-code-input" /></div>
              </div>
              <div><Label className={`${textSec} text-xs`}>Description</Label><Input value={desgForm.description} onChange={e => setDesgForm({...desgForm, description: e.target.value})} className={inputCls} placeholder="What this role does..." /></div>
              <div><Label className={`${textSec} text-xs`}>Access Level</Label>
                <select value={desgForm.role_level} onChange={e => setDesgForm({...desgForm, role_level: e.target.value})} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="desg-role-level">
                  <option value="admin">Admin (full dashboard access)</option>
                  <option value="sales_person">Standard (portal access only)</option>
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className={`${textSec} text-xs`}>Default Modules ({desgForm.default_modules.length} selected)</Label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setDesgForm(prev => ({ ...prev, default_modules: modules.filter(m => m.is_active).map(m => m.name) }))} className={`text-[10px] ${textSec} hover:text-[#e94560]`}>Select All</button>
                    <button type="button" onClick={() => setDesgForm(prev => ({ ...prev, default_modules: [] }))} className={`text-[10px] ${textSec} hover:text-[#e94560]`}>Clear</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto border border-[var(--border-color)] rounded-md p-2 bg-[var(--bg-primary)]">
                  {modules.filter(m => m.is_active).map(mod => {
                    const checked = desgForm.default_modules.includes(mod.name);
                    return (
                      <label key={mod.name} className={`flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${checked ? 'bg-[#e94560]/10 text-[#e94560]' : `${textMuted} hover:bg-[var(--bg-hover)]`}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleDesgModule(mod.name)} className="rounded border-[var(--border-color)] h-3 w-3" />
                        <span className="truncate">{mod.display_name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDesgOpen(false)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
              <Button onClick={handleSaveDesg} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="save-designation-btn">{editDesg ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

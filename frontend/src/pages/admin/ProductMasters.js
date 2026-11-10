import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Package, Tag } from 'lucide-react';
import AdminLayout from '../../components/layouts/AdminLayout';
import LookupListEditor from '../../components/masters/LookupListEditor';
import { lookups as lookupsApi } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

const DEFAULT_LISTS = [
  { key: 'product_category', label: 'Product Category', group: 'product' },
  { key: 'package_type', label: 'Package Type', group: 'product' },
];
const DESC = {
  product_category: 'Die / product categories — used on the product form, inventory filter chips and CSV import.',
  package_type: 'Kinds of package — Machine + Dies Combo, Dies Only, … — chosen on each package in Package Master.',
};
const ICON = { product_category: Tag, package_type: Package };

export default function ProductMasters() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.team === 'admin';
  const [lists, setLists] = useState(DEFAULT_LISTS);
  const [active, setActive] = useState(DEFAULT_LISTS[0].key);

  useEffect(() => {
    lookupsApi.lists()
      .then(r => {
        const prod = (r.data || []).filter(l => l.group === 'product');
        if (prod.length) setLists(prod);
      })
      .catch(() => {});
  }, []);

  const current = lists.find(l => l.key === active) || lists[0];

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl sm:text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="product-masters-title">Product Masters</h1>
            <p className="text-[var(--text-secondary)] mt-1 text-sm">Shared lists for products and packages. Add once here — every form picks them up.</p>
          </div>
          <button onClick={() => navigate('/product-types')} className="text-sm text-[#e94560] hover:underline flex items-center gap-1">
            <Layers className="h-4 w-4" /> Product types
          </button>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-1 flex gap-1 overflow-x-auto no-scrollbar">
          {lists.map(l => {
            const Icon = ICON[l.key] || Tag;
            return (
              <button key={l.key} onClick={() => setActive(l.key)} data-testid={`tab-${l.key}`}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded text-sm font-medium whitespace-nowrap transition-all ${active === l.key ? 'bg-[#e94560] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
                <Icon className="h-4 w-4" /> {l.label}
              </button>
            );
          })}
        </div>
        {DESC[current.key] && <p className="text-xs text-[var(--text-muted)]">{DESC[current.key]}</p>}

        <LookupListEditor key={current.key} listKey={current.key} title={current.label} canEdit={canEdit} />
      </div>
    </AdminLayout>
  );
}

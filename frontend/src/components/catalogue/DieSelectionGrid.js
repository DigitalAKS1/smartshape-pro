import React from 'react';
import { Check, Minus, Plus, PlayCircle } from 'lucide-react';
import MediaGallery from '../media/MediaGallery';

/**
 * The die-selection grid extracted from CataloguePage.js so both the public
 * catalogue-token page and the School Portal's own picker (no quotation/
 * package context) can share the exact same selection UI. Purely
 * presentational: grouping, package-limit badges, hero, and the submit
 * button all stay with whichever page mounts this.
 *
 * `dark` (default true) preserves CataloguePage's original hard-coded dark
 * palette exactly — that page is always rendered on a dark background. Pass
 * `dark={false}` when mounting inside a page that follows the app's
 * light/dark ThemeContext (e.g. the School Portal), so headings and cards
 * use theme tokens instead of white-on-white / hard-coded dark tiles.
 */
export default function DieSelectionGrid({
  dies = [], qtyByDie = {}, onToggle, onQtyChange, backendUrl = '',
  typeTab = 'all', onTypeTabChange, onVideoPreview, dark = true,
}) {
  const selectedDies = Object.keys(qtyByDie);

  const headingCls = dark ? 'text-white' : 'text-[var(--text-primary)]';
  const nameCls = dark ? 'text-white' : 'text-[var(--text-primary)]';
  const typeCls = dark ? 'text-[#6b6b80]' : 'text-[var(--text-muted)]';
  const descCls = dark ? 'text-[#8a8aa0]' : 'text-[var(--text-secondary)]';
  const qtyLabelCls = dark ? 'text-[#a0a0b0]' : 'text-[var(--text-muted)]';
  const cardBaseCls = dark ? 'bg-[#1a1a2e]' : 'bg-[var(--bg-card)]';
  const cardBorderCls = dark ? 'border-[#2d2d44] hover:border-[#e94560]/40' : 'border-[var(--border-color)] hover:border-[#e94560]/40';
  const imgWrapCls = dark ? 'bg-[#0f0f1a]' : 'bg-[var(--bg-primary)]';
  const stepperBtnCls = dark
    ? 'bg-[#0f0f1a] border-[#2d2d44] text-white'
    : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const stepperInputCls = dark
    ? 'bg-[#0f0f1a] border-[#2d2d44] text-white'
    : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const tabInactiveCls = dark
    ? 'bg-[#1a1a2e] text-[#a0a0b0] border border-[#2d2d44]'
    : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)]';

  const typeTabs = [];
  const seenTypes = new Set();
  dies.forEach(d => {
    const id = d.product_type_id || 'ptype_dies';
    if (!seenTypes.has(id)) { seenTypes.add(id); typeTabs.push({ id, name: d.product_type || 'Dies' }); }
  });
  const visibleDies = typeTab === 'all'
    ? dies
    : dies.filter(d => (d.product_type_id || 'ptype_dies') === typeTab);

  const grouped = {};
  visibleDies.forEach(d => {
    const cat = d.category || d.type || 'standard';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(d);
  });

  return (
    <>
      {onTypeTabChange && typeTabs.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
          <button onClick={() => onTypeTabChange('all')}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-colors ${typeTab === 'all' ? 'bg-[#e94560] text-white' : tabInactiveCls}`}>
            All
          </button>
          {typeTabs.map(t => (
            <button key={t.id} onClick={() => onTypeTabChange(t.id)}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-colors ${typeTab === t.id ? 'bg-[#e94560] text-white' : tabInactiveCls}`}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-10">
        {Object.entries(grouped).map(([cat, catDies]) => (
          <div key={cat}>
            <h2 className={`text-2xl font-bold ${headingCls} mb-4 capitalize`}>{cat.replace(/_/g, ' ')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" data-testid={`catalogue-section-${cat}`}>
              {catDies.map((die) => {
                const isSelected = selectedDies.includes(die.die_id);
                return (
                  <div key={die.die_id} onClick={() => onToggle(die.die_id)}
                    className={`relative ${cardBaseCls} rounded-lg overflow-hidden cursor-pointer transition-all hover:-translate-y-1 ${isSelected ? 'ring-2 ring-[#e94560] shadow-lg shadow-[#e94560]/20' : `border ${cardBorderCls}`}`}
                    data-testid={`die-card-${die.code}`}>
                    {isSelected && (
                      <div className="absolute top-2 right-2 z-10 bg-[#e94560] text-white rounded-full w-6 h-6 flex items-center justify-center"><Check className="h-4 w-4" /></div>
                    )}
                    <div className={`relative aspect-square ${imgWrapCls}`} onClick={(e) => e.stopPropagation()}>
                      <MediaGallery images={die.images} alt={die.name} backendUrl={backendUrl} />
                      {die.video_url && onVideoPreview && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); onVideoPreview(die); }}
                          className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-medium">
                          <PlayCircle className="h-3.5 w-3.5" /> Video
                        </button>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="font-mono text-[10px] text-[#e94560]">{die.code}</p>
                      <h3 className={`text-sm font-medium ${nameCls} leading-tight mt-0.5 line-clamp-1`}>{die.name}</h3>
                      <p className={`text-[10px] ${typeCls} mt-1 capitalize`}>{die.type} die</p>
                      {die.description && <p className={`text-[10px] ${descCls} mt-1 line-clamp-2`}>{die.description}</p>}
                      {isSelected && (
                        <div className="mt-2 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                          <span className={`text-[10px] ${qtyLabelCls} uppercase tracking-wide`}>Qty</span>
                          <div className="flex items-center gap-1">
                            <button type="button" aria-label="Decrease quantity"
                              onClick={() => onQtyChange(die.die_id, (qtyByDie[die.die_id] || 1) - 1)}
                              className={`w-6 h-6 rounded border ${stepperBtnCls} flex items-center justify-center hover:border-[#e94560]`}>
                              <Minus className="h-3 w-3" />
                            </button>
                            <input type="number" min="1" value={qtyByDie[die.die_id] || 1}
                              onChange={(e) => onQtyChange(die.die_id, e.target.value)}
                              data-testid={`die-qty-${die.code}`}
                              className={`w-12 h-6 text-center text-sm border rounded ${stepperInputCls}`} />
                            <button type="button" aria-label="Increase quantity"
                              onClick={() => onQtyChange(die.die_id, (qtyByDie[die.die_id] || 1) + 1)}
                              className={`w-6 h-6 rounded border ${stepperBtnCls} flex items-center justify-center hover:border-[#e94560]`}>
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

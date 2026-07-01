import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, ImageIcon, Save, Move, FileText } from 'lucide-react';
import { certsApi } from '../../lib/api';
import { toast } from 'sonner';

const PINK = '#e94560';
const DISPLAY_WIDTH = 800;

const FIELDS = [
  { key: 'name',   label: 'Name',   defaultColor: '#1a1a1a' },
  { key: 'school', label: 'School', defaultColor: '#222222' },
  { key: 'date',   label: 'Date',   defaultColor: '#333333' },
  { key: 'theme',  label: 'Theme',  defaultColor: '#444444' },
  { key: 'expert', label: 'Expert', defaultColor: '#555555' },
];

const FIELD_COLORS = {
  name:   '#2563eb',
  school: '#0891b2',
  date:   '#16a34a',
  theme:  '#9333ea',
  expert: '#d97706',
};

// Representative preview text so the on-canvas size + alignment read true.
const SAMPLE = {
  name:   'Attendee Name',
  school: 'School Name',
  date:   '12 June 2026',
  theme:  'Workshop Theme',
  expert: 'Expert Name',
};

// Fallback font list if /certs/fonts is unavailable; mirrors cert_engine.FONT_REGISTRY.
const FALLBACK_FONTS = ['Default', 'Roboto', 'Open Sans', 'Montserrat', 'Lato',
  'Merriweather', 'Playfair Display', 'Great Vibes', 'Dancing Script'];

// Lay fields out proportionally to the uploaded page so they land in sensible
// spots (name large + centred, theme below it, date/expert along the footer)
// instead of bunched in the top-left corner. Falls back to small defaults
// before any dimensions are known.
function initFieldState(w = 0, h = 0) {
  if (w > 0 && h > 0) {
    const cx = Math.round(w / 2);
    const layout = {
      name:   { x: cx,                 y: Math.round(h * 0.42), size: Math.round(w * 0.055), align: 'center' },
      school: { x: cx,                 y: Math.round(h * 0.52), size: Math.round(w * 0.032), align: 'center' },
      theme:  { x: cx,                 y: Math.round(h * 0.62), size: Math.round(w * 0.030), align: 'center' },
      date:   { x: Math.round(w * 0.25), y: Math.round(h * 0.84), size: Math.round(w * 0.022), align: 'center' },
      expert: { x: Math.round(w * 0.75), y: Math.round(h * 0.84), size: Math.round(w * 0.022), align: 'center' },
    };
    return Object.fromEntries(
      FIELDS.map(f => [f.key, { ...layout[f.key], color: f.defaultColor, font: 'Default' }])
    );
  }
  return Object.fromEntries(
    FIELDS.map((f, i) => [
      f.key,
      { x: 100, y: 100 + i * 60, size: 36, color: f.defaultColor, align: 'center', font: 'Default' },
    ])
  );
}

// Inject a Google-Fonts <link> once so the on-canvas preview renders in the
// chosen face (the same families are bundled server-side for generation).
function ensureFontsLink(families) {
  const id = 'cert-designer-fonts';
  if (document.getElementById(id)) return;
  const named = families.filter(f => f && f !== 'Default');
  if (!named.length) return;
  const spec = named.map(f => f.trim().replace(/\s+/g, '+')).join('|');
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css?family=${spec}&display=swap`;
  document.head.appendChild(link);
}

// Hydrate the keyed field-state object from a saved template's field array,
// falling back to defaults for any missing field/prop.
function fieldsFromTemplate(arr) {
  const base = initFieldState();
  (arr || []).forEach(f => {
    if (!f || !base[f.key]) return;
    base[f.key] = {
      x:     Number.isFinite(f.x) ? f.x : base[f.key].x,
      y:     Number.isFinite(f.y) ? f.y : base[f.key].y,
      size:  Number.isFinite(f.size) ? f.size : base[f.key].size,
      color: f.color || base[f.key].color,
      align: f.align || base[f.key].align,
      font:  f.font  || 'Default',
    };
  });
  return base;
}

export default function TemplateDesigner({ onSaved, editTemplate = null }) {
  const isEdit = !!(editTemplate && editTemplate.template_id);
  /* ── theme helpers ── */
  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const inputCls  = 'bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#e94560]';

  /* ── state (hydrated from editTemplate when editing) ── */
  const e0 = editTemplate || {};
  const e0kind = e0.kind === 'pdf' ? 'pdf' : 'image';
  const e0display = e0kind === 'pdf' ? (e0.preview_url || '') : (e0.background_url || '');
  const [bgUrl, setBgUrl]             = useState(isEdit ? (e0display || null) : null);   // display image (preview for PDF)
  const [realBg, setRealBg]           = useState(isEdit ? (e0.background_url || null) : null);  // saved background_url (PDF path for pdf kind)
  const [previewUrl, setPreviewUrl]   = useState(isEdit ? (e0.preview_url || '') : '');  // raster preview (pdf kind)
  const [kind, setKind]               = useState(isEdit ? e0kind : 'image');             // 'image' | 'pdf'
  const [naturalW, setNaturalW]       = useState(isEdit ? (e0.width_px || 0) : 0);
  const [naturalH, setNaturalH]       = useState(isEdit ? (e0.height_px || 0) : 0);
  const [displayH, setDisplayH]       = useState(
    isEdit && e0.width_px ? Math.round((e0.height_px / e0.width_px) * DISPLAY_WIDTH) : 0);
  const [fields, setFields]           = useState(isEdit ? fieldsFromTemplate(e0.fields) : initFieldState);
  const [templateName, setTemplateName] = useState(isEdit ? (e0.name || '') : '');
  const [orientation, setOrientation] = useState(isEdit ? (e0.orientation || 'landscape') : 'landscape');
  const [uploading, setUploading]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [families, setFamilies]       = useState(FALLBACK_FONTS);

  /* ── drag state (refs so no re-render during drag) ── */
  const dragging = useRef(null);
  const imgWrapRef = useRef(null);

  /* ── computed scale ── */
  const scale = naturalW > 0 ? naturalW / DISPLAY_WIDTH : 1;

  /* ── load curated font families + inject preview <link> ── */
  useEffect(() => {
    let alive = true;
    certsApi.listFonts()
      .then(res => {
        const fams = res.data?.families;
        if (alive && Array.isArray(fams) && fams.length) { setFamilies(fams); ensureFontsLink(fams); }
        else ensureFontsLink(FALLBACK_FONTS);
      })
      .catch(() => ensureFontsLink(FALLBACK_FONTS));
    return () => { alive = false; };
  }, []);

  /* ─────────────────────────────────────────────────────────── upload ── */
  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isImg = file.type.startsWith('image/');
    if (!isPdf && !isImg) {
      toast.error('Please select a PNG/JPG image or a PDF');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (isPdf) {
        const res = await certsApi.uploadPdfPreview(fd);
        const d = res.data || {};
        if (!d.pdf_url || !d.preview_url) throw new Error('No preview returned');
        setKind('pdf');
        setRealBg(d.pdf_url);
        setPreviewUrl(d.preview_url);
        setNaturalW(d.width_px || 0);
        setNaturalH(d.height_px || 0);
        setDisplayH(d.width_px ? Math.round((d.height_px / d.width_px) * DISPLAY_WIDTH) : 0);
        setBgUrl(d.preview_url);
        setFields(initFieldState(d.width_px || 0, d.height_px || 0));
        toast.success('PDF loaded — drag fields onto it');
      } else {
        const res = await certsApi.uploadBackground(fd);
        const url = res.data?.url || res.data?.background_url;
        if (!url) throw new Error('No URL returned from server');
        const img = new Image();
        img.onload = () => {
          setKind('image');
          setRealBg(url);
          setPreviewUrl('');
          setNaturalW(img.naturalWidth);
          setNaturalH(img.naturalHeight);
          setDisplayH(Math.round((img.naturalHeight / img.naturalWidth) * DISPLAY_WIDTH));
          setBgUrl(url);
          setFields(initFieldState(img.naturalWidth, img.naturalHeight));
          toast.success('Background uploaded');
        };
        img.onerror = () => { toast.error('Could not load uploaded image'); setUploading(false); };
        img.src = url;
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, []);

  /* ─────────────────────────────────────────────────────── drag handlers ── */
  const onMarkerMouseDown = useCallback((e, key) => {
    e.preventDefault();
    const f = fields[key];
    dragging.current = { key, startMouseX: e.clientX, startMouseY: e.clientY, startFieldX: f.x, startFieldY: f.y };
    const onMouseMove = (mv) => {
      if (!dragging.current) return;
      const { key: k, startMouseX, startMouseY, startFieldX, startFieldY } = dragging.current;
      if (!imgWrapRef.current) return;
      const dx = mv.clientX - startMouseX;
      const dy = mv.clientY - startMouseY;
      const newDisplayX = Math.max(0, Math.min(DISPLAY_WIDTH, startFieldX / scale + dx));
      const newDisplayY = Math.max(0, Math.min(displayH,      startFieldY / scale + dy));
      setFields(prev => ({ ...prev, [k]: { ...prev[k], x: Math.round(newDisplayX * scale), y: Math.round(newDisplayY * scale) } }));
    };
    const onMouseUp = () => {
      dragging.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [fields, scale, displayH]);

  /* ────────────────────────────────────────────────── field prop updater ── */
  const updateField = useCallback((key, prop, value) => {
    setFields(prev => ({ ...prev, [key]: { ...prev[key], [prop]: value } }));
  }, []);

  const toDisplayX = (px) => (scale > 0 ? px / scale : 0);
  const toDisplayY = (py) => (scale > 0 ? py / scale : 0);

  /* ──────────────────────────────────────────────────────────── save ── */
  const handleSave = useCallback(async () => {
    if (!templateName.trim()) { toast.error('Template name is required'); return; }
    if (!realBg)              { toast.error('Upload a background image or PDF first'); return; }
    setSaving(true);
    try {
      const body = {
        name:           templateName.trim(),
        background_url: realBg,
        kind,
        orientation,
        width_px:       naturalW,
        height_px:      naturalH,
        preview_url:    kind === 'pdf' ? previewUrl : '',
        fields:         FIELDS.map(f => ({
          key:   f.key,
          x:     fields[f.key].x,
          y:     fields[f.key].y,
          size:  fields[f.key].size,
          color: fields[f.key].color,
          align: fields[f.key].align,
          font:  fields[f.key].font,
        })),
      };
      if (isEdit) {
        await certsApi.updateTemplate(editTemplate.template_id, body);
        toast.success('Template updated');
      } else {
        await certsApi.createTemplate(body);
        toast.success('Template saved');
      }
      setBgUrl(null); setRealBg(null); setPreviewUrl(''); setKind('image');
      setNaturalW(0); setNaturalH(0); setDisplayH(0);
      setTemplateName(''); setFields(initFieldState());
      onSaved?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }, [templateName, realBg, kind, previewUrl, orientation, naturalW, naturalH, fields, onSaved, isEdit, editTemplate]);

  /* ───────────────────────────────────────────────────────────── render ── */
  return (
    <div className="space-y-5">

      {/* ── Meta row ── */}
      <div className={`${card} border rounded-xl p-4`}>
        <p className={`text-xs font-semibold uppercase tracking-wide ${textMuted} mb-3`}>{isEdit ? `Edit Template — ${e0.name || ''}` : 'New Template'}</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className={`block text-xs ${textSec} mb-1`}>Template Name *</label>
            <input type="text" className={`${inputCls} w-full`}
              placeholder="e.g. Workshop Certificate 2026"
              value={templateName} onChange={e => setTemplateName(e.target.value)} />
          </div>
          <div>
            <label className={`block text-xs ${textSec} mb-1`}>Orientation</label>
            <select className={`${inputCls}`} value={orientation} onChange={e => setOrientation(e.target.value)}>
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </div>
          <div>
            <label className={`block text-xs ${textSec} mb-1`}>Background (PNG / JPG / PDF)</label>
            <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-[var(--border-color)] cursor-pointer text-sm ${textSec} hover:bg-[var(--bg-hover)] transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
              {uploading ? (
                <><Upload className="h-4 w-4 animate-spin" />Uploading…</>
              ) : bgUrl ? (
                kind === 'pdf'
                  ? <><FileText className="h-4 w-4" style={{ color: PINK }} />Change PDF</>
                  : <><ImageIcon className="h-4 w-4" style={{ color: PINK }} />Change image</>
              ) : (
                <><Upload className="h-4 w-4" />Upload PNG / PDF</>
              )}
              <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf"
                className="hidden" onChange={handleFileChange} />
            </label>
          </div>
          <button onClick={handleSave} disabled={saving || !realBg || !templateName.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            style={{ background: PINK }}>
            <Save className="h-4 w-4" />{saving ? 'Saving…' : (isEdit ? 'Update Template' : 'Save Template')}
          </button>
        </div>
        {kind === 'pdf' && bgUrl && (
          <p className={`text-xs ${textMuted} mt-2`}>
            PDF mode — variables are overlaid onto the real PDF at the positions/fonts you set (background preserved).
          </p>
        )}
      </div>

      {/* ── Designer canvas ── */}
      {bgUrl ? (
        <div className="flex flex-col lg:flex-row gap-5 items-start">

          {/* Canvas */}
          <div className={`${card} border rounded-xl overflow-hidden flex-shrink-0`} style={{ width: DISPLAY_WIDTH, maxWidth: '100%' }}>
            <div className="px-3 py-2 border-b border-[var(--border-color)] flex items-center gap-2">
              <Move className={`h-3.5 w-3.5 ${textMuted}`} />
              <span className={`text-xs ${textMuted}`}>Drag the coloured markers to position each field — or edit x/y in the panel.</span>
            </div>
            <div ref={imgWrapRef} style={{ position: 'relative', width: DISPLAY_WIDTH, height: displayH || 'auto', userSelect: 'none' }}>
              <img src={bgUrl} alt="Certificate background" draggable={false}
                style={{ display: 'block', width: DISPLAY_WIDTH, height: displayH || 'auto' }} />
              {FIELDS.map(f => {
                const fld = fields[f.key];
                const col = FIELD_COLORS[f.key];
                // preview at the REAL scaled font size + chosen face/colour
                const dispSize = Math.max(8, scale > 0 ? fld.size / scale : fld.size);
                // anchor like the backend: x = align point, y = text top
                const tx = fld.align === 'center' ? 'translateX(-50%)'
                         : fld.align === 'right'  ? 'translateX(-100%)' : 'none';
                const dotLeft = fld.align === 'center' ? '50%'
                              : fld.align === 'right'  ? '100%' : '0%';
                return (
                  <div key={f.key} onMouseDown={e => onMarkerMouseDown(e, f.key)}
                    title={`${f.label} — drag to reposition`}
                    style={{
                      position: 'absolute', left: toDisplayX(fld.x), top: toDisplayY(fld.y),
                      transform: tx, cursor: 'grab', userSelect: 'none', whiteSpace: 'nowrap',
                      zIndex: 10, lineHeight: 1, fontSize: dispSize, color: fld.color,
                      fontFamily: fld.font && fld.font !== 'Default' ? `'${fld.font}', sans-serif` : 'inherit',
                      textShadow: '0 0 3px #fff, 0 0 3px #fff, 0 0 2px #fff',
                      outline: `1px dashed ${col}`, outlineOffset: 3,
                    }}>
                    {SAMPLE[f.key]}
                    <span style={{
                      position: 'absolute', top: 0, left: dotLeft, width: 9, height: 9,
                      borderRadius: '50%', background: col, border: '2px solid #fff',
                      transform: 'translate(-50%, -50%)', boxShadow: '0 0 2px rgba(0,0,0,0.5)',
                    }} />
                  </div>
                );
              })}
            </div>
            {naturalW > 0 && (
              <p className={`text-center text-xs ${textMuted} py-1.5`}>
                {naturalW} × {naturalH} px &nbsp;·&nbsp; display {DISPLAY_WIDTH}px &nbsp;·&nbsp; scale {scale.toFixed(3)}× &nbsp;·&nbsp; {kind.toUpperCase()}
              </p>
            )}
          </div>

          {/* Field controls panel */}
          <div className={`${card} border rounded-xl p-4 flex-1 min-w-[260px] space-y-4`}>
            <p className={`text-xs font-semibold uppercase tracking-wide ${textMuted}`}>Field Settings</p>
            {FIELDS.map(f => {
              const fld = fields[f.key];
              return (
                <div key={f.key} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: FIELD_COLORS[f.key], flexShrink: 0 }} />
                    <span className={`text-sm font-medium ${textPri}`}>{f.label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={`block text-xs ${textMuted} mb-0.5`}>X (px)</label>
                      <input type="number" className={`${inputCls} w-full`} value={fld.x} min={0} max={naturalW || 9999}
                        onChange={e => updateField(f.key, 'x', parseInt(e.target.value, 10) || 0)} />
                    </div>
                    <div>
                      <label className={`block text-xs ${textMuted} mb-0.5`}>Y (px)</label>
                      <input type="number" className={`${inputCls} w-full`} value={fld.y} min={0} max={naturalH || 9999}
                        onChange={e => updateField(f.key, 'y', parseInt(e.target.value, 10) || 0)} />
                    </div>
                    <div>
                      <label className={`block text-xs ${textMuted} mb-0.5`}>Size (pt)</label>
                      <input type="number" className={`${inputCls} w-full`} value={fld.size} min={8} max={400}
                        onChange={e => updateField(f.key, 'size', parseInt(e.target.value, 10) || 36)} />
                    </div>
                    <div>
                      <label className={`block text-xs ${textMuted} mb-0.5`}>Align</label>
                      <select className={`${inputCls} w-full`} value={fld.align} onChange={e => updateField(f.key, 'align', e.target.value)}>
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </div>
                  {/* font family */}
                  <div>
                    <label className={`block text-xs ${textMuted} mb-0.5`}>Font</label>
                    <select className={`${inputCls} w-full`} value={fld.font}
                      style={{ fontFamily: fld.font && fld.font !== 'Default' ? `'${fld.font}', sans-serif` : 'inherit' }}
                      onChange={e => updateField(f.key, 'font', e.target.value)}>
                      {families.map(fam => <option key={fam} value={fam}>{fam}</option>)}
                    </select>
                  </div>
                  {/* color */}
                  <div className="flex items-center gap-2">
                    <label className={`text-xs ${textMuted}`}>Color</label>
                    <input type="color" value={fld.color} onChange={e => updateField(f.key, 'color', e.target.value)}
                      className="h-7 w-10 rounded cursor-pointer border border-[var(--border-color)]" title="Font colour" />
                    <span className={`text-xs ${textMuted} font-mono`}>{fld.color}</span>
                  </div>
                  <hr className="border-[var(--border-color)]" />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={`${card} border rounded-xl p-10 text-center border-dashed`}>
          <ImageIcon className={`h-10 w-10 mx-auto mb-3 ${textMuted}`} />
          <p className={`${textPri} font-medium mb-1`}>Upload a PNG, JPG, or PDF to start designing</p>
          <p className={`${textMuted} text-sm`}>
            Then drag the coloured field markers to position Name, Date, Theme, and Expert — and pick a font, size, and colour for each.
          </p>
        </div>
      )}
    </div>
  );
}

import React, { useState, useRef, useCallback } from 'react';
import { Upload, ImageIcon, Save, Move } from 'lucide-react';
import { certsApi } from '../../lib/api';
import { toast } from 'sonner';

const PINK = '#e94560';
const DISPLAY_WIDTH = 800;

const FIELDS = [
  { key: 'name',   label: 'Name',   defaultColor: '#1a1a1a' },
  { key: 'date',   label: 'Date',   defaultColor: '#333333' },
  { key: 'theme',  label: 'Theme',  defaultColor: '#444444' },
  { key: 'expert', label: 'Expert', defaultColor: '#555555' },
];

const FIELD_COLORS = {
  name:   '#2563eb',
  date:   '#16a34a',
  theme:  '#9333ea',
  expert: '#d97706',
};

function initFieldState() {
  return Object.fromEntries(
    FIELDS.map((f, i) => [
      f.key,
      {
        x:     100,
        y:     100 + i * 60,
        size:  36,
        color: f.defaultColor,
        align: 'center',
      },
    ])
  );
}

export default function TemplateDesigner({ onSaved }) {
  /* ── theme helpers ── */
  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';
  const inputCls  = 'bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#e94560]';

  /* ── state ── */
  const [bgUrl, setBgUrl]             = useState(null);
  const [naturalW, setNaturalW]       = useState(0);
  const [naturalH, setNaturalH]       = useState(0);
  const [displayH, setDisplayH]       = useState(0);
  const [fields, setFields]           = useState(initFieldState);
  const [templateName, setTemplateName] = useState('');
  const [orientation, setOrientation] = useState('landscape');
  const [uploading, setUploading]     = useState(false);
  const [saving, setSaving]           = useState(false);

  /* ── drag state (refs so no re-render during drag) ── */
  const dragging = useRef(null); // { key, startMouseX, startMouseY, startFieldX, startFieldY }
  const imgWrapRef = useRef(null);

  /* ── computed scale ── */
  const scale = naturalW > 0 ? naturalW / DISPLAY_WIDTH : 1;

  /* ─────────────────────────────────────────────────────────── upload ── */
  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file (PNG recommended)');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await certsApi.uploadBackground(fd);
      const url = res.data?.url || res.data?.background_url;
      if (!url) throw new Error('No URL returned from server');

      /* read natural dimensions */
      const img = new Image();
      img.onload = () => {
        setNaturalW(img.naturalWidth);
        setNaturalH(img.naturalHeight);
        const dh = Math.round((img.naturalHeight / img.naturalWidth) * DISPLAY_WIDTH);
        setDisplayH(dh);
        setBgUrl(url);
        /* reset field y positions proportionally */
        setFields(initFieldState());
        toast.success('Background uploaded');
      };
      img.onerror = () => {
        toast.error('Could not load uploaded image');
        setUploading(false);
      };
      img.src = url;
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
    dragging.current = {
      key,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startFieldX: f.x,
      startFieldY: f.y,
    };

    const onMouseMove = (mv) => {
      if (!dragging.current) return;
      const { key: k, startMouseX, startMouseY, startFieldX, startFieldY } = dragging.current;
      const wrap = imgWrapRef.current;
      if (!wrap) return;

      /* display-pixel deltas */
      const dx = mv.clientX - startMouseX;
      const dy = mv.clientY - startMouseY;

      /* clamp to wrapper bounds */
      const newDisplayX = Math.max(0, Math.min(DISPLAY_WIDTH,  startFieldX / scale + dx));
      const newDisplayY = Math.max(0, Math.min(displayH,       startFieldY / scale + dy));

      setFields(prev => ({
        ...prev,
        [k]: {
          ...prev[k],
          x: Math.round(newDisplayX * scale),
          y: Math.round(newDisplayY * scale),
        },
      }));
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

  /* convenience: display coords from image-pixel coords */
  const toDisplayX = (px) => (scale > 0 ? px / scale : 0);
  const toDisplayY = (py) => (scale > 0 ? py / scale : 0);

  /* ──────────────────────────────────────────────────────────── save ── */
  const handleSave = useCallback(async () => {
    if (!templateName.trim()) { toast.error('Template name is required'); return; }
    if (!bgUrl)               { toast.error('Upload a background image first'); return; }
    setSaving(true);
    try {
      const body = {
        name:           templateName.trim(),
        background_url: bgUrl,
        orientation,
        width_px:       naturalW,
        height_px:      naturalH,
        fields:         FIELDS.map(f => ({
          key:   f.key,
          x:     fields[f.key].x,
          y:     fields[f.key].y,
          size:  fields[f.key].size,
          color: fields[f.key].color,
          align: fields[f.key].align,
        })),
      };
      await certsApi.createTemplate(body);
      toast.success('Template saved');
      /* reset for another template */
      setBgUrl(null);
      setNaturalW(0);
      setNaturalH(0);
      setDisplayH(0);
      setTemplateName('');
      setFields(initFieldState());
      onSaved?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }, [templateName, bgUrl, orientation, naturalW, naturalH, fields, onSaved]);

  /* ───────────────────────────────────────────────────────────── render ── */
  return (
    <div className="space-y-5">

      {/* ── Meta row ── */}
      <div className={`${card} border rounded-xl p-4`}>
        <p className={`text-xs font-semibold uppercase tracking-wide ${textMuted} mb-3`}>New Template</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className={`block text-xs ${textSec} mb-1`}>Template Name *</label>
            <input
              type="text"
              className={`${inputCls} w-full`}
              placeholder="e.g. Workshop Certificate 2026"
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
            />
          </div>
          <div>
            <label className={`block text-xs ${textSec} mb-1`}>Orientation</label>
            <select
              className={`${inputCls}`}
              value={orientation}
              onChange={e => setOrientation(e.target.value)}
            >
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </div>
          <div>
            <label className={`block text-xs ${textSec} mb-1`}>Background PNG</label>
            <label
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-[var(--border-color)] cursor-pointer text-sm ${textSec} hover:bg-[var(--bg-hover)] transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {uploading ? (
                <><Upload className="h-4 w-4 animate-spin" />Uploading…</>
              ) : bgUrl ? (
                <><ImageIcon className="h-4 w-4" style={{ color: PINK }} />Change image</>
              ) : (
                <><Upload className="h-4 w-4" />Upload PNG</>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !bgUrl || !templateName.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            style={{ background: PINK }}
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </div>

      {/* ── Designer canvas ── */}
      {bgUrl ? (
        <div className="flex flex-col lg:flex-row gap-5 items-start">

          {/* Canvas */}
          <div
            className={`${card} border rounded-xl overflow-hidden flex-shrink-0`}
            style={{ width: DISPLAY_WIDTH, maxWidth: '100%' }}
          >
            <div className="px-3 py-2 border-b border-[var(--border-color)] flex items-center gap-2">
              <Move className={`h-3.5 w-3.5 ${textMuted}`} />
              <span className={`text-xs ${textMuted}`}>
                Drag the coloured markers to position each field — or edit x/y numbers in the panel.
              </span>
            </div>
            {/* image + markers */}
            <div
              ref={imgWrapRef}
              style={{
                position: 'relative',
                width: DISPLAY_WIDTH,
                height: displayH || 'auto',
                userSelect: 'none',
              }}
            >
              <img
                src={bgUrl}
                alt="Certificate background"
                draggable={false}
                style={{ display: 'block', width: DISPLAY_WIDTH, height: displayH || 'auto' }}
              />
              {FIELDS.map(f => {
                const fld = fields[f.key];
                const dispX = toDisplayX(fld.x);
                const dispY = toDisplayY(fld.y);
                return (
                  <div
                    key={f.key}
                    onMouseDown={e => onMarkerMouseDown(e, f.key)}
                    style={{
                      position:    'absolute',
                      left:        dispX,
                      top:         dispY,
                      transform:   'translate(-50%, -50%)',
                      cursor:      'grab',
                      userSelect:  'none',
                      padding:     '2px 8px',
                      borderRadius: 4,
                      background:  FIELD_COLORS[f.key] + 'cc',
                      border:      `2px solid ${FIELD_COLORS[f.key]}`,
                      color:       '#fff',
                      fontSize:    11,
                      fontWeight:  600,
                      whiteSpace:  'nowrap',
                      boxShadow:   '0 1px 4px rgba(0,0,0,0.35)',
                      zIndex:      10,
                    }}
                    title={`${f.label} — drag to reposition`}
                  >
                    {f.label}
                  </div>
                );
              })}
            </div>
            {naturalW > 0 && (
              <p className={`text-center text-xs ${textMuted} py-1.5`}>
                {naturalW} × {naturalH} px &nbsp;·&nbsp; display at {DISPLAY_WIDTH}px &nbsp;·&nbsp; scale {scale.toFixed(3)}×
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
                    <span
                      style={{
                        display:      'inline-block',
                        width:         10,
                        height:        10,
                        borderRadius:  2,
                        background:   FIELD_COLORS[f.key],
                        flexShrink:   0,
                      }}
                    />
                    <span className={`text-sm font-medium ${textPri}`}>{f.label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {/* x */}
                    <div>
                      <label className={`block text-xs ${textMuted} mb-0.5`}>X (px)</label>
                      <input
                        type="number"
                        className={`${inputCls} w-full`}
                        value={fld.x}
                        min={0}
                        max={naturalW || 9999}
                        onChange={e => updateField(f.key, 'x', parseInt(e.target.value, 10) || 0)}
                      />
                    </div>
                    {/* y */}
                    <div>
                      <label className={`block text-xs ${textMuted} mb-0.5`}>Y (px)</label>
                      <input
                        type="number"
                        className={`${inputCls} w-full`}
                        value={fld.y}
                        min={0}
                        max={naturalH || 9999}
                        onChange={e => updateField(f.key, 'y', parseInt(e.target.value, 10) || 0)}
                      />
                    </div>
                    {/* size */}
                    <div>
                      <label className={`block text-xs ${textMuted} mb-0.5`}>Size (pt)</label>
                      <input
                        type="number"
                        className={`${inputCls} w-full`}
                        value={fld.size}
                        min={8}
                        max={200}
                        onChange={e => updateField(f.key, 'size', parseInt(e.target.value, 10) || 36)}
                      />
                    </div>
                    {/* align */}
                    <div>
                      <label className={`block text-xs ${textMuted} mb-0.5`}>Align</label>
                      <select
                        className={`${inputCls} w-full`}
                        value={fld.align}
                        onChange={e => updateField(f.key, 'align', e.target.value)}
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </div>
                  {/* color */}
                  <div className="flex items-center gap-2">
                    <label className={`text-xs ${textMuted}`}>Color</label>
                    <input
                      type="color"
                      value={fld.color}
                      onChange={e => updateField(f.key, 'color', e.target.value)}
                      className="h-7 w-10 rounded cursor-pointer border border-[var(--border-color)]"
                      title="Font colour"
                    />
                    <span className={`text-xs ${textMuted} font-mono`}>{fld.color}</span>
                  </div>
                  <hr className="border-[var(--border-color)]" />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* empty state — no image yet */
        <div className={`${card} border rounded-xl p-10 text-center border-dashed`}>
          <ImageIcon className={`h-10 w-10 mx-auto mb-3 ${textMuted}`} />
          <p className={`${textPri} font-medium mb-1`}>Upload a background PNG to start designing</p>
          <p className={`${textMuted} text-sm`}>
            Upload a PNG above, then drag the coloured field markers to position Name, Date, Theme, and Expert.
          </p>
        </div>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { PenSquare, Code2 } from 'lucide-react';

/**
 * HtmlBodyEditor — shared, controlled HTML body editor.
 *
 * Props:
 *   value:    HTML string (controlled)
 *   onChange: (html) => void
 *
 * Presents a mode toggle [Rich text | Paste HTML]. Both modes read/write the
 * SAME `value` string, so switching modes never loses content. Rich text uses
 * react-quill-new (React 19 compatible fork of react-quill); Paste HTML uses a
 * plain monospace textarea for pasting hand-authored markup.
 *
 * Self-contained and presentational — reused by EmailComposerDialog and the
 * email template dialog.
 */
export default function HtmlBodyEditor({ value, onChange }) {
  const [mode, setMode] = useState('rich'); // 'rich' | 'html'

  const tabBtn = (key, label, Icon) => (
    <button
      type="button"
      onClick={() => setMode(key)}
      className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
        mode === key
          ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
          : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="inline-flex items-center gap-0.5 p-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl">
        {tabBtn('rich', 'Rich text', PenSquare)}
        {tabBtn('html', 'Paste HTML', Code2)}
      </div>

      {mode === 'rich' ? (
        <div className="bg-white rounded-md overflow-hidden">
          <ReactQuill theme="snow" value={value || ''} onChange={onChange} />
        </div>
      ) : (
        <textarea
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder="<p>Paste or write raw HTML here…</p>"
          className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs font-mono px-3 py-2.5 resize-y focus:outline-none focus:ring-1 focus:ring-[#e94560]"
        />
      )}
    </div>
  );
}

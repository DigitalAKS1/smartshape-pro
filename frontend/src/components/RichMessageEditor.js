import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import {
  Bold, Italic, Underline as ULIcon, Strikethrough,
  List, ListOrdered,
} from 'lucide-react';

const QUICK_EMOJIS = [
  '😊','👋','🎉','✅','📞','💡','🏫','✂️','📦','🔥','⭐','💯',
  '🙏','📣','🎁','⏰','📝','💬',
];

/**
 * Rich text editor for drip / campaign messages.
 *
 * Props:
 *   value        – HTML string (stored in state above)
 *   onChange     – (html: string) => void
 *   placeholder  – shown when empty
 *   className    – outer wrapper extra classes
 */
export default function RichMessageEditor({
  value = '',
  onChange,
  placeholder = 'Write your message…',
  className = '',
}) {
  const lastValueRef = useRef(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
      Underline,
      Placeholder.configure({ placeholder }),
      CharacterCount,
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastValueRef.current = html;
      onChange?.(html);
    },
  });

  // Sync value when dialog reopens with different content
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value !== lastValueRef.current) {
      editor.commands.setContent(value || '', false);
      lastValueRef.current = value;
    }
  }, [value, editor]);

  if (!editor) return null;

  const charCount = editor.storage.characterCount?.characters() ?? 0;

  // Prevent toolbar clicks from blurring the editor
  const stop = e => e.preventDefault();

  const ToolBtn = ({ onClick, active, title, children }) => (
    <button
      type="button"
      title={title}
      onMouseDown={stop}
      onClick={onClick}
      className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors flex-shrink-0 ${
        active
          ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div
      className={`rounded-xl border border-[var(--border-color)] overflow-hidden
        bg-[var(--bg-primary)] focus-within:border-[var(--accent)] transition-colors ${className}`}
    >
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center flex-wrap gap-0.5 px-2 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-card)]">
        {/* Format buttons */}
        <ToolBtn
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          title="Underline (Ctrl+U)"
        >
          <ULIcon className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          title="Strikethrough"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Numbered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolBtn>

        {/* Divider */}
        <div className="w-px h-4 bg-[var(--border-color)] mx-1 flex-shrink-0" />

        {/* Quick emoji inserts */}
        <div className="flex items-center flex-wrap gap-0">
          {QUICK_EMOJIS.map(emoji => (
            <button
              key={emoji}
              type="button"
              title={`Insert ${emoji}`}
              onMouseDown={stop}
              onClick={() => editor.chain().focus().insertContent(emoji).run()}
              className="h-7 w-7 flex items-center justify-center text-sm hover:scale-125 transition-transform rounded"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* ── Editor area ─────────────────────────────────────────── */}
      <EditorContent editor={editor} className="rich-editor-content" />

      {/* ── Footer ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--border-color)] bg-[var(--bg-card)]">
        <span className="text-[10px] text-[var(--text-muted)]">
          Personalise:{' '}
          <code className="text-[var(--accent)] bg-[var(--accent)]/10 px-1 py-0.5 rounded text-[10px]">{'{name}'}</code>
          {' '}
          <code className="text-[var(--accent)] bg-[var(--accent)]/10 px-1 py-0.5 rounded text-[10px]">{'{school_name}'}</code>
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">{charCount} chars</span>
      </div>
    </div>
  );
}

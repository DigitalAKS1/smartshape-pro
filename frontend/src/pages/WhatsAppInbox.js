// WhatsApp team inbox (spec 2026-09-24, W2): every chat on the company and rep numbers,
// live over SSE (the inbox hook mounts the stream itself), with the reply box, the details
// rail and a deep link `?chat=<id>` from the CRM. Desktop: list | conversation | rail.
// Mobile (< 768 px): list OR conversation, the rail as a bottom sheet.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/layouts/AppShell';
import ChatList from '../components/whatsapp/ChatList';
import ChatView from '../components/whatsapp/ChatView';
import Composer from '../components/whatsapp/Composer';
import ChatRail from '../components/whatsapp/ChatRail';
import useWaInbox from '../hooks/useWaInbox';
import { useAuth } from '../contexts/AuthContext';
import { salesPersons } from '../lib/api';

/** A sales-portal user (role `sales`, or no `leads` module): their CRM lives at /sales/leads
 *  and there is no school-profile page for them. */
export function isSalesOnly(user) {
  if (!user) return false;
  if (user.role === 'admin') return false;
  if (user.role === 'sales') return true;
  const modules = Array.isArray(user.assigned_modules) ? user.assigned_modules : [];
  return !modules.includes('leads');
}

export const MOBILE_QUERY = '(max-width: 767px)';

/** True below the md breakpoint; follows the viewport via matchMedia (resize as fallback). */
export function useIsMobile() {
  const read = () => {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia === 'function') {
      try { return !!window.matchMedia(MOBILE_QUERY).matches; } catch { /* fall through */ }
    }
    return window.innerWidth < 768;
  };
  const [isMobile, setIsMobile] = useState(read);
  useEffect(() => {
    const onChange = () => setIsMobile(read());
    let mql = null;
    if (typeof window.matchMedia === 'function') {
      try { mql = window.matchMedia(MOBILE_QUERY); } catch { mql = null; }
    }
    if (mql && typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    else if (mql && typeof mql.addListener === 'function') mql.addListener(onChange);
    window.addEventListener('resize', onChange);
    return () => {
      if (mql && typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange);
      else if (mql && typeof mql.removeListener === 'function') mql.removeListener(onChange);
      window.removeEventListener('resize', onChange);
    };
  }, []);
  return isMobile;
}

export default function WhatsAppInbox() {
  const inbox = useWaInbox();
  const {
    filters, setFilters, chats, selectedId, messages, hasMore, loading, sending, isManager, degraded,
    instanceStates, select, loadOlder, send, markRead, resolve, reopen, assign, addNote, link,
  } = inbox;
  const { user } = useAuth();
  const salesOnly = isSalesOnly(user);
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [railOpen, setRailOpen] = useState(!isMobile);
  const [mobilePane, setMobilePane] = useState('list');     // 'list' | 'chat'
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [users, setUsers] = useState([]);
  const deepLinked = useRef(false);
  const widened = useRef(false);

  const chat = useMemo(() => {
    if (!selectedId) return null;
    return chats.find((c) => c.chat_id === selectedId) || { chat_id: selectedId };
  }, [chats, selectedId]);

  // ?chat=<id> — from the CRM. Select it once; if it is not on the page the default
  // filters show, widen them once so its row (name, number, notes) can load.
  const wanted = searchParams.get('chat') || '';
  useEffect(() => {
    if (!wanted || deepLinked.current) return;
    deepLinked.current = true;
    select(wanted);
    if (isMobile) setMobilePane('chat');
  }, [wanted, select, isMobile]);

  useEffect(() => {
    if (!wanted || loading || widened.current) return;
    if (chats.some((c) => c.chat_id === wanted)) { widened.current = true; return; }
    widened.current = true;
    setFilters({ scope: 'all', status: 'all' });
  }, [wanted, loading, chats, setFilters]);

  // The open chat is being read: once its row is in the list with unread > 0 (the list
  // arrived after a deep-link `select`, or a new inbound message just landed), mark it read.
  useEffect(() => {
    if (!selectedId || typeof markRead !== 'function') return;
    const row = chats.find((c) => c.chat_id === selectedId);
    if (row && row.unread_count > 0) markRead(selectedId);
  }, [chats, selectedId, markRead]);

  // A phone starts with the rail closed (it is a sheet there); a desktop keeps its own state.
  useEffect(() => { if (isMobile) setRailOpen(false); }, [isMobile]);

  useEffect(() => {
    if (!isManager) return undefined;
    let on = true;
    salesPersons.getAll()
      .then((r) => { if (on) setUsers(Array.isArray(r?.data) ? r.data.filter((u) => u.email) : []); })
      .catch(() => { /* the select just shows the current assignee */ });
    return () => { on = false; };
  }, [isManager]);

  const onSelect = useCallback((chatId) => {
    widened.current = true;                 // a row the user picked is on the page by definition
    select(chatId);
    if (isMobile) setMobilePane('chat');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (chatId) next.set('chat', chatId); else next.delete('chat');
      return next;
    }, { replace: true });
  }, [select, isMobile, setSearchParams]);

  const onLoadOlder = useCallback(async () => {
    setLoadingOlder(true);
    try { await loadOlder(); } finally { setLoadingOlder(false); }
  }, [loadOlder]);

  const instanceState = chat?.instance_name ? instanceStates?.[chat.instance_name] : undefined;

  const listPane = (
    <ChatList chats={chats} selectedId={selectedId} onSelect={onSelect} filters={filters}
      onFiltersChange={setFilters} isManager={isManager} loading={loading} degraded={degraded} />
  );

  const conversation = (
    <ChatView chat={chat} messages={messages} hasMore={hasMore} loadingOlder={loadingOlder} onLoadOlder={onLoadOlder}
      onResolve={resolve} onReopen={reopen} railOpen={railOpen} onToggleRail={() => setRailOpen((o) => !o)}
      onBack={isMobile ? () => setMobilePane('list') : undefined} instanceState={instanceState}>
      <Composer chat={chat} instanceState={instanceState} sending={sending} onSend={send} />
    </ChatView>
  );

  const rail = (
    <ChatRail chat={chat} isManager={isManager} users={users} onAssign={assign} onAddNote={addNote} onLink={link}
      salesOnly={salesOnly} onClose={isMobile ? () => setRailOpen(false) : undefined} />
  );

  // Height: the shell's own header/bottom nav take the rest of the viewport.
  const frame = 'w-full overflow-hidden rounded-none md:rounded-2xl md:border md:border-[var(--border-color)] bg-[var(--bg-card)]';

  if (isMobile) {
    return (
      <AppShell>
        <div className={frame} data-testid="wa-inbox" data-layout="mobile" style={{ height: 'calc(100vh - 150px)', minHeight: 360 }}>
          {mobilePane === 'chat' && selectedId ? (
            <div className="h-full flex flex-col" data-testid="wa-pane-chat">{conversation}</div>
          ) : (
            <div className="h-full" data-testid="wa-pane-list">{listPane}</div>
          )}
        </div>
        {railOpen && selectedId && mobilePane === 'chat' && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end" data-testid="wa-rail-sheet" onClick={() => setRailOpen(false)}>
            <div className="absolute inset-0 bg-black/30" />
            <div className="relative max-h-[80vh] h-[80vh] rounded-t-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
              {rail}
            </div>
          </div>
        )}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className={`${frame} flex`} data-testid="wa-inbox" data-layout="desktop" style={{ height: 'calc(100vh - 140px)', minHeight: 480 }}>
        <aside className="w-[320px] flex-shrink-0 border-r border-[var(--border-color)] h-full" data-testid="wa-pane-list">{listPane}</aside>
        <section className="flex-1 min-w-0 h-full flex flex-col" data-testid="wa-pane-chat">{conversation}</section>
        {railOpen && selectedId && (
          <aside className="w-[280px] flex-shrink-0 border-l border-[var(--border-color)] h-full" data-testid="wa-pane-rail">{rail}</aside>
        )}
      </div>
    </AppShell>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { waInbox } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import useWaStream, { DEGRADED_POLL_MS } from './useWaStream';

const errText = (e, fallback) => {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' && d ? d : fallback;
};

// ── Pure helpers (exported so tests can hit them directly) ─────────────────

/** Merges a `message_new` stream event into the chat list: bumps the
 *  matching chat's preview/unread and moves it to the top. If the chat is
 *  not currently loaded, it is spliced in as a stub only when it would
 *  plausibly show under the active filters — we only know direction /
 *  instance / contact / school from the event, never the owner or
 *  assignee, so 'mine' and 'unassigned' scopes are left for the next full
 *  refetch rather than guessed at. */
export function applyMessageNew(chats, ev, filters = {}) {
  if (!ev || !ev.chat_id) return chats;
  const idx = chats.findIndex((c) => c.chat_id === ev.chat_id);
  const now = new Date().toISOString();
  if (idx !== -1) {
    const existing = chats[idx];
    const updated = {
      ...existing,
      unread_count: ev.unread_count ?? existing.unread_count,
      last_message_preview: ev.preview ?? existing.last_message_preview,
      last_direction: ev.direction ?? existing.last_direction,
      last_message_at: now,
    };
    const rest = [...chats.slice(0, idx), ...chats.slice(idx + 1)];
    return [updated, ...rest];
  }
  if (filters.status && filters.status !== 'open') return chats;
  if (filters.scope && filters.scope !== 'all') return chats;
  const stub = {
    chat_id: ev.chat_id,
    instance_name: ev.instance_name,
    contact_id: ev.contact_id,
    school_id: ev.school_id,
    unread_count: ev.unread_count ?? 1,
    last_message_preview: ev.preview,
    last_direction: ev.direction,
    status: 'open',
    last_message_at: now,
  };
  return [stub, ...chats];
}

/** Patches the ticks/status of the bubble a `message_status` event names. */
export function applyMessageStatus(messages, ev) {
  if (!ev || !ev.message_id) return messages;
  return messages.map((m) => (
    m.message_id === ev.message_id ? { ...m, status: ev.status, fail_reason: ev.fail_reason ?? m.fail_reason } : m
  ));
}

/** Combines two message arrays, de-duping by `message_id` (the later entry
 *  wins) and returning them in ascending (oldest → newest) order. */
export function mergeMessages(existing, incoming) {
  const map = new Map();
  [...(existing || []), ...(incoming || [])].forEach((m) => {
    if (!m || !m.message_id) return;
    map.set(m.message_id, { ...map.get(m.message_id), ...m });
  });
  return Array.from(map.values()).sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return String(a.message_id).localeCompare(String(b.message_id));
  });
}

function buildChatParams(filters, page) {
  const params = { scope: filters.scope, status: filters.status, page };
  if (filters.instance) params.instance = filters.instance;
  if (filters.q) params.q = filters.q;
  return params;
}

const DEFAULT_FILTERS = { scope: 'mine', status: 'open', instance: '', q: '' };

export default function useWaInbox() {
  const { user } = useAuth();
  const isManager = user?.role === 'admin' || (Array.isArray(user?.roles) && user.roles.includes('admin'));

  const [filters, setFiltersState] = useState(DEFAULT_FILTERS);
  const [chats, setChats] = useState([]);
  const [total, setTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [instanceStates, setInstanceStates] = useState({});

  const alive = useRef(true);
  const seq = useRef(0);          // guards chat-list loads
  const msgSeq = useRef(0);       // guards message loads
  const selectedIdRef = useRef(null);
  const chatsRef = useRef([]);
  const pageRef = useRef(1);
  const cursorRef = useRef({});   // next_before / next_before_id for loadOlder

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { chatsRef.current = chats; }, [chats]);

  const setFilters = useCallback((patch) => {
    setFiltersState((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
  }, []);

  const loadChats = useCallback(async (page = 1) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await waInbox.chats(buildChatParams(filters, page));
      if (!alive.current || mine !== seq.current) return;
      const data = res?.data || {};
      setChats(data.items || []);
      setTotal(data.total || 0);
      setUnreadTotal(data.unread_total || 0);
      pageRef.current = page;
    } catch (e) {
      if (alive.current && mine === seq.current) toast.error(errText(e, 'Could not load WhatsApp chats'));
    } finally {
      if (alive.current && mine === seq.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => { loadChats(1); }, [loadChats]);

  const select = useCallback(async (chatId) => {
    setSelectedId(chatId);
    setMessages([]);
    setHasMore(false);
    cursorRef.current = {};
    const mine = ++msgSeq.current;
    try {
      const res = await waInbox.messages(chatId, { limit: 50 });
      if (!alive.current || mine !== msgSeq.current) return;
      const data = res?.data || {};
      setMessages(mergeMessages([], data.items || []));
      setHasMore(!!data.has_more);
      cursorRef.current = { before: data.next_before, before_id: data.next_before_id };
    } catch (e) {
      if (alive.current && mine === msgSeq.current) toast.error(errText(e, 'Could not load messages'));
    }

    const chat = chatsRef.current.find((c) => c.chat_id === chatId);
    if (chat && chat.unread_count > 0) {
      const priorUnread = chat.unread_count;
      setChats((prev) => prev.map((c) => (c.chat_id === chatId ? { ...c, unread_count: 0 } : c)));
      setUnreadTotal((ut) => Math.max(0, ut - priorUnread));
      try { await waInbox.read(chatId); } catch { /* non-critical, next refetch will settle it */ }
    }
  }, []);

  const loadOlder = useCallback(async () => {
    if (!selectedId || !hasMore) return;
    const { before, before_id } = cursorRef.current || {};
    try {
      const res = await waInbox.messages(selectedId, { before, before_id, limit: 50 });
      const data = res?.data || {};
      setMessages((prev) => mergeMessages(data.items || [], prev));
      setHasMore(!!data.has_more);
      cursorRef.current = { before: data.next_before, before_id: data.next_before_id };
    } catch (e) {
      toast.error(errText(e, 'Could not load older messages'));
    }
  }, [selectedId, hasMore]);

  const send = useCallback(async ({ text, attachment_id, template_id } = {}) => {
    const chatId = selectedIdRef.current;
    if (!chatId) return;
    const tmpId = `tmp_${Date.now()}`;
    const optimistic = {
      message_id: tmpId,
      chat_id: chatId,
      direction: 'out',
      text,
      media: attachment_id ? { attachment_id } : null,
      status: 'queued',
      typed_by: user?.email,
      sent_via_owner_email: user?.email,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => mergeMessages(prev, [optimistic]));
    setSending(true);
    try {
      const res = await waInbox.send(chatId, { text, attachment_id, template_id });
      const data = res?.data || {};
      const row = data.message;
      setMessages((prev) => prev.map((m) => {
        if (m.message_id !== tmpId) return m;
        if (row) return row;
        return { ...m, status: data.status || m.status, fail_reason: data.reason };
      }));
    } catch (e) {
      setMessages((prev) => prev.map((m) => (
        m.message_id === tmpId ? { ...m, status: 'failed', fail_reason: errText(e, 'Send failed') } : m
      )));
      toast.error(errText(e, 'Send failed'));
    } finally {
      if (alive.current) setSending(false);
    }
  }, [user]);

  const patchChat = useCallback((chatId, patch) => {
    setChats((prev) => prev.map((c) => (c.chat_id === chatId ? { ...c, ...patch } : c)));
  }, []);

  const resolve = useCallback(async (chatId) => {
    try { await waInbox.resolve(chatId); patchChat(chatId, { status: 'resolved' }); }
    catch (e) { toast.error(errText(e, 'Could not resolve chat')); }
  }, [patchChat]);

  const reopen = useCallback(async (chatId) => {
    try { await waInbox.reopen(chatId); patchChat(chatId, { status: 'open' }); }
    catch (e) { toast.error(errText(e, 'Could not reopen chat')); }
  }, [patchChat]);

  const assign = useCallback(async (chatId, email) => {
    try { await waInbox.assign(chatId, email); patchChat(chatId, { assignee_email: email }); }
    catch (e) { toast.error(errText(e, 'Could not assign chat')); }
  }, [patchChat]);

  const addNote = useCallback(async (chatId, text) => {
    try {
      const res = await waInbox.addNote(chatId, text);
      const notes = res?.data?.notes;
      if (notes !== undefined) patchChat(chatId, { notes });
    } catch (e) { toast.error(errText(e, 'Could not add note')); }
  }, [patchChat]);

  const link = useCallback(async (chatId, data) => {
    try {
      const res = await waInbox.link(chatId, data);
      const chat = res?.data?.chat || res?.data;
      if (chat) patchChat(chatId, chat);
    } catch (e) { toast.error(errText(e, 'Could not link chat')); }
  }, [patchChat]);

  const handleStreamEvent = useCallback((type, data) => {
    if (type === 'message_new') {
      setChats((prev) => {
        const next = applyMessageNew(prev, data, filters);
        const oldChat = prev.find((c) => c.chat_id === data.chat_id);
        const newChat = next.find((c) => c.chat_id === data.chat_id);
        const delta = (newChat?.unread_count || 0) - (oldChat?.unread_count || 0);
        if (delta) setUnreadTotal((ut) => Math.max(0, ut + delta));
        return next;
      });
      if (data.chat_id === selectedIdRef.current) {
        setMessages((prev) => mergeMessages(prev, [{
          message_id: data.message_id,
          chat_id: data.chat_id,
          direction: data.direction,
          text: data.preview,
          status: data.status || 'delivered',
          typed_by: data.typed_by,
          created_at: new Date().toISOString(),
        }]));
      }
    } else if (type === 'message_status') {
      setMessages((prev) => applyMessageStatus(prev, data));
    } else if (type === 'chat_updated') {
      setChats((prev) => {
        const oldChat = prev.find((c) => c.chat_id === data.chat_id);
        const next = prev.map((c) => (c.chat_id === data.chat_id ? { ...c, ...data } : c));
        if (oldChat && data.unread_count !== undefined) {
          const delta = data.unread_count - (oldChat.unread_count || 0);
          if (delta) setUnreadTotal((ut) => Math.max(0, ut + delta));
        }
        return next;
      });
    } else if (type === 'instance_state') {
      setInstanceStates((prev) => ({ ...prev, [data.instance_name]: data.state }));
    }
  }, [filters]);

  const { connected, degraded } = useWaStream(handleStreamEvent, { enabled: true });

  // The stream degraded to polling — refetch the visible page every 30 s.
  useEffect(() => {
    if (!degraded) return undefined;
    const iv = setInterval(() => { loadChats(pageRef.current || 1); }, DEGRADED_POLL_MS);
    return () => clearInterval(iv);
  }, [degraded, loadChats]);

  return {
    filters, setFilters,
    chats, total, unreadTotal,
    selectedId, messages, hasMore,
    loading, sending,
    isManager,
    connected, degraded,
    instanceStates,
    select, loadOlder, send,
    resolve, reopen, assign, addNote, link,
    reloadChats: loadChats,
  };
}

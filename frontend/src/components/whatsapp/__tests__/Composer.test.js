// Composer: Enter sends and clears, Shift+Enter keeps typing, the box is off with a reason
// when the number is not connected (or the contact opted out), a template pre-fills the box
// with the server-rendered body, and a picked file uploads then sends with the text as caption.
// Rendered via react-dom/client (no @testing-library/react here).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import Composer, { disabledReason } from '../Composer';
import { waInbox } from '../../../lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({
  waInbox: { templates: jest.fn(), renderTemplate: jest.fn(), uploadAttachment: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

let mounted = [];
beforeEach(() => { jest.clearAllMocks(); document.body.innerHTML = ''; mounted = []; });
afterEach(() => { mounted.forEach((r) => act(() => r.unmount())); });

async function render(ui) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  mounted.push(root);
  await act(async () => { root.render(ui); });
  await flush();
  return { el, root, q: (id) => el.querySelector(`[data-testid="${id}"]`), qa: (id) => Array.from(el.querySelectorAll(`[data-testid="${id}"]`)) };
}

function type(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const key = (el, opts) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...opts }));

const chat = { chat_id: 'c1', contact_id: 'con_1', school_id: 'sch_1', instance_name: 'rep_priya' };

test('Enter sends the trimmed text and clears the box', async () => {
  const onSend = jest.fn();
  const v = await render(<Composer chat={chat} onSend={onSend} />);
  const ta = v.q('composer-text');
  act(() => { type(ta, '  hello there  '); });
  act(() => { key(ta); });
  expect(onSend).toHaveBeenCalledWith({ text: 'hello there' });
  expect(ta.value).toBe('');
});

test('Shift+Enter does not send', async () => {
  const onSend = jest.fn();
  const v = await render(<Composer chat={chat} onSend={onSend} />);
  const ta = v.q('composer-text');
  act(() => { type(ta, 'line one'); });
  act(() => { key(ta, { shiftKey: true }); });
  expect(onSend).not.toHaveBeenCalled();
  expect(ta.value).toBe('line one');
});

test('the send button sends too, and an empty box never sends', async () => {
  const onSend = jest.fn();
  const v = await render(<Composer chat={chat} onSend={onSend} />);
  expect(v.q('composer-send').disabled).toBe(true);
  act(() => { key(v.q('composer-text')); });
  expect(onSend).not.toHaveBeenCalled();
  act(() => { type(v.q('composer-text'), 'ok'); });
  expect(v.q('composer-send').disabled).toBe(false);
  act(() => { v.q('composer-send').click(); });
  expect(onSend).toHaveBeenCalledWith({ text: 'ok' });
});

test('a number that is not connected turns the box off and says why', async () => {
  const onSend = jest.fn();
  const v = await render(<Composer chat={chat} instanceState="disconnected" onSend={onSend} />);
  expect(v.q('composer-reason').textContent).toMatch(/disconnected/);
  expect(v.q('composer-text').disabled).toBe(true);
  expect(v.q('composer-send').disabled).toBe(true);
  expect(v.q('composer-attach').disabled).toBe(true);
  expect(v.q('composer-template').disabled).toBe(true);
  act(() => { key(v.q('composer-text')); });
  expect(onSend).not.toHaveBeenCalled();
});

test('disabledReason: opt-out, each state, unknown state allowed, connected allowed', () => {
  expect(disabledReason({ chat: { opted_out: true } })).toMatch(/opted out/);
  expect(disabledReason({ chat, instanceState: 'paused' })).toMatch(/paused/);
  expect(disabledReason({ chat, instanceState: 'qr' })).toMatch(/QR/);
  expect(disabledReason({ chat: { ...chat, instance_state: 'unlinked' } })).toMatch(/not linked/);
  expect(disabledReason({ chat })).toBe('');
  expect(disabledReason({ chat, instanceState: 'connected' })).toBe('');
  expect(disabledReason({})).toMatch(/Pick a chat/);
});

test('picking a template pre-fills the box with the rendered body for this chat', async () => {
  waInbox.templates.mockResolvedValue({ data: [
    { template_id: 'tpl_1', name: 'Follow-up', body: 'Hi {contact_name}' },
    { template_id: 'tpl_2', name: 'Thanks', body: 'Thanks {school_name}' },
  ] });
  waInbox.renderTemplate.mockResolvedValue({ data: { body: 'Hi Ravi', phone: '919811111111' } });
  const onSend = jest.fn();
  const v = await render(<Composer chat={chat} onSend={onSend} />);
  expect(v.q('template-picker')).toBeNull();
  await act(async () => { v.q('composer-template').click(); });
  await flush();
  expect(waInbox.templates).toHaveBeenCalledTimes(1);
  const options = v.qa('template-option');
  expect(options).toHaveLength(2);
  expect(options[0].textContent).toMatch(/Follow-up/);
  await act(async () => { options[0].click(); });
  await flush();
  expect(waInbox.renderTemplate).toHaveBeenCalledWith({ template_id: 'tpl_1', contact_id: 'con_1', school_id: 'sch_1', lead_id: undefined });
  expect(v.q('composer-text').value).toBe('Hi Ravi');
  expect(v.q('template-picker')).toBeNull();
  expect(onSend).not.toHaveBeenCalled();                // pre-fill only — the rep sends
  // the rep can edit before sending
  act(() => { type(v.q('composer-text'), 'Hi Ravi, quick update'); });
  act(() => { key(v.q('composer-text')); });
  expect(onSend).toHaveBeenCalledWith({ text: 'Hi Ravi, quick update' });
});

test('a failed render falls back to the raw template body and reports it', async () => {
  waInbox.templates.mockResolvedValue({ data: [{ template_id: 'tpl_1', name: 'Follow-up', body: 'Hi {contact_name}' }] });
  waInbox.renderTemplate.mockRejectedValue({ response: { data: { detail: 'Template not found' } } });
  const v = await render(<Composer chat={chat} onSend={jest.fn()} />);
  await act(async () => { v.q('composer-template').click(); });
  await flush();
  await act(async () => { v.q('template-option').click(); });
  await flush();
  expect(toast.error).toHaveBeenCalledWith('Template not found');
  expect(v.q('composer-text').value).toBe('Hi {contact_name}');
});

test('a picked file is uploaded and sent with the typed text as caption', async () => {
  waInbox.uploadAttachment.mockResolvedValue({ data: { attachment_id: 'att_9', url: 'https://x/f.pdf' } });
  const onSend = jest.fn();
  const v = await render(<Composer chat={chat} onSend={onSend} />);
  act(() => { type(v.q('composer-text'), 'see attached'); });
  const input = v.q('composer-file');
  const file = new File(['%PDF'], 'quote.pdf', { type: 'application/pdf' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await flush();
  expect(waInbox.uploadAttachment).toHaveBeenCalledWith(file);
  expect(onSend).toHaveBeenCalledWith({ text: 'see attached', attachment_id: 'att_9' });
  expect(v.q('composer-text').value).toBe('');
});

test('the box empties when the chat changes', async () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  mounted.push(root);
  await act(async () => { root.render(<Composer chat={chat} onSend={jest.fn()} />); });
  const ta = el.querySelector('[data-testid="composer-text"]');
  act(() => { type(ta, 'draft'); });
  expect(ta.value).toBe('draft');
  await act(async () => { root.render(<Composer chat={{ ...chat, chat_id: 'c2' }} onSend={jest.fn()} />); });
  expect(el.querySelector('[data-testid="composer-text"]').value).toBe('');
});

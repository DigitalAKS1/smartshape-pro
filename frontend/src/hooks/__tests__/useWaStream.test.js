// Rendered through a probe component via react-dom/client (no
// @testing-library/react in this repo's node_modules — same pattern as
// useLeadsData.test.js / useMailMaterials.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import useWaStream from '../useWaStream';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../lib/api', () => ({
  waInbox: { streamUrl: () => 'https://api.example.test/api/wa/stream' },
}));

class FakeEventSource {
  constructor(url, opts) {
    this.url = url;
    this.opts = opts;
    this.listeners = {};
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type, data) {
    (this.listeners[type] || []).forEach((fn) => fn({ data: JSON.stringify(data) }));
  }
  error() {
    this.onerror && this.onerror(new Event('error'));
    (this.listeners.error || []).forEach((fn) => fn(new Event('error')));
  }
}
FakeEventSource.instances = [];

global.EventSource = FakeEventSource;

let hookResult = null;
function Probe({ onEvent, enabled }) {
  hookResult = useWaStream(onEvent, { enabled });
  return null;
}

let container;
let root;

function mount(props) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => {
    root.render(<Probe {...props} />);
  });
}

function rerender(props) {
  return act(async () => {
    root.render(<Probe {...props} />);
  });
}

beforeEach(() => {
  FakeEventSource.instances = [];
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  hookResult = null;
});

test('opens exactly one EventSource with the stream URL and credentials', async () => {
  await mount({ onEvent: jest.fn(), enabled: true });

  expect(FakeEventSource.instances).toHaveLength(1);
  expect(FakeEventSource.instances[0].url).toBe('https://api.example.test/api/wa/stream');
  expect(FakeEventSource.instances[0].opts).toEqual({ withCredentials: true });
});

test('enabled=false opens nothing', async () => {
  await mount({ onEvent: jest.fn(), enabled: false });

  expect(FakeEventSource.instances).toHaveLength(0);
  expect(hookResult.connected).toBe(false);
});

test('dispatches parsed events to onEvent by type and marks connected', async () => {
  const onEvent = jest.fn();
  await mount({ onEvent, enabled: true });
  const es = FakeEventSource.instances[0];

  await act(async () => {
    es.emit('message_new', { chat_id: 'c1', message_id: 'm1', unread_count: 2 });
  });

  expect(onEvent).toHaveBeenCalledWith('message_new', { chat_id: 'c1', message_id: 'm1', unread_count: 2 });
  expect(hookResult.connected).toBe(true);

  await act(async () => {
    es.emit('chat_updated', { chat_id: 'c1', status: 'open' });
  });
  expect(onEvent).toHaveBeenCalledWith('chat_updated', { chat_id: 'c1', status: 'open' });

  await act(async () => {
    es.emit('message_status', { chat_id: 'c1', message_id: 'm1', status: 'delivered' });
  });
  expect(onEvent).toHaveBeenCalledWith('message_status', { chat_id: 'c1', message_id: 'm1', status: 'delivered' });

  await act(async () => {
    es.emit('instance_state', { instance_name: 'inst1', state: 'connected' });
  });
  expect(onEvent).toHaveBeenCalledWith('instance_state', { instance_name: 'inst1', state: 'connected' });
});

test('closes the EventSource on unmount', async () => {
  await mount({ onEvent: jest.fn(), enabled: true });
  const es = FakeEventSource.instances[0];
  expect(es.closed).toBe(false);

  act(() => { root.unmount(); });
  expect(es.closed).toBe(true);

  // Prevent the afterEach from unmounting an already-unmounted root.
  root = createRoot(document.createElement('div'));
});

test('after 3 consecutive errors, switches to degraded', async () => {
  await mount({ onEvent: jest.fn(), enabled: true });
  const es = FakeEventSource.instances[0];

  await act(async () => { es.error(); });
  expect(hookResult.connected).toBe(false);
  expect(hookResult.degraded).toBe(false);

  await act(async () => { es.error(); });
  expect(hookResult.degraded).toBe(false);

  await act(async () => { es.error(); });
  expect(hookResult.degraded).toBe(true);
  expect(hookResult.lastError).toBeTruthy();
});

test('a successful event after errors resets the error streak', async () => {
  await mount({ onEvent: jest.fn(), enabled: true });
  const es = FakeEventSource.instances[0];

  await act(async () => { es.error(); });
  await act(async () => { es.error(); });
  await act(async () => { es.emit('message_new', { chat_id: 'c1' }); });
  await act(async () => { es.error(); });
  expect(hookResult.degraded).toBe(false);
});

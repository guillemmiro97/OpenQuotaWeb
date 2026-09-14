// Test bridge for the HTTP + SSE web backend.
//
// The application talks to the OpenQuota server through `fetch` and
// `EventSource` (see `src/lib/backend.ts`). The existing suites describe the
// backend in terms of the legacy Tauri command names, so this helper installs
// a `fetch`/`EventSource` shim that translates HTTP routes back to those
// command names before delegating to the suite's `invoke` mock.

import { vi } from 'vitest';
import type { Mock } from 'vitest';

type Args = Record<string, unknown> | undefined;

interface Route {
  method: string;
  pattern: RegExp;
  command: string;
  extract?: (match: RegExpMatchArray, body: Args) => Args;
}

const routes: Route[] = [
  { method: 'GET', pattern: /^\/api\/bootstrap$/, command: 'get_bootstrap_state' },
  { method: 'POST', pattern: /^\/api\/usage\/refresh$/, command: 'refresh_usage' },
  {
    method: 'POST',
    pattern: /^\/api\/usage\/refresh\/([^/]+)$/,
    command: 'refresh_provider_usage',
    extract: (match) => ({ providerId: decodeURIComponent(match[1]) }),
  },
  { method: 'POST', pattern: /^\/api\/codex\/reset-claim$/, command: 'claim_codex_reset_credit' },
  {
    method: 'GET',
    pattern: /^\/api\/providers\/([^/]+)\/links\/(\d+)$/,
    command: 'open_provider_link',
    extract: (match) => ({
      providerId: decodeURIComponent(match[1]),
      linkIndex: Number(match[2]),
    }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/providers\/([^/]+)\/api-key$/,
    command: 'get_provider_api_key_state',
    extract: (match) => ({ providerId: decodeURIComponent(match[1]) }),
  },
  {
    method: 'PUT',
    pattern: /^\/api\/providers\/([^/]+)\/api-key$/,
    command: 'save_provider_api_key',
    extract: (match, body) => ({ providerId: decodeURIComponent(match[1]), ...body }),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/providers\/([^/]+)\/api-key$/,
    command: 'delete_provider_api_key',
    extract: (match) => ({ providerId: decodeURIComponent(match[1]) }),
  },
  {
    method: 'PUT',
    pattern: /^\/api\/providers\/([^/]+)\/credentials$/,
    command: 'save_provider_credentials',
    extract: (match, body) => ({ providerId: decodeURIComponent(match[1]), ...body }),
  },
  { method: 'GET', pattern: /^\/api\/settings$/, command: 'get_app_settings' },
  { method: 'PUT', pattern: /^\/api\/settings$/, command: 'save_app_settings' },
  {
    method: 'POST',
    pattern: /^\/api\/settings\/reset-customization$/,
    command: 'reset_customization',
  },
  { method: 'POST', pattern: /^\/api\/settings\/reset-all$/, command: 'reset_all_settings' },
  {
    method: 'POST',
    pattern: /^\/api\/settings\/reset-provider\/([^/]+)$/,
    command: 'reset_provider_customization',
    extract: (match, body) => ({ providerId: decodeURIComponent(match[1]), ...body }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/notifications\/permission$/,
    command: 'request_notification_permission',
  },
  { method: 'GET', pattern: /^\/api\/logs\/path$/, command: 'get_log_path' },
  { method: 'GET', pattern: /^\/api\/updates$/, command: 'check_for_updates' },
];

function resolveCommand(method: string, url: string, body: Args) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = url.match(route.pattern);
    if (!match) continue;
    return { command: route.command, args: route.extract ? route.extract(match, body) : body };
  }
  return null;
}

/** Install a `fetch` shim that forwards HTTP routes to the provided invoke mock. */
export function installBackendBridge(invoke: Mock) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const url = rawUrl.startsWith('http') ? new URL(rawUrl).pathname : rawUrl;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body =
      typeof init?.body === 'string' && init.body.length > 0
        ? (JSON.parse(init.body) as Args)
        : undefined;

    const resolved = resolveCommand(method, url, body);
    if (!resolved) {
      return new Response(`Unhandled backend route ${method} ${url}`, { status: 404 });
    }

    try {
      const result =
        resolved.args === undefined
          ? await invoke(resolved.command)
          : await invoke(resolved.command, resolved.args);
      if (result === undefined) {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Backend error';
      return new Response(message, { status: 500 });
    }
  }) as unknown as typeof fetch;
}

interface ServerEvent {
  data: string;
}

type EventListener = (event: ServerEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  private listeners = new Map<string, Set<EventListener>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: EventListener | null = null;
  readyState = 0;

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: EventListener) {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener);
  }

  removeEventListener(name: string, listener: EventListener) {
    this.listeners.get(name)?.delete(listener);
  }

  dispatch(name: string, data: string) {
    this.listeners.get(name)?.forEach((listener) => listener({ data }));
  }

  close() {
    this.listeners.clear();
  }
}

/** Install a minimal `EventSource` implementation and expose an emit helper. */
export function installEventSourceBridge() {
  (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;
}

/** Emit a server-sent event to every open subscription. */
export function emitServerEvent(name: string, payload: unknown) {
  const data = payload === undefined ? 'null' : JSON.stringify(payload);
  MockEventSource.instances.forEach((instance) => instance.dispatch(name, data));
}

/** Wait until at least one EventSource subscription for `name` exists. */
export function hasEventSubscribers(name: string) {
  return MockEventSource.instances.some((instance) =>
    (instance as unknown as { listeners: Map<string, Set<EventListener>> }).listeners.has(name),
  );
}

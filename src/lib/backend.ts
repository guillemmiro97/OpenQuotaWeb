// Web backend bridge.
//
// The desktop build talks to Tauri over `invoke`/`listen`. This fork keeps the
// exact same public API but talks to the OpenQuota web server over HTTP + SSE,
// so every Svelte component can stay unchanged.

import type {
  ApiKeyMutationOutcome,
  AppSettings,
  BootstrapState,
  ProviderApiKeyState,
  ResetClaimOutcome,
  SettingsViewState,
  UpdateProgress,
  UpdateStatus,
  UsageViewState,
} from './types';

type StopListening = () => void;
type PayloadHandler<T> = (payload: T) => void;
export type PanelResizeEdge = 'top' | 'bottom';
export type PanelHeightMode = 'automatic' | 'manual';

const API_BASE = '/api';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message.trim() || `OpenQuota request failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// --- Server-sent events ---------------------------------------------------

const handlers = new Map<string, Set<PayloadHandler<unknown>>>();
const subscribed = new Set<string>();
let eventSource: EventSource | null = null;

function ensureEventSource(): EventSource | null {
  if (typeof EventSource === 'undefined') {
    return null;
  }
  if (!eventSource) {
    eventSource = new EventSource(`${API_BASE}/events`);
  }
  return eventSource;
}

function onEvent<T>(name: string, handler: PayloadHandler<T>): Promise<StopListening> {
  const source = ensureEventSource();
  let set = handlers.get(name);
  if (!set) {
    set = new Set();
    handlers.set(name, set);
  }
  const wrapped = handler as unknown as PayloadHandler<unknown>;
  set.add(wrapped);

  if (source && !subscribed.has(name)) {
    subscribed.add(name);
    source.addEventListener(name, (event) => {
      const listeners = handlers.get(name);
      if (!listeners) return;
      let payload: unknown;
      try {
        payload = JSON.parse((event as MessageEvent).data);
      } catch {
        return;
      }
      listeners.forEach((listener) => listener(payload));
    });
  }

  return Promise.resolve(() => {
    handlers.get(name)?.delete(wrapped);
  });
}

// --- Commands -------------------------------------------------------------

export function getBootstrapState() {
  return request<BootstrapState>('GET', '/bootstrap');
}

export function refreshUsage() {
  return request<UsageViewState>('POST', '/usage/refresh');
}

export function refreshProviderUsage(providerId: string) {
  return request<UsageViewState>('POST', `/usage/refresh/${encodeURIComponent(providerId)}`);
}

export function claimCodexResetCredit(expiresAt: string, redeemRequestId: string) {
  return request<ResetClaimOutcome>('POST', '/codex/reset-claim', { expiresAt, redeemRequestId });
}

export async function openProviderLink(providerId: string, linkIndex: number) {
  const link = await request<{ url: string }>(
    'GET',
    `/providers/${encodeURIComponent(providerId)}/links/${linkIndex}`,
  );
  window.open(link.url, '_blank', 'noopener,noreferrer');
}

export function getProviderApiKeyState(providerId: string) {
  return request<ProviderApiKeyState | null>(
    'GET',
    `/providers/${encodeURIComponent(providerId)}/api-key`,
  );
}

export function saveProviderCredentials(providerId: string, content: string) {
  return request<void>(
    'PUT',
    `/providers/${encodeURIComponent(providerId)}/credentials`,
    { content },
  );
}

export function saveProviderApiKey(providerId: string, apiKey: string) {
  return request<ApiKeyMutationOutcome>(
    'PUT',
    `/providers/${encodeURIComponent(providerId)}/api-key`,
    { apiKey },
  );
}

export function deleteProviderApiKey(providerId: string) {
  return request<ApiKeyMutationOutcome>(
    'DELETE',
    `/providers/${encodeURIComponent(providerId)}/api-key`,
  );
}

export function getAppSettings() {
  return request<SettingsViewState>('GET', '/settings');
}

export function saveAppSettings(
  settings: AppSettings,
  expectedSettingsRevision: number,
  expectedAccountRevision: number,
) {
  return request<SettingsViewState>('PUT', '/settings', {
    settings,
    expectedSettingsRevision,
    expectedAccountRevision,
  });
}

export function resetCustomization(
  expectedSettingsRevision: number,
  expectedAccountRevision: number,
) {
  return request<SettingsViewState>('POST', '/settings/reset-customization', {
    expectedSettingsRevision,
    expectedAccountRevision,
  });
}

export function resetAllSettings(
  expectedSettingsRevision: number,
  expectedAccountRevision: number,
) {
  return request<SettingsViewState>('POST', '/settings/reset-all', {
    expectedSettingsRevision,
    expectedAccountRevision,
  });
}

export function resetProviderCustomization(
  providerId: string,
  expectedSettingsRevision: number,
  expectedAccountRevision: number,
) {
  return request<SettingsViewState>(
    'POST',
    `/settings/reset-provider/${encodeURIComponent(providerId)}`,
    { expectedSettingsRevision, expectedAccountRevision },
  );
}

export function requestNotificationPermission() {
  return request<SettingsViewState>('POST', '/notifications/permission');
}

export function openNotificationSettings() {
  return Promise.resolve();
}

export function getLogPath() {
  return request<string>('GET', '/logs/path');
}

export function openLogFolder() {
  return Promise.resolve();
}

export function dismissMainWindow() {
  return Promise.resolve();
}

export function getPanelResizeEdge() {
  return Promise.resolve<PanelResizeEdge>('bottom');
}

export function getPanelHeightMode() {
  return Promise.resolve<PanelHeightMode>('automatic');
}

export function fitPanelToContent(_height: number) {
  return Promise.resolve(false);
}

export function setPanelHeightAutomatic() {
  return Promise.resolve();
}

export function setPanelHeightManual() {
  return Promise.resolve();
}

export function beginPanelResize() {
  return Promise.resolve<PanelResizeEdge>('bottom');
}

export function lockPanelResizeAxis() {
  return Promise.resolve();
}

export function quitApplication() {
  return Promise.resolve();
}

export function checkForApplicationUpdates() {
  return request<UpdateStatus>('GET', '/updates');
}

export function installApplicationUpdate() {
  return Promise.resolve();
}

export function openUpdatePage() {
  window.open('https://github.com/deviffyy/OpenQuota/releases', '_blank', 'noopener,noreferrer');
  return Promise.resolve();
}

export function onUsageState(handler: PayloadHandler<UsageViewState>) {
  return onEvent('usage-state', handler);
}

export function onSettingsState(handler: PayloadHandler<SettingsViewState>) {
  return onEvent('settings-state', handler);
}

export function onOpenScreen(handler: PayloadHandler<string>) {
  return onEvent('open-screen', handler);
}

export function onMainWindowHidden(handler: PayloadHandler<void>) {
  return onEvent('main-window-hidden', handler);
}

export function onUpdateProgress(handler: PayloadHandler<UpdateProgress>) {
  return onEvent('update-progress', handler);
}

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';
import type { UsageViewState } from './lib/types';
import { liveState, providerCatalog, settingsState } from './test/appFixtures';
import {
  emitServerEvent,
  hasEventSubscribers,
  installBackendBridge,
  installEventSourceBridge,
} from './test/backendBridge';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

type InvokeArgs = { settings?: unknown; providerId?: string; linkIndex?: number };
type InvokeImplementation = (command: string, args?: InvokeArgs) => unknown;

function mockInvoke(implementation: InvokeImplementation) {
  mocks.invoke.mockImplementation((command: string, args?: InvokeArgs) => {
    if (command === 'get_bootstrap_state') {
      return Promise.all([
        implementation('get_usage_state', args),
        implementation('get_app_settings', args),
      ]).then(([usage, settings]) => ({ usage, settings, catalog: providerCatalog }));
    }
    return implementation(command, args);
  });
}

describe('OpenQuota web dashboard', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    installBackendBridge(mocks.invoke);
    installEventSourceBridge();
    mockInvoke((command: string, args?: InvokeArgs) => {
      if (
        command === 'get_usage_state' ||
        command === 'refresh_usage' ||
        command === 'refresh_provider_usage'
      ) {
        return Promise.resolve(liveState);
      }
      if (command === 'get_app_settings') return Promise.resolve(settingsState);
      if (command === 'save_app_settings') {
        return Promise.resolve({
          ...settingsState,
          settings: args?.settings ?? settingsState.settings,
        });
      }
      if (command === 'check_for_updates') {
        return Promise.resolve({
          available: false,
          currentVersion: '0.1.0',
          version: null,
          body: null,
          installable: true,
          releaseUrl: 'https://github.com/deviffyy/OpenQuota/releases/latest',
        });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
  });

  afterEach(cleanup);

  it('loads the dashboard from the bootstrap payload', async () => {
    render(App);

    expect(await screen.findByText('Plus')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Codex' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Summary' })).getByText('$3.84'),
    ).toBeInTheDocument();
  });

  it('applies usage-state events pushed by the server', async () => {
    render(App);
    await screen.findByText('Plus');

    const updated: UsageViewState = {
      providers: {
        codex: {
          ...liveState.providers.codex,
          snapshot: { ...liveState.providers.codex.snapshot!, plan: 'Business' },
        },
      },
    };

    await waitFor(() => expect(hasEventSubscribers('usage-state')).toBe(true));
    emitServerEvent('usage-state', updated);

    expect(await screen.findByText('Business')).toBeInTheDocument();
  });

  it('refreshes usage through the backend', async () => {
    render(App);
    await screen.findByText('Plus');

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('refresh_usage'));
  });

  it('refreshes a single provider through the backend', async () => {
    render(App);
    await screen.findByText('Plus');

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh Codex' }));

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('refresh_provider_usage', { providerId: 'codex' }),
    );
  });

  it('navigates to Customize from the dashboard', async () => {
    render(App);
    await screen.findByText('Plus');

    const actions = document.querySelector('.dash__actions');
    expect(actions).not.toBeNull();
    await fireEvent.click(
      within(actions as HTMLElement).getByRole('button', { name: 'Customize' }),
    );

    expect(await screen.findByRole('heading', { name: 'Customize' })).toBeInTheDocument();
  });

  it('navigates to Settings from the dashboard', async () => {
    render(App);
    await screen.findByText('Plus');

    const actions = document.querySelector('.dash__actions');
    expect(actions).not.toBeNull();
    await fireEvent.click(within(actions as HTMLElement).getByRole('button', { name: 'Settings' }));

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('reports a backend failure instead of an empty dashboard', async () => {
    mocks.invoke.mockRejectedValue('OpenQuota backend is offline.');

    render(App);

    expect(await screen.findByRole('alert')).toHaveTextContent('OpenQuota backend is unavailable.');
  });
});

<script lang="ts">
  import type {
    AppSettings,
    ProviderSnapshot,
    ProviderViewState,
    QuotaWindow,
    UsagePeriod,
    UsageViewState,
    ValueMetric,
  } from './types';
  import type { ProviderCatalogIndex } from './metrics';
  import ProviderIcon from './ProviderIcon.svelte';
  import Icon from './Icon.svelte';
  import { formatMetricValue } from './metricFormat';

  interface Props {
    viewState: UsageViewState;
    catalog: ProviderCatalogIndex;
    settings: AppSettings;
    now: number;
    anyRefreshing: boolean;
    onRefreshAll: () => void;
    onRefreshProvider: (providerId: string) => void;
    onCustomize: () => void;
    onSettings: () => void;
  }
  let {
    viewState,
    catalog,
    settings,
    now,
    anyRefreshing,
    onRefreshAll,
    onRefreshProvider,
    onCustomize,
    onSettings,
  }: Props = $props();

  const currency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const compact = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  const enabledProviders = $derived(
    settings.providers
      .filter((provider) => provider.enabled && catalog.provider(provider.id))
      .map((provider) => provider.id),
  );

  const totalSpend = $derived.by(() => {
    let cost = 0;
    let tokens = 0;
    let hasCost = false;
    for (const id of enabledProviders) {
      const period = viewState.providers[id]?.snapshot?.usage?.[settings.totalSpendPeriod];
      if (!period) continue;
      tokens += period.tokens ?? 0;
      if (typeof period.estimatedCostUsd === 'number') {
        cost += period.estimatedCostUsd;
        hasCost = true;
      }
    }
    return { cost, tokens, hasCost };
  });

  const onlineCount = $derived(
    enabledProviders.filter((id) => viewState.providers[id]?.snapshot).length,
  );
  const alertCount = $derived(
    enabledProviders.filter((id) =>
      (viewState.providers[id]?.snapshot?.quotas ?? []).some(
        (quota) => quota.usedPercent >= 85,
      ),
    ).length,
  );

  function providerName(id: string) {
    return catalog.displayName(id, settings.providerNames);
  }

  function stateOf(id: string): ProviderViewState | undefined {
    return viewState.providers[id];
  }

  function money(value: number) {
    return currency.format(value);
  }

  function tokens(value: number) {
    return compact.format(value);
  }

  function percent(value: number) {
    return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
  }

  function quotaValue(quota: QuotaWindow) {
    return settings.usageDisplay === 'left' ? 100 - quota.usedPercent : quota.usedPercent;
  }

  function quotaText(quota: QuotaWindow) {
    const value = percent(quotaValue(quota));
    return settings.usageDisplay === 'left' ? `${value} left` : `${value} used`;
  }

  function quotaTone(quota: QuotaWindow) {
    const used = quota.usedPercent;
    if (used >= 90) return 'critical';
    if (used >= 75) return 'warning';
    return 'ok';
  }

  function resetLabel(resetsAt: string | null) {
    if (!resetsAt) return '';
    const remaining = Date.parse(resetsAt) - now;
    if (!Number.isFinite(remaining)) return '';
    if (remaining <= 0) return 'now';
    const minutes = Math.floor(remaining / 60_000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function valueText(metric: ValueMetric) {
    const first = metric.values[0];
    if (!first) return '—';
    return formatMetricValue(first.number, first.kind, 'row', first.label ?? undefined);
  }

  function hasUsage(snapshot: ProviderSnapshot) {
    const usage = snapshot.usage;
    return Boolean(
      usage.today || usage.yesterday || usage.last30Days || (usage.daily?.length ?? 0) > 0,
    );
  }

  function usageCost(period: UsagePeriod | null) {
    if (!period || typeof period.estimatedCostUsd !== 'number') return '';
    return money(period.estimatedCostUsd);
  }

  function lastUpdatedLabel() {
    const value = viewState.lastFullRefreshAt;
    if (!value) return 'Waiting for first refresh';
    const remaining = Date.parse(value) + 5 * 60_000 - now;
    if (remaining <= 0) return 'Refreshing soon';
    const minutes = Math.ceil(remaining / 60_000);
    return `Next refresh in ${minutes}m`;
  }
</script>

<div class="dash">
  <header class="dash__top">
    <div class="dash__brand">
      <div class="dash__logo"><Icon name="refresh" size={18} strokeWidth={2.2} /></div>
      <div>
        <h1>OpenQuota</h1>
        <p>AI usage dashboard</p>
      </div>
    </div>
    <div class="dash__actions">
      <span class="dash__updated">{lastUpdatedLabel()}</span>
      <button class="btn" type="button" onclick={onRefreshAll} disabled={anyRefreshing}>
        <span class:spin={anyRefreshing}><Icon name="refresh" size={15} strokeWidth={2.2} /></span>
        {anyRefreshing ? 'Refreshing…' : 'Refresh'}
      </button>
      <button class="btn" type="button" onclick={onCustomize}>
        <Icon name="sliders" size={15} strokeWidth={2} />Customize
      </button>
      <button class="btn" type="button" onclick={onSettings}>
        <Icon name="gear" size={15} strokeWidth={2} />Settings
      </button>
    </div>
  </header>

  <section class="kpis" aria-label="Summary">
    <div class="kpi">
      <span class="kpi__label">Spend · {settings.totalSpendPeriod === 'last30Days' ? '30 days' : settings.totalSpendPeriod}</span>
      <strong class="kpi__value">{totalSpend.hasCost ? money(totalSpend.cost) : '—'}</strong>
      <span class="kpi__hint">{tokens(totalSpend.tokens)} tokens</span>
    </div>
    <div class="kpi">
      <span class="kpi__label">Providers</span>
      <strong class="kpi__value">{onlineCount}<small>/{enabledProviders.length}</small></strong>
      <span class="kpi__hint">reporting data</span>
    </div>
    <div class="kpi" class:kpi--alert={alertCount > 0}>
      <span class="kpi__label">Alerts</span>
      <strong class="kpi__value">{alertCount}</strong>
      <span class="kpi__hint">{alertCount > 0 ? 'near a limit' : 'all healthy'}</span>
    </div>
  </section>

  {#if enabledProviders.length === 0}
    <div class="empty">
      <h2>No providers enabled</h2>
      <p>Add the AI tools you use to start tracking quotas and usage.</p>
      <button class="btn btn--primary" type="button" onclick={onCustomize}>Open Customize</button>
    </div>
  {:else}
    <section class="grid" aria-label="Providers">
      {#each enabledProviders as id (id)}
        {@const state = stateOf(id)}
        {@const snapshot = state?.snapshot ?? null}
        <article class="card" class:card--error={Boolean(state?.error)}>
          <header class="card__head">
            <div class="card__identity">
              <span class="card__icon"><ProviderIcon providerId={id} /></span>
              <div class="card__title">
                <h3>{providerName(id)}</h3>
                {#if snapshot?.plan}<span class="card__plan">{snapshot.plan}</span>{/if}
              </div>
            </div>
            <button
              class="icon-btn"
              class:spin={state?.refreshing}
              type="button"
              aria-label={`Refresh ${providerName(id)}`}
              onclick={() => onRefreshProvider(id)}
              disabled={state?.refreshing}
            >
              <Icon name="refresh" size={15} strokeWidth={2.2} />
            </button>
          </header>

          {#if snapshot}
            {#if snapshot.quotas.length > 0}
              <div class="quotas">
                {#each snapshot.quotas as quota (quota.id)}
                  <div class="quota">
                    <div class="quota__row">
                      <span>{quota.label}</span>
                      <b>{quotaText(quota)}</b>
                    </div>
                    <div class="bar">
                      <div
                        class="bar__fill bar__fill--{quotaTone(quota)}"
                        style={`width:${Math.max(2, Math.min(100, quota.usedPercent))}%`}
                      ></div>
                    </div>
                    {#if resetLabel(quota.resetsAt)}
                      <span class="quota__reset">Resets in {resetLabel(quota.resetsAt)}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            {#if snapshot.valueMetrics.length > 0}
              <div class="values">
                {#each snapshot.valueMetrics as metric (metric.id)}
                  <div class="value">
                    <span>{metric.label}</span>
                    <b>{valueText(metric)}</b>
                  </div>
                {/each}
              </div>
            {/if}

            {#if hasUsage(snapshot)}
              <div class="usage">
                <div class="usage__cell">
                  <span>Today</span>
                  <b>{tokens(snapshot.usage.today?.tokens ?? 0)}</b>
                  <small>{usageCost(snapshot.usage.today)}</small>
                </div>
                <div class="usage__cell">
                  <span>Yesterday</span>
                  <b>{tokens(snapshot.usage.yesterday?.tokens ?? 0)}</b>
                  <small>{usageCost(snapshot.usage.yesterday)}</small>
                </div>
                <div class="usage__cell">
                  <span>30 days</span>
                  <b>{tokens(snapshot.usage.last30Days?.tokens ?? 0)}</b>
                  <small>{usageCost(snapshot.usage.last30Days)}</small>
                </div>
              </div>
            {/if}

            {#if state?.error}
              <p class="card__note">{state.error}</p>
            {/if}
          {:else if state?.error}
            <div class="card__empty">
              <p class="card__error">{state.error}</p>
              <button class="btn" type="button" onclick={() => onRefreshProvider(id)}>Retry</button>
            </div>
          {:else}
            <div class="card__empty"><p class="muted">{state?.refreshing ? 'Loading…' : 'No data yet'}</p></div>
          {/if}
        </article>
      {/each}
    </section>
  {/if}
</div>

<style>
  .dash {
    width: 100%;
    max-width: 1440px;
    margin: 0 auto;
    padding: 24px 28px 48px;
    color: var(--text);
  }

  .dash__top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    margin-bottom: 22px;
  }

  .dash__brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .dash__logo {
    display: grid;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    color: #fff;
    background: linear-gradient(135deg, #1689ef, #6e6ef2);
    place-items: center;
  }

  .dash__brand h1 {
    margin: 0;
    font-size: 19px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .dash__brand p {
    margin: 1px 0 0;
    color: var(--secondary);
    font-size: 12px;
  }

  .dash__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .dash__updated {
    margin-right: 4px;
    color: var(--secondary);
    font-size: 12px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid var(--separator);
    border-radius: 10px;
    color: var(--text);
    background: var(--card);
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
    transition:
      background 120ms ease,
      transform 80ms ease;
  }

  .btn:hover:not(:disabled) {
    background: var(--card-hover);
  }

  .btn:active:not(:disabled) {
    transform: scale(0.97);
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .btn--primary {
    border-color: transparent;
    color: #fff;
    background: var(--meter-fill);
  }

  .kpis {
    display: grid;
    gap: 14px;
    margin-bottom: 22px;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }

  .kpi {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 16px 18px;
    border: 1px solid var(--separator);
    border-radius: 14px;
    background: var(--card);
  }

  .kpi--alert {
    border-color: color-mix(in srgb, var(--meter-warning) 45%, var(--separator));
  }

  .kpi__label {
    color: var(--secondary);
    font-size: 12px;
    font-weight: 600;
    text-transform: capitalize;
  }

  .kpi__value {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .kpi__value small {
    color: var(--tertiary);
    font-size: 15px;
    font-weight: 600;
  }

  .kpi__hint {
    color: var(--tertiary);
    font-size: 12px;
  }

  .grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
    align-items: start;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px;
    border: 1px solid var(--separator);
    border-radius: 16px;
    background: var(--card);
    transition:
      border-color 140ms ease,
      box-shadow 140ms ease;
  }

  .card:hover {
    border-color: color-mix(in srgb, var(--text) 18%, var(--separator));
    box-shadow: 0 12px 30px -22px rgba(0, 0, 0, 0.55);
  }

  .card--error {
    border-color: color-mix(in srgb, var(--error) 35%, var(--separator));
  }

  .card__head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .card__identity {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
  }

  .card__icon {
    display: grid;
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--text) 7%, transparent);
    place-items: center;
  }

  .card__title {
    min-width: 0;
  }

  .card__title h3 {
    margin: 0;
    overflow: hidden;
    font-size: 15px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card__plan {
    color: var(--secondary);
    font-size: 12px;
  }

  .icon-btn {
    display: grid;
    width: 30px;
    height: 30px;
    margin-left: auto;
    flex: 0 0 30px;
    border: 1px solid var(--separator);
    border-radius: 9px;
    color: var(--secondary);
    background: transparent;
    cursor: pointer;
    place-items: center;
  }

  .icon-btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--button-hover);
  }

  .quotas {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .quota__row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 13px;
  }

  .quota__row span {
    color: var(--secondary);
  }

  .bar {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--meter-track);
  }

  .bar__fill {
    height: 100%;
    border-radius: 999px;
    background: var(--meter-fill);
    transition: width 300ms ease;
  }

  .bar__fill--warning {
    background: var(--meter-warning);
  }

  .bar__fill--critical {
    background: var(--meter-critical);
  }

  .quota__reset {
    display: block;
    margin-top: 5px;
    color: var(--tertiary);
    font-size: 11px;
  }

  .values {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .value {
    display: flex;
    flex: 1 1 120px;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--text) 4%, transparent);
  }

  .value span {
    color: var(--secondary);
    font-size: 11px;
  }

  .value b {
    font-size: 15px;
  }

  .usage {
    display: grid;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid var(--separator);
    grid-template-columns: repeat(3, 1fr);
  }

  .usage__cell {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .usage__cell span {
    color: var(--secondary);
    font-size: 11px;
  }

  .usage__cell b {
    font-size: 14px;
  }

  .usage__cell small {
    color: var(--tertiary);
    font-size: 11px;
  }

  .card__error {
    margin: 0;
    color: var(--error);
    font-size: 12px;
    line-height: 16px;
  }

  .card__note {
    margin: 0;
    padding-top: 4px;
    border-top: 1px solid var(--separator);
    color: var(--tertiary);
    font-size: 11px;
    line-height: 15px;
  }

  .card__empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .muted {
    margin: 0;
    color: var(--tertiary);
    font-size: 13px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 64px 24px;
    border: 1px dashed var(--separator);
    border-radius: 16px;
    text-align: center;
  }

  .empty h2 {
    margin: 0;
    font-size: 18px;
  }

  .empty p {
    margin: 0;
    color: var(--secondary);
    font-size: 13px;
  }

  .spin {
    animation: spin 900ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>

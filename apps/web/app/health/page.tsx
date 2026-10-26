'use client';

import { formatDateRu, type UiTextKey } from '@buhuchet/domain';
import type { HealthResponse } from '@buhuchet/shared';
import { Card, StatusDot } from '@buhuchet/ui';
import { useEffect, useState } from 'react';
import { api } from '../../src/api-client';
import { useT } from '../../src/l10n/provider';

type State = { kind: 'loading' } | { kind: 'done'; health: HealthResponse } | { kind: 'failed' };

const CHECK_LABELS: Record<keyof HealthResponse['checks'], UiTextKey> = {
  database: 'health.check.database',
  storage: 'health.check.storage',
};

export default function HealthPage() {
  const t = useT();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    api.api.health
      .$get()
      .then((res) => res.json())
      .then((health) => !cancelled && setState({ kind: 'done', health }))
      .catch(() => !cancelled && setState({ kind: 'failed' }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-bold">{t('health.title')}</h1>
      <Card title={t('health.state')}>
        {state.kind === 'loading' && <StatusDot state="pending" label={t('health.checking')} />}
        {state.kind === 'failed' && <StatusDot state="error" label={t('health.api_down')} />}
        {state.kind === 'done' && (
          <div className="flex flex-col gap-3" data-testid="health">
            <StatusDot
              state={state.health.status === 'ok' ? 'ok' : 'error'}
              label={t(state.health.status === 'ok' ? 'health.all_ok' : 'health.degraded')}
            />
            <ul className="flex flex-col gap-2 text-sm">
              {(Object.keys(CHECK_LABELS) as Array<keyof HealthResponse['checks']>).map((key) => (
                <li key={key} data-testid={`check-${key}`}>
                  <StatusDot
                    state={state.health.checks[key]}
                    label={t(
                      state.health.checks[key] === 'ok' ? 'health.check_ok' : 'health.check_error',
                      { name: t(CHECK_LABELS[key]) },
                    )}
                  />
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-muted">
              <dt>{t('health.version')}</dt>
              <dd>{state.health.version}</dd>
              <dt>{t('health.environment')}</dt>
              <dd>{state.health.environment}</dd>
              <dt>{t('health.today')}</dt>
              <dd>{formatDateRu(state.health.todayBishkek)}</dd>
            </dl>
          </div>
        )}
      </Card>
    </main>
  );
}

'use client';

import { formatDateRu } from '@buhuchet/domain';
import type { HealthResponse } from '@buhuchet/shared';
import { Card, StatusDot } from '@buhuchet/ui';
import { useEffect, useState } from 'react';
import { api } from '../../src/api-client';

type State = { kind: 'loading' } | { kind: 'done'; health: HealthResponse } | { kind: 'failed' };

// TODO(l10n): временные тексты до модуля «Локализация» (этап 1).
const CHECK_LABELS: Record<keyof HealthResponse['checks'], string> = {
  database: 'База данных',
  storage: 'Хранилище файлов',
};

export default function HealthPage() {
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
      <h1 className="text-2xl font-bold">Проверка работы системы</h1>
      <Card title="Состояние">
        {state.kind === 'loading' && <StatusDot state="pending" label="Проверяем…" />}
        {state.kind === 'failed' && <StatusDot state="error" label="API не отвечает" />}
        {state.kind === 'done' && (
          <div className="flex flex-col gap-3" data-testid="health">
            <StatusDot
              state={state.health.status === 'ok' ? 'ok' : 'error'}
              label={state.health.status === 'ok' ? 'Всё работает' : 'Есть неполадки'}
            />
            <ul className="flex flex-col gap-2 text-sm">
              {(Object.keys(CHECK_LABELS) as Array<keyof HealthResponse['checks']>).map((key) => (
                <li key={key} data-testid={`check-${key}`}>
                  <StatusDot
                    state={state.health.checks[key]}
                    label={`${CHECK_LABELS[key]}: ${state.health.checks[key] === 'ok' ? 'доступна' : 'недоступна'}`}
                  />
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
              <dt>Версия</dt>
              <dd>{state.health.version}</dd>
              <dt>Среда</dt>
              <dd>{state.health.environment}</dd>
              <dt>Сегодня (Бишкек)</dt>
              <dd>{formatDateRu(state.health.todayBishkek)}</dd>
            </dl>
          </div>
        )}
      </Card>
    </main>
  );
}

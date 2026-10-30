'use client';

import { pluralForm, type Translate } from '@buhuchet/domain';
import { AdminDuesPreview } from '@buhuchet/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiFailure } from '../api-client';

/*
 * Предпросмотр пересчёта сроков в окнах Админки (задача 2.37; ТЗ «система показывает, сколько
 * несданных отчётов в скольких организациях изменится»): сервер считает тем же кодом, что пересчёт
 * после сохранения, по правке, которая не сохраняется.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

/** Запрос через 400 мс после последней правки: окно не шлёт его на каждое нажатие клавиши. */
const DELAY_MS = 400;

function useDebounced<T>(value: T): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setShown(value), DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return shown;
}

/**
 * Сколько несданных отчётов в скольких организациях изменится после правки `body`; `null` — правки,
 * влияющей на сроки, нет. Пока ответа нет — `undefined`.
 */
export function useDuesPreview<T>(
  key: string,
  body: T | null,
  request: (body: T) => Promise<JsonResponse>,
): AdminDuesPreview | undefined {
  const shown = useDebounced(body === null ? null : JSON.stringify(body));
  const current = body === null ? null : JSON.stringify(body);
  const query = useQuery({
    queryKey: ['admin', 'pdicts', 'dues', key, shown],
    queryFn: async () => {
      const res = await request(JSON.parse(shown!) as T);
      if (!res.ok) throw await apiFailure(res);
      return AdminDuesPreview.parse(await res.json());
    },
    enabled: shown !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  // Ответ на прежнюю правку не показывается, пока не пришёл ответ на нынешнюю.
  return current !== null && current === shown ? query.data : undefined;
}

/** «12 несданных отчётов в 3 организациях» (прототип spreadTxt). */
export function spreadText(t: Translate, x: AdminDuesPreview): string {
  if (x.reports === 0) return t('pdicts.type.spread_none');
  return t(`pdicts.type.spread_orgs.${pluralForm(x.orgs)}`, {
    n: x.orgs,
    reports: t(`pdicts.type.spread.${pluralForm(x.reports)}`, { n: x.reports }),
  });
}

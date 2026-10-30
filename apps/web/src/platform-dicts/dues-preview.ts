'use client';

import { pluralForm, type Translate, type UiTextKey } from '@buhuchet/domain';
import { AdminDuesPreview } from '@buhuchet/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState } from 'react';
import { ApiFailure, apiFailure } from '../api-client';

/*
 * Предпросмотр пересчёта сроков в окнах Админки (задача 2.37; ТЗ «система показывает, сколько
 * несданных отчётов в скольких организациях изменится»): сервер считает тем же кодом, что пересчёт
 * после сохранения, по правке, которая не сохраняется.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

/** Запрос через 400 мс после последней правки: окно не шлёт его на каждое нажатие клавиши. */
const DELAY_MS = 400;

/** Ответ предпросмотра: число, ещё считается (оба пусты) или посчитать не вышло. */
export interface DuesPreviewState {
  dues?: AdminDuesPreview;
  failed: boolean;
}

/** Сервер ещё считает прежний предпросмотр этого администратора — повторить чуть позже. */
const busy = (err: unknown) => err instanceof ApiFailure && err.error.code === 'dues_preview_busy';

/**
 * Сколько несданных отчётов в скольких организациях изменится после правки `body`; `null` — правки,
 * влияющей на сроки, нет (или форма с ошибкой). Новый запрос — только когда меняются поля срока
 * (`relevant`, по умолчанию всё тело); прежний запрос отменяется. Пока ответа нет — пусто.
 */
export function useDuesPreview<T>(
  key: string,
  body: T | null,
  request: (body: T, signal: AbortSignal) => Promise<JsonResponse>,
  relevant?: unknown,
): DuesPreviewState {
  const sig = body === null ? null : JSON.stringify(relevant === undefined ? body : relevant);
  // Через `DELAY_MS` после последней правки полей срока — тело на этот момент.
  const [shown, setShown] = useState<{ sig: string; body: T } | null>(null);
  const pick = useEffectEvent(() => (sig === null || body === null ? null : { sig, body }));
  useEffect(() => {
    const timer = setTimeout(() => setShown(pick()), DELAY_MS);
    return () => clearTimeout(timer);
  }, [sig]);
  const query = useQuery({
    queryKey: ['admin', 'pdicts', 'dues', key, shown?.sig ?? null],
    queryFn: async ({ signal }) => {
      const res = await request(shown!.body, signal);
      if (!res.ok) throw await apiFailure(res);
      return AdminDuesPreview.parse(await res.json());
    },
    enabled: shown !== null,
    staleTime: 0,
    gcTime: 0,
    retry: (count, err) => count < 3 && busy(err),
    retryDelay: 1500,
  });
  // Ответ на прежнюю правку не показывается, пока не пришёл ответ на нынешнюю.
  const fresh = sig !== null && shown?.sig === sig;
  return { dues: fresh ? query.data : undefined, failed: fresh && query.isError };
}

/** «12 несданных отчётов в 3 организациях» (прототип spreadTxt). */
export function spreadText(t: Translate, x: AdminDuesPreview): string {
  if (x.reports === 0) return t('pdicts.type.spread_none');
  return t(`pdicts.type.spread_orgs.${pluralForm(x.orgs)}`, {
    n: x.orgs,
    reports: t(`pdicts.type.spread.${pluralForm(x.reports)}`, { n: x.reports }),
  });
}

/**
 * Строка предупреждения окна: с числом (`template` с `{spread}`), «Считаем…» или — посчитать не вышло —
 * без числа: сроки пересчитаются после сохранения.
 */
export function duesNote(t: Translate, state: DuesPreviewState, template: UiTextKey): string {
  if (state.dues) return t(template, { spread: spreadText(t, state.dues) });
  return t(state.failed ? 'pdicts.dues.later' : 'pdicts.cal.dues_wait');
}

'use client';

import type { GridViewSettings, ViewKey } from '@buhuchet/domain';
import { ViewSettingsMap } from '@buhuchet/shared';
import { useToast } from '@buhuchet/ui';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, callApi } from '../api-client';
import { useT } from '../l10n/provider';

/** Все настройки вида пользователя — один запрос на вкладку браузера (`GET /api/view-settings`). */
export const VIEW_SETTINGS_KEY = ['view-settings'] as const;

/** Сохранение вида — через столько после последней правки (перетаскивание ширины, клики по заголовкам). */
const SAVE_DELAY_MS = 300;

const NO_SETTINGS: GridViewSettings = {};

type SettingsMap = Record<string, GridViewSettings>;

async function fetchViewSettings(): Promise<SettingsMap> {
  const res = await api.api['view-settings'].$get();
  if (!res.ok) throw new Error(`view-settings: ${res.status}`);
  return ViewSettingsMap.parse(await res.json()).items;
}

/**
 * Правки вида, сделанные в этой вкладке (`null` — «Сбросить вид»). Настройки грузятся один раз на
 * вкладку, а правка пишется на сервер с задержкой: человек нажал «Статистика» раньше, чем пришёл
 * ответ загрузки, — ответ со старыми настройками затирал правку в кеше, и плашки, едва появившись,
 * пропадали, а кнопка оставалась нажатой (docs/typical-mistakes.md № 65). Поэтому ответ загрузки
 * всегда накрывается правками вкладки. Выход — новая загрузка страницы, правки с ней уходят.
 */
const tabEdits = new WeakMap<QueryClient, Map<string, GridViewSettings | null>>();

function noteViewEdit(client: QueryClient, gridKey: string, settings: GridViewSettings | null) {
  let edits = tabEdits.get(client);
  if (!edits) tabEdits.set(client, (edits = new Map()));
  edits.set(gridKey, settings);
}

/** Запрос настроек вида: ответ сервера, накрытый правками этой вкладки. */
export function viewSettingsQuery(
  client: QueryClient,
  load: () => Promise<SettingsMap> = fetchViewSettings,
) {
  return {
    queryKey: VIEW_SETTINGS_KEY,
    queryFn: async () => {
      const next = { ...(await load()) };
      for (const [key, edit] of tabEdits.get(client) ?? []) {
        if (edit) next[key] = edit;
        else delete next[key];
      }
      return next;
    },
    staleTime: Infinity,
  };
}

/** Правка вида — сразу в кеш; ответ загрузки, которая ещё идёт, её не затрёт. */
export function applyViewEdit(
  client: QueryClient,
  gridKey: string,
  settings: GridViewSettings | null,
) {
  noteViewEdit(client, gridKey, settings);
  client.setQueryData<SettingsMap>(VIEW_SETTINGS_KEY, (map) => {
    const next = { ...map };
    if (settings) next[gridKey] = settings;
    else delete next[gridKey];
    return next;
  });
}

/**
 * Вид списка пользователя (ТЗ «Настройки вида»: столбцы, порядок, ширины, сортировка, плотность,
 * «Таблица / Карточки», записей на странице — для пользователя и списка, переживают перезагрузку и
 * вход с другого устройства). Правка сразу видна на экране и через 300 мс сохраняется на сервере;
 * несохранённая правка уходит и при закрытии страницы. Не удалось загрузить настройки — список
 * показывается по умолчанию.
 */
export function useViewSettings(gridKey: ViewKey) {
  const client = useQueryClient();
  const toast = useToast();
  const t = useT();
  const query = useQuery(viewSettingsQuery(client));
  // Правка видна в том же нажатии: кеш запросов оповещает экран позже, и отмеченная галочка успела бы
  // вернуться на миг в прежнее положение.
  const [local, setLocal] = useState<GridViewSettings | null>(null);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; settings: GridViewSettings }>(
    undefined,
  );

  const put = useCallback(
    async (settings: GridViewSettings, keepalive = false) => {
      const res = await callApi(() =>
        api.api['view-settings'][':gridKey'].$put(
          { param: { gridKey }, json: settings },
          keepalive ? { init: { keepalive: true } } : undefined,
        ),
      );
      if (!res.ok && !keepalive) toast(t('grid.view_save_failed'), { bad: true, icon: 'alert' });
    },
    [gridKey, toast, t],
  );

  const flush = useCallback(
    (keepalive: boolean) => {
      const job = pending.current;
      if (!job) return;
      clearTimeout(job.timer);
      pending.current = undefined;
      void put(job.settings, keepalive);
    },
    [put],
  );

  // Закрыли страницу или ушли с экрана — несохранённая правка уходит сразу.
  useEffect(() => {
    const leave = () => flush(true);
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      flush(true);
    };
  }, [flush]);

  const save = useCallback(
    (settings: GridViewSettings) => {
      setLocal(settings);
      applyViewEdit(client, gridKey, settings);
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = {
        settings,
        timer: setTimeout(() => flush(false), SAVE_DELAY_MS),
      };
    },
    [client, gridKey, flush],
  );

  const reset = useCallback(async () => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = undefined;
    setLocal(null);
    applyViewEdit(client, gridKey, null);
    const res = await callApi(() =>
      api.api['view-settings'][':gridKey'].$delete({ param: { gridKey } }),
    );
    toast(res.ok ? t('grid.view_reset') : t('grid.view_save_failed'), {
      icon: res.ok ? 'refresh' : 'alert',
      bad: !res.ok,
    });
  }, [client, gridKey, toast, t]);

  return {
    settings: local ?? query.data?.[gridKey] ?? NO_SETTINGS,
    /** Настройки получены (или их не удалось получить) — список можно показывать. */
    ready: !query.isPending,
    save,
    reset,
  };
}

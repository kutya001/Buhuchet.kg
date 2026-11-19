import type { GridViewSettings } from '@buhuchet/domain';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { applyViewEdit, VIEW_SETTINGS_KEY, viewSettingsQuery } from './view-settings';

// «Статистика» нажата раньше, чем пришёл ответ первой загрузки настроек вида: ответ со старыми
// настройками затирал правку в кеше — плашки пропадали, кнопка оставалась нажатой (сквозной тест
// admin-l10n.shared.spec.ts прошёл только со второй попытки; docs/typical-mistakes.md № 65).

type SettingsMap = Record<string, GridViewSettings>;

/** Открытый экран, первая загрузка настроек которого ещё идёт: отвечает тем, что было на сервере. */
function openLoading(server: SettingsMap) {
  const client = new QueryClient();
  const release: (() => void)[] = [];
  const observer = new QueryObserver<SettingsMap>(
    client,
    viewSettingsQuery(
      client,
      () => new Promise<SettingsMap>((resolve) => release.push(() => resolve(server))),
    ),
  );
  const unsubscribe = observer.subscribe(() => undefined);
  return {
    client,
    data: () => client.getQueryData<SettingsMap>(VIEW_SETTINGS_KEY),
    answer: async () => {
      while (release.length) release.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    },
    close: () => {
      unsubscribe();
      client.clear();
    },
  };
}

describe('настройки вида: правка, сделанная до ответа загрузки', () => {
  it('ответ со старыми настройками не затирает правку; настройки других списков приходят с сервера', async () => {
    const h = openLoading({ 'stats.l10n': { stats: false }, contractors: { density: 'compact' } });
    try {
      applyViewEdit(h.client, 'stats.l10n', { stats: true });
      expect(h.data()).toEqual({ 'stats.l10n': { stats: true } });
      await h.answer();
      expect(h.data()).toEqual({
        'stats.l10n': { stats: true },
        contractors: { density: 'compact' },
      });
    } finally {
      h.close();
    }
  });

  it('«Сбросить вид» до ответа загрузки — сохранённый на сервере вид списка не возвращается', async () => {
    const h = openLoading({ contractors: { density: 'compact' }, tasks: { width: 'center' } });
    try {
      applyViewEdit(h.client, 'contractors', null);
      await h.answer();
      expect(h.data()).toEqual({ tasks: { width: 'center' } });
    } finally {
      h.close();
    }
  });

  it('правка после ответа загрузки меняет только свой список', async () => {
    const h = openLoading({ contractors: { density: 'compact' } });
    try {
      await h.answer();
      applyViewEdit(h.client, 'tasks', { width: 'center' });
      expect(h.data()).toEqual({ contractors: { density: 'compact' }, tasks: { width: 'center' } });
    } finally {
      h.close();
    }
  });

  it('правки одной вкладки не попадают в другой кеш', async () => {
    const a = openLoading({});
    const b = openLoading({ contractors: { density: 'compact' } });
    try {
      applyViewEdit(a.client, 'contractors', { density: 'normal' });
      await a.answer();
      await b.answer();
      expect(b.data()).toEqual({ contractors: { density: 'compact' } });
    } finally {
      a.close();
      b.close();
    }
  });
});

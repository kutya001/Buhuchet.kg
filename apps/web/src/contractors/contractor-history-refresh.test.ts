import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { contractorHistoryQuery, refreshContractorHistory } from './contractor-data';

// «Скопировать для клиента» (поток К, задача К4): вкладку «История» открыли, пока шёл запрос записи
// в историю, — её первая загрузка прочитана до записи, а `invalidateQueries` у запроса без данных новую
// загрузку не начинает (ждёт идущую): строка действия не видна до `staleTime` (сквозной тест
// report-months.spec.ts прошёл только со второй попытки; docs/typical-mistakes.md № 44).

/** Открытая «История», первая загрузка которой ещё идёт: отвечает тем, что было в базе при её начале. */
function openHistoryLoading() {
  const client = new QueryClient();
  let rows = ['было'];
  let calls = 0;
  const release: (() => void)[] = [];
  const observer = new QueryObserver<string[]>(client, {
    queryKey: contractorHistoryQuery('c1').queryKey,
    queryFn: () => {
      calls += 1;
      const seen = rows;
      return new Promise<string[]>((resolve) => release.push(() => resolve(seen)));
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  return {
    client,
    observer,
    unsubscribe,
    calls: () => calls,
    write: () => {
      rows = ['было', 'скопирован текст'];
    },
    /** Ответить на все начатые загрузки. */
    answer: async () => {
      while (release.length) release.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    },
    /** Отвечать на загрузки, пока перечитывание не закончится (новые загрузки начинаются по ходу). */
    settle: async (done: Promise<unknown>) => {
      let over = false;
      void done.finally(() => {
        over = true;
      });
      for (let i = 0; i < 20 && !over; i += 1) {
        while (release.length) release.shift()?.();
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(over).toBe(true);
    },
  };
}

describe('refreshContractorHistory — «История» после действия, которое в неё пишет', () => {
  it('первая загрузка вкладки шла во время записи — после действия загружается заново и строка видна', async () => {
    const h = openHistoryLoading();
    try {
      expect(h.calls()).toBe(1);
      h.write();
      await h.settle(refreshContractorHistory(h.client, 'c1'));
      expect(h.calls()).toBe(2);
      expect(h.observer.getCurrentResult().data).toEqual(['было', 'скопирован текст']);
    } finally {
      h.unsubscribe();
      h.client.clear();
    }
  });

  it('без отмены идущей загрузки строки нет — поэтому вызывается не просто invalidateQueries', async () => {
    const h = openHistoryLoading();
    try {
      h.write();
      await h.settle(
        h.client.invalidateQueries({ queryKey: contractorHistoryQuery('c1').queryKey }),
      );
      expect(h.calls()).toBe(1);
      expect(h.observer.getCurrentResult().data).toEqual(['было']);
    } finally {
      h.unsubscribe();
      h.client.clear();
    }
  });

  it('вкладка уже загружена — перечитывается один раз', async () => {
    const h = openHistoryLoading();
    try {
      await h.answer();
      h.write();
      await h.settle(refreshContractorHistory(h.client, 'c1'));
      expect(h.calls()).toBe(2);
      expect(h.observer.getCurrentResult().data).toEqual(['было', 'скопирован текст']);
    } finally {
      h.unsubscribe();
      h.client.clear();
    }
  });
});

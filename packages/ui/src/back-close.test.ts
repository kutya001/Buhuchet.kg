import { describe, expect, it } from 'vitest';
import { OverlayHistory, type HistoryHost } from './back-close';

/**
 * Подделка истории браузера: записи, текущий указатель, «Назад» и «Вперёд» приходят событием
 * popstate позже (как в браузере), `flush` их доставляет.
 */
function fakeHost() {
  const entries: unknown[] = [{ page: 'A' }];
  let index = 0;
  const queue: (() => void)[] = [];
  let listener: ((e: { state: unknown }) => void) | null = null;
  const go = (delta: number) =>
    queue.push(() => {
      index = Math.max(0, Math.min(entries.length - 1, index + delta));
      listener?.({ state: entries[index] });
    });
  const host: HistoryHost = {
    history: {
      get state() {
        return entries[index];
      },
      pushState(data: unknown) {
        entries.splice(index + 1);
        entries.push(data);
        index += 1;
      },
      back: () => go(-1),
    },
    addEventListener: (_type, l) => {
      listener = l;
    },
  };
  return {
    host,
    entries,
    get index() {
      return index;
    },
    forward: () => go(1),
    back: () => go(-1),
    flush() {
      while (queue.length) queue.shift()!();
    },
  };
}

describe('кнопка «Назад» закрывает открытое окно, а не уходит со страницы', () => {
  it('«Назад» закрывает панель; страница под ней остаётся той же', () => {
    const h = fakeHost();
    const overlays = new OverlayHistory(h.host);
    let closed = 0;
    const handle = overlays.open(() => {
      closed++;
    });
    expect(h.entries).toHaveLength(2);
    h.back();
    h.flush();
    expect(closed).toBe(1);
    expect(h.index).toBe(0);
    expect(overlays.size).toBe(0);
    // Окно, закрытое «Назад», второй раз историю не трогает.
    handle.release();
    h.flush();
    expect(h.index).toBe(0);
  });

  it('закрыли кнопкой, жестом или касанием вне окна — заглушка снимается, следующее «Назад» уходит со страницы', () => {
    const h = fakeHost();
    const overlays = new OverlayHistory(h.host);
    let closed = 0;
    overlays
      .open(() => {
        closed++;
      })
      .release();
    h.flush();
    expect(h.index).toBe(0);
    expect(closed).toBe(0);
  });

  it('закрыли переходом с заменой записи — заглушку заменит сам переход', () => {
    const h = fakeHost();
    const overlays = new OverlayHistory(h.host);
    overlays.open(() => {}).release({ navigating: true });
    h.flush();
    expect(h.index).toBe(1);
    expect(overlays.size).toBe(0);
  });

  it('два окна одно над другим: «Назад» закрывает верхнее, второе «Назад» — нижнее', () => {
    const h = fakeHost();
    const overlays = new OverlayHistory(h.host);
    const closed: string[] = [];
    overlays.open(() => {
      closed.push('панель');
    });
    overlays.open(() => {
      closed.push('окно');
    });
    expect(h.entries).toHaveLength(2);
    h.back();
    h.flush();
    expect(closed).toEqual(['окно']);
    expect(h.index).toBe(1);
    h.back();
    h.flush();
    expect(closed).toEqual(['окно', 'панель']);
    expect(h.index).toBe(0);
  });

  it('новое окно открылось, пока снималась прежняя заглушка, — «Назад» закроет его', () => {
    const h = fakeHost();
    const overlays = new OverlayHistory(h.host);
    overlays.open(() => {}).release();
    let closed = 0;
    overlays.open(() => {
      closed++;
    });
    h.flush();
    expect(h.index).toBe(1);
    h.back();
    h.flush();
    expect(closed).toBe(1);
    expect(h.index).toBe(0);
  });

  it('новое окно открылось и сразу закрылось, пока снималась прежняя заглушка, — со страницы не уходим', () => {
    const h = fakeHost();
    const overlays = new OverlayHistory(h.host);
    overlays.open(() => {}).release();
    // Так бывает при смене карточки формой: в режиме разработки React открывает окно дважды.
    overlays.open(() => {}).release();
    let closed = 0;
    overlays.open(() => {
      closed++;
    });
    h.flush();
    expect(h.index).toBe(1);
    expect(h.entries).toHaveLength(2);
    h.back();
    h.flush();
    expect(closed).toBe(1);
    expect(h.index).toBe(0);
  });

  it('окно закрылось, пока снималась прежняя заглушка, и больше окон нет — заглушки нет', () => {
    const h = fakeHost();
    const overlays = new OverlayHistory(h.host);
    overlays.open(() => {}).release();
    overlays.open(() => {}).release();
    h.flush();
    expect(h.index).toBe(0);
    expect(h.entries).toHaveLength(2);
    expect(overlays.size).toBe(0);
  });

  it('«Вперёд» на лишнюю заглушку, когда окон уже нет, — проходится назад', () => {
    const h = fakeHost();
    const overlays = new OverlayHistory(h.host);
    overlays.open(() => {});
    h.back();
    h.flush();
    h.forward();
    h.flush();
    expect(h.index).toBe(0);
  });

  it('форма с несохранёнными изменениями на «Назад» остаётся открытой и спрашивает; ответ закрывает вопрос, затем форму', () => {
    const h = fakeHost();
    const overlays = new OverlayHistory(h.host);
    const closed: string[] = [];
    let asked = false;
    const form = overlays.open(() => {
      // Форма не закрывается, а открывает вопрос «Закрыть без сохранения?» — окно поверх неё.
      asked = true;
      return false;
    });
    h.back();
    h.flush();
    expect(asked).toBe(true);
    expect(overlays.size).toBe(1);
    // Заглушка снова на месте: следующее «Назад» не уйдёт со страницы.
    expect(h.index).toBe(1);
    const question = overlays.open(() => {
      closed.push('вопрос');
    });
    expect(h.entries).toHaveLength(2);
    // «Назад» на вопросе — как «Отмена»: закрывается только вопрос.
    h.back();
    h.flush();
    expect(closed).toEqual(['вопрос']);
    expect(overlays.size).toBe(1);
    expect(h.index).toBe(1);
    // «Закрыть» в вопросе: закрывается и форма, заглушка снимается.
    overlays.open(() => {}).release();
    form.release();
    h.flush();
    expect(overlays.size).toBe(0);
    expect(h.index).toBe(0);
    void question;
  });
});

import type { AdminNews } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { newsMenu, type NewsMenuRun } from '../news/news-admin';
import { castPreview, castTextError, moreOf, moreValue } from './tgadm-cast';
import { requestCastFromNews, takeCastRequest } from './cast-store';

// Тексты — ключами словаря: проверяется, какой ключ и с чем выбран.
const t = (key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;

describe('«Рассылка» (поток Т, задача Т6; прототип v103 admin/tg-cast.js)', () => {
  it('текст: пусто — «Введите текст», длиннее 900 — отказ до запроса', () => {
    expect(castTextError(t, '   ')).toBe('tgadm.cast.err.text_required');
    expect(castTextError(t, 'т'.repeat(900))).toBeUndefined();
    expect(castTextError(t, 'т'.repeat(901))).toBe('tgadm.cast.err.text_too_long');
  });

  it('кнопка «Подробнее»: новость или статья; свой вид или адрес не разбирается', () => {
    expect(moreOf(moreValue({ kind: 'news', id: 'n1' }))).toEqual({ kind: 'news', id: 'n1' });
    expect(moreOf('article:a:5')).toEqual({ kind: 'article', id: 'a:5' });
    expect(moreOf('')).toBeNull();
    expect(moreOf('url:https://evil.example')).toBeNull();
    expect(moreOf('news:')).toBeNull();
    expect(moreValue(null)).toBe('');
  });

  it('предпросмотр: заголовок, текст и ряд кнопок; без заголовка и кнопок — только текст', () => {
    expect(
      castPreview({
        title: ' Работы ',
        text: ' Текст ',
        more: { text: 'Подробнее', url: 'https://s/app/kb/news?news=n1' },
        video: { text: 'Смотреть видео', url: 'https://s/app/kb/video?video=v1' },
      }),
    ).toEqual({
      heading: 'Работы',
      text: 'Текст',
      buttons: [
        [
          { text: 'Подробнее', url: 'https://s/app/kb/news?news=n1' },
          { text: 'Смотреть видео', url: 'https://s/app/kb/video?video=v1' },
        ],
      ],
    });
    expect(castPreview({ title: '', text: 'Т', more: null, video: null })).toEqual({ text: 'Т' });
  });

  it('«Отправить в Telegram» из меню новости: просьба забирается один раз', () => {
    requestCastFromNews('n1');
    expect(takeCastRequest()).toBe('n1');
    expect(takeCastRequest()).toBeNull();
  });

  it('пункт меню новости — только у вышедшей новости «для всех», иначе недоступен с причиной', () => {
    const casted: string[] = [];
    const noop = () => {};
    const run: NewsMenuRun = {
      edit: noop,
      preview: noop,
      publish: noop,
      restore: noop,
      takeOff: noop,
      remove: noop,
      cast: (n) => casted.push(n.id),
    };
    const entry = (n: Partial<AdminNews>) =>
      newsMenu(
        t,
        run,
      )({
        id: 'n1',
        status: 'published',
        off: false,
        audience: 'all',
        state: 'live',
        ...n,
      } as AdminNews).find((x) => 'id' in x && x.id === 'cast') as {
        disabled: boolean;
        reason?: string;
        run: () => void;
      };
    expect(entry({})).toMatchObject({ disabled: false, reason: undefined });
    entry({}).run();
    expect(casted).toEqual(['n1']);
    expect(entry({ audience: 'adm' })).toMatchObject({
      disabled: true,
      reason: 'tgadm.newsmenu.adm',
    });
    expect(entry({ state: 'scheduled' })).toMatchObject({ reason: 'tgadm.newsmenu.later' });
    expect(entry({ state: 'draft', status: 'draft' })).toMatchObject({
      reason: 'tgadm.newsmenu.draft',
    });
    expect(entry({ state: 'off', off: true })).toMatchObject({ reason: 'tgadm.newsmenu.draft' });
    // Без обработчика (другие экраны) пункта нет.
    const { cast: _cast, ...rest } = run;
    void _cast;
    expect(
      newsMenu(
        t,
        rest,
      )({ id: 'n2', state: 'live', audience: 'all' } as AdminNews).some(
        (x) => 'id' in x && x.id === 'cast',
      ),
    ).toBe(false);
  });
});

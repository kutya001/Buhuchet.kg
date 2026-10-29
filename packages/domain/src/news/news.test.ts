import { describe, expect, it } from 'vitest';
import {
  compareNews,
  NEWS_MESSAGES,
  NEWS_TEMPLATE,
  newsGroups,
  newsHistoryKinds,
  newsImageProblem,
  newsImageType,
  newsLive,
  newsLoginDefault,
  newsMatches,
  newsProblems,
  newsReleasedAt,
  newsShortText,
  newsShowMoment,
  newsState,
  newsVersions,
  type NewsDraft,
} from './news';

const at = (iso: string) => new Date(iso);

describe('когда новость видна', () => {
  it('в день публикации — с 09:00 по Бишкеку (03:00 UTC)', () => {
    expect(newsShowMoment('2026-10-20').toISOString()).toBe('2026-10-20T03:00:00.000Z');
    const n = { status: 'published' as const, off: false, date: '2026-10-20' };
    expect(newsLive(n, at('2026-10-20T02:59:59Z'))).toBe(false);
    expect(newsLive(n, at('2026-10-20T03:00:00Z'))).toBe(true);
    expect(newsLive(n, at('2026-10-19T23:00:00Z'))).toBe(false);
  });

  it('черновик и снятая с публикации не видны; состояние для Админки', () => {
    const now = at('2026-10-27T06:00:00Z');
    const base = { date: '2026-10-27', off: false };
    expect(newsLive({ ...base, status: 'draft' }, now)).toBe(false);
    expect(newsLive({ ...base, status: 'published', off: true }, now)).toBe(false);
    expect(newsState({ ...base, status: 'draft' }, now)).toBe('draft');
    expect(newsState({ ...base, status: 'published', off: true }, now)).toBe('off');
    expect(newsState({ ...base, status: 'published' }, now)).toBe('live');
    expect(newsState({ ...base, status: 'published', date: '2026-10-28' }, now)).toBe('scheduled');
  });

  it('«вышла» — в момент публикации, но не раньше даты в 09:00', () => {
    expect(newsReleasedAt('2026-10-20', null).toISOString()).toBe('2026-10-20T03:00:00.000Z');
    expect(newsReleasedAt('2026-10-20', at('2026-10-18T10:00:00Z')).toISOString()).toBe(
      '2026-10-20T03:00:00.000Z',
    );
    expect(newsReleasedAt('2026-10-01', at('2026-10-27T10:00:00Z')).toISOString()).toBe(
      '2026-10-27T10:00:00.000Z',
    );
  });

  it('неверная дата — ошибка', () => {
    expect(() => newsShowMoment('2026-02-30')).toThrow(RangeError);
  });
});

describe('лента', () => {
  const n = (
    id: string,
    date: string,
    version: string | null,
    publishedAt: string | null = null,
    pinned = false,
  ) => ({ id, date, version, pinned, publishedAt: publishedAt ? at(publishedAt) : null });

  it('от новых к старым: дата, в один день — время публикации, затем версия', () => {
    const items = [
      n('a', '2026-10-01', '1.2'),
      n('b', '2026-10-05', '1.3', '2026-10-05T04:00:00Z'),
      n('c', '2026-10-05', '1.10', '2026-10-05T08:00:00Z'),
      n('d', '2026-10-01', '1.10'),
    ];
    // В один день без времени публикации — по номеру версии числом, как в прототипе (+ver): 1.2 > 1.10.
    expect(items.sort(compareNews).map((x) => x.id)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('группы по версиям в порядке ленты, закреплённые отдельно; дата группы — самая поздняя', () => {
    const items = [
      n('p', '2026-10-27', '2.0', null, true),
      n('x', '2026-10-25', '1.4'),
      n('y', '2026-10-20', null),
      n('z', '2026-10-18', '1.4'),
    ];
    const { pinned, groups } = newsGroups(items);
    expect(pinned.map((x) => x.id)).toEqual(['p']);
    expect(groups.map((g) => [g.version, g.date, g.items.map((x) => x.id)])).toEqual([
      ['1.4', '2026-10-25', ['x', 'z']],
      [null, '2026-10-20', ['y']],
    ]);
  });

  it('версии для фильтра — от новых к старым как числа', () => {
    expect(
      newsVersions([
        { version: '1.9' },
        { version: null },
        { version: '1.10' },
        { version: '1.9' },
      ]),
    ).toEqual(['1.10', '1.9']);
  });

  it('поиск по заголовку, краткому и подробному описанию без учёта регистра', () => {
    const item = {
      title: 'Версия 1.4',
      short: 'Коротко',
      md: '## Что нового\n- **Календарь** сроков',
    };
    expect(newsMatches(item, 'календарь')).toBe(true);
    expect(newsMatches(item, 'ВЕРСИЯ')).toBe(true);
    expect(newsMatches(item, 'нет такого')).toBe(false);
    expect(newsMatches(item, '  ')).toBe(true);
    expect(newsShortText({ short: '', md: '## Что нового\n- Пункт' })).toBe('Что нового - Пункт');
    expect(newsShortText({ short: 'Своё', md: 'текст' })).toBe('Своё');
  });
});

describe('правка в Админке', () => {
  const draft: NewsDraft = {
    title: 'Версия 1.4',
    type: 'update',
    version: '1.4',
    date: '2026-10-20',
    short: 'Коротко',
    md: NEWS_TEMPLATE.replace('## Что нового\n- ', '## Что нового\n- Пункт'),
  };

  it('«Показывать при входе» по умолчанию — у обновлений, нововведений и закреплённых', () => {
    expect(newsLoginDefault('update', false)).toBe(true);
    expect(newsLoginDefault('feature', false)).toBe(true);
    expect(newsLoginDefault('fix', false)).toBe(false);
    expect(newsLoginDefault('announce', true)).toBe(true);
  });

  it('заполненная новость проходит; пустые поля — ошибки под полями', () => {
    expect(newsProblems(draft, { publish: true })).toEqual({});
    expect(
      newsProblems(
        { ...draft, title: ' ', date: '', short: '', md: NEWS_TEMPLATE },
        { publish: false },
      ),
    ).toEqual({
      title: 'news_title_required',
      date: 'news_date_required',
      short: 'news_short_required',
      md: 'news_md_required',
    });
    expect(NEWS_MESSAGES.news_version_required).toBe(
      'Укажите версию: без неё можно только объявление',
    );
  });

  it('версия нужна при публикации, кроме объявлений; черновик сохраняется без неё', () => {
    expect(newsProblems({ ...draft, version: '' }, { publish: true })).toEqual({
      version: 'news_version_required',
    });
    expect(newsProblems({ ...draft, version: '' }, { publish: false })).toEqual({});
    expect(newsProblems({ ...draft, version: '', type: 'announce' }, { publish: true })).toEqual(
      {},
    );
  });

  it('длины: заголовок 200, краткое описание 200, версия 20', () => {
    expect(
      newsProblems(
        { ...draft, title: 'з'.repeat(201), short: 'к'.repeat(201), version: '1'.repeat(21) },
        { publish: true },
      ),
    ).toEqual({
      title: 'news_title_too_long',
      short: 'news_short_too_long',
      version: 'news_version_too_long',
    });
    expect(newsProblems({ ...draft, md: `${'м'.repeat(50_001)}` }, { publish: true })).toEqual({
      md: 'news_md_too_long',
    });
  });
});

describe('картинка в новости', () => {
  const head = (...b: number[]) => new Uint8Array([...b, ...new Array<number>(16).fill(0)]);
  it('тип — по первым байтам: PNG, JPG, GIF, WebP; SVG и прочее — нет', () => {
    expect(newsImageType(head(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(newsImageType(head(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(newsImageType(head(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif');
    expect(newsImageType(head(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe(
      'image/webp',
    );
    expect(newsImageType(head(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20))).toBe(
      null,
    );
    expect(newsImageType(new TextEncoder().encode('<svg onload="alert(1)"></svg>'))).toBe(null);
  });

  it('больше 2 МБ — «Картинка больше 2 МБ», не картинка — тип', () => {
    const png = head(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(newsImageProblem(png)).toBe(null);
    const big = new Uint8Array(2 * 1048576 + 1);
    big.set(png);
    expect(newsImageProblem(big)).toBe('news_image_too_large');
    expect(newsImageProblem(new Uint8Array(32))).toBe('news_image_type');
  });

  it('история в Админке: строки — как в прототипе newsLog и pdLog, новые сверху', () => {
    const k = newsHistoryKinds;
    expect(k('create', [{ field: 'status', to: 'draft' }], null)).toEqual(['draft']);
    // Сразу «Опубликовать» в окне новой новости: в прототипе две записи — «Черновик» и «Опубликовано».
    expect(k('create', [{ field: 'status', to: 'published' }], null)).toEqual([
      'published',
      'draft',
    ]);
    expect(
      k(
        'update',
        [
          { field: 'title', to: 'Новый' },
          { field: 'status', to: 'published' },
        ],
        'draft',
      ),
    ).toEqual(['published']);
    expect(k('update', [{ field: 'off', to: true }], 'published')).toEqual(['off']);
    expect(k('update', [{ field: 'off', to: false }], 'published')).toEqual(['back']);
    expect(k('update', [{ field: 'title', to: 'Новый' }], 'published')).toEqual(['edited']);
    expect(k('update', [{ field: 'title', to: 'Новый' }], 'draft')).toEqual(['draft_saved']);
    expect(k('update', [], null)).toEqual(['draft_saved']);
    expect(k('delete', [{ field: 'title', from: 'Черновик' }], 'draft')).toEqual(['deleted']);
  });
});

import { createDb, schema, type Db } from '@buhuchet/db';
import { createTestDatabase, databaseAvailable, type TestDatabase } from '@buhuchet/db/testing';
import { UI_TEXTS } from '@buhuchet/domain';
import { ApiError, UiDictionary } from '@buhuchet/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import { createTestDeps } from '../../testing';
import { serverTexts } from './texts';

const { uiTexts } = schema;

async function dictionary(res: Response) {
  expect(res.status, await res.clone().text()).toBe(200);
  return UiDictionary.parse(await res.json());
}

/** База, которая падает на запросе: цепочка drizzle строится, а ожидание ответа — ошибка. */
function failingDb(): Db {
  const chain: object = new Proxy(() => chain, {
    get: (_target, prop) =>
      prop === 'then'
        ? (_resolve: unknown, reject: (err: Error) => void) => reject(new Error('база недоступна'))
        : chain,
    apply: () => chain,
  });
  return chain as Db;
}

/** База без строк, которая считает запросы; ответ приходит не сразу — запросы успевают совпасть. */
function countingDb(): { db: Db; queries: () => number } {
  let count = 0;
  const chain: object = new Proxy(() => chain, {
    get: (_target, prop) =>
      prop === 'then'
        ? (resolve: (rows: unknown[]) => void) => {
            count += 1;
            setTimeout(() => resolve([]), 5);
          }
        : chain,
    apply: () => chain,
  });
  return { db: chain as Db, queries: () => count };
}

describe('словарь текстов: сверка с базой', () => {
  it('одновременные запросы ждут одну общую сверку, а не каждый свою', async () => {
    const { db, queries } = countingDb();
    const deps = createTestDeps({ db });
    const texts = await Promise.all([serverTexts(deps), serverTexts(deps), serverTexts(deps)]);
    // Отметка текстов, отметка цветов, тексты и цвета — один раз на троих.
    expect(queries()).toBe(4);
    for (const t of texts) expect(t('health.title')).toBe(UI_TEXTS['health.title'].ru);
    // Следующая сверка — только отметки: словарь не изменился.
    await serverTexts(deps);
    expect(queries()).toBe(6);
  });

  it('сверка идёт по своему соединению словаря, пул методов не занят', async () => {
    const pool = countingDb();
    const own = countingDb();
    const text = await serverTexts(createTestDeps({ db: pool.db, textsDb: own.db }));
    expect(text('health.title')).toBe(UI_TEXTS['health.title'].ru);
    expect(pool.queries()).toBe(0);
    expect(own.queries()).toBe(4);
  });

  it('сверка упала — ошибку получают все, кто её ждал, а следующая идёт заново', async () => {
    const { db, queries } = countingDb();
    let broken = true;
    const flaky = new Proxy(db, {
      get: (target, prop, receiver) => {
        if (broken) throw new Error('база недоступна');
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const deps = createTestDeps({ db: flaky });
    const failed = await Promise.allSettled([serverTexts(deps), serverTexts(deps)]);
    expect(failed.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    broken = false;
    expect((await serverTexts(deps))('health.title')).toBe(UI_TEXTS['health.title'].ru);
    expect(queries()).toBe(4);
  });
});

describe('словарь текстов: база не отвечает на сверку', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ошибка сверки — отдаётся словарь из памяти, новая попытка — после паузы', async () => {
    vi.useFakeTimers();
    const { db, queries } = countingDb();
    let broken = false;
    const flaky = new Proxy(db, {
      get: (target, prop, receiver) => {
        if (broken) throw new Error('база недоступна');
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const deps = createTestDeps({ db: flaky });
    const first = serverTexts(deps);
    await vi.advanceTimersByTimeAsync(50);
    expect((await first)('health.title')).toBe(UI_TEXTS['health.title'].ru);
    expect(queries()).toBe(4);

    broken = true;
    expect((await serverTexts(deps))('health.title')).toBe(UI_TEXTS['health.title'].ru);
    // Пока пауза — к базе не ходит совсем, даже когда она уже ожила.
    broken = false;
    await serverTexts(deps);
    expect(queries()).toBe(4);
    await vi.advanceTimersByTimeAsync(15_000);
    const again = serverTexts(deps);
    await vi.advanceTimersByTimeAsync(50);
    await again;
    expect(queries()).toBe(6);
  });

  it('база молчит дольше предела — словарь из памяти, запросы не ждут её', async () => {
    vi.useFakeTimers();
    const { db } = countingDb();
    let hung = false;
    const never: object = new Proxy(() => never, {
      get: (_target, prop) => (prop === 'then' ? () => {} : never),
      apply: () => never,
    });
    const slow = new Proxy(db, {
      get: (target, prop, receiver) =>
        hung ? (never as Db)[prop as keyof Db] : (Reflect.get(target, prop, receiver) as unknown),
    });
    const deps = createTestDeps({ db: slow });
    const first = serverTexts(deps);
    await vi.advanceTimersByTimeAsync(50);
    await first;

    hung = true;
    let answered = false;
    const waiting = Promise.all([serverTexts(deps), serverTexts(deps)]).then((texts) => {
      answered = true;
      return texts;
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    const texts = await waiting;
    expect(texts.map((t) => t('health.title'))).toEqual([
      UI_TEXTS['health.title'].ru,
      UI_TEXTS['health.title'].ru,
    ]);
  });
});

describe('словарь текстов: без базы', () => {
  const app = createApp(createTestDeps({ db: failingDb() }));

  it('база недоступна — тексты по умолчанию, ответ не кэшируется', async () => {
    const res = await app.request('/api/l10n');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('etag')).toBeNull();
    const body = await dictionary(res);
    expect(body).toMatchObject({ lang: 'ru', version: 'default' });
    expect(body.texts['health.title']).toBe(UI_TEXTS['health.title'].ru);
  });

  it('язык, которого нет, — 400', async () => {
    const res = await app.request('/api/l10n?lang=en');
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error.code).toBe('validation_failed');
  });
});

describe.skipIf(!databaseAvailable())('словарь текстов интерфейса', () => {
  let t: TestDatabase;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    t = await createTestDatabase();
    await t.admin.db.insert(uiTexts).values([
      { key: 'nav.home', text: 'Главная', section: 'Меню' },
      { key: 'health.title', text: 'Проверка системы', section: 'Система' },
    ]);
    app = createApp(createTestDeps({ db: t.app.db }));
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('тексты на сервере: ключ словаря — текст, остальное — как есть, и `constructor` тоже', async () => {
    const text = await serverTexts(createTestDeps({ db: t.app.db }));
    expect(text('health.title')).toBe('Проверка системы');
    expect(text('Выручка')).toBe('Выручка');
    expect(text('constructor')).toBe('constructor');
    expect(text('toString')).toBe('toString');
  });

  it('открыт без входа: тексты базы поверх текстов по умолчанию, версия в ETag', async () => {
    const res = await app.request('/api/l10n');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = await dictionary(res);
    expect(res.headers.get('etag')).toBe(`"${body.version}"`);
    expect(body.lang).toBe('ru');
    expect(body.texts['nav.home']).toBe('Главная');
    // Из базы, а не из UI_TEXTS.
    expect(body.texts['health.title']).toBe('Проверка системы');
    // Ключа ещё нет в базе (наполнение не запускали) — текст по умолчанию.
    expect(body.texts['health.state']).toBe(UI_TEXTS['health.state'].ru);
    expect(await dictionary(await app.request('/api/l10n?lang=ru'))).toEqual(body);
  });

  it('та же версия в If-None-Match — 304 без тела', async () => {
    const etag = (await app.request('/api/l10n')).headers.get('etag')!;
    for (const header of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
      const res = await app.request('/api/l10n', { headers: { 'if-none-match': header } });
      expect(res.status, header).toBe(304);
      expect(await res.text()).toBe('');
    }
    const other = await app.request('/api/l10n', { headers: { 'if-none-match': '"other"' } });
    expect(other.status).toBe(200);
  });

  it('текст, изменённый в таблице словаря, виден со следующего запроса — с новой версией', async () => {
    const before = await dictionary(await app.request('/api/l10n'));
    await t.admin.db
      .update(uiTexts)
      .set({ text: 'Проверка работы' })
      .where(eq(uiTexts.key, 'health.title'));
    const after = await dictionary(await app.request('/api/l10n'));
    expect(after.texts['health.title']).toBe('Проверка работы');
    expect(after.version).not.toBe(before.version);
    const stale = await app.request('/api/l10n', {
      headers: { 'if-none-match': `"${before.version}"` },
    });
    expect(stale.status).toBe(200);

    // Новый ключ и удалённый текст — тоже новая версия; без текста в базе — снова текст по умолчанию.
    await t.admin.db.insert(uiTexts).values({ key: 'x.new', text: 'Новый', section: 'Тест' });
    const added = await dictionary(await app.request('/api/l10n'));
    expect(added.texts['x.new']).toBe('Новый');
    await t.admin.db.delete(uiTexts).where(eq(uiTexts.key, 'health.title'));
    const removed = await dictionary(await app.request('/api/l10n'));
    expect(removed.version).not.toBe(added.version);
    expect(removed.texts['health.title']).toBe(UI_TEXTS['health.title'].ru);
  });

  it('тексты внутри транзакций, занявших весь пул: словарь идёт по своему соединению и не зависает', async () => {
    const pool = createDb(t.appUrl, { max: 2, applicationName: 'buhuchet-test-pool' });
    const own = createDb(t.appUrl, { max: 1, applicationName: 'buhuchet-test-l10n' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deps = createTestDeps({ db: pool.db, textsDb: own.db });
      // Обе транзакции открыты и держат оба соединения пула — и только тогда им нужны тексты. По
      // соединению пула сверка словаря не дождалась бы свободного никогда.
      let opened = 0;
      let release!: () => void;
      const bothOpen = new Promise<void>((resolve) => (release = resolve));
      const inTransaction = () =>
        pool.db.transaction(async (tx) => {
          await tx.execute(sql`select 1`);
          opened += 1;
          if (opened === 2) release();
          await bothOpen;
          return (await serverTexts(deps))('health.title');
        });
      const stuck = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('словарь ждёт соединение пула')), 10_000);
      });
      const texts = await Promise.race([Promise.all([inTransaction(), inTransaction()]), stuck]);
      expect(texts).toHaveLength(2);
      expect(texts[0]).toBe(texts[1]);
    } finally {
      clearTimeout(timer);
      await Promise.all([pool.close(), own.close()]);
    }
  }, 30_000);

  it('с базой словарь сверяется не чаще заданного: в промежутке отдаётся из памяти', async () => {
    const slow = createApp(createTestDeps({ db: t.app.db, l10nRecheckMs: 60_000 }));
    const before = await dictionary(await slow.request('/api/l10n'));
    await t.admin.db.update(uiTexts).set({ text: 'Главная 2' }).where(eq(uiTexts.key, 'nav.home'));
    expect(await dictionary(await slow.request('/api/l10n'))).toEqual(before);
    expect((await dictionary(await app.request('/api/l10n'))).texts['nav.home']).toBe('Главная 2');
  });
});

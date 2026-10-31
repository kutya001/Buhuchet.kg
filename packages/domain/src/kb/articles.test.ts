import { describe, expect, it } from 'vitest';
import type { Feature, PermissionId } from '../roles/permissions';
import {
  kbArticleBlocks,
  kbArticleMatches,
  kbArticleSnippet,
  kbArticleText,
  kbArticleVisible,
  kbScreenBlocks,
  kbStepArticle,
} from './articles';
import type { KbArticleDef } from './catalog';
import type { KbAccess, KbProgramStep } from './program';

describe('статья по блокам', () => {
  it('заголовки, абзацы с жирным, цитата и описание экрана', () => {
    expect(
      kbArticleBlocks(
        '<p>Здесь <b>всё обучение</b> работе.</p><h4>Уроки</h4><h5>Вкладки</h5><blockquote>Совет</blockquote><kb-screen data-mod="staff"></kb-screen>',
      ),
    ).toEqual([
      {
        type: 'p',
        inline: [{ text: 'Здесь ' }, { text: 'всё обучение', bold: true }, { text: ' работе.' }],
      },
      { type: 'h4', inline: [{ text: 'Уроки' }] },
      { type: 'h5', inline: [{ text: 'Вкладки' }] },
      { type: 'quote', inline: [{ text: 'Совет' }] },
      { type: 'screen', module: 'staff' },
    ]);
  });

  it('списки со вложенным списком рядом с пунктом (как в refDB)', () => {
    expect(
      kbArticleBlocks('<ol><li><b>Шаг</b> один</li><ul><li>а</li><li>б</li></ul><li>два</li></ol>'),
    ).toEqual([
      {
        type: 'list',
        items: [
          { depth: 0, ordered: true, inline: [{ text: 'Шаг', bold: true }, { text: ' один' }] },
          { depth: 1, ordered: false, inline: [{ text: 'а' }] },
          { depth: 1, ordered: false, inline: [{ text: 'б' }] },
          { depth: 0, ordered: true, inline: [{ text: 'два' }] },
        ],
      },
    ]);
    // Лишний закрывающий тег списка не ломает разбор.
    expect(kbArticleBlocks('<ul><li>а</li></ul></ul><p>б</p>')).toEqual([
      { type: 'list', items: [{ depth: 0, ordered: false, inline: [{ text: 'а' }] }] },
      { type: 'p', inline: [{ text: 'б' }] },
    ]);
  });

  it('прочие теги и сценарии — только текст, без разметки; знаки «&lt;» раскодированы', () => {
    const blocks = kbArticleBlocks(
      '<p onclick="x()">Нажмите <a href="javascript:alert(1)">ссылку</a> &lt;Enter&gt;</p><script>alert(1)</script><img src=x onerror=alert(1)>',
    );
    expect(blocks).toEqual([
      { type: 'p', inline: [{ text: 'Нажмите ссылку <Enter>' }] },
      { type: 'p', inline: [{ text: 'alert(1)' }] },
    ]);
    expect(JSON.stringify(blocks)).not.toMatch(/onclick|href|onerror|script/);
  });

  it('картинка из хранилища — отдельным блоком, другие адреса пропускаются (задача 2.39)', () => {
    const id = '0b6f1c2e-3a4d-4e5f-8a9b-0c1d2e3f4a5b';
    const blocks = kbArticleBlocks(
      `<p>До <img src="/api/news/images/${id}" alt="Окно &quot;Шаг&quot;"> после</p>` +
        '<p><img src="https://evil.example/x.png" alt="x"><img src="javascript:alert(1)"></p>' +
        `<ul><li>Пункт <img src="/api/news/images/${id}" alt="в списке"></li></ul>`,
    );
    expect(blocks).toEqual([
      { type: 'p', inline: [{ text: 'До' }] },
      { type: 'image', src: `/api/news/images/${id}`, alt: 'Окно "Шаг"' },
      { type: 'p', inline: [{ text: 'после' }] },
      { type: 'list', items: [{ depth: 0, ordered: false, inline: [{ text: 'Пункт' }] }] },
    ]);
  });

  it('текст статьи для поиска — без тегов, пробелы схлопнуты', () => {
    expect(kbArticleText('<h4>Роли</h4><ul><li>«Владелец» — <b>все</b>  права</li></ul>')).toBe(
      'Роли «Владелец» — все права',
    );
  });
});

describe('поиск по статьям', () => {
  const art = { title: 'Роли и права', text: 'Право «Видеть уровни сотрудников» даётся роли.' };

  it('по названию и тексту, без учёта регистра и «ё»', () => {
    expect(kbArticleMatches(art, 'УРОВНИ')).toBe(true);
    expect(kbArticleMatches(art, 'роли и')).toBe(true);
    expect(kbArticleMatches({ title: 'Учёт', text: '' }, 'учет')).toBe(true);
    expect(kbArticleMatches(art, 'контрагент')).toBe(false);
    expect(kbArticleMatches(art, '  ')).toBe(true);
  });

  it('отрывок: без поиска — 150 знаков, с поиском — найденное и вокруг него', () => {
    const long = 'а'.repeat(200);
    expect(kbArticleSnippet(long, '')).toEqual({
      before: `${'а'.repeat(150)}…`,
      mark: '',
      after: '',
    });
    const text = `${'x'.repeat(100)}Права роли${'y'.repeat(100)}`;
    const s = kbArticleSnippet(text, 'права');
    expect(s.mark).toBe('Права');
    expect(s.before).toBe(`…${'x'.repeat(60)}`);
    expect(s.after).toBe(` роли${'y'.repeat(85)}…`);
    expect(kbArticleSnippet('коротко', 'нет')).toEqual({ before: 'коротко', mark: '', after: '' });
  });
});

function access(o: {
  perms?: PermissionId[];
  features?: Feature[];
  modules?: string[];
  admin?: boolean;
}): KbAccess {
  const perms = new Set(o.perms ?? []);
  const features = new Set(o.features ?? []);
  return {
    admin: o.admin ?? false,
    isOwner: false,
    can: (p) => perms.has(p),
    feature: (f) => features.has(f),
    policy: () => true,
    modules: new Set(o.modules ?? ['staff', 'dicts', 'org', 'kb', 'cps']),
  };
}

const article = (o: Partial<KbArticleDef>): KbArticleDef => ({
  id: 'a',
  sec: 'Модули',
  t: 'Статья',
  html: '',
  ...o,
});

describe('какие статьи видны', () => {
  it('по режиму: «all» — всем, «biz» — организации, «adm» — администратору', () => {
    const biz = access({});
    const adm = access({ admin: true, modules: [] });
    expect(kbArticleVisible(article({ aud: 'all' }), biz)).toBe(true);
    expect(kbArticleVisible(article({ aud: 'biz' }), biz)).toBe(true);
    expect(kbArticleVisible(article({ aud: 'biz' }), adm)).toBe(false);
    expect(kbArticleVisible(article({ aud: 'adm' }), biz)).toBe(false);
    expect(kbArticleVisible(article({ aud: 'adm' }), adm)).toBe(true);
  });

  it('статьи о модулях не из меню и о модулях, которых ещё нет, скрыты', () => {
    expect(kbArticleVisible(article({ mod: 'staff' }), access({}))).toBe(true);
    expect(kbArticleVisible(article({ mod: 'staff' }), access({ modules: ['org'] }))).toBe(false);
    // «Финансы» в меню, но экрана ещё нет; «Отчеты для сдачи» (2.13) и «Контрагенты» — с формой
    // создания (2.09) — есть.
    expect(kbArticleVisible(article({ mod: 'fin' }), access({ modules: ['fin'] }))).toBe(false);
    expect(kbArticleVisible(article({ mod: 'reports' }), access({ modules: ['reports'] }))).toBe(
      true,
    );
    expect(kbArticleVisible(article({ mod: 'cps' }), access({}))).toBe(true);
    // Админка: «Учётные записи» и «Справочники платформы» сделаны, «Telegram» — ещё нет.
    const adm = access({ admin: true, modules: ['accounts', 'orgs', 'pdicts', 'tg', 'kb'] });
    expect(kbArticleVisible(article({ aud: 'adm', mod: 'accounts' }), adm)).toBe(true);
    expect(kbArticleVisible(article({ aud: 'adm', mod: 'pdicts' }), adm)).toBe(true);
    expect(kbArticleVisible(article({ aud: 'adm', mod: 'tg' }), adm)).toBe(false);
  });

  it('по праву, функции и включённости', () => {
    expect(kbArticleVisible(article({ perm: 'fee' }), access({}))).toBe(false);
    expect(kbArticleVisible(article({ perm: 'fee' }), access({ perms: ['fee'] }))).toBe(true);
    expect(kbArticleVisible(article({ feat: 'fee' }), access({}))).toBe(false);
    expect(kbArticleVisible(article({ feat: 'fee' }), access({ features: ['fee'] }))).toBe(true);
    expect(kbArticleVisible(article({ active: false }), access({}))).toBe(false);
  });
});

describe('статья шага', () => {
  const arts = [article({ id: 'a3', mod: null }), article({ id: 'a15', mod: 'staff' })];
  const step = (art: string | undefined, module: string | null): KbProgramStep => ({
    def: { id: 's', t: 's', g: 'staff', ord: 1, ...(art ? { art } : {}) },
    rule: { module: null },
    module,
    learn: true,
    star: false,
  });

  it('своя статья шага, иначе статья его модуля', () => {
    expect(kbStepArticle(step('a3', 'staff'), arts)?.id).toBe('a3');
    expect(kbStepArticle(step(undefined, 'staff'), arts)?.id).toBe('a15');
    expect(kbStepArticle(step(undefined, null), arts)).toBeNull();
    expect(kbStepArticle(step('a99', null), arts)).toBeNull();
  });
});

describe('описание экрана модуля', () => {
  it('вкладки, элементы, плашки, кнопки и формы с обязательными полями — из kbUi', () => {
    const ui = {
      tabs: {
        'staff.list': 'Все сотрудники',
        'staff.roles': 'Роли и права',
        'org.main': 'Профиль',
      },
      screens: { staff: ['add', 'Активные', '+ Добавить'] },
      els: [{ id: 'add', t: 'Кнопка «+ Добавить»', x: 'Добавляет сотрудника' }],
      plates: { Активные: 'Сколько активных' },
      buttons: {},
      addItems: { '+ Добавить': 'Новый сотрудник' },
      artForms: [{ mod: 'staff', t: 'Форма сотрудника', fields: ['fio', 'x'] }],
      fields: { fio: { n: 'ФИО', req: 1, x: 'Полностью' } },
    };
    expect(kbScreenBlocks(ui, 'staff')).toEqual({
      tabs: { list: 'Все сотрудники', roles: 'Роли и права' },
      items: [
        { kind: 'el', name: 'Кнопка «+ Добавить»', text: 'Добавляет сотрудника' },
        { kind: 'plate', name: 'Активные', text: 'Сколько активных' },
        { kind: 'button', name: '+ Добавить', text: 'Новый сотрудник' },
      ],
      forms: [
        {
          title: 'Форма сотрудника',
          text: '',
          fields: [
            { name: 'ФИО', required: true, text: 'Полностью' },
            { name: 'x', required: false, text: '' },
          ],
        },
      ],
    });
    expect(kbScreenBlocks({}, 'org')).toEqual({ tabs: {}, items: [], forms: [] });
    // Ключ не из справочника («constructor») — пусто, а не ошибка.
    expect(kbScreenBlocks(ui, 'constructor')).toEqual({ tabs: {}, items: [], forms: [] });
  });

  it('описание экрана — только у модуля меню', () => {
    expect(
      kbArticleBlocks('<kb-screen data-mod="constructor"></kb-screen><kb-screen data-mod="cps">'),
    ).toEqual([{ type: 'screen', module: 'cps' }]);
  });
});

describe('текст из Админки', () => {
  it('теги без «>» разбираются быстро: время не растёт с квадратом длины', () => {
    const odd = '<a'.repeat(50_000);
    const started = performance.now();
    kbArticleBlocks(odd);
    kbArticleText(odd);
    kbArticleBlocks('<'.repeat(100_000));
    // С запасом под покрытие и параллельные тесты на CI (там бывает 0,5–0,6 с): разбор с квадратом
    // длины на 100 000 символов занимает десятки секунд и всё равно не уложится.
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

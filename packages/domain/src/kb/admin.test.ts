import { describe, expect, it } from 'vitest';
import { formatText, UI_TEXTS, type UiTextKey } from '../l10n/texts';
import { MENU_MODULE_IDS } from '../org/modules';
import {
  KB_ADMIN_COLUMNS,
  KB_ADMIN_LISTS,
  KB_ADMIN_MESSAGES,
  KB_MODULE_TITLES,
  kbArticleProblems,
  kbHistoryLine,
  kbLevelsProblem,
  kbShowEdit,
  kbStepProblems,
  type KbArticleInput,
  type KbHistoryItemInput,
  type KbStepInput,
} from './admin';

const STEP: KbStepInput = {
  g: 'org',
  t: 'Заполнить профиль',
  w: '',
  learn: false,
  art: '',
  star: false,
  perm: '',
  featk: '',
  evk: 'org.main',
  active: true,
};
const KNOWN = { groups: new Set(['org', 'adm']), articles: new Set(['a1']), isNew: false };

const ART: KbArticleInput = {
  sec: 'Модули',
  t: 'Контрагенты',
  mod: 'cps',
  perm: '',
  aud: 'biz',
  active: true,
  html: '<p>Текст</p>',
};

const t = (key: UiTextKey) => UI_TEXTS[key].ru;
const line = (item: KbHistoryItemInput, admin = false) => {
  const l = kbHistoryLine(item, t, () => admin);
  return formatText(t(l.key), l.params);
};

describe('шаг урока (прототип kbStepDlg)', () => {
  it('верный шаг', () => {
    expect(kbStepProblems(STEP, KNOWN)).toEqual({});
    expect(
      kbStepProblems({ ...STEP, art: 'a1', perm: 'createCp', featk: 'tasks', evk: 'open' }, KNOWN),
    ).toEqual({});
  });

  it('название обязательно и не длиннее 200 знаков; «Зачем» — до 500', () => {
    expect(kbStepProblems({ ...STEP, t: '  ' }, KNOWN)).toEqual({ t: 'kb_title_required' });
    expect(kbStepProblems({ ...STEP, t: 'а'.repeat(201) }, KNOWN)).toEqual({
      t: 'kb_title_too_long',
    });
    expect(kbStepProblems({ ...STEP, w: 'а'.repeat(501) }, KNOWN)).toEqual({
      w: 'kb_why_too_long',
    });
  });

  it('значения — только из списков', () => {
    expect(
      kbStepProblems({ ...STEP, g: 'x', art: 'zz', perm: 'root', featk: 'x', evk: 'x' }, KNOWN),
    ).toEqual({
      g: 'kb_unknown',
      art: 'kb_unknown',
      perm: 'kb_unknown',
      featk: 'kb_unknown',
      evk: 'kb_unknown',
    });
  });

  it('у нового шага — место для «Перейти» из модулей меню', () => {
    const fresh = { ...KNOWN, isNew: true };
    expect(kbStepProblems(STEP, fresh)).toEqual({ mod: 'kb_unknown' });
    expect(kbStepProblems({ ...STEP, mod: 'nowhere' }, fresh)).toEqual({ mod: 'kb_unknown' });
    expect(kbStepProblems({ ...STEP, mod: 'cps' }, fresh)).toEqual({});
  });
});

describe('статья (прототип kbArtEditDlg)', () => {
  it('название и раздел обязательны', () => {
    expect(kbArticleProblems(ART)).toEqual({});
    expect(kbArticleProblems({ ...ART, t: '', sec: ' ' })).toEqual({
      t: 'kb_title_required',
      sec: 'kb_section_required',
    });
  });

  it('модуль, право и «Кому» — из списков, текст — до 100 000 знаков', () => {
    expect(
      kbArticleProblems({
        ...ART,
        mod: 'x',
        perm: 'x',
        aud: 'x' as KbArticleInput['aud'],
        html: 'а'.repeat(100_001),
      }),
    ).toEqual({
      mod: 'kb_unknown',
      perm: 'kb_unknown',
      aud: 'kb_unknown',
      html: 'kb_html_too_long',
    });
  });
});

describe('уровни (прототип renderKbAdm, levels)', () => {
  const L = [
    { n: 'Новичок', p: 0 },
    { n: 'Ученик', p: 25 },
    { n: 'Эксперт', p: 100 },
  ];

  it('названия обязательны, первый — от 0 %, пороги растут и не больше 100 %', () => {
    expect(kbLevelsProblem(L)).toBeNull();
    expect(kbLevelsProblem([L[0]!, { n: ' ', p: 25 }])).toBe('kb_level_name');
    expect(kbLevelsProblem([L[0]!, { n: 'а'.repeat(61), p: 25 }])).toBe('kb_level_name_too_long');
    expect(kbLevelsProblem([{ n: 'Новичок', p: 5 }, L[1]!])).toBe('kb_level_order');
    expect(kbLevelsProblem([L[0]!, { n: 'Ученик', p: 0 }])).toBe('kb_level_order');
    expect(kbLevelsProblem([L[0]!, { n: 'Ученик', p: 50 }, { n: 'Профи', p: 40 }])).toBe(
      'kb_level_order',
    );
    expect(kbLevelsProblem([L[0]!, { n: 'Ученик', p: 101 }])).toBe('kb_level_order');
    expect(kbLevelsProblem([L[0]!, { n: 'Ученик', p: 25.5 }])).toBe('kb_level_order');
  });
});

describe('столбцы и тексты', () => {
  it('подписи столбцов, отказов и модулей — в словаре', () => {
    for (const list of KB_ADMIN_LISTS) {
      for (const col of KB_ADMIN_COLUMNS[list])
        expect(UI_TEXTS, col.label).toHaveProperty(col.label);
    }
    for (const code of Object.keys(KB_ADMIN_MESSAGES)) {
      expect(UI_TEXTS, code).toHaveProperty(`kbadm.err.${code}`);
      expect(t(`kbadm.err.${code}` as UiTextKey)).toBe(
        KB_ADMIN_MESSAGES[code as keyof typeof KB_ADMIN_MESSAGES],
      );
    }
    for (const m of MENU_MODULE_IDS) expect(UI_TEXTS).toHaveProperty(KB_MODULE_TITLES[m]);
  });
});

describe('«История изменений» словами прототипа (pdLog)', () => {
  const step = (action: string, changes: KbHistoryItemInput['changes']): KbHistoryItemInput => ({
    section: 'kbsteps',
    code: 'u1',
    action,
    label: 'Новый шаг',
    changes,
  });

  it('шаги уроков', () => {
    expect(line(step('create', [{ field: 'g', to: 'org' }]))).toBe(
      'Шаги уроков: добавлен шаг «Новый шаг» (Организации)',
    );
    expect(line(step('create', [{ field: 'g', to: 'adm' }]), true)).toBe(
      'Шаги уроков: добавлен шаг «Новый шаг» (Администратор платформы)',
    );
    expect(line(step('update', [{ field: 'ord', from: 5, to: 4 }]))).toBe(
      'Шаги уроков: «Новый шаг» перемещён выше',
    );
    expect(line(step('update', [{ field: 'ord', from: 4, to: 5 }]))).toBe(
      'Шаги уроков: «Новый шаг» перемещён ниже',
    );
    expect(line(step('update', [{ field: 'active', from: true, to: false }]))).toBe(
      'Шаги уроков: «Новый шаг» выключен',
    );
    expect(
      line(
        step('update', [
          { field: 't', from: 'а', to: 'б' },
          { field: 'active', from: false, to: true },
          { field: 'perm', from: '', to: 'createCp' },
          { field: 'evk', from: 'open', to: 'cp.new' },
          { field: 'featk', from: '', to: 'tasks' },
        ]),
      ),
    ).toBe('Шаги уроков: «Новый шаг» изменён — название, включён, право, условие отметки, функция');
    expect(line(step('update', [{ field: 'w', from: '', to: 'Зачем' }]))).toBe(
      'Шаги уроков: «Новый шаг» изменён',
    );
  });

  it('статьи и уровни', () => {
    const art = (action: string, changes: KbHistoryItemInput['changes']): KbHistoryItemInput => ({
      section: 'kbarts',
      code: 'a1',
      action,
      label: 'Контрагенты',
      changes,
    });
    expect(line(art('create', []))).toBe('Статьи: добавлена «Контрагенты»');
    expect(line(art('update', [{ field: 'active', from: true, to: false }]))).toBe(
      'Статьи: «Контрагенты» отключена',
    );
    expect(line(art('update', [{ field: 'html', from: 'а', to: 'б' }]))).toBe(
      'Статьи: «Контрагенты» изменена',
    );
    expect(
      line({
        section: 'kblevels',
        code: 'business',
        action: 'update',
        label: '',
        changes: [{ field: '2', from: { n: 'Ученик', p: 25 }, to: { n: 'Ученик', p: 30 } }],
      }),
    ).toBe('Уровни (организации): 2: Ученик 25 % → Ученик 30 %');
  });
});

describe('сценарий показа (прототип kbShowDlg «Сохранить»)', () => {
  const stored = [
    { s: '#a', t: 'Первое', x: 'Текст', sub: [{ tab: 'Обслуживание' }] },
    { auto: 'fields', in: '#mbody' },
    { s: '#b', t: 'Третье', x: '', common: true },
  ];

  it('облачка по прежним номерам: что подсвечивает — как было, тексты — из окна', () => {
    expect(
      kbShowEdit(stored, {
        active: true,
        items: [
          { from: 2, t: ' Третье ', x: ' ', common: false },
          { from: 1, t: 'Лишнее' },
          { from: 0, t: 'Первое', x: 'Новый', common: true },
          { t: 'Своё', x: 'Текст' },
          { auto: 'screen' },
        ],
      }),
    ).toEqual({
      items: [
        { s: '#b', t: 'Третье', x: '' },
        { auto: 'fields', in: '#mbody' },
        { s: '#a', t: 'Первое', x: 'Новый', sub: [{ tab: 'Обслуживание' }], common: true },
        { t: 'Своё', x: 'Текст' },
        { auto: 'screen' },
      ],
    });
  });

  it('заголовок обязателен, длины — как в окне, номер прежнего облачка — один раз и из сценария', () => {
    const edit = (items: Parameters<typeof kbShowEdit>[1]['items']) =>
      kbShowEdit(stored, { active: true, items });
    expect(edit([{ from: 0, t: ' ' }])).toEqual({ problem: 'kb_show_title', index: 0 });
    expect(edit([{ from: 1 }, { t: 'а'.repeat(201) }])).toEqual({
      problem: 'kb_show_title_too_long',
      index: 1,
    });
    expect(edit([{ t: 'x', x: 'а'.repeat(1001) }])).toEqual({
      problem: 'kb_show_text_too_long',
      index: 0,
    });
    expect(
      edit([
        { from: 0, t: 'x' },
        { from: 0, t: 'y' },
      ]),
    ).toEqual({
      problem: 'kb_show_item',
      index: 1,
    });
    expect(edit([{ from: 3, t: 'x' }])).toEqual({ problem: 'kb_show_item', index: 0 });
    expect(edit(Array.from({ length: 61 }, () => ({ auto: 'screen' as const })))).toEqual({
      problem: 'kb_show_too_many',
      index: -1,
    });
  });
});

describe('«История изменений» показов и загрузок', () => {
  it('показы: свой сценарий, правка, «Вернуть автоматический»', () => {
    const show = (action: string, n: number): KbHistoryItemInput => ({
      section: 'kbshows',
      code: 'profile',
      action,
      label: 'Заполнить профиль',
      changes: [action === 'delete' ? { field: 'n', from: n } : { field: 'n', to: n }],
    });
    expect(line(show('create', 3))).toBe(
      'Показы: «Заполнить профиль» — создан свой сценарий (3 облачков)',
    );
    expect(line(show('update', 4))).toBe(
      'Показы: «Заполнить профиль» — сценарий изменён (4 облачков)',
    );
    expect(line(show('delete', 4))).toBe('Показы: «Заполнить профиль» — снова автоматический');
  });

  it('загрузка из Excel и откат — строкой справочника; удаление при откате', () => {
    const load = (
      section: KbHistoryItemInput['section'],
      action: string,
      changes: KbHistoryItemInput['changes'],
    ) => line({ section, code: '', action, label: '', changes });
    expect(
      load('kbsteps', 'import', [
        { field: 'added', to: 1 },
        { field: 'changed', to: 2 },
        { field: 'disabled', to: 0 },
      ]),
    ).toBe('Шаги уроков: загрузка из Excel — добавлено 1, изменено 2, отключено 0');
    expect(
      load('kbshows', 'rollback', [{ field: 'loadedAt', to: '2026-10-31T04:00:00.000Z' }]),
    ).toBe('Показы: загрузка от 31.10.2026 откачена');
    const removed = (section: KbHistoryItemInput['section']) =>
      line({
        section,
        code: 'x',
        action: 'delete',
        label: 'Своё',
        changes: [{ field: 't', from: 'Своё' }],
      });
    expect(removed('kbsteps')).toBe('Шаги уроков: шаг «Своё» удалён');
    expect(removed('kbarts')).toBe('Статьи: «Своё» удалена');
  });
});

import { describe, expect, it } from 'vitest';
import type { Feature, PermissionId } from '../roles/permissions';
import type { KbCatalog, KbLevelDef, KbStepDef } from './catalog';
import {
  kbGroupStatus,
  kbAdminAccess,
  kbHitMark,
  kbLevelsToRecord,
  kbNextStep,
  kbOnStepScreen,
  kbProgram,
  kbProgramSteps,
  kbStats,
  kbStepIsNew,
  kbStepVisible,
  type KbAccess,
  type KbMark,
} from './program';
import { KB_STEP_RULES, type KbStepRule } from './ready';

// Уровни и шаги — как в refDB.json (`kbLevels.business`, `kbSteps`, `kbGroups`), только нужные тестам.
const LEVELS: KbLevelDef[] = [
  { n: 'Новичок', p: 0 },
  { n: 'Ученик', p: 25 },
  { n: 'Уверенный пользователь', p: 50 },
  { n: 'Профи', p: 80 },
  { n: 'Эксперт', p: 100 },
];

const step = (id: string, g: string, ord: number, extra: Partial<KbStepDef> = {}): KbStepDef => ({
  id,
  t: id,
  g,
  ord,
  active: true,
  ...extra,
});

const CATALOG: KbCatalog = {
  groups: [
    { id: 'org', t: 'Моя организация' },
    { id: 'me', t: 'Мой профиль' },
    { id: 'cps', t: 'Контрагенты' },
    { id: 'kpi', t: 'Показатели контрагентов' },
    { id: 'home', t: 'Главная и аналитика' },
    { id: 'adm', t: 'Администратор платформы', adm: 1 },
  ],
  steps: [
    step('profile', 'org', 1, { star: 1, perm: 'org' }),
    step('policy', 'org', 3, { star: 1, perm: 'org' }),
    step('settings', 'org', 5, { perm: 'org' }),
    step('tg', 'me', 7, { star: 1 }),
    step('theme', 'me', 9, { learn: 1, hit: 'theme' }),
    step('cp1', 'cps', 16, { star: 1, perm: 'createCp' }),
    step('resp', 'cps', 18, { star: 1, perm: 'assign' }),
    step('flags', 'cps', 20, { learn: 1, hit: 'cp.main', featk: 'taxpay' }),
    step('kset', 'kpi', 53, { perm: 'indSetup', featk: 'indicators' }),
    step('kper', 'kpi', 57, { learn: 1, at: ['kpi.period'], featk: 'indicators' }),
    step('today', 'home', 62, { learn: 1, at: ['home.today'] }),
    step('cols', 'lists', 65, { learn: 1, hit: 'cols' }),
    step('a-org', 'adm', 76, { star: 1 }),
  ],
  levels: { business: LEVELS, admin: LEVELS },
};

// Работающие шаги для тестов: как будто модули контрагентов, показателей и Главной уже сделаны.
const RULES: Record<string, KbStepRule> = {
  profile: { module: 'org' },
  policy: { module: 'org' },
  settings: { module: 'org' },
  tg: { module: null },
  theme: { module: null },
  cp1: { module: 'cps' },
  resp: { module: 'cps' },
  flags: { module: 'cps' },
  kset: { module: 'kpi' },
  kper: { module: 'kpi' },
  today: { module: 'home' },
  'a-org': { module: null },
};

function access(o: {
  owner?: boolean;
  perms?: PermissionId[];
  features?: Feature[];
  modules?: string[];
  admin?: boolean;
}): KbAccess {
  const perms = new Set(o.perms ?? []);
  const features = new Set(o.features ?? []);
  return {
    admin: o.admin ?? false,
    isOwner: o.owner ?? false,
    can: (p) => o.owner === true || perms.has(p),
    feature: (f) => features.has(f),
    modules: new Set(o.modules ?? ['home', 'cps', 'kpi', 'org', 'kb']),
  };
}

const OWNER = access({ owner: true, features: ['indicators', 'taxpay'] });
const ACCOUNTANT = access({
  perms: ['assign'],
  features: ['taxpay'],
  modules: ['home', 'cps', 'org', 'kb'],
});

const done = (at = '2026-10-20T10:00:00Z'): KbMark => ({
  done: { how: 'action', at },
  skipped: false,
});
const marks = (ids: string[], at?: string) => new Map(ids.map((id) => [id, done(at)]));
const ids = (program: ReturnType<typeof kbProgram>) => kbProgramSteps(program).map((s) => s.def.id);

describe('программа обучения', () => {
  it('шаг без права пользователю не показывается (ТЗ: бухгалтер без права создавать контрагентов не получает шаг «Добавить первого контрагента»)', () => {
    expect(ids(kbProgram(CATALOG, ACCOUNTANT, RULES))).not.toContain('cp1');
    expect(ids(kbProgram(CATALOG, OWNER, RULES))).toContain('cp1');
  });

  it('шаг «Сделать» без права из реестра шагов (`permission`) скрыт: «Загрузить файл вручную» — только с правом «Загружать файлы»', () => {
    const upload = step('upload', 'files', 60, { featk: 'files' });
    const rules = { upload: KB_STEP_RULES.upload! };
    const viewer = access({ perms: ['filesView'], features: ['files'], modules: ['files'] });
    expect(kbStepVisible(upload, viewer, rules)).toBe(false);
    const uploader = access({
      perms: ['filesView', 'filesUpload'],
      features: ['files'],
      modules: ['files'],
    });
    expect(kbStepVisible(upload, uploader, rules)).toBe(true);
    // Функция «Файлы в карточках» выключена — модуля в меню нет, шага тоже (п. 21 приёмки).
    expect(
      kbStepVisible(upload, access({ perms: ['filesView', 'filesUpload'], modules: [] }), rules),
    ).toBe(false);
  });

  it('шаги выключенной в учётной политике функции и модуля не из меню скрыты', () => {
    const noKpi = access({ owner: true, features: ['taxpay'] });
    expect(ids(kbProgram(CATALOG, noKpi, RULES))).not.toContain('kset');
    expect(ids(kbProgram(CATALOG, OWNER, RULES))).toEqual(expect.arrayContaining(['kset', 'kper']));
    const noMenu = access({ owner: true, features: ['indicators', 'taxpay'], modules: ['org'] });
    expect(ids(kbProgram(CATALOG, noMenu, RULES))).toEqual([
      'profile',
      'policy',
      'settings',
      'tg',
      'theme',
    ]);
  });

  it('шаги модулей, которых ещё нет, и выключенные администратором шаги скрыты', () => {
    expect(
      kbStepVisible(
        CATALOG.steps.find((s) => s.id === 'cols')!,
        OWNER,
        RULES,
      ),
    ).toBe(false);
    expect(kbStepVisible({ ...CATALOG.steps[0]!, active: false }, OWNER, RULES)).toBe(false);
    // Реестр работающих шагов продукта: «Добавить первого контрагента» есть (2.09), загрузки из
    // Excel пока нет (2.16).
    expect(Object.keys(KB_STEP_RULES)).toContain('cp1');
    expect(Object.keys(KB_STEP_RULES)).not.toContain('import');
    expect(
      kbStepVisible(
        CATALOG.steps.find((s) => s.id === 'profile')!,
        OWNER,
      ),
    ).toBe(true);
  });

  it('у владельца группы в порядке первичной настройки, у сотрудника «Главная и аналитика» — первой', () => {
    expect(kbProgram(CATALOG, OWNER, RULES).map((g) => g.def.id)).toEqual([
      'org',
      'me',
      'cps',
      'kpi',
      'home',
    ]);
    expect(kbProgram(CATALOG, ACCOUNTANT, RULES).map((g) => g.def.id)).toEqual([
      'home',
      'me',
      'cps',
    ]);
  });

  it('у администратора платформы — своя программа', () => {
    const admin = access({ admin: true, modules: [] });
    expect(kbProgram(CATALOG, admin, RULES).map((g) => g.def.id)).toEqual(['adm']);
  });

  it('шаги Админки: справочники платформы, каталог, Excel, календарь, шаблоны, «Локализация», «Создать организацию»', () => {
    const steps = ['a-dicts', 'a-types', 'a-xls', 'a-cal', 'a-tpl', 'a-l10n', 'a-org'].map(
      (id, i) => step(id, 'adm', 70 + i),
    );
    const program = kbProgram({ steps, groups: CATALOG.groups }, kbAdminAccess());
    expect(program.flatMap((g) => g.steps.map((s) => [s.def.id, s.module, !!s.rule.done]))).toEqual(
      [
        ['a-dicts', 'pdicts', false],
        ['a-types', 'pdicts', false],
        ['a-xls', 'pdicts', false],
        ['a-cal', 'pdicts', false],
        ['a-tpl', 'pdicts', false],
        ['a-l10n', 'l10n', false],
        ['a-org', 'orgs', true],
      ],
    );
    // Сотруднику организации шаги Админки не видны.
    expect(kbProgram({ steps, groups: CATALOG.groups }, OWNER)).toEqual([]);
  });

  it('шаги группы — по порядку, флаги «★» и «Посмотреть»', () => {
    const me = kbProgram(CATALOG, OWNER, RULES).find((g) => g.def.id === 'me')!;
    expect(me.steps.map((s) => [s.def.id, s.star, s.learn])).toEqual([
      ['tg', true, false],
      ['theme', false, true],
    ]);
  });
});

describe('уровень и процент', () => {
  const program = kbProgram(CATALOG, OWNER, RULES); // 11 шагов

  it('процент — выполнено ÷ шагов программы, вниз до целого; уровень — по порогам 0, 25, 50, 80, 100 %', () => {
    expect(kbProgramSteps(program)).toHaveLength(11);
    const at = (n: number) => kbStats(program, marks(ids(program).slice(0, n)), LEVELS, null);
    expect([at(0).pct, at(0).level]).toEqual([0, 0]);
    expect([at(2).pct, at(2).level]).toEqual([18, 0]);
    expect([at(3).pct, at(3).level]).toEqual([27, 1]);
    expect([at(6).pct, at(6).level]).toEqual([54, 2]);
    expect([at(9).pct, at(9).level]).toEqual([81, 3]);
    expect([at(10).pct, at(10).level]).toEqual([90, 3]);
    expect([at(11).pct, at(11).level, at(11).next]).toEqual([100, 4, null]);
  });

  it('«ещё N шагов до …»: до порога следующего уровня, не меньше одного', () => {
    const s = kbStats(program, marks(ids(program).slice(0, 3)), LEVELS, null);
    // До «Уверенного пользователя» (50 % от 11 = 5,5 → 6 шагов): ещё 3.
    expect([s.next, s.need]).toEqual([2, 3]);
    expect(kbStats(program, marks(ids(program)), LEVELS, null).need).toBe(0);
  });

  it('прогресс по модулям и основные шаги', () => {
    const s = kbStats(program, marks(['profile', 'tg', 'theme']), LEVELS, null);
    expect(s.groups.slice(0, 2)).toEqual([
      { id: 'org', title: 'Моя организация', done: 1, total: 3 },
      { id: 'me', title: 'Мой профиль', done: 2, total: 2 },
    ]);
    expect(s.stars).toEqual({ done: 2, total: 5 });
  });

  it('пропущенный шаг остаётся в знаменателе невыполненным', () => {
    const m = new Map<string, KbMark>([['profile', { done: null, skipped: true }]]);
    expect(kbStats(program, m, LEVELS, null)).toMatchObject({ done: 0, total: 11, pct: 0 });
  });

  it('полученный уровень не понижается, когда программа выросла и процент упал (ТЗ п. 49)', () => {
    const before = access({ owner: true, features: ['taxpay'] });
    const small = kbProgram(CATALOG, before, RULES); // 9 шагов без показателей
    const m = marks(ids(small).slice(0, 8));
    const s1 = kbStats(small, m, LEVELS, null);
    expect([s1.pct, s1.level]).toEqual([88, 3]);
    // Включили «Показатели контрагентов»: 11 шагов, процент меньше, уровень — прежний «Профи».
    const s2 = kbStats(program, m, LEVELS, 3);
    expect([s2.pct, s2.byPct, s2.level]).toEqual([72, 2, 3]);
    // Следующий уровень — по новому проценту: до «Эксперта» нужны все 11.
    expect([s2.next, s2.need]).toEqual([4, 3]);
  });

  it('бухгалтер без права создавать контрагентов получает «Эксперт», пройдя все свои шаги (ТЗ п. 13)', () => {
    const p = kbProgram(CATALOG, ACCOUNTANT, RULES);
    const s = kbStats(p, marks(ids(p)), LEVELS, null);
    expect([s.pct, s.level, LEVELS[s.level]!.n]).toEqual([100, 4, 'Эксперт']);
  });

  it('пустая программа — «Новичок» и 0 %', () => {
    expect(kbStats([], new Map(), LEVELS, null)).toMatchObject({
      total: 0,
      pct: 0,
      level: 0,
      next: 1,
    });
  });
});

describe('запись уровней', () => {
  it('при первом подсчёте — все уровни до текущего без поздравления', () => {
    expect(kbLevelsToRecord({ byPct: 2 }, null)).toEqual({ levels: [0, 1, 2], congrats: null });
  });

  it('новый уровень выше полученного — запись и поздравление высшим', () => {
    expect(kbLevelsToRecord({ byPct: 3 }, 1)).toEqual({ levels: [2, 3], congrats: 3 });
  });

  it('уровень не выше полученного — ничего', () => {
    expect(kbLevelsToRecord({ byPct: 1 }, 2)).toEqual({ levels: [], congrats: null });
  });
});

describe('следующий шаг', () => {
  const program = kbProgram(CATALOG, OWNER, RULES);

  it('первый не выполненный и не пропущенный; после шага — по кругу', () => {
    const m = new Map<string, KbMark>([
      ['profile', done()],
      ['policy', { done: null, skipped: true }],
    ]);
    expect(kbNextStep(program, m)?.def.id).toBe('settings');
    expect(kbNextStep(program, m, 'today')?.def.id).toBe('settings');
    expect(kbNextStep(program, m, 'settings')?.def.id).toBe('tg');
  });

  it('всё пройдено — null', () => {
    expect(kbNextStep(program, marks(ids(program)))).toBeNull();
  });
});

describe('«Новое»', () => {
  const program = kbProgram(CATALOG, OWNER, RULES);
  const kper = kbProgramSteps(program).find((s) => s.def.id === 'kper')!;
  const tg = kbProgramSteps(program).find((s) => s.def.id === 'tg')!;

  it('шаги функции, включённой за последние 30 дней, — «Новое», пока не выполнены', () => {
    expect(kbStepIsNew(kper, new Map(), { indicators: '2026-10-01' }, '2026-10-27')).toBe(true);
    expect(kbStepIsNew(kper, new Map(), { indicators: '2026-09-26' }, '2026-10-27')).toBe(false);
    expect(kbStepIsNew(kper, marks(['kper']), { indicators: '2026-10-20' }, '2026-10-27')).toBe(
      false,
    );
    expect(kbStepIsNew(tg, new Map(), { indicators: '2026-10-20' }, '2026-10-27')).toBe(false);
  });

  it('шаг, добавленный администратором позже, — «Новое»', () => {
    expect(
      kbStepIsNew({ ...tg, def: { ...tg.def, isNew: true } }, new Map(), {}, '2026-10-27'),
    ).toBe(true);
  });
});

describe('урок, экран шага, первое использование', () => {
  const program = kbProgram(CATALOG, OWNER, RULES);
  const me = program.find((g) => g.def.id === 'me')!;

  it('урок «Пройден» с датой последнего шага, «Пройден частично» — с пропущенными', () => {
    const m = new Map<string, KbMark>([
      ['tg', done('2026-10-21T08:00:00Z')],
      ['theme', done('2026-10-22T09:00:00Z')],
    ]);
    expect(kbGroupStatus(me, m)).toEqual({ state: 'done', at: '2026-10-22T09:00:00Z' });
    expect(
      kbGroupStatus(
        me,
        new Map([
          ['tg', done()],
          ['theme', { done: null, skipped: true }],
        ]),
      ),
    ).toEqual({
      state: 'partial',
    });
    expect(kbGroupStatus(me, new Map([['tg', done()]]))).toBeNull();
  });

  it('экран шага «Посмотреть» — по модулю и вкладке', () => {
    const def = { ...CATALOG.steps[0]!, at: ['staff.roles', 'files'] };
    expect(kbOnStepScreen(def, 'staff', 'roles')).toBe(true);
    expect(kbOnStepScreen(def, 'staff', 'list')).toBe(false);
    expect(kbOnStepScreen(def, 'files', null)).toBe(true);
  });

  it('первое использование засчитывает «Сделать» и «Посмотреть» раздела списков, а не прочие «Посмотреть»', () => {
    const theme = me.steps.find((s) => s.def.id === 'theme')!;
    expect(kbHitMark(theme, 'theme')).toBeNull();
    const cols = {
      def: CATALOG.steps.find((s) => s.id === 'cols')!,
      rule: { module: null },
      module: null,
      learn: true,
      star: false,
    };
    expect(kbHitMark(cols, 'cols')).toBe('use');
    expect(kbHitMark(cols, 'grp')).toBeNull();
    // «Сделать» с событием в истории («Дни напоминаний») засчитывается только историей, не вызовом.
    const remind = {
      ...cols,
      learn: false,
      def: { ...cols.def, id: 'remind', g: 'org', hit: 'remind' },
    };
    expect(kbHitMark(remind, 'remind')).toBe('use');
    expect(kbHitMark({ ...remind, rule: KB_STEP_RULES.remind! }, 'remind')).toBeNull();
    // «Профиль» и «Настройки» — и сохранением без изменений, «действием».
    const profile = {
      ...remind,
      def: { ...remind.def, id: 'profile', hit: undefined },
      rule: KB_STEP_RULES.profile!,
    };
    expect(kbHitMark(profile, 'profile')).toBe('action');
    expect(kbHitMark(profile, 'settings')).toBeNull();
  });
});

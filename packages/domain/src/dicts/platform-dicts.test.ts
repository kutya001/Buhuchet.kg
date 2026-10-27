import { describe, expect, it } from 'vitest';
import { isGridKey } from '../common/list';
import { UI_TEXTS } from '../l10n/texts';
import {
  isOrgDictId,
  isOrgDictWindowId,
  ORG_DICT_COLUMNS,
  ORG_DICT_IDS,
  ORG_DICT_WINDOW_IDS,
  orgDictGroups,
  orgDictIdOfKey,
  regimeAccountantNote,
  type DictGroupDef,
  type OrgDictId,
} from './platform-dicts';

// Состав групп — как раздел `dictGroups` в refDB.json (названия и поля `key`).
const GROUPS: DictGroupDef[] = [
  {
    group: 'Налоги и отчёты',
    tabs: [
      {
        tab: 'Налоги и ставки',
        key: 'taxes, enRates, propertyRates, bizSize',
        about: 'Налоги',
        usedIn: 'Форма налога',
      },
      { tab: 'Виды отчётов', key: 'reportTypes' },
      { tab: 'Основания для отчётов', key: 'bases' },
    ],
  },
  {
    group: 'Режимы, льготы и статусы',
    tabs: [
      { tab: 'Режимы', key: 'regimes' },
      { tab: 'Льготы и статусы', key: 'benefits' },
    ],
  },
  {
    group: 'Классификаторы',
    tabs: [
      { tab: 'ГКЭД', key: 'gked' },
      { tab: 'Формы', key: 'forms' },
      { tab: 'Коды стран', key: 'phones' },
    ],
  },
  {
    group: 'Органы и банки',
    tabs: [
      { tab: 'Органы', key: 'organs' },
      { tab: 'УГНС', key: 'ugns' },
      { tab: 'Банки', key: 'banks' },
    ],
  },
  {
    group: 'Работа системы',
    tabs: [
      { tab: 'Календарь', key: 'calendar' },
      { tab: 'Статусы', key: 'statuses' },
      { tab: 'Категории задач', key: 'cats, reasons' },
      { tab: 'Шаблоны ролей', key: 'roleTemplates' },
      { tab: 'Шаблоны', key: 'waTemplates, tgTemplates' },
      { tab: 'Права ролей', key: 'permissions' },
    ],
  },
  {
    group: 'Служебное',
    tabs: [
      { tab: 'Загрузки', key: 'dictLoads' },
      { tab: 'Запросы', key: '—' },
    ],
  },
];

const counts = Object.fromEntries(ORG_DICT_IDS.map((id, i) => [id, i + 1])) as Record<
  OrgDictId,
  number
>;
const enRates = {
  tab: 'Ставки единого налога',
  about: 'Ставки ЕН',
  usedIn: 'Ставка ЕН контрагента',
};

describe('Справочники платформы для организации', () => {
  it('плитки по группам, без служебных справочников; «Ставки единого налога» — после «Налогов и ставок»', () => {
    const groups = orgDictGroups(GROUPS, counts, enRates);
    expect(groups.map((g) => g.group)).toEqual([
      'Налоги и отчёты',
      'Режимы, льготы и статусы',
      'Классификаторы',
      'Органы и банки',
      'Работа системы',
    ]);
    expect(groups.flatMap((g) => g.tabs.map((t) => t.id))).toEqual([...ORG_DICT_IDS]);
    expect(groups[0]!.tabs.slice(0, 2)).toEqual([
      { id: 'taxes', tab: 'Налоги и ставки', about: 'Налоги', usedIn: 'Форма налога', count: 1 },
      {
        id: 'en_rates',
        tab: 'Ставки единого налога',
        about: 'Ставки ЕН',
        usedIn: 'Ставка ЕН контрагента',
        count: 2,
      },
    ]);
    expect(groups[4]!.tabs.map((t) => t.tab)).toEqual([
      'Календарь',
      'Статусы',
      'Категории задач',
      'Шаблоны',
    ]);
  });

  it('справочник — по первому слову поля key; повтор справочника не дублирует плитку', () => {
    expect(orgDictIdOfKey('cats, reasons')).toBe('cats');
    expect(orgDictIdOfKey(' reportTypes ')).toBe('types');
    expect(orgDictIdOfKey('permissions')).toBeNull();
    expect(orgDictIdOfKey('')).toBeNull();
    const twice = orgDictGroups(
      [
        {
          group: 'А',
          tabs: [
            { tab: 'Банки', key: 'banks' },
            { tab: 'Банки ещё раз', key: 'banks' },
          ],
        },
      ],
      counts,
      enRates,
    );
    expect(twice[0]!.tabs.map((t) => t.tab)).toEqual(['Банки']);
    expect(isOrgDictId('gked')).toBe(true);
    expect(isOrgDictId('permissions')).toBe(false);
  });
});

describe('Окна справочников платформы', () => {
  it('у каждого справочника, кроме «Видов отчётов», — окно со своими столбцами и ключом настроек вида', () => {
    expect(ORG_DICT_WINDOW_IDS).toEqual(ORG_DICT_IDS.filter((id) => id !== 'types'));
    for (const id of ORG_DICT_WINDOW_IDS) {
      expect(ORG_DICT_COLUMNS[id].length).toBeGreaterThan(1);
      expect(isGridKey(`dicts.platform.${id}`)).toBe(true);
      // Подпись столбца — текст словаря `dicts.platform.col.<справочник>.<ключ>`.
      for (const c of ORG_DICT_COLUMNS[id]) {
        expect(Object.keys(UI_TEXTS)).toContain(`dicts.platform.col.${id}.${c.key}`);
      }
    }
    expect(isGridKey('dicts.platform')).toBe(true);
    expect(isOrgDictWindowId('types')).toBe(false);
    expect(isOrgDictWindowId('calendar')).toBe(true);
  });
});

describe('Режим: «Для бухгалтера»', () => {
  it('подпись «Для бухгалтера:» в начале пояснения не повторяется', () => {
    expect(regimeAccountantNote('Для бухгалтера: самый «тяжёлый» набор')).toBe(
      'самый «тяжёлый» набор',
    );
    expect(regimeAccountantNote('Без подписи')).toBe('Без подписи');
  });
});

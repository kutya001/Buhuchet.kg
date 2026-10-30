import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { pdictsHead } from './pdicts-head';
import {
  calendarHistoryText,
  dictHistoryItem,
  dictHistoryText,
  sectionHistoryText,
} from './dict-history';

// Админка → «Справочники платформы»: строки «Истории изменений» — как пишет прототип (pdLog), шапка
// вкладки — из раздела `dictGroups`.

const t = makeTranslate(defaultUiTexts());

const item = (patch: Partial<Parameters<typeof dictHistoryText>[1]>) => ({
  id: '1',
  at: '2026-10-27T06:30:00.000Z',
  actor: 'Администратор платформы',
  action: 'update',
  code: 'ОРГ-01',
  label: 'ГНС',
  changes: [],
  ...patch,
});

describe('«История изменений» справочника', () => {
  it('добавлено, удалено, переименовано, изменены поля', () => {
    expect(dictHistoryText('organs', item({ action: 'create' }), t)).toBe(
      'Органы: добавлено «ГНС»',
    );
    expect(dictHistoryText('forms', item({ action: 'delete', label: 'Фонд' }), t)).toBe(
      'Формы собственности: «Фонд» удалено',
    );
    const renamed = item({ changes: [{ field: 'name', from: 'ГНС', to: 'ГНС при МФ' }] });
    expect(dictHistoryText('organs', renamed, t)).toBe('Органы: «ГНС» → «ГНС при МФ»');
    const fields = item({ changes: [{ field: 'site', from: '', to: 'sti.gov.kg' }] });
    expect(dictHistoryText('organs', fields, t)).toBe('Органы: «ГНС» — изменены поля');
  });

  it('загрузка из Excel и её откат — одной строкой справочника', () => {
    const load = item({
      action: 'import',
      code: '',
      label: '',
      changes: [
        { field: 'added', to: 1 },
        { field: 'changed', to: 2 },
        { field: 'disabled', to: 0 },
      ],
    });
    expect(dictHistoryText('organs', load, t)).toBe(
      'Органы: загрузка из Excel — добавлено 1, изменено 2, отключено 0',
    );
    const rollback = item({
      action: 'rollback',
      code: '',
      label: '',
      changes: [{ field: 'loadedAt', to: '2026-10-29T20:30:00.000Z' }],
    });
    expect(dictHistoryText('types', rollback, t)).toBe(
      'Виды отчётов: загрузка от 30.10.2026 откачена',
    );
  });

  it('льгота: «изменено», после правки «Меняет сроки» — сколько отчётов пересчитано', () => {
    const benefit = (changes: Parameters<typeof item>[0]['changes']) =>
      dictHistoryText('benefits', item({ label: 'Крупный налогоплательщик', changes }), t);
    expect(benefit([{ field: 'gives', from: 'А', to: 'Б' }])).toBe(
      'Налоговые льготы и особые статусы: «Крупный налогоплательщик» изменено',
    );
    const due = { field: 'dueRules', from: [], to: [] };
    expect(benefit([due, { field: 'recalculated', to: 1 }])).toBe(
      'Налоговые льготы и особые статусы: «Крупный налогоплательщик» изменено, сроки по статусу пересчитаны у 1 отчёта',
    );
    expect(benefit([due, { field: 'recalculated', to: 0 }])).toBe(
      'Налоговые льготы и особые статусы: «Крупный налогоплательщик» изменено, сроки по статусу пересчитаны у 0 отчётов',
    );
    expect(
      benefit([
        { field: 'name', from: 'Крупный', to: 'Крупный налогоплательщик' },
        due,
        { field: 'recalculated', to: 3 },
      ]),
    ).toBe(
      'Налоговые льготы и особые статусы: «Крупный» → «Крупный налогоплательщик», сроки по статусу пересчитаны у 3 отчётов',
    );
  });

  it('вид отчёта: добавлен, удалён, каждое поле «было» → «стало», как в прототипе', () => {
    const names = new Map([
      ['ОРГ-01', 'ГНС'],
      ['ОРГ-02', 'Соцфонд'],
      ['РЕЖ-01', 'ОНР'],
    ]);
    const type = (patch: Parameters<typeof item>[0]) =>
      dictHistoryText('types', item({ code: 'nds', label: 'НДС', ...patch }), t, names);
    expect(type({ action: 'create' })).toBe('Виды отчётов: добавлен «НДС»');
    expect(type({ action: 'delete' })).toBe('Виды отчётов: удалён «НДС»');
    // Срок оплаты — одним полем, правилом целиком (сервер собирает его из полей до и после правки).
    const MONTHLY = {
      period: 'M',
      dueFrom: 'end',
      dueDay: 28,
      dueAfter: 1,
      dueMonth: null,
      oneOff: false,
      act: 'both',
    };
    expect(
      type({
        changes: [
          { field: 'dueDay', from: 25, to: 28 },
          { field: 'shortName', from: 'НДС', to: 'НДС-1' },
          { field: 'act', from: 'sub', to: 'both' },
          { field: 'authorityCode', from: 'ОРГ-01', to: 'ОРГ-02' },
          { field: 'regimes', from: [], to: ['РЕЖ-01'] },
          { field: 'shiftToWorkday', from: true, to: false },
          {
            field: 'pay',
            from: { ...MONTHLY, payDay: null, payAfter: null, payMonth: null },
            to: { ...MONTHLY, payDay: 20, payAfter: null, payMonth: null },
          },
          { field: 'paySchedule', from: null, to: [[3, 20]] },
          { field: 'payments', from: [], to: [{ name: 'НДС', authority: 'ОРГ-01', kbk: '' }] },
        ],
      }),
    ).toBe(
      'Виды отчётов: НДС — срок: число: «25» → «28»; кратко: «НДС» → «НДС-1»; что нужно сделать: «Сдача» → «Сдача + уплата»; орган: «ГНС» → «Соцфонд»; режимы: «» → «ОНР»; перенос срока: «да» → «нет»; срок оплаты: «как срок сдачи» → «до 20-го числа месяца после отчётного»; график оплаты: «один платёж» → «20.03»; что уплачивается: «» → «НДС (ГНС)»',
    );
    // Отключено и включено — общей строкой.
    expect(type({ changes: [{ field: 'active', from: true, to: false }] })).toBe(
      'Виды отчётов: «НДС» отключено (было: активно)',
    );
  });

  it('отключено и включено, перемещено по «№»', () => {
    const off = item({ changes: [{ field: 'active', from: true, to: false }] });
    expect(dictHistoryText('reasons', off, t)).toBe(
      'Причины изменения срока: «ГНС» отключено (было: активно)',
    );
    const on = item({ changes: [{ field: 'active', from: false, to: true }] });
    expect(dictHistoryText('reasons', on, t)).toContain('включено (было: отключено)');
    const moved = item({ changes: [{ field: 'n', from: 3, to: 2 }] });
    expect(dictHistoryText('organs', moved, t)).toBe('Органы: «ГНС» перемещено с № 3 на № 2');
  });

  it('режим — «изменено: N полей», основание — «изменено», код страны — было → стало', () => {
    const regime = item({
      label: 'ЕН',
      changes: [
        { field: 'fullName', from: 'Единый налог', to: 'Единый налог (ст. 418)' },
        { field: 'article', from: '418', to: '418–430' },
      ],
    });
    expect(dictHistoryText('regimes', regime, t)).toBe(
      'Режимы налогообложения: «ЕН» — изменено: 2 поля',
    );
    const base = item({ label: 'Есть НДС', changes: [{ field: 'types', from: [], to: ['nds'] }] });
    expect(dictHistoryText('bases', base, t)).toBe('Основания для отчётов: «Есть НДС» изменено');
    // Переименование видно, как требует ТЗ: «старое» → «новое».
    const regimeRenamed = item({
      label: 'ЕН (ст. 418)',
      changes: [
        { field: 'name', from: 'ЕН', to: 'ЕН (ст. 418)' },
        { field: 'article', from: '418', to: '418–430' },
      ],
    });
    expect(dictHistoryText('regimes', regimeRenamed, t)).toBe(
      'Режимы налогообложения: «ЕН» → «ЕН (ст. 418)»; изменено ещё: 1 поле',
    );
    const baseRenamed = item({
      label: 'Плательщик НДС',
      changes: [{ field: 'name', from: 'Есть НДС', to: 'Плательщик НДС' }],
    });
    expect(dictHistoryText('bases', baseRenamed, t)).toBe(
      'Основания для отчётов: «Есть НДС» → «Плательщик НДС»',
    );
    const phone = item({
      label: 'Кыргызстан',
      changes: [{ field: 'dialCode', from: '996', to: '997' }],
      summary: { from: 'Кыргызстан +996 XXX XXX XXX', to: 'Кыргызстан +997 XXX XXX XXX' },
    });
    expect(dictHistoryText('phones', phone, t)).toBe(
      'Коды стран: Кыргызстан +996 XXX XXX XXX → Кыргызстан +997 XXX XXX XXX',
    );
    const added = item({
      action: 'create',
      label: 'Монголия',
      changes: [
        { field: 'name', to: 'Монголия' },
        { field: 'dialCode', to: '976' },
      ],
    });
    expect(dictHistoryText('phones', added, t)).toBe('Коды стран: добавлено «Монголия» +976');
  });

  it('календарь: добавлен и удалён день; у рабочей субботы — «Рабочая суббота»', () => {
    const added = item({
      action: 'create',
      code: '2027-01-04',
      label: 'Перенос: Новый год',
      changes: [
        { field: 'kind', to: 'transfer' },
        { field: 'name', to: 'Перенос: Новый год' },
      ],
    });
    expect(calendarHistoryText(added, t)).toBe(
      'Календарь: добавлено «04.01.2027 Перенос: Новый год»',
    );
    const removed = item({
      action: 'delete',
      code: '2027-03-13',
      label: '',
      changes: [{ field: 'kind', from: 'workday' }],
    });
    expect(calendarHistoryText(removed, t)).toBe('Календарь: «13.03.2027 Рабочая суббота» удалено');
    expect(dictHistoryItem('calendar', added, t).text).toContain('добавлено «04.01.2027');
  });

  it('УГНС: было и стало по изменённым полям; пустой код — «—»', () => {
    const changed = item({
      label: '002 Ленинский р-н',
      changes: [
        { field: 'gnsCode', from: null, to: '002' },
        { field: 'shortName', from: 'Ленинский', to: 'Ленинский р-н' },
      ],
    });
    expect(dictHistoryText('ugns', changed, t)).toBe(
      'УГНС: «002 Ленинский р-н» изменено. Было: — · Ленинский. Стало: 002 · Ленинский р-н',
    );
  });

  it('дата и время — по Бишкеку; без автора — «Система»', () => {
    const row = dictHistoryItem('organs', item({ action: 'create', actor: null }), t);
    expect(row).toMatchObject({ date: '27.10.2026', time: '12:30', who: 'Система' });
  });
});

describe('«История изменений» вкладок «ГКЭД» и «Налоги и ставки» (задачи 2.37 и 2.38)', () => {
  it('коды ГКЭД: добавлен, удалён, «Действует», изменён', () => {
    const code = { code: '69.20.8', label: 'Проверка', section: 'gked' as const };
    expect(dictHistoryText('gked', item({ ...code, action: 'create' }), t)).toBe(
      'ГКЭД: добавлен код 69.20.8 «Проверка»',
    );
    expect(sectionHistoryText(item({ ...code, action: 'delete' }), t)).toBe(
      'ГКЭД: удалён код 69.20.8 «Проверка»',
    );
    const off = item({ ...code, changes: [{ field: 'active', from: true, to: false }] });
    expect(sectionHistoryText(off, t)).toBe('ГКЭД: 69.20.8 — «Действует»: нет');
    const note = item({ ...code, changes: [{ field: 'note', from: '', to: 'Пример' }] });
    expect(sectionHistoryText(note, t)).toBe('ГКЭД: 69.20.8 изменён');
  });

  it('группа кодов: что изменилось — коды и действия; без них — «изменена»', () => {
    const group = { code: 'banks', label: 'Банки', section: 'gkgroups' as const };
    const changed = item({
      ...group,
      changes: [
        { field: 'codes', from: ['64.11', '64.19.1'], to: ['64.11'] },
        { field: 'en', from: 'ex', to: 'warn' },
      ],
    });
    expect(sectionHistoryText(changed, t)).toBe(
      'ГКЭД: группа кодов «Банки» изменена — коды 64.11; единый налог: Предупреждение',
    );
    const why = item({ ...group, changes: [{ field: 'why', from: '', to: 'НК' }] });
    expect(sectionHistoryText(why, t)).toBe('ГКЭД: группа кодов «Банки» изменена');
    expect(sectionHistoryText(item({ ...group, action: 'delete' }), t)).toBe(
      'ГКЭД: удалена группа кодов «Банки»',
    );
  });

  it('ставка единого налога: «Виды деятельности (ГКЭД)» было → стало; налог переименован', () => {
    const rate = item({
      code: 'ЕНС-01',
      label: 'Торговля',
      section: 'enrates',
      changes: [
        { field: 'gked', from: { in: ['47'], ex: [] }, to: { in: ['47', '46'], ex: ['47.30'] } },
      ],
    });
    expect(sectionHistoryText(rate, t)).toBe(
      'Ставки единого налога: ЕНС-01 — виды деятельности (ГКЭД): «47» → «47, 46; кроме 47.30»',
    );
    const tax = item({
      code: 'НАЛ-01',
      label: 'Подоходный',
      section: 'taxes',
      changes: [{ field: 'name', from: 'Подоходный налог', to: 'Подоходный' }],
    });
    expect(dictHistoryItem('taxes', tax, t).text).toBe(
      'Налоги и обязательные платежи: «Подоходный налог» → «Подоходный»',
    );
  });

  it('«Отметить сверку с ГНС» — одной строкой; календарь: из Excel переименован праздник', () => {
    const gns = item({ code: '', label: '', changes: [{ field: 'gns', to: ['НДС', 'Акциз'] }] });
    expect(dictHistoryText('types', gns, t)).toBe('Виды отчётов: сверено с ГНС — НДС, Акциз');
    const renamed = item({
      code: '2026-01-01',
      label: 'Новый год (Excel)',
      changes: [{ field: 'name', from: 'Новый год', to: 'Новый год (Excel)' }],
    });
    expect(calendarHistoryText(renamed, t)).toBe(
      'Календарь: «01.01.2026 Новый год» → «Новый год (Excel)»',
    );
  });
});

describe('шапка вкладки', () => {
  const groups = [
    {
      group: 'Работа системы',
      tabs: [{ tab: 'Категории задач', key: 'cats, reasons', about: 'Шаблон', usedIn: 'Задачи' }],
    },
    { group: 'Служебное', tabs: [{ tab: 'Запросы', key: '—' }] },
  ];

  it('«Причины изменения срока» — в описании «Категорий задач»; нет описания — без шапки', () => {
    expect(pdictsHead(groups, 'reasons')).toEqual({
      group: 'Работа системы',
      tab: 'Категории задач',
      about: 'Шаблон',
      usedIn: 'Задачи',
    });
    expect(pdictsHead(groups, 'requests')).toMatchObject({ group: 'Служебное', tab: 'Запросы' });
    expect(pdictsHead(groups, 'organs')).toBeNull();
  });
});

import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { pdictsHead } from './pdicts-head';
import { calendarHistoryText, dictHistoryItem, dictHistoryText } from './dict-history';

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

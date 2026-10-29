import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { pdictsHead } from './pdicts-head';
import { dictHistoryItem, dictHistoryText } from './dict-history';

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

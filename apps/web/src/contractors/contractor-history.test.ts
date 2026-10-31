import { defaultUiTexts } from '@buhuchet/domain';
import type { ContractorHistory } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { contractorHistoryItem, contractorHistoryText } from './contractor-history';

// Вкладка «История» карточки контрагента (прототип contractor-card.js, `st.tab==='hist'`; ТЗ «История
// изменений»: что изменено, кто и когда).

const t = makeTranslate(defaultUiTexts());
type Entry = ContractorHistory['items'][number];

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const names = { [A]: 'Айгуль С.', [B]: 'Бакыт Т.' };

const entry = (over: Partial<Entry>): Entry => ({
  id: 1,
  at: '2026-10-18T04:30:00.000Z',
  actor: 'Эркин О.',
  entity: 'contractor',
  action: 'update',
  reason: null,
  changes: [],
  subject: null,
  ...over,
});

describe('история контрагента', () => {
  it('создание, смена ответственного и статуса, остальные поля — «Изменено: …» без повторов', () => {
    expect(contractorHistoryText(t, entry({ action: 'create' }), names)).toBe('Контрагент создан');
    const text = contractorHistoryText(
      t,
      entry({
        changes: [
          { field: 'responsibleEmployeeId', from: A, to: B },
          { field: 'serviceStatus', from: 'active', to: 'paused' },
          { field: 'name', from: 'А', to: 'Б' },
          { field: 'contractNo', from: '1', to: '2' },
          { field: 'contractDate', from: null, to: '2026-10-01' },
          { field: 'phone', from: '1', to: '2' },
        ],
      }),
      names,
    );
    expect(text).toBe(
      'Ответственный: Айгуль С. → Бакыт Т.; Статус обслуживания: Обслуживается → Приостановлен; Изменено: название, договор, телефон',
    );
  });

  it('ответственного не было — «—»; причина — в скобках, запись только с причиной — сама причина', () => {
    expect(
      contractorHistoryText(
        t,
        entry({
          changes: [{ field: 'responsibleEmployeeId', from: null, to: A }],
          reason: 'передача дел',
        }),
        names,
      ),
    ).toBe('Ответственный: — → Айгуль С. (передача дел)');
    expect(
      contractorHistoryText(t, entry({ reason: 'Отмечен статус «Крупный» по УГНС' }), names),
    ).toBe('Отмечен статус «Крупный» по УГНС');
    expect(contractorHistoryText(t, entry({}), names)).toBe('Изменено');
    // Созданный загрузкой из Excel — одной строкой-причиной (прототип importDlg).
    expect(
      contractorHistoryText(
        t,
        entry({ action: 'create', reason: 'Создан загрузкой из Excel' }),
        names,
      ),
    ).toBe('Создан загрузкой из Excel');
  });

  it('подтверждение права на режим по ГКЭД (п. 58) — с вопросом', () => {
    expect(
      contractorHistoryText(
        t,
        entry({
          changes: [
            {
              field: 'gkedConfirmation',
              from: null,
              to: { ask: 'ГКЭД 96.02.0 нет в перечне для патента', by: 'Эркин О.' },
            },
          ],
        }),
        names,
      ),
    ).toBe('Подтверждено право на режим: «ГКЭД 96.02.0 нет в перечне для патента» — нет');
  });

  it('назначение: назначен, снят, изменены поля; задача — с названием', () => {
    const asg = (over: Partial<Entry>) =>
      contractorHistoryText(t, entry({ entity: 'assignment', subject: 'НДС', ...over }), names);
    expect(asg({ action: 'create' })).toBe('Назначен отчёт: НДС');
    expect(asg({ changes: [{ field: 'endedOn', from: null, to: '2026-10-18' }] })).toBe(
      'Снят отчёт: НДС',
    );
    expect(
      asg({
        changes: [
          { field: 'fromMonth', from: '2026-09-01', to: '2026-08-01' },
          { field: 'note', from: '', to: 'x' },
        ],
      }),
    ).toBe('Назначение НДС: с какого периода, примечание');
    expect(
      contractorHistoryText(
        t,
        entry({ entity: 'task', action: 'create', subject: 'Собрать первичку' }),
        names,
      ),
    ).toBe('Поставлена задача «Собрать первичку»');
  });

  it('запись ленты: дата и время по Бишкеку, кто; без автора — «Система»', () => {
    const item = contractorHistoryItem(t, entry({ action: 'create', actor: null }), names);
    expect(item).toMatchObject({
      id: '1',
      date: '18.10.2026',
      time: '10:30',
      text: 'Контрагент создан',
      who: 'Система',
    });
  });
});

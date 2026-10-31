import { defaultUiTexts } from '@buhuchet/domain';
import type { ContractorHistory } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { contractorHistoryItem, contractorHistoryText } from './contractor-history';

// Вкладка «История» карточки контрагента (прототип contractor-card.js, `st.tab==='hist'`; ТЗ «История
// изменений»: что изменено, кто и когда).

const t = makeTranslate(defaultUiTexts());
/** Суммы на экране — с неразрывными пробелами; в ожиданиях — обычные. */
const plain = (s: string) => s.replace(/\u00a0/g, ' ');
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

  it('плата за обслуживание: ставка, «одной суммой», напоминание, оплата и её файл (задача 2.21)', () => {
    expect(
      plain(
        contractorHistoryText(
          t,
          entry({
            changes: [
              {
                field: 'tariffAdded',
                to: { amount: 1_600_000, period: 'M', validFrom: '2026-11-01', note: '' },
              },
            ],
          }),
          names,
        ),
      ),
    ).toBe('Новая ставка 16 000 сом в месяц с ноября 2026');
    expect(
      plain(
        contractorHistoryText(
          t,
          entry({ changes: [{ field: 'oneSum', from: false, to: true }] }),
          names,
        ),
      ),
    ).toBe('Отмечено: платит одной суммой (налоги и обслуживание)');
    expect(
      plain(
        contractorHistoryText(
          t,
          entry({ changes: [{ field: 'oneSum', from: true, to: false }] }),
          names,
        ),
      ),
    ).toBe('Снята отметка «Платит одной суммой»');
    expect(
      plain(
        contractorHistoryText(
          t,
          entry({ action: 'remind', changes: [{ field: 'feeReminder' }] }),
          names,
        ),
      ),
    ).toBe('Напоминание в WhatsApp о долге за обслуживание');
    const pay = (allocation: unknown, amount = 1_600_000) =>
      plain(
        contractorHistoryText(
          t,
          entry({
            entity: 'fee_payment',
            action: 'create',
            changes: [
              { field: 'amount', to: amount },
              { field: 'paidOn', to: '2026-10-18' },
              { field: 'allocation', to: allocation },
              { field: 'to', to: 'Счёт организации' },
            ],
          }),
          names,
        ),
      );
    expect(pay([{ month: '2026-09', amount: 1_400_000 }])).toBe(
      'Оплата за обслуживание 16 000 сом: сентябрь 2026 — 14 000, аванс — 2 000',
    );
    expect(pay([], 500_000)).toBe('Оплата за обслуживание 5 000 сом: аванс — 5 000');
  });

  it('поступление с частью за обслуживание: общая сумма и строки обслуживания (задача 2.21)', () => {
    const changes = [
      { field: 'kind', to: 'in' },
      { field: 'total', to: 500_000 },
      { field: 'opDate', to: '2026-10-18' },
      { field: 'allocations', to: [{ report: 'НДС 09.2026', amount: 300_000 }] },
      { field: 'feeTotal', to: 1_400_000 },
      { field: 'feeAllocations', to: [{ month: '2026-10', amount: 1_400_000 }] },
    ];
    expect(
      plain(
        contractorHistoryText(
          t,
          entry({ entity: 'money_operation', action: 'create', changes }),
          names,
        ),
      ),
    ).toBe(
      'Поступление 19 000 сом: НДС 09.2026 — 3 000, обслуживание октябрь 2026 — 14 000, аванс — 2 000',
    );
    // Без права «Видеть плату» сервер не отдаёт части за обслуживание — только налоговая часть.
    expect(
      plain(
        contractorHistoryText(
          t,
          entry({ entity: 'money_operation', action: 'create', changes: changes.slice(0, 4) }),
          names,
        ),
      ),
    ).toBe('Поступление 5 000 сом: НДС 09.2026 — 3 000, аванс — 2 000');
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

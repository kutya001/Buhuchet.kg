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
  it('файл контрагента (вручную или из свидетельства и выписки): прикреплён и удалён — с именем файла', () => {
    const file = (action: Entry['action'], change: Entry['changes'][number]) =>
      contractorHistoryText(t, entry({ entity: 'file', action, changes: [change] }), names);
    expect(file('file_attach', { field: 'file', to: 'svid.pdf' })).toContain('svid.pdf');
    expect(file('file_delete', { field: 'file', from: 'vyp.pdf' })).toContain('vyp.pdf');
    expect(file('file_delete', { field: 'file', from: 'vyp.pdf' })).not.toBe(t('cp.hist.update'));
  });

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

  it('исправление даты начала (прототип v84): одной строкой с причиной; у разового — «первого обращения»', () => {
    const changes = [
      { field: 'startDate', from: '2026-05-15', to: '2026-03-02' },
      { field: 'startReason', to: 'внесли с ошибкой' },
    ];
    expect(contractorHistoryText(t, entry({ changes }), names)).toBe(
      'Дата начала обслуживания: 15.05.2026 → 02.03.2026. Причина: внесли с ошибкой',
    );
    expect(
      contractorHistoryText(
        t,
        entry({ changes: [...changes, { field: 'startKind', to: 'oneoff' }] }),
        names,
      ),
    ).toBe('Дата первого обращения: 15.05.2026 → 02.03.2026. Причина: внесли с ошибкой');
    // Вместе с другими полями — в той же записи.
    expect(
      contractorHistoryText(
        t,
        entry({ changes: [{ field: 'head', from: '', to: 'Асанов' }, ...changes] }),
        names,
      ),
    ).toBe(
      'Дата начала обслуживания: 15.05.2026 → 02.03.2026. Причина: внесли с ошибкой; Изменено: руководитель',
    );
    // Дата без причины (перевод разового в постоянное) — как прежде.
    expect(contractorHistoryText(t, entry({ changes: [changes[0]!] }), names)).toBe(
      'Изменено: начало обслуживания',
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

  it('правка и удаление ставки — с причиной в тексте (прототип v86)', () => {
    const was = { amount: 1_400_000, period: 'M', validFrom: '2026-11-01', firstMonth: 'full' };
    expect(
      plain(
        contractorHistoryText(
          t,
          entry({
            reason: 'ставку внесли с ошибкой',
            changes: [
              {
                field: 'tariffEdited',
                from: was,
                to: {
                  amount: 1_500_000,
                  period: 'Y',
                  validFrom: '2026-12-01',
                  firstMonth: 'prorate',
                },
              },
            ],
          }),
          names,
        ),
      ),
    ).toBe(
      'Изменена ставка обслуживания: сумма 14 000 сом → 15 000 сом; периодичность: в год; ' +
        'действует с ноября 2026 → с декабря 2026; ' +
        'первый неполный месяц: Полный месяц → Пропорционально дням. Причина: ставку внесли с ошибкой',
    );
    // Изменилась только сумма: остальное в строку не попадает, причина — один раз.
    expect(
      plain(
        contractorHistoryText(
          t,
          entry({
            reason: 'опечатка',
            changes: [{ field: 'tariffEdited', from: was, to: { ...was, amount: 1_450_000 } }],
          }),
          names,
        ),
      ),
    ).toBe('Изменена ставка обслуживания: сумма 14 000 сом → 14 500 сом. Причина: опечатка');
    expect(
      plain(
        contractorHistoryText(
          t,
          entry({
            reason: 'внесли по ошибке',
            changes: [
              {
                field: 'tariffDeleted',
                from: { amount: 1_600_000, period: 'M', validFrom: '2027-01-01' },
              },
            ],
          }),
          names,
        ),
      ),
    ).toBe(
      'Удалена ставка 16 000 сом в месяц с января 2027 (ещё не действовала). Причина: внесли по ошибке',
    );
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
    // «Скопировать для клиента» (задача К4; прототип v94 `rmPayMount`).
    expect(
      plain(
        contractorHistoryText(
          t,
          entry({
            action: 'pay_text_copy',
            changes: [{ field: 'payText', to: { month: '2026-10', total: 500_000 } }],
          }),
          names,
        ),
      ),
    ).toBe('Скопирован текст «К оплате» за октябрь 2026: 5 000 сом');
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
      via: null,
    });
  });

  it('действие из чата бота — отметка «через Telegram» (прототип histVia)', () => {
    const item = contractorHistoryItem(t, entry({ action: 'create', via: 'telegram' }), names);
    expect(item.via).toBe('через Telegram');
  });
});

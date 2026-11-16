import { defaultUiTexts } from '@buhuchet/domain';
import type { FileLinkInfo } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { fileAlsoText, fileDeleteLinksList, fileLinkText, fileSourceWithLinks } from './file-links';

const ID = '00000000-0000-4000-8000-000000000001';
const link = (over: Partial<FileLinkInfo>): FileLinkInfo => ({
  kind: 'receipt',
  id: ID,
  parentId: null,
  date: '2026-11-10',
  amount: 1_500_000,
  name: null,
  op: null,
  report: null,
  ...over,
});

/** Суммы — с неразрывным пробелом между разрядами (`formatSom`): в ожиданиях — обычный пробел. */
const sp = (s: string | null) => s?.replace(/[\u00a0\u202f]/g, ' ') ?? null;

describe('подписи записей файла контрагента (прототип v124 fLinkRecs)', () => {
  const t = makeTranslate(defaultUiTexts());
  const all = (l: FileLinkInfo) => [
    fileLinkText(t, l, 'nm'),
    fileLinkText(t, l, 'gen'),
    sp(fileLinkText(t, l, 'src')),
  ];

  it('поступление, оплата налога, операция, оплата за обслуживание — с датой и суммой', () => {
    expect(all(link({}))).toEqual([
      'Поступление от 10.11.2026',
      'поступления от 10.11.2026',
      'Поступление 10.11.2026, 15 000 сом',
    ]);
    expect(
      all(
        link({
          kind: 'tax_payment',
          amount: 250_000,
          report: { short: 'НДС', period: 'M', start: '2026-10-01', event: null },
        }),
      ),
    ).toEqual([
      'Оплата налога от 10.11.2026',
      'оплаты налога от 10.11.2026',
      'Оплата НДС · 10.2026 — 2 500 сом от 10.11.2026',
    ]);
    expect(sp(fileLinkText(t, link({ kind: 'tax_payment' }), 'src'))).toBe(
      'Оплата налога 10.11.2026, 15 000 сом',
    );
    expect(all(link({ kind: 'money_operation', op: 'bonus', amount: 100_000 }))).toEqual([
      'Списание в бонус от 10.11.2026',
      'операции «Списание в бонус» от 10.11.2026',
      'Списание в бонус 10.11.2026, 1 000 сом',
    ]);
    expect(all(link({ kind: 'fee_payment', amount: 500_000 }))).toEqual([
      'Оплата за обслуживание от 10.11.2026',
      'оплаты за обслуживание от 10.11.2026',
      'Оплата за обслуживание 10.11.2026, 5 000 сом',
    ]);
  });

  it('отчёт, разовая услуга, проект и их оплаты — с названием', () => {
    expect(
      all(
        link({
          kind: 'report',
          date: null,
          amount: null,
          report: { short: 'ЕН', period: 'Q', start: '2026-07-01', event: null },
        }),
      ),
    ).toEqual(['Отчёт ЕН · III кв. 2026', 'отчёта ЕН · III кв. 2026', 'Отчёт ЕН · III кв. 2026']);
    expect(all(link({ kind: 'one_off_service', name: 'Ликвидация' }))[1]).toBe(
      'разовой услуги «Ликвидация»',
    );
    expect(
      all(link({ kind: 'one_off_service_payment', name: 'Ликвидация', amount: 300_000 })),
    ).toEqual([
      'Оплата разовой услуги от 10.11.2026',
      'оплаты разовой услуги «Ликвидация» от 10.11.2026',
      'Оплата разовой услуги «Ликвидация» 10.11.2026, 3 000 сом',
    ]);
    expect(all(link({ kind: 'project', name: 'Аудит' }))[0]).toBe('Проект «Аудит»');
    expect(all(link({ kind: 'project_payment', name: 'Аудит', amount: 300_000 }))).toEqual([
      'Оплата по проекту от 10.11.2026',
      'оплаты по проекту «Аудит» от 10.11.2026',
      'Оплата по проекту «Аудит» 10.11.2026, 3 000 сом',
    ]);
  });

  it('«Источник», «также у …» и список «Удалить отовсюду?» (прототип allFiles, fDelDlg)', () => {
    const two = [link({}), link({ kind: 'fee_payment', amount: 500_000 })];
    expect(sp(fileSourceWithLinks(t, 'Загружен вручную', two))).toBe(
      'Загружен вручную · Поступление 10.11.2026, 15 000 сом · Оплата за обслуживание 10.11.2026, 5 000 сом',
    );
    expect(fileAlsoText(t, two)).toBe(
      'также у поступления от 10.11.2026, оплаты за обслуживание от 10.11.2026',
    );
    expect(fileAlsoText(t, [])).toBeNull();
    expect(fileDeleteLinksList(t, two, 0)).toBe(
      'поступление от 10.11.2026; оплата за обслуживание от 10.11.2026',
    );
    expect(fileDeleteLinksList(t, [link({})], 2)).toBe(
      'поступление от 10.11.2026; ещё 2 записи, которых вам не видно',
    );
    expect(fileDeleteLinksList(t, [], 1)).toBe('ещё 1 запись, которых вам не видно');
  });
});

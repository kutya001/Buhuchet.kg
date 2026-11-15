import { FEATURES, type AccessSubject, type Feature, type PermissionId } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { payFor } from './sent';

/*
 * «Принять» у чека: сумма чека уходит только тому, кто может сразу принять эти деньги (доработки
 * 14.11.2026, блок 4, пункт 4; прототип v115 `pgRcptMoney`, `feeAccOk`). Иначе файл просто принят, а
 * сумма и месяц оплаты сотруднику не показываются.
 */

const ME = 'e-me';
const OTHER = 'e-other';
const allOn = Object.fromEntries(FEATURES.map((f) => [f, true])) as Record<Feature, boolean>;

function subject(permissions: PermissionId[], scopes: AccessSubject['scopes'] = {}): AccessSubject {
  return { employeeId: ME, isOwner: false, permissions: new Set(permissions), scopes };
}

const TAX = {
  purpose: 'tax' as const,
  month: '2026-10' as const,
  amount: 625_050,
  source: 'telegram' as const,
};
const FEE = {
  purpose: 'fee' as const,
  month: '2026-09' as const,
  amount: 900_000,
  source: 'page' as const,
};
const mine = { responsibleEmployeeId: ME, archived: false };
const theirs = { responsibleEmployeeId: OTHER, archived: false };

describe('«Принять» у чека: сумма — только тому, кто может принять эти деньги', () => {
  it('налоги: «Учёт оплаты налогов», «Учёт денег» и область «Финансовых операций»', () => {
    const money = subject(['finView', 'money'], { fin: 'all' });
    expect(payFor(TAX, { subject: money, features: allOn, contractor: theirs })).toEqual(TAX);
    // Без «Учёт денег» — только просмотр финансовых операций.
    const view = subject(['finView'], { fin: 'all' });
    expect(payFor(TAX, { subject: view, features: allOn, contractor: theirs })).toBeNull();
    // Область «Свои»: свой контрагент — да, чужой — нет.
    const own = subject(['finView', 'money'], { fin: 'own' });
    expect(payFor(TAX, { subject: own, features: allOn, contractor: mine })).toEqual(TAX);
    expect(payFor(TAX, { subject: own, features: allOn, contractor: theirs })).toBeNull();
    // Функция «Учёт оплаты налогов» выключена.
    const off = { ...allOn, taxpay: false };
    expect(payFor(TAX, { subject: money, features: off, contractor: theirs })).toBeNull();
  });

  it('обслуживание: «Плата за обслуживание», «Видеть плату» и «Менять ставку» в области «Контрагентов»', () => {
    const fee = subject(['cpView', 'fee', 'tariff'], { cps: 'all' });
    expect(payFor(FEE, { subject: fee, features: allOn, contractor: theirs })).toEqual(FEE);
    // «Видеть плату» без «Менять ставку».
    const view = subject(['cpView', 'fee'], { cps: 'all' });
    expect(payFor(FEE, { subject: view, features: allOn, contractor: theirs })).toBeNull();
    // Область «Свои»: чужой контрагент — нет.
    const own = subject(['cpView', 'fee', 'tariff'], { cps: 'own' });
    expect(payFor(FEE, { subject: own, features: allOn, contractor: mine })).toEqual(FEE);
    expect(payFor(FEE, { subject: own, features: allOn, contractor: theirs })).toBeNull();
    // Функция «Плата за обслуживание» выключена.
    const off = { ...allOn, fee: false };
    expect(payFor(FEE, { subject: fee, features: off, contractor: theirs })).toBeNull();
    // Права на налоги обслуживание не открывают, и наоборот.
    const money = subject(['finView', 'money'], { fin: 'all' });
    expect(payFor(FEE, { subject: money, features: allOn, contractor: theirs })).toBeNull();
    expect(payFor(TAX, { subject: fee, features: allOn, contractor: theirs })).toBeNull();
  });

  it('контрагент в архиве и файл не чек — без денег, даже владельцу', () => {
    const owner: AccessSubject = { ...subject([]), isOwner: true };
    expect(payFor(TAX, { subject: owner, features: allOn, contractor: mine })).toEqual(TAX);
    const archived = { ...mine, archived: true };
    expect(payFor(TAX, { subject: owner, features: allOn, contractor: archived })).toBeNull();
    expect(payFor(undefined, { subject: owner, features: allOn, contractor: mine })).toBeNull();
  });
});

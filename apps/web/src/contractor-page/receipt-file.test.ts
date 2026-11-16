import { defaultUiTexts } from '@buhuchet/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { takeSentReceipt } from './receipt-file';

const acceptSent = vi.hoisted(() => vi.fn());
vi.mock('../files/sent-data', () => ({ acceptSent }));

/*
 * «Сохранить» в окне денег с чеком (доработки 16.11.2026, блок 1, пункты 2, 4 и 7; прототип v121
 * `pgRcptSave`): деньги уже записаны, чек принимается и прикрепляется к ним; чек тем временем решил
 * другой сотрудник — деньги остаются без него с предупреждением.
 */
describe('takeSentReceipt: чек после записи денег (прототип v121 pgRcptSave)', () => {
  const t = makeTranslate(defaultUiTexts());
  const errorText = (e: { message: string }) => e.message;
  const receipt = { sentId: 'sent-1', name: 'Чек.pdf', version: 3 };
  const decided = (status: 'accepted' | 'rejected', by: string | null) => ({
    ok: false,
    error: { code: 'sent_decided', message: 'Файл уже решён', details: { status, by } },
  });

  beforeEach(() => acceptSent.mockReset());

  it('«Сохранить» с чеком — «Принять» с прикреплением к записи денег, без сообщений', async () => {
    acceptSent.mockResolvedValue({ ok: true, item: {} });
    const attach = { kind: 'receipt' as const, id: 'op-1' };
    expect(await takeSentReceipt(t, errorText, receipt, { kind: 'receipt', attach })).toBeNull();
    expect(acceptSent).toHaveBeenCalledWith({ id: 'sent-1', version: 3 }, attach);
  });

  it('после «Убрать» — «Принять» без прикрепления: чек только в файлы контрагента', async () => {
    acceptSent.mockResolvedValue({ ok: true, item: {} });
    expect(await takeSentReceipt(t, errorText, receipt, { kind: 'fee', attach: null })).toBeNull();
    expect(acceptSent).toHaveBeenCalledWith({ id: 'sent-1', version: 3 }, undefined);
  });

  it('чек уже принял или отклонил другой — деньги сохранены без него, текст по виду окна', async () => {
    const cases = [
      ['accepted', 'receipt', 'Чек уже принял Асанов А. — поступление сохранено без него'],
      ['rejected', 'receipt', 'Чек отклонил Асанов А. — поступление сохранено без него'],
      ['accepted', 'fee', 'Чек уже принял Асанов А. — оплата сохранена без него'],
      ['rejected', 'fee', 'Чек отклонил Асанов А. — оплата сохранена без него'],
    ] as const;
    for (const [status, kind, warn] of cases) {
      acceptSent.mockResolvedValueOnce(decided(status, 'Асанов А.'));
      expect(await takeSentReceipt(t, errorText, receipt, { kind, attach: null })).toEqual({
        warn,
      });
    }
    // Кто решил, сервер не назвал — прочерк.
    acceptSent.mockResolvedValueOnce(decided('accepted', null));
    expect(await takeSentReceipt(t, errorText, receipt, { kind: 'receipt', attach: null })).toEqual(
      { warn: 'Чек уже принял — — поступление сохранено без него' },
    );
  });

  it('другая ошибка — «Записано, но файл … не загружен»: деньги записаны, чек остаётся «Новый»', async () => {
    acceptSent.mockResolvedValue({
      ok: false,
      error: { code: 'file_not_uploaded', message: 'Файл не загружен' },
    });
    expect(await takeSentReceipt(t, errorText, receipt, { kind: 'receipt', attach: null })).toEqual(
      {
        bad: t('money.files_saved_partly', { name: 'Чек.pdf', error: 'Файл не загружен' }),
      },
    );
    // 409 `sent_decided` без понятных подробностей — тоже как другая ошибка.
    acceptSent.mockResolvedValue({
      ok: false,
      error: { code: 'sent_decided', message: 'Файл уже решён', details: { status: 'x' } },
    });
    expect(
      await takeSentReceipt(t, errorText, receipt, { kind: 'receipt', attach: null }),
    ).toHaveProperty('bad');
  });
});

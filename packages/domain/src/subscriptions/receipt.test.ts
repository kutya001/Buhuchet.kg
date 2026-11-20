import { describe, expect, it } from 'vitest';
import {
  subscriptionAgainId,
  subscriptionDaysLeft,
  subscriptionLastRejected,
  subscriptionReceiptName,
  subscriptionReceiptProblem,
  subscriptionReceiptSniff,
  subscriptionReceiptStoredName,
  subscriptionReceiptUploadType,
  type SubscriptionPaymentFacts,
} from './receipt';
import { SUBSCRIPTION_RECEIPT_MAX_BYTES } from './subscriptions';

// Чек и «История оплат» экрана «Подписка» (доработки 20.11.2026, блок 5; прототип v154 org-sub.js).

const bytes = (...b: number[]) => new Uint8Array(b);

describe('чек об оплате подписки', () => {
  it('тип — по содержимому: PDF, JPG, PNG, остальное — нет (прототип subFileErr)', () => {
    expect(subscriptionReceiptSniff(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toBe(
      'application/pdf',
    );
    expect(subscriptionReceiptSniff(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(subscriptionReceiptSniff(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      'image/png',
    );
    // HTML с расширением .pdf, GIF и обрезанная подпись PNG — не чек.
    expect(subscriptionReceiptSniff(new TextEncoder().encode('<html>'))).toBeNull();
    expect(subscriptionReceiptSniff(bytes(0x47, 0x49, 0x46, 0x38))).toBeNull();
    expect(subscriptionReceiptSniff(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(subscriptionReceiptSniff(bytes())).toBeNull();
  });

  it('тип загрузки — по расширению (прототип subFileType)', () => {
    expect(subscriptionReceiptUploadType('Чек.PDF')).toBe('application/pdf');
    expect(subscriptionReceiptUploadType('фото.png')).toBe('image/png');
    expect(subscriptionReceiptUploadType('фото.jpeg')).toBe('image/jpeg');
    expect(subscriptionReceiptUploadType('без расширения')).toBe('image/jpeg');
  });

  it('имя, пустой и больше 20 МБ — до загрузки', () => {
    expect(subscriptionReceiptName('C:\\Users\\u\\  Чек   октябрь.pdf ')).toBe('Чек октябрь.pdf');
    expect(subscriptionReceiptProblem({ name: 'чек.pdf', size: 1 })).toBeNull();
    expect(subscriptionReceiptProblem({ name: '  ', size: 1 })).toBe('sub_receipt_name');
    expect(subscriptionReceiptProblem({ name: 'a\u0007.pdf', size: 1 })).toBe('sub_receipt_name');
    expect(subscriptionReceiptProblem({ name: `${'я'.repeat(252)}.pdf`, size: 1 })).toBe(
      'sub_receipt_name',
    );
    // Знаки смены направления письма («Счёт‮fdp.bat» в списке — «Счётtab.pdf») и точка в конце.
    expect(subscriptionReceiptProblem({ name: 'Счёт\u202efdp.bat', size: 1 })).toBe(
      'sub_receipt_name',
    );
    expect(subscriptionReceiptProblem({ name: 'Чек\u2066.pdf', size: 1 })).toBe('sub_receipt_name');
    expect(subscriptionReceiptProblem({ name: 'Чек.exe.', size: 1 })).toBe('sub_receipt_name');
    expect(subscriptionReceiptProblem({ name: 'чек.pdf', size: 0 })).toBe('sub_receipt_empty');
    expect(subscriptionReceiptProblem({ name: 'чек.pdf', size: 1.5 })).toBe('sub_receipt_empty');
    expect(
      subscriptionReceiptProblem({ name: 'чек.pdf', size: SUBSCRIPTION_RECEIPT_MAX_BYTES }),
    ).toBeNull();
    expect(
      subscriptionReceiptProblem({ name: 'чек.pdf', size: SUBSCRIPTION_RECEIPT_MAX_BYTES + 1 }),
    ).toBe('sub_receipt_large');
  });
});

describe('имя хранимого чека — с расширением типа по содержимому', () => {
  it('«Чек.bat» с «%PDF-» хранится как «Чек.bat.pdf»; подходящее окончание не меняется', () => {
    expect(subscriptionReceiptStoredName('Чек.bat', 'application/pdf')).toBe('Чек.bat.pdf');
    expect(subscriptionReceiptStoredName('Чек.PDF', 'application/pdf')).toBe('Чек.PDF');
    expect(subscriptionReceiptStoredName('скан', 'image/jpeg')).toBe('скан.jpg');
    expect(subscriptionReceiptStoredName('фото.JPEG', 'image/jpeg')).toBe('фото.JPEG');
    expect(subscriptionReceiptStoredName('фото.jpg', 'image/png')).toBe('фото.jpg.png');
    expect(subscriptionReceiptStoredName('чек.png', 'image/png')).toBe('чек.png');
    const long = subscriptionReceiptStoredName(`${'я'.repeat(255)}`, 'application/pdf');
    expect(long).toHaveLength(255);
    expect(long.endsWith('.pdf')).toBe(true);
  });
});

describe('«История оплат»: отклонённый чек', () => {
  const p = (
    id: string,
    kind: SubscriptionPaymentFacts['kind'],
    status: SubscriptionPaymentFacts['status'],
  ): SubscriptionPaymentFacts => ({ id, kind, status });

  it('последняя проверенная заявка владельца отклонена — бесплатный период и правка администратора не в счёт', () => {
    expect(subscriptionLastRejected([])).toBe(false);
    expect(
      subscriptionLastRejected([p('a', 'mem', 'rejected'), p('b', 'renew', 'confirmed')]),
    ).toBe(true);
    expect(
      subscriptionLastRejected([
        p('w', 'renew', 'pending'),
        p('f', 'free', 'confirmed'),
        p('a', 'grow', 'rejected'),
      ]),
    ).toBe(true);
    expect(
      subscriptionLastRejected([p('a', 'renew', 'confirmed'), p('b', 'mem', 'rejected')]),
    ).toBe(false);
  });

  it('«Прикрепить другой чек» — только у самой новой записи, если она отклонена и нового чека нет', () => {
    expect(subscriptionAgainId([p('a', 'mem', 'rejected'), p('b', 'renew', 'confirmed')])).toBe(
      'a',
    );
    expect(subscriptionAgainId([p('w', 'renew', 'pending'), p('a', 'mem', 'rejected')])).toBeNull();
    expect(
      subscriptionAgainId([p('f', 'admin', 'confirmed'), p('a', 'mem', 'rejected')]),
    ).toBeNull();
    expect(subscriptionAgainId([])).toBeNull();
  });

  it('дней до конца срока: 0 — последний день, меньше нуля — просрочено', () => {
    expect(subscriptionDaysLeft('2026-11-30', '2026-11-20')).toBe(10);
    expect(subscriptionDaysLeft('2026-11-20', '2026-11-20')).toBe(0);
    expect(subscriptionDaysLeft('2026-11-18', '2026-11-20')).toBe(-2);
  });
});

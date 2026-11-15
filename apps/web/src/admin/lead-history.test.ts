import { defaultUiTexts } from '@buhuchet/domain';
import type { AdminLeadCard, AdminLeadEvent } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { leadDocsHint, leadEventText, leadHistoryItems } from './lead-history';

// «История» окна заявки — тексты как в прототипе (admin/leads.js `leadLog`, modules/landing.js).

const t = makeTranslate(defaultUiTexts());
const GUEST = 'Посетитель сайта';
const ADMIN = 'Администратор платформы';

const event = (over: Partial<AdminLeadEvent>): AdminLeadEvent => ({
  at: '2026-11-01T04:42:00.000Z',
  actor: ADMIN,
  kind: 'status',
  from: null,
  to: null,
  text: null,
  via: null,
  ...over,
});

describe('история заявки', () => {
  it('заявка с сайта; со стенда — с отметкой «тестовый стенд»; повтор с того же телефона', () => {
    const created = event({ kind: 'created', actor: GUEST, to: 'new' });
    expect(leadEventText(t, created, false)).toBe('Заявка с сайта');
    expect(leadEventText(t, created, true)).toBe('Заявка с сайта (тестовый стенд)');
    expect(leadEventText(t, event({ kind: 'repeat', actor: GUEST }), false)).toBe(
      'Повторная заявка с того же телефона',
    );
    expect(leadEventText(t, event({ kind: 'repeat', actor: GUEST, text: 'Ещё' }), false)).toBe(
      'Повторная заявка с того же телефона: комментарий дописан',
    );
  });

  it('смена статуса, «Отказ» с причиной, откат, организация по заявке, заметка', () => {
    const status = (over: Partial<AdminLeadEvent>) => leadEventText(t, event(over), false);
    expect(status({ from: 'new', to: 'in_progress' })).toBe('Статус: Новая → В работе');
    expect(status({ from: 'in_progress', to: 'rejected', text: 'Нужны проводки' })).toBe(
      'Статус: В работе → Отказ (Нужны проводки)',
    );
    expect(status({ kind: 'rollback', from: 'rejected', to: 'in_progress', text: 'ошибка' })).toBe(
      'Статус: Отказ → В работе (откат: ошибка)',
    );
    expect(status({ kind: 'org', from: 'new', to: 'connected', text: 'ОсОО «Альфа»' })).toBe(
      'Статус: Новая → Подключена, создана организация «ОсОО «Альфа»»',
    );
    expect(status({ kind: 'org', from: 'connected', to: 'connected', text: 'ОсОО «Альфа»' })).toBe(
      'Создана организация «ОсОО «Альфа»»',
    );
    expect(status({ kind: 'note' })).toBe('Заметка администратора изменена');
  });

  it('(доработки 14.11.2026, блок 1) «Одобрить»: «одобрена: создана организация»; файлы удалены по сроку', () => {
    const text = (over: Partial<AdminLeadEvent>, approved = true) =>
      leadEventText(t, event(over), false, approved);
    expect(text({ kind: 'org', from: 'in_progress', to: 'connected', text: 'ИП Токтогулов' })).toBe(
      'Статус: В работе → Подключена, одобрена: создана организация «ИП Токтогулов»',
    );
    expect(text({ kind: 'org', from: 'connected', to: 'connected', text: 'ИП Токтогулов' })).toBe(
      'Одобрена: создана организация «ИП Токтогулов»',
    );
    expect(text({ kind: 'docs', text: 'rejected' }, false)).toBe(
      'Файлы заявки удалены: прошло 7 дней после отказа',
    );
    expect(text({ kind: 'docs', text: 'kept' }, false)).toBe(
      'Файлы заявки удалены: прошло 30 дней после отправки',
    );
  });

  it('(доработки 14.11.2026, блок 1) пояснение под файлами заявки: срок, после отказа, удалены, у организации', () => {
    const base = {
      docsGoneAt: null,
      org: null,
      docsPurgeAt: '2026-12-14T18:00:00.000Z',
      status: 'new',
    } as unknown as AdminLeadCard;
    expect(leadDocsHint(t, base)).toBe(
      'Файлы видит только администратор платформы. Удалятся 15.12.2026, если заявку не одобрить.',
    );
    expect(leadDocsHint(t, { ...base, status: 'rejected' })).toBe(
      'Файлы видит только администратор платформы. Удалятся 15.12.2026 — через 7 дней после отказа.',
    );
    expect(leadDocsHint(t, { ...base, docsGoneAt: '2026-12-15T03:00:00.000Z' })).toBe(
      'Файлы заявки удалены 15.12.2026: срок хранения истёк.',
    );
    expect(
      leadDocsHint(t, {
        ...base,
        docsPurgeAt: null,
        org: { id: 'o', name: 'ИП Токтогулов' },
      } as AdminLeadCard),
    ).toBe(
      'Файлы переданы в «Файловый менеджер» организации «ИП Токтогулов» с источником «Заявка на подключение».',
    );
    expect(leadDocsHint(t, { ...base, docsPurgeAt: null })).toBe('');
  });

  it('новые сверху, дата и время по Бишкеку, кто', () => {
    const card = {
      fromStand: true,
      history: [
        event({ kind: 'created', actor: GUEST, to: 'new' }),
        event({ at: '2026-11-01T05:00:00.000Z', kind: 'note' }),
      ],
    } as AdminLeadCard;
    expect(leadHistoryItems(t, card).map((i) => [i.date, i.time, i.text, i.who])).toEqual([
      ['01.11.2026', '11:00', 'Заметка администратора изменена', ADMIN],
      ['01.11.2026', '10:42', 'Заявка с сайта (тестовый стенд)', GUEST],
    ]);
  });

  it('статус, изменённый кнопкой в чате бота, — с отметкой «через Telegram» (задача Т6)', () => {
    const card = {
      fromStand: false,
      history: [
        event({ kind: 'created', actor: GUEST, to: 'new' }),
        event({ at: '2026-11-01T05:00:00.000Z', from: 'new', to: 'in_progress', via: 'telegram' }),
      ],
    } as AdminLeadCard;
    expect(leadHistoryItems(t, card).map((i) => [i.text, i.via])).toEqual([
      ['Статус: Новая → В работе', 'через Telegram'],
      ['Заявка с сайта', null],
    ]);
  });
});

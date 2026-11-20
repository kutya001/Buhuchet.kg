import { defaultUiTexts } from '@buhuchet/domain';
import type { AdminOrgCard } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  megabytesText,
  orgHashTarget,
  orgHistoryItems,
  orgHistoryText,
  orgHistoryWho,
  remindText,
} from './org-card-model';

// Карточка организации в Админке (прототип v83, admin/admin-cards.js: ocHist, ocMain, ocSet): строки
// «Истории», объём файлов, дни напоминаний и адрес #orgs/<адрес организации>.

const t = makeTranslate(defaultUiTexts());

type Entry = AdminOrgCard['history'][number];
const entry = (over: Partial<Entry>): Entry => ({
  id: 'organization-1',
  at: '2026-11-09T04:30:00.000Z',
  actor: null,
  actorAdmin: true,
  entity: 'organization',
  action: 'update',
  subject: null,
  changes: [],
  reason: null,
  ...over,
});

describe('карточка организации: «История»', () => {
  it('подписка — теми же словами, что в окне «Подписка организации»; вид — названием от сервера', () => {
    expect(
      orgHistoryText(
        t,
        entry({
          entity: 'subscription',
          changes: [
            { field: 'planId', from: 'Месяц', to: 'Квартал' },
            { field: 'seats', from: 10, to: 20 },
          ],
          reason: 'Оплата наличными',
        }),
      ),
    ).toBe('Подписка изменена: Вид: Месяц → Квартал; Пакет: 10 → 20. Причина: Оплата наличными');
  });

  it('создание и открытие карточки', () => {
    expect(orgHistoryText(t, entry({ action: 'create' }))).toBe(
      'Организация создана вместе с владельцем',
    );
    expect(
      orgHistoryText(t, entry({ action: 'card_view', reason: 'Открыта карточка организации' })),
    ).toBe('Открыта карточка организации');
    // «Одобрить» заявки с сайта (прототип v114 ldApproveDlg).
    expect(
      orgHistoryText(
        t,
        entry({
          action: 'create',
          changes: [{ field: 'fromLead', from: null, to: 'nurlan.kasymov' }],
        }),
      ),
    ).toBe(
      'Организация создана по заявке с сайта: владелец nurlan.kasymov, файлы заявки — в «Файловом менеджере» (Заявка на подключение)',
    );
  });

  it('блокировка — с причиной, разблокировка — с прежней причиной', () => {
    const block = entry({
      changes: [
        { field: 'status', from: 'active', to: 'blocked' },
        { field: 'blockedReason', from: null, to: 'Заблокирована администратором' },
      ],
      reason: 'Организация заблокирована администратором платформы',
    });
    expect(orgHistoryText(t, block)).toBe(
      'Организация заблокирована: Заблокирована администратором',
    );
    const unblock = entry({
      changes: [
        { field: 'status', from: 'blocked', to: 'active' },
        { field: 'blockedReason', from: 'Заблокирована администратором', to: null },
      ],
      reason: 'Организация разблокирована администратором платформы',
    });
    expect(orgHistoryText(t, unblock)).toBe(
      'Организация разблокирована (была: Заблокирована администратором)',
    );
    expect(
      orgHistoryText(t, entry({ changes: [{ field: 'status', from: 'blocked', to: 'active' }] })),
    ).toBe('Организация разблокирована');
  });

  it('реквизиты: было → стало, новое и убранное значение, поля без значений — «Изменено»', () => {
    const h = entry({
      actor: 'Асанова А.',
      actorAdmin: false,
      changes: [
        { field: 'name', from: 'ОсОО «Альфа»', to: 'ОсОО «Альфа плюс»' },
        { field: 'address', from: null, to: 'г. Бишкек' },
        { field: 'head', from: 'Иванов И.', to: null },
        { field: 'logoKey' },
      ],
    });
    expect(orgHistoryText(t, h)).toBe(
      'Название: ОсОО «Альфа» → ОсОО «Альфа плюс»; Адрес: г. Бишкек; Руководитель: Иванов И. → —; Изменено: логотип',
    );
    expect(orgHistoryText(t, entry({}))).toBe('Запись изменена');
  });

  it('(прототип v114 ldInnFormDlg) «ИНН и форма»: «ИНН: А → Б; Форма: ОсОО → ИП», ОКПО — значением', () => {
    const h = entry({
      changes: [
        { field: 'inn', from: '01234567890123', to: '01234567890124' },
        { field: 'legalForm', from: 'osoo', to: 'ip' },
      ],
    });
    expect(orgHistoryText(t, h)).toBe('ИНН: 01234567890123 → 01234567890124; Форма: ОсОО → ИП');
    expect(
      orgHistoryText(t, entry({ changes: [{ field: 'legalForm', from: null, to: 'osoo' }] })),
    ).toBe('Форма: — → ОсОО');
    expect(
      orgHistoryText(t, entry({ changes: [{ field: 'okpo', from: null, to: '12345678' }] })),
    ).toBe('ОКПО: 12345678');
  });

  it('учётная политика — словами её истории', () => {
    const h = entry({
      entity: 'org_settings',
      actor: 'Асанова А.',
      actorAdmin: false,
      changes: [{ field: 'taskConfirm', from: true, to: false }],
    });
    expect(orgHistoryText(t, h)).toBe('Задачи требуют подтверждения: выключено');
    expect(orgHistoryText(t, entry({ entity: 'org_settings', action: 'create' }))).toBe(
      'Учётная политика по умолчанию',
    );
    expect(
      orgHistoryText(t, entry({ entity: 'org_settings', changes: [{ field: 'timezone' }] })),
    ).toBe('Учётная политика изменена');
    // Блок «Telegram-уведомления» (пакет 14.11.2026, блок 3): час и день недельной сводки — словами.
    expect(
      orgHistoryText(
        t,
        entry({
          entity: 'org_settings',
          changes: [{ field: 'digestTime', from: '09:00:00', to: '08:30' }],
        }),
      ),
    ).toBe('Час напоминаний: 09:00 → 08:30');
    expect(
      orgHistoryText(
        t,
        entry({ entity: 'org_settings', changes: [{ field: 'weekDay', from: 1, to: 5 }] }),
      ),
    ).toBe('Недельная сводка: понедельник → пятница');
    expect(
      orgHistoryText(
        t,
        entry({
          entity: 'org_settings',
          changes: [{ field: 'overdueRepeat', from: false, to: true }],
        }),
      ),
    ).toBe('Повторять напоминание при просрочке каждый день: включено');
  });

  it('«Действия из Telegram»: включены и выключены; другие поля той же записи не теряются', () => {
    const actions = (to: boolean, more: Entry['changes'] = []) =>
      orgHistoryText(
        t,
        entry({
          entity: 'org_settings',
          changes: [{ field: 'telegramActions', from: !to, to }, ...more],
        }),
      );
    expect(actions(false)).toBe('Действия из Telegram: выключены');
    expect(actions(true)).toBe('Действия из Telegram: включены');
    expect(actions(false, [{ field: 'taskConfirm', from: true, to: false }])).toBe(
      'Действия из Telegram: выключены; Задачи требуют подтверждения: выключено',
    );
  });

  it('роли: создана, удалена, переименована, изменены права и область', () => {
    const role = (over: Partial<Entry>) => entry({ entity: 'role', ...over });
    expect(orgHistoryText(t, role({ action: 'create', subject: 'Бухгалтер' }))).toBe(
      'Роль «Бухгалтер» создана',
    );
    expect(orgHistoryText(t, role({ action: 'create' }))).toBe('Роль создана');
    expect(
      orgHistoryText(
        t,
        role({ action: 'delete', changes: [{ field: 'name', from: 'Стажёр', to: null }] }),
      ),
    ).toBe('Роль «Стажёр» удалена');
    expect(
      orgHistoryText(
        t,
        role({
          subject: 'Старший бухгалтер',
          changes: [
            { field: 'name', from: 'Бухгалтер', to: 'Старший бухгалтер' },
            { field: 'permissions' },
            { field: 'scopes' },
          ],
        }),
      ),
    ).toBe(
      'Роль «Старший бухгалтер»: название Бухгалтер → Старший бухгалтер, изменены права, изменена область записей',
    );
    expect(orgHistoryText(t, role({}))).toBe('Роль: изменена');
  });

  it('кто: сотрудник, администратор платформы, система; дата и время — по Бишкеку', () => {
    expect(orgHistoryWho(t, entry({ actor: 'Асанова А.', actorAdmin: false }))).toBe('Асанова А.');
    expect(orgHistoryWho(t, entry({}))).toBe('Администратор платформы');
    expect(orgHistoryWho(t, entry({ actorAdmin: false }))).toBe(t('status.system'));
    expect(orgHistoryItems(t, [entry({ action: 'create' })])).toEqual([
      {
        id: 'organization-1',
        date: '09.11.2026',
        time: '10:30',
        text: 'Организация создана вместе с владельцем',
        who: 'Администратор платформы',
      },
    ]);
  });
});

describe('карточка организации: подписи', () => {
  it('объём файлов — МБ до десятых, как в прототипе', () => {
    expect(megabytesText(0)).toBe('0,00');
    expect(megabytesText(2_097_152)).toBe('2,00');
    expect(megabytesText(2_621_440)).toBe('2,50');
    expect(megabytesText(1_048_576 * 1234.56)).toBe('1 234,60');
  });

  it('напоминания о сроках: дни и «в день срока»', () => {
    expect(remindText(t, [7, 3, 1])).toBe('за 7 дней, за 3 дня, за 1 день и в день срока');
    expect(remindText(t, [])).toBe('в день срока');
  });

  it('адрес #orgs/…: адрес страницы или номер организации; чужой адрес и битая кодировка — нет', () => {
    expect(orgHashTarget('#orgs/demo')).toEqual({ slug: 'demo' });
    expect(orgHashTarget('#orgs/Alfa%2Dplus')).toEqual({ slug: 'alfa-plus' });
    const id = '00000000-0000-4000-8000-000000000001';
    expect(orgHashTarget(`#orgs/${id}`)).toEqual({ id });
    expect(orgHashTarget('#orgs/')).toBeNull();
    expect(orgHashTarget('#accounts/alisher')).toBeNull();
    expect(orgHashTarget('#orgs/%E0%A4%A')).toBeNull();
    expect(orgHashTarget('')).toBeNull();
  });
});

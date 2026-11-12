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
  it('создание и открытие карточки', () => {
    expect(orgHistoryText(t, entry({ action: 'create' }))).toBe(
      'Организация создана вместе с владельцем',
    );
    expect(
      orgHistoryText(t, entry({ action: 'card_view', reason: 'Открыта карточка организации' })),
    ).toBe('Открыта карточка организации');
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
      orgHistoryText(t, entry({ entity: 'org_settings', changes: [{ field: 'digestTime' }] })),
    ).toBe('Учётная политика изменена');
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

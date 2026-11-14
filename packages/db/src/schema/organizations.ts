import { ORG_LEGAL_FORMS } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  pgPolicy,
  pgTable,
  text,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { appRole, orgIsolation } from './rls';
import { users } from './users';

/**
 * Организации (тенанты) и их «Основное» в модуле «Моя организация». Роль приложения меняет только поля
 * профиля (права на столбцы, миграция 0015) и создаёт только активную не демо-организацию
 * (`organizations_insert_guard`, миграция 0025); статус и блокировку ведёт администратор платформы.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Адрес страницы организации: buhuchet.kg/<slug>/inn/<ИНН>. */
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /** 14 цифр; второй организации с таким ИНН быть не может. */
    inn: text('inn').unique(),
    address: text('address'),
    /** «+», код страны и цифры, как телефон сотрудника. */
    phone: text('phone'),
    /** Руководитель. */
    head: text('head'),
    /**
     * «Форма»: ОсОО или ИП (доработки 14.11.2026, блок 1, пункт 4). Как и ИНН, меняет только
     * администратор платформы — у роли приложения нет права менять столбец; у организаций, созданных до
     * 14.11.2026, пусто.
     */
    legalForm: text('legal_form', { enum: ORG_LEGAL_FORMS }),
    /** «ОКПО» — 8 цифр (доработки 14.11.2026, блок 1, пункт 4); меняет владелец в «Основное». */
    okpo: text('okpo'),
    /** Ключ логотипа в хранилище: org/<org_id>/logo/<id>; картинка — по подписанной ссылке. */
    logoKey: text('logo_key'),
    isDemo: boolean('is_demo').notNull().default(false),
    /**
     * active или blocked: заблокированную организацию (например, за неоплату) сотрудники не входят,
     * данные сохраняются и возвращаются при разблокировке (ТЗ «Админка» → «Блокировка организации»).
     * Причина — пометка администратора платформы, необязательная (в прототипе подставляется
     * «Заблокирована администратором»).
     */
    status: text('status').notNull().default('active'),
    blockedReason: text('blocked_reason'),
    // Ссылки по кругу (users ссылается на organizations) — тип столбца задан явно.
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    updatedBy: uuid('updated_by').references((): AnyPgColumn => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    check('organizations_status_check', sql`${t.status} in ('active', 'blocked')`),
    check(
      'organizations_legal_form_check',
      sql`${t.legalForm} is null or ${t.legalForm} in (${sql.raw(ORG_LEGAL_FORMS.map((v) => `'${v}'`).join(', '))})`,
    ),
    check('organizations_okpo_check', sql`${t.okpo} is null or ${t.okpo} ~ '^[0-9]{8}$'`),
    orgIsolation('organizations_isolation', t.id),
    // Новую организацию роль приложения создаёт только активной, без причины блокировки и не демо:
    // статус и блокировку ведёт администратор платформы (app.admin_set_org_status), демо — наполнение.
    // Права на столбцы при вставке не годятся — Drizzle перечисляет в INSERT все столбцы.
    pgPolicy('organizations_insert_guard', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.status} = 'active' and ${t.blockedReason} is null and not ${t.isDemo}`,
    }),
  ],
).enableRLS();

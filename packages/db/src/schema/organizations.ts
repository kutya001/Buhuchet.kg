import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { orgIsolation } from './rls';
import { users } from './users';

/**
 * Организации (тенанты) и их «Основное» в модуле «Моя организация». Роль приложения меняет только поля
 * профиля (права на столбцы, миграция 0014); статус и блокировку ведёт администратор платформы.
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
    /** Ключ логотипа в хранилище: org/<org_id>/logo/<id>; картинку отдаёт GET /api/org/logo. */
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
    orgIsolation('organizations_isolation', t.id),
  ],
).enableRLS();

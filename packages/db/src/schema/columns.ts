import { bigint, integer, timestamp } from 'drizzle-orm/pg-core';

/** Деньги — целые тыйыны. */
export const money = (name: string) => bigint(name, { mode: 'number' });

/** Номер версии записи (защита от одновременной правки). */
export const recordVersion = () => integer('version').notNull().default(1);

export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

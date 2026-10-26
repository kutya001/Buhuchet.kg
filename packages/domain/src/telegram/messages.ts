/**
 * Сообщения бота (ТЗ «Телеграм бот для любых уведомлений», «Уведомления в Telegram»): тексты —
 * шаблоны из «Справочников платформы» (refDB → messageTemplates), подстановки в фигурных скобках.
 * Для привязки и смены пароля шаблонов в справочнике пока нет — до них действуют эти
 * (docs/deviations.md, п. 6); шаблон справочника с тем же ключом главнее.
 */
export const TELEGRAM_TEMPLATE_DEFAULTS = {
  tgCode: 'Код для восстановления пароля: {код}. Действует 10 минут.',
  tgLinked:
    '✅ Telegram привязан к учётной записи {логин}. Сюда будут приходить напоминания о сроках и коды для восстановления пароля.',
  tgLinkInvalid:
    'Ссылка недействительна или устарела. Откройте «Мой профиль» в Buhuchet.kg и привяжите Telegram заново.',
  tgStart:
    'Это бот Buhuchet.kg. Чтобы получать напоминания, откройте «Мой профиль» и привяжите Telegram по ссылке из блока «Telegram для уведомлений».',
  tgPassChanged:
    '🔑 Пароль учётной записи {логин} изменён. Если вы его не меняли, сразу сообщите владельцу организации.',
} as const;

export type TelegramTemplateKey = keyof typeof TELEGRAM_TEMPLATE_DEFAULTS;

/** Подставить значения в шаблон: «{код}» → «482913». Неизвестная подстановка остаётся как есть. */
export function fillTemplate(template: string, values: Readonly<Record<string, string | number>>) {
  return template.replace(/\{([^{}]+)\}/g, (whole, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : whole,
  );
}

/**
 * Один Telegram привязан к нескольким логинам (например, бухгалтер в двух организациях) — тогда в
 * каждом сообщении указывается организация (ТЗ). Первой строкой, чтобы было видно в уведомлении.
 */
export function withOrganization(text: string, orgName: string | null, shared: boolean): string {
  return shared && orgName ? `${orgName}\n${text}` : text;
}

/** Как показать привязанный Telegram: «@имя» или, если имени пользователя нет, имя в Telegram. */
export function telegramName(link: { username: string | null; firstName: string | null }): string {
  if (link.username) return `@${link.username}`;
  return link.firstName?.trim() || 'Telegram';
}

/**
 * Команда «/start» из ссылки t.me/бот?start=токен. null — это не /start; token null — /start без
 * токена (пользователь просто открыл бота).
 */
export function parseStartCommand(text: string): { token: string | null } | null {
  const match = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text.trim());
  if (!match) return null;
  return { token: match[1] ?? null };
}

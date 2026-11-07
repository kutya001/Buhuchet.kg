import type { UiTextDefault } from './texts';

const S = 'Система';

/**
 * Оповещения администратору платформы в Telegram о сбоях (ревью безопасности Р-8 и Р-9,
 * docs/decisions.md п. О-30): задача по расписанию падает, снова работает, давно не запускалась,
 * Telegram не может доставить обновления вебхуку бота. Названия задач — `alert.job.<имя задачи>`
 * (точки и дефисы имени — «_»); задача без названия в словаре подписана своим именем.
 */
export const ALERTS_TEXTS = {
  'alert.job_failing': {
    ru: '⚠️ Сбой: задача по расписанию «{job}» не выполняется, неудачных попыток подряд: {n}.\nПоследняя ошибка: {error}\nСайт повторяет её сам. Если не придёт сообщение «снова выполняется», проверьте журнал сайта.',
    section: S,
  },
  'alert.job_recovered': {
    ru: '✅ Задача по расписанию «{job}» снова выполняется.',
    section: S,
  },
  'alert.jobs_missed': {
    ru: '⚠️ Задачи по расписанию не запускались дольше положенного:\n{list}\nПроверьте, что Vercel Cron (или worker на сервере) вызывает сайт каждую минуту.',
    section: S,
  },
  'alert.jobs_missed_item': {
    ru: '• «{job}»: последний запуск — {last}, по расписанию был нужен {expected}',
    section: S,
  },
  'alert.job_hung': {
    ru: 'Не закончилась за {n} минут: оборвана по времени или процесс остановлен',
    section: S,
  },
  'alert.webhook': {
    ru: '⚠️ Telegram не может доставить сообщения боту сайта: «{error}» ({at}). Ждут доставки: {n}.\nПроверьте Админка → «Телеграм» → «Бот платформы» → «Проверить вебхук».',
    section: S,
  },
  'alert.job.system_cleanup_scheduler_runs': { ru: 'Очистка журнала запусков', section: S },
  'alert.job.auth_cleanup_login_attempts': { ru: 'Очистка счёта неверных паролей', section: S },
  'alert.job.system_cleanup_rate_limits': { ru: 'Очистка частоты выгрузок', section: S },
  'alert.job.contractors_sync_service_status': {
    ru: 'Статусы обслуживания контрагентов',
    section: S,
  },
  'alert.job.contractor_page_cleanup_grants': {
    ru: 'Очистка запомненных браузеров страницы контрагента',
    section: S,
  },
  'alert.job.reports_create_due': { ru: 'Создание отчётов к сроку', section: S },
  'alert.job.files_cleanup_pending': { ru: 'Очистка незаконченных загрузок файлов', section: S },
  'alert.job.platform_dicts_dues_recalc': {
    ru: 'Пересчёт сроков после правки справочников',
    section: S,
  },
  'alert.job.telegram_reminders': { ru: 'Напоминания в Telegram', section: S },
  'alert.job.telegram_send': { ru: 'Отправка сообщений Telegram', section: S },
  'alert.job.telegram_register_webhook': { ru: 'Вебхук бота Telegram', section: S },
} as const satisfies Record<string, UiTextDefault>;

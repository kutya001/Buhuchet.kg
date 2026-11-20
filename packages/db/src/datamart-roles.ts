/**
 * Что видят роли базы «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 8, пункт 3;
 * миграция 0166, docs/decisions.md п. О-62). Списки повторяют миграцию: тест `datamart-run.test.ts`
 * сверяет их с правами базы, поэтому новая таблица без строки здесь и без миграции прав не проходит
 * проверки. Новая таблица организации (с `org_id`) открывается роли организаций своими строками, только
 * если миграция выдаст ей права; таблица без `org_id`, которой нет в списках, — только роли Админки.
 */

/** Закрыты обеим ролям: пароли, сеансы, коды и ключи Telegram и страниц, хеши токенов, попытки входа. */
export const DM_CLOSED_TABLES = [
  'admin_login_codes',
  'contractor_page_grants',
  'contractor_telegram_tokens',
  'dm_template_sql',
  'dm_tokens',
  'dues_recalcs',
  'login_attempts',
  'password_reset_codes',
  'password_setup_tokens',
  'platform_lead_tg_tokens',
  'rate_limits',
  'sessions',
  'storage_check_items',
  'storage_check_runs',
  'storage_delete_retries',
  'telegram_group_tokens',
  'telegram_inbox',
  'telegram_link_guards',
  'telegram_link_tokens',
  'telegram_relink_codes',
] as const;

/**
 * Только роли Админки: организации целиком, заявки, подписки и чеки, журналы и задачи платформы,
 * черновики новостей и видео, а также личные строки пользователя — роль организации фильтрует только по
 * организации, а приложение показывает их только самому пользователю.
 */
export const DM_ADMIN_ONLY_TABLES = [
  // Колокольчик: строку видит только получатель.
  'bell_notifications',
  'dict_loads',
  'dm_requests',
  'dm_template_orgs',
  'dm_templates',
  'file_trash',
  // Знакомые элементы «Базы знаний» — свои строки пользователя.
  'kb_known',
  'news',
  'news_admin_texts',
  // Прочитанные новости — свои строки пользователя.
  'news_reads',
  // Какой порог памяти уже сообщён владельцам — служебная строка рассылки (поток Т, миграция 0169).
  'org_memory_notices',
  'org_subscriptions',
  'platform_audit_log',
  'platform_lead_docs',
  'platform_lead_events',
  'platform_lead_uploads',
  'platform_leads',
  'scheduler_jobs',
  'scheduler_runs',
  'session_log',
  'subscription_payments',
  'subscription_plans',
  'subscription_settings',
  // Сообщения бота каждому сотруднику (в том числе о безопасности) — Админке, шаблон «Сообщения бота».
  'telegram_outbox',
  // Виджет «Мои отчёты на неделю» — одна строка учётной записи.
  'telegram_widgets',
  'video_guest_stats',
  'video_uploads',
  // Видео платформы: организации приложение показывает только опубликованные «для всех» (`videos_read`),
  // а роль Витрины фильтровала бы только по организации — черновики и видео «для Админки» открылись бы.
  'videos',
  // Настройки вида списков — свои строки пользователя.
  'view_settings',
  // Кто видел приветствие — свои строки пользователя.
  'welcome_seen',
] as const;

/** Справочники платформы без организации — обеим ролям целиком. */
export const DM_PLATFORM_TABLES = [
  'authorities',
  'banks',
  'due_change_reasons',
  'gked_items',
  'message_templates',
  'ownership_forms',
  'permissions',
  'phone_codes',
  'platform_reference',
  'production_calendar',
  'report_bases',
  'report_type_bases',
  'report_type_regimes',
  'report_types',
  'role_templates',
  'single_tax_rates',
  'status_tones',
  'task_categories',
  'tax_benefit_due_rules',
  'tax_benefit_offices',
  'tax_benefit_report_types',
  'tax_benefits',
  'tax_offices',
  'tax_regimes',
  'ui_texts',
] as const;

/**
 * Столбцы, закрытые обеим ролям в открытых таблицах: ключи хранилища, номера чатов Telegram, код
 * страницы контрагента и попытки его ввода, описания сообщений бота с кнопками, попытки входа, адрес
 * запроса по токену.
 */
export const DM_SECRET_COLUMNS = [
  'contractor_pages.code',
  'contractor_pages.code_version',
  'contractor_pages.failures',
  'contractor_pages.locked_until',
  'contractor_sent_files.storage_key',
  'contractor_sent_files.tg_chat_id',
  'contractor_telegram_links.chat_id',
  'contractor_telegram_messages.chat_id',
  'contractor_telegram_messages.payload',
  'dm_requests.ip',
  'file_trash.storage_key',
  'files.storage_key',
  'organizations.logo_key',
  'platform_lead_docs.storage_key',
  'platform_leads.tg_chat_id',
  'subscription_payments.receipt_key',
  'telegram_groups.chat_id',
  'telegram_links.chat_id',
  'telegram_outbox.chat_id',
  'telegram_outbox.last_error',
  'telegram_outbox.payload',
  'telegram_widgets.chat_id',
  'users.login_failures',
  'users.login_lock_reason',
  'users.login_locked_at',
  'users.password_hash',
  'video_uploads.s3_upload_id',
  'video_uploads.storage_key',
  'videos.cover_key',
  'videos.file_key',
] as const;

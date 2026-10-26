import { CONFIRM_WAIT_DAYS_MESSAGE, REMIND_DAYS_MESSAGE } from '../org/policy';
import { ORG_PROFILE_MESSAGES } from '../org/profile';
import { SLUG_MESSAGES } from '../org/slug';
import type { UiTextDefault } from './texts';

const S = 'Моя организация';

/**
 * Тексты модуля «Моя организация» (задача #19; прототип modules/org.js renderOrg, modules/profile.js
 * orgProfileDlg и orgMainView, modules/onboard.js featOnDlg; core/org.js FEATURES; refDB kbUi.features —
 * «что даёт» у функций; modules/cp-page.js PG_SECS — разделы страницы контрагента).
 */
export const ORG_TEXTS = {
  'org.main.title': { ru: 'Основное', section: S },
  'org.field.name': { ru: 'Название', section: S },
  'org.field.inn': { ru: 'ИНН', section: S },
  'org.field.phone': { ru: 'Телефон', section: S },
  'org.field.address': { ru: 'Адрес', section: S },
  'org.field.head': { ru: 'Руководитель', section: S },
  'org.field.slug': { ru: 'Адрес страницы организации', section: S },
  'org.field.slug_hint': {
    ru: 'Для ссылок на страницы контрагентов: www.buhuchet.kg/{slug}/inn/<ИНН>. 3–30 символов: строчные латинские буквы, цифры и дефис',
    section: S,
  },
  'org.field.logo': { ru: 'Логотип', section: S },
  'org.field.logo_hint': { ru: 'PNG или JPG до 2 МБ', section: S },
  'org.field.since': { ru: 'На платформе с', section: S },
  'org.saved': { ru: 'Сохранено', section: S },
  'org.readonly': {
    ru: 'Редактировать может только владелец организации. Вы видите профиль только для просмотра.',
    section: S,
  },
  'org.load_error': { ru: 'Не удалось загрузить данные организации', section: S },
  'org.slug.confirm_title': { ru: 'Сменить адрес страницы организации?', section: S },
  'org.slug.confirm_text': {
    ru: 'Ссылки, отправленные контрагентам, перестанут открываться. Новые ссылки будут вида www.buhuchet.kg/{slug}/inn/<ИНН> — их нужно отправить заново.',
    section: S,
  },
  'org.slug.confirm_ok': { ru: 'Сменить адрес', section: S },
  'org.profile.sub': { ru: 'Профиль организации · только просмотр', section: S },
  'org.profile.edit': { ru: 'Редактировать', section: S },

  'org.policy.readonly': {
    ru: 'Менять учётную политику может только владелец. Изменения записываются в историю.',
    section: S,
  },
  'org.policy.features': { ru: 'Функции', section: S },
  'org.policy.features_hint': {
    ru: 'Отключённая функция пропадает из меню, вкладок, полей и уведомлений, но данные не удаляются: при повторном включении всё вернётся. Основные модули — «Главная», «Контрагенты», «Отчеты для сдачи», «Сотрудники», «Справочники», «Моя организация», «Мой профиль» и «База знаний» — включены всегда.',
    section: S,
  },
  'org.feature.tasks': { ru: 'Задачи', section: S },
  'org.feature.calendar': { ru: 'Календарь отчётов', section: S },
  'org.feature.fee': { ru: 'Плата за обслуживание', section: S },
  'org.feature.taxpay': { ru: 'Учёт оплаты налогов', section: S },
  'org.feature.accounts': { ru: 'Виртуальные счета и бонусы', section: S },
  'org.feature.telegram': { ru: 'Напоминания в Telegram', section: S },
  'org.feature.files': { ru: 'Файлы в карточках', section: S },
  'org.feature.finops': { ru: 'Финансовые операции по контрагентам', section: S },
  'org.feature.projects': { ru: 'Проекты контрагентов', section: S },
  'org.feature.indicators': { ru: 'Показатели контрагентов', section: S },
  'org.feature.cppage': { ru: 'Страница контрагента по ссылке', section: S },
  'org.feature.tasks.hint': { ru: 'Модуль задач и регулярные задачи по отчётам', section: S },
  'org.feature.calendar.hint': { ru: 'Вкладка «Календарь» в модуле отчётов', section: S },
  'org.feature.fee.hint': { ru: 'Журнал тарифов, начисления, должники', section: S },
  'org.feature.taxpay.hint': { ru: 'Деньги от контрагента и оплата в бюджет', section: S },
  'org.feature.accounts.hint': {
    ru: 'Счета сотрудников и списание остатка в бонус',
    section: S,
  },
  'org.feature.telegram.hint': {
    ru: 'Напоминания о сроках, просрочках и еженедельная сводка',
    section: S,
  },
  'org.feature.files.hint': {
    ru: 'Прикрепление отчётов, квитанций и документов',
    section: S,
  },
  'org.feature.finops.hint': {
    ru: 'Модуль «Финансовые операции» и вкладка «Финансы» в карточке контрагента',
    section: S,
  },
  'org.feature.projects.hint': {
    ru: 'Модуль «Проекты», вкладка «Проекты» в карточке и проекты в задачах',
    section: S,
  },
  'org.feature.indicators.hint': {
    ru: 'Модуль «Показатели контрагентов» и вкладка «Показатели» в карточке контрагента',
    section: S,
  },
  'org.feature.cppage.hint': {
    ru: 'Контрагент по ссылке и коду из 6 цифр смотрит свои отчёты, показатели и оплату за обслуживание',
    section: S,
  },
  'org.feature.tasks.benefit': {
    ru: 'Регулярная задача на каждый отчёт и ручные поручения сотрудникам с контролем выполнения.',
    section: S,
  },
  'org.feature.calendar.benefit': {
    ru: 'Вкладка «Календарь» в «Отчетах для сдачи»: все сроки месяца по дням.',
    section: S,
  },
  'org.feature.fee.benefit': {
    ru: 'Журнал тарифов, начисления за обслуживание, должники и напоминание о долге.',
    section: S,
  },
  'org.feature.taxpay.benefit': {
    ru: 'Деньги от контрагента на налоги, сверка «хватает / недостача» и отметка оплаты в бюджет.',
    section: S,
  },
  'org.feature.accounts.benefit': {
    ru: 'Деньги контрагентов хранятся на счетах сотрудников, остаток можно списать в бонус.',
    section: S,
  },
  'org.feature.telegram.benefit': {
    ru: 'Напоминания о сроках за 7 и 3 дня и в день срока, о просрочках и еженедельная сводка.',
    section: S,
  },
  'org.feature.files.benefit': {
    ru: 'Отчёты, квитанции и документы в карточках и в «Файловом менеджере».',
    section: S,
  },
  'org.feature.finops.benefit': {
    ru: 'Единый журнал всех денег контрагентов и вкладка «Деньги» в карточке.',
    section: S,
  },
  'org.feature.projects.benefit': {
    ru: 'Разовые работы за отдельную плату: сроки, работы, транши, задачи.',
    section: S,
  },
  'org.feature.indicators.benefit': {
    ru: 'Помесячные показатели контрагентов: выручка, численность и свои, с итогами за период.',
    section: S,
  },
  'org.feature.cppage.benefit': {
    ru: 'Контрагент сам смотрит свои отчёты и сроки, показатели и оплату за обслуживание по ссылке с кодом — без входа в программу.',
    section: S,
  },
  'org.feature.needs': { ru: 'требует «{name}»', section: S },
  'org.feature.benefit_line': { ru: 'Что даёт: {text}', section: S },
  'org.feature.requires': { ru: 'Сначала включите «{name}»', section: S },
  'org.feature.required_by': {
    ru: 'Сначала отключите «{name}» — она работает только вместе с этой функцией',
    section: S,
  },
  'org.feature.on_title': { ru: 'Функция «{name}» включена', section: S },
  'org.feature.off': { ru: '{name}: отключено', section: S },
  'org.feature.later': { ru: 'Позже', section: S },
  'org.page.hint': {
    ru: 'Разделы страницы для всех контрагентов; у отдельного контрагента раздел можно скрыть в его карточке. «Ваш бухгалтер» видно всегда.',
    section: S,
  },
  'org.page.section.pay': { ru: 'Как оплатить', section: S },
  'org.page.section.reports': { ru: 'Отчёты', section: S },
  'org.page.section.money': { ru: 'Деньги на налоги', section: S },
  'org.page.section.fee': { ru: 'Оплата за обслуживание', section: S },
  'org.page.section.kpi': { ru: 'Показатели', section: S },
  'org.page.section.contacts': { ru: 'Контакты', section: S },
  'org.page.needs': {
    ru: 'Появится на странице, когда включена функция «{name}»',
    section: S,
  },
  'org.policy.tasks': { ru: 'Задачи', section: S },
  'org.policy.task_confirm': { ru: 'Задачи требуют подтверждения', section: S },
  'org.policy.task_confirm_hint': {
    ru: 'В новой задаче переключатель «Требуется подтверждение» сразу включён, постановщик может его снять. У уже поставленных задач признак не меняется.',
    section: S,
  },
  'org.policy.task_confirm_on': { ru: 'Новые задачи будут требовать подтверждения', section: S },
  'org.policy.task_confirm_off': {
    ru: 'Новые задачи закрываются сразу после «Выполнена»',
    section: S,
  },
  'org.policy.reports': { ru: 'Отчёты', section: S },
  'org.policy.report_confirm': { ru: 'Сдача отчётов требует подтверждения', section: S },
  'org.policy.report_confirm_hint': {
    ru: 'Отчёт, отмеченный «Сдан», ждёт подтверждения старшего бухгалтера — сотрудника с правом «Подтверждать сдачу отчётов»; тот подтверждает сдачу или возвращает отчёт «На исправление» с причиной. Если выключить, «Сдан» станет окончательной отметкой.',
    section: S,
  },
  'org.policy.report_confirm_on': { ru: 'Сданные отчёты будут ждать подтверждения', section: S },
  'org.policy.report_confirm_off': { ru: '«Сдан» теперь окончательная отметка', section: S },
  'org.policy.wait_days': { ru: 'Напомнить о неподтверждённой сдаче через, дней', section: S },
  'org.policy.wait_days_hint': {
    ru: 'Сотрудникам с правом «Подтверждать сдачу отчётов» — в Telegram',
    section: S,
  },
  'org.policy.pay_first': { ru: 'Сдача отчёта только после оплаты', section: S },
  'org.policy.pay_first_hint': {
    ru: 'У отчётов «Сдача + уплата» с суммой к уплате больше 0 «Сдан» ставится, когда налог оплачен полностью или частично: «Указать сумму» → «Принять деньги» → «Отметить оплаченным» → «Сдан». Если контрагент оплатил налог сам — «Оплатил контрагент сам» в окне оплаты.',
    section: S,
  },
  'org.policy.pay_first_on': { ru: '«Сдан» — только после оплаты налога', section: S },
  'org.policy.pay_first_off': { ru: '«Сдан» можно ставить до оплаты', section: S },
  'org.remind.title': { ru: 'Напоминания о сроках по умолчанию', section: S },
  'org.remind.day.one': { ru: 'за {n} день', section: S },
  'org.remind.day.few': { ru: 'за {n} дня', section: S },
  'org.remind.day.many': { ru: 'за {n} дней', section: S },
  'org.remind.remove': { ru: 'Убрать', section: S },
  'org.remind.add': { ru: '+ день', section: S },
  'org.remind.add_label': { ru: 'Добавить день напоминания', section: S },
  'org.remind.deadline': { ru: 'в день срока — всегда', section: S },
  'org.remind.hint': {
    ru: 'Этот набор получают новые подключённые виды отчётов. Для отдельного вида дни меняются в «Справочники → Виды отчётов». Отключить напоминание в день срока нельзя.',
    section: S,
  },
  'org.remind.saved': { ru: 'Набор дней сохранён', section: S },
  'org.history.title': { ru: 'История изменений учётной политики · {n}', section: S },
  'org.history.empty': { ru: 'Изменений пока не было', section: S },
  'org.history.created': { ru: 'Учётная политика по умолчанию', section: S },
  'org.history.feature_on': { ru: 'Включена функция «{name}»', section: S },
  'org.history.feature_off': { ru: 'Отключена функция «{name}»', section: S },
  'org.history.task_confirm': { ru: 'Задачи требуют подтверждения: {state}', section: S },
  'org.history.report_confirm': {
    ru: 'Сдача отчётов требует подтверждения: {state}',
    section: S,
  },
  'org.history.pay_first': { ru: 'Сдача отчёта только после оплаты: {state}', section: S },
  'org.history.on': { ru: 'включено', section: S },
  'org.history.off': { ru: 'выключено', section: S },
  'org.history.wait_days': {
    ru: 'Напоминание о неподтверждённой сдаче: через {n} дн.',
    section: S,
  },
  'org.history.remind_days': { ru: 'Дни напоминаний: за {days} дн.', section: S },
  'org.history.page_on': {
    ru: 'Страница контрагента: раздел «{name}» показывается',
    section: S,
  },
  'org.history.page_off': {
    ru: 'Страница контрагента: раздел «{name}» не показывается',
    section: S,
  },
  'org.history.reason': { ru: '{text} ({reason})', section: S },
  'org.history.system': { ru: 'Система', section: S },
  'org.settings.general': { ru: 'Общие', section: S },
  'org.settings.timezone': { ru: 'Часовой пояс', section: S },
  'org.settings.timezone_hint': { ru: '«Сегодня» и «эта неделя» считаются по нему', section: S },
  'org.settings.default_role': { ru: 'Роль по умолчанию для новых сотрудников', section: S },
  'org.settings.telegram': { ru: 'Напоминания в Telegram', section: S },
  'org.settings.overdue_repeat': { ru: 'Повторять при просрочке каждый день', section: S },
  'org.settings.overdue_repeat_hint': {
    ru: 'Ответственному, главному бухгалтеру и владельцу — пока отчёт не сдан',
    section: S,
  },
  'org.settings.digest': { ru: 'Еженедельная сводка, понедельник', section: S },
  'org.settings.digest_hint': {
    ru: 'Все напоминания одному человеку за день собираются в одно сообщение.',
    section: S,
  },
  'org.settings.telegram_off': {
    ru: 'Напоминания в Telegram отключены в учётной политике.',
    section: S,
  },
  'org.settings.save': { ru: 'Сохранить настройки', section: S },
  'org.settings.saved': { ru: 'Настройки сохранены', section: S },

  // Отказы сервера — тем же текстом, что у сервера.
  'err.name_required': { ru: ORG_PROFILE_MESSAGES.name_required, section: 'Ошибки' },
  'err.inn_invalid': { ru: ORG_PROFILE_MESSAGES.inn_invalid, section: 'Ошибки' },
  'err.inn_taken': { ru: ORG_PROFILE_MESSAGES.inn_taken, section: 'Ошибки' },
  'err.logo_too_large': { ru: ORG_PROFILE_MESSAGES.logo_too_large, section: 'Ошибки' },
  'err.logo_type': { ru: ORG_PROFILE_MESSAGES.logo_type, section: 'Ошибки' },
  'err.slug_invalid': { ru: SLUG_MESSAGES.slug_invalid, section: 'Ошибки' },
  'err.slug_reserved': { ru: SLUG_MESSAGES.slug_reserved, section: 'Ошибки' },
  'err.slug_taken': { ru: SLUG_MESSAGES.slug_taken, section: 'Ошибки' },
  'err.remind_days_invalid': { ru: REMIND_DAYS_MESSAGE, section: 'Ошибки' },
  'err.confirm_wait_days_invalid': { ru: CONFIRM_WAIT_DAYS_MESSAGE, section: 'Ошибки' },
  'err.default_role_owner': {
    ru: 'Роль владельца не бывает ролью по умолчанию',
    section: 'Ошибки',
  },
} as const satisfies Record<string, UiTextDefault>;

import type { UiTextDefault } from './texts';

/**
 * Тексты входа и «Мой профиль» (задача #13): страница входа, «Забыли пароль?» и ввод кода — прототип
 * core/login.js showLogin; «Мой профиль» — modules/profile.js profileDlg; смена временного пароля и
 * предложение привязать Telegram после неё — по ТЗ («при следующем входе система требует сменить его»,
 * «привязка предлагается при первом входе»), в прототипе этих шагов нет. Ключ `auth.forgot` — из
 * раздела `localization` refDB.json, с тем же текстом. `{min}` — наименьшая длина пароля, `{code}` —
 * число цифр кода, `{count}` и `{minutes}` — числа из правил входа (@buhuchet/domain).
 */
export const AUTH_TEXTS = {
  // Страница входа
  'auth.brand_mode': { ru: 'Автоматизация бухгалтерского аутсорсинга', section: 'Вход' },
  'auth.title': { ru: 'Вход', section: 'Вход' },
  'auth.login': { ru: 'Логин', section: 'Вход' },
  'auth.password': { ru: 'Пароль', section: 'Вход' },
  'auth.sign_in': { ru: 'Войти', section: 'Вход' },
  'auth.forgot': { ru: 'Забыли пароль?', section: 'Вход' },
  'auth.lock_warning': {
    ru: 'После {count} неверных попыток вход блокируется на {minutes} минут.',
    section: 'Вход',
  },

  // «Забыли пароль?»
  'auth.reset_title': { ru: 'Восстановление пароля', section: 'Вход' },
  'auth.reset_text': {
    ru: 'Введите логин. Бот пришлёт одноразовый код в привязанный Telegram. Код действует {minutes} минут.',
    section: 'Вход',
  },
  'auth.get_code': { ru: 'Получить код', section: 'Вход' },
  'auth.back': { ru: 'Вернуться ко входу', section: 'Вход' },
  'auth.code_title': { ru: 'Введите код', section: 'Вход' },
  'auth.code': { ru: 'Код из Telegram', section: 'Вход' },
  'auth.new_password': { ru: 'Новый пароль', section: 'Вход' },
  'auth.password_hint': { ru: 'Не короче {min} символов', section: 'Вход' },
  'auth.repeat_password': { ru: 'Повторите пароль', section: 'Вход' },
  'auth.change': { ru: 'Сменить пароль', section: 'Вход' },
  'auth.reset_note': {
    ru: 'После смены пароля все прежние сеансы завершатся, а бот сообщит о смене в Telegram.',
    section: 'Вход',
  },
  'auth.reset_done': { ru: 'Пароль изменён. Войдите с новым паролем.', section: 'Вход' },

  // Смена временного пароля и Telegram после неё
  'auth.temp_title': { ru: 'Смените временный пароль', section: 'Вход' },
  'auth.temp_text': {
    ru: 'Вы вошли с временным паролем. Придумайте свой: пока пароль не сменён, работать в программе нельзя.',
    section: 'Вход',
  },
  'auth.temp_password': { ru: 'Временный пароль', section: 'Вход' },
  'auth.tg_title': { ru: 'Привяжите Telegram', section: 'Вход' },
  'auth.tg_text': {
    ru: 'Бот будет напоминать о сроках отчётов и пришлёт код, если вы забудете пароль. Откройте ссылку в Telegram — бот привяжет чат и пришлёт подтверждение.',
    section: 'Вход',
  },
  'auth.later': { ru: 'Позже', section: 'Вход' },
  'auth.continue': { ru: 'Продолжить', section: 'Вход' },

  // Ошибки полей
  'auth.err.login': { ru: 'Введите логин', section: 'Вход' },
  'auth.err.password': { ru: 'Введите пароль', section: 'Вход' },
  'auth.err.current': { ru: 'Введите текущий пароль', section: 'Вход' },
  'auth.err.short': { ru: 'Пароль короче {min} символов', section: 'Вход' },
  'auth.err.mismatch': { ru: 'Пароли не совпадают', section: 'Вход' },
  'auth.err.code': { ru: 'Введите код из Telegram: {code} цифр', section: 'Вход' },
  'form.too_long': { ru: 'Слишком длинное значение', section: 'Формы' },
  // Ошибки ответа без своего текста: обрыв связи и непонятный ответ сервера (`err.<код>`, useErrorText).
  'err.network': {
    ru: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
    section: 'Ошибки',
  },
  'err.unknown': { ru: 'Не получилось. Попробуйте ещё раз.', section: 'Ошибки' },

  // «Мой профиль»
  'profile.title': { ru: 'Мой профиль', section: 'Профиль' },
  'profile.main': { ru: 'Основное', section: 'Профиль' },
  'profile.fio': { ru: 'ФИО', section: 'Профиль' },
  'profile.login': { ru: 'Логин', section: 'Профиль' },
  'profile.phone': { ru: 'Телефон', section: 'Профиль' },
  'profile.role': { ru: 'Роль', section: 'Профиль' },
  'profile.platform_admin': { ru: 'Администратор платформы', section: 'Профиль' },
  'profile.tg': { ru: 'Telegram для уведомлений', section: 'Профиль' },
  'profile.tg_linked': { ru: 'Привязан', section: 'Профиль' },
  'profile.tg_unlink': { ru: 'Отвязать', section: 'Профиль' },
  'profile.tg_missing': {
    ru: 'Telegram не привязан: напоминания не приходят, а восстановить пароль самостоятельно нельзя.',
    section: 'Профиль',
  },
  'profile.tg_copy': { ru: 'Скопировать ссылку', section: 'Профиль' },
  'profile.tg_copied': { ru: 'Ссылка скопирована', section: 'Профиль' },
  'profile.tg_hint': {
    ru: 'Ссылка одноразовая и действует {minutes} минут. Бот проверит её, привяжет чат и пришлёт подтверждение.',
    section: 'Профиль',
  },
  'profile.tg_done': { ru: 'Telegram привязан', section: 'Профиль' },
  'profile.tg_unlinked': { ru: 'Telegram отвязан', section: 'Профиль' },
  'profile.settings': { ru: 'Личные настройки', section: 'Профиль' },
  'profile.theme': { ru: 'Тема', section: 'Профиль' },
  'profile.theme_light': { ru: 'Светлая', section: 'Профиль' },
  'profile.theme_dark': { ru: 'Тёмная', section: 'Профиль' },
  'profile.password': { ru: 'Смена пароля', section: 'Профиль' },
  'profile.current_password': { ru: 'Текущий пароль', section: 'Профиль' },
  'profile.repeat': { ru: 'Повторите', section: 'Профиль' },
  'profile.password_changed': {
    ru: 'Пароль изменён. Другие сеансы завершены.',
    section: 'Профиль',
  },
  'btn.done': { ru: 'Готово', section: 'Кнопки' },
} as const satisfies Record<string, UiTextDefault>;

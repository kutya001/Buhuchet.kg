import type { UiTextDefault } from './texts';

const S = 'Приветствие';

/**
 * Тексты первого запуска организации (задача 2.33; прототип modules/onboard.js — wlRender, wlClick,
 * obApply, featOnDlg): окно приветствия, опросник, «Что будет включено», «Пройти опросник заново» и
 * запись «по опроснику» в истории учётной политики. Заголовки экранов, пояснения и вопросы — из
 * refDB.json `onboarding` (их правит Админка), здесь — только подписи окна.
 */
export const ONBOARDING_TEXTS = {
  'onboarding.label': { ru: 'Приветствие', section: S },
  'onboarding.position': { ru: '{n} из {total}', section: S },
  'onboarding.position_label': { ru: 'Экран {n} из {total}', section: S },
  'onboarding.later': { ru: 'Позже', section: S },
  'onboarding.later_title': {
    ru: 'Опросник можно пройти позже в учётной политике',
    section: S,
  },
  'onboarding.later_done': {
    ru: 'Опросник можно пройти позже: «Моя организация» → «Учётная политика»',
    section: S,
  },
  'onboarding.load_error': { ru: 'Не удалось открыть приветствие', section: S },
  'onboarding.prev': { ru: 'Назад', section: S },
  'onboarding.next': { ru: 'Далее', section: S },
  'onboarding.next_plan': { ru: 'Далее: что будет включено', section: S },
  'onboarding.next_taxes': { ru: 'Далее: выбор налогов', section: S },
  'onboarding.apply': { ru: 'Применить', section: S },
  'onboarding.self': { ru: 'Осмотреться самому', section: S },
  'onboarding.learn': { ru: 'Начать обучение', section: S },
  // Экран 1: картинка интерфейса
  'onboarding.pic.label': { ru: 'Как выглядит программа', section: S },
  'onboarding.pic.title': { ru: 'Отчеты для сдачи', section: S },
  'onboarding.pic.week': { ru: 'На неделе', section: S },
  'onboarding.pic.overdue': { ru: 'Просрочено', section: S },
  'onboarding.pic.add': { ru: '+ Добавить', section: S },
  'onboarding.pic.plate_overdue': { ru: 'Просрочено', section: S },
  'onboarding.pic.plate_week': { ru: 'На этой неделе', section: S },
  'onboarding.pic.plate_wait': { ru: 'Ожидают подтверждения', section: S },
  'onboarding.pic.row1.type': { ru: 'НДС', section: S },
  'onboarding.pic.row1.cp': { ru: 'ОсОО «Ала-Тоо»', section: S },
  'onboarding.pic.row1.status': { ru: 'К сдаче', section: S },
  'onboarding.pic.row2.type': { ru: 'Единый налог', section: S },
  'onboarding.pic.row2.cp': { ru: 'ИП Асанов', section: S },
  'onboarding.pic.row2.status': { ru: 'Сдан', section: S },
  'onboarding.pic.row3.type': { ru: 'Соцфонд', section: S },
  'onboarding.pic.row3.cp': { ru: 'ОсОО «Бектур»', section: S },
  'onboarding.pic.row3.status': { ru: 'Подтверждено', section: S },
  'onboarding.pic.caption': {
    ru: 'Слева — модули, сверху — вкладки и «+ Добавить», плашки — быстрые фильтры, ниже — список',
    section: S,
  },
  // Экран 2: модули и функции
  'onboarding.mods.always': { ru: 'Включён всегда', section: S },
  'onboarding.mods.can_on': { ru: 'Можно включить', section: S },
  'onboarding.mods.on': { ru: 'Включён · можно выключить', section: S },
  'onboarding.mods.features': { ru: 'Функции внутри модулей', section: S },
  'onboarding.fx.on': { ru: 'Включена', section: S },
  // Экран 3: опросник
  'onboarding.answer': { ru: 'Ответ', section: S },
  'onboarding.answer.yes': { ru: 'Да', section: S },
  'onboarding.answer.no': { ru: 'Нет', section: S },
  'onboarding.answer.unk': { ru: 'Не знаю', section: S },
  // Экран 4: что будет включено
  'onboarding.plan.on': { ru: 'Будет включено · {n}', section: S },
  'onboarding.plan.off': { ru: 'Не включено · {n}', section: S },
  'onboarding.plan.on_empty': { ru: 'Ничего, кроме основных модулей', section: S },
  'onboarding.plan.off_empty': { ru: 'Всё включено', section: S },
  'onboarding.plan.task_confirm_hint': {
    ru: 'Выполненную задачу проверяет постановщик или сотрудник с правом «Подтверждать задачи»',
    section: S,
  },
  'onboarding.plan.note': {
    ru: 'Всегда включены: {list}. Всё остальное можно включить или выключить позже в «Моя организация» → «Учётная политика»; данные при выключении не удаляются.',
    section: S,
  },
  // Экран 5: с чего начать
  'onboarding.start.all_done': { ru: 'Все основные шаги уже выполнены', section: S },
  'onboarding.start.all_done_text': {
    ru: 'Загляните в «Базу знаний», чтобы пройти остальные уроки.',
    section: S,
  },
  // Экран 6: выбор налогов
  'onboarding.tax.selected': { ru: 'Выбрано:', section: S },
  'onboarding.tax.skip': { ru: 'Пропустить', section: S },
  'onboarding.tax.self': { ru: 'Подключить и осмотреться', section: S },
  'onboarding.tax.learn': { ru: 'Подключить и начать обучение', section: S },
  'onboarding.tax.skipped': {
    ru: 'Налоги можно выбрать позже: «Справочники» → «Виды отчётов» → «Подключить из каталога»',
    section: S,
  },
  'onboarding.tax.done': { ru: 'Подключено видов отчётов: {n}', section: S },
  // «Пройти опросник заново» в учётной политике
  'onboarding.quiz': { ru: 'Пройти опросник', section: S },
  'onboarding.quiz_again': { ru: 'Пройти опросник заново', section: S },
  'onboarding.quiz_title': {
    ru: 'Вопросы о том, как вы работаете: по ответам включатся нужные модули',
    section: S,
  },
  'onboarding.retake.same': { ru: 'Изменений нет: учётная политика не изменилась', section: S },
  'onboarding.retake.updated': { ru: 'Учётная политика обновлена по опроснику', section: S },
  'onboarding.feat_on.title_many': { ru: 'Включено функций: {n}', section: S },
  'onboarding.feat_on.text_many': {
    ru: 'Уроки по этим функциям появились в «Базе знаний» у всех сотрудников с отметкой «Новое».',
    section: S,
  },
  // «База знаний» → «Мой уровень»
  'onboarding.kb.title': { ru: 'Приветствие и обзор модулей', section: S },
  'onboarding.kb.hint': {
    ru: 'Что это за программа, какие в ней модули и с чего начать',
    section: S,
  },
  'onboarding.kb.open': { ru: 'Открыть', section: S },
  // Запись «по опроснику» в истории учётной политики
  'onboarding.history.first': { ru: 'Учётная политика по опроснику: {text}', section: S },
  'onboarding.history.again': {
    ru: 'Учётная политика по опроснику (пройден заново): {text}',
    section: S,
  },
  'onboarding.history.name': { ru: '«{name}»', section: S },
  'onboarding.history.on': { ru: 'включены {list}', section: S },
  'onboarding.history.off': { ru: 'выключены {list}', section: S },
  'onboarding.history.task_confirm': {
    ru: '«Задачи требуют подтверждения»: {state}',
    section: S,
  },
  'onboarding.history.same': { ru: 'без изменений', section: S },
} as const satisfies Record<string, UiTextDefault>;

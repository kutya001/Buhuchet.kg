import type { UiTextDefault } from './texts';

const S = 'Главная';
const A = 'Главная: аналитика';

/**
 * Тексты модуля «Главная» (задача 2.34; прототип modules/home.js — `renderHome`, modules/analytics.js —
 * `renderAnalytics`, `monthChart`, `shareChart`). Число контрагентов — `cp.count.*`, дни недели —
 * `pdicts.cal.dow.*`, месяцы — `rule.month_gen.*` и `report.month.*`.
 */
export const HOME_TEXTS = {
  // «Сводка»: строка приветствия
  'home.hello.today': { ru: 'Сегодня', section: S },
  'home.hello.date': { ru: '{d} {month}, {dow}', section: S },
  'home.hello.all': { ru: 'Вы видите всю организацию', section: S },
  'home.hello.own': { ru: 'Вы видите только своих контрагентов и свои отчёты', section: S },
  'home.hello.week': { ru: 'неделя {from}–{to}', section: S },
  'home.hello.weekend': {
    ru: '(сегодня выходной, показана ближайшая рабочая неделя)',
    section: S,
  },
  'home.load_error': { ru: 'Не удалось загрузить сводку', section: S },
  // Организация без контрагентов
  'home.empty.text': {
    ru: 'Добавьте контрагентов, чтобы здесь появились сроки и суммы.',
    section: S,
  },
  'home.empty.go': { ru: 'Перейти к контрагентам', section: S },
  // Плашки
  'home.plate.ovr': { ru: 'Просрочено отчётов', section: S },
  'home.plate.ovr_sub': { ru: 'срок прошёл, отчёт не сдан', section: S },
  'home.plate.ovr_none': { ru: 'всё сдано в срок', section: S },
  'home.plate.ovp': { ru: 'Просрочено оплат', section: S },
  'home.plate.ovp_sub': { ru: '{amount} не оплачено', section: S },
  'home.plate.ovp_none': { ru: 'долгов в бюджет нет', section: S },
  'home.plate.wks': { ru: 'Сдать на этой неделе', section: S },
  'home.plate.wks_sub': { ru: 'до {date}', section: S },
  'home.plate.wkp': { ru: 'Оплатить на этой неделе', section: S },
  'home.plate.wait': { ru: 'Ожидают подтверждения', section: S },
  'home.plate.wait_mine': { ru: 'сданы, ждут вашего подтверждения', section: S },
  'home.plate.wait_sub': { ru: 'сданы, ждут старшего бухгалтера', section: S },
  'home.plate.tpend': { ru: 'Ждут подтверждения', section: S },
  'home.plate.tpend_sub': { ru: 'выполненные задачи сотрудников', section: S },
  'home.plate.tpend_none': { ru: 'подтверждать нечего', section: S },
  'home.plate.kmiss': { ru: 'Не заполнены показатели', section: S },
  'home.plate.kmiss_over': { ru: 'контрагентов, есть просроченные месяцы', section: S },
  'home.plate.kmiss_soon': { ru: 'контрагентов, срок ещё не прошёл', section: S },
  'home.plate.kmiss_none': { ru: 'всё внесено', section: S },
  'home.plate.tsk': { ru: 'Мои задачи на сегодня', section: S },
  'home.plate.tsk_over': { ru: '{n} просрочено', section: S },
  'home.plate.tsk_sub': { ru: 'включая просроченные', section: S },
  // Блоки под плашками
  'home.upcoming.title': { ru: 'Ближайшие сроки сдачи', section: S },
  'home.upcoming.all': { ru: 'Все отчёты', section: S },
  'home.upcoming.empty': { ru: 'Несданных отчётов нет.', section: S },
  'home.upcoming.no_resp': { ru: 'нет ответственного', section: S },
  'home.upcoming.overdue': { ru: 'просрочен', section: S },
  'home.progress.title': { ru: 'Отчёты со сроком в этом месяце: сдано', section: S },
  'home.progress.n': { ru: '{done} из {all}', section: S },
  'home.progress.empty': { ru: 'Нет отчётов со сроком в этом месяце.', section: S },
  'home.tasks.title': { ru: 'Мои задачи на сегодня', section: S },
  'home.tasks.overdue': { ru: 'просрочена', section: S },
  'home.debtors.title': { ru: 'Должники по обслуживанию', section: S },
  'home.debtors.open': { ru: 'Открыть список', section: S },

  // «Аналитика»
  'home.an.intro': {
    ru: 'Выручка организации — оплаты от контрагентов за обслуживание, проекты и разовые услуги (в том числе от разовых контрагентов). Налоги контрагентов сюда не входят.',
    section: A,
  },
  'home.an.year': { ru: '{y} год', section: A },
  'home.an.year_label': { ru: 'Год', section: A },
  'home.an.compare': { ru: 'Сравнить с {y}', section: A },
  'home.an.load_error': { ru: 'Не удалось загрузить аналитику', section: A },
  'home.an.plate.ch': { ru: 'Начислено за обслуживание', section: A },
  'home.an.plate.ch_sub': { ru: 'оплачено {p} %', section: A },
  'home.an.plate.total': { ru: 'Выручка за {y}', section: A },
  'home.an.plate.total_ytd': { ru: 'Выручка за {y} (с начала года)', section: A },
  'home.an.plate.change': { ru: '{ch} % к тому же периоду {y}', section: A },
  'home.an.plate.share': { ru: '{p} % выручки', section: A },
  'home.an.plate.debt': { ru: 'Долг сейчас', section: A },
  'home.an.plate.debt_sub': { ru: 'обслуживание и разовые услуги', section: A },
  'home.an.kind.fee': { ru: 'Обслуживание', section: A },
  'home.an.kind.proj': { ru: 'Проекты', section: A },
  'home.an.kind.svc': { ru: 'Разовые услуги', section: A },
  'home.an.som': { ru: 'сом', section: A },
  'home.an.mln': { ru: '{n} млн', section: A },
  'home.an.k': { ru: '{n} тыс.', section: A },
  // График выручки по месяцам
  'home.an.months': { ru: 'Выручка по месяцам', section: A },
  'home.an.bar': { ru: '{month}: {kind} {amount}', section: A },
  'home.an.bar_prev': { ru: '{month} прошлого года: {amount}', section: A },
  'home.an.bar_total': { ru: '{month}: всего {amount}', section: A },
  'home.an.bar_total_cmp': { ru: '{month}: всего {amount}, год назад {prev}', section: A },
  'home.an.empty': { ru: 'Данные появятся после первых начислений', section: A },
  'home.an.empty_chart': { ru: 'Пустой график', section: A },
  // «Топ-10» и «Концентрация»
  'home.an.top': { ru: 'Топ-10 контрагентов по выручке', section: A },
  'home.an.top_empty': { ru: 'Нет поступлений за год', section: A },
  'home.an.top_hint': { ru: 'Нажмите на контрагента, чтобы открыть его операции.', section: A },
  'home.an.conc': { ru: 'Концентрация', section: A },
  'home.an.conc.paid': { ru: 'Платили в {y}', section: A },
  'home.an.conc.top5': { ru: 'Доля топ-5', section: A },
  'home.an.conc.avg': { ru: 'Средний чек за год', section: A },
  'home.an.conc.debt': { ru: 'Долг за обслуживание сейчас', section: A },
  // Список контрагентов
  'home.an.col.cp': { ru: 'Контрагент', section: A },
  'home.an.col.resp': { ru: 'Ответственный', section: A },
  'home.an.col.kind': { ru: 'Тип', section: A },
  'home.an.col.fee_ch': { ru: 'Начислено за обслуживание', section: A },
  'home.an.col.fee': { ru: 'Оплачено за обслуживание', section: A },
  'home.an.col.proj': { ru: 'Проекты', section: A },
  'home.an.col.svc': { ru: 'Разовые услуги', section: A },
  'home.an.col.total': { ru: 'Итого получено', section: A },
  'home.an.col.debt': { ru: 'Долг', section: A },
  'home.an.col.share': { ru: 'Доля', section: A },
  'home.an.col.change': { ru: 'Изменение', section: A },
  'home.an.kind.oneoff': { ru: 'Разовое', section: A },
  'home.an.kind.regular': { ru: 'Постоянное', section: A },
  'home.an.ops': { ru: 'Операции контрагента', section: A },
  'home.an.card': { ru: 'Карточка контрагента', section: A },
} as const satisfies Record<string, UiTextDefault>;

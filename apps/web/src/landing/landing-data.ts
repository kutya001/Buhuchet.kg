import { addDays, type StatusTone } from '@buhuchet/domain';
import type { IconName } from '@buhuchet/ui';
import data from './landing-data.json';

/*
 * Картинки лендинга из spec/ (scripts/landing-data.mjs → landing-data.json): выборка demoDB.json для
 * уменьшенных экранов программы, как `landDemo` прототипа, и номер версии платформы для подвала. Контрагенты и суммы на картинках выдуманные
 * (демо-организация), реальных данных на лендинге нет (ТЗ «Лендинг» → «Общий вид»). Числа полосы цифр
 * и коды стран формы — из действующих справочников (`landingDicts`, `@buhuchet/api/web`).
 */

/**
 * Отчёт демо-организации: контрагент, вид, срок, статус, к уплате (сом), период, дата сдачи и состояние
 * для плиток (`open` — ещё не сдан, `done` — сдан; считает scripts/landing-data.mjs).
 */
type DemoReportRow = [
  number,
  string,
  string,
  string,
  number | null,
  string,
  string | null,
  'open' | 'done' | '',
];

interface DemoContractor {
  name: string;
  inn: string;
  regime: string;
  head: string;
  start: string | null;
  resp: string | null;
}

interface LandingData {
  /** Номер версии прототипа, с которым сверена копия spec/ («91»). */
  version: string;
  demo: {
    contractors: Record<string, DemoContractor>;
    employees: Record<string, string>;
    types: Record<string, string>;
    statusLook: Record<string, [string, string]>;
    reports: DemoReportRow[];
  };
}

const DATA = data as unknown as LandingData;

/**
 * Версия платформы для подвала лендинга (прототип v91: «Версия N» без даты): номер версии прототипа, с
 * которым сверена копия spec/ (docs/deviations.md п. И-2).
 */
export const LANDING_VERSION = DATA.version;

export interface DemoReport {
  contractor: string;
  type: string;
  due: string;
  status: { label: string; tone: StatusTone; icon: IconName };
  /** К уплате, сом; null — «—». */
  sum: number | null;
  period: string;
}

export interface DemoScreens {
  /** До 6 строк таблицы: последние 2 просроченных (не старше 30 дней) и ближайшие по сроку. */
  rows: DemoReport[];
  overdue: number;
  week: number;
  done: number;
  /** Карточка контрагента: первый контрагент демо-организации и его последние 5 отчётов. */
  card: {
    name: string;
    regime: string;
    inn: string;
    resp: string;
    head: string;
    start: string | null;
    reports: DemoReport[];
  } | null;
}

function report(row: DemoReportRow): DemoReport {
  const [cp, t, due, status, sum, period] = row;
  const [tone, icon] = DATA.demo.statusLook[status] ?? ['gray', 'circle'];
  return {
    contractor: DATA.demo.contractors[String(cp)]?.name ?? '',
    type: DATA.demo.types[t] ?? t,
    due,
    status: { label: status, tone: tone as StatusTone, icon: icon as IconName },
    sum,
    period,
  };
}

/**
 * Картинки — у сроков рядом с сегодняшним днём (прототип landDemo): плитки «Просрочено» (за последние
 * 30 дней), «На этой неделе», «Сдано за 30 дней» и таблица отчётов.
 */
export function demoScreens(today: string): DemoScreens {
  const all = DATA.demo.reports;
  const open = all.filter((r) => r[7] === 'open').sort((a, b) => (a[2] < b[2] ? -1 : 1));
  const week = addDays(today, 7);
  const monthAgo = addDays(today, -30);
  const late = open.filter((r) => r[2] < today && r[2] >= monthAgo);
  const next = open.filter((r) => r[2] >= today);
  const done = all.filter(
    (r) => r[7] === 'done' && (r[6] ?? '') >= monthAgo && (r[6] ?? '') <= today,
  ).length;
  const first = DATA.demo.contractors['1'] ?? Object.values(DATA.demo.contractors)[0];
  const firstId = DATA.demo.contractors['1']
    ? 1
    : Number(Object.keys(DATA.demo.contractors)[0] ?? 0);
  return {
    rows: [...late.slice(-2), ...next].slice(0, 6).map(report),
    overdue: late.length,
    week: next.filter((r) => r[2] <= week).length,
    done,
    card: first
      ? {
          name: first.name,
          regime: first.regime,
          inn: first.inn,
          resp: (first.resp && DATA.demo.employees[first.resp]) || '',
          head: first.head,
          start: first.start,
          reports: all
            .filter((r) => r[0] === firstId)
            .sort((a, b) => (a[2] < b[2] ? 1 : -1))
            .slice(0, 5)
            .map(report),
        }
      : null,
  };
}

import {
  AssignmentEndedError,
  AssignmentExistsError,
  ContractorArchivedError,
  ContractorOneOffError,
  contractorScope,
  ReportExistsError,
  ReportRefusedError,
  reportScope,
  ReportStateError,
  type AssignmentTexts,
  type ListTexts,
} from '@buhuchet/db';
import { REPORT_MESSAGES, scopeOf, type AccessSubject } from '@buhuchet/domain';
import { ApiError } from '@buhuchet/shared';
import type { SQL } from 'drizzle-orm';
import { apiFail } from '../../errors';

export const error = { 'application/json': { schema: ApiError } };

/** Сотрудник области «Свои» группы «Отчеты для сдачи» или null — вся организация. */
export const ownReportsEmployeeOf = (subject: AccessSubject): string | null =>
  scopeOf(subject, 'reports') === 'own' ? subject.employeeId : null;

/**
 * Область над отчётами (список, карточка, «Изменить срок», «Создать уточнённый»): свои контрагенты и
 * отчёты, где сотрудник ответственный (docs/deviations.md п. А-2, решение В).
 */
export const reportScopeOf = (subject: AccessSubject): SQL | undefined =>
  reportScope(ownReportsEmployeeOf(subject));

/** Область над контрагентом (назначения, «Разовый отчёт»): только свои контрагенты. */
export const assigneeScopeOf = (subject: AccessSubject): SQL | undefined =>
  contractorScope(ownReportsEmployeeOf(subject));

/** Причины, которые система пишет в «Историю статусов» при назначениях. */
export function assignmentTexts(t: ListTexts): AssignmentTexts {
  return {
    ended: t('report.reason.ended'),
    restored: t('report.reason.restored'),
    until: t('report.reason.until'),
    past: t('report.reason.past'),
    pastMarked: t('report.reason.past_marked'),
    pastConfirmed: t('report.reason.past_confirmed'),
    pastConfirmNote: t('report.note.past_marked'),
    ownRuleChanged: t('report.reason.own_rule_changed'),
  };
}

const STATE_CODE = {
  not_open: 'report_not_open',
  not_submitted: 'report_not_submitted',
  superseded: 'report_superseded',
  pay_only: 'report_pay_only',
} as const;

/**
 * Отказы слоя данных — ответом API: 409 со своим кодом и текстом. Устаревшая версия
 * (`AssignmentChangedError`, `ReportChangedError` — это `RecordChangedError`) и «не найден» отвечает
 * общий обработчик.
 */
export async function withReportErrors<T>(
  run: () => Promise<T>,
  options: { eventDate?: boolean } = {},
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof AssignmentExistsError) {
      apiFail(409, 'assignment_exists', REPORT_MESSAGES.assignment_exists, {
        field: 'reportTypeCode',
      });
    }
    if (e instanceof AssignmentEndedError) {
      apiFail(409, 'assignment_ended', REPORT_MESSAGES.assignment_ended);
    }
    if (e instanceof ContractorArchivedError) {
      apiFail(409, 'contractor_archived', REPORT_MESSAGES.contractor_archived);
    }
    if (e instanceof ContractorOneOffError) {
      apiFail(409, 'contractor_oneoff', REPORT_MESSAGES.contractor_oneoff);
    }
    if (e instanceof ReportExistsError) {
      const code = options.eventDate ? 'report_event_exists' : 'report_exists';
      apiFail(409, code, REPORT_MESSAGES[code], {
        field: options.eventDate ? 'eventDate' : 'month',
      });
    }
    if (e instanceof ReportStateError) {
      const code = STATE_CODE[e.reason];
      apiFail(409, code, REPORT_MESSAGES[code]);
    }
    if (e instanceof ReportRefusedError) {
      apiFail(e.status, e.code, REPORT_MESSAGES[e.code], e.field ? { field: e.field } : undefined);
    }
    throw e;
  }
}

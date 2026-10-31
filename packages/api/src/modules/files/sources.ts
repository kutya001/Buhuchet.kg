import {
  contractorFilesPart,
  fileContractor,
  indicatorFilesPart,
  manualFilesPart,
  moneyFileSource,
  moneyFilesPart,
  reportFilesPart,
  taskFilesPart,
  type FileListPart,
  type ListTexts,
  type Tx,
} from '@buhuchet/db';
import {
  canSeeContractor,
  hasPermission,
  type AccessSubject,
  type Feature,
  type FileSourceKind,
  type HistoryEntity,
} from '@buhuchet/domain';
import { scopeSqlOf } from '../contractors/common';
import { feePaymentFiles } from '../fees/files';
import { operationFiles } from '../finance/files';
import { indicatorValueSource } from '../kpi/card';
import { kpiScopeOf } from '../kpi/common';
import { finScopeOf } from '../money/common';
import { reportScopeOf } from '../reports/common';
import { reportFileSource } from '../reports/files';
import { taskAccessOf } from '../tasks/common';
import { taskFileSource } from '../tasks/files';

/** Куда пишется история «Прикреплён файл» и «Удалён файл»: запись-источник и её контрагент. */
export interface FileHistoryTarget {
  entity: HistoryEntity;
  entityId: string;
  contractorId: string | null;
}

/** Запись-источник файлов глазами сотрудника. */
export interface FileSourceRecord {
  /**
   * Контрагент записи — для области «Свои контрагенты» группы «Файловый менеджер»; null — общий файл
   * организации (его видят все с правом «Просматривать файлы»).
   */
  contractor: { id: string; responsibleEmployeeId: string | null } | null;
  /**
   * Может ли сотрудник прикреплять и удалять файлы этой записи по правам её модуля (задача — её
   * исполнитель, проект — «Вести проекты» и т. п.; запись в архиве — нет). Права группы «Файловый
   * менеджер» проверяет модуль файлов сам.
   */
  editable: boolean;
  /** История записи: файл с номером `fileId` прикреплён или удалён. */
  history(fileId: string): FileHistoryTarget;
}

/**
 * Источник файлов — модуль, у записей которого есть блок «Файлы». `resolve` загружает запись в
 * транзакции организации (RLS) с условием области её модуля и отвечает null, если сотрудник её не
 * видит (тогда и файлов записи он не видит: 404). `id` — номер записи из запроса, у источника без
 * записей — null; `own` — контрагент, к которому привязан сам файл (у файла без записи).
 */
export interface FileSource {
  /**
   * Файлы источника появляются только своим методом модуля (документы «Из свидетельства и выписки»
   * прикрепляет создание контрагента), а не общей загрузкой `POST /files/uploads`.
   */
  ownUpload?: true;
  resolve(
    tx: Tx,
    subject: AccessSubject,
    id: string | null,
    own?: { contractorId: string | null },
  ): Promise<FileSourceRecord | null>;
}

/** Кто смотрит Файловый менеджер: права, функции учётной политики и тексты словаря. */
export interface FileListContext {
  subject: AccessSubject;
  features: Readonly<Record<Feature, boolean>>;
  t: ListTexts;
}

/**
 * Источник в «Файловом менеджере» (задача 2.29): `list` — какие файлы этого вида сотрудник видит в
 * списке (то же условие, что у `resolve`, но в SQL над `files`) и что написать в «Источнике»; null —
 * ни одного (модуль выключен в учётной политике или нет права его смотреть).
 */
export interface FileListSource extends FileSource {
  list(ctx: FileListContext): FileListPart | null;
}

/**
 * «Загружен вручную» (Файловый менеджер, задача 2.29): файл без записи — общий файл организации или
 * файл контрагента (`own`, необязательно): тогда он в области «Свои контрагенты» и в истории
 * контрагента; к контрагенту в архиве файлы не загружаются и не удаляются. История пишется у самого
 * файла (с контрагентом).
 */
export const manualSource: FileListSource = {
  async resolve(tx, _subject, id, own) {
    if (id !== null) return null;
    const contractorId = own?.contractorId ?? null;
    if (!contractorId) {
      return {
        contractor: null,
        editable: true,
        history: (fileId) => ({ entity: 'file', entityId: fileId, contractorId: null }),
      };
    }
    const contractor = await fileContractor(tx, contractorId);
    if (!contractor) return null;
    return {
      contractor: { id: contractor.id, responsibleEmployeeId: contractor.responsibleEmployeeId },
      editable: !contractor.archived,
      history: (fileId) => ({ entity: 'file', entityId: fileId, contractorId: contractor.id }),
    };
  },
  list: ({ t }) => manualFilesPart(t),
};

/**
 * «Контрагент» (задача 2.17; прототип `allFiles`: вид «Контрагент», источник «Из свидетельства и
 * выписки»): свидетельство и выписка, прикреплённые к контрагенту при создании из документов. Запись —
 * сам контрагент: номер из запроса или контрагент файла (у прикреплённых при создании номера записи
 * нет); к контрагенту в архиве файлы не прикрепляются и не удаляются. История — у файла с
 * контрагентом, как у загруженного вручную.
 */
export const contractorSource: FileListSource = {
  ownUpload: true,
  async resolve(tx, _subject, id, own) {
    const contractorId = id ?? own?.contractorId ?? null;
    if (!contractorId) return null;
    const contractor = await fileContractor(tx, contractorId);
    if (!contractor) return null;
    return {
      contractor: { id: contractor.id, responsibleEmployeeId: contractor.responsibleEmployeeId },
      editable: !contractor.archived,
      history: (fileId) => ({ entity: 'file', entityId: fileId, contractorId: contractor.id }),
    };
  },
  list: ({ t }) => contractorFilesPart(t),
};

/** Файлы отчётов в списке: право «Просматривать отчёты»; видны отчёты области «Свои». */
function reportFilesList({ subject, t }: FileListContext): FileListPart | null {
  return hasPermission(subject, 'repView') ? reportFilesPart(reportScopeOf(subject), t) : null;
}

/** Файлы задач в списке: модуль «Задачи» включён; видны задачи, которые сотрудник может открыть. */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-9 — в прототипе видны файлы всех задач контрагентов области.
function taskFilesList({ subject, features }: FileListContext): FileListPart | null {
  return features.tasks ? taskFilesPart(taskAccessOf(subject)) : null;
}

/**
 * Файлы значений показателей в списке: функция «Показатели контрагентов» включена, есть право их
 * смотреть; видны значения контрагентов в области группы «Показатели контрагентов».
 */
function indicatorFilesList({ subject, features, t }: FileListContext): FileListPart | null {
  if (!features.indicators || !hasPermission(subject, 'kpiView')) return null;
  return indicatorFilesPart(kpiScopeOf(subject), t);
}

/**
 * Файлы денег по отчётам (задача 2.19): скрин перевода к поступлению и платёжное поручение к оплате
 * налога. Видны при включённом «Учёте оплаты налогов» с правом «Учёт денег» по контрагентам области
 * группы «Финансовые операции»; прикреплять и удалять — пока операция не отменена и контрагент не в
 * архиве. История — у поступления; у оплаты — у отчёта (как «Прикреплён файл» в карточке отчёта).
 * Поступление только за обслуживание и его сумму целиком видит только тот, кто видит плату по этому
 * контрагенту (задача 2.21, docs/deviations.md п. В-19).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-19
function moneySource(kind: 'receipt' | 'tax_payment'): FileListSource {
  return {
    async resolve(tx, subject, id) {
      if (id === null || !hasPermission(subject, 'money')) return null;
      const row = await moneyFileSource(tx, id, kind, finScopeOf(subject));
      if (!row?.taxpay || !canSeeContractor(subject, 'fin', row.contractor)) return null;
      const feeSeen =
        row.feeOn &&
        hasPermission(subject, 'fee') &&
        canSeeContractor(subject, 'cps', row.contractor);
      if (row.feeOnly && !feeSeen) return null;
      const contractor = {
        id: row.contractor.id,
        responsibleEmployeeId: row.contractor.responsibleEmployeeId,
      };
      return {
        contractor,
        editable: !row.contractor.archived && !row.cancelled,
        history: () =>
          kind === 'tax_payment' && row.reportId
            ? { entity: 'report' as const, entityId: row.reportId, contractorId: contractor.id }
            : { entity: 'money_operation' as const, entityId: id, contractorId: contractor.id },
      };
    },
    list: ({ subject, features, t }) =>
      features.taxpay && hasPermission(subject, 'money')
        ? moneyFilesPart(
            kind,
            finScopeOf(subject),
            t,
            features.fee && hasPermission(subject, 'fee') ? { scope: scopeSqlOf(subject) } : null,
          )
        : null,
  };
}

/**
 * Источники файлов по видам (`FILE_SOURCE_KINDS` из @buhuchet/domain). Модуль с блоком «Файлы» добавляет
 * свою строку (по порядку модулей ТЗ) и вид в домене. Файлы платы за обслуживание видит только право
 * «Видеть плату за обслуживание» — это проверяет `resolve` модуля обслуживания (ТЗ «Файловый менеджер»;
 * `fees/files.ts`).
 */
export const FILE_SOURCES: Readonly<Record<FileSourceKind, FileListSource>> = {
  manual: manualSource,
  contractor: contractorSource,
  report: { ...reportFileSource, list: reportFilesList },
  receipt: moneySource('receipt'),
  tax_payment: moneySource('tax_payment'),
  fee_payment: feePaymentFiles,
  money_operation: operationFiles,
  task: { ...taskFileSource, list: taskFilesList },
  indicator_value: { ...indicatorValueSource, list: indicatorFilesList },
};

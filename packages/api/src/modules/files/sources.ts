import type { Tx } from '@buhuchet/db';
import type { AccessSubject, FileSourceKind, HistoryEntity } from '@buhuchet/domain';
import { indicatorValueSource } from '../kpi/card';
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
   * Может ли сотрудник прикреплять и удалять файлы этой записи по правам её модуля (отчёт — «Менять
   * статус отчёта», проект — «Вести проекты» и т. п.; запись в архиве — нет). Права группы «Файловый
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
 * записей — null.
 */
export interface FileSource {
  resolve(tx: Tx, subject: AccessSubject, id: string | null): Promise<FileSourceRecord | null>;
}

/**
 * «Загружен вручную» (Файловый менеджер): файл без записи, общий файл организации. Номера записи нет;
 * история пишется у самого файла. Привязку к контрагенту добавит Файловый менеджер (задача 2.29).
 */
export const manualSource: FileSource = {
  async resolve(_tx, _subject, id) {
    if (id !== null) return null;
    return {
      contractor: null,
      editable: true,
      history: (fileId) => ({ entity: 'file', entityId: fileId, contractorId: null }),
    };
  },
};

/**
 * Источники файлов по видам (`FILE_SOURCE_KINDS` из @buhuchet/domain). Модуль с блоком «Файлы» добавляет
 * свою строку (по порядку модулей ТЗ) и вид в домене. Файлы платы за обслуживание видит только право
 * «Видеть плату за обслуживание» — это проверяет `resolve` модуля обслуживания (ТЗ «Файловый менеджер»).
 */
export const FILE_SOURCES: Readonly<Record<FileSourceKind, FileSource>> = {
  manual: manualSource,
  task: taskFileSource,
  indicator_value: indicatorValueSource,
};

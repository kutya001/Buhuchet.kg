import * as XLSX from 'xlsx';
import { DOCUMENT_TYPES, DOCUMENT_STATUSES } from '@/types/document.types';
import type { Document, Counterparty, DocumentType, DocumentStatus } from '@/types/database.types';
import type { Export1CRow } from '@/types/export.types';

type FullDocForExport = Document & {
  counterparties?: Counterparty | null;
};

export function exportTo1CExcel(
  documents: FullDocForExport[],
  companyName: string
) {
  const rows: Export1CRow[] = [];

  documents.forEach((doc) => {
    const typeLabel = DOCUMENT_TYPES[doc.doc_type as DocumentType]?.label || doc.doc_type;
    const statusLabel = DOCUMENT_STATUSES[doc.status as DocumentStatus]?.label || doc.status;
    const counterpartyName = doc.counterparties?.name || '—';
    const counterpartyInn = doc.counterparties?.inn || '—';
    const vatPayerText = doc.counterparties?.is_vat_payer ? 'Плательщик НДС (12%)' : 'Без НДС';

    rows.push({
      'Дата Документа': doc.doc_date,
      'Номер Документа': doc.doc_number || '—',
      'Тип Операции': typeLabel,
      'ИНН Контрагента': counterpartyInn,
      'Наименование Контрагента': counterpartyName,
      'Товар / Услуга': doc.comment || 'Финансовая операция',
      'Кол-во': 1,
      'Ед. изм.': 'услуга',
      'Цена (сом)': Number(doc.total_amount),
      'Сумма (сом)': Number(doc.total_amount),
      'Учет НДС (12%)': vatPayerText,
      'Статус Документа': statusLabel,
    });
  });

  // Создаем рабочий лист Excel
  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Автоматическая ширина колонок
  const colWidths = [
    { wch: 15 }, // Дата
    { wch: 15 }, // Номер
    { wch: 25 }, // Тип
    { wch: 18 }, // ИНН
    { wch: 28 }, // Контрагент
    { wch: 32 }, // Товар
    { wch: 10 }, // Кол-во
    { wch: 10 }, // Ед изм
    { wch: 14 }, // Цена
    { wch: 16 }, // Сумма
    { wch: 22 }, // НДС
    { wch: 16 }, // Статус
  ];
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Выгрузка 1С');

  // Очищаем имя компании от спецсимволов для имени файла
  const safeCompanyName = companyName.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_]/g, '_');
  const todayStr = new Date().toISOString().split('T')[0];
  const filename = `export_1c_${safeCompanyName}_${todayStr}.xlsx`;

  // Инициируем скачивание браузером
  XLSX.writeFile(workbook, filename);
}

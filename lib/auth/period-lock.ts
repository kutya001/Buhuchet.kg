import { createAdminClient } from '@/lib/supabase/server';

/**
 * Проверка блокировки отчетного периода на стороне сервера (Server-side Period Lock Guard)
 * @param companyId UUID компании
 * @param date Дата документа или дата совершения операции (Date / string "YYYY-MM-DD")
 * @param module Модуль для проверки ('documents' | 'files')
 * @returns boolean true - период ЗАКРЫТ (операция запрещена), false - период открыт
 */
export async function isPeriodClosed(
  companyId: string,
  date: Date | string,
  module: 'documents' | 'files' = 'documents'
): Promise<boolean> {
  try {
    if (!companyId || !date) return false;

    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) return false;

    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1; // 1-12

    const adminSupabase = await createAdminClient();

    // 1. Проверяем точечную запись в Журнале Закрытых Периодов (company_closed_periods)
    const { data: periodRecord } = await adminSupabase
      .from('company_closed_periods')
      .select('status, lock_documents, lock_files')
      .eq('company_id', companyId)
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    if (periodRecord) {
      if (module === 'documents' && (periodRecord.lock_documents || periodRecord.status === 'closed')) {
        return true;
      }
      if (module === 'files' && (periodRecord.lock_files || periodRecord.status === 'closed')) {
        return true;
      }
    }

    // 2. Проверяем также глобальную отсечку closed_period_until из карточки компании
    const { data: company } = await adminSupabase
      .from('companies')
      .select('closed_period_until')
      .eq('id', companyId)
      .single();

    if (company?.closed_period_until) {
      const lockUntilDate = new Date(company.closed_period_until);
      // Если дата операции меньше или равна дате блокировки — период заблокирован
      if (targetDate <= lockUntilDate) {
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error('[Period Lock Guard Error]:', err);
    return false;
  }
}

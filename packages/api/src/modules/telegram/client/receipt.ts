import { sentUploadState, type Tx } from '@buhuchet/db';
import { sentUploadOn } from '@buhuchet/domain';

/*
 * Чек к оплате и файлы клиента через бота (доработки 14.11.2026, блок 2, пункт 1 и блок 4, пункт 4,
 * этап 2; прототип v115 modules/cp-telegram.js: `pgFileOn`, `pgRcptBtn`, `pgRcptOffer`).
 */

/**
 * Может ли контрагент сейчас отправлять файлы через бота (прототип `pgFileOn`): те же правила, что у
 * отправки со страницы (`sentUploadOn`: страница включена и не закрыта, раздел «Файлы» показан, галочки
 * учётной политики и контрагента); что Telegram подключён, проверяет вызывающий. Нельзя — кнопки
 * «Прислать чек» под сообщениями нет.
 */
export async function clientFilesOn(tx: Tx, contractorId: string): Promise<boolean> {
  const state = await sentUploadState(tx, contractorId);
  return !!state && sentUploadOn(state);
}

import type { OrgLogoLink } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';

/** Ссылка на логотип живёт 15 минут, как все ссылки на файлы; потом экран запрашивает новую. */
export const LOGO_LINK_SECONDS = 15 * 60;

/**
 * Ключ лежит в папке логотипов этой организации. Ключ ставит только сервер, но ссылка выдаётся и файл
 * удаляется лишь после этой проверки: ошибочный ключ не откроет и не сотрёт файл чужой организации.
 */
export function ownLogoKey(key: string | null | undefined, orgId: string): key is string {
  return !!key && key.startsWith(`org/${orgId}/logo/`);
}

/**
 * Временная подписанная ссылка на картинку логотипа в хранилище (ТЗ: файлы — только по таким ссылкам
 * после проверки права). Хранилище отдаёт файл вложением: в `<img>` картинка показывается, а открытая
 * отдельно — скачивается, а не выполняется. null — логотипа нет.
 */
export async function logoLink(
  deps: ApiDeps,
  orgId: string,
  key: string | null,
): Promise<OrgLogoLink | null> {
  if (!ownLogoKey(key, orgId)) return null;
  // Срок — по настоящим часам: подпись хранилища ставит их же, а не часы демо-стенда (FIXED_NOW).
  const expiresAt = new Date(Date.now() + LOGO_LINK_SECONDS * 1000);
  const url = await deps.storage.signedDownloadUrl(key, { expiresInSeconds: LOGO_LINK_SECONDS });
  return { url, expiresAt: expiresAt.toISOString() };
}

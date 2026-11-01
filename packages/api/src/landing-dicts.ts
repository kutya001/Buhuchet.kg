import { landingNumbers, phoneCodeList, type Db, type PhoneCodeRecord } from '@buhuchet/db';

/** Справочники лендинга для гостя: числа полосы цифр и коды стран поля «Телефон» формы заявки. */
export interface LandingDicts {
  numbers: { reportTypes: number; regimes: number };
  codes: PhoneCodeRecord[];
}

/** Справочники лендинга сверяются с базой не чаще раза в минуту: наплыв гостей базу не нагружает. */
export const LANDING_DICTS_TTL_MS = 60_000;

/**
 * Справочники для лендинга (прототип modules/landing.js: `landNums` и поле «Телефон» формы): числа
 * полосы цифр — действующие виды отчётов и режимы налогообложения, коды стран — справочник «Коды стран
 * телефонов», тот же, по которому сервер проверяет номер заявки. Справочники платформы общие и без
 * организации: читаются без входа, как в `POST /api/leads`. Хранятся в памяти не дольше `ttlMs`
 * (ТЗ: лендинг без обращения к базе на каждое открытие, числа не устаревают); неудачное чтение не
 * запоминается — следующее открытие спросит базу снова.
 */
export function landingDictsLoader(
  load: () => Promise<LandingDicts>,
  ttlMs = LANDING_DICTS_TTL_MS,
): (now?: number) => Promise<LandingDicts> {
  let cached: { at: number; value: Promise<LandingDicts> } | undefined;
  return (now = Date.now()) => {
    if (cached && now - cached.at < ttlMs) return cached.value;
    const entry = { at: now, value: load() };
    cached = entry;
    entry.value.catch(() => {
      if (cached === entry) cached = undefined;
    });
    return entry.value;
  };
}

/** Чтение справочников лендинга из базы (роль приложения, без контекста организации). */
export async function readLandingDicts(db: Db): Promise<LandingDicts> {
  const [numbers, codes] = await Promise.all([landingNumbers(db), phoneCodeList(db)]);
  return { numbers, codes };
}

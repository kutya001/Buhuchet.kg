import {
  landingNumbers,
  landingVideoRecords,
  phoneCodeList,
  type Db,
  type PhoneCodeRecord,
  type VideoRecord,
} from '@buhuchet/db';
import type { LandingVideo } from '@buhuchet/shared';

/**
 * Справочники лендинга для гостя: числа полосы цифр, коды стран поля «Телефон» формы заявки и видео
 * блока «Видео о Buhuchet.kg» (прототип v79 `vidLand`).
 */
export interface LandingDicts {
  numbers: { reportTypes: number; regimes: number };
  codes: PhoneCodeRecord[];
  videos: LandingVideo[];
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

/** Видео для лендинга: без ключей хранилища и статистики — только что показать гостю. */
export function landingVideoOf(v: VideoRecord): LandingVideo {
  return {
    id: v.id,
    title: v.title,
    kind: v.kind as LandingVideo['kind'],
    source: v.source as LandingVideo['source'],
    ytId: v.source === 'yt' ? v.ytId : null,
    duration: v.duration,
    description: v.description,
    cover: v.coverKey !== null,
  };
}

/** Чтение справочников лендинга из базы (роль приложения, без контекста организации). */
export async function readLandingDicts(db: Db): Promise<LandingDicts> {
  const [numbers, codes, videos] = await Promise.all([
    landingNumbers(db),
    phoneCodeList(db),
    landingVideoRecords(db),
  ]);
  return { numbers, codes, videos: videos.map(landingVideoOf) };
}

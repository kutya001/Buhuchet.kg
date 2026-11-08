'use client';

import type { VideoSegment } from '@buhuchet/domain';
import {
  ListValues,
  VideoCatalog,
  VideoOpened,
  VideoOptions,
  VideoPlay,
  VideoProgressSaved,
} from '@buhuchet/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, apiFailure } from '../../api-client';

/*
 * Данные видео платформы (прототип v79 modules/video.js): все доступные видео (`videoCatalogQuery` —
 * окно «?», кнопка «▶», кнопки в статьях, новостях и уроках), окно видео (открытие, прогресс,
 * длительность), видео лендинга без входа.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

export const VIDEO_KEY = ['kb', 'videos'] as const;

/** Все видео, доступные пользователю, со своими просмотрами. */
export const videoCatalogQuery = queryOptions({
  queryKey: [...VIDEO_KEY, 'all'],
  queryFn: async () => json(await api.api.kb.videos.all.$get(), (v) => VideoCatalog.parse(v)),
  staleTime: 30_000,
});

/** Видео для выбора в редакторах Админки: новости, статьи, шаги уроков (не удалённые). */
export const videoOptionsQuery = queryOptions({
  queryKey: [...VIDEO_KEY, 'options'],
  queryFn: async () =>
    json(await api.api.admin.videos.options.$get(), (v) => VideoOptions.parse(v)),
  staleTime: 30_000,
});

/**
 * Значения столбца «Статус» Админки → «Видео» с числом видео: по ним — число черновиков у вкладки
 * (прототип kbAdmTabs). Ключ — внутри списка, поэтому обновляется вместе с ним.
 */
export const videoAdminStatusValuesQuery = queryOptions({
  queryKey: ['list', 'kbadm.video', 'status-values'],
  queryFn: async () =>
    json(await api.api.admin.videos.values.$get({ query: { col: 'status' } }), (v) =>
      ListValues.parse(v),
    ),
});

/** После просмотра или правки видео — перечитать вкладки, «?» и просмотры. */
export function refreshVideos(client: QueryClient) {
  void client.invalidateQueries({ queryKey: VIDEO_KEY });
  void client.invalidateQueries({ queryKey: ['kb', 'video-views'] });
}

/** Открыть окно видео: чем играть и новое открытие (у администратора — без открытия). */
export async function openVideo(id: string): Promise<VideoOpened> {
  return json(await api.api.kb.videos[':id'].open.$post({ param: { id } }), (v) =>
    VideoOpened.parse(v),
  );
}

/** Сохранить, что проигралось в открытии окна; при закрытии — запросом, который доживёт до ответа. */
export async function saveVideoProgress(
  id: string,
  sessionId: string,
  segs: readonly VideoSegment[],
  pos: number,
  final: boolean,
): Promise<VideoProgressSaved> {
  const res = await api.api.kb.videos[':id'].sessions[':sessionId'].$put(
    { param: { id, sessionId }, json: { segs: segs.map((s) => [s[0], s[1]]), pos } },
    final ? { init: { keepalive: true } } : undefined,
  );
  return json(res, (v) => VideoProgressSaved.parse(v));
}

/** Плеер узнал длительность или что видео YouTube не играет. */
export function sendVideoMeta(id: string, input: { duration?: number; ytOk?: boolean }) {
  void api.api.kb.videos[':id'].meta.$post({ param: { id }, json: input }).catch(() => {});
}

/** Обложка видео для вошедшего (своя картинка или кадр). */
export const videoCoverUrl = (id: string) => `/api/kb/videos/${encodeURIComponent(id)}/cover`;

/* ───────────── Лендинг ───────────── */

export const landingCoverUrl = (id: string) =>
  `/api/landing/videos/${encodeURIComponent(id)}/cover`;

/** Чем играть видео лендинга (без входа). */
export async function landingPlay(id: string): Promise<VideoPlay> {
  return json(await api.api.landing.videos[':id'].play.$get({ param: { id } }), (v) =>
    VideoPlay.parse(v),
  );
}

/** Гость запустил видео. */
export function landingStart(id: string) {
  void api.api.landing.videos[':id'].start.$post({ param: { id } }).catch(() => {});
}

/** Гость закрыл окно: сколько процентов проигралось. */
export function landingWatched(id: string, pct: number) {
  void api.api.landing.videos[':id'].watched
    .$post(
      { param: { id }, json: { pct: Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10 } },
      { init: { keepalive: true } },
    )
    .catch(() => {});
}

'use client';

import { VIDEO_COVER_WIDTH } from '@buhuchet/domain';
import {
  VideoCoverUploaded,
  VideoPartLinks,
  VideoUploadChecked,
  VideoUploadStarted,
  VideoUploadState,
} from '@buhuchet/shared';
import { api, apiFailure } from '../api-client';

/*
 * Загрузка файла видео из браузера прямо в хранилище частями (решение заказчика 08.11.2026, прототип
 * v79 vidEditDlg: полоса с процентами, «Отменить», обрыв — «Продолжить», «Проверяем файл…»): API
 * открывает загрузку и подписывает ссылки на части, браузер кладёт части `PUT`, API собирает файл и
 * проверяет, что это MP4 или WebM. Обложка — JPEG до 2 МБ телом запроса.
 */

const videos = () => api.api.admin.videos;

/** Частей одновременно и ссылок за раз: ссылка живёт 15 минут, запрашиваем их понемногу. */
const PARALLEL = 3;
const BATCH = 6;

/** Часть не дошла до хранилища (обрыв связи, ссылка истекла): загрузку можно продолжить. */
export class UploadBroken extends Error {}

export interface VideoUploadJob {
  id: string;
  partSize: number;
  parts: number;
  file: File;
}

export async function startVideoUpload(file: File): Promise<VideoUploadJob> {
  const res = await videos().uploads.$post({
    json: { name: file.name, size: file.size, ...(file.type ? { type: file.type } : {}) },
  });
  if (!res.ok) throw await apiFailure(res);
  return { ...VideoUploadStarted.parse(await res.json()), file };
}

const partBytes = (job: VideoUploadJob, n: number) =>
  n < job.parts ? job.partSize : job.file.size - job.partSize * (job.parts - 1);

/** Номера частей по порядку. */
export const allParts = (job: VideoUploadJob) => Array.from({ length: job.parts }, (_, i) => i + 1);

/** Части, которых ещё нет в хранилище (или они неполные) — для «Продолжить» после обрыва. */
export async function missingParts(job: VideoUploadJob): Promise<number[]> {
  const res = await videos().uploads[':id'].$get({ param: { id: job.id } });
  if (!res.ok) throw await apiFailure(res);
  const state = VideoUploadState.parse(await res.json());
  const have = new Set(
    state.parts.filter((p) => p.size === partBytes(job, p.number)).map((p) => p.number),
  );
  return allParts(job).filter((n) => !have.has(n));
}

/** Байт в частях — для полосы после «Продолжить». */
export const partsBytes = (job: VideoUploadJob, numbers: readonly number[]) =>
  numbers.reduce((sum, n) => sum + partBytes(job, n), 0);

/** Положить части в хранилище по подписанным ссылкам; `onPart` — сколько байт дошло. */
export async function putVideoParts(
  job: VideoUploadJob,
  numbers: readonly number[],
  signal: AbortSignal,
  onPart: (bytes: number) => void,
): Promise<void> {
  for (let i = 0; i < numbers.length; i += BATCH) {
    const res = await videos().uploads[':id'].parts.$post(
      { param: { id: job.id }, json: { numbers: numbers.slice(i, i + BATCH) } },
      { init: { signal } },
    );
    if (!res.ok) throw await apiFailure(res);
    const queue = [...VideoPartLinks.parse(await res.json()).links];
    const worker = async () => {
      for (let link = queue.shift(); link; link = queue.shift()) {
        const from = (link.number - 1) * job.partSize;
        const body = job.file.slice(from, Math.min(job.file.size, from + job.partSize));
        const put = await fetch(link.url, { method: 'PUT', body, signal });
        if (!put.ok) throw new UploadBroken(`part ${link.number}: ${put.status}`);
        onPart(body.size);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
  }
}

/** «Проверяем файл…»: API собирает файл и узнаёт вид и длительность. */
export async function completeVideoUpload(id: string) {
  const res = await videos().uploads[':id'].complete.$post({ param: { id } });
  if (!res.ok) throw await apiFailure(res);
  return VideoUploadChecked.parse(await res.json());
}

/** «Отменить»: части и файл убираются из хранилища. */
export function cancelVideoUpload(id: string) {
  void videos()
    .uploads[':id'].$delete({ param: { id } })
    .catch(() => {});
}

/** Обложка в хранилище: код загрузки для формы. */
export async function uploadVideoCover(blob: Blob): Promise<string> {
  const res = await videos().covers.$post(
    {},
    { headers: { 'content-type': 'image/jpeg' }, init: { body: blob } },
  );
  if (!res.ok) throw await apiFailure(res);
  return VideoCoverUploaded.parse(await res.json()).id;
}

const jpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

/** Своя обложка уменьшается до 960 px по ширине и хранится JPEG (прототип `vidShrink`). */
export function shrinkCover(file: File, width = VIDEO_COVER_WIDTH): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, width / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      void jpeg(canvas, 0.82).then(resolve);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/** Кадр с первой секунды файла — обложка по умолчанию (прототип `check` → `U.frame`, 640 px). */
export function captureFrame(file: File, width = 640): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let finished = false;
    const finish = (blob: Blob | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), 9000);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      if (!video.videoWidth) return finish(null);
      const d = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 2;
      video.currentTime = Math.min(1, d / 2);
    };
    video.onseeked = () => {
      const k = Math.min(1, width / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * k);
      canvas.height = Math.round(video.videoHeight * k);
      const ctx = canvas.getContext('2d');
      if (!ctx) return finish(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      void jpeg(canvas, 0.8).then(finish);
    };
    video.src = url;
  });
}

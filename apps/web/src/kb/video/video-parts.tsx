'use client';

import { bishkekDate, bishkekTime, formatDateRu, videoPct, videoTime } from '@buhuchet/domain';
import type { VideoItem } from '@buhuchet/shared';
import { Icon, Pill, type IconName } from '@buhuchet/ui';
import { useState } from 'react';
import { MODULES, isModuleId } from '../../shell/modules';
import { useT } from '../../l10n/provider';
import { landingCoverUrl, videoCoverUrl } from './video-data';
import './video.css';

/*
 * Части экранов видео (прототип v79 modules/video.js): обложка `vidCover`, метка вида `vidKindPill`,
 * полоса просмотра `vidProg`, метка статуса просмотра `vidStPill`, кнопка в тексте `vidMdBtn`.
 */

/** «15.03.2026» по Бишкеку. */
export const bishkekDay = (iso: string): string => formatDateRu(bishkekDate(new Date(iso)));

/** «15.03.2026 10:05» по Бишкеку (прототип `fmtDT`). */
export const bishkekDateTime = (iso: string): string =>
  `${bishkekDay(iso)} ${bishkekTime(new Date(iso))}`;

/** Оттенок рисованной обложки — по коду видео (прототип `vidHue`). */
export function videoHue(key: string): number {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 360;
  return 190 + (h % 60);
}

export interface CoverVideo {
  id: string;
  title: string;
  source: 'file' | 'yt';
  ytId: string | null;
  duration: number | null;
  module?: string | null;
  cover: boolean;
}

/**
 * Обложка 16:9 (прототип `vidCover`): своя картинка или кадр видео, у YouTube — обложка YouTube (на
 * лендинге — без обращения к YouTube: рисованная), иначе — рисованная со значком модуля и названием.
 */
export function VideoCover({
  video,
  size,
  land = false,
  isNew = false,
  play = true,
  showDuration = true,
  version,
  className = '',
}: {
  video: CoverVideo;
  /** Версия записи в адресе своей обложки: после замены картинки браузер не берёт старую. */
  version?: number;
  size?: 'sm' | 'xs';
  land?: boolean;
  isNew?: boolean;
  play?: boolean;
  showDuration?: boolean;
  className?: string;
}) {
  const t = useT();
  const image = video.cover
    ? land
      ? landingCoverUrl(video.id)
      : `${videoCoverUrl(video.id)}${version === undefined ? '' : `?v=${version}`}`
    : video.source === 'yt' && video.ytId && !land
      ? `https://i.ytimg.com/vi/${encodeURIComponent(video.ytId)}/hqdefault.jpg`
      : null;
  const mod = video.module && isModuleId(video.module) ? MODULES[video.module] : null;
  const icon: IconName = mod?.icon ?? 'film';
  // Картинка не загрузилась (нет связи с YouTube, файл убран) — обложка рисуется, как без картинки.
  const [broken, setBroken] = useState<string | null>(null);
  return (
    <span
      className={`vcv ${size ?? ''} ${className}`}
      style={{ ['--vh' as string]: videoHue(video.id || video.title) }}
    >
      {image && broken !== image ? (
        // Обложка — своё хранилище или i.ytimg.com; размеры задаёт рамка 16:9.
        <img src={image} alt="" loading="lazy" decoding="async" onError={() => setBroken(image)} />
      ) : (
        <span className="vcv-g" aria-hidden="true">
          <span className="vcv-ic">
            <Icon name={icon} />
          </span>
          <span className="vcv-t">{video.title}</span>
        </span>
      )}
      {play ? (
        <span className="vcv-p" aria-hidden="true">
          <Icon name="pl" />
        </span>
      ) : null}
      {video.duration && showDuration ? (
        <span className="vcv-d">{videoTime(video.duration)}</span>
      ) : null}
      {isNew ? <span className="vcv-n">{t('video.new')}</span> : null}
    </span>
  );
}

/** «Видеоинструкция» (синяя) или «Презентация» (фиолетовая). */
export function VideoKindPill({ kind }: { kind: 'instr' | 'pres' }) {
  const t = useT();
  return (
    <Pill size="sm" tone={kind === 'pres' ? 'violet' : 'info'}>
      {t(`video.kind.${kind}`)}
    </Pill>
  );
}

/** Статус просмотра: «Не смотрел», «Начал», «Просмотрено» (прототип `vidStPill`). */
export function VideoStatusPill({ status }: { status: 'none' | 'started' | 'done' }) {
  const t = useT();
  return (
    <Pill
      size="sm"
      tone={status === 'done' ? 'ok' : status === 'started' ? 'warn' : 'plain'}
      icon={status === 'done' ? 'ok' : undefined}
    >
      {t(`video.view.${status}`)}
    </Pill>
  );
}

/** Полоса просмотра или «Просмотрено» (прототип `vidProg`); `you` — «Вы посмотрели N %» окна. */
export function VideoProgress({
  duration,
  segs,
  done,
  you = false,
}: {
  duration: number | null;
  segs: readonly (readonly [number, number])[];
  done: boolean;
  you?: boolean;
}) {
  const t = useT();
  if (done) {
    return (
      <span className="vprog done">
        <Icon name="ok" size="sm" />
        {t('video.view.done')}
      </span>
    );
  }
  const pct = videoPct(duration, segs);
  if (!pct && !you) return null;
  return (
    <span className="vprog">
      <span className="bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span>{you ? t('video.you_pct', { pct }) : `${pct} %`}</span>
    </span>
  );
}

/** Полоса у видео списка: только у видеоинструкций и у того, чьи просмотры учитываются. */
export function ItemProgress({ video }: { video: VideoItem }) {
  if (video.kind !== 'instr' || !video.view) return null;
  return (
    <VideoProgress duration={video.duration} segs={video.view.segs} done={!!video.view.doneAt} />
  );
}

/** Кнопка «▶ <название> · 3:25» в тексте статьи и новости (прототип `vidMdBtn`). */
export function VideoMdButton({
  video,
  label,
  onOpen,
}: {
  video: Pick<VideoItem, 'title' | 'duration'> | null;
  label?: string;
  onOpen: () => void;
}) {
  const t = useT();
  const title = video ? video.title : label || t('video.step_btn');
  return (
    <button
      type="button"
      className="md-vid"
      onClick={(e) => {
        e.preventDefault();
        onOpen();
      }}
    >
      <Icon name="pl" size="sm" />
      <span>
        {title}
        {video?.duration ? ` · ${videoTime(video.duration)}` : ''}
      </span>
    </button>
  );
}

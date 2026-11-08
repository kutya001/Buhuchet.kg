'use client';

import { isMenuModuleId, KB_MODULE_TITLES, videoTime, type VideoSegment } from '@buhuchet/domain';
import type { LandingVideo, VideoItem, VideoPlay, VideoView } from '@buhuchet/shared';
import {
  buttonClass,
  EmptyState,
  Icon,
  Modal,
  Pill,
  PHONE_QUERY,
  useMediaQuery,
  useToast,
  useWindow,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiFailure } from '../../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../../dialog-slot';
import { useT } from '../../l10n/provider';
import type { Translate } from '../../l10n/translate';
import { KB_STATE_KEY, kbArticlesQuery } from '../kb-data';
import { mountPlayer, type PlayerControl, type PlayerTexts } from './player';
import {
  landingPlay,
  landingStart,
  landingWatched,
  openVideo,
  refreshVideos,
  saveVideoProgress,
  sendVideoMeta,
} from './video-data';
import { VideoProgress } from './video-parts';

/*
 * Окно видео (прототип v79 modules/video.js `vidOpen`): одно окно для всех видео — База знаний, «?»
 * модуля, статьи, новости, шаги уроков, лендинг. Крестик и Esc закрывают, нажатие мимо окна — нет. У
 * сотрудника секунды учитываются и сохраняются; у администратора платформы — нет (строка об этом);
 * у гостя лендинга — только число запусков и процент для сводки.
 */

export interface VideoControls {
  /** Открыть окно видео по коду. */
  open: (id: string) => void;
}

export const VideoContext = createContext<VideoControls>({ open: () => {} });

export const useVideo = () => useContext(VideoContext);

/** Тексты плеера из словаря. */
export function playerTexts(t: Translate): PlayerTexts {
  return {
    watch: t('video.watch'),
    watchSpace: t('video.watch_space'),
    pause: t('video.pause'),
    timeline: t('video.timeline'),
    mute: t('video.mute'),
    unmute: t('video.unmute'),
    sound: t('video.sound'),
    volume: t('video.volume'),
    rate: t('video.rate'),
    full: t('video.full'),
    unfull: t('video.unfull'),
    resumeTitle: t('video.resume.title'),
    resumeGo: (time) => t('video.resume.go', { time }),
    resumeZero: t('video.resume.zero'),
    errYt: t('video.err.yt'),
    errYtText: t('video.err.yt_text'),
    errNet: t('video.err.net'),
    retry: t('video.retry'),
  };
}

export interface WindowVideo {
  id: string;
  title: string;
  kind: 'instr' | 'pres';
  source: 'file' | 'yt';
  ytId: string | null;
  duration: number | null;
  description: string;
}

/**
 * Плеер в окне: создаётся один раз на окно. `report` — сообщать серверу длительность и «YouTube
 * недоступно» (вошедший; на лендинге и в предпросмотре формы — нет, у формы своя `onDuration`).
 */
export function PlayerHost({
  video,
  play,
  track,
  view,
  report = track !== 'guest',
  auto = true,
  onSave,
  onInfo,
  onStart,
  onGuestEnd,
  onDuration,
}: {
  video: WindowVideo;
  play: VideoPlay;
  track: 'user' | 'guest' | null;
  view: VideoView | null;
  report?: boolean;
  /** false — не запускать сразу (карточка видео в Админке). */
  auto?: boolean;
  onSave?: (segs: VideoSegment[], pos: number, final: boolean) => void;
  onInfo?: (segs: readonly VideoSegment[], done: boolean) => void;
  onStart?: () => void;
  onGuestEnd?: (pct: number) => void;
  onDuration?: (seconds: number) => void;
}) {
  const t = useT();
  const phone = useMediaQuery(PHONE_QUERY);
  const host = useRef<HTMLDivElement>(null);
  const ctl = useRef<PlayerControl | null>(null);
  // Обработчики — последние, плеер создаётся один раз на окно.
  const handlers = useRef({ onSave, onInfo, onStart, onGuestEnd, onDuration });
  useEffect(() => {
    handlers.current = { onSave, onInfo, onStart, onGuestEnd, onDuration };
  });
  const ytReported = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    const control = mountPlayer(host.current, {
      video,
      source:
        play.kind === 'file' ? { kind: 'file', url: play.url } : { kind: 'yt', ytId: play.ytId },
      texts: playerTexts(t),
      track,
      initial: view ? { segs: view.segs, pos: view.pos, done: !!view.doneAt } : undefined,
      phone,
      auto,
      onSave: (segs, pos, final) => handlers.current.onSave?.(segs, pos, final),
      onInfo: (segs, done) => handlers.current.onInfo?.(segs, done),
      onStart: () => handlers.current.onStart?.(),
      onGuestEnd: (pct) => handlers.current.onGuestEnd?.(pct),
      // Длительность и «YouTube недоступно» сообщает только вошедший (лендинг ничего не меняет).
      onDuration: (d) => {
        handlers.current.onDuration?.(d);
        if (report) sendVideoMeta(video.id, { duration: d });
      },
      onYt: !report
        ? undefined
        : (ok) => {
            if (ok && ytReported.current) return;
            ytReported.current = true;
            sendVideoMeta(video.id, { ytOk: ok });
          },
    });
    ctl.current = control;
    // Клавиши на ПК: пробел — пауза, ← → — на 5 секунд, пока фокус в этом окне и не в поле ввода.
    const onKey = (e: KeyboardEvent) => {
      if (phone || e.ctrlKey || e.metaKey || e.altKey) return;
      const dialog = host.current?.closest('[role="dialog"]');
      const target = e.target as HTMLElement | null;
      if (!dialog || !target || !dialog.contains(target)) return;
      if (target.closest('input:not([type=range]),select,textarea,[contenteditable]')) return;
      if (control.key(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      control.destroy();
      ctl.current = null;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
    // Плеер — один на окно: окно с другим видео — новый ключ компонента.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="vid-p" />;
}

function subLine(t: Translate, v: VideoItem): ReactNode {
  return (
    <>
      {t(`video.kind.${v.kind}`)}
      {v.module ? ` · ${v.moduleTitle}` : ''}
      {v.duration ? ` · ${videoTime(v.duration)}` : ''}
      {v.status === 'draft' ? (
        <>
          {' · '}
          <Pill size="sm">{t('video.draft')}</Pill>
        </>
      ) : v.off ? (
        <>
          {' · '}
          <Pill size="sm" tone="bad">
            {t('video.off')}
          </Pill>
        </>
      ) : null}
    </>
  );
}

interface OpenedSlot {
  video: VideoItem;
  play: VideoPlay;
  session: string | null;
}

/** Окно видео вошедшего пользователя. */
function UserVideoWindow({
  data,
  open,
  onClose,
  hrefOf,
  currentModule,
  openArticle,
  goTo,
}: {
  data: OpenedSlot;
  open: boolean;
  onClose: () => void;
  hrefOf: (module: string) => string | null;
  currentModule: string | null;
  openArticle: (id: string) => void;
  goTo: (href: string) => void;
}) {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const { video: v, play, session } = data;
  const tracked = session !== null;
  const [line, setLine] = useState<{ segs: readonly VideoSegment[]; done: boolean }>({
    segs: v.view?.segs ?? [],
    done: !!v.view?.doneAt,
  });
  const articles = useQuery({ ...kbArticlesQuery, enabled: !!v.article }).data;
  const article = v.article ? articles?.find((a) => a.id === v.article) : undefined;
  const moduleHref =
    v.kind === 'instr' && v.module && v.module !== currentModule ? hrefOf(v.module) : null;
  const doneShown = useRef(!!v.view?.doneAt);

  const onSave = useCallback(
    (segs: VideoSegment[], pos: number, final: boolean) => {
      if (!session) return;
      void saveVideoProgress(v.id, session, segs, pos, final)
        .then((saved) => {
          if (saved.done && !doneShown.current) {
            doneShown.current = true;
            const step = saved.steps[0];
            toast(
              step
                ? t('video.done_step', { title: step.title })
                : t('video.done_toast', { title: v.title }),
              { icon: 'grad' },
            );
            if (saved.steps.length) void client.invalidateQueries({ queryKey: KB_STATE_KEY });
          }
          if (final || saved.done) refreshVideos(client);
        })
        .catch(() => {});
    },
    [session, v.id, v.title, toast, t, client],
  );

  const short =
    article && article.title.length > 34 ? `${article.title.slice(0, 32)}…` : article?.title;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      sticky
      noMax
      swipeHead
      title={v.title}
      sub={subLine(t, v)}
      footer={
        <VideoFooter>
          {article ? (
            <FooterButton
              icon="book"
              label={t('video.article', { title: short ?? '' })}
              onClick={(close) => {
                close();
                openArticle(article.id);
              }}
            />
          ) : null}
          {moduleHref ? (
            <FooterButton
              icon="right"
              label={t('video.go_module')}
              onClick={(_, leave) => {
                leave();
                goTo(moduleHref);
              }}
            />
          ) : null}
        </VideoFooter>
      }
    >
      <div className="vid-w vid-m">
        <PlayerHost
          video={v}
          play={play}
          track={tracked ? 'user' : null}
          view={v.view}
          onSave={onSave}
          onInfo={(segs, done) => setLine({ segs, done })}
        />
        <div className="vid-i">
          <div className="vid-l">
            {tracked ? (
              <VideoProgress duration={v.duration} segs={line.segs} done={line.done} you />
            ) : (
              <span className="inline-flex items-center gap-1.5 text-muted">
                <Icon name="info" size="sm" />
                {t('video.admin_note')}
              </span>
            )}
          </div>
          {v.description ? <p className="vid-d">{v.description}</p> : null}
        </div>
      </div>
    </Modal>
  );
}

function VideoFooter({ children }: { children?: ReactNode }) {
  const t = useT();
  const { close } = useWindow();
  return (
    <>
      {children}
      <div className="flex-1" />
      <button type="button" className={buttonClass('cta')} onClick={close}>
        {t('video.close')}
      </button>
    </>
  );
}

function FooterButton({
  icon,
  label,
  onClick,
}: {
  icon: 'book' | 'right' | 'film';
  label: string;
  onClick: (close: () => void, leave: () => void) => void;
}) {
  const { close, leave } = useWindow();
  return (
    <button type="button" className={buttonClass('ghost')} onClick={() => onClick(close, leave)}>
      <Icon name={icon} size="sm" />
      {label}
    </button>
  );
}

/** «Видео снято с публикации» (прототип: видео нет, удалено или снято). */
function GoneWindow({
  open,
  onClose,
  allHref,
  goTo,
}: {
  open: boolean;
  onClose: () => void;
  allHref: string | null;
  goTo: (href: string) => void;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="narrow"
      noMax
      title={t('video.gone.title')}
      footer={
        <VideoFooter>
          {allHref ? (
            <FooterButton
              icon="film"
              label={t('video.all')}
              onClick={(_, leave) => {
                leave();
                goTo(allHref);
              }}
            />
          ) : null}
        </VideoFooter>
      }
    >
      <EmptyState icon="film" title={t('video.gone.title')} text={t('video.gone.text')} />
    </Modal>
  );
}

/**
 * Окно видео в оболочке: `useVideo().open(id)` — из «?», вкладки «Видео», статей, новостей, уроков и
 * ссылки `#video/<код>`. Недоступно по модулям — уведомление; снято или удалено — окно «Видео снято с
 * публикации».
 */
export function useVideoRuntime(shell: {
  hrefOf: (module: string) => string | null;
  currentModule: string | null;
  openArticle: (id: string) => void;
  videoTabHref: string | null;
  goTo: (href: string) => void;
}): { controls: VideoControls; overlays: ReactNode } {
  const t = useT();
  const toast = useToast();
  const [slot, setSlot] = useState<DialogSlot<OpenedSlot> | null>(null);
  const [gone, setGone] = useState<DialogSlot<true> | null>(null);
  const open = useCallback(
    (id: string) => {
      void openVideo(id)
        .then((opened) => setSlot(openSlot(opened)))
        .catch((err: unknown) => {
          if (err instanceof ApiFailure && err.status === 403) {
            toast(t('video.denied'), { icon: 'lock' });
          } else if (err instanceof ApiFailure && err.status === 404) {
            setGone(openSlot(true as const));
          } else {
            toast(t('video.load_error'), { bad: true, icon: 'alert' });
          }
        });
    },
    [toast, t],
  );
  const controls = useMemo(() => ({ open }), [open]);
  const overlays = (
    <>
      {slot ? (
        <UserVideoWindow
          key={`video-${slot.n}`}
          data={slot.data}
          open={slot.open}
          onClose={() => setSlot(closeSlot)}
          hrefOf={shell.hrefOf}
          currentModule={shell.currentModule}
          openArticle={shell.openArticle}
          goTo={shell.goTo}
        />
      ) : null}
      {gone ? (
        <GoneWindow
          key={`video-gone-${gone.n}`}
          open={gone.open}
          onClose={() => setGone(closeSlot)}
          allHref={shell.videoTabHref}
          goTo={shell.goTo}
        />
      ) : null}
    </>
  );
  return { controls, overlays };
}

/* ───────────── Гость лендинга ───────────── */

/**
 * Окно видео на лендинге (прототип `vidOpen(id, {guest:true})`): без строки просмотра и кнопок статьи
 * и модуля; запуск и досмотренный процент уходят в сводку «Гости лендинга».
 */
export function useGuestVideo(videos: readonly LandingVideo[]): {
  open: (id: string) => void;
  overlay: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const [slot, setSlot] = useState<DialogSlot<{ video: LandingVideo; play: VideoPlay }> | null>(
    null,
  );
  const [gone, setGone] = useState<DialogSlot<true> | null>(null);
  const open = useCallback(
    (id: string) => {
      const video = videos.find((x) => x.id === id);
      if (!video) return;
      void landingPlay(id)
        .then((play) => setSlot(openSlot({ video, play })))
        .catch((err: unknown) => {
          // Видео сняли, пока страница была открыта, — окно «Видео снято с публикации» (прототип `vidOpen`).
          if (err instanceof ApiFailure && err.status === 404) setGone(openSlot(true as const));
          else toast(t('video.load_error'), { bad: true, icon: 'alert' });
        });
    },
    [videos, toast, t],
  );
  const overlay = (
    <>
      {slot ? (
        <GuestWindow key={`guest-video-${slot.n}`} slot={slot} onClose={() => setSlot(closeSlot)} />
      ) : null}
      {gone ? (
        <GoneWindow
          key={`guest-gone-${gone.n}`}
          open={gone.open}
          onClose={() => setGone(closeSlot)}
          allHref={null}
          goTo={() => {}}
        />
      ) : null}
    </>
  );
  return { open, overlay };
}

function GuestWindow({
  slot,
  onClose,
}: {
  slot: DialogSlot<{ video: LandingVideo; play: VideoPlay }>;
  onClose: () => void;
}) {
  const t = useT();
  const v = slot.data.video;
  return (
    <Modal
      open={slot.open}
      onClose={onClose}
      kind="card"
      size="wide"
      sticky
      noMax
      swipeHead
      title={v.title}
      sub={`${t(`video.kind.${v.kind}`)}${v.module && isMenuModuleId(v.module) ? ` · ${t(KB_MODULE_TITLES[v.module])}` : ''}${v.duration ? ` · ${videoTime(v.duration)}` : ''}`}
      footer={<VideoFooter />}
    >
      <div className="vid-w vid-m">
        <PlayerHost
          video={v}
          play={slot.data.play}
          track="guest"
          view={null}
          onStart={() => landingStart(v.id)}
          onGuestEnd={(pct) => landingWatched(v.id, pct)}
        />
        {v.description ? (
          <div className="vid-i">
            <p className="vid-d">{v.description}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

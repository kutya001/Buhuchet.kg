import {
  VIDEO_DONE_SHARE,
  VIDEO_RATES,
  VIDEO_SAVE_SECONDS,
  videoSegAdd,
  videoSegLen,
  videoTime,
  type VideoSegment,
} from '@buhuchet/domain';
import { ICONS, type IconName } from '@buhuchet/ui';

/*
 * Плеер окна видео (прототип v79 modules/video.js `vidPlayer`): файл платформы — встроенный плеер
 * браузера без кнопки скачивания; YouTube — плеер www.youtube-nocookie.com через postMessage (без
 * внешнего скрипта), загружается только после открытия окна. Учёт: секунды, которые действительно
 * проигрались при видимой вкладке; перемотка вперёд пропущенное не засчитывает; каждая секунда — один
 * раз. Сохранение — каждые 15 секунд просмотра, при паузе, уходе со вкладки и закрытии окна.
 * Разметку плеер рисует сам: в ней только постоянные значки и тексты словаря через textContent.
 */

const YT = 'https://www.youtube-nocookie.com';

export interface PlayerVideo {
  id: string;
  title: string;
  kind: 'instr' | 'pres';
  source: 'file' | 'yt';
  ytId: string | null;
  duration: number | null;
}

export type PlayerSource = { kind: 'file'; url: string } | { kind: 'yt'; ytId: string };

export interface PlayerTexts {
  watch: string;
  watchSpace: string;
  pause: string;
  timeline: string;
  mute: string;
  unmute: string;
  sound: string;
  volume: string;
  rate: string;
  full: string;
  unfull: string;
  resumeTitle: string;
  resumeGo: (time: string) => string;
  resumeZero: string;
  errYt: string;
  errYtText: string;
  errNet: string;
  retry: string;
}

export interface PlayerOptions {
  video: PlayerVideo;
  source: PlayerSource;
  texts: PlayerTexts;
  /** Учитываются ли секунды: сотрудник (`user`), гость лендинга (`guest`), администратор (null). */
  track: 'user' | 'guest' | null;
  /** Свои отрезки и где остановился — до этого открытия (у сотрудника). */
  initial?: { segs: readonly VideoSegment[]; pos: number; done: boolean };
  phone: boolean;
  /** Отрезки этого открытия и позиция — сохранить (на сервере сливаются с прежними). */
  onSave?: (segs: VideoSegment[], pos: number, final: boolean) => void;
  /** Просмотренное с идущим сейчас отрезком — для строки «Вы посмотрели N %». */
  onInfo?: (segs: readonly VideoSegment[], done: boolean) => void;
  /** Длительность стала известна (YouTube, WebM без длительности в файле). */
  onDuration?: (seconds: number) => void;
  /** YouTube: видео играет (true) или недоступно (false). */
  onYt?: (ok: boolean) => void;
  /** Первый запуск в этом окне. */
  onStart?: () => void;
  /** Окно закрыто после запуска: сколько процентов проигралось в этом открытии (гость). */
  onGuestEnd?: (pct: number) => void;
  /** false — не запускать сразу (карточка видео в Админке, прототип `auto:false`). */
  auto?: boolean;
}

export interface PlayerControl {
  key(e: KeyboardEvent): boolean;
  pause(): void;
  destroy(): void;
}

const icon = (name: IconName) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="ic">${ICONS[name]}</svg>`;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

interface Adapter {
  play(): void;
  pause(): void;
  time(): number;
  playing(): boolean;
  rate(): number;
  seek(t: number): void;
  setRate(r: number): void;
  setVolume(v: number, muted: boolean): void;
  stop(): void;
  /** Загрузить заново с `at`; `autoplay: false` — без запуска (YouTube показывает свою обложку с ▶). */
  reload(at: number, autoplay?: boolean): void;
}

/** Плеер в `host`: возвращает управление (клавиши, пауза, закрытие). */
export function mountPlayer(host: HTMLElement, o: PlayerOptions): PlayerControl {
  const { video: v, texts: tx } = o;
  const kind = o.source.kind;
  let duration = v.duration ?? 0;
  const dur = () => duration;
  const tracked = o.track !== null;
  // Отрезки этого открытия и все свои (с прежними) — у сотрудника.
  let sessionSegs: VideoSegment[] = [];
  let allSegs: VideoSegment[] = o.initial ? [...o.initial.segs] : [];
  let done = o.initial?.done ?? false;
  const T = {
    ps: null as number | null,
    pt: 0,
    lt: null as number | null,
    ui: 0,
    w: performance.now(),
    acc: 0,
    started: false,
    ended: false,
    drag: false,
    fail: null as 'yt' | 'net' | null,
    dead: false,
  };

  host.textContent = '';
  const box = el('div', `vp-box vk-${kind}`);
  box.tabIndex = -1;
  const stage = el('div', 'vp-st');
  box.append(stage);
  const overlay = el('div', 'vp-ov');
  overlay.hidden = true;
  let big: HTMLButtonElement | null = null;
  let bar: HTMLDivElement | null = null;
  const q = <E extends Element>(sel: string) => box.querySelector<E>(sel)!;

  if (kind === 'file') {
    const media = el('video', 'vp-v');
    media.playsInline = true;
    media.preload = 'metadata';
    media.setAttribute('controlslist', 'nodownload noremoteplayback noplaybackrate');
    media.setAttribute('disablepictureinpicture', '');
    media.setAttribute('disableremoteplayback', '');
    stage.append(media);
  } else {
    stage.append(el('div', 'vp-yt'));
  }
  if (kind === 'file') {
    big = el('button', 'vp-big', icon('pl'));
    big.type = 'button';
    big.setAttribute('aria-label', tx.watch);
    stage.append(big);
  }
  stage.append(overlay);
  if (kind === 'file') {
    bar = el('div', 'vp-bar');
    const pp = el('button', 'vp-b vp-pp', icon('pl'));
    pp.type = 'button';
    pp.setAttribute('aria-label', tx.watch);
    pp.title = o.phone ? tx.watch : tx.watchSpace;
    const tm = el('span', 'vp-tm');
    const cur = el('span', 'vp-c');
    cur.textContent = '0:00';
    const all = el('span', 'vp-d');
    all.textContent = videoTime(dur());
    tm.append(cur, document.createTextNode(' / '), all);
    const sk = el('span', 'vp-sk');
    const tr = el('span', 'vp-tr');
    tr.append(el('span', 'vp-seg'), el('span', 'vp-fill'));
    const rg = el('input', 'vp-rg');
    rg.type = 'range';
    rg.min = '0';
    rg.max = String(dur() || 1);
    rg.step = '0.1';
    rg.value = '0';
    rg.setAttribute('aria-label', tx.timeline);
    sk.append(tr, rg);
    const mu = el('button', 'vp-b vp-mu', icon('vol'));
    mu.type = 'button';
    mu.setAttribute('aria-label', tx.mute);
    mu.title = tx.sound;
    const vl = el('input', 'vp-vl');
    vl.type = 'range';
    vl.min = '0';
    vl.max = '1';
    vl.step = '0.05';
    vl.value = '1';
    vl.setAttribute('aria-label', tx.volume);
    const rt = el('select', 'vp-rt');
    rt.setAttribute('aria-label', tx.rate);
    rt.title = tx.rate;
    for (const r of VIDEO_RATES) {
      const op = el('option');
      op.value = String(r);
      op.textContent = `${String(r).replace('.', ',')}×`;
      op.selected = r === 1;
      rt.append(op);
    }
    const fs = el('button', 'vp-b vp-fs', icon('maximize'));
    fs.type = 'button';
    fs.setAttribute('aria-label', tx.full);
    fs.title = tx.full;
    bar.append(pp, tm, sk, mu, vl, rt, fs);
    box.append(bar);
  }
  host.append(box);

  // ── Адаптеры: file — <video>; yt — плеер YouTube через postMessage ──
  let ad: Adapter;
  let ytCleanup = () => {};
  if (o.source.kind === 'file') {
    const url = o.source.url;
    const media = q<HTMLVideoElement>('.vp-v');
    media.src = url;
    media.oncontextmenu = (e) => e.preventDefault();
    media.onloadedmetadata = () => {
      if (Number.isFinite(media.duration) && media.duration > 0) {
        const d = Math.round(media.duration);
        if (!duration || Math.abs(duration - d) > 1) {
          const unknown = !duration;
          duration = d;
          if (unknown) o.onDuration?.(d);
        }
        q('.vp-d').textContent = videoTime(dur());
        q<HTMLInputElement>('.vp-rg').max = String(dur());
      }
    };
    media.onplay = media.onpause = () => ui();
    media.onended = () => ended();
    media.onerror = () => fail('net');
    ad = {
      play: () => void media.play().catch(() => {}),
      pause: () => media.pause(),
      time: () => media.currentTime || 0,
      playing: () => !media.paused && !media.ended,
      rate: () => media.playbackRate,
      seek: (x) => {
        try {
          media.currentTime = x;
        } catch {
          // Перемотка до загрузки сведений о файле — не страшно.
        }
      },
      setRate: (r) => {
        media.playbackRate = r;
      },
      setVolume: (x, m) => {
        media.volume = x;
        media.muted = m;
      },
      stop: () => {
        media.pause();
        media.removeAttribute('src');
        media.load();
      },
      reload: (at) => {
        media.src = url;
        media.load();
        if (at) ad.seek(at);
        ad.play();
      },
    };
  } else {
    const ytId = o.source.ytId;
    const y = {
      t: 0,
      at: 0,
      st: -1,
      r: 1,
      ok: false,
      ifr: null as HTMLIFrameElement | null,
      tries: 0,
      hs: 0 as ReturnType<typeof setInterval> | 0,
    };
    const cmd = (func: string, args: unknown[] = []) => {
      try {
        y.ifr?.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' }),
          YT,
        );
      } catch {
        // Окно плеера уже закрыто.
      }
    };
    const onMessage = (e: MessageEvent) => {
      // Только сообщения нашего плеера с youtube-nocookie.com (ревью безопасности PR #208).
      if (!y.ifr || e.source !== y.ifr.contentWindow || e.origin !== YT) return;
      let d: unknown = e.data;
      try {
        if (typeof d === 'string') d = JSON.parse(d);
      } catch {
        return;
      }
      if (!d || typeof d !== 'object') return;
      const msg = d as { event?: unknown; info?: unknown };
      if (typeof msg.event !== 'string') return;
      if (!y.ok) {
        y.ok = true;
        if (y.hs) clearInterval(y.hs);
        for (const n of ['onStateChange', 'onError', 'onPlaybackRateChange']) {
          cmd('addEventListener', [n]);
        }
      }
      const info = (msg.info && typeof msg.info === 'object' ? msg.info : {}) as Record<
        string,
        unknown
      >;
      const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
      if (msg.event === 'infoDelivery' || msg.event === 'initialDelivery') {
        const ct = num(info.currentTime);
        if (ct !== null) {
          y.t = ct;
          y.at = performance.now();
        }
        const ps = num(info.playerState);
        if (ps !== null) y.st = ps;
        const pr = num(info.playbackRate);
        if (pr) y.r = pr;
        const id = num(info.duration);
        if (id && id > 0) {
          const dd = Math.round(id);
          if (!duration || Math.abs(duration - dd) > 1) {
            const unknown = !duration;
            duration = dd;
            if (unknown) o.onDuration?.(dd);
          }
        }
      }
      if (msg.event === 'onStateChange') {
        y.st = num(msg.info) ?? y.st;
        if (y.st === 1 && !T.started) o.onYt?.(true);
        if (y.st === 0) ended();
      }
      if (msg.event === 'onPlaybackRateChange') {
        const r = num(msg.info);
        if (r) y.r = r;
      }
      if (msg.event === 'onError') {
        const c = num(msg.info);
        fail(c === 100 || c === 101 || c === 150 ? 'yt' : 'net');
      }
    };
    window.addEventListener('message', onMessage);
    const load = (t0: number, autoplay = true) => {
      const h = q<HTMLDivElement>('.vp-yt');
      h.textContent = '';
      y.ok = false;
      y.st = -1;
      y.t = t0 || 0;
      y.at = performance.now();
      const f = document.createElement('iframe');
      const origin = /^https?:/.test(location.origin)
        ? `&origin=${encodeURIComponent(location.origin)}`
        : '';
      f.src = `${YT}/embed/${encodeURIComponent(ytId)}?enablejsapi=1&autoplay=${autoplay ? 1 : 0}&rel=0&playsinline=1&modestbranding=1&iv_load_policy=3${t0 > 1 ? `&start=${Math.floor(t0)}` : ''}${origin}`;
      f.title = v.title;
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      h.append(f);
      y.ifr = f;
      // Рукопожатие с плеером YouTube; нет ответа за 12 секунд — «Не удалось загрузить видео».
      const ping = () => {
        try {
          f.contentWindow?.postMessage(
            JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
            YT,
          );
        } catch {
          // Окно плеера ещё не готово.
        }
      };
      f.onload = ping;
      if (y.hs) clearInterval(y.hs);
      y.tries = 0;
      y.hs = setInterval(() => {
        if (y.ok) {
          if (y.hs) clearInterval(y.hs);
          return;
        }
        if (++y.tries > 48) {
          if (y.hs) clearInterval(y.hs);
          fail('net');
          return;
        }
        ping();
      }, 250);
    };
    ytCleanup = () => {
      if (y.hs) clearInterval(y.hs);
      window.removeEventListener('message', onMessage);
      if (y.ifr) {
        y.ifr.src = 'about:blank';
        y.ifr.remove();
      }
      y.ifr = null;
    };
    ad = {
      play: () => cmd('playVideo'),
      pause: () => cmd('pauseVideo'),
      time: () => (y.st === 1 ? y.t + ((performance.now() - y.at) / 1000) * y.r : y.t),
      playing: () => y.st === 1,
      rate: () => y.r,
      seek: (x) => cmd('seekTo', [x, true]),
      setRate: (r) => cmd('setPlaybackRate', [r]),
      setVolume: () => {},
      stop: () => ytCleanup(),
      reload: (at, autoplay) => load(at, autoplay),
    };
  }

  // ── Учёт ──
  const piece = (keep?: boolean) => {
    if (T.ps === null) return;
    const a = T.ps;
    const b = Math.min(T.pt, dur() || T.pt);
    if (b - a >= 0.2 && tracked) {
      sessionSegs = videoSegAdd(sessionSegs, a, b);
      if (o.track === 'user') {
        allSegs = videoSegAdd(allSegs, a, b);
        if (!done && dur() && videoSegLen(allSegs) >= dur() * VIDEO_DONE_SHARE) done = true;
      }
    }
    T.ps = keep ? T.pt : null;
  };
  const save = (final = false) => {
    if (o.track === 'user') o.onSave?.([...sessionSegs], Math.round(ad.time() * 10) / 10, final);
    o.onInfo?.(o.track === 'user' ? allSegs : sessionSegs, done);
  };
  // Просмотренное с идущим сейчас отрезком — для полосы под плеером и строки «Вы посмотрели N %».
  const live = () => {
    const base = o.track === 'user' ? allSegs : sessionSegs;
    return T.ps !== null && T.pt - T.ps >= 0.2
      ? videoSegAdd(base, T.ps, Math.min(T.pt, dur() || T.pt))
      : base;
  };
  const track = () => {
    const now = performance.now();
    const dt = Math.min(2, (now - T.w) / 1000);
    T.w = now;
    const t = ad.time();
    const pl = ad.playing() && !document.hidden;
    const r = ad.rate() || 1;
    if (pl && !T.started) {
      T.started = true;
      o.onStart?.();
    }
    if (T.ps !== null) {
      const cont = t >= T.pt - 0.3 && t <= T.pt + dt * r + 1.5;
      if (cont) T.pt = Math.max(T.pt, t);
      if (!cont || !pl) {
        piece();
        if (pl) {
          T.ps = t;
          T.pt = t;
        }
      }
    } else if (pl) {
      T.ps = T.lt !== null && t >= T.lt && t - T.lt <= dt * r + 0.6 ? T.lt : t;
      T.pt = t;
    }
    T.lt = t;
    if (pl) {
      T.acc += dt;
      T.ui += dt;
      const reached =
        o.track === 'user' && !done && dur() && videoSegLen(live()) >= dur() * VIDEO_DONE_SHARE;
      if (T.acc >= VIDEO_SAVE_SECONDS || reached) {
        T.acc = 0;
        T.ui = 0;
        piece(true);
        save();
      } else if (T.ui >= 1) {
        T.ui = 0;
        o.onInfo?.(live(), done);
      }
    }
    ui();
  };
  const tick = setInterval(track, 250);
  // Ушёл на другую вкладку или свернул окно браузера — видео встаёт на паузу.
  const onVisibility = () => {
    if (document.hidden && ad.playing()) {
      track();
      ad.pause();
      piece();
      save();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  function ui() {
    if (kind === 'yt') return;
    const t = ad.time();
    const d = dur() || 1;
    const pl = ad.playing();
    const pp = q<HTMLButtonElement>('.vp-pp');
    pp.innerHTML = icon(pl ? 'ps' : 'pl');
    pp.setAttribute('aria-label', pl ? tx.pause : tx.watch);
    q('.vp-c').textContent = videoTime(t);
    q<HTMLElement>('.vp-fill').style.width = `${((t / d) * 100).toFixed(2)}%`;
    const rg = q<HTMLInputElement>('.vp-rg');
    if (!T.drag) rg.value = String(t);
    const marks = live()
      .map(
        (x) =>
          `<i style="left:${((x[0] / d) * 100).toFixed(2)}%;width:${(((x[1] - x[0]) / d) * 100).toFixed(2)}%"></i>`,
      )
      .join('');
    const seg = q<HTMLElement>('.vp-seg');
    if (seg.dataset.k !== marks) {
      seg.dataset.k = marks;
      seg.innerHTML = marks;
    }
    box.classList.toggle('on', pl);
    box.classList.toggle('ended', T.ended && !pl);
    if (big) big.hidden = pl || !overlay.hidden;
  }
  function ended() {
    track();
    piece();
    T.ended = true;
    save();
    ui();
  }
  function fail(k: 'yt' | 'net') {
    if (T.dead) return;
    T.fail = k;
    piece();
    if (kind !== 'yt') ad.pause();
    if (k === 'yt') o.onYt?.(false);
    overlay.hidden = false;
    overlay.className = 'vp-ov err';
    overlay.textContent = '';
    overlay.insertAdjacentHTML('beforeend', icon('alert').replace('class="ic"', 'class="ic lg"'));
    const b = el('b');
    b.textContent = k === 'yt' ? tx.errYt : tx.errNet;
    overlay.append(b);
    if (k === 'yt') {
      const s = el('span');
      s.textContent = tx.errYtText;
      overlay.append(s);
    } else {
      const rb = el('button', 'vp-retry', icon('refresh'));
      rb.type = 'button';
      rb.append(document.createTextNode(tx.retry));
      rb.onclick = () => {
        overlay.hidden = true;
        T.fail = null;
        ad.reload(ad.time());
        ui();
      };
      overlay.append(rb);
    }
    if (big) big.hidden = true;
  }
  const go = (t0: number) => {
    overlay.hidden = true;
    T.lt = t0 || 0;
    if (kind === 'yt') {
      ad.reload(t0);
      return;
    }
    if (t0) ad.seek(t0);
    ad.play();
    ui();
  };
  // Видеоинструкцию, которую уже начинали, окно предлагает «Продолжить с 2:10» или «Сначала».
  const pos = o.initial?.pos ?? 0;
  const resume = o.track === 'user' && v.kind === 'instr' && pos > 5 && pos < dur() - 3 ? pos : 0;
  if (resume > 0) {
    overlay.hidden = false;
    overlay.className = 'vp-ov ask';
    const b = el('b');
    b.textContent = tx.resumeTitle;
    const row = el('span', 'vp-ask');
    const cont = el('button', 'vp-cont', icon('play'));
    cont.type = 'button';
    cont.append(document.createTextNode(tx.resumeGo(videoTime(resume))));
    cont.onclick = () => go(resume);
    const zero = el('button', 'vp-zero', icon('refresh'));
    zero.type = 'button';
    zero.append(document.createTextNode(tx.resumeZero));
    zero.onclick = () => go(0);
    row.append(cont, zero);
    overlay.append(b, row);
    if (big) big.hidden = true;
  } else if (o.auto !== false) {
    go(0);
  } else if (kind === 'yt') {
    // У YouTube своей кнопки ▶ нет: плеер загружается без запуска и показывает обложку YouTube.
    ad.reload(0, false);
  } else {
    ui();
  }

  // ── Управление: «▶» / «❚❚», шкала времени, громкость, скорость, «На весь экран» ──
  let onFs = () => {};
  if (kind === 'file' && big && bar) {
    const toggle = () => {
      if (T.fail || !overlay.hidden) return;
      if (ad.playing()) {
        track();
        ad.pause();
        piece();
        save();
      } else {
        T.ended = false;
        ad.play();
      }
      ui();
    };
    q<HTMLButtonElement>('.vp-pp').onclick = toggle;
    big.onclick = () => {
      if (!overlay.hidden) return;
      T.ended = false;
      T.lt = ad.time() >= dur() - 0.05 ? 0 : ad.time();
      ad.play();
      ui();
    };
    stage.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.vp-ov,.vp-big')) return;
      toggle();
    });
    const rg = q<HTMLInputElement>('.vp-rg');
    rg.oninput = () => {
      T.drag = true;
      track();
      piece();
      const x = Number(rg.value);
      ad.seek(x);
      T.ps = ad.playing() ? x : null;
      T.pt = x;
      q('.vp-c').textContent = videoTime(x);
      q<HTMLElement>('.vp-fill').style.width = `${((x / (dur() || 1)) * 100).toFixed(2)}%`;
    };
    rg.onchange = () => {
      T.drag = false;
      ui();
    };
    let vol = 1;
    let muted = false;
    const setVol = () => {
      ad.setVolume(vol, muted);
      const b = q<HTMLButtonElement>('.vp-mu');
      b.innerHTML = icon(muted || !vol ? 'mute' : 'vol');
      b.setAttribute('aria-label', muted ? tx.unmute : tx.mute);
    };
    q<HTMLButtonElement>('.vp-mu').onclick = () => {
      muted = !muted;
      setVol();
    };
    q<HTMLInputElement>('.vp-vl').oninput = (e) => {
      vol = Number((e.target as HTMLInputElement).value);
      muted = vol === 0;
      setVol();
    };
    q<HTMLSelectElement>('.vp-rt').onchange = (e) => {
      track();
      ad.setRate(Number((e.target as HTMLSelectElement).value));
    };
    const fsOn = () => document.fullscreenElement === box || box.classList.contains('vp-fake');
    const fsUi = () => {
      const on = fsOn();
      const b = q<HTMLButtonElement>('.vp-fs');
      b.innerHTML = icon(on ? 'minimize' : 'maximize');
      b.setAttribute('aria-label', on ? tx.unfull : tx.full);
      b.title = on ? tx.unfull : tx.full;
    };
    q<HTMLButtonElement>('.vp-fs').onclick = () => {
      if (fsOn()) {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        box.classList.remove('vp-fake');
      } else if (box.requestFullscreen) {
        box.requestFullscreen().catch(() => box.classList.add('vp-fake'));
      } else {
        box.classList.add('vp-fake');
      }
      setTimeout(fsUi, 60);
    };
    onFs = fsUi;
    document.addEventListener('fullscreenchange', onFs);
  }

  return {
    // Клавиши на ПК: пробел — пауза, ← → — на 5 секунд назад и вперёд.
    key(e) {
      if (kind === 'yt' || T.fail || !overlay.hidden) return false;
      if (e.key === ' ' || e.code === 'Space') {
        q<HTMLButtonElement>('.vp-pp').click();
        return true;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        track();
        piece();
        const t = Math.max(0, Math.min(dur(), ad.time() + (e.key === 'ArrowLeft' ? -5 : 5)));
        ad.seek(t);
        T.ps = ad.playing() ? t : null;
        T.pt = t;
        ui();
        return true;
      }
      return false;
    },
    pause() {
      if (ad.playing()) {
        track();
        ad.pause();
        piece();
        save();
      }
    },
    destroy() {
      if (T.dead) return;
      track();
      piece();
      save(true);
      T.dead = true;
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFs);
      ad.stop();
      if (o.track === 'guest' && T.started && dur()) {
        o.onGuestEnd?.(Math.min(100, (videoSegLen(sessionSegs) / dur()) * 100));
      }
    },
  };
}

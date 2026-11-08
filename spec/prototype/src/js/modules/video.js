'use strict';
// Видео платформы (решение заказчика 08.11.2026): «Окно видео», учёт просмотров, вкладки «Видео» и «Просмотры видео» Базы знаний,
// видеоинструкции в «?» модуля и кнопка «▶» в верхней панели, ссылки на видео из статей, новостей и шагов уроков
/* ═════════════ Данные ═════════════ */
// VIDEOS — видео платформы (refDB.videos, ведёт администратор платформы); VVIEWS — просмотры (TemDB.videoViews): у сотрудников своей
// организации u — код сотрудника, у демо-просмотров других организаций (видны администратору платформы) — org и логин; VGUEST — гости лендинга, только числа
const VIDEOS=DB.ref.videos,VVIEWS=DB.videoViews,VGUEST=DB.videoGuest;
// Файлы, загруженные в прототипе, хранятся только в памяти браузера и играют до перезагрузки страницы; в TemDB — только сведения о видео
const VID_BLOB={};
const VID={pend:null,pf:null,vf:null};
const VID_K={instr:'Видеоинструкция',pres:'Презентация'};
const VID_RATES=[.75,1,1.25,1.5,2];
const vidT=s=>{s=Math.max(0,Math.floor(s||0));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),c=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${c}`:`${m}:${c}`};
const vidById=id=>VIDEOS.find(v=>v.id===id);
const vidLive=v=>!!v&&!v.del&&v.status==='Опубликовано'&&!v.off;
const vidModT=v=>v.mod?(kbModT(v.mod)||v.mod):'Общее';
// Группы «Видео»: сначала «Общее», дальше в порядке левой панели, внутри — в порядке, который задал администратор платформы
const vidModOrd=v=>{if(!v.mod)return -1;const i=mods().findIndex(m=>m.id===v.mod);return i>=0?i:500+[...BIZ,...ADM].findIndex(m=>m.id===v.mod)};
// Видео модулей, недоступных по правам или выключенных в учётной политике, не показываются; «только режим Админка» — только администратору платформы
function vidOk(v){if(!vidLive(v))return false;if(isAdmin())return true;if(v.aud==='adm')return false;return !v.mod||mods().some(m=>m.id===v.mod)}
const vidSortF=(a,b)=>vidModOrd(a)-vidModOrd(b)||(a.ord||0)-(b.ord||0)||COLL.compare(a.t,b.t);
const vidList=()=>VIDEOS.filter(vidOk).sort(vidSortF);
const vidOfMod=mod=>vidList().filter(v=>v.kind==='instr'&&v.mod===mod);
const vidLand=()=>VIDEOS.filter(v=>vidLive(v)&&v.land&&v.aud!=='adm').sort((a,b)=>(a.landOrd||99)-(b.landOrd||99)||(a.ord||0)-(b.ord||0));
const vidKindPill=v=>`<span class="pill sm ${v.kind==='pres'?'purple':'blue'}">${VID_K[v.kind]||''}</span>`;
const vidPubAt=v=>((v.hist||[]).filter(h=>h.to==='Опубликовано').pop()||{}).at||v._ca||'';
// Отрезки просмотренных секунд: [[с, по], …] без пересечений; каждая секунда видео считается один раз
function segAdd(l,a,b){if(!(b>a))return l||[];const s=[...(l||[]),[a,b]].sort((x,y)=>x[0]-y[0]);const o=[];s.forEach(x=>{const t=o[o.length-1];if(t&&x[0]<=t[1]+.25)t[1]=Math.max(t[1],x[1]);else o.push([x[0],x[1]])});return o.map(x=>[Math.round(x[0]*10)/10,Math.round(x[1]*10)/10])}
const segLen=l=>(l||[]).reduce((a,x)=>a+Math.max(0,x[1]-x[0]),0);
const vidRec=(vid,u,mk)=>{u=u||S.me;let r=VVIEWS.find(x=>!x.org&&x.u===u&&x.v===vid);if(!r&&mk){r={u,v:vid,segs:[],ses:[],pos:0};VVIEWS.push(r)}return r||null};
const vidSecs=(v,r)=>Math.min(v&&v.dur||Infinity,segLen(r&&r.segs));
const vidPct=(v,r)=>!r||!v||!v.dur?0:Math.min(100,Math.floor(vidSecs(v,r)/v.dur*100+1e-6));
// Статусы: «Не смотрел», «Начал» (меньше 90 % секунд видео), «Просмотрено» (не меньше 90 %); «Просмотрено» ставится один раз и не снимается
const vidSt=(v,r)=>r&&r.done?'Просмотрено':r&&segLen(r.segs)>=1?'Начал':'Не смотрел';
const vidStPill=st=>`<span class="pill sm ${st==='Просмотрено'?'green':st==='Начал'?'yellow':'faint'}">${st==='Просмотрено'?ic('ok')+' ':''}${st}</span>`;
const vidNew=v=>!isAdmin()&&v.kind==='instr'&&!vidRec(v.id);
const vidHue=v=>{let h=0;for(const c of String(v.id||v.t||''))h=(h*31+c.charCodeAt(0))%360;return 190+h%60};
// Обложка: своя (копия в хранилище платформы), кадр с первой секунды файла, у YouTube — обложка YouTube (на лендинге без обращения к YouTube — рисованная)
function vidCover(v,o={}){const im=v.cover||v.frame||(v.src==='yt'&&v.yt&&!o.land?`https://i.ytimg.com/vi/${v.yt}/hqdefault.jpg`:'');const m=[...BIZ,...ADM].find(x=>x.id===v.mod);
  return `<span class="vcv ${o.cls||''}" style="--vh:${vidHue(v)}">${im?`<img src="${esc(im)}" alt="" loading="lazy" decoding="async">`:`<span class="vcv-g" aria-hidden="true"><span class="vcv-ic">${ic(m?m.icon:'film')}</span><span class="vcv-t">${esc(v.t)}</span></span>`}${o.nop?'':`<span class="vcv-p" aria-hidden="true">${ic('pl')}</span>`}${v.dur&&!o.nod?`<span class="vcv-d">${vidT(v.dur)}</span>`:''}${o.isNew?'<span class="vcv-n">Новое</span>':''}</span>`}
// Полоса просмотра или «Просмотрено» — у видеоинструкций и у того, чьи просмотры учитываются
function vidProg(v){if(isAdmin())return '';const r=vidRec(v.id);if(r&&r.done)return `<span class="vprog done">${ic('ok','sm')}Просмотрено</span>`;const p=vidPct(v,r);return p?`<span class="vprog"><span class="bar" aria-hidden="true"><i style="width:${p}%"></i></span><span>${p} %</span></span>`:''}
function vidCardHtml(v){return `${vidCover(v,{isNew:vidNew(v)})}<span class="vcard-b"><b class="vcard-t">${esc(v.t)}</b><span class="vcard-m">${vidKindPill(v)}<span class="tag">${esc(vidModT(v))}</span></span>${v.kind==='instr'?vidProg(v):''}</span>`}
const vidLink=v=>location.href.replace(/#.*$/,'')+'#video/'+v.id;
const vidCopy=v=>copyText(vidLink(v),'Ссылка скопирована: она открывает видео в «Базе знаний»; без входа — сначала страница входа');
// Ссылка YouTube: youtube.com/watch?v=…, youtu.be/…, youtube.com/shorts/…, youtube.com/embed/…
function ytId(u){const m=/^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([\w-]{11})(?:[?&#/][^\s]*)?$/.exec(String(u||'').trim());return m?m[1]:null}

/* ═════════════ Плеер ═════════════ */
// Один плеер для «Окна видео» и карточки видео в Админке. Источник: файл платформы — встроенный плеер браузера без кнопки скачивания;
// YouTube — встроенный плеер www.youtube-nocookie.com, загружается только после открытия окна; начальные видео-файлы прототипа — имитация плеера.
// o: {track:'user'|'guest'|null, start, onInfo(), onDur(d), onYt(ok)}
function vidPlayer(host,v,o={}){
  const kind=v.src==='yt'?'yt':v.src==='file'&&VID_BLOB[v.id]?'file':'sim';const dur=()=>v.dur||0;
  const rec=o.track==='user'?vidRec(v.id,S.me,true):null;const ses=o.track?{at:nowStamp(),p:[]}:null;if(rec)rec.ses.push(ses);
  const T={ps:null,pt:0,lt:null,ui:0,w:performance.now(),acc:0,started:false,ended:false,drag:false,fail:null,dead:false};
  host.innerHTML=`<div class="vp-box vk-${kind}" tabindex="-1"><div class="vp-st">${kind==='sim'?`<div class="vp-sim">${vidCover(v,{cls:'vp-cv',land:o.track==='guest',nop:1,nod:1})}<span class="vp-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="vp-cap">${ic('info','sm')}<span>Прототип: на сайте здесь играет видео из хранилища</span></span></div>`:kind==='file'?'<video class="vp-v" playsinline preload="metadata" controlslist="nodownload noremoteplayback noplaybackrate" disablepictureinpicture disableremoteplayback></video>':'<div class="vp-yt"></div>'}
    ${kind==='yt'?'':`<button type="button" class="vp-big" aria-label="Смотреть">${ic('pl')}</button>`}<div class="vp-ov" hidden></div></div>
    ${kind==='yt'?'':`<div class="vp-bar"><button type="button" class="vp-b vp-pp" aria-label="Смотреть" title="Смотреть${isMobile()?'':' (пробел)'}">${ic('pl')}</button><span class="vp-tm"><span class="vp-c">0:00</span> / <span class="vp-d">${vidT(dur())}</span></span>
      <span class="vp-sk"><span class="vp-tr"><span class="vp-seg"></span><span class="vp-fill"></span></span><input type="range" class="vp-rg" min="0" max="${dur()||1}" step="0.1" value="0" aria-label="Шкала времени"></span>
      <button type="button" class="vp-b vp-mu" aria-label="Выключить звук" title="Звук">${ic('vol')}</button><input type="range" class="vp-vl" min="0" max="1" step="0.05" value="1" aria-label="Громкость">
      <select class="vp-rt" aria-label="Скорость" title="Скорость">${VID_RATES.map(r=>`<option value="${r}" ${r===1?'selected':''}>${String(r).replace('.',',')}×</option>`).join('')}</select>
      <button type="button" class="vp-b vp-fs" aria-label="На весь экран" title="На весь экран">${ic('maximize')}</button></div>`}</div>`;
  const box=$('.vp-box',host),st=$('.vp-st',host),ov=$('.vp-ov',host),big=$('.vp-big',host);
  // Адаптеры: sim — свои часы; file — <video>; yt — плеер YouTube через postMessage (без внешнего скрипта)
  let ad;
  if(kind==='sim'){const s={t:0,on:false,r:1};ad={play(){if(s.t>=dur()-.05)s.t=0;s.on=true;T.w=performance.now();ui()},pause(){s.on=false;ui()},time:()=>s.t,playing:()=>s.on,rate:()=>s.r,seek(x){s.t=Math.max(0,Math.min(dur(),x));ui()},setRate(r){s.r=r},setVol(){},adv(dt){if(!s.on)return;s.t=Math.min(dur(),s.t+dt*s.r);if(s.t>=dur()){s.on=false;ended()}},stop(){s.on=false}}}
  else if(kind==='file'){const e=$('.vp-v',host);e.src=VID_BLOB[v.id];e.oncontextmenu=x=>x.preventDefault();
    e.onloadedmetadata=()=>{if(isFinite(e.duration)&&e.duration>0){const d=Math.round(e.duration);if(!v.dur||Math.abs(v.dur-d)>1){v.dur=d;if(o.onDur)o.onDur(d);dbSoon()}$('.vp-d',host).textContent=vidT(dur());$('.vp-rg',host).max=dur()}};
    e.onplay=e.onpause=()=>ui();e.onended=()=>ended();e.onerror=()=>fail('net');
    ad={play(){e.play().catch(()=>{})},pause(){e.pause()},time:()=>e.currentTime||0,playing:()=>!e.paused&&!e.ended,rate:()=>e.playbackRate,seek(x){try{e.currentTime=x}catch(z){}},setRate(r){e.playbackRate=r},setVol(x,m){e.volume=x;e.muted=m},adv(){},stop(){e.pause();e.removeAttribute('src');e.load()}}}
  else{const y={t:0,at:0,st:-1,r:1,ok:false,ifr:null,tries:0,hs:0};const W='https://www.youtube-nocookie.com';
    const cmd=(f,a=[])=>{try{y.ifr&&y.ifr.contentWindow.postMessage(JSON.stringify({event:'command',func:f,args:a,id:1,channel:'widget'}),W)}catch(z){}};
    y.msg=e=>{if(!y.ifr||e.source!==y.ifr.contentWindow)return;let d=e.data;try{if(typeof d==='string')d=JSON.parse(d)}catch(z){return}if(!d||!d.event)return;
      if(!y.ok){y.ok=true;clearInterval(y.hs);['onStateChange','onError','onPlaybackRateChange'].forEach(n=>cmd('addEventListener',[n]))}
      const i=d.info||{};if(d.event==='infoDelivery'||d.event==='initialDelivery'){if(i.currentTime!=null){y.t=+i.currentTime;y.at=performance.now()}if(i.playerState!=null)y.st=+i.playerState;if(i.playbackRate)y.r=+i.playbackRate;if(i.duration>0){const dd=Math.round(i.duration);if(!v.dur||Math.abs(v.dur-dd)>1){v.dur=dd;if(o.onDur)o.onDur(dd);dbSoon()}}}
      if(d.event==='onStateChange'){y.st=+d.info;if(y.st===1){T.started=true;if(v.ytBad){v.ytBad=false;dbSoon()}if(o.onYt)o.onYt(true)}if(y.st===0)ended()}
      if(d.event==='onPlaybackRateChange'&&d.info)y.r=+d.info;
      if(d.event==='onError'){const c=+d.info;fail(c===100||c===101||c===150?'yt':'net')}};
    addEventListener('message',y.msg);
    y.load=t0=>{const h=$('.vp-yt',host);h.innerHTML='';y.ok=false;y.st=-1;y.t=t0||0;y.at=performance.now();const f=document.createElement('iframe');
      f.src=`${W}/embed/${encodeURIComponent(v.yt)}?enablejsapi=1&autoplay=1&rel=0&playsinline=1&modestbranding=1&iv_load_policy=3${t0>1?'&start='+Math.floor(t0):''}${/^https?:/.test(location.origin)?'&origin='+encodeURIComponent(location.origin):''}`;
      f.title=v.t;f.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';f.allowFullscreen=true;f.referrerPolicy='strict-origin-when-cross-origin';h.append(f);y.ifr=f;
      // Рукопожатие с плеером YouTube; нет ответа за 12 секунд (нет связи) — «Не удалось загрузить видео»
      const ping=()=>{try{f.contentWindow.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}),W)}catch(z){}};f.onload=ping;clearInterval(y.hs);y.tries=0;y.hs=setInterval(()=>{if(y.ok){clearInterval(y.hs);return}if(++y.tries>48){clearInterval(y.hs);fail('net');return}ping()},250)};
    ad={play(){cmd('playVideo')},pause(){cmd('pauseVideo')},time:()=>y.st===1?y.t+(performance.now()-y.at)/1000*y.r:y.t,playing:()=>y.st===1,rate:()=>y.r,seek(x){cmd('seekTo',[x,true])},setRate(r){cmd('setPlaybackRate',[r])},setVol(){},adv(){},stop(){clearInterval(y.hs);removeEventListener('message',y.msg);if(y.ifr){y.ifr.src='about:blank';y.ifr.remove()}y.ifr=null},y}}
  // Учёт: секунды, которые действительно проигрались при видимой вкладке; перемотка вперёд пропущенное не засчитывает
  const piece=keep=>{if(T.ps==null)return;const a=T.ps,b=Math.min(T.pt,dur()||T.pt);if(b-a>=.2&&ses){ses.p=segAdd(ses.p,a,b);if(rec){rec.segs=segAdd(rec.segs,a,b);done()}}if(keep)T.ps=T.pt;else T.ps=null};
  const done=()=>{if(!rec||rec.done||!dur())return;if(segLen(rec.segs)>=dur()*.9){rec.done=nowStamp();vidDone(v)}};
  const save=()=>{if(rec){rec.pos=Math.round(ad.time()*10)/10;dbSoon()}if(o.onInfo)o.onInfo(rec)};
  // Просмотренное с учётом идущего сейчас отрезка — для полосы под плеером и строки «Вы посмотрели N %»
  const live=()=>{const b=(rec?rec.segs:ses?ses.p:[])||[];return T.ps!=null&&T.pt-T.ps>=.2?segAdd(b,T.ps,Math.min(T.pt,dur()||T.pt)):b};
  const track=()=>{const now=performance.now(),dt=Math.min(2,(now-T.w)/1000);T.w=now;ad.adv(document.hidden?0:dt);const t=ad.time(),pl=ad.playing()&&!document.hidden,r=ad.rate()||1;
    if(pl&&!T.started){T.started=true;if(o.track==='guest'){const g=VGUEST[v.id]=VGUEST[v.id]||{n:0,p:0};g.n++;dbSoon()}}
    if(T.ps!=null){const cont=t>=T.pt-.3&&t<=T.pt+dt*r+1.5;if(cont)T.pt=Math.max(T.pt,t);if(!cont||!pl){piece();if(pl){T.ps=t;T.pt=t}}}
    else if(pl){T.ps=T.lt!=null&&t>=T.lt&&t-T.lt<=dt*r+.6?T.lt:t;T.pt=t}
    T.lt=t;
    // Прогресс сохраняется каждые 15 секунд просмотра, при паузе и при закрытии окна; набралось 90 % — «Просмотрено» сразу
    if(pl){T.acc+=dt;T.ui+=dt;if(T.acc>=15||(rec&&!rec.done&&dur()&&segLen(live())>=dur()*.9)){T.acc=0;T.ui=0;piece(true);save()}else if(T.ui>=1){T.ui=0;if(o.onInfo)o.onInfo(rec&&{segs:live(),done:rec.done})}}ui()};
  const tk=setInterval(track,250);
  // Ушёл на другую вкладку или свернул окно браузера — видео встаёт на паузу
  const onVis=()=>{if(document.hidden&&ad.playing()){track();ad.pause();piece();save()}};document.addEventListener('visibilitychange',onVis);
  function ui(){if(kind==='yt')return;const t=ad.time(),d=dur()||1,pl=ad.playing();const pp=$('.vp-pp',host);pp.innerHTML=ic(pl?'ps':'pl');pp.setAttribute('aria-label',pl?'Пауза':'Смотреть');
    $('.vp-c',host).textContent=vidT(t);$('.vp-fill',host).style.width=(t/d*100).toFixed(2)+'%';const rg=$('.vp-rg',host);if(!T.drag)rg.value=t;
    const sg=live();const sh=sg.map(x=>`<i style="left:${(x[0]/d*100).toFixed(2)}%;width:${((x[1]-x[0])/d*100).toFixed(2)}%"></i>`).join('');const se=$('.vp-seg',host);if(se.dataset.k!==sh){se.dataset.k=sh;se.innerHTML=sh}
    box.classList.toggle('on',pl);box.classList.toggle('ended',T.ended&&!pl);if(big)big.hidden=pl||!ov.hidden}
  function ended(){track();piece();T.ended=true;if(rec)rec.pos=dur();save();ui()}
  function fail(k){if(T.dead)return;T.fail=k;piece();ad.pause&&kind!=='yt'&&ad.pause();if(k==='yt'&&!v.ytBad){v.ytBad=true;dbSoon()}if(k==='yt'&&o.onYt)o.onYt(false);
    ov.hidden=false;ov.className='vp-ov err';ov.innerHTML=k==='yt'?`${ic('alert','lg')}<b>Видео недоступно на YouTube</b><span>Его удалили или закрыли на YouTube.</span>`:`${ic('alert','lg')}<b>Не удалось загрузить видео. Проверьте подключение и попробуйте ещё раз</b><button type="button" class="btn" data-vp-retry>${ic('refresh','sm')}Повторить</button>`;
    const rb=$('[data-vp-retry]',ov);if(rb)rb.onclick=()=>{ov.hidden=true;T.fail=null;if(kind==='yt')ad.y.load(ad.time());else if(kind==='file'){const e=$('.vp-v',host);e.src=VID_BLOB[v.id]||'';e.load();ad.play()}ui()};if(big)big.hidden=true}
  const go=t0=>{ov.hidden=true;T.lt=t0||0;if(kind==='yt'){ad.y.load(t0);return}if(t0)ad.seek(t0);ad.play();ui()};
  // Видеоинструкцию, которую уже начинали, окно предлагает «Продолжить с 2:10» или «Сначала»
  const rp=o.start!=null?o.start:rec&&v.kind==='instr'&&rec.pos>5&&rec.pos<dur()-3?rec.pos:0;
  if(rp>0&&o.start==null){ov.hidden=false;ov.className='vp-ov ask';ov.innerHTML=`<b>Вы уже начинали это видео</b><span class="row" style="gap:8px;justify-content:center;flex-wrap:wrap"><button type="button" class="btn cta" data-vp-cont>${ic('play','sm')}Продолжить с ${vidT(rp)}</button><button type="button" class="btn" data-vp-zero>${ic('refresh','sm')}Сначала</button></span>`;
    $('[data-vp-cont]',ov).onclick=()=>go(rp);$('[data-vp-zero]',ov).onclick=()=>go(0);if(big)big.hidden=true}else if(o.auto!==false)go(rp);else ui();
  // Управление: «▶» / «❚❚», шкала времени, громкость, скорость, «На весь экран»
  if(kind!=='yt'){const tog=()=>{if(T.fail||!ov.hidden)return;if(ad.playing()){track();ad.pause();piece();save()}else{T.ended=false;ad.play()}ui()};
    $('.vp-pp',host).onclick=tog;big.onclick=()=>{if(!ov.hidden)return;T.ended=false;T.lt=ad.time()>=dur()-.05?0:ad.time();ad.play();ui()};st.addEventListener('click',e=>{if(e.target.closest('.vp-ov,.vp-big'))return;tog()});
    const rg=$('.vp-rg',host);rg.oninput=()=>{T.drag=true;track();piece();ad.seek(+rg.value);T.ps=ad.playing()?+rg.value:null;T.pt=+rg.value;$('.vp-c',host).textContent=vidT(+rg.value);$('.vp-fill',host).style.width=(+rg.value/(dur()||1)*100).toFixed(2)+'%'};rg.onchange=()=>{T.drag=false;ui()};
    let vol=1,mu=false;const sv=()=>{ad.setVol(vol,mu);const b=$('.vp-mu',host);b.innerHTML=ic(mu||!vol?'mute':'vol');b.setAttribute('aria-label',mu?'Включить звук':'Выключить звук')};
    $('.vp-mu',host).onclick=()=>{mu=!mu;sv()};$('.vp-vl',host).oninput=e=>{vol=+e.target.value;mu=vol===0;sv()};
    $('.vp-rt',host).onchange=e=>{track();ad.setRate(+e.target.value)};
    const fsOn=()=>document.fullscreenElement===box||box.classList.contains('vp-fake');
    $('.vp-fs',host).onclick=()=>{if(fsOn()){if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});box.classList.remove('vp-fake')}else if(box.requestFullscreen)box.requestFullscreen().catch(()=>box.classList.add('vp-fake'));else box.classList.add('vp-fake');setTimeout(fsUi,60)};
    const fsUi=()=>{const on=fsOn();const b=$('.vp-fs',host);b.innerHTML=ic(on?'minimize':'maximize');b.setAttribute('aria-label',on?'Свернуть':'На весь экран');b.title=on?'Свернуть':'На весь экран'};document.addEventListener('fullscreenchange',fsUi)}
  return {kind,rec,ses,
    // Клавиши на ПК: пробел — пауза, ← → — на 5 секунд назад и вперёд
    key(e){if(kind==='yt'||T.fail||!ov.hidden)return false;if(e.key===' '||e.code==='Space'){$('.vp-pp',host).click();return true}if(e.key==='ArrowLeft'||e.key==='ArrowRight'){track();piece();const t=Math.max(0,Math.min(dur(),ad.time()+(e.key==='ArrowLeft'?-5:5)));ad.seek(t);T.ps=ad.playing()?t:null;T.pt=t;ui();return true}return false},
    pause(){if(ad.playing()){track();ad.pause();piece();save()}},
    destroy(){if(T.dead)return;track();piece();save();T.dead=true;clearInterval(tk);document.removeEventListener('visibilitychange',onVis);ad.stop();
      if(o.track==='guest'&&T.started&&dur()){const g=VGUEST[v.id]=VGUEST[v.id]||{n:1,p:0};g.p=Math.round((g.p+Math.min(100,segLen(ses.p)/dur()*100))*10)/10;dbSoon()}}}}
// «Просмотрено» засчитывает шаги «Посмотреть», к которым привязано это видео (способ «видео»)
function vidDone(v){const l=typeof ckAll==='function'?ckAll().filter(i=>i.learn&&i.video===v.id&&ckMark(i,'video')):[];
  if(l.length){kbSync(false);renderSide();if(typeof renderSheetDot==='function')renderSheetDot()}
  toast(l.length?`Видео просмотрено: шаг «${l[0].t}» засчитан`:`Видео «${v.t}» просмотрено`,'grad');dbSoon()}

/* ═════════════ Окно видео ═════════════ */
// Одно окно для всех видео: База знаний, «?» модуля, статьи, новости, шаги уроков, лендинг. Крестик и Esc закрывают, нажатие мимо окна — нет
function vidOpen(id,o={}){const v=vidById(id);const guest=!!o.guest;
  const can_=v&&!v.del&&(guest?vidLive(v)&&v.land:isAdmin()||vidOk(v));
  if(!can_){if(v&&!v.del&&vidLive(v)&&!guest)return toast('Это видео вам недоступно: модуль выключен или нет прав','lock');
    return openModal({noMax:true,render:()=>({title:'Видео снято с публикации',body:`<div class="state" style="padding:18px 8px">${ic('film','lg')}<b>Видео снято с публикации</b><span>Это видео больше не показывается. Другие видео — во вкладке «Видео» Базы знаний.</span></div>`,foot:`${!guest&&S.loggedIn!==false?`<button class="btn ghost" id="vx-kb">${ic('film','sm')}Все видео</button>`:''}<div class="grow"></div><button class="btn cta" data-close>Закрыть</button>`,mount(el,m){const b=$('#vx-kb',el);if(b)b.onclick=()=>{m.close();go('kb','video')}}})})}
  MODALS.filter(m=>m.vid).forEach(m=>m.close());
  const track=guest?'guest':isAdmin()?null:'user';let ctl=null;
  const art=!guest&&v.art?kbArts().find(a=>a.id===v.art):null;const modOk=!guest&&v.kind==='instr'&&v.mod&&v.mod!==S.mod&&mods().some(m=>m.id===v.mod);
  const line=r=>{if(guest)return '';if(!track)return `<span class="muted">${ic('info','sm')} Просмотры администратора платформы в статистику не попадают</span>`;if(r&&r.done)return `<span class="vprog done">${ic('ok','sm')}Просмотрено</span>`;const p=vidPct(v,r);return `<span class="vprog"><span class="bar" aria-hidden="true"><i style="width:${p}%"></i></span><span>Вы посмотрели ${p} %</span></span>`};
  const m=openModal({size:'wide',sticky:true,noMax:true,swipeHead:true,render:()=>({title:esc(v.t),sub:`${VID_K[v.kind]}${v.mod?' · '+esc(vidModT(v)):''}${v.dur?' · '+vidT(v.dur):''}${v.status==='Черновик'?' · <span class="pill sm faint">Черновик</span>':v.off?' · <span class="pill sm red">Снято с публикации</span>':''}`,
    body:`<div class="vid-w"><div class="vid-p"></div><div class="vid-i"><div class="vid-l">${line(vidRec(v.id))}</div>${v.desc?`<p class="vid-d">${esc(v.desc)}</p>`:''}</div></div>`,
    foot:`${art?`<button class="btn ghost" id="vd-art">${ic('book','sm')}Статья: ${esc(art.t.length>34?art.t.slice(0,32)+'…':art.t)}</button>`:''}${modOk?`<button class="btn ghost" id="vd-go">${ic('right','sm')}Перейти в модуль</button>`:''}<div class="grow"></div><button class="btn cta" data-close>Закрыть</button>`,
    mount(el,mm){if(ctl)ctl.destroy();ctl=vidPlayer($('.vid-p',el),v,{track,onInfo:r=>{const l=$('.vid-l',el);if(l)l.innerHTML=line(r)}});mm.ctl=ctl;
      const a=$('#vd-art',el);if(a)a.onclick=()=>{mm.close();kbArtDlg(art)};const g=$('#vd-go',el);if(g)g.onclick=()=>{mm.close();MODALS.slice().forEach(x=>x.close());go(v.mod)}}}),
    onClose:()=>{if(ctl)ctl.destroy();document.removeEventListener('keydown',kd,true);if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});if(S.mod==='kb'&&!guest&&!LAND.open)setTimeout(()=>{if(!MODALS.length)renderPage()},0);if(o.onClose)o.onClose()}});
  m.vid=v.id;m.el.classList.add('vid-m');
  const kd=e=>{if(MODALS[MODALS.length-1]!==m||isMobile())return;const t=e.target;if(t&&t.closest&&t.closest('input:not([type=range]),select,textarea,[contenteditable]'))return;if(e.ctrlKey||e.metaKey||e.altKey)return;if(ctl&&ctl.key(e)){e.preventDefault();e.stopPropagation()}};
  document.addEventListener('keydown',kd,true);return m}
// Ссылка #video/<код>: открывает вкладку «Видео» Базы знаний с окном видео; без входа — сначала страница входа
function vidRoute(){const x=/^#video\/([\w-]+)$/.exec(location.hash);if(!x)return false;const id=x[1];history.replaceState(history.state,'','#kb.video');
  if(S.loggedIn===false){VID.pend=id;return false}setTimeout(()=>vidOpen(id),60);return false}
function vidPendGo(){if(!VID.pend||S.loggedIn===false)return;const id=VID.pend;VID.pend=null;setTimeout(()=>{go('kb','video');setTimeout(()=>vidOpen(id),80)},120)}
// Кнопка «▶ <название> · 3:25» в тексте статьи и новости
function vidMdBtn(id,lab){const v=vidById(id);return `<button type="button" class="md-vid" data-vopen="${esc(id)}">${ic('pl','sm')}<span>${v?esc(v.t):lab||'Видео'}${v&&v.dur?' · '+vidT(v.dur):''}</span></button>`}
document.addEventListener('click',e=>{const b=e.target.closest('[data-vopen],[data-vall]');if(!b)return;e.preventDefault();
  if(b.dataset.vopen){vidOpen(b.dataset.vopen);return}
  const mod=b.dataset.vall;MODALS.slice().forEach(m=>m.close());VID.vf=mod;go('kb','video',{mod:{type:'enum',vals:[kbModT(mod)]}})});

/* ═════════════ «?» модуля и кнопка «▶» в верхней панели ═════════════ */
// В окне «?» первой стоит карточка видео (до трёх) и «Все видео модуля», если их больше одного
function vidHelpHtml(mod){const l=vidOfMod(mod);if(!l.length)return '';return `<div class="vh"><div class="vh-h"><b>${ic('film','sm')}${l.length>1?'Видеоинструкции модуля':'Видеоинструкция модуля'}</b>${l.length>1?`<button type="button" class="linkbtn" data-vall="${esc(mod)}">Все видео модуля · ${l.length}</button>`:''}</div><div class="vh-l">${l.slice(0,3).map(v=>`<button type="button" class="vh-c" data-vopen="${v.id}">${vidCover(v,{cls:'sm',isNew:vidNew(v)})}<span class="vh-t"><b>${esc(v.t)}</b><span class="muted">${vidT(v.dur)}</span>${vidProg(v)}</span></button>`).join('')}</div></div>`}
// На ПК у модуля с видеоинструкцией слева от «?» — «▶»: сразу открывает первую видеоинструкцию модуля; на телефоне видео — только в окне «?»
function vidTopSync(){const b=$('#vhelp');if(!b)return;const l=S.loggedIn===false?[]:vidOfMod(S.mod);b.hidden=!l.length;if(!l.length)return;const v=l[0];b.innerHTML=ic('film');b.title=`Видеоинструкция: ${v.t}`;b.setAttribute('aria-label',`Видеоинструкция: ${v.t}`);b.onclick=()=>vidOpen(v.id)}

/* ═════════════ База знаний: «Видео» ═════════════ */
function renderKbVideo(body,fresh){const l=vidList();const tr=!isAdmin();
  if(!l.length){body.innerHTML=`<div class="state">${ic('film','lg')}<b>Видео пока нет</b><span>Видеоинструкции к модулям и презентации добавляет администратор платформы.</span></div>`;return}
  const un=tr?l.filter(v=>vidSt(v,vidRec(v.id))!=='Просмотрено').length:0;const pf=VID.pf;VID.pf=null;
  body.innerHTML=`${tr?`<div class="plates vk-pl">${plate({id:'vk-un',icon:'film',color:un?'blue':'green',label:'Не просмотренные',value:un,sub:un?'видео, которые вы ещё не досмотрели':'вы посмотрели все видео',on:VID.unseen})}</div>`:''}<div id="kbv"></div>`;
  grid($('#kbv',body),{id:'kb-video',defView:'cards',defGroup:['mod'],cols:[
    {key:'t',label:'Название',type:'text',w:320,val:v=>v.t,html:v=>`<span class="strong">${esc(v.t)}</span>${vidNew(v)?' <span class="pill sm red">Новое</span>':''}`},
    {key:'kind',label:'Вид',type:'enum',w:170,val:v=>VID_K[v.kind],html:vidKindPill},
    {key:'mod',label:'Модуль',type:'enum',w:230,val:vidModT,sortVal:vidModOrd},
    {key:'dur',label:'Длительность',type:'text',w:130,num:true,val:v=>vidT(v.dur),sortVal:v=>v.dur||0},
    {key:'pct',label:'Просмотрено, %',type:'int',w:150,num:true,agg:'',val:v=>tr?vidPct(v,vidRec(v.id)):'',html:v=>tr?(vidRec(v.id)&&vidRec(v.id).done?`<span class="green">${ic('ok','sm')} ${vidPct(v,vidRec(v.id))}</span>`:String(vidPct(v,vidRec(v.id)))):'—'},
    {key:'seen',label:'Просмотр',type:'enum',w:150,hide:true,val:v=>tr?vidSt(v,vidRec(v.id)):'—'},
    {key:'ord',label:'Порядок',type:'int',w:100,hide:true,num:true,val:v=>v.ord||0},
    {key:'pub',label:'Опубликовано',type:'date',w:140,val:v=>vidPubAt(v).slice(0,10)}],
    rows:vidList,title:'t',noun:['видео','видео','видео'],sort:{key:'ord',dir:1},ordered:true,searchText:v=>v.t+' '+(v.desc||''),cardHtml:vidCardHtml,
    open:v=>vidOpen(v.id),actions:v=>[{label:'Смотреть',icon:'play',run:()=>vidOpen(v.id)},{label:'Скопировать ссылку',icon:'link',sub:'Ссылка открывает эту вкладку с окном видео',run:()=>vidCopy(v)}],
    preset:pf||S.preset,simulateLoad:fresh});
  const u=$('[data-plate="vk-un"]',body);if(u)u.onclick=()=>{VID.unseen=!VID.unseen;VID.pf=VID.unseen?{seen:{type:'enum',vals:['Не смотрел','Начал']}}:{};renderPage()}}

/* ═════════════ База знаний: «Просмотры видео» ═════════════ */
// Строка — сотрудник и доступная ему видеоинструкция, в том числе ещё не открытая; презентации по людям не показываются; заблокированных нет
function vidViewRows(adm){const rows=[];const self=(ORGS.find(o=>o.self)||{}).id||'self';
  const push=(org,on,u,fio,role,v,r)=>rows.push({id:org+'|'+u+'|'+v.id,org:on,oid:org,u,fio,role,v,r});
  EMP.filter(e=>e.active!==false).forEach(e=>{const rl=(ROLES.find(r=>r.id===e.role)||{}).name||'';const l=asUser(e.id,()=>vidList().filter(v=>v.kind==='instr'));
    l.forEach(v=>push(self,ORG.name,e.id,e.fio,rl,v,vidRec(v.id,e.id)));
    VVIEWS.filter(r=>!r.org&&r.u===e.id&&!l.some(v=>v.id===r.v)).forEach(r=>{const v=vidById(r.v);if(v&&v.kind==='instr'&&(v.del||!vidLive(v)))push(self,ORG.name,e.id,e.fio,rl,v,r)})});
  if(adm)OTHER_USERS.filter(u=>u.active!==false&&u.org!==self).forEach(u=>{const o=ORGS.find(x=>x.id===u.org);if(!o||o.active===false)return;
    VIDEOS.filter(v=>v.kind==='instr'&&!v.del&&vidLive(v)&&v.aud!=='adm'&&(!v.mod||BIZ.some(m=>m.id===v.mod))).forEach(v=>push(u.org,o.name,u.login,u.fio,u.role,v,VVIEWS.find(x=>x.org===u.org&&x.u===u.login&&x.v===v.id)||null));
    VVIEWS.filter(x=>x.org===u.org&&x.u===u.login).forEach(r=>{const v=vidById(r.v);if(v&&v.kind==='instr'&&(v.del||!vidLive(v)))push(u.org,o.name,u.login,u.fio,u.role,v,r)})});
  return rows}
const vrFirst=x=>x.r&&x.r.ses&&x.r.ses.length?x.r.ses[0].at:'';
const vrLast=x=>{const s=x.r&&x.r.ses&&x.r.ses.filter(s=>segLen(s.p)>0);return s&&s.length?s[s.length-1].at:''};
const vrVt=x=>x.v.t+(x.v.del?' (удалено)':'');
function renderKbVViews(body,fresh,adm){
  if(!adm&&!can('kbLevels')){body.innerHTML=`<div class="state">${ic('lock','lg')}<b>Нет доступа</b><span>Просмотры видео видят владелец и роль с правом «Видеть уровни сотрудников».</span></div>`;return}
  const rows=vidViewRows(adm);const st=x=>vidSt(x.v,x.r);const nv=new Set(rows.map(x=>x.v.id)).size;const dn=rows.filter(x=>st(x)==='Просмотрено').length;
  const ppl={};rows.forEach(x=>{const k=x.oid+'|'+x.u;ppl[k]=ppl[k]||st(x)!=='Не смотрел'});const none=Object.values(ppl).filter(x=>!x).length;
  const cnt=k=>rows.filter(x=>st(x)===k).length;const pf=VID.pf;VID.pf=null;
  body.innerHTML=`${adm?`<div class="note">${ic('info')}<span>Просмотры видеоинструкций сотрудниками всех организаций: учитываются секунды, которые действительно проигрались в открытом окне при видимой вкладке; каждая секунда видео — один раз. Просмотры администратора платформы сюда не попадают; гости лендинга — только общим числом.</span></div>`:''}
    <div class="vv-st"><span>Видеоинструкций: <b>${nv}</b></span><span>Просмотрено полностью: <b>${rows.length?Math.round(dn/rows.length*100):0} %</b></span><span>Не начинали: <b>${none}</b> ${plural(none,'сотрудник','сотрудника','сотрудников')}</span></div>
    <div class="plates vk-pl">${plate({id:'vv-Не смотрел',icon:'eyeoff',color:'red',label:'Не смотрел',value:cnt('Не смотрел'),sub:'доступна, но не открывал или не смотрел'})}${plate({id:'vv-Начал',icon:'half',color:'yellow',label:'Начал',value:cnt('Начал'),sub:'просмотрено меньше 90 %'})}${plate({id:'vv-Просмотрено',icon:'ok',color:'green',label:'Просмотрено',value:dn,sub:'не меньше 90 % секунд видео'})}</div><div id="kbvv"></div>${adm?vidAdmSum():''}`;
  grid($('#kbvv',body),{id:adm?'kb-adm-vviews':'kb-vviews',cols:[
    ...(adm?[{key:'org',label:'Организация',type:'enum',w:230,val:x=>x.org}]:[]),
    {key:'fio',label:'Сотрудник',type:'text',w:250,val:x=>x.fio,html:x=>`<span class="strong">${esc(x.fio)}</span>`},
    {key:'role',label:'Роль',type:'enum',w:170,val:x=>x.role},
    {key:'vt',label:'Видео',type:'enum',w:280,val:vrVt},
    {key:'mod',label:'Модуль',type:'enum',w:200,val:x=>vidModT(x.v)},
    {key:'dur',label:'Длительность',type:'text',w:120,num:true,val:x=>vidT(x.v.dur),sortVal:x=>x.v.dur||0},
    {key:'seen',label:'Просмотрено',type:'text',w:150,num:true,val:x=>`${vidT(vidSecs(x.v,x.r))} · ${vidPct(x.v,x.r)} %`,sortVal:x=>vidPct(x.v,x.r)},
    {key:'st',label:'Статус',type:'enum',w:150,val:st,html:x=>vidStPill(st(x))},
    {key:'n',label:'Открывал, раз',type:'int',w:130,num:true,val:x=>x.r&&x.r.ses?x.r.ses.length:0},
    {key:'first',label:'Первое открытие',type:'date',w:150,val:x=>vrFirst(x).slice(0,10)},
    {key:'last',label:'Последний просмотр',type:'text',w:170,val:x=>vrLast(x)?fmtDT(vrLast(x)):'',sortVal:x=>vrLast(x)}],
    rows:()=>rows,title:'fio',noun:['строка','строки','строк'],sort:{key:'last',dir:-1},ordered:true,open:x=>vidHistDlg(x),actions:x=>[{label:'История просмотров',icon:'history',run:()=>vidHistDlg(x)}],preset:pf||S.preset,simulateLoad:fresh});
  $$('[data-plate^="vv-"]',body).forEach(b=>b.onclick=()=>{VID.pf={st:{type:'enum',vals:[b.dataset.plate.slice(3)]}};renderPage()})}
// История просмотров сотрудника по видео (только просмотр): когда, с какой по какую секунду, сколько проигралось
function vidHistDlg(x){const ses=(x.r&&x.r.ses||[]).slice().reverse();
  openModal({size:'mid',render:()=>({title:esc(x.fio),sub:`${esc(vrVt(x))} · ${vidT(x.v.dur)}${x.org&&x.oid!==((ORGS.find(o=>o.self)||{}).id)?' · '+esc(x.org):''}`,
    body:`<div class="box"><div class="row" style="flex-wrap:wrap;gap:10px">${vidStPill(vidSt(x.v,x.r))}<span class="grow muted">Просмотрено ${vidT(vidSecs(x.v,x.r))} из ${vidT(x.v.dur)} · ${vidPct(x.v,x.r)} %${x.r&&x.r.done?' · «Просмотрено» '+fmtDT(x.r.done):''}</span></div><span class="vprog wide"><span class="bar vbar" aria-hidden="true">${(x.r&&x.r.segs||[]).map(s=>`<i style="left:${(s[0]/(x.v.dur||1)*100).toFixed(2)}%;width:${((s[1]-s[0])/(x.v.dur||1)*100).toFixed(2)}%"></i>`).join('')}</span></span><span class="hint">Закрашено — секунды видео, которые проигрались хотя бы раз</span></div>
      ${ses.length?`<table class="mini vh-tb"><thead><tr><th>Дата и время</th><th>С какой по какую секунду</th><th class="num">Проигралось</th></tr></thead><tbody>${ses.map(s=>`<tr><td>${fmtDT(s.at)}</td><td>${s.p&&s.p.length?s.p.map(p=>vidT(p[0])+'–'+vidT(p[1])).join(', '):'<span class="faint">открыл, не смотрел</span>'}</td><td class="num">${vidT(segLen(s.p))}</td></tr>`).join('')}</tbody></table><span class="hint">Несколько отрезков в одной строке — смотрел с перемоткой</span>`:`<div class="state" style="padding:14px">${ic('film','lg')}<b>Ещё не открывал</b><span>Видеоинструкция доступна сотруднику, но он её не открывал.</span></div>`}`,
    foot:'<div class="grow"></div><button class="btn cta" data-close>Готово</button>'})})}

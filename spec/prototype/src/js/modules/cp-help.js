'use strict';
// Подсказки и обучение на странице контрагента (доработки 15.11.2026, пункты 1–7; поток К; прототип v120): клиенты — не бухгалтеры, поэтому
// окно «Добро пожаловать» после первого верного кода, обзор страницы по живому экрану (тот же вид, что «Показать как» у сотрудников),
// кнопка и панель «Помощь» с частыми вопросами, «Словарик» — слова с пунктиром и объяснением по нажатию, подсказки в окнах действий.
// Все тексты — справочник текстов элементов экрана (refDB.kbUi.cpHelp), один набор для всех организаций; ведёт администратор платформы:
// Админка → «База знаний (содержимое)» → «Страница контрагента» (cp-help-admin.js). Обзор и панель ничего не меняют в данных — обзор пишет только строку в историю контрагента.
/* ═════════════ Тексты ═════════════ */
const CPH=()=>KBUI.cpHelp||(KBUI.cpHelp={welcome:{},tour:[],faq:[],gloss:[],hints:{}});
const cphT=(k,d)=>{const v=(CPH().hints||{})[k];return v==null||v===''?d||'':v};
const cphW=(k,d)=>{const v=(CPH().welcome||{})[k];return v==null||v===''?d||'':v};
const cphFill=(t,o)=>String(t||'').replace(/\{([^}]+)\}/g,(m,k)=>o[k]!=null?o[k]:m);
const cphCap=s=>s?s[0].toUpperCase()+s.slice(1):'';
// Метки страницы для «Что значат цвета у отчётов?» и облачка «Отчёты»: те же цвета и значки, что у меток и плашек раздела
const CPH_PILL=()=>({...ST,'Впереди':['blue','clock'],'Просрочен':['red','alert'],'Просрочено':['red','alert']});

/* Что сейчас видно на странице: обзор, «Добро пожаловать» и вопросы «Помощи» показывают только это */
// Разделы страницы (17.11.2026): «money» — расчёт «Не хватает» в строке «Налоги» «Оплаты», «fee» — строка «Услуги бухгалтера», «tg» — Telegram в «Связи»
const cphSec=k=>k==='money'?!!$('#pub .pub-body .pub-calc'):k==='fee'?!!$('#pub .pub-body [data-po="fee"]'):!!$(`#pub .pub-body [data-sec="${k}"]`);
function cphVis(c){const tax=!!$('#pub .pub-s[data-sec="pay"] [data-pay="tax"]'),fee=!!$('#pub .pub-s[data-sec="pay"] [data-pay="fee"]'),tg=cphSec('tg');
  return {sec:cphSec,payTax:tax,payFee:fee,pay:tax||fee,paid:pgPaidOn(c)&&(tax||fee),up:sntUpOn(c)&&cphSec('files'),tg,tgFull:tg&&!!$('#pub [data-pub-tgon].dis'),code:pgCodeTo(c).length>0}}

/* ═════════════ Пункт 2.1. «Добро пожаловать» ═════════════ */
// Показывается один раз в этом браузере для этой страницы — после первого верного кода; запоминается отдельно от кода (код живёт 1 день)
const CPH_WKEY='pgwel';
const cphKey=()=>PUB.open?PUB.open.slug+'|'+PUB.open.inn:'';
const cphSeen=k=>{const m=store.get(CPH_WKEY,{});return !!(m&&typeof m==='object'&&m[k])};
function cphSeenSet(k){let m=store.get(CPH_WKEY,{});if(!m||typeof m!=='object')m={};m[k]=nowStamp();store.set(CPH_WKEY,m)}
// Приглашение (17.11.2026, «Меньше текста», п. 6): одна строка и две кнопки полосой внизу экрана, страница видна сразу (было окно «Добро пожаловать!» на 72 % экрана с тремя карточками).
// Показывается, пока клиент не нажал одну из кнопок; «Показать» запускает обзор
function cphWelcomeBar(c){const k=cphKey();if(!k||cphSeen(k)||CPHT.on)return '';
  return `<div class="pgw-bar" role="region" aria-label="Как пользоваться страницей"><span>${esc(cphW('lead','Здесь видно, что сдано, сколько и куда заплатить. Показать за минуту?'))}</span><div class="pgw-bb"><button type="button" class="btn ghost" id="pgw-skip">${esc(cphW('skip','Не сейчас'))}</button><button type="button" class="btn" id="pgw-go">${ic('play','sm')}${esc(cphW('go','Показать'))}</button></div></div>`}
function cphWelcomeMount(el,c){const b=$('.pgw-bar',el);if(!b)return;const k=cphKey(),done=()=>{cphSeenSet(k);b.classList.add('out');setTimeout(()=>b.remove(),cphRM()?0:140)};
  $('#pgw-skip',b).onclick=done;$('#pgw-go',b).onclick=()=>{done();setTimeout(()=>cphTour(c),60)}}

/* ═════════════ Пункт 2.2. Обзор страницы по живому экрану ═════════════ */
// Тот же вид, что «Показать как» сотрудников (облачко .tour-bub и подсветка .tour-hole), но свой движок: страница без входа, без шагов уроков и знакомых элементов.
// Шаги — справочник kbUi.cpHelp.tour; разделы, скрытые у контрагента, и пустые карточки пропускаются: счётчик считает только видимые шаги.
// На телефоне свёрнутый раздел на своём шаге раскрывается, после обзора всё сворачивается как было и прокрутка возвращается на место.
const CPHT={on:false,list:[],i:0,c:null,unf:null,top:0,el:null,t:0};
const cphRM=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
// Что подсвечивать: s — на ПК, m — на телефоне (меньший элемент, чтобы облачко внизу его не закрывало)
const CPH_EL={state:{s:'.pub-state'},help:{s:'#pub-help',m:'.pub-nav [data-pub-nav="help"]'},pay:{s:'.pub-s[data-sec="pay"]',m:'.pub-s[data-sec="pay"] .pub-po'}};
const cphElSel=k=>{const d=CPH_EL[k]||{s:`.pub-s[data-sec="${k}"]`};return isMobile()&&d.m?d.m:d.s};
const cphEl=k=>k==='end'?null:[...$$('#pub .pub-body '+cphElSel(k))].find(tVis)||null;
// Обзор — 5 шагов (17.11.2026): «Что нужно сделать», «Оплата», «Отчёты», «Файлы», «Помощь»; остальные шаги выключены в справочнике (поле «on»), «Готово» — тоже шаг со своим «on»
function cphTourList(c){const v=cphVis(c);
  return (CPH().tour||[]).filter(s=>s.on!==false).filter(s=>s.sec==='end'||(s.sec==='help'?!!$('#pub-help'):s.sec==='state'?!!$('#pub .pub-state'):v.sec(s.sec)))
    .map(s=>({...s,x:(s.sec==='pay'&&!v.paid||s.sec==='files'&&!v.up)&&s.x2?s.x2:s.x}))}
function cphOverlay(){let o=$('#pgtour');if(o)return o;o=document.createElement('div');o.id='pgtour';o.hidden=true;
  o.innerHTML='<div class="tour-hole"></div><div class="tour-bub" role="dialog" aria-modal="true" aria-live="polite" aria-labelledby="pgt-t"></div>';document.body.append(o);
  o.addEventListener('click',e=>{const b=e.target.closest('[data-pgt]');if(!b||CPHT.busy)return;const a=b.dataset.pgt;if(a==='next')cphTourGo(1);else if(a==='prev')cphTourGo(-1);else if(a==='end')cphTourEnd(false)});
  addEventListener('resize',()=>CPHT.on&&cphTourPlace());return o}
// ← → и Esc на ПК; нажатия по странице во время обзора до неё не доходят (поверх — затемнение)
addEventListener('keydown',e=>{if(!CPHT.on)return;const k=e.key;if(k!=='ArrowRight'&&k!=='ArrowLeft'&&k!=='Escape')return;e.preventDefault();e.stopPropagation();if(CPHT.busy)return;
  if(k==='Escape')cphTourEnd(false);else cphTourGo(k==='ArrowRight'?1:-1)},true);
// Двойное нажатие «Показать, как пользоваться» запускает один обзор
function cphTour(c){if(CPHT.on||!PUB.open)return;c=c||pubCp(PUB.open);if(!c||!$('#pub .pub-body'))return;closePop();
  const list=cphTourList(c);if(!list.length)return;const sc=$('#pub .pub-page');
  Object.assign(CPHT,{on:true,busy:false,list,i:0,c,unf:new Set(PUB.unf),top:sc?sc.scrollTop:0,el:null});
  const o=cphOverlay();o.hidden=false;if(sc)sc.addEventListener('scroll',cphTourScroll,{passive:true});cphTourShow()}
function cphTourScroll(){if(CPHT.on){cancelAnimationFrame(CPHT.raf);CPHT.raf=requestAnimationFrame(cphTourPlace)}}
function cphTourGo(d){const j=CPHT.i+d;if(d>0&&j>=CPHT.list.length)return cphTourEnd(true);if(j<0||j>=CPHT.list.length)return;CPHT.i=j;cphTourShow()}
function cphTourShow(){const p=CPHT.list[CPHT.i];if(!p)return;CPHT.busy=true;
  // свёрнутый на телефоне раздел раскрывается на своём шаге
  if(isMobile()&&p.sec!=='end'&&p.sec!=='state'&&p.sec!=='help'&&p.sec!=='pay')pubFold(p.sec,true);
  const el=cphEl(p.sec);CPHT.el=el;const sc=$('#pub .pub-page');
  if(el&&sc){const r=el.getBoundingClientRect(),sr=sc.getBoundingClientRect(),bh=isMobile()?Math.min(260,innerHeight*.45):0,room=sc.clientHeight-bh-24;
    // телефон и высокий элемент — верх элемента у верха экрана; иначе элемент посередине
    const off=r.height>room||isMobile()?12:Math.max(12,(room-r.height)/2);sc.scrollTo({top:Math.max(0,sc.scrollTop+r.top-sr.top-off),behavior:cphRM()?'auto':'smooth'})}
  else if(sc&&p.sec==='end')sc.scrollTo({top:CPHT.top,behavior:cphRM()?'auto':'smooth'});
  const n=CPHT.list.length,k=CPHT.i,last=k===n-1,bub=$('#pgtour .tour-bub');
  const legend=p.sec==='reports'?cphLegend(true):'';
  bub.innerHTML=`<div class="row tour-top"><span class="tour-n">${k+1} из ${n}</span><span class="grow"></span><button type="button" class="icon-btn sm" data-pgt="end" aria-label="Закончить обзор" title="Закончить (Esc)">${ic('x','sm')}</button></div><div class="bar tour-bar" aria-hidden="true"><i style="width:${Math.round((k+1)/n*100)}%"></i></div>
    <b id="pgt-t">${esc(p.t||'')}</b><p>${esc(p.x||'')}</p>${legend}<div class="row tour-nav">${last?'':`<button type="button" class="linkbtn" data-pgt="end">Закончить</button>`}<div class="grow"></div>${k?'<button type="button" class="btn sm ghost" data-pgt="prev">Назад</button>':''}<button type="button" class="btn sm cta" data-pgt="next">${last?'Готово':'Далее'}</button></div>${isMobile()?'':'<div class="tour-keys">← → — листать, Esc — закончить</div>'}`;
  const nx=$('[data-pgt="next"]',bub);if(nx)nx.focus({preventScroll:true});
  cphTourPlace();clearTimeout(CPHT.t);CPHT.t=setTimeout(()=>{cphTourPlace();CPHT.busy=false},cphRM()?0:320)}
// Облачко не закрывает подсвеченный элемент: на телефоне оно внизу, а подсветка обрезается над ним; на ПК — сбоку, ниже или выше элемента
function cphTourPlace(){if(!CPHT.on)return;const hole=$('#pgtour .tour-hole'),bub=$('#pgtour .tour-bub'),W=innerWidth,H=innerHeight,mob=isMobile();
  const bw=Math.min(mob?W-24:380,W-24);bub.style.width=bw+'px';const bh=bub.offsetHeight,el=CPHT.el&&tVis(CPHT.el)?CPHT.el:null;let r=null,x,y;
  if(el){const q=el.getBoundingClientRect(),pad=6;r={left:Math.max(4,q.left-pad),top:Math.max(4,q.top-pad),right:Math.min(W-4,q.right+pad),bottom:Math.min(H-4,q.bottom+pad)};
    if(mob)r.bottom=Math.min(r.bottom,H-bh-24);if(r.bottom<r.top+8)r.bottom=r.top+8}
  if(r)Object.assign(hole.style,{left:r.left+'px',top:r.top+'px',width:(r.right-r.left)+'px',height:(r.bottom-r.top)+'px',opacity:1});
  else Object.assign(hole.style,{left:W/2+'px',top:H/2+'px',width:'0px',height:'0px',opacity:1});
  if(mob){x=(W-bw)/2;y=H-bh-12}
  else if(!r){x=(W-bw)/2;y=(H-bh)/2}
  else{const cy=Math.max(12,Math.min(H-bh-12,r.top));
    if(r.right+16+bw<=W-12){x=r.right+16;y=cy}else if(r.left-16-bw>=12){x=r.left-16-bw;y=cy}
    else if(r.bottom+12+bh<=H-12){x=Math.min(W-bw-12,Math.max(12,r.left));y=r.bottom+12}else if(r.top-12-bh>=12){x=Math.min(W-bw-12,Math.max(12,r.left));y=r.top-12-bh}
    else{x=W-bw-12;y=H-bh-12}}
  bub.style.left=x+'px';bub.style.top=y+'px'}
// full — дошли до «Готово». Страница возвращается как была: свёрнутые разделы снова свёрнуты, прокрутка на месте
function cphTourEnd(full,quiet){if(!CPHT.on)return;const c=CPHT.c,k=CPHT.i,n=CPHT.list.length;CPHT.on=false;clearTimeout(CPHT.t);const o=$('#pgtour');if(o)o.hidden=true;
  const sc=$('#pub .pub-page');if(sc)sc.removeEventListener('scroll',cphTourScroll);
  if(PUB.open&&CPHT.unf){$$('#pub .pub-s.pub-fd').forEach(s=>{const sk=s.dataset.sec;pubFold(sk,CPHT.unf.has(sk))});PUB.unf=new Set(CPHT.unf)}
  if(sc)sc.scrollTo({top:CPHT.top,behavior:'auto'});
  if(c&&!quiet){HIST.push({at:nowStamp(),who:'client',ent:'cp',id:c.id,cp:c.id,what:full?'Контрагент посмотрел обзор страницы':`Контрагент закрыл обзор страницы на шаге ${k+1} из ${n}`});dbSoon()}
  const h=$('#pub-help');if(h&&!quiet)h.focus({preventScroll:true})}
// Метки «Отчётов» с цветом и значком: в облачке «Отчёты» — только метки, в «Помощи» — метка и объяснение (строки ответа «Что значат цвета у отчётов?»)
function cphLegend(short){const q=(CPH().faq||[]).find(x=>x.act==='colors'&&x.on!==false);if(!q)return '';const P=CPH_PILL();
  const rows=String(q.a||'').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const m=/^«([^»]+)»\s*[—–-]\s*(.+)$/.exec(l);return m?{l:m[1],t:m[2]}:{l:'',t:l}});
  // В облачке обзора — три главные метки: «Сдан», «В работе», «Просрочен»
  if(short)return `<div class="pgt-leg">${rows.filter(r=>['Сдан','В работе','Просрочен'].includes(r.l)).map(r=>pill(r.l,P,'sm')).join('')}</div>`;
  return `<ul class="pgh-leg">${rows.map(r=>`<li>${r.l?pill(r.l,P,'sm'):''}<span>${esc(r.t)}</span></li>`).join('')}</ul>`}

/* ═════════════ Пункт 3. «Помощь» ═════════════ */
// «?» в шапке страницы и «Помощь» в нижнем меню телефона (17.11.2026): круглой кнопки поверх страницы больше нет — она закрывала суммы у правого края
const cphHelpBtn=()=>`<button type="button" class="icon-btn pub-help" id="pub-help" aria-label="${esc(cphT('helpBtn','Помощь'))}" title="${esc(cphT('helpBtn','Помощь'))}">${ic('help')}</button>`;
function cphMount(el,c){const h=$('#pub-help',el);if(h)h.onclick=()=>cphHelp(c)}
// Вопросы о скрытых разделах и выключенных функциях не показываются
function cphQVis(q,v){const s=q.sec||'';return s===''?true:s==='pay'?v.pay||v.sec('pay'):s==='payTax'?v.payTax:s==='payFee'?v.payFee:v.sec(s)}
const CPH_GO={goPay:'pay',goFiles:'files',goMoney:'money',goFee:'fee',goReports:'reports'};
// «Открыть налоги» и «Открыть услуги бухгалтера» ведут к строке «Оплаты» (pubGo)
const cphActL=a=>cphT('act'+a[0].toUpperCase()+a.slice(1),'');
// Можно ли нажать кнопку ответа сейчас: нет — вместо кнопки «Спросите вашего бухгалтера»
function cphActOn(a,v){if(CPH_GO[a])return v.sec(CPH_GO[a]);return a==='paid'?v.paid:a==='up'?v.up:a==='tg'?v.tg&&!v.tgFull:a==='code'?v.code:false}
function cphHelp(c){if(CPHT.on)return;c=c||pubCp(PUB.open);if(!c)return;closePop();const top=MODALS[MODALS.length-1];if(top&&top.o.cph)return;
  const v=cphVis(c),H=CPH(),qs=(H.faq||[]).filter(q=>q.on!==false&&q.q&&cphQVis(q,v)).sort((a,b)=>(a.ord||0)-(b.ord||0)),gl=(H.gloss||[]).filter(g=>g.w&&g.x).slice().sort((a,b)=>a.w.localeCompare(b.w,'ru'));
  const open=PUB.hq||(PUB.hq=new Set());
  const e=EM[c.resp],ph=e&&e.active!==false&&e.phone&&e.phone.digits?e.phone:ORG.phone&&ORG.phone.digits?ORG.phone:null,who=ph&&e&&ph===e.phone?e.fio:ORG.name;
  const ans=q=>{const ls=String(q.a||'').split('\n').map(l=>l.trim()).filter(Boolean);
    const body=q.act==='colors'?cphLegend(false):ls.length>1?`<ol class="pgh-steps">${ls.map(l=>`<li>${esc(l)}</li>`).join('')}</ol>`:ls.length?`<p>${esc(ls[0])}</p>`:'';
    const act=!q.act||q.act==='colors'?'':cphActOn(q.act,v)?`<button type="button" class="btn sm cta" data-pgh-act="${esc(q.act)}">${ic(CPH_GO[q.act]?'right':q.act==='paid'?'check':q.act==='up'?'upload':q.act==='tg'?'tg':'send','sm')}${esc(cphActL(q.act))}</button>`:`<span class="pgh-ask1">${ic('user','sm')}${esc(cphT('askAcc','Спросите вашего бухгалтера'))}</span>`;
    return body+(act?`<div class="row pgh-act">${act}</div>`:'')+(q.act==='code'?'<span class="hint pgh-res" role="status" hidden></span>':'')};
  const row=(id,t,a)=>`<div class="pgh-q${open.has(id)?' open':''}"><button type="button" class="pgh-qh" data-pgh-q="${esc(id)}" aria-expanded="${open.has(id)}"><span>${esc(t)}</span>${ic('down','sm')}</button><div class="pgh-a">${a}</div></div>`;
  openModal({size:'pgside',noMax:true,cph:true,render:()=>({title:esc(cphT('helpTitle','Помощь')),
    body:`<div class="pgh-ask"><b>${esc(cphT('notFound','Спросить бухгалтера'))}</b>${ph?`<span class="hint">${esc(who)} · <span class="mono">${esc(fmtPhone(ph))}</span></span><div class="row"><a class="btn sm" href="tel:+${ph.digits}">${ic('phone','sm')}Позвонить</a><a class="btn sm" href="${waLink(ph)}" target="_blank" rel="noopener">${ic('chat','sm')}WhatsApp</a></div>`:''}</div>
      <button type="button" class="btn pgh-tour" data-pgh-tour>${ic('play','sm')}${esc(cphT('helpTour','Как пользоваться'))}</button>
      ${qs.length?`<h3 class="pgh-h">${esc(cphT('faqHead','Частые вопросы'))}</h3><div class="pgh-faq">${qs.map(q=>row(q.id,q.q,ans(q))).join('')}</div>`:''}
      ${gl.length?`<div class="pgh-faq pgh-gl">${row('__gloss',cphT('glossHead','Словарик'),`<dl class="pgh-dl">${gl.map(g=>`<div><dt>${esc(cphCap(g.w))}</dt><dd>${esc(g.x)}</dd></div>`).join('')}</dl>`)}</div>`:''}`,
    mount(el,m){const mb=$('.mb',el);mb.onclick=ev=>{const b=ev.target.closest('[data-pgh-q],[data-pgh-act],[data-pgh-tour],[data-pgh-demo]');if(!b)return;
      if(b.dataset.pghQ!=null){const id=b.dataset.pghQ,on=!open.has(id);on?open.add(id):open.delete(id);b.parentElement.classList.toggle('open',on);b.setAttribute('aria-expanded',on);return}
      if(b.dataset.pghTour!=null){m.close();setTimeout(()=>cphTour(c),60);return}
      if(b.dataset.pghDemo!=null){const r=pgCodeTo(c);if(r[0])pgCodeDemo(c,r[0]);return}
      const a=b.dataset.pghAct;if(CPH_GO[a]){m.close();setTimeout(()=>pubGo(CPH_GO[a]),60);return}
      if(a==='paid'){m.close();cphPaid(c,v);return}
      if(a==='up'){m.close();pubUpDlg(c);return}
      if(a==='tg'){m.close();pgTgDlg(c);return}
      // «Прислать код в Telegram»: ответ — строкой под кнопкой, панель остаётся открытой
      if(a==='code'){const r=pubForgot(c),o=b.closest('.pgh-a').querySelector('.pgh-res');if(o){o.hidden=false;o.classList.toggle('ok',!!r.ok);o.innerHTML=esc(r.t)+(r.ok?` <button type="button" class="linkbtn" data-pgh-demo>${ic('eye','sm')}В макете: сообщение в Telegram</button>`:'')}}}}})})}
// «Сообщить об оплате»: сразу окно «Я оплатил» с месяцем и суммой по умолчанию; обе карточки «Как оплатить» — выбор «Налоги» или «Обслуживание», по умолчанию «Налоги»
function cphPaid(c,v){v=v||cphVis(c);const ks=[v.payTax&&'tax',v.payFee&&'fee'].filter(Boolean);if(!ks.length)return;pubPaidDlg(c,ks[0],null,{pick:ks.length>1})}

/* ═════════════ Пункт 4. «Словарик» ═════════════ */
// Слово подчёркнуто пунктиром один раз в разделе (первое появление), не внутри кнопок, ссылок, меток и чисел. Формы слова: у одного слова — по основе
// (отчёт → отчёты, отчётов), у сочетаний — как написано; «Другие формы» — ещё варианты через запятую (к уплате, единого налога). Сокращения (НДС, ГНС) — только заглавными
let CPH_GRX=null,CPH_GV='';
function cphGlossRx(){const g=CPH().gloss||[],key=JSON.stringify(g);if(CPH_GRX&&CPH_GV===key)return CPH_GRX;
  const alts=[];g.forEach((x,i)=>{if(!x.w||!x.x||x.pg===false)return;[x.w,...String(x.also||'').split(',')].map(s=>s.trim()).filter(Boolean).forEach(f=>alts.push({i,f,up:f.length>1&&f===f.toUpperCase()&&/[A-ZА-ЯЁ]/.test(f)}))});
  alts.sort((a,b)=>b.f.length-a.f.length);
  const pat=a=>{let s=a.f.toLowerCase();const one=!/\s/.test(s),stem=one&&!a.up;if(stem&&s.length>=5&&/[аеёиоуыэюяьй]$/.test(s))s=s.slice(0,-1);
    return '(?<![\\p{L}\\p{N}])'+s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/[её]/g,'[её]').replace(/\s+/g,'\\s+')+(stem?'\\p{L}*':'')+'(?![\\p{L}\\p{N}])'};
  let rx=null;try{rx=alts.length?new RegExp(alts.map(a=>'('+pat(a)+')').join('|'),'giu'):null}catch(e){rx=null}
  CPH_GRX={alts,rx};CPH_GV=key;return CPH_GRX}
const CPH_GSKIP='button,a,input,select,textarea,label,h1,h2,h3,h4,.pill,.mono,.tnum,svg,option,.pub-gl,.pub-sum,.pub-fm,.pub-dl,.pub-pay';
function cphGloss(root){const G=cphGlossRx();if(!G.rx)return;
  $$('.pub-s',root).forEach(sc=>{const used=new Set(),w=document.createTreeWalker(sc,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.nodeValue.trim()&&!n.parentElement.closest(CPH_GSKIP)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT}),nodes=[];let n;while((n=w.nextNode()))nodes.push(n);
    nodes.forEach(nd=>{const t=nd.nodeValue,out=[];let last=0,m;G.rx.lastIndex=0;
      while((m=G.rx.exec(t))){const a=G.alts[m.slice(1).findIndex(x=>x!==undefined)];if(!a||used.has(a.i)||(a.up&&m[0]!==m[0].toUpperCase())){G.rx.lastIndex=m.index+1;continue}
        used.add(a.i);out.push(document.createTextNode(t.slice(last,m.index)));const b=document.createElement('button');b.type='button';b.className='pub-gl';b.dataset.pubGl=a.i;b.setAttribute('aria-haspopup','dialog');b.title='Что это значит?';b.textContent=m[0];out.push(b);last=m.index+m[0].length}
      if(out.length){out.push(document.createTextNode(t.slice(last)));nd.replaceWith(...out)}})})}
// Облачко с объяснением: закрывается нажатием мимо, Esc или крестиком; страница остаётся на том же месте
function cphGlossPop(b){const g=(CPH().gloss||[])[+b.dataset.pubGl];if(!g)return;if(POP_ANCHOR===b){closePop();return}
  openPop(b,`<div class="pgl" role="dialog" aria-label="${esc(cphCap(g.w))}"><div class="pgl-h"><b>${esc(cphCap(g.w))}</b><button type="button" class="icon-btn sm" data-pgl-x aria-label="Закрыть">${ic('x','sm')}</button></div><p>${esc(g.x)}</p></div>`,
    {cls:'pad pgl-pop',mount:el=>{$('[data-pgl-x]',el).onclick=()=>{closePop();b.focus({preventScroll:true})}}})}

/* ═════════════ Пункт 5. Подсказки в окнах действий ═════════════ */
// После отправки — окно с понятным итогом вместо короткого уведомления: что будет дальше
function cphDone(title,text){openModal({noMax:true,render:()=>({title:esc(title),body:`<div class="pgw-done">${ic('ok')}<p>${esc(text)}</p></div>`,foot:'<button type="button" class="btn cta" data-close>Понятно</button>'})})}
// Экран кода: «Что это за страница?» раскрывает объяснение под ссылкой
const cphCodeWhat=()=>`<button type="button" class="linkbtn pub-what-q" id="pub-wq" aria-expanded="false" aria-controls="pub-wqx">${ic('help','sm')}${esc(cphT('codeWhat','Что это за страница?'))}</button><p class="muted pub-wqx" id="pub-wqx" hidden>${esc(cphT('codeWhatX'))}</p>`;
function cphCodeMount(el){const b=$('#pub-wq',el);if(b)b.onclick=()=>{const x=$('#pub-wqx',el),on=x.hidden;x.hidden=!on;b.setAttribute('aria-expanded',on)}}

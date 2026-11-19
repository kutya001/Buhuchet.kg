'use strict';
// Колокольчик в верхней панели: значок, счётчик и панель «Уведомления» (пакет 16.11.2026, блок 3; поток И).
// Строки берутся только из bell.js потока Т (bellItems, bellUnseen, bellSeenAll, bellRead, bellReadAll); в продукте — /api/bell.
const BELL_PAGE=30;
const BELL_TABS=[['all','Все'],['reports','Отчёты'],['tasks','Задачи'],['files','Файлы'],['money','Деньги'],['news','Новости']];
// Значок строки — по виду (фильтру панели), у отдельных событий — свой (по умолчанию)
const BELL_IC={reports:'file',tasks:'task',files:'folder',money:'wallet',news:'grad',other:'info'};
const BELL_EV_IC={login_locked:'lock',lead:'user',broadcast:'send',cp_tg_request:'tg',cp_question:'chat',page_closed:'ban',nudge:'clock',day_dues:'calendar',week:'calendar'};
const BP={tab:'all',n:BELL_PAGE};
const bellBtn=()=>$('#bell');
const bellIsOpen=()=>!!(POP&&POP_ANCHOR&&POP_ANCHOR===bellBtn());
const bellCount=n=>n>99?'99+':String(n);
// Время строки: «только что», «5 мин назад», «14:20» (сегодня), «вчера 14:20», «12.11 14:20», в прошлом году — с годом (по умолчанию)
function bellAgo(at){const d=String(at).slice(0,10),hm=String(at).slice(11,16),now=bishkekNow().hm,mins=t=>+t.slice(0,2)*60+ +t.slice(3,5);
  if(d===TODAY){const m=mins(now)-mins(hm);return m<1?'только что':m<60?`${m} мин назад`:hm}
  if(d===addDays(TODAY,-1))return 'вчера '+hm;
  return (d.slice(0,4)===TODAY.slice(0,4)?fmtD(d).slice(0,5):fmtD(d))+' '+hm}
const bellGroup=at=>{const d=String(at).slice(0,10);return d===TODAY?'Сегодня':d===addDays(TODAY,-1)?'Вчера':'Раньше'};

// Значок: есть непросмотренные — цветной с красным счётчиком (1–99, дальше «99+»), иначе серый; до входа — скрыт
function bellPaint(){const b=bellBtn();if(!b)return;clearTimeout(bellPaint.t);const off=S.loggedIn===false;b.hidden=off;if(off){if(bellIsOpen())closePop();return}
  if(bellIsOpen())bellSeenAll(S.me);const n=bellUnseen(S.me),nn=n?0:bellNewsUnseen(S.me);
  b.classList.toggle('on',n>0);b.innerHTML=ic('bell')+(n?`<span class="badge red bell-n">${bellCount(n)}</span>`:nn?'<span class="bell-nd"></span>':'');
  const t=n?`Уведомления: непросмотренных ${n}`:nn?'Уведомления: есть новости':'Уведомления';b.title=t;b.setAttribute('aria-label',t);b.setAttribute('aria-expanded',String(bellIsOpen()));
  if(bellIsOpen())bellDraw(POP)}
// Несколько перерисовок подряд (действие, отрисовка оболочки) — одна
const bellSoon=()=>{clearTimeout(bellPaint.t);bellPaint.t=setTimeout(bellPaint,30)};

function bellRow(x){const c=x.cp!=null?CPM[x.cp]:null,i=BELL_EV_IC[x.ev]||BELL_IC[x.kind]||'info';
  return `<button type="button" class="bell-it${x.read?'':' unread'}" data-bell="${x.id}"${x.open?'':' data-noopen="1"'}><span class="bell-ic">${ic(i,'sm')}</span><span class="bell-tx">${c?`<span class="bell-cp">${esc(c.name)}</span>`:''}<span class="bell-t">${esc(x.text)}</span></span><span class="bell-at">${esc(bellAgo(x.at))}</span>${x.read?'':'<span class="bell-dot" aria-label="Не открыто"></span>'}</button>`}
function bellListHtml(){const all=bellItems(S.me,BP.tab),l=all.slice(0,BP.n);let g='',h='';
  if(!l.length)return `<div class="bell-empty">${ic('bell','lg')}<b>Новых уведомлений нет</b>${BP.tab!=='all'&&bellItems(S.me,'all').length?'<button type="button" class="linkbtn" data-belltab="all">Показать все</button>':BP.tab==='all'&&bellItems(S.me,'news').length?'<button type="button" class="linkbtn" data-belltab="news">Новости</button>':''}</div>`;
  l.forEach(x=>{const k=bellGroup(x.at);if(k!==g){g=k;h+=`<div class="bell-g">${k}</div>`}h+=bellRow(x)});
  if(all.length>l.length)h+=`<div class="bell-more"><button type="button" class="btn sm" data-bellmore>Показать ещё</button><span class="muted">${l.length} из ${all.length}</span></div>`;
  return h}
function bellDraw(el){const keep=el.scrollTop,unread=bellItems(S.me).some(x=>!x.read);
  el.innerHTML=`<div class="grabber"></div><div class="bell-h"><div class="bell-top"><b>Уведомления</b><div class="grow"></div><button type="button" class="linkbtn" data-bellall${unread?'':' disabled'}>Прочитать все</button><button type="button" class="icon-btn sm" data-bellx aria-label="Закрыть" title="Закрыть">${ic('x')}</button></div>
    <div class="chipsel bell-tabs" role="group" aria-label="Что показать">${BELL_TABS.map(([k,t])=>`<button type="button" data-belltab="${k}" class="${BP.tab===k?'on':''}" aria-pressed="${BP.tab===k}">${t}</button>`).join('')}</div></div>
    <div class="bell-l" role="list">${bellListHtml()}</div>`;
  el.scrollTop=keep}
// Открыл панель — все строки просмотрены (счётчик гаснет и на других устройствах); жирными остаются те, что ещё не открывали
function bellOpen(){const b=bellBtn();BP.tab='all';BP.n=BELL_PAGE;
  openPop(b,'',{cls:'bell-pop',mount(el){el.setAttribute('role','dialog');el.setAttribute('aria-label','Уведомления');bellSeenAll(S.me);bellDraw(el);bellPaint();
    el.addEventListener('click',e=>{const t=e.target.closest('[data-belltab],[data-bellmore],[data-bellall],[data-bellx],[data-bell]');if(!t)return;
      if(t.dataset.bellx!=null){closePop();bellPaint();b.focus();return}
      if(t.dataset.belltab){BP.tab=t.dataset.belltab;BP.n=BELL_PAGE;el.scrollTop=0;bellDraw(el);return}
      if(t.dataset.bellmore!=null){BP.n+=BELL_PAGE;bellDraw(el);return}
      if(t.dataset.bellall!=null){bellReadAll(S.me);renderSide();renderSheetDot();bellDraw(el);toast('Все уведомления прочитаны','check');return}
      const x=bellItems(S.me).find(y=>y.id===t.dataset.bell);if(x)bellGo(x)})}});
  // openPop ставит панель под значком; размер и место на телефоне — из CSS (.bell-pop)
  b.setAttribute('aria-expanded','true')}
const bellToggle=()=>{if(bellIsOpen()){closePop();bellPaint();return}bellOpen()};

// Нажатие строки: прочитана и открыта запись (виды open — bell-contract.md потока Т); незнакомый вид или нет записи — только прочитана
function bellGo(x){const o=x.open;bellRead(x.id);closePop();bellPaint();if(!o)return;
  const id=o.id,c=CPM[id],gone=()=>toast('Запись удалена или больше вам не доступна','alert');
  switch(o.k){
    case 'report':{const r=REPORTS.find(y=>String(y.id)===String(id));return r?openReport(r):gone()}
    case 'task':{const t=allTasks().find(y=>String(y.id)===String(id));return t?openTask(t):gone()}
    case 'contractor':return c?openCp(c):gone();
    case 'cp_money':return c?openCp(c,'money'):gone();
    case 'cp_fee':return c?openCp(c,'fee'):gone();
    // «Отправленные файлы» — раздел вкладки «Файлы» карточки контрагента: окно прокручивается к нему
    case 'cp_sent':if(!c)return gone();openCp(c,'files');setTimeout(()=>{const s=$$('.modal .snt-box').pop();if(s)s.scrollIntoView({block:'start',behavior:'smooth'})},60);return;
    // Строка «Сроки на сегодня»: «Отчёты для сдачи» → «На неделе», мои отчёты (по умолчанию)
    case 'reports_day':return go('reports','week',seeAll('reports')?{resp:{type:'enum',vals:[empName(S.me)]}}:null);
    case 'reports_tab':return go('reports',id==='wait'?'waiting':id);
    case 'tasks_tab':return feat('tasks')?go('tasks',id):gone();
    case 'employee':{const e=EM[id];return e?empCard(e):gone()}
    case 'news':{const n=NEWS.find(y=>y.id===id);return n?newsOpen(n):gone()}
    case 'lead':{const l=LEADS.find(y=>String(y.id)===String(id));return l?openLead(l):gone()}
  }}

function bellInit(){const b=bellBtn();if(!b)return;b.onclick=bellToggle;bellOnChange=bellSoon;bellPaint();
  // Обновление: при открытии страницы, раз в минуту и при возврате на вкладку браузера; всплывающих уведомлений браузера нет
  setInterval(bellPaint,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)bellPaint()})}

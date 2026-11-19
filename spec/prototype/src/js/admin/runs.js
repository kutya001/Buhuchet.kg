'use strict';
// Админка → «Запуски»: задачи по расписанию и журнал их запусков (решение заказчика 17.11.2026; пока только в прототипе) — ТЗ «Доработки 17.11.2026», блок «Админка: запуски по расписанию и переписка бота»
// Только просмотр: запустить задачу или изменить расписание отсюда нельзя (по умолчанию). Видит только администратор платформы в режиме Админка.
// Демо-данные — задачи продукта (packages/api/src/jobs/registry.ts, названия — словарь alert.job.<имя>) и запуски с временем «минут назад» (ago):
// журнал всегда выглядит свежим. В продукте запуски — таблица scheduler_runs (хранится 30 дней), состояние задач — всегда.
/* ═════════════ Запуски по расписанию ═════════════ */
const RUN_JOBS=(DBSRC.demo.db.schedJobs||[]).map(j=>Object.assign({},j));
const RUN_JM=Object.fromEntries(RUN_JOBS.map(j=>[j.name,j]));
// Время запуска совпадает с расписанием: отрезок — последний момент по cron не позже «ago минут назад», повторы — через 2 и через 10 минут после неудачи.
// cron у продукта — по UTC, на экране — по Бишкеку (UTC+6)
const cronHit=(f,v)=>f==='*'||(f.startsWith('*/')?v%+f.slice(2)===0:f.split(',').some(x=>+x===v));
function cronSnap(cron,ms){const[m,h]=cron.split(' ');let t=Math.floor(ms/6e4)*6e4;for(let i=0;i<2000;i++,t-=6e4){const d=new Date(t);if(cronHit(m,d.getUTCMinutes())&&cronHit(h,(d.getUTCHours()+18)%24))return t}return ms}
const RUN_NOW=Date.now()+6*36e5,bkMs=t=>new Date(t).toISOString().slice(0,19).replace('T',' ');
const RUNS=(DBSRC.demo.db.schedRuns||[]).map(r=>{const j=RUN_JM[r.job]||{},slot=cronSnap(j.cron||'* * * * *',RUN_NOW-r.slot*6e4),st=slot+[0,2,12][r.tr-1]*6e4+(r.st==='Выполняется'?0:3e3);
  return Object.assign({},r,{start:bkMs(st).slice(0,16),slotAt:bkMs(slot).slice(0,16),ago:(RUN_NOW-st)/6e4,end:r.st==='Выполняется'||r.ms==null?'':bkMs(st+r.ms),title:j.title||r.job})});
// Сообщение о сбое ушло администраторам в момент третьей неудачной попытки
RUNS.forEach(r=>{const m=r.alert&&TG_LOG.find(x=>x.id===r.alert);if(m)m.at=r.start});
const RUN_ST={Успешно:['green','check'],Ошибка:['red','alert'],Выполняется:['yellow','hourglass']};
const JOB_ST={Работает:['green','check'],Падает:['red','alert'],'Не запускалась':['yellow','clock']};
// Пустой запуск: успешный и ничего не сделал — в «Важных» не показывается
const runEmpty=r=>r.st==='Успешно'&&r.done==='Нечего делать';
const runDur=r=>{if(r.st==='Выполняется'||r.ms==null)return '';const s=r.ms/1000;return s<60?`${String(Math.round(s*10)/10).replace('.',',')} с`:`${Math.floor(s/60)} мин ${Math.round(s%60)} с`};
const runTry=r=>`${r.tr} из 3`;
const runsOf=name=>RUNS.filter(r=>r.job===name).sort((a,b)=>a.ago-b.ago);
// Состояние задачи — те же правила, что у сообщения «Сбой в работе сайта» (в продукте): три неудачные попытки подряд — «Падает»;
// запуска по расписанию не было дольше двух периодов (и 5 минут запаса) — «Не запускалась»
function jobInfo(j){const rs=runsOf(j.name),done=rs.filter(r=>r.st!=='Выполняется');let fails=0;for(const r of done){if(r.st!=='Ошибка')break;fails++}
  const last=rs[0]||null,ok=done.find(r=>r.st==='Успешно')||null;
  const st=fails>=3?'Падает':!last||last.ago>j.min*2+5?'Не запускалась':'Работает';
  return {last,ok,fails,st,day:rs.filter(r=>r.st==='Ошибка'&&r.ago<1440).length}}
const jobRank={Падает:0,'Не запускалась':1,Работает:2};
const runSt=st=>pill(st,RUN_ST);
// Переключатель «Важные · Все» и период журнала запусков — на время сеанса
const RUNS_V={imp:true,per:'7'};
const RUN_PER=[['1','Сегодня'],['7','7 дней'],['30','30 дней']];
const runInPer=(at,per)=>per==='1'?at.startsWith(TODAY):at.slice(0,10)>=new Date(Date.parse(TODAY)-(+per-1)*864e5).toISOString().slice(0,10);
function renderRuns(body,tab,fresh){
  if(tab==='runs')return renderRunList(body,fresh);
  const info=new Map(RUN_JOBS.map(j=>[j.name,jobInfo(j)])),I=j=>info.get(j.name),n=st=>RUN_JOBS.filter(j=>I(j).st===st).length;
  const err=RUN_JOBS.reduce((s,j)=>s+I(j).day,0),work=n('Работает');
  body.innerHTML=`<div class="plates">${plate({id:'ok',icon:'check',color:work===RUN_JOBS.length?'green':'yellow',label:'Работают',value:`${work} из ${RUN_JOBS.length}`})}${plate({id:'fail',icon:'alert',color:n('Падает')?'red':'green',label:'Падают',value:n('Падает'),sub:'три неудачи подряд'})}${plate({id:'miss',icon:'clock',color:n('Не запускалась')?'yellow':'green',label:'Не запускались',value:n('Не запускалась'),sub:'пропущен запуск'})}${plate({id:'err',icon:'alert',color:err?'red':'green',label:'Ошибок за сутки',value:err})}</div><div id="jbg"></div>`;
  body.querySelector('.plates').onclick=e=>{const b=e.target.closest('[data-plate]');if(!b)return;
    if(b.dataset.plate==='err'){RUNS_V.imp=true;RUNS_V.per='1';return go('runs','runs',{st:{type:'enum',vals:['Ошибка']}})}
    const g=GS['run-jobs'];if(!g)return;g.filters={};const v={ok:'Работает',fail:'Падает',miss:'Не запускалась'}[b.dataset.plate];g.filters.st={type:'enum',vals:[v]};g.page=0;renderPage()};
  grid($('#jbg',body),{id:'run-jobs',audit:false,rid:j=>j.name,cols:[
    {key:'title',label:'Задача',type:'text',w:250,val:j=>j.title,html:j=>`<span class="strong">${esc(j.title)}</span>`},
    {key:'every',label:'Как часто',type:'enum',w:170,val:j=>j.every},
    {key:'last',label:'Последний запуск',type:'text',w:225,val:j=>I(j).last?I(j).last.start:'',sortVal:j=>I(j).last?I(j).last.start:'',html:j=>{const l=I(j).last;return l?`<span class="tnum">${fmtDT(l.start)}</span> ${runSt(l.st)}`:'<span class="faint">—</span>'}},
    {key:'ok',label:'Последний успех',type:'text',w:140,val:j=>I(j).ok?I(j).ok.start:'',html:j=>I(j).ok?`<span class="tnum">${fmtDT(I(j).ok.start)}</span>`:'<span class="faint">—</span>'},
    {key:'fails',label:'Неудач подряд',type:'int',w:110,num:true,val:j=>I(j).fails},
    {key:'st',label:'Состояние',type:'enum',w:160,val:j=>I(j).st,sortVal:j=>jobRank[I(j).st]+j.title.replace(/[«»]/g,''),html:j=>pill(I(j).st,JOB_ST)},
    {key:'what',label:'Что делает',type:'text',w:360,hide:1,val:j=>j.what},
    {key:'name',label:'Служебное имя',type:'text',w:250,hide:1,val:j=>j.name,cls:'mono'}],
    rows:()=>RUN_JOBS,title:'title',noun:['задача','задачи','задач'],sort:{key:'st',dir:1},simulateLoad:fresh,preset:S.preset,
    rowClass:j=>I(j).st==='Падает'?'overdue':'',
    // Нажатие на задачу — её запуски; «Все», чтобы были видны и пустые запуски ежеминутных задач (по умолчанию)
    open:j=>{RUNS_V.imp=false;RUNS_V.per='7';go('runs','runs',{title:{type:'enum',vals:[j.title]}})},
    actions:j=>[{label:'Запуски задачи',icon:'history',run:()=>{RUNS_V.imp=false;go('runs','runs',{title:{type:'enum',vals:[j.title]}})}}]});
}
function renderRunList(body,fresh){
  body.innerHTML=`<div class="row act-bar"><div class="seg" role="group" aria-label="Какие запуски"><button data-rv="1" class="${RUNS_V.imp?'on':''}" title="Ошибки и запуски, которые что-то сделали">Важные</button><button data-rv="0" class="${RUNS_V.imp?'':'on'}">Все</button></div><div class="seg" role="group" aria-label="Период">${RUN_PER.map(([k,l])=>`<button data-rp="${k}" class="${RUNS_V.per===k?'on':''}">${l}</button>`).join('')}</div><div class="grow"></div><span class="muted act-note">Время — по Бишкеку · журнал хранится 30 дней</span></div><div id="rng"></div>`;
  body.querySelector('.act-bar').onclick=e=>{const v=e.target.closest('[data-rv]'),p=e.target.closest('[data-rp]');if(v)RUNS_V.imp=v.dataset.rv==='1';else if(p)RUNS_V.per=p.dataset.rp;else return;const g=GS['run-list'];if(g)g.page=0;renderPage()};
  grid($('#rng',body),{id:'run-list',audit:false,rid:r=>r.id,cols:[
    {key:'start',label:'Начало',type:'text',w:140,val:r=>r.start,html:r=>`<span class="tnum">${fmtDT(r.start)}</span>`},
    {key:'title',label:'Задача',type:'enum',w:280,val:r=>r.title},
    {key:'st',label:'Итог',type:'enum',w:150,val:r=>r.st,html:r=>runSt(r.st)},
    {key:'dur',label:'Длительность',type:'text',w:120,val:runDur,sortVal:r=>r.ms||0},
    {key:'tr',label:'Попытка',type:'enum',w:100,val:runTry},
    {key:'done',label:'Что сделано',type:'text',w:280,val:r=>r.done,html:r=>r.done?esc(r.done):'<span class="faint">—</span>'},
    {key:'err',label:'Ошибка',type:'text',w:320,val:r=>r.err,cls:'mono'},
    {key:'slot',label:'За какое время',type:'text',w:140,hide:1,val:r=>r.slotAt,html:r=>`<span class="tnum">${fmtDT(r.slotAt)}</span>`},
    {key:'end',label:'Окончание',type:'text',w:150,hide:1,val:r=>r.end,html:r=>r.end?`<span class="tnum">${fmtDT(r.end)}:${r.end.slice(17,19)}</span>`:'<span class="faint">—</span>'}],
    rows:()=>RUNS.filter(r=>(!RUNS_V.imp||!runEmpty(r))&&runInPer(r.start,RUNS_V.per)),title:'title',noun:['запуск','запуска','запусков'],sort:{key:'start',dir:-1},simulateLoad:fresh,preset:S.preset,
    rowClass:r=>r.st==='Ошибка'?'overdue':'',open:runDlg,
    empty:{icon:'check',title:'Запусков за период нет',text:RUNS_V.imp?'Ошибок нет, пустые успешные запуски скрыты. Переключите на «Все» или выберите период длиннее.':'Выберите период длиннее.'}});
}
// Окно «Запуск»: всё о запуске, прежние попытки того же запуска и сообщение о сбое администраторам
function runDlg(r){const j=RUN_JM[r.job]||{},tries=RUNS.filter(x=>x.job===r.job&&x.slot===r.slot&&x!==r).sort((a,b)=>a.tr-b.tr),al=r.alert&&TG_LOG.find(x=>x.id===r.alert);
  const kv=(k,v)=>`<div><span class="k">${k}</span><span class="v">${v}</span></div>`,dash='<span class="faint">—</span>';
  openModal({size:'mid',render:()=>({title:esc(r.title),sub:`${runSt(r.st)} · ${fmtDT(r.start)} · попытка ${runTry(r)}`,
    body:`<div class="box"><div class="kv">${kv('Задача',`${esc(r.title)}<div class="hint mono">${esc(r.job)}</div>`)}${kv('Как часто',esc(j.every||'—'))}${kv('За какое время',`<span class="tnum">${fmtDT(r.slotAt)}</span>`)}${kv('Начало',`<span class="tnum">${fmtDT(r.start)}</span>`)}${kv('Окончание',r.end?`<span class="tnum">${fmtDT(r.end)}:${r.end.slice(17,19)}</span>`:'ещё выполняется')}${kv('Длительность',runDur(r)||dash)}${kv('Попытка',runTry(r))}${kv('Что сделано',r.done?esc(r.done):dash)}</div></div>
    ${r.err?`<div class="box"><h3>Ошибка</h3><pre class="mono run-err">${esc(r.err)}</pre><div class="row"><button class="btn sm" id="run-copy">${ic('copy','sm')}Скопировать</button></div></div>`:''}
    ${tries.length?`<div class="box"><h3>Другие попытки этого запуска</h3><ul class="tl">${tries.map(x=>`<li><span class="t">${fmtD(x.start.slice(0,10))}<br>${x.start.slice(11)}</span><span><button type="button" class="linkbtn" data-run="${x.id}">Попытка ${runTry(x)}</button> · ${runSt(x.st)}${x.err?`<br><span class="w mono">${esc(x.err)}</span>`:''}</span></li>`).join('')}</ul><div class="hint">Неудачный запуск сайт повторяет сам через 2 и через 10 минут — всего не больше трёх попыток.</div></div>`:''}
    ${al?`<div class="note bad">${ic('tg')}<span>Администраторам отправлено сообщение о сбое · ${fmtDT(al.at)} · <button type="button" class="linkbtn" id="run-al">открыть в журнале Telegram</button></span></div>`:''}`,
    foot:'<div class="grow"></div><button class="btn cta" data-close>Закрыть</button>',
    mount(el,m){const c=$('#run-copy',el);if(c)c.onclick=()=>copyText(r.err,'Текст ошибки скопирован');
      el.querySelectorAll('[data-run]').forEach(b=>b.onclick=()=>{const x=RUNS.find(y=>y.id===b.dataset.run);if(x){m.close();runDlg(x)}});
      const a=$('#run-al',el);if(a)a.onclick=()=>{MODALS.slice().forEach(x=>x.close());tgLogShow(al)}}})})}

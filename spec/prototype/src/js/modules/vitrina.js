'use strict';
// Модуль «Витрина данных» у организации и в Админке: шаблоны отчётов на SQL, «Вывод» в таблице как в Excel, API-токены и журнал запросов
// ТЗ «Доработки 20.11.2026: Витрина данных», блоки 1–7 (решения заказчика 20.11.2026); пакет 20.11, этап 0, П10, поток К.
// Прототип не выполняет SQL (ТЗ, «Порядок работ»): готовые шаблоны считаются кодом прототипа на демо-данных (DM_RUN по коду шаблона), текст запроса в окне шаблона — для вида;
// проверка и выполнение запроса, роли базы только для чтения, пределы и внешний адрес — по ТЗ на тестовом стенде. От токена хранятся только первые знаки (в продукте — хеш).
/* ═════════════ Витрина данных ═════════════ */
const DM_TPL=DB.ref.dmTemplates,DM_TOK=DB.dmTokens,DM_LOG=DB.dmLog,DMST=DB.ref.statuses.dmTemplate;
STATUS_GROUPS.push(['Состояния шаблонов витрины данных',DMST,'dm','1 Черновик → 2 Опубликован; «Отключён» ставит администратор платформы, «Сломан» — система, когда шаблон не выполнился при проверке: отметки вне шкалы.']);
SCALES.dm={map:()=>DMST,steps:['Черновик','Опубликован'],none:['Отключён','Сломан']};SC_NAME.dm='Шаблон витрины';
const DM_MODS={cps:'Контрагенты',reports:'Отчеты для сдачи',fin:'Финансовые операции по контрагентам',projects:'Проекты контрагентов',kpi:'Показатели контрагентов',staff:'Сотрудники'};
const DM_PT={date:'Дата',month:'Месяц',year:'Год',num:'Число',text:'Текст',bool:'Да или нет','list:cp':'Контрагент из списка','list:emp':'Сотрудник из списка','list:rtype':'Вид отчёта из списка','list:status':'Статус отчёта из списка'};
const DM_CT={text:'Текст',num:'Число',money:'Деньги',date:'Дата',datetime:'Дата и время',month:'Месяц',bool:'Да или нет',cp:'Контрагент (для области)'};
const DM_DEF={today:'Сегодня',month:'Текущий месяц',year:'Текущий год',month_start:'Начало текущего месяца',month_end:'Конец текущего месяца',days_ago_30:'30 дней назад',month_ago_5:'5 месяцев назад'};
const DM_TERMS=[7,30,90,180],DM_TOK_MAX=20;
const DM_TST={Действует:['green','check'],Истёк:['faint','clock'],Отозван:['faint','ban'],Остановлен:['yellow','pause']};
const DM_RES={Успешно:['green','check'],Ошибка:['red','alert']};
const DMV={tpl:null,org:'o1',p:null};
const dmDemo=()=>typeof DEMO!=='undefined'&&!!DEMO.on;
const dmTpl=code=>DM_TPL.find(t=>t.code===code)||null;
const dmIn=(d,a,b)=>!!d&&d>=a&&d<=b;
const dmOpen=r=>!['Сдан','Не требуется'].includes(r.status);
const dmRepN=r=>(T[r.t]||{}).short||r.t;
const dmCpN=(D,id)=>D.cpm[id]?D.cpm[id].name:'';
const dmOrgN=id=>id==='adm'?'Администратор платформы':id===ORG.id?ORG.name:subOrgName(id)||id;
const dmApiOn=id=>id==='adm'||(id===ORG.id?!!ORG.apiOn:!!(ORGS.find(o=>o.id===id)||{}).apiOn);
function dmDef(d){const m=ym(TODAY);switch(d){case 'today':return TODAY;case 'month':return m;case 'year':return TODAY.slice(0,4);case 'month_start':return m+'-01';case 'month_end':return lastDay(m);
  case 'days_ago_30':return addDays(TODAY,-30);case 'month_ago_5':return addMonths(m,-5);default:return d||''}}
const dmAccess=(t,org)=>t.access==='all'||(Array.isArray(t.access)&&t.access.includes(org));
// Шаблон виден сотруднику организации: вид «Для организаций», не черновик и не отключён, разрешён организации, есть просмотр модуля шаблона и его дополнительное право;
// без столбца «Контрагент» (итоги по всей организации) — только владельцу и при «Все контрагенты» в группе прав модуля (блок 2, пункт 6)
function dmSee(t){if(t.kind!=='org'||t.state==='Черновик'||t.state==='Отключён'||!dmAccess(t,ORG.id))return false;
  const g=PERM_GROUPS.find(x=>x.id===t.mod);if(g&&g.feature&&!feat(g.feature))return false;if(t.perm==='fee'&&!feat('fee'))return false;
  const v=PERM_VIEW[t.mod];if(v&&!can(v))return false;if(t.perm&&!can(t.perm))return false;
  return !!t.cpCol||!SCOPE_GROUPS.includes(t.mod)||seeAll(t.mod)}

/* Готовые шаблоны: расчёт на данных прототипа. D — данные организации (своя — живые; другая, когда администратор смотрит «глазами организации», — набор её карточки, денег в нём нет) */
function dmCtx(orgId){if(!orgId||orgId===ORG.id)return {self:true,cps:CPS,cpm:CPM,reps:REPORTS.filter(r=>!r.superseded&&r.due),tasks:TASKS,who:id=>empName(id)||whoName(id)||''};
  const d=ocData(ORGS.find(x=>x.id===orgId));return {self:false,cps:d.cps,cpm:d.cpm,reps:d.reps,tasks:d.tasks,who:d.who}}
const DM_RUN={
 contractors:D=>D.cps.filter(c=>!c.archived).map(c=>({_cp:c.id,cp:c.name,inn:c.inn||'',form:c.form||'',regime:c.regime||'',resp:D.who(c.resp),svc:c.status&&!c.periods?c.status:cpStatus(c),start:c.start||''})),
 'reports-due':(D,p)=>D.reps.filter(r=>dmIn(r.due,p.date_from,p.date_to)&&(!p.status||r.status===p.status)).sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:COLL.compare(dmCpN(D,a.cp),dmCpN(D,b.cp)))
   .map(r=>({_cp:r.cp,cp:dmCpN(D,r.cp),rep:dmRepN(r),period:r.plabel,due:r.due,status:r.status,sum:r.sum||0,paid:r.paid||0,resp:D.who(r.resp)})),
 'reports-overdue':(D,p)=>D.reps.filter(r=>dmOpen(r)&&r.due<p.date).sort((a,b)=>a.due<b.due?-1:1)
   .map(r=>({_cp:r.cp,cp:dmCpN(D,r.cp),rep:dmRepN(r),period:r.plabel,due:r.due,days:diffDays(p.date,r.due),status:r.status,resp:D.who(r.resp)})),
 'reports-by-staff':(D,p)=>{const by={};D.reps.filter(r=>r.due.slice(0,7)===p.month).forEach(r=>{const k=D.who(r.resp)||'Без ответственного',x=by[k]=by[k]||{emp:k,total:0,done:0,overdue:0,remaining:0};
   x.total++;if(!dmOpen(r))x.done++;else if(r.due<TODAY)x.overdue++;else x.remaining++});return Object.values(by).sort((a,b)=>COLL.compare(a.emp,b.emp))},
 'tax-due':(D,p)=>{const by={};D.reps.filter(r=>r.sum>0&&(r.payDue||r.due).slice(0,7)===p.month).forEach(r=>{const x=by[r.cp]=by[r.cp]||{_cp:r.cp,cp:dmCpN(D,r.cp),sum:0,paid:0,rest:0};
   x.sum+=r.sum;x.paid+=r.paid||0;x.rest+=Math.max(0,r.sum-(r.paid||0))});return Object.values(by).sort((a,b)=>b.rest-a.rest||COLL.compare(a.cp,b.cp))},
 'service-fee':(D,p)=>D.self?revenueData(+p.year).filter(r=>r.c.kind!=='oneoff'&&(r.feeCh||r.fee)).map(r=>({_cp:r.c.id,cp:r.c.name,charged:r.feeCh,paid:r.fee,debt:Math.max(0,r.feeCh-r.fee)})).sort((a,b)=>b.debt-a.debt||COLL.compare(a.cp,b.cp)):[],
 debtors:(D,p)=>D.self?CPS.filter(c=>c.kind!=='oneoff'&&c.feePaid).map(c=>{const ms=feeMonths(c).filter(m=>feeDue(c,m)<=p.date&&feeCharge(c,m)-feeGot(c,m)>0);
   return {_cp:c.id,cp:c.name,debt:ms.reduce((a,m)=>a+feeCharge(c,m)-feeGot(c,m),0),months:ms.length,resp:empName(c.resp)}}).filter(x=>x.debt>0).sort((a,b)=>b.debt-a.debt):[],
 'money-operations':(D,p)=>D.self?OPS.filter(o=>!o.del&&dmIn(o.date,p.date_from,p.date_to)).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0)
   .map(o=>({_cp:o.cp,date:o.date,cp:dmCpN(D,o.cp),kind:(OPK[o.kind]||[o.kind])[0],amount:o.amount,note:o.note||''})):[],
 revenue:(D,p)=>D.self?revenueData(+p.year).filter(r=>r.total>0).map(r=>({_cp:r.c.id,cp:r.c.name,fee:r.fee,proj:r.proj,svc:r.svc,total:r.total})).sort((a,b)=>b.total-a.total):[],
 'projects-services':(D,p)=>D.self?[...PROJECTS.filter(x=>!x.del&&dmIn(x.from,p.date_from,p.date_to)).map(x=>{const pd=sumPays(x.pays);return {_cp:x.cp,kind:'Проект',name:x.name,cp:dmCpN(D,x.cp),date:x.from,cost:x.plan||0,paid:pd,debt:Math.max(0,(x.plan||0)-pd)}}),
   ...SERVICES.filter(s=>!s.del&&dmIn(s.date,p.date_from,p.date_to)).map(s=>{const pd=svcPaid(s);return {_cp:s.cp,kind:'Разовая услуга',name:s.name,cp:dmCpN(D,s.cp),date:s.date,cost:s.amount,paid:pd,debt:Math.max(0,s.amount-pd)}})].sort((a,b)=>a.date<b.date?-1:1):[],
 'indicators-by-month':(D,p)=>D.self?IVALS.filter(v=>v.v!=null&&v.m>=p.month_from&&v.m<=p.month_to).map(v=>{const i=IND.find(x=>x.id===v.ind)||{};return {_cp:v.cp,cp:dmCpN(D,v.cp),ind:i.name||v.ind,month:v.m,value:v.v,unit:i.unit||'',_o:i.order||0}})
   .sort((a,b)=>COLL.compare(a.cp,b.cp)||a._o-b._o||(a.month<b.month?-1:1)):[],
 tasks:(D,p)=>D.tasks.filter(t=>dmIn(t.date,p.date_from,p.date_to)).sort((a,b)=>a.date<b.date?-1:1).map(t=>({_cp:t.cp||null,title:t.title,cp:t.cp?dmCpN(D,t.cp):'',exec:D.who(t.exec),due:t.date,status:t.status||''})),
 orgs:()=>ORGS.map(o=>{const s=orgSum(o);return {org:o.name,status:o.active===false?'Заблокирована':'Активна',staff:s.staff,cps:s.cps.reg+s.cps.once+s.cps.pau,mb:s.files.mb}}).sort((a,b)=>COLL.compare(a.org,b.org)),
 'org-activity':(D,p)=>{const by={};ORGS.forEach(o=>{const ls=new Set(orgUsers(o).map(u=>u.login));SESS.forEach(s=>{const d=s.at.slice(0,10);if(!ls.has(s.u)||!dmIn(d,p.date_from,p.date_to))return;
   const x=by[d+'|'+o.id]=by[d+'|'+o.id]||{day:d,org:o.name,logins:0,us:new Set()};x.logins++;x.us.add(s.u)})});
   return Object.values(by).map(x=>({day:x.day,org:x.org,logins:x.logins,users:x.us.size})).sort((a,b)=>a.day<b.day?1:a.day>b.day?-1:COLL.compare(a.org,b.org))},
 subscriptions:(D,p)=>SUB_PAYS.filter(x=>dmIn(x.at.slice(0,10),p.date_from,p.date_to)).sort((a,b)=>a.at<b.at?1:-1)
   .map(x=>({at:x.at.slice(0,10),org:subOrgName(x.org),what:SUB_WHAT[x.what]||x.what,pack:x.pack||0,gb:x.extraGb||0,sum:x.sum||0,status:SUB_PAY_ST[x.status]||x.status,paid_to:x.paidTo||''})),
 leads:(D,p)=>LEADS.filter(l=>dmIn(l.at.slice(0,10),p.date_from,p.date_to)).sort((a,b)=>a.at<b.at?1:-1).map(l=>({at:l.at.slice(0,10),firm:l.firm||'',size:l.size||'',status:l.status})),
 'bot-messages':(D,p)=>{const by={};TG_LOG.forEach(m=>{const d=(m.at||'').slice(0,10);if(!dmIn(d,p.date_from,p.date_to))return;const x=by[d]=by[d]||{day:d,sent:0,errors:0};if(m.st==='Отправлено')x.sent++;else if(m.st==='Ошибка')x.errors++});
   return Object.values(by).sort((a,b)=>a.day<b.day?1:-1)},
 'scheduler-runs':(D,p)=>{const by={};RUNS.forEach(r=>{if(!dmIn(r.start.slice(0,10),p.date_from,p.date_to))return;const x=by[r.title]=by[r.title]||{job:r.title,runs:0,ok:0,errors:0,last:''};
   x.runs++;if(r.st==='Успешно')x.ok++;else if(r.st==='Ошибка')x.errors++;if(r.start>x.last)x.last=r.start});return Object.values(by).sort((a,b)=>b.errors-a.errors||COLL.compare(a.job,b.job))}};
// Расчёт шаблона: номер организации — из сеанса (у администратора — выбранная организация, расчёт от лица её владельца); «Свои контрагенты» — строки только своих контрагентов по столбцу «Контрагент»
function dmRun(t,p,orgId){const f=DM_RUN[t.run||t.code];if(!f||t.state==='Сломан')return null;const t0=performance.now();let rows;
  if(t.kind==='adm')rows=f(null,p);else{const D=dmCtx(orgId);rows=isAdmin()&&D.self?asOrg(()=>f(D,p)):f(D,p)}
  if(!isAdmin()&&t.kind==='org'&&t.cpCol&&SCOPE_GROUPS.includes(t.mod)&&!seeAll(t.mod))rows=rows.filter(r=>r._cp!=null&&CPM[r._cp]&&CPM[r._cp].resp===S.me);
  rows.forEach((r,i)=>r._i=i);return {rows,ms:Math.max(1,Math.round(performance.now()-t0))}}

/* Параметры шаблона: последние значения запоминаются для пользователя (блок 4, пункт 1) */
function dmPar(t){const sv=store.get('dm.p.'+S.me+'.'+t.code,{}),p={};t.params.forEach(x=>{p[x.k]=sv[x.k]!=null?sv[x.k]:dmDef(x.def)});return p}
function dmParHtml(t,p){return t.params.map(x=>{const id='dmp-'+x.k,v=p[x.k]??'';let c;
  if(x.type==='date')c=`<input type="date" class="inp" id="${id}" value="${esc(v)}">`;else if(x.type==='month')c=`<input type="month" class="inp" id="${id}" value="${esc(v)}">`;
  else if(x.type==='year')c=sel(id,[0,1,2,3,4].map(i=>String(+TODAY.slice(0,4)-i)),v);else if(x.type==='list:status')c=sel(id,[['','Все статусы'],...Object.keys(ST).map(k=>[k,stl(k)])],v);
  else if(x.type==='bool')c=sel(id,[['','Не важно'],['1','Да'],['0','Нет']],v);else c=inp(id,v);
  return fld(esc(x.label),c,{req:x.req,id})}).join('')}
function dmParRead(el,t){const p={};let ok=true;t.params.forEach(x=>{const v=val(el,'dmp-'+x.k);p[x.k]=v||null;if(!setErr(el,'dmp-'+x.k,x.req&&!v?'Укажите значение':''))ok=false});
  if(ok&&p.date_from&&p.date_to&&p.date_from>p.date_to)ok=setErr(el,'dmp-date_to','«По дату» раньше «С даты»');if(ok&&p.month_from&&p.month_to&&p.month_from>p.month_to)ok=setErr(el,'dmp-month_to','Месяц раньше начального');
  return ok?p:null}

/* Таблица результата: столбцы шаблона; «как в Excel» — только просмотр (exTable ro) */
const DM_GT={text:'text',num:'num',money:'money',date:'date',datetime:'datetime',month:'enum',bool:'enum'};
const dmNumTxt=v=>v==null||v===''?'':fmtM(v,Math.round(v*100)%100!==0);
function dmCol(c,i){const o={key:c.k,label:c.label,type:DM_GT[c.type]||'text',w:c.type==='text'?(i===0?230:170):c.type==='money'?140:120,num:c.type==='num'||c.type==='money',val:r=>r[c.k],td:()=>`data-dx="${i}"`};
  if(c.type==='month'){o.text=r=>r[c.k]?ymLabel(r[c.k]):'';o.sortVal=r=>r[c.k]}
  if(c.type==='num')o.text=r=>dmNumTxt(r[c.k]);if(c.type==='bool')o.text=r=>r[c.k]==null?'':r[c.k]?'Да':'Нет';
  if(c.total&&o.num)o.total=c.type==='money'?true:rows=>dmNumTxt(Math.round(rows.reduce((a,r)=>a+(+r[c.k]||0),0)*100)/100);
  return o}
const dmNum=s=>{const v=parseFloat(String(s).replace(/[\s ]/g,'').replace('−','-').replace(',','.'));return isNaN(v)?null:v};
function dmEx(host,stat){const sc=$('.gscroll',host);if(!sc)return;const TD=[];
  $$('tbody tr[data-id]',sc).forEach(tr=>{const ts=$$('td[data-dx]',tr);if(!ts.length)return;const r=TD.length;ts.forEach((t,c)=>{t.dataset.sr=r;t.dataset.sc=c});TD.push(ts)});
  if(!TD.length){if(stat)stat.innerHTML='';return}
  exTable(sc,{ro:true,rows:TD.length,cols:Math.max(...TD.map(x=>x.length)),stat,hint:'Выделите ячейки мышью или с Shift: внизу — количество, сумма и среднее. Ctrl+C копирует выделенное для вставки в Excel',
    label:(r,c)=>{const t=TD[r]&&TD[r][c];return t?t.textContent.trim():'Ячейка'},
    get:(r,c)=>{const t=TD[r]&&TD[r][c];if(!t)return {t:'',n:null,ed:false};const tx=t.textContent.trim();return {t:tx,n:t.classList.contains('num')?dmNum(tx):null,ed:false,why:'Значения в выводе не правятся'}},
    put:()=>({}),draw:()=>{}})}
function dmDraw(host,t,p,orgId){
  if(t.state==='Сломан'){host.innerHTML=`<div class="state">${ic('alert','lg')}<b>Шаблон временно не работает. Администратор уже знает</b>${isAdmin()&&t.err?`<span>${esc(t.err)}</span>`:''}</div>`;return}
  const r=dmRun(t,p,orgId);
  if(!r){host.innerHTML=`<div class="note">${ic('info')}<span>Прототип не выполняет SQL: результат этого шаблона появится на тестовом стенде. Здесь показываются результаты готовых шаблонов и их копий.</span></div>`;return}
  host.innerHTML=`<div class="row dm-meta"><span class="hint" style="margin:0">Строк: <b>${r.rows.length}</b> · выполнено за ${r.ms} мс${t.kind==='org'&&isAdmin()?` · глазами организации «${esc(dmOrgN(orgId))}»`:''}</span></div><div class="ex-stat" id="dm-st"></div><div id="dm-g"></div>`;
  grid($('#dm-g',host),{id:'dm-'+t.code,audit:false,fixedView:'table',size:'all',rid:x=>x._i,ordered:true,noun:['строка','строки','строк'],cols:t.cols.filter(c=>c.type!=='cp').map(dmCol),rows:r.rows,
    empty:{icon:'search',title:'По этим параметрам данных нет',text:'Измените параметры и нажмите «Показать».'},after:h=>dmEx(h,$('#dm-st',host))})}

/* Вкладка «Вывод» (блок 4) */
function dmOutList(){return isAdmin()?DM_TPL.filter(t=>t.state!=='Черновик'&&t.state!=='Отключён'):DM_TPL.filter(dmSee)}
function dmOptHtml(L,cur){const gs=[];L.forEach(t=>{const g=t.kind==='adm'?'Для администратора':(isAdmin()?'Для организаций · ':'')+(DM_MODS[t.mod]||'Прочее');let x=gs.find(y=>y[0]===g);if(!x)gs.push(x=[g,[]]);x[1].push(t)});
  return gs.map(([g,ts])=>`<optgroup label="${esc(g)}">${ts.map(t=>`<option value="${esc(t.code)}" ${t.code===cur?'selected':''}>${esc(t.name)}${t.state==='Сломан'?' — не работает':''}</option>`).join('')}</optgroup>`).join('')}
function renderDmOut(body){const L=dmOutList();
  if(!L.length){body.innerHTML=`<div class="state">${ic('table','lg')}<b>Шаблонов пока нет</b><span>${isAdmin()?'Опубликуйте шаблон во вкладке «Шаблоны».':'Для ваших прав нет ни одного шаблона. Не хватает отчёта — попросите шаблон во вкладке «Шаблоны».'}</span></div>`;return}
  const t=L.find(x=>x.code===DMV.tpl)||L[0];DMV.tpl=t.code;const p=DMV.p&&DMV.p.code===t.code?DMV.p.v:dmPar(t),orgSel=isAdmin()&&t.kind==='org';
  body.innerHTML=`<div class="box dm-q"><div class="dm-pars">${fld('Шаблон',`<select class="inp" id="dm-t">${dmOptHtml(L,t.code)}</select>`,{id:'dm-t'})}${orgSel?fld('Глазами организации',sel('dm-org',ORGS.map(o=>[o.id,o.name]),DMV.org),{id:'dm-org'}):''}${dmParHtml(t,p)}<button class="btn cta" id="dm-go">${ic('play','sm')}Показать</button></div>${t.desc?`<span class="hint" style="margin:0">${esc(t.desc)}</span>`:''}</div><div id="dm-res"></div>`;
  $('#dm-t',body).onchange=e=>{DMV.tpl=e.target.value;DMV.p=null;renderPage()};
  $('#dm-go',body).onclick=()=>{const v=dmParRead(body,t);if(!v)return;store.set('dm.p.'+S.me+'.'+t.code,v);DMV.p={code:t.code,v};
    if(orgSel){DMV.org=val(body,'dm-org');if(DMV.org!==ORG.id)log('porg',DMV.org,`Открыт шаблон витрины данных «${t.name}» глазами организации`)}
    dmDraw($('#dm-res',body),t,v,orgSel?DMV.org:ORG.id);if(t.state!=='Сломан')ckHit('dm.run')};
  dmDraw($('#dm-res',body),t,p,orgSel?DMV.org:ORG.id)}

/* Вкладка «Шаблоны»: у организации — каталог, в Админке — список и окно шаблона (блок 3) */
function renderDmTpl(body){if(isAdmin())return renderDmTplAdm(body);const L=DM_TPL.filter(dmSee),tk=can('dmTokens')&&!dmDemo();
  const gs=Object.keys(DM_MODS).map(m=>[m,L.filter(t=>t.mod===m)]).filter(x=>x[1].length);
  body.innerHTML=`<div class="note dm-ask-note">${ic('info')}<span>Готовые отчёты платформы. «Показать» открывает отчёт во вкладке «Вывод»${tk?'; «Выпустить токен» даёт внешней программе (Excel, Power BI, 1С) ключ к этому отчёту':''}. Не хватает отчёта — попросите шаблон: его добавит администратор платформы.</span><button type="button" class="btn sm" id="dm-ask">${ic('send','sm')}Попросить шаблон</button></div>
    ${gs.length?gs.map(([m,ts])=>`<h3 class="dm-h">${esc(DM_MODS[m])} <span class="faint">${ts.length}</span></h3><div class="dm-cards">${ts.map(t=>`<div class="box dm-card"><div class="row" style="align-items:flex-start"><b class="grow">${esc(t.name)}</b>${t.state==='Сломан'?pill('Сломан',DMST):''}</div>
      <span class="muted">${esc(t.desc||'')}</span><span class="hint" style="margin:0">Параметры: ${t.params.length?t.params.map(x=>esc(x.label)).join(', '):'нет'}${t.perm==='fee'?' · нужно право «Видеть плату за обслуживание»':''}</span>
      <details><summary>Столбцы · ${t.cols.filter(c=>c.type!=='cp').length}</summary><ul class="dm-cols">${t.cols.filter(c=>c.type!=='cp').map(c=>`<li>${esc(c.label)} <span class="faint">${esc(DM_CT[c.type]||c.type)}${c.total?', итог':''}</span></li>`).join('')}</ul></details>
      <div class="row" style="margin-top:auto"><button type="button" class="btn sm cta" data-dm-show="${esc(t.code)}">${ic('table','sm')}Показать</button>${tk?`<button type="button" class="btn sm" data-dm-tok="${esc(t.code)}">${ic('key','sm')}Выпустить токен</button>`:''}</div></div>`).join('')}</div>`).join('')
    :`<div class="state">${ic('table','lg')}<b>Шаблонов для ваших прав нет</b><span>Шаблон виден, если у роли есть просмотр его модуля. Не хватает отчёта — попросите шаблон.</span></div>`}`;
  $('#dm-ask',body).onclick=dmAskDlg;
  body.onclick=e=>{let b;if(b=e.target.closest('[data-dm-show]')){DMV.tpl=b.dataset.dmShow;DMV.p=null;go('dm','out')}else if(b=e.target.closest('[data-dm-tok]'))dmNewDlg(b.dataset.dmTok)}}
// «Попросить шаблон» — как «Попросить добавить» в «Справочниках»: запрос администратору платформы, ответ — в «Мои запросы»
function dmAskDlg(){openModal({form:true,render:()=>({title:'Попросить шаблон',sub:'Запрос уйдёт администратору платформы',body:`<div class="form">${fld('Какого отчёта не хватает',inp('dq-v','','placeholder="Например: Отчёты, сданные с опозданием, по месяцам"'),{req:true,full:true,id:'dq-v'})}${fld('Какие столбцы и за какой период',`<textarea class="inp" id="dq-c" style="min-height:70px" placeholder="Контрагент, отчёт, срок, дата сдачи, на сколько дней опоздали"></textarea>`,{full:true,id:'dq-c'})}</div>`,
  foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="dq-ok">Отправить запрос</button>',mount(el,m){$('#dq-ok',el).onclick=()=>{if(!setErr(el,'dq-v',!val(el,'dq-v')?'Опишите, какого отчёта не хватает':reqHour()>=REQ_HOUR?'Не больше 20 запросов за час. Отправьте этот запрос позже':''))return;
    REQUESTS.push({_cb:S.me,_ca:nowStamp(),at:TODAY,oid:ORG.id,org:ORG.name,what:val(el,'dq-v'),dict:'Витрина данных',note:val(el,'dq-c'),status:'Новый',answer:''});m.close();toast('Запрос отправлен администратору платформы','send',false,{label:'Мои запросы',run:myReqDlg})}}})})}
const dmLive=k=>dmTokSt(k)[0]==='Действует';
function dmUse(t){const ks=DM_TOK.filter(k=>k.tpl===t.code&&dmLive(k)),from=addDays(TODAY,-30),os=new Set(ks.filter(k=>k.org!=='adm').map(k=>k.org));
  DM_LOG.forEach(x=>{if(x.tpl===t.code&&x.org!=='adm'&&x.at.slice(0,10)>=from)os.add(x.org)});return {toks:ks.length,orgs:t.kind==='adm'?0:os.size,tokOrgs:new Set(ks.map(k=>k.org)).size}}
function renderDmTplAdm(body){
  body.innerHTML=`<div class="note">${ic('info')}<span>Шаблоны пишет администратор платформы на SQL: один оператор SELECT к таблицам базы, параметры — :month, :date_from. Чужую организацию и секреты закрывает сама база. Готовые шаблоны приходят с программой: их можно отключить и сделать свой копированием. Прототип не выполняет SQL: готовые шаблоны считаются на демо-данных, проверка запроса — на тестовом стенде.</span></div><div id="dm-tg"></div>`;
  grid($('#dm-tg',body),{id:'dm-tpl',audit:false,sort:{key:'name',dir:1},noun:['шаблон','шаблона','шаблонов'],cols:[
    {key:'name',label:'Название',type:'text',w:270,val:t=>t.name,html:t=>`<span class="strong">${esc(t.name)}</span>${t.src==='system'?' <span class="tag">готовый</span>':''}`},
    {key:'code',label:'Код',type:'text',w:170,val:t=>t.code,cls:'mono'},
    {key:'kind',label:'Вид',type:'enum',w:170,val:t=>t.kind==='adm'?'Для администратора':'Для организаций'},
    {key:'state',label:'Состояние',type:'enum',w:150,val:t=>t.state,html:t=>pill(t.state,DMST)},
    {key:'orgs',label:'Организаций пользуется',type:'int',w:130,num:true,val:t=>t.kind==='adm'?null:dmUse(t).orgs},
    {key:'toks',label:'Токенов',type:'int',w:90,num:true,val:t=>dmUse(t).toks},
    {key:'checked',label:'Проверен',type:'datetime',w:150,val:t=>t.checked||''},
    {key:'mod',label:'Модуль',type:'enum',w:220,hide:true,val:t=>DM_MODS[t.mod]||'—'}],
    rows:()=>DM_TPL,open:t=>dmEdit(t),
    actions:t=>[{label:'Открыть',icon:'edit',run:()=>dmEdit(t)},{label:'Копировать',icon:'copy',run:()=>dmCopy(t)},
      t.state==='Отключён'?{label:'Включить',icon:'check',run:()=>dmStateDlg(t,'Опубликован')}:t.state!=='Черновик'&&{label:'Отключить',icon:'ban',run:()=>dmStateDlg(t,'Отключён')}].filter(Boolean)})}
function dmHist(t,what){(t.hist=t.hist||[]).push({at:nowStamp(),who:S.me,what});t._ub=S.me;t._ua=nowStamp();pdLog(`Витрина данных: шаблон «${t.name}»: ${what}`,'dm')}
function dmStateDlg(t,to){const u=dmUse(t),warn=to==='Отключён'&&u.toks?` Действующих токенов: ${u.toks} в ${u.tokOrgs} ${plural(u.tokOrgs,'организации','организациях','организациях')} — они перестанут отвечать.`:'';
  openModal({form:true,render:()=>({title:to==='Отключён'?'Отключить шаблон?':'Включить шаблон?',sub:esc(t.name),body:`<p class="muted" style="margin:0 0 10px">${to==='Отключён'?`Шаблон пропадёт из каталога организаций.${warn}`:'Шаблон снова будет виден организациям из его доступа, токены снова заработают.'}</p>${fld('Причина',`<textarea class="inp" id="ds-w" style="min-height:60px"></textarea>`,{req:true,full:true,id:'ds-w'})}`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn ${to==='Отключён'?'danger':'cta'}" id="ds-ok">${to==='Отключён'?'Отключить':'Включить'}</button>`,
    mount(el,m){$('#ds-ok',el).onclick=()=>{const w=val(el,'ds-w');if(!setErr(el,'ds-w',w?'':'Укажите причину'))return;const f=t.state;t.state=to;dmHist(t,`${f} → ${to}: ${w}`);m.close();renderPage();toast(to==='Отключён'?'Шаблон отключён':'Шаблон включён',to==='Отключён'?'ban':'check')}}})})}
function dmCopy(t){let code=t.code+'-copy',i=2;while(dmTpl(code))code=t.code+'-copy'+i++;
  const n=Object.assign(structuredClone(t),{id:'dt'+Date.now().toString(36),code,name:t.name+' (копия)',state:'Черновик',src:'copy',run:t.run||t.code,checked:null,err:'',hist:[],_cb:S.me,_ca:nowStamp()});
  DM_TPL.push(n);dmHist(n,`Создан копированием шаблона «${t.name}»: Черновик`);renderPage();toast('Копия создана черновиком','copy');dmEdit(n)}

/* Окно шаблона (Админка): слева запрос и «Проверить», справа параметры, столбцы, таблицы базы и история (блок 2, пункты 2–7; блок 3, пункт 1).
   Готовый шаблон только смотрят и проверяют: изменить — копией. У опубликованного код и коды столбцов не меняются, столбцы можно только добавлять */
const DM_HINT=[['contractors','id, name, inn, form_code, regime_code, responsible_employee_id, service_status, start_date, kind'],['reports','contractor_id, report_type_code, period, due_date, pay_due, status, amount, paid, responsible_employee_id, superseded'],['report_types','code, name, short_name'],['money_operations','contractor_id, kind, amount, op_date, note, cancelled_at'],['fee_payments','contractor_id, amount, paid_on, deleted_at'],['fee_allocations','payment_id, month, amount'],['contractor_tariffs','contractor_id, amount, period, valid_from'],['contractor_service_periods','contractor_id, from_month, to_month'],['projects','contractor_id, name, starts_on, ends_on, plan, status'],['project_payments','project_id, amount, paid_on, deleted_at'],['one_off_services','contractor_id, name, service_date, amount, deleted_at'],['one_off_service_payments','service_id, amount, paid_on, deleted_at'],['indicators','name, unit, sort_order'],['indicator_values','contractor_id, indicator_id, month, value'],['tasks','title, contractor_id, executor_employee_id, due_date, status'],['employees','short_name, full_name, active']];
const DM_HINT_ADM=[['organizations','name, status, is_demo'],['sessions','user_id, org_id, created_at'],['platform_leads','created_at, firm, size, status'],['telegram_outbox','created_at, status'],['scheduler_runs','job, started_at, ok']];
const dmSqlPars=sql=>[...new Set([...String(sql).replace(/--[^\n]*/g,'').matchAll(/(?<![:\w]):([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]))];
const dmSqlCols=sql=>[...new Set([...String(sql).replace(/--[^\n]*/g,'').matchAll(/\bAS\s+([a-z_][a-z0-9_]*)\b(?!\s*\()/gi)].map(m=>m[1]))];
// Проверка текста в прототипе — по словам; в продукте — разборщиком SQL и отдельной ролью базы только для чтения (блок 8, пункты 2–3)
// Подсветка синтаксиса SQL в редакторе шаблона (Кутман 21.11.2026): ключевые слова, таблицы базы, параметры :имя, строки, числа и комментарии —
// своим цветом, слева номера строк. Поле ввода остаётся обычным textarea: его текст прозрачный, под ним — подсвеченная копия того же текста.
// Проверка, сохранение и защита запроса (dmSqlErr) не меняются
const DM_KW=new Set(('select from where and or not in is null as on join left right inner outer full cross group by order having limit offset distinct case when then else end '+
  'with recursive union all exists between like ilike asc desc nulls first last over partition filter cast true false interval lateral using any some array '+
  'sum count avg min max coalesce nullif greatest least extract date_trunc to_char round abs floor ceil now current_date row_number rank dense_rank lag lead string_agg array_agg '+
  'date numeric int integer bigint text boolean varchar timestamp').split(' '));
function dmHl(s){const tb=new Set([...DM_HINT,...DM_HINT_ADM].map(x=>String(x[0]).toLowerCase()));
  return String(s).replace(/(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*'?)|(::?[a-z_][a-z0-9_]*)|(\b\d+(?:\.\d+)?\b)|([a-z_][a-z0-9_]*)|([&<>"])/gi,(m,c,q,p,n,w,h)=>{
    if(c)return `<span class="sq-c">${esc(c)}</span>`;if(q)return `<span class="sq-s">${esc(q)}</span>`;if(p)return `<span class="${p[1]===':'?'sq-k':'sq-p'}">${esc(p)}</span>`;if(n)return `<span class="sq-n">${n}</span>`;
    if(w){const l=w.toLowerCase();return DM_KW.has(l)?`<span class="sq-k">${w}</span>`:tb.has(l)?`<span class="sq-t">${w}</span>`:w}return esc(h)})+'\n'}
const dmLn=s=>Array.from({length:String(s).split('\n').length},(_,i)=>i+1).join('\n');
// Подключение подсветки к полю: те же отступы и шрифт, что у поля; прокрутка — вместе
function dmHlBind(ta){const w=ta&&ta.closest('.dm-sqlb');if(!w)return;const pre=$('.dm-hl',w),g=$('.dm-sqlg',w),cs=getComputedStyle(ta);
  ['paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','fontFamily','fontSize','lineHeight','letterSpacing','tabSize'].forEach(k=>{pre.style[k]=cs[k]});
  g.style.paddingTop=cs.paddingTop;g.style.fontSize=cs.fontSize;g.style.lineHeight=cs.lineHeight;g.style.fontFamily=cs.fontFamily;
  const sync=()=>{pre.scrollTop=ta.scrollTop;pre.scrollLeft=ta.scrollLeft;g.firstChild.style.transform=`translateY(${-ta.scrollTop}px)`};
  const draw=()=>{pre.innerHTML=dmHl(ta.value);g.firstChild.textContent=dmLn(ta.value);sync()};
  ta.addEventListener('input',draw);ta.addEventListener('scroll',sync);if(window.ResizeObserver)new ResizeObserver(sync).observe(ta);draw()}
function dmSqlErr(sql){const s=String(sql).replace(/--[^\n]*/g,'').trim();if(!s)return 'Введите запрос';if(!/^(select|with)\b/i.test(s))return 'Запрос начинается с SELECT или WITH: разрешено только чтение';
  if(/;\s*\S/.test(s))return 'Разрешён один оператор: уберите всё после «;»';
  const bad=s.match(/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|vacuum|lock|set_config|pg_sleep|pg_read_file|pg_ls_dir|dblink|pg_catalog|information_schema)\b/i);
  return bad?`«${bad[1]}» нельзя: шаблон только читает таблицы организации`:''}
function dmEdit(t0){const sys=!!t0&&t0.src==='system',pub=!!t0&&t0.state!=='Черновик';
  const st=Object.assign({name:'',code:'',desc:'',kind:'org',mod:'reports',perm:'',access:'all',sql:'SELECT c.id AS contractor_id, c.name AS cp\nFROM contractors c\nORDER BY c.name',params:[],cols:[],run:null},t0?structuredClone(t0):{});
  st.perm=st.perm||'';st.okSql=t0&&t0.checked?st.sql:null;st.chk=null;st.org=ORG.id;if(!t0)st.cols=[{k:'contractor_id',label:'Контрагент (для области «Свои контрагенты»)',type:'cp',total:false},{k:'cp',label:'Контрагент',type:'text',total:false}];
  const dis=sys?'disabled':'';
  const rd=el=>{if(sys)return;const g=id=>{const x=$('#'+id,el);return x?x.value:null};['name:de-n','code:de-c','desc:de-d','kind:de-k','mod:de-m','perm:de-p','sql:de-s'].forEach(x=>{const[k,id]=x.split(':'),v=g(id);if(v!=null)st[k]=k==='sql'||k==='desc'?v:v.trim()});
    const a=g('de-a');if(a!=null)st.access=a==='all'?'all':$$('[data-dm-org]',el).filter(x=>x.checked).map(x=>x.dataset.dmOrg);
    st.params.forEach((x,i)=>{x.label=g('dpl-'+i)||x.label;x.type=g('dpt-'+i)||x.type;x.def=g('dpd-'+i)||null;const r=$('#dpr-'+i,el);if(r)x.req=r.checked});
    st.cols.forEach((x,i)=>{x.label=g('dcl-'+i)||x.label;x.type=g('dct-'+i)||x.type;const r=$('#dcs-'+i,el);if(r)x.total=r.checked})};
  const syncPars=()=>{const ks=dmSqlPars(st.sql);st.params=ks.map(k=>st.params.find(x=>x.k===k)||{k,label:k,type:/date/.test(k)?'date':/month/.test(k)?'month':/year/.test(k)?'year':'text',req:true,def:null})};
  const ok=()=>st.okSql!=null&&st.okSql===st.sql;
  openModal({size:'wide',form:!sys,render:m=>{const acc=st.access==='all'?'all':'sel',hint=st.kind==='adm'?[...DM_HINT_ADM,...DM_HINT]:DM_HINT,u=t0?dmUse(t0):null;
    const chk=st.chk?(st.chk.rows?`<div class="note ok">${ic('check')}<span>Запрос выполнен на «${esc(dmOrgN(st.chk.org))}»: строк ${st.chk.n}, ${st.chk.ms} мс${st.chk.n>100?'; ниже первые 100':''}.</span></div>${st.chk.n?`<div class="tbl-wrap dm-prev"><table class="mini"><thead><tr>${st.cols.filter(c=>c.type!=='cp').map(c=>`<th class="${c.type==='num'||c.type==='money'?'num':''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${st.chk.rows.map(r=>`<tr>${st.cols.filter(c=>c.type!=='cp').map(c=>{const v=r[c.k];return `<td class="${c.type==='num'||c.type==='money'?'num':''}">${esc(v==null?'':c.type==='money'?fmtM(v):c.type==='num'?dmNumTxt(v):c.type==='date'?fmtD(v):c.type==='datetime'?fmtDT(v):c.type==='month'?ymLabel(v):String(v))}</td>`}).join('')}</tr>`).join('')}</tbody></table></div>`:''}`
      :`<div class="note">${ic('info')}<span>Текст запроса прошёл проверку. Прототип не выполняет SQL: на тестовом стенде здесь будут первые 100 строк, время выполнения и число строк, а ошибка запроса — текстом базы. Столбцы прочитаны из «AS» запроса.</span></div>`):'';
    return {title:t0?esc(t0.name):'Новый шаблон',sub:t0?`${pill(t0.state,DMST)} <span class="mono">${esc(t0.code)}</span>${sys?' · готовый шаблон: изменить — копией':''}${u&&u.toks?` · действующих токенов: ${u.toks}`:''}`:'Черновик: организации увидят шаблон после проверки и публикации',
    body:`<div class="dm-ed"><div class="dm-ed-l"><div class="form">${fld('Название',inp('de-n',st.name,dis),{req:true,id:'de-n',hint:'Только на русском: так шаблон видят организации'})}${fld('Код для адреса',inp('de-c',st.code,`class="inp mono" ${dis} ${pub?'readonly':''}`),{req:true,id:'de-c',hint:pub?'У опубликованного шаблона код не меняется: на нём держатся подключения':'Латиницей через дефис, например reports-due: адрес /api/ext/v1/&lt;код&gt;'})}
        ${fld('Описание',`<textarea class="inp" id="de-d" style="min-height:56px" ${dis}>${esc(st.desc)}</textarea>`,{full:true,id:'de-d'})}
        ${fld('Вид',sel('de-k',[['org','Для организаций'],['adm','Для администратора']],st.kind,dis||(pub?'disabled':'')),{id:'de-k'})}
        ${st.kind==='org'?fld('Модуль',sel('de-m',Object.entries(DM_MODS),st.mod,dis),{id:'de-m',hint:'Шаблон виден, если есть просмотр модуля; «Свои контрагенты» — из его группы прав'})+fld('Ещё одно право',sel('de-p',[['','Не нужно'],['fee','Видеть плату за обслуживание']],st.perm,dis),{id:'de-p'})
          +fld('Доступ',sel('de-a',[['all','Все организации'],['sel','Выбранные организации']],acc,dis),{id:'de-a'})+(acc==='sel'?`<div class="fld full dm-orgs">${ORGS.map(o=>`<label class="check-row"><input type="checkbox" data-dm-org="${o.id}" ${Array.isArray(st.access)&&st.access.includes(o.id)?'checked':''} ${dis}><span>${esc(o.name)}</span></label>`).join('')}</div>`:''):''}</div>
      ${fld('Запрос',`<div class="dm-sqlb"><div class="dm-sqlg" aria-hidden="true"><div>${dmLn(st.sql)}</div></div><pre class="dm-hl mono" aria-hidden="true">${dmHl(st.sql)}</pre><textarea class="inp mono dm-sql" id="de-s" spellcheck="false" autocapitalize="off" autocomplete="off" ${dis}>${esc(st.sql)}</textarea></div>`,{req:true,full:true,id:'de-s',hint:'Один оператор SELECT. Условие «моя организация» писать не нужно: строки чужих организаций база не отдаёт. Деньги в базе — в тыйынах: столбец типа «Деньги» переводит их в сомы'})}
      <div class="row dm-chkbar">${fld('Проверить на организации',sel('de-o',ORGS.slice().sort((a,b)=>(b.id===ORG.id)-(a.id===ORG.id)).map(o=>[o.id,o.name+(o.id===ORG.id?' (демо)':'')]),st.org),{id:'de-o'})}<button type="button" class="btn" id="de-chk">${ic('play','sm')}Проверить</button></div><div id="de-res">${chk}</div></div>
      <div class="dm-ed-r"><div class="box"><h3>Параметры · ${st.params.length}</h3>${st.params.length?`<div class="tbl-wrap"><table class="mini dm-pt"><thead><tr><th>В запросе</th><th>Название</th><th>Тип</th><th>Обяз.</th><th>По умолчанию</th></tr></thead><tbody>${st.params.map((x,i)=>`<tr><td class="mono">:${esc(x.k)}</td><td>${inp('dpl-'+i,x.label,dis)}</td><td>${sel('dpt-'+i,Object.entries(DM_PT),x.type,dis)}</td><td><input type="checkbox" id="dpr-${i}" ${x.req?'checked':''} ${dis} aria-label="Обязательный"></td><td>${sel('dpd-'+i,[['','—'],...Object.entries(DM_DEF)],x.def||'',dis)}</td></tr>`).join('')}</tbody></table></div>`:'<span class="faint">В запросе нет параметров</span>'}<span class="hint">Берутся из запроса при «Проверить»: :month, :date_from. Значение уходит в базу как данные и в текст запроса не вклеивается.</span></div>
        <div class="box"><h3>Столбцы · ${st.cols.length}</h3><div class="tbl-wrap"><table class="mini dm-pt"><thead><tr><th>Код</th><th>Название</th><th>Тип</th><th>Итог</th></tr></thead><tbody>${st.cols.map((x,i)=>`<tr><td class="mono">${esc(x.k)}</td><td>${inp('dcl-'+i,x.label,dis)}</td><td>${sel('dct-'+i,Object.entries(DM_CT),x.type,dis)}</td><td><input type="checkbox" id="dcs-${i}" ${x.total?'checked':''} ${dis} aria-label="Итог по столбцу"></td></tr>`).join('')}</tbody></table></div><span class="hint">Столбцы читаются после «Проверить». Тип «Контрагент (для области)» — код контрагента: сотруднику с «Свои контрагенты» остаются строки его контрагентов; шаблон без такого столбца видят владелец и «Все контрагенты».${pub?' Код столбца после публикации не меняется, столбцы можно только добавлять.':''}</span></div>
        <details class="box dm-tables"><summary>Таблицы и поля базы</summary><ul class="dm-ul">${hint.map(([n,f])=>`<li><b class="mono">${n}</b> <span class="faint mono">${esc(f)}</span></li>`).join('')}</ul><button type="button" class="linkbtn" id="de-td">${ic('db','sm')}Все таблицы — «Техническая документация»</button></details>
        ${t0&&t0.hist&&t0.hist.length?`<div class="box"><h3>История · ${t0.hist.length}</h3><ul class="tl">${t0.hist.slice().reverse().slice(0,12).map(h=>`<li><span class="t">${fmtD(h.at.slice(0,10))}<br>${h.at.slice(11)}</span><span>${esc(h.what)}<br><span class="w">${esc(whoName(h.who))}</span></span></li>`).join('')}</ul></div>`:''}</div></div>`,
    foot:sys?`<button class="btn ghost" data-close>Закрыть</button><button class="btn" id="de-copy">${ic('copy','sm')}Копировать</button>`
      :`<button class="btn ghost" data-close>Отмена</button><button class="btn" id="de-save">${pub?'Сохранить':'Сохранить черновик'}</button>${t0&&t0.state==='Опубликован'?'':`<button class="btn cta" id="de-pub" ${ok()?'':'disabled title="Сначала нажмите «Проверить»"'}>${ic('check','sm')}Опубликовать</button>`}`,
    mount(el){const q=s=>$(s,el);
      ['#de-k','#de-a'].forEach(s=>{const x=q(s);if(x)x.onchange=()=>{rd(el);m.draw()}});
      const sq=q('#de-s');dmHlBind(sq);if(sq&&!sys){sq.oninput=()=>{st.sql=sq.value;const b=q('#de-pub');if(b)b.disabled=!ok()};sq.onchange=()=>{st.sql=sq.value}}
      q('#de-o').onchange=e=>st.org=e.target.value;q('#de-td').onclick=()=>{m.close(true);go('tdocs')};
      if(q('#de-copy'))q('#de-copy').onclick=()=>{m.close();dmCopy(t0)};
      q('#de-chk').onclick=()=>{rd(el);const e=dmSqlErr(st.sql);if(!setErr(el,'de-s',e))return;syncPars();
        const f=DM_RUN[st.run||st.code];let r=null;
        if(f){const tmp=Object.assign({},st,{state:'Опубликован'}),p={};st.params.forEach(x=>{p[x.k]=dmDef(x.def)});r=dmRun(tmp,p,st.kind==='adm'?null:st.org)}
        else{const ks=dmSqlCols(st.sql);if(!ks.length)return setErr(el,'de-s','Дайте столбцам имена через AS: по ним строятся столбцы вывода');
          st.cols=ks.map(k=>st.cols.find(c=>c.k===k)||{k,label:k,type:k==='contractor_id'?'cp':'text',total:false})}
        if(pub&&t0){const gone=t0.cols.filter(c=>!st.cols.some(x=>x.k===c.k));if(gone.length)return setErr(el,'de-s',`Столбец «${gone[0].label}» убрать нельзя: сломаются подключения. Нужен другой состав — «Копировать»`)}
        st.chk={org:st.kind==='adm'?'adm':st.org,rows:r?r.rows.slice(0,100):null,n:r?r.rows.length:0,ms:r?r.ms:0};st.okSql=st.sql;st.chkAt=nowStamp();m.draw()};
      const save=publish=>{rd(el);const code=st.code.trim();
        if(!setErr(el,'de-n',st.name?'':'Введите название')|!setErr(el,'de-c',!code?'Введите код':!/^[a-z0-9][a-z0-9-]{1,48}$/.test(code)?'Только латиница в нижнем регистре, цифры и дефис':DM_TPL.some(x=>x.code===code&&x!==t0)?'Такой код уже есть':''))return;
        if(st.kind==='org'&&Array.isArray(st.access)&&!st.access.length)return toast('Выберите организации или «Все организации»','alert',true);
        const sqlCh=!t0||t0.sql!==st.sql;if((publish||pub&&sqlCh)&&!ok()){setErr(el,'de-s','Сначала нажмите «Проверить»: публикуется только проверенный запрос');return}
        const done=()=>{const was=t0?t0.state:null,o=t0||{id:'dt'+Date.now().toString(36),src:'own',hist:[],_cb:S.me,_ca:nowStamp()};
          const ch=t0?[['name','название'],['desc','описание'],['sql','запрос'],['mod','модуль'],['perm','право'],['access','доступ'],['params','параметры'],['cols','столбцы']].filter(([k])=>JSON.stringify(t0[k]??'')!==JSON.stringify(st[k]??'')).map(x=>x[1]):[];
          Object.assign(o,{name:st.name,code,desc:st.desc,kind:st.kind,mod:st.kind==='org'?st.mod:null,perm:st.kind==='org'&&st.perm?st.perm:null,access:st.kind==='org'?st.access:'all',sql:st.sql,params:st.params,cols:st.cols,cpCol:(st.cols.find(c=>c.type==='cp')||{}).k||null,run:st.run||null});
          if(ok()&&st.chkAt)o.checked=st.chkAt;if(publish||was==='Сломан'&&ok())o.state='Опубликован';else if(!t0)o.state='Черновик';if(o.state==='Опубликован')o.err='';
          if(!t0){DM_TPL.push(o);dmHist(o,`Создан: ${o.state}`)}else{if(ch.length)dmHist(o,'Изменено: '+ch.join(', '));if(was!==o.state)dmHist(o,`${was} → ${o.state}`)}
          m.close();renderPage();toast(o.state==='Опубликован'&&was!=='Опубликован'?'Шаблон опубликован: организации из доступа его видят':'Шаблон сохранён',o.state==='Опубликован'?'check':'edit')};
        const u=t0&&t0.state==='Опубликован'?dmUse(t0):null;
        if(u&&u.toks)confirmDlg({title:'Сохранить изменения?',text:`У шаблона ${u.toks} ${plural(u.toks,'действующий токен','действующих токена','действующих токенов')} в ${u.tokOrgs} ${plural(u.tokOrgs,'организации','организациях','организациях')}: их программы сразу получат новый результат.`,ok:'Сохранить',run:done});else done()};
      if(q('#de-save'))q('#de-save').onclick=()=>save(false);if(q('#de-pub'))q('#de-pub').onclick=()=>save(true)}}}})}

/* API-токены (блок 5): токен показывается один раз, от него хранятся первые знаки; состояние ставит система, вручную — только «Отозвать» */
const dmTill=k=>k.till.length>10?k.till:k.till+' 23:59';
function dmWho(k){const id=k.by;if(k.org==='adm'||id==='admin')return whoName(id);if(k.org===ORG.id){const e=EM[id];return e?e.short+(e.active===false?' (уволен)':''):whoName(id)}
  const u=OTHER_USERS.find(x=>x.login===id);return u?(u.short||u.fio):id}
// Токен сам перестаёт работать: срок, шаблон отключён или сломан, организацию убрали из доступа, организация заблокирована или доступ закрыт по подписке, «Внешний доступ по API» выключен (блок 5, пункт 8)
function dmTokSt(k){if(k.revoked)return ['Отозван',`${fmtDT(k.revoked.at)}, ${dmWho({org:k.org,by:k.revoked.by})}`];if(dmTill(k)<nowStamp())return ['Истёк',''];
  const t=dmTpl(k.tpl),o=ORGS.find(x=>x.id===k.org);
  const why=!t||t.state==='Отключён'||t.state==='Черновик'?'Шаблон отключён':t.state==='Сломан'?'Шаблон временно не работает':k.org==='adm'?'':!dmAccess(t,k.org)?'Организацию убрали из доступа шаблона':o&&o.active===false?'Организация заблокирована':subClosed(k.org)?'Доступ закрыт по подписке':!dmApiOn(k.org)?'Внешний доступ по API выключен':'';
  return why?['Остановлен',why]:['Действует',k.next?'Перевыпущен: работает до '+fmtDT(k.till):'']}
const dmN30=k=>{const f=addDays(TODAY,-30);return DM_LOG.filter(x=>x.tok===k.id&&x.at.slice(0,10)>=f).length};
function renderDmTok(body){const adm=isAdmin();
  if(!adm&&dmDemo()){body.innerHTML=`<div class="state">${ic('key','lg')}<b>В демо-версии токены не выпускаются</b><span>Демо-организация открыта всем. В своей организации владелец включает «Внешний доступ по API», и токены выпускают здесь.</span></div>`;return}
  const off=!adm&&!ORG.apiOn,own=me()&&me().role==='owner';
  body.innerHTML=`${off?`<div class="note red">${ic('lock')}<span>Внешний доступ по API выключен. Включить его может владелец в «Моя организация». Пока он выключен, выпуск токенов недоступен, а выпущенные токены не отвечают.</span>${own?`<button type="button" class="btn sm" id="dm-on">Открыть настройки</button>`:''}</div>`:''}<div class="note">${ic('info')}<span>Токен — ключ, по которому внешняя программа (Excel, Power BI, 1С) получает результат одного шаблона, только для чтения. Срок — до 180 дней, токен показывается один раз при создании${adm?'. Здесь ваши токены к шаблонам администратора и токены всех организаций: токен организации можно только отозвать, например при утечке':`; действующих — не больше ${DM_TOK_MAX}`}.</span></div><div id="dm-kg"></div>`;
  const on=$('#dm-on',body);if(on)on.onclick=()=>go('org','settings');
  grid($('#dm-kg',body),{id:adm?'dm-tok-adm':'dm-tok',audit:false,sort:{key:'at',dir:-1},noun:['токен','токена','токенов'],
    empty:{icon:'key',title:'Токенов пока нет',text:adm?'Выпустите токен к шаблону администратора кнопкой «+ Токен».':'Токен выпускают кнопкой «+ Токен» или «Выпустить токен» в каталоге шаблонов.'},
    cols:[{key:'name',label:'Название',type:'text',w:210,val:k=>k.name,html:k=>`<span class="strong">${esc(k.name)}</span><div class="faint mono">bk_${esc(k.pre)}…</div>`},
      {key:'st',label:'Состояние',type:'enum',w:170,val:k=>dmTokSt(k)[0],html:k=>{const[s,w]=dmTokSt(k);return pill(s,DM_TST)+(w?`<div class="faint" style="font-size:12px;white-space:normal">${esc(w)}</div>`:'')}},
      adm&&{key:'org',label:'Организация',type:'enum',w:200,val:k=>dmOrgN(k.org)},
      {key:'tpl',label:'Шаблон',type:'enum',w:220,val:k=>(dmTpl(k.tpl)||{name:k.tpl}).name},
      {key:'by',label:'Кто создал',type:'enum',w:160,val:k=>dmWho(k)},
      {key:'at',label:'Создан',type:'datetime',w:140,val:k=>k.at},
      {key:'till',label:'Действует до',type:'datetime',w:140,val:k=>k.till},
      {key:'last',label:'Последний запрос',type:'text',w:190,val:k=>k.last?k.last.at:'',html:k=>k.last?`<span class="tnum">${fmtDT(k.last.at)}</span><div class="faint mono">${esc(k.last.ip)}</div>`:'<span class="faint">—</span>'},
      {key:'n30',label:'Запросов за 30 дней',type:'int',w:110,num:true,val:dmN30}].filter(Boolean),
    rows:()=>adm?DM_TOK:DM_TOK.filter(k=>k.org===ORG.id),open:k=>dmTokDlg(k),
    actions:k=>{const s=dmTokSt(k)[0],live=s!=='Отозван'&&s!=='Истёк',mine=adm?k.org==='adm':true;
      return [{label:'Открыть',icon:'eye',run:()=>dmTokDlg(k)},mine&&live&&!k.next&&{label:'Перевыпустить',icon:'refresh',run:()=>dmReissue(k)},live&&{label:'Отозвать',icon:'ban',run:()=>dmRevoke(k)}].filter(Boolean)}})}
function dmNewDlg(code){const adm=isAdmin();
  if(!adm){if(dmDemo())return toast('В демо-версии токены не выпускаются: демо-организация открыта всем','lock',true);if(!can('dmTokens'))return toast('Нужно право «Управлять API-токенами»','lock',true);
    if(!ORG.apiOn)return toast('Внешний доступ по API выключен. Включить его может владелец в «Моя организация»','lock',true);if(subClosed(ORG.id))return toast('Доступ закрыт по подписке: токены не выпускаются до оплаты','lock',true)}
  const mine=k=>k.org===(adm?'adm':ORG.id);if(DM_TOK.filter(k=>mine(k)&&dmLive(k)).length>=DM_TOK_MAX)return toast(`Действующих токенов уже ${DM_TOK_MAX}: отзовите ненужный`,'alert',true);
  const L=DM_TPL.filter(t=>t.state==='Опубликован'&&(adm?t.kind==='adm':dmSee(t)));if(!L.length)return toast('Нет опубликованных шаблонов для токена','alert',true);
  const st={tpl:(L.find(t=>t.code===code)||L[0]).code,term:30};
  openModal({form:true,render:()=>({title:'Новый API-токен',sub:adm?'Токен администратора платформы к шаблону «Для администратора»':'Токен организации: работает и после увольнения сотрудника, который его создал',
    body:`<div class="form">${fld('Шаблон',`<select class="inp" id="dk-t">${dmOptHtml(L,st.tpl)}</select>`,{req:true,full:true,id:'dk-t',hint:'Один токен открывает один шаблон; к шаблону можно выпустить несколько токенов — по одному на подключение'})}${fld('Название',inp('dk-n','','placeholder="Например: Power BI директора"'),{req:true,full:true,id:'dk-n',hint:'Чтобы потом понять, какую программу отключит «Отозвать»'})}${fld('Срок',`<div class="seg" role="group" aria-label="Срок токена">${DM_TERMS.map(d=>`<button type="button" data-term="${d}" class="${d===st.term?'on':''}">${d} ${plural(d,'день','дня','дней')}</button>`).join('')}</div>`,{full:true,hint:'Не больше 180 дней. Продления нет: срок истёк — выпустите новый'})}</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="dk-ok">Создать</button>',
    mount(el,m){$('#dk-t',el).onchange=e=>st.tpl=e.target.value;$$('[data-term]',el).forEach(b=>b.onclick=()=>{st.term=+b.dataset.term;$$('[data-term]',el).forEach(x=>x.classList.toggle('on',x===b))});
      $('#dk-ok',el).onclick=()=>{const n=val(el,'dk-n');if(!setErr(el,'dk-n',!n?'Введите название':DM_TOK.some(k=>mine(k)&&dmLive(k)&&k.name===n)?'Токен с таким названием уже действует':''))return;m.close();dmIssue({tpl:st.tpl,name:n,term:st.term})}}})})}
// Случайные знаки без смещения: байты от 248 (4×62) отбрасываются, иначе первые знаки алфавита выпадали бы чаще
function dmRand(A,n){let s='';while(s.length<n)for(const v of crypto.getRandomValues(new Uint8Array(n)))if(v<248&&s.length<n)s+=A[v%62];return s}
// Выпуск: 32 случайных байта с приставкой bk_ (в прототипе — 43 знака); в базе продукта — только хеш SHA-256, здесь — первые знаки
function dmIssue(x,prev){const adm=isAdmin(),A='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',tok='bk_'+dmRand(A,43);
  const k={id:'tk'+Date.now().toString(36),org:adm?'adm':ORG.id,tpl:x.tpl,name:x.name,by:S.me,at:nowStamp(),till:addDays(TODAY,x.term),term:x.term,pre:tok.slice(3,9),revoked:null,prev:prev?prev.id:null,next:null,last:null};
  DM_TOK.push(k);if(prev)prev.next=k.id;const t=dmTpl(x.tpl),what=`${prev?'Перевыпущен':'Выпущен'} API-токен «${k.name}» к шаблону «${t?t.name:x.tpl}» на ${x.term} ${plural(x.term,'день','дня','дней')}`;
  if(adm)pdLog('Витрина данных: '+what,'dm');else{log('org','api',what);dmTell(k,'tgDmTokNew','API-токен создан',{кто:dmWho(k)},'dmTokNew:'+k.id)}renderPage();dmShowTok(k,tok)}
// Владельцам организации токена — Telegram и колокольчик (блок 5, пункт 10): создан (и перевыпущен), отозван, до конца срока 7 дней;
// строка колокольчика открывает окно токена. Токен Админки — без сообщений: владельцев у него нет
function dmTell(k,tplKey,kind,vars,key){if(k.org==='adm'||typeof subOwners!=='function')return '';const t=dmTpl(k.tpl),org=dmOrgN(k.org);
  const txt=subTpl(tplKey,Object.assign({организация:org,название:k.name,шаблон:t?t.name:k.tpl,дата:fmtD(k.till.slice(0,10))},vars));
  subOwners(k.org).forEach(u=>{if(typeof tgSvc==='function')tgSvc(tgOf(u),kind,{org});if(typeof bellPut==='function'&&EMP.includes(u))bellPut(u.id,{kind:'other',ev:'dm_token',open:{k:'dm_token',id:k.id},text:txt,key})});return txt}
// Задача «Витрина: срок API-токенов» — каждый день в 09:00; в макете — при чтении колокольчика, как subDaily. За 7 дней до конца
// срока — владельцам один раз; токен на 7 дней (срок есть в «создан»), перевыпущенный, отозванный и истёкший — без напоминания
function dmDaily(){let n=0;DM_TOK.forEach(k=>{if(k.org==='adm'||k.soon||k.next)return;const term=k.term||diffDays(k.till.slice(0,10),k.at.slice(0,10));if(term<=7)return;
  const[s]=dmTokSt(k);if(s==='Отозван'||s==='Истёк')return;const d=diffDays(k.till.slice(0,10),TODAY);if(d<1||d>7)return;
  k.soon=TODAY;n++;dmTell(k,'tgDmTokSoon','API-токен истекает',{дней:d},'dmTokSoon:'+k.id)});if(n)dbSoon()}
// Строка колокольчика «API-токен …»: вкладка «API Токены» и окно токена
function dmBellGo(o){const k=DM_TOK.find(x=>x.id===o.id);if(!k)return toast('Запись удалена или больше вам не доступна','alert');go('dm','tok');dmTokDlg(k)}
function dmShowTok(k,tok){const t=dmTpl(k.tpl);openModal({sticky:true,noMax:true,size:'wide',render:()=>({title:'Скопируйте токен. Больше он не покажется',sub:`${esc(k.name)} · ${esc(t?t.name:k.tpl)} · действует до ${fmtD(k.till.slice(0,10))}`,
  body:`<div class="dm-tok"><code class="mono" id="dt-v">${esc(tok)}</code><button type="button" class="btn cta" id="dt-copy">${ic('copy','sm')}Скопировать</button></div><span class="hint">В системе остаются только первые знаки: bk_${esc(k.pre)}… Потеряли токен — перевыпустите его.</span>${dmHow(t,tok)}`,
  foot:'<button class="btn cta" data-close>Готово, токен сохранён</button>',mount(el){$('#dt-copy',el).onclick=()=>copyText(tok,'Токен скопирован')}})})}
// «Как подключить» (Кутман 21.11.2026): общее — ссылка CSV, адрес, заголовок и параметры по отдельности; ниже мини-блок на каждую программу
// (Excel Power Query, Excel VBA, Google Таблицы, Power BI, 1С, другие сервисы) с шагами и тем, что куда вставить. Любой адрес, параметр,
// заголовок и код копируется нажатием (data-dmcp). В окне уже выпущенного токена он показан не целиком — в коде вместо него «bk_ВАШ_ТОКЕН»
const DM_HOST='https://buhuchet.kg';
const dmCp=(v,t)=>`<button type="button" class="dm-c mono" data-dmcp="${esc(v)}" title="Нажмите, чтобы скопировать">${esc(t??v)}${ic('copy','sm')}</button>`;
const dmCode=code=>`<div class="dm-code"><pre class="mono dm-pre" data-dmcp="${esc(code)}" title="Нажмите, чтобы скопировать код">${esc(code)}</pre><button type="button" class="btn sm dm-code-b" data-dmcp="${esc(code)}">${ic('copy','sm')}Скопировать код</button></div>`;
const dmFmt=x=>x.type==='date'?'ГГГГ-ММ-ДД':x.type==='month'?'ГГГГ-ММ':x.type==='year'?'ГГГГ':'';
document.addEventListener('click',e=>{const x=e.target.closest('[data-dmcp]');if(!x)return;if(x.tagName==='PRE'&&String(getSelection()||''))return;copyText(x.dataset.dmcp,x.tagName==='PRE'||x.classList.contains('dm-code-b')?'Код скопирован':'Скопировано')});
function dmHow(t,tok){if(!t)return '';const full=!/…$/.test(tok),T=full?tok:'bk_ВАШ_ТОКЕН',B='Bearer '+T,p={};t.params.forEach(x=>{p[x.k]=dmDef(x.def)});
  // Подпись параметра в коде — одной строкой, значения — в кавычках своего языка, в адресе — закодированы (как в продукте, О-100, 21.11.2026)
  const ln=s=>String(s??'').replace(/[\r\n\u2028\u2029]+/g,' ').trim(),dq=s=>'"'+String(s).replace(/"/g,'""')+'"',E=encodeURIComponent;
  const ps=t.params.filter(x=>p[x.k]),qs=ps.map(x=>`${x.k}=${E(p[x.k])}`).join('&'),base=`${DM_HOST}/api/ext/v1/${t.code}`,url=base+(qs?'?'+qs:''),csv=`${base}?format=csv${qs?'&'+qs:''}`;
  const r=dmRun(t,p,t.kind==='adm'?null:ORG.id),cs=t.cols.filter(c=>c.type!=='cp');
  const ex=r?r.rows.slice(0,2).map(x=>Object.fromEntries(cs.map(c=>[c.k,c.type==='money'?Math.round((x[c.k]||0)*100)/100:x[c.k]??null]))):[];
  const js=JSON.stringify({columns:cs.map(c=>({key:c.k,title:c.label,type:c.type})),rows:ex,total:r?r.rows.length:0,next:r&&r.rows.length>1000?url+(qs?'&':'?')+'page=2':null},null,2);
  const mq=s=>`"${String(s).replace(/"/g,'""')}"`;
  // Power Query (Excel и Power BI): параметры — отдельными строками в начале, адрес без параметров, заголовок отдельно
  const pq=`let
    // 1. Токен (полностью, вместе с bk_)
    Token = ${mq(T)},
${ps.length?`    // 2. Параметры: меняйте значения здесь, затем «Обновить»
${ps.map(x=>`    #${mq(ln(x.label))} = ${mq(p[x.k])},   // ${x.k}, ${dmFmt(x)}`).join('\n')}
`:''}    // 3. Запрос — менять не нужно
    Source = Web.Contents(${mq(base)}, [
        Query = [format = "csv"${ps.map(x=>`, ${x.k} = #${mq(ln(x.label))}`).join('')}],
        Headers = [Authorization = "Bearer " & Token]
    ]),
    Csv = Csv.Document(Source, [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Result = Table.PromoteHeaders(Csv, [PromoteAllScalars = true])
in
    Result`;
  const cell=x=>x.type==='date'?`Date.ToText(Date.From(Excel.CurrentWorkbook(){[Name="${x.k}"]}[Content]{0}[Column1]), "yyyy-MM-dd")`:x.type==='month'?`Date.ToText(Date.From(Excel.CurrentWorkbook(){[Name="${x.k}"]}[Content]{0}[Column1]), "yyyy-MM")`:`Text.From(Excel.CurrentWorkbook(){[Name="${x.k}"]}[Content]{0}[Column1])`;
  const vb=`Sub LoadBuhuchet()
    ' 1. Токен (полностью, вместе с bk_)
    Const TOKEN As String = "${T}"
${ps.length?`    ' 2. Параметры: впишите значения или берите из ячеек, например Range("B1").Text
${ps.map((x,i)=>`    Dim p${i + 1} As String: p${i + 1} = ${dq(p[x.k])}   ' ${ln(x.label)}, ${x.k}, ${dmFmt(x)}`).join('\n')}
`:''}    ' 3. Запрос — менять не нужно
    Dim url As String
    url = "${base}?format=csv"${ps.map((x,i)=>` & "&${x.k}=" & WorksheetFunction.EncodeURL(p${i + 1})`).join('')}
    Dim http As Object: Set http = CreateObject("MSXML2.XMLHTTP.6.0")
    http.Open "GET", url, False
    http.setRequestHeader "Authorization", "Bearer " & TOKEN
    http.send
    If http.Status <> 200 Then MsgBox "Ошибка " & http.Status & ": " & http.responseText: Exit Sub
    Dim txt As String
    With CreateObject("ADODB.Stream")
        .Type = 1: .Open: .Write http.responseBody
        .Position = 0: .Type = 2: .Charset = "utf-8": txt = .ReadText
    End With
    ' 4. Разбор CSV по кавычкам, по одной ячейке; текст, похожий на формулу, — с апострофом
    Dim ws As Worksheet: Set ws = ActiveSheet
    ws.Cells.Clear
    Dim r As Long, c As Long, i As Long, q As Boolean, ch As String, v As String
    r = 1: c = 1
    If Right$(txt, 1) <> vbLf Then txt = txt & vbLf
    For i = 1 To Len(txt)
        ch = Mid$(txt, i, 1)
        If q Then
            If ch <> """" Then
                v = v & ch
            ElseIf Mid$(txt, i + 1, 1) = """" Then
                v = v & ch: i = i + 1
            Else
                q = False
            End If
        ElseIf ch = """" Then
            q = True
        ElseIf ch = "," Or ch = vbLf Then
            If v Like "[=+@-]*" And Not IsNumeric(v) Then v = "'" & v
            If Len(v) > 0 Then ws.Cells(r, c).Value = v
            v = ""
            If ch = "," Then
                c = c + 1
            Else
                r = r + 1: c = 1
            End If
        ElseIf ch <> vbCr Then
            v = v & ch
        End If
    Next
End Sub`;
  const gs=`// 1. Токен (полностью, вместе с bk_). Его видят все редакторы таблицы
const TOKEN = '${T}';
${ps.length?`// 2. Параметры: меняйте значения здесь
const PARAMS = {
${ps.map(x=>`  ${x.k}: ${JSON.stringify(p[x.k])},   // ${ln(x.label)}, ${dmFmt(x)}`).join('\n')}
};
`:'const PARAMS = {};\n'}// 3. Загрузка — менять не нужно
function load() {
  const q = Object.keys(PARAMS).map(k => k + '=' + encodeURIComponent(PARAMS[k])).join('&');
  const r = UrlFetchApp.fetch('${base}?format=csv' + (q ? '&' + q : ''), {
    headers: { Authorization: 'Bearer ' + TOKEN }
  });
  const rows = Utilities.parseCsv(r.getContentText('UTF-8'));
  // текст, похожий на формулу, — с апострофом
  const cells = rows.map(row => row.map(v => /^[=+@-]/.test(v) && isNaN(v) ? "'" + v : v));
  const sh = SpreadsheetApp.getActiveSheet();
  sh.clearContents();
  if (cells.length) sh.getRange(1, 1, cells.length, cells[0].length).setValues(cells);
}`;
  const c1=`// 1. Токен (полностью, вместе с bk_)
Токен = "${T}";
${ps.length?`// 2. Параметры: меняйте значения здесь
${ps.map(x=>`Параметры_${x.k} = ${dq(p[x.k])}; // ${ln(x.label)}, ${dmFmt(x)}`).join('\n')}
`:''}// 3. Запрос — менять не нужно
Адрес = "/api/ext/v1/${t.code}"${ps.length?` + "?${ps.map((x,i)=>`${i?'&':''}${x.k}=" + КодироватьСтроку(Параметры_${x.k}, СпособКодированияСтроки.КодировкаURL)`).join(' + "')}`:''};
Соединение = Новый HTTPСоединение("buhuchet.kg", 443, , , , 60, Новый ЗащищенноеСоединениеOpenSSL);
Заголовки = Новый Соответствие;
Заголовки.Вставить("Authorization", "Bearer " + Токен);
Ответ = Соединение.Получить(Новый HTTPЗапрос(Адрес, Заголовки));
Если Ответ.КодСостояния <> 200 Тогда
    ВызватьИсключение "Ошибка " + Ответ.КодСостояния + ": " + Ответ.ПолучитьТелоКакСтроку("UTF-8");
КонецЕсли;
Чтение = Новый ЧтениеJSON;
Чтение.УстановитьСтроку(Ответ.ПолучитьТелоКакСтроку("UTF-8"));
Данные = ПрочитатьJSON(Чтение);
// Данные.columns — столбцы, Данные.rows — строки, Данные.next — адрес следующей страницы (Неопределено, если её нет)
Для Каждого Строка Из Данные.rows Цикл
    // Строка.<код столбца>, например Строка.${(cs[0]||{k:'name'}).k}
КонецЦикла;`;
  const curl=`curl -H "Authorization: ${B}" \\\n  "${csv}"`;
  const py=`import requests

TOKEN = "${T}"
PARAMS = {${ps.map(x=>`"${x.k}": ${JSON.stringify(p[x.k])}`).join(', ')}}

r = requests.get("${base}", params=PARAMS,
                 headers={"Authorization": "Bearer " + TOKEN}, timeout=60)
r.raise_for_status()
data = r.json()   # columns, rows, total, next
print(len(data["rows"]), "строк")`;
  const parts=[`${base}?format=csv`,...ps.map(x=>`&${x.k}=${E(p[x.k])}`)];
  const hdr=`<li>«Параметры заголовка HTTP-запроса»: слева ${dmCp('Authorization')}, справа ${dmCp(B)}</li>`;
  const urlParts=`<li>В «Части URL-адреса» вставьте по одной строке, для каждой следующей — «Добавить часть»:<div class="dm-cps">${parts.map(v=>dmCp(v)).join('')}</div></li>`;
  // Токен в коде — открытым текстом: предупреждение у Excel, Power BI и 1С (ТЗ, доработки 21.11.2026, п. 9; у Google Таблиц — в самом скрипте)
  const tkw=`<p class="hint dm-tkw">${ic('lock','sm')}Токен хранится в файле открытым текстом: его видит каждый, у кого есть файл</p>`;
  const app=(k,icon,title,sub,body,open)=>`<details class="dm-app" data-dm-app="${k}"${open?' open':''}><summary><span class="dm-app-i">${ic(icon)}</span><span class="dm-app-t"><b>${title}</b><span class="hint">${sub}</span></span><span class="dm-app-ch">${ic('right','sm')}</span></summary><div class="dm-app-b">${body}</div></details>`;
  const apps=[
    app('pq','table','Excel · Power Query','Таблица обновляется кнопкой «Обновить всё»',`
      ${tkw}      <h4>Способ 1. «Из Интернета» — быстро</h4><ol class="dm-steps"><li>Excel: «Данные» → «Из Интернета» → «Дополнительно».</li>${urlParts}${hdr}
        <li>«ОК». Если Excel спросит, как входить, — «Анонимно» → «Подключение». В окне просмотра — «Загрузить».</li>
        <li>Поменять даты: «Данные» → «Запросы и подключения» → запрос → «Изменить» → шестерёнка у шага «Источник»: части адреса стоят отдельно.</li></ol>
      <h4>Способ 2. Параметры отдельно — удобно менять</h4><ol class="dm-steps"><li>«Данные» → «Получить данные» → «Из других источников» → «Пустой запрос».</li>
        <li>«Главная» → «Расширенный редактор»: замените весь текст кодом ниже → «Готово» → «Закрыть и загрузить».</li>${ps.length?`
        <li>Параметры — отдельными строками в начале кода: поменяйте значение и нажмите «Обновить всё».</li>
        <li>Брать значение из ячейки: дайте ячейке имя (поле слева от строки формул), например ${dmCp(ps[0].k)}, и вместо значения в кавычках вставьте:<div class="dm-cps">${dmCp(cell(ps[0]))}</div>Если Excel спросит об уровнях конфиденциальности — «Организационный» для обоих источников.</li>`:''}</ol>${dmCode(pq)}`,true),
    app('vba','list','Excel · VBA','Макрос загружает таблицу на текущий лист',`
      ${tkw}      <ol class="dm-steps"><li>Alt+F11 → «Insert» → «Module», вставьте код.</li>${ps.length?`<li>Параметры — в начале кода; значение можно брать из ячейки: ${dmCp('Range("B1").Text')}</li>`:''}
        <li>Alt+F8 → ${dmCp('LoadBuhuchet')} → «Выполнить». Сохраните книгу как «Книга Excel с поддержкой макросов» (.xlsm).</li></ol>${dmCode(vb)}`),
    app('gs','board','Google Таблицы','Через Apps Script: по адресу с заголовком Таблицы не загружают',`
      <ol class="dm-steps"><li>Таблица: «Расширения» → «Apps Script». Замените текст кодом ниже, сохраните.</li><li>Выберите функцию ${dmCp('load')} → «Выполнить», разрешите доступ.</li>
        <li>Обновлять само: «Триггеры» (будильник слева) → «Добавить триггер» → функция load → «По времени».</li>${ps.length?'<li>Параметры — в начале кода, в PARAMS.</li>':''}</ol>${dmCode(gs)}`),
    app('pbi','chart','Power BI','Отчёт обновляется по расписанию в службе Power BI',`
      ${tkw}      <ol class="dm-steps"><li>«Получить данные» → «Интернет» → «Дополнительно».</li>${urlParts}${hdr}<li>«ОК» → «Анонимно» → «Подключение» → «Загрузить».</li></ol>
      <h4>Параметры отдельно</h4><ol class="dm-steps"><li>«Получить данные» → «Пустой запрос» → «Расширенный редактор»: вставьте код ниже. Так работает и обновление по расписанию.</li>${ps.length?`<li>Менять без кода: «Преобразовать данные» → «Управление параметрами» → «Создать параметр» с тем же именем, например ${dmCp(ps[0].label)}, и уберите его строку из кода.</li>`:''}</ol>${dmCode(pq)}`),
    app('1c','building','1С','HTTPСоединение, ответ в JSON',`
      ${tkw}      <ol class="dm-steps"><li>В обработке или общем модуле (на сервере) вставьте код.</li>${ps.length?'<li>Параметры — в начале кода.</li>':''}<li>Строки — в Данные.rows; если Данные.next заполнен, запросите следующую страницу с ${dmCp('page=2')}.</li></ol>${dmCode(c1)}`),
    app('oth','link','Другие сервисы','Любая программа, которая умеет GET-запрос с заголовком',`
      <ol class="dm-steps"><li>Адрес: ${dmCp(base)}, параметры — после «?»${ps.length?`: ${ps.map(x=>dmCp(`${x.k}=${E(p[x.k])}`)).join(' ')}`:''}.</li><li>Заголовок: ${dmCp('Authorization')} со значением ${dmCp(B)}. В адресе токен не принимается.</li>
        <li>Таблица CSV — с ${dmCp('format=csv')}, без него — JSON. Страница — 1 000 строк, больше — ${dmCp('limit=5000')}, следующая — ${dmCp('page=2')}.</li></ol>${dmCode(curl)}${dmCode(py)}`)].join('');
  return `<div class="box dm-how"><h3>Как подключить</h3><span class="hint">Нажмите на адрес, параметр или код — он скопируется.</span>
    ${full?'':`<div class="note warn">${ic('alert')}<span>Здесь токен показан не целиком. Вместо ${dmCp('bk_ВАШ_ТОКЕН')} вставьте полный токен, сохранённый при выпуске; потеряли — перевыпустите.</span></div>`}
    <div class="dm-kv"><span class="hint">Ссылка CSV</span><span>${dmCp(csv)}</span><span class="hint">Адрес</span><span>${dmCp(base)}</span><span class="hint">Заголовок</span><span class="dm-cps">${dmCp('Authorization')}${dmCp(B)}</span></div>
    ${t.params.length?`<div class="tbl-wrap"><table class="mini dm-pt"><thead><tr><th>Параметр</th><th>Значение</th><th>Что это</th></tr></thead><tbody>${t.params.map(x=>`<tr><td>${dmCp(x.k)}</td><td>${p[x.k]?dmCp(p[x.k]):'<span class="faint">—</span>'}</td><td>${esc(x.label)}${dmFmt(x)?`, <span class="mono">${dmFmt(x)}</span>`:''}${x.req?'':' · <span class="faint">необязательный</span>'}</td></tr>`).join('')}</tbody></table></div>`:''}
    <div class="dm-apps">${apps}</div>
    <details><summary>Пример ответа JSON</summary><pre class="mono dm-pre">${esc(js)}</pre></details>
    <ul class="dm-ul"><li>Деньги — числом в сомах. Пределы на токен: 1 запрос одновременно, 30 в минуту, 5 000 в сутки; сверх них — ответ 429, повторите через время из Retry-After.</li></ul>
    <span class="hint">Данные уходят за пределы системы: за то, куда они попадут дальше, отвечает организация, выпустившая токен.</span></div>`}
function dmTokDlg(k){const t=dmTpl(k.tpl),adm=isAdmin(),mine=adm?k.org==='adm':k.org===ORG.id;
  openModal({size:'wide',render:m=>{const[s,w]=dmTokSt(k),live=s!=='Отозван'&&s!=='Истёк',L=DM_LOG.filter(x=>x.tok===k.id).sort((a,b)=>a.at<b.at?1:-1);
    const info=[['Состояние',pill(s,DM_TST)+(w?` <span class="faint">${esc(w)}</span>`:'')],['Токен',`<span class="mono">bk_${esc(k.pre)}…</span>`],['Шаблон',esc(t?t.name:k.tpl)],adm&&['Организация',esc(dmOrgN(k.org))],['Кто создал',esc(dmWho(k))],['Создан',fmtDT(k.at)],['Действует до',fmtDT(k.till)],
      ['Последний запрос',k.last?`${fmtDT(k.last.at)} · <span class="mono">${esc(k.last.ip)}</span>`:'—'],['Запросов за 30 дней',String(dmN30(k))],k.prev&&['Заменил токен',`<span class="mono">bk_${esc((DM_TOK.find(x=>x.id===k.prev)||{}).pre||'')}…</span>`]].filter(Boolean);
    return {title:esc(k.name),sub:`${esc(t?t.name:k.tpl)}${adm?' · '+esc(dmOrgN(k.org)):''}`,
    body:`<div class="dm-info">${info.map(([a,b])=>`<span class="hint">${a}</span><span>${b}</span>`).join('')}</div>${mine&&live?dmHow(t,`bk_${k.pre}…`):''}
      <div class="box"><h3>Журнал запросов · ${L.length}</h3>${L.length?`<div class="tbl-wrap"><table class="mini"><thead><tr><th>Когда</th><th>Параметры</th><th class="num">Строк</th><th class="num">Время, мс</th><th>Итог</th><th>Адрес</th></tr></thead><tbody>${L.slice(0,50).map(x=>`<tr><td class="tnum">${fmtDT(x.at)}</td><td class="mono">${esc(x.params||'—')}</td><td class="num">${x.rows}</td><td class="num">${x.ms}</td><td>${pill(x.res,DM_RES)}${x.err?`<div class="faint">${esc(x.err)}</div>`:''}</td><td class="mono">${esc(x.ip)}</td></tr>`).join('')}</tbody></table></div>`:'<span class="faint">Запросов по этому токену ещё не было</span>'}<span class="hint">Журнал хранится 90 дней.</span></div>`,
    foot:`<button class="btn ghost" data-close>Закрыть</button>${mine&&live&&!k.next?`<button class="btn" id="dt-re">${ic('refresh','sm')}Перевыпустить</button>`:''}${live?`<button class="btn danger" id="dt-rv">${ic('ban','sm')}Отозвать</button>`:''}`,
    mount(el){const a=$('#dt-re',el),b=$('#dt-rv',el);if(a)a.onclick=()=>{m.close();dmReissue(k)};if(b)b.onclick=()=>{m.close();dmRevoke(k)}}}}})}
function dmRevoke(k){const oth=isAdmin()&&k.org!=='adm';confirmDlg({title:'Отозвать токен?',text:`Токен «${esc(k.name)}» перестанет работать сразу${oth?`; организация «${esc(dmOrgN(k.org))}» увидит, что его отозвал администратор платформы`:''}. Вернуть его нельзя: понадобится — выпустите новый.`,ok:'Отозвать',danger:true,
  run:()=>{k.revoked={at:nowStamp(),by:S.me};const what=`Отозван API-токен «${k.name}»`;if(isAdmin())pdLog(`Витрина данных: ${what}${oth?` организации «${dmOrgN(k.org)}»`:''}`,'dm');else log('org','api',what);
    dmTell(k,'tgDmTokRevoked','API-токен отозван',{кто:isAdmin()?'Администратор платформы':dmWho({org:k.org,by:S.me})},'dmTokRev:'+k.id);renderPage();toast('Токен отозван','ban')}})}
// «Перевыпустить»: новый токен с теми же настройками, старый работает ещё 24 часа (блок 5, пункт 6)
function dmReissue(k){confirmDlg({title:'Перевыпустить токен?',text:`Новый токен — с тем же шаблоном, названием и сроком. Старый bk_${esc(k.pre)}… проработает ещё 24 часа, чтобы вы успели заменить его в программе.`,ok:'Перевыпустить',
  run:()=>{const term=k.term||Math.min(180,Math.max(7,diffDays(k.till.slice(0,10),k.at.slice(0,10))));const d=new Date(Date.parse(nowStamp().replace(' ','T')+':00Z')+864e5).toISOString();k.till=d.slice(0,10)+' '+d.slice(11,16);dmIssue({tpl:k.tpl,name:k.name,term},k)}})}

/* Админка → «Журнал запросов» (блок 6, пункт 7): все запросы по токенам, хранится 90 дней */
function renderDmLog(body){const d1=DM_LOG.filter(x=>x.at.slice(0,10)===TODAY),e1=d1.filter(x=>x.res==='Ошибка');
  body.innerHTML=`<div class="plates">${plate({id:'all',icon:'history',color:'blue',label:'Запросов сегодня',value:d1.length})}${plate({id:'err',icon:'alert',color:e1.length?'red':'green',label:'Ошибок сегодня',value:e1.length})}${plate({id:'tok',icon:'key',color:'purple',label:'Действующих токенов',value:DM_TOK.filter(dmLive).length})}</div><div id="dm-lg"></div>`;
  body.querySelector('.plates').onclick=e=>{const b=e.target.closest('[data-plate]');if(!b)return;if(b.dataset.plate==='tok')return go('dm','tok');const g=GS['dm-log'];if(!g)return;g.filters=b.dataset.plate==='err'?{res:{type:'enum',vals:['Ошибка']}}:{};g.page=0;renderPage()};
  grid($('#dm-lg',body),{id:'dm-log',audit:false,sort:{key:'at',dir:-1},noun:['запрос','запроса','запросов'],preset:S.preset,
    empty:{icon:'history',title:'Запросов пока не было',text:'Здесь появятся запросы внешних программ по токенам.'},cols:[
    {key:'at',label:'Когда',type:'datetime',w:145,val:x=>x.at},{key:'res',label:'Итог',type:'enum',w:120,val:x=>x.res,html:x=>pill(x.res,DM_RES)},{key:'org',label:'Организация',type:'enum',w:210,val:x=>dmOrgN(x.org)},
    {key:'tok',label:'Токен',type:'text',w:220,val:x=>(DM_TOK.find(y=>y.id===x.tok)||{name:x.tok}).name,html:x=>{const k=DM_TOK.find(y=>y.id===x.tok);return k?`${esc(k.name)}<div class="faint mono">bk_${esc(k.pre)}…</div>`:esc(x.tok)}},
    {key:'tpl',label:'Шаблон',type:'enum',w:220,val:x=>(dmTpl(x.tpl)||{name:x.tpl}).name},{key:'params',label:'Параметры',type:'text',w:250,val:x=>x.params||'',cls:'mono'},
    {key:'rows',label:'Строк',type:'int',w:90,num:true,val:x=>x.rows},{key:'ms',label:'Время, мс',type:'int',w:100,num:true,val:x=>x.ms},
    {key:'err',label:'Ошибка',type:'text',w:260,val:x=>x.err||''},{key:'ip',label:'Адрес',type:'text',w:140,val:x=>x.ip,cls:'mono'}],
    rows:()=>DM_LOG,open:x=>{const k=DM_TOK.find(y=>y.id===x.tok);if(k)dmTokDlg(k)}})}

/* «Моя организация» → «Настройки»: выключатель «Внешний доступ по API» (блок 5, пункт 9): сначала выключен, включает владелец, пишется в историю организации */
function dmApiBox(){const own=me()&&me().role==='owner',n=DM_TOK.filter(k=>k.org===ORG.id&&dmLive(k)).length;
  return `<div class="box" id="org-api"><h3>Внешний доступ по API</h3><label class="check-row"><input type="checkbox" class="sw" id="st-api" ${ORG.apiOn?'checked':''} ${own&&!dmDemo()?'':'disabled'}><span class="grow"><b>Выдавать данные внешним программам по API-токенам</b> ${tipI('Токены выпускают в «Витрине данных» → «API Токены»: Excel, Power BI или 1С получают по ним результат одного шаблона, только для чтения. Пока выключено, выпуск токенов недоступен, а выпущенные токены не отвечают; после включения они снова работают.')}<div class="hint">${dmDemo()?'В демо-версии токены не выпускаются':own?'Включает и выключает только владелец':'Включает и выключает владелец организации'}${n?` · действующих токенов: ${n}`:''}</div></span></label></div>`}
function dmApiMount(body){const x=$('#st-api',body);if(!x)return;x.onchange=()=>{if(!(me()&&me().role==='owner')){x.checked=!!ORG.apiOn;return}
  const set=on=>{ORG.apiOn=on;log('org','api',`Внешний доступ по API: ${on?'включён':'выключен'}`);renderPage();toast(on?'Внешний доступ по API включён':'Внешний доступ по API выключен: токены не отвечают','key')};
  const n=DM_TOK.filter(k=>k.org===ORG.id&&dmLive(k)).length;
  if(!x.checked&&n){x.checked=true;confirmDlg({title:'Выключить внешний доступ?',text:`Действующих токенов: ${n}. Они перестанут отвечать, пока доступ снова не включат; отзывать их не нужно.`,ok:'Выключить',danger:true,run:()=>set(false)});return}
  set(x.checked)}}

/* Вкладки и «+» модуля */
function dmTabs(){const a=isAdmin();return [{id:'out',label:'Вывод',icon:'table'},{id:'tpl',label:'Шаблоны',icon:'layers'},(a||can('dmTokens'))&&{id:'tok',label:'API Токены',icon:'key'},a&&{id:'log',label:'Журнал запросов',icon:'history'}]}
function dmAdd(){if(isAdmin())return [{label:'Шаблон',icon:'layers',run:()=>dmEdit(null)},{label:'Токен',icon:'key',run:()=>dmNewDlg()}];
  return [can('dmTokens')&&!dmDemo()&&{label:'Токен',icon:'key',run:()=>dmNewDlg()},{label:'Попросить шаблон',icon:'send',run:dmAskDlg}]}
function renderDm(body,tab){if(tab==='tpl')return renderDmTpl(body);if(tab==='tok')return renderDmTok(body);if(tab==='log')return renderDmLog(body);return renderDmOut(body)}

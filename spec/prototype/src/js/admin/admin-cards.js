'use strict';
// Админка: карточка пользователя (#accounts/<логин>) и карточка организации (#orgs/<адрес>) — вся информация по одной записи, только просмотр
/* ═════════════ Карточки пользователя и организации ═════════════ */
// Решение заказчика 09.11.2026. Меняют что-то только кнопки в шапке (как в меню строки) и «Завершить все сеансы»; войти под пользователем нельзя.
// Каждое открытие карточки пишется в историю платформы: ent 'acc' (логин) и 'porg' (организация), кто — администратор платформы.
// В прототипе полные данные есть только у демо-организации (o1, self); у остальных организаций — сводка из demoDB.json (поля sum, req, fee, work, kb).
const SESS=DB.sessions;
const SES_DAY=864e5;
function accEndSessions(login,how){const at=nowStamp();let n=0;SESS.forEach(s=>{if(s.u===login&&s.st==='open'){s.st='closed';s.end=at;s.how=how;n++}});return n}
const orgOwnerId=()=>(EMP.find(e=>e.role==='owner')||EMP[0]||{}).id;
const asOrg=f=>asUser(orgOwnerId(),f);
const acThemeL=t=>t==='dark'?'Тёмная':t==='light'?'Светлая':'Светлая (по умолчанию)';
function acUser(login){const u=allUsers().find(x=>x.login===login);if(!u)return null;const src=u.ref||OTHER_USERS.find(x=>x.login===login)||(login==='admin'?PLATFORM_ADMIN:u);
  return {u,src,kind:u.ref?'emp':login==='admin'?'admin':'other',org:u.org?ORGS.find(o=>o.id===u.org):null}}
// Состояние учётной записи цветной меткой (может быть несколько: заблокирован и не сменил временный пароль)
function acStates(c){if(c.kind==='admin')return [['Активен','green','check']];const s=c.src,out=[];
  if(!c.u.active)out.push([(s.blockedBy||(c.kind==='emp'?'owner':'admin'))==='admin'?'Заблокирован администратором':'Заблокирован владельцем','red','lock']);
  if(s.pwLocked)out.push(['Вход закрыт: 10 неверных паролей','red','ban']);
  if(s.tmpPass)out.push(['Не сменил временный пароль','yellow','key']);
  if(!out.length)out.push(['Активен','green','check']);return out}
const acPills=l=>l.map(([t,c,i])=>`<span class="pill ${c}">${ic(i)}${esc(t)}</span>`).join('');
const acKv=(k,v,full)=>`<div${full?' class="full"':''}><span class="k">${k}</span><span class="v">${v}</span></div>`;
const acDash='<span class="faint">—</span>';
const acTl=hs=>hs.length?`<ul class="tl">${hs.map(h=>`<li><span class="t">${fmtD(h.at.slice(0,10))}<br>${h.at.slice(11,16)}</span><span>${esc(h.what)}<br><span class="w">${esc(whoName(h.who))}</span></span></li>`).join('')}</ul>`:'<span class="faint">Записей пока нет</span>';
const acNote=t=>`<div class="note">${ic('info')}<span>${t}</span></div>`;
const AC_OTHER='Подробные данные этой организации в прототипе не хранятся — показана сводка. Полные данные есть у демо-организации «'+esc((ORGS.find(o=>o.self)||{}).name||'')+'».';
// Список только для просмотра (нажатие на число в «Работе», вкладки карточки организации)
function acList(title,sub,cfg){openModal({size:'wide',render:()=>({title,sub,body:'<div id="acl"></div>',foot:'<button class="btn cta" data-close>Готово</button>',mount(el){grid($('#acl',el),Object.assign({audit:false,search:false},cfg))}})})}
function acGrid(el,sel,cfg){const h=$(sel,el);if(h)grid(h,Object.assign({audit:false,search:false},cfg))}

/* ── карточка пользователя ── */
function accCard(login,tab){const c=acUser(login);if(!c){toast('Такой учётной записи нет','alert',true);return}
  log('acc',login,'Открыта карточка пользователя');
  MODALS.filter(x=>x.o.acc===login).forEach(x=>x.close());
  openModal({size:'wide',acc:login,state:{tab:tab||'main'},render:m=>{const st=m.state;const cc=acUser(login)||c;const u=cc.u,s=cc.src,adm=cc.kind==='admin';
    const tabs=adm?[['main','Основное','user'],['ses','Сеансы','key',SESS.filter(x=>x.u===login&&x.st==='open').length],['hist','История','history']]
      :[['main','Основное','user'],['work','Работа','briefcase'],['ses','Сеансы','key',SESS.filter(x=>x.u===login&&x.st==='open').length],['kb','Обучение и видео','grad'],['tg','Telegram','tg'],['hist','История','history']];
    if(!tabs.some(t=>t[0]===st.tab))st.tab='main';
    const b=st.tab==='main'?acMain(cc):st.tab==='work'?acWork(cc):st.tab==='ses'?acSes(cc):st.tab==='kb'?acKb(cc):st.tab==='tg'?acTg(cc):acHist(cc);
    const acts=adm?[]:accActions(u,()=>m.draw()).filter(x=>x&&!x.sep);
    return {title:esc(u.fio),sub:`<span class="mono">${esc(u.login)}</span> · ${cc.org?`<button type="button" class="linkbtn" data-acorg="${esc(cc.org.id)}">${esc(cc.org.name)}</button>`:'Платформа'} · ${esc(u.role)}`,
      head:acts.map((a,i)=>`<button class="btn sm hd-btn ${a.danger?'danger':''}" data-acact="${i}" ${a.disabled?'disabled':''} title="${esc(a.label)}">${ic(a.icon,'sm')}<span class="bl">${esc(a.label)}</span></button>`).join(''),
      body:`<div class="ac-st">${acPills(acStates(cc))}${adm?'<span class="hint" style="margin:0">Учётные записи администраторов платформы из Админки не меняются</span>':''}</div>${cardTabs(tabs,st.tab,'act')}<div class="ac-b">${b}</div>`,
      foot:`<span class="hint" style="margin:0">Только просмотр: войти в программу под этим пользователем из Админки нельзя</span><div class="grow"></div><button class="btn cta" data-close>Готово</button>`,
      mount(el){bindCardTabs(el,'act',k=>{st.tab=k;m.draw();const x=el.querySelector('.mb');if(x)x.scrollTop=0});
        $$('[data-acact]',el).forEach(x=>x.onclick=()=>{const a=acts[+x.dataset.acact];if(a&&a.run)a.run()});
        $$('[data-acorg]',el).forEach(x=>x.onclick=()=>orgCard(x.dataset.acorg));
        $$('[data-cpl]',el).forEach(x=>x.onclick=()=>acWorkList(cc,x.dataset.cpl));
        const e=$('#ac-end',el);if(e)e.onclick=()=>{const n=SESS.filter(x=>x.u===login&&x.st==='open').length;
          confirmDlg({title:`Завершить все сеансы ${esc(login)}?`,text:`Пользователь выйдет на всех устройствах: открытых сеансов — ${n}. Войти снова он сможет со своим паролем.`,ok:'Завершить',danger:true,run:()=>{const k=accEndSessions(login,'Завершён администратором платформы');
            const w=`Завершены все сеансы администратором платформы: ${k}`;log('acc',login,w);if(cc.kind==='emp')log('emp',s.id,w);m.draw();toast('Сеансы завершены: пользователь вышел на всех устройствах','key')}})};
        acGrids(el,cc)}}}})}
function acMain(c){const u=c.u,s=c.src;const r=c.kind==='emp'?ROLES.find(x=>x.id===s.role):null;
  const tg=c.kind==='other'?(s.tg===null?null:s.tg||'@'+u.login):s.tg;
  const kv=[acKv('ФИО',esc(u.fio)),acKv('Отображаемое имя',esc(s.short||autoShort(u.fio))),acKv('Логин',`<span class="mono">${esc(u.login)}</span>`),acKv('Телефон',s.phone?phoneHtml(s.phone):acDash),
    acKv('Организация',c.org?`<button type="button" class="linkbtn" data-acorg="${esc(c.org.id)}">${esc(c.org.name)}</button>`:'Платформа'),acKv('Роль',esc(u.role)),
    acKv('Владелец или сотрудник',c.kind==='admin'?'Администратор платформы':accIsOwner(s)?'Владелец организации':'Сотрудник'),
    acKv('Создан',`${esc(whoName(s._cb)||'—')}<div class="aud">${fmtDT(s._ca)||''}</div>`),acKv('Последний вход',esc(u.lastIn||'—')),
    acKv('Неверных паролей подряд сейчас',`${s.pwBad||0} из ${LG_ACC}`),acKv('Тема оформления',acThemeL(s.theme)),
    acKv('Telegram',tg?`<span class="pill sm green">${ic('tg')}привязан</span> <span class="mono">${esc(tg)}</span>${s.tgName?' · '+esc(s.tgName):''}${s.tgAt?`<div class="aud">с ${fmtD(String(s.tgAt).slice(0,10))}</div>`:''}`:'<span class="orange">не привязан</span>')].join('');
  let perms='';
  if(r){const eff=r.locked||r.id==='owner'?PERMS.map(p=>p[0]):roleEff(r);const sc=roleScope(r);
    perms=`<div class="box"><h3>Права роли «${esc(r.name)}»${r.id==='owner'?' — все права':''}</h3><div class="ac-perms">${PERM_GROUPS.map(g=>{const ps=PERMS.filter(p=>p[3]===g.id&&eff.includes(p[0]));if(!ps.length)return '';
      return `<div class="ac-pg"><b>${esc(g.name)}</b>${SCOPE_GROUPS.includes(g.id)?`<span class="pill sm ${r.id==='owner'||sc[g.id]==='all'?'blue':'faint'}">${r.id==='owner'||sc[g.id]==='all'?'все записи организации':'только свои'}</span>`:''}<div class="hint" style="margin:2px 0 0">${ps.map(p=>esc(p[1])).join(' · ')}</div></div>`}).join('')}</div></div>`}
  else if(c.kind==='other')perms=acNote('Права роли хранятся в организации. В прототипе у пользователей других организаций есть только название роли.');
  return `<div class="box"><div class="kv">${kv}</div></div>${perms}`}
// «Работа»: числа — по живым данным демо-организации; нажатие на число открывает список только для просмотра
function acWorkData(c){if(c.kind!=='emp')return null;const id=c.src.id,mo=ym(TODAY),pm=addMonths(mo,-1);
  const cps=CPS.filter(x=>x.resp===id&&!x.archived),rs=REPORTS.filter(r=>!r.superseded&&r.resp===id);
  return {cps,due:rs.filter(r=>r.status==='К сдаче'),work:rs.filter(r=>r.status==='В работе'),over:rs.filter(r=>r.overdue),done:rs.filter(r=>r.status==='Сдан'&&String(r.subDate||'').slice(0,7)===mo),
    tasks:TASKS.filter(t=>t.exec===id&&taskOpen(t)),kpi:IVALS.filter(v=>v.by===id&&v.m===pm),pm}}
const AC_WL={cps:'Закреплённые контрагенты',due:'Отчёты «К сдаче»',work:'Отчёты «В работе»',over:'Просроченные отчёты',done:'Сдано за текущий месяц',tasks:'Открытые задачи',kpi:'Показатели за прошлый месяц'};
function acWork(c){const d=acWorkData(c);
  if(!d){const w=c.src.work;return `${acNote(AC_OTHER)}${w?`<div class="plates">${plate({id:'a',icon:'building',color:'blue',label:'Контрагентов',value:w.cps||0})}${plate({id:'b',icon:'file',color:'yellow',label:'К сдаче',value:w.due||0})}${plate({id:'c',icon:'clock',color:'purple',label:'В работе',value:w.work||0})}${plate({id:'d',icon:'alert',color:w.over?'red':'green',label:'Просрочено',value:w.over||0})}${plate({id:'e',icon:'check',color:'green',label:'Сдано за месяц',value:w.done||0})}${plate({id:'f',icon:'task',color:'purple',label:'Открытых задач',value:w.tasks||0})}</div>`:''}`}
  const pl=(k,icon,color,label)=>plate({id:k,icon,color,label,value:d[k].length}).replace('data-plate=','data-cpl=');
  return `<div class="plates">${pl('cps','building','blue','Закреплено контрагентов')}${pl('due','file','yellow','К сдаче')}${pl('work','clock','purple','В работе')}${pl('over','alert',d.over.length?'red':'green','Просрочено')}${pl('done','check','green','Сдано за текущий месяц')}${pl('tasks','task','purple','Открытых задач')}${pl('kpi','gauge','blue','Показателей за '+fmtMon(d.pm))}</div>
    <div class="box"><h3>Закреплённые контрагенты · ${d.cps.length}</h3><div id="ac-cps"></div></div>`}
const fmtMon=m=>{const n=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];return n[+m.slice(5,7)-1]+' '+m.slice(0,4)};
const AC_CPCOLS=()=>[{key:'name',label:'Название',type:'text',w:260,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>`},{key:'inn',label:'ИНН',type:'text',w:150,cls:'mono',val:x=>x.inn},{key:'regime',label:'Режим',type:'enum',w:140,val:x=>x.regime},{key:'st',label:'Состояние',type:'enum',w:150,val:x=>x.status||'Обслуживается'}];
const AC_REPCOLS=()=>[{key:'cp',label:'Контрагент',type:'text',w:240,val:r=>(CPM[r.cp]||{}).name||''},{key:'t',label:'Отчёт',type:'enum',w:200,val:r=>(T[r.t]||{}).short||r.t},{key:'p',label:'Период',type:'text',w:140,val:r=>r.plabel||''},{key:'due',label:'Срок',type:'date',w:120,val:r=>r.due},{key:'st',label:'Статус',type:'enum',w:150,val:r=>r.status},{key:'resp',label:'Ответственный',type:'enum',w:170,val:r=>empName(r.resp)||''}];
function acWorkList(c,k){const d=acWorkData(c);if(!d)return;const rows=d[k];const sub=esc(c.u.fio)+' · только просмотр';
  if(k==='cps')return acList(AC_WL[k],sub,{id:'ac-l-cps',rid:x=>x.id,cols:AC_CPCOLS(),rows:()=>rows,title:'name',noun:['контрагент','контрагента','контрагентов']});
  if(k==='tasks')return acList(AC_WL[k],sub,{id:'ac-l-tasks',rid:x=>x.id,cols:[{key:'title',label:'Задача',type:'text',w:300,val:t=>t.title},{key:'cp',label:'Контрагент',type:'text',w:220,val:t=>(CPM[t.cp]||{}).name||''},{key:'date',label:'Срок',type:'date',w:120,val:t=>t.date},{key:'st',label:'Статус',type:'enum',w:150,val:t=>t.status}],rows:()=>rows,title:'title',noun:['задача','задачи','задач']});
  if(k==='kpi')return acList(AC_WL[k],sub,{id:'ac-l-kpi',rid:x=>x.cp+'|'+x.ind+'|'+x.m,cols:[{key:'cp',label:'Контрагент',type:'text',w:240,val:v=>(CPM[v.cp]||{}).name||''},{key:'ind',label:'Показатель',type:'enum',w:200,val:v=>(IND.find(i=>i.id===v.ind)||{}).name||v.ind},{key:'v',label:'Значение',type:'num',w:140,num:true,val:v=>v.v},{key:'at',label:'Внесено',type:'datetime',w:150,val:v=>v.at}],rows:()=>rows,title:'cp',noun:['значение','значения','значений']});
  acList(AC_WL[k],sub,{id:'ac-l-rep',rid:r=>r.id,cols:AC_REPCOLS(),rows:()=>rows,title:'cp',sort:{key:'due',dir:1},noun:['отчёт','отчёта','отчётов']})}
const SES_COLS=(who)=>[...(who?[{key:'u',label:'Пользователь',type:'text',w:150,cls:'mono',val:s=>s.u}]:[]),{key:'at',label:'Начало',type:'datetime',w:150,val:s=>s.at},{key:'last',label:'Последняя активность',type:'datetime',w:170,val:s=>s.st==='open'?s.last:s.end||s.last},{key:'till',label:'Действует до',type:'datetime',w:150,val:s=>s.st==='open'?s.till:null},{key:'dev',label:'Устройство',type:'text',w:240,val:s=>s.dev},{key:'st',label:'Состояние',type:'enum',w:230,val:s=>s.st==='open'?'Открыт':'Закрыт',html:s=>s.st==='open'?`<span class="pill sm green">${ic('check')}Открыт</span>`:`<span class="pill sm faint">Закрыт</span> <span class="hint" style="display:inline;margin:0">${esc(s.how||'')}</span>`}];
function acSes(c){const l=SESS.filter(x=>x.u===c.u.login),open=l.filter(x=>x.st==='open').length,self=c.u.login===S.me;
  return `<div class="row ac-bar"><span class="muted">Открытых сеансов: <b>${open}</b> · всего записей: ${l.length}</span><div class="grow"></div><button class="btn sm danger" id="ac-end" ${!open||self?'disabled':''} title="${self?'Это ваш текущий сеанс: выйдите через меню профиля':!open?'Открытых сеансов нет':'Пользователь выйдет на всех устройствах'}">${ic('logout','sm')}Завершить все сеансы</button></div><div id="ac-ses"></div><span class="hint">Устройство — браузер и система по заголовку браузера при входе; адрес IP в карточке не показывается.</span>`}
function acKb(c){if(c.kind!=='emp'){const k=c.src.kb;return `${acNote(AC_OTHER)}${k?`<div class="box"><div class="kv">${acKv('Уровень знаний',esc(k.lv||'—'))}${acKv('Пройдено шагов',esc(k.steps||'—'))}${acKv('Прогресс',`${k.pct||0} %`)}${acKv('Прочитано статей',k.arts||0)}${acKv('Видео просмотрено',k.vid||0)}</div></div>`:''}`}
  const id=c.src.id,s=kbFor(id);const arts=Object.entries((s.u&&s.u.arts)||{}).map(([a,x])=>({a:KB_ARTS.find(y=>y.id===a),at:x.at})).filter(x=>x.a).sort((p,q)=>p.at<q.at?1:-1);
  return `${kbBox(s,{mods:1})}<div class="box"><h3>Прочитанные статьи «Базы знаний» · ${arts.length}</h3>${arts.length?`<div class="tbl-wrap"><table class="mini m-cards"><thead><tr><th>Статья</th><th>Раздел</th><th>Прочитана</th></tr></thead><tbody>${arts.map(x=>`<tr><td>${esc(x.a.t)}</td><td>${esc(x.a.sec||'')}</td><td class="tnum">${fmtDT(x.at)}</td></tr>`).join('')}</tbody></table></div>`:'<span class="faint">Статей пока не читал</span>'}</div>
    <div class="box"><h3>Просмотры видео</h3><div id="ac-vid"></div></div>`}
const acTgRows=c=>{const s=c.src;const keys=[s.tg,c.kind==='other'?'@'+c.u.login:null].filter(Boolean);return TG_LOG.filter(x=>keys.some(k=>String(x.to||'').includes(k)))};
function acTg(c){const tg=c.kind==='other'?'@'+c.u.login:c.src.tg;return `${tg?'':acNote('Telegram не привязан: сообщения бота пользователю не уходят.')}<div id="ac-tg"></div><span class="hint">Сообщения бота этому пользователю из журнала «Телеграм»; текст кодов в журнале не хранится и не показывается.</span>`}
function acHist(c){const u=c.u,s=c.src;const hs=HIST.filter(h=>(h.ent==='acc'&&h.id===u.login)||(c.kind==='emp'&&h.ent==='emp'&&h.id===s.id)).slice();
  if(s._ca)hs.push({at:s._ca,who:s._cb,what:'Учётная запись создана'});hs.sort((a,b)=>a.at<b.at?1:-1);
  // действие администратора пишется и в историю учётной записи, и в историю сотрудника — показываем один раз
  const seen=new Set(),uq=hs.filter(h=>{const k=h.at+'|'+h.what;if(seen.has(k))return false;seen.add(k);return true});
  return `<div class="box">${acTl(uq.slice(0,200))}</div>`}
function acGrids(el,c){const login=c.u.login;
  acGrid(el,'#ac-ses',{id:'ac-ses',rid:s=>s.id,cols:SES_COLS(),rows:()=>SESS.filter(x=>x.u===login),title:'dev',sort:{key:'at',dir:-1},noun:['сеанс','сеанса','сеансов']});
  const d=c.kind==='emp'?acWorkData(c):null;if(d)acGrid(el,'#ac-cps',{id:'ac-cps',rid:x=>x.id,cols:AC_CPCOLS(),rows:()=>d.cps,title:'name',noun:['контрагент','контрагента','контрагентов']});
  if(c.kind==='emp')acGrid(el,'#ac-vid',{id:'ac-vid',rid:r=>r.v,cols:[{key:'v',label:'Видео',type:'text',w:280,val:r=>(VIDEOS.find(v=>v.id===r.v)||{t:r.v}).t},{key:'sec',label:'Просмотрено, сек',type:'int',w:150,num:true,val:r=>Math.round(vidSecs(VIDEOS.find(v=>v.id===r.v),r))},{key:'pct',label:'Процент',type:'int',w:110,num:true,val:r=>vidPct(VIDEOS.find(v=>v.id===r.v),r),text:r=>vidPct(VIDEOS.find(v=>v.id===r.v),r)+' %'},{key:'last',label:'Последний просмотр',type:'datetime',w:170,val:r=>((r.ses||[]).slice(-1)[0]||{}).at||r.done||null},{key:'st',label:'Состояние',type:'enum',w:150,val:r=>vidSt(VIDEOS.find(v=>v.id===r.v),r)}],rows:()=>VVIEWS.filter(r=>!r.org&&r.u===c.src.id),title:'v',sort:{key:'last',dir:-1},noun:['видео','видео','видео']});
  acGrid(el,'#ac-tg',{id:'ac-tg',rid:x=>x.id,cols:[{key:'at',label:'Дата',type:'datetime',w:150,val:x=>x.at},{key:'kind',label:'Тип',type:'enum',w:220,val:x=>x.kind},{key:'st',label:'Состояние',type:'enum',w:220,val:x=>x.st==='Ошибка'&&x.err?'Ошибка: '+x.err:x.st,html:x=>x.st==='Отправлено'?`<span class="pill sm green">${ic('check')}Отправлено</span>`:x.st==='Ошибка'?`<span class="pill sm red">${ic('alert')}${esc(x.err||'Ошибка')}</span>`:`<span class="pill sm faint">${esc(x.st)}</span>`}],rows:()=>acTgRows(c),title:'kind',sort:{key:'at',dir:-1},noun:['сообщение','сообщения','сообщений']})}

/* ── карточка организации ── */
const orgUsers=o=>o.self?allUsers().filter(u=>u.org===o.id):OTHER_USERS.filter(u=>u.org===o.id);
const orgSlug=o=>o.self?ORG.slug||'':o.slug||'';
const orgLead=o=>LEADS.find(l=>l.org===o.id)||null;
// Сводка: у демо-организации — по живым данным, у остальных — поле sum из demoDB.json
function orgSum(o){if(!o.self){const x=o.sum||{};const us=orgUsers(o);return {staff:us.filter(u=>u.active).length,staffOff:us.filter(u=>!u.active).length,cps:Object.assign({reg:0,once:0,pau:0,arch:0},x.cps),rep:Object.assign({due:0,work:0,done:0,over:0},x.rep),tasks:x.tasks||0,files:Object.assign({n:0,mb:0},x.files),tg:x.tg||0,logins30:orgLogins30(o)||x.logins30||0}}
  const mo=ym(TODAY);const rs=REPORTS.filter(r=>!r.superseded&&String(r.due||'').slice(0,7)===mo);const fs=asOrg(()=>allFiles());
  return {staff:EMP.filter(e=>e.active).length,staffOff:EMP.filter(e=>!e.active).length,
    cps:{reg:CPS.filter(c=>!c.archived&&c.kind!=='oneoff'&&c.status!=='Приостановлен').length,once:CPS.filter(c=>!c.archived&&c.kind==='oneoff').length,pau:CPS.filter(c=>!c.archived&&c.status==='Приостановлен').length,arch:CPS.filter(c=>c.archived).length},
    rep:{due:rs.filter(r=>r.status==='К сдаче').length,work:rs.filter(r=>r.status==='В работе').length,done:rs.filter(r=>r.status==='Сдан').length,over:rs.filter(r=>r.overdue).length},
    tasks:TASKS.filter(taskOpen).length,files:{n:fs.length,mb:Math.round(fs.reduce((a,f)=>a+(f.size||0),0)/1048576*10)/10},tg:EMP.filter(e=>e.tg).length,logins30:orgLogins30(o)}}
function orgLogins30(o){const ls=new Set(orgUsers(o).map(u=>u.login));const from=new Date(Date.parse(TODAY)-30*SES_DAY).toISOString().slice(0,10);return SESS.filter(s=>ls.has(s.u)&&s.at.slice(0,10)>=from).length}
function orgCard(id,tab){const o=ORGS.find(x=>x.id===id);if(!o){toast('Такой организации нет','alert',true);return}
  log('porg',id,'Открыта карточка организации');
  MODALS.filter(x=>x.o.porg).forEach(x=>x.close());
  openModal({size:'wide',porg:id,state:{tab:tab||'main'},render:m=>{const st=m.state;const sm=orgSum(o);const us=orgUsers(o);
    const tabs=[['main','Основное','landmark'],['sum','Сводка','gauge'],['staff','Сотрудники','users',us.length],['cps','Контрагенты','building'],['rep','Отчёты','file',sm.rep.over||'',sm.rep.over?1:0],['money','Деньги','coins'],['set','Настройки','sliders'],['files','Файлы','folder'],['hist','История','history']];
    const b=st.tab==='main'?ocMain(o):st.tab==='sum'?ocSum(o,sm):st.tab==='staff'?'<div id="oc-staff"></div>':st.tab==='cps'?ocCps(o):st.tab==='rep'?ocRep(o):st.tab==='money'?ocMoney(o):st.tab==='set'?ocSet(o):st.tab==='files'?ocFiles(o,sm):ocHist(o);
    const acts=orgActions(o,()=>m.draw());const own=OTHER_USERS.find(u=>u.login===o.owner)||(o.self?allUsers().find(u=>u.login===o.owner):null);
    const sl=orgSlug(o);
    return {title:esc(o.name),sub:`ИНН <span class="mono">${esc(o.inn)}</span>${sl?` · <span class="mono">buhuchet.kg/${esc(sl)}</span>`:''} · подключена ${fmtD(o.created)}`,
      head:[...acts,own?{label:'Сбросить пароль владельцу',icon:'key',run:()=>accResetPass(own),after:1}:null].filter(Boolean).map((a,i)=>`<button class="btn sm hd-btn ${a.danger?'danger':''}" data-ocact="${i}" ${a.disabled?'disabled':''} title="${esc(a.disabled&&a.reason?a.reason:a.label)}">${ic(a.icon,'sm')}<span class="bl">${esc(a.label)}</span></button>`).join(''),
      body:`<div class="ac-st">${o.active?`<span class="pill green">${ic('check')}Активна</span>`:`<span class="pill red">${ic('lock')}${o.note?esc(o.note):'Заблокирована'}</span>`}${o.self?`<span class="pill purple">${ic('star')}Демо</span>`:''}</div>${cardTabs(tabs,st.tab,'oct')}<div class="ac-b">${b}</div>`,
      foot:`<span class="hint" style="margin:0">Только просмотр: администратор не меняет контрагентов, отчёты и настройки организации</span><div class="grow"></div><button class="btn cta" data-close>Готово</button>`,
      mount(el){bindCardTabs(el,'oct',k=>{st.tab=k;m.draw();const x=el.querySelector('.mb');if(x)x.scrollTop=0});
        const all=[...acts,own?{run:()=>accResetPass(own)}:null].filter(Boolean);$$('[data-ocact]',el).forEach(x=>x.onclick=()=>{const a=all[+x.dataset.ocact];if(a&&a.run)a.run()});
        $$('[data-ocgo]',el).forEach(x=>x.onclick=()=>{st.tab=x.dataset.ocgo;m.draw()});
        $$('[data-plate]',el).forEach(x=>{const t={staff:'staff',cps:'cps',rep:'rep',tasks:'sum',files:'files',tg:'staff',log:'staff'}[x.dataset.plate];if(t&&t!==st.tab)x.onclick=()=>{st.tab=t;m.draw()}});
        $$('[data-acu]',el).forEach(x=>x.onclick=()=>accCard(x.dataset.acu));
        $$('[data-oclead]',el).forEach(x=>x.onclick=()=>{const l=LEADS.find(y=>String(y.id)===x.dataset.oclead);if(l)openLead(l)});
        ocGrids(el,o)}}}})}
function ocMain(o){const own=o.owner;const l=orgLead(o);
  const req=o.self?orgMainView():(()=>{const r=o.req||{};return `<div class="box"><h3>Основное</h3><div class="kv">${acKv('Название',esc(o.name))}${acKv('Полное название',esc(r.full||'—'))}${acKv('ИНН',`<span class="mono">${esc(o.inn)}</span>`)}${acKv('Адрес',esc(r.addr||'—'))}${acKv('Телефон',r.phone?esc(fmtPhone(r.phone)):'—')}${acKv('Руководитель',esc(r.head||'—'))}${acKv('Адрес страницы организации',`<span class="mono">${esc(o.slug||'—')}</span>`)}${acKv('Логотип',r.logo?'загружен':'нет')}${acKv('Банковские счета',(r.banks||[]).length?esc(r.banks.join(', ')):'—')}</div></div>`})();
  const bl=HIST.filter(h=>h.ent==='porg'&&h.id===o.id&&/блокир/i.test(h.what)).sort((a,b)=>a.at<b.at?1:-1);
  return `${req}<div class="box"><h3>На платформе</h3><div class="kv">${acKv('Владелец',own?`<button type="button" class="linkbtn mono" data-acu="${esc(own)}">${esc(own)}</button> · ${esc((orgUsers(o).find(u=>u.login===own)||{}).fio||'')}`:acDash)}${acKv('Из заявки',l?`<button type="button" class="linkbtn" data-oclead="${esc(l.id)}">${esc(l.firm||l.name)} · ${fmtDT(l.at)}</button>`:'<span class="faint">создана без заявки</span>')}${acKv('Создана',`${esc(whoName(o._cb)||'—')}<div class="aud">${fmtDT(o._ca)}</div>`)}${acKv('Состояние',o.active?'Активна':'Заблокирована'+(o.note?': '+esc(o.note):''))}</div>
    <h4 style="margin:12px 0 4px">Блокировки с причинами</h4>${bl.length?acTl(bl):'<span class="faint">Не блокировалась</span>'}</div>`}
function ocSum(o,s){const P=(id,icon,color,label,value,sub)=>plate({id,icon,color,label,value,sub});
  return `${o.self?'':acNote(AC_OTHER)}<div class="plates">${P('staff','users','blue','Сотрудники',s.staff,`активных · заблокировано ${s.staffOff}`)}${P('cps','building','green','Контрагенты',s.cps.reg+s.cps.once+s.cps.pau,`постоянных ${s.cps.reg} · разовых ${s.cps.once} · приостановлено ${s.cps.pau} · в архиве ${s.cps.arch}`)}${P('rep','file','yellow','Отчёты за '+fmtMon(ym(TODAY)),s.rep.due+s.rep.work+s.rep.done,`к сдаче ${s.rep.due} · в работе ${s.rep.work} · сдано ${s.rep.done}`)}${P('rep','alert',s.rep.over?'red':'green','Просрочено',s.rep.over,'отчётов за месяц')}${P('tasks','task','purple','Открытые задачи',s.tasks)}${P('files','folder','blue','Файлы',s.files.n,`${fmtM(s.files.mb)} МБ`)}${P('tg','tg','blue','Привязали Telegram',s.tg,'сотрудников')}${P('log','key','green','Входы за 30 дней',s.logins30)}</div>`}
function ocCps(o){if(!o.self){const c=Object.assign({reg:0,once:0,pau:0,arch:0},(o.sum||{}).cps);return `${acNote(AC_OTHER)}<div class="box"><div class="kv">${acKv('Постоянные',c.reg)}${acKv('Разовые',c.once)}${acKv('Приостановлены',c.pau)}${acKv('В архиве',c.arch)}</div></div>`}
  return '<div id="oc-cps"></div><span class="hint">Только просмотр: изменить контрагентов организации из Админки нельзя.</span>'}
function ocRep(o){if(!o.self){const r=Object.assign({due:0,work:0,done:0,over:0},(o.sum||{}).rep);return `${acNote(AC_OTHER)}<div class="box"><div class="kv">${acKv('К сдаче',r.due)}${acKv('В работе',r.work)}${acKv('Сдано',r.done)}${acKv('Просрочено',r.over)}</div></div>`}
  return `<div class="box"><h3>По месяцам и видам отчётов</h3><div id="oc-rep"></div></div><div class="box"><h3>Просроченные</h3><div id="oc-over"></div></div>`}
// «Деньги»: итоги без детализации по операциям
function ocMoney(o){if(!o.self){const f=o.fee||{};const r=(k)=>f[k]?`${acKv('Начислено',som(f[k][0]))}${acKv('Оплачено',som(f[k][1]))}${acKv('Долг',som(Math.max(0,f[k][0]-f[k][1])))}`:acKv('Нет данных',acDash);return `${acNote(AC_OTHER)}<div class="box"><h3>Плата за обслуживание за ${fmtMon(ym(TODAY))}</h3><div class="kv">${r('m')}</div></div><div class="box"><h3>С начала года</h3><div class="kv">${r('y')}</div></div>`}
  const mo=ym(TODAY),y0=mo.slice(0,4)+'-01';let mc=0,mp=0,yc=0,yp=0;
  CPS.forEach(c=>feeMonths(c).forEach(m=>{const ch=feeCharge(c,m),pd=feeGot(c,m);if(m===mo){mc+=ch;mp+=pd}if(m>=y0&&m<=mo){yc+=ch;yp+=pd}}));
  const box=(t,c,p)=>`<div class="box"><h3>${t}</h3><div class="kv">${acKv('Начислено',som(c))}${acKv('Оплачено',som(p))}${acKv('Долг',`<span class="${c-p>0?'red strong':''}">${som(Math.max(0,c-p))}</span>`)}</div></div>`;
  return `${box('Плата за обслуживание за '+fmtMon(mo),mc,mp)}${box('Плата за обслуживание с начала года',yc,yp)}<div class="box"><h3>Налоги контрагентов по месяцам</h3><div id="oc-tax"></div></div>`}
function ocSet(o){if(!o.self)return acNote(AC_OTHER);
  const fs=FEATURES.map(([k,l])=>`<span class="pill sm ${feat(k)?'green':'faint'}">${feat(k)?ic('check'):''}${esc(l)}</span>`).join(' ');
  const types=Object.entries(ORG.types||{}).filter(([,x])=>x.on).map(([id])=>T[id]).filter(Boolean);
  return `<div class="box"><h3>Учётная политика</h3><div class="kv">${acKv('Сдача отчётов требует подтверждения',repConfOn()?'да':'нет')}${acKv('Напомнить о неподтверждённой сдаче через',`${ORG.waitDays||3} дн.`)}${acKv('Задачи требуют подтверждения',ORG.taskConfirm!==false?'да':'нет')}${acKv('«Сдан» только после оплаты налога',ORG.payFirst?'да':'нет')}${acKv('Часовой пояс',esc(ORG.tz||'—'))}</div></div>
    <div class="box"><h3>Включённые модули и функции</h3><div class="row" style="gap:6px">${fs}</div></div>
    <div class="box"><h3>Подключённые виды отчётов · ${types.length}</h3><div class="row" style="gap:6px">${types.map(t=>`<span class="tag">${esc(t.short||t.name)}</span>`).join('')||acDash}</div></div>
    <div class="box"><h3>Роли и права · ${ROLES.length}</h3><div class="tbl-wrap"><table class="mini m-cards"><thead><tr><th>Роль</th><th class="num">Прав</th><th>Сотрудников</th></tr></thead><tbody>${ROLES.map(r=>`<tr><td>${esc(r.name)}</td><td class="num">${r.locked||r.id==='owner'?'все':roleN(r)}</td><td>${EMP.filter(e=>e.role===r.id).length}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="box"><h3>Telegram-напоминания</h3><div class="kv">${acKv('Напоминания о сроках',ORG.remind.map(d=>`за ${d} ${plural(d,'день','дня','дней')}`).join(', ')+' и в день срока')}${acKv('Сводка недели',`понедельник, ${esc(ORG.digest||'09:00')}`)}${acKv('Повтор о просрочке',ORG.overdueRepeat?'да':'нет')}</div></div>`}
function ocFiles(o,s){if(!o.self)return `${acNote(AC_OTHER)}<div class="box"><div class="kv">${acKv('Файлов',s.files.n)}${acKv('Объём',fmtM(s.files.mb)+' МБ')}</div></div>`;
  return `<div class="box"><h3>Объём по категориям · ${fmtM(s.files.mb)} МБ</h3><div id="oc-fk"></div></div><div class="box"><h3>Последние загрузки</h3><div id="oc-fl"></div></div>`}
function ocHist(o){const hs=HIST.filter(h=>h.ent==='porg'&&h.id===o.id||(o.self&&(h.ent==='org'||h.ent==='role'))).slice();if(o._ca)hs.push({at:o._ca,who:o._cb,what:'Организация создана вместе с владельцем'});hs.sort((a,b)=>a.at<b.at?1:-1);
  return `<div class="box">${acTl(hs.slice(0,200))}</div>`}
function ocGrids(el,o){const us=orgUsers(o);
  acGrid(el,'#oc-staff',{id:'oc-staff',rid:u=>u.login,cols:[{key:'fio',label:'ФИО',type:'text',w:240,val:u=>u.fio,html:u=>`<span class="strong">${esc(u.fio)}</span>`},{key:'login',label:'Логин',type:'text',w:140,cls:'mono',val:u=>u.login},{key:'role',label:'Роль',type:'enum',w:190,val:u=>u.role},{key:'tg',label:'Telegram',type:'enum',w:150,val:u=>(u.ref?u.ref.tg:u.tg===null?null:u.tg||'@'+u.login)?'привязан':'не привязан'},{key:'last',label:'Последний вход',type:'text',w:150,val:u=>u.lastIn},{key:'st',label:'Состояние',type:'enum',w:220,val:u=>acStates(acUser(u.login)||{u,src:u,kind:'other'}).map(x=>x[0]).join(', ')}],rows:()=>us,title:'fio',noun:['сотрудник','сотрудника','сотрудников'],open:u=>accCard(u.login)});
  if(!o.self)return;
  acGrid(el,'#oc-cps',{id:'oc-cps',rid:c=>c.id,cols:[{key:'name',label:'Название',type:'text',w:250,val:c=>c.name,html:c=>`<span class="strong">${esc(c.name)}</span>`},{key:'inn',label:'ИНН',type:'text',w:150,cls:'mono',val:c=>c.inn},{key:'form',label:'Форма',type:'enum',w:100,val:c=>c.form},{key:'regime',label:'Режим',type:'enum',w:130,val:c=>c.regime},{key:'resp',label:'Ответственный',type:'enum',w:170,val:c=>empName(c.resp)||''},{key:'kind',label:'Вид',type:'enum',w:120,val:c=>c.kind==='oneoff'?'Разовый':'Постоянный'},{key:'fee',label:'Стоимость, сом',type:'money',w:140,num:true,val:c=>{const t=tariffAt(c,ym(TODAY));return t?t.amount:null}},{key:'st',label:'Состояние',type:'enum',w:150,val:c=>c.archived?'В архиве':c.status||'Обслуживается'}],rows:()=>CPS,title:'name',noun:['контрагент','контрагента','контрагентов']});
  const agg={};REPORTS.filter(r=>!r.superseded&&r.due).forEach(r=>{const k=r.due.slice(0,7)+'|'+r.t;const x=agg[k]=agg[k]||{id:k,m:r.due.slice(0,7),t:r.t,n:0,done:0,over:0};x.n++;if(r.status==='Сдан')x.done++;if(r.overdue)x.over++});
  const mo=ym(TODAY);acGrid(el,'#oc-rep',{id:'oc-rep',rid:x=>x.id,defGroup:['m'],cols:[{key:'m',label:'Месяц срока',type:'text',w:160,val:x=>x.m,text:x=>fmtMon(x.m),sortVal:x=>x.m},{key:'t',label:'Вид отчёта',type:'enum',w:240,val:x=>(T[x.t]||{}).short||x.t},{key:'n',label:'Всего',type:'int',w:100,num:true,val:x=>x.n},{key:'done',label:'Сдано',type:'int',w:100,num:true,val:x=>x.done},{key:'over',label:'Просрочено',type:'int',w:120,num:true,val:x=>x.over}],rows:()=>Object.values(agg).filter(x=>x.m<=mo&&x.m>=addMonths(mo,-5)),title:'t',sort:{key:'m',dir:-1},noun:['строка','строки','строк']});
  acGrid(el,'#oc-over',{id:'oc-over',rid:r=>r.id,cols:AC_REPCOLS(),rows:()=>REPORTS.filter(r=>!r.superseded&&r.overdue),title:'cp',sort:{key:'due',dir:1},noun:['отчёт','отчёта','отчётов']});
  const tx={};REPORTS.filter(r=>!r.superseded&&r.sum>0&&(r.payDue||r.due)).forEach(r=>{const m=(r.payDue||r.due).slice(0,7);const x=tx[m]=tx[m]||{m,sum:0,paid:0};x.sum+=r.sum;x.paid+=Math.min(r.paid||0,r.sum)});
  acGrid(el,'#oc-tax',{id:'oc-tax',rid:x=>x.m,cols:[{key:'m',label:'Месяц уплаты',type:'text',w:170,val:x=>x.m,text:x=>fmtMon(x.m)},{key:'sum',label:'К уплате, сом',type:'money',w:160,num:true,val:x=>x.sum},{key:'paid',label:'Оплачено, сом',type:'money',w:160,num:true,val:x=>x.paid},{key:'left',label:'Не оплачено, сом',type:'money',w:170,num:true,val:x=>Math.max(0,x.sum-x.paid)}],rows:()=>Object.values(tx).filter(x=>x.m<=addMonths(mo,1)&&x.m>=addMonths(mo,-11)),title:'m',sort:{key:'m',dir:-1},noun:['месяц','месяца','месяцев']});
  const fs=asOrg(()=>allFiles());const fk={};fs.forEach(f=>{const x=fk[f.kind]=fk[f.kind]||{kind:f.kind,n:0,size:0};x.n++;x.size+=f.size||0});
  acGrid(el,'#oc-fk',{id:'oc-fk',rid:x=>x.kind,cols:[{key:'kind',label:'Категория',type:'enum',w:240,val:x=>(typeof FKIND_L!=='undefined'&&FKIND_L[x.kind])||x.kind},{key:'n',label:'Файлов',type:'int',w:110,num:true,val:x=>x.n},{key:'mb',label:'Объём, МБ',type:'num',w:130,num:true,val:x=>Math.round(x.size/1048576*10)/10}],rows:()=>Object.values(fk),title:'kind',sort:{key:'mb',dir:-1},noun:['категория','категории','категорий']});
  acGrid(el,'#oc-fl',{id:'oc-fl',rid:f=>f.id,cols:[{key:'name',label:'Файл',type:'text',w:300,val:f=>f.name},{key:'kind',label:'Категория',type:'enum',w:180,val:f=>f.kind},{key:'cp',label:'Контрагент',type:'text',w:220,val:f=>(CPM[f.cp]||{}).name||''},{key:'by',label:'Загрузил',type:'enum',w:160,val:f=>empName(f.by)||''},{key:'date',label:'Дата',type:'date',w:120,val:f=>String(f.date||'').slice(0,10)},{key:'size',label:'Размер',type:'int',w:110,num:true,val:f=>f.size,text:f=>fmtSize(f.size||0)}],rows:()=>fs.slice().sort((a,b)=>String(a.date)<String(b.date)?1:-1).slice(0,30),title:'name',sort:{key:'date',dir:-1},noun:['файл','файла','файлов']})}

/* ── ссылки #accounts/<логин> и #orgs/<адрес организации> ── */
const ACARD={pend:null};
function admCardRoute(){const x=/^#(accounts|orgs)\/(.+)$/.exec(location.hash);if(!x)return false;const k=x[1],v=decodeURIComponent(x[2]);history.replaceState(history.state,'','#'+k);
  if(S.loggedIn===false||!isAdmin()){ACARD.pend=[k,v];return false}setTimeout(()=>admCardOpen(k,v),60);return false}
function admCardOpen(k,v){if(k==='accounts')return accCard(v);const o=ORGS.find(x=>orgSlug(x)===v||x.id===v);if(o)orgCard(o.id);else toast('Организация с таким адресом не найдена','alert',true)}
function admCardPendGo(){if(!ACARD.pend||S.loggedIn===false||!isAdmin())return;const p=ACARD.pend;ACARD.pend=null;setTimeout(()=>admCardOpen(...p),140)}

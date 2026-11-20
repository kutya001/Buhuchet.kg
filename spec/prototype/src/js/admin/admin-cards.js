'use strict';
// Админка: карточка пользователя (#accounts/<логин>) и карточка организации (#orgs/<адрес>) — вся информация по одной записи, только просмотр
/* ═════════════ Карточки пользователя и организации ═════════════ */
// Решение заказчика 09.11.2026. Меняют что-то только кнопки в шапке (как в меню строки) и «Завершить все сеансы»; войти под пользователем нельзя.
// Каждое открытие карточки пишется в историю платформы: ent 'acc' (логин) и 'porg' (организация), кто — администратор платформы.
// Данные карточек: у демо-организации (o1, self) — живые, у остальных — набор демонстрационных данных ocData по числам demoDB.json (sum, req, fee, work, kb).
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
  if(s.pwLocked)out.push([s.pwLockWhy==='notme'?'Вход закрыт: «Это не я» из Telegram':'Вход закрыт: 10 неверных паролей','red','ban']);
  if(s.tmpPass)out.push(['Не сменил временный пароль','yellow','key']);
  if(s.noPass)out.push(['Пароль не задан: ссылка в Telegram','yellow','key']);
  if(!out.length)out.push(['Активен','green','check']);return out}
const acPills=l=>l.map(([t,c,i])=>`<span class="pill ${c}">${ic(i)}${esc(t)}</span>`).join('');
const acKv=(k,v,full)=>`<div${full?' class="full"':''}><span class="k">${k}</span><span class="v">${v}</span></div>`;
const acDash='<span class="faint">—</span>';
const acTl=hs=>hs.length?`<ul class="tl">${hs.map(h=>`<li><span class="t">${fmtD(h.at.slice(0,10))}<br>${h.at.slice(11,16)}</span><span>${esc(h.what)}<br><span class="w">${esc(whoName(h.who))}</span></span></li>`).join('')}</ul>`:'<span class="faint">Записей пока нет</span>';
const acNote=t=>`<div class="note">${ic('info')}<span>${t}</span></div>`;
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
function acMain(c){const u=c.u,s=c.src;const r=c.kind==='emp'?ROLES.find(x=>x.id===s.role):c.kind==='other'?ocRole(s.role||u.role):null;
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
  return `<div class="box"><div class="kv">${kv}</div></div>${perms}`}
// «Работа»: числа — по данным организации пользователя (у демо — живые, у остальных — набор ocData); нажатие на число открывает список только для просмотра
function acWorkData(c){if(!c.org)return null;const od=ocData(c.org),emp=c.kind==='emp',id=emp?c.src.id:c.u.login,mo=ym(TODAY),pm=addMonths(mo,-1);
  const cps=od.cps.filter(x=>x.resp===id&&!x.archived),rs=od.reps.filter(r=>r.resp===id);
  return {od,cps,due:rs.filter(r=>r.status==='К сдаче'),work:rs.filter(r=>r.status==='В работе'),over:rs.filter(r=>r.overdue),done:rs.filter(r=>r.status==='Сдан'&&String(r.subDate||'').slice(0,7)===mo),
    tasks:od.tasks.filter(t=>t.exec===id),kpi:emp?IVALS.filter(v=>v.by===id&&v.m===pm):null,pm}}
const AC_WL={cps:'Закреплённые контрагенты',due:'Отчёты «К сдаче»',work:'Отчёты «В работе»',over:'Просроченные отчёты',done:'Сдано за текущий месяц',tasks:'Открытые задачи',kpi:'Показатели за прошлый месяц'};
function acWork(c){const d=acWorkData(c);if(!d)return `<div class="state">${ic('briefcase','lg')}<b>Пользователь не состоит в организации</b></div>`;
  const pl=(k,icon,color,label)=>plate({id:k,icon,color,label,value:d[k].length}).replace('data-plate=','data-cpl=');
  return `<div class="plates">${pl('cps','building','blue','Закреплено контрагентов')}${pl('due','file','yellow','К сдаче')}${pl('work','clock','purple','В работе')}${pl('over','alert',d.over.length?'red':'green','Просрочено')}${pl('done','check','green','Сдано за текущий месяц')}${pl('tasks','task','purple','Открытых задач')}${d.kpi?pl('kpi','gauge','blue','Показателей за '+fmtMon(d.pm)):''}</div>
    <div class="box"><h3>Закреплённые контрагенты · ${d.cps.length}</h3><div id="ac-cps"></div></div>`}
const fmtMon=m=>{const n=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];return n[+m.slice(5,7)-1]+' '+m.slice(0,4)};
const AC_CPCOLS=()=>[{key:'name',label:'Название',type:'text',w:260,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>`},{key:'inn',label:'ИНН',type:'text',w:150,cls:'mono',val:x=>x.inn},{key:'regime',label:'Режим',type:'enum',w:140,val:x=>x.regime},{key:'st',label:'Состояние',type:'enum',w:150,val:x=>x.status||'Обслуживается'}];
function acWorkList(c,k){const d=acWorkData(c);if(!d)return;const cpm=d.od.cpm;const rows=d[k];const sub=esc(c.u.fio)+' · только просмотр';
  if(k==='cps')return acList(AC_WL[k],sub,{id:'ac-l-cps',rid:x=>x.id,cols:AC_CPCOLS(),rows:()=>rows,title:'name',noun:['контрагент','контрагента','контрагентов']});
  if(k==='tasks')return acList(AC_WL[k],sub,{id:'ac-l-tasks',rid:x=>x.id,cols:[{key:'title',label:'Задача',type:'text',w:300,val:t=>t.title},{key:'cp',label:'Контрагент',type:'text',w:220,val:t=>(cpm[t.cp]||{}).name||''},{key:'date',label:'Срок',type:'date',w:120,val:t=>t.date},{key:'st',label:'Статус',type:'enum',w:150,val:t=>t.status}],rows:()=>rows,title:'title',noun:['задача','задачи','задач']});
  if(k==='kpi')return acList(AC_WL[k],sub,{id:'ac-l-kpi',rid:x=>x.cp+'|'+x.ind+'|'+x.m,cols:[{key:'cp',label:'Контрагент',type:'text',w:240,val:v=>(cpm[v.cp]||{}).name||''},{key:'ind',label:'Показатель',type:'enum',w:200,val:v=>(IND.find(i=>i.id===v.ind)||{}).name||v.ind},{key:'v',label:'Значение',type:'num',w:140,num:true,val:v=>v.v},{key:'at',label:'Внесено',type:'datetime',w:150,val:v=>v.at}],rows:()=>rows,title:'cp',noun:['значение','значения','значений']});
  acList(AC_WL[k],sub,{id:'ac-l-rep',rid:r=>r.id,cols:OC_REPCOLS(d.od),rows:()=>rows,title:'cp',sort:{key:'due',dir:1},noun:['отчёт','отчёта','отчётов']})}
const SES_COLS=(who)=>[...(who?[{key:'u',label:'Пользователь',type:'text',w:150,cls:'mono',val:s=>s.u}]:[]),{key:'at',label:'Начало',type:'datetime',w:150,val:s=>s.at},{key:'last',label:'Последняя активность',type:'datetime',w:170,val:s=>s.st==='open'?s.last:s.end||s.last},{key:'till',label:'Действует до',type:'datetime',w:150,val:s=>s.st==='open'?s.till:null},{key:'dev',label:'Устройство',type:'text',w:240,val:s=>s.dev},{key:'st',label:'Состояние',type:'enum',w:230,val:s=>s.st==='open'?'Открыт':'Закрыт',html:s=>s.st==='open'?`<span class="pill sm green">${ic('check')}Открыт</span>`:`<span class="pill sm faint">Закрыт</span> <span class="hint" style="display:inline;margin:0">${esc(s.how||'')}</span>`}];
function acSes(c){const l=SESS.filter(x=>x.u===c.u.login),open=l.filter(x=>x.st==='open').length,self=c.u.login===S.me;
  return `<div class="row ac-bar"><span class="muted">Открытых сеансов: <b>${open}</b> · всего записей: ${l.length}</span><div class="grow"></div><button class="btn sm danger" id="ac-end" ${!open||self?'disabled':''} title="${self?'Это ваш текущий сеанс: выйдите через меню профиля':!open?'Открытых сеансов нет':'Пользователь выйдет на всех устройствах'}">${ic('logout','sm')}Завершить все сеансы</button></div><div id="ac-ses"></div><span class="hint">Устройство — браузер и система по заголовку браузера при входе; адрес IP в карточке не показывается.</span>`}
function acKb(c){if(c.kind!=='emp'){const k=c.src.kb;return k?`<div class="box"><div class="kv">${acKv('Уровень знаний',esc(k.lv||'—'))}${acKv('Пройдено шагов',esc(k.steps||'—'))}${acKv('Прогресс',`${k.pct||0} %`)}${acKv('Прочитано статей',k.arts||0)}${acKv('Видео просмотрено',k.vid||0)}</div></div>`:`<div class="state">${ic('book','lg')}<b>Пользователь ещё не открывал «Базу знаний»</b></div>`}
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
  if($('#ac-cps',el)){const d=acWorkData(c);if(d)acGrid(el,'#ac-cps',{id:'ac-cps',rid:x=>x.id,cols:AC_CPCOLS(),rows:()=>d.cps,title:'name',noun:['контрагент','контрагента','контрагентов']})}
  if(c.kind==='emp')acGrid(el,'#ac-vid',{id:'ac-vid',rid:r=>r.v,cols:[{key:'v',label:'Видео',type:'text',w:280,val:r=>(VIDEOS.find(v=>v.id===r.v)||{t:r.v}).t},{key:'sec',label:'Просмотрено, сек',type:'int',w:150,num:true,val:r=>Math.round(vidSecs(VIDEOS.find(v=>v.id===r.v),r))},{key:'pct',label:'Процент',type:'int',w:110,num:true,val:r=>vidPct(VIDEOS.find(v=>v.id===r.v),r),text:r=>vidPct(VIDEOS.find(v=>v.id===r.v),r)+' %'},{key:'last',label:'Последний просмотр',type:'datetime',w:170,val:r=>((r.ses||[]).slice(-1)[0]||{}).at||r.done||null},{key:'st',label:'Состояние',type:'enum',w:150,val:r=>vidSt(VIDEOS.find(v=>v.id===r.v),r)}],rows:()=>VVIEWS.filter(r=>!r.org&&r.u===c.src.id),title:'v',sort:{key:'last',dir:-1},noun:['видео','видео','видео']});
  acGrid(el,'#ac-tg',{id:'ac-tg',rid:x=>x.id,cols:[{key:'at',label:'Дата',type:'datetime',w:150,val:x=>x.at},{key:'kind',label:'Тип',type:'enum',w:220,val:x=>x.kind},{key:'st',label:'Состояние',type:'enum',w:220,val:x=>x.st==='Ошибка'&&x.err?'Ошибка: '+x.err:x.st,html:x=>x.st==='Отправлено'?`<span class="pill sm green">${ic('check')}Отправлено</span>`:x.st==='Ошибка'?`<span class="pill sm red">${ic('alert')}${esc(x.err||'Ошибка')}</span>`:`<span class="pill sm faint">${esc(x.st)}</span>`}],rows:()=>acTgRows(c),title:'kind',sort:{key:'at',dir:-1},noun:['сообщение','сообщения','сообщений']})}

/* ── карточка организации ── */
const orgUsers=o=>o.self?allUsers().filter(u=>u.org===o.id):OTHER_USERS.filter(u=>u.org===o.id);
const orgSlug=o=>o.self?ORG.slug||'':o.slug||'';
const orgLead=o=>LEADS.find(l=>l.org===o.id)||null;
/* ── данные карточки организации ── */
// Доработки 20.11.2026, пакет 2, блок 1, пункт 6: пометки «Подробные данные не хранятся» больше нет. У демо-организации — живые данные,
// у остальных — небольшой набор демонстрационных данных по числам demoDB.json (sum): контрагенты, их отчёты за 6 прошлых месяцев, текущий и 3 следующих,
// файлы и задачи. Набор строится один раз от названия и ИНН организации и одинаков при каждом открытии; «Сводка» считается по нему же.
const OCD={};
const OC_OPEN=new Set(['К сдаче','В работе','Требует исправления']);
const OC_N1=['Ак','Ала','Бай','Жаңы','Кызыл','Нур','Сары','Таш','Улуу','Чоң','Эл','Ырыс','Береке','Тулпар','Кут','Арстан'];
const OC_N2=['Трейд','Строй','Сервис','Агро','Логистик','Маркет','Импэкс','Фарм','Тех','Транс','Курулуш','Азык'];
const OC_FAM=['Абдыкадыров','Мамытова','Сыдыков','Иманалиева','Токтогулов','Асанова','Жумабеков','Осмонова','Бекова','Сатыбалдиев','Алымкулов','Карабаева','Эсенов','Турдубаева'];
const OC_INI='АБГДЖКМНРСТУЭ';
const OC_TASKS=['Сверка расчётов с ГНС','Запросить банковскую выписку','Подготовить акт сверки','Обновить договор обслуживания','Проверить первичные документы'];
const OC_TYPES={'ОНР':['nds','nspm','soc'],'Единый налог':['enq','soc'],'Патент':['pat','soc']};
function ocRnd(seed){let h=2166136261;for(const ch of seed)h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;return ()=>{h=Math.imul(h^(h>>>15),2246822507)>>>0;h=Math.imul(h^(h>>>13),3266489909)>>>0;return ((h^=h>>>16)>>>0)/4294967296}}
// Данные вкладок карточки: cps, cpm (по номеру), reps (без прежних версий), files, tasks, who(кто) — имя ответственного или загрузившего
function ocData(o){
  if(o.self){const fs=asOrg(()=>allFiles());return {self:true,cps:CPS,cpm:CPM,reps:REPORTS.filter(r=>!r.superseded&&r.due),files:fs,tasks:TASKS.filter(taskOpen),who:id=>empName(id)||whoName(id)||'',
    assigned:CPS.filter(c=>!c.archived&&(c.assign||[]).some(a=>!a.to)).length}}
  if(OCD[o.id])return OCD[o.id];
  const R=ocRnd(o.id+'|'+o.inn),pick=a=>a[Math.floor(R()*a.length)],us=orgUsers(o).filter(u=>u.active),logins=us.map(u=>u.login);
  const n=Object.assign({reg:0,once:0,pau:0,arch:0},(o.sum||{}).cps),mo=ym(TODAY),cps=[],reps=[],files=[],tasks=[],names=new Set();
  const kinds=[...Array(n.reg).fill('reg'),...Array(n.once).fill('once'),...Array(n.pau).fill('pau'),...Array(n.arch).fill('arch')];
  const day=(d,h)=>`${d} ${String(h).padStart(2,'0')}:${String(Math.floor(R()*60)).padStart(2,'0')}`;
  kinds.forEach((k,i)=>{const ip=R()<.22;const nm=()=>ip?`ИП ${pick(OC_FAM)} ${pick([...OC_INI])}. ${pick([...OC_INI])}.`:`ОсОО «${pick(OC_N1)} ${pick(OC_N2)}»`;let name=nm();for(let j=0;j<8&&names.has(name);j++)name=nm();if(names.has(name))name=name.replace(/»?$/,m=>` ${i+1}${m}`);names.add(name);
    const regime=ip?pick(['Единый налог','Патент']):pick(['ОНР','ОНР','Единый налог']);
    cps.push({id:`${o.id}-c${i+1}`,name,inn:(ip?'2':'0')+String(Math.floor(R()*1e13)).padStart(13,'0'),form:ip?'ИП':'ОсОО',regime,resp:logins.length?logins[i%logins.length]:null,
      kind:k==='once'?'oneoff':'regular',status:k==='pau'?'Приостановлен':'Обслуживается',archived:k==='arch',fee:k==='once'?null:3000+500*Math.floor(R()*19),_ca:`${o.created} 10:00`})});
  const cpm=Object.fromEntries(cps.map(c=>[c.id,c]));
  const add=(c,tid,p)=>{const t=T[tid];if(!t)return;const d=dueOf(t,p).due;if(d<addMonths(mo,-6)+'-01'||d>addMonths(mo,3)+'-31')return;
    const cur=d.slice(0,7)===mo;let status='К сдаче',sub=null;
    if(d<TODAY){status='Сдан';sub=addDays(d,-Math.floor(R()*6))}else if(cur){const x=R();status=x<.15?'Сдан':x<.45?'В работе':'К сдаче';if(status==='Сдан')sub=addDays(TODAY,-Math.floor(R()*3))}
    const sum=t.sum?Math.round((500+R()*30000)/10)*10:null;
    reps.push({id:`${c.id}-${tid}-${p.y}-${p.m||'q'+p.q}`,cp:c.id,t:tid,p,plabel:plabel(t,p),due:d,status,subDate:sub,sum,paid:sum&&status==='Сдан'?sum:0,resp:c.resp,files:[],_ca:day(addDays(d,-40),3),_cb:'system'})};
  cps.forEach(c=>{if(c.archived)return;const last=c.status==='Приостановлен'?addMonths(mo,-3):addMonths(mo,2);
    if(c.kind==='oneoff'){add(c,'soc',{y:+addMonths(mo,-1).slice(0,4),m:+addMonths(mo,-1).slice(5,7)});return}
    (OC_TYPES[c.regime]||['soc']).forEach(tid=>{const t=T[tid];if(!t)return;
      for(let m=addMonths(mo,-7);m<=last;m=addMonths(m,1)){const y=+m.slice(0,4),mm=+m.slice(5,7);if(t.per==='M')add(c,tid,{y,m:mm});else if(t.per==='Q'&&mm%3===0)add(c,tid,{y,q:mm/3})}})});
  // Просрочено — столько, сколько в числах организации: самые свежие прошедшие сроки не сданы
  const past=reps.filter(r=>r.due<TODAY).sort((a,b)=>a.due<b.due?1:-1);
  past.slice(0,(o.sum&&o.sum.rep&&o.sum.rep.over)||0).forEach((r,i)=>{r.status=i%2?'В работе':'К сдаче';r.subDate=null;r.paid=0});
  reps.forEach(r=>{r.overdue=OC_OPEN.has(r.status)&&r.due<TODAY;r.payDue=r.due;
    const hs=r.hist=[{at:r._ca,who:'system',what:'Отчёт создан по назначению: К сдаче'}];
    if(r.status==='В работе'||r.subDate)hs.push({at:day(addDays(r.subDate||TODAY,-2),11),who:r.resp,what:'К сдаче → В работе'});
    if(r.subDate)hs.push({at:day(r.subDate,15),who:r.resp,what:'В работе → Сдан'});
    if(r.subDate&&R()<.4){const t=T[r.t];const f={id:`${r.id}-f`,name:`квитанция_${(t.short||r.t).replace(/[^0-9A-Za-zА-Яа-яЁё]+/g,'_')}_${r.plabel.replace(/[ .]+/g,'-')}.pdf`,kind:'Отчёт',cp:r.cp,by:r.resp,date:r.subDate,src:`${t.short||r.t} · ${r.plabel}`};f.size=fsize(f.name);r.files.push(f.name);files.push(f)}});
  cps.forEach((c,i)=>{if(R()<.55){const f={id:`${c.id}-d`,name:`Договор_обслуживания_${i+1}.pdf`,kind:'Контрагент',cp:c.id,by:c.resp,date:o.created,src:c.name};f.size=fsize(f.name);files.push(f)}});
  ['Договор_типовой.docx','Прайс_услуг.xlsx','Регламент_работы.pdf'].forEach((nm,i)=>{const f={id:`${o.id}-m${i+1}`,name:nm,kind:'Загружен вручную',cp:null,by:o.owner,date:o.created,src:'Загружен вручную'};f.size=fsize(nm);files.push(f)});
  us.forEach(u=>{const k=(u.work&&u.work.tasks)||0;const mine=cps.filter(c=>c.resp===u.login&&!c.archived);for(let j=0;j<k;j++){const c=mine.length?mine[j%mine.length]:null;tasks.push({id:`${o.id}-t-${u.login}-${j}`,title:OC_TASKS[(j+u.login.length)%OC_TASKS.length],cp:c?c.id:null,date:addDays(TODAY,1+j*3),status:'К выполнению',exec:u.login})}});
  const fio=Object.fromEntries(orgUsers(o).map(u=>[u.login,u.short||u.fio]));
  return OCD[o.id]={self:false,cps,cpm,reps,files,tasks,who:id=>fio[id]||whoName(id)||'',assigned:new Set(reps.map(r=>r.cp)).size}}
const ocMb=fs=>Math.round(fs.reduce((a,f)=>a+(f.size||0),0)/1048576*10)/10;
// Сводка — по данным вкладок (у демо — живые, у остальных — набор ocData): «Отчёты» — все несданные на сегодня, «Просрочено» — все просроченные на сегодня (пакет 2, блок 1, пункт 4)
function orgSum(o){const d=ocData(o),mo=ym(TODAY),x=o.sum||{},us=orgUsers(o);const live=d.cps.filter(c=>!c.archived),open=d.reps.filter(r=>OC_OPEN.has(r.status));
  return {staff:us.filter(u=>u.active).length,staffOff:us.filter(u=>!u.active).length,
    cps:{reg:live.filter(c=>c.kind!=='oneoff'&&c.status!=='Приостановлен').length,once:live.filter(c=>c.kind==='oneoff').length,pau:live.filter(c=>c.status==='Приостановлен').length,arch:d.cps.filter(c=>c.archived).length},
    rep:{open:open.length,month:open.filter(r=>r.due.slice(0,7)<=mo).length,later:open.filter(r=>r.due.slice(0,7)>mo).length,over:d.reps.filter(r=>r.overdue).length},
    tasks:d.self?d.tasks.length:d.tasks.length,files:{n:d.files.length,mb:ocMb(d.files)},tg:d.self?EMP.filter(e=>e.tg).length:x.tg||0,logins30:orgLogins30(o)}}
function orgLogins30(o){const ls=new Set(orgUsers(o).map(u=>u.login));const from=new Date(Date.parse(TODAY)-30*SES_DAY).toISOString().slice(0,10);return SESS.filter(s=>ls.has(s.u)&&s.at.slice(0,10)>=from).length}
function orgCard(id,tab){const o=ORGS.find(x=>x.id===id);if(!o){toast('Такой организации нет','alert',true);return}
  log('porg',id,'Открыта карточка организации');
  MODALS.filter(x=>x.o.porg).forEach(x=>x.close());
  openModal({size:'wide',porg:id,state:{tab:tab||'main'},render:m=>{const st=m.state;const sm=orgSum(o);const us=orgUsers(o);
    const tabs=[['main','Основное','landmark'],['sum','Сводка','gauge'],['staff','Сотрудники','users',us.length],['cps','Контрагенты','building'],['rep','Отчёты','file',sm.rep.over||'',sm.rep.over?1:0],['money','Деньги','coins'],['set','Настройки','sliders'],['files','Файлы','folder'],['hist','История','history']];
    const b=st.tab==='main'?ocMain(o):st.tab==='sum'?ocSum(o,sm):st.tab==='staff'?'<div id="oc-staff"></div>':st.tab==='cps'?ocCps(o):st.tab==='rep'?ocRep(o,st):st.tab==='money'?ocMoney(o):st.tab==='set'?ocSet(o):st.tab==='files'?ocFiles(o,sm):ocHist(o);
    const acts=orgActions(o,()=>m.draw());const own=OTHER_USERS.find(u=>u.login===o.owner)||(o.self?allUsers().find(u=>u.login===o.owner):null);
    // Владелец по заявке ещё не задал пароль — «Отправить новую ссылку для пароля» (tg-lead.js)
    const spa=own&&!o.self?ownerSetupAct(o,own):null;
    const sl=orgSlug(o);
    return {title:esc(o.name),sub:`ИНН <span class="mono">${esc(o.inn)}</span>${sl?` · <span class="mono">buhuchet.kg/${esc(sl)}</span>`:''} · подключена ${fmtD(o.created)}`,
      head:[...acts,own?{label:'Сбросить пароль владельцу',icon:'key',run:()=>accResetPass(own),after:1}:null,spa].filter(Boolean).map((a,i)=>`<button class="btn sm hd-btn ${a.danger?'danger':''}" data-ocact="${i}" ${a.disabled?'disabled':''} title="${esc(a.disabled&&a.reason?a.reason:a.label)}">${ic(a.icon,'sm')}<span class="bl">${esc(a.label)}</span></button>`).join(''),
      body:`<div class="ac-st">${o.active?`<span class="pill green">${ic('check')}Активна</span>`:`<span class="pill red">${ic('lock')}${o.note?esc(o.note):'Заблокирована'}</span>`}${o.self?`<span class="pill purple">${ic('star')}Демо</span>`:''}</div>${cardTabs(tabs,st.tab,'oct')}<div class="ac-b">${b}</div>`,
      foot:`<span class="hint" style="margin:0">Только просмотр: администратор не меняет контрагентов, отчёты и настройки организации</span><div class="grow"></div><button class="btn cta" data-close>Готово</button>`,
      mount(el){bindCardTabs(el,'oct',k=>{st.tab=k;m.draw();const x=el.querySelector('.mb');if(x)x.scrollTop=0});
        const all=[...acts,own?{run:()=>accResetPass(own)}:null,spa].filter(Boolean);$$('[data-ocact]',el).forEach(x=>x.onclick=()=>{const a=all[+x.dataset.ocact];if(a&&a.run)a.run()});
        $$('[data-ocgo]',el).forEach(x=>x.onclick=()=>{st.tab=x.dataset.ocgo;m.draw()});
        $$('[data-plate]',el).forEach(x=>{if(x.closest('#oc-rf'))return;const p=x.dataset.plate,t={staff:'staff',cps:'cps',rep:'rep',over:'rep',tasks:'sum',files:'files',tg:'staff',log:'staff'}[p];if(t&&t!==st.tab)x.onclick=()=>{if(t==='rep')st.rf=p==='over'?'over':'due';st.tab=t;m.draw()}});
        $$('#oc-rf [data-plate]',el).forEach(x=>x.onclick=()=>{st.rf=x.dataset.plate;m.draw()});
        const dm=$('[data-ocmo]',el);if(dm)dm.ontoggle=()=>{st.rmo=dm.open};
        $$('[data-acu]',el).forEach(x=>x.onclick=()=>accCard(x.dataset.acu));
        $$('[data-oclead]',el).forEach(x=>x.onclick=()=>{const l=LEADS.find(y=>String(y.id)===x.dataset.oclead);if(l)openLead(l)});
        ocGrids(el,o,st)}}}})}
function ocMain(o){const own=o.owner;const l=orgLead(o);
  const req=o.self?orgMainView():(()=>{const r=o.req||{};return `<div class="box"><h3>Основное</h3><div class="kv">${acKv('Название',esc(o.name))}${acKv('Полное название',esc(r.full||'—'))}${acKv('ИНН',`<span class="mono">${esc(o.inn)}</span>`)}${acKv('Форма',esc(o.form?ldFormT(o.form):'—'))}${acKv('ОКПО',r.okpo?`<span class="mono">${esc(r.okpo)}</span>`:'—')}${acKv('Адрес',esc(r.addr||'—'))}${acKv('Телефон',r.phone?esc(fmtPhone(r.phone)):'—')}${acKv('Руководитель',esc(r.head||'—'))}${acKv('Адрес страницы организации',`<span class="mono">${esc(o.slug||'—')}</span>`)}${acKv('Логотип',r.logo?'загружен':'нет')}${acKv('Банковские счета',(r.banks||[]).length?esc(r.banks.join(', ')):'—')}</div></div>`})();
  const bl=HIST.filter(h=>h.ent==='porg'&&h.id===o.id&&/блокир/i.test(h.what)).sort((a,b)=>a.at<b.at?1:-1);
  return `${req}<div class="box"><h3>На платформе</h3><div class="kv">${acKv('Владелец',own?`<button type="button" class="linkbtn mono" data-acu="${esc(own)}">${esc(own)}</button> · ${esc((orgUsers(o).find(u=>u.login===own)||{}).fio||'')}`:acDash)}${acKv('Из заявки',l?`<button type="button" class="linkbtn" data-oclead="${esc(l.id)}">${esc(l.firm||l.name)} · ${fmtDT(l.at)}</button>`:'<span class="faint">создана без заявки</span>')}${acKv('Создана',`${esc(whoName(o._cb)||'—')}<div class="aud">${fmtDT(o._ca)}</div>`)}${acKv('Состояние',o.active?'Активна':'Заблокирована'+(o.note?': '+esc(o.note):''))}</div>
    <h4 style="margin:12px 0 4px">Блокировки с причинами</h4>${bl.length?acTl(bl):'<span class="faint">Не блокировалась</span>'}</div>`}
function ocSum(o,s){const P=(id,icon,color,label,value,sub)=>plate({id,icon,color,label,value,sub});
  return `<div class="plates">${P('staff','users','blue','Сотрудники',s.staff,`активных · заблокировано ${s.staffOff}`)}${P('cps','building','green','Контрагенты',s.cps.reg+s.cps.once+s.cps.pau,`постоянных ${s.cps.reg} · разовых ${s.cps.once} · приостановлено ${s.cps.pau} · в архиве ${s.cps.arch}`)}${P('rep','file','yellow','Отчёты',s.rep.open,`в этом месяце ${s.rep.month} · позже ${s.rep.later}`)}${P('over','alert',s.rep.over?'red':'green','Просрочено',s.rep.over,'отчётов на сегодня')}${P('tasks','task','purple','Открытые задачи',s.tasks)}${P('files','folder','blue','Файлы',s.files.n,`${fmtM(s.files.mb)} МБ`)}${P('tg','tg','blue','Привязали Telegram',s.tg,'сотрудников')}${P('log','key','green','Входы за 30 дней',s.logins30)}</div>`}
function ocCps(){return '<div id="oc-cps"></div><span class="hint">Только просмотр: изменить контрагентов организации из Админки нельзя.</span>'}
// «Отчёты» (пакет 2, блок 1, пункты 2–3): плитки-фильтры, поиск и полный список всех отчётов организации; над ним свёрнутый блок «По месяцам и видам отчётов»; строка открывает окно «Отчёт» только для просмотра
const OC_RF={due:r=>OC_OPEN.has(r.status),work:r=>r.status==='В работе'||r.status==='Требует исправления',done:r=>r.status==='Сдан',over:r=>r.overdue,all:()=>true};
const OC_RFT=[['due','file','yellow','К сдаче','все несданные'],['work','clock','purple','В работе',''],['done','check','green','Сдано',''],['over','alert','red','Просрочено','на сегодня'],['all','list','blue','Все','']];
function ocRepQ(o,d,q){q=(q||'').trim().toLowerCase();if(!q)return ()=>true;return r=>{const c=d.cpm[r.cp]||{},t=T[r.t]||{};return [c.name,c.inn,t.short,t.name,r.plabel,r.status,d.who(r.resp)].some(v=>String(v||'').toLowerCase().includes(q))}}
function ocRep(o,st){const d=ocData(o);const rf=st.rf||'due';
  if(!d.reps.length){const cn=d.cps.filter(c=>!c.archived).length;return `<div class="state">${ic('file','lg')}<b>Отчётов пока нет</b><span>У организации ${cn} ${plural(cn,'контрагент','контрагента','контрагентов')}, отчёты назначены у ${d.assigned}. Отчёты появятся, когда фирма назначит их контрагентам</span></div>`}
  return `<div class="box"><details class="rc-hist" ${st.rmo?'open':''} data-ocmo><summary>По месяцам и видам отчётов · 6 прошлых месяцев, текущий и 3 следующих</summary><div id="oc-rep"></div></details></div>
    <div class="plates" id="oc-rf">${OC_RFT.map(([id,icon,color,label,sub])=>{const n=d.reps.filter(OC_RF[id]).length;return plate({id,icon,color:id==='over'&&!n?'green':color,label,value:n,sub,on:rf===id})}).join('')}</div>
    <div class="row"><input class="inp" type="search" id="oc-rq" placeholder="Поиск: контрагент, ИНН, отчёт, период" value="${esc(st.rq||'')}" aria-label="Поиск отчётов организации"></div>
    <div id="oc-rl"></div><span class="hint">Только просмотр: статусы отчётов меняет сама организация.</span>`}
const OC_REPCOLS=d=>[{key:'cp',label:'Контрагент',type:'text',w:240,val:r=>(d.cpm[r.cp]||{}).name||'',html:r=>`<span class="strong">${esc((d.cpm[r.cp]||{}).name||'')}</span>`},{key:'inn',label:'ИНН',type:'text',w:150,cls:'mono',hide:true,val:r=>(d.cpm[r.cp]||{}).inn||''},
  {key:'t',label:'Отчёт',type:'enum',w:170,val:r=>(T[r.t]||{}).short||r.t},{key:'p',label:'Период',type:'text',w:120,val:r=>r.plabel||''},{key:'m',label:'Месяц срока',type:'enum',w:150,hide:true,val:r=>fmtMon(r.due.slice(0,7)),sortVal:r=>r.due.slice(0,7)},
  {key:'due',label:'Срок',type:'date',w:120,val:r=>r.due},{key:'st',label:'Статус',type:'enum',w:170,val:r=>r.status,html:r=>`${esc(r.status)}${r.overdue?` <span class="pill sm red">${ic('alert')}просрочен</span>`:''}`},
  {key:'resp',label:'Ответственный',type:'enum',w:160,val:r=>d.who(r.resp)},{key:'sum',label:'К уплате, сом',type:'money',w:140,num:true,val:r=>r.sum==null?null:r.sum},{key:'paid',label:'Оплачено, сом',type:'money',w:140,num:true,val:r=>r.sum==null?null:Math.min(r.paid||0,r.sum)}];
// Окно «Отчёт» из карточки организации: только просмотр — без кнопок смены статуса; файлы отчёта открываются тем же окном просмотра
function ocRepWin(o,r){const d=ocData(o),c=d.cpm[r.cp]||{},t=T[r.t]||{};
  const fs=d.self?(r.files||[]).map(n=>({name:n,size:fmGet(r.cp,n).size??fsize(n),cp:r.cp})):d.files.filter(f=>(r.files||[]).includes(f.name)&&f.cp===r.cp);
  const hist=d.self?statusHistHtml('rep',r):acTl((r.hist||[]).slice().reverse().map(h=>({at:h.at,who:d.who(h.who)||h.who,what:h.what})));
  openModal({size:'wide',render:()=>({title:`${esc(t.short||r.t)} · ${esc(r.plabel||'')}`,sub:`${esc(c.name||'')} · ${esc(o.name)}`,
    body:`<div class="ac-b" style="margin:0"><div class="box"><div class="kv">${acKv('Контрагент',esc(c.name||'—'))}${acKv('ИНН',`<span class="mono">${esc(c.inn||'—')}</span>`)}${acKv('Вид отчёта',esc(t.name||r.t))}${acKv('Период',esc(r.phuman||r.plabel||'—'))}${acKv('Срок сдачи',fmtD(r.due))}${acKv('Статус',`${esc(r.status)}${r.overdue?` <span class="pill sm red">${ic('alert')}просрочен</span>`:''}`)}${acKv('Ответственный',esc(d.who(r.resp)||'—'))}${acKv('Сдан',r.subDate?fmtD(r.subDate):acDash)}</div></div>
      ${t.sum?`<div class="box"><h3>Суммы</h3><div class="kv">${acKv('К уплате',r.sum==null?acDash:som(r.sum))}${acKv('Оплачено',r.sum==null?acDash:som(Math.min(r.paid||0,r.sum)))}${acKv('Срок оплаты',fmtD(r.payDue||r.due))}</div></div>`:''}
      <div class="box"><h3>История статусов</h3>${hist||'<span class="faint">Записей пока нет</span>'}</div>
      <div class="box"><h3>Файлы отчёта · ${fs.length}</h3>${fs.length?`<div class="list">${fs.map((f,i)=>`<button type="button" class="li" data-ocrf="${i}">${ic('file')}<div class="grow"><div class="t1">${esc(f.name)}</div><div class="t2">${fmtSize(f.size||0)}</div></div></button>`).join('')}</div>`:'<span class="faint">Файлов нет</span>'}</div></div>`,
    foot:`<span class="hint" style="margin:0">Только просмотр: статус отчёта меняет сама организация</span><div class="grow"></div><button class="btn cta" data-close>Готово</button>`,
    mount(el){$$('[data-ocrf]',el).forEach(x=>x.onclick=()=>fileView(fs,+x.dataset.ocrf,{sub:()=>`${esc(t.short||r.t)} · ${esc(r.plabel||'')} · ${esc(c.name||'')}`,dl:f=>toast('Скачивание: '+f.name,'download')}))}})})}
// «Деньги»: итоги без детализации по операциям; у остальных организаций плата за обслуживание — из чисел demoDB.json (fee)
function ocMoney(o){const mo=ym(TODAY);let mc=0,mp=0,yc=0,yp=0;
  if(o.self){const y0=mo.slice(0,4)+'-01';CPS.forEach(c=>feeMonths(c).forEach(m=>{const ch=feeCharge(c,m),pd=feeGot(c,m);if(m===mo){mc+=ch;mp+=pd}if(m>=y0&&m<=mo){yc+=ch;yp+=pd}}))}
  else{const f=o.fee||{};[mc,mp]=f.m||[0,0];[yc,yp]=f.y||[0,0]}
  const box=(t,c,p)=>`<div class="box"><h3>${t}</h3><div class="kv">${acKv('Начислено',som(c))}${acKv('Оплачено',som(p))}${acKv('Долг',`<span class="${c-p>0?'red strong':''}">${som(Math.max(0,c-p))}</span>`)}</div></div>`;
  return `${box('Плата за обслуживание за '+fmtMon(mo),mc,mp)}${box('Плата за обслуживание с начала года',yc,yp)}<div class="box"><h3>Налоги контрагентов по месяцам</h3><div id="oc-tax"></div></div>`}
// Роль пользователя другой организации — по названию: сначала роли новой организации (TemDB.json), потом роли демо-организации
const ocTem=()=>(DBSRC.empty&&DBSRC.empty.db)||{};
const ocRole=nm=>(ocTem().roles||[]).find(x=>x.name===nm)||ROLES.find(x=>x.name===nm)||null;
// «Настройки»: у остальных организаций — учётная политика новой организации (TemDB.json) и роли её сотрудников
function ocSet(o){const self=o.self,d=ocData(o),tem=ocTem().organization||{};
  const pol=self?{conf:repConfOn(),wait:ORG.waitDays||3,task:ORG.taskConfirm!==false,pay:!!ORG.payFirst,tz:ORG.tz,remind:ORG.remind,wd:TGN_WD[tgnWeekDay()-1],at:tgnAt(),rep:!!ORG.overdueRepeat}
    :{conf:tem.repConfirm!==false,wait:tem.waitDays||3,task:tem.taskConfirm!==false,pay:!!tem.payFirst,tz:tem.tz,remind:tem.remind||[7,3],wd:TGN_WD[(tem.tgWeekDay>=1&&tem.tgWeekDay<=7?tem.tgWeekDay:1)-1],at:tem.digest||'09:00',rep:!!tem.overdueRepeat};
  const on=self?k=>feat(k):k=>!!(tem.features||{})[k];
  const fs=FEATURES.map(([k,l])=>`<span class="pill sm ${on(k)?'green':'faint'}">${on(k)?ic('check'):''}${esc(l)}</span>`).join(' ');
  const types=self?Object.entries(ORG.types||{}).filter(([,x])=>x.on).map(([id])=>T[id]).filter(Boolean):[...new Set(d.reps.map(r=>r.t))].map(id=>T[id]).filter(Boolean);
  const roles=self?ROLES.map(r=>({name:r.name,n:r.locked||r.id==='owner'?'все':roleN(r),emp:EMP.filter(e=>e.role===r.id).length}))
    :[...new Set(orgUsers(o).map(u=>u.role))].map(nm=>{const r=ocRole(nm);return {name:nm,n:!r?'—':r.locked||r.id==='owner'?'все':roleN(r),emp:orgUsers(o).filter(u=>u.role===nm).length}});
  return `<div class="box"><h3>Учётная политика</h3><div class="kv">${acKv('Сдача отчётов требует подтверждения',pol.conf?'да':'нет')}${acKv('Напомнить о неподтверждённой сдаче через',`${pol.wait} дн.`)}${acKv('Задачи требуют подтверждения',pol.task?'да':'нет')}${acKv('«Сдан» только после оплаты налога',pol.pay?'да':'нет')}${acKv('Часовой пояс',esc(pol.tz||'—'))}</div></div>
    <div class="box"><h3>Включённые модули и функции</h3><div class="row" style="gap:6px">${fs}</div></div>
    <div class="box"><h3>Подключённые виды отчётов · ${types.length}</h3><div class="row" style="gap:6px">${types.map(t=>`<span class="tag">${esc(t.short||t.name)}</span>`).join('')||acDash}</div></div>
    <div class="box"><h3>Роли и права · ${roles.length}</h3><div class="tbl-wrap"><table class="mini m-cards"><thead><tr><th>Роль</th><th class="num">Прав</th><th>Сотрудников</th></tr></thead><tbody>${roles.map(r=>`<tr><td>${esc(r.name)}</td><td class="num">${r.n}</td><td>${r.emp}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="box"><h3>Telegram-напоминания</h3><div class="kv">${acKv('Напоминания о сроках',pol.remind.map(x=>`за ${x} ${plural(x,'день','дня','дней')}`).join(', ')+' и в день срока')}${acKv('Сводка недели',`${pol.wd}, ${esc(pol.at)}`)}${acKv('Час напоминаний',esc(pol.at))}${acKv('Повтор о просрочке',pol.rep?'да':'нет')}</div></div>`}
function ocFiles(o,s){const lf=o.leadFiles||[];
  return `<div class="box"><h3>Объём по категориям · ${fmtM(s.files.mb)} МБ</h3><div id="oc-fk"></div></div><div class="box"><h3>Последние загрузки</h3><div id="oc-fl"></div></div>${lf.length?`<div class="box"><h3>${LEAD_SRC}</h3><div class="list">${lf.map(f=>`<div class="li" style="cursor:default">${ic('file')}<div class="grow"><div class="t1">${esc(f.name)}</div><div class="t2">${esc(ldDocT(f.kind))} · ${fmtSize(f.size)} · ${fmtDT(f.at)}</div></div></div>`).join('')}</div><span class="hint">В «Файловом менеджере» организации — с источником «${LEAD_SRC}».</span></div>`:''}`}
function ocHist(o){const hs=HIST.filter(h=>h.ent==='porg'&&h.id===o.id||(o.self&&(h.ent==='org'||h.ent==='role'))).slice();if(o._ca)hs.push({at:o._ca,who:o._cb,what:'Организация создана вместе с владельцем'});hs.sort((a,b)=>a.at<b.at?1:-1);
  return `<div class="box">${acTl(hs.slice(0,200))}</div>`}
function ocGrids(el,o,st){const us=orgUsers(o);
  acGrid(el,'#oc-staff',{id:'oc-staff',rid:u=>u.login,cols:[{key:'fio',label:'ФИО',type:'text',w:240,val:u=>u.fio,html:u=>`<span class="strong">${esc(u.fio)}</span>`},{key:'login',label:'Логин',type:'text',w:140,cls:'mono',val:u=>u.login},{key:'role',label:'Роль',type:'enum',w:190,val:u=>u.role},{key:'tg',label:'Telegram',type:'enum',w:150,val:u=>(u.ref?u.ref.tg:u.tg===null?null:u.tg||'@'+u.login)?'привязан':'не привязан'},{key:'last',label:'Последний вход',type:'text',w:150,val:u=>u.lastIn},{key:'st',label:'Состояние',type:'enum',w:220,val:u=>acStates(acUser(u.login)||{u,src:u,kind:'other'}).map(x=>x[0]).join(', ')}],rows:()=>us,title:'fio',size:50,noun:['сотрудник','сотрудника','сотрудников'],open:u=>accCard(u.login)});
  if(!['cps','rep','money','files'].includes(st.tab))return;
  const d=ocData(o),mo=ym(TODAY);
  acGrid(el,'#oc-cps',{id:'oc-cps',rid:c=>c.id,cols:[{key:'name',label:'Название',type:'text',w:250,val:c=>c.name,html:c=>`<span class="strong">${esc(c.name)}</span>`},{key:'inn',label:'ИНН',type:'text',w:150,cls:'mono',val:c=>c.inn},{key:'form',label:'Форма',type:'enum',w:100,val:c=>c.form},{key:'regime',label:'Режим',type:'enum',w:130,val:c=>c.regime},{key:'resp',label:'Ответственный',type:'enum',w:170,val:c=>d.who(c.resp)},{key:'kind',label:'Вид',type:'enum',w:120,val:c=>c.kind==='oneoff'?'Разовый':'Постоянный'},{key:'fee',label:'Стоимость, сом',type:'money',w:140,num:true,val:c=>{if(!d.self)return c.fee;const t=tariffAt(c,mo);return t?t.amount:null}},{key:'st',label:'Состояние',type:'enum',w:150,val:c=>c.archived?'В архиве':c.status||'Обслуживается'}],rows:()=>d.cps,title:'name',size:50,noun:['контрагент','контрагента','контрагентов']});
  // «По месяцам и видам отчётов» — 6 прошлых месяцев, текущий и 3 следующих (пакет 2, блок 1, пункт 3)
  const agg={};d.reps.forEach(r=>{const k=r.due.slice(0,7)+'|'+r.t;const x=agg[k]=agg[k]||{id:k,m:r.due.slice(0,7),t:r.t,n:0,done:0,over:0};x.n++;if(r.status==='Сдан')x.done++;if(r.overdue)x.over++});
  acGrid(el,'#oc-rep',{id:'oc-rep',rid:x=>x.id,defGroup:['m'],cols:[{key:'m',label:'Месяц срока',type:'text',w:160,val:x=>x.m,text:x=>fmtMon(x.m),sortVal:x=>x.m},{key:'t',label:'Вид отчёта',type:'enum',w:240,val:x=>(T[x.t]||{}).short||x.t},{key:'n',label:'Всего',type:'int',w:100,num:true,val:x=>x.n},{key:'done',label:'Сдано',type:'int',w:100,num:true,val:x=>x.done},{key:'over',label:'Просрочено',type:'int',w:120,num:true,val:x=>x.over}],rows:()=>Object.values(agg).filter(x=>x.m>=addMonths(mo,-6)&&x.m<=addMonths(mo,3)),title:'t',sort:{key:'m',dir:-1},noun:['строка','строки','строк']});
  const rl=$('#oc-rl',el);if(rl){const f=OC_RF[st.rf]||OC_RF.due;
    const g=grid(rl,{id:'oc-rl',rid:r=>r.id,cols:OC_REPCOLS(d),rows:()=>d.reps.filter(f).filter(ocRepQ(o,d,st.rq)),title:'cp',sort:{key:'due',dir:1},size:50,noun:['отчёт','отчёта','отчётов'],audit:false,search:false,open:r=>ocRepWin(o,r)});
    const q=$('#oc-rq',el);if(q)q.oninput=()=>{st.rq=q.value;g.s.page=0;g.refresh()}}
  const tx={};d.reps.filter(r=>r.sum>0&&(r.payDue||r.due)).forEach(r=>{const m=(r.payDue||r.due).slice(0,7);const x=tx[m]=tx[m]||{m,sum:0,paid:0};x.sum+=r.sum;x.paid+=Math.min(r.paid||0,r.sum)});
  acGrid(el,'#oc-tax',{id:'oc-tax',rid:x=>x.m,cols:[{key:'m',label:'Месяц уплаты',type:'text',w:170,val:x=>x.m,text:x=>fmtMon(x.m)},{key:'sum',label:'К уплате, сом',type:'money',w:160,num:true,val:x=>x.sum},{key:'paid',label:'Оплачено, сом',type:'money',w:160,num:true,val:x=>x.paid},{key:'left',label:'Не оплачено, сом',type:'money',w:170,num:true,val:x=>Math.max(0,x.sum-x.paid)}],rows:()=>Object.values(tx).filter(x=>x.m<=addMonths(mo,1)&&x.m>=addMonths(mo,-11)),title:'m',sort:{key:'m',dir:-1},noun:['месяц','месяца','месяцев']});
  const fs=d.files,fk={};fs.forEach(f=>{const x=fk[f.kind]=fk[f.kind]||{kind:f.kind,n:0,size:0};x.n++;x.size+=f.size||0});
  acGrid(el,'#oc-fk',{id:'oc-fk',rid:x=>x.kind,cols:[{key:'kind',label:'Категория',type:'enum',w:240,val:x=>(typeof FKIND_L!=='undefined'&&FKIND_L[x.kind])||x.kind},{key:'n',label:'Файлов',type:'int',w:110,num:true,val:x=>x.n},{key:'mb',label:'Объём, МБ',type:'num',w:130,num:true,val:x=>Math.round(x.size/1048576*10)/10}],rows:()=>Object.values(fk),title:'kind',sort:{key:'mb',dir:-1},noun:['категория','категории','категорий']});
  acGrid(el,'#oc-fl',{id:'oc-fl',rid:f=>f.id,cols:[{key:'name',label:'Файл',type:'text',w:300,val:f=>f.name},{key:'kind',label:'Категория',type:'enum',w:180,val:f=>f.kind},{key:'cp',label:'Контрагент',type:'text',w:220,val:f=>(d.cpm[f.cp]||{}).name||''},{key:'by',label:'Загрузил',type:'enum',w:160,val:f=>d.who(f.by)},{key:'date',label:'Дата',type:'date',w:120,val:f=>String(f.date||'').slice(0,10)},{key:'size',label:'Размер',type:'int',w:110,num:true,val:f=>f.size,text:f=>fmtSize(f.size||0)}],rows:()=>fs.slice().sort((a,b)=>String(a.date)<String(b.date)?1:-1).slice(0,30),title:'name',sort:{key:'date',dir:-1},noun:['файл','файла','файлов']})}

/* ── ссылки #accounts/<логин> и #orgs/<адрес организации> ── */
const ACARD={pend:null};
function admCardRoute(){const x=/^#(accounts|orgs)\/(.+)$/.exec(location.hash);if(!x)return false;const k=x[1],v=decodeURIComponent(x[2]);history.replaceState(history.state,'','#'+k);
  if(S.loggedIn===false||!isAdmin()){ACARD.pend=[k,v];return false}setTimeout(()=>admCardOpen(k,v),60);return false}
function admCardOpen(k,v){if(k==='accounts')return accCard(v);const o=ORGS.find(x=>orgSlug(x)===v||x.id===v);if(o)orgCard(o.id);else toast('Организация с таким адресом не найдена','alert',true)}
function admCardPendGo(){if(!ACARD.pend||S.loggedIn===false||!isAdmin())return;const p=ACARD.pend;ACARD.pend=null;setTimeout(()=>admCardOpen(...p),140)}

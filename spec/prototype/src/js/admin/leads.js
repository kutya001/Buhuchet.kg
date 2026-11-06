'use strict';
// Админка → «Организации» → «Заявки»: заявки с лендинга (ТЗ «Вкладка «Заявки»», решение заказчика 01.11.2026)
/* ═════════════ Заявки с сайта ═════════════ */
const LEADS=DB.leads;
const LDST=DB.ref.statuses.lead;
STATUS_GROUPS.push(['Статусы заявок с сайта',LDST,'lead','1 Новая → 2 В работе → 3 Подключена; «Отказ» — конечная отметка вне шкалы, ставится с причиной.']);
const leadNew=()=>LEADS.filter(x=>x.status==='Новая').length;
// Уведомление о заявке обязательно (решение заказчика 06.11.2026): сразу после сохранения — каждому активному администратору платформы с привязанным Telegram; повторная заявка за сутки — своим шаблоном; на стенде — бот стенда, пометка «🧪 Тестовый стенд» в начале
const leadAdmins=()=>[PLATFORM_ADMIN].filter(u=>u.tg&&u.active!==false);
const leadLink=()=>`https://${LAND.test?'test.':''}buhuchet.kg/admin/leads`;
const leadTgText=(o,rep)=>(LAND.test?'🧪 Тестовый стенд ':'')+((rep?TPL.tgLeadRep:TPL.tgLead)||'').replace(/\{([^}]+)\}/g,(m,k)=>({фирма:o.firm,имя:o.name,телефон:fmtPhone(o.phone),клиентов:o.size,ссылка:leadLink()})[k]??m);
function leadNotify(){leadAdmins().forEach(u=>tgSvc(u,'Заявка с сайта',{org:LAND.test?'Тестовый стенд':'Платформа'}))}
// История заявки — внутри самой заявки: «Удалить» стирает её целиком
function leadLog(o,what,who){const w=who||S.me,at=nowStamp();(o.hist=o.hist||[]).push({at,who:w,what});o._ub=w;o._ua=at}
// Смена статуса: в историю — кто, когда, с какого статуса на какой, причина или комментарий (suf — « (причина)» или «, комментарий»)
function leadSet(o,to,suf){const st=o.status;if(to==='Отказ')o.prevSt=st;else delete o.prevSt;o.status=to;leadLog(o,`Статус: ${st} → ${to}${suf||''}`)}
// Ставит и меняет статус только администратор платформы
function leadStep(o,to){if(!isAdmin())return toast('Статус заявки меняет администратор платформы','lock',true);
  if(to==='Подключена')return confirmDlg({title:'Отметить заявку «Подключена»?',text:`${esc(o.firm)}: клиент подключён. Если организацию ещё нужно создать, выберите в меню строки «Создать организацию» — статус поставится сам.`,ok:'Подключена',run:()=>{leadSet(o,to);refreshAll();toast('Заявка «Подключена»')}});
  leadSet(o,to);refreshAll();toast(`Заявка: ${to}`)}
function leadRefuse(o){openModal({form:true,render:()=>({title:'Отказ по заявке',sub:esc(`${o.firm} · ${o.name}`),body:`${fld('Причина отказа',`<textarea class="inp" id="lr-why" style="min-height:64px" placeholder="Например: нужна программа бухгалтерского учёта с проводками"></textarea>`,{req:true,full:true,id:'lr-why'})}<div class="hint">«Отказ» — конечная отметка вне шкалы. Снять её можно откатом с причиной.</div>`,
  foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn danger" id="lr-ok">Отказ</button>',mount(el,m){$('#lr-ok',el).onclick=()=>{const w=val(el,'lr-why');if(!setErr(el,'lr-why',w?'':'Укажите причину отказа'))return;leadSet(o,'Отказ',` (${w})`);m.close();refreshAll();toast('Заявка: отказ','ban')}}})})}
function leadDel(o){confirmDlg({title:'Удалить заявку?',text:'Имя и телефон будут стёрты.',ok:'Удалить',danger:true,run:()=>{const i=LEADS.indexOf(o);if(i>=0)LEADS.splice(i,1);MODALS.filter(m=>m.o.lead===o.id).forEach(m=>m.close());refreshAll();toast('Заявка удалена','trash')}})}
// «Создать организацию»: форма с названием фирмы и ФИО из заявки; после сохранения заявка сама получает «Подключена» и ссылку на организацию
const leadOrg=o=>addOrgDlg({lead:o,name:o.firm,fio:o.name});
function leadActions(o){const bk=scBack('lead',o.status,o),bkT=typeof bk==='string'?bk:null;
  return [{label:'Открыть заявку',icon:'file',run:()=>openLead(o)},
    o.status==='Новая'?{label:'В работу',icon:'hourglass',run:()=>leadStep(o,'В работе')}:null,
    !o.org?{label:'Создать организацию',icon:'building',run:()=>leadOrg(o)}:null,
    o.status==='В работе'&&!o.org?{label:'Отметить «Подключена»',icon:'check',run:()=>leadStep(o,'Подключена')}:null,
    o.status!=='Отказ'&&o.status!=='Подключена'?{label:'Отказ',icon:'ban',run:()=>leadRefuse(o)}:null,
    {sep:true},
    o.status!=='Новая'?{label:o.status==='Отказ'?'Снять «Отказ»':`Откатить в «${bkT||'—'}»`,icon:'history',disabled:!bkT,reason:bk&&bk.no?bk.no:'',run:()=>rollbackDlg('lead',o.id,bkT)}:null,
    {label:'Удалить',icon:'trash',danger:true,run:()=>leadDel(o)}].filter(Boolean)}
const leadOrgHtml=o=>o.org?`<button type="button" class="linkbtn" data-lead-org="${esc(o.org)}">${esc(orgName(o.org))}</button>`:'<span class="faint">—</span>';
function openLead(o){openModal({size:'mid',lead:o.id,render:()=>{if(!LEADS.includes(o))return {title:'Заявка удалена',body:'',foot:'<button class="btn cta" data-close>Закрыть</button>'};
  const nx=scNext('lead',o.status,o),main=o.status==='Новая'?{l:'В работу',i:'hourglass',f:()=>leadStep(o,'В работе')}:!o.org&&o.status!=='Отказ'?{l:'Создать организацию',i:'building',f:()=>leadOrg(o)}:null;
  return {title:esc(o.firm),sub:`${esc(o.name)} · заявка с сайта от ${fmtDT(o.at)}`,
  body:`<div class="box"><div class="scales">${scaleFull('lead',o.status,o.id)}</div></div>
    <div class="box"><div class="kv"><div><span class="k">Дата</span><span class="v">${fmtDT(o.at)}</span></div><div><span class="k">Имя и фамилия</span><span class="v strong">${esc(o.name)}</span></div><div><span class="k">Название фирмы</span><span class="v">${esc(o.firm)}</span></div>
      <div><span class="k">Телефон</span><span class="v">${phoneHtml(o.phone)}</span></div><div><span class="k">Сколько клиентов ведёт</span><span class="v">${esc(o.size||'—')}</span></div><div><span class="k">Telegram</span><span class="v">${o.tg?esc(o.tg):'<span class="faint">—</span>'}</span></div>
      <div><span class="k">Комментарий</span><span class="v" style="white-space:pre-wrap">${o.note?esc(o.note):'<span class="faint">—</span>'}</span></div><div><span class="k">Организация</span><span class="v">${leadOrgHtml(o)}</span></div></div></div>
    <div class="box">${fld('Заметка администратора',`<textarea class="inp" id="ld-note" style="min-height:64px" placeholder="Например: позвонили, показ программы в понедельник">${esc(o.adminNote||'')}</textarea>`,{id:'ld-note',full:true,hint:'Видит только администратор платформы'})}<div class="row"><div class="grow"></div><button class="btn sm" id="ld-note-ok">Сохранить заметку</button></div></div>
    <div class="box"><h3>История статусов</h3>${statusHistHtml('lead',o)}</div>
    <div class="box"><h3>История</h3><ul class="tl">${o.hist.slice().reverse().map(h=>`<li><span class="t">${fmtD(h.at.slice(0,10))}<br>${h.at.slice(11)}</span><span>${esc(h.what)}<br><span class="w">${esc(whoName(h.who))}</span></span></li>`).join('')}</ul></div>`,
  foot:`<button class="btn" id="ld-more">${ic('more','sm')}Ещё действия</button><div class="grow"></div>${main?`<button class="btn cta" id="ld-main">${ic(main.i,'sm')}${main.l}</button>`:''}`,
  mount(el,m){$('#ld-more',el).onclick=e=>menu(e.currentTarget,leadActions(o).filter(x=>x.label!=='Открыть заявку'));if(main)$('#ld-main',el).onclick=main.f;
    $('#ld-note-ok',el).onclick=()=>{const v=$('#ld-note',el).value.trim();if(v===(o.adminNote||''))return toast('Изменений нет');o.adminNote=v;leadLog(o,'Заметка администратора изменена');m.draw();renderPage();toast('Заметка сохранена')}}}}})}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-lead-org]');if(!b)return;e.preventDefault();e.stopPropagation();MODALS.slice().forEach(m=>m.close());go('orgs','list')},true);
// Столбцы — от новых к старым; на вкладке — счётчик новых заявок
function renderLeads(body,fresh){
  body.innerHTML=`${leadAdmins().length?'':`<div class="note warn" id="ld-notg">${ic('alert')}<span>О новых заявках некому сообщить: привяжите Telegram в «Мой профиль».</span><button class="btn sm" id="ld-pf">${ic('user','sm')}Мой профиль</button></div>`}<div class="note">${ic('info')}<span>Заявки с лендинга buhuchet.kg. О каждой новой и повторной заявке бот сразу пишет администраторам платформы с привязанным Telegram. Статус ставит и меняет только администратор платформы; «Создать организацию» в меню строки сам ставит «Подключена».</span></div><div id="ldg"></div>`;
  grid($('#ldg',body),{id:'adm-leads',rid:x=>x.id,cols:[{key:'at',label:'Дата',type:'text',w:130,val:x=>x.at,html:x=>`<span class="tnum">${fmtDT(x.at)}</span>`},{key:'name',label:'Имя',type:'text',w:190,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>`},{key:'firm',label:'Фирма',type:'text',w:220,val:x=>x.firm},
    {key:'phone',label:'Телефон',type:'text',w:170,val:x=>fmtPhone(x.phone),html:x=>phoneHtml(x.phone)},{key:'size',label:'Клиентов',type:'enum',w:110,val:x=>x.size||''},{key:'tg',label:'Telegram',type:'text',w:130,val:x=>x.tg||''},{key:'note',label:'Комментарий',type:'text',w:240,val:x=>x.note||''},
    {key:'status',label:'Статус',type:'enum',w:170,val:x=>x.status,html:x=>scaleMini('lead',x.status,x)},{key:'org',label:'Организация',type:'text',w:200,val:x=>x.org?orgName(x.org):'',html:leadOrgHtml}],
    rows:()=>LEADS,title:'name',noun:['заявка','заявки','заявок'],sort:{key:'at',dir:-1},simulateLoad:fresh,rowClass:x=>x.status==='Отказ'?'muted':'',open:openLead,actions:leadActions});
  const pf=$('#ld-pf',body);if(pf)pf.onclick=profileDlg;
}

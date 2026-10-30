'use strict';
// Организация, роли, сотрудники, контрагенты, отчёты, тарифы
/* ═════════════ Organization, people, roles ═════════════ */
// Права ролей — справочник платформы «Права ролей» (refDB.permissions): набор задаёт система, названия и описания ведёт администратор платформы
const PERM_REF=DB.ref.permissions;
const PERMS=[];
// Группы прав — в порядке меню модулей, последней «Общие права»; feature — функция учётной политики, без которой модуль выключен
// view — право «Просматривать …»: без него модуль не виден, остальные права группы не действуют; scope — у группы есть область «Свои контрагенты / Все контрагенты»
const PERM_GROUPS=[['cps','Контрагенты',null,'cpView',1],['reports','Отчеты для сдачи',null,'repView',1],['fin','Финансовые операции по контрагентам','finops','finView',1],['projects','Проекты контрагентов','projects','projView',1],['kpi','Показатели контрагентов','indicators','kpiView',1],['tasks','Задачи','tasks'],['files','Файловый менеджер','files','filesView',1],['staff','Сотрудники',null,'staffView'],['dicts','Справочники'],['kb','База знаний'],['org','Моя организация'],['common','Общие права']].map(([id,name,feature,view,scope])=>({id,name,feature,view,scope:!!scope,perms:[]}));
const PERM_VIEW=Object.fromEntries(PERM_GROUPS.filter(g=>g.view).map(g=>[g.id,g.view]));
const SCOPE_GROUPS=PERM_GROUPS.filter(g=>g.scope).map(g=>g.id);
const permGroup=p=>{const x=PERM_REF.find(y=>y.id===p);return x?x.group:''};
permsBuild();
function permsBuild(){PERMS.splice(0,PERMS.length,...PERM_REF.map(p=>[p.id,p.name,p.desc,p.group]));PERM_GROUPS.forEach(g=>g.perms=PERMS.filter(p=>p[3]===g.id))}
// Кто может менять галочку права в роли: владелец — всё, кроме прав, которые есть только у владельца; остальные (с правом «Сотрудники и роли») — не свою роль и не права, которые выдаёт только владелец
const OWNER_ONLY=['org'],OWNER_GRANTS=['rollback','archiveRest','staff'];
function roleLock(r,p,sel){if(r.locked)return 'Права владельца не меняются';const v=PERM_VIEW[permGroup(p)];if(sel&&v&&v!==p&&!sel.has(v))return 'Сначала дайте просмотр';if(OWNER_ONLY.includes(p))return 'Это право есть только у владельца организации';if(me().role==='owner')return '';if(myRole()&&myRole().id===r.id)return 'Права своей роли меняет владелец';if(OWNER_GRANTS.includes(p))return 'Это право выдаёт только владелец';if(!(myRole()||{perms:[]}).perms.includes(p))return 'Этого права нет у вашей роли';return ''}
// Сотрудник с правом «Сотрудники и роли», не владелец (ТЗ «Сотрудники → Роли», решение заказчика 27.10.2026): свою роль, роли с правами «выдаёт только владелец» и роли шире своей
// не меняет, не назначает и не снимает; себе и сотрудникам с такими ролями не меняет роль, не сбрасывает пароль, не блокирует и не разблокирует; недоступные кнопки скрыты
// «Шире своей» — по действующим правам и области, как в продукте (roleWithinRights): право группы без её «Просматривать …» и «Все контрагенты» без просмотра группы не считаются
const roleEff=r=>r.perms.filter(p=>{const v=PERM_VIEW[permGroup(p)];return !v||v===p||r.perms.includes(v)});
const roleAllIn=(r,g,eff)=>eff.includes(PERM_VIEW[g])&&(eff.includes('viewAll')||roleScope(r)[g]==='all');
const roleWider=(r,m)=>{if(!m||r.locked)return true;const er=roleEff(r),em=roleEff(m);return er.some(p=>!em.includes(p))||SCOPE_GROUPS.some(g=>roleAllIn(r,g,er)&&!roleAllIn(m,g,em))};
function roleEditOff(r){if(r.locked||r.id==='owner')return 'Права владельца не меняются';if(me().role==='owner')return '';const m=myRole();if(m&&m.id===r.id)return 'Права своей роли меняет владелец';if(r.perms.some(p=>OWNER_GRANTS.includes(p)))return 'Роль с правами, которые выдаёт только владелец, меняет владелец';return ''}
function roleAssignOff(r){const w=roleEditOff(r);if(w||me().role==='owner')return w;return roleWider(r,myRole())?'Роль с правами шире ваших меняет владелец':''}
const rolesAssignable=()=>ROLES.filter(r=>r.id!=='owner'&&!roleAssignOff(r));
// Сменить роль, сбросить пароль, заблокировать: владельца — никто; себя и сотрудников с ролями, которые нельзя назначить, — только владелец
const empLocked=e=>e.role==='owner'||me().role!=='owner'&&(e.id===S.me||!!roleAssignOff(ROLES.find(r=>r.id===e.role)||{perms:[]}));
// Переключатель «Все контрагенты» у группы: не владельцу — только если у его роли в этой группе «Все контрагенты»
const roleScopeOff=g=>me().role==='owner'||seeAll(g)?'':'«Все контрагенты» нет у вашей роли';
// «Изменить» (ФИО и телефон) — у любого сотрудника; данные владельца меняет только он сам
const empEditOff=e=>!can('staff')||e.role==='owner'&&e.id!==S.me;
const ROLES=DB.roles;
/* Шаблоны ролей платформы: новая организация получает их копии и дальше меняет у себя */
const ROLE_TPL=DB.ref.roleTemplates;
const ORG=DB.organization;
const FEATURES=[
 ['tasks','Задачи','Модуль задач и регулярные задачи по отчётам'],
 ['calendar','Календарь отчётов','Вкладка «Календарь» в модуле отчётов'],
 ['fee','Плата за обслуживание','Журнал тарифов, начисления, должники'],
 ['taxpay','Учёт оплаты налогов','Деньги от контрагента и оплата в бюджет'],
 ['accounts','Виртуальные счета и бонусы','Счета сотрудников и списание остатка в бонус',['taxpay']],
 ['telegram','Напоминания в Telegram','Напоминания о сроках, просрочках и еженедельная сводка'],
 ['files','Файлы в карточках','Прикрепление отчётов, квитанций и документов'],
 ['finops','Финансовые операции по контрагентам','Модуль «Финансовые операции» и вкладка «Финансы» в карточке контрагента'],
 ['projects','Проекты контрагентов','Модуль «Проекты», вкладка «Проекты» в карточке и проекты в задачах'],
 ['indicators','Показатели контрагентов','Модуль «Показатели контрагентов» и вкладка «Показатели» в карточке контрагента'],
 ['cppage','Страница контрагента по ссылке','Контрагент по ссылке и коду из 6 цифр смотрит свои отчёты, показатели и оплату за обслуживание']];
const EMP=DB.employees;
const EM=Object.fromEntries(EMP.map(e=>[e.id,e]));
const PLATFORM_ADMIN={id:'admin',fio:'Администратор платформы',short:'Админ',login:'admin',role:'platform',tg:'@buhuchet_admin'};
const empName=id=>id&&EM[id]?EM[id].short:'';
const initials=fio=>fio.split(' ').slice(0,2).map(w=>w[0]).join('');

/* ═════════════ Counterparties & reports ═════════════ */
const CPS=DB.contractors,REPORTS=DB.reports,OPS=DB.moneyOps,HIST=DB.history,TASKS=DB.tasks,FEEPAYS=DB.feePayments,SERVICES=DB.services,PROJECTS=DB.projects,FILES=DB.files;
const nextNum=(a,p='')=>a.reduce((m,x)=>Math.max(m,+String(x.id).slice(p.length)||0),0)+1;
let CPID=nextNum(CPS),RID=nextNum(REPORTS),OPID=nextNum(OPS),TID=nextNum(TASKS,'t');
const CPM={};CPS.forEach(c=>CPM[c.id]=c);


function makeReport(cp,t,p,resp){
  const {base,due}=dueOf(t,p);
  const a=cp.assign&&cp.assign.find(a=>a.t===t.id&&!a.to);const fx=a&&a.fixed!=null&&t.sum?a.fixed:null;
  return {auto:fx!=null,id:RID++,cp:cp.id,t:t.id,p,pkey:pstart(t,p),plabel:plabel(t,p),phuman:phuman(t,p),ver:0,dueBase:base,due,status:'К сдаче',subDate:null,sum:fx,paid:0,resp,files:[],superseded:false,_cb:'system',_ca:nowStamp(),_ub:'system',_ua:nowStamp()};
}

function schedule(r){
  const t=tR(r);if(!t.sum)return [];
  const sum=r.sum||0;let dates;
  if(Array.isArray(t.inst)&&t.inst.length)dates=t.inst;
  let parts;
  if(dates){const y=r.p.y;const n=dates.length;const each=Math.floor(sum/n/10)*10;parts=dates.map(([m,d],i)=>({due:shiftWork(mkDate(y,m,d)),amount:i<n-1?each:sum-each*(n-1)}))}
  else parts=[{due:t.pay?payDueOf(tFor(r),r.p,r.due):r.due,amount:sum}];
  let left=r.paid;parts.forEach(x=>{x.paid=Math.min(left,x.amount);left-=x.paid});
  return parts;
}

/* Fees: tariff journal → monthly charges */
function tariffAt(c,m){let t=null;c.tariffs.slice().sort((a,b)=>a.from<b.from?-1:1).forEach(x=>{if(x.from<=m)t=x});return t}
const curTariff=c=>tariffAt(c,ym(TODAY));
const inService=(c,m)=>(c.periods||[]).some(p=>p.from<=m&&(!p.to||m<=p.to));
const lastPeriod=c=>c.periods[c.periods.length-1];
// Срок оплаты за месяц — «день оплаты» этого месяца; если он раньше начала обслуживания или дня, когда контрагента завели, — тот же день следующего месяца
function feeDue(c,m){let d=mkDate(+m.slice(0,4),+m.slice(5,7),c.feeDay);const s=c.start||'',cr=(c._ca||'').slice(0,10);if(d<s||d<=cr){const n=addMonths(m,1);d=mkDate(+n.slice(0,4),+n.slice(5,7),c.feeDay)}return d}
// Разовый контрагент вне архива — «Обслуживается»: его отчёты, назначенные вручную, видны в «Просрочено» и «На неделе» (ТЗ; решение заказчика 30.10.2026, продукт п. В-14)
const cpStatus=c=>c.archived?'В архиве':c.kind==='oneoff'||inService(c,ym(TODAY))?'Обслуживается':'Приостановлен';
// Отчёт за период нужен, если контрагент обслуживался хотя бы один месяц периода: квартальный и годовой — тоже (ТЗ; решение заказчика 30.10.2026, продукт п. В-11)
function pInService(c,t,p){const e=ym(pend(t,p));for(let m=ym(pstart(t,p));m<=e;m=addMonths(m,1))if(inService(c,m))return true;return false}
const repInService=(c,r)=>c.kind==='oneoff'||pInService(c,tFor(r),r.p);
const pTxt=m=>m.slice(5)+'.'+m.slice(0,4);
const periodsText=c=>(c.periods||[]).map(p=>`${pTxt(p.from)}–${p.to?pTxt(p.to):'…'}`).join(', ');
const fileName=(t,r)=>`квитанция_${t.short.replace(/[\s.\/]+/g,'')}_${r.plabel.replace(/[\s.]+/g,'-')}.pdf`;
// Месяцы платы за обслуживание: с более позднего из месяца начала обслуживания и месяца, когда контрагента завели в программе, по идущий месяц;
// долг прошлых лет остаётся (решение заказчика 27.10.2026, продукт п. В-5)
function feeMonths(c){if(c.kind==='oneoff')return [];const out=[];let m=maxIso(c.start.slice(0,7),(c._ca||'').slice(0,7));const end=ym(TODAY);while(m<=end){if(inService(c,m))out.push(m);m=addMonths(m,1)}return out}
function feeCharge(c,m){const t=tariffAt(c,m);if(!t)return 0;if(t.per==='Y')return m.slice(5)===t.from.slice(5)?t.amount:0;
  if(m===c.start.slice(0,7)&&c.start.slice(8)!=='01'){if(c.first==='next')return 0;if(c.first==='prorate'){const days=+lastDay(m).slice(8);const left=days-(+c.start.slice(8))+1;return Math.round(t.amount*left/days)}}
  return t.amount}


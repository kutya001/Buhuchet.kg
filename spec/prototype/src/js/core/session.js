'use strict';
// Сессия, права (can), функции учётной политики (feat)
/* ═════════════ Session, rights, features ═════════════ */
const S={me:'e1',search:'',navHidden:store.get('nav',false),open:new Set(store.get('tree',[])),taskView:'day',cal:null,calSel:null,preset:null,loggedIn:true};
const me=()=>S.me==='admin'?PLATFORM_ADMIN:EM[S.me];
const isAdmin=()=>S.me==='admin';
const myRole=()=>ROLES.find(r=>r.id===me().role);
// Право действует, только если в роли есть и «Просматривать …» своей группы (ТЗ «Сотрудники» → «Роли»)
function can(p){if(isAdmin())return false;const u=me();if(u.role==='owner')return true;const r=myRole();if(!r||!r.perms.includes(p))return false;const v=PERM_VIEW[permGroup(p)];return !v||v===p||r.perms.includes(v)}
// Область группы прав: «Свои контрагенты» (где сотрудник ответственный) или «Все контрагенты»; право «Видеть все отчёты и всех контрагентов» даёт «Все» во всех группах
const roleScope=r=>Object.fromEntries(SCOPE_GROUPS.map(g=>[g,(r&&r.scope&&r.scope[g])||'own']));
function seeAll(g){if(isAdmin())return false;if(me().role==='owner'||can('viewAll'))return true;return roleScope(myRole())[g||'cps']==='all'}
const feat=f=>!!ORG.features[f];
const visCps=(all,g)=>{const a=seeAll(g||'cps');return CPS.filter(c=>(all||!c.archived)&&(a||c.resp===S.me))};
const visReports=()=>{const a=seeAll('reports');return REPORTS.filter(r=>!r.superseded&&(a||r.resp===S.me))};
function born(o,who){o._cb=o._ub=who||S.me;o._ca=o._ua=nowStamp();return o}
function touch(o){if(o){o._ub=S.me;o._ua=nowStamp()}return o}
// ext — дополнительные поля записи истории, например sub — оплата внутри проекта или услуги
function log(ent,id,what,cp,ext){HIST.push(Object.assign({at:nowStamp(),who:S.me,ent,id,cp,what},ext));ckSoon();
  touch(ent==='r'?REPORTS.find(r=>r.id===id):ent==='cp'?CPM[id]:ent==='t'?TASKS.find(t=>t.id===id):ent==='emp'?EM[id]:ent==='org'?ORG.types&&ORG.types[id]:ent==='role'?ROLES.find(r=>r.id===id):ent==='p'?PROJECTS.find(p=>p.id===id):ent==='s'?SERVICES.find(s=>s.id===id):null)}
const whoName=id=>!id?'':id==='admin'?'Администратор платформы':id==='system'?'Система':id==='client'?'Контрагент (по ссылке)':empName(id)||id;
function auditKv(o){return `<div><span class="k">Создал</span><span class="v">${esc(whoName(o._cb)||'—')}<div class="aud">${fmtDT(o._ca)}</div></span></div><div><span class="k">Изменил</span><span class="v">${esc(whoName(o._ub||o._cb)||'—')}<div class="aud">${fmtDT(o._ua||o._ca)}</div></span></div>`}
const BNAV={business:['home','cps','reports','tasks'],admin:['accounts','orgs','pdicts','tg']};


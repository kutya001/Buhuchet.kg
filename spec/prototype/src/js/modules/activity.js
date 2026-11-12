'use strict';
// Аналитика активности (v84): сотрудники организации — Главная → «Активность» (право «Смотреть аналитику по сотрудникам»);
// организации платформы — Админка → Организации → «Активность». Период: день, неделя, месяц, год, с листанием назад.
/* В продукте входы и выходы берутся из журнала сеансов, действия — из истории изменений.
   В макете у демо-данных к ним добавлена условная ежедневная активность: она считается по сотруднику (организации) и дате, поэтому не хранится и не меняется между открытиями.
   Сданные отчёты, контрагенты, задачи — всегда из настоящих данных организации. */
const ACT_K=[['d','День'],['w','Неделя'],['m','Месяц'],['y','Год']];
const actDemo=()=>(DB.meta||{}).mode!=='empty';
function actHash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
const actP2=n=>String(n).padStart(2,'0'),actMin=t=>+t.slice(0,2)*60+ +t.slice(3,5);
function actRange(p){const t=TODAY;
  if(p.k==='d'){const d=addDays(t,p.off);return {from:d,to:d,label:`${fmtD(d)}, ${DOW[D(d).getUTCDay()]}`}}
  if(p.k==='w'){const wd=(D(t).getUTCDay()+6)%7,mon=addDays(t,-wd+7*p.off);return {from:mon,to:addDays(mon,6),label:`${fmtD(mon).slice(0,5)} – ${fmtD(addDays(mon,6))}`}}
  if(p.k==='m'){const k=addMonths(ym(t),p.off);return {from:k+'-01',to:addDays(addMonths(k,1)+'-01',-1),label:ymLabel(k)}}
  const y=+t.slice(0,4)+p.off;return {from:y+'-01-01',to:y+'-12-31',label:y+' год'}}
const actIn=(d,rg)=>!!d&&d.slice(0,10)>=rg.from&&d.slice(0,10)<=rg.to;
function actDays(rg){const out=[];for(let d=rg.from;d<=rg.to&&d<=TODAY;d=addDays(d,1))out.push(d);return out}
// условная активность сотрудника демо-организации за день
function actBaseEmp(e,d){if(!actDemo()||d>TODAY||(e._ca&&d<e._ca.slice(0,10))||(!e.active&&d>String(e._ua||'').slice(0,10)))return null;
  const r=mulberry(actHash('e|'+e.id+'|'+d)),wd=D(d).getUTCDay(),off=wd===0||wd===6;if(r()>(wd===0?.04:wd===6?.16:e.role==='owner'?.8:.93))return null;
  let n=Math.round((off?6:14)+r()*(off?14:46)),inn=1+(r()<.35?1:0)+(r()<.08?1:0),out=inn-(r()<.3?1:0);
  const first=actP2(8+Math.floor(r()*2))+':'+actP2(Math.floor(r()*60));let last=actP2(16+Math.floor(r()*3))+':'+actP2(Math.floor(r()*60));
  if(d===TODAY){const now=bishkekNow().hm;if(now<first)return null;if(last>now){n=Math.max(1,Math.round(n*Math.max(.1,(actMin(now)-actMin(first))/(actMin(last)-actMin(first)))));last=now;out=Math.max(0,inn-1)}}
  return {n,in:inn,out,first,last}}
// условная активность другой организации платформы за день (у своей организации — сумма по сотрудникам)
function actBaseOrg(o,d){if(!actDemo()||d>TODAY||d<(o.created||'')||(!o.active&&d>String(o._ua||'').slice(0,10)))return null;
  const r=mulberry(actHash('o|'+o.id+'|'+d)),wd=D(d).getUTCDay(),off=wd===0||wd===6,st=o.employees||1;if(r()>(wd===0?.05:wd===6?.3:.97))return null;
  const u=off?1+Math.floor(r()*Math.min(2,st)):Math.max(1,Math.round(st*(.55+r()*.45)));const n=Math.round(u*(14+r()*40)),inn=u+Math.floor(r()*u*.6);
  const dom=+d.slice(8),peak=(dom>=15&&dom<=20)||dom>=25?1:.25,sub=off?0:Math.round((o.contractors||0)*(.02+r()*.05)*peak),cps=r()<.05?1:0;
  let last=actP2(16+Math.floor(r()*3))+':'+actP2(Math.floor(r()*60));if(d===TODAY){const now=bishkekNow().hm;if(now<'08:30')return null;if(last>now)last=now}
  return {u,n,in:inn,sub,cps,last}}
// индекс живых данных за период: действия из истории и входы/выходы из журнала сеансов
function actIdx(rg){const h={},hl={},si={},so={};
  HIST.forEach(x=>{if(!actIn(x.at,rg))return;const k=x.who+'|'+x.at.slice(0,10);h[k]=(h[k]||0)+1;const t=x.at.slice(11,16);if(t&&(!hl[k]||t>hl[k]))hl[k]=t});
  (typeof SESS!=='undefined'?SESS:DB.sessions||[]).forEach(s=>{if(actIn(s.at,rg)){const k=s.u+'|'+s.at.slice(0,10);si[k]=(si[k]||0)+1}if(s.how==='Выход'&&actIn(s.end,rg)){const k=s.u+'|'+s.end.slice(0,10);so[k]=(so[k]||0)+1}});
  return {h,hl,si,so}}
function actEmpDay(e,d,ix){const b=actBaseEmp(e,d),k=e.id+'|'+d,ks=e.login+'|'+d;const n=(b?b.n:0)+(ix.h[k]||0),inn=(b?b.in:0)+(ix.si[ks]||0),out=(b?b.out:0)+(ix.so[ks]||0);
  if(!n&&!inn&&!out)return null;const last=[b&&b.last,ix.hl[k]].filter(Boolean).sort().pop()||'';return {d,n,in:inn,out,first:b?b.first:'',last}}
// сводка сотрудника за период
function actEmp(e,rg,ix){ix=ix||actIdx(rg);const days=actDays(rg).map(d=>actEmpDay(e,d,ix)).filter(Boolean);const sum=k=>days.reduce((a,x)=>a+x[k],0),ld=days[days.length-1];
  const sub=REPORTS.filter(r=>actIn(r.subDate,rg)&&(r.subBy||r.resp)===e.id&&!tR(r).payOnly);
  return {e,id:e.id,days,n:sum('n'),in:sum('in'),out:sum('out'),last:ld?ld.d+(ld.last?' '+ld.last:''):null,
    sub:sub.length,late:sub.filter(r=>r.subDate>r.due).length,
    due:REPORTS.filter(r=>r.resp===e.id&&!r.superseded&&r.status!=='Не требуется'&&!tR(r).payOnly&&actIn(r.due,rg)).length,
    over:REPORTS.filter(r=>r.resp===e.id&&r.overdue).length,cps:CPS.filter(c=>c.resp===e.id&&!c.archived).length,
    tasks:TASKS.filter(t=>t.exec===e.id&&actIn(t.doneAt,rg)).length}}
// столбики «по дням» (за год — по месяцам)
function actBuckets(rg,p,val){const ds=actDays(rg);
  if(p.k==='y'){const m=MONTHS.map((x,i)=>({l:x.slice(0,3),t:x,v:0}));ds.forEach(d=>{m[+d.slice(5,7)-1].v+=val(d)});return m}
  const all=[];for(let d=rg.from;d<=rg.to;d=addDays(d,1))all.push(d);
  return all.map((d,i)=>({l:p.k==='w'?['пн','вт','ср','чт','пт','сб','вс'][i]:all.length<=14||i%5===0||i===all.length-1?String(+d.slice(8)):'',t:fmtD(d),v:d<=TODAY?val(d):0}))}
function actChart(b,unit){const mx=Math.max(1,...b.map(x=>x.v));
  return `<div class="act-ch" role="img" aria-label="${esc(unit)} по ${b.length===12?'месяцам':'дням'}">${b.map(x=>`<div class="act-b" title="${esc(x.t)}: ${fmtM(x.v,false)}"><div class="w"><i style="height:${x.v?Math.max(2,Math.round(x.v/mx*100)):0}%"></i></div><span>${esc(x.l)}</span></div>`).join('')}</div>`}
function actBar(p,rg,note){return `<div class="row act-bar"><div class="seg" role="group" aria-label="Период">${ACT_K.map(([k,l])=>`<button data-ak="${k}" class="${p.k===k?'on':''}">${l}</button>`).join('')}</div><div class="act-nav"><button class="icon-btn sm raised" data-ao="-1" title="Раньше" aria-label="Предыдущий период">${ic('left','sm')}</button><b>${esc(rg.label)}</b><button class="icon-btn sm raised" data-ao="1" ${p.off>=0?'disabled':''} title="Позже" aria-label="Следующий период">${ic('right','sm')}</button></div>${p.off?`<button class="linkbtn" data-ao="0">К текущему</button>`:''}<div class="grow"></div><span class="muted act-note">${note}</span></div>`}
function actBind(body,p,redraw){body.onclick=e=>{let b;if(b=e.target.closest('[data-ak]')){p.k=b.dataset.ak;p.off=0;redraw();return}if(b=e.target.closest('[data-ao]')){const v=+b.dataset.ao;p.off=v?Math.min(0,p.off+v):0;redraw()}}}
const actLastHtml=v=>v?fmtDT(v):'<span class="faint">не было</span>';
const actNum=(key,label,w,get,extra)=>Object.assign({key,label,type:'int',w:w||110,num:true,val:get,html:r=>get(r)?String(get(r)):'<span class="faint">0</span>'},extra||{});

/* ── Главная → «Активность»: сотрудники ── */
function renderHomeAct(body){
  const p=S.act=S.act||{k:'m',off:0},rg=actRange(p),ix=actIdx(rg);
  const rows=EMP.map(e=>actEmp(e,rg,ix)).filter(x=>x.e.active||x.days.length||x.sub);
  const sum=k=>rows.reduce((a,x)=>a+x[k],0),act=rows.filter(x=>x.days.length).length,staff=rows.length;
  const byDay={};rows.forEach(x=>x.days.forEach(d=>{byDay[d.d]=(byDay[d.d]||0)+d.n}));
  body.innerHTML=`${actBar(p,rg,'Входы, выходы и действия сотрудников; отчёты и задачи — по данным организации')}
  <div class="plates">${plate({id:'a1',icon:'users',color:act?'green':'yellow',label:'Работали в программе',value:act,unit:' из '+staff,sub:'сотрудников с активностью'})}${plate({id:'a2',icon:'key',color:'blue',label:'Входов',value:fmtM(sum('in'),false),sub:`выходов: ${fmtM(sum('out'),false)}`})}${plate({id:'a3',icon:'chart',color:'purple',label:'Действий',value:fmtM(sum('n'),false),sub:'создание, правки, смена статусов'})}${plate({id:'a4',icon:'send',color:'green',label:'Отчётов сдано',value:sum('sub'),sub:sum('late')?`позже срока: ${sum('late')}`:'все в срок'})}${feat('tasks')?plate({id:'a5',icon:'task',color:'purple',label:'Задач выполнено',value:sum('tasks')}):''}</div>
  ${p.k==='d'?'':`<div class="box"><h3>Действия ${p.k==='y'?'по месяцам':'по дням'}</h3>${actChart(actBuckets(rg,p,d=>byDay[d]||0),'Действия')}</div>`}<div id="act-g"></div>`;
  actBind(body,p,()=>renderHomeAct(body));
  grid($('#act-g',body),{id:'home-act',audit:false,rid:r=>r.id,rows:()=>rows,title:'fio',noun:['сотрудник','сотрудника','сотрудников'],rowClass:r=>r.e.active?'':'muted',sort:{key:'n',dir:-1},open:r=>actEmpDlg(r.e,p),
    actions:r=>[{label:'Активность по дням',icon:'chart',run:()=>actEmpDlg(r.e,p)},...(can('staffView')?[{label:'Карточка сотрудника',icon:'user',run:()=>typeof openEmp==='function'&&openEmp(r.e)}]:[])],
    cols:[{key:'fio',label:'Сотрудник',type:'text',w:220,val:r=>r.e.fio,html:r=>`<span class="strong">${esc(r.e.fio)}</span>${r.e.active?'':' <span class="pill sm">заблокирован</span>'}`},
      {key:'role',label:'Роль',type:'enum',w:170,val:r=>(ROLES.find(x=>x.id===r.e.role)||{}).name||''},
      {key:'last',label:'Последняя активность',type:'datetime',w:170,val:r=>r.last,html:r=>actLastHtml(r.last)},
      actNum('in','Входов',90,r=>r.in),actNum('out','Выходов',96,r=>r.out),actNum('days','Дней с активностью',150,r=>r.days.length),actNum('n','Действий',100,r=>r.n),
      actNum('sub','Отчётов сдано',126,r=>r.sub),actNum('late','Сдано позже срока',150,r=>r.late,{hide:true}),actNum('due','Отчётов со сроком в периоде',200,r=>r.due),
      actNum('over','Просрочено сейчас',146,r=>r.over,{html:r=>r.over?`<span class="pill red sm">${ic('alert')}${r.over}</span>`:'<span class="faint">0</span>'}),
      actNum('cps','Контрагентов в ответственности',210,r=>r.cps),...(feat('tasks')?[actNum('tasks','Задач выполнено',136,r=>r.tasks)]:[])],
    empty:{icon:'users',title:'Сотрудников нет'}})}
// окно сотрудника: по дням и по контрагентам за выбранный период
function actEmpDlg(e,p0){const p={k:p0.k,off:p0.off};
  openModal({size:'wide',state:{tab:'days'},render:m=>{const rg=actRange(p),a=actEmp(e,rg),tab=m.state.tab;
    const cps=CPS.filter(c=>c.resp===e.id&&!c.archived);
    return {title:esc(e.fio),sub:`Активность · ${esc(rg.label)}`,
      body:`${actBar(p,rg,'')}<div class="plates">${plate({id:'d1',icon:'clock',color:a.last?'green':'yellow',label:'Последняя активность',value:a.last?fmtD(a.last.slice(0,10)):'—',sub:a.last?a.last.slice(11):'в этом периоде не было'})}${plate({id:'d2',icon:'key',color:'blue',label:'Входов',value:a.in,sub:`выходов: ${a.out}`})}${plate({id:'d3',icon:'chart',color:'purple',label:'Действий',value:fmtM(a.n,false),sub:`дней с активностью: ${a.days.length}`})}${plate({id:'d4',icon:'send',color:'green',label:'Отчётов сдано',value:a.sub,sub:`со сроком в периоде: ${a.due}`})}${plate({id:'d5',icon:'building',color:'blue',label:'Контрагентов',value:a.cps,sub:a.over?`просрочено отчётов: ${a.over}`:'просрочек нет'})}</div>
      ${cardTabs([['days','По дням','calendar',a.days.length],['cps','По контрагентам','building',cps.length]],tab,'at')}<div id="ad-g"></div>`,
      foot:'<button class="btn" data-close>Закрыть</button>',
      mount(el){actBind($('.mb',el)||el,p,()=>m.draw());bindCardTabs(el,'at',t=>{m.state.tab=t;m.draw()});
        if(tab==='days')grid($('#ad-g',el),{id:'home-act-d',audit:false,search:false,fixedView:isMobile()?'cards':'table',rid:r=>r.d,rows:()=>a.days,title:'d',noun:['день','дня','дней'],sort:{key:'d',dir:-1},
          cols:[{key:'d',label:'Дата',type:'date',w:130,val:r=>r.d,html:r=>`<span class="strong">${fmtD(r.d)}</span> <span class="faint">${DOW[D(r.d).getUTCDay()].slice(0,2)}</span>`},{key:'first',label:'Первый вход',type:'text',w:120,val:r=>r.first||'',nofilter:true},{key:'last',label:'Последняя активность',type:'text',w:170,val:r=>r.last||'',nofilter:true},actNum('in','Входов',90,r=>r.in),actNum('out','Выходов',96,r=>r.out),actNum('n','Действий',100,r=>r.n),
            actNum('sub','Отчётов сдано',126,r=>REPORTS.filter(x=>x.subDate===r.d&&(x.subBy||x.resp)===e.id&&!tR(x).payOnly).length)],
          empty:{icon:'clock',title:'В этом периоде активности не было'}});
        else grid($('#ad-g',el),{id:'home-act-c',audit:false,search:false,fixedView:isMobile()?'cards':'table',rows:()=>cps,title:'name',noun:['контрагент','контрагента','контрагентов'],sort:{key:'name',dir:1},open:c=>openCp(c),
          cols:[{key:'name',label:'Контрагент',type:'text',w:260,val:c=>c.name,html:c=>`<span class="strong">${esc(c.name)}</span>`},
            actNum('sub','Отчётов сдано',126,c=>REPORTS.filter(r=>r.cp===c.id&&actIn(r.subDate,rg)&&(r.subBy||r.resp)===e.id&&!tR(r).payOnly).length),
            actNum('due','Со сроком в периоде',170,c=>REPORTS.filter(r=>r.cp===c.id&&r.resp===e.id&&!r.superseded&&r.status!=='Не требуется'&&!tR(r).payOnly&&actIn(r.due,rg)).length),
            actNum('open','Не сдано',100,c=>REPORTS.filter(r=>r.cp===c.id&&r.resp===e.id&&!r.superseded&&OPEN.has(r.status)&&!tR(r).payOnly&&actIn(r.due,rg)).length),
            actNum('over','Просрочено сейчас',146,c=>REPORTS.filter(r=>r.cp===c.id&&r.resp===e.id&&r.overdue).length,{html:c=>{const n=REPORTS.filter(r=>r.cp===c.id&&r.resp===e.id&&r.overdue).length;return n?`<span class="pill red sm">${ic('alert')}${n}</span>`:'<span class="faint">0</span>'}}),
            actNum('act','Действий по контрагенту',190,c=>HIST.filter(h=>h.who===e.id&&h.cp===c.id&&actIn(h.at,rg)).length)],
          empty:{icon:'building',title:'За сотрудником нет контрагентов'}})}}}})}

/* ── Админка → Организации → «Активность» ── */
function actOrg(o,rg,ix){const ds=actDays(rg);let n=0,inn=0,sub=0,cps=0,last=null,days=0,umax=0;const byDay={},us=new Set();
  if(o.self){EMP.forEach(e=>ds.forEach(d=>{const x=actEmpDay(e,d,ix);if(!x)return;n+=x.n;inn+=x.in;us.add(e.id);byDay[d]=(byDay[d]||0)+x.n;const t=d+(x.last?' '+x.last:'');if(!last||t>last)last=t}));
    days=Object.keys(byDay).length;umax=us.size;sub=REPORTS.filter(r=>actIn(r.subDate,rg)&&!tR(r).payOnly).length;cps=CPS.filter(c=>actIn(c._ca,rg)).length}
  else ds.forEach(d=>{const x=actBaseOrg(o,d);if(!x)return;n+=x.n;inn+=x.in;sub+=x.sub;cps+=x.cps;days++;umax=Math.max(umax,x.u);byDay[d]=x.n;last=d+' '+x.last});
  return {o,id:o.id,n,in:inn,sub,cps,last,days,users:Math.min(umax,o.staff()),byDay}}
function renderOrgAct(body){
  const p=S.oact=S.oact||{k:'m',off:0},rg=actRange(p),ix=actIdx(rg);const rows=ORGS.map(o=>actOrg(o,rg,ix));
  const sum=k=>rows.reduce((a,x)=>a+x[k],0),act=rows.filter(x=>x.days).length;const byDay={};rows.forEach(x=>Object.entries(x.byDay).forEach(([d,v])=>{byDay[d]=(byDay[d]||0)+v}));
  body.innerHTML=`${actBar(p,rg,'Активность организаций на платформе; данные организаций администратор не видит')}
  <div class="plates">${plate({id:'o1',icon:'building',color:act?'green':'yellow',label:'Организаций с активностью',value:act,unit:' из '+ORGS.length})}${plate({id:'o2',icon:'users',color:'blue',label:'Работали в программе',value:sum('users'),sub:'пользователей'})}${plate({id:'o3',icon:'key',color:'blue',label:'Входов',value:fmtM(sum('in'),false)})}${plate({id:'o4',icon:'chart',color:'purple',label:'Действий',value:fmtM(sum('n'),false)})}${plate({id:'o5',icon:'send',color:'green',label:'Отчётов сдано',value:fmtM(sum('sub'),false),sub:`новых контрагентов: ${sum('cps')}`})}</div>
  ${p.k==='d'?'':`<div class="box"><h3>Действия ${p.k==='y'?'по месяцам':'по дням'}</h3>${actChart(actBuckets(rg,p,d=>byDay[d]||0),'Действия')}</div>`}<div id="oa-g"></div>`;
  actBind(body,p,()=>renderOrgAct(body));
  grid($('#oa-g',body),{id:'adm-org-act',audit:false,rows:()=>rows,title:'name',noun:['организация','организации','организаций'],rowClass:r=>r.o.active?'':'muted',sort:{key:'n',dir:-1},open:r=>orgCard(r.o.id),
    actions:r=>[{label:'Открыть карточку',icon:'building',run:()=>orgCard(r.o.id)}],
    cols:[{key:'name',label:'Организация',type:'text',w:270,val:r=>r.o.name,html:r=>`<span class="strong">${esc(r.o.name)}</span>`},
      {key:'st',label:'Статус',type:'enum',w:140,val:r=>r.o.active?'Активна':'Заблокирована',html:r=>r.o.active?'<span class="pill green sm">Активна</span>':'<span class="pill red sm">Заблокирована</span>'},
      {key:'last',label:'Последняя активность',type:'datetime',w:170,val:r=>r.last,html:r=>actLastHtml(r.last)},
      actNum('users','Работали, пользователей',180,r=>r.users),actNum('staff','Сотрудников всего',146,r=>r.o.staff()),actNum('days','Дней с активностью',150,r=>r.days),
      actNum('in','Входов',90,r=>r.in),actNum('n','Действий',100,r=>r.n),actNum('sub','Отчётов сдано',126,r=>r.sub),actNum('cps','Новых контрагентов',150,r=>r.cps)],
    empty:{icon:'building',title:'Организаций нет'}})}

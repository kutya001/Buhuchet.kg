'use strict';
// Модуль «Главная»
/* ═════════════ Главная ═════════════ */
function plate({icon,color,label,value,unit,sub,on,id}){return `<button class="plate ${on?'on':''}" data-plate="${id}"><span class="pl-top"><span class="pl-dot ${color}">${ic(icon)}</span>${esc(label)}</span><span class="pl-val">${value}${unit?`<small>${unit}</small>`:''}</span>${sub?`<span class="pl-sub">${sub}</span>`:''}</button>`}
function homeTabs(){return [{id:'today',label:'Сводка',icon:'home'},feat('fee')&&can('fee')?{id:'analytics',label:'Аналитика',icon:'chart'}:null]}
function renderHome(body,tab){
  if(tab==='analytics')return renderAnalytics(body);
  const u=me();const vr=visReports();const[w0,w1]=weekRange();
  // Как во вкладке «На неделе»: у приостановленных контрагентов сроков нет, у отчётов «Уплата» сдавать нечего, оплатить можно только указанную сумму
  const live=r=>!CPM[r.cp].paused;
  const ovRep=vr.filter(r=>r.overdue),ovPay=vr.filter(r=>r.payOverdue);
  const wkSub=vr.filter(r=>live(r)&&!tR(r).payOnly&&OPEN.has(r.status)&&r.due>=w0&&r.due<=w1),wkPay=vr.filter(r=>live(r)&&feat('taxpay')&&['Не оплачено','Оплачено частично'].includes(r.payStatus)&&r.sum>0&&r.payDue>=w0&&r.payDue<=w1);
  const waiting=repWaitList();
  const myTasks=feat('tasks')?allTasks().filter(t=>t.exec===S.me&&taskOpen(t)&&t.date<=TODAY):[];
  const d=D(TODAY);
  let h=`<div class="hello"><span>Сегодня <b>${d.getUTCDate()} ${MONTHS_G[d.getUTCMonth()]}, ${DOW[d.getUTCDay()]}</b></span><span>·</span><span>${seeAll('reports')?'Вы видите всю организацию':'Вы видите только своих контрагентов и свои отчёты'}</span><span>·</span><span>неделя ${fmtD(w0).slice(0,5)}–${fmtD(w1).slice(0,5)}${isWeekend()?' (сегодня выходной, показана ближайшая рабочая неделя)':''}</span></div>`;
  // Организация без контрагентов: та же сводка с нулями и одна строка-подсказка
  if(!CPS.length)h+=`<div class="note fe-note">${ic('building')}<span class="grow">Добавьте контрагентов, чтобы здесь появились сроки и суммы.</span>${can('createCp')||can('cpImport')?`<button class="btn cta sm" data-goto="cps.all">${ic('plus','sm')}Перейти к контрагентам</button>`:''}</div>`;
  h+=`<div class="plates">
   ${plate({id:'ovr',icon:'alert',color:ovRep.length?'red':'green',label:'Просрочено отчётов',value:ovRep.length,sub:ovRep.length?'срок прошёл, отчёт не сдан':'всё сдано в срок'})}
   ${feat('taxpay')?plate({id:'ovp',icon:'wallet',color:ovPay.length?'red':'green',label:'Просрочено оплат',value:ovPay.length,sub:ovPay.length?som(ovPay.reduce((a,r)=>a+r.sum-r.paid,0))+' не оплачено':'долгов в бюджет нет'}):''}
   ${plate({id:'wks',icon:'send',color:'yellow',label:'Сдать на этой неделе',value:wkSub.length,sub:'до '+fmtD(w1)})}
   ${feat('taxpay')?plate({id:'wkp',icon:'coins',color:'yellow',label:'Оплатить на этой неделе',value:wkPay.length,sub:som(wkPay.reduce((a,r)=>a+r.sum-r.paid,0))}):''}
   ${repConfOn()?plate({id:'wait',icon:'hourglass',color:'blue',label:'Ожидают подтверждения',value:waiting.length,sub:can('repConfirm')?'сданы, ждут вашего подтверждения':'сданы, ждут старшего бухгалтера'}):''}
   ${feat('tasks')&&can('tasksConfirm')?(()=>{const pd=allTasks().filter(t=>taskPend(t)&&t.exec!==S.me);return plate({id:'tpend',icon:'hourglass',color:pd.length?'purple':'green',label:'Ждут подтверждения',value:pd.length,sub:pd.length?'выполненные задачи сотрудников':'подтверждать нечего'})})():''}
   ${kMissOk()?(()=>{const k=kMissCnt();return plate({id:'kmiss',icon:'gauge',color:k.n?(k.over?'red':'yellow'):'green',label:'Не заполнены показатели',value:k.n,sub:k.n?(k.over?'контрагентов, есть просроченные месяцы':'контрагентов, срок ещё не прошёл'):'всё внесено'})})():''}
   ${feat('tasks')?plate({id:'tsk',icon:'task',color:'purple',label:'Мои задачи на сегодня',value:myTasks.length,sub:myTasks.filter(t=>t.date<TODAY).length?myTasks.filter(t=>t.date<TODAY).length+' просрочено':'включая просроченные'}):''}
  </div>`;
  const upcoming=vr.filter(r=>live(r)&&!tR(r).payOnly&&OPEN.has(r.status)&&r.due>=TODAY).sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:0).slice(0,9);
  const month=ym(TODAY);
  const people=(seeAll('reports')?EMP.filter(e=>e.active&&e.role!=='owner'):[u]);
  const prog=people.map(e=>{const rs=REPORTS.filter(r=>!r.superseded&&r.resp===e.id&&ym(r.due)===month&&r.status!=='Не требуется');const done=rs.filter(r=>r.status==='Сдан').length;return {e,done,all:rs.length}}).filter(x=>x.all);
  h+=`<div class="cols2"><div class="box"><h3>Ближайшие сроки сдачи<span class="grow"></span><button class="linkbtn" data-goto="reports.all" style="text-transform:none;letter-spacing:0;font-size:12.5px">Все отчёты</button></h3><div class="list">${upcoming.map(r=>{const dd=new Date(D(r.due));return `<div class="li" data-rep="${r.id}" tabindex="0"><div class="datebox ${r.overdue?'red':''}"><b>${dd.getUTCDate()}</b><span>${MONTHS_G[dd.getUTCMonth()].slice(0,3)}</span></div><div class="grow"><div class="t1">${esc(T[r.t].short)} · ${esc(CPM[r.cp].name)}</div><div class="t2">${esc(r.phuman)} · ${esc(empName(r.resp)||'нет ответственного')}${r.overdue?' · <span class="red">просрочен</span>':''}</div></div>${pill(r.status,ST)}</div>`}).join('')||'<div class="muted">Несданных отчётов нет.</div>'}</div></div>
  <div style="display:flex;flex-direction:column;gap:14px;min-width:0"><div class="box"><h3>Отчёты со сроком в этом месяце: сдано</h3>${prog.map(p=>`<div class="prog"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.e.short)}</span><div class="bar" role="progressbar" aria-valuenow="${p.done}" aria-valuemax="${p.all}"><i style="width:${Math.round(p.done/p.all*100)}%"></i></div><span class="n">${p.done} из ${p.all}</span></div>`).join('')||'<div class="muted">Нет отчётов со сроком в этом месяце.</div>'}</div>
  ${feat('tasks')&&myTasks.length?`<div class="box"><h3>Мои задачи на сегодня</h3><div class="list">${myTasks.slice(0,5).map(t=>`<div class="li" data-task="${t.id}" tabindex="0">${ic(t.reg?'file':'task')}<div class="grow"><div class="t1">${esc(t.title)}</div><div class="t2">${t.date<TODAY?'<span class="red">просрочена</span> · ':''}${fmtD(t.date)}${t.cat?' · '+esc(t.cat):''}</div></div>${pill(t.status,TST)}</div>`).join('')}</div></div>`:''}
  ${feat('fee')&&can('fee')?(()=>{const deb=visCps().filter(c=>c.feeDebt>0);return deb.length?`<div class="box"><h3>Должники по обслуживанию<span class="grow"></span><button class="linkbtn" data-goto="cps.debtors" style="text-transform:none;letter-spacing:0;font-size:12.5px">Открыть список</button></h3><div class="row"><span class="pl-val" style="font-size:22px">${som(deb.reduce((a,c)=>a+c.feeDebt,0))}</span><span class="muted">${deb.length} ${plural(deb.length,'контрагент','контрагента','контрагентов')}</span></div></div>`:''})():''}
  </div></div>`;
  body.innerHTML=h;
  body.onclick=e=>{let b;
    if(b=e.target.closest('[data-plate]')){const id=b.dataset.plate;
      if(id==='ovr')go('reports','overdue',{ovk:{type:'enum',vals:['Сдача','Сдача и оплата']}});if(id==='ovp')go('reports','overdue',{ovk:{type:'enum',vals:['Оплата','Сдача и оплата']}});
      if(id==='wks')go('reports','week',{status:{type:'enum',vals:['К сдаче','В работе','Требует исправления']},due:{type:'date',from:w0,to:w1}});if(id==='wkp')go('reports','week',{paystatus:{type:'enum',vals:['Не оплачено','Оплачено частично']},paydue:{type:'date',from:w0,to:w1},sum:{type:'num',from:0.01}});
      if(id==='wait')go('reports','waiting');if(id==='kmiss')go('kpi','missing');if(id==='tpend'){go('tasks',can('tasksAll')?'all':'mine',{status:{type:'enum',vals:['На подтверждении']}});return}if(id==='tsk'){S.taskView='day';go('tasks','mine',{date:{type:'date',from:null,to:TODAY},open:{type:'enum',vals:['Да']}})}return}
    if(b=e.target.closest('[data-goto]')){const[a,t]=b.dataset.goto.split('.');go(a,t);return}
    if(b=e.target.closest('[data-rep]')){openReport(REPORTS.find(r=>r.id===+b.dataset.rep));return}
    if(b=e.target.closest('[data-task]')){openTask(allTasks().find(t=>t.id===b.dataset.task));return}
  };
  body.onkeydown=e=>{if(e.key==='Enter'&&e.target.matches('.li'))e.target.click()};
}


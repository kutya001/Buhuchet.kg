'use strict';
// Модуль «Отчеты для сдачи»: список, матрица, календарь, действия
/* ═════════════ Отчеты для сдачи ═════════════ */
function repTabs(){const c=counts();return [
 {id:'week',label:'На неделе',icon:'calendar',count:c.week},
 {id:'overdue',label:'Просрочено',icon:'alert',count:c.overdue,red:true},
 repConfOn()?{id:'waiting',label:'Ожидают подтверждения',icon:'hourglass',count:c.waiting}:null,
 {id:'all',label:'Все отчёты',icon:'list'},
 {id:'matrix',label:'Кто что сдаёт',icon:'matrix'},
 feat('calendar')?{id:'calendar',label:'Календарь',icon:'calendar'}:null]}
function repAdd(){return [can('assign')?{label:'Назначить отчёты массово',icon:'matrix',run:massAssignDlg}:null,can('changeStatus')?{label:'Разовый отчёт',icon:'file',run:adhocDlg}:null].filter(Boolean)}
const isDone=r=>DONE.has(r.status);
function moneyTxt(r){if(!r.money)return '';return r.money.s==='paid'?'Оплачено':r.money.s==='ok'?'Достаточно':'Недостача'}
function moneyHtml(r){const rb=canRecv(r)&&(r.recv||0)<r.sum?` <button class="btn xs" data-recv="${r.id}" title="Принять деньги от контрагента под этот отчёт">${ic('plus','sm')}Принять</button>`:'';return rb?`<span class="mwrap">${moneyHtml0(r)}${rb}</span>`:moneyHtml0(r)}
function moneyHtml0(r){if(!r.money)return '<span class="faint">—</span>';if(r.money.s==='paid')return `<span class="pill faint">${ic('check')}Оплачено</span>`;if(r.money.s==='ok')return `<span class="pill green">${ic('ok')}Достаточно</span>`;return `<span class="pill red" title="Не хватает ${som(r.money.n)}">${ic('alert')}Недостача ${fmtM(r.money.n,false)}</span>`}
// Метка «перенос»: срок сдвинут с нерабочего дня или изменён вручную; у ручного срока подсказка со сроком по закону (решение заказчика 30.10.2026, Б-5)
const dueLaw=r=>(tR(r)||{}).shift===false?r.dueBase:shiftWork(r.dueBase);
function dueHtml(r){const man=r.dueManual&&r.due!==dueLaw(r);return `${r.overdue?`<span class="red" title="Просрочен">${ic('alert','sm')}</span> `:''}<span class="${r.overdue?'red strong':''}">${fmtD(r.due)}</span>${man||!r.dueManual&&r.due!==r.dueBase?` <span class="tag" title="${man?`Срок изменён вручную; по закону: ${fmtD(dueLaw(r))}`:`Перенесён с ${fmtD(r.dueBase)}: ${esc(holidayName(r.dueBase)||'выходной день')}`}">перенос</span>`:''}`}
function daysHtml(r){if(isDone(r))return '<span class="faint">—</span>';const d=diffDays(r.due,TODAY);if(d<0)return `<span class="pill red sm">${d}</span>`;if(d===0)return '<span class="pill yellow sm">сегодня</span>';return d<=3?`<span class="yellow strong">${d}</span>`:String(d)}
// Ставка отчёта из назначения: у ЕН — строки ЕНС («ЕНС-04 · 4 % безнал + 6 % нал»; коротко, в столбце — «ЕНС-04 · 4 / 6 %»)
const rateOf=(r,short)=>aRateTxt(assignOfT(CPM[r.cp],r.t),T[r.t],short,r.pkey);
function reportCols(o={}){const tp=feat('taxpay');const cols=[
 {key:'cp',label:'Контрагент',type:'text',w:220,val:r=>CPM[r.cp].name,html:r=>`<span class="strong">${esc(CPM[r.cp].name)}</span>`},
 {key:'inn',label:'ИНН',type:'text',w:150,val:r=>CPM[r.cp].inn,cls:'mono',hide:true},
 {key:'ugns',label:'УГНС',type:'enum',w:200,val:r=>ugnsLabel(CPM[r.cp].ugns),hide:true},
 {key:'type',label:'Вид отчёта',type:'enum',w:140,val:r=>T[r.t].short,html:r=>`<span title="${esc(T[r.t].name)}">${esc(T[r.t].short)}</span>${r.ver?` <span class="tag blue">уточн. ${r.ver}</span>`:''}${isMobile()?' '+actPill(actOf(r),1):''}`},
 {key:'act',label:'Что сделать',type:'enum',w:175,deskOnly:true,val:r=>ACT_L[actOf(r)],html:r=>actPill(actOf(r),1)},
 {key:'rate',label:'Ставка',type:'enum',w:130,val:r=>rateOf(r,true),hide:true},
 {key:'organ',label:'Орган',type:'enum',w:110,val:r=>T[r.t].organ,hide:true},
 {key:'period',label:'Период',type:'enum',w:112,val:r=>r.plabel,sortVal:r=>r.pkey},
 {key:'due',label:'Срок сдачи',type:'date',w:176,val:r=>r.due,html:dueHtml},
 {key:'days',label:'Дней до срока',type:'int',w:132,num:true,val:r=>isDone(r)?null:diffDays(r.due,TODAY),html:daysHtml,hide:true},
 {key:'status',label:'Статус сдачи',type:'enum',w:175,val:r=>tR(r).payOnly?'—':r.status,html:r=>tR(r).payOnly?'<span class="faint">—</span>':scaleMini('rep',r.status,r)},
 ...(o.waiting?[{key:'wait',label:'Ждёт, дней',type:'int',w:100,num:true,val:r=>repWait(r)?repWaitDays(r):null,html:r=>{const d=repWaitDays(r);return d>=(ORG.waitDays||3)?`<span class="pill orange sm" title="Дольше ${ORG.waitDays||3} дн.: старшим бухгалтерам ушло напоминание">${d}</span>`:String(d)}},{key:'subby',label:'Сдал',type:'enum',w:130,val:r=>empName(r.subBy||r.resp)}]:[]),
 {key:'sub',label:'Дата сдачи',type:'date',w:108,val:r=>tR(r).payOnly?null:r.subDate,html:r=>tR(r).payOnly?'<span class="faint">—</span>':r.subDate?fmtD(r.subDate):'',hide:true},
 // Суммы всегда в одном порядке (решение заказчика 25.10.2026): «К уплате» → «Получено от контрагента» → «Оплачено в бюджет» (под суммой — статус оплаты); на телефоне — одной строкой плитки
 {key:'sum',label:'К уплате',cl:'К уплате',cline:true,type:'money',w:130,num:true,total:true,val:r=>tR(r).sum?r.sum:null,cv:r=>r.sum==null?'не указана':fmtM(r.sum,false),html:r=>!tR(r).sum?'<span class="faint">—</span>':r.sum==null?'<span class="faint">не указана</span>':fmtM(r.sum)+(r.auto?` <span title="Повторяющаяся сумма из назначения">${ic('repeat','sm')}</span>`:'')},
 ...(tp?[
 {key:'got',label:'Получено от контрагента',cl:'Получено',cline:true,type:'money',w:170,num:true,total:true,val:r=>tR(r).sum&&r.sum>0?r.got:null,cv:r=>fmtM(r.got,false),html:r=>!(tR(r).sum&&r.sum>0)?'<span class="faint">—</span>':`<span class="mwrap"><span class="${r.got>=r.sum?'green':''}">${fmtM(r.got)}</span>${canRecv(r)&&r.got+(r.selfPaid||0)<r.sum?` <button class="btn xs" data-recv="${r.id}" title="Принять деньги от контрагента под этот отчёт">${ic('plus','sm')}Принять</button>`:''}</span>`},
 {key:'paid',label:'Оплачено в бюджет',cl:'Оплачено',cline:true,type:'money',w:178,num:true,total:true,val:r=>tR(r).sum?r.paid:null,cv:r=>fmtM(r.paid,false)+(r.payOverdue?` <span class="pill red sm">${ic('alert')}просрочено</span>`:''),html:r=>!tR(r).sum?'<span class="faint">—</span>':`<div class="sum-st"><span class="tnum">${fmtM(r.paid)}</span>${scaleMini0('pay',r.payStatus,r)}${r.payOverdue?`<span class="pill red sm" title="Срок оплаты прошёл">${ic('alert')}просрочено</span>`:''}</div>`},
 {key:'left',label:'Осталось оплатить',type:'money',w:140,num:true,total:true,val:r=>tR(r).sum&&r.sum>0?Math.max(0,Math.round((r.sum-r.paid)*100)/100):null,hide:true},
 {key:'paydue',label:'Срок оплаты',type:'date',w:116,val:r=>tR(r).sum?r.payDue:null,html:r=>tR(r).sum?`<span class="${r.payOverdue?'red strong':''}">${fmtD(r.payDue)}</span>`:'<span class="faint">—</span>',hide:true},
 {key:'paystatus',label:'Статус оплаты',type:'enum',w:170,val:r=>tR(r).sum?r.payStatus:'—',html:r=>!tR(r).sum?'<span class="faint">—</span>':scaleMini('pay',r.payStatus,r)+(r.payOverdue?` <span class="pill red sm" title="Срок оплаты прошёл">${ic('alert')}просрочено</span>`:''),hide:true},
 {key:'money',label:'Деньги (сверка)',type:'enum',w:290,val:moneyTxt,html:moneyHtml,hide:true}]:[]),
 {key:'ovk',label:'Просрочка',type:'enum',w:140,val:r=>r.overdue&&r.payOverdue?'Сдача и оплата':r.overdue?'Сдача':r.payOverdue?'Оплата':'',hide:true},
 {key:'pays',label:'Что уплачивается',type:'text',w:220,val:r=>tR(r).sum?paysTxt(T[r.t]):'',hide:true},
 {key:'resp',label:'Ответственный',type:'enum',w:132,val:r=>empName(r.resp),hide:!!o.compact&&!seeAll('reports')},
 {key:'fcode',label:'Код формы',type:'text',w:110,val:r=>T[r.t].code||'',cls:'mono',hide:true},
 {key:'pfull',label:'Период полностью',type:'text',w:170,val:r=>r.phuman,sortVal:r=>r.pkey,hide:true},
 {key:'duebase',label:'Срок по закону',type:'date',w:120,val:r=>r.dueBase,hide:true},
 ...(repConfOn()?[{key:'conf',label:'Подтверждение',type:'enum',w:190,val:r=>repMark(r)===REP_MK.wait?stl(REP_MK.wait):repMark(r)?repConfTxt(r):'',html:r=>{const k=repMark(r);return !k?'<span class="faint">—</span>':k===REP_MK.wait?`<span class="pill yellow sm">${ic('hourglass')}${esc(repConfTxt(r))}</span>`:`<span class="pill green sm">${ic('check')}${esc(repConfTxt(r))}</span>`},hide:true},
 {key:'confd',label:'Дата подтверждения',type:'date',w:130,val:r=>repMark(r)===REP_MK.ok&&r.confAt?r.confAt.slice(0,10):null,hide:true}]:[]),
 {key:'ver',label:'Версия',type:'enum',w:110,val:r=>r.ver?'Уточнённый '+r.ver:'Первичный',hide:true},
 {key:'rfiles',label:'Файлов',type:'int',w:90,num:true,val:r=>r.files.length,hide:true},
 {key:'form',label:'Форма собственности',type:'enum',w:120,val:r=>CPM[r.cp].form,hide:true},
 {key:'regime',label:'Режим',type:'enum',w:150,val:r=>CPM[r.cp].regime||'',hide:true}];
 return cols}
const repRowClass=r=>r.overdue||r.payOverdue?'overdue':r.status==='Не требуется'?'muted':'';
function repGrid(host,id,rows,extra={}){
  return grid(host,Object.assign({id,cols:reportCols(extra),rows,title:'cp',noun:['отчёт','отчёта','отчётов'],rowClass:repRowClass,actions:reportActions,open:openReport,
    sort:{key:'due',dir:1},preset:S.preset,simulateLoad:extra.load,
    bulk:can('changeStatus')?[{label:'Отметить сданными',icon:'send',run:(rs,done)=>{const ok=rs.filter(r=>OPEN.has(r.status)&&!tR(r).payOnly);if(!ok.length){toast('Среди выбранных нет отчётов, которые можно сдать','alert',true);return}if(ok.length===1&&subPayWhy(ok[0])){toast(subPayWhy(ok[0]),'lock',true);return}submitDlg(ok,done)}}]:null,
    empty:{icon:'ok',title:extra.emptyTitle||'Отчётов нет',text:extra.emptyText||''}},extra.cfg||{}));
}
// «Сдать» — not yet submitted reports that need submitting; «Уплатить» — not yet paid reports that need paying.
function actQ(r,q){if(q==='all')return true;const t=tR(r);if(r.status==='Не требуется'||r.superseded)return false;
  if(q==='sub')return !t.payOnly&&OPEN.has(r.status);return t.sum&&(r.sum==null||r.sum>0&&r.paid<r.sum)}
function renderReports(body,tab,fresh){
  const vr=visReports();const[w0,w1]=weekRange();const month=ym(TODAY);
  if(tab==='waiting'&&!repConfOn())tab='all';
  if(['week','overdue','waiting','all'].includes(tab)){
    const c=counts();const subm=vr.filter(r=>r.status==='Сдан'&&!tR(r).payOnly&&r.subDate&&ym(r.subDate)===month).length;
    const toPay=vr.filter(r=>tR(r).sum&&r.sum>0&&r.payDue&&ym(r.payDue)===month);
    body.innerHTML=`${txNote()}<div class="plates">
      ${plate({id:'overdue',icon:'alert',color:c.overdue?'red':'green',label:'Просрочено',value:c.overdue,sub:'сдача или оплата',on:tab==='overdue'})}
      ${plate({id:'week',icon:'calendar',color:'yellow',label:'На этой неделе',value:c.week,sub:`${fmtD(w0).slice(0,5)}–${fmtD(w1).slice(0,5)}`,on:tab==='week'})}
      ${repConfOn()?plate({id:'waiting',icon:'hourglass',color:'blue',label:'Ожидают подтверждения',value:c.waiting,sub:'сданы, ждут старшего бухгалтера',on:tab==='waiting'}):''}
      ${plate({id:'subm',icon:'ok',color:'green',label:'Сдано в этом месяце',value:subm,sub:ymLabel(month)})}
      ${plate({id:'sum',icon:'coins',color:'purple',label:'К уплате за '+MONTHS[+month.slice(5)-1],value:fmtM(toPay.reduce((a,r)=>a+r.sum,0),false),unit:'сом',sub:`оплачено ${fmtM(toPay.reduce((a,r)=>a+r.paid,0),false)}`})}
    </div><div id="rg"></div>`;
    body.querySelector('.plates').onclick=e=>{const b=e.target.closest('[data-plate]');if(!b)return;const id=b.dataset.plate;
      if(['overdue','week','waiting'].includes(id))go('reports',id);
      if(id==='subm')go('reports','all',{status:{type:'enum',vals:['Сдан']},sub:{type:'date',from:month+'-01',to:lastDay(month)}});
      if(id==='sum')go('reports','all',{paydue:{type:'date',from:month+'-01',to:lastDay(month)}})};
    let rows,extra={load:fresh};
    if(tab==='week'){rows=()=>visReports().filter(r=>inWeek(r,w0,w1));extra.emptyTitle='На этой неделе всё сдано и оплачено';}
    if(tab==='overdue'){rows=()=>visReports().filter(r=>r.overdue||r.payOverdue);extra.emptyTitle='Просрочек нет';extra.emptyText='Все отчёты сданы и оплачены в срок.'}
    if(tab==='waiting'){rows=()=>repWaitList();extra.waiting=true;extra.emptyTitle='Нет отчётов, ожидающих подтверждения';if(can('repConfirm'))extra.cfg={bulk:[{label:'Подтвердить',icon:'check',run:(rs,done)=>repConfDlg(rs,done)}]}}
    if(tab==='all'){rows=()=>visReports()}
    const base=rows;const q=S.repAct||'all';rows=()=>base().filter(r=>actQ(r,q));
    $('#rg',body).insertAdjacentHTML('beforebegin',`<div class="chipsel actq" id="actq" role="group" aria-label="Что нужно сделать">${[['all','Все'],['sub','Сдать'],['pay','Уплатить']].map(([k,l])=>`<button type="button" data-aq="${k}" class="${q===k?'on':''}">${l}<span class="n">${base().filter(r=>actQ(r,k)).length}</span></button>`).join('')}</div>`);
    $('#actq',body).onclick=e=>{const b=e.target.closest('[data-aq]');if(!b)return;S.repAct=b.dataset.aq;renderPage()};
    repGrid($('#rg',body),'rep-'+tab,rows,extra);
    return;
  }
  if(tab==='matrix')return renderMatrix(body);
  if(tab==='calendar')return renderCalendar(body);
}
function renderMatrix(body){
  const types=RT.filter(t=>ORG.types[t.id]&&ORG.types[t.id].on);
  const q=norm(S.search);const cps=visCps(false,'reports').filter(c=>!q||norm(c.name).includes(q)||c.inn.includes(q));
  const ca=can('assign');
  body.innerHTML=`<div class="note">${ic('info')}<span>Галочка назначает отчёт контрагенту, снятая — завершает назначение: сданные отчёты остаются, будущие несданные получают статус «Не требуется». Заштрихованные ячейки не подходят по режиму или форме собственности.${ca?'':' <b>У вас нет права назначать отчёты.</b>'}</span></div>
  <div class="mx"><table><thead><tr><th>Контрагент · режим</th>${types.map(t=>`<th title="${esc(t.name)}">${esc(t.short)}</th>`).join('')}</tr></thead><tbody>${cps.map(c=>`<tr><th title="${esc(c.name)}"><div style="max-width:230px;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</div><div class="faint" style="font-weight:450;font-size:11.5px">${esc(c.regime||'режим не указан')}</div></th>${types.map(t=>{const a=c.assign.find(a=>a.t===t.id&&!a.to);const why=compatible(t,c);return `<td class="${why&&!a?'na':''}" title="${esc(why||t.name)}"><input type="checkbox" data-cp="${c.id}" data-t="${t.id}" ${a?'checked':''} ${(!ca||(why&&!a))?'disabled':''} aria-label="${esc(t.short)} — ${esc(c.name)}"></td>`}).join('')}</tr>`).join('')}</tbody>
  <tfoot><tr><th>Назначено</th>${types.map(t=>`<td>${cps.filter(c=>c.assign.some(a=>a.t===t.id&&!a.to)).length}</td>`).join('')}</tr></tfoot></table></div>`;
  body.onchange=e=>{const x=e.target;if(!x.dataset.cp)return;const c=CPM[+x.dataset.cp],t=T[x.dataset.t];
    if(x.checked&&t.active===false){x.checked=false;return toast('Вид отключён администратором платформы: новые назначения недоступны','alert',true)}
    if(x.checked){assignTypes(c,[t.id]);toast(`${t.short} назначен: ${c.name}`);refreshAll()}
    else{x.checked=true;unassignDlg(c,[t.id])}};
}
function renderCalendar(body){
  if(!S.cal)S.cal=ym(TODAY);const m=S.cal;const[y,mo]=m.split('-').map(Number);
  const first=mkDate(y,mo,1);const wd=(D(first).getUTCDay()+6)%7;const start=addDays(first,-wd);
  const vr=visReports().filter(r=>r.status!=='Не требуется');
  const byDue={};vr.forEach(r=>{(byDue[r.due]=byDue[r.due]||[]).push(r)});
  const byPay={};if(feat('taxpay'))vr.forEach(r=>{if(tR(r).sum&&r.sum>0&&r.paid<r.sum){(byPay[r.payDue]=byPay[r.payDue]||[]).push(r)}});
  let cells='';for(let i=0;i<42;i++){const d=addDays(start,i);const inM=d.slice(0,7)===m;const list=byDue[d]||[];const todo=list.filter(r=>OPEN.has(r.status)&&!tR(r).payOnly).length;const done=list.length-todo;const pay=(byPay[d]||[]).length;const hol=holidayName(d);
    cells+=`<button class="cday ${isWorking(d)?'':'off'} ${inM?'':'other'} ${d===TODAY?'today':''} ${S.calSel===d?'sel':''}" data-day="${d}" aria-label="${fmtD(d)}: ${list.length} отчётов"><span class="dn"><span>${+d.slice(8)}</span>${!isWorking(d)&&inM?'<span class="faint" style="font-weight:450;font-size:11px">вых.</span>':''}</span>${hol&&inM?`<span class="hol" title="${esc(hol)}">${esc(hol)}</span>`:''}<span class="cnts">${todo?`<span class="pill sm ${d<TODAY?'red':'yellow'}">${ic('send')}${todo} к сдаче</span>`:''}${done?`<span class="pill sm green">${ic('check')}${done} сдано</span>`:''}${pay?`<span class="pill sm purple">${ic('coins')}${pay} оплат</span>`:''}</span></button>`}
  body.innerHTML=`<div class="calhead"><button class="icon-btn raised" data-cm="-1" aria-label="Предыдущий месяц">${ic('left')}</button><h3>${ymLabel(m)}</h3><button class="icon-btn raised" data-cm="1" aria-label="Следующий месяц">${ic('right')}</button><button class="btn sm ghost" data-cm="0">Сегодня</button><div class="grow" style="flex:1"></div><span class="hint">Сроки уже сдвинуты по производственному календарю КР</span></div>
  <div class="cal">${DOW_S.map(d=>`<div class="dow">${d}</div>`).join('')}${cells}</div>${S.calSel?`<div class="sec-h" style="margin-top:6px">Отчёты со сроком ${fmtD(S.calSel)}${holidayName(S.calSel)?' · '+esc(holidayName(S.calSel)):''}</div><div id="cal-grid"></div>`:'<div class="hint">Нажмите на день, чтобы открыть список отчётов на эту дату.</div>'}`;
  body.onclick=e=>{let b;if(b=e.target.closest('[data-cm]')){const k=+b.dataset.cm;S.cal=k?addMonths(S.cal,k):ym(TODAY);renderPage();return}
    if(b=e.target.closest('[data-day]')){S.calSel=S.calSel===b.dataset.day?null:b.dataset.day;renderPage();const g=$('#cal-grid');if(g)g.scrollIntoView({block:'nearest',behavior:'smooth'})}};
  if(S.calSel)repGrid($('#cal-grid'),'rep-cal',()=>visReports().filter(r=>r.due===S.calSel||(feat('taxpay')&&r.payDue===S.calSel&&r.sum>0&&r.paid<r.sum)),{emptyTitle:'На эту дату отчётов нет'});
}

/* ── Report actions ── */
function reportActions(r){
  const t=tR(r),st=t.payOnly?'—':r.status,cs=can('changeStatus');const no='Нет права менять статус';const it=[];
  it.push({label:'Открыть карточку',icon:'file',run:()=>openReport(r)});
  // Прежняя версия после «Создать уточнённый» не меняется: к ней можно только прикрепить файл (решение заказчика 30.10.2026, Б-7 «А»)
  if(r.superseded){if(feat('files')&&can('filesUpload'))it.push({label:'Прикрепить файл',icon:'clip',run:()=>fileDlg(r)});if(st==='Сдан')it.push({sep:true},repBackItem(r,st));return it}
  if(OPEN.has(st)){const w=subPayWhy(r);it.push({label:'Отметить сданным',icon:'send',disabled:!cs||!!w,reason:!cs?no:w,run:()=>submitDlg([r])})}
  if(st==='К сдаче')it.push({label:'Взять в работу',icon:'clock',disabled:!cs,reason:!cs&&no,run:()=>setStatus(r,'В работе')});
  if(repWait(r)){const why=repConfWhy(r);it.push({label:'Подтвердить',icon:'check',sub:'Сдача проверена старшим бухгалтером',disabled:!!why,reason:why,run:()=>repConfDlg([r])},{label:'На исправление',icon:'refresh',sub:'Вернуть ответственному с причиной',disabled:!!why,reason:why,run:()=>repFixDlg(r)})}
  if(st==='Сдан')it.push({label:'Требует исправления',icon:'alert',sub:'Орган не принял отчёт',disabled:!cs,reason:!cs&&no,run:()=>setStatus(r,'Требует исправления')});
  if(OPEN.has(r.status)&&!t.payOnly)it.push({label:'Изменить срок',icon:'calendar',disabled:!can('repDue'),reason:'Нужно право «Изменять срок отчёта»',run:()=>dueEditDlg(r)});
  if(t.sum&&r.status!=='Не требуется')it.push({label:'Указать сумму',icon:'coins',disabled:!can('changeSum'),reason:!can('changeSum')&&'Нет права менять сумму',run:()=>sumDlg(r)});
  if(feat('taxpay')&&t.sum&&r.sum>0&&r.paid<r.sum&&r.status!=='Не требуется'){const ok=r.money&&r.money.s==='ok';
    it.push({label:'Принять деньги',icon:'download',sub:'Поступление от контрагента под этот отчёт',disabled:!can('money'),reason:'Нет права на учёт денег',run:()=>recvDlg(r)});
    it.push({label:'Отметить оплаченным',icon:'wallet',sub:ok?'':`Денег контрагента не хватает${r.money&&r.money.n?': '+som(r.money.n):''} — или «Оплатил контрагент сам»`,disabled:!can('money'),reason:'Нет права на учёт денег',run:()=>payDlg(r)});
    it.push({label:'Напомнить в WhatsApp',icon:'chat',run:()=>waDlg({r})})}
  if(feat('files')&&can('filesUpload'))it.push({label:'Прикрепить файл',icon:'clip',run:()=>fileDlg(r)});
  if(st==='Сдан')it.push({label:'Создать уточнённый',icon:'repeat',disabled:!cs,reason:!cs&&no,run:()=>createRevision(r)});
  it.push({sep:true});
  if(st==='Сдан')it.push(repBackItem(r,st));
  if(r.status!=='Не требуется'&&!repFin(r))it.push({label:'Не требуется',icon:'ban',disabled:!cs,run:()=>confirmDlg({title:'Отметить «Не требуется»?',text:'Отчёт не нужно сдавать за этот период. Напоминания по нему прекратятся.',ok:'Отметить',run:()=>setStatus(r,'Не требуется')})});
  return it;
}
function repBackItem(r,st){const bk=scBack('rep',st,r);return {label:bk===REP_MK.wait?'Снять подтверждение':`Откатить в «${bk&&!bk.no?bk:'—'}»`,icon:'history',disabled:!can('rollback')||!bk||!!bk.no,reason:!can('rollback')?'Нужно право «Откат статусов»':bk&&bk.no?bk.no:'',run:()=>rollbackDlg('rep',r.id,bk)}}
const canRecv=r=>feat('taxpay')&&can('money')&&tR(r).sum&&r.sum>0&&r.paid<r.sum&&r.status!=='Не требуется'&&!r.superseded&&!CPM[r.cp].archived;
function recvDlg(r){const amt=Math.max(0,r.sum-Math.max(r.paid,r.recv||0));inDlg(CPM[r.cp],null,{r:r.id,amt:amt||r.sum-r.paid})}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-recv]');if(!b)return;e.stopPropagation();e.preventDefault();recvDlg(REPORTS.find(r=>r.id===+b.dataset.recv))},true);

'use strict';
// Модуль «Финансовые операции по контрагентам» и журнал поступлений
/* ═════════════ Финансовые операции по контрагентам ═════════════ */
/* grp — вкладка модуля: tax · fee · proj · wo */
/* Операции контрагента: модуль «Финансы», а если он отключён в учётной политике — карточка контрагента */
function cpOps(c){if(feat('finops'))go('fin','all',{cp:{type:'enum',vals:[c.name]}});else openCp(c)}
/* withDel — вместе с удалёнными операциями (фильтр «Показать удалённые»); удалённые не входят в итоги */
function finRows(withDel){const out=[];const vc=new Set(visCps(true,'fin').map(c=>c.id));const tax=taxVis(),fee=feat('fee')&&can('fee'),pj=moneyVis();
  if(tax)OPS.forEach(o=>{const bk=opBase(o.kind),del=bk!==o.kind;if(!vc.has(o.cp)||!OPK[bk]||(del&&!withDel))return;const k=o.self&&bk==='pay'?OP_SELF:OPK[bk];const fa=bk==='in'?(o.feeAlloc||[]).reduce((a,x)=>a+x.a,0):0;const amt=o.amount;const sign=bk==='corr'?(o.amount<0?'−':'+'):k[2];
    out.push({id:'o'+o.id,ref:o,src:'op',del,edited:!!o.edited,_ca:o._ca,_cb:o._cb||o.by,_ua:o._ua,_ub:o._ub,rep:o.report?(()=>{const r=REPORTS.find(y=>y.id===o.report);return r?T[r.t].short:''})():(o.alloc||[]).map(x=>{const r=REPORTS.find(y=>y.id===x.r);return r?T[r.t].short:''}).filter(Boolean).join(', '),per:o.report?(()=>{const r=REPORTS.find(y=>y.id===o.report);return r?r.plabel:''})():[...new Set((o.alloc||[]).map(x=>{const r=REPORTS.find(y=>y.id===x.r);return r?r.plabel:''}).filter(Boolean))].join(', '),note:o.note||'',grp:['bonus','refund'].includes(bk)?'wo':'tax',cp:o.cp,date:o.date,cat:k[0],color:k[1],sign,amount:Math.abs(amt),what:bk==='in'?(allocText(Object.assign({},o,{feeAlloc:[]}))||'Аванс')+(fa&&fee?` · ещё ${som(fa)} за обслуживание — отдельной строкой`:''):(o.note||''),by:o.by,files:(o.files||[]).length,acc:o.holder})});
  if(fee)FEEPAYS.forEach(f=>{if(!vc.has(f.cp)||(f.del&&!withDel))return;out.push({id:'f:'+f.id,ref:f,src:'fee',del:!!f.del,edited:!!f.edited,_ca:f._ca||f.date+' 10:00',_cb:f._cb||f.by,per:fpAlloc(f).map(x=>ymLabel(x.m)).join(', '),note:f.note||'',grp:'fee',dup:false,cp:f.cp,date:f.date,cat:'Оплата за обслуживание',color:'purple',sign:'+',amount:f.amount,what:fpWhat(f)+(f.op?' · из общего поступления':''),by:f.by,files:(f.files||[]).length,acc:'org'})});
  if(pj){SERVICES.forEach(s=>{if(!vc.has(s.cp)||(s.del&&!withDel))return;out.push({id:'s:'+s.id,ref:s,src:'svc',del:!!s.del,edited:!!s.edited,_ca:s._ca||s.date+' 10:00',_cb:s._cb||s.resp,_ua:s._ua,_ub:s._ub,note:s.note||s.desc||'',grp:'proj',cp:s.cp,date:s.date,cat:'Разовая услуга',color:'orange',sign:'+',amount:s.amount,paid:svcPaid(s),st:svcStatus(s),what:s.name,by:s.resp,files:s.files.length+s.pays.reduce((a,p)=>a+(p.files||[]).length,0),acc:'org'})});
    if(feat('projects'))PROJECTS.forEach(p=>{if(!vc.has(p.cp))return;p.pays.forEach((x,i)=>{if(x.del&&!withDel)return;out.push({id:'p:'+p.id+':'+i,ref:p,pay:x,src:'proj',del:!!x.del,edited:!!x.edited,_ca:x._ca||x.date+' 10:00',_cb:x.by,proj:p.name,note:x.note||'',grp:'proj',cp:p.cp,date:x.date,cat:'Оплата по проекту',color:'blue',sign:'+',amount:x.amount,what:`${p.name}${x.note?' · '+x.note:''}`,by:x.by,files:(x.files||[]).length,acc:'org'})})})}
  return out}
function finCols(){return [
 {key:'date',label:'Дата',type:'date',w:110,val:x=>x.date},
 {key:'cp',label:'Контрагент',type:'enum',w:220,val:x=>CPM[x.cp].name,html:x=>`<span class="strong">${esc(CPM[x.cp].name)}</span>`},
 {key:'cat',label:'Тип операции',type:'enum',w:230,val:x=>x.cat,html:x=>`<span class="pill sm ${x.color}">${esc(x.cat)}</span>${x.del?' <span class="tag red">удалена</span>':x.edited?' <span class="tag yellow">изменена</span>':''}`},
 {key:'what',label:'За что',type:'text',w:320,val:x=>x.what},
 {key:'amount',label:'Сумма',type:'money',w:140,num:true,total:true,val:x=>x.del||x.src==='op'&&(x.ref.kind==='xfer'||x.ref.self)?null:x.sign==='−'?-x.amount:x.amount,html:x=>`<span class="${x.del?'faint strike':x.sign==='+'&&x.src!=='svc'?'green':''}">${x.src==='svc'?'':x.sign}${fmtM(x.amount)}</span>`},
 {key:'st',label:'Оплата',type:'enum',w:165,val:x=>x.st||'',html:x=>x.st?pill(x.st,PST)+(x.st==='Оплачено частично'?` <span class="faint tnum">${fmtM(x.paid,false)}</span>`:''):'<span class="faint">—</span>'},
 {key:'acc',label:'Счёт',type:'enum',w:160,val:x=>x.acc==='org'?'Организация':x.acc==='client'?'Контрагент сам':empName(x.acc),html:x=>x.acc==='org'?`${ic('building','sm')} организация`:x.acc==='client'?`${ic('building','sm')} контрагент сам`:`${ic('user','sm')} ${esc(empName(x.acc))}`},
 {key:'by',label:'Кто внёс',type:'enum',w:130,val:x=>whoName(x.by),hide:true},
 {key:'files',label:'Файлы',type:'int',w:90,num:true,val:x=>x.files,html:x=>x.files?`${ic('clip','sm')} ${x.files}`:'<span class="faint">—</span>',hide:true},
 {key:'rep',label:'Отчёт',type:'text',w:160,val:x=>x.rep||'',hide:true},
 {key:'per',label:'Период',type:'text',w:140,val:x=>x.per||'',hide:true},
 {key:'proj',label:'Проект',type:'text',w:200,val:x=>x.proj||'',hide:true},
 {key:'note',label:'Комментарий',type:'text',w:220,val:x=>x.note||'',hide:true}]}
/* Строка журнала открывает окно самой операции поверх журнала; переход к источнику — «Открыть источник» в окне */
const finOp=x=>x.src==='op'?{src:'op',ref:x.ref}:x.src==='fee'?{src:'fee',ref:x.ref}:x.src==='proj'?{src:'pt',ref:x.pay,own:x.ref}:{src:'svc',ref:x.ref};
function openFinRow(x){opWin(finOp(x))}
function finActions(x){const it=x.src==='svc'?svcActions(x.ref):opActs(finOp(x));return it.concat([{sep:true},{label:'Карточка контрагента',icon:'building',run:()=>openCp(CPM[x.cp])}])}
const FIN_TABS={all:'Все',tax:'Налоги',fee:'Обслуживание',proj:'Проекты и услуги',wo:'Списания и возвраты'};
function finTabs(){const fee=feat('fee')&&can('fee');return [{id:'all',label:'Все',icon:'list'},taxVis()?{id:'tax',label:'Налоги',icon:'send'}:null,fee?{id:'fee',label:'Обслуживание',icon:'coins'}:null,moneyVis()?{id:'proj',label:'Проекты и услуги',icon:'briefcase',count:SERVICES.filter(s=>!s.del&&svcStatus(s)!=='Оплачено'&&visCps(true,'fin').some(c=>c.id===s.cp)).length}:null,taxVis()?{id:'wo',label:'Списания и возвраты',icon:'gift'}:null,taxVis()?{id:'journal',label:'Журнал поступлений',icon:'wallet'}:null]}
function finAdd(){return [taxVis()?{label:'Поступление',icon:'wallet',run:()=>inDlg()}:null,can('projects')?{label:'Разовая услуга',icon:'coins',run:()=>serviceDlg()}:null].filter(Boolean)}
function renderFin(body,tab,fresh){
  if(!taxVis()&&!moneyVis()){body.innerHTML=`<div class="note">${ic('lock')}<span>Финансовые операции видны сотрудникам с правом «Учёт денег и оплата налогов», «Видеть плату за обслуживание» или «Вести проекты и разовые услуги».</span></div>`;return}
  if(tab==='journal')return renderJournal(body,fresh);
  if(tab==='services')tab='proj';
  const m=ym(TODAY);const rs=finRows().filter(x=>ym(x.date)===m&&!x.dup);const live=a=>a.filter(x=>!x.del);const s=f=>rs.filter(f).reduce((a,x)=>a+x.amount,0);
  const inT=s(x=>x.src==='op'&&x.ref.kind==='in'),pay=s(x=>x.src==='op'&&x.ref.kind==='pay'),fee=finRows().filter(x=>x.src==='fee'&&ym(x.date)===m).reduce((a,x)=>a+x.amount,0),pj=s(x=>x.src==='proj')+live(SERVICES).reduce((a,v)=>a+live(v.pays).filter(p=>ym(p.date)===m).reduce((b,p)=>b+p.amount,0),0),wo=s(x=>x.grp==='wo');
  body.innerHTML=`<div class="plates">
    ${taxVis()?plate({id:'tax',icon:'wallet',color:'green',label:'Поступило на налоги',value:fmtM(inT,false),unit:'сом',sub:`оплачено в бюджет ${fmtM(pay,false)}`,on:tab==='tax'}):''}
    ${feat('fee')&&can('fee')?plate({id:'fee',icon:'coins',color:'purple',label:'Получено за обслуживание',value:fmtM(fee,false),unit:'сом',sub:ymLabel(m),on:tab==='fee'}):''}
    ${moneyVis()?plate({id:'proj',icon:'briefcase',color:'orange',label:'Проекты и разовые услуги',value:fmtM(pj,false),unit:'сом',sub:'получено за '+ymLabel(m).toLowerCase(),on:tab==='proj'}):''}
    ${taxVis()?plate({id:'wo',icon:'gift',color:'blue',label:'Списания и возвраты',value:fmtM(wo,false),unit:'сом',sub:ymLabel(m),on:tab==='wo'}):''}
  </div>${tab==='proj'?`<div class="note">${ic('info')}<span>Разовая услуга — одна операция со статусом оплаты. Оплаты по проектам — отдельные поступления (транши).</span></div>`:''}${tab==='fee'&&taxVis()?`<div class="note">${ic('info')}<span>Оплаты за обслуживание поступают только на счёт организации. Часть общего поступления «налоги + обслуживание» показана здесь отдельной строкой.</span></div>`:''}${finDelSw()}<div id="fg"></div>`;
  body.querySelector('.plates').onclick=e=>{const b=e.target.closest('[data-plate]');if(!b)return;go('fin',b.dataset.plate===tab?'all':b.dataset.plate)};
  finDelBind(body);
  const rows=()=>finRows(S.finDel).filter(x=>tab==='all'?!x.dup:tab==='fee'?x.grp==='fee':x.grp===tab);
  grid($('#fg',body),{id:'fin-'+tab,cols:finCols(),rows,title:'what',noun:['операция','операции','операций'],sort:{key:'date',dir:-1},preset:S.preset,simulateLoad:fresh,open:openFinRow,actions:finActions,rowClass:x=>x.del?'muted':'',
    empty:{icon:'coins',title:'Операций пока нет',add:tab==='proj'&&can('projects')?()=>serviceDlg():null}});
}
/* Журнал поступлений: одна строка — один перевод контрагента с детализацией */
/* Поступление можно изменить и удалить с причиной; уменьшить налоговую часть — только на деньги контрагента, которые ещё не потрачены на налоги */
const inMin=o=>opBase(o.kind)!==o.kind?0:Math.max(0,o.amount-CPM[o.cp].avail);
/* «Показать удалённые» — общий для вкладок модуля переключатель */
const finDelSw=()=>`<div class="row" style="justify-content:flex-end"><label class="row" style="gap:8px;cursor:pointer;flex-wrap:nowrap"><input type="checkbox" class="sw" id="fin-del" ${S.finDel?'checked':''}><span>Показать удалённые</span></label></div>`;
function finDelBind(body){const x=$('#fin-del',body);if(x)x.onchange=()=>{S.finDel=x.checked;renderPage()}}
const corrOf=o=>OPS.filter(x=>x.kind==='corr'&&x.ref===o.id).reduce((a,x)=>a+x.amount,0);
function inActions(o){return opActs({src:'op',ref:o}).concat([{sep:true},{label:'Карточка контрагента',icon:'building',run:()=>openCp(CPM[o.cp])}])}
function orgHeld(c){let b=0;OPS.forEach(o=>{if(o.cp!==c.id||!OPK[o.kind])return;if(o.kind==='xfer'){b-=o.amount;return}if(o.holder!=='org')return;b+=['in','back','corr'].includes(o.kind)?o.amount:-o.amount});return Math.max(0,b)}
function xferDlg(c){const max=Math.min(orgHeld(c),c.avail);openModal({form:true,render:()=>({title:'Перевод на счёт сотрудника',sub:`${esc(c.name)} · на счёте организации ${som(max)}`,body:`<div class="form">${fld('Кому',sel('xf-to',EMP.filter(e=>e.active&&e.role!=='owner').map(e=>[e.id,e.fio+(e.id===c.resp?' — ответственный':'')]),c.resp),{req:true,id:'xf-to'})}${fld('Сумма',inp('xf-sum',fmtM(max,false),'inputmode="decimal"'),{req:true,id:'xf-sum',hint:'Не больше '+som(max)})}${fld('Дата',inp('xf-date',TODAY,'type="date"'),{req:true,id:'xf-date'})}${fld('Комментарий',inp('xf-note',''),{id:'xf-note',full:true})}</div><div class="note">${ic('info')}<span>Остаток контрагента не меняется: деньги только переходят со счёта организации на счёт сотрудника, который оплачивает налоги этого контрагента.</span></div>`,
  foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="xf-ok">Перевести</button>',
  mount(el,m){$('#xf-ok',el).onclick=()=>{const a=parseNum(val(el,'xf-sum'));if(!setErr(el,'xf-sum',!(a>0)?'Введите сумму':a>max+0.001?'Больше, чем есть на счёте организации по этому контрагенту':''))return;const to=val(el,'xf-to');
    OPS.push(born({id:OPID++,cp:c.id,kind:'xfer',amount:a,date:val(el,'xf-date')||TODAY,by:S.me,holder:to,from:'org',note:'Со счёта организации на счёт '+empName(to)+(val(el,'xf-note')?'. '+val(el,'xf-note'):'')}));log('cp',c.id,`Перевод ${som(a)} со счёта организации на счёт ${empName(to)}`,c.id);m.close();derive();refreshAll();toast('Перевод записан','send')}}})})}
function empBal(e){let b=0;OPS.forEach(o=>{if(o.holder!==e.id||!OPK[o.kind])return;b+=['in','back','corr','xfer'].includes(o.kind)?o.amount:-o.amount});return b}
function renderJournal(body,fresh){
  body.innerHTML=`<div class="note">${ic('info')}<span>Контрагент может перевести одну общую сумму сразу за несколько налогов, например «Укс»: 15 000 сом = ЕН 5 000 + Соцфонд 5 000 + ПН 5 000. Общая сумма может быть больше детализации (излишек — аванс), но не меньше. Поступление можно изменить или удалить с причиной; уменьшить его можно только на деньги, которые ещё не потрачены на налоги.</span></div>${finDelSw()}<div id="jg"></div>`;finDelBind(body);
  const rows=()=>{const vc=new Set(visCps(true,'fin').map(c=>c.id));return OPS.filter(o=>(o.kind==='in'||S.finDel&&o.kind==='in_x')&&vc.has(o.cp))};const dl=o=>o.kind!=='in';
  grid($('#jg',body),{id:'fin-journal',cols:[
    {key:'date',label:'Дата',type:'date',w:110,val:o=>o.date},
    {key:'cp',label:'Контрагент',type:'enum',w:220,val:o=>CPM[o.cp].name,html:o=>`<span class="strong">${esc(CPM[o.cp].name)}</span>`},
    {key:'total',label:'Общая сумма',type:'money',w:140,num:true,total:true,val:o=>dl(o)?null:o.total??o.amount,html:o=>dl(o)?`<span class="faint strike">${fmtM(o.total??o.amount)}</span> <span class="tag red">удалено</span>`:fmtM(o.total??o.amount)+(o.edited?' <span class="tag yellow">изменено</span>':'')},
    {key:'dist',label:'Распределено',type:'money',w:140,num:true,total:true,val:o=>dl(o)?null:(o.alloc||[]).reduce((a,x)=>a+x.a,0)+(o.feeAlloc||[]).reduce((a,x)=>a+x.a,0)},
    {key:'alloc',label:'Детализация',type:'text',w:360,hide:true,val:o=>allocText(o)||'аванс',html:o=>(o.alloc||[]).length+(o.feeAlloc||[]).length>1?`<span class="tag">${(o.alloc||[]).length+(o.feeAlloc||[]).length} строки</span> ${esc(allocText(o))}`:esc(allocText(o)||'аванс')},
    {key:'tax',label:'На налоги',type:'money',w:130,num:true,total:true,val:o=>dl(o)?null:o.amount,hide:true},
    {key:'fee',label:'За обслуживание',type:'money',w:140,num:true,total:true,val:o=>dl(o)?null:(o.feeAlloc||[]).reduce((a,x)=>a+x.a,0),hide:!(feat('fee')&&can('fee'))},
    {key:'adv',label:'Остаток (аванс)',type:'money',w:140,num:true,total:true,val:o=>dl(o)?null:advOf(o)},
    {key:'corr',label:'Обратные записи',type:'money',w:130,num:true,val:o=>corrOf(o)||null,hide:true},
    {key:'ed',label:'Изменение',type:'enum',w:190,val:o=>dl(o)?'Удалено':inMin(o)>0?'Частично потрачено':'Можно изменить',html:o=>dl(o)?'<span class="faint">—</span>':inMin(o)>0?`<span class="pill sm" title="На налоги уже потрачено ${esc(som(inMin(o)))}">${ic('lock')}не меньше ${fmtM(inMin(o)+(o.feeAlloc||[]).reduce((a,x)=>a+x.a,0),false)}</span>`:`<span class="pill green sm">${ic('edit')}можно изменить</span>`},
    {key:'files',label:'Файл',type:'int',w:90,num:true,val:o=>(o.files||[]).length,html:o=>(o.files||[]).length?`${ic('clip','sm')} ${(o.files||[]).length}`:'<span class="faint">—</span>'},
    {key:'by',label:'Кто внёс',type:'enum',w:130,val:o=>whoName(o.by),hide:true},
    {key:'note',label:'Комментарий',type:'text',w:220,val:o=>o.note||'',hide:true},
    {key:'holder',label:'На счёт',type:'enum',w:140,val:o=>o.holder==='org'?'Организации':empName(o.holder),hide:true}],
    rows,title:'cp',noun:['поступление','поступления','поступлений'],sort:{key:'date',dir:-1},preset:S.preset,simulateLoad:fresh,open:inCard,actions:inActions,rowClass:o=>dl(o)?'muted':'',empty:{icon:'wallet',title:'Поступлений пока нет'}});
}
function inCard(o){opWin({src:'op',ref:o})}
function corrDlg(o){const c=CPM[o.cp];
  openModal({form:true,render:()=>({title:'Обратная запись к поступлению',sub:`${esc(c.name)} · ${som(o.total??o.amount)} от ${fmtD(o.date)}`,body:`<div class="form">${fld('Что сделать',sel('cr-sign',[['-','Уменьшить: поступило меньше'],['+','Увеличить: поступило больше']],'-'),{id:'cr-sign'})}${fld('Сумма, сом',inp('cr-sum','','inputmode="decimal" class="inp tnum"'),{req:true,id:'cr-sum'})}${fld('Дата',inp('cr-date',TODAY,'type="date"'),{req:true,id:'cr-date'})}<div></div>${fld('Причина',inp('cr-why','','placeholder="Например: ошибка в сумме платёжки"'),{req:true,full:true,id:'cr-why'})}</div>
    <div class="note">${ic('info')}<span>Обратная запись — отдельная строка журнала с причиной. Исходное поступление и оплаты налогов не меняются, остаток на счёте пересчитается. Если денег на неоплаченные налоги станет меньше, у них появится «Недостача». Всё попадает в историю.</span></div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="cr-ok">Записать</button>',
    mount(el,m){$('#cr-ok',el).onclick=()=>{const n=parseNum(val(el,'cr-sum'));const minus=val(el,'cr-sign')==='-';
      const ok=[setErr(el,'cr-sum',isNaN(n)||n<=0?'Введите сумму больше нуля':minus&&n>Math.min(c.avail,(o.amount||0)+corrOf(o))?`Уменьшить можно не больше чем на ${som(Math.max(0,Math.min(c.avail,(o.amount||0)+corrOf(o))))}: столько осталось на счёте от денег контрагента и от этого поступления`:''),setErr(el,'cr-why',val(el,'cr-why')?'':'Укажите причину')].every(Boolean);if(!ok)return;
      const amt=minus?-n:n;const x={id:OPID++,cp:c.id,kind:'corr',amount:amt,date:val(el,'cr-date')||TODAY,by:S.me,holder:o.holder,ref:o.id,note:`К поступлению от ${fmtD(o.date)}: ${val(el,'cr-why')}`,_cb:S.me,_ca:nowStamp()};OPS.push(x);
      HIST.push({at:nowStamp(),who:S.me,ent:'in',id:o.id,cp:c.id,what:`Обратная запись ${amt>0?'+':'−'}${som(n)}: ${val(el,'cr-why')}`});log('cp',c.id,`Обратная запись к поступлению от ${fmtD(o.date)}: ${amt>0?'+':'−'}${som(n)}`,c.id);m.close();refreshAll();toast('Обратная запись сделана')}}})});
}
function renderServices(body,fresh){body.innerHTML='<div id="sg"></div>';
  grid($('#sg',body),{id:'fin-svc',cols:[{key:'date',label:'Дата',type:'date',w:110,val:s=>s.date},{key:'cp',label:'Контрагент',type:'enum',w:220,val:s=>CPM[s.cp].name,html:s=>`<span class="strong">${esc(CPM[s.cp].name)}</span>${CPM[s.cp].kind==='oneoff'?' <span class="tag">разовый</span>':''}`},{key:'name',label:'Услуга',type:'text',w:300,val:s=>s.name},{key:'resp',label:'Исполнитель',type:'enum',w:130,val:s=>empName(s.resp)},
    {key:'amount',label:'Стоимость',type:'money',w:130,num:true,total:true,val:s=>s.amount},{key:'paid',label:'Получено',type:'money',w:130,num:true,total:true,val:s=>svcPaid(s)},{key:'left',label:'Осталось',type:'money',w:130,num:true,total:true,val:s=>s.amount-svcPaid(s),html:s=>s.amount>svcPaid(s)?`<span class="red strong">${fmtM(s.amount-svcPaid(s))}</span>`:'<span class="faint">0,00</span>'},
    {key:'st',label:'Оплата',type:'enum',w:170,val:svcStatus,html:s=>pill(svcStatus(s),PST)},{key:'files',label:'Файлов',type:'int',w:90,num:true,val:s=>s.files.length,hide:true}],
    rows:()=>{const vc=new Set(visCps(true,'fin').map(c=>c.id));return SERVICES.filter(s=>vc.has(s.cp)&&!s.del)},title:'name',noun:['услуга','услуги','услуг'],sort:{key:'date',dir:-1},preset:S.preset,simulateLoad:fresh,open:serviceCard,actions:svcActions,
    empty:{icon:'coins',title:'Разовых услуг пока нет',add:can('projects')?()=>serviceDlg():null}})}


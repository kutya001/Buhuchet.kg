'use strict';
// Окно финансовой операции: просмотр, «Изменить» и «Удалить» с причиной, удалённые операции
/* Решение заказчика 24.10.2026: клик по операции открывает окно самой операции, а не источник; там же «Изменить» и «Удалить».
   d — ссылка на операцию: {src:'op',ref:o} · {src:'fee',ref:f} · {src:'pt',ref:транш,own:проект} · {src:'sp',ref:оплата,own:услуга} · {src:'svc',ref:услуга}.
   Удалённая запись не стирается: у операции OPS вид получает «_x» (как у отменённых), у остальных — отметка del {at,by,why}; в суммы, сверки и итоги она не входит. */
const opBase=k=>k&&k.endsWith('_x')?k.slice(0,-2):k;
const opKind=d=>d.src==='op'?opBase(d.ref.kind):d.src;
const opCpId=d=>d.own?d.own.cp:d.ref.cp;
const opDelOf=d=>d.src==='op'?(d.ref.kind.endsWith('_x')?{at:d.ref.xAt,by:d.ref.xBy,why:d.ref.xWhy}:null):d.ref.del||(d.own&&d.own.del)||null;
const OP_OWN={fee:['Оплата за обслуживание','purple'],pt:['Оплата по проекту','blue'],sp:['Оплата разовой услуги','orange'],svc:['Разовая услуга','orange']};
const opMeta=d=>d.src==='op'&&d.ref.self&&opKind(d)==='pay'?OP_SELF:OPK[opKind(d)]||OP_OWN[opKind(d)];
const opAmt=d=>{const x=d.ref;return d.src!=='op'?x.amount:opBase(x.kind)==='in'?(x.total??x.amount):Math.abs(x.amount)};
const permTitle=p=>(PERM_REF.find(x=>x.id===p)||{name:p}).name;
const accName=a=>a==='org'?'счёт организации':a==='client'?'контрагент оплатил сам, без наших счетов':'счёт '+empName(a);
// Номер новой оплаты за обслуживание: не повторяет уже выданные (записи не удаляются, но части поступления пересоздаются при его изменении)
function fpId(){let i=FEEPAYS.length+1;while(FEEPAYS.some(f=>f.id==='f'+i+'n'))i++;return 'f'+i+'n'}
// В форме изменения поступления: сколько уже потрачено на налоги и какие оплаты мешают уменьшить его сильнее
function inEditNote(o){const b=inBlock(o,0);return b?`<div class="note warn">${ic('lock')}<span>Из этого поступления на налоги уже потрачено ${som(b.min)}: на налоги должно остаться не меньше этой суммы. Чтобы уменьшить сильнее, сначала измените или удалите оплату налога — нажмите на неё в списке.</span></div>${b.html}`:''}
// Ссылка на операцию в разметке: data-opw="op:12" · "fee:f3" · "pt:p1:2" · "sp:s1:s1p1"
const opKey=d=>d.src==='pt'||d.src==='sp'?`${d.src}:${d.own.id}:${d.ref.id}`:`${d.src}:${d.ref.id}`;
function opFind(k){const [s,a,b]=String(k).split(':');
  if(s==='op'){const o=OPS.find(x=>String(x.id)===a);return o&&{src:'op',ref:o}}
  if(s==='fee'){const f=FEEPAYS.find(x=>x.id===a);return f&&{src:'fee',ref:f}}
  if(s==='pt'){const p=PROJECTS.find(x=>x.id===a),x=p&&p.pays.find(y=>String(y.id)===b);return x&&{src:'pt',ref:x,own:p}}
  if(s==='sp'){const v=SERVICES.find(x=>x.id===a),x=v&&v.pays.find(y=>String(y.id)===b);return x&&{src:'sp',ref:x,own:v}}
  if(s==='svc'){const v=SERVICES.find(x=>x.id===a);return v&&{src:'svc',ref:v}}
  return null}
// Изменять и удалять может тот, кто вносит операции этого типа
function opPerm(d){const k=opKind(d);return k==='bonus'?'bonus':k==='fee'?'tariff':['pt','sp','svc'].includes(k)?'projects':'money'}
function opLock(d,act){const k=opKind(d),x=d.ref,c=CPM[opCpId(d)];
  if(opDelOf(d))return d.own&&d.own.del?'Услуга удалена':'Операция удалена';
  if(k==='back')return 'Операцию создала система (возврат по уточнённому расчёту): вручную она не изменяется и не удаляется';
  const p=opPerm(d);if(!(can(p)||(c.archived&&['bonus','refund'].includes(k)&&can('archiveRest'))))return `Только просмотр: нужно право «${permTitle(p)}»`;
  if(c.archived&&!['bonus','refund'].includes(k))return 'Контрагент в архиве: операции только для просмотра';
  if(['pay','bonus','refund'].includes(k)&&CLOSED.has(ym(x.date)))return 'Месяц закрыт: внесите корректирующую запись';
  if(k==='fee'&&x.op){if(act==='del')return 'Эта оплата — часть общего поступления: уберите её через «Изменить» или удалите поступление целиком';if(!can('money'))return 'Эта оплата — часть общего поступления: его изменяет сотрудник с правом «Учёт денег и оплата налогов»'}
  return ''}
// Поля операции так, как их вводили
function opView(d){const x=d.ref,k=opKind(d),c=CPM[opCpId(d)],m=opMeta(d);
  const v={k,c,x,label:m[0],color:m[1],amount:opAmt(d),date:x.date,note:x.note||'',acc:x.holder||'org',del:opDelOf(d),edited:!!x.edited,files:x.files=x.files||[]};
  if(d.src==='op'){const r=x.report&&REPORTS.find(y=>y.id===x.report);v.rep=r;v.hist={ent:k==='in'?'in':'op',id:x.id};v.aud=x._cb?x:Object.assign({_cb:x.by,_ca:x.date+' 00:00'},x);
    v.what=k==='in'?(allocText(x)||'Аванс'):k==='pay'&&r?`${T[r.t].short} · ${r.plabel}`:k==='xfer'?'Со счёта организации на '+accName(x.holder):x.note||'—';
    v.src=r?[`Отчёт ${T[r.t].short} · ${r.plabel}`,()=>openReport(r)]:['Карточка контрагента, вкладка «Деньги»',()=>openCp(c,'money')]}
  if(d.src==='fee'){const o=x.op&&OPS.find(y=>y.id===x.op);v.in=o;v.hist={ent:'fp',id:x.id};v.aud=x._cb?x:Object.assign({_cb:x.by,_ca:x._ca||x.date+' 10:00'},x);v.what=fpWhat(x);v.to=x.to;
    v.src=o?[`Общее поступление ${som(o.total??o.amount)} от ${fmtD(o.date)}`,()=>opWin({src:'op',ref:o})]:['Карточка контрагента, вкладка «Обслуживание»',()=>openCp(c,'fee')]}
  if(d.src==='pt'){const p=d.own;v.hist={ent:'p',id:p.id,sub:x.id};v.aud={_cb:x.by,_ca:x._ca||x.date+' 10:00',_ub:x._ub,_ua:x._ua};v.what=p.name+(x.note?' · '+x.note:'');v.src=[`Проект «${p.name}»`,()=>openProject(p)]}
  if(d.src==='sp'){const s=d.own;v.hist={ent:'s',id:s.id,sub:x.id};v.aud={_cb:x.by,_ca:x._ca||x.date+' 10:00',_ub:x._ub,_ua:x._ua};v.what=s.name;v.src=[`Разовая услуга «${s.name}»`,()=>serviceCard(s)]}
  if(d.src==='svc'){v.hist={ent:'s',id:x.id};v.aud=x;v.what=x.name;v.src=[`Разовая услуга «${x.name}»`,()=>serviceCard(x)]}
  return v}
function opLog(d,what){HIST.push(Object.assign({at:nowStamp(),who:S.me,cp:opCpId(d),what},opView(d).hist));ckSoon();touch(d.own||null);if(d.src==='svc')touch(d.ref)}
function opHistHtml(h){const hs=HIST.filter(e=>e.ent===h.ent&&e.id===h.id&&(h.sub==null||e.sub===h.sub)).sort((a,b)=>a.at<b.at?1:-1);
  return `<div class="box"><h3>История изменений</h3>${hs.length?`<ul class="tl">${hs.map(e=>`<li><span class="t">${fmtD(e.at.slice(0,10))}<br>${e.at.slice(11)}</span><span>${esc(e.what)}<br><span class="w">${esc(whoName(e.who))}</span></span></li>`).join('')}</ul>`:'<span class="faint">Изменений не было</span>'}</div>`}
// Кнопка, которую нельзя нажать: видна приглушённой, по нажатию — подсказка почему (на телефоне title не виден)
const opBtn=(id,icon,label,why,cls='')=>`<button class="btn ${cls} ${why?'dis':''}" id="${id}" ${why?`aria-disabled="true" title="${esc(why)}" data-why="${esc(why)}"`:''}>${ic(icon,'sm')}${label}</button>`;
function opWin(d){if(!d)return;if(d.src==='svc')return serviceCard(d.ref);
  openModal({size:'mid',live:true,render:()=>{const v=opView(d),x=d.ref,c=v.c,k=v.k;const eL=opLock(d,'edit'),dL=opLock(d,'del');
    const kv=[['Тип операции',`<span class="pill sm ${v.color}">${esc(v.label)}</span>`],['Контрагент',`<button class="linkbtn" id="ow-cp">${esc(c.name)}</button>`],['Дата',fmtD(v.date)],
      ['Сумма',`<span class="tnum strong">${k==='corr'?(x.amount<0?'−':'+'):''}${som(v.amount)}</span>`]];
    if(k==='in'){const fa=(x.feeAlloc||[]).reduce((a,y)=>a+y.a,0);kv.push(['На налоги',`<span class="tnum">${som(x.amount)}</span>`]);if(fa)kv.push(['За обслуживание',`<span class="tnum">${som(fa)}</span>`]);kv.push(['Аванс',`<span class="tnum">${som(advOf(x))}</span>`])}
    else kv.push(['За что',v.rep?`<button class="linkbtn" id="ow-rep">${esc(v.what)}</button>`:esc(v.what)]);
    if(d.src==='pt'){const p=d.own;kv.push(['Проект: получено',`<span class="tnum">${som(projPaid(p))}${p.plan?' из '+som(p.plan):''}</span>`])}
    if(d.src==='sp'){const s=d.own;kv.push(['Услуга: получено',`<span class="tnum">${som(svcPaid(s))} из ${som(s.amount)}</span>`])}
    kv.push(k==='fee'?['Куда поступили',`${ic(v.to==='owner'?'user':'building','sm')} ${esc(fpToName(v.to||'org'))}`]:[k==='xfer'?'На счёт':'Счёт',v.acc==='org'?`${ic('building','sm')} организации`:v.acc==='client'?`${ic('building','sm')} не наш: контрагент оплатил сам`:`${ic('user','sm')} сотрудника ${esc(empName(v.acc))}`]);
    if(v.note&&v.note!==v.what)kv.push(['Примечание',esc(v.note)]);
    const corr=k==='in'?OPS.filter(y=>y.kind==='corr'&&y.ref===x.id):[];
    const lockNote=!v.del&&(eL||dL)?`<div class="note">${ic('lock')}<span>${esc(eL||dL)}</span></div>`:'';
    return {title:`${esc(v.label)} ${som(v.amount)}`,sub:`${esc(c.name)} · ${fmtD(v.date)}`,
    body:`${v.del||v.edited?`<div class="row">${v.del?`<span class="pill red">${ic('trash')}Удалена</span>`:''}${v.edited?`<span class="pill yellow">${ic('edit')}Изменена</span>`:''}</div>`:''}
    ${v.del?`<div class="note bad">${ic('trash')}<span><b>Удалена</b> · ${esc(whoName(v.del.by))}, ${fmtDT(v.del.at)}${v.del.why?`. Причина: ${esc(v.del.why)}`:''}. В суммы, сверки и итоги не входит.</span></div>`:lockNote}
    ${k==='fee'&&v.in?`<div class="note">${ic('info')}<span>Часть общего поступления ${som(v.in.total??v.in.amount)} от ${fmtD(v.in.date)}: сумму и месяц меняют в самом поступлении.</span></div>`:''}
    <div class="box"><div class="kv">${kv.map(([a,b])=>`<div><span class="k">${a}</span><span class="v">${b}</span></div>`).join('')}${auditKv(v.aud)}</div></div>
    ${k==='in'?`<div class="box"><h3>Детализация</h3><table class="mini"><thead><tr><th>За что</th><th class="num">Сумма</th></tr></thead><tbody>${(x.alloc||[]).map(y=>{const r=REPORTS.find(z=>z.id===y.r);return `<tr class="clk" data-rep="${y.r}"><td>${r?esc(T[r.t].short+' · '+r.plabel):'—'}</td><td class="num">${fmtM(y.a)}</td></tr>`}).join('')}${(x.feeAlloc||[]).map(y=>`<tr><td>${ic('coins','sm')} Обслуживание · ${esc(ymLabel(y.m))}</td><td class="num">${fmtM(y.a)}</td></tr>`).join('')}${advOf(x)>0?`<tr><td class="muted">Аванс, не распределён</td><td class="num">${fmtM(advOf(x))}</td></tr>`:''}<tr><td><b>Итого</b></td><td class="num"><b>${fmtM(x.total??x.amount)}</b></td></tr></tbody></table></div>`:''}
    ${corr.length?`<div class="box"><h3>Обратные записи</h3><table class="mini"><tbody>${corr.map(y=>`<tr class="clk" data-opw="op:${y.id}"><td>${fmtD(y.date)}</td><td>${esc(y.note)}</td><td>${esc(whoName(y.by))}</td><td class="num">${y.amount>0?'+':''}${fmtM(y.amount)}</td></tr>`).join('')}</tbody></table></div>`:''}
    ${filesBox(v.files,'ow-f',!v.del&&!eL,'Файлы',{ent:v.hist.ent,id:v.hist.id,cp:c.id})}${opHistHtml(v.hist)}`,
    foot:`${v.del?'':opBtn('ow-del','trash','Удалить',dL)+(k==='in'?opBtn('ow-corr','refresh','Обратная запись',eL):'')+opBtn('ow-edit','edit','Изменить',eL)}<div class="grow"></div><button class="btn" id="ow-src" title="${esc(v.src[0])}">${ic('link','sm')}Открыть источник</button><button class="btn cta" data-close>Готово</button>`,
    mount(el,m){const q=s=>el.querySelector(s);
      $$('[data-why]',el).forEach(b=>b.onclick=()=>toast(b.dataset.why,'lock',true));
      if(q('#ow-edit:not(.dis)'))q('#ow-edit').onclick=()=>opEditDlg(d);
      if(q('#ow-del:not(.dis)'))q('#ow-del').onclick=()=>opDelDlg(d);
      if(q('#ow-corr:not(.dis)'))q('#ow-corr').onclick=()=>corrDlg(x);
      q('#ow-src').onclick=()=>{m.close();v.src[1]()};q('#ow-cp').onclick=()=>openCp(c,d.src==='fee'?'fee':'money');if(q('#ow-rep'))q('#ow-rep').onclick=()=>openReport(v.rep);
      $$('[data-rep]',el).forEach(y=>y.onclick=()=>openReport(REPORTS.find(r=>r.id===+y.dataset.rep)));
      bindFiles(el,'ow-f',v.files,f=>{opLog(d,'Прикреплены файлы: '+f.join(', '));m.draw()})}}}});
}
// Пункты меню строки: те же действия, что в окне; «Отменить списание» и «Отменить возврат» — это «Удалить»
function opActs(d,open=true){const v=opView(d),k=v.k;if(v.del)return [open&&{label:'Открыть',icon:'list',run:()=>opWin(d)},{label:'Открыть источник',icon:'link',sub:v.src[0],run:v.src[1]}].filter(Boolean);
  const eL=opLock(d,'edit'),dL=opLock(d,'del');
  return [open&&{label:'Открыть',icon:'list',run:()=>opWin(d)},{label:'Изменить',icon:'edit',disabled:!!eL,reason:eL,run:()=>opEditDlg(d)},
    k==='in'?{label:'Обратная запись',icon:'refresh',sub:'С причиной, исходная запись остаётся',disabled:!!eL,reason:eL,run:()=>corrDlg(d.ref)}:null,
    {label:'Открыть источник',icon:'link',sub:v.src[0],run:v.src[1]},{sep:true},
    {label:k==='bonus'?'Отменить списание':k==='refund'?'Отменить возврат':'Удалить',icon:['bonus','refund'].includes(k)?'history':'trash',danger:true,disabled:!!dL,reason:dL,run:()=>opDelDlg(d)}].filter(Boolean)}
// Ограничение суммы при изменении: поступление — не ниже потраченного, списание и оплата — не больше свободных денег, транш — не больше плана
function opMax(d){const k=opKind(d),x=d.ref,c=CPM[opCpId(d)],a=opAmt(d);
  if(k==='pay'&&!x.self)return {max:a+c.avail,msg:`Денег контрагента не хватает: на счёте ещё ${som(c.avail)}, оплата может быть не больше ${som(a+c.avail)}`};
  if(k==='bonus'||k==='refund')return {max:a+c.free,msg:`Свободный остаток контрагента ${som(c.free)}: сумма может быть не больше ${som(a+c.free)}`};
  if(k==='xfer')return {max:orgHeld(c)+a,msg:`На счёте организации по этому контрагенту ${som(orgHeld(c))}: перевод может быть не больше ${som(orgHeld(c)+a)}`};
  if(k==='pt'&&d.own.plan){const mx=d.own.plan-(projPaid(d.own)-a);return {max:mx,msg:`Больше планируемой стоимости проекта: транш может быть не больше ${som(mx)}`}}
  if(k==='sp'){const mx=d.own.amount-(svcPaid(d.own)-a);return {max:mx,msg:`Больше стоимости услуги: оплата может быть не больше ${som(mx)}`}}
  return {max:null}}
function opEditDlg(d){const k=opKind(d),x=d.ref;const L=opLock(d,'edit');if(L)return toast(L,'lock',true);
  if(k==='in')return inDlg(CPM[x.cp],x);
  if(k==='svc')return serviceDlg(x);
  if(k==='fee')return x.op?inDlg(CPM[x.cp],OPS.find(y=>y.id===x.op)):feePayDlg(CPM[x.cp],x);
  const v=opView(d),c=v.c,a0=v.amount,sg0=k==='corr'?(x.amount<0?'-':'+'):null;
  const note0=k==='xfer'?(x.note||'').replace(/^Со счёта организации на счёт [^.]*\.?\s*/,''):v.note;
  const hasAcc=['pay','bonus','refund','corr','xfer'].includes(k)&&!x.self;
  const accs=[...(k==='xfer'?[]:[['org','Счёт организации']]),...EMP.filter(e=>(e.active&&e.role!=='owner')||e.id===x.holder).map(e=>[e.id,'Счёт '+e.short+(e.id===c.resp?' — ответственный':'')])];
  const lim=opMax(d);const sgn=s=>s==null?'':s==='-'?'−':'+';
  openModal({form:true,render:()=>({title:'Изменить: '+v.label.toLowerCase(),sub:`${esc(c.name)} · ${sgn(sg0)}${som(a0)} от ${fmtD(x.date)}`,body:`<div class="form">
    ${k==='corr'?fld('Что сделать',sel('oe-sign',[['-','Уменьшить: поступило меньше'],['+','Увеличить: поступило больше']],sg0),{id:'oe-sign',full:true}):''}
    ${fld('Сумма, сом',inp('oe-sum',String(a0),'inputmode="decimal" class="inp tnum"'),{req:true,id:'oe-sum',hint:lim.max!=null?'Не больше '+som(lim.max):''})}${fld('Дата',inp('oe-date',x.date,`type="date" max="${TODAY}"`),{req:true,id:'oe-date'})}
    ${hasAcc?fld(k==='xfer'?'Кому':'Счёт',sel('oe-acc',accs,x.holder),{id:'oe-acc'}):''}
    ${fld(k==='bonus'?'Причина списания':'Примечание',inp('oe-note',note0),{full:true,id:'oe-note'})}
    ${fld('Добавить файлы',`<input class="inp" type="file" id="oe-f" multiple>`,{full:true,id:'oe-f',hint:v.files.length?`Уже приложено: ${v.files.length}`:''})}
    ${fld('Причина изменения',`<textarea class="inp" id="oe-why" style="min-height:56px" placeholder="Например: ошибка в сумме платёжки"></textarea>`,{full:true,id:'oe-why',hint:'Обязательна, если меняются сумма, дата'+(hasAcc?' или счёт':'')})}</div>
    <div class="note">${ic('info')}<span>Контрагента и тип операции поменять нельзя — такую операцию удаляют и вносят заново. Изменение попадёт в историю операции: было → стало, кто, когда, причина. Статусы оплаты, остаток и баланс счёта пересчитаются сами.</span></div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="oe-ok">Сохранить</button>',
    mount(el,m){$('#oe-ok',el).onclick=()=>{const n=parseNum(val(el,'oe-sum')),dt=val(el,'oe-date'),sg=k==='corr'?val(el,'oe-sign'):null,acc=hasAcc?val(el,'oe-acc'):null,note=val(el,'oe-note'),why=val(el,'oe-why');
      const s0=k==='corr'?x.amount:a0,s1=k==='corr'?(sg==='-'?-n:n):n;
      const ch=[];if(Math.abs(s1-s0)>0.001)ch.push(`сумма ${sgn(sg0)}${fmtM(a0)} → ${sgn(sg)}${fmtM(n)} сом`);if(dt!==x.date)ch.push(`дата ${fmtD(x.date)} → ${fmtD(dt)}`);
      if(acc&&acc!==x.holder)ch.push(`счёт: ${accName(x.holder)} → ${accName(acc)}`);
      const files=[...$('#oe-f',el).files].map(f=>f.name),nch=note!==note0;
      const ok=[setErr(el,'oe-sum',isNaN(n)||n<=0?'Введите сумму больше нуля':lim.max!=null&&n>lim.max+0.001?lim.msg:k==='corr'&&s1-s0<-0.001&&s0-s1>c.avail+0.001?`Уменьшить остаток можно не больше чем на ${som(c.avail)}: столько денег контрагента не потрачено`:''),
        setErr(el,'oe-date',!dt?'Укажите дату':dt>TODAY?'Дата не может быть позже сегодняшней':['pay','bonus','refund'].includes(k)&&CLOSED.has(ym(dt))?'Этот месяц закрыт: перенести операцию в него нельзя':''),
        setErr(el,'oe-why',ch.length&&!why?'Укажите причину: меняется '+ch.map(s=>s.split(/[ :]/)[0]).join(', '):'')].every(Boolean);if(!ok)return;
      if(!ch.length&&!nch&&!files.length){m.close();return toast('Без изменений')}
      if(k==='pay'){const r=REPORTS.find(y=>y.id===x.report);if(r)r.paid=Math.max(0,Math.round((r.paid-a0+n)*100)/100)}

      x.amount=s1;x.date=dt;if(acc)x.holder=acc;x.note=k==='xfer'?'Со счёта организации на счёт '+empName(acc)+(note?'. '+note:''):note;files.forEach(f=>FUP.add(f));x.files.push(...files);
      if(ch.length||nch)x.edited=true;touch(x);
      opLog(d,`Изменено: ${[...ch,nch?`примечание «${note0||'—'}» → «${note||'—'}»`:'',files.length?'добавлены файлы: '+files.join(', '):''].filter(Boolean).join('; ')}${why?`. Причина: ${why}`:''}`);
      m.close();refreshAll();toast('Операция изменена','edit')}}})});
}
// Деньги поступления уже потрачены на налоги: какие оплаты мешают его уменьшить или удалить
function inBlock(o,newTax){const c=CPM[o.cp];const need=o.amount-newTax-c.avail;if(need<=0.001)return null;
  const rs=new Set((o.alloc||[]).map(x=>x.r));const pays=OPS.filter(p=>p.cp===o.cp&&p.kind==='pay').sort((a,b)=>(rs.has(b.report)-rs.has(a.report))||(a.date<b.date?1:-1)).slice(0,8);
  return {min:Math.max(0,o.amount-c.avail),html:`<table class="mini"><thead><tr><th>Оплата налога</th><th>Дата</th><th class="num">Сумма</th></tr></thead><tbody>${pays.map(p=>{const r=REPORTS.find(y=>y.id===p.report);return `<tr class="clk" data-opw="op:${p.id}"><td>${r?esc(T[r.t].short+' · '+r.plabel):esc(p.note||'—')}</td><td>${fmtD(p.date)}</td><td class="num">${fmtM(p.amount)}</td></tr>`}).join('')}</tbody></table>`}}
function opDelDlg(d){const L=opLock(d,'del');if(L)return toast(L,'lock',true);const v=opView(d),k=v.k,x=d.ref,c=v.c;
  const blk=k==='in'?inBlock(x,0):null;const neg=k==='corr'&&x.amount>0&&x.amount>c.avail+0.001;
  const T_={bonus:['Отменить списание в бонус?','Отменить списание','Списание отменено'],refund:['Отменить возврат контрагенту?','Отменить возврат','Возврат отменён']}[k]||['Удалить операцию?','Удалить','Операция удалена'];
  const fa=k==='in'?(x.feeAlloc||[]).reduce((a,y)=>a+y.a,0):0;
  const cons=({in:()=>`Деньги уйдут из остатка контрагента${(x.alloc||[]).length?', отчёты из детализации снова будут ждать денег':''}.${fa?` Оплата за обслуживание из этого поступления (${som(fa)}) тоже удалится, долг пересчитается.`:''}`,
    pay:()=>`Сумма вернётся в остаток контрагента, статус оплаты ${v.rep?'отчёта '+esc(T[v.rep.t].short+' · '+v.rep.plabel):'отчёта'} пересчитается.`,bonus:()=>`Сумма вернётся в свободный остаток контрагента, бонус сотрудника ${esc(empName(x.holder))} уменьшится.`,refund:()=>'Сумма вернётся в свободный остаток контрагента.',
    xfer:()=>'Деньги вернутся на счёт организации.',corr:()=>'Остаток контрагента пересчитается.',fee:()=>fpAlloc(x).length?`Долг за обслуживание за ${esc(fpAlloc(x).map(y=>ymLabel(y.m)).join(', '))} пересчитается.`:'Аванс за обслуживание уменьшится.',pt:()=>'«Получено» по проекту уменьшится.',sp:()=>'Статус оплаты услуги пересчитается.',
    svc:()=>{const ps=x.pays.filter(p=>!p.del);return ps.length?`Оплаты по ней (${ps.length} на ${som(sumPays(ps))}) тоже уйдут из итогов.`:''}}[k]||(()=>''))();
  openModal({form:true,render:()=>({title:blk||neg?'Удалить нельзя':T_[0],sub:`${esc(v.label)} · ${esc(c.name)} · ${som(v.amount)} от ${fmtD(v.date)}`,
    body:blk?`<div class="note warn">${ic('lock')}<span>Из этого поступления уже оплачены налоги: не потрачено только ${som(c.avail)} из ${som(x.amount)}. Сначала измените или удалите оплату налога:</span></div>${blk.html}`
      :neg?`<div class="note warn">${ic('lock')}<span>Эти деньги уже потрачены: на счёте контрагента ${som(c.avail)}. Сначала измените или удалите оплату налога.</span></div>`
      :`<p style="margin:0">${k==='bonus'||k==='refund'?`${T_[1]} на ${som(v.amount)}?`:`Удалить операцию на ${som(v.amount)}?`} Суммы и статусы оплаты пересчитаются.</p><div class="note">${ic('history')}<span>${cons} Запись не стирается: она получит отметку «Удалена», уйдёт из сумм, сверок и итогов и будет видна в журнале с фильтром «Показать удалённые».</span></div>${fld('Причина',`<textarea class="inp" id="od-why" style="min-height:64px" placeholder="Например: внесли по ошибке"></textarea>`,{req:true,full:true,id:'od-why'})}`,
    foot:blk||neg?'<button class="btn cta" data-close>Понятно</button>':`<button class="btn ghost" data-close>Отмена</button><button class="btn danger" id="od-ok">${ic(k==='bonus'||k==='refund'?'history':'trash','sm')}${T_[1]}</button>`,
    mount(el,m){if(!$('#od-ok',el))return;$('#od-ok',el).onclick=()=>{const why=val(el,'od-why');if(!setErr(el,'od-why',why?'':'Укажите причину'))return;const mk={at:nowStamp(),by:S.me,why};
      if(d.src==='op'){x.kind=k+'_x';x.xAt=mk.at;x.xBy=S.me;x.xWhy=why;x.xDel=1;
        if(k==='pay'){const r=REPORTS.find(y=>y.id===x.report);if(r)r.paid=Math.max(0,Math.round((r.paid-x.amount)*100)/100)}
        if(k==='in')FEEPAYS.filter(f=>f.op===x.id&&!f.del).forEach(f=>{f.del=mk;fpAlloc(f).forEach(y=>{c.feePaid[y.m]=(c.feePaid[y.m]||0)-y.a})})}
      else{x.del=mk;if(d.src==='fee')fpAlloc(x).forEach(y=>{c.feePaid[y.m]=(c.feePaid[y.m]||0)-y.a})}
      opLog(d,`${T_[2]}: ${v.label.toLowerCase()} на ${som(v.amount)} от ${fmtD(v.date)}. Причина: ${why}`);m.close();refreshAll();toast(T_[2],'trash')}}})});
}
// Ссылки на операции в таблицах карточек: строка открывает окно операции, «…» — меню «Изменить / Удалить»
document.addEventListener('click',e=>{const t=e.target.closest&&e.target.closest('[data-opm],[data-opw]');if(!t)return;const d=opFind(t.dataset.opm||t.dataset.opw);if(!d)return;e.stopPropagation();
  if(t.dataset.opm)menu(t,opActs(d));else opWin(d)});
const opMenuBtn=d=>`<button class="icon-btn sm" data-opm="${esc(opKey(d))}" aria-label="Действия с операцией" title="Действия">${ic('more','sm')}</button>`;

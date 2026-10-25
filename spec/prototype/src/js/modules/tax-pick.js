'use strict';
// «Выбор налогов»: подключение видов отчётов из каталога платформы по группам — последний экран приветствия и окно «Подключить из каталога»
/* ═════════════ Выбор налогов (ТЗ «Первый запуск организации» → экран 5, «Справочники» → «Виды отчётов») ═════════════ */
// Режимы-статусы (резиденты ПВТ, ПКИ, СЭЗ) идут в группу «По статусам», а не в режимы
const TX_STREG=new Set(['ПВТ','ПКИ','СЭЗ']);
const TX_REG_ORDER=['ОНР','Единый налог','Патент'];
const txOn=id=>!!(ORG.types[id]&&ORG.types[id].on);
// Назначен ли вид действующему контрагенту: такой вид отключить нельзя
const txUsed=id=>CPS.some(c=>!c.archived&&(c.assign||[]).some(a=>a.t===id&&!a.to));
// Группы каталога: [{id,t,who,subs:[{t,ids}]}]; отчёт из нескольких групп показан в каждой, отметка общая
function txGroups(){const L=RT.filter(t=>t.active&&t.group!=='disabled');const G=[];const add=(id,t,who,subs)=>{subs=subs.filter(s=>s.ids.length);if(subs.length)G.push({id,t,who,subs})};
  const regs=[...new Set(L.filter(t=>t.kind==='regime').flatMap(t=>t.regimes||[]).filter(r=>!TX_STREG.has(r)))].sort((a,b)=>{const i=TX_REG_ORDER.indexOf(a),j=TX_REG_ORDER.indexOf(b);return (i<0?99:i)-(j<0?99:j)||a.localeCompare(b,'ru')});
  regs.forEach(r=>add('reg:'+r,r==='ОНР'?'Общий режим (ОНР)':r,`Клиенты на режиме «${REGIME_FULL[r]||r}»`,[{t:'',ids:L.filter(t=>t.kind==='regime'&&(t.regimes||[]).includes(r)).map(t=>t.id)}]));
  add('all','Для всех','Сдают все организации и ИП, без условий: декларации и годовая финансовая отчётность',[{t:'',ids:L.filter(t=>t.kind!=='regime'&&['all','optional'].includes(t.group)&&!(t.basis||[]).length).map(t=>t.id)}]);
  const bases=(DICT.bases?DICT.bases.items:[]).filter(b=>b.code!=='statSample');
  add('basis','По основаниям','Если у клиента есть сотрудники, имущество, земля, импорт и другое',bases.map(b=>({t:b.name,ids:L.filter(t=>t.kind!=='regime'&&(t.basis||[]).includes(b.code)&&t.organ!=='Нацстатком').map(t=>t.id)})));
  const bens=DICT.benefits.items;
  add('status','По статусам','Резиденты ПВТ, ПКИ, СЭЗ и другие льготы и особые статусы',[{t:'',ids:L.filter(t=>t.group==='status'||(t.regimes||[]).some(r=>TX_STREG.has(r))||bens.some(b=>(b.adds||[]).includes(t.id))).map(t=>t.id)}]);
  add('stat','Статистика','Если клиент в списке Нацстаткома: формы по труду, предприятию, инвестициям',[{t:'',ids:L.filter(t=>t.organ==='Нацстатком'||(t.basis||[]).includes('statSample')).map(t=>t.id)}]);
  return G}
// «Отметить основные»: режимные ОНР и единого налога без особых оснований, ЕНД и STI-161
const txMain=()=>RT.filter(t=>t.active&&((t.kind==='regime'&&(t.regimes||[]).some(r=>r==='ОНР'||r==='Единый налог')&&t.preselect&&t.group==='regime'&&!(t.basis||[]).length&&!(t.regimes||[]).includes('Патент'))||['endo','endi','soc'].includes(t.id))).map(t=>t.id);
// Состояние выбора: sel — отмеченные; open — раскрытые группы; row — раскрытое описание
const txState=o=>({sel:new Set(o&&o.cur?Object.keys(ORG.types).filter(txOn):[]),q:'',open:new Set(isMobile()?[]:[(txGroups()[0]||{}).id]),row:null,cur:!!(o&&o.cur)});
function txHtml(st){const q=norm(st.q).trim();const hit=t=>!q||[t.short,t.name,t.code,t.index].some(x=>norm(x||'').includes(q));const G=txGroups();
  const row=t=>{const on=st.sel.has(t.id),was=st.cur&&txOn(t.id),lock=was&&on&&txUsed(t.id),open=st.row===t.id;
    return `<div class="pk-row ${on?'on':''}" data-txr="${t.id}"><input type="checkbox" class="pk-cb" data-txc="${t.id}" ${on?'checked':''} ${lock?'disabled title="Назначен действующим контрагентам — снять нельзя"':''} aria-label="${esc(t.short)}">
      <div class="pk-main"><div class="pk-t"><b>${esc(t.short)}</b>${actPill(t.act,1)}<span class="muted">${esc(t.organ)} · ${perTxt(t)}</span></div>${t.code?`<div class="pk-why">${esc(t.code)}</div>`:''}</div>
      <span class="pk-st">${was?'<span class="tag">Подключён</span>':''}</span><span class="tx-chev" aria-hidden="true">${ic(open?'up':'down','sm')}</span></div>${open?`<div class="pk-inl">${pkDescHtml(t,{},{})}</div>`:''}`};
  const groups=G.map(g=>{const ids=[...new Set(g.subs.flatMap(s=>s.ids))];const vis=ids.filter(id=>hit(T[id]));if(q&&!vis.length)return '';const n=ids.filter(id=>st.sel.has(id)).length;const op=q||st.open.has(g.id);
    return `<div class="tx-g ${op?'op':''}"><div class="tx-gh"><button type="button" class="tx-gt" data-txg="${g.id}" aria-expanded="${!!op}"><span class="ck-chev ${op?'op':''}">${ic('right','sm')}</span><span class="grow"><b>${esc(g.t)}</b><span class="hint">${esc(g.who)}</span></span></button>
      <span class="chk-n ${n===ids.length?'green':''}">Выбрано ${n} из ${ids.length}</span><label class="tx-all"><input type="checkbox" data-txall="${g.id}" ${n===ids.length?'checked':''}>Выбрать всю группу</label></div>
      ${op?g.subs.map(s=>{const v=s.ids.filter(id=>hit(T[id]));return v.length?`${s.t?`<div class="tx-sub">${esc(s.t)}</div>`:''}${v.map(id=>row(T[id])).join('')}`:''}).join(''):''}</div>`}).join('');
  return `<div class="tx-bar"><span class="kb-search pk-q">${ic('search','sm')}<input class="inp" id="tx-q" value="${esc(st.q)}" placeholder="Название или код формы, например STI-091" aria-label="Поиск отчёта"></span><button type="button" class="btn sm" data-txmain>${ic('star','sm')}Отметить основные</button><button type="button" class="btn sm ghost" data-txnone>Снять все</button></div>
    <div class="tx-list">${groups||`<div class="state">${ic('search','lg')}<b>Ничего не найдено</b><span>Попробуйте другое название или код формы.</span></div>`}</div>`}
// Обработчики; draw — перерисовка, sum — обновить строку «Выбрано»
function txMount(el,st,draw){const q=$('#tx-q',el);if(q)q.oninput=()=>{st.q=q.value;const p=q.selectionStart;draw();const n=$('#tx-q',el.isConnected?el:document);if(n){n.focus();n.setSelectionRange(p,p)}};
  const lock=id=>st.cur&&txOn(id)&&txUsed(id);
  el.querySelectorAll('[data-txc]').forEach(c=>{c.onclick=e=>e.stopPropagation();c.onchange=()=>{c.checked?st.sel.add(c.dataset.txc):st.sel.delete(c.dataset.txc);draw()}});
  el.querySelectorAll('[data-txr]').forEach(r=>r.onclick=e=>{if(e.target.closest('input,button,a,details'))return;st.row=st.row===r.dataset.txr?null:r.dataset.txr;draw()});
  el.querySelectorAll('[data-txg]').forEach(b=>b.onclick=()=>{const g=b.dataset.txg;st.open.has(g)?st.open.delete(g):st.open.add(g);draw()});
  el.querySelectorAll('[data-txall]').forEach(c=>c.onchange=()=>{const g=txGroups().find(x=>x.id===c.dataset.txall);g.subs.flatMap(s=>s.ids).forEach(id=>{if(c.checked)st.sel.add(id);else if(!lock(id))st.sel.delete(id)});st.open.add(g.id);draw()});
  const mb=el.querySelector('[data-txmain]');if(mb)mb.onclick=()=>{txMain().forEach(id=>st.sel.add(id));draw();toast('Отмечены основные: ОНР, единый налог, ЕНД и STI-161')};
  const nb=el.querySelector('[data-txnone]');if(nb)nb.onclick=()=>{[...st.sel].forEach(id=>{if(!lock(id))st.sel.delete(id)});draw()}}
// Подключить отмеченные (как в «Справочники» → «Виды отчётов»); в окне из справочника снятые отключаются. Контрагентам ничего не назначается
function txApply(st,days,how){days=[...new Set(days&&days.length?days:ORG.remind)].sort((a,b)=>b-a);let on=0,off=0;
  st.sel.forEach(id=>{if(txOn(id))return;ORG.types[id]=ORG.types[id]||born({days:[...days],needFile:false,needReceipt:false});const o=ORG.types[id];o.days=[...days];o.on=true;touch(o);log('org',id,`Подключён вид отчёта «${T[id].name}»${how?' ('+how+')':''}`);on++});
  if(st.cur)Object.keys(ORG.types).filter(id=>txOn(id)&&!st.sel.has(id)&&!txUsed(id)).forEach(id=>{ORG.types[id].on=false;touch(ORG.types[id]);log('org',id,`Отключён вид отчёта «${T[id].name}»`);off++});
  refreshAll();return {on,off}}
// Окно «Подключить из каталога» («Справочники» → «Виды отчётов», пустые состояния «Подключите виды отчётов»)
function txDlg(){if(!can('dicts'))return toast('Подключает виды отчётов сотрудник с правом «Вести справочники организации»','lock',true);const st=txState({cur:true});st.days=[...ORG.remind];
  openModal({form:true,size:'wide',render:m=>{const add=[...st.sel].filter(id=>!txOn(id)).length,rem=Object.keys(ORG.types).filter(id=>txOn(id)&&!st.sel.has(id)).length;
    return {title:'Выбор налогов',sub:'Отметьте налоги и отчёты, которые сдают ваши клиенты: их можно будет назначать контрагентам',
    body:`${txHtml(st)}<div class="form" style="margin-top:10px">${fld('Напоминать до срока, за дней',inp('ct-days',st.days.join(', '),'inputmode="numeric" placeholder="7, 3"'),{id:'ct-days',full:true,hint:'Для новых подключённых видов; потом у каждого вида дни меняются отдельно. В день срока напоминание приходит всегда.'})}</div>`,
    foot:`<span class="muted">Выбрано: <b>${st.sel.size}</b>${add?` · новых ${add}`:''}${rem?` · <span class="red">отключится ${rem}</span>`:''}</span><div class="grow"></div><button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="ct-ok" ${add||rem?'':'disabled'}>${ic('check','sm')}Подключить</button>`,
    mount(el){txMount(el,st,()=>m.draw());$('#ct-days',el).oninput=e=>{st.days=e.target.value.split(/[,;\s]+/).map(Number).filter(n=>n>0&&n<=60)};
      $('#ct-ok',el).onclick=()=>{const r=txApply(st,st.days);m.close();toast(`Подключено видов отчётов: ${r.on}${r.off?`, отключено: ${r.off}`:''}`,'ok')}}}}})}
const connectTypesDlg=txDlg;
// Пустое состояние «Подключите виды отчётов»: в «Отчетах для сдачи» и в «Подборе отчётов»
const txNoTypes=()=>!Object.values(ORG.types).some(t=>t.on);
const txNote=()=>txNoTypes()?`<div class="note fe-note">${ic('book')}<span class="grow"><b>Подключите виды отчётов.</b> Отметьте налоги и отчёты, которые сдают ваши клиенты: только их можно назначать контрагентам.</span>${can('dicts')?`<button class="btn cta sm" data-txopen>${ic('plus','sm')}Выбрать налоги</button>`:'<span class="hint">Подключает владелец</span>'}</div>`:'';
document.addEventListener('click',e=>{if(e.target.closest('[data-txopen]'))txDlg()});

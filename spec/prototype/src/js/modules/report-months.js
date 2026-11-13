'use strict';
// «К сдаче и к оплате по месяцам» (решение заказчика 13.11.2026): одно правило для вкладки «Отчёты к сдаче» карточки контрагента,
// вкладки «По месяцам» модуля «Отчеты для сдачи», страницы контрагента по ссылке и сообщения «К оплате» клиенту в Telegram
/* ═════════════ Отчёты и налоги по месяцам ═════════════ */
// Месяц отчёта — месяц, которым заканчивается его период: НДС за 10.2026 — октябрь, ЕН за III кв. 2026 — сентябрь, годовой отчёт — декабрь.
// Так всё, что собрано «за месяц», сдаётся и оплачивается после его конца, а квартальные и годовые отчёты стоят рядом с последним месяцем своего периода
const RM_ADD={M:0,Q:2,H:5,Y:11};
function rmYm(r){const p=r.p||{};if(p.ev&&p.y&&p.m)return `${p.y}-${String(p.m).padStart(2,'0')}`;return addMonths(r.pkey.slice(0,7),RM_ADD[T[r.t].per]||0)}
const rmTitle=m=>`За ${MONTHS[+m.slice(5,7)-1]} ${m.slice(0,4)}`;
// Строка плана: что по отчёту нужно сделать и что уже сделано. «Сдать» — у всех, кроме видов «только уплата»; «уплатить» — у видов с суммой,
// если сумма не нулевая (не указана — тоже «уплатить»: её ещё нужно рассчитать). Без «Учёта оплаты налогов» оплата не отмечается, поэтому месяц закрывает одна сдача
function rmItem(r){const t=tR(r),tp=feat('taxpay'),sub=!t.payOnly,pay=!!t.sum&&r.sum!==0;
  const subDone=!sub||r.status==='Сдан',payDone=!pay||!tp||(r.sum>0&&r.paid>=r.sum);
  const sum=pay&&r.sum>0?r.sum:0,paid=sum?Math.min(r.paid||0,sum):0;
  const open=[sub&&!subDone?r.due:null,pay&&!payDone?r.payDue:null].filter(Boolean).sort();
  return {r,sub,pay,subDone,payDone,noSum:pay&&r.sum==null,sum,paid,left:Math.round((sum-paid)*100)/100,late:!!(r.overdue||r.payOverdue),when:open[0]||r.due}}
// План по месяцам: прежние версии отчётов и «Не требуется» в него не входят. Внутри месяца — от ближайшего срока
function rmPlan(rs){const by={};rs.forEach(r=>{if(r.superseded||r.status==='Не требуется')return;const m=rmYm(r);(by[m]=by[m]||[]).push(rmItem(r))});
  return Object.keys(by).sort().map(m=>rmGroup(m,by[m]))}
function rmGroup(m,items){const it=items.slice().sort((a,b)=>a.when<b.when?-1:a.when>b.when?1:RT.indexOf(T[a.r.t])-RT.indexOf(T[b.r.t])||a.r.id-b.r.id);
  const n=f=>it.filter(f).length,s=k=>Math.round(it.reduce((a,x)=>a+x[k],0)*100)/100;
  const ds=it.flatMap(x=>[x.sub?x.r.due:null,x.pay?x.r.payDue:null]).filter(Boolean).sort();
  return {m,items:it,subN:n(x=>x.sub),subDone:n(x=>x.sub&&x.subDone),payN:n(x=>x.pay),payDone:n(x=>x.pay&&x.payDone),noSum:n(x=>x.noSum),sum:s('sum'),paid:s('paid'),left:s('left'),
    late:n(x=>x.late),done:it.every(x=>x.subDone&&x.payDone),from:ds[0]||'',to:ds[ds.length-1]||''}}
// Итог месяца одной строкой: просрочка, сдача, суммы, сроки
function rmSumHtml(g){const tp=feat('taxpay'),d=x=>fmtD(x).slice(0,5),out=[];
  if(g.late)out.push(`<span class="pill red sm">${ic('alert')}просрочено ${g.late}</span>`);
  if(g.subN)out.push(`<span class="pill sm ${g.subDone===g.subN?'green':'blue'}">${ic(g.subDone===g.subN?'check':'send')}сдано ${g.subDone} из ${g.subN}</span>`);
  if(g.sum>0)out.push(`<span class="pill sm ${tp&&g.left===0?'green':'purple'}">${ic('coins')}к уплате ${fmtM(g.sum)}${tp?g.left>0?` · осталось ${fmtM(g.left)}`:' · оплачено':''}</span>`);
  if(g.noSum)out.push(`<span class="pill yellow sm" title="Сумма к уплате ещё не указана">${ic('alert')}без суммы ${g.noSum}</span>`);
  if(g.from)out.push(`<span class="hint">${g.from===g.to?`срок ${d(g.from)}`:`сроки ${d(g.from)}–${fmtD(g.to)}`}</span>`);
  return out.join('')}
const RM_NO='<span class="faint">—</span>';
function rmRowHtml(x){const r=x.r,t=T[r.t],tp=feat('taxpay'),per=t.per!=='M'||(r.p&&r.p.ev)?` <span class="faint">${esc(r.plabel)}</span>`:'';
  return `<tr class="clk m-has-act${x.late?' rm-late':''}" data-rep="${r.id}"><td><b title="${esc(t.name)}">${esc(t.short)}</b>${per}${r.ver?` <span class="tag blue">уточн. ${r.ver}</span>`:''}</td>
    <td>${actPill(actOf(r),1)}</td><td>${x.sub?dueHtml(r):RM_NO}</td><td>${x.sub?scaleMini0('rep',r.status,r):RM_NO}</td>
    <td class="num">${!tR(r).sum?RM_NO:r.sum==null?'<span class="faint">не указана</span>':fmtM(r.sum)}</td>
    <td>${x.pay?`<span class="${r.payOverdue?'red strong':''}">${fmtD(r.payDue)}</span>`:RM_NO}</td>
    ${tp?`<td>${x.pay&&r.sum>0?`<div class="sum-st"><span class="tnum">${fmtM(r.paid)}</span>${scaleMini0('pay',r.payStatus,r)}</div>`:x.pay?scaleMini0('pay',r.payStatus,r):RM_NO}</td>`:''}
    <td class="m-act rm-act"><button type="button" class="icon-btn sm" data-rm-menu="${r.id}" aria-label="Действия с отчётом" title="Действия">${ic('more')}</button></td></tr>`}
function rmMonthHtml(g,open,c){const tp=feat('taxpay');
  return `<section class="box rm-m${g.late?' late':g.done?' done':''}${open?' open':''}" data-rm="${g.m}"><h3><button type="button" class="rm-tg" data-rm-tg="${g.m}" aria-expanded="${open}">${ic('down','sm')}<span class="rm-t">${rmTitle(g.m)}</span></button><span class="rm-sum">${rmSumHtml(g)}</span></h3>
    ${open?`<div class="tbl-wrap"><table class="mini m-cards rm-tbl"><thead><tr><th>Отчёт</th><th>Что сделать</th><th>Срок сдачи</th><th>Статус сдачи</th><th class="num">К уплате</th><th>Срок оплаты</th>${tp?'<th>Оплачено в бюджет</th>':''}<th></th></tr></thead>
      <tbody>${g.items.map(rmRowHtml).join('')}${g.sum>0&&g.items.length>1?`<tr class="m-total"><td><b>Итого за месяц</b></td><td></td><td></td><td></td><td class="num"><b>${fmtM(g.sum)}</b></td><td></td>${tp?`<td><b>${fmtM(g.paid)}</b>${g.left>0?` <span class="faint">осталось ${fmtM(g.left)}</span>`:''}</td>`:''}<td></td></tr>`:''}</tbody></table></div>${c?rmPayHtml(c,g):''}`:''}</section>`}

/* Вкладка «Отчёты к сдаче» карточки контрагента: «По месяцам» (по умолчанию) или «Списком» — прежний общий список; выбор запоминает браузер */
function rmCardHtml(c,st){const mode=store.get('cp.repmode','months')==='list'?'list':'months';st.rq=st.rq||'all';st.rmTg=st.rmTg||{};
  const sw=`<div class="chipsel" role="group" aria-label="Как показать отчёты">${[['months','По месяцам'],['list','Списком']].map(([k,l])=>`<button type="button" data-rm-mode="${k}" class="${mode===k?'on':''}" aria-pressed="${mode===k}">${l}</button>`).join('')}</div>`;
  if(mode==='list')return `<div class="row rm-bar">${sw}</div><div id="cpr"></div>`;
  const rs=REPORTS.filter(r=>r.cp===c.id&&!r.superseded&&r.status!=='Не требуется'),q=st.rq,n=k=>rs.filter(r=>actQ(r,k)).length;
  const all=rmPlan(rs),closed=all.filter(g=>g.done).length,left=Math.round(all.reduce((a,g)=>a+g.left,0)*100)/100;
  const vis=(q==='all'?all:rmPlan(rs.filter(r=>actQ(r,q)))).filter(g=>q!=='all'||st.rmAll||!g.done);
  const bar=`<div class="row rm-bar">${sw}<div class="chipsel actq" role="group" aria-label="Что нужно сделать">${[['all','Все'],['sub','Сдать'],['pay','Уплатить']].map(([k,l])=>`<button type="button" data-rm-q="${k}" class="${q===k?'on':''}" aria-pressed="${q===k}">${l}<span class="n">${n(k)}</span></button>`).join('')}</div>
    <span class="grow"></span>${feat('taxpay')&&left>0?`<span class="muted rm-left">Осталось оплатить: <b class="tnum">${som(left)}</b></span>`:''}${closed&&q==='all'?`<label class="rm-all"><input type="checkbox" id="rm-all" ${st.rmAll?'checked':''}> Закрытые месяцы · ${closed}</label>`:''}</div>`;
  const body=vis.length?vis.map(g=>rmMonthHtml(g,g.m in st.rmTg?st.rmTg[g.m]:!g.done,c)).join('')
    :`<div class="box rm-empty">${ic('ok')}<span>${!rs.length?'Отчётов у контрагента пока нет: назначьте их на вкладке «Подбор отчётов»':q==='sub'?'Все отчёты сданы':q==='pay'?'Неоплаченных налогов нет':'Всё сдано и оплачено. Прошлые месяцы — по галочке «Закрытые месяцы»'}</span></div>`;
  return `${bar}<div class="rm-list">${body}</div><div class="hint rm-hint">Месяц отчёта — месяц, которым заканчивается его период: квартальные и годовые отчёты стоят в последнем месяце периода. Нажмите на отчёт — откроется его карточка; «⋯» — действия: статус, сумма, оплата.</div>`}
function rmCardMount(el,c,st,mm){const q=s=>el.querySelector(s);
  $$('[data-rm-mode]',el).forEach(b=>b.onclick=()=>{store.set('cp.repmode',b.dataset.rmMode);mm.draw()});
  if(q('#cpr')){repGrid(q('#cpr'),'cp-rep',()=>REPORTS.filter(r=>r.cp===c.id&&!r.superseded),{compact:true,cfg:{search:false,preset:null,sort:{key:'due',dir:-1},simulateLoad:false}});return}
  $$('[data-rm-q]',el).forEach(b=>b.onclick=()=>{st.rq=b.dataset.rmQ;mm.draw()});
  $$('[data-rm-tg]',el).forEach(b=>b.onclick=()=>{st.rmTg[b.dataset.rmTg]=b.getAttribute('aria-expanded')!=='true';mm.draw()});
  if(q('#rm-all'))q('#rm-all').onchange=e=>{st.rmAll=e.target.checked;mm.draw()};
  // «⋯» — те же действия, что в меню отчёта общего списка; после действия карточка перерисовывается сама (refreshAll)
  $$('[data-rm-menu]',el).forEach(b=>b.onclick=e=>{e.stopPropagation();const r=REPORTS.find(x=>x.id===+b.dataset.rmMenu);if(r)menu(b,reportActions(r))});
  $$('.rm-tbl [data-recv]',el).forEach(b=>b.onclick=e=>e.stopPropagation());
  // Блок «К оплате клиенту» под таблицей месяца: «Скопировать для клиента» и «Отправить в Telegram» (cp-telegram.js)
  rmPayMount(el,c)}

/* Вкладка «По месяцам» модуля «Отчеты для сдачи»: один месяц по всем контрагентам. Общий список сгруппирован по контрагенту:
   у каждого видно, что сдать и что оплатить за месяц, суммы и сроки. По умолчанию — прошлый месяц: отчёты за него сдаются сейчас */
const rmNow=()=>addMonths(ym(TODAY),-1);
function rmRender(body,fresh){if(!S.rmM)S.rmM=rmNow();const m=S.rmM,q=S.repAct||'all';
  const base=()=>visReports().filter(r=>!r.superseded&&r.status!=='Не требуется'&&rmYm(r)===m);
  const rs=base(),g=rmGroup(m,rs.map(rmItem)),cps=new Set(rs.map(r=>r.cp)).size;
  body.innerHTML=`${txNote()}<div class="calhead rm-head"><button class="icon-btn raised" data-rmm="-1" aria-label="Предыдущий месяц">${ic('left')}</button><h3>${rmTitle(m)}</h3><button class="icon-btn raised" data-rmm="1" aria-label="Следующий месяц">${ic('right')}</button>${m===rmNow()?'':`<button class="btn sm ghost" data-rmm="0" title="Месяц, отчёты за который сдаются сейчас">${ic('calendar','sm')}Прошлый месяц</button>`}<div class="grow" style="flex:1"></div><span class="hint">Что сдать и оплатить за месяц: по каким контрагентам и к какому сроку</span></div>
    ${rs.length?`<div class="rm-total"><span class="muted">${cps} ${plural(cps,'контрагент','контрагента','контрагентов')}</span>${rmSumHtml(g)}</div>`:''}
    <div class="chipsel actq" id="actq" role="group" aria-label="Что нужно сделать">${[['all','Все'],['sub','Сдать'],['pay','Уплатить']].map(([k,l])=>`<button type="button" data-aq="${k}" class="${q===k?'on':''}">${l}<span class="n">${rs.filter(r=>actQ(r,k)).length}</span></button>`).join('')}</div><div id="rg"></div>`;
  $('.rm-head',body).onclick=e=>{const b=e.target.closest('[data-rmm]');if(!b)return;const k=+b.dataset.rmm;S.rmM=k?addMonths(m,k):rmNow();renderPage()};
  $('#actq',body).onclick=e=>{const b=e.target.closest('[data-aq]');if(!b)return;S.repAct=b.dataset.aq;renderPage()};
  repGrid($('#rg',body),'rep-months',()=>base().filter(r=>actQ(r,q)),{load:fresh,emptyTitle:`${rmTitle(m)} отчётов нет`,emptyText:q==='all'?'Выберите другой месяц стрелками.':'По выбранной плашке за этот месяц ничего не осталось.',cfg:{defGroup:['cp'],sort:{key:'due',dir:1},ordered:true,searchText:r=>CPM[r.cp].name+' '+CPM[r.cp].inn}})}

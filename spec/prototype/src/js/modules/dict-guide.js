'use strict';
// Содержательные описания справочников: форма просмотра налога, вида отчёта и значения справочника,
// группы справочников платформы (ТЗ «Форма просмотра налога и вида отчёта», «Группы справочников платформы»)
/* ═════════════ Данные пояснений (refDB: taxes[].guide, enRates[].explain, notes у форм и органов, acc у режимов) ═════════════ */
const DICT_GROUPS=DB.ref.dictGroups||[];
const STATUS_NOTES=DB.ref.statusNotes||{},TPL_NOTES=DB.ref.templateNotes||{};
const dgInfo=tab=>{for(const g of DICT_GROUPS)for(const t of g.tabs)if(t.tab===tab)return Object.assign({group:g.group},t);return null};
// Шапка справочника: группа, что это за справочник и где используется
function dgHead(tab,extra){const i=dgInfo(tab);if(!i)return extra||'';
  return `<div class="dg-head"><div class="dg-crumb">${ic('book','sm')}${esc(i.group)} · <b>${esc(i.tab)}</b></div><p>${esc(i.about)}</p>${i.usedIn?`<div class="hint">${ic('info','sm')} Где используется: ${esc(i.usedIn)}</div>`:''}${extra||''}</div>`}
const accTxt=x=>String(x&&x.acc||'').replace(/^Для бухгалтера:\s*/,'');
const taxesOfType=id=>TAXES.filter(x=>x.guide&&(x.guide.reportTypes||[]).includes(id));
const benName=c=>{const b=DICT.benefits.items.find(x=>x.code===c);return b?b.name:c};
const baseName=k=>{const b=(DICT.bases?DICT.bases.items:[]).find(x=>x.code===k);return b?b.name:k};
const dash=v=>!v||/^—\s*$/.test(String(v).trim());
const tgKv=rows=>{rows=rows.filter(r=>r&&!dash(r[1]));return rows.length?`<div class="kv tg-kv">${rows.map(([k,v,raw])=>`<div><span class="k">${k}</span><span class="v">${raw?v:esc(v)}</span></div>`).join('')}</div>`:''};
const tgSec=(title,html,icn)=>html?`<section class="tg-sec"><h4>${ic(icn||'right','sm')}${title}</h4>${html}</section>`:'';
const verifyNote=(on,txt)=>on?`<div class="note warn">${ic('alert')}<span><b>Сверить:</b> ${esc(txt||'данные уточняются')}. Проверьте на сайте ГНС или в органе перед применением.</span></div>`:'';

/* ═════════════ Налог или платёж: блоки «Что это», «Кто платит и с чего», «Ставки», «Сроки», «Связи», «Освобождения», «Важно знать», «Как проверить», «Статья НК», «Источники» ═════════════ */
// Тарифы по фондам: общий тариф, доли работодателя и работника, раскладка по фондам, предельная база с даты введения, пометка «Сверить»
function tgTariffs(t){return `<div class="tg-tariffs">${t.map(r=>`<div class="tg-tariff"><div class="tg-tariff-h"><b>${esc(r.total||'')}</b><span class="grow">${esc(r.name||'')}${r.who?`<span class="faint"> · ${esc(r.who)}</span>`:''}</span>${r.since?`<span class="tag">с ${esc(r.since)}</span>`:''}${r.verify?`<span class="pill yellow sm">${ic('alert')}сверить</span>`:''}</div>
    ${(r.parts||[]).map(pt=>`<div class="tg-part"><div class="tg-part-h"><span>${esc(pt.payer||'')}</span><b>${esc(pt.rate||'')}</b></div>${(pt.funds||[]).length?`<ul class="tg-funds">${pt.funds.map(f=>`<li><span>${esc(f.fund)}</span><b>${esc(f.rate)}</b></li>`).join('')}</ul>`:''}</div>`).join('')}
    ${r.cap?`<div class="tg-cap">${ic('alert','sm')}<span>Предельная база: <b>${esc(r.cap.amount)}</b>${r.cap.since?` с ${esc(r.cap.since)}`:''}${r.cap.note?` (${esc(r.cap.note)})`:''}</span></div>`:''}
    ${r.law||r.verifyNote?`<div class="faint tg-law">${esc([r.law,r.verifyNote?'Сверить: '+r.verifyNote:''].filter(Boolean).join(' · '))}</div>`:''}</div>`).join('')}</div>`}
// Как проверить: способы со списком шагов
const tgCheck=c=>c&&(c.ways||[]).length?`<ol class="tg-ways">${c.ways.map(w=>`<li><b>${esc(w.name)}</b>${(w.steps||[]).length?`<ul class="tg-ul">${w.steps.map(st=>`<li>${esc(st)}</li>`).join('')}</ul>`:''}</li>`).join('')}</ol>`:'';
// Ссылки на источники: открываются в новой вкладке
const tgLinks=a=>(a||[]).length?`<ul class="tg-ul tg-src">${a.map(l=>`<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title||l.url)}</a></li>`).join('')}</ul>`:'';
function taxGuideHtml(x,o){o=o||{};const g=x.guide||{};
  const rates=(g.tariffs||[]).length?tgTariffs(g.tariffs):Array.isArray(g.rates)&&g.rates.length?`<div class="tg-rates">${g.rates.map(r=>`<div class="tg-rate"><b>${esc(r.rate)}</b><span>${esc(r.when)}</span></div>`).join('')}</div>`:x.rates?`<p class="pk-p">${esc(x.rates)}</p>`:'';
  const gk=(g.gked||[]).length?g.gked.map(c=>`<span class="mono">${esc(c)}</span> ${esc(gkName(c)||'')}`).join('<br>'):'';
  const gkx=(g.gkedExclude||[]).length?g.gkedExclude.map(c=>`<span class="mono">${esc(c)}</span> ${esc(gkName(c)||'')}`).join('<br>'):'';
  const rts=(g.reportTypes||x.reportTypes||[]).map(id=>T[id]?esc(T[id].name)+(T[id].code?` <span class="faint mono">${esc(T[id].code)}</span>`:''):esc(id)).join('<br>');
  return `<div class="tg">
    ${o.head===false?'':`<div class="tg-tags">${[x.group,x.level,g.organ||x.organ,g.period||x.period].filter(Boolean).map(v=>`<span class="tag">${esc(v)}</span>`).join('')}${x.verify?`<span class="pill yellow sm">${ic('alert')}сверить</span>`:''}</div>`}
    ${tgSec('Что это',g.about?`<p class="pk-p">${esc(g.about)}</p>`:'','info')}
    ${tgSec('Кто платит и с чего',tgKv([['Кто платит',g.payers||x.payers],['С чего считается',g.base||x.base]]),'users')}
    ${tgSec('Ставки',rates,'coins')}
    ${tgSec('Кто платит по полному тарифу',(g.exceptions27||[]).length?`<ul class="tg-ul">${g.exceptions27.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:'','list')}
    ${tgSec('Кто администрирует',tgKv((g.admin||[]).map(a=>[esc(a.organ),a.what])),'landmark')}
    ${tgSec('Сроки',tgKv([['Налоговый период',g.period||x.period],['Срок сдачи отчёта',g.reportDue||x.reportDue],['Срок уплаты',g.payDue||x.payDue],['Что уплачивается',g.pays],['Форма отчёта',g.form||x.form],['Куда',g.organ||x.organ]]),'calendar')}
    ${tgSec('Связи',tgKv([['Платят на режимах',g.regimesPay],['Освобождают режимы',g.regimesFree],['Льготы и статусы',(g.benefits||[]).map(benName).join(', ')],['Основания',(g.bases||[]).map(baseName).join(', ')],['Виды деятельности (ГКЭД)',gk,1],['Кроме ГКЭД',gkx,1],['Виды отчётов',rts||'нет — отдельного отчёта не сдают',1]]),'link')}
    ${tgSec('Освобождения',dash(g.exemptions)?'':`<p class="pk-p">${esc(g.exemptions)}</p>`,'ban')}
    ${tgSec('Важно знать',(g.notes||[]).length?`<ul class="tg-ul">${g.notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:'','alert')}
    ${tgSec(esc((g.check||{}).title||'Как проверить'),tgCheck(g.check),'search')}
    ${tgSec('Статья НК',`<p class="pk-p">${esc(g.art||x.art||'—')}</p>${verifyNote(x.verify,g.verifyNote)}`,'book')}
    ${tgSec('Источники',tgLinks(g.sources),'globe')}
  </div>`}
function taxViewDlg(x){openModal({size:'mid',render:()=>({title:esc(x.name),sub:`${esc(x.code)} · ${esc(x.group||'')} · справочник платформы «Налоги и ставки»`,body:taxGuideHtml(x),foot:'<button class="btn cta" data-close>Закрыть</button>'})})}

/* ═════════════ Вид отчёта: описание, налоги, к которым он относится, и настройки организации ═════════════ */
function typeGuideHtml(t){const tx=taxesOfType(t.id);
  const kv=tgKv([['Код формы',t.code?`<span class="mono">${esc(t.code)}</span>`:'—',1],['Орган',t.organ],t.index?['Индекс формы',`<span class="mono">${esc(t.index)}</span>`,1]:null,t.respondents?['Кто сдаёт',t.respondents]:null,['Периодичность',t.oneOff?'разовый — создаётся через «Разовый отчёт» на каждое событие':perOwn(t)?'задаётся в назначении':PER_LABEL[t.per]],['Срок сдачи',ruleText(t)],t.act!=='sub'?['Срок оплаты',payRuleText(t)]:null,['Что нужно сделать',actPill(t.act,1),1],t.act!=='sub'?['Что уплачивается',paysTxt(t)]:null,
    (t.rates||[]).length?['Ставки',t.rates.join(', ')]:null,(t.rateAdd||[]).length?['Добавляемые строки ставок',t.rateAdd.map(x=>`${rtTxt(x)} — ${x.name}${x.art?` (${x.art})`:''}`).join('; ')]:null,['Тип',t.kind==='regime'?'Режимный: '+(t.regimes||[]).join(', '):KIND_L[t.kind]],(t.basis||[]).length?['Основание',(t.basis||[]).map(baseName).join('; ')]:null,
    !gkEmpty(t.gked)?['Виды деятельности (ГКЭД)',gkRuleTxt(t.gked)+(gkLists(t.gked)?' (организации)':'')]:null,...(t.gked?GK_INFO.filter(([k])=>(t.gked[k]||[]).length).map(([k,l])=>[l.replace(' (ГКЭД)',''),t.gked[k].join(', ')]):[]),['Для кого',whoText(t.who)],t.art?['Статья НК КР',t.art]:null,t.note?['Примечание',t.note]:null]);
  return `<div class="tg">${tgSec('Что это за отчёт',`${t.desc?`<p class="pk-p">${esc(t.desc)}</p>`:''}${t.choice?`<div class="note">${ic('info')}<span>${esc(t.choice)}</span></div>`:''}${t.clientNote?`<div class="note">${ic('user')}<span><b>Для контрагента:</b> ${esc(t.clientNote)}</span></div>`:''}${kv}${verifyNote(t.verify,t.verifyNote)}`,'file')}</div>
    ${tx.map(x=>`<details class="tg-tax" ${tx.length===1?'open':''}><summary>${ic('coins','sm')}<span class="grow">${tx.length===1?'Налог: ':''}<b>${esc(x.name)}</b> <span class="faint mono">${esc(x.code)}</span></span>${ic('down','sm')}</summary>${taxGuideHtml(x,{head:true})}</details>`).join('')}`}

/* ═════════════ Значение справочника: режим, форма, орган, ставка ЕН ═════════════ */
function valueGuideHtml(tab,x){
  if(tab==='Режимы')return tgKv([['Полное название',REGIME_FULL[x.name]||x.full||x.name],['Тип',x.type],['Освобождает от',x.frees],['Кто применяет',x.who],['Как переходят',x.how],['Совмещается с',x.combines],['Для бухгалтера',accTxt(x)],['Статья НК',x.art]]);
  if(tab==='Формы')return tgKv([['Код',x.code],['Полное название',x.full],['Считается',x.end==='ip'?'ИП (физическое лицо)':'организация'],['Что меняет в налогах',x.note]]);
  if(tab==='Органы'){const rts=RT.filter(t=>t.organ===x.name&&t.active).map(t=>esc(t.short)).join(', ');
    const kv=tgKv([['Код',x.code],['Что это и что туда сдают',x.note],['Виды отчётов',rts||'—',1]]);
    const ct=tgKv([...(x.contacts||[]).map(ph=>[esc(ph.label),`<a href="tel:${esc(String(ph.value).replace(/[^\d+]/g,''))}">${esc(ph.value)}</a>`,1]),['График работы',x.hours],['Сайт',x.site?`<a href="${esc(x.site)}" target="_blank" rel="noopener">${esc(x.site.replace(/^https?:\/\//,'').replace(/\/$/,''))}</a>`:'',1]]);
    return ct?`<div class="tg">${tgSec('Что это',kv,'info')}${tgSec('Контакты',ct+(x.contactsNote?verifyNote(1,x.contactsNote):''),'chat')}</div>`:kv}
  if(tab==='Льготы и статусы')return typeof benDescHtml==='function'?benDescHtml(x,{},''):'';
  if(tab==='Основания для отчётов')return tgKv([['Код',x.code],['Описание',x.desc],['Виды отчётов',RT.filter(t=>(t.basis||[]).includes(x.code)).map(t=>t.short).join(', ')]]);
  return tgKv([['Код',x.code],['Пояснение',x.note]])}
function valueViewDlg(tab,x,title){openModal({size:'mid',render:()=>({title:esc(title||x.name),sub:`${esc(tab)} · справочник платформы`,body:valueGuideHtml(tab,x)||'<span class="faint">Пояснения нет</span>',foot:'<button class="btn cta" data-close>Закрыть</button>'})})}
function enRateViewDlg(x){openModal({size:'mid',render:()=>({title:`${esc(x.code)} · ${esc(x.rate)}`,sub:esc(x.activity),body:`<div class="tg">${tgSec('Когда применяется',x.explain?`<p class="pk-p">${esc(x.explain)}</p>`:'','info')}${tgSec('Условия',tgKv([['Ставка',x.rate],['Безналичная выручка',x.rateCashless],['Наличная выручка',x.rateCash],['Условие',x.cond],['Добавляется к ставкам',(x.addTo||[]).join(', ')],['Строки суммы в отчёте',rtParts(x).map(p=>`${p.n}, ${p.pct}`).join('; ')],['Виды деятельности (ГКЭД)',!gkEmpty(x.gked)?gkRuleTxt(x.gked):''],['Статья НК',x.art]]),'list')}</div>`,foot:'<button class="btn cta" data-close>Закрыть</button>'})})}

/* ═════════════ Справочники платформы для организации: группы с пояснениями ═════════════
   Каждый справочник — плитка в своей группе; нажатие открывает окно со списком значений и пояснением, что это и где используется. */
function orgDictDefs(){const y=+TODAY.slice(0,4);const D=k=>DICT[k]?DICT[k].items.filter(x=>x.active):[];
  return {
    'Налоги и ставки':{n:TAXES.length,rows:()=>TAXES,cols:[{key:'code',label:'Код',type:'text',w:90,val:x=>x.code,cls:'mono'},{key:'name',label:'Налог или платёж',type:'text',w:300,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>${x.verify?` <span class="pill yellow sm">${ic('alert')}сверить</span>`:''}`},{key:'about',label:'Что это',type:'text',w:380,val:x=>(x.guide||{}).about||''},{key:'period',label:'Период',type:'enum',w:120,val:x=>x.period}],open:taxViewDlg,title:'name'},
    'Ставки единого налога':{n:EN_TABLE.length,rows:()=>EN_TABLE,cols:[{key:'code',label:'Код',type:'text',w:90,val:x=>x.code,cls:'mono'},{key:'rate',label:'Ставка',type:'text',w:120,val:x=>x.rate},{key:'activity',label:'Деятельность',type:'text',w:300,val:x=>x.activity,html:x=>`<span class="strong">${esc(x.activity)}</span>`},{key:'explain',label:'Когда применяется',type:'text',w:380,val:x=>x.explain||''}],open:enRateViewDlg,title:'activity',about:'Ставки единого налога по видам деятельности (ст. 423): когда применяется каждая.',group:'Налоги и отчёты'},
    'Виды отчётов':{n:RT.filter(t=>t.active).length,go:'types'},
    'Основания для отчётов':{n:D('bases').length,rows:()=>D('bases'),cols:[{key:'name',label:'Основание',type:'text',w:260,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>`},{key:'desc',label:'Описание',type:'text',w:420,val:x=>x.desc||''}]},
    'Режимы':{n:D('regimes').length,rows:()=>D('regimes'),cols:[{key:'name',label:'Режим',type:'text',w:200,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>`},{key:'full',label:'Полное название',type:'text',w:260,val:x=>REGIME_FULL[x.name]||x.full||''},{key:'acc',label:'Для бухгалтера',type:'text',w:380,val:accTxt}]},
    'Льготы и статусы':{n:D('benefits').length,rows:()=>D('benefits'),cols:[{key:'name',label:'Льгота или статус',type:'text',w:280,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>`},{key:'gives',label:'Что даёт',type:'text',w:420,val:x=>x.gives||''}]},
    'ГКЭД':{n:GK.filter(g=>g.level==='subclass').length,rows:()=>GK.filter(g=>g.level==='subclass'&&g.active!==false),cols:[{key:'code',label:'Код',type:'text',w:100,val:x=>x.code,cls:'mono'},{key:'name',label:'Вид деятельности',type:'text',w:520,val:x=>x.name}],open:null,title:'name'},
    'Формы':{n:D('forms').length,rows:()=>D('forms'),cols:[{key:'name',label:'Форма',type:'text',w:200,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>`},{key:'full',label:'Полное название',type:'text',w:260,val:x=>x.full||''},{key:'end',label:'Считается',type:'enum',w:120,val:x=>x.end==='ip'?'ИП':'Организация'},{key:'note',label:'Что меняет в налогах',type:'text',w:360,val:x=>x.note||''}]},
    'Коды стран':{n:PHONES.length,rows:()=>PHONES,cols:[{key:'name',label:'Страна',type:'text',w:220,val:p=>`${p.flag} ${p.name}`},{key:'code',label:'Код',type:'text',w:90,val:p=>'+'+p.code},{key:'mask',label:'Маска номера',type:'text',w:160,val:p=>p.mask}],open:null,title:'name'},
    'Органы':{n:D('organs').length,rows:()=>D('organs'),cols:[{key:'name',label:'Орган',type:'text',w:200,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>`},{key:'note',label:'Что это и что туда сдают',type:'text',w:460,val:x=>x.note||''},{key:'contacts',label:'Контакты',type:'text',w:220,val:x=>(x.contacts||[]).map(c=>`${c.label}: ${c.value}`).join('; ')}]},
    'УГНС':{n:D('ugns').length,rows:()=>D('ugns'),cols:[{key:'code',label:'Код',type:'text',w:90,val:x=>x.code||'—',cls:'mono'},{key:'name',label:'Налоговый орган',type:'text',w:380,val:x=>x.name},{key:'city',label:'Город или район',type:'enum',w:200,val:x=>x.city||''}],open:null,title:'name'},
    'Банки':{n:D('banks').length,rows:()=>D('banks'),cols:[{key:'name',label:'Банк',type:'text',w:280,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>`},{key:'code',label:'Код',type:'text',w:100,val:x=>x.code||'',cls:'mono'}],open:null},
    'Календарь':{n:holidayRows(y).length,rows:()=>holidayRows(y),cols:[{key:'d',label:'Дата',type:'date',w:120,val:h=>h.d},{key:'name',label:'Название',type:'text',w:320,val:h=>h.name},{key:'kind',label:'Тип',type:'enum',w:170,val:h=>h.kind}],open:null,title:'name',sort:{key:'d',dir:1}},
    'Статусы':{n:Object.keys(STATUS_NOTES).length,rows:()=>Object.entries(STATUS_NOTES).map(([name,note])=>({name,note,code:name})),cols:[{key:'name',label:'Статус отчёта',type:'text',w:220,val:x=>stl(x.name),html:x=>pill(x.name,ST)},{key:'note',label:'Что означает',type:'text',w:460,val:x=>x.note}],open:null,title:'name',sort:null},
    'Категории задач':{n:D('cats').length+D('reasons').length,rows:()=>[...D('cats').map(x=>Object.assign({kind:'Категория задачи'},x)),...D('reasons').map(x=>Object.assign({kind:'Причина изменения срока'},x))],cols:[{key:'kind',label:'Список',type:'enum',w:220,val:x=>x.kind},{key:'code',label:'Код',type:'text',w:100,val:x=>x.code||'',cls:'mono'},{key:'name',label:'Значение',type:'text',w:320,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>`}],open:null},
    'Шаблоны':{n:Object.keys(TPL_NOTES).length,rows:()=>Object.entries(TPL_NOTES).map(([k,note])=>({code:k,name:note,text:TPL[k]||''})),cols:[{key:'name',label:'Шаблон',type:'text',w:320,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>`},{key:'text',label:'Текст',type:'text',w:460,val:x=>x.text}],open:null,title:'name',sort:null}}}
// Группы для организации: служебных справочников («Загрузки», «Запросы», «Шаблоны ролей») здесь нет
function orgDictGroups(){const defs=orgDictDefs();return DICT_GROUPS.map(g=>{const tabs=[];g.tabs.forEach(t=>{if(defs[t.tab])tabs.push(Object.assign({},t,defs[t.tab]));if(t.tab==='Налоги и ставки')tabs.push(Object.assign({tab:'Ставки единого налога',usedIn:'Ставка ЕН контрагента по основному ГКЭД; подсказка в форме контрагента.'},defs['Ставки единого налога']))});return {group:g.group,tabs}}).filter(g=>g.tabs.length)}
function orgDictDlg(d){openModal({size:'wide',render:()=>({title:esc(d.tab),sub:`${esc(d.group||'')} · справочник платформы`,body:`<div class="dg-head"><p>${esc(d.about||'')}</p>${d.usedIn?`<div class="hint">${ic('info','sm')} Где используется: ${esc(d.usedIn)}</div>`:''}</div><div id="odg"></div>`,foot:'<button class="btn cta" data-close>Закрыть</button>',
  mount(el){const open=d.open===null?null:d.open||(x=>valueViewDlg(d.tab,x));grid($('#odg',el),{id:'odg-'+d.tab,rid:x=>x.code||x.name||x.d,cols:d.cols,rows:d.rows,title:d.title||'name',noun:['значение','значения','значений'],sort:d.sort===undefined?{key:d.cols[0].key,dir:1}:d.sort||undefined,open:open||undefined,fixedView:'table',audit:false})}})})}

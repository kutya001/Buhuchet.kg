'use strict';
// ГКЭД в формах: выбор вида деятельности поиском, поля «Основной» и «Дополнительные», предупреждения по налогам
/* ═════════════ ГКЭД: выбор, поля контрагента, сверка с налогами ═════════════ */
const GK_MAX=80;
// Окно выбора: поиск по коду, началу кода или словам названия; выбираются только коды нижнего уровня
function gkPickDlg({title='Вид деятельности (ГКЭД)',exclude=[],cur='',onPick}){const st={q:''};
  const path=x=>gkUp(x.code).reverse().join(' › ');
  const list=()=>{const l=gkSearch(st.q,{leaf:true});return `<div class="gk-n hint">${l.length?`Найдено: ${l.length}${l.length>GK_MAX?` — показаны первые ${GK_MAX}, уточните поиск`:''}`:'Ничего не найдено: попробуйте начало кода, например «47», или слово из названия'}</div>
    <div class="gk-list" role="listbox">${l.slice(0,GK_MAX).map(x=>{const ex=exclude.includes(x.code);return `<button type="button" class="gk-i ${x.code===cur?'on':''}" data-gk="${esc(x.code)}" ${ex?'disabled title="Уже указан у контрагента"':''} role="option"><span class="mono strong">${esc(x.code)}</span><span class="grow">${esc(x.name)}<small>${esc(path(x))}</small></span>${x.code===cur?ic('check','sm'):''}</button>`}).join('')}</div>`};
  openModal({size:'mid',noMax:true,render:m=>({title,sub:`Справочник ГКЭД, ред. 2022 · выбирается код нижнего уровня`,
    body:`<div class="search gk-q"><span>${ic('search')}</span><input id="gk-q" value="${esc(st.q)}" placeholder="Код или слово, например 69.20 или бухгалтер" autocomplete="off" aria-label="Поиск по ГКЭД"></div><div id="gk-res">${list()}</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button>',
    mount(el){const q=$('#gk-q',el);q.focus();q.oninput=()=>{st.q=q.value;$('#gk-res',el).innerHTML=list()};
      $('#gk-res',el).onclick=e=>{const b=e.target.closest('[data-gk]');if(!b||b.disabled)return;m.close();onPick(b.dataset.gk)}}})})}
// Поля контрагента: основной (обязателен) и дополнительные (сколько угодно, без повтора основного)
function gkFields(p,st){const off=c=>gkOff(c)?` <span class="pill yellow sm">${ic('alert')}Не действует</span>`:'';
  return `${fld('Основной вид деятельности (ГКЭД)',`<button type="button" class="btn gk-main ${st.gked?'':'gk-empty'}" id="${p}-gk">${ic('search','sm')}<span>${st.gked?esc(gkT(st.gked)):'Выбрать вид деятельности'}</span></button>${off(st.gked)}`,{req:true,full:true,id:p+'-gk',hint:'Поиск по коду или названию, например «69.20 — Деятельность в области бухгалтерского учёта»'})}
    ${fld('Дополнительные виды деятельности (ГКЭД)',`<div class="gk-x" id="${p}-gkx">${st.gked2.map(c=>`<span class="chip gk-chip" title="${esc(gkT(c))}"><span><b>${esc(c)}</b> ${esc(gkName(c))}</span>${off(c)}<button type="button" data-gkdel="${esc(c)}" aria-label="Убрать ${esc(c)}">${ic('x','sm')}</button></span>`).join('')}<button type="button" class="btn sm" data-gkadd>${ic('plus','sm')}Добавить</button></div>`,{full:true,id:p+'-gkx',hint:'Сколько угодно кодов; основной повторять нельзя'})}`}
function gkBind(el,p,st,redraw){const b=$('#'+p+'-gk',el);if(b)b.onclick=()=>gkPickDlg({title:'Основной вид деятельности (ГКЭД)',cur:st.gked,exclude:st.gked2,onPick:c=>{st.gked=c;redraw()}});
  const x=$('#'+p+'-gkx',el);if(x)x.onclick=e=>{const d=e.target.closest('[data-gkdel]');if(d){st.gked2=st.gked2.filter(k=>k!==d.dataset.gkdel);redraw();return}
    if(e.target.closest('[data-gkadd]'))gkPickDlg({title:'Дополнительный вид деятельности (ГКЭД)',exclude:[st.gked,...st.gked2].filter(Boolean),onPick:c=>{st.gked2=[...st.gked2,c];redraw()}})}}
// Предупреждения: режим, льготы и статусы, назначенные отчёты не подходят к видам деятельности; ставка ЕН по ГКЭД. Ничего не меняется само
function gkNote(c,sel){if(!c.gked&&!(c.gked2||[]).length)return '';const k=gkCheck(c,sel);const warn=[...k.block,...k.regime,...k.ben,...(k.types.length?[`Не подходят по ГКЭД назначенные отчёты: ${k.types.join(', ')}`]:[]),...k.off.map(x=>`Код ${x} больше не действует: замените его`)];
  return `${warn.length?`<div class="note warn gk-warn">${ic('alert')}<span>${warn.map(esc).join('<br>')}</span></div>`:''}${k.rate.length?`<div class="note">${ic('info')}<span>${k.rate.map(esc).join('<br>')}</span></div>`:''}`}
// Отметка «Подходит по ГКЭД» у видов отчётов при назначении
function gkFitHint(c,sel){const codes=cpCodes(c);if(!codes.length)return '';const fit=RT.filter(t=>ORG.types[t.id]&&ORG.types[t.id].on&&t.active!==false&&gkFitType(t,c));if(!fit.length)return '';
  const miss=fit.filter(t=>!sel.has(t.id));return `<div class="hint">${ic('check','sm')} Подходит по ГКЭД: ${fit.map(t=>esc(t.short)).join(', ')}${miss.length?` · не выбраны: ${miss.map(t=>esc(t.short)).join(', ')}`:''}</div>`}
// Ввод перечня «Виды деятельности (ГКЭД)» и «Кроме» в формах справочников
// warnOn — у статусов: поле «Предупреждать при ГКЭД» (коды, при которых статус можно выбрать только с предупреждением)
// Перечни по форме собственности (у патента): правятся в окне режима (lists), у видов отчётов и налогов показываются справочно
const GK_INFO=[['ip','Для ИП (ГКЭД)','gip','Перечень для ИП; пусто — ИП с этим режимом не проверяются'],['ipEx','Кроме, для ИП (ГКЭД)','gipx','Виды деятельности, которых нет в перечне для ИП, хотя они входят в его коды'],['itd','Для ИТД (ГКЭД)','gitd','Перечень для физлиц на патенте (ИТД, форма собственности ФС-22)']];
// lists — окно режима: перечни по форме собственности правятся, если они у режима есть или перечень задан только для организаций (who:'org')
function gkRuleFields(p,r,raw,warnOn,lists){r=r||{};raw=raw||{};lists=lists&&(gkLists(r)||r.who==='org');const note=(r.note?`<div class="note ${gkToVerify(r)&&!r.verify?'warn':''} full" style="grid-column:1/-1">${ic(gkToVerify(r)&&!r.verify?'alert':'info')}<span>Примечание к перечню: ${esc(r.note)}</span></div>`:'')+(r.verify?`<div class="note warn full" style="grid-column:1/-1">${ic('alert')}<span>Сверить: ${esc(r.verify)}</span></div>`:'')
    +(lists?'':GK_INFO.filter(([k])=>(r[k]||[]).length).map(([k,l])=>`<div class="fld full"><label>${l}</label><div class="mono" style="font-size:12.5px">${esc(r[k].join(', '))}</div><div class="hint">Справочно: контрагентов проверяет перечень режима (${r[k].length} ${plural(r[k].length,'код','кода','кодов')})</div></div>`).join(''));
  return `${note}${fld('Виды деятельности (ГКЭД)',inp(p+'-gin',raw.in!=null?raw.in:(r.in||[]).join(', '),'class="inp mono" placeholder="Например: 47, 56.10, G"'),{full:true,id:p+'-gin',hint:'Коды или начала кодов через запятую; секция — буквой. Пусто — для всех видов деятельности'})}
  ${fld('Кроме (ГКЭД)',inp(p+'-gex',raw.ex!=null?raw.ex:(r.ex||[]).join(', '),'class="inp mono" placeholder="Например: 47.26"'),{full:true,id:p+'-gex',hint:'Виды деятельности, для которых не подходит'})}
  ${lists?GK_INFO.map(([k,l,s,h])=>fld(l,inp(p+'-'+s,raw[k]!=null?raw[k]:(r[k]||[]).join(', '),'class="inp mono"'),{full:true,id:p+'-'+s,hint:h})).join(''):''}
  ${warnOn||(r.warn||[]).length?fld('Предупреждать при ГКЭД',inp(p+'-gwarn',raw.warn!=null?raw.warn:(r.warn||[]).join(', '),'class="inp mono" placeholder="Например: 64.92.0, 05"'),{full:true,id:p+'-gwarn',hint:warnOn?'При таком основном ГКЭД статус предлагается с жёлтым предупреждением «Проверьте право по виду деятельности»':'При таком основном ГКЭД — вопрос с подтверждением; после него режим сохраняется с жёлтой отметкой в карточке'}):''}`}
// undefined — ошибка в кодах, null — пусто (без ограничения), иначе {in, ex} с прежними признаками правила
function gkRuleRead(el,p,old){const a=gkParse(val(el,p+'-gin')),b=gkParse(val(el,p+'-gex')),w=$('#'+p+'-gwarn',el)?gkParse(val(el,p+'-gwarn')):null;
  const ls=GK_INFO.map(([k,,s])=>[k,s,$('#'+p+'-'+s,el)?gkParse(val(el,p+'-'+s)):null]);
  const ok=[setErr(el,p+'-gin',a.err||''),setErr(el,p+'-gex',b.err||''),w?setErr(el,p+'-gwarn',w.err||''):true,...ls.map(([,s,x])=>x?setErr(el,p+'-'+s,x.err||''):true)].every(Boolean);
  if(!ok)return undefined;const wv=w?w.v:(old&&old.warn)||[];const lv={};ls.forEach(([k,,x])=>lv[k]=x?x.v:(old&&old[k])||[]);
  if(!a.v.length&&!b.v.length&&!wv.length&&!lv.ip.length&&!lv.itd.length)return null;const r=gkRuleKeep(old,{in:a.v,ex:b.v});if(wv.length)r.warn=wv;else delete r.warn;
  Object.entries(lv).forEach(([k,v])=>{if(v.length)r[k]=v;else delete r[k]});return r}
const gkRaw=(el,p)=>{if(!$('#'+p+'-gin',el))return undefined;const o={in:val(el,p+'-gin'),ex:val(el,p+'-gex'),warn:$('#'+p+'-gwarn',el)?val(el,p+'-gwarn'):undefined};GK_INFO.forEach(([k,,s])=>{if($('#'+p+'-'+s,el))o[k]=val(el,p+'-'+s)});return o};
const gkRuleSame=(a,b)=>gkRuleTxt(a)===gkRuleTxt(b)&&['warn','ip','ipEx','itd'].every(k=>((a||{})[k]||[]).join()===((b||{})[k]||[]).join());
// Льгота или статус не подходит к видам деятельности: сохранить можно после подтверждения, в карточке останется жёлтая отметка
function gkBenOk(c,st,again){const b=gkCheck(c).ben;if(!b.length||st.gkBenOk===gkSig(c))return true;
  confirmDlg({title:'Сохранить с несоответствием?',text:esc(b.join('. '))+'. Перечни видов деятельности для статусов ещё сверяются с законами, поэтому сохранить можно; в карточке останется предупреждение.',ok:'Сохранить',run:()=>{st.gkBenOk=gkSig(c);again()}});return false}
const gkSig=c=>JSON.stringify([c.gked,c.gked2,c.ben]);
// Режим с «Предупреждать при ГКЭД» (единый налог, ст. 419; СЭЗ, ст. 427): вопрос с подтверждением; после «Не оказывает» режим сохраняется, остаётся жёлтая отметка, в историю пишется, кто подтвердил
function gkEnOk(c,st,again){const w=gkCheck(c).rwarn[0];if(!w)return true;const sig=gkEnSig(c);if(st.gkEnOk===sig||(c.gkOk&&c.gkOk.sig===sig))return true;
  const what=w.grp?w.grp.name.replace(/ \(.*$/,'').toLowerCase():'';
  if(w.list){const cs=cpCodes(c);confirmDlg({title:`Проверьте право на режим «${esc(w.n)}»`,text:`Ни один вид деятельности контрагента (${cs.map(k=>`<b>${esc(k)}</b> «${esc(gkName(k))}»`).join(', ')}) не входит в перечень режима «${esc(w.n)}» ${esc(w.list)} (${esc(w.art)} НК КР). Если вида деятельности нет в перечне, режим применять нельзя.<br><br>Подтвердите: режим сохранится, в карточке останется предупреждение, в историю запишется, кто подтвердил.`,
    ok:'Подтверждаю',run:()=>{st.gkEnOk=sig;st.gkEnAsk='';again&&again()}});return false}
  confirmDlg({title:esc(w.ask||`Проверьте право на режим «${w.n}»`),text:`Основной ГКЭД <b>${esc(w.code)}</b> «${esc(gkName(w.code))}»${what?` (${esc(what)})`:''} не отличает запрещённую для режима «${esc(w.n)}» деятельность от разрешённой (${esc(w.art)} НК КР). ${w.ask?'Если оказывает — режим применять нельзя.':'Если контрагент ведёт запрещённую деятельность, режим применять нельзя.'}<br><br>Подтвердите: режим сохранится, в карточке останется предупреждение, в историю запишется, кто подтвердил.`,
    ok:w.ask?'Нет, не оказывает':'Подтверждаю',run:()=>{st.gkEnOk=sig;st.gkEnAsk=w.ask||'';again&&again()}});return false}
// После сохранения: подтверждение у контрагента и запись в историю
function gkEnSave(c,st){if(!st.gkEnOk||st.gkEnOk!==gkEnSig(c))return;const w=gkCheck(c).rwarn[0];if(!w)return;c.gkOk={sig:st.gkEnOk,by:S.me,at:TODAY,ask:st.gkEnAsk||''};
  log('cp',c.id,w.list?`Подтверждён режим «${w.n}»: вид деятельности вне перечня ${w.list} (ГКЭД ${cpCodes(c).join(', ')})`:`Подтверждён режим «${w.n}» при основном ГКЭД ${w.code}${st.gkEnAsk?`: «${st.gkEnAsk}» — нет`:': запрещённой деятельности нет'}`,c.id)}
// Карточка контрагента, «Основное»: основной ГКЭД первым, дополнительные списком ниже; без ГКЭД — предупреждение
function gkKv(c){const off=k=>gkOff(k)?` <span class="pill yellow sm">${ic('alert')}Не действует — замените</span>`:'';const row=k=>`<div><span class="mono strong">${esc(k)}</span> ${esc(gkName(k))}${off(k)}</div>`;
  return `<div><span class="k">Основной вид деятельности (ГКЭД)</span><span class="v">${c.gked?row(c.gked):`<span class="pill yellow">${ic('alert')}Укажите основной вид деятельности (ГКЭД)</span>${can('createCp')&&!c.archived?` <button type="button" class="linkbtn" data-gkfix="${c.id}">Указать</button>`:''}`}</span></div>
    ${(c.gked2||[]).length?`<div><span class="k">Дополнительные виды деятельности</span><span class="v">${c.gked2.map(row).join('')}</span></div>`:''}`}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-gkfix]');if(b){const c=CPM[b.dataset.gkfix];if(c)editCpDlg(c)}});
// Фильтр списка контрагентов по ГКЭД: код, начало кода («47» — вся розничная торговля) или секция («G»); основной и дополнительные коды; иначе — по словам названия
function gkMatch(c,q){const Q=String(q||'').trim().toUpperCase();if(!Q)return true;const ks=cpCodes(c);if(/^([A-Z]{1,2}|\d\d(\.[\d.]*)?)$/.test(Q))return ks.some(k=>gkHit(k,Q));const n=norm(Q);return ks.some(k=>norm(gkName(k)).includes(n))}

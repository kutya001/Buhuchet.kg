'use strict';
// Тариф Соцфонда в форме и карточке контрагента, окно «Тариф Соцфонда» (ТЗ «Тариф страховых взносов в Соцфонд (СПиНО)»)
/* ═════════════ Признаки и выбор тарифа: общий блок для формы создания, формы изменения и окна из карточки ═════════════
   st — состояние формы: sf (признаки), sfT (выбранный id; пусто — определить автоматически), sfTouch (тариф менял пользователь), sfWhy (причина ручного выбора).
   cx — контрагент или черновик формы, по нему считается тариф. */
const sfDraft=(cx,st)=>Object.assign({},cx,{sf:st.sf,sfT:st.sfT||undefined});
const sfLow=s=>String(s||'').replace(/^./,x=>x.toLowerCase());
// Выбранный пользователем тариф расходится с условиями (или условия не позволяют определить тариф): нужна причина и подтверждение
function sfManBad(cx,st){if(!st.sfTouch||!st.sfT)return false;const a=sfAuto(sfDraft(cx,st));return !!a&&(!a.t||a.t.id!==st.sfT)}
const sfWarnHtml=a=>a&&a.warn.length?a.warn.map(w=>`<div class="note warn">${ic('alert')}<span>${esc(w)}</span></div>`).join(''):'';
function sfFields(p,cx,st,edit){const d=sfDraft(cx,st);if(!sfNeed(d))return '';const a=sfAuto(d);const cur=st.sfT?sfById(st.sfT):null;const ro=edit===false;
  const yn=k=>{const v=typeof st.sf[k]==='boolean'?st.sf[k]:k==='gov'?false:null;return `<div class="seg" role="group" aria-label="${esc(SF_FLAGS.find(f=>f[0]===k)[1])}" data-sff="${k}">${[[true,'Да'],[false,'Нет']].map(([x,l])=>`<button type="button" data-v="${x}" class="${v===x?'on':''}" ${ro?'disabled':''}>${l}</button>`).join('')}</div>`};
  const s=cur?sfState(d):null;const bad=!!(s&&s.bad);const why=bad?sfBadWhy(s):'';const show=cur||a&&a.t;
  return `<div class="fld full sf-box" data-f="${p}-sf"><label>Тариф Соцфонда${tipI('Тариф страховых взносов за работников. Система предлагает его по основному ГКЭД, статусам ПВТ / ПКИ и признакам ниже. Ставки, предельная база и ограничения по ГКЭД — из справочника платформы. Зарплату платформа не считает.')}</label>
    <div class="sf-flags">${SF_FLAGS.map(([k,l])=>`<div class="sf-flag"><span class="grow">${esc(l)}${SF_FLAG_HINT[k]?`<span class="hint">${esc(SF_FLAG_HINT[k])}</span>`:''}</span>${yn(k)}</div>`).join('')}</div>
    <div class="sf-pick">${sel(p+'-sft',[['',a&&a.t?`Определить автоматически: ${sfShort(a.t)}`:'Определить автоматически'],...sfTariffs().map(t=>[t.id,sfTitle(t)+(t.total?' · '+t.total:'')])],st.sfT||'',`aria-label="Тариф Соцфонда" ${ro?'disabled':''}`)}</div>
    ${a?a.t?`<div class="hint">${ic('info','sm')} По условиям: <b>${esc(sfShort(a.t))}</b>${a.t.total?' · '+esc(a.t.total):''} — ${esc(a.why.join('; '))}${a.miss.length?`. Не указано: ${esc(a.miss.join(', '))}`:''}</div>`:`<div class="note warn">${ic('alert')}<span>Тариф Соцфонда не определён: укажите ${esc(a.miss.join(', '))}</span></div>`:''}
    ${sfWarnHtml(a)}
    ${bad?`<div class="note warn sf-n">${ic('alert')}<span class="grow">${st.sfTouch?`«${esc(sfShort(cur))}» не совпадает с условиями: ${esc(why)}`:cx.sfMan&&cx.sfT===st.sfT?`Выбран вручную, хотя не совпадает с условиями: ${esc(why)}${cx.sfWhy?`. Причина: ${esc(cx.sfWhy)}`:''}`:`Тариф ${esc(sfShort(cur))} больше не применим: ${esc(why)}`}</span>${!ro&&a&&a.t?`<button type="button" class="btn sm" data-sfto="${a.t.id}">Сменить на ${esc(sfLow(sfShort(a.t)).replace(/ тариф$/,''))}</button>`:''}</div>`:''}
    ${!bad&&sfManBad(cx,st)?`<div class="note warn">${ic('alert')}<span>«${esc(sfShort(cur))}» выбран, хотя по условиям тариф не определён: ${esc(a.miss.join(', '))} не указано</span></div>`:''}
    ${sfManBad(cx,st)?fld('Почему тариф выбран вручную',inp(p+'-sfwhy',st.sfWhy||'','placeholder="Например: подтверждено письмом ГНС"'),{req:true,full:true,id:p+'-sfwhy'}):''}
    ${show?`<details class="sf-d"><summary>${ic('coins','sm')}<span class="grow">Ставки: ${esc(sfTitle(cur||a.t))}</span>${ic('down','sm')}</summary>${sfTariffHtml(cur||a.t)}</details>`:''}</div>`}
// Обработчики блока: признаки Да/Нет, выбор тарифа, «Сменить на …», причина
function sfMount(el,p,st,snap,draw){const box=el.querySelector(`[data-f="${p}-sf"]`);if(!box)return;
  box.querySelectorAll('[data-sff]').forEach(g=>g.onclick=e=>{const b=e.target.closest('[data-v]');if(!b||b.disabled)return;snap&&snap();st.sf=Object.assign({},st.sf,{[g.dataset.sff]:b.dataset.v==='true'});draw()});
  const s=$('#'+p+'-sft',el);if(s)s.onchange=()=>{snap&&snap();st.sfT=s.value;st.sfTouch=true;draw()};
  box.querySelectorAll('[data-sfto]').forEach(b=>b.onclick=()=>{snap&&snap();st.sfT=b.dataset.sfto;st.sfTouch=true;st.sfWhy='';draw()});
  const w=$('#'+p+'-sfwhy',el);if(w)w.oninput=()=>{st.sfWhy=w.value}}
// Проверка перед сохранением: причина ручного выбора обязательна
function sfValid(el,p,cx,st){if(!sfManBad(cx,st))return true;return setErr(el,p+'-sfwhy',(st.sfWhy||'').trim()?'':'Укажите, почему тариф выбран вручную')}
// Подтверждение ручного выбора, который расходится с условиями
function sfConfirm(cx,st,go){if(!sfManBad(cx,st)||st.sfOk)return true;const d=sfDraft(cx,st);const s=sfState(d);const a=sfAuto(d);
  confirmDlg({title:'Тариф не совпадает с условиями',text:`«${esc(sfShort(sfById(st.sfT)))}» расходится с условиями: ${esc(sfBadWhy(s)||('не указано: '+a.miss.join(', ')))}. Сохранить ручной выбор? В истории контрагента запишется, кто и почему его поставил.`,ok:'Сохранить',run:()=>{st.sfOk=true;go()}});return false}
// Запись признаков и тарифа в контрагента после сохранения формы: без выбора — тариф по условиям; выбор, совпавший с условиями, — не ручной
function sfApply(c,st){const fl={};SF_FLAGS.forEach(([k])=>{if(typeof st.sf[k]==='boolean')fl[k]=st.sf[k]});const was=JSON.stringify(c.sf||{});if(Object.keys(fl).length)c.sf=fl;else delete c.sf;
  if(was!==JSON.stringify(c.sf||{}))log('cp',c.id,'Признаки для тарифа Соцфонда: '+SF_FLAGS.filter(([k])=>typeof fl[k]==='boolean').map(([k,l])=>`${l} — ${fl[k]?'да':'нет'}`).join('; '),c.id);
  const a=sfAuto(c);if(!a)return;
  if(!st.sfT){if(a.t&&(!c.sfT||st.sfTouch)&&(c.sfT!==a.t.id||c.sfMan))sfSet(c,a.t.id,false);return}
  if(!st.sfTouch)return;const man=!a.t||a.t.id!==st.sfT;if(st.sfT!==c.sfT||man!==!!c.sfMan)sfSet(c,st.sfT,man,man?(st.sfWhy||'').trim():'')}
const sfInit=c=>({sf:Object.assign({},c&&c.sf||{}),sfT:c&&c.sfT||'',sfTouch:false,sfWhy:''});

/* ═════════════ Карточка контрагента: строка «Тариф Соцфонда» ═════════════ */
function sfCardKv(c){const s=sfState(c);if(!s)return '';const ed=can('createCp')&&!c.archived;
  const fl=SF_FLAGS.map(([k,l])=>{const v=sfFlag(c,k);return `${esc(l.replace(/\s*\(.*\)$/,''))}: ${v===null?(k==='gov'?'нет':'<span class="yellow">не указано</span>'):v?'да':'нет'}`}).join(' · ');
  const why=sfBadWhy(s);const a=s.auto;
  return `<div class="sf-kv"><span class="k">Тариф Соцфонда</span><span class="v">${sfPill(s.cur)}${s.cur?` <span class="tag">${s.man?'выбран вручную':'определён автоматически'}</span>`:''} <button class="linkbtn" id="cp-sf" style="font-size:12px">${ed?(s.cur?'изменить':'Указать'):'ставки'}</button>
    <div class="hint">${fl}</div>
    ${s.none?`<div class="hint">${a.t?`По условиям подходит «${esc(sfShort(a.t))}»`:`Не указано: ${esc(a.miss.join(', '))}`}</div>`:''}
    ${s.bad&&!s.man?`<div class="note warn sf-n" style="margin-top:6px">${ic('alert')}<span class="grow">Тариф ${esc(sfShort(s.cur))} больше не применим: ${esc(why)}</span>${ed&&a.t?`<button type="button" class="btn sm" id="cp-sfto">Сменить на ${esc(sfLow(sfShort(a.t)).replace(/ тариф$/,''))}</button>`:''}</div>`:''}
    ${s.bad&&s.man?`<div class="note warn sf-n" style="margin-top:6px">${ic('alert')}<span>Выбран вручную, хотя не совпадает с условиями: ${esc(why)}${c.sfWhy?`. Причина: ${esc(c.sfWhy)}`:''}</span></div>`:''}
    ${!s.bad&&s.man&&c.sfWhy?`<div class="hint">Причина ручного выбора: ${esc(c.sfWhy)}</div>`:''}
    ${s.cur&&s.cur.id===(a.t||{}).id?sfWarnHtml(a):''}</span></div>`}
function sfCardMount(el,c,refresh){const b=$('#cp-sf',el);if(b)b.onclick=()=>sfDlg(c,refresh);const t=$('#cp-sfto',el);if(t)t.onclick=()=>{const s=sfState(c);if(!s||!s.auto.t)return;sfSet(c,s.auto.t.id,false);touch(c);refreshAll();refresh&&refresh();toast(`Тариф Соцфонда: ${sfShort(s.auto.t)}`)}}
// Окно «Тариф Соцфонда» из карточки: признаки, выбор тарифа, ставки
function sfDlg(c,refresh){const st=sfInit(c);const ed=can('createCp')&&!c.archived;
  openModal({form:true,render:m=>({title:'Тариф Соцфонда',sub:esc(c.name),body:`<div class="form">${sfFields('sfd',c,st,ed)}</div>`,
    foot:ed?'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="sfd-ok">Сохранить</button>':'<button class="btn cta" data-close>Закрыть</button>',
    mount(el){sfMount(el,'sfd',st,null,()=>m.draw());const ok=$('#sfd-ok',el);if(!ok)return;
      ok.onclick=()=>{if(!sfValid(el,'sfd',c,st))return;if(!sfConfirm(c,st,()=>ok.click()))return;sfApply(c,st);touch(c);m.close();refreshAll();refresh&&refresh();toast('Тариф Соцфонда сохранён')}}})})}

/* ═════════════ Отчёт STI-161 и подбор отчётов: ставки по тарифу контрагента ═════════════ */
// Виды отчётов, по которым сдаются взносы: из связей налога-взноса с тарифами (guide.reportTypes)
const sfTypeIds=()=>sfGuide().reportTypes||[];
function sfTypeNote(t,cx){if(!t||!sfTypeIds().includes(t.id)||!cx)return '';const s=sfState(cx);if(!s)return '';const x=s.cur||s.auto.t;
  if(!x)return `<div class="note warn">${ic('alert')}<span>Тариф Соцфонда не определён: ставки взносов зависят от него</span></div>`;
  const cap=sfCapTxt(x);return `<div class="note">${ic('shield')}<span><b>Тариф: ${esc(sfShort(x))}</b>${s.cur?'':' (по условиям)'} — ${esc(sfRatesTxt(x))}.${cap?` Предельная база: ${esc(cap.replace(/^база /,''))}. Взносы не начисляются на часть зарплаты выше предельной базы.`:''}</span></div>`}

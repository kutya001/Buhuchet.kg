'use strict';
// Подбор отчётов, льгот и особых статусов (ТЗ «Подбор отчётов и налогов, льгот и статусов»)
/* ═════════════ Расчёт наборов из справочников платформы ═════════════
   Наборы не вводятся вручную: группы считаются по полям вида отчёта (group, regimes, who, bizSize, regimesNot,
   enRatesNot, basis, preselect, gked), по справочнику «Налоговые льготы и особые статусы» (adds — добавляет,
   removes — делает ненужными) и по справочнику «Основания для отчётов».
   cx — контрагент или черновик формы: form, regime, regime2, ben (названия), bases (коды), size, gked, gked2, assign. */
const PK_GROUPS=[['regime','Обязательно по режиму'],['status','По статусу'],['basis','По основанию'],['all','Для всех'],['stat','Формы Нацстаткома'],['choice','По желанию'],['gked','Подходит по ГКЭД']];
const PK_MUST=new Set(['regime','status','basis','all']);
// Формы Нацстаткома — виды с основанием «В списке Нацстаткома»: в «Рекомендуемых» своя свёрнутая группа, только при этом основании;
// форма с ГКЭД-подсказкой, подходящая контрагенту, — в «Подходит по ГКЭД» при любом основании. Разовые виды при основании — в «По желанию»
const PK_STAT='statSample';const pkStat=t=>!!t&&(t.basis||[]).includes(PK_STAT);
const PK_ONE='Разовый: создаётся через «Разовый отчёт»';
const pkOffT=t=>!!t&&(t.active===false||t.group==='disabled');
const BIZSZ=DB.ref.bizSize||[];const bizName=k=>(BIZSZ.find(x=>x.code===k)||{}).name||'';
const benByName=n=>DICT.benefits.items.find(b=>b.name===n);
const baseOf=k=>(DICT.bases?DICT.bases.items:[]).find(b=>b.code===k);
const baseLow=k=>{const b=baseOf(k);return b?b.name.replace(/^Есть /,'').replace(/^./,s=>s.toLowerCase()):k};
const pkBens=cx=>(cx.ben||[]).map(benByName).filter(Boolean);
const pkOn=t=>!!(ORG.types[t.id]&&ORG.types[t.id].on)&&t.active!==false;
const pkWho=(t,cx)=>!t.who||t.who==='all'||!cx.form||formEnd(cx)===t.who;
const whoText=w=>w==='org'?'только организации':w==='ip'?'только ИП':'организации и ИП';
// Строки ЕН контрагента (коды ЕНС): выбранные в назначении, иначе подобранные по ГКЭД и статусам (ТЗ «Ставка единого налога по ГКЭД»)
function pkEn(cx){if(cx.enCode)return [cx.enCode];const a=(cx.assign||[]).find(a=>!a.to&&isEnT(a.t)&&(a.en||[]).length);return a?a.en.map(e=>e.code):enAuto(cx).map(e=>e.code)}
// «Не для ставок ЕН»: вид не нужен, если все строки ЕНС контрагента из списка; добавочная строка (ЕНС-16) не считается
function pkEnNot(t,cx){if(!(t.enRatesNot||[]).length||!regsOf(cx).includes('Единый налог'))return false;const cs=pkEn(cx).filter(c=>!(enRow(c)||{}).addTo);return !!cs.length&&cs.every(c=>t.enRatesNot.includes(c))}
// Причина «Подходит по ГКЭД 94»: код или начало кода из перечня вида, под который попал ГКЭД контрагента
function pkGkCode(t,cx){const r=gkFor(t.gked,cx);if(gkEmpty(r)||!(r.in||[]).length)return '';const f=gkFit(t.gked,cpCodes(cx),cx);if(!f||!f.length)return '';return r.in.find(x=>gkHit(f[0],x))||f[0]}
// Возвращает rec: {id: {grp, pre, why}} — «Рекомендуемые»; no: {id: [статусы]} — не нужен по статусу; off: {id: причина} — нельзя назначить;
// stat: {id: 1} — форма Нацстаткома без основания «В списке Нацстаткома» (только во «Все», причина «Если в списке Нацстаткома»)
function pkCalc(cx){const rs=regsOf(cx),bens=pkBens(cx),bases=new Set(cx.bases||[]),size=cx.size||'small';const out={rec:{},no:{},off:{},hidden:[],stat:{}};
  const put=(t,grp,pre,why)=>{if(pkOn(t))out.rec[t.id]={grp,pre,why};else out.hidden.push(t.id)};
  RT.forEach(t=>{if(t.active===false||t.group==='disabled')return;
    const why=compatible(t,cx);if(why){out.off[t.id]=why;return}
    if(!pkWho(t,cx)){out.off[t.id]=`Для этой формы собственности не сдаётся: ${whoText(t.who)}`;return}
    const rm=bens.filter(b=>(b.removes||[]).includes(t.id));if(rm.length){out.no[t.id]=rm.map(b=>b.name);return}
    const ad=bens.filter(b=>(b.adds||[]).includes(t.id));
    if(ad.length)return put(t,'status',t.preselect!==false,`По статусу «${ad.map(b=>b.name).join('», «')}»`);
    const gk=()=>{const k=pkGkCode(t,cx);if(k)put(t,'gked',false,`Подходит по ГКЭД ${k}`)};
    if(t.oneOff&&(t.basis||[]).length){const on=t.basis.some(k=>bases.has(k));return put(t,on?'choice':'basis',false,on?t.choice||PK_ONE:'Если есть: '+t.basis.map(baseLow).join(' или '))}
    if(t.group==='status'||t.group==='optional')return gk();
    if((t.regimes||[]).length&&!rs.some(r=>t.regimes.includes(r)))return gk();
    if(rs.some(r=>(t.regimesNot||[]).includes(r)))return;
    if((t.bizSize||[]).length&&!t.bizSize.includes(size))return;
    if(pkEnNot(t,cx))return;
    if(t.group==='regime')return put(t,t.preselect?'regime':'choice',!!t.preselect,t.preselect?`Обязательно по режиму «${rs.filter(r=>(t.regimes||[]).includes(r)).join('», «')||rs[0]}»`:t.choice||'По выбору');
    if(t.group==='basis'){const on=(t.basis||[]).filter(k=>bases.has(k));const txt='Если есть: '+(t.basis||[]).map(baseLow).join(' или ');
      if(pkStat(t)){const k=pkGkCode(t,cx);if(k)return put(t,'gked',false,`Подходит по ГКЭД ${k}`);if(!bases.has(PK_STAT)){out.stat[t.id]=1;return}
        return put(t,'stat',!!t.preselect,t.preselect?'Основание: в списке Нацстаткома':'Если форма есть в списке от Нацстаткома')}
      if(on.length&&!t.preselect)return put(t,'choice',false,t.choice||txt);return put(t,'basis',on.length>0,on.length?'Основание: '+on.map(baseLow).join(', '):txt)}
    if(t.group==='all')return put(t,t.preselect?'all':'choice',!!t.preselect,t.preselect?'Для всех':t.choice||'По выбору');
    gk()});
  return out}
// Отчёты, которые отмечаются сами: «Обязательно по режиму», «По статусу», отмеченные «По основанию» и «Для всех»
const pkAuto=cx=>Object.entries(pkCalc(cx).rec).filter(([,r])=>r.pre).map(([id])=>id);
// Почему отчёт обязателен (для предупреждения при снятии)
function pkMustWhy(r){return r.grp==='regime'?r.why.replace('Обязательно по режиму','обязателен по режиму'):r.grp==='status'?r.why.replace('По статусу','обязателен по статусу'):r.grp==='basis'?'обязателен по основанию ('+r.why.replace('Основание: ','')+')':'обязателен для всех'}
function pkNear(t){if(t.oneOff)return '';const p=periodList(t).find(p=>dueOf(t,p).due>=TODAY);return p?`${fmtD(dueOf(t,p).due)} — за ${phuman(t,p)}`:''}
// Ссылка «Источник» — только http(s), открывается в новой вкладке
const srcLink=u=>/^https?:\/\//i.test(u||'')?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/i,'').split('/')[0])}</a>`:esc(u||'');
function pkCtxLine(cx){const bs=pkBens(cx);const parts=[cx.regime?`Режим: ${REGIME_FULL[cx.regime]||cx.regime}${cx.regime2?' + '+cx.regime2:''}`:`<span class="yellow strong">${ic('alert','sm')}Режим не указан</span>`,
  bs.length?`Статусы: ${bs.map(b=>esc(b.name)).join(', ')}`:'Статусов нет',cx.gked?`ГКЭД ${esc(cx.gked)}`:'ГКЭД не указан',esc(cx.form||'форма не указана'),bizName(cx.size||'small')];
  return `<div class="pk-ctx">${parts.join('<span class="faint"> · </span>')}</div>${cx.regime?'':`<div class="hint">Укажите режим, чтобы увидеть обязательные отчёты</div>`}`}

/* ── Описание вида отчёта ── */
function pkDescHtml(t,cx,o){const en=isEnT(t)&&(cx.gked||regsOf(cx).includes('Единый налог'))?aRateTxt({t:t.id,en:enAuto(cx)},t):'';const ab=DICT.benefits.items.filter(b=>(b.adds||[]).includes(t.id)),nb=DICT.benefits.items.filter(b=>(b.removes||[]).includes(t.id));
  const te=tOv(t,cx),ov=ovText(t,cx);
  const kv=[['Орган',esc(t.organ)],['Код формы',t.code?`<span class="mono">${esc(t.code)}</span>`:'—'],t.index?['Индекс формы',`<span class="mono">${esc(t.index)}</span>`]:null,t.respondents?['Кто сдаёт',esc(t.respondents)]:null,
    ['Периодичность',t.oneOff?'разовый — создаётся через «Разовый отчёт» на каждое событие':perOwn(t)?'задаётся в назначении':PER_LABEL[t.per]],[t.act==='pay'?'Срок':'Срок сдачи',esc(ruleText(t))],t.act!=='sub'&&!t.oneOff?['Срок оплаты',esc(payRuleText(t))]:null,
    ov?['Срок по статусу',esc(ov)]:null,t.oneOff?null:['Ближайший срок',esc(pkNear(te)||'—')],['Что нужно сделать',actPill(t.act,1)],t.act!=='sub'?['Что уплачивается',esc(paysTxt(t)||'—')]:null,(t.rates||[]).length?['Ставки',esc(t.rates.join(', '))+(en?` <span class="tag">по ГКЭД: ${esc(en)}</span>`:'')]:null,
    ['Режимы',(t.regimes||[]).length?esc(t.regimes.join(', ')):'любой'],(t.basis||[]).length?['Основание',esc((t.basis||[]).map(k=>(baseOf(k)||{}).name||k).join('; '))]:null,
    ab.length?['Добавляют статусы',esc(ab.map(b=>b.name).join(', '))]:null,nb.length?['Не нужен при статусах',esc(nb.map(b=>b.name).join(', '))]:null,
    !gkEmpty(t.gked)?['Виды деятельности (ГКЭД)',esc(gkRuleTxt(t.gked))+(t.gked.hint?' <span class="faint">— подсказка, не запрет</span>':'')]:null,['Для кого',whoText(t.who)],t.art?['Статья НК КР',esc(t.art)]:null,t.source?['Источник',srcLink(t.source)]:null].filter(Boolean);
  return `<div class="pk-desc"><h3 class="pk-dh">${esc(t.name)}${t.verify?` <span class="pill yellow sm">${ic('alert')}сверить</span>`:''}</h3>
    ${t.desc?`<p class="pk-p">${esc(t.desc)}</p>`:''}${t.choice?`<div class="note">${ic('info')}<span>${esc(t.choice)}</span></div>`:''}${t.extra?`<div class="hint">${esc(t.extra)}</div>`:''}
    ${t.verify?`<div class="note warn">${ic('alert')}<span>Данные уточняются, проверьте на сайте ГНС${t.verifyNote?': '+esc(t.verifyNote):''}</span></div>`:''}
    <div class="kv pk-kv">${kv.map(([k,v])=>`<div><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>
    ${typeof sfTypeNote==='function'?sfTypeNote(t,cx):''}${o&&o.btns||''}${taxesOfType(t.id).map(x=>`<details class="tg-tax"><summary>${ic('coins','sm')}<span class="grow">Подробнее о налоге: <b>${esc(x.name)}</b></span>${ic('down','sm')}</summary>${taxGuideHtml(x)}</details>`).join('')}</div>`}

/* ═════════════ Окно «Подбор отчётов» ═════════════
   o: {cx, sel (Set), before (Set назначенных), edit (можно отмечать), single (добавить один отчёт), onApply({sel, bases, forced})} */
// Подбор отчётов: одно содержимое для окна (создание контрагента, «Добавить отчёт») и для вкладки «Подбор отчётов» карточки контрагента.
// o: {cx, sel, before, single, edit, title, onApply}; st — состояние подбора (pkState), живёт между перерисовками.
const pkState=o=>({tab:o.single?'all':'rec',q:'',cur:null,open:null,act:'',kind:'',per:'',gOpen:{},autoBase:false,sel:new Set(o.sel||[]),forced:{},cx:Object.assign({},o.cx,{bases:[...(o.cx.bases||[])]})});
function pkView(o,st){const cx=st.cx;const before=o.before||new Set();const canEdit=o.edit!==false;
    const calc=pkCalc(cx);const q=norm(st.q).trim();
    const hit=t=>!q||[t.short,t.name,t.code,t.index].some(x=>norm(x||'').includes(q));
    const isOn=id=>st.sel.has(id);
    const stTag=id=>(before.has(id)?(isOn(id)?'<span class="tag">Назначен</span>':'<span class="pill red sm">Будет снят</span>'):isOn(id)?'<span class="pill green sm">Будет добавлен</span>':'')+(before.has(id)&&pkOffT(T[id])?'<span class="pill yellow sm">Вид отключён</span>':'');
    // Свёрнутая группа: заголовок-кнопка и «отмечено N из M»; открыта, если её открыли или поиск нашёл в ней форму
    const foldHead=(key,title,all,op)=>`<button type="button" class="pk-gt" data-pkg="${esc(key)}" aria-expanded="${op}"><span class="ck-chev ${op?'op':''}">${ic('right','sm')}</span><b>${esc(title)}</b></button><span class="chk-n">отмечено ${all.filter(isOn).length} из ${all.length}</span>`;
    const row=(t,why,dis)=>{const cur=st.cur===t.id,open=st.open===t.id;return `<div class="pk-row ${cur?'cur':''} ${dis?'dis':''} ${isOn(t.id)?'on':''}" data-pk="${t.id}">
      ${canEdit?`<input type="checkbox" class="pk-cb" data-pkc="${t.id}" ${isOn(t.id)?'checked':''} ${dis&&!isOn(t.id)?'disabled':''} aria-label="${esc(t.short)}">`:''}
      <div class="pk-main"><div class="pk-t"><b>${esc(t.short)}</b>${actPill(t.act,1)}<span class="muted">${esc(t.organ)} · ${esc(perTxt(t))}</span></div><div class="pk-why ${dis?'red':''}">${esc(why)}</div></div>
      <span class="pk-st">${stTag(t.id)}</span><span class="pk-chev" aria-hidden="true">${ic(open?'up':'down','sm')}</span></div>${open?`<div class="pk-inl">${descOf(t)}</div>`:''}`};
    const descOf=t=>{const dis=!!calc.off[t.id];return pkDescHtml(t,cx,{btns:canEdit&&!dis?`<div class="row" style="margin-top:4px"><button type="button" class="btn sm ${isOn(t.id)?'':'cta'}" data-pkyes="${t.id}" ${isOn(t.id)?'disabled':''}>${ic('check','sm')}Подходит</button><button type="button" class="btn sm" data-pkno="${t.id}" ${isOn(t.id)?'':'disabled'}>${ic('x','sm')}Не подходит</button></div>`:dis?`<div class="note warn">${ic('ban')}<span>${esc(calc.off[t.id])}</span></div>`:''})};
    let list='';
    if(st.tab==='rec'){PK_GROUPS.forEach(([g,title])=>{const all=Object.keys(calc.rec).filter(id=>calc.rec[id].grp===g),ids=all.filter(id=>hit(T[id]));if(!ids.length)return;
        const fold=g==='stat',op=!fold||!!st.gOpen[g]||!!q;
        list+=`<div class="pk-g"><div class="pk-gh">${fold?foldHead(g,title,all,op):`<b>${title}</b><span class="faint">${ids.length}</span>`}<span class="grow"></span>${op&&canEdit&&!o.single&&ids.some(id=>!isOn(id))?`<button type="button" class="linkbtn" data-pkall="${g}">Отметить все в группе</button>`:''}</div>${op?ids.map(id=>row(T[id],calc.rec[id].why)).join(''):''}</div>`});
      if(!list)list=`<div class="state">${ic('file','lg')}<b>${q?'Ничего не найдено':'Подобрать нечего'}</b><span>${q?'Попробуйте другое название или код формы, или откройте вкладку «Все».':cx.regime?'Для этого режима и статусов в каталоге нет подходящих подключённых видов. Откройте вкладку «Все».':'Укажите режим налогообложения, статусы и основания: по ним подбираются отчёты.'}</span></div>`;
      if(calc.hidden.length){const h=calc.hidden.map(id=>esc(T[id].short));list+=`<div class="hint">${ic('info','sm')} Подходят, но не подключены в организации: ${h.slice(0,8).join(', ')}${h.length>8?` и ещё ${h.length-8}`:''}. Подключает владелец в «Справочники» → «Виды отчётов».</div>`}}
    else{const types=RT.filter(t=>(pkOn(t)||before.has(t.id))&&(!pkOffT(t)||before.has(t.id))&&hit(t)&&(!st.act||t.act===st.act)&&(!st.kind||(st.kind==='regime'?t.kind==='regime':t.kind!=='regime'))&&(!st.per||(perOwn(t)?st.per==='own':t.per===st.per)));
      const organs=[...new Set(types.map(t=>t.organ))];
      // Орган из одних форм Нацстаткома — свёрнутая группа
      list=organs.map(org=>{const ts=types.filter(t=>t.organ===org),fold=ts.every(pkStat),op=!fold||!!st.gOpen['o:'+org]||!!q;
        return `<div class="pk-g"><div class="pk-gh">${fold?foldHead('o:'+org,org,ts.map(t=>t.id),op):`<b>${esc(org)}</b><span class="faint">${ts.length}</span>`}</div>${op?ts.map(t=>{const off=calc.off[t.id],no=calc.no[t.id],r=calc.rec[t.id];
        if(pkOffT(t))return row(t,'Вид отключён: новые отчёты не создаются, созданные остаются',true);
        return row(t,off||(no?`Не нужен по статусу «${no.join('», «')}»`:r?r.why:calc.stat[t.id]?'Если в списке Нацстаткома':t.choice||'Не подобран для этого контрагента'),!!off)}).join(''):''}</div>`}).join('')||`<div class="state">${ic('search','lg')}<b>Ничего не найдено</b><span>Измените поиск или фильтры.</span></div>`}
    const add=[...st.sel].filter(x=>!before.has(x)),rem=[...before].filter(x=>!st.sel.has(x));
    const bases=(DICT.bases?DICT.bases.items:[]).filter(b=>b.active||cx.bases.includes(b.code));
    const cur=st.cur&&T[st.cur];
    return {add,rem,
      body:`${txNote()}${pkCtxLine(cx)}
      ${st.autoBase&&cx.bases.includes(PK_STAT)?`<div class="note">${ic('info')}<span>Основание «${esc((baseOf(PK_STAT)||{}).name||PK_STAT)}» включено само: отмечена форма Нацстаткома. Остальные формы — в группе «Формы Нацстаткома».</span></div>`:''}
      ${!o.single&&bases.length?`<div class="pk-bases"><span class="muted">Основания:</span><div class="chipsel" id="pk-bases">${bases.map(b=>`<button type="button" data-base="${b.code}" class="${cx.bases.includes(b.code)?'on':''}" title="${esc(b.desc||'')}" ${canEdit?'':'disabled'}>${cx.bases.includes(b.code)?ic('check','sm'):''}${esc(b.name)}</button>`).join('')}</div></div>`:''}
      <div class="pk-bar"><span class="kb-search pk-q">${ic('search','sm')}<input class="inp" id="pk-q" value="${esc(st.q)}" placeholder="Название или код формы, например STI-091" aria-label="Поиск отчёта"></span>
        ${o.single?'':`<div class="seg" role="tablist" id="pk-tab">${[['rec','Рекомендуемые'],['all','Все']].map(([k,l])=>`<button type="button" data-tab="${k}" class="${st.tab===k?'on':''}">${l}</button>`).join('')}</div>`}</div>
      ${st.tab==='all'?`<div class="pk-flt">${sel('pk-act',[['','Сдача и уплата: все'],['sub','Сдача'],['pay','Уплата'],['both','Сдача + уплата']],st.act,'data-pkf="act"')}${sel('pk-kind',[['','Режимные и сквозные'],['regime','Режимные'],['cross','Сквозные']],st.kind,'data-pkf="kind"')}${sel('pk-per',[['','Любая периодичность'],['M','Месяц'],['Q','Квартал'],['H','Полугодие'],['Y','Год'],['own','По назначению']],st.per,'data-pkf="per"')}</div>`:''}
      <div class="pk-split"><div class="pk-list">${list}</div><div class="pk-side">${cur?descOf(cur):`<div class="state">${ic('info','lg')}<b>Описание отчёта</b><span>Нажмите на строку, чтобы увидеть, что это за отчёт, кто его сдаёт, сроки и ставки.</span></div>`}</div></div>`,
      sum:`<span class="muted pk-sum">Выбрано: <b>${st.sel.size}</b>${add.length?` · новых ${add.length}`:''}${rem.length?` · <span class="red">будет снято ${rem.length}</span>`:''}</span>`,
      ro:'<span class="muted">Только просмотр: менять отчёты может сотрудник с правом «Назначать отчёты контрагентам» или «Создавать и изменять контрагентов»</span>'}}
// Обработчики подбора; draw — перерисовка окна или карточки
function pkMount(el,o,st,draw){const cx=st.cx;const before=o.before||new Set();const m={draw};
        const q=$('#pk-q',el);q.oninput=()=>{st.q=q.value;const p=q.selectionStart;m.draw();const n=$('#pk-q',el);n.focus();n.setSelectionRange(p,p)};
        if($('#pk-tab',el))$('#pk-tab',el).onclick=e=>{const b=e.target.closest('[data-tab]');if(!b)return;st.tab=b.dataset.tab;m.draw()};
        $$('[data-pkf]',el).forEach(s=>s.onchange=()=>{st[s.dataset.pkf]=s.value;m.draw()});
        const toggle=(id,on)=>{if(on===st.sel.has(id))return;if(on){if(o.single)[...st.sel].forEach(x=>{if(!before.has(x))st.sel.delete(x)});st.sel.add(id);
            // Форма Нацстаткома без основания: основание «В списке Нацстаткома» включается само, отмечаются заранее отмечаемые формы
            if(pkStat(T[id])&&!cx.bases.includes(PK_STAT)){cx.bases=[...cx.bases,PK_STAT];st.autoBase=true;if(!o.single){const c=pkCalc(cx);Object.keys(c.rec).filter(x=>c.rec[x].grp==='stat'&&c.rec[x].pre).forEach(x=>st.sel.add(x))}
              toast(`Включено основание «${(baseOf(PK_STAT)||{}).name||PK_STAT}»`)}
            m.draw();return}
          const r=pkCalc(cx).rec[id];if(r&&PK_MUST.has(r.grp)&&r.pre)return confirmDlg({title:'Снять обязательный отчёт?',text:`Этот отчёт ${esc(pkMustWhy(r))}. Точно снять «${esc(T[id].short)}»?`,ok:'Снять',danger:true,run:()=>{st.sel.delete(id);st.forced[id]=pkMustWhy(r);m.draw()}});
          st.sel.delete(id);m.draw()};
        el.querySelectorAll('[data-pkc]').forEach(c=>{c.onclick=e=>e.stopPropagation();c.onchange=()=>{const v=c.checked;c.checked=!v;toggle(c.dataset.pkc,v)}});
        el.querySelectorAll('[data-pk]').forEach(r=>r.onclick=e=>{if(e.target.closest('input,button,a'))return;const id=r.dataset.pk;if(isMobile())st.open=st.open===id?null:id;st.cur=id;m.draw()});
        el.querySelectorAll('[data-pkyes]').forEach(b=>b.onclick=()=>toggle(b.dataset.pkyes,true));el.querySelectorAll('[data-pkno]').forEach(b=>b.onclick=()=>toggle(b.dataset.pkno,false));
        el.querySelectorAll('[data-pkg]').forEach(b=>b.onclick=()=>{const k=b.dataset.pkg;st.gOpen[k]=!st.gOpen[k];m.draw()});
        el.querySelectorAll('[data-pkall]').forEach(b=>b.onclick=()=>{const c=pkCalc(cx);Object.keys(c.rec).filter(id=>c.rec[id].grp===b.dataset.pkall).forEach(id=>st.sel.add(id));m.draw()});
        if($('#pk-bases',el))$('#pk-bases',el).onclick=e=>{const b=e.target.closest('[data-base]');if(!b||b.disabled)return;const k=b.dataset.base;const on=!cx.bases.includes(k);
          cx.bases=on?[...cx.bases,k]:cx.bases.filter(x=>x!==k);const c=pkCalc(cx);
          if(k===PK_STAT&&!on)st.autoBase=false;
          RT.filter(t=>(t.basis||[]).includes(k)&&(c.rec[t.id]||c.stat[t.id])).forEach(t=>{const r=c.rec[t.id];if(on&&r&&r.pre)st.sel.add(t.id);if(!on&&!(t.basis||[]).some(x=>cx.bases.includes(x))&&(c.stat[t.id]||r.grp==='basis'))st.sel.delete(t.id)});m.draw()}}
function pickDlg(o){const st=pkState(o);const canEdit=o.edit!==false;
  openModal({size:'wide',swipeHead:true,render:m=>{const v=pkView(o,st);
    return {title:o.single?'Добавить отчёт':'Подбор отчётов',sub:esc(o.title||''),body:v.body,
      foot:canEdit?`${v.sum}<div class="grow"></div><button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="pk-ok" ${o.single&&!v.add.length?'disabled':''}>${o.single?'Добавить':'Применить'}</button>`:`${v.ro}<div class="grow"></div><button class="btn cta" data-close>Закрыть</button>`,
      mount(el){el.classList.add('pickm');pkMount(el,o,st,()=>m.draw());
        if($('#pk-ok',el))$('#pk-ok',el).onclick=()=>{m.close();o.onApply&&o.onApply({sel:st.sel,bases:st.cx.bases,forced:st.forced})}}}}});
}
// Вкладка «Подбор отчётов» карточки контрагента: то же содержимое, применяется кнопкой «Применить» внизу вкладки.
// cs — состояние карточки; несохранённый выбор хранится в cs.pk, пока карточка открыта.
const pkCpBefore=c=>new Set(c.assign.filter(a=>!a.to).map(a=>a.t));
const pkSame=(a,b)=>a.size===b.size&&[...a].every(x=>b.has(x));
function pkCpDirty(c,cs){const p=cs.pk;return !!p&&(!pkSame(p.sel,pkCpBefore(c))||JSON.stringify(p.cx.bases)!==JSON.stringify(c.bases||[]))}
function pkCpTab(c,cs){const before=pkCpBefore(c);
  if(!cs.pk||!pkCpDirty(c,cs)){const ui=cs.pk?{tab:cs.pk.tab,q:cs.pk.q,cur:cs.pk.cur,open:cs.pk.open,act:cs.pk.act,kind:cs.pk.kind,per:cs.pk.per}:{};cs.pk=Object.assign(pkState({cx:c,sel:before}),ui)}
  const o={cx:c,before,edit:pkEdit(c),title:c.name};const v=pkView(o,cs.pk);const dirty=pkCpDirty(c,cs);
  return `<div class="pk-tab">${v.body}<div class="pk-apply ${dirty?'dirty':''}">${o.edit?`${v.sum}<div class="grow"></div><button type="button" class="btn ghost sm" id="pk-reset" ${dirty?'':'disabled'}>Сбросить</button><button type="button" class="btn cta sm" id="pk-ok" ${dirty?'':'disabled'}>${ic('check','sm')}Применить</button>`:v.ro}</div></div>`}
function pkCpMount(el,c,cs,draw){const o={cx:c,before:pkCpBefore(c),edit:pkEdit(c),title:c.name};pkMount(el,o,cs.pk,draw);
  if($('#pk-reset',el))$('#pk-reset',el).onclick=()=>{cs.pk=null;draw()};
  if($('#pk-ok',el))$('#pk-ok',el).onclick=()=>{const p=cs.pk;const bases=p.cx.bases;const bch=JSON.stringify(bases)!==JSON.stringify(c.bases||[]);
    const fin=r=>{cs.pk=null;refreshAll();draw();toast(r?`Отчёты изменены: добавлено ${r.add.length}, снято ${r.rem.length}${r.del?`, удалено отчётов ${r.del}`:''}`:bch?'Основания сохранены':'Без изменений')};
    pkConfirm(c,p.sel,{forced:p.forced},r=>{if(bch){c.bases=[...bases];touch(c);log('cp',c.id,'Основания: '+(bases.map(baseLow).join(', ')||'нет'),c.id)}fin(r)})}}


/* ═════════════ Окно «Льготы и особые статусы» ═════════════
   o: {cx, ben (названия), dates ({название: {from, to}}), edit, onApply({ben, dates})} */
const benConflicts=b=>{const m=String(b.combines||'').match(/не совмещается с ([^;.]+)/i);return m?(m[1].match(/ЛЬГ-\d+/g)||[]):[]};
function benWarns(b,cx,chosen){const w=[];const codes=cpCodes(cx);
  if(!gkEmpty(b.gked)&&!b.gked.hint&&(b.gked.in||[]).length&&codes.length){const f=gkFit(b.gked,codes,cx);if(!f||!f.length)w.push(`Виды деятельности контрагента не соответствуют статусу «${b.name}»`)}
  chosen.filter(x=>x!==b.name).map(benByName).filter(Boolean).forEach(x=>{if(benConflicts(b).includes(x.code)||benConflicts(x).includes(b.code))w.push(`«${b.name}» не совмещается с «${x.name}»: ${b.combines||x.combines}`)});
  if(b.who&&b.who!=='all'&&cx.form&&formEnd(cx)!==b.who)w.push(`Применяют ${whoText(b.who)}`);return w}
// «Меняет сроки» статуса словами: «НДС: сдача — до последнего дня…; уплата — до 25-го…»
const benOvTxt=b=>Object.keys(b.dueOverride||{}).filter(id=>T[id]).map(id=>`${T[id].short}: ${ovText(T[id],{ben:[b.name]}).replace(/ \(статус «[^»]*»\)$/,'').replace(/^./,s=>s.toLowerCase())}`).join('; ');
function benDescHtml(b,cx,btns){const tl=ids=>(ids||[]).map(id=>T[id]?T[id].short:id).join(', ');const ug=(b.suggest&&b.suggest.ugns||[]).map(ugnsLabel).filter(Boolean);
  const kv=[['Тип',b.kind==='status'?'Статус — льгот не даёт, меняет набор отчётов или сроки':'Льгота'],['Что даёт',esc(b.gives||'—')],benOvTxt(b)?['Меняет сроки',esc(benOvTxt(b))]:null,ug.length?['Ставится по УГНС',esc(ug.join(', '))+(cx.ugns&&(b.suggest.ugns||[]).includes(cx.ugns)?' <span class="pill blue sm">у контрагента</span>':'')]:null,['Кто может применять',whoText(b.who||'all')],b.cond?['Условия',esc(b.cond)]:null,b.confirm?['Как подтверждается',esc(b.confirm)]:null,b.combines?['Совмещается с',esc(b.combines)]:null,
    b.term||b.until?['Срок действия',esc(b.term||'до '+fmtD(b.until))]:null,!gkEmpty(b.gked)?['Виды деятельности (ГКЭД)',esc(gkRuleTxt(b.gked))+(b.gked.hint?' <span class="faint">— подсказка, не запрет</span>':'')+(b.gked.note?`<div class="hint">${esc(b.gked.note)}</div>`:'')]:null,b.gked&&(b.gked.warn||[]).length?['Предупреждать при ГКЭД',esc(b.gked.warn.join(', '))]:null,
    (b.adds||[]).length?['Добавляет отчёты',esc(tl(b.adds))]:null,(b.removes||[]).length?['Делает ненужными',esc(tl(b.removes))]:null,b.art?['Статья НК КР',esc(b.art)]:null].filter(Boolean);
  return `<div class="pk-desc"><h3 class="pk-dh">${esc(b.name)}${b.verify?` <span class="pill yellow sm">${ic('alert')}сверить</span>`:''}</h3>
    ${b.verify?`<div class="note warn">${ic('alert')}<span>Данные уточняются${b.verifyNote?': '+esc(b.verifyNote):''}</span></div>`:''}
    <div class="kv pk-kv">${kv.map(([k,v])=>`<div class="${k==='Что даёт'||k==='Условия'?'pk-wide':''}"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>${btns||''}</div>`}
// o.cp — сохранённый контрагент: окно заранее показывает, у скольких несданных отчётов изменится срок по статусу
function benPickDlg(o){const cx=o.cx;const ugb=ugBens(cx.ugns);const st={tab:'fit',q:'',cur:null,open:null,ben:[...(o.ben||[])],dates:JSON.parse(JSON.stringify(o.dates||{}))};const canEdit=o.edit!==false;
  // Тарифы Соцфонда выбираются отдельно (блок «Тариф Соцфонда»), в окне льгот их нет
  const items=()=>DICT.benefits.items.filter(b=>b!==sfSpBen()&&(b.active||st.ben.includes(b.name)));
  const fits=b=>!gkEmpty(b.gked)&&(b.gked.in||[]).length&&cpCodes(cx).length&&(gkFit(b.gked,cpCodes(cx),cx)||[]).length>0;
  openModal({size:'wide',swipeHead:true,render:m=>{const q=norm(st.q).trim();const hit=b=>!q||[b.name,b.gives,b.code].some(x=>norm(x||'').includes(q));
    const list=items().filter(b=>(st.tab==='all'||fits(b))&&hit(b));const on=b=>st.ben.includes(b.name);
    const row=b=>{const w=on(b)?benWarns(b,cx,st.ben):[];const open=st.open===b.code;return `<div class="pk-row ${st.cur===b.code?'cur':''} ${on(b)?'on':''}" data-bn="${b.code}">${canEdit?`<input type="checkbox" class="pk-cb" data-bnc="${esc(b.name)}" ${on(b)?'checked':''} aria-label="${esc(b.name)}">`:''}
      <div class="pk-main"><div class="pk-t"><b>${esc(b.name)}</b>${b.kind==='status'?'<span class="pill sm">Статус</span>':''}${ugb.includes(b)?'<span class="pill blue sm" title="Отмечен по УГНС контрагента">по УГНС</span>':''}${b.verify?'<span class="pill yellow sm">сверить</span>':''}${fits(b)?`<span class="pill green sm">${ic('check')}по ГКЭД</span>`:''}</div><div class="pk-why">${esc(String(b.gives||'').split(/[;.]/)[0])}</div>
      ${w.length?`<div class="pk-why yellow">${ic('alert','sm')} ${w.map(esc).join('<br>')}</div>`:''}
      ${on(b)&&(b.until||b.term)?`<div class="row pk-dates">${fld('Действует с',inp('bd-f-'+b.code,(st.dates[b.name]||{}).from||'','type="date" data-bdf="'+esc(b.name)+'"'))}${fld('Действует по',inp('bd-t-'+b.code,(st.dates[b.name]||{}).to||b.until||'','type="date" data-bdt="'+esc(b.name)+'"'))}</div>`:''}</div>
      <span class="pk-chev" aria-hidden="true">${ic(open?'up':'down','sm')}</span></div>${open?`<div class="pk-inl">${desc(b)}</div>`:''}`};
    const desc=b=>benDescHtml(b,cx,canEdit?`<div class="row" style="margin-top:4px"><button type="button" class="btn sm ${on(b)?'':'cta'}" data-bnyes="${esc(b.name)}" ${on(b)?'disabled':''}>${ic('check','sm')}Подходит</button><button type="button" class="btn sm" data-bnno="${esc(b.name)}" ${on(b)?'':'disabled'}>${ic('x','sm')}Не подходит</button></div>`:'');
    const cur=st.cur&&DICT.benefits.items.find(b=>b.code===st.cur);const rd=o.cp?redueNote(cpRedueList(o.cp,st.ben,st.dates)):'';
    return {title:'Льготы и особые статусы',sub:esc(o.title||''),body:`${pkCtxLine(cx)}${rd?`<div class="note">${ic('history')}<span>${rd}. Сроки, изменённые вручную, не меняются.</span></div>`:''}
      <div class="pk-bar"><span class="kb-search pk-q">${ic('search','sm')}<input class="inp" id="bn-q" value="${esc(st.q)}" placeholder="Название льготы или статуса" aria-label="Поиск"></span><div class="seg" id="bn-tab">${[['fit','Подходят по ГКЭД'],['all','Все']].map(([k,l])=>`<button type="button" data-tab="${k}" class="${st.tab===k?'on':''}">${l}</button>`).join('')}</div></div>
      <div class="pk-split"><div class="pk-list">${list.map(row).join('')||`<div class="state">${ic('star','lg')}<b>${st.tab==='fit'&&!q?'По видам деятельности ничего не подходит':'Ничего не найдено'}</b><span>${cpCodes(cx).length||st.tab!=='fit'?'Откройте вкладку «Все», чтобы выбрать из всего справочника.':'Укажите ГКЭД контрагента, чтобы увидеть подходящие статусы, или откройте вкладку «Все».'}</span></div>`}</div>
      <div class="pk-side">${cur?desc(cur):`<div class="state">${ic('info','lg')}<b>Описание статуса</b><span>Нажмите на строку, чтобы увидеть, что даёт льгота, кто может её применять, условия и как она подтверждается.</span></div>`}</div></div>`,
      foot:canEdit?`<span class="muted pk-sum">Выбрано: <b>${st.ben.length}</b></span><div class="grow"></div><button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="bn-ok">Применить</button>`:`<div class="grow"></div><button class="btn cta" data-close>Закрыть</button>`,
      mount(el){el.classList.add('pickm');const qi=$('#bn-q',el);qi.oninput=()=>{st.q=qi.value;const p=qi.selectionStart;m.draw();const n=$('#bn-q',el);n.focus();n.setSelectionRange(p,p)};
        $('#bn-tab',el).onclick=e=>{const b=e.target.closest('[data-tab]');if(!b)return;st.tab=b.dataset.tab;m.draw()};
        const set=(n,v)=>{st.ben=v?[...new Set([...st.ben,n])]:st.ben.filter(x=>x!==n);if(!v)delete st.dates[n];m.draw()};
        el.querySelectorAll('[data-bnc]').forEach(c=>{c.onclick=e=>e.stopPropagation();c.onchange=()=>set(c.dataset.bnc,c.checked)});
        el.querySelectorAll('[data-bnyes]').forEach(b=>b.onclick=()=>set(b.dataset.bnyes,true));el.querySelectorAll('[data-bnno]').forEach(b=>b.onclick=()=>set(b.dataset.bnno,false));
        el.querySelectorAll('[data-bdf],[data-bdt]').forEach(i=>{i.onclick=e=>e.stopPropagation();i.onchange=()=>{const n=i.dataset.bdf||i.dataset.bdt;const d=st.dates[n]=st.dates[n]||{};d[i.dataset.bdf?'from':'to']=i.value}});
        el.querySelectorAll('[data-bn]').forEach(r=>r.onclick=e=>{if(e.target.closest('input,button,a,.fld'))return;const id=r.dataset.bn;if(isMobile())st.open=st.open===id?null:id;st.cur=id;m.draw()});
        if($('#bn-ok',el))$('#bn-ok',el).onclick=()=>{m.close();o.onApply&&o.onApply({ben:st.ben,dates:st.dates})}}}}});
}

/* ═════════════ Применение выбора к контрагенту ═════════════
   Снятый отчёт: прошлые периоды не меняются; отчёты текущего и будущих периодов в статусе «К сдаче» без денег и файлов удаляются;
   отчёты, по которым уже есть движение (статус дальше «К сдаче», деньги, файлы), остаются и доводятся вручную. */
function pkCurStart(t){return pstart(t,perOfYm(t,ym(TODAY)))}
function pkDroppable(c,id){const t=tFor({cp:c.id,t:id});const k=perOwn(T[id])?TODAY.slice(0,8)+'01':pkCurStart(t);
  return REPORTS.filter(r=>r.cp===c.id&&r.t===id&&!r.superseded&&r.status==='К сдаче'&&!r.subDate&&!(r.paid>0)&&!(r.files||[]).length&&r.pkey>=k&&!OPS.some(o=>(o.alloc||[]).some(x=>x.r===r.id)))}
const pkList=ids=>ids.map(id=>esc(T[id].short)).join(', ').replace(/\.$/,'');
function pkChangesHtml(c,add,rem){const del=rem.reduce((a,id)=>a+pkDroppable(c,id).length,0);const keep=rem.reduce((a,id)=>a+REPORTS.filter(r=>r.cp===c.id&&r.t===id&&!r.superseded&&OPEN.has(r.status)&&r.due>=TODAY).length,0)-del;
  return [add.length?`<b>Будет добавлено:</b> ${pkList(add)}. Отчёты создадутся с текущего периода.`:'',rem.length?`<b>Будет снято:</b> ${pkList(rem)}. Удалится несданных отчётов текущего и будущих периодов: ${del}.${keep>0?` Остаются ${keep}: по ним уже есть движение (статус, деньги или файлы), их доведите вручную.`:''} Отчёты прошлых периодов не меняются.`:''].filter(Boolean).join('<br><br>')}
function pkApply(c,sel,{rates,forced}={}){const cur=new Set(c.assign.filter(a=>!a.to).map(a=>a.t));const add=[...sel].filter(x=>!cur.has(x)),rem=[...cur].filter(x=>!sel.has(x));let del=0;
  rem.forEach(id=>{const a=c.assign.find(a=>a.t===id&&!a.to);const drop=pkDroppable(c,id);drop.forEach(r=>{const i=REPORTS.indexOf(r);if(i>=0)REPORTS.splice(i,1)});del+=drop.length;if(a)a.to=TODAY;
    log('cp',c.id,`Снят отчёт: ${T[id].name}${drop.length?` (удалено отчётов «К сдаче»: ${drop.length})`:''}${forced&&forced[id]?` — снял, хотя отчёт ${forced[id]}`:''}`,c.id)});
  if(add.length)assignTypes(c,add,null,rates||{});touch(c);derive();return {add,rem,del}}
// Подтверждение перед сохранением: что будет добавлено, что снято и сколько отчётов удалится
function pkConfirm(c,sel,opts,done){const cur=new Set(c.assign.filter(a=>!a.to).map(a=>a.t));const add=[...sel].filter(x=>!cur.has(x)),rem=[...cur].filter(x=>!sel.has(x));
  if(!add.length&&!rem.length){done&&done(null);return}
  confirmDlg({title:'Изменить отчёты контрагента?',text:pkChangesHtml(c,add,rem),ok:'Сохранить',danger:rem.length>0,run:()=>{const r=pkApply(c,sel,opts);done&&done(r)}})}
const pkEdit=c=>(can('createCp')||can('assign'))&&!c.archived;
// «Подобрать отчёты» из списка и меню открывает карточку контрагента на вкладке «Подбор отчётов»
function pickForCp(c){openCp(c,'pick')}
// Назначенные отчёты, которые статусы контрагента делают ненужными
function pkNotNeeded(cx,ids){const out=[];pkBens(cx).forEach(b=>{const x=(b.removes||[]).filter(id=>ids.includes(id)&&T[id]);if(x.length)out.push({b,ids:x})});return out}
function pkNotNeededNote(cx,ids,btnAttr){const nn=pkNotNeeded(cx,ids);if(!nn.length)return '';
  return nn.map(x=>`<div class="note warn">${ic('alert')}<span class="grow">По статусу «${esc(x.b.name)}» не нужны: ${x.ids.map(id=>esc(T[id].short)).join(', ')}</span>${btnAttr?`<button type="button" class="btn sm" ${btnAttr}="${x.ids.join(',')}">Снять</button>`:''}</div>`).join('')}
// Строка выбранных льгот с датами
function benLine(cx){const bs=pkBens(cx);if(!bs.length)return '<span class="faint">нет</span>';const dd=cx.benDates||{};
  const ugb=ugBens(cx.ugns);return bs.map(b=>{const d=dd[b.name]||{};const to=d.to||b.until;return `<span class="tag" title="${esc(b.gives)}">${esc(b.name)}${ugb.includes(b)?' · отмечен по УГНС':''}${d.from?' · с '+fmtD(d.from):''}${to?' · до '+fmtD(to):''}</span>`}).join(' ')}

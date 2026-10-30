'use strict';
// Добавление и изменение контрагента
/* ── Add counterparty ── */
/* Ставка по виду: выбирается из ставок каталога, если их несколько; у ЕН — строки ЕНС, у налога с продаж — ещё и добавляемые строки ставок */
const DEF_RATE=DB.ref.defaultRates;const defRate=t=>DEF_RATE[t.id]&&t.rates.includes(DEF_RATE[t.id])?DEF_RATE[t.id]:t.rates[0];
// rates: {id: ставка} у обычных видов, {id: [{code, v}]} у ЕН, {'add:id': [k]} — добавленные строки налога с продаж; cx — контрагент (ГКЭД, статусы, УГНС) для подбора строк ЕНС
function rateRows(chosen,rates,fixed,cx){const ids=[...chosen].filter(id=>T[id].rates&&T[id].rates.length);if(!ids.length)return '';
  return `<div class="tbl-wrap"><table class="mini rt-tbl"><thead><tr><th>Вид отчёта</th><th>Ставка</th>${fixed?'<th class="num">Повторяющаяся сумма, сом</th>':''}</tr></thead><tbody>${ids.map(id=>{const t=T[id];return `<tr><td><b>${esc(t.short)}</b> <span class="faint">${esc(t.name)}</span></td><td data-l="Ставка">${isEnT(t)?enEdHtml(id,rates,cx):`${t.rates.length>1?sel('rt-'+id,t.rates,rates[id]||defRate(t),`data-rate="${id}" style="min-height:30px;padding:3px 8px;width:auto"`):esc(t.rates[0])}${(t.rateAdd||[]).length?addEdHtml(id,t,rates):''}`}</td>${fixed?`<td class="num" data-l="Повторяющаяся сумма, сом">${t.sum?`<input class="inp tnum" data-fix="${id}" value="${fixed[id]??''}" inputmode="decimal" placeholder="нет" style="max-width:120px;margin-left:auto;text-align:right;min-height:30px;padding:3px 8px" aria-label="Повторяющаяся сумма ${esc(t.short)}">`:'<span class="faint">—</span>'}</td>`:''}</tr>`}).join('')}</tbody></table></div>`}
// Строки ЕНС: предлагаются строки основного и дополнительных ГКЭД, остальные — через «Показать все ставки»; у общепита — вариант по месту
function enEdHtml(id,rates,cx){const rows=rates[id]||(rates[id]=enAuto(cx));const sug=enSuggest(cx,rows);const ws=enWarn(rows);const all=EN_TABLE.filter(x=>x.active!==false).map(x=>x.code);
  const opt=c=>{const y=enRow(c);return y?[c,`${c} · ${rtTxt(y)} — ${y.activity}`]:null};
  return `<div class="en-ed">${rows.map((e,i)=>{const vs=rtVars(enRow(e.code));const cs=e.all?[...new Set([...all,e.code])]:[...new Set([...sug,e.code])];
    return `<div class="en-row">${sel(`en-${id}-${i}`,[...cs.map(opt).filter(Boolean),...(e.all?[]:[['__all','Показать все ставки…']])],e.code,`data-enc="${id}:${i}" aria-label="Ставка единого налога, строка ${i+1}"`)}${vs.length>1?sel(`env-${id}-${i}`,vs.map((o,j)=>[String(j),`${o.n} — ${o.pct}`]),String(e.v||0),`data-env="${id}:${i}" aria-label="Вариант ставки ${esc(e.code)}"`):''}${rows.length>1?`<button type="button" class="icon-btn sm" data-endel="${id}:${i}" title="Убрать строку" aria-label="Убрать строку ${esc(e.code)}">${ic('x','sm')}</button>`:''}</div>`}).join('')}
    <button type="button" class="linkbtn" data-enadd="${id}">${ic('plus','sm')}Добавить строку ставки</button>${ws.length?`<div class="en-warn">${ic('alert','sm')}<span>${ws.map(esc).join('<br>')}</span></div>`:''}</div>`}
// Налог с продаж: к основной ставке — строки «1 % безнал + 2 % нал» (покупатели на патенте, ЕН 0,5 % и 0 %, ПКИ, зона торговли) и «2 %» (обезличенный покупатель)
function addEdHtml(id,t,rates){const on=rates['add:'+id]||[];return `<div class="en-add">${t.rateAdd.map(x=>`<label class="row"><input type="checkbox" data-radd="${id}:${x.k}" ${on.includes(x.k)?'checked':''}><span>+ ${esc(rtTxt(x))} — ${esc(x.name)}${x.art?` <span class="faint">(${esc(x.art)})</span>`:''}</span></label>`).join('')}</div>`}
// o: {cx, redraw, man(id) — пользователь сам поменял ставку}
const bindRates=(el,rates,fixed,o={})=>{const man=id=>o.man&&o.man(id);
  $$('[data-rate]',el).forEach(s=>s.onchange=()=>{rates[s.dataset.rate]=s.value;man(s.dataset.rate)});
  const ed=(k,f)=>{const[id,i]=k.split(':');const rows=rates[id]=(rates[id]||[]).map(e=>Object.assign({},e));f(rows,+i);man(id);o.redraw&&o.redraw()};
  $$('[data-enc]',el).forEach(s=>s.onchange=()=>ed(s.dataset.enc,(rows,i)=>{if(s.value==='__all')rows[i].all=true;else rows[i]=Object.assign(enItem(enRow(s.value),o.cx),rows[i].all?{all:true}:{})}));
  $$('[data-env]',el).forEach(s=>s.onchange=()=>ed(s.dataset.env,(rows,i)=>{rows[i].v=+s.value}));
  $$('[data-endel]',el).forEach(b=>b.onclick=()=>ed(b.dataset.endel,(rows,i)=>rows.splice(i,1)));
  $$('[data-enadd]',el).forEach(b=>b.onclick=()=>ed(b.dataset.enadd+':0',rows=>{const c=enSuggest(o.cx,rows).find(x=>!rows.some(e=>e.code===x));rows.push(c?enItem(enRow(c),o.cx):{code:'ЕНС-04',all:true})}));
  $$('[data-radd]',el).forEach(x=>x.onchange=()=>{const[id,k]=x.dataset.radd.split(':');const a=new Set(rates['add:'+id]||[]);x.checked?a.add(k):a.delete(k);rates['add:'+id]=[...a];man(id)});
  if(fixed)$$('[data-fix]',el).forEach(i=>i.oninput=()=>{const n=parseNum(i.value);if(isNaN(n))delete fixed[i.dataset.fix];else fixed[i.dataset.fix]=n})};
// Форма делится на разделы «Реквизиты», «Режим и статусы», «Отчёты и обслуживание»: на ПК — все три на одном экране с оглавлением,
// на телефоне — три шага с «Назад» и «Далее» (ТЗ «Подбор отчётов и налогов, льгот и статусов»)
const CF_SECS=['Реквизиты','Режим и статусы','Отчёты и обслуживание'];
function cfToc(step,mob){return `<div class="cf-toc ${mob?'steps':''}" role="tablist">${CF_SECS.map((n,i)=>`<button type="button" class="cf-tc ${step===i+1?'on':''}" data-step="${i+1}"><span class="cf-n">${i+1}</span><span class="cf-l">${n}</span><span class="cf-b" data-secb="${i+1}"></span></button>${mob&&i<2?`<span class="cf-ar" aria-hidden="true">${ic('right','sm')}</span>`:''}`).join('')}</div>`}
const cfSec=(n,html)=>`<section class="cf-sec" data-sec="${n}"><h3 class="cf-h"><span class="cf-n">${n}</span>${CF_SECS[n-1]}</h3>${html}</section>`;
// Отметка у раздела в оглавлении: «заполнено» или сколько обязательных полей осталось
function cfMarks(el,need){[1,2,3].forEach(n=>{const b=el.querySelector(`[data-secb="${n}"]`);if(!b)return;const k=need.filter(x=>x[0]===n&&x[1]()).length;const bad=el.querySelectorAll(`.cf-sec[data-sec="${n}"] .fld.bad`).length;
  b.className='cf-b '+(bad?'red':k?'yellow':'green');b.innerHTML=bad?`${ic('alert','sm')}ошибок: ${bad}`:k?`осталось: ${k}`:`${ic('check','sm')}заполнено`})}
function cfShow(el,m,n){m.state.step=n;el.dataset.step=n;$$('.cf-sec',el).forEach(s=>s.classList.toggle('cur',+s.dataset.sec===n));$$('.cf-tc',el).forEach(b=>b.classList.toggle('on',+b.dataset.step===n));const mb=el.querySelector('.mb');if(mb)mb.scrollTop=0}
// Блок «Сдаёт отчёты» формы: выбранные виды с причиной подбора и кнопки «Подобрать отчёты», «+ Добавить отчёт»
function cfTypes(p,cx,sel,auto,before){const rec=pkCalc(cx).rec;before=before||new Set();
  return `<div class="cf-types" id="${p}-types">${[...sel].map(id=>{const t=T[id];if(!t)return '';const r=rec[id];return `<div class="cf-ty"><div class="grow"><b>${esc(t.short)}</b> ${actPill(t.act,1)} <span class="muted">${esc(t.organ)}</span><div class="hint">${esc(r?r.why:'Выбран вручную')}${before.size?before.has(id)?' · назначен':' · будет добавлен':''}</div></div><button type="button" class="icon-btn sm" data-unsel="${id}" title="Убрать ${esc(t.short)}" aria-label="Убрать ${esc(t.short)}">${ic('x','sm')}</button></div>`}).join('')||'<span class="faint">Отчёты не выбраны</span>'}</div>
    ${[...before].filter(id=>!sel.has(id)).length?`<div class="hint red">Будет снято: ${[...before].filter(id=>!sel.has(id)).map(id=>esc(T[id].short)).join(', ')}</div>`:''}
    <div class="row"><button type="button" class="btn sm cta" id="${p}-pick">${ic('list','sm')}Подобрать отчёты</button><button type="button" class="btn sm" id="${p}-one">${ic('plus','sm')}Добавить отчёт</button></div>
    ${auto?`<div class="hint">${ic('info','sm')} Подобрано автоматически по режиму, статусам и основаниям. Проверьте в «Подобрать отчёты»: там описание каждого отчёта.</div>`:''}`}
// Обязательные по подбору, но не выбранные — с кнопкой «Добавить»
function cfMissing(cx,sel,attr){const miss=pkAuto(cx).filter(id=>!sel.has(id));if(!miss.length)return '';return `<div class="note">${ic('info')}<span class="grow">Обязательны по режиму, статусам или основаниям, но не выбраны: ${miss.map(id=>esc(T[id].short)).join(', ')}</span><button type="button" class="btn sm" ${attr}="${miss.join(',')}">Добавить</button></div>`}
const sizeSeg=(id,v)=>`<div class="seg" role="group" aria-label="Размер бизнеса" id="${id}">${BIZSZ.map(b=>`<button type="button" data-sz="${b.code}" class="${(v||'small')===b.code?'on':''}" title="${esc(b.rule)}">${esc(b.name)}</button>`).join('')}</div>`;
const basesChips=(id,arr)=>`<div class="chipsel" id="${id}">${(DICT.bases?DICT.bases.items:[]).filter(b=>b.active||arr.includes(b.code)).map(b=>`<button type="button" data-base="${b.code}" class="${arr.includes(b.code)?'on':''}" title="${esc(b.desc||'')}">${arr.includes(b.code)?ic('check','sm'):''}${esc(b.name)}</button>`).join('')}</div>`;
// pre — создание «Из свидетельства и выписки»: {res, docs, files} — форма заполнена из документов; {manual, files} — пустая форма, файлы прикрепятся
function addCpDlg(kind,pre){
  const st={regime:'Единый налог',regime2:'',ben:[],benD:{},bases:[],size:'small',form:'ОсОО',kind:typeof kind==='string'?kind:'regular',per:'M',sel:new Set(),picked:false,forced:{},rates:{},rateMan:{},gked:'',gked2:[],reg:{},regOpen:!!pre,ugAdd:[],...sfInit(null)};
  if(pre&&pre.res){rdPrefill(st,pre);st.ugAdd=ugAuto(st,st.d.ugns);if(st.ugAdd.length)setTimeout(()=>toast(ugMsg(st.ugAdd)),600)}
  openModal({form:true,size:'mid',state:{step:1},render:m=>{const reg=st.kind==='regular';
    const fake={regime:st.regime,regime2:st.regime2,ben:st.ben,benDates:st.benD,bases:st.bases,size:st.size,form:st.form,gked:st.gked,gked2:st.gked2,sf:st.sf,kind:st.kind,ugns:(st.d||{}).ugns||'',reg:st.reg,assign:[]};
    if(reg&&!st.picked)st.sel=new Set(pkAuto(fake));
    // Ставка ЕН подставляется по ГКЭД, статусам и месту строками ЕНС целиком, пока пользователь не выбрал её сам
    EN_IDS.forEach(id=>{if(st.sel.has(id)&&!st.rateMan[id])st.rates[id]=enAuto(fake)});
    fake.assign=[...st.sel].filter(isEnT).map(id=>({t:id,en:enClean(st.rates[id])}));
    const d=st.d||{};const feeOn=feat('fee')&&can('fee')&&reg;const mob=isMobile();const step=m.state.step;
    const s1=`<div class="form">
    <div class="fld full"><label>Тип обслуживания</label><div class="seg" role="group" aria-label="Тип обслуживания" id="nc-kind" style="align-self:flex-start;width:max-content">${[['regular','Постоянное обслуживание'],['oneoff','Разовое']].map(([k,l])=>`<button type="button" data-k="${k}" class="${st.kind===k?'on':''}">${l}</button>`).join('')}</div><div class="hint">${reg?'Сдаёт отчёты, платит за обслуживание по тарифу.':'Отчётов и тарифа нет: только разовые услуги и проекты. Потом можно перевести в постоянное.'}</div></div>
    ${fld('Название',inp('nc-name',d.name||'','placeholder="ОсОО «Компания»"'),{req:true,full:true,id:'nc-name'})}
    ${fld('ИНН',inp('nc-inn',d.inn||'','inputmode="numeric" maxlength="14" class="inp mono" placeholder="14 цифр"'),{req:true,id:'nc-inn'})}
    ${fld('Телефон (звонок и WhatsApp)',phoneInput('nc-ph',d.ph),{req:true,id:'nc-ph'})}
    ${gkFields('nc',st)}${pre&&pre.res?rdGkBox(st,pre):''}
    ${fld('Форма собственности',sel('nc-form',[...(st.form?[]:[['','— выберите —']]),...DICT.forms.items.filter(x=>x.active).map(x=>x.name)],st.form),{req:true,id:'nc-form'})}
    ${fld('Налоговый орган (УГНС)',sel('nc-ugns',[['','— не указан —'],...DICT.ugns.items.filter(x=>x.active).map(x=>[ugK(x),ugT(x)])],d.ugns||''),{id:'nc-ugns',hint:'Список ведёт администратор платформы'})}
    ${fld('Руководитель',inp('nc-head',d.head||''),{id:'nc-head'})}${fld('Контактное лицо',inp('nc-contact',d.contact||''),{id:'nc-contact'})}
    <div class="fld full reg-h"><button type="button" class="linkbtn" id="nc-regt" aria-expanded="${st.regOpen}">${ic(st.regOpen?'down':'right','sm')}Регистрационные данные</button><span class="hint">полное наименование, регистрационный номер, ОКПО, юридический адрес, почта, даты регистрации, учредители${st.regOpen?'':' — необязательно'}</span></div>
    ${st.regOpen?regFields('nc',st.reg):''}</div>`;
    const s2=`<div class="form">
    ${fld('Режим налогообложения',sel('nc-reg',[['','— не указан —'],...DICT.regimes.items.filter(x=>x.active).map(x=>[x.name,REGIME_FULL[x.name]||x.name])],st.regime),{id:'nc-reg',hint:st.regime?'':'Не обязательно. Без режима обязательные отчёты не подбираются: проверьте назначение вручную.'})}
    ${st.regime?fld('Дополнительный режим',sel('nc-reg2',reg2Opts(st.regime,st.regime2),st.regime2),{id:'nc-reg2',hint:'Если контрагент совмещает режимы по разным видам деятельности, например ОНР и майнинг'}):'<div></div>'}
    ${fld('Размер бизнеса',sizeSeg('nc-size',st.size),{id:'nc-size',full:true,hint:esc((BIZSZ.find(b=>b.code===st.size)||{}).rule||'')+': от него зависит, ежемесячно или ежеквартально сдаются единый налог и налог с продаж'})}
    ${fld('Льготы и особые статусы',`<div class="cf-ben">${benLine(fake)}</div><button type="button" class="btn sm" id="nc-benb" style="align-self:flex-start">${ic('star','sm')}Выбрать льготы и статусы</button>`,{full:true,id:'nc-ben',hint:'Необязательно. В окне — описание каждой льготы, условия и какие отчёты она добавляет или делает ненужными'})}
    ${reg?fld('Основания для сквозных отчётов',basesChips('nc-bases',st.bases),{full:true,id:'nc-bases',hint:'Что есть у контрагента: по каждому основанию подбираются свои отчёты (например, сотрудники — Соцфонд)'}):''}
    ${reg?sfFields('nc',fake,st):''}
    <div class="fld full">${gkNote(fake,reg?st.sel:new Set())}</div></div>`;
    const s3=`<div class="form">
    ${reg?`<div class="fld full" data-f="nc-types"><label class="req">Сдаёт отчёты</label>${cfTypes('nc',fake,st.sel,!st.picked&&st.sel.size>0)}<div class="err" hidden></div></div>
    <div class="fld full">${pkNotNeededNote(fake,[...st.sel],'data-nnrm')}${st.picked?cfMissing(fake,st.sel,'data-addmiss'):''}${gkFitHint(fake,st.sel)}</div>`:''}
    ${reg&&st.sel.size?`<div class="fld full"><label>Ставки налога</label>${rateRows(st.sel,st.rates,null,fake)||'<span class="faint">У выбранных видов ставка не выбирается</span>'}<div class="hint">Ставки ведёт администратор платформы: у видов отчётов — в каталоге, у единого налога — в справочнике «Ставки единого налога» (строки ЕНС подставлены по ГКЭД и статусам). Повторяющуюся сумму (например, патент) можно задать позже в карточке, кнопка «Ставки».</div></div>`:''}
    ${fld('Ответственный бухгалтер',sel('nc-resp',[['','— выберите —'],...EMP.filter(e=>e.active).map(e=>[e.id,e.short])],d.resp||(me().role==='acc'?S.me:'')),{req:true,id:'nc-resp'})}
    ${fld(reg?'Дата начала обслуживания':'Дата первого обращения',inp('nc-start',d.start||TODAY,'type="date"'),{id:'nc-start'})}
    ${feeOn?`${fld('Стоимость обслуживания, сом',`<div class="row" style="flex-wrap:nowrap">${inp('nc-fee',d.fee||'','inputmode="decimal" class="inp tnum"')}<div class="seg" role="group" aria-label="Периодичность оплаты" id="nc-per" style="flex-shrink:0;white-space:nowrap">${[['M','в месяц'],['Y','в год']].map(([k,l])=>`<button type="button" data-p="${k}" class="${st.per===k?'on':''}">${l}</button>`).join('')}</div></div>`,{req:true,id:'nc-fee',hint:st.per==='Y'?'Годовой тариф начисляется раз в год, в месяце начала обслуживания':''})}${st.per==='M'?fld('Первый неполный месяц',sel('nc-first',[['prorate','Пропорционально дням'],['full','Полный месяц'],['next','Со следующего месяца']],d.first||'prorate'),{id:'nc-first'}):'<div></div>'}`:reg&&feat('fee')?`<div class="note full" style="grid-column:1/-1">${ic('lock')}<span>Стоимость обслуживания вам не видна. Её внесёт владелец или сотрудник с правом «Плата за обслуживание».</span></div>`:''}
    ${reg&&feat('taxpay')?`<label class="check-row full" style="grid-column:1/-1"><input type="checkbox" class="sw" id="nc-needf" ${d.needf?'checked':''}><span class="grow">Обязательно требовать прикрепления при поступлении от контрагента<div class="hint">Поступление денег нельзя будет сохранить без скрина перевода или квитанции</div></span></label>`:''}
    ${fld('Номер договора',inp('nc-cno',d.cno||'','placeholder="Например: 45/26"'),{id:'nc-cno'})}${fld('Дата договора',inp('nc-cdate',d.cdate||'','type="date"'),{id:'nc-cdate'})}
    ${fld('Примечание',`<textarea class="inp" id="nc-note" style="min-height:60px">${esc(d.note||'')}</textarea>`,{full:true,id:'nc-note'})}
    </div><div id="nc-pro" class="hint"></div>`;
    return {title:'Новый контрагент'+(pre?' '+rdBadge:''),sub:pre&&pre.res?'Заполнено из свидетельства и выписки — проверьте все поля. Ничего не сохранится до «Сохранить контрагента»':'Обязательные поля отмечены звёздочкой, остальные можно заполнить позже',
      body:`${pre&&pre.res?rdHead(st,pre):pre?RD_BETA:''}${pre&&(pre.files||[]).length?`<div class="note">${ic('clip')}<span>После сохранения к контрагенту прикрепятся: ${pre.files.map(esc).join(', ')}</span></div>`:''}
      <div class="cf ${mob?'steps':''}">${cfToc(step,mob)}${cfSec(1,s1)}${cfSec(2,s2)}${cfSec(3,s3)}</div>`,
    foot:mob?`<button class="btn ghost" id="cf-back">${ic('left','sm')}Назад</button><button class="btn ghost cf-cancel" data-close>Отмена</button><div class="grow"></div><button class="btn cta" id="cf-next">Далее${ic('right','sm')}</button><button class="btn cta" id="nc-ok">Сохранить контрагента</button>`:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="nc-ok">Сохранить контрагента</button>',
    mount(el){bindPhone(el,'nc-ph');bindRates(el,st.rates,null,{cx:fake,redraw:()=>{snap();m.draw()},man:id=>st.rateMan[id]=1});
      gkBind(el,'nc',st,()=>{snap();st.rateMan={};m.draw()});
      const snap=()=>{st.d={name:val(el,'nc-name'),inn:val(el,'nc-inn'),ph:readPhone(el,'nc-ph').ph,resp:val(el,'nc-resp'),start:val(el,'nc-start'),ugns:val(el,'nc-ugns'),fee:$('#nc-fee',el)?val(el,'nc-fee'):(st.d||{}).fee||'',first:$('#nc-first',el)?val(el,'nc-first'):'prorate',head:val(el,'nc-head'),contact:val(el,'nc-contact'),cno:val(el,'nc-cno'),cdate:val(el,'nc-cdate'),note:val(el,'nc-note'),needf:!!($('#nc-needf',el)&&$('#nc-needf',el).checked)};if($('#nc-rfull',el))st.reg=regRead(el,'nc')};
      // Проверки полей по разделам: [раздел, id поля, () => текст ошибки]
      const fee=()=>parseNum(val(el,'nc-fee'));
      const checks=()=>{const inn=val(el,'nc-inn'),ph=readPhone(el,'nc-ph');const dup=CPS.find(c=>c.inn===inn);return [
        [1,'nc-name',()=>val(el,'nc-name')?'':'Введите название'],
        [1,'nc-inn',()=>!/^\d{14}$/.test(inn)?'ИНН — ровно 14 цифр':!/^[0-2]/.test(inn)?'ИНН в КР начинается с 0, 1 или 2':dup?`Такой ИНН уже есть: ${dup.name}${dup.archived?' (в архиве — верните его из архива, а не создавайте заново)':''}`:''],
        [1,'nc-ph',()=>ph.empty?'Введите номер телефона':!ph.ok?`Номер для этой страны — ${ph.need} цифр`:''],
        [1,'nc-gk',()=>st.gked?'':'Выберите основной вид деятельности'],[1,'nc-form',()=>st.form?'':'Выберите форму собственности'],
        [2,'nc-reg',()=>gkCheck(fake).block[0]||''],
        st.kind==='regular'?[3,'nc-types',()=>st.sel.size?'':'Выберите хотя бы один отчёт']:null,[3,'nc-resp',()=>val(el,'nc-resp')?'':'Выберите ответственного'],
        $('#nc-fee',el)?[3,'nc-fee',()=>isNaN(fee())||fee()<0?'Введите сумму, 0 — допустимо':'']:null].filter(Boolean)};
      const need=[[1,()=>!val(el,'nc-name')],[1,()=>!val(el,'nc-inn')],[1,()=>readPhone(el,'nc-ph').empty],[1,()=>!st.gked],[1,()=>!st.form],[3,()=>st.kind==='regular'&&!st.sel.size],[3,()=>!val(el,'nc-resp')],[3,()=>!!$('#nc-fee',el)&&val(el,'nc-fee')==='']];
      const marks=()=>cfMarks(el,need);marks();['input','change'].forEach(ev=>el.addEventListener(ev,marks));
      const validate=sec=>{let ok=checks().filter(c=>!sec||c[0]===sec).map(([,id,f])=>setErr(el,id,f())).every(Boolean);if((!sec||sec===1)&&st.regOpen&&!regCheck(el,'nc'))ok=false;marks();return ok};
      cfShow(el,m,step);
      $$('.cf-tc',el).forEach(b=>b.onclick=()=>{const n=+b.dataset.step;if(mob){if(n>m.state.step&&![...Array(n-m.state.step).keys()].every(k=>validate(m.state.step+k)))return;cfShow(el,m,n)}else{const s=el.querySelector(`.cf-sec[data-sec="${n}"]`);s&&s.scrollIntoView({block:'start',behavior:'smooth'})}});
      if($('#cf-next',el))$('#cf-next',el).onclick=()=>{const n=m.state.step;if(!validate(n)){const f=el.querySelector(`.cf-sec[data-sec="${n}"] .fld.bad`);f&&f.scrollIntoView({block:'center',behavior:'smooth'});return}cfShow(el,m,Math.min(3,n+1))};
      if($('#cf-back',el))$('#cf-back',el).onclick=()=>cfShow(el,m,Math.max(1,m.state.step-1));
      $('#nc-regt',el).onclick=()=>{snap();st.regOpen=!st.regOpen;m.draw()};
      if(st.rd){{const g=$('.rd-gk',el),f=el.querySelector('[data-f="nc-gk"]');if(g&&f)f.after(g)}rdMarks(el,st);if(!m.rdOn){m.rdOn=1;['input','change'].forEach(ev=>el.addEventListener(ev,e=>{if(e.target.id==='nc-start')st.rd.startSet=true;if(MODALS.includes(m))rdMarks(el,st)}))}
        $$('[data-rdgk]',el).forEach(b=>b.onclick=()=>{snap();st.gked=b.dataset.rdgk;st.gked2=st.gked2.filter(x=>x!==st.gked);m.draw()});
        $$('[data-rdalt]',el).forEach(b=>b.onclick=()=>{const[k,i]=b.dataset.rdalt.split(':');const a=st.rd.alt[k];const x=a[+i];snap();
          a.unshift(a.splice(+i,1)[0]);st.rd.v[k]=x.v;st.rd.src[k]=x.src;if(k==='form')st.form=x.v;else if(k==='phone')st.d.ph=x.v;else if(['name','inn','head'].includes(k))st.d[k]=x.v;else st.reg[k]=x.v;m.draw()})}
      const pro=()=>{const p=$('#nc-pro',el);if(!$('#nc-fee',el)){p.textContent='';return}const n=parseNum(val(el,'nc-fee')),s=val(el,'nc-start'),f=$('#nc-first',el)?val(el,'nc-first'):'full';if(isNaN(n)||!s){p.textContent='';return}const k=s.slice(0,7);const days=+lastDay(k).slice(8),left=days-(+s.slice(8))+1;
        if(st.per==='Y'){p.textContent=`Начисление ${som(n)} раз в год: в ${ymLabel(k)}, затем каждый ${MONTHS[+k.slice(5)-1].toLowerCase()}.`;return}
        p.textContent=s.slice(8)==='01'?`За ${ymLabel(k)} начислится полная ставка ${som(n)}.`:f==='prorate'?`За ${ymLabel(k)}: ${fmtM(n,false)} × ${left} / ${days} = ${som(Math.round(n*left/days))}`:f==='full'?`За ${ymLabel(k)} начислится полная ставка ${som(n)}.`:`За ${ymLabel(k)} ничего не начислится, с ${ymG(addMonths(k,1))} — ${som(n)}.`};
      ['nc-fee','nc-start','nc-first'].forEach(i=>{const x=$('#'+i,el);if(x){x.addEventListener('input',pro);x.addEventListener('change',pro)}});pro();
      $('#nc-kind',el).onclick=e=>{const b=e.target.closest('[data-k]');if(!b)return;snap();st.kind=b.dataset.k;m.draw()};
      if($('#nc-per',el))$('#nc-per',el).onclick=e=>{const b=e.target.closest('[data-p]');if(!b)return;snap();st.per=b.dataset.p;m.draw()};
      if($('#nc-reg2',el))$('#nc-reg2',el).onchange=e=>{snap();st.regime2=e.target.value;m.draw()};
      $('#nc-size',el).onclick=e=>{const b=e.target.closest('[data-sz]');if(!b)return;snap();st.size=b.dataset.sz;m.draw()};
      sfMount(el,'nc',st,snap,()=>m.draw());
      $('#nc-ugns',el).onchange=e=>{const old=(st.d||{}).ugns;snap();const add=ugAuto(st,e.target.value),drop=ugDrop(st,old,e.target.value);st.ugAdd=[...st.ugAdd.filter(n=>!drop.includes(n)),...add];if(add.length||drop.length)toast(ugMsg(add,drop));m.draw()};
      $('#nc-benb',el).onclick=()=>{snap();benPickDlg({cx:fake,ben:st.ben,dates:st.benD,title:val(el,'nc-name')||'Новый контрагент',onApply:({ben,dates})=>{st.ben=ben;st.benD=dates;m.draw()}})};
      if($('#nc-bases',el))$('#nc-bases',el).onclick=e=>{const b=e.target.closest('[data-base]');if(!b)return;snap();const k=b.dataset.base;st.bases=st.bases.includes(k)?st.bases.filter(x=>x!==k):[...st.bases,k];m.draw()};
      const openPick=single=>{snap();pickDlg({cx:fake,sel:st.sel,single,title:val(el,'nc-name')||'Новый контрагент',onApply:({sel,bases,forced})=>{st.sel=new Set(sel);st.bases=[...bases];Object.assign(st.forced,forced);st.picked=true;m.draw()}})};
      if($('#nc-pick',el))$('#nc-pick',el).onclick=()=>openPick(false);if($('#nc-one',el))$('#nc-one',el).onclick=()=>openPick(true);
      $$('[data-unsel]',el).forEach(b=>b.onclick=()=>{const id=b.dataset.unsel;const r=pkCalc(fake).rec[id];const go=()=>{snap();st.sel.delete(id);st.picked=true;if(r&&r.pre)st.forced[id]=pkMustWhy(r);m.draw()};
        if(r&&r.pre&&PK_MUST.has(r.grp))confirmDlg({title:'Снять обязательный отчёт?',text:`Этот отчёт ${esc(pkMustWhy(r))}. Точно снять «${esc(T[id].short)}»?`,ok:'Снять',danger:true,run:go});else go()});
      $$('[data-nnrm]',el).forEach(b=>b.onclick=()=>{snap();b.dataset.nnrm.split(',').forEach(id=>st.sel.delete(id));st.picked=true;m.draw()});
      $$('[data-addmiss]',el).forEach(b=>b.onclick=()=>{snap();b.dataset.addmiss.split(',').forEach(id=>st.sel.add(id));m.draw()});
      $('#nc-reg',el).onchange=e=>{snap();st.regime=e.target.value;if(st.regime2===st.regime||!st.regime)st.regime2='';[...st.sel].forEach(id=>{if(compatible(T[id],{regime:st.regime,regime2:st.regime2,form:st.form}))st.sel.delete(id)});m.draw();gkEnOk({gked:st.gked,regime:st.regime,regime2:st.regime2},st,()=>m.draw())};
      $('#nc-form',el).onchange=e=>{snap();st.form=e.target.value;[...st.sel].forEach(id=>{if(compatible(T[id],{regime:st.regime,form:st.form}))st.sel.delete(id)});m.draw()};
      $('#nc-inn',el).addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,14)});
      $('#nc-ok',el).onclick=()=>{if(m.saving)return;if(st.regOpen)snap();const name=val(el,'nc-name'),inn=val(el,'nc-inn'),ph=readPhone(el,'nc-ph'),resp=val(el,'nc-resp');
        const dup=CPS.find(c=>c.inn===inn);const reg=st.kind==='regular';
        const ok=validate(0);
        if(dup&&dup.archived&&can('createCp')){const e=el.querySelector('[data-f="nc-inn"] .err');if(e){e.insertAdjacentHTML('beforeend',' <button type="button" class="btn xs" id="nc-unarch">Вернуть из архива</button>');$('#nc-unarch',el).onclick=()=>{m.close();unarchiveCp(dup);openCp(dup)}}}
        if(!ok){const f=el.querySelector('.fld.bad');if(f){const s=f.closest('.cf-sec');if(mob&&s)cfShow(el,m,+s.dataset.sec);f.scrollIntoView({block:'center',behavior:'smooth'})}return}
        if(!sfValid(el,'nc',fake,st)){const f=el.querySelector('.fld.bad');if(f){const s=f.closest('.cf-sec');if(mob&&s)cfShow(el,m,+s.dataset.sec);f.scrollIntoView({block:'center',behavior:'smooth'})}return}
        if(!gkEnOk(fake,st,()=>$('#nc-ok',el).click()))return;
        if(!gkBenOk(fake,st,()=>$('#nc-ok',el).click()))return;
        if(!sfConfirm(fake,st,()=>$('#nc-ok',el).click()))return;
        if(pre&&pre.res&&pre.res.stopped&&!st.stopOk){confirmDlg({title:'Юрлицо прекращено',text:`По данным документа юрлицо прекращено (ликвидировано)${pre.res.status?`, статус «${esc(pre.res.status)}»`:''}. Всё равно создать контрагента?`,ok:'Создать',danger:true,run:()=>{st.stopOk=true;$('#nc-ok',el).click()}});return}
        m.saving=true;const start=val(el,'nc-start')||TODAY;
        const c={id:CPID++,name,inn,phone:ph.ph,form:st.form,regime:st.regime,regime2:st.regime2,ben:[...st.ben],benDates:JSON.parse(JSON.stringify(st.benD)),bases:[...st.bases],size:st.size,gked:st.gked,gked2:[...st.gked2],resp,head:val(el,'nc-head'),contact:val(el,'nc-contact'),start,contract:(()=>{const cno=val(el,'nc-cno').trim(),cd=val(el,'nc-cdate');return cno||cd?`${cno?'№ '+cno:'Без номера'}${cd?' от '+fmtD(cd):''}`:'—'})(),note:val(el,'nc-note'),paysTo:'emp',archived:false,assign:[],tariffs:[],feeDay:10,feePaid:{},first:$('#nc-first',el)?val(el,'nc-first'):'full',files:[],
          kind:st.kind,ugns:val(el,'nc-ugns')||null,reg:regEmpty(st.reg)?undefined:Object.assign({},st.reg),oneSum:false,needInFile:!!($('#nc-needf',el)&&$('#nc-needf',el).checked),periods:reg?[{from:start.slice(0,7),to:null}]:[]};
        if(!Object.keys(c.benDates).length)delete c.benDates;
        if($('#nc-fee',el))c.tariffs.push({amount:parseNum(val(el,'nc-fee')),per:st.per,from:start.slice(0,7),by:S.me,at:TODAY,note:'Первая ставка'});
        if(!st.regime)setTimeout(()=>toast('Режим налогообложения не указан: проверьте, что назначены правильные отчёты','alert',true),1600);
        const nR=REPORTS.length,nH=HIST.length;
        try{if(!c.reg)delete c.reg;if(pre&&(pre.files||[]).length){c.files.push(...pre.files);c.regFiles=[...pre.files]}
          born(c);CPS.push(c);CPM[c.id]=c;log('cp',c.id,pre&&pre.res?'Создан из свидетельства и выписки (бета)':reg?'Контрагент создан':'Создан разовый контрагент',c.id);st.ugAdd.filter(n=>c.ben.includes(n)).forEach(n=>log('cp',c.id,`Отмечен статус «${n}» по УГНС`,c.id));gkEnSave(c,st);if(reg)sfApply(c,st);if(reg){assignTypes(c,[...st.sel],start,st.rates);Object.keys(st.forced).filter(id=>!st.sel.has(id)).forEach(id=>log('cp',c.id,`Не назначен отчёт ${T[id].name}, хотя он ${st.forced[id]}`,c.id))}}
        catch(err){m.saving=false;const i=CPS.indexOf(c);if(i>=0)CPS.splice(i,1);delete CPM[c.id];REPORTS.length=nR;HIST.length=nH;console.error(err);toast('Не удалось сохранить контрагента, ничего не создано. Попробуйте ещё раз','alert',true);return}
        m.close();refreshAll();toast(reg?`Контрагент добавлен, отчётов создано: ${REPORTS.filter(r=>r.cp===c.id).length}`:'Разовый контрагент добавлен','building');openCp(c)}}};
  }});
}

/* ── Edit counterparty: реквизиты (тип обслуживания, отчёты, тариф и дата начала меняются своими действиями) ── */
function editCpDlg(c){
  const cm=String(c.contract||'').match(/№\s*(\S+)(?:\s+от\s+(\d\d)\.(\d\d)\.(\d{4}))?/);
  const before=new Set(c.assign.filter(a=>!a.to).map(a=>a.t));const reg=c.kind!=='oneoff';
  const st={form:c.form,regime:c.regime||'',regime2:c.regime2||'',ben:[...(c.ben||[])],benD:JSON.parse(JSON.stringify(c.benDates||{})),bases:[...(c.bases||[])],size:c.size||'small',sel:new Set(before),forced:{},ugns:c.ugns||'',ugAdd:[],gked:c.gked||'',gked2:[...(c.gked2||[])],...sfInit(c),d:{name:c.name,inn:c.inn,ph:c.phone,head:c.head||'',contact:c.contact||'',note:c.note||'',cno:cm?cm[1]:'',cdate:cm&&cm[2]?`${cm[4]}-${cm[3]}-${cm[2]}`:'',feeDay:c.feeDay},reg:Object.assign({},c.reg||{})};
  const feeOn=feat('fee')&&can('fee')&&c.kind!=='oneoff';
  openModal({form:true,size:'mid',render:m=>{const d=st.d;const bad=c.assign.filter(a=>!a.to&&st.sel.has(a.t)&&compatible(T[a.t],{regime:st.regime,regime2:st.regime2,form:st.form,assign:c.assign}));
    const fake=Object.assign({},c,{regime:st.regime,regime2:st.regime2,ben:st.ben,benDates:st.benD,bases:st.bases,size:st.size,form:st.form,gked:st.gked,gked2:st.gked2});
    return {title:'Изменить контрагента',sub:esc(c.name),body:`<div class="form">
    ${fld('Название',inp('ec-name',d.name,'placeholder="ОсОО «Компания»"'),{req:true,full:true,id:'ec-name'})}
    ${fld('ИНН',inp('ec-inn',d.inn,'inputmode="numeric" maxlength="14" class="inp mono" placeholder="14 цифр"'),{req:true,id:'ec-inn'})}
    ${fld('Телефон (звонок и WhatsApp)',phoneInput('ec-ph',d.ph),{req:true,id:'ec-ph'})}
    ${gkFields('ec',st)}
    ${fld('Форма собственности',sel('ec-form',DICT.forms.items.filter(x=>x.active||x.name===c.form).map(x=>x.name),st.form),{id:'ec-form'})}
    ${fld('Налоговый орган (УГНС)',sel('ec-ugns',[['','— не указан —'],...DICT.ugns.items.filter(x=>x.active||ugK(x)===st.ugns).map(x=>[ugK(x),ugT(x)])],st.ugns),{id:'ec-ugns',hint:'Список ведёт администратор платформы'})}
    ${fld('Режим налогообложения',sel('ec-reg',[['','— не указан —'],...DICT.regimes.items.filter(x=>x.active||x.name===c.regime).map(x=>[x.name,REGIME_FULL[x.name]||x.name])],st.regime),{id:'ec-reg'})}
    ${st.regime?fld('Дополнительный режим',sel('ec-reg2',reg2Opts(st.regime,st.regime2),st.regime2),{id:'ec-reg2'}):'<div></div>'}
    ${fld('Размер бизнеса',sizeSeg('ec-size',st.size),{id:'ec-size',full:true,hint:esc((BIZSZ.find(b=>b.code===st.size)||{}).rule||'')})}
    ${fld('Льготы и особые статусы',`<div class="cf-ben">${benLine(fake)}</div><button type="button" class="btn sm" id="ec-benb" style="align-self:flex-start">${ic('star','sm')}Выбрать льготы и статусы</button>`,{full:true,id:'ec-ben'})}
    ${reg?fld('Основания для сквозных отчётов',basesChips('ec-bases',st.bases),{full:true,id:'ec-bases'}):''}
    ${reg?sfFields('ec',fake,st,can('createCp')):''}
    <div class="full" style="grid-column:1/-1">${gkNote(fake)}</div>
    ${reg?`<div class="note full" style="grid-column:1/-1">${ic('list')}<span>Отчёты здесь не выбираются: их подбор с описаниями — на вкладке «Подбор отчётов» карточки контрагента. После смены режима, статусов, оснований или видов деятельности проверьте отчёты там.</span></div>`:''}
    ${bad.length?`<div class="note warn full" style="grid-column:1/-1">${ic('alert')}<span>Назначенные отчёты не меняются сами. Не подходят к новому режиму или форме: ${bad.map(a=>esc(T[a.t].short)).join(', ')}. После сохранения уберите их на вкладке «Подбор отчётов».</span></div>`:''}
    ${fld('Руководитель',inp('ec-head',d.head),{id:'ec-head'})}${fld('Контактное лицо',inp('ec-contact',d.contact),{id:'ec-contact'})}
    ${fld('Номер договора',inp('ec-cno',d.cno,'placeholder="Например: 45/26"'),{id:'ec-cno'})}${fld('Дата договора',inp('ec-cdate',d.cdate,'type="date"'),{id:'ec-cdate'})}
    ${feeOn?fld('День оплаты обслуживания',inp('ec-fday',d.feeDay,'type="number" min="1" max="28" class="inp tnum"'),{id:'ec-fday',hint:'Число месяца, до которого контрагент платит за обслуживание (1–28)'}):''}
    ${fld('Примечание',`<textarea class="inp" id="ec-note" style="min-height:60px">${esc(d.note)}</textarea>`,{full:true,id:'ec-note'})}
    <div class="fld full reg-h"><b>Регистрационные данные</b></div>
    ${regFields('ec',st.reg)}
    </div><div class="hint">Тип обслуживания, тариф, ответственный и периоды обслуживания меняются своими действиями в карточке.</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="ec-ok">Сохранить</button>',
    mount(el){bindPhone(el,'ec-ph');gkBind(el,'ec',st,()=>{snap();m.draw()});
      const snap=()=>{st.d={name:val(el,'ec-name'),inn:val(el,'ec-inn'),ph:readPhone(el,'ec-ph').ph||st.d.ph,head:val(el,'ec-head'),contact:val(el,'ec-contact'),note:val(el,'ec-note'),cno:val(el,'ec-cno'),cdate:val(el,'ec-cdate'),feeDay:$('#ec-fday',el)?val(el,'ec-fday'):st.d.feeDay};st.reg=regRead(el,'ec')};
      $('#ec-reg',el).onchange=e=>{snap();st.regime=e.target.value;if(st.regime2===st.regime||!st.regime)st.regime2='';m.draw();gkEnOk(Object.assign({},c,st),st,()=>m.draw())};if($('#ec-reg2',el))$('#ec-reg2',el).onchange=e=>{snap();st.regime2=e.target.value;m.draw()};
      $('#ec-form',el).onchange=e=>{snap();st.form=e.target.value;m.draw()};
      $('#ec-ugns',el).onchange=e=>{snap();const old=st.ugns;st.ugns=e.target.value;const add=ugAuto(st,st.ugns),drop=ugDrop(st,old,st.ugns);st.ugAdd=[...st.ugAdd.filter(n=>!drop.includes(n)),...add];st.ugDrop=[...(st.ugDrop||[]).filter(n=>!add.includes(n)),...drop];if(add.length||drop.length)toast(ugMsg(add,drop));m.draw()};
      $('#ec-size',el).onclick=e=>{const b=e.target.closest('[data-sz]');if(!b)return;snap();st.size=b.dataset.sz;m.draw()};
      sfMount(el,'ec',st,snap,()=>m.draw());
      $('#ec-benb',el).onclick=()=>{snap();benPickDlg({cx:fake,cp:c,ben:st.ben,dates:st.benD,edit:can('createCp'),title:c.name,onApply:({ben,dates})=>{st.ben=ben;st.benD=dates;m.draw()}})};
      if($('#ec-bases',el))$('#ec-bases',el).onclick=e=>{const b=e.target.closest('[data-base]');if(!b)return;snap();const k=b.dataset.base;st.bases=st.bases.includes(k)?st.bases.filter(x=>x!==k):[...st.bases,k];m.draw()};
      $('#ec-inn',el).addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,14)});
      $('#ec-ok',el).onclick=()=>{const name=val(el,'ec-name'),inn=val(el,'ec-inn'),ph=readPhone(el,'ec-ph');const dup=CPS.find(x=>x.inn===inn&&x.id!==c.id);const fd=$('#ec-fday',el)?parseInt(val(el,'ec-fday'),10):c.feeDay;
        const ok=[setErr(el,'ec-name',name?'':'Введите название'),
          setErr(el,'ec-inn',!/^\d{14}$/.test(inn)?'ИНН — ровно 14 цифр':!/^[0-2]/.test(inn)?'ИНН в КР начинается с 0, 1 или 2':dup?`Такой ИНН уже есть: ${dup.name}${dup.archived?' (в архиве)':''}`:''),
          setErr(el,'ec-ph',ph.empty?'Введите номер телефона':!ph.ok?`Номер для этой страны — ${ph.need} цифр`:''),
          $('#ec-fday',el)?setErr(el,'ec-fday',fd>=1&&fd<=28?'':'Число от 1 до 28'):true,
          setErr(el,'ec-gk',st.gked?'':'Укажите основной вид деятельности (ГКЭД)'),setErr(el,'ec-reg',gkCheck(Object.assign({},c,st)).block[0]||''),regCheck(el,'ec')].every(Boolean);
        if(!ok){const f=el.querySelector('.fld.bad');f&&f.scrollIntoView({block:'center',behavior:'smooth'});return}
        if(!sfValid(el,'ec',fake,st)){const f=el.querySelector('.fld.bad');f&&f.scrollIntoView({block:'center',behavior:'smooth'});return}
        if(!gkEnOk(Object.assign({},c,st),st,()=>$('#ec-ok',el).click()))return;
        if(!gkBenOk(Object.assign({},c,st),st,()=>$('#ec-ok',el).click()))return;
        if(!sfConfirm(fake,st,()=>$('#ec-ok',el).click()))return;
        const cno=val(el,'ec-cno'),cd=val(el,'ec-cdate');
        const nv={name,inn,phone:ph.ph,form:st.form,ugns:st.ugns||null,regime:st.regime,regime2:st.regime2,ben:[...st.ben],benDates:Object.keys(st.benD).length?JSON.parse(JSON.stringify(st.benD)):undefined,bases:[...st.bases],size:st.size,gked:st.gked,gked2:[...st.gked2],head:val(el,'ec-head'),contact:val(el,'ec-contact'),note:val(el,'ec-note'),contract:cno||cd?`${cno?'№ '+cno:'Без номера'}${cd?' от '+fmtD(cd):''}`:'—',feeDay:fd,reg:(r=>regEmpty(r)?undefined:r)(regRead(el,'ec'))};
        const L={name:'название',inn:'ИНН',phone:'телефон',form:'форма собственности',ugns:'налоговый орган (УГНС)',regime:'режим налогообложения',regime2:'дополнительный режим',ben:'льготы и особые статусы',benDates:'сроки льгот',bases:'основания для отчётов',size:'размер бизнеса',gked:'основной ГКЭД',gked2:'дополнительные ГКЭД',head:'руководитель',contact:'контактное лицо',note:'примечание',contract:'договор',feeDay:'день оплаты обслуживания',reg:'регистрационные данные'};
        const ch=Object.keys(nv).filter(k=>JSON.stringify(nv[k]??(k==='bases'?[]:k==='size'?'small':''))!==JSON.stringify(c[k]??(k==='bases'?[]:k==='size'?'small':'')));
        const sfCh=JSON.stringify(st.sf||{})!==JSON.stringify(c.sf||{})||(st.sfTouch&&(st.sfT||'')!==(c.sfT||''))||sfManBad(fake,st);
        // новое подтверждение права на режим (вопрос по ГКЭД) сохраняется и без других правок — например, после загрузки из Excel
        const gkNew=st.gkEnOk&&!(c.gkOk&&c.gkOk.sig===st.gkEnOk);if(!ch.length&&!sfCh&&!gkNew){m.close();return toast('Изменений нет')}
        const was=bad.length,ov=cpOvMap(c),ben0=c.ben||[],bases0=[...(c.bases||[])];Object.assign(c,nv);if(!c.benDates)delete c.benDates;if(!c.ugns)delete c.ugns;if(reg)sfApply(c,st);touch(c);if(ch.length)log('cp',c.id,'Изменено: '+ch.map(k=>L[k]).join(', '),c.id);
        gkEnSave(c,st);st.ugAdd.filter(n=>c.ben.includes(n)&&!ben0.includes(n)).forEach(n=>log('cp',c.id,`Отмечен статус «${n}» по УГНС`,c.id));(st.ugDrop||[]).filter(n=>!c.ben.includes(n)&&ben0.includes(n)).forEach(n=>log('cp',c.id,`Снят статус «${n}» по УГНС`,c.id));const nd=cpRedue(c,ov);m.close();refreshAll();const pb=reg?pkBaseDiff(c,bases0):null;const miss=reg?pkAuto(c).filter(id=>!before.has(id)&&!pb.add.includes(id)):[];
        const ndT=nd?`. Сроки по статусу изменены у ${nd} ${plural(nd,'отчёта','отчётов','отчётов')}`:'';
        toast(miss.length?`Контрагент сохранён${ndT}. Обязательны, но не назначены: ${miss.map(id=>T[id].short).join(', ')} — добавьте на вкладке «Подбор отчётов»`:'Контрагент сохранён'+ndT,miss.length?'alert':undefined,!!miss.length);if(pb&&(pb.add.length||pb.rem.length))pkBaseDlg(c,pb);if(ch.includes('gked')||ch.includes('gked2')){const k=gkCheck(c);const n=k.regime.length+k.ben.length+k.types.length;if(n)setTimeout(()=>toast(`Виды деятельности изменились: проверьте режим, льготы и отчёты в карточке (замечаний: ${n})`,'alert',true),1400)}
        if(was&&(ch.includes('regime')||ch.includes('regime2')||ch.includes('form')))setTimeout(()=>toast('Проверьте назначенные отчёты: часть не подходит к новому режиму или форме','alert',true),1400)}}}}});
}


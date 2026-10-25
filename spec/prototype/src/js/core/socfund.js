'use strict';
// Тариф страховых взносов в Соцфонд у контрагента (ТЗ «Тариф страховых взносов в Соцфонд (СПиНО)»)
/* ═════════════ Тариф Соцфонда ═════════════
   Тарифы и цифры — только из справочника: налог-взнос с guide.tariffs (ПЛТ-01), у тарифа id, short (краткое имя), status (код статуса),
   total, parts (стороны и фонды), cap (base — предельная база, amount — наибольшие взносы на работника); guide.exceptionsGked — тексты исключений по ГКЭД;
   статус СПиНО (ЛЬГ-29) в «Налоговых льготах и особых статусах»: gked.ex — запрещающие коды, gked.warn — коды с предупреждением, suggest.notWith — не для статусов.
   Контрагент: sf — признаки {cashless, registry, confirmed, gov} (true / false, не указано — нет ключа), sfT — id тарифа,
   sfMan — выбран вручную, sfWhy — причина ручного выбора. При тарифе СПиНО статус ЛЬГ-29 стоит и в списке статусов контрагента. */
const SF_FLAGS=[['cashless','Зарплата только безналично (на карты)'],['registry','Реестр наёмных работников загружен в Салык.кг'],['confirmed','Тариф подтверждён ГНС'],['gov','Госфинансирование']];
const SF_FLAG_HINT={confirmed:'Подтверждение в кабинете налогоплательщика («Переписка с ГНС»)',gov:'Получает средства из государственного бюджета'};
const SF_ORDER=['spino','general','pvtpki'];
const sfTax=()=>TAXES.find(x=>x.guide&&(x.guide.tariffs||[]).some(t=>t.id==='spino'));
const sfGuide=()=>(sfTax()||{}).guide||{};
// Тарифы, которые бывают у контрагента: СПиНО, базовый, ПВТ / ПКИ (тарифы пенсионеров и инвалидов — по работнику, здесь не выбираются)
const sfTariffs=()=>SF_ORDER.map(id=>(sfGuide().tariffs||[]).find(t=>t.id===id)).filter(Boolean);
const sfById=id=>sfTariffs().find(t=>t.id===id);
const sfCodes=t=>String(t&&t.status||'').split(/[,;\s]+/).filter(Boolean);
const sfSpBen=()=>{const t=sfById('spino');return t?DICT.benefits.items.find(b=>b.code===sfCodes(t)[0]):null};
// Название тарифа: у СПиНО — название статуса из справочника; кратко — поле short
const sfTitle=t=>!t?'':t.id==='spino'&&sfSpBen()?sfSpBen().name:t.short||t.name;
const sfShort=t=>!t?'':t.short||t.name;
// Предельная база и наибольшие взносы на работника
function sfCapTxt(t){const c=t&&t.cap;if(!c)return '';return [c.base?`база не выше ${c.base} в месяц на работника`:'',c.amount?`взносы не больше ${c.amount} в месяц на работника`:'',c.since?`с ${c.since}`:''].filter(Boolean).join(', ')}
// Признаки показываются, если у контрагента есть наёмные сотрудники
const sfNeed=c=>!!c&&c.kind!=='oneoff'&&((c.bases||[]).includes('employees')||(c.assign||[]).some(a=>!a.to&&a.t==='soc'));
const sfFlag=(c,k)=>c&&c.sf&&typeof c.sf[k]==='boolean'?c.sf[k]:null;
// Исключение по основному ГКЭД: block — запрещающий код («Кроме»), warn — код с предупреждением; text — какое исключение закона
function sfGkHit(c){const b=sfSpBen();if(!b||!c||!c.gked)return null;const g=b.gked||{};const ex=(g.ex||[]).find(p=>gkHit(c.gked,p)),wr=ex?null:(g.warn||[]).find(p=>gkHit(c.gked,p));if(!ex&&!wr)return null;const p=ex||wr;
  const e=(sfGuide().exceptionsGked||[]).find(x=>[...(x.gkedBlock||[]),...(x.gked||[])].some(k=>k===p||gkHit(c.gked,k)));
  return {block:!!ex,code:p,text:e?e.text:gkName(p).toLowerCase(),note:e&&e.note||''}}
/* Какой тариф подходит по условиям: {t (тариф или null — не определён), why: [причины], miss: [чего не хватает], warn: [предупреждения]} или null — не применяется */
function sfAuto(c){if(!sfNeed(c))return null;const sp=sfById('spino'),gen=sfById('general'),res=sfById('pvtpki');if(!sp||!gen)return null;
  const rs=benOf(c).filter(x=>sfCodes(res).includes(x.code));
  if(rs.length&&res)return {t:res,why:[`Статус «${rs.map(x=>x.name).join('», «')}»`],miss:[],warn:res.verify?[`Ставки «${sfShort(res)}» для работников резидентов ещё сверяются: проверьте в Соцфонде`]:[]};
  const why=[],miss=[],warn=[];const sb=sfSpBen();const nm=sfShort(sp);
  if(!c.gked)miss.push('основной ГКЭД');else{const h=sfGkHit(c);if(h&&h.block)why.push(`Основной ГКЭД ${c.gked} не допускает ${nm}: ${h.text}`);else if(h)warn.push(`Проверьте право на ${nm} по виду деятельности: основной ГКЭД ${c.gked} — ${h.text}`)}
  if(sb&&sb.suggest&&(sb.suggest.warnForms||[]).length){const f=DICT.forms.items.find(x=>x.name===c.form);if(f&&sb.suggest.warnForms.includes(f.code))warn.push(`Форма «${c.form}» часто означает бюджетное финансирование: проверьте признак «Госфинансирование»`)}
  if(sfFlag(c,'gov')===true)why.push('Госфинансирование');
  [['cashless','Зарплата не безналично','способ выплаты зарплаты'],['registry','Реестр работников не загружен в Салык.кг','реестр работников'],['confirmed','Тариф не подтверждён ГНС','подтверждение ГНС']].forEach(([k,no,un])=>{const v=sfFlag(c,k);if(v===false)why.push(no);else if(v===null)miss.push(un)});
  if(why.length)return {t:gen,why,miss,warn:[]};
  if(miss.length)return {t:null,why:[],miss,warn};
  return {t:sp,why:['Все условия выполнены'],miss:[],warn}}
/* Состояние у контрагента: cur — выбранный тариф, auto — по условиям, man — вручную, bad — выбранный не совпадает с условиями, ask — «Тариф под вопросом» */
function sfState(c){const auto=sfAuto(c);if(!auto)return null;const cur=c.sfT?sfById(c.sfT):null;
  const bad=!!cur&&!!auto.t&&cur.id!==auto.t.id;return {auto,cur,man:!!c.sfMan,bad,none:!cur,ask:!cur||(bad&&!!c.sfMan)}}
// Почему выбранный тариф расходится с условиями
function sfBadWhy(st){if(!st||!st.bad)return '';const a=st.auto;if(st.cur.id==='spino')return a.why.join('; ');
  if(a.t.id==='pvtpki')return a.why.join('; ');if(st.cur.id==='pvtpki')return 'нет статуса «Резидент ПВТ» или «Резидент ПКИ»';return `по условиям подходит «${sfShort(a.t)}»`}
const sfName=c=>{const s=sfState(c);return s?s.cur?sfShort(s.cur):'Не определён':''};
// Плашка тарифа: краткое название и итоговая ставка
const sfPill=(t,sm)=>t?`<span class="pill ${t.id==='spino'?'green':t.id==='pvtpki'?'blue':'gray'} ${sm?'sm':''}" title="${esc(sfTitle(t))}">${ic('shield')}${esc(sfShort(t))}${t.total?' · '+esc(t.total):''}</span>`:`<span class="pill yellow ${sm?'sm':''}">${ic('alert')}Тариф Соцфонда не определён</span>`;
// Ставки тарифа одной строкой: работодатель, работник, итого
const sfRatesTxt=t=>t?[(t.parts||[]).map(p=>`${p.payer.replace(/\s*\(.*\)$/,'').toLowerCase()} ${p.rate}`).join(', '),t.total?'итого '+t.total:''].filter(Boolean).join('; '):'';
// Описание тарифа: ставки по сторонам и фондам, предельная база, ГНПФ — карточка тарифа из формы налога
function sfTariffHtml(t){if(!t)return '';const g=sfGuide();
  return (typeof tgTariffs==='function'?tgTariffs([t]):'')+(t.id!=='pvtpki'&&g.gnpf?`<div class="hint">${ic('info','sm')} ${esc(g.gnpf.text)}${g.gnpf.verifyNote?` (${esc(g.gnpf.verifyNote)})`:''}</div>`:'')}
/* Пеня по просроченному неоплаченному отчёту (только подсказка): ставка из справочника (guide.penalty налога, связанного с видом), сумма от неуплаченного на сегодня */
function sfPeniNote(r){const t=T[r.t];if(!t||!(r.overdue||r.payOverdue))return '';const x=TAXES.find(x=>x.guide&&x.guide.penalty&&(x.guide.reportTypes||[]).includes(t.id));if(!x)return '';const p=x.guide.penalty;
  const pct=parseFloat(String(p.rate).replace(',','.'));const left=r.sum>0?Math.max(0,r.sum-(r.paid||0)):0;if(r.sum>0&&!left)return '';
  const days=Math.max(0,diffDays(TODAY,r.payDue||r.due));let amt=left?Math.round(left*pct/100*days*100)/100:0;const capped=/100 %/.test(p.cap||'')&&amt>left;if(capped)amt=left;
  return `<div class="note warn">${ic('alert')}<span>${esc(String(p.start||'После срока').replace(/^./,s=>s.toUpperCase()))} начисляется пеня ${esc(String(pct).replace('.',','))} % в день от неуплаченной суммы${p.cap?` (${esc(p.cap)})`:''}.${left&&days?` Примерно на сегодня: ≈ ${som(amt)} за ${days} дн. от ${som(left)}.`:''} Это подсказка: в суммы к уплате и деньги контрагента пеня не попадает.</span></div>`}
// Изменение тарифа с записью в историю: кто и почему поставил вручную; статус СПиНО в списке статусов контрагента идёт за тарифом
function sfSet(c,id,man,why){const was=c.sfT?sfById(c.sfT):null,t=id?sfById(id):null;c.sfT=id||undefined;c.sfMan=!!man||undefined;c.sfWhy=man&&why?why:undefined;
  ['sfT','sfMan','sfWhy'].forEach(k=>{if(c[k]===undefined)delete c[k]});
  const sb=sfSpBen();if(sb){const on=id==='spino';c.ben=(c.ben||[]).filter(n=>n!==sb.name);if(on)c.ben.push(sb.name)}
  if((was&&was.id)!==(t&&t.id)||man)log('cp',c.id,`Тариф Соцфонда: ${was?sfShort(was):'не определён'} → ${t?sfShort(t):'не определён'}${man?` (выбран вручную${why?': '+why:''})`:' (определён автоматически)'}`,c.id)}

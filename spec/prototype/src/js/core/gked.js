'use strict';
// ГКЭД: справочник видов экономической деятельности (gkedDB.json) и правила «Виды деятельности (ГКЭД)» у режимов, ставок ЕН, льгот и видов отчётов
/* ═════════════ ГКЭД — Государственный классификатор видов экономической деятельности КР, ред. 2022 ═════════════ */
/* Запись: {code, name, level: section|subsection|division|group|class|subclass, parent, active, note}.
   Связь с налогами хранится не в ГКЭД, а в поле gked:{in:[…], ex:[…]} у режима, ставки ЕН, льготы и вида отчёта:
   in — коды или начала кодов (секция — буквой), ex — список «Кроме»; пустое правило — без ограничения;
   main — проверяется только основной ГКЭД; who:'org' — перечень только для организаций; strict:'main' — основной ГКЭД из «Кроме» не даёт сохранить (режим «Единый налог», ст. 419). */
const GK=DB.ref.gked;
const GK_LV={section:'Секция',subsection:'Подсекция',division:'Раздел',group:'Группа',class:'Класс',subclass:'Подкласс'};
const GK_LVS=Object.keys(GK_LV);
let GKM={},GKKIDS={};
function gkIndex(){GKM={};GKKIDS={};GK.forEach(x=>{GKM[x.code]=x});GK.forEach(x=>{if(x.parent)(GKKIDS[x.parent]=GKKIDS[x.parent]||[]).push(x.code)})}
gkIndex();
const gkKids=code=>(GKKIDS[code]||[]).map(k=>GKM[k]).filter(Boolean);
// Контрагенту выбирается только код нижнего уровня — подкласс
const gkLeaf=x=>!!x&&x.level==='subclass';
function gkUp(code){const a=[];let x=GKM[code],n=0;while(x&&x.parent&&n<8){x=GKM[x.parent];if(x)a.push(x.code);n++}return a}
function gkSec(code){const x=GKM[code];if(x&&x.level==='section')return x.code;return gkUp(code).find(k=>GKM[k].level==='section')||''}
const gkName=code=>(GKM[code]||{}).name||'';
const gkT=code=>code?`${code} — ${gkName(code)||'код не найден в справочнике'}`:'';
const gkOff=code=>!!code&&(!GKM[code]||GKM[code].active===false);
const cpCodes=c=>[c&&c.gked,...((c&&c.gked2)||[])].filter(Boolean);
// Код подходит под начало кода p: «47» — весь раздел, «47.1» — группа, «G» — вся секция
const gkHit=(code,p)=>/^[A-Z]+$/.test(p)?code===p||gkUp(code).includes(p):code===p||code.startsWith(p);
const gkEmpty=r=>!r||(!(r.in||[]).length&&!(r.ex||[]).length);
/* Перечень по форме собственности (патент, ПКМ № 84): у организаций — «Виды деятельности» и «Кроме» (in, ex), у ИП — «Для ИП» без «Кроме, для ИП» (ip, ipEx),
   у физлица на патенте (ИТД, форма собственности ФС-22) — «Для ИТД» (itd). gkFor — правило, которое применяется к контрагенту */
const GK_ITD_FORM='ФС-22';
const gkLists=r=>!!r&&!!((r.ip||[]).length||(r.itd||[]).length);
const gkItd=c=>{const f=DICT.forms.items.find(x=>x.name===c.form);return !!f&&f.code===GK_ITD_FORM};
const gkListKey=c=>formEnd(c)!=='ip'?'':gkItd(c)?'itd':'ip';
const GK_LIST_L={'':'для организаций',ip:'для ИП',itd:'для физлиц на ИТД'};
function gkFor(r,c){const k=c&&gkLists(r)?gkListKey(c):'';if(!k)return r;return Object.assign({},r,{in:r[k]||[],ex:k==='ip'?r.ipEx||[]:[]})}
// Какие из кодов подходят под правило; null — правило пустое (без ограничения)
function gkFit(r,codes,c){r=gkFor(r,c);if(gkEmpty(r))return null;if(r.main&&c)codes=c.gked?[c.gked]:[];return codes.filter(c=>(!(r.in||[]).length||r.in.some(p=>gkHit(c,p)))&&!(r.ex||[]).some(p=>gkHit(c,p)))}
const gkRuleTxt=r=>gkEmpty(r)?'':[(r.in||[]).length?(r.in||[]).join(', '):'все',(r.ex||[]).length?'кроме '+r.ex.join(', '):''].filter(Boolean).join('; ');
// Ввод перечня: коды через запятую, точку с запятой или пробел; каждый код должен быть в справочнике
function gkParse(s){const a=String(s||'').split(/[,;\s]+/).map(x=>x.trim().toUpperCase()).filter(Boolean);const bad=a.filter(p=>!GKM[p]);
  return bad.length?{err:`Нет в справочнике ГКЭД: ${bad.join(', ')}`}:{v:[...new Set(a)]}}
// Поиск: по коду или началу кода и по словам названия
function gkSearch(q,o={}){const s=norm(q||'').trim();const words=s.split(/\s+/).filter(Boolean);
  return GK.filter(x=>(!o.leaf||gkLeaf(x))&&(o.all||x.active!==false)&&(!s||x.code.toLowerCase().startsWith(s)||words.every(w=>norm(x.name).includes(w))))}

/* Ставка единого налога по виду деятельности: строка ст. 423 с самым точным совпадением */
const GK_EN_SPECIAL=['ЕНС-05','ЕНС-07','ЕНС-14'];
// Ставки для особого статуса: предлагаются только контрагенту с этим статусом, и тогда — первой
const GK_EN_BEN={'ЕНС-13':'Резидент ПКИ'};
// Одна ставка на всю деятельность: дополнительные виды отдельно не облагаются (ст. 423 ч. 7)
const GK_EN_ONE=['ЕНС-01','ЕНС-05','ЕНС-13','ЕНС-15'];
// Строки ст. 423 с самым точным совпадением (несколько — если ставка зависит от выручки или признаков контрагента); иначе «Остальные виды деятельности»
function gkEnRows(code,c){const bens=(c&&c.ben)||[];const sb=(EN_TABLE||[]).filter(x=>GK_EN_BEN[x.code]&&bens.includes(GK_EN_BEN[x.code])&&!gkEmpty(x.gked)&&gkFit(x.gked,[code]).length);if(sb.length)return sb;
  let best=[],bl=-1;(EN_TABLE||[]).forEach(x=>{const r=x.gked;if(GK_EN_BEN[x.code]||gkEmpty(r)||!(r.in||[]).length)return;if(!gkFit(r,[code]).length)return;const l=Math.max(...r.in.filter(p=>gkHit(code,p)).map(p=>/^[A-Z]+$/.test(p)?0:p.length));if(l>bl){bl=l;best=[x]}else if(l===bl)best.push(x)});
  // Реэкспорт, ввоз в СЭЗ и деятельность вне КР — признаки контрагента, а не вида деятельности: такие ставки не предлагаются, если есть обычная
  const base=best.filter(x=>!GK_EN_SPECIAL.includes(x.code));if(base.length)best=base;
  if(!best.length){const o=(EN_TABLE||[]).find(x=>x.code==='ЕНС-04');if(o)best=[o]}return best}
const gkEnRow=(code,c)=>gkEnRows(code,c)[0]||null;
const gkFitType=(t,c)=>{const f=gkFit(t.gked,cpCodes(c),c);return !!(f&&f.length)};

/* Сверка контрагента с ГКЭД: режимы, льготы, ставка ЕН, назначенные отчёты. Ничего не меняет, только предупреждает */
// Перечень помечен «сверить» — к предупреждению добавляется оговорка; verify — перечень по документу, сверяются отдельные позиции
const gkVer=r=>!r?'':r.verify?' (часть перечня ещё сверяется)':/сверить/i.test(r.note||'')?' (перечень ещё сверяется)':'';
const gkToVerify=r=>!!r&&(!!r.verify||/сверить/i.test(r.note||''));
/* Общие группы кодов (gkedGroups): {id, name, codes, en, spino, why, ask}; en и spino — действие в едином налоге (ст. 419) и в тарифе СПиНО (ЛЬГ-29):
   'ex' — запрет, 'warn' — предупреждение, пусто — ничего; строка — для всей группы, объект {код: действие} — по кодам */
const GKG=DB.ref.gkedGroups;
const gkGrpAct=(g,k,code)=>!g||!g[k]?'':typeof g[k]==='string'?g[k]:g[k][code]||'';
const gkGrpOf=code=>GKG.find(g=>(g.codes||[]).some(p=>gkHit(code,p)))||null;
// «Предупреждать при ГКЭД» у режима (единый налог): подтверждение привязано к основному ГКЭД и режимам
// у режима с перечнями по форме собственности (патент) — ещё все ГКЭД и форма собственности
const gkRegOf=n=>DICT.regimes.items.find(x=>x.name===n);
const gkEnSig=c=>JSON.stringify([c.gked||'',regsOf(c),...(regsOf(c).some(n=>gkLists((gkRegOf(n)||{}).gked))?[cpCodes(c),c.form||'']:[])]);
function gkCheck(c,sel){const codes=cpCodes(c);const out={block:[],regime:[],rwarn:[],ben:[],rate:[],types:[],off:codes.filter(gkOff)};if(!codes.length)return out;
  regsOf(c).forEach(n=>{const r=gkRegOf(n);if(!r||gkEmpty(r.gked)&&!gkLists(r.gked))return;const g0=r.gked;
    // who:'org' — перечень задан только для организаций: ИП проверяется по своему перечню («Для ИП», «Для ИТД»), без него — не проверяется
    if(g0.who==='org'&&formEnd(c)==='ip'&&!gkLists(g0))return;const g=gkFor(g0,c);
    // Перечень по форме собственности (патент): ни один ГКЭД не входит — вопрос с подтверждением, как у СПиНО; после него жёлтая отметка
    if(gkLists(g0)){const f=gkFit(g,codes);if(f&&!f.length){const ok=c.gkOk&&c.gkOk.sig===gkEnSig(c)?c.gkOk:null;const art=r.art||'НК КР',lst=GK_LIST_L[gkListKey(c)];
      out.rwarn.push({n,code:c.gked||codes[0],list:lst,art});out.regime.push(`Режим «${n}»: ни один вид деятельности контрагента не входит в перечень ${lst}${ok?` — подтвердил ${whoName(ok.by)} ${fmtD(ok.at)}`:' — нужно подтверждение'}${gkVer(g)}`);return}}
    if(g.strict==='main'&&c.gked&&(g.ex||[]).some(p=>gkHit(c.gked,p))){out.block.push(`Режим «${n}» нельзя применять при основном ГКЭД ${c.gked}: этот вид деятельности запрещён для него (${((g.note||'').match(/ст\. \d+/)||[])[0]||r.art||'НК КР'})`);return}
    // Основной ГКЭД из «Предупреждать при ГКЭД»: код не отличает запрещённую деятельность от разрешённой — вопрос с подтверждением, после него жёлтая отметка
    const wc=c.gked&&(g.warn||[]).find(p=>gkHit(c.gked,p));if(wc){const grp=gkGrpOf(c.gked);const ok=c.gkOk&&c.gkOk.sig===gkEnSig(c)?c.gkOk:null;const art=((g.note||'').match(/ст\. \d+/)||[])[0]||r.art||'НК КР';
      out.rwarn.push({n,code:c.gked,grp,ask:grp&&grp.ask||'',art});out.regime.push(`Режим «${n}» при основном ГКЭД ${c.gked}${grp?` (${grp.name.replace(/ \(.*$/,'').toLowerCase()})`:''}: код не отличает запрещённую деятельность от разрешённой (${art})${ok?` — подтвердил ${whoName(ok.by)} ${fmtD(ok.at)}${ok.ask?`: «${ok.ask}» — нет`:''}`:' — нужно подтверждение'}${gkVer(g)}`)}
    const bad=codes.filter(k=>(g.ex||[]).some(p=>gkHit(k,p)));const f=gkFit(g,codes,c);
    if(!f.length)out.regime.push(`Режим «${n}» не подходит к видам деятельности контрагента${gkVer(g)}`);else if(bad.length)out.regime.push(`Режим «${n}» не применяется к ГКЭД ${bad.join(', ')}: по этим видам деятельности — другой режим${gkVer(g)}`)});
  // Правило «только подсказка» (gked.hint): несовпадение не даёт ни предупреждения, ни подтверждения, ни жёлтой отметки
  benOf(c).forEach(b=>{if(b.gked&&b.gked.hint)return;const f=gkFit(b.gked,codes,c);if(f&&!f.length)out.ben.push(`Виды деятельности контрагента не соответствуют статусу «${b.name}»${gkVer(b.gked)}`)});
  if(regsOf(c).includes('Единый налог')&&c.gked){const ms=gkEnRows(c.gked,c),m=ms[0];if(m)out.rate.push(`Ставка единого налога по основному ГКЭД ${c.gked}: ${ms.map(x=>`${x.rate} (${x.activity})`).join(' или ')}`);
    // ЕНС-01, ЕНС-05, ЕНС-13, ЕНС-15 — одна ставка на всю деятельность: по дополнительным ГКЭД налог отдельно не считается
    const one=ms.filter(x=>GK_EN_ONE.includes(x.code));
    if(one.length===ms.length){if((c.gked2||[]).length)out.rate.push(`При этой ставке налог считается по ней со всей деятельности, дополнительные виды отдельно не облагаются (ст. 423 ч. 7)`)}
    else (c.gked2||[]).forEach(k=>{const x=gkEnRow(k,c);if(x&&m&&x.rate!==m.rate)out.rate.push(`ГКЭД ${k}: ставка ${x.rate} (${x.activity}) — налог считается отдельно по каждому виду деятельности (ст. 423 ч. 7)${one.length?`; при ставке ${one.map(o=>o.rate).join(', ')} — одна ставка на всю деятельность`:''}`)})}
  // Режимный вид при выбранном режиме с перечнем ГКЭД (патент) проверяется по перечню режима — второй раз не предупреждаем
  const regRule=t=>t.kind==='regime'&&(t.regimes||[]).some(n=>regsOf(c).includes(n)&&gkRegOf(n)&&!gkEmpty(gkRegOf(n).gked));
  const ids=sel?[...sel]:(c.assign||[]).filter(a=>!a.to).map(a=>a.t);ids.forEach(id=>{const t=T[id];if(t&&t.gked&&t.gked.hint||t&&regRule(t))return;const f=t&&gkFit(t.gked,codes,c);if(f&&!f.length)out.types.push(t.short)});
  return out}
// Excel: «47, 56.10; кроме 47.26» ↔ {in, ex}; «все; кроме …» — только исключения; пусто — без ограничения
function gkRuleIn(v){const s=String(v||'').trim();if(!s||norm(s)==='все')return {in:[],ex:[]};const[a,b]=s.split(/;\s*кроме\s*/i);const A=norm(a).trim()==='все'?{v:[]}:gkParse(a),B=gkParse(b||'');
  if(A.err||B.err)return {err:'«Виды деятельности (ГКЭД)»: '+(A.err||B.err)};return {in:A.v,ex:B.v}}
// Новый перечень сохраняет служебные признаки правила (по основному, запрет, примечание «сверить»)
const gkRuleKeep=(o,n)=>Object.assign({},o||{},{in:n.in||[],ex:n.ex||[]});

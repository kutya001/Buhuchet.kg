'use strict';
// Ставки в назначении и строки суммы налога (ТЗ «Ставки и параметры отчёта», «Сумма ЕН при нескольких ставках», решение заказчика 24.10.2026)
/* Единый налог: в назначении хранится строка справочника «Ставки единого налога» (код ЕНС), а не процент — a.en=[{code, v}];
   строк может быть несколько (другая ставка у дополнительного ГКЭД, ЕНС-16 к ставкам из её поля addTo).
   Налог с продаж: к основной ставке a.rate добавляются строки вида rateAdd (a.add=[k]).
   Из строк ставки получаются строки суммы отчёта: у ЕНС-04 — «Безналичная выручка, 4 %» и «Наличная выручка, 6 %». */
const EN_IDS=['enq','enm'];
const isEnT=t=>!!t&&EN_IDS.includes(typeof t==='string'?t:t.id);
// При этих ставках налог считается по одной ставке со всей деятельности: дополнительные виды отдельных строк не дают (ст. 423 ч. 7)
const EN_NO_EXTRA=GK_EN_ONE;
const enRow=code=>(EN_TABLE||[]).find(x=>x.code===code)||null;
const RT_PCT=/\d+(?:,\d+)? %/;
const pctNum=p=>parseFloat(String(p||'').replace(',','.'))||0;
// Части текста ставки: «Бишкек и Ош — 5 %, остальная территория — 3 %», «0 % с 01.08.2026 по 31.07.2031, 1 % с 01.08.2031 (…)»
const rtSegs=x=>String((x&&x.rate)||'').replace(/[()]/g,', ').split(/\s*,\s+/).map(s=>s.trim()).filter(s=>RT_PCT.test(s));
const rtIso=s=>{const m=String(s||'').match(/(\d\d)\.(\d\d)\.(\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:''};
// Варианты на выбор в строке назначения (общепит по месту, СЭЗ по переработке): [{n, pct}]
function rtVars(x){const ss=rtSegs(x);if(ss.length<2||ss.some(s=>/с \d\d\.\d\d\.\d{4}/.test(s)))return [];
  const vs=ss.map(s=>{const m=s.match(/^(.+?)\s+—\s+(\d+(?:,\d+)? %)$/);return m?{n:m[1],pct:m[2]}:null});return vs.every(Boolean)?vs:[]}
// Ставка по датам действия (резидент ПКИ): та, что действует на дату периода
function rtByDate(x,date){const ss=rtSegs(x).map(s=>({p:s.match(RT_PCT)[0],f:rtIso((s.match(/с (\d\d\.\d\d\.\d{4})/)||[])[1]),to:rtIso((s.match(/по (\d\d\.\d\d\.\d{4})/)||[])[1])})).filter(s=>s.f);
  if(!ss.length)return '';const d=date||TODAY;const hit=ss.find(s=>s.f<=d&&(!s.to||d<=s.to))||ss.filter(s=>s.f<=d).sort((a,b)=>a.f<b.f?1:-1)[0]||ss[0];return hit.p}
// Строки одной ставки: безнал и нал — две строки; «по ставкам ЕНС-04» — строки той ставки; иначе одна строка
function rtParts(x,v,date){if(!x)return [];
  if(x.rateCashless&&x.rateCash)return [{k:'cl',n:'Безналичная выручка',pct:x.rateCashless},{k:'ca',n:'Наличная выручка',pct:x.rateCash}];
  const ref=(String(x.rate||'').match(/по ставкам (ЕНС-\d+)/)||[])[1];if(ref&&ref!==x.code)return rtParts(enRow(ref),v,date);
  const vs=rtVars(x);if(vs.length){const o=vs[Math.min(Math.max(0,+v||0),vs.length-1)];return [{k:'r',n:'Выручка',pct:o.pct,vn:o.n}]}
  const pd=rtByDate(x,date);if(pd)return [{k:'r',n:'Выручка',pct:pd}];
  const p=(String(x.rate||'').match(RT_PCT)||[])[0];const base=(String(x.rate||'').match(/ % от (.+)$/)||[])[1];
  return p?[{k:'r',n:base?'Сумма '+base:'Выручка',pct:p}]:[]}
// «4 % безнал + 6 % нал», «5 % (Бишкек и Ош)», «0 %»; коротко — «4 / 6 %», «5 %»
function rtTxt(x,v,date,short){const ps=rtParts(x,v,date);if(!ps.length)return (x&&x.rate)||'';
  if(ps[0].k==='cl')return short?`${ps[0].pct.replace(' %','')} / ${ps[1].pct}`:`${ps[0].pct} безнал + ${ps[1].pct} нал`;
  return ps[0].pct+(!short&&ps[0].vn?` (${ps[0].vn})`:'')}

/* Строки назначения: [{code, v, x}] — у ЕН строки ЕНС, у вида с rateAdd — основная ставка и добавленные строки (если они есть) */
function aRows(a,t){t=t||(a&&T[a.t]);if(!a||!t)return [];
  if(isEnT(t))return (a.en||[]).map(e=>({code:e.code,v:e.v,x:enRow(e.code)})).filter(e=>e.x);
  if(!(t.rateAdd||[]).length||!(a.add||[]).length)return [];
  return [...(a.rate?[{code:'',x:{rate:a.rate}}]:[]),...a.add.map(k=>({code:k,x:t.rateAdd.find(y=>y.k===k)})).filter(e=>e.x)]}
// Ставка назначения: «ЕНС-04 · 4 % безнал + 6 % нал»; коротко, для столбца «Ставка» — «ЕНС-04 · 4 / 6 %»
function aRateTxt(a,t,short,date){t=t||(a&&T[a.t]);if(!a||!t)return '';const rs=aRows(a,t);if(!rs.length)return isEnT(t)?'':a.rate||'';
  return rs.map(e=>isEnT(t)?`${e.code} · ${rtTxt(e.x,e.v,date,short)}`:e.code?(short?rtTxt(e.x,null,date,true):`${rtTxt(e.x,null,date)} — ${e.x.name||e.x.short||''}`):rtTxt(e.x,null,date,short)).join('; ')}

/* Подбор строк ЕНС по ГКЭД и статусам */
// Место деятельности для ставки «по месту» (общепит): город УГНС и юридический адрес
const enPlace=cx=>{if(!cx)return '';const u=cx.ugns?DICT.ugns.items.find(y=>ugK(y)===cx.ugns):null;return [u&&u.city,cx.reg&&cx.reg.addr].filter(Boolean).join(' ')};
// Вариант по месту: у общепита «Бишкек и Ош» — если УГНС или адрес в этих городах, иначе «остальная территория»; у вариантов не по месту — первый
function enVarAuto(x,cx){const vs=rtVars(x);if(vs.length<2)return undefined;const names=o=>/^[А-ЯЁ]/.test(o.n)?o.n.split(/\s+и\s+|,\s*/):[];
  if(!vs.some(o=>names(o).length))return 0;const place=enPlace(cx);if(!place)return 0;
  const hit=vs.findIndex(o=>names(o).some(w=>new RegExp(`(^|[^А-Яа-яЁё])${w}([^А-Яа-яЁё]|$)`).test(place)));return hit>=0?hit:Math.max(0,vs.findIndex(o=>!names(o).length))}
const enItem=(x,cx)=>{const v=enVarAuto(x,cx);return v==null?{code:x.code}:{code:x.code,v}};
// Строки по умолчанию: основная — по основному ГКЭД и статусам (резидент ПКИ — ЕНС-13), дополнительные ГКЭД с другой ставкой — свои строки (кроме ЕНС-01, 05, 13, 15)
function enAuto(cx){const m=cx&&cx.gked?gkEnRow(cx.gked,cx):enRow('ЕНС-04');if(!m)return [];const out=[enItem(m,cx)];
  if(!EN_NO_EXTRA.includes(m.code))((cx&&cx.gked2)||[]).forEach(k=>{const x=gkEnRows(k,cx).find(y=>!EN_NO_EXTRA.includes(y.code));if(x&&!out.some(e=>e.code===x.code))out.push(enItem(x,cx))});
  return out}
// В поле предлагаются строки ЕНС основного и дополнительных ГКЭД; ЕНС-16 — если есть ставка, к которой она добавляется
const enAddOk=(code,rows)=>{const to=(enRow(code)||{}).addTo;return !to||(rows||[]).some(e=>to.includes(e.code))};
function enSuggest(cx,rows){const out=[];const add=c=>{if(c&&!out.includes(c))out.push(c)};if(cx&&cx.gked)gkEnRows(cx.gked,cx).forEach(x=>add(x.code));((cx&&cx.gked2)||[]).forEach(k=>gkEnRows(k,cx).forEach(x=>add(x.code)));
  if(!out.length)add('ЕНС-04');EN_TABLE.filter(x=>x.addTo&&x.active!==false&&enAddOk(x.code,rows)).forEach(x=>add(x.code));return out}
// Замечания к строкам назначения: ЕНС-16 без своей основной ставки; одна ставка на всю деятельность вместе с другими строками
function enWarn(rows){const out=[];const cs=(rows||[]).map(e=>e.code);
  cs.forEach(c=>{const x=enRow(c);if(x&&x.addTo&&!enAddOk(c,rows))out.push(`${c} добавляется только к ставкам ${x.addTo.join(', ')} (${x.art||'ст. 423'})`)});
  const one=cs.find(c=>EN_NO_EXTRA.includes(c));if(one&&cs.some(c=>c!==one&&!(enRow(c)||{}).addTo))out.push(`При ставке ${one} налог считается по ней со всей деятельности: другие строки обычно не нужны (ст. 423 ч. 7)`);
  return out}
// Старое назначение ЕН с процентом (a.rate) → строка ЕНС: подходящая по ГКЭД с той же ставкой, иначе первая строка справочника с этой ставкой, иначе по ГКЭД
function enFromRate(c,rate){const fit=x=>{const vs=rtVars(x);if(vs.length){const i=vs.findIndex(o=>o.pct===rate);return i<0?null:{code:x.code,v:i}}return rtParts(x,0).some(p=>p.pct===rate)?enItem(x,c):null};
  const hit=(c&&c.gked?gkEnRows(c.gked,c):[]).map(fit).find(Boolean);if(hit)return [hit];
  const y=rate?EN_TABLE.find(y=>!GK_EN_BEN[y.code]&&!GK_EN_SPECIAL.includes(y.code)&&!y.addTo&&!rtVars(y).length&&(rtParts(y,0)[0]||{}).pct===rate):null;return y?[enItem(y,c)]:enAuto(c)}
// Назначения ЕН из старых данных и файлов: процент заменяется строкой ЕНС (выполняется при каждом пересчёте, ничего не делает с уже переведёнными)
function enNorm(){CPS.forEach(c=>(c.assign||[]).forEach(a=>{if(!isEnT(a.t)||a.en)return;a.en=enFromRate(c,a.rate);delete a.rate}))}
const enClean=rows=>(rows||[]).filter(e=>e&&e.code).map(e=>e.v==null?{code:e.code}:{code:e.code,v:e.v});

/* Строки суммы отчёта: у ЕН — всегда (у ЕНС-01 одна «Выручка, 0,5 %»), у налога с продаж — когда к основной ставке добавлены строки */
function taxLines(r){const t=T[r.t];if(!tR(r).sum)return [];const rs=aRows(assignOfT(CPM[r.cp],r.t),t);if(isEnT(t)?!rs.length:rs.length<2)return [];const many=rs.length>1;const seen={};
  const out=rs.flatMap(e=>rtParts(e.x,e.v,r.pkey).map(p=>{const pre=many?(isEnT(t)?e.code:e.code?(e.x.short||e.x.name):'Основная ставка'):'';
    let key=`${e.code||'main'}${e.v!=null?'/'+e.v:''}:${p.k}`;seen[key]=(seen[key]||0)+1;if(seen[key]>1)key+='#'+seen[key];
    return {key,pre,n:p.n,pct:p.pct,cash:p.k==='ca'?1:p.k==='cl'?0:null,label:`${pre?pre+' · '+p.n.toLowerCase():p.n}, ${p.pct}`}}));
  // строки, уже введённые в отчёте, но которых больше нет в назначении, остаются, пока в них есть значения
  (r.lines||[]).forEach(l=>{if((l.rev!=null||l.tax!=null)&&!out.some(o=>o.key===l.key))out.push({key:l.key,pre:'',n:l.label,pct:l.pct,cash:l.cash??null,label:l.label,old:1})});
  return out.map(o=>{const f=(r.lines||[]).find(l=>l.key===o.key);return Object.assign(o,{rev:f?f.rev:null,tax:f?f.tax:null})})}
const lineTax=(rev,pct)=>Math.round(rev*pctNum(pct)/100);
const linesTxt=ls=>(ls||[]).filter(l=>l.rev!=null||l.tax!=null).map(l=>`${l.label}: ${l.rev!=null?'выручка '+som(l.rev)+', ':''}налог ${som(l.tax||0)}`).join('; ');
// Подсказки у строк: что считается наличной и безналичной выручкой (ст. 174 п. 28, 29)
const LN_CASH='наличные в кассу и наличные, внесённые на свой счёт в банке или через терминал';
const LN_CASHLESS='перевод, QR, POS-терминал, электронный кошелёк, бартер';

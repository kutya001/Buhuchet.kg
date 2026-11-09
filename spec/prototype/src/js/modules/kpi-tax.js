'use strict';
// Показатели в расчёте налогов: окно «Сумма к уплате» и «Отметить сданным» берут базу налога из показателей контрагента за месяцы периода отчёта
/* ═════════════ Показатели → расчёт налогов ═════════════
   У показателя отметка «Для расчёта налогов» (одна на организацию для каждой роли):
   rev — выручка: база единого налога (строки по ставкам), налога с продаж, отчислений ПВТ; у НДС — справочно;
   fot — ФОТ: база подоходного налога и страховых взносов в Соцфонд (отчёт «Соцфонд»: подоходный налог и взносы);
   emp — численность: предельная база взносов на работника (720 940 сом в месяц с 01.01.2026 — из справочника тарифов).
   Недостающие значения вносятся прямо в окне и записываются в показатели; расчёт — подсказка, суммы подставляются кнопкой «Подставить». */
const KTAX={rev:'Выручка',fot:'ФОТ',emp:'Численность'};
const KTAX_HINT={rev:'база единого налога, налога с продаж и отчислений ПВТ',fot:'база подоходного налога и взносов в Соцфонд',emp:'предельная база взносов в Соцфонд на работника'};
const KTAX_OPT=[['','Не используется'],['rev','Выручка — база единого налога, налога с продаж, ПВТ'],['fot','ФОТ — база подоходного налога и взносов в Соцфонд'],['emp','Численность — предел базы взносов на работника']];
const KTAX_TYPES={rev:['som','dec'],fot:['som','dec'],emp:['int']};
const kTaxInd=role=>kInds().find(i=>i.tax===role)||null;
const KTX_REV=['enq','enm','nspm','nspq','pvt','nds'];
// Какие показатели нужны отчёту; месяцы периода отчёта
function kTaxNeed(r){const t=T[r.t];if(!t||!tR(r).sum)return null;if(t.id==='soc')return ['fot','emp'];return KTX_REV.includes(t.id)?['rev']:null}
const kRepMs=r=>{const t=T[r.t];if(!t||!/^\d{4}-\d{2}-01$/.test(r.pkey||''))return [];const n={M:1,Q:3,H:6,Y:12}[t.per]||1;const a=r.pkey.slice(0,7);return kMonths(a,addMonths(a,n-1))};
const kTaxOk=r=>!isAdmin()&&feat('indicators')&&can('kpiView')&&!!kTaxNeed(r)&&kRepMs(r).length>0&&!!CPM[r.cp];
function kTaxBase(c,role,ms){const i=kTaxInd(role);if(!i)return null;const vals=ms.map(m=>{const v=kVal(c.id,i.id,m);return v?v.v:null});return {i,vals,sum:vals.reduce((a,v)=>a+(v||0),0),miss:ms.filter((m,j)=>vals[j]==null)}}
// Подоходный налог и взносы по ФОТ: тариф Соцфонда контрагента, предел базы на работника (если внесена численность); ставка налога — из справочника налогов
function kTaxSoc(c,ms,fot,emp){const s=sfState(c);const tf=s&&(s.cur||s.auto.t);const pnT=TAXES.find(x=>x.code==='НАЛ-01');
  const pnRate=tf&&tf.id==='pvtpki'?5:pctNum((((pnT&&pnT.guide&&pnT.guide.rates)||[])[0]||{}).rate||'10 %')||10;
  if(!tf)return {err:'Тариф Соцфонда не определён — укажите его в карточке контрагента, тогда появится расчёт взносов'};
  const tot=pctNum(tf.total),wk=(tf.parts||[]).find(p=>/^работник/i.test(p.payer)),wr=wk?pctNum(wk.rate):0;
  const cap=tf.cap&&tf.cap.base?parseNum(String(tf.cap.base).replace(/[^\d,.]/g,''))||0:0;let sf=0,pn=0,capped=false;
  ms.forEach((m,j)=>{const f=fot.vals[j];if(f==null)return;const e=emp?emp.vals[j]:null;let b=f;if(cap&&e>0&&f>cap*e){b=cap*e;capped=true}sf+=b*tot/100;pn+=Math.max(0,f-b*wr/100)*pnRate/100});
  return {tf,wr,pnRate,sf:Math.round(sf),pn:Math.round(pn),capped,cap}}
// Ставка налога с выручки без строк по ставкам: налог с продаж — из назначения, отчисления ПВТ — из назначения или 1 %
function kRevPct(r){const a=assignOfT(CPM[r.cp],r.t)||{};if(r.t==='nds')return '';if(a.rate&&/\d/.test(a.rate))return a.rate;return r.t==='pvt'?'1 %':''}
function kTaxFld(r,id){return kTaxOk(r)?`<div class="fld full ktx" data-ktx="${id}">${kTaxHtml(r)}</div>`:''}
function kTaxHtml(r){const c=CPM[r.cp],ms=kRepMs(r),need=kTaxNeed(r),ed=kCanEdit(c),main=need[0];
  let h=`<div class="ktx-h">${ic('gauge','sm')}<b>Расчёт по показателям</b><span class="hint" style="margin:0">${esc(r.phuman)} · ${main==='fot'?'ФОТ — база подоходного налога и взносов':'выручка — база налога'}</span></div>`;
  if(!kTaxInd(main))return h+`<div class="hint" style="margin:0">Нет показателя с отметкой «Для расчёта налогов: ${KTAX[main]}». ${can('indSetup')?'Отметьте его в «Показатели» → «Настройка показателей».':'Его отмечает роль с правом «Настраивать показатели».'}</div>`;
  const roles=need.filter(x=>kTaxInd(x));
  h+=`<div class="tbl-wrap"><table class="mini ktx-t"><thead><tr><th>Показатель</th>${ms.map(m=>`<th class="num">${esc(ymS(m))}</th>`).join('')}${ms.length>1?'<th class="num">Итого</th>':''}</tr></thead><tbody>${roles.map(role=>{const i=kTaxInd(role),b=kTaxBase(c,role,ms),on=kOpen(i,c);
    return `<tr><td>${esc(i.name)} <small class="faint">${esc(i.unit||'')}</small>${on?'':` <span class="tag" title="${esc(kOffLbl(i,c)||'Показатель у контрагента не ведётся')}">не ведётся</span>${can('indSetup')&&!c.archived?` <button type="button" class="linkbtn" data-ktx-on="${i.id}">Вести</button>`:''}`}</td>${ms.map((m,j)=>{const v=b.vals[j];
      return ed&&kCellOk(i,c,m)?`<td class="num ${v==null&&role!=='emp'?'emp':''}"><input class="inp tnum ktx-in" data-ktxi="${i.id}" data-m="${m}" value="${v==null?'':esc(kNum(i,v))}" placeholder="внести" inputmode="decimal" aria-label="${esc(i.name)}, ${esc(ymLabel(m))}"></td>`:`<td class="num">${v==null?'<span class="faint">—</span>':esc(kNum(i,v))}</td>`}).join('')}${ms.length>1?`<td class="num strong">${b.miss.length===ms.length?'—':esc(kNum(i,role==='emp'?Math.round(b.sum/(ms.length-b.miss.length)):b.sum))}</td>`:''}</tr>`}).join('')}</tbody></table></div><div class="ktx-res">`;
  const B=kTaxBase(c,main,ms);
  if(B.miss.length)return h+`<div class="ktx-row hint" style="margin:0">${ic('alert','sm')}<span class="grow">Нет значения «${esc(B.i.name)}» за ${B.miss.map(m=>ymLabel(m)).join(', ')}${ed?' — внесите выше, расчёт появится сам':''}.</span></div></div>`;
  const go=(k,l)=>`<button type="button" class="btn sm" data-ktx-go="${k}">${ic('download','sm')}${l||'Подставить'}</button>`;
  if(main==='fot'){const x=kTaxSoc(c,ms,B,kTaxBase(c,'emp',ms));if(x.err)return h+`<div class="ktx-row hint" style="margin:0">${ic('alert','sm')}<span class="grow">${esc(x.err)}</span></div></div>`;
    return h+`<div class="ktx-row"><span class="grow">Подоходный налог ≈ <b>${som(x.pn)}</b><span class="hint" style="margin:0">${x.pnRate} % от ФОТ за вычетом взносов работника ${String(x.wr).replace('.',',')} %; стандартный вычет и вычеты на иждивенцев не учтены</span></span></div>
      <div class="ktx-row"><span class="grow">Страховые взносы ≈ <b>${som(x.sf)}</b><span class="hint" style="margin:0">тариф ${esc(sfShort(x.tf))} · ${esc(x.tf.total)} от ФОТ${x.capped?`; база ограничена ${fmtM(x.cap,false)} сом на работника`:''}</span></span>${go('soc','Подставить в сумму')}</div></div>`}
  const ls=taxLines(r);
  if(ls.length===1)return h+`<div class="ktx-row"><span class="grow">${esc(ls[0].label)}: выручка <b>${som(B.sum)}</b> → налог ≈ <b>${som(lineTax(B.sum,ls[0].pct))}</b></span>${go('l0','Подставить выручку')}</div></div>`;
  if(ls.length>1)return h+`<div class="ktx-row"><span class="grow">Выручка за период — <b>${som(B.sum)}</b>. Строк по ставкам несколько: подставьте выручку в нужную строку, налог посчитается сам</span></div><div class="ktx-row">${ls.map((l,k)=>go('l'+k,'В «'+l.label+'»')).join('')}</div></div>`;
  const pct=kRevPct(r);if(!pct)return h+`<div class="ktx-row"><span class="grow">Выручка за период — <b>${som(B.sum)}</b>.${r.t==='nds'?' НДС к уплате зависит от зачёта входящего НДС — сумму впишите сами.':' Ставка в назначении не указана — сумму впишите сами.'}</span></div></div>`;
  return h+`<div class="ktx-row"><span class="grow">${esc(T[r.t].short)} ≈ <b>${som(Math.round(B.sum*pctNum(pct)/100))}</b><span class="hint" style="margin:0">${esc(pct)} от выручки ${som(B.sum)}</span></span>${go('sum','Подставить в сумму')}</div></div>`}
// Обработчики: ввод недостающих значений (пишутся в показатели), «Вести», «Подставить»
function kTaxBind(el,id,r){const box=el.querySelector(`[data-ktx="${id}"]`);if(!box)return;const c=CPM[r.cp],ms=kRepMs(r);
  const fill=(sel,v)=>{const x=el.querySelector(sel);if(!x)return false;x.value=String(v);x.dispatchEvent(new Event('input',{bubbles:true}));return true};
  const redraw=()=>{const a=document.activeElement;const k=a&&a.dataset&&a.dataset.ktxi?`[data-ktxi="${a.dataset.ktxi}"][data-m="${a.dataset.m}"]`:'';box.innerHTML=kTaxHtml(r);bind();if(k){const n=box.querySelector(k);if(n)n.focus()}};
  const bind=()=>{$$('.ktx-in',box).forEach(x=>{x.addEventListener('focus',()=>x.select());x.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();x.blur()}});
      x.addEventListener('change',()=>{const i=IND.find(y=>y.id===x.dataset.ktxi),m=x.dataset.m;const v=kParse(i,x.value);
        if(Number.isNaN(v)){toast(`«${x.value}» — не число`,'alert',true);const o=kVal(c.id,i.id,m);x.value=o?kNum(i,o.v):'';return}
        if(kSet(c,i,m,v)){kLiveBadges();toast(`«${i.name}», ${ymLabel(m)}: записано в показатели`,'gauge')}setTimeout(redraw,0)})});
    $$('[data-ktx-on]',box).forEach(b=>b.onclick=()=>{const i=IND.find(y=>y.id===b.dataset.ktxOn);if(kSetOn(i,c,true)){if(ms[0]<kStart(i,c)){i.from[c.id]=ms[0]<ym(TODAY)?ms[0]:ym(TODAY);kResync()}toast(`«${i.name}»: ведётся у ${c.name}`,'gauge')}redraw()});
    $$('[data-ktx-go]',box).forEach(b=>b.onclick=()=>{const k=b.dataset.ktxGo,B=kTaxBase(c,kTaxNeed(r)[0],ms);let ok=false;
      if(k==='soc'){const x=kTaxSoc(c,ms,B,kTaxBase(c,'emp',ms));const ps=T[r.t].pays||[];const kp=ps.findIndex(p=>/подоходн/i.test(p.n)),ks=ps.findIndex(p=>/взнос/i.test(p.n));
        ok=el.querySelector(`#${id}-p0`)&&kp>=0&&ks>=0?(fill(`#${id}-p${kp}`,x.pn),fill(`#${id}-p${ks}`,x.sf)):fill('#'+id,x.pn+x.sf)}
      else if(k==='sum')ok=fill('#'+id,Math.round(B.sum*pctNum(kRevPct(r))/100));
      else ok=fill(`#${id}-r${k.slice(1)}`,B.sum);
      toast(ok?'Подставлено из показателей — проверьте и сохраните':'Поле суммы не найдено','gauge',!ok)})};
  bind()}

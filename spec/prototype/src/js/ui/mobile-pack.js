'use strict';
// Компоновка форм на телефоне: короткие поля по два в строку
/* ═════════════ Mobile form packing ═════════════
   Правило ТЗ «Компоновка форм на телефоне» (до 600 px):
   - формы изменения (.form): пара полей, стоящая в одной строке на ПК, остаётся парой, если оба поля короткие
     (дата, месяц, время, число, сумма, переключатель, галочка, выпадающий список с короткими значениями);
     иначе оба поля идут на всю ширину; текст, описания, телефоны, файлы и таблицы — всегда на всю ширину;
   - формы просмотра (.kv): подряд идущие короткие значения встают по два, длинные — на всю ширину.
   На ПК ничего не меняется: классы m-half и m-full действуют только в мобильной ширине. */
const PACK_W=600;
let packCanvas=null;
function textW(s,el){if(!packCanvas)packCanvas=document.createElement('canvas');const cx=packCanvas.getContext('2d');const cs=getComputedStyle(el);cx.font=`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;return cx.measureText(s).width}
// Поле формы короткое, если его содержимое помещается в половину строки
function fldShort(f,colW){
  if(f.classList.contains('full')||f.style.gridColumn)return false;
  const lab=f.querySelector(':scope>label,:scope>.lbl');if(lab&&textW(lab.textContent.trim(),lab)>colW)return false;
  if(f.querySelector('textarea,input[type=file],table,.grid,.ph-in,.chips,.box'))return false;
  const ctl=[...f.querySelectorAll('input,select,.seg')].filter(x=>!x.closest('.hint'));if(!ctl.length)return false;
  return ctl.every(x=>{
    if(x.matches('.seg'))return [...x.children].reduce((a,b)=>a+textW(b.textContent.trim(),b)+24,8)<=colW;
    if(x.tagName==='SELECT'){if(x.multiple)return false;const w=Math.max(...[...x.options].map(o=>textW(o.textContent.trim(),x)),0);return w+40<=colW}
    const t=(x.getAttribute('type')||'text').toLowerCase();
    if(['date','month','time','week','number','datetime-local'].includes(t))return true;
    if(t==='checkbox'||t==='radio'){const l=x.closest('label');return !l||textW(l.textContent.trim(),l)+48<=colW}
    if(t==='hidden')return true;
    const im=x.getAttribute('inputmode');return im==='decimal'||im==='numeric';
  });
}
function packForm(form){
  const kids=[...form.children].filter(k=>k.offsetParent!==null||k.matches('div:empty'));
  const colW=(form.clientWidth-14)/2;const rows=[];let cur=[];
  // Раскладка, как на ПК: «на всю ширину» занимает строку, остальные — по две ячейки
  kids.forEach(k=>{const full=!k.classList.contains('fld')||k.classList.contains('full')||/-1/.test(k.style.gridColumn);
    if(k.matches('div:empty')&&!k.className){cur.push(null);if(cur.length===2){rows.push(cur);cur=[]}return}
    if(full){if(cur.length)rows.push(cur);cur=[];rows.push([k]);return}
    cur.push(k);if(cur.length===2){rows.push(cur);cur=[]}});
  if(cur.length)rows.push(cur);
  rows.forEach(r=>{const f=r.filter(Boolean);const two=f.length===2&&f.every(x=>x.classList.contains('fld')&&fldShort(x,colW));
    f.forEach(x=>{x.classList.toggle('m-half',two);x.classList.toggle('m-full',!two)})});
}
function kvShort(d,colW){
  if(d.querySelector('table,.grid,.box,ul,.chips'))return false;
  return d.innerText.split('\n').every(line=>textW(line.trim(),d.querySelector('.v,dd')||d)<=colW);
}
function packKv(kv){
  const items=[...kv.children].filter(k=>k.offsetParent!==null);const colW=(kv.clientWidth-18)/2;
  for(let i=0;i<items.length;i++){const a=items[i],b=items[i+1];
    if(b&&kvShort(a,colW)&&kvShort(b,colW)){a.classList.add('m-half');a.classList.remove('m-full');b.classList.add('m-half');b.classList.remove('m-full');i++}
    else{a.classList.add('m-full');a.classList.remove('m-half')}}
}
/* ═════════════ Таблицы и панели действий в карточках на телефоне ═════════════
   Правило ТЗ «Карточка записи с вкладками»: таблица с классом m-cards на телефоне (до 767 px) показывается плитками.
   Первая ячейка строки — заголовок плитки, остальные — пары «подпись — значение» по два в строку (подписи берутся из шапки),
   длинное значение — на всю ширину, пустые значения («—») скрыты, кнопки строки — в правом верхнем углу плитки.
   Панель действий .acts стоит одной строкой: если кнопки не помещаются, второстепенные кнопки остаются значками. */
const MC_LONG=22;
function mCardsTable(t){const mt=+(t.dataset.mt||0);
  const hs=[];[...(t.tHead?t.tHead.rows[0].cells:[])].forEach(th=>{for(let k=0;k<(th.colSpan||1);k++)hs.push(th.textContent.trim())});
  [...t.tBodies].forEach(tb=>[...tb.rows].forEach(tr=>{let col=0;[...tr.cells].forEach((td,i)=>{const l=hs[col]||'';col+=td.colSpan||1;
    const txt=td.textContent.replace(/\s+/g,' ').trim();const ctl=td.querySelector('button,input,select,a');
    td.classList.toggle('m-t',i===mt);td.dataset.l=l;
    td.classList.toggle('m-act',i!==mt&&!l&&!!ctl&&!txt);
    td.classList.toggle('m-empty',i!==mt&&!ctl&&(txt===''||txt==='—'||txt==='-'));
    td.classList.toggle('m-wide',i!==mt&&(txt.length>MC_LONG||td.colSpan>1||!!td.querySelector('select,input:not([type=checkbox])')))});
    tr.classList.toggle('m-has-act',!!tr.querySelector('.m-act'));tr.classList.toggle('m-solo',tr.cells.length===1)}));
  t.dataset.mc='1'}
function mActsFit(row){row.classList.remove('icons');if(innerWidth>767)return;if(row.scrollWidth>row.clientWidth+1)row.classList.add('icons')}
// Ряд вкладок карточки на ПК: если не помещается — сначала меньше отступы, затем без значков, и только потом прокрутка (ТЗ «Вкладки модуля»)
function ctabsFit(t){t.classList.remove('tight','tight2');if(innerWidth<=767)return;const over=()=>t.scrollWidth>t.clientWidth+1;if(over())t.classList.add('tight');if(over())t.classList.add('tight2');
  const on=t.querySelector('.tab.on');if(on&&over())t.scrollLeft=on.offsetLeft-t.offsetLeft-(t.clientWidth-on.offsetWidth)/2}
function mCardsAll(){document.querySelectorAll('.ctabs').forEach(t=>{if(t.offsetParent!==null)ctabsFit(t)});document.querySelectorAll('table.m-cards').forEach(t=>{if(t.offsetParent!==null)mCardsTable(t)});document.querySelectorAll('.acts').forEach(r=>{if(r.offsetParent!==null)mActsFit(r)})}
let packQ=false,packWas=false;
function packAll(){packQ=false;mCardsAll();const mob=innerWidth<=PACK_W;
  if(!mob){if(packWas)document.querySelectorAll('.m-half,.m-full').forEach(x=>x.classList.remove('m-half','m-full'));packWas=false;return}
  packWas=true;
  document.querySelectorAll('.form,.kv').forEach(c=>{if(c.offsetParent===null)return;c.classList.add('m-pack');if(c.classList.contains('form'))packForm(c);else packKv(c)});
}
function packSoon(){if(packQ)return;packQ=true;requestAnimationFrame(packAll)}
new MutationObserver(packSoon).observe(document.documentElement,{childList:true,subtree:true});
addEventListener('resize',packSoon);

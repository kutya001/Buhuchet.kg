'use strict';
// Общий список контрагентов с поиском по названию и ИНН (просьба заказчика 13.11.2026, v93)
/* ═════════════ Contractor select ═════════════
   Одно поле для всех форм, где выбирают контрагента: задача, проект, разовая услуга, поступление денег, разовый отчёт, загрузка файла.
   Внутри — обычный <select> (скрыт): формы читают его значение и слушают change как раньше. Сверху — кнопка с названием и ИНН выбранного;
   по нажатию открывается окно со строкой «Название или ИНН» и списком. Ищет по части названия (без учёта регистра и «ё/е») и по цифрам ИНН подряд.
   Клавиши: в поле — буква или ↓ открывают список; в списке — ↑ ↓ выбирают строку, Enter подтверждает, Esc и Tab закрывают. */
const CPS_MAX=200;
const cpsFace=(text,inn,none)=>`<span class="cps-t ${none?'faint':''}">${esc(text)}</span>${inn?`<small class="cps-i mono">${esc(inn)}</small>`:''}${ic('down','sm')}`;
// cps — контрагенты; val — id выбранного; o.empty — подпись пустого выбора (нет её — выбор обязателен, как у обычного списка: первый по порядку);
// o.label(c) — подпись строки вместо названия; o.dis — поле недоступно
function cpSel(id,cps,val,o={}){
  const lab=c=>o.label?o.label(c):c.name;const hasE=o.empty!=null;
  const cur=cps.find(c=>String(c.id)===String(val))||(hasE?null:cps[0]);
  return `<span class="cps"><select class="cps-n" id="${id}" hidden ${o.dis?'disabled':''}>${hasE?`<option value="">${esc(o.empty)}</option>`:''}${cps.map(c=>`<option value="${c.id}" data-inn="${esc(c.inn||'')}" ${c===cur?'selected':''}>${esc(lab(c))}</option>`).join('')}</select><button type="button" class="inp cps-b" aria-haspopup="listbox" aria-expanded="false" ${o.dis?'disabled':''}>${cpsFace(cur?lab(cur):hasE?o.empty:'',cur?cur.inn:'',!cur)}</button></span>`}
function cpsSync(s){const b=s.parentNode.querySelector('.cps-b');if(!b)return;const o=s.selectedOptions[0];b.innerHTML=cpsFace(o?o.textContent:'',o?o.dataset.inn||'':'',!o||!o.value)}
// Подходит ли строка под запрос: часть названия либо цифры ИНН подряд (пробелы в цифрах не мешают)
function cpsHit(o,q){if(!q)return true;if(o.v==='')return false;const d=q.replace(/\s/g,'');return o.q.includes(q)||/^\d+$/.test(d)&&o.inn.includes(d)}
function cpsOpen(btn,seed=''){
  const s=btn.parentNode.querySelector('select');if(!s||btn.disabled)return;
  const all=[...s.options].map(o=>({v:o.value,t:o.textContent,inn:o.dataset.inn||'',q:norm(o.textContent)}));
  let shown=[],act=-1;
  const rows=q=>{const m=all.filter(o=>cpsHit(o,q));shown=m.slice(0,CPS_MAX);act=q?(shown.length?0:-1):shown.findIndex(o=>o.v===s.value);
    return shown.map((o,i)=>`<button type="button" class="mi cps-o ${o.v===s.value?'on':''} ${i===act?'act':''}" role="option" aria-selected="${o.v===s.value}" data-i="${i}" tabindex="-1"><span class="cps-t ${o.v===''?'faint':''}">${esc(o.t)}</span>${o.inn?`<small class="cps-i mono">${esc(o.inn)}</small>`:''}</button>`).join('')
      +(m.length>CPS_MAX?`<div class="cps-m">Показаны первые ${CPS_MAX} из ${m.length} — уточните поиск</div>`:'')||'<div class="cps-e">Ничего не найдено</div>'};
  const q0=norm(seed.trim());
  openPop(btn,`<input class="inp" type="search" id="cps-q" value="${esc(seed)}" placeholder="Название или ИНН" aria-label="Поиск контрагента по названию или ИНН" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="cps-l"><div class="cps-l" id="cps-l" role="listbox">${rows(q0)}</div>`,{cls:'cps-pop',mount(el){
    const inp=el.querySelector('#cps-q'),list=el.querySelector('#cps-l');
    // Высота списка закрепляется: при вводе окно не прыгает и не отрывается от поля
    list.style.height=list.offsetHeight+'px';
    const see=()=>{const a=list.querySelector('.cps-o.act')||list.querySelector('.cps-o.on');if(a)a.scrollIntoView({block:'nearest'})};
    const mark=()=>{$$('.cps-o',list).forEach((b,i)=>b.classList.toggle('act',i===act));see()};
    const pick=o=>{closePop();if(s.value!==o.v){s.value=o.v;s.dispatchEvent(new Event('change',{bubbles:true}))}
      const n=document.getElementById(s.id);const nb=n&&n.parentNode.querySelector('.cps-b');(nb||btn).focus({preventScroll:true})};
    inp.oninput=()=>{list.innerHTML=rows(norm(inp.value.trim()));list.scrollTop=0;see()};
    inp.onkeydown=e=>{
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!shown.length)return;act=e.key==='ArrowDown'?Math.min(shown.length-1,act+1):Math.max(0,act-1);mark()}
      else if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(shown[act])pick(shown[act])}
      else if(e.key==='Tab'){e.preventDefault();closePop();btn.focus({preventScroll:true})}};
    list.onclick=e=>{const b=e.target.closest('.cps-o');if(b)pick(shown[+b.dataset.i])};
    if(seed)inp.setSelectionRange(seed.length,seed.length);see()}});
  btn.setAttribute('aria-expanded','true');
}
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('.cps-b');if(b){if(POP&&POP_ANCHOR===b)closePop();else cpsOpen(b);return}
  // Подпись поля ведёт к кнопке списка, а не к скрытому <select>
  const l=e.target.closest&&e.target.closest('label[for]');if(l){const s=document.getElementById(l.htmlFor);if(s&&s.classList.contains('cps-n')){const x=s.parentNode.querySelector('.cps-b');x&&x.focus()}}});
document.addEventListener('keydown',e=>{const b=e.target.closest&&e.target.closest('.cps-b');if(!b||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!(POP&&POP_ANCHOR===b))cpsOpen(b)}
  else if(e.key.length===1&&e.key!==' '){e.preventDefault();cpsOpen(b,e.key)}});
// Значение сменили не через список (код формы) — подпись кнопки обновляется сама
document.addEventListener('change',e=>{if(e.target.classList&&e.target.classList.contains('cps-n'))cpsSync(e.target)});

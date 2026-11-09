'use strict';
// Таблица ввода чисел «как в Excel»: все таблицы ввода «Показателей» и вкладка «Показатели» в карточке контрагента
/* ═════════════ Таблица как в Excel ═════════════
   Выделение: щелчок, протягивание мышью, Shift+щелчок, Shift+стрелки, щелчок по заголовку столбца или строки, Ctrl+A.
   Ввод: начните печатать — значение ячейки заменится; F2 или двойной щелчок — правка текущего значения; Enter — сохранить и вниз
   (Shift+Enter — вверх), Tab — вправо, Esc — отменить правку; стрелки — переход между ячейками (при вводе с клавиатуры тоже сохраняют).
   Delete или Backspace — стереть выделенное; Ctrl+C, Ctrl+X, Ctrl+V — блоком через буфер обмена (в Excel и из Excel);
   одно значение, вставленное в выделенный диапазон, заполняет его весь; Ctrl+Enter — введённое значение во все выделенные ячейки;
   Ctrl+D — заполнить вниз первой строкой выделения; Ctrl+Z — отменить. Правая кнопка мыши — меню тех же действий.
   На телефоне нажатие на ячейку сразу открывает ввод, «Далее» на клавиатуре сохраняет и переходит ниже.
   Ячейки данных — <td data-sr="строка" data-sc="столбец">; заголовки столбцов — data-exc, строк — data-exr.
   o: rows, cols — размеры; get(r,c) → {t: текст для правки и копирования, n: число или null, ed: можно править, why: почему нельзя};
   put([{r,c,t}]) → {bad:[тексты не числом]} записывает (пустой текст — стереть); draw(r,c) перерисовывает ячейку; after(изменённые) — после записи;
   stat — элемент строки состояния (как внизу Excel: количество, сумма, среднее выделенного); hint — её текст без выделения; label(r,c) — имя ячейки для экранного диктора;
   menu(r,c) → дополнительные пункты меню правой кнопки для текущей ячейки */
const exCoarse=()=>matchMedia('(pointer:coarse)').matches;
function exTable(wrap,o){
  const C=[];$$('td[data-sr]',wrap).forEach(t=>{(C[+t.dataset.sr]=C[+t.dataset.sr]||[])[+t.dataset.sc]=t});
  const st={a:null,e:null,ed:null,drag:false,undo:[]};
  // Невидимое поле держит клавиатуру и буфер обмена, пока ячейка не в правке
  const kb=document.createElement('textarea');kb.className='ex-kb';kb.setAttribute('autocomplete','off');kb.setAttribute('aria-label','Таблица ввода');kb.spellcheck=false;
  const Z='​';const arm=()=>{kb.value=Z;kb.select()};wrap.appendChild(kb);wrap.classList.add('ex');
  const fix=$$('thead .ex-fix',wrap).reduce((a,x)=>a+x.offsetWidth,0);if(fix)wrap.style.scrollPaddingLeft=fix+'px';
  const lim=(v,n)=>Math.max(0,Math.min(n-1,v));
  const rect=()=>{const a=st.a,e=st.e;return [Math.min(a.r,e.r),Math.max(a.r,e.r),Math.min(a.c,e.c),Math.max(a.c,e.c)]};
  const inR=p=>{if(!st.a)return false;const[r0,r1,c0,c1]=rect();return p.r>=r0&&p.r<=r1&&p.c>=c0&&p.c<=c1};
  const each=f=>{const[r0,r1,c0,c1]=rect();for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)f(r,c)};
  const fmt=v=>fmtM(Math.round(v*100)/100,Math.round(v*100)%100!==0);
  let lit=[];
  function paint(scroll){lit.forEach(t=>t.classList.remove('ex-s','ex-a'));lit=[];
    if(st.a){each((r,c)=>{const t=C[r]&&C[r][c];if(t){t.classList.add('ex-s');lit.push(t)}});const t=C[st.a.r][st.a.c];if(t){t.classList.add('ex-a');lit.push(t)}
      if(scroll){const f=C[st.e.r]&&C[st.e.r][st.e.c];if(f)f.scrollIntoView({block:'nearest',inline:'nearest'})}
      kb.setAttribute('aria-label',o.label?o.label(st.a.r,st.a.c):'Ячейка')}
    stat()}
  function stat(){if(!o.stat)return;if(!st.a){o.stat.innerHTML=o.hint||'';return}const[r0,r1,c0,c1]=rect();const n=(r1-r0+1)*(c1-c0+1);
    if(n<2){o.stat.innerHTML=o.hint||'';return}const ns=[];each((r,c)=>{const g=o.get(r,c);if(g.n!=null)ns.push(g.n)});const s=ns.reduce((a,b)=>a+b,0);
    o.stat.innerHTML=`<span>Выделено: <b>${n}</b></span>${ns.length?`<span>Заполнено: <b>${ns.length}</b></span><span>Сумма: <b>${fmt(s)}</b></span><span>Среднее: <b>${fmt(s/ns.length)}</b></span><span>Мин: <b>${fmt(Math.min(...ns))}</b></span><span>Макс: <b>${fmt(Math.max(...ns))}</b></span>`:'<span class="faint">в выделении нет значений</span>'}`}
  function go(dr,dc,ext){if(!st.a){st.a={r:0,c:0};st.e={r:0,c:0}}
    else if(ext)st.e={r:lim(st.e.r+dr,o.rows),c:lim(st.e.c+dc,o.cols)};else{const r=lim(st.a.r+dr,o.rows),c=lim(st.a.c+dc,o.cols);st.a={r,c};st.e={r,c}}
    paint(true)}
  function pick(a,e){st.a=a;st.e=e||Object.assign({},a);paint(true)}
  // Запись: только в доступные ячейки; отмена — прежние тексты изменённых ячеек
  function write(L,how){const ok=[],skip=[];L.forEach(x=>{const g=o.get(x.r,x.c);if(g.ed)ok.push(Object.assign({t0:g.t},x));else if(String(x.t).trim()!=='')skip.push(g)});
    const res=ok.length?(o.put(ok)||{}):{};const ch=ok.filter(x=>o.get(x.r,x.c).t!==x.t0);ok.forEach(x=>o.draw(x.r,x.c));
    if(ch.length&&how!=='undo'){st.undo.push(ch.map(x=>({r:x.r,c:x.c,t:x.t0})));if(st.undo.length>100)st.undo.shift()}
    if(ch.length&&o.after)o.after(ch);
    const bad=res.bad||[];
    if(L.length===1){if(bad.length)toast(`«${bad[0]}» — не число`,'alert',true);else if(skip.length)toast(skip[0].why||'Эту ячейку изменить нельзя','lock',true)}
    else{const m=[`${how==='clear'?'Стёрто':how==='undo'?'Отменено':'Записано'} значений: ${ch.length}`];if(bad.length)m.push(`не числа: ${bad.length}${bad.length<4?' ('+bad.map(b=>'«'+b+'»').join(', ')+')':''}`);
      if(skip.length)m.push(`пропущено ячеек, где ввод недоступен: ${skip.length}`);toast(m.join(', '),bad.length?'alert':how==='clear'?'trash':'check',!!bad.length)}
    paint();return ch.length}
  // Правка ячейки: mode 'enter' — начали печатать (стрелки сохраняют и переходят), 'edit' — F2 или двойной щелчок (стрелки двигают курсор)
  function edit(mode,init,quiet){if(!st.a)return false;const{r,c}=st.a;const g=o.get(r,c);if(!g.ed){if(!quiet)toast(g.why||'Эту ячейку изменить нельзя','lock',true);return false}
    const t=C[r][c];const inp=document.createElement('input');inp.className='ex-in';inp.setAttribute('inputmode','decimal');inp.setAttribute('enterkeyhint','next');inp.autocomplete='off';inp.size=1;
    t.style.minWidth=t.offsetWidth+'px';inp.value=init!=null?init:g.t;inp.setAttribute('aria-label',o.label?o.label(r,c):'Значение');t.classList.add('ex-e');t.textContent='';t.appendChild(inp);st.ed={r,c,inp,mode,t0:g.t};
    inp.focus({preventScroll:true});const L=inp.value.length;try{if(mode==='edit'&&exCoarse())inp.select();else inp.setSelectionRange(L,L)}catch(e){}
    inp.addEventListener('keydown',ek);inp.addEventListener('blur',()=>{if(st.ed&&st.ed.inp===inp)done(null)});
    inp.addEventListener('paste',e=>{const tx=(e.clipboardData||window.clipboardData).getData('text');if(!/[\t\n]/.test(tx.replace(/[\r\n]+$/,'')))return;e.preventDefault();cancel();paste(tx)});return true}
  function done(move,all){const E=st.ed;if(!E)return;st.ed=null;C[E.r][E.c].classList.remove('ex-e');C[E.r][E.c].style.minWidth='';const v=E.inp.value;
    if(all){const L=[];each((r,c)=>L.push({r,c,t:v}));o.draw(E.r,E.c);write(L)}else if(v.trim()!==String(E.t0).trim())write([{r:E.r,c:E.c,t:v}]);else{o.draw(E.r,E.c);paint()}
    if(move)go(move[0],move[1],false);
    if(move&&exCoarse())edit('edit',null,true);else if(!exCoarse())kb.focus({preventScroll:true})}
  function cancel(){const E=st.ed;if(!E)return;st.ed=null;C[E.r][E.c].classList.remove('ex-e');C[E.r][E.c].style.minWidth='';o.draw(E.r,E.c);paint();if(!exCoarse())kb.focus({preventScroll:true})}
  function ek(e){const E=st.ed;if(!E)return;const k=e.key;
    if(k==='Enter'){e.preventDefault();e.stopPropagation();return (e.ctrlKey||e.metaKey)?done(null,true):done(e.shiftKey?[-1,0]:[1,0])}
    if(k==='Tab'){e.preventDefault();return done(e.shiftKey?[0,-1]:[0,1])}
    if(k==='Escape'){e.preventDefault();e.stopPropagation();return cancel()}
    const D={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[k];if(D&&E.mode==='enter'){e.preventDefault();return done(D)}e.stopPropagation()}
  const tsv=()=>{const[r0,r1,c0,c1]=rect();const out=[];for(let r=r0;r<=r1;r++){const l=[];for(let c=c0;c<=c1;c++)l.push(o.get(r,c).t);out.push(l.join('\t'))}return out.join('\n')};
  // Вставка блока: одно значение в диапазон — во все ячейки; блок, который укладывается в диапазон целое число раз, — повторяется; иначе — от левого верхнего угла
  function paste(tx){if(!st.a)return;const B=String(tx).replace(/\r/g,'').replace(/\n+$/,'').split('\n').map(l=>l.split('\t'));const bh=B.length,bw=Math.max(...B.map(l=>l.length));
    const[r0,r1,c0,c1]=rect();const h=r1-r0+1,w=c1-c0+1;const L=[];
    if(bh===1&&bw===1&&(h>1||w>1))each((r,c)=>L.push({r,c,t:B[0][0]}));
    else if(h%bh===0&&w%bw===0&&(h>bh||w>bw))each((r,c)=>L.push({r,c,t:(B[(r-r0)%bh][(c-c0)%bw])??''}));
    else{B.forEach((l,dr)=>l.forEach((v,dc)=>{const r=r0+dr,c=c0+dc;if(r<o.rows&&c<o.cols)L.push({r,c,t:v})}));st.a={r:r0,c:c0};st.e={r:Math.min(o.rows-1,r0+bh-1),c:Math.min(o.cols-1,c0+bw-1)}}
    write(L,'paste')}
  function clear(){const L=[];each((r,c)=>L.push({r,c,t:''}));write(L,'clear')}
  function fillDown(){if(!st.a)return;const[r0,r1,c0,c1]=rect();if(r1===r0)return toast('Выделите ячейки ниже той, что нужно размножить','alert',true);const L=[];for(let c=c0;c<=c1;c++){const t=o.get(r0,c).t;for(let r=r0+1;r<=r1;r++)L.push({r,c,t})}write(L,'fill')}
  function undo(){const u=st.undo.pop();if(!u)return toast('Отменять нечего');const rs=u.map(x=>x.r),cs=u.map(x=>x.c);st.a={r:Math.min(...rs),c:Math.min(...cs)};st.e={r:Math.max(...rs),c:Math.max(...cs)};write(u,'undo')}
  const copyOut=()=>{kb.focus({preventScroll:true});arm();let ok=false;try{ok=document.execCommand('copy')}catch(e){}if(!ok&&navigator.clipboard)navigator.clipboard.writeText(tsv()).catch(()=>{});toast('Скопировано: Ctrl+V вставит в Excel или в другие ячейки','copy')};
  kb.addEventListener('focus',()=>{arm();if(!st.a&&o.rows&&o.cols)pick({r:0,c:0})});
  kb.addEventListener('keydown',e=>{if(st.ed||!st.a)return;const k=e.key,ctl=e.ctrlKey||e.metaKey;
    const D={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[k];
    if(D){e.preventDefault();return go(ctl?D[0]*1e6:D[0],ctl?D[1]*1e6:D[1],e.shiftKey)}
    if(k==='Enter'){e.preventDefault();return go(e.shiftKey?-1:1,0,false)}
    if(k==='Tab'){e.preventDefault();return go(0,e.shiftKey?-1:1,false)}
    if(k==='PageDown'||k==='PageUp'){e.preventDefault();return go(k==='PageDown'?10:-10,0,e.shiftKey)}
    if(k==='Home'){e.preventDefault();return ctl?pick({r:0,c:0}):go(0,-1e6,e.shiftKey)}
    if(k==='End'){e.preventDefault();return ctl?pick({r:o.rows-1,c:o.cols-1}):go(0,1e6,e.shiftKey)}
    if(k==='F2'){e.preventDefault();return edit('edit')}
    if(k==='Delete'||k==='Backspace'){e.preventDefault();return clear()}
    if(k==='Escape'&&(st.a.r!==st.e.r||st.a.c!==st.e.c)){e.preventDefault();e.stopPropagation();return pick(st.a)}
    if(ctl&&e.code==='KeyA'){e.preventDefault();st.a={r:0,c:0};st.e={r:o.rows-1,c:o.cols-1};return paint()}
    if(ctl&&e.code==='KeyZ'){e.preventDefault();return undo()}
    if(ctl&&e.code==='KeyD'){e.preventDefault();return fillDown()}
    if(!ctl&&!e.altKey&&k.length===1){e.preventDefault();return edit('enter',k)}});
  // Ввод через метод ввода (IME) и экранную клавиатуру: первый набранный текст начинает правку
  kb.addEventListener('input',()=>{const v=kb.value.replace(Z,'');arm();if(v&&!st.ed&&st.a)edit('enter',v)});
  kb.addEventListener('copy',e=>{if(!st.a)return;e.preventDefault();e.clipboardData.setData('text/plain',tsv())});
  kb.addEventListener('cut',e=>{if(!st.a)return;e.preventDefault();e.clipboardData.setData('text/plain',tsv());clear()});
  kb.addEventListener('paste',e=>{if(!st.a)return;e.preventDefault();paste((e.clipboardData||window.clipboardData).getData('text'))});
  const cell=e=>{const t=e.target.closest&&e.target.closest('td[data-sr]');return t&&wrap.contains(t)?{r:+t.dataset.sr,c:+t.dataset.sc,t}:null};
  wrap.addEventListener('mousedown',e=>{if(exCoarse()||e.button>2||e.target.closest('.ex-in,button,a,input,select,label'))return;
    const h=e.target.closest('[data-exc],[data-exr]');
    if(h&&e.button===0&&wrap.contains(h)){e.preventDefault();if(st.ed)done(null);
      if(h.dataset.exc!=null){const c=+h.dataset.exc;if(e.shiftKey&&st.a)st.e={r:o.rows-1,c};else{st.a={r:0,c};st.e={r:o.rows-1,c}}}
      else{const r=+h.dataset.exr;if(e.shiftKey&&st.a)st.e={r,c:o.cols-1};else{st.a={r,c:0};st.e={r,c:o.cols-1}}}
      paint();return kb.focus({preventScroll:true})}
    const p=cell(e);if(!p)return;if(e.button===2&&inR(p))return kb.focus({preventScroll:true});
    e.preventDefault();if(st.ed)done(null);if(e.shiftKey&&st.a)st.e={r:p.r,c:p.c};else{st.a={r:p.r,c:p.c};st.e={r:p.r,c:p.c}}
    st.drag=e.button===0;paint();kb.focus({preventScroll:true})});
  wrap.addEventListener('mouseover',e=>{if(!st.drag)return;const p=cell(e);if(p&&(p.r!==st.e.r||p.c!==st.e.c)){st.e={r:p.r,c:p.c};paint()}});
  const up=()=>{st.drag=false;if(!wrap.isConnected)document.removeEventListener('mouseup',up)};document.addEventListener('mouseup',up);
  wrap.addEventListener('dblclick',e=>{if(!exCoarse()&&cell(e)&&!st.ed)edit('edit')});
  wrap.addEventListener('click',e=>{if(!exCoarse())return;const p=cell(e);if(!p||e.target.closest('.ex-in'))return;if(st.ed)done(null);st.a={r:p.r,c:p.c};st.e={r:p.r,c:p.c};paint();edit('edit')});
  wrap.addEventListener('contextmenu',e=>{const p=cell(e);if(!p||exCoarse())return;e.preventDefault();if(!inR(p)){st.a={r:p.r,c:p.c};st.e={r:p.r,c:p.c};paint()}kb.focus({preventScroll:true});
    const rd=navigator.clipboard&&navigator.clipboard.readText;
    menu(p.t,[{label:'Копировать',icon:'copy',sub:'Ctrl+C',run:copyOut},{label:'Вырезать',icon:'x',sub:'Ctrl+X',run:()=>{copyOut();clear()}},
      {label:'Вставить',icon:'paste',sub:'Ctrl+V',run:()=>rd?navigator.clipboard.readText().then(t=>{kb.focus({preventScroll:true});paste(t)},()=>toast('Браузер не дал прочитать буфер обмена: нажмите Ctrl+V','alert',true)):toast('Нажмите Ctrl+V','alert',true)},
      {sep:true},{label:'Заполнить вниз',icon:'down',sub:'Ctrl+D — первой строкой выделения',run:fillDown},{label:'Очистить',icon:'trash',sub:'Delete',run:clear},
      {sep:true},{label:'Отменить',icon:'refresh',sub:'Ctrl+Z',disabled:!st.undo.length,reason:'Изменений ещё не было',run:undo},...(o.menu?(L=>L.length?[{sep:true},...L]:[])(o.menu(st.a.r,st.a.c)):[])],{x:e.clientX,y:e.clientY})});
  stat();
  return {pick,focus:()=>kb.focus({preventScroll:true}),paste,clear,undo,get sel(){return st.a?rect():null}}}

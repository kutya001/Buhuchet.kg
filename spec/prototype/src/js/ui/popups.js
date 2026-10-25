'use strict';
// Поповеры, меню, модальные окна, подтверждения, уведомления, помощники форм
/* ═════════════ Popover / menu / modal / toast ═════════════ */
let POP=null,POP_ANCHOR=null;
function closePop(){if(POP){POP.remove();POP=null;POP_ANCHOR=null}}
function openPop(anchor,html,{pt,cls='',mount}={}){
  closePop();const el=document.createElement('div');el.className='pop '+cls;el.innerHTML=html;document.body.appendChild(el);
  const W=innerWidth,H=innerHeight,w=el.offsetWidth,h=el.offsetHeight;let x,y;
  if(pt){x=pt.x;y=pt.y}else{const r=anchor.getBoundingClientRect();x=r.left;y=r.bottom+6;if(x+w>W-8)x=r.right-w;if(y+h>H-8)y=Math.max(8,r.top-h-6)}
  x=Math.max(8,Math.min(x,W-w-8));y=Math.max(8,Math.min(y,H-h-8));el.style.left=x+'px';el.style.top=y+'px';
  POP=el;POP_ANCHOR=anchor;mount&&mount(el);swipeDown(el,()=>el,{can:()=>true,close:closePop});
  const f=el.querySelector('input:not([type=checkbox]),select');if(f&&!isMobile())f.focus();
  return el;
}
document.addEventListener('pointerdown',e=>{if(POP&&!POP.contains(e.target)&&!(POP_ANCHOR&&POP_ANCHOR.contains&&POP_ANCHOR.contains(e.target)))closePop()},true);
let HOV=null;const hoverOk=()=>!isMobile()&&matchMedia('(hover:hover)').matches;
document.addEventListener('mouseover',e=>{if(!hoverOk())return;const a=e.target.closest&&e.target.closest('.tipi,#tb-info');if(!a||POP_ANCHOR===a)return;clearTimeout(HOV);HOV=setTimeout(()=>{if(!a.matches(':hover'))return;a.click();if(POP&&POP_ANCHOR===a){const p=POP;p.dataset.hover='1';const chk=()=>setTimeout(()=>{if(POP===p&&!p.matches(':hover')&&!a.matches(':hover'))closePop()},220);p.addEventListener('mouseleave',chk);a.addEventListener('mouseleave',chk,{once:true})}},300)});
document.addEventListener('mouseout',e=>{const a=e.target.closest&&e.target.closest('.tipi,#tb-info');if(a&&!(e.relatedTarget&&a.contains(e.relatedTarget)))clearTimeout(HOV)});
function menu(anchor,items,pt){
  const html=items.filter(Boolean).map((it,i)=>it.sep?'<div class="msep"></div>':`<button class="mi ${it.danger?'danger':''} ${it.on?'on':''}" data-i="${i}" ${it.disabled?'disabled':''}>${ic(it.icon||'right')}<span>${esc(it.label)}${it.badge?` <span class="pill yellow sm beta-p">${esc(it.badge)}</span>`:''}${it.disabled&&it.reason?`<span class="sub">${esc(it.reason)}</span>`:it.sub?`<span class="sub">${esc(it.sub)}</span>`:''}</span></button>`).join('');
  const list=items.filter(Boolean);
  openPop(anchor,html,{pt,mount(el){el.addEventListener('click',e=>{const b=e.target.closest('.mi');if(!b||b.disabled)return;const it=list[+b.dataset.i];closePop();it.run&&it.run()})}});
}
// Ряд вкладок окна-карточки (ТЗ «Карточка записи с вкладками»). tabs: [ключ, название, значок, счётчик?, красный? (или 'yellow')].
// ПК: полный ряд со счётчиками. Телефон: видна одна текущая вкладка во всю ширину с «N из M ▾»; нажатие открывает список всех вкладок,
// свайп влево-вправо листает их как раньше (formPager ищет .tabs прямо в .mb). Ряд закреплён вверху содержимого окна.
function cardTabs(tabs,cur,attr){return `<div class="tabs sm ctabs" role="tablist" style="margin:0">${tabs.map((t,i)=>`<button type="button" class="tab ${cur===t[0]?'on':''}" role="tab" aria-selected="${cur===t[0]}" data-${attr}="${t[0]}" data-ic="${t[2]}" title="${esc(t[1])}">${ic(t[2])}<span class="lbl">${t[1]}</span>${t[3]?`<span class="badge ${t[4]==='yellow'?'yellow':t[4]?'red':''}">${t[3]}</span>`:''}${cur===t[0]?`<span class="ct-pick">${i+1} из ${tabs.length}${ic('down','sm')}</span>`:''}</button>`).join('')}</div>`}
function bindCardTabs(el,attr,go){const bs=$$(`.ctabs [data-${attr}]`,el);
  bs.forEach(x=>x.onclick=()=>{if(x.classList.contains('on')&&isMobile())return menu(x,bs.map(b=>({label:b.querySelector('.lbl').textContent,icon:b.dataset.ic,sub:b.querySelector('.badge')?b.querySelector('.badge').textContent:'',on:b===x,run:()=>{if(b!==x)go(b.getAttribute('data-'+attr))}})));
    if(!x.classList.contains('on'))go(x.getAttribute('data-'+attr))})}
const MODALS=[];
/* Кнопка «Назад» (телефон и браузер) закрывает верхнее окно, «Другие модули» или показ, а не меняет модуль под окном.
   Пока открыто хоть одно, в истории браузера одна запись-заглушка {ov:id} с тем же адресом, а запись под ней помечена {ovb:id};
   закрыли последнее кнопкой — заглушка снимается. */
const OV={skip:false,t:0,url:'',id:0,reopen:false,next:null};
const ovAny=()=>MODALS.length>0||!!(document.getElementById('sheet')&&document.getElementById('sheet').classList.contains('open'))||(typeof TOUR!=='undefined'&&TOUR.on);
const ovStale=()=>!!(history.state&&history.state.ov)&&!ovAny();
// Пока снимается заглушка (history.back ещё не дошёл), новое окно и переход ждут его завершения — иначе «Назад» унёс бы и их
function ovOpen(){clearTimeout(OV.t);if(OV.skip){OV.reopen=true;return}if(!(history.state&&history.state.ov)){OV.url=location.href;OV.id++;history.replaceState({ovb:OV.id},'',location.href);history.pushState({ov:OV.id},'',location.href)}}
// Под окном сменился модуль (go во время показа) — заглушка становится обычной записью этого модуля, иначе «Назад» по ней вернуло бы прежний
function ovClosed(){clearTimeout(OV.t);OV.t=setTimeout(()=>{if(!ovStale())return;if(location.href===OV.url){OV.skip=true;history.back()}else history.replaceState(null,'',location.href)},0)}
// popstate приходит и на «Назад», и на смену адреса после # (location.hash=…); окно закрывает только «Назад» с заглушки на помеченную запись под ней
addEventListener('popstate',e=>{
  if(OV.skip){OV.skip=false;if(OV.reopen){OV.reopen=false;if(ovAny())ovOpen()}if(OV.next){const n=OV.next;OV.next=null;go(...n)}return}
  closePop();
  // Вернулись на саму заглушку (со страницы, открытой поверх окна, например страницы контрагента): окно остаётся; окон нет — заглушка лишняя, проходим её
  if(e.state&&e.state.ov){if(!ovAny())history.back();return}
  if(!ovAny()||!(e.state&&e.state.ovb===OV.id))return;
  if(typeof TOUR!=='undefined'&&TOUR.on){tourEnd(false);if(ovAny())ovOpen();return}
  const m=MODALS[MODALS.length-1];
  if(m){if(m.dirty&&m.o.form){ovOpen();confirmDlg({title:'Закрыть без сохранения?',text:'В форме есть несохранённые изменения. Если закрыть сейчас, они пропадут.',ok:'Закрыть',danger:true,run:m.close});return}
    m.close();if(ovAny())ovOpen();return}
  if(document.getElementById('sheet')&&document.getElementById('sheet').classList.contains('open'))closeSheet(true)});
function openModal(o){
  const cover=document.createElement('div');cover.className='cover';
  cover.innerHTML=`<div class="modal ${o.size||''}" role="dialog" aria-modal="true"></div>`;
  document.body.appendChild(cover);
  const m={o,cover,el:cover.firstElementChild,state:o.state||{},close(){if(m.closed)return;m.closed=true;cover.remove();const i=MODALS.indexOf(m);if(i>=0)MODALS.splice(i,1);ovClosed();if(typeof ckSoon==='function')ckSoon();if(o.onClose)o.onClose()}};
  m.canMax=!!(o.size||o.form)&&!o.noMax;m.maxKey='modal.max.'+(o.form?'form':'card');if(o.form&&o.size!=='wide')m.el.classList.add('narrow');
  m.setMax=(on,save)=>{if(!m.canMax)on=false;m.max=on;const fl=m.el.getBoundingClientRect();cover.classList.toggle('max',on);m.el.classList.toggle('max',on);
    if(save){store.set(m.maxKey,on);
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&!isMobile()){const to=m.el.getBoundingClientRect();m.el.animate([{transform:`translate(${fl.left+fl.width/2-to.left-to.width/2}px,${fl.top+fl.height/2-to.top-to.height/2}px) scale(${fl.width/to.width},${fl.height/to.height})`},{transform:'none'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'})}}
    if(m.drawn)m.draw()};
  MODALS.push(m);ovOpen();
  formPager(m);
  const mark=e=>{if(e.target.closest&&e.target.closest('.form,.fld'))m.dirty=true};m.el.addEventListener('input',mark);m.el.addEventListener('change',mark);
  swipeDown(m.el,()=>m.el.querySelector('.mb'),{cover,headOnly:!!o.swipeHead,can:()=>{if(m.dirty&&o.form){confirmDlg({title:'Закрыть без сохранения?',text:'В форме есть несохранённые изменения. Если закрыть сейчас, они пропадут.',ok:'Закрыть',danger:true,run:m.close});return false}return true},close:m.close});
  cover.addEventListener('pointerdown',e=>{if(e.target===cover&&!o.sticky)m.close()});
  m.draw=()=>{
    const keep=m.el.querySelector('.mb')?m.el.querySelector('.mb').scrollTop:0;
    const r=o.render(m);
    m.el.innerHTML=`<div class="grabber"></div><div class="mh"><div style="flex:1;min-width:0"><h2>${r.title}</h2>${r.sub?`<div class="sub">${r.sub}</div>`:''}</div>${r.head||''}<div class="mh-btns">${m.canMax?`<button class="icon-btn" data-max aria-pressed="${!!m.max}" aria-label="${m.max?'Свернуть окно':'На весь экран'}" title="${m.max?'Свернуть окно':'На весь экран'}${isMobile()?'':' (двойной клик по заголовку)'}">${ic(m.max?'minimize':'maximize')}</button>`:''}<button class="icon-btn" data-x aria-label="Закрыть">${ic('x')}</button></div></div><div class="mb">${r.body}</div>${r.foot?`<div class="mf">${r.foot}</div>`:''}`;
    m.el.querySelector('[data-x]').onclick=m.close;
    if(m.canMax){m.el.querySelector('[data-max]').onclick=()=>m.setMax(!m.max,true);m.el.querySelector('.mh').ondblclick=e=>{if(!e.target.closest('button,a,input,select'))m.setMax(!m.max,true)}}
    $$('[data-close]',m.el).forEach(b=>b.onclick=m.close);
    r.mount&&r.mount(m.el,m);
    m.el.querySelectorAll('.scf').forEach(f=>{if(f.scrollWidth<=f.clientWidth)return;const g=f.querySelector('.scf-s.go')||f.querySelector('.scf-s.c');if(g)f.scrollLeft=Math.max(0,g.offsetLeft+g.offsetWidth-f.clientWidth+12)});
    m.el.querySelector('.mb').scrollTop=keep;
  };
  m.setMax(!!store.get(m.maxKey,false));m.draw();m.drawn=true;
  if(!isMobile()){const f=m.el.querySelector('.mb .fld input:not([type=checkbox]):not([readonly]),.mb .fld textarea,.mb .fld select');f&&f.focus({preventScroll:true})}
  return m;
}
// Уведомление внизу экрана: исчезает само через 3,2 с; на ПК — крестик «Закрыть», на телефоне — свайп влево или вправо (ТЗ «Уведомления внизу экрана»)
function toast(msg,icon='check',bad=false){if(!bad&&typeof ckSoon==='function'&&!CK.quiet)ckSoon();const t=document.createElement('div');t.className='toast'+(bad?' bad':'');t.setAttribute('role','status');t.innerHTML=ic(icon)+`<span>${esc(msg)}</span><button type="button" class="toast-x" aria-label="Закрыть уведомление" title="Закрыть">${ic('x','sm')}</button>`;$('#toasts').appendChild(t);
  const gone=()=>{if(t.gone)return;t.gone=true;t.style.transition='opacity .3s';t.style.opacity='0';setTimeout(()=>t.remove(),320)};
  t.querySelector('.toast-x').onclick=()=>{t.gone=true;t.remove()};swipeAway(t,()=>{t.gone=true;t.remove()});
  setTimeout(()=>{if(t.dragging)t.later=gone;else gone()},3200)}
function confirmDlg({title,text,ok='Подтвердить',danger=false,run}){
  openModal({noMax:true,render:()=>({title,body:`<p style="margin:0;color:var(--muted);line-height:1.55">${text}</p>`,foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn ${danger?'danger':'cta'}" id="cf-ok">${esc(ok)}</button>`,
    mount(el,m){$('#cf-ok',el).onclick=()=>{m.close();run()}}})});
}
/* Form helpers */
function fld(label,inner,{req,full,hint,id}={}){return `<div class="fld ${full?'full':''}" ${id?`data-f="${id}"`:''}><label ${id?`for="${id}"`:''} class="${req?'req':''}">${label}</label>${inner}${hint?`<div class="hint">${hint}</div>`:''}<div class="err" hidden></div></div>`}
const inp=(id,val='',attrs='')=>`<input ${/class=/.test(attrs)?'':'class="inp"'} id="${id}" value="${esc(val)}" ${attrs}>`;
const sel=(id,opts,val,attrs='')=>`<select class="inp" id="${id}" ${attrs}>${opts.map(o=>{const[v,l,dis]=Array.isArray(o)?o:[o,o];return `<option value="${esc(v)}" ${String(v)===String(val)?'selected':''} ${dis?'disabled':''}>${esc(l)}</option>`}).join('')}</select>`;
function setErr(root,id,msg){const f=root.querySelector(`[data-f="${id}"]`);if(!f)return!msg;f.classList.toggle('bad',!!msg);const e=f.querySelector('.err');e.hidden=!msg;e.innerHTML=msg?ic('alert','sm')+`<span>${esc(msg)}</span>`:'';return !msg}
const val=(root,id)=>{const e=root.querySelector('#'+id);return e?e.value.trim():''};
function phoneInput(id,ph){const cc=ph?ph.cc:'KG';const c=PH[cc];const local=ph?ph.digits.slice(c.code.length):'';
  return `<div class="phone">${sel(id+'-cc',PHONES.filter(p=>p.active!==false||p.cc===cc).map(p=>[p.cc,`${p.flag} +${p.code}`]),cc,'aria-label="Код страны"')}<input class="inp mono" id="${id}" inputmode="tel" value="${esc(applyMask(c.mask,local))}" placeholder="${c.mask.replace(/X/g,'0')}"></div>`}
function bindPhone(root,id){const s=root.querySelector('#'+id+'-cc'),i=root.querySelector('#'+id);
  const fix=()=>{const c=PH[s.value];const max=c.mask.split('X').length-1;const d=i.value.replace(/\D/g,'').slice(0,max);i.value=applyMask(c.mask,d);i.placeholder=c.mask.replace(/X/g,'0')};
  i.addEventListener('input',fix);s.addEventListener('change',fix)}
function readPhone(root,id){const s=root.querySelector('#'+id+'-cc'),i=root.querySelector('#'+id);const c=PH[s.value];const d=i.value.replace(/\D/g,'');const max=c.mask.split('X').length-1;
  return {ok:d.length===max,empty:!d,ph:{cc:c.cc,digits:c.code+d},need:max}}
const waLink=(ph,text)=>`https://wa.me/${ph.digits}${text?`?text=${encodeURIComponent(text)}`:''}`;
function phoneHtml(ph){if(!ph)return '<span class="faint">—</span>';return `<span class="mono"><a href="tel:+${ph.digits}" title="Позвонить" style="color:inherit">${esc(fmtPhone(ph))}</a></span> <a class="icon-btn sm" style="display:inline-grid;vertical-align:middle" href="${waLink(ph)}" target="_blank" rel="noopener" title="Написать в WhatsApp" aria-label="WhatsApp">${ic('chat','sm')}</a>`}
function copyText(text,okMsg){
  const fb=()=>openModal({render:()=>({title:'Скопируйте данные',sub:'Буфер обмена недоступен в этом окне. Выделите текст и нажмите Ctrl+C, затем вставьте в Excel.',body:`<textarea class="inp mono" id="cp-ta" style="min-height:260px" readonly>${esc(text)}</textarea>`,foot:'<button class="btn cta" data-close>Готово</button>',mount(el){const t=$('#cp-ta',el);t.focus();t.select()}})});
  try{navigator.clipboard.writeText(text).then(()=>toast(okMsg,'copy'),fb)}catch(e){fb()}
}


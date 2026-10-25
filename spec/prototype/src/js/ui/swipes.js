'use strict';
// Свайпы на телефоне: закрытие окон вниз, листание вкладок
/* ═════════════ Swipes (touch only) ═════════════ */
// Rules (ТЗ «Управление свайпами»): 1:1 follow, direction locked after 10 px, fires past a distance threshold or on a flick (≥0.5 px/ms),
// otherwise springs back; the finishing animation keeps the finger's speed.
const RM=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const FLICK=.5,SLOP=10,EASE='cubic-bezier(.2,.6,.35,1)';
function hScrollEl(el,stop){for(let n=el;n&&n!==stop&&n.nodeType===1;n=n.parentElement){if(n.matches('.tabs,.bnav,.scf,input[type=range]'))return true;const ox=getComputedStyle(n).overflowX;if((ox==='auto'||ox==='scroll')&&n.scrollWidth>n.clientWidth+2)return n}return null}
const canScrollX=(n,dx)=>dx<0?n.scrollLeft<n.scrollWidth-n.clientWidth-1:n.scrollLeft>1;
function hScroll(el,stop){for(let n=el;n&&n!==stop&&n.nodeType===1;n=n.parentElement){if(n.matches('.tabs,.bnav,.scf,.gscroll,input[type=range]'))return true;const ox=getComputedStyle(n).overflowX;if((ox==='auto'||ox==='scroll')&&n.scrollWidth>n.clientWidth+2)return true}return false}
function tracker(){const pts=[];return{add(x,y,ts){const t=ts||performance.now();pts.push({x,y,t});while(pts.length>2&&t-pts[0].t>90)pts.shift()},v(){if(pts.length<2)return{x:0,y:0};const a=pts[0],b=pts[pts.length-1];const dt=Math.max(8,b.t-a.t);return{x:(b.x-a.x)/dt,y:(b.y-a.y)/dt}},reset(){pts.length=0}}}
// The ease-out curve starts ~3× faster than its average, so dist/v*3 continues at the release speed.
const finishMs=(dist,v)=>Math.round(Math.max(120,Math.min(320,Math.abs(v)>.05?Math.abs(dist)/Math.abs(v)*3:260)));
const afterAnim=(el,ms,fn)=>{let done=false;const f=()=>{if(done)return;done=true;el.removeEventListener('transitionend',f);fn()};el.addEventListener('transitionend',f);setTimeout(f,ms+60)};
function rgbaA(c,k){const m=c.match(/rgba?\(([^)]+)\)/);if(!m)return c;const p=m[1].split(',').map(x=>x.trim());const a=p.length>3?+p[3]:1;return `rgba(${p[0]},${p[1]},${p[2]},${(a*k).toFixed(3)})`}
// Swipe down closes a sheet/form/popover: from the grabber or header any time, from the content when it is scrolled to the top.
function swipeDown(el,scroller,{can,close,cover,headOnly}){let st=null;const tr=tracker();
  el.addEventListener('touchstart',e=>{st=null;if(e.touches.length>1)return;const t=e.target;const head=t.closest('.grabber,.mh');const sc=scroller();
    if(!head&&(headOnly||sc&&sc.scrollTop>0||t.closest('input,textarea,select')||hScroll(t,el)))return;
    const p=e.touches[0];st={x0:p.clientX,y0:p.clientY,dy:0,mode:null,bg:cover?getComputedStyle(cover).backgroundColor:null};tr.reset();tr.add(p.clientX,p.clientY,e.timeStamp)},{passive:true});
  el.addEventListener('touchmove',e=>{if(!st)return;const p=e.touches[0];tr.add(p.clientX,p.clientY,e.timeStamp);const dx=p.clientX-st.x0,dy=p.clientY-st.y0;
    if(!st.mode){if(Math.abs(dy)<SLOP&&Math.abs(dx)<SLOP)return;st.mode=dy>0&&Math.abs(dy)>Math.abs(dx)?'v':'x';if(st.mode!=='v'){st=null;return}st.y0=p.clientY;el.style.transition='none';el.style.animation='none';if(cover)cover.style.transition='none'}
    e.preventDefault();st.dy=Math.max(0,p.clientY-st.y0);if(RM())return;el.style.transform=`translateY(${st.dy}px)`;
    if(cover)cover.style.backgroundColor=rgbaA(st.bg,1-Math.min(1,st.dy/Math.max(200,el.offsetHeight)))},{passive:false});
  const end=()=>{if(!st||st.mode!=='v'){st=null;return}const v=tr.v().y,dy=st.dy,bg=st.bg;st=null;const thr=Math.min(el.offsetHeight/4,160);
    const fire=(dy>thr&&v>-.1)||(v>FLICK&&dy>SLOP);
    if(fire&&can()){ckHit('swipe');if(RM()){close();return}const rest=Math.max(0,el.getBoundingClientRect().top>innerHeight?0:innerHeight-el.getBoundingClientRect().top);const ms=finishMs(rest,v);
      el.style.transition=`transform ${ms}ms ${EASE}`;el.style.transform=`translateY(${dy+rest}px)`;if(cover){cover.style.transition=`background-color ${ms}ms`;cover.style.backgroundColor=rgbaA(bg,0)}afterAnim(el,ms,()=>{close();if(cover){cover.style.transition='';cover.style.backgroundColor=''}});return}
    el.style.transition=`transform 230ms ${EASE}`;el.style.transform='';if(cover){cover.style.transition='background-color 230ms';cover.style.backgroundColor=''}};
  el.addEventListener('touchend',end);el.addEventListener('touchcancel',()=>{if(st)st.dy=0;end()})}
// Swipe left/right throws a toast away: same thresholds as the tab pager (1/3 of its width or a flick), otherwise springs back.
// The toast sits outside the work area, so the tab pager never sees this gesture.
function swipeAway(el,close){let st=null;const tr=tracker();
  const put=(x,ms)=>{el.style.animation='none';el.style.transition=ms?`transform ${ms}ms ${EASE},opacity ${ms}ms ${EASE}`:'none';el.style.transform=x?`translateX(${x}px)`:'';el.style.opacity=x?String(Math.max(.2,1-Math.abs(x)/(el.offsetWidth*1.2))):''};
  el.addEventListener('touchstart',e=>{st=null;if(e.touches.length>1||e.target.closest('.toast-x'))return;const p=e.touches[0];st={x0:p.clientX,y0:p.clientY,dx:0,mode:null};tr.reset();tr.add(p.clientX,p.clientY,e.timeStamp)},{passive:true});
  el.addEventListener('touchmove',e=>{if(!st)return;const p=e.touches[0];tr.add(p.clientX,p.clientY,e.timeStamp);const dx=p.clientX-st.x0,dy=p.clientY-st.y0;
    if(!st.mode){if(Math.abs(dx)<SLOP&&Math.abs(dy)<SLOP)return;st.mode=Math.abs(dx)>Math.abs(dy)?'x':'y';if(st.mode==='y'){st=null;return}st.x0=p.clientX;el.dragging=true}
    e.preventDefault();e.stopPropagation();st.dx=p.clientX-st.x0;put(st.dx)},{passive:false});
  const end=cancel=>{const s0=st;st=null;if(!s0||s0.mode!=='x')return;el.dragging=false;const W=el.offsetWidth,v=tr.v().x,dx=s0.dx;
    const fire=!cancel&&(Math.abs(dx)>W/3&&v*Math.sign(dx)>-.1||Math.abs(v)>FLICK&&Math.sign(v)===Math.sign(dx)&&Math.abs(dx)>SLOP);
    if(!fire){put(0,RM()?0:230);if(el.later)setTimeout(el.later,RM()?0:240);return}
    const ms=RM()?0:finishMs(W+40-Math.abs(dx),v);if(!ms){close();return}put(Math.sign(dx)*(W+40),ms);afterAnim(el,ms,close)};
  el.addEventListener('touchend',()=>end(false));el.addEventListener('touchcancel',()=>end(true))}
// Swipe left/right inside a form with tabs (contractor, employee card…): same thresholds and paging as module tabs.
function formPager(m){const el=m.el;let st=null;const tr=tracker();
  const parts=()=>{const mb=el.querySelector('.mb');const tb=mb&&mb.querySelector(':scope>.tabs');return tb?{mb,tb,kids:[...mb.children].filter(k=>k!==tb)}:null};
  const slide=(kids,x,ms)=>kids.forEach(k=>{k.style.transition=ms?`transform ${ms}ms ${EASE}`:'none';k.style.transform=x?`translateX(${x}px)`:''});
  el.addEventListener('touchstart',e=>{st=null;if(e.touches.length>1||e.target.closest('input,textarea,select,.grabber,.mh'))return;const q=parts();if(!q)return;
    const hs=hScrollEl(e.target,el);if(hs===true)return;const btns=[...q.tb.querySelectorAll('.tab')];const i=btns.findIndex(b=>b.classList.contains('on'));if(i<0||btns.length<2)return;
    const p=e.touches[0];st={x0:p.clientX,y0:p.clientY,mode:null,dx:0,hs,btns,i,q};tr.reset();tr.add(p.clientX,p.clientY,e.timeStamp)},{passive:true});
  el.addEventListener('touchmove',e=>{if(!st)return;const p=e.touches[0];tr.add(p.clientX,p.clientY,e.timeStamp);const dx=p.clientX-st.x0,dy=p.clientY-st.y0;
    if(!st.mode){if(Math.abs(dx)<SLOP&&Math.abs(dy)<SLOP)return;st.mode=Math.abs(dx)>Math.abs(dy)?'x':'y';if(st.mode==='y'||st.hs&&canScrollX(st.hs,dx)){st=null;return}st.x0=p.clientX;st.dir=dx<0?1:-1}
    e.preventDefault();let d=p.clientX-st.x0;const j=st.i+st.dir;if(j<0||j>=st.btns.length||Math.sign(d)===st.dir)d*=.25;st.dx=d;if(!RM())slide(st.q.kids,d)},{passive:false});
  const end=cancel=>{if(!st||st.mode!=='x'){st=null;return}const s0=st;st=null;const W=el.clientWidth,v=tr.v().x,dx=s0.dx,j=s0.i+s0.dir;
    const fire=!cancel&&j>=0&&j<s0.btns.length&&(((-dx*s0.dir)>W/3&&v*s0.dir<.1)||(-v*s0.dir>FLICK&&-dx*s0.dir>SLOP));
    if(!fire){slide(s0.q.kids,0,RM()?0:230);return}
    const go=()=>{s0.btns[j].click();if(RM())return;const q=parts();if(!q)return;slide(q.kids,s0.dir*W,0);void el.offsetWidth;slide(q.kids,0,ms)};
    ckHit('swipe');const ms=RM()?0:finishMs(W-Math.abs(dx),v);if(!ms){go();return}slide(s0.q.kids,-s0.dir*W,ms);afterAnim(s0.q.kids[0]||el,ms,go)};
  el.addEventListener('touchend',()=>end(false));el.addEventListener('touchcancel',()=>end(true))}
// Swipe left/right on the work area pages between module tabs: the current tab slides with the finger and the neighbour slides in.
const TAB_SCROLL={};
(function pager(){const pane=$('#pane');let st=null;const tr=tracker();
  const kids=pg=>[...pg.children].filter(k=>!k.classList.contains('tabrow'));
  function renderNeighbour(tabId){const cur=$('#page');const ids=[...cur.querySelectorAll('[id]')];ids.forEach(x=>x.id+='__o');cur.id='page__o';
    const nb=document.createElement('div');nb.className='page pg-nb';nb.id='page';pane.appendChild(nb);const top=pane.scrollTop,keep=S.tab;S.tab=tabId;
    const ttl=()=>[['#tb-tab','textContent'],['#q-scope','textContent'],['#tb-title','title']].map(([q,k])=>[$(q),k,$(q)[k]]);const was=ttl();
    try{renderPage(false)}finally{S.tab=keep}pane.scrollTop=top;nb._ttl=ttl();was.forEach(([e,k,v])=>e[k]=v);
    nb.querySelectorAll('[id]').forEach(x=>x.id+='__n');nb.id='page__n';cur.id='page';ids.forEach(x=>x.id=x.id.slice(0,-3));
    const saved=Math.max(0,Math.min(TAB_SCROLL[S.mod+'.'+tabId]||0,nb.offsetHeight-pane.clientHeight));nb.dataset.sv=saved;nb.style.top=(top-saved)+'px';return nb}
  function ghostAt(p){const g=st.ghost;if(!g)return;const a=st.ta,b=st.tb||st.ta;g.style.left=(a.offsetLeft+(b.offsetLeft-a.offsetLeft)*p)+'px';g.style.width=(a.offsetWidth+(b.offsetWidth-a.offsetWidth)*p)+'px'}
  function paint(dx,anim,ms){const W=pane.clientWidth;const t=anim?`transform ${ms}ms ${EASE}`:'none';
    st.cur.forEach(k=>{k.style.transition=t;k.style.transform=dx?`translateX(${dx}px)`:''});
    if(st.nb){st.nb.style.transition=t;st.nb.style.transform=`translateX(${dx+st.dir*W}px)`}
    if(st.ghost){st.ghost.style.transition=anim?`left ${ms}ms ${EASE},width ${ms}ms ${EASE}`:'none';ghostAt(st.nb?Math.min(1,Math.max(0,-dx*st.dir/W)):0)}}
  function begin(dir){const tabs=$('#tabs');pane.classList.add('paging');st.cur=kids($('#page'));st.cur.forEach(k=>k.style.willChange='transform');
    if(tabs){tabs.classList.add('swiping');st.ta=$('.tab.on',tabs);const g=document.createElement('span');g.className='tab-ghost';tabs.appendChild(g);st.ghost=st.ta?g:null;if(!st.ta)g.remove()}
    const j=st.i+dir;if(j>=0&&j<st.tabs.length){st.dir=dir;st.to=st.tabs[j].id;st.nb=renderNeighbour(st.to);st.tb=tabs&&$(`.tab[href$=".${st.to}"]`,tabs)}}
  function cleanup(){pane.classList.remove('paging');(st.cur||[]).forEach(k=>{k.style.transition='';k.style.transform='';k.style.willChange=''});const tabs=$('#tabs');if(tabs)tabs.classList.remove('swiping');if(st.ghost)st.ghost.remove()}
  pane.addEventListener('touchstart',e=>{st=null;if(MODALS.length||POP||TOUR.on||$('#sheet').classList.contains('open')||e.touches.length>1)return;const p=e.touches[0];
    const hs=hScrollEl(e.target,pane);if(p.clientX<20||hs===true)return;const tabs=modTabs(curMod());const i=tabs.findIndex(x=>x.id===S.tab);if(i<0||tabs.length<2)return;
    st={x0:p.clientX,y0:p.clientY,mode:null,tabs,i,dx:0,dir:0,hs};tr.reset();tr.add(p.clientX,p.clientY,e.timeStamp)},{passive:true});
  pane.addEventListener('touchmove',e=>{if(!st)return;const p=e.touches[0];tr.add(p.clientX,p.clientY,e.timeStamp);const dx=p.clientX-st.x0,dy=p.clientY-st.y0;
    if(!st.mode){if(Math.abs(dx)<SLOP&&Math.abs(dy)<SLOP)return;st.mode=Math.abs(dx)>Math.abs(dy)?'x':'y';if(st.mode==='y'||st.hs&&canScrollX(st.hs,dx)){st=null;return}st.x0=p.clientX;begin(dx<0?1:-1)}
    e.preventDefault();let d=p.clientX-st.x0;if(!st.nb||Math.sign(d)===st.dir)d*=.25;st.dx=d;if(!RM())paint(d,false)},{passive:false});
  function end(cancel){if(!st||st.mode!=='x'){st=null;return}const W=pane.clientWidth,v=tr.v().x,dx=st.dx;
    const fire=!cancel&&st.nb&&(((-dx*st.dir)>W/3&&v*st.dir<.1)||(-v*st.dir>FLICK&&-dx*st.dir>SLOP));
    if(fire)ckHit('swipe');const target=fire?-st.dir*W:0;const ms=RM()?0:fire?finishMs(W-Math.abs(dx),v):230;const s0=st;
    if(ms)paint(target,true,ms);
    const finish=()=>{st=s0;if(fire){const pane=$('#pane');const old=$('#page');TAB_SCROLL[S.mod+'.'+S.tab]=pane.scrollTop;cleanup();old.remove();const nb=st.nb;
        nb.querySelectorAll('[id]').forEach(x=>{if(x.id.endsWith('__n'))x.id=x.id.slice(0,-3)});nb.id='page';const sv=+nb.dataset.sv||0;nb.classList.remove('pg-nb');nb.removeAttribute('style');delete nb.dataset.sv;
        S.tab=st.to;(nb._ttl||[]).forEach(([e,k,v])=>e[k]=v);history.replaceState(null,'','#'+S.mod+'.'+S.tab);pane.scrollTop=sv;fitTabs()}
      else{cleanup();if(st.nb){st.nb.remove();renderPage(false)}}st=null};
    if(ms)afterAnim(st.cur[0]||pane,ms,finish);else finish();st=null}
  pane.addEventListener('touchend',()=>end(false));pane.addEventListener('touchcancel',()=>end(true))})();


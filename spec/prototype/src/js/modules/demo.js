'use strict';
// Демо-организация: кнопка «Посмотреть на демо-организацию» на лендинге (ТЗ «Лендинг» → «Демо-организация», решение заказчика 01.11.2026)
/* ═════════════ Демо-организация ═════════════ */
/* В прототипе кнопка открывает программу демо-организации от лица владельца с полосой «Демо-версия…»; «Вернуться на сайт» и «Оставить заявку» ведут на лендинг.
   Демо-версия для сайта (buhuchet.kg/demo) — тот же файл, собранный с признаком BU_DEMO (python3 build.py → dist/demo.html):
   сразу программа без экрана входа и без Админки, свои ключи хранилища браузера (budemo.*), исходящие запросы запрещены (Content-Security-Policy: connect-src 'none'),
   «Оставить заявку» и «Вернуться на сайт» переходят на страницы сайта из BU_DEMO.lead и BU_DEMO.site. */
const DEMO={build:typeof BU_DEMO!=='undefined'&&!!BU_DEMO,on:false,ro:null};
DEMO.on=DEMO.build;
const demoOwner=()=>EMP.find(e=>e.role==='owner'&&e.active!==false)||EMP.find(e=>e.active!==false)||EMP[0];
function demoStrip(){let el=$('#demo-strip');if(!DEMO.on){if(el)el.remove();document.documentElement.style.removeProperty('--demo-h');if(DEMO.ro){DEMO.ro.disconnect();DEMO.ro=null}return}
  const t=LT('land.demo.strip'),i=t.indexOf(':'),a=i>0?t.slice(0,i):t,b=i>0?t.slice(i):'';
  if(!el){el=document.createElement('div');el.id='demo-strip';el.className='demo-strip';el.setAttribute('role','region');el.setAttribute('aria-label',a);document.body.prepend(el)}
  el.innerHTML=`<span class="ds-t">${ic('eye','sm')}<span><b>${esc(a)}</b><span class="ds-sub">${esc(b)}</span></span></span><span class="ds-r"><button type="button" class="btn sm cta" data-demo-lead>${LE('land.btn.lead')}</button><button type="button" class="btn sm" data-demo-back>${LE('land.demo.back')}</button></span>`;
  const set=()=>document.documentElement.style.setProperty('--demo-h',el.offsetHeight+'px');set();
  if(!DEMO.ro&&'ResizeObserver' in window){DEMO.ro=new ResizeObserver(set);DEMO.ro.observe(el)}}
function demoOn(){DEMO.on=true;document.body.classList.add('demo-on');demoStrip()}
function demoOff(){if(DEMO.build||!DEMO.on)return;DEMO.on=false;document.body.classList.remove('demo-on');demoStrip();renderSide()}
// Прототип: лендинг → программа демо-организации от лица владельца
function demoOpen(){if(DEMO.build)return;
  const run=()=>{landHide();const lg=$('#login');if(lg)lg.remove();S.loggedIn=true;demoOn();const o=demoOwner();
    if(S.me!==o.id)switchUser(o.id);else{MODALS.slice().forEach(m=>m.close());location.hash='#home';renderSide()}buIntro()};
  if(DATA_MODE==='empty')return confirmDlg({title:'Включить демо-данные?',text:'Демо-организация открывается на демо-данных (demoDB.json). Данные пустой организации в прототипе пропадут.',ok:'Включить',run:()=>{setDataMode('demo');run()}});
  run()}
// «Вернуться на сайт» и «Оставить заявку»: в демо-версии для сайта — переход на страницу сайта, в прототипе — лендинг
function demoExit(to){if(DEMO.build){location.href=to==='lead'?BU_DEMO.lead:BU_DEMO.site;return}location.hash=to==='lead'?'#landing/lead':'#landing'}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-demo-lead],[data-demo-back]');if(!b)return;e.preventDefault();demoExit(b.hasAttribute('data-demo-lead')?'lead':'site')});
if(DEMO.build){document.body.classList.add('demo-on');addEventListener('DOMContentLoaded',()=>{demoStrip();const b=document.getElementById('demo-boot');if(b)b.remove()})}

'use strict';
// Страница контрагента по ссылке (v56, решение заказчика 24.10.2026): www.buhuchet.kg/<адрес организации>/inn/<ИНН>, вход по коду из 6 цифр.
// С 14.11.2026 (блок 6) клиент на странице не только смотрит: отправляет файлы и сообщает об оплате с чеком (cp-sent.js, cp-paid.js)
/* ═════════════ Страница контрагента по ссылке ═════════════ */
// Разделы страницы: [ключ, название, функция учётной политики, без которой раздела нет]; «Главное» и «Ваш бухгалтер» показываются всегда
// Названия — как части страницы видит контрагент (17.11.2026): «Куда переводить» и «Деньги на налоги» — строка «Налоги» в «Оплате», «Услуги бухгалтера» — вторая строка «Оплаты»,
// «Контакты» и «Telegram» — в «Связи», «Цифры компании» — бывшие «Показатели»
const PG_SECS=[['pay','Куда переводить'],['reports','Отчёты'],['files','Файлы'],['money','Деньги на налоги','taxpay'],['fee','Услуги бухгалтера','fee'],['kpi','Цифры компании','indicators'],['contacts','Контакты'],['tg','Telegram']];
// Верный код запоминается в браузере на 1 день с момента ввода (решение заказчика 14.11.2026; было 30 дней) — только у страницы контрагента, вход сотрудников не меняется
const PG_TRY=5,PG_LOCK=15*60e3,PG_KEEP=864e5;
// Кроме 5 неверных подряд — не больше 5 неверных кодов за сутки по одной ссылке с любых адресов: пятый закрывает страницу до «Сменить код» или «Выключить» и «Включить» (решение заказчика 07.11.2026). Счёт идёт по коду (p.day — время неверных вводов), верный код между неверными его не сбрасывает; закрытая страница не открывается никому, в том числе в браузерах с запомненным кодом
const PG_DAY=5,PG_DAYMS=864e5;
const pgDay=p=>{const now=Date.now();p.day=(p.day||[]).filter(t=>now-t<PG_DAYMS);return p.day};
// Ответственному за контрагента — «Telegram: страница контрагента закрыта»; нет ответственного, он заблокирован или без Telegram — первому владельцу организации с Telegram. Приходит и при выключенных напоминаниях
function pgClosedNotify(c){bellCp(c,{kind:'other',ev:'page_closed',open:{k:'contractor',id:c.id},text:`Страница закрыта: ${PG_DAY} неверных кодов за сутки, откроется после смены кода`,key:'page_closed:'+c.id+':'+TODAY});const r=EM[c.resp],to=r&&r.active!==false&&r.tg?r:EMP.find(e=>e.role==='owner'&&e.active!==false&&e.tg);if(to)tgSvc(to,'Страница контрагента закрыта')}
const pgPath=c=>`${ORG.slug}/inn/${c.inn}`;
const pgUrl=c=>'www.buhuchet.kg/'+pgPath(c);
const pgCodeTxt=k=>k?k.slice(0,3)+' '+k.slice(3):'';
const pgSecOrg=s=>(!s[2]||feat(s[2]))&&(ORG.pageSec||[]).includes(s[0]);
const pgSecs=c=>PG_SECS.filter(s=>pgSecOrg(s)&&!((c.page||{}).hide||[]).includes(s[0])).map(s=>s[0]);
const pgOn=c=>feat('cppage')&&!c.archived&&!!(c.page&&c.page.on);
// Копировать и отправить включённую ссылку может и ответственный бухгалтер без права «Управлять страницей контрагента»
const pgSendWhy=c=>can('cpPage')||c.resp===S.me?'':'Отправлять ссылку может ответственный бухгалтер или сотрудник с правом «Управлять страницей контрагента»';
// Код страницы — только из криптографически стойкого генератора, без запасного Math.random (замечание CodeQL, решение заказчика 20.11.2026)
function pgNewCode(){return String(crypto.getRandomValues(new Uint32Array(1))[0]%1e6).padStart(6,'0')}
// Блок «Страница контрагента» на вкладке «Основное» карточки
function pgBox(c){if(!feat('cppage'))return '';const p=c.page||{},on=pgOn(c),why=c.archived?'Контрагент в архиве: страница выключена':can('cpPage')?'':'Нужно право «Управлять страницей контрагента»',sw=pgSendWhy(c);
  const btn=(k,icon,l,w,cls='')=>`<button type="button" class="btn sm ${cls} ${w?'dis':''}" data-pg="${k}" ${w?`aria-disabled="true" data-why="${esc(w)}" title="${esc(w)}"`:`title="${esc(l)}"`} aria-label="${esc(l)}">${ic(icon,'sm')}<span class="bl">${esc(l)}</span></button>`;
  const secs=PG_SECS.filter(pgSecOrg);
  return `<div class="box cp-page" id="cp-page"><h3>Страница контрагента<span class="grow"></span>${on?pill('Включена',{Включена:['green','check']}):pill('Выключена',{Выключена:['gray','ban']})}</h3>
    ${on?`<div class="kv"><div><span class="k">Ссылка</span><span class="v"><a class="mono pg-link" href="#/${esc(pgPath(c))}" title="Открыть страницу так, как её увидит контрагент">${esc(pgUrl(c))}</a></span></div>
      <div><span class="k">Код доступа</span><span class="v"><button type="button" class="pg-code mono strong" data-pg="codecopy" title="Нажмите, чтобы скопировать код" aria-label="Код доступа ${esc(pgCodeTxt(p.code))}: скопировать">${pgCodeTxt(p.code)}${ic('copy','sm')}</button></span></div>
      <div><span class="k">Последнее открытие</span><span class="v">${p.last?`${fmtDT(p.last)}${p.lastDev?` <span class="hint">· ${esc(p.lastDev)}</span>`:''}`:'<span class="faint">контрагент ещё не открывал</span>'}</span></div>
      ${secs.length?`<div class="pg-secs-row"><span class="k">Разделы страницы</span><span class="v"><span class="pg-secs">${secs.map(([k,l])=>`<label class="row"><input type="checkbox" data-pg-sec="${k}" ${(p.hide||[]).includes(k)?'':'checked'} ${why?'disabled':''}> ${esc(l)}</label>`).join('')}</span><span class="hint">«Связь» с бухгалтером видна всегда. Разделы для всех контрагентов — в учётной политике</span></span></div>`:''}
      ${secs.some(s=>s[0]==='files')?`<div class="pg-secs-row"><span class="k">Файлы от контрагента</span><span class="v"><label class="row"><input type="checkbox" data-pg-up ${!p.noUp&&ORG.cpUpload!==false?'checked':''} ${why||ORG.cpUpload===false?'disabled':''}> Контрагент может отправлять файлы</label><span class="hint">${ORG.cpUpload===false?'Выключено для всех контрагентов в учётной политике':'Кнопка «Отправить файл» в разделе «Файлы» страницы и приём файлов в Telegram'}</span></span></div>`:''}</div>`
    :`<span class="hint">${c.archived?'Контрагент в архиве — страница выключена.':'Контрагент откроет по ссылке и коду из 6 цифр свои отчёты, показатели и оплату за обслуживание — только для просмотра, без входа в программу.'}</span>`}
    ${pgTgBox(c)}
    ${on&&p.closed?`<div class="note bad">${ic('lock','sm')}<span>Страница закрыта: за сутки было 5 неверных кодов. Нажмите «Сменить код» (нет права — попросите владельца или главного бухгалтера) и отправьте контрагенту новый код.</span></div>`:''}
    <div class="row acts">${on?`${btn('copy','copy','Скопировать ссылку',sw)}${btn('wa','chat','Отправить в WhatsApp',sw)}<div class="grow"></div>${btn('code','refresh','Сменить код',why)}${btn('off','ban','Выключить',why)}`:c.archived?'':`<div class="grow"></div>${btn('on','link','Включить',why,'cta')}`}</div></div>`}
function pgMount(el,c,redraw){const b=$('#cp-page',el);if(!b)return;
  b.onclick=e=>{const t=e.target.closest('[data-pg-tg]');if(t)return pgTgBoxClick(c,t,redraw);const x=e.target.closest('[data-pg]');if(!x)return;if(x.dataset.why){toast(x.dataset.why,'lock',true);return}const k=x.dataset.pg;
    if(k==='on')pgEnable([c],redraw);else if(k==='off')pgOffDlg(c,redraw);else if(k==='code')pgCodeDlg(c,redraw);
    else if(k==='codecopy'){copyText(c.page.code,`Код ${pgCodeTxt(c.page.code)} скопирован`,true);log('cp',c.id,'Скопирован код доступа страницы контрагента',c.id)}
    else if(k==='copy'){copyText('https://'+pgUrl(c),'Ссылка скопирована',true);log('cp',c.id,'Скопирована ссылка на страницу контрагента',c.id)}else if(k==='wa')waDlg({cp:c,page:true})};
  b.onchange=e=>{const u=e.target.closest('[data-pg-up]');if(u){c.page.noUp=!u.checked;log('cp',c.id,`Контрагент может отправлять файлы: ${u.checked?'включено':'выключено'}`,c.id);toast(u.checked?'Контрагент может отправлять файлы':'Контрагент не может отправлять файлы');return}
    const x=e.target.closest('[data-pg-sec]');if(!x)return;const k=x.dataset.pgSec,p=c.page,h=new Set(p.hide||[]);x.checked?h.delete(k):h.add(k);p.hide=[...h];
    log('cp',c.id,`Страница контрагента: раздел «${PG_SECS.find(s=>s[0]===k)[1]}» ${x.checked?'показывается':'скрыт'}`,c.id);toast(x.checked?'Раздел показывается на странице':'Раздел скрыт на странице')}}
// Включить — у каждого свой код; уже включённые и архивные пропускаются
function pgEnable(cs,done){const a=cs.filter(c=>!c.archived&&!(c.page&&c.page.on)),skip=cs.length-a.length;
  if(!a.length){toast(cs.length>1?'У выбранных контрагентов страница уже включена или они в архиве':'Страница уже включена','info');return}
  const run=()=>{a.forEach(c=>{const p=c.page||{};c.page={on:true,code:pgNewCode(),at:nowStamp(),by:S.me,codeAt:nowStamp(),hide:p.hide||[],...(p.noUp?{noUp:true}:{}),last:null,lastDev:'',fails:0,lock:0};log('cp',c.id,'Страница контрагента включена: создан код доступа',c.id)});
    done&&done();refreshAll();ckHit('cppage');
    toast(a.length>1?`Страница включена у ${a.length} ${plural(a.length,'контрагента','контрагентов','контрагентов')}, у каждого свой код${skip?`. Пропущено: ${skip} — уже включена или в архиве`:''}`:`Страница включена. Код доступа: ${pgCodeTxt(a[0].page.code)}`,'link')};
  if(a.length>1)confirmDlg({title:`Включить страницу у ${a.length} ${plural(a.length,'контрагента','контрагентов','контрагентов')}?`,text:`У каждого появится своя ссылка и свой код из 6 цифр. Отправить их контрагенту можно из его карточки: «Основное» → «Страница контрагента» → «Отправить в WhatsApp».${skip?` Пропущено: ${skip} — страница уже включена или контрагент в архиве.`:''}`,ok:'Включить',run});else run()}
function pgOff(c,why){if(!c.page||!c.page.on)return;c.page.on=false;c.page.offAt=nowStamp();log('cp',c.id,'Страница контрагента выключена'+(why?': '+why:''),c.id)}
function pgOffDlg(c,done){confirmDlg({title:'Выключить страницу контрагента?',text:'Ссылка перестанет открываться: контрагент увидит «Страница недоступна. Обратитесь к вашему бухгалтеру». Включить можно снова — с новым кодом.',ok:'Выключить',danger:true,run:()=>{pgOff(c,'');done&&done();refreshAll();toast('Страница выключена','ban')}})}
function pgCodeDlg(c,done){confirmDlg({title:'Сменить код доступа?',text:'Старый код перестанет действовать сразу, в том числе в браузерах, где он запомнен. Новый код нужно будет отправить контрагенту.',ok:'Сменить код',run:()=>{
  Object.assign(c.page,{code:pgNewCode(),codeAt:nowStamp(),fails:0,lock:0,day:[],closed:null});log('cp',c.id,'Код доступа страницы контрагента изменён',c.id);done&&done();refreshAll();toast(`Новый код: ${pgCodeTxt(c.page.code)}. Отправьте его контрагенту`,'link')}})}

/* Сама страница — как её откроет контрагент по ссылке. В прототипе открывается поверх программы по адресу #/<адрес организации>/inn/<ИНН> */
const PUB={back:'',open:null};
// Состояние просмотра: годы «Отчётов» и «Цифр компании», фильтр и вид «Отчётов» (по умолчанию «По месяцам»), раскрытые плитки, раскрытые на телефоне разделы
// po — раскрытые строки «Оплаты» (null — раскрыта та, по которой есть долг), det — раскрытые «Из чего сумма», «За год», «История оплат», ft — вкладка «Файлов»
const pubReset=()=>Object.assign(PUB,{y:null,ky:null,lateY:null,f:'',mode:'month',rt:new Set(),rm:null,ki:new Set(),unf:new Set(),ff:'',fq:'',fl:[],hq:null,wel:false,po:null,det:new Set(),ft:''});
const pgMem=()=>{const m=store.get('pgmem',{});return m&&typeof m==='object'?m:{}};
const pgDev=()=>{const u=navigator.userAgent||'';const b=/Edg\//.test(u)?'Edge':/OPR\/|Opera/.test(u)?'Opera':/YaBrowser/.test(u)?'Яндекс Браузер':/Firefox\//.test(u)?'Firefox':/Chrome\//.test(u)?'Chrome':/Safari\//.test(u)?'Safari':'браузер';return (/Mobi|Android|iPhone|iPad/.test(u)||isMobile()?'Телефон':'ПК')+' · '+b};
const pgHm=ms=>new Date(ms).toLocaleTimeString('ru-RU',{timeZone:'Asia/Bishkek',hour:'2-digit',minute:'2-digit'});
function pubRoute(){const m=location.hash.match(/^#\/([^/]+)\/inn\/(\d+)\/?$/);if(!m)return false;pubShow(decodeURIComponent(m[1]),m[2]);return true}
function pubShow(slug,inn){let el=$('#pub');if(!el){el=document.createElement('div');el.id='pub';el.className='pub';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Страница контрагента');document.body.append(el)}
  if(!PUB.open)PUB.back=S.mod?'#'+S.mod+(S.tab?'.'+S.tab:''):'#home';PUB.open={slug,inn,logged:false};pubReset();el.hidden=false;document.body.classList.add('pub-on');pubDraw()}
function pubHide(){if(CPHT.on)cphTourEnd(false,true);if(PUB.io){PUB.io.disconnect();PUB.io=null}const el=$('#pub');if(el)el.hidden=true;document.body.classList.remove('pub-on');PUB.open=null}
function pubClose(){const b=PUB.back||'#home';pubHide();PUB.back='';if(location.hash!==b)location.hash=b;else route();refreshAll()}
// Выключенная страница, неизвестный ИНН, архивный контрагент и чужой адрес организации — одна и та же страница без данных
const pubCp=({slug,inn})=>feat('cppage')&&slug===ORG.slug?CPS.find(c=>c.inn===inn&&pgOn(c))||null:null;
// «Забыли код?» (блок 6, пункт 6, cp-paid.js): ответ — строкой под ссылкой
const pubForgotHtml=()=>`<button type="button" class="linkbtn pub-fg" id="pub-fg">${ic('send','sm')}Забыли код?</button><span class="hint pub-fgm" id="pub-fgm" role="status" hidden></span>`;
// Над экраном кода — логотип и название бухгалтерской фирмы: клиент знает её, а не платформу; страница без данных — знак платформы
const pubBrand=c=>c?`<div class="pub-brand pub-org">${ORG.logo?`<img src="${ORG.logo}" alt="" class="pub-logo">`:`<span class="pub-logo">${esc(initials(ORG.name.replace(/^(ОсОО|ИП|ОАО|ЗАО)\s+/,'').replace(/[«»"]/g,'')))}</span>`}<b>${esc(ORG.name)}</b></div>`:`<div class="pub-brand">${ic('book')}<b>Buhuchet.kg</b></div>`;
// keep — перерисовка той же страницы: прокрутка остаётся на месте
function pubDraw(keep){const el=$('#pub');if(!el||!PUB.open)return;const o=PUB.open,c=pubCp(o),sc=$('.pub-page',el),top=keep&&sc?sc.scrollTop:0;
  const bar=`<div class="pub-bar"><span class="pub-proto">${ic('eye','sm')}<span>Прототип: страница, которую контрагент откроет по ссылке</span></span><span class="pub-url">${ic('lock','sm')}<span class="mono">www.buhuchet.kg/${esc(o.slug)}/inn/${esc(o.inn)}</span></span><button type="button" class="btn sm" id="pub-x">${ic('x','sm')}Вернуться в программу</button></div>`;
  const brand=pubBrand(c);
  let main,inside=false;
  if(!c)main=`<div class="pub-gate">${brand}<h1>Страница недоступна</h1><p class="muted">Обратитесь к вашему бухгалтеру.</p></div>`;
  else{const p=c.page,mem=pgMem()[o.slug+'|'+o.inn];
    if(p.closed)main=`<div class="pub-gate">${brand}<h1>Страница закрыта</h1><p class="muted">Было ${PG_DAY} неверных кодов за сутки. Попросите новый код у вашего бухгалтера.</p></div>`;
    else if(mem&&mem.code===p.code&&mem.until>Date.now()){main=pubBody(c);inside=true}
    else if(p.lock>Date.now())main=`<div class="pub-gate">${brand}<h1>Ввод кода временно закрыт</h1><p class="muted">Было ${PG_TRY} неверных кодов подряд. Попробуйте снова после ${pgHm(p.lock)} или попросите код у вашего бухгалтера.</p>${pubForgotHtml()}</div>`;
    // Экран кода (17.11.2026, «Меньше текста», п. 6): заголовок, одна строка, поле, «Открыть», «Забыли код?» и «Что это за страница?» — «код запоминается на 1 день» там же
    else main=`<form class="pub-gate" id="pub-f" autocomplete="off">${brand}<h1>Введите код</h1><p class="muted">6 цифр из сообщения бухгалтера</p>${fld('',`<input class="inp mono pub-code" id="pub-k" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-label="Код доступа">`,{id:'pub-k',full:true})}<button type="submit" class="btn cta" id="pub-ok">Открыть</button>${pubForgotHtml()}${cphCodeWhat()}</form>`}
  // Внизу страницы — когда показаны данные («Обновлено …»); на экранах кода и отказа сноски нет
  el.innerHTML=bar+`<div class="pub-page">${main}${inside?`<footer class="pub-foot">Обновлено ${pubDW(TODAY)}, ${bishkekNow().hm}</footer>`:''}</div>${inside?cphWelcomeBar(c):''}`;
  if(top)$('.pub-page',el).scrollTop=top;
  $('#pub-x',el).onclick=pubClose;cphCodeMount(el);
  const fg=$('#pub-fg',el);if(fg)fg.onclick=()=>{const r=pubForgot(c),o=$('#pub-fgm',el);o.hidden=false;o.className='hint pub-fgm'+(r.ok?' ok':'');
    o.innerHTML=esc(r.t)+(r.ok?` <button type="button" class="linkbtn" id="pub-fgd">${ic('eye','sm')}В макете: сообщение в Telegram</button>`:'');const d=$('#pub-fgd',el);if(d)d.onclick=()=>pgCodeDemo(c,r.to[0])};
  if(c&&c.page.on&&$('.pub-body',el)&&!o.logged){o.logged=true;pubSeen(c)}
  const f=$('#pub-f',el);if(f){const k=$('#pub-k',f);setTimeout(()=>k.focus(),30);k.oninput=()=>{k.value=k.value.replace(/\D/g,'').slice(0,6);setErr(f,'pub-k','')};
    f.onsubmit=e=>{e.preventDefault();const p=c.page,v=k.value.trim();if(!/^\d{6}$/.test(v)){setErr(f,'pub-k','Введите 6 цифр');return}
      if(v!==p.code){p.fails=(p.fails||0)+1;const d=pgDay(p);d.push(Date.now());
        if(d.length>=PG_DAY){p.fails=0;p.closed=nowStamp();HIST.push({at:nowStamp(),who:'client',ent:'cp',id:c.id,cp:c.id,what:`Страница контрагента: ${PG_DAY} неверных кодов за сутки, страница закрыта до смены кода`});pgClosedNotify(c);dbSoon();pubDraw();return}
        if(p.fails>=PG_TRY){p.fails=0;p.lock=Date.now()+PG_LOCK;HIST.push({at:nowStamp(),who:'client',ent:'cp',id:c.id,cp:c.id,what:`Страница контрагента: ${PG_TRY} неверных кодов подряд, ввод закрыт на 15 минут`});dbSoon();pubDraw();return}
        dbSoon();setErr(f,'pub-k',`Неверный код. Осталось попыток: ${Math.min(PG_TRY-p.fails,PG_DAY-pgDay(p).length)}`);k.select();return}
      p.fails=0;const m=pgMem();m[o.slug+'|'+o.inn]={code:p.code,until:Date.now()+PG_KEEP};store.set('pgmem',m);pubDraw()}}
  const b=$('.pub-body',el);if(b)b.onclick=pubClick;
  if(b&&c){pubBind(el);cphGloss(b);cphMount(el,c);cphWelcomeMount(el,c);const pg=$('.pub-page',el);pg.onscroll=()=>{cancelAnimationFrame(PUB.nr);PUB.nr=requestAnimationFrame(pubNavMark)};pubNavMark()}}
// Поля раздела, которые живут своими обработчиками: год «Отчётов» и «Цифр компании», поиск в «Файлах»; после перерисовки одного раздела — снова
function pubBind(el){const y=$('#pub-y',el);if(y)y.onchange=()=>{PUB.y=y.value;PUB.rm=null;pubSecDraw('reports')};const ky=$('#pub-ky',el);if(ky)ky.onchange=()=>{PUB.ky=ky.value;pubSecDraw('kpi')};
  const fq=$('#pub-fq',el);if(fq){fq.oninput=()=>{PUB.fq=fq.value;pubFq(el)};pubFq(el)}}
// Смена года, вида, фильтра и вкладки меняет только свой раздел и проявляет его список (было: перерисовка всей страницы одним кадром)
function pubSecDraw(k){const el=$('#pub'),c=PUB.open&&pubCp(PUB.open),old=el&&$(`#pub .pub-s[data-sec="${k}"]`);if(!c||!old){pubDraw(true);return}
  const tmp=document.createElement('div');tmp.innerHTML=pubBody(c);cphGloss(tmp);const n=$(`.pub-s[data-sec="${k}"]`,tmp);if(!n){pubDraw(true);return}
  old.replaceWith(n);$$('.pub-fade',n).forEach(x=>x.classList.add('in'));pubBind(n)}
// Поиск по названию в «Файлах»: строки скрываются на месте, поле не теряет фокус; при поиске список показывается целиком
function pubFq(el){const q=norm(PUB.fq||'').trim(),l=$('.pub-fl',el);if(!l)return;let n=0;$$('[data-pub-fo]',l).forEach(r=>{const on=!q||r.dataset.n.includes(q);r.hidden=!on;if(on)n++});
  l.classList.toggle('all',!!q);const mb=$('.pub-more',l);if(mb)mb.hidden=!!q;const no=$('.pub-fnone',el);if(no)no.hidden=!!n}
// Каждое открытие — в историю контрагента: дата, время, устройство
// Обновление страницы в том же браузере в течение минуты новым открытием не считается (решение заказчика 30.10.2026, Е-3)
function pubSeen(c){const k=PUB.open.slug+'|'+PUB.open.inn,sn=store.get('pgseen',{})||{},now=Date.now();if(sn[k]&&now-sn[k]<60e3)return;sn[k]=now;store.set('pgseen',sn);const d=pgDev();Object.assign(c.page,{last:nowStamp(),lastDev:d});HIST.push({at:nowStamp(),who:'client',ent:'cp',id:c.id,cp:c.id,what:`Страница контрагента открыта: ${d}`});dbSoon()}
// Нажатия на странице: «Оплатить» — окно оплаты; строки «Оплаты», «Из чего сумма», виды, месяцы и цифры раскрываются; чипы — фильтр «Отчётов» и «Файлов»; нижнее меню — к разделу
function pubClick(e){const x=e.target.closest('[data-pub-gl],[data-pub-tgon],[data-pub-go],[data-pub-tg],[data-pub-f],[data-pub-rt],[data-pub-rm],[data-pub-ki],[data-pub-more],[data-pub-copy],[data-pub-ff],[data-pub-fo],[data-pub-up],[data-pub-paid],[data-pub-send],[data-pub-pay],[data-pub-po],[data-pub-det],[data-pub-ft],[data-pub-vm],[data-pub-nav],[data-pub-file]');if(!x)return;const d=x.dataset,c=pubCp(PUB.open);
  if(d.pubGl!=null){cphGlossPop(x);return}
  if(d.pubUp!=null){if(c)pubUpDlg(c);return}
  if(d.pubPaid){if(c)pubPaidDlg(c,d.pubPaid);return}
  if(d.pubPay){if(c)pubPayDlg(c,d.pubPay);return}
  if(d.pubSend){if(c)pubPayDlg(c,'tax',d.pubSend);return}
  if(d.pubTgon!=null){if(d.why)toast(d.why,'lock',true);else if(c)pgTgDlg(c);return}
  if(d.pubFile!=null){e.preventDefault();const l=$$('[data-pub-file]',x.parentElement);pubFileOpen(l.map(a=>({name:a.dataset.pubFile})),l.indexOf(x));return}
  if(d.pubFo!=null){const l=$$('[data-pub-fo]',x.parentElement).filter(r=>!r.hidden);pubFileOpen(l.map(r=>PUB.fl[+r.dataset.pubFo]),l.indexOf(x));return}
  if(d.pubFf!=null){PUB.ff=PUB.ff===d.pubFf?'':d.pubFf;pubSecDraw('files');return}
  if(d.pubFt){if(PUB.ft!==d.pubFt){PUB.ft=d.pubFt;pubSecDraw('files')}return}
  if(d.pubCopy!=null){copyText(d.pubCopy,d.pubOk||'Скопировано',true);return}
  if(d.pubMore!=null){x.parentElement.classList.add('all');x.remove();return}
  if(d.pubTg){if(isMobile())pubFold(d.pubTg,!PUB.unf.has(d.pubTg));return}
  if(d.pubNav){pubNav(d.pubNav,c);return}
  if(d.pubGo){pubGo(d.pubGo,d.pubFl);return}
  if(d.pubF!=null){PUB.f=PUB.f===d.pubF?'':d.pubF;PUB.rm=null;pubSecDraw('reports');return}
  if(d.pubVm!=null){pubViewMenu(x);return}
  const flip=(set,k)=>{const on=!set.has(k);on?set.add(k):set.delete(k);x.parentElement.classList.toggle('open',on);x.setAttribute('aria-expanded',on)};
  if(d.pubPo){if(!PUB.po)PUB.po=new Set($$('#pub .pub-po.open').map(r=>r.dataset.po));flip(PUB.po,d.pubPo)}
  else if(d.pubDet)flip(PUB.det,d.pubDet);
  else if(d.pubRt)flip(PUB.rt,d.pubRt);else if(d.pubRm){if(!PUB.rm)PUB.rm=new Set($$('#pub .pub-grp.open [data-pub-rm]').map(b=>b.dataset.pubRm));flip(PUB.rm,d.pubRm)}else if(d.pubKi)flip(PUB.ki,d.pubKi)}
// Вид «Отчётов»: «По месяцам» на виду, «По видам» и «По срокам» — в меню (на телефоне — лист снизу)
function pubViewMenu(b){const L=[['month','По месяцам','calendar'],['type','По видам','file'],['due','По срокам','clock']];
  openPop(b,`<div class="menu" role="menu">${L.map(([k,l,i])=>`<button type="button" class="mi${PUB.mode===k?' on':''}" role="menuitemradio" aria-checked="${PUB.mode===k}" data-vm="${k}">${ic(PUB.mode===k?'check':i,'sm')}<span>${l}</span></button>`).join('')}</div>`,
    {mount:el=>$$('[data-vm]',el).forEach(x=>x.onclick=()=>{closePop();if(PUB.mode===x.dataset.vm)return;PUB.mode=x.dataset.vm;PUB.rm=null;pubSecDraw('reports')})})}
// На телефоне «Отчёты», «Файлы», «Связь» и «Цифры компании» свёрнуты до строки с итогом и раскрываются по высоте; «Что нужно сделать» и «Оплата» — всегда раскрыты; на ПК всё раскрыто
function pubFold(k,open){open?PUB.unf.add(k):PUB.unf.delete(k);const s=$(`#pub .pub-s[data-sec="${k}"]`);if(!s||!s.classList.contains('pub-fd'))return;s.classList.toggle('fold',!open);const b=$('[data-pub-tg]',s);if(b)b.setAttribute('aria-expanded',open)}
// Нижнее меню телефона: «Главное» — наверх, «Оплата», «Отчёты», «Файлы» — к разделу, «Помощь» — панель помощи
function pubNav(k,c){if(k==='help'){if(c)cphHelp(c);return}if(k==='top'){const sc=$('#pub .pub-page');if(sc)sc.scrollTo({top:0,behavior:cphRM()?'auto':'smooth'});return}pubGo(k)}
// Переход к разделу: «money» и «fee» (ответы «Помощи», старые ссылки) — строки «Налоги» и «Услуги бухгалтера» в «Оплате»; раздел мягко подсвечивается.
// При «уменьшить движение» — без плавной прокрутки
function pubGo(k,fl){const po={money:'tax',fee:'fee'}[k];if(po){k='pay';PUB.po=PUB.po||new Set($$('#pub .pub-po.open').map(r=>r.dataset.po));if(!PUB.po.has(po)){PUB.po.add(po);pubSecDraw('pay')}}
  if(fl&&PUB.f!==fl){PUB.f=fl;PUB.rm=null;if(fl==='late'&&PUB.lateY)PUB.y=PUB.lateY;PUB.unf.add(k);pubSecDraw(k)}else pubFold(k,true);
  const s=$(`#pub .pub-s[data-sec="${k}"]`);if(!s)return;const t=po?$(`[data-po="${po}"]`,s)||s:s;t.scrollIntoView({behavior:cphRM()?'auto':'smooth',block:'start'});t.classList.remove('pub-flash');void t.offsetWidth;t.classList.add('pub-flash')}
// Отметка текущего раздела в нижнем меню: раздел, чей заголовок последним прошёл верхнюю треть экрана
function pubNavMark(){const sc=$('#pub .pub-page'),nv=$('#pub .pub-nav');if(!sc||!nv)return;const lim=sc.getBoundingClientRect().top+sc.clientHeight/3;let cur='top';
  ['pay','reports','files'].forEach(k=>{const s=$(`#pub .pub-s[data-sec="${k}"]`);if(s&&s.getBoundingClientRect().top<=lim)cur=k});
  if(sc.scrollTop+sc.clientHeight>=sc.scrollHeight-4){const f=$('#pub .pub-s[data-sec="files"]');if(f&&f.getBoundingClientRect().top<sc.clientHeight)cur='files'}
  $$('[data-pub-nav]',nv).forEach(b=>{const on=b.dataset.pubNav===cur;b.classList.toggle('on',on);on?b.setAttribute('aria-current','true'):b.removeAttribute('aria-current')})}
// Тексты пояснений страницы ведёт администратор платформы: «Справочники платформы» → «Тексты элементов экрана»
const PGT=(g,k)=>(((KBUI.page||{})[g]||{})[k])||'';
const pubSt=r=>r.status==='Требует исправления'?'В работе':r.status;
const PUB_PER={M:'раз в месяц',Q:'раз в квартал',H:'раз в полгода',Y:'раз в год'};
const pubPer=t=>t.oneOff?'разовый':PUB_PER[t.per]||perTxt(t);
// «Что это» у вида отчёта: «Пояснение для контрагента», у вида без него — первое предложение описания
const pubNote=t=>t.clientNote||((t.desc||'').match(/^.*?[.!?](?=\s|$)/)||[t.desc||''])[0].trim();
// По какой месяц обслуживание оплачено без пропусков
function pubFeeTill(c){let till='';for(const m of feeMonths(c)){const ch=feeCharge(c,m);if(ch>0&&feeGot(c,m)<ch)break;if(ch>0)till=m}return till}
// Сверка «Деньги на налоги» за текущий месяц и итоги года
function pubMoney(c){const pm=ym(TODAY);const need=REPORTS.filter(r=>r.cp===c.id&&!r.superseded&&tR(r).sum&&r.sum>0&&r.paid<r.sum&&r.status!=='Не требуется'&&r.payDue&&r.payDue<=lastDay(pm)).sort((a,b)=>a.payDue<b.payDue?-1:1);
  const needSum=need.reduce((a,r)=>a+r.sum-r.paid,0),later=REPORTS.filter(r=>r.cp===c.id&&r.ear>0&&r.payDue&&r.payDue>lastDay(pm)).reduce((a,r)=>a+r.ear,0),diff=Math.round((c.avail-later-needSum)*100)/100;
  const y0=TODAY.slice(0,4),s=k=>OPS.filter(o=>o.cp===c.id&&o.kind===k&&!o.del&&(o.date||'').slice(0,4)===y0).reduce((a,o)=>a+o.amount,0);
  return {pm,need,needSum,diff,y0,got:s('in')+s('back')+s('corr'),paid:s('pay')}}
// Мини-график показателя: столбик на месяц, последний месяц со значением — цветом акцента, пустой месяц — чёрточка у основания, будущие месяцы пустые
function pubSpark(i,ms,vals){const H=30,mx=Math.max(0,...vals.filter(x=>x!=null).map(Math.abs)),last=vals.reduce((a,x,j)=>x!=null?j:a,-1);
  return `<svg class="pub-sp" viewBox="0 0 96 ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(i.name)} по месяцам">${ms.map((m,j)=>{const x=vals[j];if(x===undefined)return '';const h=x==null||!mx?1.5:Math.max(1.5,Math.abs(x)/mx*(H-2));return `<rect x="${j*8+1}" y="${H-h}" width="6" height="${h}" rx="1" class="${x==null?'e':j===last?'c':''}"><title>${esc(ymLabel(m))}: ${x==null?'нет данных':kNum(i,x)}</title></rect>`}).join('')}</svg>`}
/* ═════════════ Страница простыми словами (доработки 17.11.2026, «Меньше текста, понятнее, плавнее», п. 6; поток К) ═════════════ */
// 7 блоков: шапка, «Что нужно сделать», «Оплата», «Отчёты», «Файлы», «Связь», «Цифры компании». Пояснение раздела — под «?» у заголовка, а не абзацем.
// Одна сумма на одно дело: налоги — «Не хватает» сверки «Деньги на налоги» (pubTaxDue), услуги бухгалтера — долг (c.feeDebt); та же сумма
// в строке «Что нужно сделать», в «Оплате», в окне «Оплатить» и в «Я оплатил». Месяц из «Отчёты» → «По месяцам» — его остаток, во всех трёх местах тоже один
// Дата словами для клиента: «20 ноября», в другом году — «20 ноября 2025»
const pubDW=s=>{if(!s)return '';const y=s.slice(0,4);return `${+s.slice(8,10)} ${MONTHS_G[+s.slice(5,7)-1]}${y!==TODAY.slice(0,4)?' '+y:''}`};
const pubMon=m=>cphCap(ymLabel(m)).replace(' '+TODAY.slice(0,4),'');
const pubFeeOn=c=>pgSecs(c).includes('fee')&&c.kind!=='oneoff';
// Сколько перевести на налоги — «Не хватает»: налоги до конца месяца минус деньги клиента у бухгалтера (раздел «Деньги на налоги» включён у контрагента)
const pubTaxDue=c=>feat('taxpay')&&pgSecs(c).includes('money')?Math.max(0,-pubMoney(c).diff):0;
// Куда переводить: налоги — реквизит ответственного бухгалтера или счёт организации (как выбрано у контрагента), услуги бухгалтера — счёт организации; раздел «Куда переводить» включён
const pubAcc=(c,k)=>pgSecs(c).includes('pay')?(k==='tax'?(feat('taxpay')?pgTaxAcc(c):null):pubFeeOn(c)?orgMain('fee'):null):null;
// Срок прошёл: налог, на который не хватает денег, надо было оплатить раньше сегодня; месяц услуг бухгалтера не оплачен после своего числа оплаты
const pubTaxLate=c=>pubTaxDue(c)>0&&pubMoney(c).need.some(r=>r.payDue<TODAY);
const pubFeeDue=(c,m)=>{const l=lastDay(m),d=Math.min(c.feeDay||1,+l.slice(8,10));return `${m}-${String(d).padStart(2,'0')}`};
const pubFeeLate=c=>c.feeDebt>0&&pgFeeOpen(c).some(m=>pubFeeDue(c,m)<TODAY);
// Что написать в комментарии к переводу: название компании, у услуг бухгалтера — и месяц
const pubPayNote=(c,k)=>k==='fee'?`${c.name}, ${ymLabel(pgFeeOpen(c)[0]||ym(TODAY)).replace(' '+TODAY.slice(0,4),'')}`:c.name;
// Сообщение «Я оплатил», которое бухгалтер ещё не проверил: «Чек отправлен 17 ноября · 5 920 сом · бухгалтер проверяет»
const pubWaitTxt=w=>w?`Чек отправлен ${pubDW(String(w.at).slice(0,10))} · ${som(w.sum)} · бухгалтер проверяет`:'';
// «Куда переводить»: номер или счёт крупно с «Скопировать», «Только из: …» банков, БИК, «Получатель: …, ваш бухгалтер», «В комментарии к переводу: …» с «Скопировать»
function pubPay(k,a,c){const ph=a.kind==='phone',num=rqNum(a),cb=pgRqBtn(a),emp=!ORG.accounts.includes(a),note=pubPayNote(c,k);
  return `<div class="pub-pay" data-pay="${k}"><span class="hint">${ph?'По номеру телефона':esc(rqKindL(a,!emp))}</span>
    ${ph?'':`<span class="pub-pbn">${esc(a.bank||a.prov||'')}</span>`}
    <div class="pub-pn"><span class="mono">${esc(num)}</span><button type="button" class="btn sm" data-pub-copy="${esc(cb.copy)}" data-pub-ok="${esc(cb.copied)}">${ic('copy','sm')}${ph?'Скопировать номер':'Скопировать всё'}</button></div>
    ${ph&&(a.banks||[]).length?`<div class="pub-pk"><span class="hint">Только из:</span><span>${esc(rqBanksDict(a.banks).join(', '))}</span>${PGT('pay','Банки и кошельки')?tipI(PGT('pay','Банки и кошельки')):''}</div>`:''}
    ${a.bank&&a.bik?`<div class="pub-pk"><span class="hint">БИК</span><span class="mono">${esc(a.bik)}</span></div>`:''}
    ${a.name?`<div class="pub-pk"><span class="hint">Получатель:</span><span><b>${esc(a.name)}</b>${emp?', ваш бухгалтер':''}</span></div>`:''}
    <div class="pub-pk pub-pnote"><span class="hint">В комментарии к переводу:</span><b>${esc(note)}</b><button type="button" class="icon-btn sm" data-pub-copy="${esc(note)}" data-pub-ok="Комментарий скопирован" aria-label="Скопировать комментарий" title="Скопировать">${ic('copy','sm')}</button></div></div>`}
// Сумма к переводу с «Скопировать» — сверху окна «Оплатить» и в раскрытой строке «Оплаты»
const pubSumLine=s=>`<div class="pub-sendsum"><span class="hint">К переводу</span><b class="tnum">${som(s)}</b><button type="button" class="btn sm" data-pub-copy="${esc(String(s).replace('.',','))}" data-pub-ok="Сумма скопирована">${ic('copy','sm')}Скопировать</button></div>`;
// Сворачиваемая строка внутри раздела: «Из чего сумма», «За год», «История оплат», «Куда переводить» — раскрывается по высоте
const pubDet=(id,label,body,sum='')=>{const o=PUB.det.has(id);return `<div class="pub-det${o?' open':''}"><button type="button" class="pub-dh" data-pub-det="${esc(id)}" aria-expanded="${o}"><span>${esc(label)}</span>${sum?`<span class="hint">${sum}</span>`:''}<span class="grow"></span>${ic('down','sm')}</button><div class="pub-gb"><div class="pub-gi">${body}</div></div></div>`};
// Раздел: заголовок (на телефоне — свернуть или раскрыть, в свёрнутом — итог раздела), «?» с пояснением, act — кнопки, видные и в свёрнутом
function pubSec(k,title,sum,body,{extra='',fold=true,act='',q}={}){const f=fold&&!PUB.unf.has(k),what=q!=null?q:PGT('secs',title);
  const head=`<span class="pub-tt">${esc(title)}</span>${sum?`<span class="pub-sum">${sum}</span>`:''}`;
  return `<section class="box pub-s${fold?' pub-fd':''}${f?' fold':''}" data-sec="${k}"><h3 class="pub-sh">${fold?`<button type="button" class="pub-tg" data-pub-tg="${k}" aria-expanded="${!(f&&isMobile())}">${head}</button>`:`<span class="pub-tg">${head}</span>`}${extra?`<span class="pub-ex">${extra}</span>`:''}${act?`<span class="pub-act">${act}</span>`:''}${what?tipI(what):''}${fold?`<button type="button" class="pub-chev" data-pub-tg="${k}" tabindex="-1" aria-hidden="true">${ic('down','sm')}</button>`:''}</h3><div class="pub-sw"><div class="pub-sb">${body}</div></div></section>`}
// Длинные списки на телефоне — по 5 строк с «Показать ещё»
// Суммы на странице — без «,00», если копеек нет
const pubM=v=>fmtM(v,(Math.round(v*100)%100)!==0);
const pubMore=n=>n>5?`<button type="button" class="linkbtn pub-more" data-pub-more>${ic('down','sm')}Показать ещё ${n-5}</button>`:'';
// «Файлы» (решение заказчика 06.11.2026): файлы контрагента, которые хранятся у нас, по категориям; категории следуют разделам страницы; файлы задач и скрытые со страницы (c.pgHide) не попадают никогда
const PG_FCAT=[['rep','Отчёты'],['doc','Документы компании'],['pay','Оплаты налогов'],['in','Ваши переводы'],['prj','Проекты и услуги'],['fee','Услуги бухгалтера'],['oth','Прочие']];
const PG_FCATL=Object.fromEntries(PG_FCAT);
function pubFiles(c,has,fee){const out=[],hid=new Set(c.pgHide||[]),add=(cat,n,rel,date)=>{if(!n||hid.has(n))return;out.push({cat,name:n,rel:rel||'',date:String(date||TODAY).slice(0,10),size:fsize(n)})},tp=has('money');
  if(has('reports'))REPORTS.forEach(r=>{if(r.cp!==c.id)return;(r.files||[]).forEach(n=>add('rep',n,`${T[r.t].name} · ${r.plabel}`,r.subDate||r.due))});
  (c.files||[]).forEach(n=>add('doc',n,(c.regFiles||[]).includes(n)?'Из свидетельства и выписки':(c.fromCp||[]).includes(n)?'Отправлен вами':'',c._ua||c.start));
  if(tp)OPS.forEach(o=>{if(o.cp!==c.id||o.del||!(o.files||[]).length)return;const r=o.kind==='pay'&&REPORTS.find(y=>y.id===o.report);
    if(o.kind==='pay')o.files.forEach(n=>add('pay',n,`${r?T[r.t].name+' · '+r.plabel+', ':''}оплата ${som(o.amount)} от ${pubDW(o.date)}`,o.date));
    else if(o.kind==='in')o.files.forEach(n=>add('in',n,`Перевод ${som(o.total??o.amount)} от ${pubDW(o.date)}`,o.date))});
  if(feat('projects')){SERVICES.forEach(x=>{if(x.cp!==c.id||x.del)return;[...(x.files||[]),...(x.pays||[]).filter(y=>!y.del).flatMap(y=>y.files||[])].forEach(n=>add('prj',n,`Услуга «${x.name}»`,x.date))});
    PROJECTS.forEach(x=>{if(x.cp!==c.id||x.del)return;[...(x.files||[]),...(x.pays||[]).filter(y=>!y.del).flatMap(y=>y.files||[])].forEach(n=>add('prj',n,`Проект «${x.name}»`,x.from))})}
  if(fee)FEEPAYS.forEach(x=>{if(x.cp===c.id&&!x.del)(x.files||[]).forEach(n=>add('fee',n,`Оплата ${som(x.amount)} от ${pubDW(x.date)}`,x.date))});
  FILES.forEach(f=>{if(f.cp===c.id)add('oth',f.name,'',f.at)});
  return out.sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0)}
const pubFIc=n=>/^(JPE?G|PNG|WEBP|GIF|HEIC|BMP)$/.test(fext(n))?'image':/^(XLSX?|CSV)$/.test(fext(n))?'table':/^(ZIP|RAR|7Z)$/.test(fext(n))?'folder':'file';
// Любой файл открывается в окне просмотра (доработки 16.11.2026, блок 5): «‹ ›» — по файлам того же списка (вкладка «От бухгалтера» с плашкой и поиском,
// файлы одного отчёта), «Скачать»; файл, который не показать, — «Предпросмотр недоступен» и «Скачать». Ссылка на файл в рабочей версии временная — 5 минут
function pubFileOpen(list,i){fileView(list,i,{sub:f=>f.cat?`${esc(PG_FCATL[f.cat]||'')}${f.rel?' · '+esc(f.rel):''}`:'Просмотр файла',dl:f=>toast('Скачивание: '+f.name,'download')})}
// Куда отчёт сдаётся — простыми словами
const pubOrgan=o=>o?({'ГНС':'в налоговую','Нацстатком':'в Нацстатком','Соцфонд':'в Соцфонд'}[o]||'в '+o):'';
// Подпись итога «Цифр компании»: «за 2026 год», «в среднем за 2026 год»
const PUB_KAGG={sum:'за',avg:'в среднем за',max:'наибольшее за',min:'наименьшее за',last:'последнее за'};
function pubBody(c){const secs=pgSecs(c),has=k=>secs.includes(k),e0=EM[c.resp],e=e0&&e0.active!==false?e0:null,cy=TODAY.slice(0,4),fee=pubFeeOn(c),tp=feat('taxpay');const role=x=>(ROLES.find(r=>r.id===x.role)||{}).name||'';
  const ph=e&&e.phone&&e.phone.digits?e.phone:ORG.phone&&ORG.phone.digits?ORG.phone:null;
  const byDue=(a,b)=>a.due<b.due?-1:a.due>b.due?1:a.id-b.id,isSub=r=>r.status==='Сдан',fk=r=>isSub(r)?'sub':r.due<TODAY?'late':'next';
  const all=REPORTS.filter(r=>r.cp===c.id&&!r.superseded&&r.status!=='Не требуется').sort(byDue),late=all.filter(r=>fk(r)==='late'),nx=all.find(r=>fk(r)==='next');PUB.lateY=late.length?late[late.length-1].due.slice(0,4):null;
  const M=tp&&has('money')?pubMoney(c):null,due=pubTaxDue(c),aTax=pubAcc(c,'tax'),aFee=pubAcc(c,'fee'),wTax=pgClaimWait(c,'tax'),wFee=pgClaimWait(c,'fee'),paid=pgPaidOn(c);
  const H={},hidF=new Set(c.pgHide||[]),rf=r=>(r.files||[]).filter(n=>!hidF.has(n));
  // «Что нужно сделать»: деньги с кнопкой «Оплатить» и несданные в срок отчёты с «Спросить бухгалтера»; дел нет — одна зелёная строка
  const ask=ph?`<a class="btn" href="${waLink(ph)}" target="_blank" rel="noopener">${ic('chat','sm')}Спросить бухгалтера</a>`:`<button type="button" class="btn" data-pub-nav="help">${ic('help','sm')}Спросить бухгалтера</button>`;
  const D=[];
  const doRow=(k,l,s,late,acc,w)=>`<div class="pub-do${late?' late':''}" data-do="${k}"><span class="pub-dl"><span>${esc(l)}</span><b class="pub-dsum tnum">${som(s)}</b>${w?`<span class="hint">${esc(pubWaitTxt(w))}</span>`:late&&k!=='late'?'<span class="hint red">срок оплаты уже прошёл</span>':''}</span>${acc?`<button type="button" class="btn ${w||D.some(x=>x.includes('btn cta'))?'':'cta'}" data-pub-pay="${k}">${ic('wallet','sm')}Оплатить</button>`:''}</div>`;
    if(due>0)D.push(doRow('tax','Перевести на налоги',due,pubTaxLate(c),aTax,wTax));
  if(fee&&c.feeDebt>0)D.push(doRow('fee','Услуги бухгалтера',c.feeDebt,pubFeeLate(c),aFee,wFee));
  if(has('reports')&&late.length)D.push(`<div class="pub-do calm" data-do="late"><span class="pub-dl"><button type="button" class="linkbtn" data-pub-go="reports" data-pub-fl="late">${late.length} ${plural(late.length,'отчёт не сдан','отчёта не сданы','отчётов не сданы')} в срок</button><span class="hint">Их сдаёт бухгалтер</span></span>${ask}</div>`);
  const state=D.length?`<section class="pub-state todo" role="status" aria-labelledby="pub-doh"><h2 id="pub-doh">Что нужно сделать</h2>${D.join('')}</section>`
    :`<div class="pub-state ok" role="status">${ic('ok')}<span>${esc(PGT('state','Всё в порядке')||'Всё в порядке. Платить сейчас не нужно.')}</span></div>`;
  // «Оплата»: строки «Налоги» и «Услуги бухгалтера»; раскрыта та, по которой есть долг. Внутри — к переводу, куда переводить, «Я оплатил», расчёт и история
  const po=PUB.po||new Set([due>0&&'tax',fee&&c.feeDebt>0&&'fee'].filter(Boolean));
  const paidBtn=(k,s,w)=>paid?`<div class="pub-paid">${w?`<span class="pill sm blue">${ic('hourglass')}Бухгалтер проверяет</span><span class="hint">${esc(pubWaitTxt(w).replace(' · бухгалтер проверяет',''))}</span>`:''}<button type="button" class="btn" data-pub-paid="${k}">${ic('check','sm')}${w?'Отправить ещё чек':'Я оплатил'}</button></div>`:'';
  const poRow=(k,title,st,body)=>{const o=po.has(k);return `<div class="pub-po${o?' open':''}" data-po="${k}"><button type="button" class="pub-gh" data-pub-po="${k}" aria-expanded="${o}"><span class="pub-rt1"><b>${esc(title)}</b><span class="grow"></span>${st}${ic('down','sm')}</span></button><div class="pub-gb"><div class="pub-gi">${body}</div></div></div>`};
  const P=[];
  if(M||aTax){const st=!M?'<span class="hint">куда переводить</span>':due>0?`<span class="${pubTaxLate(c)?'red ':''}strong">не хватает ${som(due)}</span>`:M.diff>0?`<span class="green">${M.needSum?'денег хватает, запас':'запас'} ${som(M.diff)}</span>`:'<span class="green">денег хватает</span>';
    const cs=r=>`<div class="pub-row"><div class="pub-r1"><span>${esc(T[r.t].name)} · ${esc(r.plabel)}</span><span class="grow"></span><b class="tnum">${som(r.sum-r.paid)}</b></div><div class="pub-r2"><span>до ${pubDW(r.payDue)}</span></div></div>`;
    const kv=(l,v,cls='')=>`<div><span class="k">${l}</span><span class="v tnum ${cls}">${v}</span></div>`;
    const calc=M?`<div class="kv pub-calc">${kv(`Налоги до ${pubDW(lastDay(M.pm))}`,som(M.needSum))}${kv('Ваши деньги у нас',som(Math.round((M.needSum+M.diff)*100)/100))}${kv(due>0?'Не хватает':'Запас',`${som(due>0?due:M.diff)}${due>0?`<button type="button" class="icon-btn sm" data-pub-copy="${esc(String(due).replace('.',','))}" data-pub-ok="Сумма скопирована" aria-label="Скопировать сумму" title="Скопировать сумму">${ic('copy','sm')}</button>`:''}`,due>0?'strong pub-due':'')}</div>`:'';
    const year=M?`<div class="kv">${kv(`Вы перевели нам за ${M.y0} год`,som(M.got))}${kv('Мы заплатили налогов за вас',som(M.paid))}</div>`:'';
    const acc=aTax?pubPay('tax',aTax,c)+paidBtn('tax',due,wTax):'';
    P.push(poRow('tax','Налоги',st,`${!M&&due>0&&aTax?pubSumLine(due):''}${calc}${due>0||!M?acc:aTax?pubDet('acc-tax','Куда переводить',acc):''}
      ${M&&M.need.length?pubDet('need','Из чего сумма',`<div class="pub-list">${M.need.map(cs).join('')}${pubMore(M.need.length)}</div>`):''}${year?pubDet('year','За год',year):''}`))}
  if(fee){const ct=curTariff(c),ms=feeMonths(c).filter(m=>feeCharge(c,m)>0||c.feePaid[m]).reverse(),till=pubFeeTill(c),lt=pubFeeLate(c);
    const st=c.feeDebt>0?`<span class="${lt?'red ':''}strong">${som(c.feeDebt)}</span>`:`<span class="green">${till?`оплачены по ${MONTHS[+till.slice(5,7)-1]}`:'долга нет'}</span>`;
    const mrow=m=>{const ch=feeCharge(c,m),p=feeGot(c,m),w=pgClaimWait(c,'fee',m),stx=p>=ch?'оплачено':w?'бухгалтер проверяет':p>0?'оплачено частично':'не оплачено',bad=p<ch&&!w&&pubFeeDue(c,m)<TODAY;
      return `<div class="pub-row"><div class="pub-r1"><span>${esc(pubMon(m))}</span><span class="grow"></span><b class="tnum">${som(ch)}</b><span class="${p>=ch?'green':bad?'red':'hint'}">${stx}</span></div>${p>0&&p<ch?`<div class="pub-r2"><span>оплачено <b class="tnum">${som(p)}</b> из <b class="tnum">${som(ch)}</b></span></div>`:''}</div>`};
    const open=ms.filter(m=>feeGot(c,m)<feeCharge(c,m)),done=ms.filter(m=>feeGot(c,m)>=feeCharge(c,m));
    const acc=aFee?pubPay('fee',aFee,c)+paidBtn('fee',c.feeDebt,wFee):'';
    const fs=String(c.feeDebt).replace('.',','),feeKv=c.feeDebt>0?`<div class="kv pub-calc"><div><span class="k">К оплате</span><span class="v tnum strong pub-due">${som(c.feeDebt)}${aFee?`<button type="button" class="icon-btn sm" data-pub-copy="${esc(fs)}" data-pub-ok="Сумма скопирована" aria-label="Скопировать сумму" title="Скопировать сумму">${ic('copy','sm')}</button>`:''}</span></div></div>`:'';
    P.push(poRow('fee','Услуги бухгалтера',st,`${ct?`<div class="pub-r2 pub-fee1"><span>Стоимость <b class="tnum">${som(ct.amount)}</b> ${ct.per==='Y'?'в год':'в месяц'}</span><span>оплата до ${c.feeDay}-го числа</span></div>`:''}
      ${open.length?`<div class="pub-list">${open.map(mrow).join('')}</div>`:''}${feeKv}${c.feeDebt>0?acc:aFee?pubDet('acc-fee','Куда переводить',acc):''}${done.length?pubDet('feehist','История оплат',`<div class="pub-list">${done.map(mrow).join('')}${pubMore(done.length)}</div>`):''}`))}
  if(P.length)H.pay=pubSec('pay','Оплата','',`<div class="pub-pos">${P.join('')}</div>`,{fold:false});
  // «Отчёты»: по умолчанию «По месяцам» (там деньги и «Оплатить»), «По видам» и «По срокам» — в меню «⋯»; плашки-фильтры — строкой; несданные в срок — спокойно, без красного
  if(has('reports')){const ys=[...new Set([cy,...all.map(r=>r.due.slice(0,4))])].sort().reverse(),y=ys.includes(PUB.y)?PUB.y:cy;
    const yr=all.filter(r=>r.due.slice(0,4)===y),cnt={sub:0,next:0,late:0};yr.forEach(r=>cnt[fk(r)]++);const f=PUB.f,vis=yr.filter(r=>!f||fk(r)===f);
    const FL={sub:'Сдано',next:'Впереди',late:'Не сданы в срок'};
    const chip=k=>`<button type="button" class="pub-chip${f===k?' on':''}${k==='late'&&cnt.late?' calm':''}" data-pub-f="${k}" aria-pressed="${f===k}">${FL[k]} <b>${cnt[k]}</b></button>`;
    const row=(r,wt)=>{const t=T[r.t],st=pubSt(r),lt=fk(r)==='late';
      return `<div class="pub-row${lt?' late':''}"><div class="pub-r1">${wt?`<b>${esc(t.name)}</b><span class="faint">·</span>`:''}<span>${esc(r.phuman)}</span><span class="grow"></span>${pill(st,ST)}</div>
        <div class="pub-r2">${st==='Сдан'&&r.subDate?`<span>сдан ${pubDW(r.subDate)}</span>`:`<span class="${lt?'calm strong':''}">${lt?'срок был ':'срок '}${pubDW(r.due)}</span>`}${t.sum?`<span>${r.sum!=null?`налог <b class="tnum">${som(r.sum)}</b>`:'<span class="faint">сумма ещё не рассчитана</span>'}</span>${tp&&r.sum>0?pill(r.payStatus,PST):''}`:''}</div>
        ${rf(r).length?`<div class="pub-files">${rf(r).map(n=>`<a href="#" class="pub-file" data-pub-file="${esc(n)}">${ic('download','sm')}${esc(n)}</a>`).join('')}</div>`:''}</div>`};
    let list;
    // «По срокам» — группы по месяцу срока сдачи; «По месяцам» — по месяцу, за который отчёт (правило rmYm, общее с карточкой контрагента и сообщением «К оплате»): в шапке группы —
    // «осталось N сом» или «оплачено», внутри — «к оплате · оплачено · осталось» и «Оплатить» с остатком месяца (без «Учёта оплаты налогов» — только «к оплате»)
    if(PUB.mode==='due'||PUB.mode==='month'){const bm=PUB.mode==='month',gk=bm?rmYm:r=>ym(r.due),now=bm?addMonths(ym(TODAY),-1):ym(TODAY);
      const ms=[...new Set(vis.map(gk))].sort(),op=PUB.rm||new Set([ms.find(m=>m>=now)||ms[ms.length-1]]);
      list=ms.map(m=>{const rs=vis.filter(r=>gk(r)===m),l=rs.filter(r=>fk(r)==='late').length,o=op.has(m),g=bm?rmGroup(m,rs.map(rmItem)):null,pp=bm&&tp?pgMonthPay(c,m):null;
        const hs=pp&&pp.sum>0?(pp.left>0?`<span class="pub-gsum">осталось <b class="tnum">${som(pp.left)}</b></span>`:'<span class="pub-gsum green">оплачено</span>'):g&&g.sum>0?`<span class="pub-gsum">к оплате <b class="tnum">${som(g.sum)}</b></span>`:'';
        return `<div class="pub-grp${o?' open':''}"><button type="button" class="pub-gh" data-pub-rm="${m}" aria-expanded="${o}"><span class="pub-rt1"><b>${esc(cphCap(ymLabel(m)))}</b><span class="grow"></span>${hs}${ic('down','sm')}</span>${l||pp&&pp.left>0&&pp.st==='Ожидает подтверждения'?`<span class="pub-rt3">${pp&&pp.left>0&&pp.st==='Ожидает подтверждения'?'<span class="blue">бухгалтер проверяет чек</span>':''}${l?`<span class="calm">${l} ${plural(l,'отчёт не сдан','отчёта не сданы','отчётов не сданы')} в срок</span>`:''}</span>`:''}</button>
          <div class="pub-gb"><div class="pub-gi pub-list">${pp&&pp.sum>0?`<div class="pub-gpay"><span class="hint">к оплате <b class="tnum">${pubM(pp.sum)}</b> · оплачено <b class="tnum">${pubM(pp.got)}</b> · осталось <b class="tnum">${pubM(pp.left)}</b></span>${pp.left>0&&pgSendOn(c)?`<span class="grow"></span><button type="button" class="btn sm" data-pub-send="${m}">${ic('wallet','sm')}Оплатить</button>`:''}</div>`:''}${rs.map(r=>row(r,true)).join('')}${pubMore(rs.length)}</div></div></div>`}).join('')}
    else{const soon=addDays(TODAY,30),rk=id=>{const rs=yr.filter(r=>r.t===id);return rs.some(r=>fk(r)==='late')?0:rs.some(r=>fk(r)==='next'&&r.due<=soon)?1:2};
      const ts=[...new Set(vis.map(r=>r.t))].sort((a,b)=>rk(a)-rk(b)||RT.indexOf(T[a])-RT.indexOf(T[b]));
      list=`<div class="pub-list pub-rts">${ts.map(id=>{const t=T[id],rs=vis.filter(r=>r.t===id),ty=yr.filter(r=>r.t===id),n=ty.filter(isSub).length,l=ty.filter(r=>fk(r)==='late').length,nx1=ty.find(r=>fk(r)==='next'),o=PUB.rt.has(id),nt=pubNote(t);
        return `<div class="pub-rt${o?' open':''}" data-rt="${esc(id)}"><button type="button" class="pub-gh" data-pub-rt="${esc(id)}" aria-expanded="${o}">
          <span class="pub-rt1"><b>${esc(t.name)}</b><span class="hint">${esc(pubPer(t))}</span><span class="grow"></span>${ic('down','sm')}</span>
          <span class="pub-rt3"><b>сдано ${n} из ${ty.length}</b>${l?`<span class="calm">${l} ${plural(l,'не сдан','не сданы','не сданы')} в срок</span>`:''}${nx1?`<span>следующий до ${pubDW(nx1.due)}</span>`:n===ty.length?`<span class="green">${ic('check','sm')}всё сдано</span>`:''}</span></button>
          <div class="pub-gb"><div class="pub-gi pub-list">${nt||t.organ?`<span class="pub-rt2">${esc([t.organ?cphCap(`сдаётся ${pubOrgan(t.organ)}`)+'.':'',nt].filter(Boolean).join(' '))}</span>`:''}${rs.map(r=>row(r,false)).join('')}${pubMore(rs.length)}</div></div></div>`}).join('')}${pubMore(ts.length)}</div>`}
    const ML={month:'По месяцам',type:'По видам',due:'По срокам'};
    H.reports=pubSec('reports','Отчёты',`сдано ${cnt.sub} из ${yr.length}${y===cy&&nx?` · следующий до ${pubDW(nx.due)}`:''}`,
      `<div class="pub-tools"><div class="pub-chips" role="group" aria-label="Показать отчёты">${chip('sub')}${chip('next')}${chip('late')}</div><span class="grow"></span><button type="button" class="btn sm ghost pub-vm" data-pub-vm aria-haspopup="menu" title="Как показать отчёты">${esc(ML[PUB.mode]||ML.month)}${ic('more','sm')}</button></div>
      <div class="pub-fade">${vis.length?list:`<span class="faint">${f?`Отчётов «${FL[f]}» в ${y} году нет`:esc(cphFill(cphT('emptyReports',`В ${y} году отчётов нет`),{год:y}))}</span>`}</div>`,
      {extra:sel('pub-y',ys.map(x=>[x,x+' год']),y,'aria-label="Год срока сдачи"')})}
  // «Файлы»: вкладки «От бухгалтера» и «От вас», «Отправить файл» видна и в свёрнутом разделе; поиск — когда файлов больше 10
  if(has('files')){const fs=pubFiles(c,has,fee),sent=SENT.filter(x=>x.cp===c.id),up=sntUpOn(c),tab=PUB.ft==='you'||!fs.length&&sent.length?'you':'acc';
    const cats=PG_FCAT.filter(([k])=>fs.some(f=>f.cat===k)),ff=cats.some(([k])=>k===PUB.ff)?PUB.ff:'',vis=fs.filter(f=>!ff||f.cat===ff);PUB.fl=vis;
    const chip=(k,l,n)=>`<button type="button" class="pub-chip${ff===k?' on':''}" data-pub-ff="${k}" aria-pressed="${ff===k}">${esc(l)} <b>${n}</b></button>`;
    const tabs=sent.length||up?`<div class="chipsel pub-ftabs" role="tablist">${[['acc','От бухгалтера',fs.length],['you','От вас',sent.length]].map(([k,l,n])=>`<button type="button" role="tab" data-pub-ft="${k}" class="${tab===k?'on':''}" aria-selected="${tab===k}">${l}${n?` · ${n}`:''}</button>`).join('')}</div>`:'';
    const accL=fs.length?`${cats.length>1?`<div class="pub-chips">${chip('','Все',fs.length)}${cats.map(([k,l])=>chip(k,l,fs.filter(f=>f.cat===k).length)).join('')}</div>`:''}
      ${fs.length>10?`<div class="pub-tools"><input class="inp pub-fq" id="pub-fq" type="search" placeholder="Поиск по названию" value="${esc(PUB.fq||'')}" aria-label="Поиск файла по названию" autocomplete="off"></div>`:''}
      <div class="pub-list pub-fl">${vis.map((f,i)=>`<button type="button" class="pub-frow" data-pub-fo="${i}" data-n="${esc(norm(f.name))}" title="Открыть для просмотра">${ic(pubFIc(f.name))}<span class="pub-fm"><b>${esc(f.name)}</b><span class="hint">${esc(PG_FCATL[f.cat])}${f.rel?' · '+esc(f.rel):''}</span></span><span class="pub-fs hint">${pubDW(f.date)}</span></button>`).join('')}${pubMore(vis.length)}</div><span class="faint pub-fnone" hidden>Файлов с таким названием нет</span>`
      :`<span class="faint">${esc(cphT('emptyFiles','Файлов пока нет'))}</span>`;
    H.files=pubSec('files','Файлы',fs.length+sent.length?`${fs.length+sent.length} ${plural(fs.length+sent.length,'файл','файла','файлов')}`:'',`${tabs}<div class="pub-fade">${tab==='you'?pubSentHtml(c):accL}</div>`,
      {act:up?`<button type="button" class="btn sm" data-pub-up>${ic('upload','sm')}Отправить файл</button>`:''})}
  // «Связь»: бухгалтер со звонком и WhatsApp — видны и в свёрнутом; внутри — кто ещё ведёт отчёты, офис, ваши данные у нас и Telegram
  {const tel=p=>p&&p.digits?`<a class="icon-btn" href="tel:+${p.digits}" aria-label="Позвонить" title="Позвонить">${ic('phone')}</a><a class="icon-btn" href="${waLink(p)}" target="_blank" rel="noopener" aria-label="WhatsApp" title="WhatsApp">${ic('chat')}</a>`:'';
    const ids=has('contacts')?[...c.assign.filter(a=>!a.to&&a.resp).map(a=>a.resp)].filter((x,i,a)=>x&&x!==c.resp&&EM[x]&&EM[x].active!==false&&a.indexOf(x)===i):[];
    const what=id=>c.assign.filter(a=>!a.to&&(a.resp||c.resp)===id).map(a=>T[a.t]&&T[a.t].name).filter(Boolean).join(', ');
    const person=(x,sub)=>`<div class="pub-person"><b>${esc(x.fio)}</b>${sub?`<span class="hint">${esc(sub)}</span>`:''}${x.phone&&x.phone.digits?`<a class="mono" href="tel:+${x.phone.digits}">${esc(fmtPhone(x.phone))}</a>`:''}</div>`;
    const me=e?person(e,'ваш бухгалтер'):`<span class="faint">Бухгалтер пока не назначен. Позвоните в ${esc(ORG.name)}${ORG.phone&&ORG.phone.digits?`: <a class="mono" href="tel:+${ORG.phone.digits}">${esc(fmtPhone(ORG.phone))}</a>`:''}</span>`;
    const ours=has('contacts')?`<h4>Ваши данные у нас</h4><div class="kv"><div><span class="k">ИНН</span><span class="v mono">${esc(c.inn)}</span></div><div><span class="k">Налоговый режим</span><span class="v">${esc(c.regime?REGIME_FULL[c.regime]||c.regime:'не указан')}</span></div><div><span class="k">Руководитель</span><span class="v">${esc(c.head||'—')}</span></div><div><span class="k">Контактное лицо</span><span class="v">${esc(c.contact||'—')}</span></div><div><span class="k">Телефон</span><span class="v mono">${esc(fmtPhone(c.phone)||'—')}</span></div></div>
      ${ph?`<a class="linkbtn" href="${waLink(ph)}" target="_blank" rel="noopener">${ic('chat','sm')}${esc(PGT('contacts','Ваши данные у нас')||'Что-то изменилось? Сообщите бухгалтеру')}</a>`:`<span class="hint">${esc(PGT('contacts','Ваши данные у нас')||'Что-то изменилось? Сообщите бухгалтеру')}</span>`}`
      :`<div class="kv"><div><span class="k">ИНН</span><span class="v mono">${esc(c.inn)}</span></div><div><span class="k">Налоговый режим</span><span class="v">${esc(c.regime?REGIME_FULL[c.regime]||c.regime:'не указан')}</span></div></div>`;
    H.acc=pubSec('acc','Связь',e?esc(e.fio.split(' ').slice(0,2).join(' ')):esc(ORG.name),`<div class="pub-people">${me}${ids.map(id=>person(EM[id],`${role(EM[id])} · помогает с отчётами: ${what(id)}`)).join('')}${has('contacts')&&ORG.phone&&ORG.phone.digits?`<div class="pub-person"><span class="hint">Офис</span><a class="mono" href="tel:+${ORG.phone.digits}">${esc(fmtPhone(ORG.phone))}</a></div>`:''}</div>
      ${has('tg')?pgTgPub(c):''}${ours}`,{act:tel(ph)})}
  // «Цифры компании» (были «Показатели») — последним: плитка на показатель, итог за год крупно и мини-график, значения по месяцам раскрываются по нажатию
  if(has('kpi')){const inds=IND.filter(i=>!i.archived&&kOn(i,c)).sort((a,b)=>(a.order||0)-(b.order||0));const ys=[...new Set([cy,...IVALS.filter(v=>v.cp===c.id).map(v=>v.m.slice(0,4))])].sort().reverse(),y=ys.includes(PUB.ky)?PUB.ky:cy;
    const m12=Array.from({length:12},(_,i)=>`${y}-${String(i+1).padStart(2,'0')}`),ms=m12.filter(m=>m<=ym(TODAY)),v=(i,m)=>{const x=kVal(c.id,i.id,m);return x?x.v:null};
    H.kpi=pubSec('kpi','Цифры компании',inds.length?esc(inds.slice(0,3).map(i=>i.name.toLowerCase()).join(', ')+(inds.length>3?'…':'')):'',
      inds.length&&ms.length?`<div class="pub-ks pub-fade">${inds.map(i=>{const a=kAgg(ms.map(m=>v(i,m))),k=i.main||'sum',o=PUB.ki.has(i.id);
        return `<div class="pub-k${o?' open':''}"><button type="button" class="pub-gh" data-pub-ki="${esc(i.id)}" aria-expanded="${o}"><span class="pub-rt1"><b>${esc(i.name)}</b>${i.unit?`<span class="hint">${esc(i.unit)}</span>`:''}<span class="grow"></span>${ic('down','sm')}</span><span class="pub-kv">${a.n?kNum(i,Math.round(a[k]*100)/100):'—'}</span><span class="hint">${PUB_KAGG[k]||'за'} ${y} год</span>${pubSpark(i,m12,m12.map(m=>m<=ym(TODAY)?v(i,m):undefined))}</button>
          <div class="pub-gb"><div class="pub-gi pub-list">${ms.slice().reverse().map(m=>{const x=v(i,m);return `<div class="pub-row"><div class="pub-r1"><span>${esc(cphCap(ymLabel(m)))}</span><span class="grow"></span><b class="tnum">${x==null?'<span class="faint">—</span>':kNum(i,x)}</b></div></div>`}).join('')}${pubMore(ms.length)}</div></div></div>`}).join('')}</div>`:`<span class="faint">${esc(cphT('emptyKpi','За этот год данных пока нет'))}</span>`,
      {extra:sel('pub-ky',ys.map(x=>[x,x+' год']),y,'aria-label="Год"')})}
  const logo=ORG.logo?`<img src="${ORG.logo}" alt="" class="pub-logo">`:`<span class="pub-logo">${esc(initials(ORG.name.replace(/^(ОсОО|ИП|ОАО|ЗАО)\s+/,'').replace(/[«»"]/g,'')))}</span>`;
  // На ПК две колонки: слева «Оплата» и «Цифры компании», справа «Отчёты», «Файлы», «Связь»; на телефоне — один под другим: «Оплата», «Отчёты», «Файлы», «Связь», «Цифры компании»
  const col=ks=>ks.map(k=>H[k]||'').join('');
  const nav=[['top','Главное','home'],['pay','Оплата','wallet'],['reports','Отчёты','file'],['files','Файлы','folder'],['help','Помощь','help']].filter(([k])=>k==='top'||k==='help'||H[k]);
  return `<div class="pub-body"><header class="pub-h" id="pub-top"><div class="pub-org">${logo}<b>${esc(ORG.name)}</b></div><span class="grow"></span>${ph?`<a class="icon-btn" href="tel:+${ph.digits}" aria-label="Позвонить бухгалтеру" title="Позвонить бухгалтеру">${ic('phone')}</a>`:''}${cphHelpBtn()}</header>
    <div class="pub-title"><h1>${esc(c.name)}</h1></div>
    ${state}
    <div class="pub-grid"><div class="pub-col">${col(['pay','kpi'])}</div><div class="pub-col">${col(['reports','files','acc'])}</div></div>
    <nav class="pub-nav" aria-label="Разделы страницы">${nav.map(([k,l,i])=>`<button type="button" data-pub-nav="${k}"${k==='top'?' class="on" aria-current="true"':''}>${ic(i)}<span>${l}</span></button>`).join('')}</nav></div>`}

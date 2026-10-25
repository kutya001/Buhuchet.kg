'use strict';
// Страница контрагента по ссылке (v56, решение заказчика 24.10.2026): www.buhuchet.kg/<адрес организации>/inn/<ИНН>, вход по коду из 6 цифр, только просмотр
/* ═════════════ Страница контрагента по ссылке ═════════════ */
// Разделы страницы: [ключ, название, функция учётной политики, без которой раздела нет]; «Главное» и «Ваш бухгалтер» показываются всегда
const PG_SECS=[['pay','Как оплатить'],['reports','Отчёты'],['money','Деньги на налоги','taxpay'],['fee','Оплата за обслуживание','fee'],['kpi','Показатели','indicators'],['contacts','Контакты']];
const PG_TRY=5,PG_LOCK=15*60e3,PG_KEEP=30*864e5;
const pgPath=c=>`${ORG.slug}/inn/${c.inn}`;
const pgUrl=c=>'www.buhuchet.kg/'+pgPath(c);
const pgCodeTxt=k=>k?k.slice(0,3)+' '+k.slice(3):'';
const pgSecOrg=s=>(!s[2]||feat(s[2]))&&(ORG.pageSec||[]).includes(s[0]);
const pgSecs=c=>PG_SECS.filter(s=>pgSecOrg(s)&&!((c.page||{}).hide||[]).includes(s[0])).map(s=>s[0]);
const pgOn=c=>feat('cppage')&&!c.archived&&!!(c.page&&c.page.on);
// Копировать и отправить включённую ссылку может и ответственный бухгалтер без права «Управлять страницей контрагента»
const pgSendWhy=c=>can('cpPage')||c.resp===S.me?'':'Отправлять ссылку может ответственный бухгалтер или сотрудник с правом «Управлять страницей контрагента»';
function pgNewCode(){let n;try{n=crypto.getRandomValues(new Uint32Array(1))[0]%1e6}catch(e){n=Math.floor(Math.random()*1e6)}return String(n).padStart(6,'0')}
// Блок «Страница контрагента» на вкладке «Основное» карточки
function pgBox(c){if(!feat('cppage'))return '';const p=c.page||{},on=pgOn(c),why=c.archived?'Контрагент в архиве: страница выключена':can('cpPage')?'':'Нужно право «Управлять страницей контрагента»',sw=pgSendWhy(c);
  const btn=(k,icon,l,w,cls='')=>`<button type="button" class="btn sm ${cls} ${w?'dis':''}" data-pg="${k}" ${w?`aria-disabled="true" data-why="${esc(w)}" title="${esc(w)}"`:`title="${esc(l)}"`} aria-label="${esc(l)}">${ic(icon,'sm')}<span class="bl">${esc(l)}</span></button>`;
  const secs=PG_SECS.filter(pgSecOrg);
  return `<div class="box cp-page" id="cp-page"><h3>Страница контрагента<span class="grow"></span>${on?pill('Включена',{Включена:['green','check']}):pill('Выключена',{Выключена:['gray','ban']})}</h3>
    ${on?`<div class="kv"><div><span class="k">Ссылка</span><span class="v"><a class="mono pg-link" href="#/${esc(pgPath(c))}" title="Открыть страницу так, как её увидит контрагент">${esc(pgUrl(c))}</a></span></div>
      <div><span class="k">Код доступа</span><span class="v mono strong pg-code">${pgCodeTxt(p.code)}</span></div>
      <div><span class="k">Последнее открытие</span><span class="v">${p.last?`${fmtDT(p.last)}${p.lastDev?` <span class="hint">· ${esc(p.lastDev)}</span>`:''}`:'<span class="faint">контрагент ещё не открывал</span>'}</span></div>
      ${secs.length?`<div class="pg-secs-row"><span class="k">Разделы страницы</span><span class="v"><span class="pg-secs">${secs.map(([k,l])=>`<label class="row"><input type="checkbox" data-pg-sec="${k}" ${(p.hide||[]).includes(k)?'':'checked'} ${why?'disabled':''}> ${esc(l)}</label>`).join('')}</span><span class="hint">«Ваш бухгалтер» видно всегда. Разделы для всех контрагентов — в учётной политике</span></span></div>`:''}</div>`
    :`<span class="hint">${c.archived?'Контрагент в архиве — страница выключена.':'Контрагент откроет по ссылке и коду из 6 цифр свои отчёты, показатели и оплату за обслуживание — только для просмотра, без входа в программу.'}</span>`}
    <div class="row acts">${on?`${btn('copy','copy','Скопировать ссылку',sw)}${btn('wa','chat','Отправить в WhatsApp',sw)}<div class="grow"></div>${btn('code','refresh','Сменить код',why)}${btn('off','ban','Выключить',why)}`:c.archived?'':`<div class="grow"></div>${btn('on','link','Включить',why,'cta')}`}</div></div>`}
function pgMount(el,c,redraw){const b=$('#cp-page',el);if(!b)return;
  b.onclick=e=>{const x=e.target.closest('[data-pg]');if(!x)return;if(x.dataset.why){toast(x.dataset.why,'lock',true);return}const k=x.dataset.pg;
    if(k==='on')pgEnable([c],redraw);else if(k==='off')pgOffDlg(c,redraw);else if(k==='code')pgCodeDlg(c,redraw);
    else if(k==='copy'){copyText('https://'+pgUrl(c),'Ссылка скопирована');log('cp',c.id,'Скопирована ссылка на страницу контрагента',c.id)}else if(k==='wa')waDlg({cp:c,page:true})};
  b.onchange=e=>{const x=e.target.closest('[data-pg-sec]');if(!x)return;const k=x.dataset.pgSec,p=c.page,h=new Set(p.hide||[]);x.checked?h.delete(k):h.add(k);p.hide=[...h];
    log('cp',c.id,`Страница контрагента: раздел «${PG_SECS.find(s=>s[0]===k)[1]}» ${x.checked?'показывается':'скрыт'}`,c.id);toast(x.checked?'Раздел показывается на странице':'Раздел скрыт на странице')}}
// Включить — у каждого свой код; уже включённые и архивные пропускаются
function pgEnable(cs,done){const a=cs.filter(c=>!c.archived&&!(c.page&&c.page.on)),skip=cs.length-a.length;
  if(!a.length){toast(cs.length>1?'У выбранных контрагентов страница уже включена или они в архиве':'Страница уже включена','info');return}
  const run=()=>{a.forEach(c=>{const p=c.page||{};c.page={on:true,code:pgNewCode(),at:nowStamp(),by:S.me,codeAt:nowStamp(),hide:p.hide||[],last:null,lastDev:'',fails:0,lock:0};log('cp',c.id,'Страница контрагента включена: создан код доступа',c.id)});
    done&&done();refreshAll();ckHit('cppage');
    toast(a.length>1?`Страница включена у ${a.length} ${plural(a.length,'контрагента','контрагентов','контрагентов')}, у каждого свой код${skip?`. Пропущено: ${skip} — уже включена или в архиве`:''}`:`Страница включена. Код доступа: ${pgCodeTxt(a[0].page.code)}`,'link')};
  if(a.length>1)confirmDlg({title:`Включить страницу у ${a.length} ${plural(a.length,'контрагента','контрагентов','контрагентов')}?`,text:`У каждого появится своя ссылка и свой код из 6 цифр. Отправить их контрагенту можно из его карточки: «Основное» → «Страница контрагента» → «Отправить в WhatsApp».${skip?` Пропущено: ${skip} — страница уже включена или контрагент в архиве.`:''}`,ok:'Включить',run});else run()}
function pgOff(c,why){if(!c.page||!c.page.on)return;c.page.on=false;c.page.offAt=nowStamp();log('cp',c.id,'Страница контрагента выключена'+(why?': '+why:''),c.id)}
function pgOffDlg(c,done){confirmDlg({title:'Выключить страницу контрагента?',text:'Ссылка перестанет открываться: контрагент увидит «Страница недоступна. Обратитесь к вашему бухгалтеру». Включить можно снова — с новым кодом.',ok:'Выключить',danger:true,run:()=>{pgOff(c,'');done&&done();refreshAll();toast('Страница выключена','ban')}})}
function pgCodeDlg(c,done){confirmDlg({title:'Сменить код доступа?',text:'Старый код перестанет действовать сразу, в том числе в браузерах, где он запомнен. Новый код нужно будет отправить контрагенту.',ok:'Сменить код',run:()=>{
  Object.assign(c.page,{code:pgNewCode(),codeAt:nowStamp(),fails:0,lock:0});log('cp',c.id,'Код доступа страницы контрагента изменён',c.id);done&&done();refreshAll();toast(`Новый код: ${pgCodeTxt(c.page.code)}. Отправьте его контрагенту`,'link')}})}

/* Сама страница — как её откроет контрагент по ссылке. В прототипе открывается поверх программы по адресу #/<адрес организации>/inn/<ИНН> */
const PUB={back:'',open:null};
// Состояние просмотра: годы «Отчётов» и «Показателей», фильтр-плашка и вид «Отчётов», раскрытые плитки, раскрытые на телефоне разделы
const pubReset=()=>Object.assign(PUB,{y:null,ky:null,lateY:null,f:'',mode:'type',rt:new Set(),rm:null,ki:new Set(),unf:new Set()});
const pgMem=()=>{const m=store.get('pgmem',{});return m&&typeof m==='object'?m:{}};
const pgDev=()=>{const u=navigator.userAgent||'';const b=/Edg\//.test(u)?'Edge':/OPR\/|Opera/.test(u)?'Opera':/YaBrowser/.test(u)?'Яндекс Браузер':/Firefox\//.test(u)?'Firefox':/Chrome\//.test(u)?'Chrome':/Safari\//.test(u)?'Safari':'браузер';return (/Mobi|Android|iPhone|iPad/.test(u)||isMobile()?'Телефон':'ПК')+' · '+b};
const pgHm=ms=>new Date(ms).toLocaleTimeString('ru-RU',{timeZone:'Asia/Bishkek',hour:'2-digit',minute:'2-digit'});
function pubRoute(){const m=location.hash.match(/^#\/([^/]+)\/inn\/(\d+)\/?$/);if(!m)return false;pubShow(decodeURIComponent(m[1]),m[2]);return true}
function pubShow(slug,inn){let el=$('#pub');if(!el){el=document.createElement('div');el.id='pub';el.className='pub';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Страница контрагента');document.body.append(el)}
  if(!PUB.open)PUB.back=S.mod?'#'+S.mod+(S.tab?'.'+S.tab:''):'#home';PUB.open={slug,inn,logged:false};pubReset();el.hidden=false;document.body.classList.add('pub-on');pubDraw()}
function pubHide(){const el=$('#pub');if(el)el.hidden=true;document.body.classList.remove('pub-on');PUB.open=null}
function pubClose(){const b=PUB.back||'#home';pubHide();PUB.back='';if(location.hash!==b)location.hash=b;else route();refreshAll()}
// Выключенная страница, неизвестный ИНН, архивный контрагент и чужой адрес организации — одна и та же страница без данных
const pubCp=({slug,inn})=>feat('cppage')&&slug===ORG.slug?CPS.find(c=>c.inn===inn&&pgOn(c))||null:null;
// keep — перерисовка той же страницы (год, фильтр, вид): прокрутка остаётся на месте
function pubDraw(keep){const el=$('#pub');if(!el||!PUB.open)return;const o=PUB.open,c=pubCp(o),sc=$('.pub-page',el),top=keep&&sc?sc.scrollTop:0;
  const bar=`<div class="pub-bar"><span class="pub-proto">${ic('eye','sm')}<span>Прототип: страница, которую контрагент откроет по ссылке</span></span><span class="pub-url">${ic('lock','sm')}<span class="mono">www.buhuchet.kg/${esc(o.slug)}/inn/${esc(o.inn)}</span></span><button type="button" class="btn sm" id="pub-x">${ic('x','sm')}Вернуться в программу</button></div>`;
  const brand=`<div class="pub-brand">${ic('book')}<b>Buhuchet.kg</b></div>`;
  let main;
  if(!c)main=`<div class="pub-gate">${brand}<h1>Страница недоступна</h1><p class="muted">Обратитесь к вашему бухгалтеру.</p></div>`;
  else{const p=c.page,mem=pgMem()[o.slug+'|'+o.inn];
    if(mem&&mem.code===p.code&&mem.until>Date.now())main=pubBody(c);
    else if(p.lock>Date.now())main=`<div class="pub-gate">${brand}<h1>Ввод кода временно закрыт</h1><p class="muted">Было ${PG_TRY} неверных кодов подряд. Попробуйте снова после ${pgHm(p.lock)} или попросите код у вашего бухгалтера.</p></div>`;
    else main=`<form class="pub-gate" id="pub-f" autocomplete="off">${brand}<h1>Введите код доступа</h1><p class="muted">Код из 6 цифр прислал ваш бухгалтер вместе со ссылкой.</p>${fld('Код доступа',`<input class="inp mono pub-code" id="pub-k" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">`,{id:'pub-k',full:true})}<button type="submit" class="btn cta" id="pub-ok">Открыть</button><span class="hint">В этом браузере код запомнится на 30 дней.</span></form>`}
  el.innerHTML=bar+`<div class="pub-page">${main}<footer class="pub-foot">Страница только для просмотра. Вопросы — вашему бухгалтеру.</footer></div>`;
  if(top)$('.pub-page',el).scrollTop=top;
  $('#pub-x',el).onclick=pubClose;
  if(c&&c.page.on&&$('.pub-body',el)&&!o.logged){o.logged=true;pubSeen(c)}
  const f=$('#pub-f',el);if(f){const k=$('#pub-k',f);setTimeout(()=>k.focus(),30);k.oninput=()=>{k.value=k.value.replace(/\D/g,'').slice(0,6);setErr(f,'pub-k','')};
    f.onsubmit=e=>{e.preventDefault();const p=c.page,v=k.value.trim();if(!/^\d{6}$/.test(v)){setErr(f,'pub-k','Введите 6 цифр');return}
      if(v!==p.code){p.fails=(p.fails||0)+1;if(p.fails>=PG_TRY){p.fails=0;p.lock=Date.now()+PG_LOCK;HIST.push({at:nowStamp(),who:'client',ent:'cp',id:c.id,cp:c.id,what:`Страница контрагента: ${PG_TRY} неверных кодов подряд, ввод закрыт на 15 минут`});dbSoon();pubDraw();return}
        dbSoon();setErr(f,'pub-k',`Неверный код. Осталось попыток: ${PG_TRY-p.fails}`);k.select();return}
      p.fails=0;const m=pgMem();m[o.slug+'|'+o.inn]={code:p.code,until:Date.now()+PG_KEEP};store.set('pgmem',m);pubDraw()}}
  const y=$('#pub-y',el);if(y)y.onchange=()=>{PUB.y=y.value;PUB.rm=null;pubDraw(true)};const ky=$('#pub-ky',el);if(ky)ky.onchange=()=>{PUB.ky=ky.value;pubDraw(true)};
  const b=$('.pub-body',el);if(b)b.onclick=pubClick;
  $$('[data-pub-file]',el).forEach(a=>a.onclick=e=>{e.preventDefault();toast(`Файл «${a.dataset.pubFile}» откроется для просмотра и скачивания`,'download')})}
// Каждое открытие — в историю контрагента: дата, время, устройство
function pubSeen(c){const d=pgDev();Object.assign(c.page,{last:nowStamp(),lastDev:d});HIST.push({at:nowStamp(),who:'client',ent:'cp',id:c.id,cp:c.id,what:`Страница контрагента открыта: ${d}`});dbSoon()}
// Нажатия на странице: плитки «Главного» и замечания строки состояния ведут в свой раздел; плашки — фильтр «Отчётов»; плитки видов, месяцев и показателей раскрываются
function pubClick(e){const x=e.target.closest('[data-pub-go],[data-pub-tg],[data-pub-f],[data-pub-mode],[data-pub-rt],[data-pub-rm],[data-pub-ki],[data-pub-more],[data-pub-copy]');if(!x)return;const d=x.dataset;
  if(d.pubCopy!=null){copyText(d.pubCopy,d.pubOk||'Скопировано');return}
  if(d.pubMore!=null){x.parentElement.classList.add('all');x.remove();return}
  if(d.pubTg){if(isMobile())pubFold(d.pubTg,!PUB.unf.has(d.pubTg));return}
  if(d.pubGo){pubGo(d.pubGo,d.pubFl);return}
  if(d.pubF!=null){PUB.f=PUB.f===d.pubF?'':d.pubF;pubDraw(true);return}
  if(d.pubMode){PUB.mode=d.pubMode;pubDraw(true);return}
  const flip=(set,k)=>{const on=!set.has(k);on?set.add(k):set.delete(k);x.parentElement.classList.toggle('open',on);x.setAttribute('aria-expanded',on)};
  if(d.pubRt)flip(PUB.rt,d.pubRt);else if(d.pubRm){if(!PUB.rm)PUB.rm=new Set($$('#pub .pub-grp.open [data-pub-rm]').map(b=>b.dataset.pubRm));flip(PUB.rm,d.pubRm)}else if(d.pubKi)flip(PUB.ki,d.pubKi)}
// На телефоне разделы, кроме «Главного» и «Как оплатить», свёрнуты; на ПК всё раскрыто
function pubFold(k,open){open?PUB.unf.add(k):PUB.unf.delete(k);const s=$(`#pub .pub-s[data-sec="${k}"]`);if(!s||!s.classList.contains('pub-fd'))return;s.classList.toggle('fold',!open);const b=$('[data-pub-tg]',s);if(b)b.setAttribute('aria-expanded',open)}
function pubGo(k,fl){if(fl&&PUB.f!==fl){PUB.f=fl;PUB.mode='type';if(fl==='late'&&PUB.lateY)PUB.y=PUB.lateY;PUB.unf.add(k);pubDraw(true)}else pubFold(k,true);
  const s=$(`#pub .pub-s[data-sec="${k}"]`);if(!s)return;s.scrollIntoView({behavior:'smooth',block:'start'});s.classList.remove('pub-flash');void s.offsetWidth;s.classList.add('pub-flash')}
// Тексты пояснений страницы ведёт администратор платформы: «Справочники платформы» → «Тексты элементов экрана»
const PGT=(g,k)=>(((KBUI.page||{})[g]||{})[k])||'';
const pubSt=r=>r.status==='Требует исправления'?'В работе':r.status;
// Метка с пояснением: цвет дополнен значком и текстом, нажатие на метку открывает пояснение
const pubTp=(h,t)=>t?`<button type="button" class="tipi pub-tp" data-tip="${esc(t)}">${h}${ic('info','sm')}</button>`:h;
const PUB_PER={M:'ежемесячно',Q:'ежеквартально',H:'раз в полгода',Y:'раз в год'};
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
// Карточка «Как оплатить»: номер телефона или счёт крупно с «Скопировать», банки и кошельки, получатель, пояснение
function pubPay(k,title,icon,a,org){const ph=a.kind==='phone',num=rqNum(a),raw=String(num).replace(/\s/g,'');
  const cp=(v,ok,l)=>`<button type="button" class="btn sm" data-pub-copy="${esc(v)}" data-pub-ok="${esc(ok)}" aria-label="${esc(l)}">${ic('copy','sm')}Скопировать</button>`;
  return `<div class="pub-pay" data-pay="${k}"><div class="pub-pt">${ic(icon)}<b>${esc(title)}</b><span class="hint">${esc(rqKindL(a,org))}</span></div>
    ${ph?'':`<span class="pub-pbn">${esc(a.bank||a.prov||'')}</span>`}
    <div class="pub-pn"><span class="mono">${esc(num)}</span>${cp(raw,ph?'Номер скопирован':'Номер счёта скопирован',ph?'Скопировать номер':'Скопировать счёт')}</div>
    ${ph?`<div class="pub-pb"><span class="hint">Перевод из</span>${(a.banks||[]).map(b=>`<span class="pill sm">${esc(b)}</span>`).join('')}${PGT('pay','Банки и кошельки')?tipI(PGT('pay','Банки и кошельки')):''}</div>`:''}
    ${a.bank&&a.bik?`<div class="pub-pk"><span class="hint">БИК</span><span class="mono">${esc(a.bik)}</span>${cp(a.bik,'БИК скопирован','Скопировать БИК')}</div>`:''}
    ${a.name?`<div class="pub-pk"><span class="hint">Получатель</span><b>${esc(a.name)}</b></div>`:''}
    ${PGT('pay',title)?`<p class="pub-what">${esc(PGT('pay',title))}</p>`:''}</div>`}
// Раздел: заголовок (на телефоне — кнопка свернуть или раскрыть, в свёрнутом — итог раздела), строка «что это», содержимое
function pubSec(k,icon,title,sum,body,{extra='',fold=true}={}){const f=fold&&!PUB.unf.has(k),what=PGT('secs',title);
  const head=`${ic(icon)}<span class="pub-tt">${esc(title)}</span>${sum?`<span class="pub-sum">${sum}</span>`:''}`;
  return `<section class="box pub-s${fold?' pub-fd':''}${f?' fold':''}" data-sec="${k}"><h3 class="pub-sh">${fold?`<button type="button" class="pub-tg" data-pub-tg="${k}" aria-expanded="${!(f&&isMobile())}">${head}<span class="grow"></span>${ic('down','sm')}</button>`:`<span class="pub-tg">${head}</span>`}${extra?`<span class="pub-ex">${extra}</span>`:''}</h3><div class="pub-sb">${what?`<p class="pub-what">${esc(what)}</p>`:''}${body}</div></section>`}
// Длинные списки на телефоне — по 5 строк с «Показать ещё»
// Суммы на странице — без «,00», если копеек нет
const pubM=v=>fmtM(v,(Math.round(v*100)%100)!==0);
const pubMore=n=>n>5?`<button type="button" class="linkbtn pub-more" data-pub-more>${ic('down','sm')}Показать ещё ${n-5}</button>`:'';
function pubBody(c){const secs=pgSecs(c),has=k=>secs.includes(k),e=EM[c.resp],cy=TODAY.slice(0,4),fee=has('fee')&&c.kind!=='oneoff',tp=feat('taxpay');const role=x=>(ROLES.find(r=>r.id===x.role)||{}).name||'';
  const tel=ph=>ph&&ph.digits?`<a class="btn sm" href="tel:+${ph.digits}">${ic('phone','sm')}Позвонить</a><a class="btn sm" href="${waLink(ph)}" target="_blank" rel="noopener">${ic('chat','sm')}WhatsApp</a>`:'';
  const person=(x,sub)=>`<div class="pub-person"><b>${esc(x.fio)}</b><span class="hint">${esc(sub)}</span>${x.phone&&x.phone.digits?`<a class="mono" href="tel:+${x.phone.digits}">${esc(fmtPhone(x.phone))}</a>`:''}</div>`;
  const byDue=(a,b)=>a.due<b.due?-1:a.due>b.due?1:a.id-b.id,isSub=r=>r.status==='Сдан',fk=r=>isSub(r)?'sub':r.due<TODAY?'late':'next';
  const all=REPORTS.filter(r=>r.cp===c.id&&!r.superseded&&r.status!=='Не требуется').sort(byDue),late=all.filter(r=>fk(r)==='late');PUB.lateY=late.length?late[late.length-1].due.slice(0,4):null;
  const M=has('money')?pubMoney(c):null,H={};
  // Строка состояния: каждое замечание — ссылка на свой раздел
  const iss=[];
  if(has('reports')&&late.length)iss.push({go:'reports',fl:'late',red:1,t:`${plural(late.length,'просрочен','просрочено','просрочено')} ${late.length} ${plural(late.length,'отчёт','отчёта','отчётов')}`});
  if(M&&M.diff<0)iss.push({go:'money',t:`не хватает ${som(-M.diff)} на налоги`});
  if(fee&&c.feeDebt>0)iss.push({go:'fee',t:`долг за обслуживание ${som(c.feeDebt)}`});
  const state=iss.length?`<div class="pub-state ${iss.some(i=>i.red)?'bad':'warn'}" role="status">${ic('alert')}<span><b>Нужно внимание:</b> ${iss.map(i=>`<button type="button" class="linkbtn" data-pub-go="${i.go}"${i.fl?` data-pub-fl="${i.fl}"`:''}>${esc(i.t)}</button>`).join('<span class="faint"> · </span>')}</span>${PGT('state','Нужно внимание')?tipI(PGT('state','Нужно внимание')):''}</div>`
    :`<div class="pub-state ok" role="status">${ic('ok')}<span>${esc(PGT('state','Всё в порядке')||'Всё в порядке: просроченных отчётов и долгов нет')}</span></div>`;
  // «Главное» — плитки-итоги; нажатие открывает раздел
  const tile=(go,key,lbl,val,sub,cls='')=>`<button type="button" class="pub-tile ${cls}" data-pub-go="${go}" title="${esc(PGT('main',key))}"><span class="pub-tl">${lbl}</span><span class="pub-tv">${val}</span>${sub?`<span class="pub-ts">${sub}</span>`:''}</button>`;
  const T1=[],cyr=all.filter(r=>r.due.slice(0,4)===cy);
  if(has('reports')){const n=cyr.filter(isSub).length,pc=cyr.length?Math.round(n/cyr.length*100):0,nx=all.find(r=>fk(r)==='next');
    T1.push(tile('reports','Отчёты',`Отчёты ${cy}: сдано`,`${n}<small> из ${cyr.length}</small>`,`<span class="bar" role="progressbar" aria-label="Сдано отчётов" aria-valuemin="0" aria-valuemax="${cyr.length}" aria-valuenow="${n}"><i style="width:${pc}%"></i></span>${late.length?`<span class="red strong">${ic('alert','sm')}${plural(late.length,'просрочен','просрочено','просрочено')} ${late.length}</span>`:''}`));
    T1.push(tile('reports','Ближайший срок','Ближайший срок',nx?`до ${fmtD(nx.due)}`:'—',nx?esc(`${T[nx.t].name} за ${nx.phuman.replace(/^[А-ЯЁ]/,x=>x.toLowerCase())}`):'Ближайших сроков нет'))}
  const sr=cyr.filter(r=>T[r.t].sum&&r.sum>0);
  if((has('reports')||M)&&sr.length){const s=k=>sr.reduce((a,r)=>a+(r[k]||0),0);const f3=[['к уплате',s('sum')],...(tp?[['получено',s('got')],['оплачено',s('paid')]]:[])];
    T1.push(tile(M?'money':'reports','Налоги',`Налоги ${cy}, сом`,`<span class="pub-t3">${f3.map(([l,v])=>`<span><small>${l}</small><b>${pubM(v)}</b></span>`).join('')}</span>`,'','wide'))}
  if(fee){const till=pubFeeTill(c);T1.push(c.feeDebt>0?tile('fee','Обслуживание','Обслуживание: долг',`${pubM(c.feeDebt)}<small> сом</small>`,'','bad'):tile('fee','Обслуживание',till?'Обслуживание оплачено по':'Обслуживание',till?esc(ymLabel(till)):'долга нет',''))}
  const nw=T1.filter(t=>!/pub-tile (wide|bad wide)/.test(t)).length;if(nw%2)T1[T1.length-1]=T1[T1.length-1].replace('class="pub-tile ','class="pub-tile wide ');
  if(T1.length)H.main=pubSec('main','home','Главное','',`<div class="pub-tiles">${T1.join('')}</div>`,{fold:false});
  // «Как оплатить» — налоги: основной реквизит ответственного бухгалтера или основной счёт организации для налогов, смотря что выбрано у контрагента
  if(has('pay')){const P=[];
    if(tp){const h=c.paysTo==='emp'?EM[c.resp]:null,ws=h&&h.wallets||[],a=c.paysTo==='org'?orgMain('tax'):ws.find(w=>w.main)||ws[0];if(a)P.push(pubPay('tax','Налоги','wallet',a,c.paysTo==='org'))}
    if(fee){const a=orgMain('fee');if(a)P.push(pubPay('fee','Обслуживание','coins',a,true))}
    if(P.length)H.pay=pubSec('pay','wallet','Как оплатить','',`<div class="pub-pays">${P.join('')}</div>`,{fold:false})}
  H.acc=pubSec('acc','user','Ваш бухгалтер',e?esc(e.fio):'',e?`<div class="pub-person"><b>${esc(e.fio)}</b><span class="hint">${esc(role(e))}</span>${e.phone&&e.phone.digits?`<span class="mono">${esc(fmtPhone(e.phone))}</span>`:''}</div><div class="row">${tel(e.phone)}</div>`:`<span class="faint">Бухгалтер пока не назначен. Позвоните в ${esc(ORG.name)}${ORG.phone&&ORG.phone.digits?`: <a class="mono" href="tel:+${ORG.phone.digits}">${esc(fmtPhone(ORG.phone))}</a>`:''}</span>`);
  // «Отчёты» — плитки по видам отчётов (или группы по месяцам срока), плашки — фильтры
  if(has('reports')){const ys=[...new Set([cy,...all.map(r=>r.due.slice(0,4))])].sort().reverse(),y=ys.includes(PUB.y)?PUB.y:cy;
    const yr=all.filter(r=>r.due.slice(0,4)===y),cnt={sub:0,next:0,late:0};yr.forEach(r=>cnt[fk(r)]++);const f=PUB.f,vis=yr.filter(r=>!f||fk(r)===f);
    const pl=(k,icon,color,label)=>`<button type="button" class="plate${f===k?' on':''}" data-pub-f="${k}" aria-pressed="${f===k}" title="${esc(PGT('report',label))}"><span class="pl-top"><span class="pl-dot ${color}">${ic(icon)}</span>${label}</span><span class="pl-val">${cnt[k]}</span></button>`;
    const row=(r,wt)=>{const t=T[r.t],st=pubSt(r),lt=fk(r)==='late';
      return `<div class="pub-row${lt?' late':''}"><div class="pub-r1">${wt?`<b title="${esc(t.name)}">${esc(t.short)}</b><span class="faint">·</span>`:''}<span>${esc(r.phuman)}</span><span class="grow"></span>${pubTp(pill(st,ST),PGT('report',st))}</div>
        <div class="pub-r2"><span class="${lt?'red strong':''}">${lt?ic('alert','sm'):''}срок ${fmtD(r.due)}</span>${st==='Сдан'&&r.subDate?`<span>сдан ${fmtD(r.subDate)}</span>`:''}${t.sum?`<span>${r.sum!=null?`к уплате <b class="tnum">${pubM(r.sum)}</b>`:'<span class="faint">сумма ещё не рассчитана</span>'}</span>${tp&&r.sum>0?pubTp(pill(r.payStatus,PST),PGT('taxPay',r.payStatus)):''}`:''}</div>
        ${(r.files||[]).length?`<div class="pub-files">${r.files.map(n=>`<a href="#" class="pub-file" data-pub-file="${esc(n)}">${ic('download','sm')}${esc(n)}</a>`).join('')}</div>`:''}</div>`};
    let list;
    if(PUB.mode==='due'){const ms=[...new Set(vis.map(r=>ym(r.due)))].sort(),op=PUB.rm||new Set([ms.find(m=>m>=ym(TODAY))||ms[ms.length-1]]);
      list=ms.map(m=>{const rs=vis.filter(r=>ym(r.due)===m),l=rs.filter(r=>fk(r)==='late').length,o=op.has(m);
        return `<div class="pub-grp${o?' open':''}"><button type="button" class="pub-gh" data-pub-rm="${m}" aria-expanded="${o}"><span class="pub-rt1"><b>${esc(ymLabel(m))}</b><span class="hint">${rs.length} ${plural(rs.length,'отчёт','отчёта','отчётов')}</span>${l?`<span class="red strong">${ic('alert','sm')}${plural(l,'просрочен','просрочено','просрочено')} ${l}</span>`:''}<span class="grow"></span>${ic('down','sm')}</span></button><div class="pub-gb pub-list">${rs.map(r=>row(r,true)).join('')}${pubMore(rs.length)}</div></div>`}).join('')}
    else{const soon=addDays(TODAY,30),rk=id=>{const rs=yr.filter(r=>r.t===id);return rs.some(r=>fk(r)==='late')?0:rs.some(r=>fk(r)==='next'&&r.due<=soon)?1:2};
      const ts=[...new Set(vis.map(r=>r.t))].sort((a,b)=>rk(a)-rk(b)||RT.indexOf(T[a])-RT.indexOf(T[b]));
      list=`<div class="pub-list pub-rts">${ts.map(id=>{const t=T[id],rs=vis.filter(r=>r.t===id),ty=yr.filter(r=>r.t===id),n=ty.filter(isSub).length,l=ty.filter(r=>fk(r)==='late').length,nx=ty.find(r=>fk(r)==='next'),o=PUB.rt.has(id),nt=pubNote(t);
        return `<div class="pub-rt${o?' open':''}${l?' late':''}" data-rt="${esc(id)}"><button type="button" class="pub-gh" data-pub-rt="${esc(id)}" aria-expanded="${o}">
          <span class="pub-rt1"><b title="${esc(t.name)}">${esc(t.short)}</b>${t.organ?`<span class="pill sm">${esc(t.organ)}</span>`:''}<span class="hint">${esc(pubPer(t))}</span><span class="grow"></span>${ic('down','sm')}</span>
          ${nt?`<span class="pub-rt2">${esc(nt)}</span>`:''}
          <span class="pub-rt3"><b>сдано ${n} из ${ty.length}</b>${l?`<span class="red strong">${ic('alert','sm')}${plural(l,'просрочен','просрочено','просрочено')} ${l}</span>`:''}${nx?`<span>следующий срок ${fmtD(nx.due)}</span>`:n===ty.length?`<span class="green">${ic('check','sm')}всё сдано</span>`:''}</span></button>
          <div class="pub-gb pub-list">${rs.map(r=>row(r,false)).join('')}${pubMore(rs.length)}</div></div>`}).join('')}${pubMore(ts.length)}</div>`}
    H.reports=pubSec('reports','file','Отчёты',`сдано ${cnt.sub} из ${yr.length}${cnt.late?` · ${cnt.late} ${plural(cnt.late,'просрочен','просрочено','просрочено')}`:''}`,
      `<div class="plates pub-pl">${pl('sub','check','green','Сдано')}${pl('next','clock','blue','Впереди')}${pl('late','alert',cnt.late?'red':'green','Просрочено')}</div>
      <div class="pub-tools"><div class="chipsel" role="group" aria-label="Как показать отчёты">${[['type','По видам'],['due','По срокам']].map(([k,l])=>`<button type="button" data-pub-mode="${k}" class="${PUB.mode===k?'on':''}" aria-pressed="${PUB.mode===k}">${l}</button>`).join('')}</div>${f?`<button type="button" class="linkbtn" data-pub-f="${f}">${ic('x','sm')}Показать все</button>`:''}</div>
      ${vis.length?list:`<span class="faint">${f?`Отчётов с отметкой «${{sub:'Сдано',next:'Впереди',late:'Просрочено'}[f]}» в ${y} году нет`:`Отчётов со сроком в ${y} году нет`}</span>`}`,
      {extra:sel('pub-y',ys.map(x=>[x,x+' год']),y,'aria-label="Год срока сдачи"')})}
  if(M){const v=M.diff<0?['short','alert','Недостача',som(-M.diff)]:M.diff===0?['ok','ok','Достаточно',som(0)]:M.needSum?['ok','ok','Достаточно, излишек','+'+som(M.diff)]:['over','info','Излишек','+'+som(M.diff)];
    const kv=(l,key,val)=>`<div><span class="k">${l}${PGT('money',key)?tipI(PGT('money',key)):''}</span><span class="v tnum">${val}</span></div>`;
    H.money=pubSec('money','wallet','Деньги на налоги',M.diff<0?`недостача ${som(-M.diff)}`:v[2].toLowerCase(),
      `<div class="verdict ${v[0]}">${ic(v[1])}<span>${v[2]}</span>${PGT('money',v[2])?tipI(PGT('money',v[2])):''}<span class="big">${v[3]}</span></div>
      <div class="kv">${kv(`Нужно оплатить до ${fmtD(lastDay(M.pm))}`,'Нужно оплатить',`<b>${som(M.needSum)}</b>`)}${kv(`Поступило от вас в ${M.y0} году`,'Поступило от вас',som(M.got))}${kv(`Оплачено в бюджет в ${M.y0} году`,'Оплачено в бюджет',som(M.paid))}</div>
      ${M.need.length?`<div class="pub-list">${M.need.map(r=>{const lt=r.payDue<TODAY;return `<div class="pub-row${lt?' late':''}"><div class="pub-r1"><b>${esc(T[r.t].short)}</b><span class="faint">·</span><span>${esc(r.plabel)}</span><span class="grow"></span><b class="tnum">${som(r.sum-r.paid)}</b></div><div class="pub-r2"><span class="${lt?'red strong':''}">${lt?ic('alert','sm'):''}оплатить до ${fmtD(r.payDue)}</span></div></div>`}).join('')}${pubMore(M.need.length)}</div>`:'<span class="faint">Неоплаченных налогов в этом месяце нет</span>'}`)}
  if(fee){const ct=curTariff(c),ms=feeMonths(c).filter(m=>feeCharge(c,m)>0||c.feePaid[m]).reverse(),till=pubFeeTill(c);
    H.fee=pubSec('fee','coins','Оплата за обслуживание',c.feeDebt>0?`долг ${som(c.feeDebt)}`:till?`оплачено по ${ymLabel(till).toLowerCase()}`:'',
      `<div class="kv"><div><span class="k">Текущая ставка${PGT('fee','Текущая ставка')?tipI(PGT('fee','Текущая ставка')):''}</span><span class="v tnum">${ct?`${som(ct.amount)} ${ct.per==='Y'?'в год':'в месяц'}<div class="hint">оплата до ${c.feeDay}-го числа</div>`:'—'}</span></div><div><span class="k">Долг${PGT('fee','Долг')?tipI(PGT('fee','Долг')):''}</span><span class="v tnum ${c.feeDebt?'red strong':''}">${som(c.feeDebt)}</span></div></div>
      ${ms.length?`<div class="pub-list">${ms.map(m=>{const ch=feeCharge(c,m),p=feeGot(c,m),stx=p>=ch?'Оплачено':p>0?'Оплачено частично':'Не оплачено';return `<div class="pub-row"><div class="pub-r1"><span>${esc(ymLabel(m))}</span><span class="grow"></span>${pubTp(pill(stx,PST),PGT('fee',stx))}</div><div class="pub-r2"><span>начислено <b class="tnum">${som(ch)}</b></span><span>оплачено <b class="tnum">${som(p)}</b></span></div></div>`}).join('')}${pubMore(ms.length)}</div>`:''}
      ${H.pay&&H.pay.includes('data-pay="fee"')?`<button type="button" class="linkbtn" data-pub-go="pay">${ic('wallet','sm')}Реквизиты для оплаты — в разделе «Как оплатить»</button>`:''}`)}
  // «Показатели» — плитка на показатель: итог за год крупно и мини-график, значения по месяцам раскрываются по нажатию
  if(has('kpi')){const inds=IND.filter(i=>!i.archived&&kOn(i,c)).sort((a,b)=>(a.order||0)-(b.order||0));const ys=[...new Set([cy,...IVALS.filter(v=>v.cp===c.id).map(v=>v.m.slice(0,4))])].sort().reverse(),y=ys.includes(PUB.ky)?PUB.ky:cy;
    const m12=Array.from({length:12},(_,i)=>`${y}-${String(i+1).padStart(2,'0')}`),ms=m12.filter(m=>m<=ym(TODAY)),v=(i,m)=>{const x=kVal(c.id,i.id,m);return x?x.v:null};
    H.kpi=pubSec('kpi','gauge','Показатели',inds.length?`${inds.length} ${plural(inds.length,'показатель','показателя','показателей')}`:'',
      inds.length&&ms.length?`<div class="pub-ks">${inds.map(i=>{const a=kAgg(ms.map(m=>v(i,m))),k=i.main||'sum',o=PUB.ki.has(i.id);
        return `<div class="pub-k${o?' open':''}"><button type="button" class="pub-gh" data-pub-ki="${esc(i.id)}" aria-expanded="${o}"><span class="pub-rt1"><b>${esc(i.name)}</b>${i.unit?`<span class="hint">${esc(i.unit)}</span>`:''}<span class="grow"></span>${ic('down','sm')}</span><span class="pub-kv">${a.n?kNum(i,Math.round(a[k]*100)/100):'—'}</span><span class="hint">${esc((KAGG[k]||'').toLowerCase())} за ${y} год</span>${pubSpark(i,m12,m12.map(m=>m<=ym(TODAY)?v(i,m):undefined))}</button>
          <div class="pub-gb pub-list">${ms.slice().reverse().map(m=>{const x=v(i,m);return `<div class="pub-row"><div class="pub-r1"><span>${esc(ymLabel(m))}</span><span class="grow"></span><b class="tnum">${x==null?'<span class="faint">—</span>':kNum(i,x)}</b></div></div>`}).join('')}${pubMore(ms.length)}</div></div>`}).join('')}</div>`:'<span class="faint">Показателей за этот год нет</span>',
      {extra:sel('pub-ky',ys.map(x=>[x,x+' год']),y,'aria-label="Год показателей"')})}
  if(has('contacts')){const ids=[c.resp,...c.assign.filter(a=>!a.to&&a.resp).map(a=>a.resp)].filter((x,i,a)=>x&&EM[x]&&EM[x].active!==false&&a.indexOf(x)===i);
    const what=id=>{const ts=c.assign.filter(a=>!a.to&&(a.resp||c.resp)===id).map(a=>T[a.t]&&T[a.t].short).filter(Boolean);return id===c.resp?'ответственный'+(ts.length?' · '+ts.join(', '):''):ts.join(', ')};
    H.contacts=pubSec('contacts','users','Контакты',ids.length?`${ids.length} ${plural(ids.length,'сотрудник','сотрудника','сотрудников')}`:'',`<div class="pub-people">${ids.map(id=>person(EM[id],`${role(EM[id])} · ${what(id)}`)).join('')}${ORG.phone&&ORG.phone.digits?`<div class="pub-person"><b>${esc(ORG.name)}</b><span class="hint">телефон организации</span><a class="mono" href="tel:+${ORG.phone.digits}">${esc(fmtPhone(ORG.phone))}</a></div>`:''}</div>
      <h4>Ваши данные у нас</h4><div class="kv"><div><span class="k">Руководитель</span><span class="v">${esc(c.head||'—')}</span></div><div><span class="k">Контактное лицо</span><span class="v">${esc(c.contact||'—')}</span></div><div><span class="k">Телефон</span><span class="v mono">${esc(fmtPhone(c.phone)||'—')}</span></div></div><span class="hint">${esc(PGT('contacts','Ваши данные у нас')||'Если что-то устарело, сообщите вашему бухгалтеру.')}</span>`)}
  const logo=ORG.logo?`<img src="${ORG.logo}" alt="" class="pub-logo">`:`<span class="pub-logo">${esc(initials(ORG.name.replace(/^(ОсОО|ИП|ОАО|ЗАО)\s+/,'').replace(/[«»"]/g,'')))}</span>`;
  // На ПК две колонки; на телефоне разделы идут один под другим в порядке: «Главное», «Как оплатить», «Ваш бухгалтер», «Отчёты», «Деньги на налоги», «Оплата за обслуживание», «Показатели», «Контакты»
  const col=ks=>ks.map(k=>H[k]||'').join('');
  const nav=[['main','Главное','home'],['pay','Оплата','wallet'],['reports','Отчёты','file'],['kpi','Показатели','gauge'],['contacts','Контакты','users']].filter(([k])=>H[k]);
  return `<div class="pub-body"><header class="pub-h"><div class="pub-org">${logo}<span><b>${esc(ORG.name)}</b><span class="hint">ваша бухгалтерская компания</span></span></div><span class="hint">Данные на ${fmtD(TODAY)} ${bishkekNow().hm}${PGT('head','Данные на')?tipI(PGT('head','Данные на')):''}</span></header>
    <div class="pub-title"><h1>${esc(c.name)}</h1><span class="muted">ИНН <span class="mono">${c.inn}</span> · ${esc(c.regime?REGIME_FULL[c.regime]||c.regime:'режим налогообложения не указан')}</span></div>
    ${state}
    <div class="pub-grid"><div class="pub-col">${col(['main','reports','kpi'])}</div><div class="pub-col">${col(['pay','acc','money','fee','contacts'])}</div></div>
    ${nav.length>1?`<nav class="pub-nav" aria-label="Разделы страницы">${nav.map(([k,l,i])=>`<button type="button" data-pub-go="${k}">${ic(i)}<span>${l}</span></button>`).join('')}</nav>`:''}</div>`}

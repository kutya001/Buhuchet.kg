'use strict';
// Окно просмотра файлов (доработки 16.11.2026, блок 5): одно окно для «Файлового менеджера», блока «Файлы» записи, карточки контрагента,
// «Отправленных файлов» и страницы контрагента. Кнопки «Скачать», «На весь экран», «‹ ›» — соседние файлы того же списка; на телефоне —
// во весь экран, листание жестом. В прототипе у файлов нет содержимого: окно показывает пример по типу файла. В рабочей версии файл
// разбирается в браузере в изоляции: макросы и скрипты не выполняются, ссылки и внешние данные не загружаются, у XLSX, DOCX и PPTX —
// предел распаковки, у XML внешние сущности запрещены; просмотр ничего в файле не меняет и в историю не пишется.
// fileView(list, i, o): list — файлы {name, size, …}, i — открытый; o (всё необязательно): sub(f) — html подзаголовка, info(f) — html
// под просмотром, foot(f) — html кнопок после «Скачать» (без него — «Закрыть»), mount(el, m, f), dl(f) — «Скачать»
const FV_EXT={jpg:'img',jpeg:'img',png:'img',webp:'img',gif:'img',heic:'img',pdf:'pdf',xlsx:'xls',xls:'xls',csv:'xls',docx:'doc',pptx:'ppt',txt:'txt',log:'txt',xml:'xml',doc:'old',ppt:'old'};
const FV_ROWS=5000;// лист больше — первые 5 000 строк и «Скачайте, чтобы увидеть всё»
const fvKind=n=>FV_EXT[fext(n).toLowerCase()]||'none';
// Строки списка (ui/grid.js) в том порядке и с теми фильтрами, что сейчас на экране — для «‹ ›»
const fvGridRows=id=>{const g=[...ACTIVE].reverse().find(x=>x.cfg.id===id&&x.host.isConnected);return g&&g.rows};
// Повторяемый «случайный» ряд от имени файла: один и тот же файл всегда показывает одно и то же
function fvRnd(name){let h=2166136261;for(const ch of name)h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;return ()=>{h=Math.imul(h^(h>>>15),2246822507)>>>0;h=Math.imul(h^(h>>>13),3266489909)>>>0;return ((h^=h>>>16)>>>0)/4294967296}}
const fvBase=n=>n.replace(/\.[^.]+$/,'').replace(/_/g,' ');
const fvCol=c=>{let s='';c++;while(c>0){const m=(c-1)%26;s=String.fromCharCode(65+m)+s;c=Math.floor((c-1)/26)}return s};
const fvNum=(v,d=2)=>v.toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d});
const FV_FIO=['Абдыкадыров Н. Т.','Мамытова А. К.','Сыдыков Б. Э.','Иманалиева Ж. С.','Токтогулов Э. М.','Асанова Г. Р.','Жумабеков Т. А.','Осмонова Д. Б.','Кадыров С. У.','Бекова Н. Ж.','Исаев А. Р.','Чыныбаева М. О.'];
// Пример книги Excel: листы, ширина столбцов, объединённые ячейки, жирный шрифт, числа как в файле (формулы — значениями)
function fvBook(f){const R=fvRnd(f.name),csv=fext(f.name)==='CSV',cell=(v,x={})=>Object.assign({v},x);
  const tab=/табел/i.test(f.name);const n=8+Math.floor(R()*14);let tot=0;
  const rows=[[cell(tab?'Табель учёта рабочего времени':fvBase(f.name),{b:1})],[],[cell('№',{b:1}),cell(tab?'Сотрудник':'Наименование',{b:1}),cell(tab?'Должность':'Ед.',{b:1}),cell(tab?'Дней':'Кол-во',{b:1,r:1}),cell(tab?'Часов':'Цена',{b:1,r:1}),cell(tab?'Начислено':'Сумма',{b:1,r:1})]];
  for(let i=0;i<n;i++){const q=tab?18+Math.floor(R()*5):1+Math.floor(R()*40),p=tab?q*8:Math.round(R()*90000)/100+50,s=tab?Math.round(R()*6000000)/100+25000:q*p;tot+=s;
    rows.push([cell(i+1,{r:1}),cell(tab?FV_FIO[i%FV_FIO.length]:['Бумага А4','Картридж','Услуги связи','Аренда офиса','Канцтовары','Программа 1С','Обслуживание ККМ','Интернет'][i%8]),cell(tab?['Бухгалтер','Менеджер','Кассир','Водитель'][i%4]:i%3?'шт.':'усл.'),cell(q,{r:1}),cell(tab?String(p):fvNum(p),{r:1}),cell(fvNum(s),{r:1})])}
  rows.push([cell('',{}),cell('Итого',{b:1}),cell(''),cell(''),cell(''),cell(fvNum(tot),{b:1,r:1})]);
  const s1={name:csv?fvBase(f.name):tab?'Октябрь':'Лист1',cols:[50,230,130,80,90,120],rows:csv?rows.slice(2):rows,merge:csv?[]:[[0,0,1,6]]};
  if(csv)return [s1];
  const s2={name:'Справочник',cols:[60,240,110],rows:[[cell('Код',{b:1}),cell('Название',{b:1}),cell('Ставка',{b:1,r:1})],...[['01','НДС',' 12 %'],['02','НсП','2 %'],['03','Подоходный налог','10 %'],['04','Соцфонд','27,25 %']].map(r=>[cell(r[0]),cell(r[1]),cell(r[2].trim(),{r:1})])],merge:[]};
  // Третий лист больше предела: окно показывает первые 5 000 строк
  const big=12480,s3={name:'Журнал',cols:[70,110,260,120],big,rows:null,merge:[],make(){const r=fvRnd(f.name+'j'),o=[[cell('№',{b:1}),cell('Дата',{b:1}),cell('Операция',{b:1}),cell('Сумма',{b:1,r:1})]];
    for(let i=1;i<FV_ROWS;i++)o.push([cell(i,{r:1}),cell(`${String(1+i%28).padStart(2,'0')}.10.2026`),cell(['Оплата поставщику','Поступление от покупателя','Выдача под отчёт','Комиссия банка'][i%4]),cell(fvNum(Math.round(r()*5000000)/100),{r:1})]);return o}};
  return [s1,s2,s3]}
function fvSheet(sh,q){const rows=sh.rows||(sh.rows=sh.make()),w=Math.max(...rows.map(r=>r.length),sh.cols.length);const span={},skip={};
  sh.merge.forEach(([r,c,rs,cs])=>{span[r+':'+c]=[rs,cs];for(let a=r;a<r+rs;a++)for(let b=c;b<c+cs;b++)if(a!==r||b!==c)skip[a+':'+b]=1});
  const ql=q.toLowerCase();let hits=0;
  const body=rows.map((r,i)=>`<tr><th>${i+1}</th>${Array.from({length:w},(_,j)=>{if(skip[i+':'+j])return '';const c=r[j],sp=span[i+':'+j],v=c?String(c.v):'',hit=ql&&v.toLowerCase().includes(ql);if(hit)hits++;
    return `<td${sp?` rowspan="${sp[0]}" colspan="${sp[1]}"`:''} class="${c&&c.b?'b ':''}${c&&c.r?'num ':''}${hit?'hit':''}">${esc(v)}</td>`}).join('')}</tr>`).join('');
  return {hits,html:`<table class="fv-xl"><colgroup><col style="width:44px">${Array.from({length:w},(_,j)=>`<col style="width:${sh.cols[j]||90}px">`).join('')}</colgroup><thead><tr><th></th>${Array.from({length:w},(_,j)=>`<th>${fvCol(j)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`}}
// Пример документа Word: заголовки, абзацы, списки, таблица, картинка; без точной разбивки на страницы
function fvDocx(f){const R=fvRnd(f.name),dog=/догов/i.test(f.name),t=fvBase(f.name);
  const pr=[['Бухгалтерский учёт и подготовка отчётности',15000],['Сдача налоговой отчётности','входит'],['Кадровый учёт до 10 сотрудников',5000],['Консультации по налогам','входит']];
  return `<h1>${esc(dog?'Договор № 15 на бухгалтерское обслуживание':t)}</h1><p class="fv-r">г. Бишкек · ${1+Math.floor(R()*27)} октября 2026 г.</p>
  <p>ОсОО «Тоо-Сервис Учёт», именуемое в дальнейшем «Исполнитель», в лице директора, действующего на основании Устава, с одной стороны, и <b>Заказчик</b>, с другой стороны, заключили настоящий договор о нижеследующем.</p>
  <h2>1. Предмет договора</h2><p>Исполнитель оказывает Заказчику услуги по ведению бухгалтерского и налогового учёта, а Заказчик принимает и оплачивает их.</p>
  <ol><li>Ведение бухгалтерского учёта по данным Заказчика.</li><li>Подготовка и сдача налоговой отчётности в ГНС и Соцфонд.</li><li>Консультации по вопросам налогообложения.</li></ol>
  <h2>2. Стоимость услуг</h2><table><thead><tr><th>Услуга</th><th class="num">Сом в месяц</th></tr></thead><tbody>${pr.map(([a,b])=>`<tr><td>${esc(a)}</td><td class="num">${typeof b==='number'?fvNum(b,0):esc(b)}</td></tr>`).join('')}</tbody></table>
  <h2>3. Обязанности сторон</h2><ul><li>Заказчик передаёт первичные документы до 5 числа следующего месяца.</li><li>Исполнитель сдаёт отчётность в установленные сроки.</li></ul>
  <div class="fv-pic" aria-label="Картинка из документа">${ic('image')}<span>Печать и подпись</span></div><p class="fv-r"><i>Директор ____________ / подпись</i></p>`}
// Пример презентации: слайды по одному, текст и картинки; точный вид, как в PowerPoint, не обещаем
function fvSlides(f){const t=fvBase(f.name);return [
  `<div class="fv-s0"><b>${esc(t)}</b><span>Итоги квартала · октябрь 2026</span></div>`,
  `<div class="fv-sl"><b>Что сделано</b><ul><li>Сданы все отчёты за III квартал</li><li>Подключены 12 новых контрагентов</li><li>Напоминания о сроках — в Telegram</li></ul></div>`,
  `<div class="fv-sl"><b>Поступления по месяцам</b><div class="fv-bars">${[62,78,71,90].map((h,i)=>`<i style="height:${h}%"><span>${['Июль','Авг.','Сент.','Окт.'][i]}</span></i>`).join('')}</div></div>`,
  `<div class="fv-s0"><b>Спасибо!</b><span>Вопросы — бухгалтеру</span></div>`]}
// Пример текста: кодировка UTF-8 или Windows-1251 определяется сама
function fvText(f){const log=fext(f.name)==='LOG',R=fvRnd(f.name);
  const lines=log?Array.from({length:24},(_,i)=>`2026-10-${String(1+i%28).padStart(2,'0')} ${String(8+i%10).padStart(2,'0')}:${String(Math.floor(R()*60)).padStart(2,'0')}:12  ${['INFO ','INFO ','WARN ','ERROR'][Math.floor(R()*4)]} ${['Выгрузка выписки банка','Отчёт ЕН принят ГНС','Повтор отправки в Соцфонд','Нет связи с сервером ГНС, повтор через 5 мин'][i%4]}`)
    :['Пояснение к декларации по единому налогу','','В октябре 2026 года выручка снизилась в связи с сезонным','спадом продаж. Расходы на аренду не изменились.','','Главный бухгалтер: Мамытова А. К.','Тел.: +996 555 12-34-56'];
  return {enc:R()<.5?'Windows-1251':'UTF-8',lines}}
// Пример XML (отчёт для ГНС): отступы, сворачивание веток, поиск
function fvXml(f){const R=fvRnd(f.name),rows=Array.from({length:4},(_,i)=>({t:'Row',a:{n:String(i+1)},c:[{t:'Code',x:String(110+i*10)},{t:'Name',x:['Выручка от реализации','Прочие доходы','Налоговая база','Сумма налога'][i]},{t:'Amount',x:fvNum(Math.round(R()*90000000)/100).replace(/\s/g,'')}]}));
  return {t:'Report',a:{form:'STI-150',version:'4.2',period:'2026-10'},c:[{t:'Header',c:[{t:'TIN',x:'02512201510047'},{t:'Name',x:'ОсОО «Ала-Тоо Трейд»'},{t:'Tax',x:'ЕН'}]},{t:'Rows',c:rows},{t:'Signer',a:{role:'director'},x:'Абдыкадыров Н. Т.'}]}}
function fvXmlHtml(n,id='x'){const at=Object.entries(n.a||{}).map(([k,v])=>` <span class="xa">${esc(k)}</span>=<span class="xv">"${esc(v)}"</span>`).join('');
  if(!n.c)return `<div class="xl"><span class="xt">&lt;${esc(n.t)}</span>${at}<span class="xt">&gt;</span>${esc(n.x||'')}<span class="xt">&lt;/${esc(n.t)}&gt;</span></div>`;
  return `<div class="xn" data-xn="${id}"><button type="button" class="xf" aria-expanded="true" aria-label="Свернуть ${esc(n.t)}">▾</button><span class="xt">&lt;${esc(n.t)}</span>${at}<span class="xt">&gt;</span><div class="xc">${n.c.map((c,i)=>fvXmlHtml(c,id+'-'+i)).join('')}</div><span class="xt">&lt;/${esc(n.t)}&gt;</span></div>`}
// Пример картинки или скана: лист с чеком
function fvPic(f){const R=fvRnd(f.name);return `<svg viewBox="0 0 300 400" class="fv-svg" role="img" aria-label="${esc(f.name)}"><rect width="300" height="400" rx="6" fill="#fdfcf7" stroke="#d8d4c4"/><text x="150" y="44" text-anchor="middle" font-size="16" font-weight="700" fill="#333">${esc(fvBase(f.name).slice(0,26))}</text>${Array.from({length:11},(_,i)=>`<rect x="30" y="${76+i*24}" width="${120+Math.floor(R()*110)}" height="8" rx="4" fill="#cfcabb"/>`).join('')}<circle cx="226" cy="352" r="30" fill="none" stroke="#5a6fc4" stroke-width="3" opacity=".7"/></svg>`}
function fvPdf(f){const R=fvRnd(f.name),n=1+Math.floor(R()*3);return {n,html:Array.from({length:n},(_,p)=>`<div class="fv-pg" data-pg="${p+1}"><b>${p?'':esc(fvBase(f.name))}</b>${Array.from({length:p?22:18},()=>`<i style="width:${45+Math.floor(R()*50)}%"></i>`).join('')}<span class="fv-pn">${p+1}</span></div>`).join('')}}
function fileView(list,i,o={}){list=list&&list.length?list:[];if(!list.length)return;let k=Math.max(0,Math.min(i|0,list.length-1));let st={};const reset=()=>{st={z:1,r:0,sh:0,sl:0,q:'',book:null}};reset();
  const go=d=>{const nk=k+d;if(nk<0||nk>=list.length)return;k=nk;reset();m.draw()};
  const dl=f=>o.dl?o.dl(f):toast('Скачивание: '+f.name,'download');
  const view=f=>{const kind=fvKind(f.name),zoom=`<button class="icon-btn sm" data-fz="-1" aria-label="Уменьшить">−</button><span class="fv-zv">${Math.round(st.z*100)} %</span><button class="icon-btn sm" data-fz="1" aria-label="Увеличить">+</button>`;
    if(kind==='img')return `<div class="fv-bar">${zoom}<button class="btn sm ghost" data-frot>${ic('refresh','sm')}Повернуть</button><button class="btn sm ghost" data-ffit>Вписать</button></div><div class="fv-scroll fv-img"><div style="transform:scale(${st.z}) rotate(${st.r}deg)">${fvPic(f)}</div></div>`;
    if(kind==='pdf'){const p=fvPdf(f);return `<div class="fv-bar">${zoom}<span class="hint">${p.n} ${plural(p.n,'страница','страницы','страниц')}</span></div><div class="fv-scroll fv-pdf"><div style="zoom:${st.z}">${p.html}</div></div>`}
    if(kind==='xls'){const b=st.book||(st.book=fvBook(f)),sh=b[st.sh],t=fvSheet(sh,st.q);
      return `<div class="fv-bar"><input class="inp sm fv-q" id="fv-q" type="search" placeholder="Найти на листе" value="${esc(st.q)}" aria-label="Найти на листе">${st.q?`<span class="hint">${t.hits?`Найдено: ${t.hits}`:'Ничего не найдено'}</span>`:''}</div><div class="fv-scroll fv-grid">${t.html}</div>${sh.big?`<div class="fv-more">${ic('info','sm')}Показаны первые ${fvNum(FV_ROWS,0)} строк из ${fvNum(sh.big,0)} — скачайте файл, чтобы увидеть всё</div>`:''}${b.length>1?`<div class="fv-tabs" role="tablist">${b.map((s,j)=>`<button type="button" role="tab" aria-selected="${j===st.sh}" data-fsh="${j}">${esc(s.name)}</button>`).join('')}</div>`:''}`}
    if(kind==='doc')return `<div class="fv-scroll fv-doc"><div class="fv-paper kb-art">${fvDocx(f)}</div></div>`;
    if(kind==='ppt'){const s=fvSlides(f);return `<div class="fv-bar"><button class="icon-btn sm" data-fsl="-1" aria-label="Предыдущий слайд" ${st.sl?'':'disabled'}>${ic('left','sm')}</button><span class="fv-zv">Слайд ${st.sl+1} из ${s.length}</span><button class="icon-btn sm" data-fsl="1" aria-label="Следующий слайд" ${st.sl<s.length-1?'':'disabled'}>${ic('right','sm')}</button></div><div class="fv-scroll fv-ppt"><div class="fv-slide">${s[st.sl]}</div></div>`}
    if(kind==='txt'){const t=fvText(f);return `<div class="fv-bar"><span class="hint">Кодировка: ${t.enc} · определена автоматически</span></div><div class="fv-scroll fv-txt"><pre>${t.lines.map((l,j)=>`<span class="ln">${j+1}</span>${esc(l)}`).join('\n')}</pre></div>`}
    if(kind==='xml')return `<div class="fv-bar"><input class="inp sm fv-q" id="fv-q" type="search" placeholder="Найти в XML" value="${esc(st.q)}" aria-label="Найти в XML"><span class="hint" id="fv-qn"></span><div class="grow"></div><button class="btn sm ghost" data-fxa="0">Свернуть всё</button><button class="btn sm ghost" data-fxa="1">Развернуть всё</button></div><div class="fv-scroll fv-xml"><div class="xl xpi">&lt;?xml version="1.0" encoding="windows-1251"?&gt;</div>${fvXmlHtml(fvXml(f))}</div>`;
    return `<div class="state fv-none">${ic('file','lg')}<b>${kind==='old'?`Старый формат ${esc(fext(f.name))} — просмотр недоступен`:'Предпросмотр недоступен'}</b><span>${kind==='old'?`Скачайте файл и откройте его в ${fext(f.name)==='DOC'?'Word':'PowerPoint'}`:'Скачайте файл, чтобы открыть его'}</span><button class="btn cta" data-fdl>${ic('download','sm')}Скачать</button></div>`};
  // ← и → на ПК — соседний файл, пока это окно сверху и курсор не в поле
  const key=e=>{if(MODALS[MODALS.length-1]!==m||(e.target.closest&&e.target.closest('input,textarea,select')))return;if(e.key==='ArrowLeft')go(-1);if(e.key==='ArrowRight')go(1)};
  const m=openModal({size:'wide fv-m',onClose:()=>document.removeEventListener('keydown',key),render:()=>{const f=list[k],n=list.length;
    return {title:esc(f.name),sub:o.sub?o.sub(f):`${esc(fext(f.name))} · ${fmtSize(f.size??fsize(f.name))}`,
      head:n>1?`<div class="fv-nav"><button class="icon-btn" data-fgo="-1" aria-label="Предыдущий файл" title="Предыдущий файл" ${k?'':'disabled'}>${ic('left')}</button><span class="fv-n">${k+1} из ${n}</span><button class="icon-btn" data-fgo="1" aria-label="Следующий файл" title="Следующий файл" ${k<n-1?'':'disabled'}>${ic('right')}</button></div>`:'',
      body:`<div class="fv" data-fv="${fvKind(f.name)}">${view(f)}</div>${o.info?o.info(f):''}`,
      foot:`<button class="btn" id="fv-dl">${ic('download','sm')}Скачать</button>${o.foot?o.foot(f):'<div class="grow"></div><button class="btn cta" data-close>Закрыть</button>'}`,
      mount(el,mm){const f=list[k];$('#fv-dl',el).onclick=()=>dl(f);$$('[data-fdl]',el).forEach(b=>b.onclick=()=>dl(f));
        $$('[data-fgo]',el).forEach(b=>b.onclick=()=>go(+b.dataset.fgo));
        $$('[data-fz]',el).forEach(b=>b.onclick=()=>{st.z=Math.min(4,Math.max(.25,Math.round((st.z+(+b.dataset.fz)*.25)*100)/100));mm.draw()});
        const rot=$('[data-frot]',el);if(rot)rot.onclick=()=>{st.r=(st.r+90)%360;mm.draw()};const fit=$('[data-ffit]',el);if(fit)fit.onclick=()=>{st.z=1;st.r=0;mm.draw()};
        $$('[data-fsh]',el).forEach(b=>b.onclick=()=>{st.sh=+b.dataset.fsh;mm.draw()});
        $$('[data-fsl]',el).forEach(b=>b.onclick=()=>{st.sl+=+b.dataset.fsl;mm.draw()});
        const q=$('#fv-q',el);if(q&&fvKind(f.name)==='xls'){q.onkeydown=e=>{if(e.key==='Enter'){st.q=q.value.trim();mm.draw();const h=$('.fv-grid td.hit',mm.el);if(h)h.scrollIntoView({block:'center',inline:'center'});const q2=$('#fv-q',mm.el);q2&&q2.focus()}};q.onsearch=()=>{if(!q.value&&st.q){st.q='';mm.draw()}}}
        if(q&&fvKind(f.name)==='xml')q.oninput=()=>{const s=q.value.trim().toLowerCase();let n=0;$$('.fv-xml .hit',el).forEach(x=>x.classList.remove('hit'));
          if(s)$$('.fv-xml .xl,.fv-xml .xn',el).forEach(x=>{const own=x.classList.contains('xl')?x.textContent:[...x.childNodes].filter(c=>!c.classList||!c.classList.contains('xc')).map(c=>c.textContent).join('');if(!own.toLowerCase().includes(s))return;n++;x.classList.add('hit');let p=x.parentElement.closest('.xn');while(p){p.classList.remove('off');p.querySelector(':scope>.xf').setAttribute('aria-expanded','true');p=p.parentElement.closest('.xn')}});
          $('#fv-qn',el).textContent=s?(n?`Найдено: ${n}`:'Ничего не найдено'):''};
        $$('.fv-xml .xf',el).forEach(b=>b.onclick=()=>{const x=b.parentElement,off=x.classList.toggle('off');b.setAttribute('aria-expanded',String(!off));b.setAttribute('aria-label',(off?'Развернуть ':'Свернуть ')+x.querySelector('.xt').textContent.slice(1))});
        $$('[data-fxa]',el).forEach(b=>b.onclick=()=>$$('.fv-xml .xn',el).forEach(x=>{const on=b.dataset.fxa==='1';x.classList.toggle('off',!on&&x.parentElement.closest('.xn')!==null);x.querySelector(':scope>.xf').setAttribute('aria-expanded',String(!x.classList.contains('off')))}));
        // Листание жестом на телефоне: вбок по просмотру — соседний файл (у слайдов — соседний слайд), если просмотр сам не прокручивается в ту сторону
        const fv=$('.fv',el);let t0=null;fv.addEventListener('touchstart',e=>{const t=e.touches[0];t0=e.touches.length===1?{x:t.clientX,y:t.clientY,el:e.target}:null},{passive:true});
        fv.addEventListener('touchend',e=>{if(!t0)return;const t=e.changedTouches[0],dx=t.clientX-t0.x,dy=t.clientY-t0.y,src=t0.el;t0=null;if(Math.abs(dx)<70||Math.abs(dy)>Math.abs(dx)*.6)return;
          for(let s=src;s&&s!==fv;s=s.parentElement){if(s.scrollWidth>s.clientWidth+2&&(dx<0?s.scrollLeft+s.clientWidth<s.scrollWidth-2:s.scrollLeft>2))return}
          const d=dx<0?1:-1;if(fvKind(f.name)==='ppt'){const nn=fvSlides(f).length;if(st.sl+d>=0&&st.sl+d<nn){st.sl+=d;mm.draw();return}}go(d)});
        if(o.mount)o.mount(el,mm,f)}}}});
  document.addEventListener('keydown',key);return m}

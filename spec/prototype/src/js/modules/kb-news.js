'use strict';
// База знаний: вкладка «Новости»
/* ═════════════ База знаний: «Новости» (ведёт администратор платформы) ═════════════ */
const NEWS_T={'Обновление':'blue','Нововведение':'green','Исправление':'orange','Объявление':'purple'};
const NEWS_ST=['Черновик','Опубликовано'];
const NEWS=DB.ref.news;
// Новому пользователю прочитанными считаются новости версий прототипа v1–v28 (целые номера), а не любые с номером меньше 29: «1.4» — новая версия
const NEWS_READ=dbSets(DB.newsRead);const newsRead=u=>NEWS_READ[u||S.me]=NEWS_READ[u||S.me]||new Set(NEWS.filter(n=>/^\d+$/.test(n.ver||'')&&+n.ver<=28).map(n=>n.id));
const newsLive=n=>n.status==='Опубликовано'&&!n.off&&(n.date<TODAY||(n.date===TODAY&&bishkekNow().hm>='09:00'));
const newsVis=()=>NEWS.filter(n=>newsLive(n)&&(n.aud==='all'||isAdmin()));
const newsUnread=()=>{const r=newsRead();return newsVis().filter(n=>!r.has(n.id)).length};
const newsPill=t=>`<span class="pill sm ${NEWS_T[t]||'blue'}">${esc(t)}</span>`;
const newsLinkTxt=l=>!l?'':l.k==='art'?((KB_ARTS.find(a=>a.id===l.id)||{}).t||''):kbModT(l.id);
/* Markdown подробного описания (ТЗ, «База знаний (содержимое)» → «Новости»): заголовки двух уровней, жирный и курсив, списки,
   ссылки (в том числе на модуль #mod:id, его вкладку #mod:id.вкладка и статью #art:id), картинки, цитата, разделитель, простая таблица; HTML не выполняется */
function mdInline(t){return esc(t).replace(/`([^`]+)`/g,'<code>$1</code>')
  .replace(/!\[([^\]]*)\]\(((?:https?:|data:image\/)[^)\s]+)\)/g,'<img src="$2" alt="$1">')
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(x,a,h)=>{const m=/^#(mod|art):([\w-]+(?:\.[\w-]+)?)$/.exec(h);if(m)return `<a href="#" data-md${m[1]}="${m[2]}">${a}</a>`;return /^https?:/.test(h)?`<a href="${h}" target="_blank" rel="noopener">${a}</a>`:a})
  .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/(^|[\s(«])[*_]([^*_\s][^*_]*?)[*_](?=[\s.,;:!?)»]|$)/g,'$1<i>$2</i>')}
function mdHtml(src){const L=String(src||'').replace(/\r/g,'').split('\n');let h='',i=0;
  const cells=l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
  while(i<L.length){const l=L[i];let m;
    if(!l.trim()){i++;continue}
    if(m=/^(#{1,2})\s+(.*)$/.exec(l)){h+=m[1].length===1?`<h4>${mdInline(m[2])}</h4>`:`<h5>${mdInline(m[2])}</h5>`;i++;continue}
    if(/^\s*(-{3,}|\*{3,})\s*$/.test(l)){h+='<hr>';i++;continue}
    if(/^>\s?/.test(l)){let q=[];while(i<L.length&&/^>\s?/.test(L[i]))q.push(L[i++].replace(/^>\s?/,''));h+=`<blockquote>${mdInline(q.join(' '))}</blockquote>`;continue}
    if(/^\s*\|/.test(l)&&i+1<L.length&&/^\s*\|?\s*:?-{2,}/.test(L[i+1])){const hd=cells(l);i+=2;let rows=[];while(i<L.length&&/^\s*\|/.test(L[i]))rows.push(cells(L[i++]));
      h+=`<div class="md-tw"><table class="md-t"><thead><tr>${hd.map(c=>`<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${hd.map((x,j)=>`<td>${mdInline(r[j]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;continue}
    if(/^\s*([-*]|\d+[.)])\s+/.test(l)){const list=(ind)=>{const ol=/^\s*\d+[.)]/.test(L[i]);let o='';
        while(i<L.length&&/^\s*([-*]|\d+[.)])\s+/.test(L[i])){const d=L[i].match(/^\s*/)[0].length;if(d<ind||d===ind&&/^\s*\d+[.)]/.test(L[i])!==ol)break;if(d>ind){o=o.replace(/<\/li>$/,'')+list(d)+'</li>';continue}
          const t=L[i].replace(/^\s*([-*]|\d+[.)])\s+/,'').trim();if(t)o+=`<li>${mdInline(t)}</li>`;i++}
        return ol?`<ol>${o}</ol>`:`<ul>${o}</ul>`};h+=list(l.match(/^\s*/)[0].length);continue}
    let p=[];while(i<L.length&&L[i].trim()&&!/^(#{1,2}\s|>|\s*([-*]|\d+[.)])\s+|\s*\||\s*-{3,}\s*$)/.test(L[i]))p.push(L[i++].trim());
    if(!p.length)p.push(L[i++].trim());h+=`<p>${mdInline(p.join(' '))}</p>`}
  return h}
const mdText=src=>String(src||'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[#>*_`|]/g,'').replace(/\s+/g,' ').trim();
const newsShort=n=>n.short||mdText(n.md||stripTags(n.html||'')).slice(0,200);
// Ссылки на модули и статьи из markdown (в ленте, окне «Что нового», предпросмотре)
document.addEventListener('click',e=>{const a=e.target.closest('[data-mdmod],[data-mdart]');if(!a)return;e.preventDefault();
  if(a.closest('.md-edit'))return toast('Ссылка сработает у пользователя после публикации','info');
  if(a.dataset.mdmod){const [id,tab]=a.dataset.mdmod.split('.');if(!mods().some(m=>m.id===id))return toast('Этот модуль вам недоступен','lock');MODALS.slice().forEach(m=>m.close());go(id,tab||null);return}
  const art=kbArts().find(x=>x.id===a.dataset.mdart);if(!art)return toast('Статья недоступна','lock');kbArtDlg(art)});
/* Новости, сохранённые в браузере до версии 33 (текст в html, без markdown), берут подробное описание из refDB.json; недостающие новости добавляются */
function newsSync(){const fresh=(DBSRC.ref.db.news||[]);
  // Черновик «Версия N: план», который администратор не менял, заменяется вышедшей записью из refDB.json
  NEWS.forEach(n=>{const f=n.status==='Черновик'&&/: план$/.test(n.t||'')&&fresh.find(x=>x.id===n.id&&x.status!=='Черновик');if(f)Object.keys(f).forEach(k=>n[k]=structuredClone(f[k]))});
  NEWS.forEach(n=>{if(n.md!=null)return;const f=fresh.find(x=>x.id===n.id)||fresh.find(x=>x.ver&&x.ver===n.ver&&!NEWS.some(y=>y.id===x.id));
    if(f){['t','type','short','md','login','pin','link','status','date'].forEach(k=>{if(f[k]!==undefined)n[k]=structuredClone(f[k])});n.id=f.id}else{n.md=stripTags(n.html||'');n.short=newsShort(n);n.login=n.type==='Обновление'||n.type==='Нововведение'}delete n.html});
  fresh.forEach(f=>{if(!NEWS.some(n=>n.id===f.id))NEWS.push(structuredClone(f))})}
newsSync();
function newsOpen(n){newsRead().add(n.id);renderSide();renderSheetDot();
  openModal({size:'wide',render:()=>({title:esc(n.t),sub:`${fmtD(n.date)}${n.ver?' · версия '+esc(n.ver):''}${n.edited?' · изменено '+fmtD(n.edited):''}`,body:`<div class="row" style="gap:8px">${newsPill(n.type)}${n.pin?'<span class="tag">Закреплено</span>':''}</div><div class="kb-art md">${mdHtml(n.md)}</div>`,
    foot:`<div class="grow"></div>${n.link&&newsLinkOk(n.link)?`<button class="btn" id="nw-more">${ic('right','sm')}Подробнее: ${esc(newsLinkTxt(n.link))}</button>`:''}<button class="btn cta" data-close>Закрыть</button>`,
    mount(el,m){const b=$('#nw-more',el);if(b)b.onclick=()=>{m.close();n.link.k==='art'?kbArtDlg(KB_ARTS.find(a=>a.id===n.link.id)):go(n.link.id)}}}),onClose:()=>{if(S.mod==='kb')renderPage()}});if(S.mod==='kb')setTimeout(renderPage,0)}
/* Окно «Что нового» (ТЗ, «Новости» → «Окно «Что нового» при входе»): при входе в систему, только если есть непрочитанные новости
   с отметкой «Показывать при входе»; показанные сразу считаются прочитанными, поэтому окно с ними больше не открывается (решение заказчика 25.10.2026).
   При самом первом входе над новостями — приветствие с «Открыть Базу знаний». Не при перезагрузке страницы.
   В прототипе входом считаются открытие прототипа в новой вкладке браузера, «Войти как» и вход по логину и паролю. */
// От новых к старым: по дате выхода, в один день — по времени публикации (последняя запись «Опубликовано» в истории), затем по номеру версии
const newsPubAt=n=>((n.hist||[]).filter(h=>h.to==='Опубликовано').pop()||{}).at||n._ua||'';
const newsSort=(a,b)=>b.date.localeCompare(a.date)||newsPubAt(b).localeCompare(newsPubAt(a))||(+b.ver||0)-(+a.ver||0);
function whatsNew(how){if(navigator.webdriver&&!store.get('wntest',false))return;
  if(how==='open'){let seen=null;try{seen=sessionStorage.getItem('bu.wn.'+S.me)}catch(e){}if(seen)return}
  try{sessionStorage.setItem('bu.wn.'+S.me,'1')}catch(e){}
  const r=newsRead(),vis=newsVis().sort(newsSort);let l=vis.filter(n=>n.login&&!r.has(n.id));const unread=l.length;
  if(!l.length)return;const first=!store.get('kbw.'+S.me,false);store.set('kbw.'+S.me,true);
  const fresh=new Set(l.filter(n=>!r.has(n.id)).map(n=>n.id));l.forEach(n=>r.add(n.id));renderSide();renderSheetDot();if(typeof dbSoon==='function')dbSoon();
  setTimeout(()=>openModal({size:'wide',render:()=>({title:'Что нового',sub:`${unread} ${plural(unread,'новость','новости','новостей')} с вашего прошлого входа`,
    body:`${first?`<div class="note">${ic('grad')}<span><b>Добро пожаловать в Buhuchet.kg: начните с Базы знаний.</b> В «Базе знаний» — уроки по вашим модулям с кнопками «Перейти» и «Показать как», статьи инструкции и ваш уровень знаний. Программа строится из ваших прав: проходите шаги, и уровень вырастет от «Новичка» до «Эксперта».</span></div>`:''}
      ${l.map(n=>`<section class="wn-item"><div class="row" style="gap:8px;flex-wrap:wrap">${newsPill(n.type)}<span class="muted">${fmtD(n.date)}${n.ver?' · версия '+esc(n.ver):''}</span>${fresh.has(n.id)?'<span class="pill sm red">Новое</span>':''}</div><h3>${esc(n.t)}</h3><div class="kb-art md">${mdHtml(n.md)}</div>${n.link&&newsLinkOk(n.link)?`<button class="btn sm" data-wnmore="${n.id}">${ic('right','sm')}Подробнее: ${esc(newsLinkTxt(n.link))}</button>`:''}</section>`).join('')}`,
    foot:`${first?`<button class="btn" id="wn-kb">${ic('grad','sm')}Открыть Базу знаний</button>`:''}<div class="grow"></div><button class="btn ghost" id="wn-all">${ic('bell','sm')}Все новости</button><button class="btn cta" data-close>Понятно</button>`,
    mount(el,m){$('#wn-all',el).onclick=()=>{m.close();go('kb','news')};const k=$('#wn-kb',el);if(k)k.onclick=()=>{m.close();go('kb','lessons')};
      $$('[data-wnmore]',el).forEach(b=>b.onclick=()=>{const n=NEWS.find(x=>x.id===b.dataset.wnmore);m.close();n.link.k==='art'?kbArtDlg(KB_ARTS.find(a=>a.id===n.link.id)):go(n.link.id)})}}),
    onClose:()=>{if(S.mod==='kb')renderPage()}}),400)}
const newsLinkOk=l=>l.k==='art'?kbArts().some(a=>a.id===l.id):mods().some(m=>m.id===l.id);
const NF={type:'',ver:'',q:''};
function renderNews(body){const all=newsVis();const r=newsRead();const q=NF.q.trim().toLowerCase();
  const l=all.filter(n=>(!NF.type||n.type===NF.type)&&(!NF.ver||n.ver===NF.ver)&&(!q||(n.t+' '+newsShort(n)+' '+(n.md||'')).toLowerCase().includes(q))).sort(newsSort);
  const vers=[...new Set(all.map(n=>n.ver).filter(Boolean))].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  const item=n=>{const t=newsShort(n);return `<button class="kb-a nw ${r.has(n.id)?'':'unread'}" data-news="${n.id}"><span class="row" style="gap:8px;flex-wrap:wrap">${newsPill(n.type)}<span class="muted">${fmtD(n.date)}${n.ver?' · версия '+esc(n.ver):''}</span>${r.has(n.id)?'':'<span class="pill sm red">Новое</span>'}${n.pin?`<span class="tag">${ic('star','sm')}Закреплено</span>`:''}</span><b>${esc(n.t)}</b><span class="hint">${esc(t.slice(0,170))}${t.length>170?'…':''}</span></button>`};
  // Группы версий идут в порядке ленты: выше та, в которой новость вышла позже
  const pins=l.filter(n=>n.pin),rest=l.filter(n=>!n.pin);const groups=[];rest.forEach(n=>{const k=n.ver||'';let g=groups.find(x=>x.k===k);if(!g)groups.push(g={k,l:[]});g.l.push(n)});
  body.innerHTML=`<div class="box"><div class="row" style="flex-wrap:wrap"><span class="kb-search">${ic('search','sm')}<input class="inp" id="nw-q" placeholder="Поиск по новостям" value="${esc(NF.q)}" aria-label="Поиск по новостям"></span>${sel('nw-type',[['','Все типы'],...Object.keys(NEWS_T).map(x=>[x,x])],NF.type,'aria-label="Тип"')}${sel('nw-ver',[['','Все версии'],...vers.map(v=>[v,'Версия '+v])],NF.ver,'aria-label="Версия"')}<span class="muted">${l.length} ${plural(l.length,'новость','новости','новостей')}${r.size||all.length?` · непрочитанных ${all.filter(n=>!r.has(n.id)).length}`:''}</span>${all.some(n=>!r.has(n.id))?'<button class="linkbtn" id="nw-all">Отметить все прочитанными</button>':''}</div></div>
  ${!l.length?`<div class="state">${ic('bell','lg')}<b>${all.length?'Ничего не найдено':'Новостей пока нет'}</b>${all.length?'<button class="linkbtn" id="nw-x">Сбросить фильтры</button>':'<span>Здесь появятся новости об обновлениях платформы.</span>'}</div>`:''}
  ${pins.length?`<div class="box"><h3>Закреплено</h3><div class="kb-list">${pins.map(item).join('')}</div></div>`:''}
  ${groups.map(g=>`<div class="box"><h3>${g.k?`Версия ${esc(g.k)} — ${fmtD(g.l.reduce((a,n)=>n.date>a?n.date:a,''))}`:'Объявления'}</h3><div class="kb-list">${g.l.map(item).join('')}</div></div>`).join('')}`;
  const qi=$('#nw-q',body);qi.oninput=()=>{NF.q=qi.value;const p=qi.selectionStart;renderPage();const n=$('#nw-q');if(n){n.focus({preventScroll:true});n.setSelectionRange(p,p)}};
  $('#nw-type',body).onchange=e=>{NF.type=e.target.value;renderPage()};$('#nw-ver',body).onchange=e=>{NF.ver=e.target.value;renderPage()};
  body.onclick=e=>{const b=e.target.closest('[data-news]');if(b)return newsOpen(NEWS.find(n=>n.id===b.dataset.news));if(e.target.closest('#nw-x')){NF.type=NF.ver=NF.q='';renderPage()}if(e.target.closest('#nw-all')){all.forEach(n=>r.add(n.id));renderPage();renderSide();renderSheetDot()}}}


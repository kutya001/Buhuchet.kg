'use strict';
// Оформленная рассылка (поток Т, задача Т6; пакет заказчика 13.11.2026, идея 15 списка «Идеи для Telegram-бота»): Админка → «Телеграм» → «Рассылка».
// Раньше объявление было одним полем текста. Теперь сообщение собирается из частей: картинка, заголовок, текст, кнопки «Подробнее» и «Смотреть видео»; рядом — предпросмотр, как в Telegram.
// Правила:
//   — отправляет только администратор платформы; получатели прежние: все пользователи платформы или одна организация, только с привязанным Telegram;
//   — кнопки ведут только на сайт: «Подробнее» — на опубликованную новость «для всех» или статью Базы знаний не «только для Админки», «Смотреть видео» — на опубликованное видео;
//     свой адрес ввести нельзя; открыть запись сможет тот, кому она доступна на сайте;
//   — заголовок до 80 знаков, текст до 900: вместе они помещаются в подпись к картинке; текст уходит как обычный текст, разметка и ссылки в нём не выполняются;
//   — картинка — JPG, PNG или WebP до 2 МБ; простым текстом уходят те же картинка, заголовок, текст и кнопки, только заголовок не выделен;
//   — «Заполнить из новости» берёт заголовок, краткое описание и ссылку новости; сама публикация новости сообщений в Telegram по-прежнему не шлёт — рассылку запускает администратор;
//   — перед постановкой в очередь — подтверждение с числом получателей: отправленное сообщение не отозвать.
const TG_CAST_H=80,TG_CAST_T=900,TG_CAST_IMG_MB=2,TG_CAST_IMG=/^image\/(jpeg|png|webp)$/;
const TG_CAST={to:'all',h:'',t:'',more:'',video:'',img:null,plain:false};
const tgCastNews=()=>NEWS.filter(n=>newsLive(n)&&n.aud!=='adm').sort((a,b)=>(+b.ver||0)-(+a.ver||0)||(a.date<b.date?1:-1)).slice(0,20);
const tgCastArts=()=>KB_ARTS.filter(a=>a.active!==false&&a.aud!=='adm');
const tgCastVids=()=>VIDEOS.filter(v=>vidLive(v)&&v.aud!=='adm');
// Пример картинки для макета: в продукте картинку выбирает администратор
const tgCastDemoImg=()=>({name:'Пример картинки.png',src:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 280"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#0f766e"/></linearGradient></defs><rect width="640" height="280" fill="url(#g)"/><text x="40" y="150" font-family="Arial,sans-serif" font-size="46" font-weight="700" fill="#fff">Buhuchet.kg</text><text x="40" y="200" font-family="Arial,sans-serif" font-size="22" fill="#fff" opacity=".85">Что нового</text></svg>')});
function tgCastMsg(c,at){const r=[],[k,id]=String(c.more||'').split(':'),more=tgBtnT('tgBtnMore','Подробнее');
  if(k==='news'){const n=NEWS.find(x=>x.id===id);if(n&&newsLive(n))r.push({t:more,url:`${TG_SITE}/kb/news?news=${id}`,go:()=>newsOpen(n)})}
  if(k==='art'){const a=KB_ARTS.find(x=>x.id===id);if(a&&a.active!==false)r.push({t:more,url:`${TG_SITE}/kb?article=${id}`,go:()=>kbArtDlg(a)})}
  if(c.video&&vidLive(vidById(c.video)))r.push({t:tgBtnT('tgBtnVideo','Смотреть видео'),icon:'pl',url:`${TG_SITE}/kb/video?video=${c.video}`,go:()=>vidOpen(c.video)});
  return {img:c.img,h:c.h,t:c.t,at,btns:r.length?[r]:[]}}
// Новость → поля рассылки: заголовок, краткое описание, «Подробнее» — сама новость, «Смотреть видео» — если ссылка новости ведёт на видео
function tgCastFromNews(n){const c=TG_CAST,v=n.link&&n.link.k==='video'?vidById(n.link.id):null;
  c.h=tgClip(n.t,TG_CAST_H);c.t=tgClip(newsShort(n),TG_CAST_T);c.more='news:'+n.id;c.video=v&&vidLive(v)&&v.aud!=='adm'?v.id:''}
const tgCastCount=to=>to==='all'?allUsers().length-1:to==='o1'?EMP.filter(e=>e.tg).length:ORGS.find(o=>o.id===to).staff();
function renderTgCast(body){const c=TG_CAST,news=tgCastNews(),chat={who:'Buhuchet.kg',list:[],plain:c.plain};
  if(c.to!=='all'&&!ORGS.some(o=>o.id===c.to&&o.active))c.to='all';
  body.innerHTML=`<div class="cols2"><div class="box"><h3>Сообщение</h3>
    ${fld('Заполнить из новости',sel('bc-news',[['','— выберите новость'],...news.map(n=>[n.id,n.t])],''),{id:'bc-news',hint:'Заголовок, краткое описание и кнопка «Подробнее» возьмутся из новости; дальше их можно поправить'})}
    ${fld('Кому',sel('bc-to',[['all','Всем пользователям платформы'],...ORGS.filter(o=>o.active).map(o=>[o.id,o.name])],c.to),{id:'bc-to'})}
    ${fld('Заголовок',inp('bc-h',c.h,`maxlength="${TG_CAST_H}" placeholder="Например: Плановые работы 15 ноября"`),{id:'bc-h',hint:`Необязательно; до ${TG_CAST_H} знаков`})}
    ${fld('Текст',`<textarea class="inp" id="bc-t" maxlength="${TG_CAST_T}" style="min-height:120px" placeholder="Например: 15 ноября с 22:00 до 23:00 плановые работы, платформа будет недоступна.">${esc(c.t)}</textarea>`,{req:true,id:'bc-t',hint:`До ${TG_CAST_T} знаков. Уходит как обычный текст: разметка и ссылки в нём не выполняются`})}
    ${fld('Картинка',`<div class="row" style="flex-wrap:wrap"><input type="file" id="bc-img" accept="image/jpeg,image/png,image/webp" hidden><button type="button" class="btn sm" id="bc-img-b">${ic('upload','sm')}${c.img?'Заменить':'Выбрать'}</button>${c.img?`<span class="muted">${esc(c.img.name)}</span><button type="button" class="linkbtn" id="bc-img-x">Убрать</button>`:'<button type="button" class="linkbtn" id="bc-img-demo">В макете: показать пример картинки</button>'}</div>`,{id:'bc-img',hint:`Необязательно; JPG, PNG или WebP до ${TG_CAST_IMG_MB} МБ`})}
    ${fld('Кнопка «Подробнее»',sel('bc-more',[['','— нет'],...news.map(n=>['news:'+n.id,'Новость · '+n.t]),...tgCastArts().map(a=>['art:'+a.id,'Статья · '+a.t])],c.more),{id:'bc-more',hint:'Опубликованная новость или статья Базы знаний: откроется на сайте. Свой адрес указать нельзя'})}
    ${fld('Кнопка «Смотреть видео»',sel('bc-video',[['','— нет'],...tgCastVids().map(v=>[v.id,v.t])],c.video),{id:'bc-video'})}
    <div class="row"><span class="hint">Сообщение получат только те, кто привязал Telegram.</span><div class="grow"></div><button class="btn cta" id="bc-go">${ic('send','sm')}Поставить в очередь</button></div></div>
    <div class="box"><h3>Как увидит получатель</h3><label class="check-row"><input type="checkbox" class="sw" id="bc-plain" ${c.plain?'checked':''}><span class="grow">Показать простым текстом<div class="hint">Так сообщение получит тот, кто включил «Сообщения простым текстом». Картинка и кнопки остаются.</div></span></label><div id="bc-pv"></div>
      <div class="note">${ic('info')}<span>Это макет: в приложении Telegram шрифты и форма кнопок немного другие. Подписи кнопок — шаблоны «Telegram: кнопка «Подробнее»» и «Telegram: кнопка «Смотреть видео»».</span></div></div></div>`;
  const pv=$('#bc-pv',body),draw=()=>{chat.plain=c.plain;chat.list=c.h||c.t||c.img?[tgCastMsg(c,bishkekNow().hm)]:[];pv.innerHTML=tgcHtml(chat);tgcBind(pv,chat,draw,me())};draw();
  const on=(id,k,ev)=>{$('#'+id,body)[ev||'oninput']=e=>{c[k]=e.target.type==='checkbox'?e.target.checked:e.target.value;draw()}};
  on('bc-h','h');on('bc-t','t');on('bc-to','to','onchange');on('bc-more','more','onchange');on('bc-video','video','onchange');on('bc-plain','plain','onchange');
  $('#bc-news',body).onchange=e=>{const n=NEWS.find(x=>x.id===e.target.value);if(!n)return;tgCastFromNews(n);renderTgCast(body);toast('Поля заполнены из новости')};
  $('#bc-img-b',body).onclick=()=>$('#bc-img',body).click();
  $('#bc-img',body).onchange=e=>{const f=e.target.files[0];if(!f)return;if(!TG_CAST_IMG.test(f.type))return toast('Картинка — только JPG, PNG или WebP','alert',true);if(f.size>TG_CAST_IMG_MB*1048576)return toast(`Картинка больше ${TG_CAST_IMG_MB} МБ`,'alert',true);
    const rd=new FileReader();rd.onload=()=>{c.img={name:f.name,src:rd.result};renderTgCast(body)};rd.readAsDataURL(f)};
  const x=$('#bc-img-x',body);if(x)x.onclick=()=>{c.img=null;renderTgCast(body)};
  const dm=$('#bc-img-demo',body);if(dm)dm.onclick=()=>{c.img=tgCastDemoImg();renderTgCast(body)};
  $('#bc-go',body).onclick=()=>{c.h=c.h.trim();c.t=c.t.trim();if(!setErr(body,'bc-t',c.t?'':'Введите текст'))return;
    const n=tgCastCount(c.to),whom=c.to==='all'?'всем пользователям платформы':`организации «${orgName(c.to)}»`;if(!n)return toast('Некому отправлять: ни у кого из получателей не привязан Telegram','alert',true);
    confirmDlg({title:'Поставить рассылку в очередь?',text:`Сообщение${c.h?` «${esc(c.h)}»`:''} получат ${n} ${plural(n,'пользователь','пользователя','пользователей')} — ${esc(whom)}. Отправленное сообщение отозвать нельзя.`,ok:'Поставить в очередь',run:()=>{
      for(let i=0;i<Math.min(n,6);i++)TG_LOG.unshift({id:TG_LOG.length+1,at:TODAY+' '+bishkekNow().hm,to:'получатель '+(i+1),org:c.to==='all'?'Все':orgName(c.to),kind:'Объявление',st:'Ожидает',tries:0,err:''});
      log('tg','cast',`Рассылка${c.h?` «${c.h}»`:''}: ${whom}, получателей — ${n}${c.img?', с картинкой':''}`);
      Object.assign(c,{h:'',t:'',more:'',video:'',img:null});renderTgCast(body);toast(`В очереди: ${n} ${plural(n,'сообщение','сообщения','сообщений')}`,'tg');
      setTimeout(()=>{TG_LOG.forEach(x=>{if(x.kind==='Объявление'&&x.st==='Ожидает'){x.st='Отправлено';x.tries=1}})},2500)}})};
}

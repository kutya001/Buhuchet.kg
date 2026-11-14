'use strict';
// Темы в чате с ботом (поток Т, задача Т7; пакет заказчика 13.11.2026, идея 6 списка «Идеи для Telegram-бота»).
// Telegram умеет делить личный чат с ботом на темы, как папки. Режим включается для всего бота сразу (в @BotFather), поэтому у нас он за переключателем
// администратора платформы: Админка → «Телеграм» → «Бот платформы» → «Темы в чате с ботом» (по умолчанию выключено — чат у всех прежний).
// Правила:
//   — темы по видам сообщений: «Отчёты» (утреннее напоминание, кнопки отчётов, «На исправление», ждут подтверждения, сводка недели, «Напомнить»),
//     «Задачи» (новые задачи с кнопками), «Безопасность» (коды, привязка и замена Telegram, смена пароля, «Это не я»); у администратора платформы вместо
//     «Отчётов» и «Задач» — «Заявки» (заявки с сайта); рассылки и проверка бота — без темы, в «Общем»;
//   — если чат привязан к учётным записям в нескольких организациях, отчёты и задачи идут в тему своей организации (название темы — название организации),
//     «Безопасность» — одна общая: сейчас в таком чате бот ставит название организации первой строкой, с темами строка не нужна;
//   — тему бот создаёт сам, когда ему впервые есть что в неё написать (createForumTopic); человек тему удалил — бот создаст её заново при следующем сообщении;
//   — ответ на команду меню и на нажатие кнопки приходит в ту же тему, где команда или кнопка; в теме организации команды отвечают по учётной записи этой организации;
//   — названия тем — шаблоны «Справочников платформы» (tgTopic…), до 128 знаков (предел Telegram); название организации длиннее — с многоточием;
//   — переключатель включён, а в @BotFather темы не включены (Telegram отвечает, что тем у бота нет) — бот пишет без тем, как раньше, и Админка показывает
//     это в «Бот платформы»: напоминание о сроке должно дойти всегда.
// Темы не меняют, кому и что приходит: только в какую папку чата.
const TG_TOPIC_NAME_MAX=128;
// Код темы, шаблон названия, название по умолчанию
const TG_TOPICS=[['rep','tgTopicReports','Отчёты'],['task','tgTopicTasks','Задачи'],['lead','tgTopicLeads','Заявки'],['sec','tgTopicSecurity','Безопасность']];
// Сообщение получает тему при сборке: tgIn('rep', сообщение)
const tgIn=(k,m)=>m&&Object.assign(m,{topic:k});
const tgTopicLabel=k=>{const t=TG_TOPICS.find(x=>x[0]===k);return t?tgBtnT(t[1],t[2]):k};
// Учётные записи этого чата в других организациях (в макете — демо-переключатель окна переписки)
const tgOrgsOf=(u,o)=>o&&o.orgs?o.orgs:[];
const TG_DEMO_ORG2={id:'demo2',name:'ОсОО «Ак-Жол Консалт»'};
// Темы чата: по видам или, если чат привязан к нескольким организациям, по организациям и «Безопасность»
function tgTopicsFor(u,o={}){
  if(!u)return [{key:'sec',name:tgTopicLabel('sec')}];
  if(u.id==='admin')return [{key:'lead',name:tgTopicLabel('lead')},{key:'sec',name:tgTopicLabel('sec')}];
  const others=tgOrgsOf(u,o);
  if(others.length)return [{key:'org:'+ORG.id,name:tgClip(ORG.name,TG_TOPIC_NAME_MAX)},...others.map(x=>({key:'org:'+x.id,name:tgClip(x.name,TG_TOPIC_NAME_MAX)})),{key:'sec',name:tgTopicLabel('sec')}];
  return ['rep','task','sec'].map(k=>({key:k,name:tgTopicLabel(k)}))}
// Тема сообщения в этом чате: при темах по организациям отчёты и задачи — в тему своей организации; без темы — «Общее» ('')
function tgTopicKey(chat,m){const k=m.topic||'';if(!k||k==='sec'||k==='lead')return k;return chat.byOrg?(k.startsWith('org:')?k:'org:'+ORG.id):k}
const tgTopicShown=(chat,m)=>!chat.topics||m.day||tgTopicKey(chat,m)===chat.cur;
// Вкладки тем над перепиской: в Telegram — список тем чата с ботом
function tgcTopicsHtml(chat){const n=k=>chat.list.filter(m=>!m.day&&!m.eph&&tgTopicKey(chat,m)===k).length,T=[...chat.topics,{key:'',name:'Общее'}];
  return `<div class="tgc-topics" role="tablist" aria-label="Темы чата с ботом">${T.map(t=>`<button type="button" role="tab" class="tgc-tp${t.key===chat.cur?' on':''}" aria-selected="${t.key===chat.cur}" data-tgc-topic="${esc(t.key)}">${ic(t.key==='sec'?'lock':t.key==='task'?'task':t.key==='lead'?'send':t.key===''?'chat':t.key==='rep'?'file':'building','sm')}<span>${esc(t.name)}</span>${n(t.key)?`<span class="tgc-n">${n(t.key)}</span>`:''}</button>`).join('')}</div>`}
// Новые сообщения переписки (ответ на нажатие, команду или ответ человека) приходят в открытую тему
function tgTopicTag(chat){if(!chat.topics)return;chat.list.forEach(m=>{if(m.topic===undefined&&!m.day)m.topic=chat.cur.startsWith('org:')&&chat.cur!=='org:'+ORG.id?chat.cur:chat.cur.startsWith('org:')?'rep':chat.cur})}
// Открыть тему последнего сообщения — как Telegram открывает чат на новом сообщении
function tgTopicStart(chat){const last=chat.list.slice().reverse().find(m=>!m.day&&!m.eph);chat.cur=last?tgTopicKey(chat,last):chat.topics[0].key;
  if(!chat.topics.some(t=>t.key===chat.cur)&&chat.cur!=='')chat.cur=chat.topics[0].key}

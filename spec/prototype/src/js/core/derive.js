'use strict';
// Производное состояние: просрочки, остатки, статусы контрагентов (derive)
/* ═════════════ Derived state ═════════════ */
const DONE=new Set(['Сдан','Не требуется']);
const OPEN=new Set(['К сдаче','В работе','Требует исправления']);
// Оплата за обслуживание: какие месяцы она закрывает (alloc; у старых записей — один month) и аванс — всё, что сверх них
const fpAlloc=f=>f.alloc||(f.month?[{m:f.month,a:f.amount}]:[]);
const fpAdv=f=>Math.max(0,Math.round((f.amount-fpAlloc(f).reduce((s,x)=>s+x.a,0))*100)/100);
// Аванс сам засчитывается в неоплаченные начисления от старых к новым (решение заказчика 24.10.2026)
function feeAdvSplit(c,adv,paidOf){const use={};feeMonths(c).forEach(m=>{const need=feeCharge(c,m)-paidOf(m);if(adv>0.001&&need>0){const x=Math.min(need,adv);use[m]=x;adv-=x}});return {use,left:Math.round(adv*100)/100}}
const feeGot=(c,m)=>(c.feePaid[m]||0)+((c.feeAdvUse||{})[m]||0);
function derive(){
  kpiIndex();enNorm();
  CPS.forEach(c=>{c.overdue=0;c.avail=0;c.free=0;c.status=cpStatus(c);c.paused=c.status==='Приостановлен'});
  const recv={},selfP={};OPS.forEach(o=>{if(o.kind==='in')(o.alloc||[]).forEach(x=>{recv[x.r]=(recv[x.r]||0)+x.a});if(o.kind==='pay'&&o.self&&o.report)selfP[o.report]=(selfP[o.report]||0)+o.amount});
  const fadv={};FEEPAYS.forEach(f=>{if(f.del)return;const a=fpAdv(f);if(a>0)fadv[f.cp]=(fadv[f.cp]||0)+a});
  const by={};
  REPORTS.forEach(r=>{const t=tR(r);
    const sch=schedule(r);const u=sch.find(x=>x.paid<x.amount);r.payDue=t.sum?(u?u.due:(sch.length?sch[sch.length-1].due:r.due)):null;
    r.payStatus=!t.sum||r.status==='Не требуется'?'Не требуется':r.sum==null?'Не оплачено':r.sum===0?'Не требуется':r.paid>=r.sum?'Оплачено':r.paid>0?'Оплачено частично':'Не оплачено';
    if(t.payOnly&&r.status!=='Не требуется')r.status=r.sum>0&&r.paid>=r.sum?'Сдан':'К сдаче';
    // r.got — «Получено от контрагента» (решение заказчика 25.10.2026): его деньги, уже оплаченные по отчёту, и отложенные под него из поступлений; «Оплатил контрагент сам» (r.selfPaid) сюда не входит
    r.recv=recv[r.id]||0;r.selfPaid=selfP[r.id]||0;r.got=Math.max(0,Math.round((r.paid-r.selfPaid)*100)/100);r.ear=0;const cpP=CPM[r.cp].paused;
    r.overdue=!cpP&&!r.superseded&&!t.payOnly&&OPEN.has(r.status)&&r.due<TODAY;
    r.payOverdue=!cpP&&!r.superseded&&feat('taxpay')&&['Не оплачено','Оплачено частично'].includes(r.payStatus)&&r.sum>0&&r.payDue<TODAY;
    r.money=null;
    if(r.overdue)CPM[r.cp].overdue++;
    (by[r.cp]=by[r.cp]||[]).push(r);
  });
  CPS.forEach(c=>{
    let av=0;OPS.forEach(o=>{if(o.cp!==c.id||!OPK[o.kind]||o.kind==='xfer'||o.self)return;av+=(o.kind==='in'||o.kind==='back'||o.kind==='corr')?o.amount:-o.amount});
    c.avail=av;let left=av;
    const pend=(by[c.id]||[]).filter(r=>tR(r).sum&&r.sum>0&&r.status!=='Не требуется'&&!r.superseded).sort((a,b)=>a.payDue<b.payDue?-1:1);
    // Сначала под каждый отчёт резервируются деньги, принятые именно за него (детализация поступлений), потом свободный остаток идёт по сроку оплаты
    // r.ear — сколько денег отложено именно под этот отчёт: в сверке за месяц деньги под отчёты с более поздним сроком показываются отдельной строкой
    const ear={};pend.forEach(r=>{if(r.paid>=r.sum)return;const e=Math.max(0,Math.min(r.sum-r.paid,(r.recv||0)-r.paid,left));ear[r.id]=e;r.ear=e;left-=e});
    pend.forEach(r=>{
      if(r.paid>=r.sum){r.money={s:'paid'};return}
      const need=r.sum-r.paid,rest=need-(ear[r.id]||0);r.got=Math.round((r.got+(ear[r.id]||0)+Math.min(rest,Math.max(0,left)))*100)/100;if(left>=rest){r.money={s:'ok',need};left-=rest}else{r.money={s:'short',n:rest-left,need};left=0}
    });
    c.free=left;
    const sp=feeAdvSplit(c,fadv[c.id]||0,m=>c.feePaid[m]||0);c.feeAdvUse=sp.use;c.feeAdv=sp.left;
    let debt=0;feeMonths(c).forEach(m=>{const due=feeDue(c,m);if(due<=TODAY)debt+=Math.max(0,feeCharge(c,m)-feeGot(c,m))});c.feeDebt=debt;
  });
}


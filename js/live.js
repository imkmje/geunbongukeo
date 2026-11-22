"use strict";
/* 근본국어 교사 화면 '실시간 현황' 탭: 수업 중 제출 현황(명단) + 프로젝터용 해설 화면(학생 이름 없음).
   - 이 탭이 보이고 브라우저 창이 앞에 있을 때만 10초마다 그 시험의 답안만 다시 읽는다(다른 탭이거나 창을 내리면 멈춤).
   - teacher.js보다 먼저 불러온다. S·D() 같은 teacher.js 값은 함수 안에서만 쓴다. 계산은 js/tools-logic.js의 liveBoard. */
const LIVE_MS=10000;
function LV(){return S.lv||(S.lv={tid:null,proj:false,showKey:false,sort:'no',at:0,busy:false,err:''})}
const lvClasses=()=>S.cf?[S.cf]:classes();
const lvWhen=ms=>{const d=new Date(ms);return d.toDateString()===new Date().toDateString()?d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):d.toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})};
const lvTime=ms=>ms?new Date(ms).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
function lvOpenTests(){const cs=lvClasses();return testList().filter(t=>cs.some(c=>isOpen(t,c)))}
function lvTest(){
  const L=LV();if(L.tid&&D().tests[L.tid])return {id:L.tid,...D().tests[L.tid]};
  const open=lvOpenTests();const all=testList();const t=open[open.length-1]||all[all.length-1];
  L.tid=t?t.id:null;return t||null;
}
/* 이 반(또는 보이는 모든 반) 명단과 제출 기록 */
function lvRoster(t){
  const rl=rosterLists();const pool=[];
  for(const c of lvClasses())for(const p of (rl[c]||[]))pool.push({sid:p.id,name:p.name,cls:c});
  pool.sort((a,b)=>a.sid.localeCompare(b.sid));
  const recs=recordsFor(t.id,S.cf);const bySid={};for(const r of recs)bySid[ident(r.name)]=r;
  const rows=pool.map(p=>({...p,rec:bySid[p.sid]||null}));
  const extra=recs.filter(r=>!pool.some(p=>p.sid===ident(r.name)));
  return {rows,recs,done:rows.filter(r=>r.rec).length,extra};
}

/* ---------- 화면 ---------- */
function viewLive(){
  const L=LV();const t=lvTest();
  if(!t)return noTests();
  const open=lvOpenTests();const key=keyOf(t.id);
  const R=lvRoster(t);const M=R.rows.length;
  if(L.proj)return viewProjector(t,key,R);// 해설 화면만 그린다(아래 명단의 이름이 화면에 남지 않게)
  const chip=x=>`<button class="chip" aria-pressed="${x.id===t.id}" data-act="lv-test" data-v="${x.id}">${esc(x.title)}${lvClasses().some(c=>isOpen(x,c))?' <span class="pill open" style="margin-left:4px">응시 중</span>':''}</button>`;
  const others=testList().filter(x=>!open.some(o=>o.id===x.id));
  let h=`<div class="stack"><div class="card"><h3>${open.length?'지금 응시가 열린 시험':'지금 응시가 열린 시험이 없습니다'}</h3>
    ${open.length?`<div class="chips" role="group" aria-label="응시 중인 시험">${open.map(chip).join('')}</div>`:'<p class="sub">아래에서 시험을 고르고, 오른쪽 위 <b>응시 열기</b>를 누르면 학생 화면에 답안지가 나타납니다.</p>'}
    ${others.length?`<details class="lv-more" ${open.length?'':'open'}><summary>다른 시험 ${others.length}개</summary><div class="chips" style="margin-top:8px">${others.map(chip).join('')}</div></details>`:''}</div>`;
  const pctDone=M?Math.round(R.done/M*100):0;
  const ocs=lvClasses().filter(c=>!isHiddenCls(c));
  h+=`<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><h2>${esc(t.title)}</h2><p class="sub">${S.cf?esc(S.cf):(classes().length?'보이는 모든 반':'')}${S.cf||classes().length?' · ':''}문항 ${t.items.length}개</p></div>
      <div class="row" style="gap:6px">${ocs.map(c=>isOpen(t,c)?`<span class="pill open">${esc(c)} 응시 중</span><button class="btn small" data-act="close" data-v="${t.id}|${esc(c)}">응시 닫기</button>`:`<button class="btn small" data-act="open" data-v="${t.id}|${esc(c)}">${esc(c)} 응시 열기</button>`).join('')}</div></div>
    <div class="lv-count" role="status" aria-live="polite"><span class="big num">${R.done}<small>/${M}명</small></span><span class="lbl">제출</span></div>
    <div class="lv-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${M}" aria-valuenow="${R.done}" aria-label="제출한 학생 비율"><i style="width:${pctDone}%"></i></div>
    <div class="row" style="margin-top:12px;justify-content:space-between">
      <span class="sub">${S.demo?'예시 데이터라 자동으로 바뀌지 않습니다.':`마지막 확인 ${esc(lvTime(L.at)||'–')} · 이 탭을 보고 있는 동안 10초마다 자동으로 다시 확인합니다.`}${L.err?` <span style="color:var(--bad)">${esc(L.err)}</span>`:''}</span>
      <div class="row" style="gap:6px"><button class="btn" data-act="lv-refresh" ${L.busy?'disabled':''}>${L.busy?'확인하는 중…':'지금 새로고침'}</button><button class="btn primary" data-act="lv-proj">해설 화면 열기</button></div></div></div>`;
  if(!M)h+=`<div class="card empty"><h3>${S.cf?esc(S.cf)+'에 ':''}학생 명단이 없습니다</h3><p>반 관리에서 명단을 넣으면 누가 냈는지 여기에 보입니다.</p></div>`;
  else{
    const miss=R.rows.filter(r=>!r.rec);
    h+=`<div class="card"><h3>아직 안 낸 학생 ${miss.length}명</h3>${miss.length?`<div class="lv-miss">${miss.map(r=>`<span class="badge warn">${esc(r.sid+' '+r.name)}${S.cf?'':' · '+esc(r.cls)}</span>`).join('')}</div>`:'<p class="sub" style="color:var(--good)"><b>명단 전원이 냈습니다.</b></p>'}
      ${R.extra.length?`<p class="sub" style="margin-top:8px;color:var(--warn)">명단에 없는 답안 ${R.extra.length}개가 있습니다(다른 반에서 옮긴 학생일 수 있습니다).</p>`:''}</div>
    <div class="card"><h3>명단</h3><div class="tbl-wrap"><table class="lv-table"><thead><tr><th>학번</th><th>이름</th>${S.cf?'':'<th>반</th>'}<th>상태</th><th>제출 시각</th></tr></thead><tbody>
      ${R.rows.map(r=>`<tr><td class="mono">${esc(r.sid)}</td><td>${esc(r.name)}</td>${S.cf?'':`<td>${esc(r.cls)}</td>`}<td>${r.rec?'<span class="badge good">제출함</span>':'<span class="badge warn">아직 안 냄</span>'}</td><td class="num muted">${r.rec?esc(lvWhen(r.rec.at))+(r.rec.src==='student'?'':' (교사 입력)'):''}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  }
  return h+'</div>';
}

/* 프로젝터 해설 화면: 큰 글씨, 학생 이름 없음 */
function viewProjector(t,key,R){
  const L=LV();const B=liveBoard(t,key,R.recs);const rows=sortBoard(B.items,L.sort);
  const keyOk=t.items.every((_,i)=>key[i]&&key[i]!=='0');
  const rate=v=>v==null?'–':Math.round(v*100)+'%';
  const tone=v=>v==null?'':v>=.5?'hi':v>=.3?'mid':'lo';
  const item=x=>{
    const dist=[1,2,3,4,5].map(o=>{const v=x.n?x.cnt[o]/x.n:0;const isAns=L.showKey&&String(o)===x.ans;const isTop=x.top&&o===x.top.opt;return `<span class="pj-opt${isAns?' ans':''}${isTop?' top':''}"><em>${Math.round(v*100)}</em><span class="pj-col"><i style="height:${Math.max(2,Math.round(v*64))}px"></i></span><b>${CIR[o]}</b></span>`}).join('');
    return `<div class="pj-item"><div class="pj-no">${esc(x.no)}</div>
      <div class="pj-main"><div class="pj-rate ${tone(x.wrongRate)}"><span class="pj-pct">${rate(x.wrongRate)}</span><span class="pj-lbl">오답률</span></div>
        <div class="pj-bar"><i class="${tone(x.wrongRate)}" style="width:${x.wrongRate==null?0:Math.max(1,Math.round(x.wrongRate*100))}%"></i></div>
        <div class="pj-top">${x.top?`가장 많이 고른 오답 <b>${CIR[x.top.opt]}</b> ${rate(x.top.share)}`:(x.n?(x.wrong?`비운 학생 ${rate(x.blank)}`:'오답을 고른 학생 없음'):'아직 답 없음')}${L.showKey&&x.ans?` <span class="pj-key">정답 ${CIR[+x.ans]}</span>`:''}</div></div>
      <div class="pj-dist" aria-label="선지별 비율">${dist}</div></div>`;
  };
  return `<div class="proj" role="dialog" aria-modal="true" aria-label="해설 화면">
   <div class="pj-bar-top"><div class="pj-title"><h2>${esc(t.title)}</h2><span class="pj-sub">${R.done}/${R.rows.length}명 제출 · 답안 ${B.n}개${B.avgWrong!=null?` · 평균 오답률 ${rate(B.avgWrong)}`:''}${S.demo?'':' · '+esc(lvTime(L.at))+' 확인'}</span></div>
     <div class="row pj-ctrl"><div class="seg" role="group" aria-label="정렬"><button data-act="lv-sort" data-v="no" aria-pressed="${L.sort==='no'}">번호순</button><button data-act="lv-sort" data-v="wrong" aria-pressed="${L.sort==='wrong'}">오답률 높은 순</button></div>
       <button class="btn" data-act="lv-key" aria-pressed="${L.showKey}">${L.showKey?'정답 가리기':'정답 보이기'}</button><button class="btn" data-act="lv-full">전체 화면</button><button class="btn" data-act="lv-refresh">새로고침</button><button class="btn primary" data-act="lv-proj-off">닫기 (Esc)</button></div></div>
   ${!keyOk?'<p class="pj-note">정답이 비어 있는 문항은 오답률을 계산하지 않습니다.</p>':''}
   ${B.sets.length?`<div class="pj-sets">${B.sets.map(s=>`<div class="pj-set"><span class="pj-set-n">${esc(s.name)}</span><span class="pj-set-q">${esc(s.nos.join(', '))}번</span><span class="pj-set-v ${tone(s.wrongRate)}">${rate(s.wrongRate)}</span><span class="pj-set-l">평균 오답률</span></div>`).join('')}</div>`:''}
   ${B.n?`<div class="pj-items">${rows.map(item).join('')}</div>`:'<div class="pj-empty">아직 들어온 답안이 없습니다. 학생이 내면 10초 안에 나타납니다.</div>'}
  </div>`;
}

/* ---------- 새로 읽기 (그 시험의 답안만) ---------- */
function lvActive(){return S.tab==='live'&&document.visibilityState==='visible'&&S.session&&S.teacher&&!S.demo&&S.ready}
async function lvRefresh(){
  const L=LV();
  if(S.demo){L.at=Date.now();schedule();return}
  const tid=L.tid;if(!tid||L.busy||!S.session)return;
  L.busy=true;
  try{
    const rows=[];for(let from=0;;from+=1000){const r=await sb.from('submissions').select('test_id,student_id,answers,src,submitted_at').eq('test_id',tid).order('id').range(from,from+999);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<1000)break}
    lvPatch(tid,rows);L.at=Date.now();L.err='';
  }catch(e){console.error(e);L.err='확인하지 못했습니다. 인터넷 연결을 확인해 주세요.'}
  finally{L.busy=false}
  if(S.tab==='live')schedule();
}
/* load()가 만드는 모양(S.live.manual)과 똑같이 그 시험 답안만 바꿔 끼운다 → 다른 탭도 같은 자료를 본다. */
function lvPatch(tid,rows){
  const X=S.live;const nameOf={};for(const [n,id] of Object.entries(S.idx.classByName))nameOf[id]=n;
  for(const m of Object.values(X.manual))delete m.answers[tid];
  for(const x of rows){const s0=S.idx.studentById[x.student_id];if(!s0)continue;
    const m=X.manual[s0.id]=X.manual[s0.id]||{name:s0.sid+' '+s0.name,answers:{}};
    m.answers[tid]={a:x.answers,at:Date.parse(x.submitted_at)||0,cls:nameOf[s0.class_id]||'',src:x.src}}
}
setInterval(()=>{if(lvActive())lvRefresh()},LIVE_MS);
document.addEventListener('visibilitychange',()=>{if(lvActive())lvRefresh()});

/* ---------- 동작 ---------- */
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const L=LV();const v=b.dataset.v;
  switch(b.dataset.act){
    case 'tab':if(v==='live')setTimeout(()=>{if(S.tab==='live'&&!S.demo)lvRefresh()},0);else if(L.proj)L.proj=false;break;
    case 'lv-test':L.tid=v;L.at=0;render();lvRefresh();break;
    case 'lv-refresh':lvRefresh();if(!S.demo)render();break;
    case 'lv-proj':L.proj=true;render();break;
    case 'lv-proj-off':L.proj=false;if(document.fullscreenElement)document.exitFullscreen?.();render();break;
    case 'lv-sort':L.sort=v;render();break;
    case 'lv-key':L.showKey=!L.showKey;render();break;
    case 'lv-full':if(document.fullscreenElement)document.exitFullscreen?.();else document.documentElement.requestFullscreen?.().catch(()=>toast('이 브라우저에서는 전체 화면을 쓸 수 없습니다. F11 키를 눌러 보세요'));break;
  }
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&S.lv?.proj&&S.tab==='live'&&!document.querySelector('dialog[open]')){S.lv.proj=false;render()}});

"use strict";
/* ---------- 상태 ---------- */
const S={
  ready:false, err:null, slow:false,
  session:null, teacher:false, preview:false, idx:{classByName:{},studentBySid:{},studentById:{}},
  live:{tests:{},keys:{},stats:{},subs:{},manual:{},config:{},roster:{}},
  demo:null, me:null,
  tab:'class', selTest:null, selStudent:null, sortBy:'no',
  edit:null, importText:'', importTest:null, importPreview:null,
  stuTest:null, stuName:'', draft:{}, confirm:null, natText:'', cf:'', stuCls:'', tagText:'', impCls:'', mg:null
};
const D=()=>S.demo||S.live;

const byDate=testOrder;// js/logic.js: 시행일 → 제목(숫자 인식) → 만든 시각
function testList(){return Object.entries(D().tests).map(([id,t])=>({id,...t})).sort(byDate)}
function allClasses(){return D().config?.main?.classes||[]}
function hiddenClasses(){return D().config?.main?.hidden||[]}
const isHiddenCls=c=>!!c&&hiddenClasses().includes(c);
/* 화면에 쓰는 반 목록: 숨긴 반은 '숨긴 반 보기'를 켰을 때만 */
function classes(){return visibleClasses(allClasses(),hiddenClasses(),S.showHidden)}
function liveClasses(){return allClasses().filter(c=>!isHiddenCls(c))}
function effClasses(){const c=classes();return c.length?c:['']}
const isOpen=(t,c)=>(t.openFor||[]).includes(c);
const isRel=(t,c)=>(t.releasedFor||[]).includes(c);
function myCls(){return classes().length?S.stuCls:''}
function statusOf(t,c){if(c===undefined)c=(S.teacher||S.demo)&&!S.preview?S.cf:myCls();const cs=c?[c]:effClasses();
  const rel=cs.filter(x=>isRel(t,x)).length,op=cs.filter(x=>isOpen(t,x)).length;
  if(rel&&rel===cs.length)return['rel','결과 공개'];if(rel)return['rel',`공개 ${rel}/${cs.length}`];
  if(op)return['open',cs.length>1?`응시 중 ${op}/${cs.length}`:'응시 중'];if(t.closedOnce)return['closed','마감'];return['draft','준비 중']}

/* ---------- 기록 모으기 (학생 직접 제출 + 교사 입력) ---------- */
function allRecords(){
  const out={};// name -> {testId: rec}
  const ri=rosterIndex();
  const put=(name,tid,v,src,path)=>{const n0=normName(name);if(!n0||!v||!v.a)return;const id=ident(n0);const ro=ri[id];const n=ro?ro.id+' '+ro.name:(/^\d{5}$/.test(id)?(id+' '+n0.replace(/\d{5}/,'').trim()).trim():n0);out[n]=out[n]||{};const prev=out[n][tid];if(!prev||(v.at||0)>=(prev.at||0))out[n][tid]={name:n,a:v.a,el:v.el||'',cls:ro?ro.cls:(v.cls||''),at:v.at||0,src,path}};
  for(const [id,d] of Object.entries(D().subs))for(const [tid,v] of Object.entries(d.answers||{}))put(d.name,tid,v,'student','subs/'+id);
  for(const [id,d] of Object.entries(D().manual))for(const [tid,v] of Object.entries(d.answers||{}))put(d.name,tid,v,v.src||'teacher','manual/'+id);
  return out;
}
function recordsFor(tid,c,every){if(c===undefined)c=S.cf;const all=allRecords();const hid=every||S.showHidden?null:new Set(hiddenClasses());return Object.values(all).map(m=>m[tid]).filter(r=>r&&(c?r.cls===c:!(hid&&hid.has(r.cls)))).sort((a,b)=>a.name.localeCompare(b.name,'ko'))}
function keyOf(tid){return (D().keys[tid]?.a||'').split('')}
function natOf(tid){return D().keys[tid]?.nat||null}
function ident(n){const m=String(n).match(/\d{5}/);return m?m[0]:normName(n)}
function rosterLists(){return D().roster?.main?.lists||{}}
function rosterIndex(){const o={};for(const [c,l] of Object.entries(rosterLists()))for(const p of l)o[p.id]={...p,cls:c};return o}
function buildStats(tid){const t=D().tests[tid];const key=keyOf(tid);const all=toStats(analyze(t,key,recordsFor(tid,'')));const byClass={};for(const c of classes()){const rs=recordsFor(tid,c);if(rs.length)byClass[c]=toStats(analyze(t,key,rs))}const k=D().keys[tid]||{};return {all,byClass,nat:k.nat||null,ex:k.ex||null,tags:k.tags||null,at:Date.now()}}
/* '숨긴 반 보기 (N)' 켜고 끄기. 숨긴 반이 없으면 아무것도 안 보인다. */
function hidToggle(){const n=hiddenClasses().length;return n?`<button class="btn small ghost" data-act="hid-toggle" aria-pressed="${!!S.showHidden}">${S.showHidden?'숨긴 반 감추기':`숨긴 반 보기 (${n})`}</button>`:''}
function clsBar(){return `<div class="chips" style="margin-bottom:14px;align-items:center" role="group" aria-label="반 선택"><span class="sub" style="align-self:center;margin-right:4px">반</span>${['',...classes()].map(c=>`<button class="chip${isHiddenCls(c)?' is-hidden':''}" aria-pressed="${S.cf===c}" data-act="cf" data-v="${esc(c)}">${c?esc(c):'전체'}${isHiddenCls(c)?' <span class="badge">숨김</span>':''}</button>`).join('')}${hidToggle()}</div>`}

/* ---------- Supabase 연결 ---------- */
const sb=window.supabase.createClient(window.GB_CONFIG.url,window.GB_CONFIG.key,{auth:{persistSession:true,autoRefreshToken:true}});
const chk=r=>{if(r.error)throw r.error;return r.data};
const clsId=n=>S.idx.classByName[n];
const nowIso=()=>new Date().toISOString();
async function load(){
  // Supabase는 한 번에 최대 1000줄만 돌려주므로(.limit을 더 크게 줘도 마찬가지) 1000줄씩 나눠 끝까지 읽는다.
  const ORD={classes:['id'],students:['id'],tests:['id'],test_keys:['test_id'],test_class:['test_id','class_id'],submissions:['id']};
  const fetchAll=async t=>{const out=[];for(let from=0;;from+=1000){let q=sb.from(t).select('*');for(const c of ORD[t])q=q.order(c);const rows=chk(await q.range(from,from+999));out.push(...rows);if(rows.length<1000)return out}};
  const [cl,st,ts,tk,tc,sub]=await Promise.all(Object.keys(ORD).map(fetchAll));
  cl.sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));
  const cById={};const idx={classByName:{},studentBySid:{},studentById:{}};
  for(const c of cl){cById[c.id]=c.name;idx.classByName[c.name]=c.id}
  const L={tests:{},keys:{},stats:{},subs:{},manual:{},config:{main:{classes:cl.map(c=>c.name),hidden:cl.filter(c=>c.hidden).map(c=>c.name)}},roster:{main:{lists:{}}}};
  for(const x of st){idx.studentBySid[x.sid]=x;idx.studentById[x.id]=x;const cn=cById[x.class_id];if(cn)(L.roster.main.lists[cn]=L.roster.main.lists[cn]||[]).push({id:x.sid,name:x.name,uid:x.id,must:x.must_change_pw!==false,locked:!!x.locked_until&&Date.parse(x.locked_until)>Date.now()})}
  for(const l of Object.values(L.roster.main.lists))l.sort((a,b)=>a.id.localeCompare(b.id));
  for(const t of ts)L.tests[t.id]={title:t.title,date:t.test_date||'',created:t.created_at||'',items:t.items||[],openFor:[],releasedFor:[],closedOnce:false,key:''};
  for(const r of tc){const T=L.tests[r.test_id];const n=cById[r.class_id];if(!T||!n)continue;if(r.is_open)T.openFor.push(n);if(r.released)T.releasedFor.push(n);if(r.closed_once)T.closedOnce=true;
    if(r.stats){const X=L.stats[r.test_id]=L.stats[r.test_id]||{all:null,byClass:{},at:0};X.byClass[n]=r.stats;X.at=Math.max(X.at,Date.parse(r.released_at||0)||0)}}
  for(const k of tk)L.keys[k.test_id]={a:k.answers||'',nat:k.nat,ex:k.ex,tags:k.tags};
  for(const x of sub){const s0=idx.studentById[x.student_id];if(!s0)continue;const m=L.manual[s0.id]=L.manual[s0.id]||{name:s0.sid+' '+s0.name,answers:{}};m.answers[x.test_id]={a:x.answers,at:Date.parse(x.submitted_at)||0,cls:cById[s0.class_id]||'',src:x.src}}
  S.live=L;S.idx=idx;
  await frLoad();// js/feedback.js: 한마디·다시 풀기·정답 공개 단계
  S.site=await loadSite(sb,'teacher');
}
async function api(fn,okMsg){
  if(S.demo){toast('예시 데이터에서는 저장되지 않습니다');return false}
  try{await fn();await load();render();if(okMsg)toast(okMsg);return true}
  catch(e){console.error(e);toast('저장하지 못했습니다: '+(e?.message||e));return false}
}
async function resetPw(uid){
  if(S.demo){toast('예시 데이터에서는 바꾸지 않습니다');return}
  const st=S.idx.studentById[uid];
  const r=await sb.rpc('teacher_reset_password',{p_student:uid});
  if(r.error||!r.data?.ok){toast('초기화하지 못했습니다: '+(r.error?.message||'명단에서 학생을 찾지 못했습니다'));return}
  await load();render();toast((st?st.sid+' '+st.name:'학생')+'의 비밀번호를 학번으로 되돌렸습니다');
}
function viewLogin(){return `<div class="card" style="max-width:420px;margin:32px auto"><h2>교사 로그인</h2><form id="loginForm" class="stack" style="margin-top:14px"><label class="f">아이디 또는 이메일<input type="text" id="lgEmail" autocomplete="username" autocapitalize="off" spellcheck="false" required></label><label class="f">비밀번호<input type="password" id="lgPw" autocomplete="current-password" required></label><button class="btn primary" type="submit">로그인</button><p class="sub" id="lgMsg" role="status"></p></form><div class="row" style="margin-top:6px"><a class="btn ghost small" href="./">학생 화면으로</a></div></div>`}
/* ---------- 렌더 스케줄 (입력 중에는 다시 그리지 않음) ---------- */
let dirty=false;
function busy(){const a=document.activeElement;return a&&$('#app').contains(a)&&(a.tagName==='TEXTAREA'||(a.tagName==='INPUT'&&a.type!=='button')||a.tagName==='SELECT')}
function schedule(){if(busy()){dirty=true;return}render()}
document.addEventListener('focusout',()=>setTimeout(()=>{if(dirty&&!busy()){dirty=false;render()}},50));

/* ---------- 상단 탭 ---------- */
const TABS=[['class','반 분석'],['student','학생 리포트'],['trend','누적 추이'],['manage','시험 관리'],['classes','반 관리']];
function renderTabs(){
  const nav=$('#tabs');
  if(!(S.session&&S.teacher)&&!S.demo){nav.innerHTML='';return}
  nav.innerHTML=TABS.map(([k,l])=>`<button class="tab" role="tab" aria-selected="${S.tab===k}" data-act="tab" data-v="${k}">${l}</button>`).join('')+(S.session?`<button class="tab" data-act="reload">새로고침</button><button class="tab" data-act="logout">로그아웃</button>`:'');
}

/* ---------- 메인 렌더 ---------- */
function render(){
  renderTabs();
  const app=$('#app');
  if(!S.ready){app.innerHTML=`<div class="card empty"><h2>불러오는 중</h2><p>${S.slow?'저장소에 아직 연결되지 않았습니다. 네트워크 상태를 확인해 주세요.':'시험과 답안 기록을 불러오고 있습니다.'}</p></div>`;return}
  let html='';
  if(S.demo)html+=`<div class="demo-band" role="note"><span>예시 데이터를 보는 중입니다. 가상의 학생 26명이며 실제 기록이 아니고, 여기서 바꾼 내용은 저장되지 않습니다.</span><button class="btn small" data-act="demo-off">예시 끄기</button></div>`;
  if(!S.session&&!S.demo){app.innerHTML=viewLogin();return}
  if(!S.teacher&&!S.demo){app.innerHTML=`<div class="card empty"><h2>교사로 등록되지 않은 계정입니다</h2><p>Supabase SQL Editor에서 교사 등록 줄(insert into public.teachers …)을 이 계정의 이메일로 실행했는지 확인해 주세요.</p><button class="btn" data-act="logout">로그아웃</button></div>`;return}
  {if(S.cf&&!classes().includes(S.cf))S.cf='';html+=(!['manage','classes'].includes(S.tab)&&allClasses().length?clsBar():'')+({class:viewClass,student:viewStudentReport,trend:viewTrend,manage:viewManage,classes:viewClasses}[S.tab]||viewClass)()}
  app.innerHTML=html;
  afterRender();
}
function testChips(sel,act='sel-test',filter=null){
  const ts=testList().filter(filter||(()=>true));
  return `<div class="chips" role="group" aria-label="시험 회차">${ts.map(t=>{const [c,l]=statusOf(t);return `<button class="chip" aria-pressed="${t.id===sel}" data-act="${act}" data-v="${t.id}">${esc(t.title)} <span class="pill ${c}" style="margin-left:4px">${l}</span></button>`}).join('')}</div>`;
}
function ensureSel(){const ts=testList();if(!ts.length){S.selTest=null;return null}if(!S.selTest||!D().tests[S.selTest]){const withRecs=[...ts].reverse().find(t=>recordsFor(t.id).length);S.selTest=(withRecs||ts[ts.length-1]).id}return {id:S.selTest,...D().tests[S.selTest]}}
function noTests(){return `<div class="card empty"><h2>아직 만든 시험이 없습니다</h2><p>시험 관리에서 회차를 만들고 정답을 입력하면, 학생이 답안을 내는 즉시 이곳에 문항별 정답률과 선지 분포가 나타납니다.</p><div class="row" style="justify-content:center"><button class="btn primary" data-act="tab" data-v="manage">시험 만들기</button>${S.demo?'':'<button class="btn" data-act="demo-on">예시 데이터로 둘러보기</button>'}</div></div>`}

/* ----- 반 분석 ----- */
function viewClass(){
  const t=ensureSel();if(!t)return noTests();
  const key=keyOf(t.id);const nat=natOf(t.id);const recs=recordsFor(t.id);
  let h=`<div class="stack">${testChips(t.id)}`;
  const keyMissing=t.items.some((_,i)=>!key[i]||key[i]==='0');
  if(!recs.length){return h+`<div class="card empty"><h2>${esc(t.title)}: 제출된 답안이 없습니다</h2><p>${effClasses().some(c=>isOpen(t,c))?'학생들이 이 페이지 링크로 들어와 답안을 내면 여기에 바로 집계됩니다.':'시험 관리에서 이 회차의 응시를 열거나, 종이 답안을 직접 입력해 주세요.'}</p><button class="btn" data-act="tab" data-v="manage">시험 관리로</button></div></div>`}
  const an=analyze(t,key,recs);
  const it=an.items.filter(x=>x.n);
  const rl=rosterLists();const pool=S.cf?(rl[S.cf]||[]).map(p=>({...p,cls:S.cf})):Object.entries(rl).flatMap(([c,l])=>l.map(p=>({...p,cls:c})));const done=new Set(recs.map(r=>ident(r.name)));const miss=pool.filter(p=>!done.has(p.id));const extra=pool.length?recs.filter(r=>!pool.some(p=>p.id===ident(r.name))):[];
  const focus=it.map(x=>{const why=[];const nr=nat?.[x.i]?.r;
      if(x.rate<.5)why.push(['bad',`정답률 ${pct(x.rate)}`]);
      if(x.lure.share>=.3)why.push(['warn',`${CIR[x.lure.opt]} 오답 ${pct(x.lure.share)}`]);
      if(nr!=null&&x.rate-nr<=-.15)why.push(['bad',`전국보다 ${Math.round((nr-x.rate)*100)}%p 낮음`]);
      if(x.disc!=null&&x.disc<0)why.push(['warn','변별도 음수 · 정답 확인']);
      return {...x,why,nr}}).filter(x=>x.why.length).sort((a,b)=>b.why.length-a.why.length||a.rate-b.rate).slice(0,8);
  h+=`<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2>${esc(t.title)}</h2><p class="sub">${esc(t.date||'')} · 문항 ${t.items.length}개${hasElectives(t)?' · 선택과목 분리':''}</p></div>
    </div>${frStagePanel(t,keyMissing)}
    ${classes().length&&(t.releasedFor||[]).length&&effClasses().some(c=>!isRel(t,c))?`<p class="note" style="margin-top:12px"><b>일부 반에만 공개되어 있습니다.</b> 화면에는 보이지 않지만, 아직 공개하지 않은 반 학생도 기술적으로는 정답을 찾아볼 수 있습니다. 같은 시험지를 쓰는 반이 모두 푼 뒤에 공개하는 편이 안전합니다.</p>`:''}
    ${keyMissing?`<p class="note" style="margin-top:12px"><b>정답이 비어 있는 문항이 있습니다.</b> 시험 관리에서 정답을 모두 입력해야 정답률이 맞게 계산됩니다.</p>`:''}
    ${(t.releasedFor||[]).length&&recs.some(r=>r.at>(D().stats[t.id]?.at||0))?`<p class="note" style="margin-top:12px"><b>공개한 뒤에 새 답안이 들어왔습니다.</b> 학생 화면의 반 정답률을 갱신하려면 <button class="btn small" data-act="release" data-v="${t.id}">공개 자료 갱신</button></p>`:''}
    <div class="tiles" style="margin-top:14px">
      <div class="tile"><div class="k">응시 인원</div><div class="v">${an.n}<small> 명</small></div></div>
      <div class="tile"><div class="k">평균 (100점 환산)</div><div class="v">${Math.round(an.avgPct*100)}<small> 점</small></div></div>
      <div class="tile"><div class="k">중앙값</div><div class="v">${Math.round(an.medPct*100)}<small> 점</small></div></div>
      <div class="tile"><div class="k">최고 · 최저 (원점수)</div><div class="v">${an.hi}<small> · ${an.lo}</small></div></div>
    </div></div>`;
  if(pool.length)h+=`<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">제출 현황 ${pool.length-miss.length}/${pool.length}명</h3>${miss.length?'':'<span class="pill rel">명단 전원 제출</span>'}</div>${miss.length?`<p class="sub" style="margin-top:6px">아직 답안이 없는 학생: ${miss.map(p=>esc(p.id+' '+p.name)+(S.cf?'':' ('+esc(p.cls)+')')).join(', ')}</p>`:''}${extra.length?`<p class="sub" style="margin-top:6px;color:var(--warn)">명단에 없는 학번·이름으로 낸 답안: ${extra.map(r=>esc(r.name)).join(', ')} · 학번 오타인지 확인하세요.</p>`:''}</div>`;
  h+=`<div class="grid2"><div class="card"><h3>수업에서 다룰 문항</h3><p class="sub" style="margin-bottom:8px">정답률 50% 미만, 한 오답에 30% 이상 몰림, 전국보다 15%p 이상 낮음, 상위권이 오히려 더 틀린 문항</p>
    ${focus.length?`<div class="focus-list">${focus.map(x=>`<div class="focus-item"><div class="qno">${esc(x.no)}</div><div style="min-width:0"><div>${esc(x.area)} · ${esc(x.type||'유형 미지정')}</div><div class="why">${x.why.map(([c,l])=>`<span class="pill" style="color:var(--${c})">${esc(l)}</span>`).join('')}</div>${exBlock(D().keys[t.id]?.ex?.[x.i])}</div><div class="num" style="text-align:right">반 <b class="rate lo">${pct(x.rate)}</b>${x.nr!=null?`<br><span class="muted">전국 ${pct(x.nr)}</span>`:''}</div></div>`).join('')}</div>`:'<p class="muted">특별히 짚을 문항이 없습니다.</p>'}
    </div><div class="stack"><div class="card"><h3>영역별 정답률</h3>${barRows(Object.entries(an.area).map(([k,v])=>({label:k,v})))}</div>
    <div class="card"><h3>유형별 정답률</h3>${barRows(Object.entries(an.type).sort((a,b)=>a[1]-b[1]).map(([k,v])=>({label:k,v})))}</div></div></div>`;
  const setNames=[...new Set(t.items.map(x=>x.set).filter(Boolean))];
  if(setNames.length){const srows=setNames.map(nm=>{const idx=t.items.map((x,i)=>x.set===nm?i:-1).filter(i=>i>=0);let col=0,sumc=0,cnt=0;for(const g of an.graded){const my=idx.filter(i=>g.res[i]!==undefined);if(!my.length)continue;cnt++;const w=my.filter(i=>!g.res[i]).length;sumc+=(my.length-w)/my.length;if(w>=2&&w/my.length>=.5)col++}return {nm,nos:idx.map(i=>t.items[i].no),rate:cnt?sumc/cnt:null,col:cnt?col/cnt:null}});
    h+=`<div class="card"><h3>지문 세트별</h3><p class="sub" style="margin-bottom:8px">'지문 전체를 놓친 학생'은 그 세트 문항의 절반 이상(2개 이상)을 틀린 학생입니다. 이 비율이 높으면 선지 해설보다 지문 구조 설명이 먼저입니다.</p><div class="tbl-wrap"><table><thead><tr><th>지문 세트</th><th>문항</th><th class="n">평균 정답률</th><th class="n">지문 전체를 놓친 학생</th></tr></thead><tbody>${srows.map(x=>`<tr><td>${esc(x.nm)}</td><td class="mono">${esc(x.nos.join(', '))}</td><td class="n">${pct(x.rate)}</td><td class="n ${x.col>=.3?'rate lo':''}">${pct(x.col)}</td></tr>`).join('')}</tbody></table></div></div>`}
  const ktags=D().keys[t.id]?.tags;if(ktags){const cp=[];for(const g of recs)cp.push(...tagPicks(t,key,ktags,g,t.id));if(cp.length){const c=tagCount(cp);h+=`<div class="card"><h3>반이 고른 오답의 유형</h3><p class="sub" style="margin-bottom:8px">이번 회차에서 학생들이 고른 오답 ${cp.length}개를 꼬리표별로 모았습니다.</p>${barRows(Object.entries(c).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({label:k,v:v/cp.length})))}</div>`}}
  h+=frClassCards(t,recs,key);// js/feedback.js: 설명할 문항, 학생별 한마디·다시 풀기
  const rows=[...it];
  const sorters={no:(a,b)=>a.i-b.i,rate:(a,b)=>a.rate-b.rate,gap:(a,b)=>((a.rate-(nat?.[a.i]?.r??a.rate))-(b.rate-(nat?.[b.i]?.r??b.rate))),disc:(a,b)=>(a.disc??9)-(b.disc??9)};
  rows.sort(sorters[S.sortBy]||sorters.no);
  const sb=(k,l)=>`<button data-act="sort" data-v="${k}" aria-pressed="${S.sortBy===k}">${l}${S.sortBy===k?' ↓':''}</button>`;
  h+=`<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">문항별 분석</h3><div class="legend"><span><i style="background:var(--s1)"></i>정답 선지</span><span><i style="background:var(--s2)"></i>매력적 오답(20% 이상)</span><span><i style="background:var(--line2)"></i>그 밖의 선지</span></div></div>
   <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>${sb('no','번호')}</th><th>영역 · 유형</th><th>정답</th><th class="n">${sb('rate','반 정답률')}</th>${nat?`<th class="n">전국</th><th class="n">${sb('gap','차이')}</th>`:''}<th>우리 반 선지 분포 (%)</th>${nat?'<th>전국 선지 (%)</th>':''}<th class="n">${sb('disc','변별도')}</th></tr></thead><tbody>
   ${rows.map(x=>{const nr=nat?.[x.i]?.r;const nd=nat?.[x.i]?.d;return `<tr><td class="mono"><b>${esc(x.no)}</b></td><td>${esc(x.area)}<br><span class="muted">${esc(x.type||'')}</span></td><td class="mono">${CIR[+x.ans]||'?'}</td><td class="n"><span class="rate ${x.rate<.5?'lo':x.rate>=.8?'hi':''}">${pct(x.rate)}</span><br><span class="muted">${x.c}/${x.n}</span></td>${nat?`<td class="n">${pct(nr)}</td><td class="n ${nr!=null&&x.rate-nr<=-.15?'rate lo':''}">${nr!=null?pp(x.rate-nr):'–'}</td>`:''}<td>${distBar(x)}</td>${nat?`<td class="distlab">${nd?nd.map((v,o)=>`${CIR[o+1]}${v==null?'–':Math.round(v*100)}`).join(' '):'–'}</td>`:''}<td class="n" data-tip="상위 27% 정답률 − 하위 27% 정답률. 0.2 미만이면 변별이 약하고, 음수면 정답·문항 오류를 확인해 보세요.">${x.disc==null?'–':x.disc.toFixed(2)}</td></tr>`}).join('')}
   </tbody></table></div></div></div>`;
  return h;
}

/* ----- 학생 리포트 ----- */
function viewStudentReport(){
  const t=ensureSel();if(!t)return noTests();
  const recs=recordsFor(t.id);
  let h=`<div class="stack">${testChips(t.id)}`;
  if(!recs.length)return h+`<div class="card empty"><h2>이 회차에 답안이 없습니다</h2><p>다른 회차를 고르거나 시험 관리에서 답안을 입력해 주세요.</p></div></div>`;
  if(!S.selStudent||!recs.find(r=>r.name===S.selStudent))S.selStudent=recs[0].name;
  const key=keyOf(t.id),nat=natOf(t.id);
  const an=analyze(t,key,recs);const cls=classFromAn(an,nat);
  const rec=recs.find(r=>r.name===S.selStudent);const r=report(t,key,rec,cls);
  let fb='';
  // 누적
  const all=allRecords()[rec.name]||{};const tl=testList();
  const trend=tl.map(tt=>{const rr=all[tt.id];if(!rr)return null;const k=keyOf(tt.id);const rs=recordsFor(tt.id);const a2=analyze(tt,k,rs);const nt=natOf(tt.id);let hm=null,hn=null,hc=null;if(nt){const g2=grade(tt,k,rr);const idx=g2.idx.filter(i=>nt[i]?.r!=null);if(idx.length>=2){hm=idx.filter(i=>g2.res[i]).length/idx.length;hn=idx.reduce((a,i)=>a+nt[i].r,0)/idx.length;hc=idx.reduce((a,i)=>a+(a2.items[i].rate??0),0)/idx.length}}return {label:tt.title,me:grade(tt,k,rr).pct,cls:a2.avgPct,hm,hn,hc}});
  const tr=trend.filter(Boolean);
  const myPicks=[],clsPicks=[];for(const tt of tl){const tg=D().keys[tt.id]?.tags;if(!tg)continue;const k=keyOf(tt.id);for(const rr of recordsFor(tt.id)){const p=tagPicks(tt,k,tg,rr,tt.id);if(rr.name===rec.name)myPicks.push(...p);clsPicks.push(...p)}}
  r.tagCum=myPicks;fb=feedbackText(rec.name,t,r,cls);
  h+=`<div class="card"><div class="row" style="justify-content:space-between"><label class="f">학생 선택<select id="stuSel" data-act="sel-student">${recs.map(x=>`<option ${x.name===rec.name?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
    <div class="tiles" style="flex:1;max-width:560px"><div class="tile"><div class="k">점수</div><div class="v">${r.score}<small> / ${r.max}</small></div></div><div class="tile"><div class="k">반 평균 대비</div><div class="v">${pp(r.pct-an.avgPct)}<small> %p</small></div></div><div class="tile"><div class="k">틀린 문항</div><div class="v">${r.wrong.length}<small> 개</small></div></div></div></div></div>
  ${frStudentCards(t,rec,recs,key)}
  <div class="grid2"><div class="card"><h3>많이 맞혔는데 놓친 문항</h3><p class="sub" style="margin-bottom:8px">${nat?'전국':'반'} 정답률 70% 이상인데 틀린 문항입니다. 실수나 근거 확인 부족일 가능성이 큽니다.</p>
    ${r.missedEasy.length?`<div class="focus-list">${r.missedEasy.map(x=>`<div class="focus-item"><div class="qno">${esc(x.no)}</div><div>${esc(x.area)} · ${esc(x.type||'')}<div class="why"><span class="pill" style="color:var(--bad)">고른 답 ${(x.mine==='0'?'무응답':CIR[+x.mine])}</span><span class="pill" style="color:var(--s1)">정답 ${CIR[+x.ans]}</span></div></div><div class="num" style="text-align:right">반 ${pct(x.rate)}${x.nr!=null?`<br><span class="muted">전국 ${pct(x.nr)}</span>`:''}</div></div>`).join('')}</div>`:'<p class="muted">해당 문항이 없습니다.</p>'}
  </div><div class="card"><h3>영역별 · 반과 비교</h3>${barRows(r.areaCmp.map(x=>({label:x.name,v:x.me,w:x.cls})),{a:rec.name,b:'반 평균'})}
    <h3 style="margin-top:18px">반보다 약한 유형</h3>${r.weak.length?barRows(r.weak.map(x=>({label:x.name,v:x.me,w:x.cls})),{a:rec.name,b:'반 평균'}):'<p class="muted">반 평균보다 20%p 이상 낮은 유형(2문항 이상)이 없습니다.</p>'}</div></div>
  ${setCard(r)}${tagCard(myPicks,clsPicks,'t')}${r.rare.length?`<div class="card"><h3>드물게 고른 오답</h3><p class="sub" style="margin-bottom:8px">전국 응시자 5% 이하가 고른 선지를 골라 틀린 문항입니다(전국 자료가 없는 문항은 반에서 혼자 고른 경우). 함정이 아니라 발문·지문을 잘못 읽었거나 마킹 실수였을 가능성이 큽니다.</p><div class="focus-list">${r.rare.map(x=>`<div class="focus-item"><div class="qno">${esc(x.no)}</div><div>${esc(x.area)} · ${esc(x.type||'')}<div class="why"><span class="pill" style="color:var(--bad)">고른 답 ${CIR[+x.mine]}</span><span class="pill" style="color:var(--s1)">정답 ${CIR[+x.ans]}</span></div></div><div class="num" style="text-align:right">${x.src==='전국'?'전국 '+(Math.round(x.sh*1000)/10)+'%가 선택':'반에서 혼자 선택'}</div></div>`).join('')}</div></div>`:''}
  <div class="grid2"><div class="card"><h3>회차별 점수 추이 (100점 환산)</h3>${lineChart(tr.map(x=>x.label),[{name:rec.name,color:'var(--s2)',values:tr.map(x=>x.me)},{name:'반 평균',color:'var(--s1)',values:tr.map(x=>x.cls)}])}</div>
  <div class="card"><h3>개별 피드백 문구</h3><p class="sub" style="margin-bottom:8px">자동으로 만든 초안입니다. 고친 다음 복사해서 보내세요.</p><textarea id="fbText" rows="9" style="font-family:var(--f-body);font-size:14px">${esc(fb)}</textarea><div class="row" style="margin-top:8px"><button class="btn primary" data-act="copy-fb">피드백 복사</button></div></div></div>
  ${tr.some(x=>x.hm!=null)?`<div class="card"><h3>어려운 문항 정답률 추이 (전국 오답률 상위 15문항 기준)</h3><p class="sub" style="margin-bottom:8px">회차마다 난도가 달라 점수만으로는 성장을 보기 어렵습니다. 전국에서 많이 틀린 문항만 골라 전국 정답률과 나란히 봅니다. 회차당 해당 문항이 적으면 값이 크게 흔들리니 여러 회차를 묶어서 보세요.</p>${lineChart(tr.map(x=>x.label),[{name:rec.name,color:'var(--s2)',values:tr.map(x=>x.hm)},{name:'반',color:'var(--s1)',values:tr.map(x=>x.hc)},{name:'전국',color:'var(--muted)',values:tr.map(x=>x.hn)}])}</div>`:''}
  <div class="card"><h3>틀린 문항 전체</h3>${r.wrong.length?`<div class="tbl-wrap"><table><thead><tr><th>번호</th><th>영역 · 유형</th><th>고른 답</th><th>정답</th><th class="n">반 정답률</th>${nat?'<th class="n">전국</th>':''}<th class="n">같은 답 고른 비율</th></tr></thead><tbody>${r.wrong.map(x=>{const itx=an.items[x.i];return `<tr><td class="mono"><b>${esc(x.no)}</b></td><td>${esc(x.area)} · ${esc(x.type||'')}${exBlock(D().keys[t.id]?.ex?.[x.i])}</td><td class="mono">${(x.mine==='0'?'무응답':CIR[+x.mine])}</td><td class="mono">${CIR[+x.ans]}</td><td class="n">${pct(x.rate)}</td>${nat?`<td class="n">${pct(x.nr)}</td>`:''}<td class="n">${pct(itx.dist[+x.mine]||0)}</td></tr>`}).join('')}</tbody></table></div>`:'<p class="muted">틀린 문항이 없습니다.</p>'}</div></div>`;
  return h;
}

/* ----- 누적 추이 ----- */
function viewTrend(){
  const tl=testList().filter(t=>recordsFor(t.id).length);
  if(!testList().length)return noTests();
  if(!tl.length)return `<div class="card empty"><h2>누적할 답안이 아직 없습니다</h2><p>회차마다 답안이 쌓이면 반 평균과 영역별 정답률 변화를 선으로 보여 줍니다.</p></div>`;
  const ans=tl.map(t=>({t,an:analyze(t,keyOf(t.id),recordsFor(t.id))}));
  const areas=AREAS.filter(a=>ans.some(x=>x.an.area[a]!=null));
  // 학생 × 유형 (전 회차 합산, 반 대비 차이)
  const tot={},stu={};
  for(const {t,an} of ans)for(const g of an.graded)for(const i of g.idx){const ty=t.items[i].type||'(미지정)';tot[ty]=tot[ty]||{c:0,n:0};tot[ty].n++;if(g.res[i])tot[ty].c++;stu[g.name]=stu[g.name]||{};const s=stu[g.name][ty]=stu[g.name][ty]||{c:0,n:0};s.n++;if(g.res[i])s.c++}
  const types=Object.entries(tot).sort((a,b)=>b[1].n-a[1].n).slice(0,10).map(x=>x[0]);
  const names=Object.keys(stu).sort((a,b)=>a.localeCompare(b,'ko'));
  const cell=(nm,ty)=>{const s=stu[nm][ty];if(!s||!s.n)return '<td class="muted">·</td>';const d=s.c/s.n-tot[ty].c/tot[ty].n;const m=Math.min(55,Math.round(Math.abs(d)*110));return `<td style="background:color-mix(in oklab, ${d>=0?'var(--div-pos)':'var(--div-neg)'} ${m}%, var(--div-mid))" data-tip="${esc(nm+' · '+ty+'\n본인 '+pct(s.c/s.n)+' ('+s.c+'/'+s.n+') · 반 '+pct(tot[ty].c/tot[ty].n))}">${pp(d)}</td>`};
  const hd=ans.map(({t,an})=>{const nt=natOf(t.id);if(!nt)return {hc:null,hn:null};const its=an.items.filter(x=>x.n&&nt[x.i]?.r!=null);if(its.length<2)return {hc:null,hn:null};return {hc:its.reduce((a,x)=>a+x.rate,0)/its.length,hn:its.reduce((a,x)=>a+nt[x.i].r,0)/its.length}});
  const hardCard=hd.some(x=>x.hc!=null)?`<div class="card"><h3>어려운 문항 정답률: 반과 전국 (전국 오답률 상위 15문항 기준)</h3>${lineChart(ans.map(x=>x.t.title),[{name:'반',color:'var(--s1)',values:hd.map(x=>x.hc)},{name:'전국',color:'var(--muted)',values:hd.map(x=>x.hn)}])}<p class="sub">반 선이 전국 선에 가까워지거나 넘어서면 어려운 문항을 다루는 힘이 늘고 있다는 뜻입니다.</p></div>`:'';
  return `<div class="stack"><div class="grid2">
   <div class="card"><h3>반 평균 추이 (100점 환산)</h3>${lineChart(ans.map(x=>x.t.title),[{name:'반 평균',color:'var(--s1)',values:ans.map(x=>x.an.avgPct)}])}<p class="sub">회차마다 시험 난이도가 다르므로, 전국 정답률을 넣은 회차는 반 분석의 '차이' 열과 함께 보세요.</p></div>
   <div class="card"><h3>영역별 정답률 추이</h3>${lineChart(ans.map(x=>x.t.title),areas.map(a=>({name:a,color:AREA_COLOR[a],values:ans.map(x=>x.an.area[a]??null)})))}</div></div>${hardCard}
   <div class="card"><h3>학생 × 유형: 반 평균과의 차이 (%p, 전 회차 합산)</h3><p class="sub" style="margin-bottom:10px">파란 칸은 반보다 잘한 유형, 붉은 칸은 반보다 약한 유형입니다. 칸에 마우스를 올리면 문항 수가 나옵니다. 문항 수가 적은 칸은 우연의 영향이 큽니다.</p>
   <div class="legend" style="margin-bottom:8px"><span><i style="background:color-mix(in oklab,var(--div-neg) 55%,var(--div-mid))"></i>반보다 낮음</span><span><i style="background:var(--div-mid)"></i>비슷함</span><span><i style="background:color-mix(in oklab,var(--div-pos) 55%,var(--div-mid))"></i>반보다 높음</span></div>
   <div class="tbl-wrap"><table class="heat"><thead><tr><th>학생</th>${types.map(t=>`<th>${esc(t)}</th>`).join('')}</tr></thead><tbody>${names.map(nm=>`<tr><td class="nm">${esc(nm)}</td>${types.map(ty=>cell(nm,ty)).join('')}</tr>`).join('')}</tbody></table></div></div></div>`;
}

/* ----- 시험 관리 ----- */
function newItems(kind,n){
  const mk=(no,area,el)=>({no:String(no),area,type:'',pts:2,el:el||''});
  if(kind==='elec'){const a=[];for(let i=1;i<=34;i++)a.push(mk(i,i<=17?'독서':'문학'));for(const [el,area] of Object.entries(ELEC))for(let i=35;i<=45;i++)a.push(mk(i,area,el));return a}
  if(kind==='single'){const a=[];for(let i=1;i<=45;i++)a.push(mk(i,i<=17?'독서':i<=34?'문학':'기타'));return a}
  return Array.from({length:n||20},(_,i)=>mk(i+1,'독서'));
}
function startEdit(id){
  if(id){const t=D().tests[id];S.edit={id,title:t.title,date:t.date||'',items:JSON.parse(JSON.stringify(t.items)),key:keyOf(id).concat(Array(t.items.length).fill('0')).slice(0,t.items.length),nat:JSON.parse(JSON.stringify(natOf(id)||[])),ex:JSON.parse(JSON.stringify(D().keys[id]?.ex||[])),tags:JSON.parse(JSON.stringify(D().keys[id]?.tags||[]))}}
  else S.edit={id:null,title:'',date:new Date().toISOString().slice(0,10),items:newItems('single'),key:Array(45).fill('0'),nat:[],ex:[],tags:[]};
  S.natText='';S.exText='';S.tagText='';confirmItems=false;
}
function viewManage(){
  if(S.edit)return viewEditor();
  const ts=testList();
  let h=`<div class="stack"><div class="card"><div class="row" style="justify-content:space-between"><div><h2>시험 회차</h2><p class="sub">회차를 만들고 정답을 넣은 뒤 응시를 열면, 학생 화면에 답안지가 나타납니다.</p></div><div class="row"><button class="btn primary" data-act="new-test">새 시험 만들기</button>${S.demo?'':'<button class="btn" data-act="demo-on">예시 데이터로 둘러보기</button>'}</div></div>`;
  if(!ts.length)h+=`<p class="note" style="margin-top:14px">아직 시험이 없습니다. <b>새 시험 만들기</b>를 누르면 45문항 틀이 미리 채워집니다. 영역 구분은 실제 시험지를 보고 맞춰 주세요.</p>`;
  else h+=`<div class="tbl-wrap" style="margin-top:14px"><table><thead><tr><th>시험</th><th>상태</th><th class="n">답안</th><th>정답</th><th>전국 자료</th><th></th></tr></thead><tbody>${ts.map(t=>{const [c,l]=statusOf(t);const k=keyOf(t.id);const filled=t.items.filter((_,i)=>k[i]&&k[i]!=='0').length;const nat=natOf(t.id);const cf=S.confirm==='del:'+t.id;return `<tr><td><b>${esc(t.title)}</b><br><span class="muted">${esc(t.date||'')}</span></td><td>${classes().length?classes().map(cc=>{const [c2,l2]=statusOf(t,cc);return `<div><span class="pill ${c2}">${esc(cc)} ${l2}</span></div>`}).join(''):`<span class="pill ${c}">${l}</span>`}</td><td class="n">${recordsFor(t.id,'').length}</td><td class="num">${filled}/${t.items.length}</td><td>${nat&&nat.some(Boolean)?'있음':'<span class="muted">없음</span>'}</td><td><div class="row" style="gap:6px">${effClasses().map(c=>isHiddenCls(c)?`<span class="badge">${esc(c)} 숨김</span>`:isOpen(t,c)?`<button class="btn small" data-act="close" data-v="${t.id}|${esc(c)}">${c?esc(c)+' ':''}응시 닫기</button>`:`<button class="btn small" data-act="open" data-v="${t.id}|${esc(c)}">${c?esc(c)+' ':''}응시 열기</button>`).join('')}<button class="btn small" data-act="edit" data-v="${t.id}">편집</button>${cf?`<span class="confirm">이 시험에 낸 답안 기록도 함께 지워집니다 <button class="btn small red" data-act="del-yes" data-v="${t.id}">삭제</button><button class="btn small ghost" data-act="cancel-confirm">취소</button></span>`:`<button class="btn small ghost" data-act="del" data-v="${t.id}">삭제</button>`}</div></td></tr>`}).join('')}</tbody></table></div>`;
  h+='</div>';
  {const x={...SITE_DEFAULT,...(S.site||{})};h+=`<div class="card"><h3>사이트 제목</h3><p class="sub" style="margin-bottom:10px">학생 화면과 교사 화면 맨 위에 보이는 제목과 그 위의 작은 설명 줄입니다.</p><div class="row" style="align-items:flex-end"><label class="f" style="flex:1;min-width:160px">제목<input type="text" id="siteTitle" maxlength="40" value="${esc(x.title)}"></label><label class="f" style="flex:2;min-width:200px">학생 화면 설명 줄<input type="text" id="siteStu" maxlength="60" value="${esc(x.student_subtitle)}"></label><label class="f" style="flex:2;min-width:200px">교사 화면 설명 줄<input type="text" id="siteTch" maxlength="60" value="${esc(x.teacher_subtitle)}"></label><button class="btn primary" data-act="site-save">제목 저장</button></div></div>`}
  h+=`<p class="note">반 만들기, 학생 명단, 비밀번호 초기화는 위쪽 <button class="btn small" data-act="tab" data-v="classes">반 관리</button> 탭으로 옮겼습니다.</p>`;
  if(ts.length){
    if(!S.importTest||!D().tests[S.importTest])S.importTest=ts[ts.length-1].id;
    const it=D().tests[S.importTest];
    const pv=S.importPreview;
    h+=`<div class="grid2"><div class="card"><h3>종이 답안 입력</h3>
      <p class="sub" style="margin-bottom:10px">한 줄에 한 명씩 <span class="mono">학번 이름 답안</span> 또는 <span class="mono">학번 답안</span>으로 적습니다. 빈 칸은 0으로 적습니다. 반 명단에 있는 학번만 저장되며, 학생이 직접 낸 답안이 있으면 이것으로 바뀝니다.</p>
      <label class="f">이름·답안 줄이 들어갈 회차<select id="impTest" data-act="imp-test">${ts.map(t=>`<option value="${t.id}" ${t.id===S.importTest?'selected':''}>${esc(t.title)}</option>`).join('')}</select></label>
            <textarea id="impText" rows="7" style="margin-top:10px" placeholder="${hasElectives(it)?'20315 김하늘 3152413524135241352413524135241352413524135 언매':'20315 김하늘 315241352413524135241352413524135241352413524'}">${esc(S.importText)}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn" data-act="imp-parse">확인하기</button>${pv&&pv.ok.length?`<button class="btn primary" data-act="imp-save">${pv.ok.length}명 저장</button>`:''}</div>
      ${pv?`<div style="margin-top:10px;font-size:13.5px">${pv.ok.map(o=>`<div>✓ ${esc(o.name)} · ${esc(D().tests[o.tid]?.title||'')} · ${o.cnt}문항${o.el?' · '+esc(o.el):''}${o.cls?' · '+esc(o.cls):''}</div>`).join('')}${pv.bad.map(b=>`<div style="color:var(--bad)">✗ ${esc(b)}</div>`).join('')}</div>`:''}
    </div><div class="card"><h3>${esc(it.title)} 제출 현황</h3>${(()=>{const rs=recordsFor(it.id,'');if(!rs.length)return '<p class="muted">아직 제출된 답안이 없습니다.</p>';return `<div class="tbl-wrap"><table><thead><tr><th>이름</th><th>경로</th><th>제출 시각</th><th></th></tr></thead><tbody>${rs.map(r=>{const cf=S.confirm==='rm:'+r.path+':'+it.id;return `<tr><td>${esc(r.name)}${r.cls?` <span class="muted">${esc(r.cls)}</span>`:''}</td><td>${r.src==='student'?'학생 직접':'교사 입력'}</td><td class="num muted">${r.at?new Date(r.at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):''}</td><td>${cf?`<span class="confirm"><button class="btn small red" data-act="rm-yes" data-v="${esc(r.path)}">지우기</button><button class="btn small ghost" data-act="cancel-confirm">취소</button></span>`:`<button class="btn small ghost" data-act="rm" data-v="${esc(r.path)}">지우기</button>`}</td></tr>`}).join('')}</tbody></table></div>`})()}</div></div>`;
  }
  h+=`<div class="note"><b>학생에게 나눠 줄 것</b> 이 사이트 주소(교사 화면 말고 첫 화면)뿐입니다. 초기 비밀번호는 학번이고, 학생은 처음 로그인할 때 새 비밀번호를 정합니다. 학생은 학번과 비밀번호로 로그인해 자기 반에 열린 시험에 답을 내고, 결과가 공개되면 자기 결과와 누적 기록을 봅니다.</div></div>`;
  return h;
}
function viewEditor(){
  const E=S.edit;const groups=[['','공통'],...Object.keys(ELEC).map(k=>[k,k])].filter(([g])=>E.items.some(it=>(it.el||'')===g));
  const total=g=>E.items.filter(it=>(it.el||'')===g).reduce((a,it)=>a+(+it.pts||0),0);
  const totLine=groups.length>1?groups.slice(1).map(([g])=>`공통+${g} ${total('')+total(g)}점`).join(' · '):`총 ${total('')}점`;
  let rows='';let cur=null;
  E.items.forEach((it,i)=>{const g=it.el||'';if(g!==cur){cur=g;rows+=`<tr><th colspan="9" style="background:var(--omr-soft);color:var(--omr-ink)">${g?esc(g)+' ('+esc(ELEC[g])+')':'공통 과목'}</th></tr>`}
    rows+=`<tr data-i="${i}"><td style="width:62px"><input type="text" id="no-${i}" value="${esc(it.no)}" data-f="no" style="width:52px" aria-label="문항 번호"></td>
    <td><div class="bubs">${[1,2,3,4,5].map(o=>`<button class="bub" aria-pressed="${E.key[i]===String(o)}" data-act="key" data-i="${i}" data-v="${o}" aria-label="${it.no}번 정답 ${o}">${o}</button>`).join('')}</div></td>
    <td><select id="ar-${i}" data-f="area" aria-label="영역">${[...AREAS,...(AREAS.includes(it.area)?[]:[it.area])].map(a=>`<option ${a===it.area?'selected':''}>${esc(a)}</option>`).join('')}</select></td>
    <td style="min-width:150px"><input type="text" id="ty-${i}" list="dl-${esc(it.area)}" value="${esc(it.type)}" data-f="type" placeholder="유형" aria-label="문항 유형"></td>
    <td><button class="btn small" data-act="pts" data-i="${i}" aria-label="배점">${it.pts}점</button></td><td><input type="text" id="se-${i}" value="${esc(it.set||'')}" data-f="set" placeholder="지문" style="width:110px" aria-label="지문 세트"></td>
    <td class="distlab">${E.nat[i]?`전국 ${pct(E.nat[i].r)}`:''}</td><td class="distlab">${E.ex[i]?'있음':''}</td><td class="distlab">${E.tags[i]?Object.entries(E.tags[i]).map(([o,g])=>CIR[+o]+esc(g)).join(' '):''}</td></tr>`});
  return `<div class="stack"><div class="card"><div class="row" style="justify-content:space-between"><h2>${E.id?'시험 편집':'새 시험'}</h2><div class="row"><button class="btn ghost" data-act="edit-cancel">취소</button><button class="btn primary" data-act="edit-save">저장</button></div></div>
   <div class="row" style="margin-top:12px;align-items:flex-end"><label class="f" style="flex:2;min-width:220px">시험 이름<input type="text" id="edTitle" value="${esc(E.title)}" placeholder="예: 2026년 6월 고2 전국연합학력평가"></label><label class="f">시행일<input type="date" id="edDate" value="${esc(E.date)}"></label></div>
   <div class="row" style="margin-top:12px"><span class="sub">문항 틀:</span><button class="btn small" data-act="tpl" data-v="single">45문항 단일</button><span class="row" style="gap:6px"><input type="number" id="tplN" min="1" max="80" value="20" style="width:70px" aria-label="문항 수"><button class="btn small" data-act="tpl" data-v="n">문항 수로 만들기</button></span></div>
   <div class="row" style="margin-top:12px;align-items:flex-end"><span class="sub" style="align-self:center">영역 범위 지정:</span><label class="f">시작<input type="number" id="rgFrom" min="1" value="1" style="width:70px"></label><label class="f">끝<input type="number" id="rgTo" min="1" value="10" style="width:70px"></label><label class="f">영역<select id="rgArea">${AREAS.map(a=>`<option>${a}</option>`).join('')}</select></label><label class="f">유형(선택)<input type="text" id="rgType" placeholder="비우면 그대로" style="width:140px"></label><label class="f">지문 세트(선택)<input type="text" id="rgSet" placeholder="예: 독서-인문" style="width:130px"></label><button class="btn small" data-act="range">적용</button></div>
   <p class="note" style="margin-top:12px">고2 학평의 영역 구성은 회차마다 다를 수 있으니 실제 문제지를 보고 범위를 지정하세요. 수집 파일의 <span class="mono"># 영역:</span> 줄을 아래 '전국 자료' 칸에 함께 붙여넣으면 자동으로 들어갑니다. 틀을 바꾸면 아래 정답과 유형이 초기화됩니다. 배점 버튼을 누르면 2점과 3점이 바뀝니다. 현재 ${esc(totLine)}.</p></div>
   <div class="grid2"><div class="card"><h3>정답 한 번에 넣기</h3><p class="sub" style="margin-bottom:8px">정답 숫자를 이어 붙여 적습니다. 예: 31524 13524…</p>${groups.map(([g,l])=>`<label class="f" style="margin-bottom:8px">${esc(l)} (${E.items.filter(it=>(it.el||'')===g).length}문항)<input type="text" id="bulk-${g||'c'}" class="mono" placeholder="${'31524'.repeat(3)}…"></label>`).join('')}<button class="btn" data-act="bulk">정답 채우기</button></div>
   <div class="card"><h3>전국 정답률 · 선지 비율 붙여넣기</h3><p class="sub" style="margin-bottom:8px">수집 파일 내용을 통째로 붙여넣으면 됩니다. <span class="mono"># 정답:</span>, <span class="mono"># 배점 3점 문항:</span>, <span class="mono"># 영역:</span> 줄과 <span class="mono">번호 정답률 ①~⑤ 비율</span> 줄을 모두 읽습니다. 선지 비율은 없어도 됩니다.</p><textarea id="natText" rows="5" placeholder="1 87 3 4 87 4 2&#10;2 64 10 64 8 12 6&#10;언매 35 58 6 58 20 9 7">${esc(S.natText)}</textarea><div class="row" style="margin-top:8px"><button class="btn" data-act="nat-apply">전국 자료 적용</button>${E.nat.some(Boolean)?'<button class="btn ghost small" data-act="nat-clear">전국 자료 지우기</button>':''}</div><p class="sub" style="margin-top:6px">이 자료는 결과를 공개하기 전까지 교사에게만 보입니다. 선지 비율만 봐도 정답을 짐작할 수 있기 때문입니다.</p></div></div>
   <div class="card"><h3>문항별 해설 붙여넣기</h3><p class="sub" style="margin-bottom:8px">해설지 내용을 붙여넣습니다. 각 문항은 <span class="mono">[1]</span> 또는 <span class="mono">1.</span>처럼 번호로 시작하는 줄에서 시작하고, 다음 번호가 나올 때까지가 그 문항의 해설입니다. 해설은 결과를 공개한 뒤에 학생 화면의 틀린 문항 아래에 나타납니다.</p><textarea id="exText" rows="6" placeholder="[1] 정답 ③ 2문단에서 … &#10;[2] 정답 ① …">${esc(S.exText||'')}</textarea><div class="row" style="margin-top:8px"><button class="btn" data-act="ex-apply">해설 적용</button><span class="sub">${E.ex.filter(Boolean).length}문항에 해설이 있습니다</span>${E.ex.some(Boolean)?'<button class="btn ghost small" data-act="ex-clear">해설 지우기</button>':''}</div></div>
   <div class="card"><h3>오답 선지 오류 유형</h3><p class="sub" style="margin-bottom:8px">문항마다 오답 선지에 '왜 틀린 선지인지' 꼬리표를 붙입니다. 한 줄에 한 문항: <span class="mono">번호 ②과잉 추론 ④사실 불일치</span>. 학생이 고른 오답의 꼬리표가 쌓이면 독해 습관이 보입니다. 결과를 공개하기 전까지 교사만 봅니다.</p><p class="sub" style="margin-bottom:8px">기본 꼬리표: ${ERR.map(x=>`<span class="pill" style="color:var(--ink2)" data-tip="${esc(ERR_DESC[x])}">${esc(x)}</span>`).join(' ')} (다른 이름도 쓸 수 있음)</p><textarea id="tagText" rows="5" placeholder="3 ①사실 불일치 ②과잉 추론 ④관계 왜곡 ⑤부분 오류">${esc(S.tagText||'')}</textarea><div class="row" style="margin-top:8px"><button class="btn" data-act="tag-apply">오류 유형 적용</button><span class="sub">${E.tags.filter(Boolean).length}문항에 꼬리표가 있습니다</span>${E.tags.some(Boolean)?'<button class="btn ghost small" data-act="tag-clear">꼬리표 지우기</button>':''}</div></div>
   <div class="card"><h3>문항표</h3><div class="tbl-wrap"><table class="ed"><thead><tr><th>번호</th><th>정답</th><th>영역</th><th>유형</th><th>배점</th><th>세트</th><th>전국</th><th>해설</th><th>오류 유형</th></tr></thead><tbody>${rows}</tbody></table></div>
   ${AREAS.map(a=>`<datalist id="dl-${a}">${TYPES[a].map(x=>`<option value="${esc(x)}"></option>`).join('')}</datalist>`).join('')}</div></div>`;
}

/* ---------- 이벤트 ---------- */
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b||b.tagName==='SELECT')return;
  const act=b.dataset.act,v=b.dataset.v;
  switch(act){
    case 'tab':S.tab=v;S.preview=false;S.confirm=null;render();break;
    case 'sel-test':S.selTest=v;render();break;
    case 'sort':S.sortBy=v;render();break;
    case 'demo-on':if(!(S.session&&S.teacher))break;S.demo=makeDemo();S.selTest=null;render();break;
    case 'demo-off':S.demo=null;S.selTest=null;S.edit=null;render();break;
    case 'copy-fb':copy($('#fbText').value,$('#fbText'));break;
    case 'release':{const t=D().tests[v];const key=keyOf(v);const tg=S.cf?[S.cf]:liveClasses();if(!tg.length){toast('반을 먼저 만들어 주세요');break}await api(async()=>{for(const c of tg){const rs=recordsFor(v,c);const stats=rs.length?toStats(analyze(t,key,rs)):null;chk(await sb.from('test_class').upsert({test_id:v,class_id:clsId(c),released:true,released_at:nowIso(),stats},{onConflict:'test_id,class_id'}))}},(S.cf?S.cf+'에 ':'')+'결과를 공개했습니다');break}
    case 'unrelease':{const tg=S.cf?[S.cf]:liveClasses();await api(async()=>{for(const c of tg)chk(await sb.from('test_class').update({released:false,released_at:null,stats:null}).eq('test_id',v).eq('class_id',clsId(c)))},'공개를 취소했습니다');break}
    case 'open':{const [id,c]=v.split('|');if(!c){toast('반을 먼저 만들어 주세요');break}if(isHiddenCls(c)){toast('숨긴 반에는 응시를 열 수 없습니다. 반 관리에서 다시 보이게 해 주세요');break}await api(async()=>chk(await sb.from('test_class').upsert({test_id:id,class_id:clsId(c),is_open:true},{onConflict:'test_id,class_id'})),c+' 응시를 열었습니다');break}
    case 'close':{const [id,c]=v.split('|');await api(async()=>chk(await sb.from('test_class').update({is_open:false,closed_once:true}).eq('test_id',id).eq('class_id',clsId(c))),c+' 응시를 닫았습니다');break}
    case 'del':S.confirm='del:'+v;render();break;
    case 'del-yes':S.confirm=null;await api(async()=>chk(await sb.from('tests').delete().eq('id',v)),'시험과 그 답안을 지웠습니다');break;
    case 'cancel-confirm':S.confirm=null;render();break;
    case 'rm':S.confirm='rm:'+v+':'+S.importTest;render();break;
    case 'rm-yes':{S.confirm=null;const sid=v.split('/')[1];await api(async()=>chk(await sb.from('submissions').delete().eq('test_id',S.importTest).eq('student_id',sid)),'답안을 지웠습니다');break}
    case 'new-test':startEdit(null);render();break;
    case 'edit':startEdit(v);render();break;
    case 'edit-cancel':S.edit=null;render();break;
    case 'tpl':{const n=+($('#tplN')?.value||20);S.edit.items=newItems(v,Math.min(80,Math.max(1,n)));S.edit.key=Array(S.edit.items.length).fill('0');S.edit.nat=[];S.edit.ex=[];S.edit.tags=[];render();break}
    case 'key':{const i=+b.dataset.i;S.edit.key[i]=S.edit.key[i]===v?'0':v;b.parentElement.querySelectorAll('.bub').forEach(x=>x.setAttribute('aria-pressed',S.edit.key[i]===x.dataset.v));break}
    case 'pts':{const i=+b.dataset.i;const it=S.edit.items[i];it.pts=it.pts===3?2:3;render();break}
    case 'bulk':{const E=S.edit;let n=0;for(const g of ['','화작','언매']){const el=$('#bulk-'+(g||'c'));if(!el||!el.value.trim())continue;const ds=el.value.replace(/[^0-5]/g,'').split('');const idx=E.items.map((it,i)=>(it.el||'')===g?i:-1).filter(i=>i>=0);idx.forEach((i,k)=>{if(ds[k]!=null){E.key[i]=ds[k];n++}})}render();toast(n+'문항 정답을 채웠습니다');break}
    case 'nat-apply':{S.natText=$('#natText').value;const res=parseNat(S.edit,S.natText);render();toast(res.ok+'문항 적용'+(res.meta?' · '+res.meta:'')+(res.bad.length?`, 읽지 못한 줄 ${res.bad.length}개(${res.bad.slice(0,3).join(', ')})`:''));break}
    case 'nat-clear':S.edit.nat=[];render();break;
    case 'range':{const E=S.edit;const a=+$('#rgFrom').value,z=+$('#rgTo').value,ar=$('#rgArea').value,ty=$('#rgType').value.trim(),se=$('#rgSet').value.trim();let n=0;E.items.forEach(it=>{const no=parseInt(it.no,10);if(no>=Math.min(a,z)&&no<=Math.max(a,z)){it.area=ar;if(ty)it.type=ty;if(se)it.set=se;n++}});render();toast(n+'문항을 '+ar+'(으)로 지정했습니다');break}
    case 'ex-apply':{S.exText=$('#exText').value;const r=parseEx(S.edit,S.exText);render();toast(r.n+'문항에 해설을 넣었습니다'+(r.mismatch.length?` · 해설의 정답이 입력한 정답과 다른 문항: ${r.mismatch.join(', ')}번`:'')+(r.cut.length?` · 너무 길어 뒷부분을 자른 문항: ${r.cut.join(', ')}번`:''));break}
    case 'ex-clear':S.edit.ex=[];render();break;
    case 'tag-apply':{S.tagText=$('#tagText').value;const n=parseTags(S.edit,S.tagText);render();toast(n+'문항에 꼬리표를 넣었습니다');break}
    case 'tag-clear':S.edit.tags=[];render();break;
    case 'hid-toggle':S.showHidden=!S.showHidden;lsSet('gb-show-hidden',S.showHidden);render();break;
    case 'cf':S.cf=v;lsSet('omr-cf',v);S.selStudent=null;render();break;
    case 'site-save':{const v2={title:normName($('#siteTitle').value),student_subtitle:normName($('#siteStu').value),teacher_subtitle:normName($('#siteTch').value)};if(!v2.title){toast('제목을 적어 주세요');break}await api(async()=>chk(await sb.from('site_settings').update({...v2,updated_at:nowIso()}).eq('id',1).select()).length||(()=>{throw new Error('설정 표가 없습니다. Supabase에서 최신 schema.sql을 다시 실행해 주세요')})(),'제목을 저장했습니다');break}
    case 'reload':S.ready=false;render();try{await load()}catch(e){toast('불러오지 못했습니다: '+(e?.message||e))}S.ready=true;render();break;
    case 'logout':await sb.auth.signOut();S.session=null;S.teacher=false;S.live={tests:{},keys:{},stats:{},subs:{},manual:{},config:{},roster:{}};render();break;
    case 'edit-save':await saveEdit();break;
    case 'imp-parse':S.importText=$('#impText').value;S.importPreview=parseImport(S.importText,S.importTest);render();break;
    case 'imp-save':await saveImport();break;
  }
});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.id==='stuSel'){S.selStudent=el.value;render();return}
  if(el.id==='impTest'){S.importTest=el.value;S.importPreview=null;render();return}
  if(S.edit){const tr=el.closest('tr[data-i]');if(tr&&el.dataset.f){const it=S.edit.items[+tr.dataset.i];it[el.dataset.f]=el.value.trim();if(el.dataset.f==='area'){const ty=$('#ty-'+tr.dataset.i);if(ty)ty.setAttribute('list','dl-'+el.value)}}}
});
document.addEventListener('input',e=>{
  const el=e.target;
  if(el.id==='impText')S.importText=el.value;
  if(el.id==='natText')S.natText=el.value;
  if(el.id==='exText')S.exText=el.value;
  if(el.id==='tagText')S.tagText=el.value;
  if(S.edit){if(el.id==='edTitle')S.edit.title=el.value;if(el.id==='edDate')S.edit.date=el.value;const tr=el.closest('tr[data-i]');if(tr&&el.dataset.f&&el.tagName==='INPUT')S.edit.items[+tr.dataset.i][el.dataset.f]=el.value}
});
function afterRender(){}

/* ---------- 저장 동작 ---------- */
async function saveEdit(){
  const E=S.edit;if(!E.title.trim()){toast('시험 이름을 적어 주세요');$('#edTitle')?.focus();return}
  const id=E.id||crypto.randomUUID();
  const items=E.items.map(it=>({no:String(it.no||'').trim()||'?',area:it.area||'기타',type:(it.type||'').trim(),pts:+it.pts||2,set:(it.set||'').trim()}));
  const nat=E.nat.some(Boolean)?items.map((_,i)=>E.nat[i]||null):null;
  const ex=E.ex.some(Boolean)?items.map((_,i)=>E.ex[i]||null):null;
  const tags=E.tags.some(Boolean)?items.map((_,i)=>E.tags[i]||null):null;
  if(E.id&&recordsFor(E.id,'',true).length&&D().tests[E.id]?.items?.length!==items.length&&!confirmItems){S.confirm='items:'+E.id;toast('답안이 있는 시험의 문항 수가 바뀝니다. 저장을 한 번 더 누르면 진행합니다');confirmItems=true;return}
  confirmItems=false;
  const ok=await api(async()=>{
    chk(await sb.from('tests').upsert({id,title:E.title.trim(),test_date:E.date||null,items,updated_at:nowIso()}));
    chk(await sb.from('test_keys').upsert({test_id:id,answers:E.key.join(''),nat,ex,tags,updated_at:nowIso()}));
  },'저장했습니다');
  if(ok){S.edit=null;S.selTest=id;S.importTest=id;render()}
}
let confirmItems=false;
/* parseNat·parseEx는 js/logic.js에 있다(테스트에서도 같은 코드를 쓴다). */
function parseTags(E,text){let n=0;for(const raw of text.split(/\n/)){const m=raw.trim().match(/^(\d{1,2})[번.]?\s+(.+)$/);if(!m)continue;const i=E.items.findIndex(it=>String(it.no)===m[1]&&!it.el);if(i<0)continue;const rest=m[2].replace(/(^|[\s,;\/])([1-5])\s*[:：)]\s*/g,(x,p,d)=>p+CIR[+d]);const o={};for(const part of rest.split(/(?=[①②③④⑤])/)){const k=CIR.indexOf(part[0]);if(k<1)continue;const tg=part.slice(1).replace(/^[\s:：]+/,'').replace(/[\s,;\/]+$/,'').trim();if(tg&&String(k)!==E.key[i])o[k]=tg}if(Object.keys(o).length){E.tags[i]=o;n++}}return n}
function parseImport(text,tid){
  const ok=[],bad=[];
  for(const raw of text.split(/\n/)){const line=raw.trim();if(!line)continue;
    if(line.startsWith('KORA1.')){try{const o=JSON.parse(unb64u(line.slice(6)));const t=D().tests[o.t];if(!t){bad.push('없는 시험의 코드: '+line.slice(0,16)+'…');continue}ok.push({name:normName(o.n),tid:o.t,a:String(o.a).slice(0,t.items.length).padEnd(t.items.length,'0'),el:o.e||'',cls:o.c||'',at:o.at||Date.now(),src:'code',cnt:applicable(t,o.e||'').filter(i=>o.a[i]&&o.a[i]!=='0').length})}catch(e){bad.push('코드를 읽지 못함: '+line.slice(0,16)+'…')}continue}
    const t=D().tests[tid];const toks=line.split(/[\s,\t]+/);let el='';
    const ei=toks.findIndex(x=>/^(화작|언매|화법과작문|언어와매체)$/.test(x));if(ei>=0){el=/화/.test(toks[ei])?'화작':'언매';toks.splice(ei,1)}
    const ans=toks.pop()||'';let name=normName(toks.join(' '));{const ro=rosterIndex()[ident(name)];if(ro)name=ro.id+' '+ro.name}
    if(!name||!/^[0-5.]+$/.test(ans)){bad.push(line.slice(0,20)+' (이름 뒤에 답안 숫자가 필요합니다)');continue}
    if(hasElectives(t)&&!el){bad.push(name+': 화작 또는 언매를 적어 주세요');continue}
    const idx=applicable(t,el);const ds=ans.replace(/\./g,'0');
    if(ds.length!==idx.length){bad.push(`${name}: 답안 ${ds.length}개, 필요한 수 ${idx.length}개`);continue}
    const arr=Array(t.items.length).fill('0');idx.forEach((i,k)=>arr[i]=ds[k]);
    ok.push({name,tid,a:arr.join(''),el,cls:classes().length?(S.impCls||classes()[0]):'',at:Date.now(),src:'teacher',cnt:idx.length});
  }
  return {ok,bad};
}
async function saveImport(){
  const pv=S.importPreview;if(!pv)return;
  if(S.demo){toast('예시 데이터에서는 저장되지 않습니다');return}
  const miss=[],rows=[];
  for(const o of pv.ok){const st=S.idx.studentBySid[ident(o.name)];if(!st){miss.push(o.name);continue}rows.push({test_id:o.tid,student_id:st.id,answers:o.a,src:'teacher',submitted_at:nowIso()})}
  if(miss.length)toast('명단에 없는 학번이라 건너뜀: '+miss.join(', '));
  if(!rows.length)return;
  const ok=await api(async()=>chk(await sb.from('submissions').upsert(rows,{onConflict:'test_id,student_id'})),rows.length+'명의 답안을 저장했습니다');
  if(ok){S.importText='';S.importPreview=null;render()}
}
/* ---------- 예시 데이터 (메모리 전용) ---------- */
function makeDemo(){
  let s=20261122;const rnd=()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
  const nrm=()=>Math.sqrt(-2*Math.log(rnd()+1e-9))*Math.cos(2*Math.PI*rnd());
  const d={tests:{},keys:{},stats:{},subs:{},manual:{},config:{main:{classes:['화목반','수금반']}}};
  const studs=Array.from({length:26},(_,i)=>({name:String(20101+i)+' 예시학생'+String(i+1).padStart(2,'0'),th:nrm(),el:'',cls:i%2?'수금반':'화목반'}));
  d.roster={main:{lists:{}}};for(const st of studs){const [id,nm]=st.name.split(' ');(d.roster.main.lists[st.cls]=d.roster.main.lists[st.cls]||[]).push({id,name:nm})}
  [['t_demo1','3월 학력평가 (예시)','2026-03-26'],['t_demo2','6월 학력평가 (예시)','2026-06-04'],['t_demo3','9월 학력평가 (예시)','2026-09-03']].forEach(([id,title,date],ti)=>{
    const items=newItems('single');items.forEach((it,i)=>{const no=i+1;it.area=no<=5?'화법':no<=10?'작문':no<=15?'언어':no<=30?'독서':'문학';it.set=no<=5?'화법 지문':no<=10?'작문 지문':no<=15?'':no<=19?'독서(인문)':no<=24?'독서(사회)':no<=30?'독서(과학)':no<=34?'현대시':no<=38?'고전소설':no<=42?'현대소설':'고전시가';const ts=TYPES[it.area];it.type=ts[Math.floor(rnd()*ts.length)];if(rnd()<.18)it.pts=3});
    const key=items.map(()=>String(1+Math.floor(rnd()*5)));
    const lure=key.map(k=>{let o;do{o=String(1+Math.floor(rnd()*5))}while(o===k);return o});
    const diff=items.map(it=>nrm()*.9-.1+(it.type.includes('보기')?.7:0));
    const nat=items.map((_,i)=>{const r=Math.min(.97,Math.max(.12,1/(1+Math.exp(1.5*(diff[i]-.15)))));const rest=1-r;const d5=[1,2,3,4,5].map(o=>String(o)===key[i]?r:String(o)===lure[i]?rest*.55:rest*.45/3);return {r:Math.round(r*100)/100,d:d5.map(x=>Math.round(x*100)/100)}});
    d.tests[id]={title,date,open:ti===2,released:ti<2,openFor:ti===2?['화목반','수금반']:[],releasedFor:ti<2?['화목반','수금반']:[],closedOnce:ti<2,key:'',items};
    const tags=items.map((_,i)=>{const o={};for(let k=1;k<=5;k++){if(String(k)===key[i])continue;o[k]=String(k)===lure[i]&&rnd()<.5?'과잉 추론':ERR[Math.floor(rnd()*ERR.length)]}return o});
    d.keys[id]={a:key.join(''),nat,tags};
    for(const st of studs){if(rnd()<.06)continue;const a=items.map((it,i)=>{if(it.el&&it.el!==st.el)return '0';const p=.2+.8/(1+Math.exp(-1.7*(st.th+ti*.15-diff[i])));if(rnd()<p)return key[i];if(rnd()<.03)return '0';return rnd()<.6?lure[i]:String(1+Math.floor(rnd()*5))}).join('');
      const mid='m_'+fnv(st.name);d.manual[mid]=d.manual[mid]||{name:st.name,answers:{}};d.manual[mid].answers[id]={a,el:st.el,cls:st.cls,at:Date.parse(date),src:'teacher'}}
  });
  const prevDemo=S.demo;S.demo=d;
  for(const id of ['t_demo1','t_demo2']){const t=d.tests[id];const key=d.keys[id].a.split('');const an=analyze(t,key,recordsFor(id));d.stats[id]=buildStats(id);d.stats[id].at=Date.now()+1e9;t.key=key.join('')}
  S.demo=prevDemo;return d;
}



/* ---------- 시작 ---------- */
document.addEventListener('submit',async e=>{
  if(e.target.id!=='loginForm')return;e.preventDefault();
  const msg=$('#lgMsg');msg.textContent='로그인하는 중…';
  let em=$('#lgEmail').value.trim();if(!em.includes('@'))em=em.toLowerCase()+'@'+(window.GB_CONFIG.loginDomain||'geunbongukeo.local');
  const r=await sb.auth.signInWithPassword({email:em,password:$('#lgPw').value});
  if(r.error){msg.textContent='로그인하지 못했습니다. 아이디(또는 이메일)와 비밀번호를 확인해 주세요.';return}
  await afterLogin(r.data.session);
});
async function afterLogin(session){
  S.session=session;S.demo=null;S.ready=false;render();
  const r=await sb.rpc('is_teacher');S.teacher=!!r.data;
  if(r.error)toast('서버에 연결하지 못했습니다. 새로고침해 주세요: '+r.error.message);
  if(S.teacher){try{await load()}catch(e){toast('불러오지 못했습니다: '+(e?.message||e))}}
  S.ready=true;render();
}
(async function boot(){
  S.cf=lsGet('omr-cf','')||'';S.showHidden=!!lsGet('gb-show-hidden',false);
  loadSite(sb,'teacher').then(x=>{S.site=x});
  const {data}=await sb.auth.getSession();
  if(data.session)await afterLogin(data.session);else{S.ready=true;render()}
})();

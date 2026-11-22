"use strict";
/* 근본국어 교사 화면: 선생님 한마디 · 틀린 문항 다시 풀기 · 정답·해설 공개 단계.
   teacher.js보다 먼저 불러온다. S·sb·api 같은 teacher.js 값은 함수 안에서만 쓴다.
   수업 흐름(반마다): 응시 → 결과 공개(점수·O/X) → 학생 다시 풀기 → 설명 수업 → 정답·해설 공개 */
const FR={fb:{},rt:{},kr:new Set(),draft:{},saving:{},open:null,err:null};
// 열쇠: 한마디 (시험id|학번), 누적 코멘트는 (|학번). 다시 풀기 (시험id|학번). 정답 공개 (시험id|반 이름)

/* load()가 부른다: feedback·retries·정답 공개 여부를 읽는다. 표가 아직 없으면(스키마를 다시 실행하기 전) 안내만 한다. */
async function frLoad(){
  FR.fb={};FR.rt={};FR.kr=new Set();FR.err=null;
  const all=async(t,cols,ord)=>{const out=[];for(let from=0;;from+=1000){let q=sb.from(t).select(cols);for(const c of ord)q=q.order(c);const r=await q.range(from,from+999);if(r.error)throw r.error;out.push(...r.data);if(r.data.length<1000)return out}};
  try{
    const [fb,rt,tc]=await Promise.all([all('feedback','id,test_id,student_id,body,updated_at',['id']),all('retries','test_id,student_id,answers,submitted_at',['test_id','student_id']),all('test_class','test_id,class_id,key_released',['test_id','class_id'])]);
    const cName={};for(const [n,id] of Object.entries(S.idx.classByName))cName[id]=n;
    const sidOf=id=>S.idx.studentById[id]?.sid;
    for(const x of fb){const sid=sidOf(x.student_id);if(sid)FR.fb[(x.test_id||'')+'|'+sid]={body:x.body,at:x.updated_at}}
    for(const x of rt){const sid=sidOf(x.student_id);if(sid)FR.rt[x.test_id+'|'+sid]={answers:x.answers,at:x.submitted_at}}
    for(const x of tc)if(x.key_released&&cName[x.class_id])FR.kr.add(x.test_id+'|'+cName[x.class_id]);
  }catch(e){console.error(e);FR.err=e?.message||String(e)}
}
const frMissing=()=>FR.err?`<p class="note" style="margin-top:10px"><b>한마디·다시 풀기 자료를 읽지 못했습니다.</b> Supabase SQL Editor에서 최신 <span class="mono">supabase/schema.sql</span>을 다시 실행해 주세요. (${esc(FR.err)})</p>`:'';
const frSid=rec=>ident(rec.name);
const frKeyRel=(tid,c)=>FR.kr.has(tid+'|'+c);
function frTargets(key,a){const out=[];key.forEach((k,i)=>{if(/^[1-5]$/.test(k||'')&&(a||'')[i]!==k)out.push(i)});return out}
/* 한 반(또는 목록)의 다시 풀기 진행: due=다시 풀 문항이 있는 학생, done=다시 푼 학생 */
function frProgress(tid,key,recs){let due=0,done=0;for(const r of recs){if(!frTargets(key,r.a).length)continue;due++;if(FR.rt[tid+'|'+frSid(r)])done++}return {due,done}}

/* ----- 반 분석: 4단계 표시와 버튼 (반마다 한 줄) ----- */
function frStagePanel(t,keyMissing){
  const cs=S.cf?[S.cf]:liveClasses();
  if(!cs.length)return `<p class="note" style="margin-top:12px">반을 만들면 반마다 결과 공개 → 다시 풀기 → 정답·해설 공개를 진행할 수 있습니다. <button class="btn small" data-act="tab" data-v="classes">반 관리</button></p>`;
  const key=keyOf(t.id);
  return `<div class="stage-list">${cs.map(c=>{
    const rel=isRel(t,c),kr=rel&&frKeyRel(t.id,c),open=isOpen(t,c);const pg=frProgress(t.id,key,recordsFor(t.id,c));
    const steps=stageSteps({open,rel,kr,closed:!!t.closedOnce,...pg});const v=esc(t.id+'|'+c);
    const btns=isHiddenCls(c)?'<span class="badge">숨긴 반</span>':!rel?`<button class="btn red small" data-act="fr-release" data-v="${v}" ${keyMissing?'disabled title="정답을 모두 입력해야 공개할 수 있습니다"':''}>결과 공개</button>`
      :!kr?`<button class="btn primary small" data-act="fr-key" data-v="${v}">정답·해설 공개</button><button class="btn ghost small" data-act="fr-unrelease" data-v="${v}">결과 공개 취소</button>`
      :`<button class="btn ghost small" data-act="fr-key-undo" data-v="${v}">정답·해설 공개 취소</button><button class="btn ghost small" data-act="fr-unrelease" data-v="${v}">결과 공개 취소</button>`;
    return `<div class="stage-row">${c?`<b class="stage-cls">${esc(c)}</b>`:''}<ol class="stage">${steps.map((s,i)=>`<li class="st-${s.state}"><span class="st-n">${s.state==='done'?'✓':i+1}</span>${esc(s.label)}</li>`).join('')}</ol><div class="row stage-btns">${btns}</div></div>`}).join('')}</div>${frMissing()}`;
}

/* ----- 반 분석: 설명할 문항 + 학생별 한마디·다시 풀기 ----- */
function frClassCards(t,recs,key){
  const rts=recs.map(r=>FR.rt[t.id+'|'+frSid(r)]?.answers).filter(Boolean);
  const list=explainPriority(t.items,key,recs.map(r=>r.a),rts);
  const pg=frProgress(t.id,key,recs);
  const tried=list.reduce((a,x)=>a+x.retried,0),fixed=list.reduce((a,x)=>a+x.fixed,0);
  const kind=x=>!x.retried?'<span class="muted">다시 푼 학생 없음</span>':x.again>x.fixed?'<span class="pill" style="color:var(--bad)">개념형 많음</span>':x.again?'<span class="pill" style="color:var(--warn)">섞임</span>':'<span class="pill" style="color:var(--good)">실수형</span>';
  let h=`<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">설명할 문항</h3><span class="sub">다시 풀기 ${pg.done}/${pg.due}명 완료 · 재도전 정답률 ${tried?pct(fixed/tried)+` (${fixed}/${tried})`:'–'}</span></div>
   <p class="sub" style="margin:6px 0 10px">다시 풀어도 또 틀린 학생(개념형)이 많은 문항부터, 그다음 처음 오답률이 높은 순서입니다. 설명 수업에서 위에서부터 다루세요. 다시 풀어서 맞힌 학생이 많으면 실수형이라 짧게 짚어도 됩니다.</p>
   ${list.length?`<div class="tbl-wrap"><table><thead><tr><th class="n">순서</th><th>번호</th><th>영역 · 유형</th><th class="n">처음 오답률</th><th class="n">다시 풀어 맞힘</th><th class="n">또 틀림</th><th class="n">안 다시 품</th><th>가장 많이 고른 오답</th><th>판단</th></tr></thead><tbody>${list.slice(0,12).map((x,k)=>`<tr><td class="n">${k+1}</td><td class="mono"><b>${esc(x.no)}</b></td><td>${esc(x.area)}<br><span class="muted">${esc(x.type||'')}</span>${exBlock(D().keys[t.id]?.ex?.[x.i])}</td><td class="n"><span class="rate ${x.wrongRate>=.5?'lo':''}">${pct(x.wrongRate)}</span><br><span class="muted">${x.wrong}/${x.n}</span></td><td class="n">${x.fixed}</td><td class="n ${x.again?'rate lo':''}">${x.again}</td><td class="n muted">${x.notRetried}</td><td>${x.topWrong?`${CIR[x.topWrong.opt]} <span class="muted">${pct(x.topWrong.share)}</span>`:'<span class="muted">무응답</span>'}</td><td>${kind(x)}</td></tr>`).join('')}</tbody></table></div>${list.length>12?`<p class="sub" style="margin-top:6px">나머지 ${list.length-12}문항은 틀린 학생이 더 적습니다.</p>`:''}`:'<p class="muted">틀린 학생이 있는 문항이 없습니다.</p>'}</div>`;
  // 학생별 표
  const nFb=recs.filter(r=>FR.fb[t.id+'|'+frSid(r)]).length;
  h+=`<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">학생별 한마디 · 다시 풀기</h3><span class="badge">한마디 ${nFb}/${recs.length}명</span></div>
   <p class="sub" style="margin:6px 0 10px">한마디는 학생 결과 화면의 '선생님 한마디'에 보이며, 그 반에 정답·해설을 공개한 뒤에 열립니다. 재도전은 '다시 풀어 맞힌 수 / 다시 푼 문항 수'입니다.</p>
   <div class="tbl-wrap"><table class="fb-tbl"><thead><tr><th>학생</th><th class="n">점수</th><th class="n">틀린 수</th><th>재도전</th><th>한마디</th><th></th></tr></thead><tbody>${recs.map(r=>{
     const sid=frSid(r);const g=grade(t,key,r);const tg=frTargets(key,r.a);const rr=FR.rt[t.id+'|'+sid];const o=rr?retryOutcome(key,rr.answers):null;const fb=FR.fb[t.id+'|'+sid];const dr=FR.draft[t.id+'|'+sid];
     const rt=!tg.length?'<span class="muted">–</span>':!rr?'<span class="muted">아직</span>':`<b class="num">${o.fixed.length}/${o.targets.length}</b> <span class="muted">${pct(o.rate)}</span>`;
     const open=FR.open===sid;
     return `<tr${open?' class="fb-open"':''}><td class="nm">${esc(r.name)}${r.cls&&!S.cf?` <span class="muted">${esc(r.cls)}</span>`:''}</td><td class="n">${g.score}/${g.max}</td><td class="n">${tg.length}</td><td>${rt}</td><td class="fb-prev">${dr!=null&&fbClean(dr)!==(fb?.body||'')?'<span class="badge warn">저장 안 됨</span> ':''}${fb?esc(fb.body.length>40?fb.body.slice(0,40)+'…':fb.body):'<span class="muted">없음</span>'}</td><td><button class="btn small${open?' primary':''}" data-act="fr-open" data-v="${esc(sid)}" aria-expanded="${open}">${open?'닫기':fb?'고치기':'쓰기'}</button></td></tr>${open?`<tr class="fb-edrow"><td colspan="6">${fbEditor(t.id,sid,{next:true,label:r.name})}</td></tr>`:''}`}).join('')}</tbody></table></div>${frMissing()}</div>`;
  return h;
}

/* ----- 한마디 입력 칸 ----- */
function fbStateText(k){
  if(FR.saving[k])return ['','저장하는 중…'];
  const saved=FR.fb[k];const d=FR.draft[k];
  if(d!=null&&fbClean(d)!==(saved?.body||''))return ['warn','저장 안 됨'];
  return saved?['good','저장됨 · '+new Date(saved.at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})]:['','아직 없음'];
}
function fbEditor(tid,sid,o={}){
  const k=tid+'|'+sid;const txt=FR.draft[k]??FR.fb[k]?.body??'';const [c,l]=fbStateText(k);const n=fbLen(txt);
  return `<div class="fb-ed" data-k="${esc(k)}"><textarea class="fb-text" data-fbk="${esc(k)}" rows="3" maxlength="${FB_MAX+20}" aria-label="${esc((o.label?o.label+' ':'')+(tid?'선생님 한마디':'누적 코멘트'))}" placeholder="${tid?'예: 3번처럼 근거 문장을 찾는 연습을 계속해 봅시다.':'예: 꾸준히 좋아지고 있어요. 문학 갈래별 정리를 해 봅시다.'}">${esc(txt)}</textarea>
   <div class="row fb-foot"><span class="fb-count num${n>FB_MAX?' over':''}">${n}/${FB_MAX}</span><span class="fb-state ${c}" role="status">${esc(l)}</span><span class="fb-sp"></span>
   <button class="btn small" data-act="fb-save" data-v="${esc(k)}">저장</button>${o.next?`<button class="btn small primary" data-act="fb-next" data-v="${esc(k)}" title="Ctrl+Enter">저장하고 다음 학생 →</button>`:''}</div></div>`;
}

/* ----- 학생 리포트: 한마디 + 다시 풀기 ----- */
function frStudentCards(t,rec,recs,key){
  const sid=frSid(rec);const kr=rec.cls?frKeyRel(t.id,rec.cls):false;const rel=rec.cls?isRel(t,rec.cls):false;
  const nFb=recs.filter(r=>FR.fb[t.id+'|'+frSid(r)]).length;
  const when=!rel?'이 반은 아직 결과를 공개하지 않았습니다. 정답·해설을 공개한 뒤에 학생에게 보입니다.':!kr?'이 반은 아직 정답·해설 공개 전이라 학생에게 보이지 않습니다. 정답·해설을 공개하면 보입니다.':'이 반은 정답·해설을 공개해서 학생 결과 화면에 바로 보입니다.';
  const chips=recs.map(r=>{const s=frSid(r);const has=!!FR.fb[t.id+'|'+s];const d=FR.draft[t.id+'|'+s];const dirty=d!=null&&fbClean(d)!==(FR.fb[t.id+'|'+s]?.body||'');
    return `<button class="chip fb-chip${has?' has':''}" aria-pressed="${r.name===rec.name}" data-act="fr-pick" data-v="${esc(r.name)}" title="${has?'한마디 있음':'한마디 없음'}">${has?'✓ ':''}${esc(r.name)}${dirty?' •':''}</button>`}).join('');
  // 다시 풀기
  const tg=frTargets(key,rec.a);const rr=FR.rt[t.id+'|'+sid];let rtH;
  if(!tg.length)rtH='<p class="muted">모두 맞혀 다시 풀 문항이 없습니다.</p>';
  else if(!rr)rtH=`<p class="sub">아직 다시 풀지 않았습니다. 대상 ${tg.length}문항: <span class="mono">${tg.map(i=>esc(t.items[i].no)).join(', ')}</span></p>${kr?'<p class="sub">정답·해설을 공개해서 이제는 다시 풀 수 없습니다.</p>':''}`;
  else{const o=retryOutcome(key,rr.answers);const nm=c=>c==null||c==='0'?'비움':CIR[+c];
    rtH=`<p class="sub" style="margin-bottom:8px">재도전 정답률 <b>${pct(o.rate)}</b> (${o.fixed.length}/${o.targets.length}) · ${esc(new Date(rr.at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</p>
     <div class="tbl-wrap"><table><thead><tr><th>번호</th><th>처음</th><th>다시</th><th>정답</th><th>판단</th></tr></thead><tbody>${o.targets.map(i=>`<tr><td class="mono"><b>${esc(t.items[i].no)}</b></td><td class="mono">${nm(rec.a[i])}</td><td class="mono">${nm(rr.answers[i])}</td><td class="mono">${CIR[+key[i]]}</td><td>${o.fixed.includes(i)?'<span class="pill" style="color:var(--good)">맞힘 · 실수형</span>':'<span class="pill" style="color:var(--bad)">또 틀림 · 개념형</span>'}</td></tr>`).join('')}</tbody></table></div>
     ${kr?'':`<div class="row" style="margin-top:8px"><button class="btn small ghost danger" data-act="fr-rt-del" data-v="${esc(t.id+'|'+sid)}">다시 풀기 기록 지우기</button><span class="sub">지우면 학생이 한 번 더 낼 수 있습니다.</span></div>`}`}
  return `<div class="grid2"><div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">선생님 한마디</h3><span class="badge">이 시험 ${nFb}/${recs.length}명 작성</span></div>
   <p class="sub" style="margin:6px 0 8px">${when} ${FB_MAX}자까지 적을 수 있고, 비우고 저장하면 지워집니다.</p>
   <div class="chips fb-chips" role="group" aria-label="학생 고르기 (✓ 한마디 있음, • 저장 안 됨)">${chips}</div>
   ${fbEditor(t.id,sid,{next:true,label:rec.name})}
   <h3 style="margin:16px 0 4px">누적 코멘트</h3><p class="sub" style="margin-bottom:8px">시험과 상관없이 이 학생에게 남기는 말입니다. 학생의 '내 누적 기록' 화면 맨 위에 바로 보입니다.</p>
   ${fbEditor('',sid,{label:rec.name})}${frMissing()}</div>
   <div class="card"><h3>틀린 문항 다시 풀기</h3>${rtH}</div></div>`;
}

/* ----- 저장 ----- */
async function fbSave(k){
  const [tid,sid]=k.split('|');const body=fbClean(FR.draft[k]??FR.fb[k]?.body??'');
  if(fbLen(body)>FB_MAX){toast(`${FB_MAX}자까지 적을 수 있습니다. 조금 줄여 주세요`);return false}
  if(S.demo){if(body)FR.fb[k]={body,at:new Date().toISOString()};else delete FR.fb[k];delete FR.draft[k];toast('예시 데이터라 화면에서만 바뀌고 저장되지는 않습니다');return true}
  const uid=S.idx.studentBySid[sid]?.id;if(!uid){toast('명단에 없는 학번이라 저장할 수 없습니다');return false}
  FR.saving[k]=true;fbPaint(k);
  try{const r=await sb.rpc('teacher_save_feedback',{p_student:uid,p_test:tid||null,p_body:body});
    if(r.error||!r.data?.ok){toast('저장하지 못했습니다: '+(r.error?.message||{too_long:`${FB_MAX}자를 넘었습니다`,not_found:'학생이나 시험을 찾지 못했습니다'}[r.data?.error]||r.data?.error));return false}
    if(r.data.deleted)delete FR.fb[k];else FR.fb[k]={body:r.data.body,at:r.data.updated_at};
    delete FR.draft[k];return true;
  }catch(e){toast('저장하지 못했습니다: '+(e?.message||e));return false}
  finally{delete FR.saving[k]}
}
/* 다시 그리지 않고 글자 수·상태만 고친다(입력 중) */
function fbPaint(k){
  const box=[...document.querySelectorAll('.fb-ed')].find(x=>x.dataset.k===k);if(!box)return;
  const n=fbLen(FR.draft[k]??FR.fb[k]?.body??'');const cn=box.querySelector('.fb-count');cn.textContent=n+'/'+FB_MAX;cn.classList.toggle('over',n>FB_MAX);
  const [c,l]=fbStateText(k);const st=box.querySelector('.fb-state');st.className='fb-state '+c;st.textContent=l;
}
function fbFocus(k){setTimeout(()=>{const el=[...document.querySelectorAll('.fb-text')].find(x=>x.dataset.fbk===k);if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);el.scrollIntoView({block:'center',behavior:'smooth'})}},30)}
async function fbNext(k){
  if(!(await fbSave(k))){render();return}
  const [tid,sid]=k.split('|');const recs=recordsFor(tid);const names=recs.map(r=>r.name);const cur=recs.find(r=>frSid(r)===sid);
  const nx=cur?nextAfter(names,cur.name):null;
  if(!nx){render();fbFocus(k);toast('저장했습니다. 마지막 학생입니다');return}
  const nsid=ident(nx);
  if(S.tab==='student')S.selStudent=nx;else FR.open=nsid;
  render();fbFocus(tid+'|'+nsid);toast('저장했습니다');
}

/* ----- 공개 단계 바꾸기 ----- */
async function frStage(act,v){
  const [tid,c]=v.split('|');const t=D().tests[tid];if(!t)return;
  const key=keyOf(tid);const pg=frProgress(tid,key,recordsFor(tid,c));const left=pg.due-pg.done;
  const Q={'fr-release':{title:`${c} 결과 공개`,msg:'학생에게 점수와 문항별 맞음/틀림만 보이고, 틀린 문항을 한 번 다시 풀 수 있게 됩니다(정답·해설은 아직 숨김).',ok:'결과 공개'},
    'fr-key':{title:`${c} 정답·해설 공개`,msg:`학생에게 정답·해설·다시 풀기 결과·선생님 한마디가 보이고, 이제부터는 다시 풀기를 낼 수 없습니다.${left>0?` (아직 다시 풀지 않은 학생 ${left}명)`:''}`,ok:'정답·해설 공개'},
    'fr-key-undo':{title:`${c} 정답·해설 공개 취소`,msg:'학생 화면에서 정답·해설·한마디가 다시 숨겨지고, 아직 다시 풀지 않은 학생은 다시 풀 수 있게 됩니다.',ok:'공개 취소'},
    'fr-unrelease':{title:`${c} 결과 공개 취소`,msg:'학생 화면에서 이 시험 결과가 사라지고, 정답·해설 공개도 함께 취소됩니다. 다시 풀기 기록은 남습니다.',ok:'공개 취소',danger:true}}[act];
  if(!(await ask(Q)))return;
  const cid=clsId(c);
  if(act==='fr-release'){const rs=recordsFor(tid,c);const stats=rs.length?toStats(analyze(t,key,rs)):null;
    await api(async()=>chk(await sb.from('test_class').upsert({test_id:tid,class_id:cid,released:true,released_at:nowIso(),stats},{onConflict:'test_id,class_id'})),c+'에 결과를 공개했습니다')}
  else if(act==='fr-key')await api(async()=>chk(await sb.from('test_class').update({key_released:true,key_released_at:nowIso()}).eq('test_id',tid).eq('class_id',cid)),c+'에 정답·해설을 공개했습니다');
  else if(act==='fr-key-undo')await api(async()=>chk(await sb.from('test_class').update({key_released:false,key_released_at:null}).eq('test_id',tid).eq('class_id',cid)),'정답·해설 공개를 취소했습니다');
  else await api(async()=>chk(await sb.from('test_class').update({released:false,released_at:null,stats:null,key_released:false,key_released_at:null}).eq('test_id',tid).eq('class_id',cid)),'결과 공개를 취소했습니다');
}

/* ----- 이벤트 ----- */
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const act=b.dataset.act,v=b.dataset.v;
  switch(act){
    case 'fb-save':if(await fbSave(v)){render();toast(FR.fb[v]?'저장했습니다':'지웠습니다')}else render();break;
    case 'fb-next':await fbNext(v);break;
    case 'fr-open':FR.open=FR.open===v?null:v;render();if(FR.open)fbFocus(S.selTest+'|'+v);break;
    case 'fr-pick':S.selStudent=v;render();break;
    case 'fr-release':case 'fr-key':case 'fr-key-undo':case 'fr-unrelease':await frStage(act,v);break;
    case 'fr-rt-del':{const [tid,sid]=v.split('|');const st=S.idx.studentBySid[sid];
      if(S.demo){toast('예시 데이터에서는 바꾸지 않습니다');break}
      if(!st||!(await ask({title:'다시 풀기 기록 지우기',msg:`${st.name}(${sid}) 학생의 다시 풀기 답을 지웁니다. 정답·해설 공개 전이면 학생이 한 번 더 낼 수 있습니다.`,ok:'지우기',danger:true})))break;
      await api(async()=>chk(await sb.from('retries').delete().eq('test_id',tid).eq('student_id',st.id)),'다시 풀기 기록을 지웠습니다');break}
  }
});
document.addEventListener('input',e=>{const el=e.target;if(!el.classList?.contains('fb-text'))return;FR.draft[el.dataset.fbk]=el.value;fbPaint(el.dataset.fbk)});
document.addEventListener('keydown',e=>{const el=e.target;if(!el.classList?.contains('fb-text')||e.key!=='Enter'||!(e.ctrlKey||e.metaKey))return;e.preventDefault();
  const box=el.closest('.fb-ed');const btn=box?.querySelector('[data-act="fb-next"]')||box?.querySelector('[data-act="fb-save"]');btn?.click()});

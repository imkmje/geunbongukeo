"use strict";
/* 근본국어 교사 화면: 선생님 한마디 · 틀린 문항 다시 풀기 · 정답·해설 공개 단계.
   teacher.js보다 먼저 불러온다. S·sb·api 같은 teacher.js 값은 함수 안에서만 쓴다.
   수업 흐름(반마다): 응시 → 결과 공개(점수·O/X) → 학생 다시 풀기 → 설명 수업 → 정답·해설 공개 */
const FR_PAGE=30;
const FR={stExp:null,tf:{cls:'',q:'',n:30},fb:{},rt:{},kr:new Set(),draft:{},saving:{},done:{},fail:{},flash:null,pend:null,open:null,err:null,auto:{tid:null,at:0,busy:false,sig:'',err:''}};
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
/* 다시 풀기 결과(js/retry.js retryOutcome): fixed 맞힘(실수형), again 또 틀림(개념형), blank 다시 풀 때 비움(개념형으로 세지 않음) */
function frRetrySplit(key,answers){const o=retryOutcome(key,answers);return {...o,blank:o.blank||[]}}
/* 한 반(또는 목록)의 다시 풀기 진행: due=다시 풀 문항이 있는 학생, done=다시 푼 학생 */
function frProgress(tid,key,recs){let due=0,done=0;for(const r of recs){if(!frTargets(key,r.a).length)continue;due++;if(FR.rt[tid+'|'+frSid(r)])done++}return {due,done}}

/* ----- 반 분석: 4단계 표시와 버튼 (반마다 한 줄) ----- */
function frStagePanel(t,keyMissing){
  const cs=S.cf?[S.cf]:liveClasses();
  if(!cs.length)return `<p class="note" style="margin-top:12px">반을 만들면 반마다 결과 공개 → 다시 풀기 → 정답·해설 공개를 진행할 수 있습니다. <button class="btn small" data-act="tab" data-v="classes">반 관리</button></p>`;
  const key=keyOf(t.id);
  // '전체'에서 반이 여럿이면 반마다 한 줄 요약(반 · 단계 · 제출/다시 풀기)만 보이고, 누르면 그 반의 단계·버튼이 펼쳐진다. 맨 위에 '모든 반 한꺼번에'.
  const compact=!S.cf&&cs.length>1;
  const mini=c=>{const rel=isRel(t,c),kr=rel&&frKeyRel(t.id,c),open=isOpen(t,c),closed=isClosed(t,c);const rs=recordsFor(t.id,c);
    const SS=subStatus(t,[c]);const pg=frProgress(t.id,key,rs);
    const [cl,st]=isHiddenCls(c)?['draft','숨긴 반']:kr?['rel','정답·해설 공개됨']:rel?['rel','결과 공개됨']:open?['open','응시 중']:closed?['closed','마감']:['draft','준비 중'];
    const info=rel&&!kr?`다시 풀기 ${pg.done}/${pg.due}명`:SS.m?`제출 ${SS.n}/${SS.m}명`:rs.length?`답안 ${rs.length}개`:'';
    const exp=FR.stExp===c;
    return `<button class="stage-mini${exp?' on':''}" data-act="fr-st-exp" data-v="${esc(c)}" aria-expanded="${exp}"><b>${esc(c)}</b><span class="pill ${cl}">${st}</span><span class="sub">${info}</span><span class="stage-mini-go" aria-hidden="true">${exp?'▴':'▾'}</span></button>`};
  const full=c=>{
      const rel=isRel(t,c),kr=rel&&frKeyRel(t.id,c),open=isOpen(t,c),closed=isClosed(t,c);const rs=recordsFor(t.id,c);const pg=frProgress(t.id,key,rs);
    const steps=stageSteps({open,rel,kr,closed,...pg});const v=esc(t.id+'|'+c);
    // 결과 공개는 낸 답안이 있어야 누를 수 있다(한 번도 안 연 반·아무도 안 낸 반은 공개할 것이 없다).
    const noRel=keyMissing?'정답을 모두 입력해야 공개할 수 있습니다':!rs.length?(open||closed?'이 반에 낸 답안이 아직 없습니다':'이 반은 아직 응시를 연 적이 없습니다'):'';
    // '결과 공개 취소'는 자주 쓰지 않고 되돌리기 어려우니 '⋯ 더보기' 안에 둔다(누르면 확인 상자가 한 번 더 뜬다).
    const undo=moreMenu(`${kr?`<button class="btn ghost small" data-act="fr-key-undo" data-v="${v}">정답·해설 공개 취소</button>`:''}<button class="btn ghost small danger" data-act="fr-unrelease" data-v="${v}">결과 공개 취소</button>`,(c?c+' ':'')+'공개 취소 메뉴','⋯ 더보기');
    const btns=isHiddenCls(c)?'<span class="badge">숨긴 반</span>':!rel?`<button class="btn red small" data-act="fr-release" data-v="${v}" ${noRel?`disabled title="${esc(noRel)}"`:''}>결과 공개</button>${noRel&&!keyMissing?`<span class="sub">${esc(noRel)}</span>`:''}`
      :!kr?`<button class="btn primary small" data-act="fr-key" data-v="${v}">정답·해설 공개</button>${undo}`
      :`<span class="badge good">정답·해설 공개됨</span>${undo}`;
    return `<div class="stage-row">${c?`<b class="stage-cls">${esc(c)}</b>`:''}<ol class="stage">${steps.map((s,i)=>`<li class="st-${s.state}"><span class="st-n">${s.state==='done'?'✓':i+1}</span>${esc(s.label)}</li>`).join('')}</ol><div class="row stage-btns">${btns}</div></div>`};
  if(compact)return `${frNowLine(t)}<div class="stage-compact">${bulkBar(t)}<div class="stage-minis" role="group" aria-label="반마다 단계">${cs.map(c=>mini(c)+(FR.stExp===c?full(c):'')).join('')}</div></div>${frMissing()}`;
  return `<div class="stage-list">${cs.map(full).join('')}</div>${frNowLine(t)}${frMissing()}`;
}

/* ----- 반 분석 맨 위 '지금 할 일' 한 줄 (B1) ----- */
function frNowLine(t){
  const cs=(S.cf?[S.cf]:liveClasses()).filter(c=>!isHiddenCls(c));if(!cs.length)return '';
  const key=keyOf(t.id);
  const line=(msg,extra='')=>`<p class="now-line" role="status"><b>지금 할 일</b> ${msg}${extra}</p>`;
  // 응시 중(결과 공개 전) 반이 있으면 제출 현황. 수는 반 분석 '제출 현황'·실시간 현황과 같은 함수로 센다(teacher.js subStatus).
  const SS=subStatus(t,cs);
  if(SS.openClasses.length){const allIn=!SS.openMiss.length;
    return line(`제출 ${SS.n}/${SS.m}명 · ${allIn?(SS.openClasses.length<SS.classes.length?'응시 중인 반은 모두 냈습니다. 응시를 닫으세요':'모두 냈습니다. 응시를 닫으세요'):'다 내면 응시를 닫으세요'}`)}
  const retryCs=cs.filter(c=>isRel(t,c)&&!frKeyRel(t.id,c));
  if(retryCs.length){const recs=retryCs.flatMap(c=>recordsFor(t.id,c));const pg=frProgress(t.id,key,recs);
    const rts=recs.map(r=>FR.rt[t.id+'|'+frSid(r)]?.answers).filter(Boolean);
    const top=explainPriority(t.items,key,recs.map(r=>r.a),rts).slice(0,3);
    return line(`다시 풀기 ${pg.done}/${pg.due}명`,top.length?` · <button class="link-btn" data-act="fr-jump" data-v="frExplain">설명은 ${top.map(x=>esc(x.no)+'번').join(' → ')} 순서로 ↓</button>`:'')+frAutoNote()}
  const krCs=cs.filter(c=>isRel(t,c)&&frKeyRel(t.id,c));
  if(krCs.length){const recs=krCs.flatMap(c=>recordsFor(t.id,c));const k=recs.filter(r=>FR.fb[t.id+'|'+frSid(r)]).length;
    return line('',`<button class="link-btn" data-act="fr-jump" data-v="frStuTbl">한마디 ${k}/${recs.length}명 작성 ↓</button>`)}
  if(cs.some(c=>recordsFor(t.id,c).length))return line('응시를 닫았습니다 · 결과 공개를 누르면 학생이 점수와 O/X를 보고 틀린 문항을 다시 풉니다');
  return line('시험 관리에서 이 시험의 응시를 여세요');
}
function frAutoNote(){
  if(S.demo)return '';const A=FR.auto;
  return `<p class="sub fr-auto" id="frAuto">${frAutoText()}</p>`;
}
function frAutoText(){const A=FR.auto;
  if(A.err)return `<span style="color:var(--bad)">${esc(A.err)}</span>`;
  if(!A.at||A.tid!==S.selTest)return '다시 풀기 현황을 15초마다 자동으로 다시 읽습니다.';
  const sec=Math.round((Date.now()-A.at)/1000);const tm=new Date(A.at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  return `${sec<20?'방금 갱신':sec+'초 전 갱신'} · ${esc(tm)} · 이 탭을 보고 있는 동안 15초마다 다시 읽습니다.`}

/* ----- 반 분석 자동 갱신 (A10): '결과 공개' 단계(정답·해설 공개 전)이고 탭이 보일 때만, 그 시험의 다시 풀기·답안을 15초마다 다시 읽는다 ----- */
const FR_AUTO_MS=15000;
function frAutoActive(){
  if(S.tab!=='class'||document.visibilityState!=='visible'||!S.session||!S.teacher||S.demo||!S.ready||!S.selTest)return false;
  const t=D().tests[S.selTest];if(!t)return false;
  return (S.cf?[S.cf]:liveClasses()).some(c=>!isHiddenCls(c)&&isRel(t,c)&&!frKeyRel(t.id,c));
}
async function frAutoRefresh(){
  const A=FR.auto;const tid=S.selTest;if(!tid||A.busy)return;A.busy=true;
  try{
    const get=async(table,cols)=>{const out=[];for(let from=0;;from+=1000){const r=await sb.from(table).select(cols).eq('test_id',tid).order('student_id').range(from,from+999);if(r.error)throw r.error;out.push(...r.data);if(r.data.length<1000)return out}};
    const [rt,sub]=await Promise.all([get('retries','test_id,student_id,answers,submitted_at'),get('submissions','test_id,student_id,answers,src,submitted_at')]);
    const sig=JSON.stringify([rt.map(x=>x.student_id+x.answers+x.submitted_at),sub.map(x=>x.student_id+x.answers+x.submitted_at)]);
    const changed=A.tid===tid&&A.sig&&A.sig!==sig;const first=A.tid!==tid;
    A.tid=tid;A.sig=sig;A.at=Date.now();A.err='';
    if(changed||first){
      for(const k of Object.keys(FR.rt))if(k.startsWith(tid+'|'))delete FR.rt[k];
      for(const x of rt){const sid=S.idx.studentById[x.student_id]?.sid;if(sid)FR.rt[tid+'|'+sid]={answers:x.answers,at:x.submitted_at}}
      lvPatch(tid,sub);// js/live.js: 그 시험 답안만 바꿔 끼운다
    }
    if((changed||first)&&S.tab==='class'&&S.selTest===tid){schedule();return}// 입력 중이면 끝난 뒤에 다시 그린다
  }catch(e){console.error(e);A.err='다시 풀기 현황을 읽지 못했습니다. 인터넷 연결을 확인해 주세요.'}
  finally{A.busy=false}
  const el=document.getElementById('frAuto');if(el)el.innerHTML=frAutoText();
}
setInterval(()=>{if(frAutoActive())frAutoRefresh()},FR_AUTO_MS);
document.addEventListener('visibilitychange',()=>{if(frAutoActive())frAutoRefresh()});

/* ----- 반 분석: 설명할 문항 + 학생별 한마디·다시 풀기 ----- */
function frClassCards(t,recs,key){
  const rts=recs.map(r=>FR.rt[t.id+'|'+frSid(r)]?.answers).filter(Boolean);
  const list=explainPriority(t.items,key,recs.map(r=>r.a),rts);
  const pg=frProgress(t.id,key,recs);
  const tried=list.reduce((a,x)=>a+x.retried,0),fixed=list.reduce((a,x)=>a+x.fixed,0);
  const kind=x=>!x.retried?'<span class="muted">다시 푼 학생 없음</span>':x.again>x.fixed?'<span class="pill" style="color:var(--bad)">개념형 많음</span>':x.again?'<span class="pill" style="color:var(--warn)">섞임</span>':'<span class="pill" style="color:var(--good)">실수형</span>';
  // 다시 풀 때 비운 학생(explainPriority retryBlank)은 '또 틀림'이 아니라 '안 다시 품'에 들어가므로 그 칸에 (비움 N)으로 덧붙인다.
  let h=`<div class="card" id="frExplain"><div class="row" style="justify-content:space-between"><h3 style="margin:0">설명할 문항</h3><span class="sub">다시 풀기 ${pg.done}/${pg.due}명 완료 · 재도전 정답률 ${tried?pct(fixed/tried)+` (${fixed}/${tried})`:'–'}</span></div>
   <p class="sub" style="margin:6px 0 10px">다시 풀어도 또 틀린 학생(개념형)이 많은 문항부터, 그다음 처음 오답률이 높은 순서입니다. 설명 수업에서 위에서부터 다루세요. 다시 풀어서 맞힌 학생이 많으면 실수형이라 짧게 짚어도 됩니다.</p>
   ${list.length?`<div class="tbl-wrap"><table><thead><tr><th class="n">순서</th><th>번호</th><th>영역 · 유형</th><th class="n">처음 오답률</th><th class="n">다시 풀어 맞힘</th><th class="n">또 틀림</th><th class="n">안 다시 품</th><th>가장 많이 고른 오답</th><th>판단</th></tr></thead><tbody>${list.slice(0,12).map((x,k)=>`<tr><td class="n">${k+1}</td><td class="mono"><b>${esc(x.no)}</b></td><td>${esc(x.area)}<br><span class="muted">${esc(x.type||'')}</span>${exBlock(D().keys[t.id]?.ex?.[x.i])}</td><td class="n"><span class="rate ${x.wrongRate>=.5?'lo':''}">${pct(x.wrongRate)}</span><br><span class="muted">${x.wrong}/${x.n}</span></td><td class="n">${x.fixed}</td><td class="n ${x.again?'rate lo':''}">${x.again}</td><td class="n muted">${x.notRetried}${x.retryBlank?`<br><span class="muted" style="font-size:12px">비움 ${x.retryBlank}</span>`:''}</td><td>${x.topWrong?`${CIR[x.topWrong.opt]} <span class="muted">${pct(x.topWrong.share)}</span>`:'<span class="muted">무응답</span>'}</td><td>${kind(x)}</td></tr>`).join('')}</tbody></table></div>${list.length>12?`<p class="sub" style="margin-top:6px">나머지 ${list.length-12}문항은 틀린 학생이 더 적습니다.</p>`:''}`:'<p class="muted">틀린 학생이 있는 문항이 없습니다.</p>'}</div>`;
  // 학생별 표
  const nFb=recs.filter(r=>FR.fb[t.id+'|'+frSid(r)]).length;
  h+=`<div class="card" id="frStuTbl"><div class="row" style="justify-content:space-between"><h3 style="margin:0">학생별 한마디 · 다시 풀기</h3><span class="badge">한마디 ${nFb}/${recs.length}명</span></div>
   <p class="sub" style="margin:6px 0 10px">한마디는 학생 결과 화면의 '선생님 한마디'에 보이며, 그 반에 정답·해설을 공개한 뒤에 열립니다. 재도전은 '다시 풀어 맞힌 수 / 다시 푼 문항 수'입니다.</p>
   ${frTblFilter(recs)}
   <div class="tbl-wrap"><table class="fb-tbl"><thead><tr><th>학생</th><th class="n">점수</th><th class="n">틀린 수</th><th>재도전</th><th>한마디</th><th></th></tr></thead><tbody>${frTblRows(recs).shown.map(r=>{
     const sid=frSid(r);const g=grade(t,key,r);const tg=frTargets(key,r.a);const rr=FR.rt[t.id+'|'+sid];const o=rr?frRetrySplit(key,rr.answers):null;const fb=FR.fb[t.id+'|'+sid];const dr=FR.draft[t.id+'|'+sid];
     const rt=!tg.length?'<span class="muted">–</span>':!rr?'<span class="muted">아직</span>':`<b class="num">${o.fixed.length}/${o.targets.length}</b> 맞힘${o.blank.length?` <span class="muted">· ${o.blank.length} 비움</span>`:''}`;
     const open=FR.open===sid;
     return `<tr${open?' class="fb-open"':''}><td class="nm">${esc(r.name)}${r.cls&&!S.cf?` <span class="muted">${esc(r.cls)}</span>`:''}</td><td class="n">${g.score}/${g.max}</td><td class="n">${tg.length}</td><td>${rt}</td><td class="fb-prev">${dr!=null&&fbClean(dr)!==(fb?.body||'')?'<span class="badge warn">저장 안 됨</span> ':''}${fb?esc(fb.body.length>40?fb.body.slice(0,40)+'…':fb.body):'<span class="muted">없음</span>'}</td><td><button class="btn small${open?' primary':''}" data-act="fr-open" data-v="${esc(sid)}" aria-expanded="${open}">${open?'닫기':fb?'고치기':'쓰기'}</button></td></tr>${open?`<tr class="fb-edrow"><td colspan="6">${frPendBox()}${fbEditor(t.id,sid,{next:true,label:r.name,locked:isAnonCls(r.cls)})}</td></tr>`:''}`}).join('')}</tbody></table></div>${(()=>{const T=frTblRows(recs);return T.rest?`<div class="row" style="margin-top:8px"><button class="btn" data-act="fr-tmore">더 보기 (${Math.min(FR_PAGE,T.rest)}명 더 · 남은 ${T.rest}명)</button></div>`:''})()}${frMissing()}</div>`;
  return h;
}

/* 학생별 표 거르기: 반(전체일 때만) + 학번·이름 찾기 + 30명씩 '더 보기'. 입력 칸을 연 학생은 늘 보이게 한다. */
function frTblRows(recs){
  const F=FR.tf;const q=F.q.trim();
  const L=recs.filter(r=>(!F.cls||S.cf||r.cls===F.cls)&&(!q||r.name.includes(q)));
  let n=Math.max(FR_PAGE,F.n);const oi=FR.open?L.findIndex(r=>frSid(r)===FR.open):-1;if(oi>=n)n=oi+1;
  return {all:L,shown:L.slice(0,n),rest:Math.max(0,L.length-n)};
}
function frTblFilter(recs){
  if(recs.length<=FR_PAGE&&!FR.tf.q&&!FR.tf.cls)return '';
  const cs=[...new Set(recs.map(r=>r.cls).filter(Boolean))];const T=frTblRows(recs);
  return `<div class="row fr-tf" style="margin-bottom:8px">${!S.cf&&cs.length>1?`<label class="f">반<select id="frTcls"><option value="">모든 반</option>${cs.map(c=>`<option ${c===FR.tf.cls?'selected':''}>${esc(c)}</option>`).join('')}</select></label>`:''}<label class="f" style="flex:1;min-width:160px;max-width:280px">학번·이름 찾기<input type="search" id="frTq" value="${esc(FR.tf.q)}" placeholder="예: 20315 또는 김하늘" autocomplete="off"></label><span class="sub" style="align-self:flex-end">${T.all.length}명 중 ${T.shown.length}명 보임</span></div>`;
}

/* ----- 한마디 입력 칸 ----- */
/* 입력 칸 아래 상태: 실제 저장 결과만 보여 준다(저장하는 중 → 저장했습니다 / 저장하지 못했습니다 / 저장 안 됨) */
const fbWhen=at=>new Date(at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const fbDirty=k=>{const d=FR.draft[k];return d!=null&&fbClean(d)!==(FR.fb[k]?.body||'')};
function fbStateText(k){
  if(FR.saving[k])return ['','저장하는 중…'];
  if(fbDirty(k))return FR.fail[k]?['bad','저장하지 못했습니다 · '+FR.fail[k]]:['warn','저장 안 됨'];
  const saved=FR.fb[k];
  if(FR.done[k])return ['good',(FR.done[k].del?'지웠습니다':'저장했습니다')+(saved?' · '+fbWhen(saved.at):'')];
  return saved?['good','저장됨 · '+fbWhen(saved.at)]:['','아직 없음'];
}
function fbEditor(tid,sid,o={}){
  const k=tid+'|'+sid;const txt=FR.draft[k]??FR.fb[k]?.body??'';const [c,l]=fbStateText(k);const n=fbLen(txt);
  // 개인정보를 정리한 반: 학생이 로그인할 수 없어 한마디가 보이지 않으므로 잠근다.
  if(o.locked)return `<div class="fb-ed fb-locked" data-k="${esc(k)}"><textarea class="fb-text" rows="2" disabled aria-label="${esc((o.label?o.label+' ':'')+(tid?'선생님 한마디':'누적 코멘트'))} (잠김)">${esc(txt)}</textarea><p class="sub fb-lock-msg">🔒 정리된 반이라 학생에게 보이지 않습니다</p></div>`;
  const fl=FR.flash&&FR.flash.k===k?`<span class="fb-flash">✓ ${esc(FR.flash.msg)}</span>`:'';
  return `<div class="fb-ed" data-k="${esc(k)}"><textarea class="fb-text" data-fbk="${esc(k)}" rows="3" maxlength="${FB_MAX+20}" aria-label="${esc((o.label?o.label+' ':'')+(tid?'선생님 한마디':'누적 코멘트'))}" placeholder="${tid?'예: 3번처럼 근거 문장을 찾는 연습을 계속해 봅시다.':'예: 꾸준히 좋아지고 있어요. 문학 갈래별 정리를 해 봅시다.'}">${esc(txt)}</textarea>
   <div class="row fb-foot"><span class="fb-count num${n>FB_MAX?' over':''}">${n}/${FB_MAX}</span><span class="fb-state ${c}" role="status">${esc(l)}</span>${fl}<span class="fb-sp"></span>
   <button class="btn small" data-act="fb-save" data-v="${esc(k)}">저장</button>${o.next?`<button class="btn small primary" data-act="fb-next" data-v="${esc(k)}" title="Ctrl+Enter">저장하고 다음 학생 →</button>`:''}</div></div>`;
}

/* 학생을 바꾸려는데 저장하지 않은 한마디가 있으면 묻는 상자 (window.confirm 대신 화면 안에) */
function frPendBox(){
  if(!FR.pend)return '';
  return `<div class="fb-pend" role="alertdialog" aria-label="저장하지 않은 한마디"><p><b>저장하지 않은 한마디가 있습니다. 저장하고 넘어갈까요?</b></p><div class="row" style="gap:6px"><button class="btn small primary" data-act="fr-pend-save">저장하고 넘어가기</button><button class="btn small" data-act="fr-pend-skip">저장하지 않고 넘어가기</button><button class="btn small ghost" data-act="fr-pend-cancel">취소</button></div></div>`;
}
/* 지금 학생(sid)의 저장 안 된 칸: 이 시험 한마디와 누적 코멘트 */
const frDirtyKeys=(tid,sid)=>[tid+'|'+sid,'|'+sid].filter(fbDirty);
/* 학생 바꾸기. 저장 안 된 글이 있으면 먼저 묻는다. kind 'stu'=학생 리포트, 'open'=반 분석 표의 입력 줄 */
function frSwitch(kind,to){
  const tid=S.selTest;const cur=kind==='stu'?(S.selStudent?ident(S.selStudent):null):FR.open;
  if(cur&&frDirtyKeys(tid,cur).length){FR.pend={kind,to,from:cur};render();
    setTimeout(()=>document.querySelector('.fb-pend [data-act="fr-pend-save"]')?.focus(),20);return}
  frGo(kind,to);
}
function frGo(kind,to){FR.pend=null;FR.flash=null;if(kind==='stu')S.selStudent=to;else FR.open=to;render();if(kind==='open'&&to)fbFocus(S.selTest+'|'+to)}

/* ----- 학생 리포트: 한마디 + 다시 풀기 ----- */
function frStudentCards(t,rec,recs,key){
  const sid=frSid(rec);const kr=rec.cls?frKeyRel(t.id,rec.cls):false;const rel=rec.cls?isRel(t,rec.cls):false;
  const nFb=recs.filter(r=>FR.fb[t.id+'|'+frSid(r)]).length;
  const when=!rel?'이 반은 아직 결과를 공개하지 않았습니다. 정답·해설을 공개한 뒤에 학생에게 보입니다.':!kr?'이 반은 아직 정답·해설 공개 전이라 학생에게 보이지 않습니다. 정답·해설을 공개하면 보입니다.':'이 반은 정답·해설을 공개해서 학생 결과 화면에 바로 보입니다.';
  // 다시 풀기
  const tg=frTargets(key,rec.a);const rr=FR.rt[t.id+'|'+sid];let rtH;
  if(!tg.length)rtH='<p class="muted">모두 맞혀 다시 풀 문항이 없습니다.</p>';
  else if(!rr)rtH=`<p class="sub">아직 다시 풀지 않았습니다. 대상 ${tg.length}문항: <span class="mono">${tg.map(i=>esc(t.items[i].no)).join(', ')}</span></p>${kr?'<p class="sub">정답·해설을 공개해서 이제는 다시 풀 수 없습니다.</p>':''}`;
  else{const o=frRetrySplit(key,rr.answers);const nm=c=>c==null||c==='0'?'비움':CIR[+c];
    rtH=`<p class="sub" style="margin-bottom:8px">재도전 정답률 <b>${pct(o.rate)}</b> (${o.fixed.length}/${o.targets.length} 맞힘${o.blank.length?` · ${o.blank.length} 비움`:''}) ·${esc(new Date(rr.at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</p>
     <div class="tbl-wrap"><table><thead><tr><th>번호</th><th>처음</th><th>다시</th><th>정답</th><th>판단</th></tr></thead><tbody>${o.targets.map(i=>`<tr><td class="mono"><b>${esc(t.items[i].no)}</b></td><td class="mono">${nm(rec.a[i])}</td><td class="mono">${nm(rr.answers[i])}</td><td class="mono">${CIR[+key[i]]}</td><td>${o.fixed.includes(i)?'<span class="pill" style="color:var(--good)">맞힘 · 실수형</span>':o.blank.includes(i)?'<span class="pill" style="color:var(--muted)">다시 풀 때 비움</span>':'<span class="pill" style="color:var(--bad)">또 틀림 · 개념형</span>'}</td></tr>`).join('')}</tbody></table></div>
     ${kr?'':`<div class="row" style="margin-top:8px"><button class="btn small ghost danger" data-act="fr-rt-del" data-v="${esc(t.id+'|'+sid)}">다시 풀기 기록 지우기</button><span class="sub">지우면 학생이 한 번 더 낼 수 있습니다.</span></div>`}`}
  const locked=isAnonCls(rec.cls);
  return `<div class="grid2"><div class="card"><div class="row" style="justify-content:space-between"><h3 class="h-tag" style="margin:0">선생님 한마디 <span class="vis-tag">학생 결과 화면에 보임(정답·해설 공개 뒤)</span></h3><span class="badge">이 시험 ${nFb}/${recs.length}명 작성</span></div>
   <p class="sub" style="margin:6px 0 8px">${when} ${FB_MAX}자까지 적을 수 있고, 비우고 저장하면 지워집니다.</p>
   ${frPendBox()}${fbEditor(t.id,sid,{next:true,label:rec.name,locked})}
   <h3 class="h-tag" style="margin:16px 0 4px">누적 코멘트 <span class="vis-tag">학생 '내 누적 기록' 맨 위에 보임</span></h3><p class="sub" style="margin-bottom:8px">시험과 상관없이 이 학생에게 남기는 말입니다. 저장하면 바로 보입니다.</p>
   ${fbEditor('',sid,{label:rec.name,locked})}${frMissing()}</div>
   <div class="card"><h3>틀린 문항 다시 풀기</h3>${rtH}</div></div>`;
}

/* ----- 저장 ----- */
async function fbSave(k){
  const [tid,sid]=k.split('|');const body=fbClean(FR.draft[k]??FR.fb[k]?.body??'');
  if(fbLen(body)>FB_MAX){toast(`${FB_MAX}자까지 적을 수 있습니다. 조금 줄여 주세요`);return false}
  if(S.demo){if(body)FR.fb[k]={body,at:new Date().toISOString()};else delete FR.fb[k];delete FR.draft[k];FR.done[k]={at:Date.now(),del:!body};toast('예시 데이터라 화면에서만 바뀌고 저장되지는 않습니다');return true}
  const uid=S.idx.studentBySid[sid]?.id;if(!uid){toast('명단에 없는 학번이라 저장할 수 없습니다');return false}
  FR.saving[k]=true;delete FR.fail[k];delete FR.done[k];fbPaint(k);
  const fail=m=>{FR.fail[k]=m;if(FR.draft[k]==null)FR.draft[k]=body;toast('저장하지 못했습니다: '+m);return false};
  try{const r=await sb.rpc('teacher_save_feedback',{p_student:uid,p_test:tid||null,p_body:body});
    if(r.error||!r.data?.ok)return fail(r.error?.message||{too_long:`${FB_MAX}자를 넘었습니다`,not_found:'학생이나 시험을 찾지 못했습니다'}[r.data?.error]||r.data?.error||'알 수 없는 오류');
    if(r.data.deleted)delete FR.fb[k];else FR.fb[k]={body:r.data.body,at:r.data.updated_at};
    // 저장하는 동안 더 적은 글이 있으면 그 글은 '저장 안 됨'으로 남긴다(지우지 않는다)
    if(FR.draft[k]!=null&&fbClean(FR.draft[k])===(FR.fb[k]?.body||''))delete FR.draft[k];
    FR.done[k]={at:Date.now(),del:!!r.data.deleted};return true;
  }catch(e){return fail(e?.message||String(e))}
  finally{delete FR.saving[k];fbPaint(k)}
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
  if(!nx){render();fbFocus(k);toast('마지막 학생입니다');return}
  const nsid=ident(nx);
  if(S.tab==='student')S.selStudent=nx;else FR.open=nsid;
  // 앞 학생을 저장했다는 표시는 토스트 대신 새 칸 아래에 남긴다(지금 칸이 저장된 것처럼 보이지 않게)
  FR.flash={k:tid+'|'+nsid,msg:`앞 학생(${cur.name}) 저장함`};
  render();fbFocus(tid+'|'+nsid);
}

/* ----- 공개 단계 바꾸기 ----- */
async function frStage(act,v){
  const [tid,c]=v.split('|');const t=D().tests[tid];if(!t)return;
  const key=keyOf(tid);const pg=frProgress(tid,key,recordsFor(tid,c));const left=pg.due-pg.done;
  const relMsg=()=>{const base='학생에게 점수와 문항별 맞음/틀림만 보이고, 틀린 문항을 한 번 다시 풀 수 있게 됩니다(정답·해설은 아직 숨김).';
    if(!isOpen(t,c))return base;// 응시가 열려 있을 때만: 공개하면 응시가 닫히고 못 낸 학생은 더 낼 수 없다(서버 student_submit 규칙)
    const miss=subStatus({id:tid,...t},[c]).miss;
    return base+(miss.length?` 이 반은 응시가 닫히고, 아직 못 낸 학생 ${miss.length}명(${miss.map(sidName).join(', ')})은 더 낼 수 없습니다.`:' 이 반은 응시가 닫힙니다(모두 냈습니다).')};
  const Q={'fr-release':{title:`${c} 결과 공개`,msg:act==='fr-release'?relMsg():'',ok:'결과 공개'},
    'fr-key':{title:`${c} 정답·해설 공개`,msg:`학생에게 정답·해설·다시 풀기 결과·선생님 한마디가 보이고, 이제부터는 다시 풀기를 낼 수 없습니다.${left>0?` (아직 다시 풀지 않은 학생 ${left}명)`:''}`,ok:'정답·해설 공개'},
    'fr-key-undo':{title:`${c} 정답·해설 공개 취소`,msg:'학생 화면에서 정답·해설·한마디가 다시 숨겨지고, 아직 다시 풀지 않은 학생은 다시 풀 수 있게 됩니다.',ok:'공개 취소'},
    'fr-unrelease':{title:`${c} 결과 공개 취소`,msg:'학생 화면에서 이 시험 결과가 사라지고, 정답·해설 공개도 함께 취소됩니다. 다시 풀기 기록은 남습니다.',ok:'공개 취소',danger:true}}[act];
  if(!(await ask(Q)))return;
  const cid=clsId(c);
  if(act==='fr-release'){const rs=recordsFor(tid,c);if(!rs.length){toast('이 반에 낸 답안이 없어 공개할 결과가 없습니다');return}const stats=toStats(analyze(t,key,rs));
    // 공개하면 응시도 닫는다(학생은 이미 더 낼 수 없으므로 교사 화면과 서버 상태를 맞춘다)
    await api(async()=>chk(await sb.from('test_class').upsert({test_id:tid,class_id:cid,released:true,released_at:nowIso(),stats,is_open:false,closed_once:true},{onConflict:'test_id,class_id'})),c+'에 결과를 공개했습니다')}
  else if(act==='fr-key')await api(async()=>chk(await sb.from('test_class').update({key_released:true,key_released_at:nowIso()}).eq('test_id',tid).eq('class_id',cid)),c+'에 정답·해설을 공개했습니다');
  else if(act==='fr-key-undo')await api(async()=>chk(await sb.from('test_class').update({key_released:false,key_released_at:null}).eq('test_id',tid).eq('class_id',cid)),'정답·해설 공개를 취소했습니다');
  else await api(async()=>chk(await sb.from('test_class').update({released:false,released_at:null,stats:null,key_released:false,key_released_at:null}).eq('test_id',tid).eq('class_id',cid)),'결과 공개를 취소했습니다');
}

/* ----- 이벤트 ----- */
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const act=b.dataset.act,v=b.dataset.v;
  switch(act){
    case 'fb-save':FR.flash=null;await fbSave(v);render();break;
    case 'fb-next':await fbNext(v);break;
    case 'fr-open':frSwitch('open',FR.open===v?null:v);break;
    case 'fr-pick':if(v!==S.selStudent)frSwitch('stu',v);break;
    case 'fr-pend-save':{const P=FR.pend;if(!P)break;let ok=true;for(const k of frDirtyKeys(S.selTest,P.from))ok=(await fbSave(k))&&ok;if(ok)frGo(P.kind,P.to);else render();break}
    case 'fr-pend-skip':{const P=FR.pend;if(!P)break;for(const k of frDirtyKeys(S.selTest,P.from)){delete FR.draft[k];delete FR.fail[k]}frGo(P.kind,P.to);break}
    case 'fr-pend-cancel':FR.pend=null;render();break;
    case 'fr-st-exp':FR.stExp=FR.stExp===v?null:v;render();break;
    case 'fr-tmore':FR.tf.n+=FR_PAGE;render();break;
    case 'fr-jump':document.getElementById(v)?.scrollIntoView({block:'start',behavior:'smooth'});break;
    case 'tab':if(v==='class')setTimeout(()=>{if(frAutoActive())frAutoRefresh()},0);break;
    case 'fr-release':case 'fr-key':case 'fr-key-undo':case 'fr-unrelease':await frStage(act,v);break;
    case 'fr-rt-del':{const [tid,sid]=v.split('|');const st=S.idx.studentBySid[sid];
      if(S.demo){toast('예시 데이터에서는 바꾸지 않습니다');break}
      if(!st||!(await ask({title:'다시 풀기 기록 지우기',msg:`${st.name}(${sid}) 학생의 다시 풀기 답을 지웁니다. 정답·해설 공개 전이면 학생이 한 번 더 낼 수 있습니다.`,ok:'지우기',danger:true})))break;
      await api(async()=>chk(await sb.from('retries').delete().eq('test_id',tid).eq('student_id',st.id)),'다시 풀기 기록을 지웠습니다');break}
  }
});
document.addEventListener('input',e=>{const el=e.target;if(el.id==='frTq'){FR.tf.q=el.value;FR.tf.n=FR_PAGE;const p=el.selectionStart;render();const n=document.getElementById('frTq');if(n){n.focus();n.setSelectionRange(p,p)}}});
document.addEventListener('change',e=>{const el=e.target;if(el.id==='frTcls'){FR.tf.cls=el.value;FR.tf.n=FR_PAGE;render()}});
document.addEventListener('input',e=>{const el=e.target;if(!el.classList?.contains('fb-text'))return;const k=el.dataset.fbk;FR.draft[k]=el.value;delete FR.fail[k];delete FR.done[k];fbPaint(k)});
document.addEventListener('keydown',e=>{const el=e.target;if(!el.classList?.contains('fb-text')||e.key!=='Enter'||!(e.ctrlKey||e.metaKey))return;e.preventDefault();
  const box=el.closest('.fb-ed');const btn=box?.querySelector('[data-act="fb-next"]')||box?.querySelector('[data-act="fb-save"]');btn?.click()});

"use strict";
/* 근본국어 학생 화면: 틀린 문항 다시 풀기 · 선생님 한마디.
   student.js보다 먼저 불러온다. T·sb·rpc·head 같은 student.js 값은 함수 안에서만 쓴다.
   - 결과 공개(정답·해설 공개 전): 점수·문항별 맞음/틀림·영역·세트·반 통계만. 정답·해설은 서버가 보내지 않는다.
   - 다시 풀기: 그 사이에 틀렸거나 비운 문항만 한 번 다시 마킹해서 낸다. 맞았는지는 정답·해설 공개 뒤에 보인다.
   - 정답·해설 공개 뒤: 다시 풀기 결과(실수형/개념형)와 선생님 한마디가 결과 화면에 붙는다. */
const RT={draft:lsGet('gb-rt-draft',{})||{},confirm:false,busy:false,note:undefined};
const rtKey=tid=>(T.me?.sid||'')+':'+tid;

/* student_results를 불러와, 정답 공개 전 시험은 채점용 가짜 정답(pseudoKey)을 넣어 둔다(기존 채점·누적 그래프가 그대로 돈다). */
async function loadResults(){
  const rows=await rpc('student_results',{p_token:T.token,p_test:null})||[];
  for(const r of rows){if(r.stage==='result'){r.keyHidden=true;r.key=r.answers&&r.ox?pseudoKey(r.ox,r.answers):null}}
  return rows;
}
async function loadNote(){try{RT.note=await rpc('student_overall_feedback',{p_token:T.token})}catch(e){RT.note=null}}

const fmtDay=s=>s?new Date(s).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
function fbBox(fb,title){return `<div class="card fb-note"><h3>${esc(title)}</h3><p class="fb-body">${esc(fb.body)}</p><p class="sub">${esc(fmtDay(fb.updated_at))}</p></div>`}

/* ----- 결과 공개 단계(정답·해설 공개 전) ----- */
function viewResultPre(row){
  const t={title:row.title,items:row.items};const cls=clsOf(row);
  const r=report(t,row.key.split(''),{a:row.answers,el:''},cls);
  const ox=String(row.ox||'');const tg=retryTargets(ox);const blanks=tg.filter(i=>ox[i]==='B').length;
  let top;
  if(row.can_retry)top=`<div class="card rt-cta"><h2>틀린 문항 다시 풀기</h2><p class="sub">정답을 보기 전에, 틀렸거나 비운 <b>${tg.length}문항</b>을 한 번 더 풀어 보세요. <b>한 번만</b> 낼 수 있습니다. 정답과 해설은 선생님 설명 수업이 끝난 뒤에 공개됩니다.</p><div class="row" style="margin-top:12px"><button class="btn red" data-act="rt-start" data-v="${esc(row.id)}">틀린 문항 다시 풀기 (${tg.length}문항)</button></div></div>`;
  else if(row.retry)top=`<div class="card"><h3>다시 푼 답을 냈습니다 <span class="sub" style="font-weight:400">${esc(fmtDay(row.retry.submitted_at))}</span></h3><p class="sub">맞았는지는 선생님이 정답·해설을 공개하면 여기서 볼 수 있습니다.</p><div class="rt-list">${retryTargets(ox).map(i=>{const c=row.retry.answers[i];return `<span class="rt-pair"><b class="mono">${esc(row.items[i]?.no)}번</b> ${row.answers[i]==='0'?'비움':CIR[+row.answers[i]]} → ${c&&c!=='0'&&c!=='-'?CIR[+c]:'비움'}</span>`}).join('')}</div></div>`;
  else top=tg.length?'':`<div class="card"><h3>모든 문항을 맞혔습니다</h3><p class="sub">다시 풀 문항이 없습니다. 정답·해설은 선생님이 공개하면 볼 수 있습니다.</p></div>`;
  const cells=row.items.map((it,i)=>{const c=ox[i];if(c==='.')return '';const lab=c==='O'?'맞음':c==='B'?'무응답':'틀림';
    return `<div class="ox ox-${c}" data-tip="${esc(it.no+'번 · '+lab+(cls.ir[i]!=null?'\n반 정답률 '+pct(cls.ir[i]):''))}"><span class="mono">${esc(it.no)}</span><b>${c==='O'?'O':c==='B'?'–':'X'}</b></div>`}).join('');
  return `${top}<div class="card"><h2>${esc(row.title)} 결과</h2><p class="sub">지금은 점수와 맞음/틀림만 보입니다. 정답·해설은 아직 공개되지 않았습니다.</p>
   <div class="tiles" style="margin-top:10px"><div class="tile"><div class="k">내 점수</div><div class="v">${r.score}<small> / ${r.max}</small></div></div><div class="tile"><div class="k">반 평균 (100점 환산)</div><div class="v">${cls.avgPct!=null?Math.round(cls.avgPct*100):'–'}<small> 점</small></div></div><div class="tile"><div class="k">틀린 문항</div><div class="v">${tg.length}<small> 개${blanks?` (무응답 ${blanks})`:''}</small></div></div></div></div>
   <div class="card"><h3>문항별 맞음 · 틀림</h3><div class="legend" style="margin-bottom:8px"><span><i class="ox-i ox-O"></i>맞음</span><span><i class="ox-i ox-X"></i>틀림</span><span><i class="ox-i ox-B"></i>무응답</span></div><div class="ox-grid">${cells}</div></div>
   <div class="grid2"><div class="card"><h3>영역별 · 반과 비교</h3>${barRows(r.areaCmp.map(x=>({label:x.name,v:x.me,w:x.cls})),{a:'나',b:'반 평균'})}</div>${setCard(r)||'<div></div>'}</div>`;
}

/* ----- 다시 풀기 답안지 ----- */
function viewRetry(){
  const row=(T.results||[]).find(x=>x.id===T.cur);
  if(!row||!row.can_retry){T.view='result';return viewResult()}
  const ox=String(row.ox||'');const tg=retryTargets(ox);const n=row.items.length;const k=rtKey(row.id);
  let d=RT.draft[k];if(typeof d!=='string'||d.length!==n)d=RT.draft[k]='0'.repeat(n);
  const left=tg.filter(i=>d[i]==='0').length;
  const rows=tg.map(i=>{const it=row.items[i];const first=row.answers[i];
    return `<div class="omr-row rt-row"><span class="no">${esc(it.no)}</span>${[1,2,3,4,5].map(o=>`<button class="bub" aria-pressed="${d[i]===String(o)}" data-act="rt-mark" data-i="${i}" data-v="${o}" aria-label="${esc(it.no)}번 ${o}">${o}</button>`).join('')}<span class="rt-first">${first==='0'?'처음엔 비움':'처음 '+CIR[+first]}</span></div>`}).join('');
  return head()+`<div class="omr"><div class="omr-head"><span class="t">${esc(row.title)} · 다시 풀기</span><span class="mono" style="font-size:12px">틀렸거나 비운 ${tg.length}문항</span></div><div class="omr-cols rt-cols">${rows}</div></div>
   <div class="card"><div class="row" style="justify-content:space-between"><div><b>한 번만 낼 수 있습니다.</b><p class="sub" id="rtInfo">${left?`아직 고르지 않은 문항 ${left}개`:'모두 골랐습니다'}</p></div>
   <div class="row">${RT.confirm?`<span class="confirm">${left?`고르지 않은 문항 ${left}개는 비운 채로 냅니다. `:''}다시 고칠 수 없습니다. 낼까요? <button class="btn small red" data-act="rt-yes">제출</button><button class="btn small ghost" data-act="rt-no">계속 풀기</button></span>`:`<button class="btn red" data-act="rt-submit" ${RT.busy?'disabled':''}>다시 푼 답 제출</button>`}<button class="btn ghost" data-act="result" data-v="${esc(row.id)}">결과로</button></div></div></div>`;
}

/* ----- 정답·해설 공개 뒤: 결과 화면에 붙는 카드 ----- */
function resultExtras(row){
  if(row.keyHidden)return '';
  let h='';
  if(row.feedback)h+=fbBox(row.feedback,'선생님 한마디');
  if(row.retry&&row.key){const o=retryOutcome(row.key,row.retry.answers);
    if(o.targets.length){const it=i=>`<span class="rt-pair"><b class="mono">${esc(row.items[i]?.no)}번</b> ${row.retry.answers[i]==='0'?'비움':CIR[+row.retry.answers[i]]}</span>`;
      h+=`<div class="card"><h3>다시 풀기 결과 <span class="sub" style="font-weight:400">${o.fixed.length}/${o.targets.length} 맞힘</span></h3><p class="sub" style="margin-bottom:10px">${esc(retryMessage(o))}</p>
       <div class="grid2 rt-split"><div><h4 class="rt-h good">다시 풀어서 맞힌 문항 · 실수형</h4>${o.fixed.length?`<div class="rt-list">${o.fixed.map(it).join('')}</div>`:'<p class="muted">없습니다.</p>'}</div>
       <div><h4 class="rt-h bad">또 틀린 문항 · 개념형</h4>${o.again.length?`<div class="rt-list">${o.again.map(it).join('')}</div>`:'<p class="muted">없습니다.</p>'}</div></div></div>`}}
  return h;
}
/* 틀린 문항 카드 안에 붙는 다시 풀기 표시 */
function retryPill(row,i){
  if(row.keyHidden||!row.retry||!row.key)return '';const c=row.retry.answers[i];if(c==null||c==='-')return '';
  return c===row.key[i]?'<div class="why"><span class="pill" style="color:var(--good)">다시 풀어서 맞힘 · 실수형</span></div>':`<div class="why"><span class="pill" style="color:var(--bad)">또 틀림 · 개념형 (다시 고른 답 ${c==='0'?'비움':CIR[+c]})</span></div>`;
}
/* 누적 기록 맨 위: 시험과 상관없는 선생님 한마디 */
function overallFbCard(){return RT.note&&RT.note.body?fbBox(RT.note,'선생님 한마디 (누적)'):''}

/* ----- 동작 ----- */
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const act=b.dataset.act;
  if(!act.startsWith('rt-'))return;
  try{switch(act){
    case 'rt-start':T.cur=b.dataset.v;T.view='retry';RT.confirm=false;render();window.scrollTo(0,0);break;
    case 'rt-mark':{const row=(T.results||[]).find(x=>x.id===T.cur);if(!row)break;const k=rtKey(row.id);const i=+b.dataset.i,v=b.dataset.v;
      const arr=(RT.draft[k]||'0'.repeat(row.items.length)).split('');arr[i]=arr[i]===v?'0':v;RT.draft[k]=arr.join('');lsSet('gb-rt-draft',RT.draft);
      b.parentElement.querySelectorAll('.bub').forEach(x=>x.setAttribute('aria-pressed',arr[i]===x.dataset.v));
      const left=retryTargets(row.ox).filter(j=>arr[j]==='0').length;const el=$('#rtInfo');if(el)el.textContent=left?`아직 고르지 않은 문항 ${left}개`:'모두 골랐습니다';break}
    case 'rt-submit':RT.confirm=true;render();break;
    case 'rt-no':RT.confirm=false;render();break;
    case 'rt-yes':{RT.confirm=false;const row=(T.results||[]).find(x=>x.id===T.cur);if(!row)break;const k=rtKey(row.id);
      RT.busy=true;render();
      try{const d=await rpc('student_retry_submit',{p_token:T.token,p_test:row.id,p_answers:retryString(row.items.length,retryTargets(row.ox),RT.draft[k])});
        if(d&&d.ok){toast('다시 푼 답을 냈습니다');delete RT.draft[k];lsSet('gb-rt-draft',RT.draft)}
        else toast({already:'이미 다시 푼 답을 냈습니다',key_released:'정답이 이미 공개되어 다시 풀 수 없습니다',not_released:'아직 결과가 공개되지 않았습니다',no_submission:'처음 낸 답안이 없습니다',nothing_to_retry:'다시 풀 문항이 없습니다'}[d?.error]||'내지 못했습니다. 새로고침 뒤 다시 시도해 주세요');
        T.results=await loadResults();T.view='result';
      }finally{RT.busy=false;render();window.scrollTo(0,0)}
      break}
  }}catch(err){console.error(err);if(!/invalid_session|must_change_password|class_hidden/.test(err?.message||''))toast('문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.')}
});

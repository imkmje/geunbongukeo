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

/* ----- 결과 화면 공통 조각 ----- */
/* 점수 칸: 100점 환산을 크게, 원점수는 작게. third=세 번째 칸 html.
   반 평균이 없으면(응시 인원이 적음, cls.hidden) 반 평균 칸 대신 안내 한 줄. 결과 화면에서 이 안내는 여기 한 번만 나온다. */
function scoreTiles(r,cls,third){
  const me=score100(r.score,r.max),av=cls.hidden?null:pct100(cls.avgPct);
  const avTile=av!=null?`<div class="tile"><div class="k">반 평균 (100점 환산)</div><div class="v">${av}<small>점</small></div><div class="raw">${r.max}점 만점에 ${oneDec(cls.avgPct*r.max)}점</div></div>`:'';
  return `<div class="tiles" style="margin-top:10px"><div class="tile"><div class="k">내 점수 (100점 환산)</div><div class="v">${me??'–'}<small>점</small></div><div class="raw">${r.max}점 만점에 ${r.score}점</div></div>
   ${avTile}${third}</div>${av==null?`<p class="sub cls-hidden">${esc(CLS_HIDDEN_MSG)}</p>`:''}`;
}
/* 영역별 막대: 반 통계가 있으면 '나'와 '반 평균', 없으면 '나'만(안내는 점수 칸에서 이미 함) */
function areaBars(r,cls){
  if(cls.hidden)return `<h3>영역별 정답률</h3>${barRows(r.areaCmp.map(x=>({label:x.name,v:x.me})),{a:'나'})}`;
  return `<h3>영역별 · 반과 비교</h3>${barRows(r.areaCmp.map(x=>({label:x.name,v:x.me,w:x.cls})),{a:'나',b:'반 평균'})}`;
}
/* 문항별 O/X 표시: ○ 맞음, ✕ 틀림, 비움 (O를 0으로 잘못 읽지 않게) */
const OX_LAB={O:'맞음',X:'틀림',B:'비움'},OX_SYM={O:'○',X:'✕',B:'비움'};
function oxLegend(){return `<div class="legend" style="margin-bottom:8px">${['O','X','B'].map(c=>`<span><i class="ox-i ox-${c}" aria-hidden="true">${c==='B'?'':OX_SYM[c]}</i>${OX_LAB[c]}</span>`).join('')}</div>`}
/* 빈 문항 번호 단추: 누르면 그 줄로 간다(pre: 줄 id 앞부분) */
const blankBtn=pre=>x=>`<button type="button" class="blank-no" data-act="goto" data-t="${pre}${x.i}" aria-label="${esc(x.no)}번 문항으로 가기">${esc(x.no)}번</button>`;
/* 지문 세트별 결과(휴대폰에서도 읽히게 한 줄에 한 세트씩) */
function setList(r){
  if(!r.sets||!r.sets.length)return '';
  const lab={collapse:['bad','지문 전체를 놓침'],slip:['warn','한 문항만 놓침'],part:['warn','일부 놓침'],ok:['good','모두 맞음']};
  return `<div class="card"><h3>지문 세트별 결과</h3><p class="sub" style="margin-bottom:8px">같은 지문 문항을 절반 이상(2개 이상) 틀렸으면 지문 이해에서, 하나만 틀렸으면 선지 판단에서 막힌 것입니다.</p>
   <ul class="set-list">${r.sets.map(x=>`<li class="set-${x.state}"><div class="set-nm">${esc(x.name)}</div><div class="set-meta"><span class="mono">${esc(noRange(x.nos))}</span><span>${x.n}문항 중 <b>${x.w}</b>개 틀림</span><span class="pill" style="color:var(--${lab[x.state][0]})">${lab[x.state][1]}</span></div></li>`).join('')}</ul></div>`;
}

/* ----- 결과 공개 단계(정답·해설 공개 전) ----- */
function viewResultPre(row){
  const t={title:row.title,items:row.items};const cls=clsOf(row);
  const r=report(t,row.key.split(''),{a:row.answers,el:''},cls);
  const ox=String(row.ox||'');const tg=retryTargets(ox);const blanks=tg.filter(i=>ox[i]==='B').length;
  let top;
  if(row.can_retry)top=`<div class="card rt-cta"><h2>틀린 문항 다시 풀기</h2><p class="sub">정답을 보기 전에, 틀렸거나 비운 <b>${tg.length}문항</b>을 한 번 더 풀어 보세요. <b>한 번만</b> 낼 수 있습니다. 정답과 해설은 선생님 설명 수업이 끝난 뒤에 공개됩니다.</p><div class="row" style="margin-top:12px"><button class="btn red" data-act="rt-start" data-v="${esc(row.id)}">틀린 문항 다시 풀기 (${tg.length}문항)</button></div></div>`;
  else if(row.retry)top=`<div class="card"><h3>다시 푼 답을 냈습니다 <span class="sub" style="font-weight:400">${esc(fmtDay(row.retry.submitted_at))}</span></h3><p class="sub">맞았는지는 선생님이 정답·해설을 공개하면 여기서 볼 수 있습니다.</p><div class="rt-list">${retryTargets(ox).map(i=>{const c=row.retry.answers[i];return `<span class="rt-pair"><b class="mono">${esc(row.items[i]?.no)}번</b> ${row.answers[i]==='0'?'비움':CIR[+row.answers[i]]} → ${c&&c!=='0'&&c!=='-'?CIR[+c]:'비움'}</span>`}).join('')}</div></div>`;
  else top=tg.length?'':`<div class="card"><h3>모든 문항을 맞혔습니다</h3><p class="sub">다시 풀 문항이 없습니다. 정답·해설은 선생님이 공개하면 볼 수 있습니다.</p></div>`;
  const cells=row.items.map((it,i)=>{const c=ox[i];if(!OX_LAB[c])return '';
    return `<div class="ox ox-${c}" role="img" aria-label="${esc(it.no)}번 ${OX_LAB[c]}" data-tip="${esc(it.no+'번 · '+OX_LAB[c]+(cls.ir[i]!=null?'\n반 정답률 '+pct(cls.ir[i]):''))}"><span class="mono" aria-hidden="true">${esc(it.no)}</span><b aria-hidden="true">${OX_SYM[c]}</b></div>`}).join('');
  return `${top}<div class="card"><h2>${esc(row.title)} 결과</h2><p class="sub">지금은 점수와 맞음/틀림만 보입니다. 정답·해설은 아직 공개되지 않았습니다.</p>
   ${scoreTiles(r,cls,`<div class="tile"><div class="k">틀린 문항</div><div class="v">${tg.length}<small>개${blanks?` (비움 ${blanks})`:''}</small></div></div>`)}</div>
   <div class="card"><h3>문항별 맞음 · 틀림</h3>${oxLegend()}<div class="ox-grid">${cells}</div></div>
   <div class="grid2"><div class="card">${areaBars(r,cls)}</div>${setList(r)||'<div></div>'}</div>`;
}

/* ----- 다시 풀기 답안지 ----- */
function rtBlanks(row,d){const ox=String(row.ox||'');return retryTargets(ox).filter(i=>!/[1-5]/.test(d[i]||'')).map(i=>({i,no:String(row.items[i]?.no??i+1)}))}
const rtInfoHtml=list=>list.length?`아직 고르지 않은 문항: ${blankNos(list,10,blankBtn('rt-r'))}`:'모두 골랐습니다';
const rtConfirmHtml=list=>`${list.length?`${blankNos(list,10,blankBtn('rt-r'))}이 비어 있습니다. `:''}한 번 내면 고칠 수 없습니다. 그대로 낼까요?`;
function viewRetry(){
  const row=(T.results||[]).find(x=>x.id===T.cur);
  if(!row||!row.can_retry){T.view='result';return viewResult()}
  const ox=String(row.ox||'');const tg=retryTargets(ox);const n=row.items.length;const k=rtKey(row.id);
  let d=RT.draft[k];if(typeof d!=='string'||d.length!==n)d=RT.draft[k]='0'.repeat(n);
  const left=rtBlanks(row,d);
  const rows=tg.map(i=>{const it=row.items[i];const first=row.answers[i];
    return `<div class="omr-row rt-row${d[i]==='0'?' is-blank':''}" id="rt-r${i}"><span class="no">${esc(it.no)}</span>${[1,2,3,4,5].map(o=>`<button class="bub" aria-pressed="${d[i]===String(o)}" data-act="rt-mark" data-i="${i}" data-v="${o}" aria-label="${esc(it.no)}번 ${o}">${o}</button>`).join('')}<span class="rt-first">${first==='0'?'처음엔 비움':'처음 '+CIR[+first]}</span></div>`}).join('');
  return head()+`<div class="omr"><div class="omr-head"><span class="t">${esc(row.title)} · 다시 풀기</span><span class="mono" style="font-size:12px">틀렸거나 비운 ${tg.length}문항</span></div><div class="omr-cols rt-cols">${rows}</div></div>
   <div class="card"><div class="row" style="justify-content:space-between"><div><b>한 번만 낼 수 있습니다.</b><p class="sub blank-info" id="rtInfo">${rtInfoHtml(left)}</p></div>
   <div class="row">${RT.confirm?`<span class="confirm"><span id="rtConfirm">${rtConfirmHtml(left)}</span> <button class="btn small red" data-act="rt-yes">제출</button><button class="btn small ghost" data-act="rt-no">계속 풀기</button></span>`:`<button class="btn red" data-act="rt-submit" ${RT.busy?'disabled':''}>다시 푼 답 제출</button>`}<button class="btn ghost" data-act="result" data-v="${esc(row.id)}">결과로</button></div></div></div>`;
}

/* ----- 정답·해설 공개 뒤: 결과 화면에 붙는 카드(선생님 한마디 → 다시 풀기 결과) ----- */
function resultExtras(row){
  if(row.keyHidden)return '';
  let h='';
  if(row.feedback)h+=fbBox(row.feedback,'선생님 한마디');
  const o=row.retry&&row.key?retryOutcome(row.key,row.retry.answers):null;
  if(o&&o.targets.length){const it=i=>`<span class="rt-pair"><b class="mono">${esc(row.items[i]?.no)}번</b> ${/[1-5]/.test(row.retry.answers[i])?CIR[+row.retry.answers[i]]:'비움'}</span>`;
    const grp=(cls,title,list)=>`<div><h4 class="rt-h ${cls}">${title}</h4>${list.length?`<div class="rt-list">${list.map(it).join('')}</div>`:'<p class="muted">없습니다.</p>'}</div>`;
    h+=`<div class="card"><h3>다시 풀기 결과 <span class="sub" style="font-weight:400">${o.targets.length}문항 중 ${o.fixed.length}문항 맞힘</span></h3><p class="sub" style="margin-bottom:10px">${esc(retryMessage(o))}</p>
     <div class="rt-split3">${grp('good','다시 풀어서 맞힘 · 실수형',o.fixed)}${grp('bad','또 틀림 · 개념형',o.again)}${o.blank.length?grp('mute','다시 풀 때 비워 둠',o.blank):''}</div></div>`}
  else if(!row.retry&&retryTargets(row.ox).length)h+=`<p class="rt-none">이번 시험은 다시 풀기를 하지 않았습니다. 아래 정답·해설을 꼭 읽어 보세요.</p>`;
  return h;
}
/* 틀린 문항 카드 안에 붙는 다시 풀기 표시 */
function retryPill(row,i){
  if(row.keyHidden||!row.retry||!row.key)return '';const c=row.retry.answers[i];if(c==null||c==='-')return '';
  if(!/[1-5]/.test(c))return '<span class="pill" style="color:var(--ink2)">다시 풀 때 비워 둠</span>';
  return c===row.key[i]?'<span class="pill" style="color:var(--good)">다시 풀어서 맞힘 · 실수형</span>':`<span class="pill" style="color:var(--bad)">또 틀림 · 개념형 (다시 고른 답 ${CIR[+c]})</span>`;
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
      b.parentElement.classList.toggle('is-blank',arr[i]==='0');
      const left=rtBlanks(row,RT.draft[k]);const el=$('#rtInfo');if(el)el.innerHTML=rtInfoHtml(left);const cf=$('#rtConfirm');if(cf)cf.innerHTML=rtConfirmHtml(left);break}
    case 'rt-submit':RT.confirm=true;render();break;
    case 'rt-no':RT.confirm=false;render();break;
    case 'rt-yes':{RT.confirm=false;const row=(T.results||[]).find(x=>x.id===T.cur);if(!row)break;const k=rtKey(row.id);
      RT.busy=true;render();
      try{const d=await rpc('student_retry_submit',{p_token:T.token,p_test:row.id,p_answers:retryString(row.items.length,retryTargets(row.ox),RT.draft[k])});
        if(d&&d.ok){toast('다시 푼 답을 냈습니다');T.notice='';delete RT.draft[k];lsSet('gb-rt-draft',RT.draft)}
        else toast({already:'이미 다시 푼 답을 냈습니다',key_released:'정답이 이미 공개되어 다시 풀 수 없습니다',not_released:'아직 결과가 공개되지 않았습니다',no_submission:'처음 낸 답안이 없습니다',nothing_to_retry:'다시 풀 문항이 없습니다'}[d?.error]||'내지 못했습니다. 새로고침 뒤 다시 시도해 주세요');
        T.results=await loadResults();T.view='result';
      }finally{RT.busy=false;render();window.scrollTo(0,0)}
      break}
  }}catch(err){console.error(err);if(!errHandled(err))toast('문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.')}
});

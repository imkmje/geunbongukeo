"use strict";
/* 근본국어: 틀린 문항 다시 풀기 · 선생님 한마디에 쓰는 순수 함수(화면 없음). 학생·교사 화면과 tests/가 함께 쓴다.
   수업 흐름(반마다): 응시 → 결과 공개(점수·맞음/틀림만) → 틀린 문항 다시 풀기(한 번) → 설명 수업 → 정답·해설 공개.
   서버 student_results는 정답·해설 공개 전에는 정답 대신 ox('O' 맞음, 'X' 틀림, 'B' 무응답, '.' 채점 안 함)만 준다. */

const FB_MAX=500;
/* 한마디 글: 줄바꿈을 \n으로, 앞뒤 빈칸 제거(서버와 같은 규칙) */
const fbClean=s=>String(s??'').replace(/\r\n?/g,'\n').replace(/^[ \t\n]+|[ \t\n]+$/g,'');
/* 글자 수: 서버(Postgres length)처럼 유니코드 글자 단위로 센다 */
const fbLen=s=>[...fbClean(s)].length;

/* 정답 공개 전: ox와 내 답안으로 채점용 가짜 정답을 만든다. 맞은 문항은 내 답, 틀리거나 비운 문항은 '?'(어떤 답과도 다름).
   정답을 모르는 상태에서도 기존 채점 함수(grade·report)로 점수·영역별 결과를 그대로 계산할 수 있다. */
function pseudoKey(ox,answers){
  const a=String(answers||'');
  return Array.from(String(ox||''),(c,i)=>c==='O'?(a[i]||'?'):c==='.'?'0':'?').join('');
}
/* 다시 풀 문항: 틀렸거나 비운 문항의 자리 */
function retryTargets(ox){const out=[];Array.from(String(ox||'')).forEach((c,i)=>{if(c==='X'||c==='B')out.push(i)});return out}
/* 서버로 보낼 다시 풀기 답: 길이 n, 다시 푸는 자리만 '0'~'5', 나머지 '-' */
function retryString(n,targets,draft){
  const set=new Set(targets);const d=String(draft||'');
  return Array.from({length:n},(_,i)=>set.has(i)?(/[0-5]/.test(d[i]||'')?d[i]:'0'):'-').join('');
}
/* 정답 공개 뒤: 다시 푼 결과. fixed=다시 풀어서 맞힘(실수형), again=또 틀림(개념형) */
function retryOutcome(key,retry){
  const r=String(retry||'');const k=Array.isArray(key)?key:String(key||'').split('');
  const targets=[],fixed=[],again=[];
  for(let i=0;i<r.length;i++){const c=r[i];if(c==='-')continue;targets.push(i);(c===k[i]?fixed:again).push(i)}
  return {targets,fixed,again,rate:targets.length?fixed.length/targets.length:null};
}
/* 학생에게 보여 줄 한 줄 풀이 */
function retryMessage(o){
  if(!o||!o.targets.length)return '';
  const f=o.fixed.length,a=o.again.length;
  if(!a)return `다시 풀어서 ${f}문항을 모두 맞혔습니다. 몰라서라기보다 서두르거나 근거를 덜 확인해서 틀린 '실수형' 오답입니다. 다음에는 고른 답의 근거 문장을 지문에서 한 번 더 확인해 보세요.`;
  if(!f)return `다시 풀어도 ${a}문항을 또 틀렸습니다. 지문 이해나 개념이 아직 덜 잡힌 '개념형' 오답입니다. 해설을 천천히 읽고, 수업에서 설명한 근거를 다시 정리해 봅시다.`;
  return `다시 풀어서 맞힌 ${f}문항은 '실수형', 또 틀린 ${a}문항은 '개념형' 오답입니다. 실수형은 근거를 확인하는 습관으로, 개념형은 해설과 수업 내용으로 보완해 봅시다.`;
}
/* 교사 화면 4단계 표시. s={open,rel,kr,closed,done,due} → [{label,state:'done'|'now'|'todo'}] */
function stageSteps(s){
  const st=(done,now)=>done?'done':now?'now':'todo';
  return [
    {label:'응시 중',state:st(s.rel||(s.closed&&!s.open),s.open&&!s.rel)},
    {label:'결과 공개 (점수·O/X)',state:st(s.rel,false)},
    {label:`다시 풀기 진행 (${s.done||0}/${s.due||0}명 완료)`,state:st(s.kr,s.rel&&!s.kr)},
    {label:'정답·해설 공개',state:st(s.kr,false)}];
}
/* 목록에서 다음 항목(마지막이면 null) */
function nextAfter(list,cur){const i=list.indexOf(cur);return i>=0&&i<list.length-1?list[i+1]:null}

if(typeof module!=='undefined'&&module.exports)module.exports={FB_MAX,fbClean,fbLen,pseudoKey,retryTargets,retryString,retryOutcome,retryMessage,stageSteps,nextAfter};

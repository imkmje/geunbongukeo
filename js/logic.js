"use strict";
/* 근본국어: 화면(DOM) 없이 돌아가는 순수 함수. 교사·학생 화면과 tests/가 함께 쓴다.
   - parseNat: '사이트등록_통계' 파일(# 정답·# 배점 3점 문항·# 영역·# 세트·# 유형 줄 + 전국 정답률 줄)
   - parseEx: '사이트등록_해설' 파일([번호] 정답 ③ … 블록)
   - pwProblem: 학생 새 비밀번호 규칙 */

const PW_MIN=6;
/* 새 비밀번호가 규칙에 맞으면 '' , 아니면 학생에게 보여 줄 이유를 돌려준다. (서버도 같은 규칙으로 다시 확인한다) */
function pwProblem(pw,sid){
  const p=String(pw??'').trim();
  if(p.length<PW_MIN)return `비밀번호는 ${PW_MIN}자 이상이어야 합니다.`;
  if(new TextEncoder().encode(p).length>72)return '비밀번호가 너무 깁니다. 조금 짧게 정해 주세요.';  // bcrypt 한계 72바이트(한글 약 24자)
  if(p===String(sid??'').trim())return '학번과 같은 비밀번호는 쓸 수 없습니다.';
  return '';
}

const CIRC_DIGIT={'①':'1','②':'2','③':'3','④':'4','⑤':'5'};
const toDigits=s=>String(s).replace(/[①②③④⑤]/g,c=>CIRC_DIGIT[c]);
/* "1~6 독서 / 7~10 문학" → [{a:1,z:6,name:'독서'},…]. '1 언어'처럼 한 문항만 적어도 읽는다. */
function parseRanges(s){
  const out=[];
  for(const part of String(s).replace(/←.*$/,'').split(/\s*\/\s*(?=\d)/)){
    const m=part.trim().match(/^(\d+)(?:\s*[~\-–～]\s*(\d+))?\s+(.+)$/);if(!m)continue;
    const a=+m[1],z=m[2]?+m[2]:a;out.push({a:Math.min(a,z),z:Math.max(a,z),name:m[3].trim()});
  }
  return out;
}
const blankItem=no=>({no:String(no),area:'독서',type:'',pts:2,el:''});

/* E: 편집 중인 시험 {items,key,nat,ex,tags}. 붙여넣은 글을 읽어 E를 고친다. */
function parseNat(E,text){
  let ok=0;const bad=[];const meta=[];
  const lines=String(text||'').replace(/^﻿/,'').split(/\r?\n/);
  const H={};
  for(const raw of lines){const h=raw.trim().match(/^[#＃]\s*(정답|배점\s*3\s*점(?:\s*문항)?|3\s*점\s*문항|영역|세트|유형)\s*[:：]\s*(.*)$/);if(!h)continue;
    const k=h[1].startsWith('정답')?'정답':h[1].startsWith('영역')?'영역':h[1].startsWith('세트')?'세트':h[1].startsWith('유형')?'유형':'3점';if(!(k in H))H[k]=h[2]}
  const common=()=>E.items.map((it,i)=>it.el?-1:i).filter(i=>i>=0);
  const byNo=no=>E.items.findIndex(it=>String(it.no)===String(no)&&!it.el);
  // 1) 정답 줄이 먼저: 정답 개수가 곧 문항 수이므로, 선택과목이 없는 시험이면 문항표 길이를 맞춘다.
  if(H['정답']!=null){const ds=toDigits(H['정답'].replace(/\(.*?\)/g,'')).replace(/[^1-5]/g,'');
    if(ds.length){
      const hasEl=E.items.some(it=>it.el);
      if(!hasEl&&ds.length!==E.items.length){const before=E.items.length;
        E.items=Array.from({length:ds.length},(_,i)=>E.items[i]||blankItem(i+1));
        for(const f of ['nat','ex','tags'])if(Array.isArray(E[f]))E[f]=E[f].slice(0,ds.length);
        meta.push(`문항 수 ${before}→${ds.length}`)}
      E.key=Array.from({length:E.items.length},(_,i)=>E.key?.[i]||'0');
      const ci=common();ds.split('').forEach((d,k)=>{if(k<ci.length)E.key[ci[k]]=d});
      meta.push('정답 '+ds.length+'개')}}
  if(H['3점']!=null){const ns=H['3점'].match(/\d+/g)||[];if(ns.length){E.items.forEach(it=>{if(!it.el)it.pts=2});let c=0;ns.forEach(n=>{const i=byNo(n);if(i>=0){E.items[i].pts=3;c++}});meta.push('3점 '+c+'문항')}}
  for(const [k,f,lab] of [['영역','area','영역'],['세트','set','세트'],['유형','type','유형']]){if(H[k]==null)continue;let c=0;
    for(const r of parseRanges(H[k]))E.items.forEach(it=>{const no=parseInt(it.no,10);if(!it.el&&no>=r.a&&no<=r.z){it[f]=r.name;c++}});
    if(c)meta.push(lab+' '+c+'문항')}
  // 2) 전국 정답률 줄: "번호 정답률 ①비율 ②비율 ③비율 ④비율 ⑤비율" (선지 비율은 없어도 됨)
  if(!Array.isArray(E.nat))E.nat=[];
  for(const raw of lines){const line=raw.trim();if(!line||/^[#＃]/.test(line))continue;
    const m=line.match(/^(화작|언매)?\s*(\d+)\s*[번.]?\s+(.*)$/);if(!m){bad.push(line.slice(0,12));continue}
    const el=m[1]||'';const nums=(m[3].match(/\d+(?:\.\d+)?/g)||[]).map(Number);
    const i=E.items.findIndex(it=>String(it.no)===m[2]&&((it.el||'')===el));
    if(i<0||!nums.length){bad.push(line.slice(0,12));continue}
    // 한 줄 안에서 1보다 큰 값이 하나라도 있으면 그 줄 전체를 %로 본다(0.9% 같은 작은 비율을 90%로 잘못 읽지 않게).
    const pctRow=nums.some(x=>x>1);const sc=x=>Math.round((pctRow?x/100:x)*10000)/10000;
    E.nat[i]={r:sc(nums[0]),d:nums.length>=6?nums.slice(1,6).map(sc):null};ok++}
  return {ok,bad,meta:meta.join(', ')};
}

const EX_MAX=8000;
/* 해설: "[1] 정답 ③ (출제 의도: …)" 줄에서 문항이 시작하고 다음 번호 줄 전까지가 그 문항의 해설. */
function parseEx(E,text){
  const ex=[];let cur=-1;const src=String(text||'').replace(/^﻿/,'');
  const br=/^\s*\[\s*\d{1,2}\s*\]/m.test(src);
  const re=br?/^\s*\[\s*(\d{1,2})\s*\]\s*(.*)$/:/^\s*(\d{1,2})\s*(?:번|\.|\))\s*(.*)$/;
  for(const raw of src.split(/\r?\n/)){const m=raw.match(re);const i=m?E.items.findIndex(it=>String(it.no)===m[1]&&!it.el):-1;
    if(i>=0){cur=i;ex[i]=(m[2]||'').trim();continue}
    if(cur>=0)ex[cur]=(ex[cur]?ex[cur]+'\n':'')+raw.trim()}
  if(!Array.isArray(E.ex))E.ex=[];
  let n=0;const mismatch=[],cut=[];
  ex.forEach((v,i)=>{if(v==null)return;let t=v.trim();if(!t)return;
    if(t.length>EX_MAX){t=t.slice(0,EX_MAX);cut.push(E.items[i].no)}
    E.ex[i]=t;n++;
    const a=toDigits(t.split('\n')[0]).match(/정답\s*[:：]?\s*([1-5])/);
    if(a&&E.key&&E.key[i]&&E.key[i]!=='0'&&E.key[i]!==a[1])mismatch.push(E.items[i].no)});
  return {n,mismatch,cut};
}

/* 반 명단 붙여넣기 계획: 저장하기 전에 무엇이 바뀌는지 보여 주려고 줄마다 분류한다.
   text: 붙여넣은 글, cls: 이 반 이름, students: 지금 학생 [{uid,sid,name,cls}] (cls ''=반 없음)
   돌려주는 값: add(새 학생) / move(다른 반·반 없음에서 옮겨 옴) / rename(이름만 바뀜) / same(그대로)
               / errors(고쳐야 하는 줄, 줄 번호 포함) / skipped(학번이 없어 건너뛴 줄: 머리글 등) / missing(이 반인데 붙여넣은 글에 없는 학생) */
function rosterPlan(text,cls,students){
  const P={add:[],move:[],rename:[],same:[],errors:[],skipped:[],missing:[]};
  const bySid={};for(const s of students||[])bySid[s.sid]=s;
  const seen={};
  String(text||'').replace(/^﻿/,'').split(/\r?\n/).forEach((raw,k)=>{
    const line=raw.trim();const no=k+1;if(!line)return;
    const short=line.length>40?line.slice(0,40)+'…':line;
    const m=line.match(/(?:^|\D)(\d{5})(?!\d)/);
    if(!m){
      // 신청시간 같은 날짜(2026-09-16)는 지우고 본다. 날짜가 있는 줄의 4자리 학번 오타도 놓치지 않게.
      const nd=line.replace(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/g,' ');
      if(/(?:^|\D)\d{4}(?!\d)|(?:^|\D)\d{6,}/.test(nd)&&/[가-힣]{2}/.test(line))P.errors.push({line:no,text:short,msg:'학번은 숫자 5자리여야 합니다'});
      else P.skipped.push({line:no,text:short});
      return}
    const sid=m[1];const after=line.slice(m.index+m[0].length);
    const nm=after.match(/^[\s,\t|]*([가-힣]{2,10})(?![가-힣])/);
    if(!nm){P.errors.push({line:no,text:short,msg:'학번 뒤에 이름(한글 2~10자)이 없습니다'});return}
    if(seen[sid]){P.errors.push({line:no,text:short,msg:`학번 ${sid}이(가) ${seen[sid]}번째 줄에도 있습니다`});return}
    seen[sid]=no;
    const name=nm[1];const ex=bySid[sid];const row={line:no,sid,name};
    if(!ex)P.add.push(row);
    else if((ex.cls||'')!==cls)P.move.push({...row,uid:ex.uid,from:ex.cls||'',oldName:ex.name});
    else if(ex.name!==name)P.rename.push({...row,uid:ex.uid,oldName:ex.name});
    else P.same.push({...row,uid:ex.uid});
  });
  P.missing=(students||[]).filter(s=>(s.cls||'')===cls&&cls&&!seen[s.sid]);
  P.changes=P.add.length+P.move.length+P.rename.length;
  return P;
}

/* 반 숨기기: 화면에 보일 반 이름 목록. all=전체 반(만든 순서), hidden=숨긴 반 이름, show=숨긴 반도 보기 */
function visibleClasses(all,hidden,show){const h=new Set(hidden||[]);return (all||[]).filter(c=>show||!h.has(c))}
/* 학생 로그인 실패 코드 → 학생에게 보여 줄 말 */
/* until: 서버 student_login이 'locked'와 함께 주는 잠금 해제 시각(있으면 'HH:MM 뒤에'로 알려 준다. 잠금 시간을 바꿔도 맞게) */
function loginErrorMsg(code,until){
  const u=until?new Date(until):null;
  if(code==='locked'&&u&&!isNaN(u))return `여러 번 틀려서 잠겼습니다. ${String(u.getHours()).padStart(2,'0')}:${String(u.getMinutes()).padStart(2,'0')} 뒤에 다시 시도해 주세요. 급하면 선생님께 잠금을 풀어 달라고 하세요.`;
  return {locked:'여러 번 틀려서 10분 동안 잠겼습니다. 잠시 뒤 다시 시도해 주세요. 급하면 선생님께 잠금을 풀어 달라고 하세요.',
    class_hidden:'수업이 끝난 반이라 로그인할 수 없습니다. 선생님께 문의하세요.'}[code]
    ||'학번 또는 비밀번호가 맞지 않습니다. 비밀번호를 잊었으면 선생님께 초기화를 부탁하세요.';
}

/* 시험 순서(교사 화면 전체): 시행일 → 제목(숫자는 숫자로: 2차시 < 10차시) → 만든 시각 */
function testOrder(a,b){
  return (a.date||'').localeCompare(b.date||'')
    ||(a.title||'').localeCompare(b.title||'','ko',{numeric:true})
    ||(a.created||'').localeCompare(b.created||'');
}

/* 설명할 문항 순서(정답·해설 공개 전 설명 수업용). 학생 이름 없이 숫자만 돌려준다.
   items: 시험 문항 [{no,area,type,el}], key: 정답(문자열 또는 배열),
   submissions: 처음 답안 목록(문자열 또는 {a}/{answers}), retries: 다시 풀기 답 목록(문자열 또는 {answers}; 다시 안 푼 문항은 '-').
   틀린 학생이 있는 문항만, '다시 풀어도 또 틀린 수(개념형)' 많은 순 → 처음 오답률 높은 순 → 문항 순서.
   다시 풀 때 비워 둔 답('0')은 개념형(again)도, 다시 푼 것(retried)도 아니다: notRetried(안 다시 품)에 들어가고 retryBlank로 따로 센다. */
function explainPriority(items,key,submissions,retries){
  const str=x=>typeof x==='string'?x:(x&&(x.a??x.answers))||'';
  const subs=(submissions||[]).map(str).filter(Boolean),rts=(retries||[]).map(str).filter(Boolean);
  const out=[];
  (items||[]).forEach((it,i)=>{
    const k=String(key?.[i]??'');if(!/^[1-5]$/.test(k)||(it&&it.el))return;
    let n=0,wrong=0;const pick=[0,0,0,0,0,0];
    for(const a of subs){n++;const c=a[i]||'0';if(c!==k){wrong++;if(/[1-5]/.test(c))pick[+c]++}}
    if(!wrong)return;
    let retried=0,fixed=0,retryBlank=0;
    for(const r of rts){const c=r[i];if(c==null||c==='-')continue;if(!/[1-5]/.test(c)){retryBlank++;continue}retried++;if(c===k)fixed++}
    let opt=0;for(let o=1;o<=5;o++)if(pick[o]>pick[opt])opt=o;
    out.push({i,no:it?.no??String(i+1),area:it?.area||'',type:it?.type||'',n,wrong,wrongRate:n?wrong/n:0,
      retried,fixed,again:retried-fixed,notRetried:Math.max(0,wrong-retried),retryBlank,
      topWrong:opt?{opt,count:pick[opt],share:pick[opt]/n}:null});
  });
  return out.sort((a,b)=>b.again-a.again||b.wrongRate-a.wrongRate||a.i-b.i);
}

/* 그래프 가로축 이름: 제목의 'N차시'만(예: '근본국어 3차시 · 독서(사회)' → '3차시'). 차시가 없으면 짧게 줄인 제목. */
function sessionLabel(title,max=9){
  const s=String(title??'').trim();const m=s.match(/(\d+)\s*차시/);if(m)return (+m[1])+'차시';
  return s.length>max?s.slice(0,max)+'…':s;
}

/* 변별도(상위 27% 정답률 − 하위 27% 정답률): 응시 인원이 이 수보다 적으면 계산하지 않는다(몇 명의 실수로 크게 흔들려 참고하기 어렵다). */
const DISC_MIN_N=15;
/* 변별도용 순위: 점수 비율 높은 순 → 원점수 높은 순 → 이름(학번이 앞에 붙음) 순. 같은 점수끼리도 늘 같은 순서가 되게 한다. */
function discRank(graded){
  const nm=x=>String(x.name??'');
  return [...(graded||[])].sort((a,b)=>(b.pct-a.pct)||((b.score||0)-(a.score||0))||(nm(a)<nm(b)?-1:nm(a)>nm(b)?1:0));
}
/* 문항별 변별도 [수|null] (길이 n). graded [{pct,score,name,res:{문항자리:맞음?}}]. 응시 DISC_MIN_N명 미만이면 모두 null. */
function itemDisc(graded,n){
  const out=Array.from({length:n||0},()=>null);const L=graded||[];
  if(L.length<DISC_MIN_N)return out;
  const s=discRank(L);const k=Math.max(1,Math.round(s.length*.27));const up=s.slice(0,k),lo=s.slice(-k);
  const rate=(g,i)=>{const a=g.filter(x=>x.res&&x.res[i]!==undefined);return a.length?a.filter(x=>x.res[i]).length/a.length:null};
  for(let i=0;i<out.length;i++){const ru=rate(up,i),rl=rate(lo,i);out[i]=ru!=null&&rl!=null?ru-rl:null}
  return out;
}

if(typeof module!=='undefined'&&module.exports)module.exports={sessionLabel,testOrder,visibleClasses,loginErrorMsg,rosterPlan,parseNat,parseEx,parseRanges,pwProblem,PW_MIN,EX_MAX,explainPriority,DISC_MIN_N,discRank,itemDisc};

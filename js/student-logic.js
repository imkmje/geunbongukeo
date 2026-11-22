"use strict";
/* 근본국어 학생 화면에서만 쓰는 순수 함수(화면 없음). tests/student-logic.test.js가 함께 쓴다.
   - score100: 원점수를 100점 환산(반올림)
   - blankList · blankNos · blankSentence: 빈 문항 번호 목록과 확인 문장
   - noRange: 문항 번호를 '2~5번'처럼 줄여 쓰기
   - classStats: 서버가 준 반 통계를 화면용으로 고르기(응시 인원이 적으면 서버가 null을 준다)
   - studentTestSort: 학생 시험 목록 순서
   - rpcErrorKind: 학생 함수 오류를 종류별로 나누기 */

/* 원점수 → 100점 환산 점수(정수, 반올림). 만점이 없으면 null */
function score100(score,max){
  const s=Number(score),m=Number(max);
  if(!m||!isFinite(s)||!isFinite(m))return null;
  return Math.round(s*100/m);
}
/* 비율(0~1) → 100점 환산 점수(정수). 없으면 null */
function pct100(p){return p==null||!isFinite(p)?null:Math.round(p*100)}
/* 원점수 한 자리 소수(반 평균 원점수용): 16 → '16', 16.25 → '16.3' */
function oneDec(v){if(v==null||!isFinite(v))return '–';const r=Math.round(v*10)/10;return String(r)}

/* 빈 문항: idx(채점하는 문항 자리 목록) 중 답이 '0'이거나 없는 자리 → [{i,no}] */
function blankList(items,answers,idx){
  const a=String(answers||'');
  const list=idx||(items||[]).map((_,i)=>i);
  return list.filter(i=>!/[1-5]/.test(a[i]||'')).map(i=>({i,no:String(items?.[i]?.no??(i+1))}));
}
/* '7번, 9번' (max개를 넘으면 '… 외 N문항'). fmt로 번호 하나를 다르게 쓸 수 있다(화면에서는 누르는 단추) */
function blankNos(list,max=10,fmt=x=>x.no+'번'){
  const n=(list||[]).length;if(!n)return '';
  const shown=list.slice(0,max).map(fmt).join(', ');
  return n>max?`${shown} 외 ${n-max}문항`:shown;
}
/* 제출 확인 문장: '7번, 9번이 비어 있습니다. 그대로 낼까요?' */
function blankSentence(list,max=10,fmt){
  if(!(list||[]).length)return '그대로 낼까요?';
  return `${blankNos(list,max,fmt)}이 비어 있습니다. 그대로 낼까요?`;
}
/* 문항 번호 줄여 쓰기: ['2','3','4','5','8'] → '2~5, 8번' */
function noRange(nos){
  const ns=(nos||[]).map(String);if(!ns.length)return '';
  const out=[];let a=0;
  for(let k=1;k<=ns.length;k++){
    const cont=k<ns.length&&/^\d+$/.test(ns[k])&&/^\d+$/.test(ns[k-1])&&+ns[k]===+ns[k-1]+1;
    if(!cont){out.push(k-1>a?`${ns[a]}~${ns[k-1]}`:ns[a]);a=k}
  }
  return out.join(', ')+'번';
}


/* 반 통계: 응시 인원이 적으면(5명 미만) 서버가 stats 전체나 avgPct·ir·dist 같은 칸을 null로 준다.
   NaN·undefined가 화면에 새지 않게 숫자가 아닌 값은 null로 바꾸고, 반 평균이 없으면 반 통계 전체를 숨긴다(hidden).
   (반 평균을 가리면서 문항별 반 정답률만 보여 주면 이상하고, 적은 인원에서는 그것도 개인 정보가 되므로) */
const CLS_HIDDEN_MSG='응시 인원이 적어 반 평균을 보여 드리지 않습니다.';
const finOrNull=v=>typeof v==='number'&&isFinite(v)?v:null;
function classStats(stats){
  const s=stats&&typeof stats==='object'?stats:{};
  const avgPct=finOrNull(s.avgPct);const n=finOrNull(s.n)||0;
  if(avgPct==null||s.hidden===true)return {n,avgPct:null,ir:[],dist:[],area:{},type:{},hidden:true};
  const obj=o=>{const out={};if(o&&typeof o==='object')for(const k of Object.keys(o)){const v=finOrNull(o[k]);if(v!=null)out[k]=v}return out};
  return {n,avgPct,
    ir:Array.isArray(s.ir)?s.ir.map(finOrNull):[],
    dist:Array.isArray(s.dist)?s.dist.map(d=>Array.isArray(d)?d.map(finOrNull):null):[],
    area:obj(s.area),type:obj(s.type),hidden:false};
}

/* 학생 시험 목록 순서: 지금 할 일이 있는 시험(응시 중 → 틀린 문항 다시 풀기 남음)을 맨 위에,
   나머지는 교사 화면과 같은 순서(시행일 → 제목의 차시 번호를 숫자로: 2차시 < 10차시). 원래 배열은 바꾸지 않는다. */
function studentTestSort(tests){
  const ord=typeof testOrder==='function'?testOrder:require('./logic.js').testOrder;
  const rank=t=>t.is_open?0:t.retry_due?1:2;
  const key=t=>({date:t.test_date||'',title:t.title||'',created:t.created_at||''});
  return (tests||[]).map((t,i)=>({t,i})).sort((a,b)=>rank(a.t)-rank(b.t)||ord(key(a.t),key(b.t))||a.i-b.i).map(x=>x.t);
}

/* 학생 함수(rpc) 오류 → 'session'(로그인이 끊김·토큰이 망가짐) | 'class_hidden' | 'must_change' | null(그 밖의 오류).
   토큰이 uuid 모양이 아니면 서버는 invalid_session 대신 '22P02 invalid input syntax for type uuid'를 돌려준다. */
function rpcErrorKind(err){
  if(!err)return null;
  const m=String(err.message||'')+' '+String(err.details||'');
  if(/class_hidden/.test(m))return 'class_hidden';
  if(/must_change_password/.test(m))return 'must_change';
  if(/invalid_session/.test(m)||err.code==='22P02'||/invalid input syntax for type uuid/i.test(m))return 'session';
  return null;
}

if(typeof module!=='undefined'&&module.exports)module.exports={score100,pct100,oneDec,blankList,blankNos,blankSentence,noRange,CLS_HIDDEN_MSG,classStats,studentTestSort,rpcErrorKind};

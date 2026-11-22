"use strict";
/* 근본국어 학생 화면에서만 쓰는 순수 함수(화면 없음). tests/student-logic.test.js가 함께 쓴다.
   - score100: 원점수를 100점 환산(반올림)
   - blankList · blankNos · blankSentence: 빈 문항 번호 목록과 확인 문장
   - noRange: 문항 번호를 '2~5번'처럼 줄여 쓰기 */

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

if(typeof module!=='undefined'&&module.exports)module.exports={score100,pct100,oneDec,blankList,blankNos,blankSentence,noRange};

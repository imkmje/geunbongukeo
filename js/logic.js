"use strict";
/* 근본국어: 화면(DOM) 없이 돌아가는 순수 함수. 교사·학생 화면과 tests/가 함께 쓴다.
   - parseNat: '사이트등록_통계' 파일(# 정답·# 배점 3점 문항·# 영역·# 세트 줄 + 전국 정답률 줄)
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
  for(const raw of lines){const h=raw.trim().match(/^[#＃]\s*(정답|배점\s*3\s*점(?:\s*문항)?|3\s*점\s*문항|영역|세트)\s*[:：]\s*(.*)$/);if(!h)continue;
    const k=h[1].startsWith('정답')?'정답':h[1].startsWith('영역')?'영역':h[1].startsWith('세트')?'세트':'3점';if(!(k in H))H[k]=h[2]}
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
  for(const [k,f,lab] of [['영역','area','영역'],['세트','set','세트']]){if(H[k]==null)continue;let c=0;
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

if(typeof module!=='undefined'&&module.exports)module.exports={parseNat,parseEx,parseRanges,pwProblem,PW_MIN,EX_MAX};

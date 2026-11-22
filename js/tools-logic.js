"use strict";
/* 근본국어 교사 도구(실시간 현황·내보내기·익명화·파일로 시험 만들기)의 순수 함수. 화면(DOM) 없이 돌아가며 tests/tools.test.js가 확인한다.
   브라우저에서는 logic.js 다음에 불러온다(parseNat·parseEx를 그대로 쓴다). */
const TL_LOGIC=(typeof parseNat==='function')?{parseNat,parseEx}:require('./logic.js');

/* ---------- 채점 (core.js의 grade와 같은 규칙: 정답이 비어 있거나 '0'이면 오답, 선택과목이 다르면 제외) ---------- */
function tlApplicable(items,el){return items.map((it,i)=>(!it.el||it.el===el)?i:-1).filter(i=>i>=0)}
function tlGrade(items,key,a,el){
  let score=0,max=0;const res={};const ans=String(a||'');
  for(const i of tlApplicable(items,el||'')){const p=+items[i].pts||2;max+=p;const k=key[i];const ok=!!k&&k!=='0'&&ans[i]===k;res[i]=ok;if(ok)score+=p}
  return {score,max,res};
}

/* ---------- CSV ---------- */
/* 엑셀에서 수식으로 읽히지 않게 =,+,-,@로 시작하는 글자에는 ' 를 붙인다(숫자는 그대로). */
function csvCell(v){
  if(v==null)return '';
  if(typeof v==='number')return Number.isFinite(v)?String(v):'';
  let s=String(v);
  if(/^[=+\-@\t\r]/.test(s)&&!/^-?\d+(\.\d+)?$/.test(s))s="'"+s;
  return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function toCsv(rows){return rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n'}
const CSV_BOM='﻿';// 엑셀이 한글을 UTF-8로 읽게 하는 표시
function safeFileName(s){return String(s||'').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,80)||'자료'}

const ansCell=d=>d&&d!=='0'?+d:'';
const fmtAt=ms=>{if(!ms)return '';const d=new Date(ms);const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`};
const SRC_LABEL={student:'학생 직접',teacher:'교사 입력'};

/* (가) 한 시험 × 한 반: 학생마다 한 줄. 아직 안 낸 학생도 넣는다(점수 칸 비움).
   test {title,items}, key ['1'..'5'|'0'], students [{sid,name,cls}], subs {sid:{a,el,at,src}} */
function testCsvRows(test,key,students,subs){
  const items=test.items||[];
  const head=['학번','이름','반','제출','제출 시각','점수','만점',...items.map(it=>`${it.el?it.el+' ':''}${it.no}번 답`),...items.map(it=>`${it.el?it.el+' ':''}${it.no}번 정답 여부`)];
  const rows=[head];
  const keyRow=['','(정답)','','','','','',...items.map((_,i)=>ansCell(key[i])),...items.map(()=>'')];
  for(const s of [...students].sort((a,b)=>a.sid.localeCompare(b.sid))){
    const r=subs[s.sid];
    if(!r){rows.push([s.sid,s.name,s.cls||'','미제출','','',tlGrade(items,key,'','').max,...items.map(()=>''),...items.map(()=>'')]);continue}
    const g=tlGrade(items,key,r.a,r.el);
    rows.push([s.sid,s.name,s.cls||'',SRC_LABEL[r.src]||'제출',fmtAt(r.at),g.score,g.max,
      ...items.map((_,i)=>i in g.res?ansCell(r.a[i]):''),
      ...items.map((_,i)=>i in g.res?(g.res[i]?'O':'X'):'')]);
  }
  rows.splice(1,0,keyRow);
  return rows;
}

/* (나) 한 반 누적: 학생 × 회차 점수 + 응시 횟수 + 평균(100점 환산). 맨 아래에 회차별 반 평균.
   tests [{id,title,items,key}] (보여 줄 순서대로), subsByTest {testId:{sid:{a,el}}} */
function classCumRows(tests,students,subsByTest){
  const used=tests.filter(t=>students.some(s=>subsByTest[t.id]?.[s.sid]));
  const head=['학번','이름',...used.map(t=>`${t.title} (만점 ${tlGrade(t.items,t.key,'','').max})`),'응시 횟수','평균 (100점 환산)'];
  const rows=[head];const colSum=used.map(()=>({s:0,n:0}));
  for(const s of [...students].sort((a,b)=>a.sid.localeCompare(b.sid))){
    let pSum=0,n=0;
    const cells=used.map((t,k)=>{const r=subsByTest[t.id]?.[s.sid];if(!r)return '';const g=tlGrade(t.items,t.key,r.a,r.el);if(g.max){pSum+=g.score/g.max;n++}colSum[k].s+=g.score;colSum[k].n++;return g.score});
    rows.push([s.sid,s.name,...cells,n,n?Math.round(pSum/n*1000)/10:'']);
  }
  rows.push(['','반 평균',...colSum.map(c=>c.n?Math.round(c.s/c.n*10)/10:''),'','']);
  return rows;
}

/* (다) 한 반의 모든 답안을 한 표로(익명화 전에 받아 두는 기록): 학생 × 회차마다 한 줄, 문항 칸은 가장 긴 시험에 맞춘다. */
function classAnswerRows(tests,students,subsByTest){
  const width=Math.max(0,...tests.map(t=>t.items.length));
  const rows=[['학번','이름','시험','제출','제출 시각','점수','만점','틀린 문항',...Array.from({length:width},(_,i)=>`${i+1}째 문항 답`)]];
  for(const s of [...students].sort((a,b)=>a.sid.localeCompare(b.sid)))for(const t of tests){
    const r=subsByTest[t.id]?.[s.sid];if(!r)continue;const g=tlGrade(t.items,t.key,r.a,r.el);
    const wrong=Object.keys(g.res).filter(i=>!g.res[i]).map(i=>t.items[i].no).join(' ');
    rows.push([s.sid,s.name,t.title,SRC_LABEL[r.src]||'제출',fmtAt(r.at),g.score,g.max,wrong,...Array.from({length:width},(_,i)=>i<t.items.length&&i in g.res?ansCell(r.a[i]):'')]);
  }
  return rows;
}

/* ---------- 익명화 계획 (supabase/schema.sql의 teacher_anonymize_class와 같은 규칙) ----------
   - 이름: 반 안에서 학번 순서대로 '학생01', '학생02'… (학생이 100명 이상이면 세 자리)
   - 학번: 9로 시작하는 5자리 번호(90001부터, 이미 쓰인 9xxxx 다음 번호). 고등학교 학번은 9로 시작하지 않으므로
     내년에 같은 학번을 받은 새 학생과 섞이지 않는다.
   - 이미 익명화된 학생(학번 9xxxx이고 이름이 '학생NN')은 그대로 두고, 새로 붙는 번호는 그 뒤부터.
   classStudents [{uid,sid,name}], allSids: 전체 학생 학번 */
const ANON_NAME=/^학생[0-9]+$/,ANON_SID=/^9[0-9]{4}$/;
const isAnon=s=>ANON_SID.test(s.sid)&&ANON_NAME.test(s.name);
function anonPlan(classStudents,allSids){
  const list=[...classStudents].sort((a,b)=>a.sid.localeCompare(b.sid));
  const done=list.filter(isAnon),todo=list.filter(s=>!isAnon(s));
  const width=Math.max(2,String(list.length).length);
  let next=Math.max(90000,...(allSids||[]).filter(x=>ANON_SID.test(x)).map(Number));
  return todo.map((s,k)=>{next++;if(next>99999)throw new Error('anon_sid_full');return {uid:s.uid,sid:s.sid,name:s.name,newSid:String(next),label:'학생'+String(done.length+k+1).padStart(width,'0')}});
}

/* ---------- 실시간 해설 화면: 문항별 오답률·가장 많이 고른 오답, 세트별 요약 (학생 이름 없음) ----------
   recs [{a,el}] */
function liveBoard(test,key,recs){
  const items=(test.items||[]).map((it,i)=>({i,no:it.no,set:it.set||'',area:it.area||'',ans:key[i]&&key[i]!=='0'?key[i]:'',n:0,wrong:0,cnt:[0,0,0,0,0,0]}));
  for(const r of recs)for(const i of tlApplicable(test.items,r.el||'')){const ch=+(String(r.a||'')[i]||0)||0;const x=items[i];x.n++;x.cnt[ch]++;if(!x.ans||String(ch)!==x.ans)x.wrong++}
  for(const x of items){
    x.wrongRate=x.n&&x.ans?x.wrong/x.n:null;
    let best=0,opt=0;for(let o=1;o<=5;o++)if(String(o)!==x.ans&&x.cnt[o]>best){best=x.cnt[o];opt=o}
    x.top=x.ans&&opt?{opt,share:best/x.n}:null;x.blank=x.n?x.cnt[0]/x.n:0;
  }
  const sm={};for(const x of items){if(!x.set||x.wrongRate==null)continue;const s=sm[x.set]=sm[x.set]||{name:x.set,nos:[],sum:0,k:0};s.nos.push(x.no);s.sum+=x.wrongRate;s.k++}
  const sets=Object.values(sm).map(s=>({name:s.name,nos:s.nos,wrongRate:s.sum/s.k}));
  const scored=items.filter(x=>x.wrongRate!=null);
  return {n:recs.length,items,sets,avgWrong:scored.length?scored.reduce((a,x)=>a+x.wrongRate,0)/scored.length:null};
}
function sortBoard(items,by){const a=[...items];if(by==='wrong')a.sort((x,y)=>(y.wrongRate??-1)-(x.wrongRate??-1)||x.i-y.i);else a.sort((x,y)=>x.i-y.i);return a}

/* ---------- 파일로 시험 만들기 ---------- */
/* 파일 이름 목록 → 차시 번호로 짝짓기. 'NN차시_사이트등록_통계.txt' / 'NN차시_사이트등록_해설.txt' */
function pairSessionFiles(names){
  const by={};const other=[],dup=[];
  for(const nm of names){
    const m=String(nm).match(/(\d{1,3})\s*차시[^\\/]*?(통계|해설)[^\\/]*\.txt$/i);
    if(!m){other.push(nm);continue}
    const n=parseInt(m[1],10);const k=m[2]==='통계'?'stat':'ex';
    const p=by[n]=by[n]||{n,stat:null,ex:null};
    if(p[k]){dup.push(nm);continue}
    p[k]=nm;
  }
  return {pairs:Object.values(by).sort((a,b)=>a.n-b.n),other,dup};
}
/* 시험 제목: "근본국어 N차시 · 독서(사회) · 문학(고전소설) · 문법"
   영역별로 그 영역 세트 이름의 첫 낱말(갈래)을 괄호에 넣는다. 독서 → 문학 → 그 밖의 영역 순서, 언어 영역은 맨 뒤에 '문법'. */
function sessionTitle(n,items){
  const order=['독서','문학','화법','작문','매체','기타'];const parts=[];
  const areas=[...new Set((items||[]).map(it=>it.area).filter(Boolean))];
  const rank=a=>a==='언어'?99:(order.indexOf(a)<0?50:order.indexOf(a));
  for(const a of areas.sort((x,y)=>rank(x)-rank(y))){
    if(a==='언어'){parts.push('문법');continue}
    const g=[...new Set(items.filter(it=>it.area===a&&it.set).map(it=>String(it.set).trim().split(/\s+/)[0]).filter(Boolean))];
    parts.push(g.length?`${a}(${g.join('·')})`:a);
  }
  return [`근본국어 ${n}차시`,...parts].join(' · ');
}
/* 한 차시 파일 한 쌍 → 저장할 시험 내용과 경고. 편집기의 '새 시험 만들기'와 같은 45문항 틀에서 시작해 parseNat·parseEx를 그대로 쓴다. */
function sessionEntry(n,statText,exText){
  const items=[];for(let i=1;i<=45;i++)items.push({no:String(i),area:i<=17?'독서':i<=34?'문학':'기타',type:'',pts:2,el:''});
  const E={items,key:Array(45).fill('0'),nat:[],ex:[],tags:[]};const warn=[];
  if(statText==null)warn.push('통계 파일 없음');
  if(exText==null)warn.push('해설 파일 없음');
  let nat={ok:0,bad:[],meta:''},ex={n:0,mismatch:[],cut:[]};
  if(statText!=null){
    nat=TL_LOGIC.parseNat(E,statText);
    if(!/^\s*[#＃]\s*정답\s*[:：]/m.test(statText))warn.push('# 정답: 줄이 없음');
    if(nat.bad.length)warn.push(`읽지 못한 줄 ${nat.bad.length}개`);
  }
  if(statText==null&&exText!=null){const m=String(exText).match(/^\s*\[\s*(\d{1,2})\s*\]/gm);const k=m?Math.max(...m.map(x=>+x.replace(/\D/g,''))):0;if(k){E.items=E.items.slice(0,k);E.key=E.key.slice(0,k)}}
  if(exText!=null){ex=TL_LOGIC.parseEx(E,exText);
    if(ex.mismatch.length)warn.push(`해설의 정답이 다른 문항: ${ex.mismatch.join(', ')}번`);
    if(ex.cut.length)warn.push(`해설이 너무 길어 자른 문항: ${ex.cut.join(', ')}번`);
    if(ex.n<E.items.length)warn.push(`해설 없는 문항 ${E.items.length-ex.n}개`)}
  const blank=E.key.filter(k=>!k||k==='0').length;if(blank)warn.push(`정답 빈 문항 ${blank}개`);
  const items2=E.items.map(it=>({no:String(it.no),area:it.area||'기타',type:(it.type||'').trim(),pts:+it.pts||2,set:(it.set||'').trim()}));
  return {n,title:sessionTitle(n,items2),items:items2,key:E.key.join(''),
    nat:E.nat.some(Boolean)?items2.map((_,i)=>E.nat[i]||null):null,
    ex:E.ex.some(Boolean)?items2.map((_,i)=>E.ex[i]||null):null,
    natN:E.nat.filter(Boolean).length,typeN:items2.filter(it=>it.type).length,exN:E.ex.filter(Boolean).length,
    pts3:items2.filter(it=>it.pts===3).map(it=>it.no),warn};
}

if(typeof module!=='undefined'&&module.exports)module.exports={tlGrade,csvCell,toCsv,CSV_BOM,safeFileName,testCsvRows,classCumRows,classAnswerRows,anonPlan,isAnon,liveBoard,sortBoard,pairSessionFiles,sessionTitle,sessionEntry};

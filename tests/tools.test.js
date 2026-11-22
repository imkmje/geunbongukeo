// 실행: node --test tests/
// 교사 도구(실시간 현황·내보내기·익명화·파일로 시험 만들기)의 순수 함수. 학생 이름은 모두 가상의 예시다.
// 실제 차시 파일은 GB_SAMPLES 폴더(기본: 저장소 옆 ../winter-edit)가 있을 때만 읽고, 없으면 그 부분만 건너뛴다.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const T=require('../js/tools-logic.js');

const items=[{no:'1',area:'언어',pts:2},{no:'2',area:'독서',pts:3,set:'사회 가상 지문'},{no:'3',area:'독서',pts:2,set:'사회 가상 지문'},{no:'4',area:'문학',pts:2,set:'현대시 가상 작품'}];
const key='3152'.split('');

test('CSV 칸: 쉼표·따옴표·줄바꿈을 감싸고, 수식처럼 보이는 글자는 막는다',()=>{
  assert.equal(T.csvCell('가,나'),'"가,나"');
  assert.equal(T.csvCell('말 "따옴표"'),'"말 ""따옴표"""');
  assert.equal(T.csvCell('한 줄\n두 줄'),'"한 줄\n두 줄"');
  assert.equal(T.csvCell('=SUM(A1)'),"'=SUM(A1)");
  assert.equal(T.csvCell('@x'),"'@x");
  assert.equal(T.csvCell('-3'),'-3','음수 숫자 글자는 그대로');
  assert.equal(T.csvCell(12),'12');assert.equal(T.csvCell(null),'');assert.equal(T.csvCell(NaN),'');
  assert.equal(T.toCsv([['a','b'],[1,'']]),'a,b\r\n1,\r\n');
  assert.equal(T.CSV_BOM.charCodeAt(0),0xFEFF);
  assert.equal(T.safeFileName('근본국어 1차시 · 독서/문학: "A"'),'근본국어 1차시 · 독서 문학 A');
});

test('채점: 정답 빈 칸은 오답, 배점 반영',()=>{
  const g=T.tlGrade(items,key,'3150','');
  assert.equal(g.score,2+3+2);assert.equal(g.max,9);assert.deepEqual(g.res,{0:true,1:true,2:true,3:false});
  assert.equal(T.tlGrade(items,['3','0','5','2'],'3152','').score,6,'정답이 0인 문항은 맞힌 것으로 치지 않는다');
});

test('시험 × 반 CSV: 정답 줄, 미제출 학생, 문항별 답·정답 여부',()=>{
  const studs=[{sid:'10102',name:'이예시',cls:'가반'},{sid:'10101',name:'김예시',cls:'가반'}];
  const rows=T.testCsvRows({title:'예시',items},key,studs,{'10101':{a:'3110',at:Date.UTC(2026,10,1,1,2),src:'student'}});
  assert.deepEqual(rows[0].slice(0,7),['학번','이름','반','제출','제출 시각','점수','만점']);
  assert.equal(rows[0][7],'1번 답');assert.equal(rows[0][11],'1번 정답 여부');assert.equal(rows[0].length,7+8);
  assert.deepEqual(rows[1].slice(7,11),[3,1,5,2],'정답 줄');
  assert.deepEqual(rows[2].slice(0,4),['10101','김예시','가반','학생 직접'],'학번 순서');
  assert.deepEqual(rows[2].slice(5),[5,9,3,1,1,'','O','O','X','X'],'점수·만점·답(무응답은 빈 칸)·정답 여부');
  assert.deepEqual(rows[3].slice(0,7),['10102','이예시','가반','미제출','','',9]);
  const csv=T.toCsv(rows);assert.ok(!/code_hash|token/.test(csv));
});

test('반 누적 CSV: 학생 × 회차 점수, 응시 횟수, 100점 환산 평균, 반 평균 줄',()=>{
  const tA={id:'a',title:'1차시',items,key},tB={id:'b',title:'2차시',items:items.slice(0,2),key:['3','1']},tC={id:'c',title:'아무도 안 본 회차',items,key};
  const studs=[{sid:'10101',name:'김예시'},{sid:'10102',name:'이예시'}];
  const rows=T.classCumRows([tA,tB,tC],studs,{a:{'10101':{a:'3152'},'10102':{a:'0000'}},b:{'10101':{a:'31'}}});
  assert.deepEqual(rows[0],['학번','이름','1차시 (만점 9)','2차시 (만점 5)','응시 횟수','평균 (100점 환산)'],'아무도 안 본 회차는 뺀다');
  assert.deepEqual(rows[1],['10101','김예시',9,5,2,100]);
  assert.deepEqual(rows[2],['10102','이예시',0,'',1,0]);
  assert.deepEqual(rows[3],['','반 평균',4.5,5,'','']);
});

test('반 전체 답안 표(익명화 전 기록)',()=>{
  const tA={id:'a',title:'1차시',items,key},tB={id:'b',title:'2차시',items:items.slice(0,2),key:['3','1']};
  const rows=T.classAnswerRows([tA,tB],[{sid:'10101',name:'김예시'}],{a:{'10101':{a:'3110',src:'teacher'}},b:{'10101':{a:'31'}}});
  assert.equal(rows.length,3);assert.equal(rows[0].length,8+4);
  assert.deepEqual(rows[1].slice(0,8),['10101','김예시','1차시','교사 입력','',5,9,'3 4']);
  assert.deepEqual(rows[2].slice(8),[3,1,'',''],'짧은 시험은 남는 칸을 비운다');
});

test('익명화 계획: 학번 순서로 학생01…, 학번은 9로 시작하는 새 번호, 다시 하면 이어서',()=>{
  const cls=[{uid:'u3',sid:'10103',name:'박예시'},{uid:'u1',sid:'10101',name:'김예시'},{uid:'u2',sid:'10102',name:'이예시'}];
  const p=T.anonPlan(cls,['10101','10102','10103','20101']);
  assert.deepEqual(p.map(x=>[x.sid,x.label,x.newSid]),[['10101','학생01','90001'],['10102','학생02','90002'],['10103','학생03','90003']]);
  for(const x of p)assert.match(x.newSid,/^[0-9]{5}$/,'학번 규칙(숫자 5자리)을 지킨다');
  // 다른 반이 이미 익명화되어 90001~90003을 쓰고 있으면 그다음부터
  const p2=T.anonPlan([{uid:'x',sid:'20101',name:'최예시'}],['90001','90002','90003','20101']);
  assert.deepEqual([p2[0].newSid,p2[0].label],['90004','학생01']);
  // 이미 익명화된 학생은 건너뛰고, 새로 붙는 번호는 뒤에서부터
  const mixed=[{uid:'a',sid:'90001',name:'학생01'},{uid:'b',sid:'90002',name:'학생02'},{uid:'c',sid:'10109',name:'정예시'}];
  const p3=T.anonPlan(mixed,mixed.map(s=>s.sid));
  assert.deepEqual(p3.map(x=>[x.uid,x.label,x.newSid]),[['c','학생03','90003']]);
  assert.equal(T.anonPlan(mixed.slice(0,2),['90001','90002']).length,0,'모두 끝났으면 할 일 없음');
  // 100명 이상이면 세 자리 이름
  const big=Array.from({length:100},(_,i)=>({uid:'u'+i,sid:String(10000+i),name:'가상'}));
  assert.equal(T.anonPlan(big,big.map(s=>s.sid))[0].label,'학생001');
  assert.throws(()=>T.anonPlan([{uid:'z',sid:'10101',name:'가상'}],['99999']),/anon_sid_full/);
});

test('해설 화면: 오답률·가장 많이 고른 오답·세트 요약, 이름 없음',()=>{
  const recs=[{a:'3152',name:'김예시'},{a:'3452'},{a:'3402'},{a:'1150'}];
  const b=T.liveBoard({items},key,recs);
  assert.equal(b.n,4);
  const it2=b.items[1];
  assert.equal(it2.wrongRate,0.5);assert.deepEqual(it2.top,{opt:4,share:0.5});
  assert.equal(b.items[0].wrongRate,0.25);assert.deepEqual(b.items[0].top,{opt:1,share:0.25});
  const it4=b.items[3];assert.equal(it4.wrongRate,0.25);assert.equal(it4.blank,0.25,'무응답 비율');assert.equal(it4.top,null,'오답 선지를 고른 학생이 없으면 없음');
  assert.deepEqual(b.sets.map(s=>[s.name,s.nos.join(','),Math.round(s.wrongRate*1000)/1000]),[['사회 가상 지문','2,3',0.375],['현대시 가상 작품','4',0.25]]);
  assert.deepEqual(T.sortBoard(b.items,'wrong').map(x=>x.no),['2','1','3','4'],'오답률 높은 순, 같으면 번호 순');
  assert.ok(!JSON.stringify(b).includes('김예시'),'학생 이름이 들어가지 않는다');
  const nokey=T.liveBoard({items},['3','0','5','2'],recs);assert.equal(nokey.items[1].wrongRate,null,'정답이 없는 문항은 오답률 없음');
});

test('파일 짝짓기: 차시 번호로 묶고, 짝이 없거나 겹치는 파일을 알려 준다',()=>{
  const r=T.pairSessionFiles(['02차시_사이트등록_해설.txt','01차시_사이트등록_통계.txt','01차시_사이트등록_해설.txt','02차시_사이트등록_통계.txt','10차시_사이트등록_통계.txt','메모.txt','01차시_사이트등록_통계 (1).txt']);
  assert.deepEqual(r.pairs.map(p=>[p.n,!!p.stat,!!p.ex]),[[1,true,true],[2,true,true],[10,true,false]]);
  assert.deepEqual(r.other,['메모.txt']);assert.deepEqual(r.dup,['01차시_사이트등록_통계 (1).txt']);
});

test('시험 제목: 영역(갈래) 요약, 언어는 맨 뒤 문법',()=>{
  const it=(area,set)=>({area,set});
  assert.equal(T.sessionTitle(1,[it('독서','사회 가'),it('독서','사회 가'),it('문학','고전소설 나')]),'근본국어 1차시 · 독서(사회) · 문학(고전소설)');
  assert.equal(T.sessionTitle(3,[it('언어',''),it('독서','사회·인문 가'),it('문학','현대시 나')]),'근본국어 3차시 · 독서(사회·인문) · 문학(현대시) · 문법');
  assert.equal(T.sessionTitle(4,[it('문학',''),it('독서','')]),'근본국어 4차시 · 독서 · 문학','세트가 없으면 영역 이름만');
  assert.equal(T.sessionTitle(5,[]),'근본국어 5차시');
});

test('차시 한 쌍(합성) → 저장할 시험',()=>{
  const st=['# 근본국어 0차시 · 출처: 예시','# 정답: 31524','# 배점 3점 문항: 5','# 영역: 1 언어 / 2~3 독서 / 4~5 문학','# 세트: 2~3 과학 가상 지문 / 4~5 현대소설 가상 작품','# 유형: 1 음운 / 2~3 추론 / 4~5 내용 이해','3 58.5 10 58.5 11 10.5 10'].join('\n');
  const ex=['[1] 정답 ③','해설 예시','[2] 정답 ①','[3] 정답 ⑤','[4] 정답 ②','[5] 정답 ④'].join('\n');
  const e=T.sessionEntry(7,st,ex);
  assert.equal(e.title,'근본국어 7차시 · 독서(과학) · 문학(현대소설) · 문법');
  assert.equal(e.key,'31524');assert.equal(e.items.length,5);assert.deepEqual(e.pts3,['5']);
  assert.equal(e.natN,1);assert.equal(e.typeN,5);assert.equal(e.items[1].type,'추론');assert.equal(e.exN,5);assert.equal(e.nat.length,5);assert.equal(e.nat[0],null);
  assert.deepEqual(e.warn,[]);
  const noEx=T.sessionEntry(7,st,null);assert.ok(noEx.warn.includes('해설 파일 없음'));assert.equal(noEx.ex,null);
  const bad=T.sessionEntry(7,st,ex.replace('[2] 정답 ①','[2] 정답 ②'));assert.ok(bad.warn.some(w=>/해설의 정답이 다른 문항: 2번/.test(w)));
  const onlyEx=T.sessionEntry(8,null,ex);assert.equal(onlyEx.items.length,5);assert.ok(onlyEx.warn.includes('통계 파일 없음'));assert.ok(onlyEx.warn.some(w=>/정답 빈 문항 5개/.test(w)));
});

/* ---------- 실제 차시 파일 (있을 때만) ---------- */
const DIR=process.env.GB_SAMPLES||path.join(__dirname,'..','..','winter-edit');
const have=fs.existsSync(DIR)&&fs.readdirSync(DIR).some(f=>/차시_사이트등록_통계\.txt$/.test(f));
// 이미 등록해 둔 1~15차시 시험 제목(갈래 이름만 담긴 제목)
const WANT={1:'독서(사회) · 문학(고전소설)',2:'독서(사회) · 문학(현대소설) · 문법',3:'독서(사회·인문) · 문학(현대시) · 문법',4:'독서(인문) · 문학(현대소설)',5:'독서(사회) · 문학(고전소설) · 문법',6:'독서(인문) · 문학(현대시) · 문법',7:'독서(사회) · 문학(현대소설) · 문법',8:'독서(인문) · 문학(현대소설) · 문법',9:'독서(과학) · 문학(고전시가) · 문법',10:'독서(사회) · 문학(고전소설)',11:'독서(과학) · 문학(고전시가) · 문법',12:'독서(인문) · 문학(고전소설)',13:'독서(기술) · 문학(고전시가)',14:'독서(과학) · 문학(고전시가) · 문법',15:'독서(사회) · 문학(현대시) · 문법'};
test('실제 차시 파일: 15쌍 짝짓기, 제목이 등록된 제목과 같음, 경고 없음',{skip:have?false:'샘플 폴더 없음: '+DIR},()=>{
  const names=fs.readdirSync(DIR);
  const r=T.pairSessionFiles(names.filter(f=>/\.txt$/.test(f)));
  assert.equal(r.pairs.length,15);assert.deepEqual(r.dup,[]);
  for(const p of r.pairs){
    assert.ok(p.stat&&p.ex,p.n+'차시 짝');
    const e=T.sessionEntry(p.n,fs.readFileSync(path.join(DIR,p.stat),'utf8'),fs.readFileSync(path.join(DIR,p.ex),'utf8'));
    assert.equal(e.title,`근본국어 ${p.n}차시 · ${WANT[p.n]}`,p.n+'차시 제목');
    assert.deepEqual(e.warn,[],p.n+'차시 경고');
    assert.equal(e.exN,e.items.length);assert.match(e.key,/^[1-5]+$/);
    if(/^# 유형:/m.test(fs.readFileSync(path.join(DIR,p.stat),'utf8')))assert.equal(e.typeN,e.items.length,p.n+'차시 유형');
  }
});

/* ---------- 교사 화면 쓰기 편하게 (시험 칩·기본 시험·정답 미리 보기·그래프 축) ---------- */
test('해설 화면: 지문 세트가 없는 문항은 영역별로 따로 묶는다(언어(1번))',()=>{
  const b=T.liveBoard({items},key,[{a:'3152'},{a:'4152'}]);
  assert.deepEqual(b.loose.map(s=>[s.name,s.nos.join(','),s.wrongRate]),[['언어','1',0.5]]);
  assert.ok(!b.sets.some(s=>s.name==='언어'),'세트 목록에는 섞지 않는다');
});

test('시험 칩: 고른 반에서 열었거나 공개했거나 답안이 있는 시험만 위에, 나머지는 접는다',()=>{
  const ts=[{id:'a',openFor:[],releasedFor:['A반']},{id:'b',openFor:['B반'],releasedFor:[]},{id:'c',openFor:[],releasedFor:[]},{id:'d',openFor:[],releasedFor:[]}];
  const r=T.splitTestChips(ts,['A반'],t=>t.id==='d');
  assert.deepEqual(r.main.map(t=>t.id),['a','d']);assert.deepEqual(r.more.map(t=>t.id),['b','c'],'다른 반에만 열린 시험은 접힌다');
  const all=T.splitTestChips(ts,['A반','B반'],()=>false);
  assert.deepEqual(all.main.map(t=>t.id),['a','b']);assert.deepEqual(all.more.map(t=>t.id),['c','d']);
  assert.deepEqual(T.splitTestChips([],['A반']),{main:[],more:[]});
});

test('기본 시험: 응시 중 → 최근 공개·제출 → 목록 마지막',()=>{
  const r=(id,o={})=>({id,open:false,relAt:0,lastAt:0,...o});
  assert.equal(T.pickDefaultTest([r('1차',{relAt:100}),r('2차',{open:true}),r('3차')]),'2차','응시 중인 시험이 먼저');
  assert.equal(T.pickDefaultTest([r('1차',{relAt:300}),r('2차',{lastAt:200}),r('15차')]),'1차','준비 중인 마지막 시험이 아니라 가장 최근 활동');
  assert.equal(T.pickDefaultTest([r('1차',{relAt:100}),r('2차',{relAt:50,lastAt:400})]),'2차','답안이 늦게 들어온 시험');
  assert.equal(T.pickDefaultTest([r('1차',{open:true,lastAt:500}),r('2차',{open:true,lastAt:100})]),'1차','둘 다 응시 중이면 최근 제출');
  assert.equal(T.pickDefaultTest([r('1차'),r('2차')]),'2차','활동이 없으면 목록 마지막');
  assert.equal(T.pickDefaultTest([]),null);
});

test('정답 미리 보기: 5개씩 띄어 쓰고, 풀어 쓴 글은 번호와 함께',()=>{
  assert.equal(T.groupKey('5254234515'),'52542 34515');
  assert.equal(T.groupKey('525423'),'52542 3');assert.equal(T.groupKey(''),'');
  assert.equal(T.keyTip('520'),'1번 5, 2번 2, 3번 ?');
  assert.equal(T.keyTip('52',[{no:'11'},{no:'12'}]),'11번 5, 12번 2');
});

test('그래프 가로축: 제목에서 N차시만',()=>{
  const {sessionLabel}=require('../js/logic.js');
  assert.equal(sessionLabel('근본국어 3차시 · 독서(사회) · 문학(현대시) · 문법'),'3차시');
  assert.equal(sessionLabel('근본국어 03 차시'),'3차시');
  assert.equal(sessionLabel('6월 학력평가 (예시)'),'6월 학력평가 (…');
  assert.equal(sessionLabel('짧은 제목'),'짧은 제목');assert.equal(sessionLabel(null),'');
});

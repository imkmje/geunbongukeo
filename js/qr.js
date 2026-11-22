"use strict";
/* 근본국어 교사 화면: 학생 접속 QR. 프로젝터에 띄워 학생이 휴대폰 카메라로 찍으면 학생 화면(index.html)이 열린다.
   QR은 사이트 안의 js/vendor/qrcode-generator-1.4.4.js(MIT)로 그린다. 바깥 서버에 주소를 보내지 않는다. */

/* 학생 화면 주소: 교사 화면과 같은 폴더의 첫 화면. 예) https://아이디.github.io/geunbongukeo/ */
function studentUrl(href){
  const u=new URL('./',href||location.href);u.hash='';u.search='';return u.href;
}
/* QR을 SVG 문자열로. 칸마다 사각형 대신 path 하나로 그려 크게 키워도 선명하다. */
function qrSvg(text,label){
  const q=qrcode(0,'M');q.addData(text,'Byte');q.make();
  const n=q.getModuleCount(),m=4,size=n+m*2;let d='';
  for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))d+=`M${c+m} ${r+m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${label||'QR 코드'}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
function openQr(){
  const url=studentUrl();
  let el=document.getElementById('qrOverlay');if(el)el.remove();
  el=document.createElement('div');el.id='qrOverlay';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','학생 접속 QR');
  el.innerHTML=`<div class="qr-box">
    <h2>휴대폰 카메라로 찍어 접속하세요</h2>
    <div class="qr-code">${qrSvg(url,'학생 화면 주소 QR 코드')}</div>
    <p class="qr-url">${url.replace(/^https?:\/\//,'').replace(/\/$/,'')}</p>
    <p class="qr-sub">학번과 비밀번호로 로그인합니다. 처음 비밀번호는 학번입니다.</p>
    <div class="qr-btns"><button class="btn" type="button" data-qr="copy">주소 복사</button><button class="btn" type="button" data-qr="full">전체 화면</button><button class="btn primary" type="button" data-qr="close">닫기</button></div>
  </div>`;
  document.body.appendChild(el);
  const close=()=>{if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});el.remove();document.removeEventListener('keydown',onKey)};
  const onKey=e=>{if(e.key==='Escape')close()};
  document.addEventListener('keydown',onKey);
  el.addEventListener('click',async e=>{
    const b=e.target.closest('[data-qr]');if(!b){if(e.target===el)close();return}
    const a=b.dataset.qr;
    if(a==='close')close();
    else if(a==='full'){try{if(document.fullscreenElement)await document.exitFullscreen();else await el.requestFullscreen()}catch(_){toast('이 브라우저에서는 전체 화면을 쓸 수 없습니다')}}
    else if(a==='copy'){try{await navigator.clipboard.writeText(url);toast('학생 화면 주소를 복사했습니다')}catch(_){toast('복사하지 못했습니다. 주소를 직접 옮겨 적어 주세요')}}
  });
  el.querySelector('[data-qr="close"]').focus();
}
if(typeof module!=='undefined'&&module.exports)module.exports={studentUrl};

const test=require('node:test');const assert=require('node:assert');
const {studentUrl}=require('../js/qr.js');
test('학생 화면 주소는 교사 화면과 같은 폴더의 첫 화면',()=>{
  assert.equal(studentUrl('https://imkmje.github.io/geunbongukeo/teacher.html#x'),'https://imkmje.github.io/geunbongukeo/');
  assert.equal(studentUrl('https://imkmje.github.io/geunbongukeo/teacher.html?a=1'),'https://imkmje.github.io/geunbongukeo/');
  assert.equal(studentUrl('http://localhost:8000/teacher.html'),'http://localhost:8000/');
});

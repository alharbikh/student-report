/* مرصد الغياب: فك تشفير تقرير الفترة محليًا، دون أي نقل للبيانات أو كلمة المرور. */
'use strict';
(() => {
  const data=window.REPORT_ENCRYPTED,form=document.getElementById('unlockForm');
  const password=document.getElementById('unlockPassword');
  const error=document.getElementById('unlockError');
  const submit=document.getElementById('unlockButton');
  let activeUrl=null;
  const bytes=base64=>Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
  async function unlock(pass){
    if(!data||data.version!==1||data.algorithm!=='AES-256-GCM'||!crypto?.subtle)throw Error('صيغة التقرير أو المتصفح غير مدعومة.');
    if(!Number.isInteger(data.iterations)||data.iterations<300000)throw Error('إعدادات تشفير التقرير غير سليمة.');
    const keyMaterial=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey(
      {name:'PBKDF2',salt:bytes(data.salt),iterations:data.iterations,hash:'SHA-256'},
      keyMaterial,{name:'AES-GCM',length:256},false,['decrypt']);
    const plain=await crypto.subtle.decrypt(
      {name:'AES-GCM',iv:bytes(data.iv)},key,bytes(data.ciphertext));
    return new TextDecoder('utf-8',{fatal:true}).decode(plain);
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();error.textContent='';submit.disabled=true;
    const pass=password.value;
    try{
      const html=await unlock(pass);
      const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
      const frame=document.getElementById('reportFrame');
      frame.addEventListener('load',()=>{
        if(activeUrl)URL.revokeObjectURL(activeUrl);
        activeUrl=url;
      },{once:true});
      frame.src=url;document.getElementById('login').hidden=true;
      document.getElementById('viewer').hidden=false;
      document.body.classList.add('unlocked');
      password.value='';document.title='مرصد غياب الطلاب — '+data.period.from+' إلى '+data.period.to;
    }catch(e){
      error.textContent='تعذّر فتح التقرير. تأكد من عبارة المرور وصحة الملف.';
    }finally{password.value='';submit.disabled=false}
  });
  window.addEventListener('pagehide',()=>{if(activeUrl)URL.revokeObjectURL(activeUrl)});
})();

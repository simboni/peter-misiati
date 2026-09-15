/**
 * The consultation budget, measured against the running app.
 *
 * Design principle P3 from docs/hms/03-product-spec.md: a standard outpatient
 * consultation in under 90 seconds and under 15 interactions. That number is the
 * answer to weakness W3 — systems built for the billing office, with the doctor
 * paying the cost in clicks — so it is measured rather than asserted.
 *
 * NOT part of `npm test`: it needs a running server and a browser, and the app
 * deliberately carries no browser-test dependency yet. Run it by hand:
 *
 *   npm run build && npm start &
 *   node --experimental-strip-types scripts/consultation-budget.mjs
 *
 * It needs puppeteer-core and a Chromium binary on the machine.
 *
 * Measured 15 September 2026:
 *   coding by search (first use of a code)   10 interactions, ~9s
 *   coding by favourite chip (thereafter)     8 interactions, ~7.5s
 */
const p=require('puppeteer-core');
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));

async function register(pg,given,family,nid,phone){
  await pg.goto('http://localhost:3200/patients/new',{waitUntil:'networkidle0'});
  await pg.type('#givenName',given); await pg.type('#familyName',family);
  await pg.select('#sex','male'); await pg.type('#nationalId',nid); await pg.type('#phone',phone);
  await pg.click('form button[type=submit]:last-of-type'); await wait(2500);
  return decodeURIComponent(pg.url().split('/patients/')[1]||'');
}

async function consult(pg,mrn,label){
  let n=0; const t0=Date.now();
  await pg.goto('http://localhost:3200/patients/'+encodeURIComponent(mrn),{waitUntil:'networkidle0'}); n++;
  // "Start consultation" — the only submit button on the patient page
  await pg.click('button[type=submit]'); await wait(2000); n++;
  if(!pg.url().includes('/encounters/')) throw new Error('did not start: '+pg.url());

  // Code the diagnosis. A favourite chip is one tap; otherwise search then pick.
  const fav = await pg.$('form[action] button[title]');
  if(fav){
    await fav.click(); await wait(1800); n++;
    console.log('  ['+label+'] diagnosis coded by favourite chip: 1 tap');
  } else {
    await pg.type('#dx','malaria'); n++;
    await pg.click('form:has(#dx) button[type=submit]'); await wait(1500); n++;
    const hits = await pg.$$('button.w-full');
    await hits[0].click(); await wait(1800); n++;
    console.log('  ['+label+'] diagnosis coded by search: 3 interactions');
  }

  await pg.type('#complaint','Fever and headache 3 days'); n++;
  await pg.type('#examination','Temp 38.9, chest clear'); n++;
  await pg.type('#assessment','Falciparum malaria, RDT positive'); n++;
  await pg.type('#plan','AL 6 doses, paracetamol, review 3 days'); n++;
  await pg.click('button[name=finish]'); await wait(2500); n++;

  const secs = Math.round((Date.now()-t0)/100)/10;
  const closed = /\/patients\//.test(pg.url());
  console.log('  ['+label+'] interactions '+n+'/15 '+(n<=15?'PASS':'FAIL')+
              ' · seconds '+secs+'/90 '+(secs<=90?'PASS':'FAIL')+
              ' · encounter '+(closed?'CLOSED':'STILL OPEN — '+pg.url()));
  return closed;
}

(async()=>{
 const b=await p.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const pg=await b.newPage(); await pg.setViewport({width:1000,height:1200});
 const errs=[]; pg.on('pageerror',e=>errs.push(e.message));

 await pg.goto('http://localhost:3200/sign-in',{waitUntil:'networkidle0'});
 await pg.type('#username','j.otieno'); await pg.type('#password','ChangeMe123');
 await pg.click('button[type=submit]'); await wait(2500);
 const a = await register(pg,'Peter','Njoroge','44112233','0722334455');
 const c = await register(pg,'Mary','Atieno','55223344','0722556677');
 console.log('registered:',a,c);

 await pg.goto('http://localhost:3200/',{waitUntil:'networkidle0'});
 await pg.click('form button[type=submit]'); await wait(2000);
 await pg.type('#username','a.wanjiru'); await pg.type('#password','ChangeMe123');
 await pg.click('button[type=submit]'); await wait(2500);

 console.log('\nCONSULTATION BUDGET');
 const ok1 = await consult(pg,a,'first patient');
 const ok2 = await consult(pg,c,'next patient');
 await pg.screenshot({path:'consult-final.png',fullPage:true});
 console.log('\nboth encounters closed:', ok1&&ok2);
 console.log('ERRORS:', errs.length?errs.join('; '):'none');
 await b.close();
})();

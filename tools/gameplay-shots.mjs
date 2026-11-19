import { chromium } from 'playwright-core';
import fs from 'node:fs';
const url = process.argv[2] ?? 'http://127.0.0.1:5302/';
const out = process.env.OUT ?? '/workspace/games-3d/yooworld/gameplay/screens';
const prefix = process.env.PREFIX ?? 'after'; fs.mkdirSync(out, {recursive:true});
const b = await chromium.launch({executablePath:process.env.CHROME_PATH ?? '/usr/bin/google-chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const ctx = await b.newContext({viewport:{width:844,height:390},deviceScaleFactor:1,isMobile:true,hasTouch:true});
await ctx.addInitScript(()=>{sessionStorage.setItem('yw.portrait','1'); localStorage.setItem('yw.camView','room');});
const p=await ctx.newPage(); p.on('pageerror',e=>console.error(e));
await p.goto(url+'?fresh=1&lieu=appart&perf=0'); await p.waitForFunction(()=>window.game?.s.ready && window.__move && window.__cam,null,{timeout:120000}); await p.waitForTimeout(2000);
await p.evaluate(()=>{const g=window.game,a=g.s.apartment; g.setLayout({...a,items:[...a.items,{uid:'t_stool',defId:'stoolBar',x:10,z:12,rot:0}]},'place',{});});
for(const [name,def] of [['chair','chair'],['stool','stoolBar']]){
 await p.evaluate(def=>{const g=window.game,W=window.__world,c=W.chars[g.s.activeChar],it=g.s.apartment.items.find(x=>x.defId===def),s=W.seats.find(x=>x.id===it.uid+':0');c.mode='idle';c.path=[];c.sitOn=undefined;c.pos.copy(s.front);g.interact(it.uid,'sit');window.dispatchEvent(new Event('yw:follow'));},def);
 await p.waitForTimeout(5000); await p.screenshot({path:`${out}/${prefix}_${name}.png`});
}
await p.evaluate(()=>window.game.travel('beach')); await p.waitForTimeout(3000);
await p.screenshot({path:`${out}/${prefix}_label.png`});
await p.evaluate(()=>{const W=window.__world,c=W.chars[window.game.s.activeChar],s=W.seats.find(s=>s.id==='lounger2:0');c.mode='idle';c.path=[];c.sitOn=undefined;c.pos.copy(s.front);window.game.interactProp('lounger2','sit');window.dispatchEvent(new Event('yw:follow'));});
await p.waitForTimeout(6500); await p.screenshot({path:`${out}/${prefix}_lounger.png`});
await p.evaluate(()=>{window.game.setPanel('chat');window.game.sendChat('Dernier message visible · هاي');}); await p.waitForTimeout(500); await p.focus('.chat-sheet input');
await p.evaluate(()=>{Object.defineProperty(window.visualViewport,'height',{get:()=>170,configurable:true});window.visualViewport.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('resize'));});await p.waitForTimeout(1500);
await p.screenshot({path:`${out}/${prefix}_chat_keyboard.png`});
await b.close();

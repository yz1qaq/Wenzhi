(() => {
 'use strict';
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const root=document.documentElement;
 let frame=0;
 function position(){
  frame=0;
  const scrollable=Math.max(0,root.scrollHeight-innerHeight);
  const amount=scrollable?Math.max(0,Math.min(1,scrollY/scrollable)):0;
  root.style.setProperty('--read-position',String(amount));
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(position);}
 function enter(element,className='console-arrive'){
  if(!element||reduced.matches)return;
  element.classList.remove(className);
  // One short, state-triggered transition; content is visible by default.
  requestAnimationFrame(()=>element.isConnected&&element.classList.add(className));
 }
 const learning=document.getElementById('learning-view');
 let lastView='',lastQuestion='';
 if(learning)new MutationObserver(()=>{
  const heading=learning.querySelector('.learn-heading h2')?.textContent||'';
  const question=learning.querySelector('[data-study-question]')?.dataset.studyQuestion||learning.querySelector('[data-exercise-id]')?.dataset.exerciseId||'';
  if(heading!==lastView){enter(learning.querySelector('.learn-heading'));if(heading==='学习统计')enter(learning.querySelector('.learn-stats-grid'),'console-chart-arrive');}
  if(question&&question!==lastQuestion)enter(learning.querySelector('.learn-question,.learn-exercise'));
  lastView=heading;lastQuestion=question;schedule();
 }).observe(learning,{childList:true});
 window.addEventListener('scroll',schedule,{passive:true});
 window.addEventListener('resize',schedule,{passive:true});
 document.addEventListener('toggle',schedule,true);
 window.addEventListener('hashchange',schedule);
 if('ResizeObserver' in window)new ResizeObserver(schedule).observe(document.body);
 schedule();
})();

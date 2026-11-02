const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = fs.existsSync(require('node:path').join(__dirname, '../study-core.js')) ? require('../study-core.js') : {};
const questions = [{id:'a',category:'Go',track:'go'},{id:'b',category:'Go',track:'go'},{id:'c',category:'Agent',track:'ai'},{id:'d',category:'Agent',track:'ai'}];
const data = {questions, aliases:{old:'a'}};
const now = new Date(2026,10,2,12).getTime();
const DAY = 86400000;
const record = (overrides={}) => ({learned:false,mastery:null,score:null,source:null,updatedAt:null,nextReviewAt:null,...overrides});
const ai = (score, exerciseId='e1') => ({learned:true,mastery:score<60?'low':score<85?'medium':'high',score,source:'ai',exerciseId,question:'变式题',answer:'回答',feedback:'反馈',dimensions:{correctness:score*0.4,completeness:score*0.3,reasoning:score*0.2,expression:score*0.1}});

test('empty progress and missing records have independent safe defaults', () => {
  const p = S.emptyProgress();
  assert.deepEqual(p,{version:2,bookmarks:[],records:{},history:[],theme:'light'});
  assert.deepEqual(S.getRecord(p,'a'),record());
  p.bookmarks.push('a');
  assert.equal(S.emptyProgress().bookmarks.length,0);
  assert.equal(S.statusOf(p,'b'),'new');
});

test('v1 migration preserves bookmarks, theme, statuses and canonical precedence', () => {
  const p = S.normalizeProgress({version:1,bookmarks:['old','a','b'],statuses:{old:'mastered',a:'learning',b:'review',c:'mastered',d:'new'},theme:'dark'},data);
  assert.deepEqual(p.bookmarks,['a','b']);
  assert.equal(p.theme,'dark');
  assert.deepEqual(questions.map(q=>S.statusOf(p,q.id)),['learned','low','high','new']);
  assert.equal(p.records.a.score,null);
  assert.equal(p.records.c.score,null);
  assert.equal(p.records.a.source,'legacy');
  assert.equal(p.records.c.source,'legacy');
  assert.equal(p.records.c.nextReviewAt,0);
  assert.equal(S.isReviewDue(p.records.b,now),true);
  assert.equal(S.isReviewDue(p.records.c,now),true);
});

test('v2 migration canonicalizes aliases without replacing explicit canonical records', () => {
  const p=S.emptyProgress();
  p.records={old:record({learned:true,mastery:'high',source:'self'}),a:record({learned:true,source:'self'})};
  p.bookmarks=['old'];
  const n=S.normalizeProgress(p,data);
  assert.deepEqual(Object.keys(n.records),['a']);
  assert.equal(n.records.a.mastery,null);
  assert.deepEqual(n.bookmarks,['a']);
});

test('manual updates are immutable, reset prior AI scores and schedule review', () => {
  const original=S.emptyProgress();
  const p=S.updateProgress(original,'a',{learned:true,mastery:'medium'},now);
  assert.deepEqual(original,S.emptyProgress());
  assert.equal(p.records.a.source,'self');
  assert.equal(p.records.a.score,null);
  assert.equal(p.records.a.nextReviewAt,now+3*DAY);
  assert.equal(S.isReviewDue(p.records.a,now+3*DAY-1),false);
  assert.equal(S.isReviewDue(p.records.a,now+3*DAY),true);
  const high=S.updateProgress(p,'a',{mastery:'high'},now);
  assert.equal(high.records.a.nextReviewAt,now+7*DAY);
  assert.equal(S.statusOf(high,'a'),'high');
  const graded=S.updateProgress(high,'a',ai(90),now);
  const manual=S.updateProgress(graded,'a',{mastery:'low'},now+1);
  assert.equal(manual.records.a.score,null);
  assert.equal(manual.history.at(-1).source,'self');
  const reset=S.updateProgress(manual,'a',{learned:false},now+2);
  assert.deepEqual(reset.records.a,record({source:'self',updatedAt:now+2}));
  assert.equal(S.isReviewDue(reset.records.a,now+10*DAY),false);
  assert.equal(S.statusOf(S.updateProgress(reset,'a',{learned:true},now+3),'a'),'learned');
});

test('AI grading thresholds and repeated exercise ids do not double count or overwrite newer work', () => {
  for (const [score,want] of [[0,'low'],[59.9,'low'],[60,'medium'],[84.99,'medium'],[85,'high'],[100,'high']]) assert.equal(S.masteryFromScore(score),want);
  for (const bad of [NaN,Infinity,-1,100.01,'85',null]) assert.throws(()=>S.masteryFromScore(bad));
  const p=S.updateProgress(S.emptyProgress(),'a',ai(80),now);
  const newer=S.updateProgress(p,'a',{mastery:'high'},now+1);
  const retry=S.updateProgress(newer,'a',ai(80),now+2);
  assert.deepEqual(retry,newer);
  assert.equal(retry.history.length,2);
  assert.equal(retry.history[0].exerciseId,'e1');
  assert.equal(retry.history[0].id,'a');
  assert.equal(retry.history[0].updatedAt,now);
});

test('reject malformed imports, impossible scores and prototype ids without mutating input', () => {
  const cases=[null,[],{}, {...S.emptyProgress(),version:3}, {...S.emptyProgress(),bookmarks:['missing']}, {...S.emptyProgress(),bookmarks:[1]}, {...S.emptyProgress(),theme:'system'}, {...S.emptyProgress(),records:{a:record({learned:'true'})}}, {...S.emptyProgress(),records:{a:record({learned:true,source:'self',score:80,mastery:'medium'})}}, {...S.emptyProgress(),records:{a:record({learned:true,source:'ai',score:80,mastery:'high'})}}, {...S.emptyProgress(),records:{a:record({learned:true,source:'ai',score:NaN,mastery:'low'})}}, {...S.emptyProgress(),records:{a:record({mastery:'low'})}}, {...S.emptyProgress(),records:{a:record({updatedAt:'2026-11-02'})}}, {...S.emptyProgress(),history:Array(201).fill({})}, JSON.parse('{"version":2,"bookmarks":[],"records":{"__proto__":{}},"history":[],"theme":"light"}')];
  for (const p of cases) assert.throws(()=>S.normalizeProgress(p,data));
  assert.equal({}.polluted,undefined);
  for (const patch of [{learned:'yes'},{mastery:'bad'},{source:'bogus'},{score:100},{source:'self',score:80,mastery:'medium'},{...ai(80),mastery:'high'},{...ai(80),dimensions:{correctness:40,completeness:30,reasoning:20,expression:10}},{...ai(80),exerciseId:''},{source:'ai',mastery:'medium'}]) assert.throws(()=>S.updateProgress(S.emptyProgress(),'a',patch,now));
  assert.throws(()=>S.updateProgress(S.emptyProgress(),'__proto__',{learned:true},now));
});

test('history text is bounded, imports reject malformed history and normalize round trips', () => {
  const p=S.updateProgress(S.emptyProgress(),'a',{...ai(80),question:'q'.repeat(50000),answer:'a'.repeat(50000),feedback:'f'.repeat(50000)},now);
  assert.equal(p.history[0].question.length,2000);
  assert.equal(p.history[0].answer.length,4000);
  assert.equal(p.history[0].feedback.length,2000);
  assert.deepEqual(S.normalizeProgress(JSON.parse(JSON.stringify(p)),data),p);
  for (const change of [{id:'missing'},{score:NaN},{source:'self'},{answer:42},{dimensions:{correctness:41,completeness:30,reasoning:20,expression:10}},{mastery:'high'}]) {
    const bad=structuredClone(p);
    Object.assign(bad.history[0],change);
    assert.throws(()=>S.normalizeProgress(bad,data));
  }
  for (const [field,length] of [['question',2001],['answer',4001],['feedback',2001]]) {
    const bad=structuredClone(p);
    bad.history[0][field]='x'.repeat(length);
    assert.throws(()=>S.normalizeProgress(bad,data));
  }
});

test('history retention keeps the most recent 200 events', () => {
  let p=S.emptyProgress();
  for(let i=0;i<205;i++) p=S.updateProgress(p,'a',{mastery:i%2?'low':'high'},now+i);
  assert.equal(p.history.length,200);
  assert.equal(p.history[0].updatedAt,now+5);
  assert.equal(p.history.at(-1).updatedAt,now+204);
});

test('weighted sampling prioritizes new and low, uniform respects boundaries and avoids current', () => {
  let p=S.updateProgress(S.emptyProgress(),'a',{mastery:'high'},now);
  p=S.updateProgress(p,'b',{mastery:'low'},now);
  const counts={a:0,b:0,c:0,d:0};
  for(let i=0;i<1000;i++) counts[S.selectQuestion(questions,p,{random:()=> (i+0.5)/1000,now}).id]++;
  assert.ok(counts.b>counts.a*2);
  assert.ok(counts.c>counts.a*2);
  assert.equal(S.selectQuestion(questions,p,{mode:'uniform',random:()=>0}).id,'a');
  assert.equal(S.selectQuestion(questions,p,{mode:'uniform',random:()=>0.999999}).id,'d');
  assert.equal(S.selectQuestion(questions,p,{excludeId:'a',random:()=>0}).id,'b');
  assert.equal(S.selectQuestion([questions[0]],p,{excludeId:'a'}).id,'a');
  assert.equal(S.selectQuestion([],p),null);
  assert.throws(()=>S.selectQuestion(questions,p,{random:()=>NaN}));
});

test('summaries use the supplied pool, local calendar dates and AI-only historical scores', () => {
  let p=S.updateProgress(S.emptyProgress(),'a',ai(80,'e1'),now-DAY);
  p=S.updateProgress(p,'b',ai(40,'e2'),now);
  p=S.updateProgress(p,'c',ai(100,'e3'),now);
  p=S.updateProgress(p,'a',{mastery:'high'},now);
  p=S.updateProgress(p,'d',{learned:true},now);
  const sum=S.summarize(questions,p,now);
  assert.deepEqual([sum.total,sum.learned,sum.unlearned,sum.unrated,sum.low,sum.medium,sum.high,sum.reviewDue],[4,4,0,1,1,0,2,1]);
  assert.equal(sum.aiAttempts,3);
  assert.equal(sum.averageScore,220/3);
  assert.deepEqual(sum.byCategory[0],{category:'Go',total:2,learned:2,unlearned:0,unrated:0,low:1,medium:0,high:1,reviewDue:1});
  assert.equal(sum.trend.length,14);
  assert.deepEqual(sum.trend.at(-1),{date:'2026-11-02',count:4});
  assert.deepEqual(sum.trend.at(-2),{date:'2026-11-01',count:1});
  assert.equal(sum.trend[0].date,'2026-10-20');
  assert.equal(sum.recent[0].id,'d');
  const filtered=S.summarize(questions.slice(0,2),p,now);
  assert.equal(filtered.aiAttempts,2);
  assert.equal(filtered.averageScore,60);
  assert.equal(filtered.recent.length,3);
  assert.equal(filtered.trend.at(-1).count,2);
  const empty=S.summarize([],p,now);
  assert.deepEqual([empty.total,empty.learned,empty.aiAttempts,empty.averageScore],[0,0,0,null]);
  assert.deepEqual(empty.byCategory,[]);
  assert.deepEqual(empty.recent,[]);
  assert.ok(empty.trend.every(d=>d.count===0));
});

test('merge normalizes both inputs, keeps incoming records and deduplicates histories', () => {
  const current=S.updateProgress(S.emptyProgress(),'a',ai(80),now);
  current.bookmarks=['b'];
  const incoming=structuredClone(current);
  incoming.bookmarks=['old'];
  incoming.records.a=record({learned:true,mastery:'high',source:'self',updatedAt:now+1,nextReviewAt:now+1+7*DAY});
  const merged=S.mergeProgress(current,incoming,data);
  assert.deepEqual(merged.bookmarks,['b','a']);
  assert.equal(merged.records.a.mastery,'high');
  assert.equal(merged.history.length,1);
  assert.equal(current.records.a.mastery,'medium');
});

test('UMD provides a browser global without requiring CommonJS', () => {
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../study-core.js'),'utf8'),context);
  assert.equal(typeof context.window.WenzhiStudy.updateProgress,'function');
});

test('recent history is ordered by event time even if updates arrive out of order', () => {
  let p=S.updateProgress(S.emptyProgress(),'a',{learned:true},now);
  p=S.updateProgress(p,'b',{learned:true},now-DAY);
  assert.equal(S.summarize(questions,p,now).recent[0].id,'a');
});

test('exercise identifiers are never truncated into a different identity', () => {
  assert.throws(()=>S.updateProgress(S.emptyProgress(),'a',ai(80,'x'.repeat(201)),now));
});

test('history events require an explicit source and scores cannot exist without learning', () => {
  const p=S.updateProgress(S.emptyProgress(),'a',{learned:false},now);
  p.history[0].source=null;
  assert.throws(()=>S.normalizeProgress(p,data));
  assert.throws(()=>S.updateProgress(S.emptyProgress(),'a',{...ai(90),learned:false},now));
});

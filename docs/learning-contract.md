# Internal integration contract

## study-core.js
UMD/CommonJS + window.WenzhiStudy. API:
- emptyProgress(): {version:2,bookmarks:[],records:{},history:[],theme:'light'}
- normalizeProgress(input,data): validate/migrate version1/2; throw on invalid. data={questions:[{id,category,track}],aliases:{}}. canonical wins alias conflicts. v1 statuses new/learning/review/mastered mapped as design.
- getRecord(progress,id): default {learned:false,mastery:null,score:null,source:null,updatedAt:null,nextReviewAt:null}.
- statusOf(progress,id): 'new'|'learned'|'low'|'medium'|'high'. learned means learned but unrated.
- updateProgress(progress,id,patch,now=Date.now()): immutable update. patch={learned?,mastery?,score?,source?:'self'|'ai'|'legacy',exerciseId?,question?,answer?,feedback?,dimensions?}; learnedfalse clearslevel/score; manual no numeric score. history bounded200, stringsbounded. same exerciseId cannot append twice.
- isReviewDue(record,now=Date.now()): low always, medium/high at nextReviewAt; new/unrated false.
- selectQuestion(questions,progress,options={}): return question or null; options={excludeId,mode:'weighted'|'uniform',random?,now?}. Exclude current if>=2, weighted priority low/new; empty null.
- summarize(questions,progress,now=Date.now()): {total,learned,unlearned,unrated,low,medium,high,reviewDue,aiAttempts,averageScore,byCategory:[{category,total,learned,unlearned,unrated,low,medium,high,reviewDue}],trend:[{date:'YYYY-MM-DD',count}],recent:[historyentries]}.
- mergeProgress(current,incoming,data): normalize incoming, merge bookmarks and records (incoming wins), deduplicate history.
- masteryFromScore(number): low<60, medium60..84, high85..100, reject NaN/outofrange.

## server API
GET /api/health => {ok:true,service:'wenzhi'}
POST /api/practice/start {questionIds:[1..5 bankIDs]} => {items:[{id,sourceId,question}]} (exact bank title, no standardanswer before grading; no model/config required).
POST /api/practice/grade {config:{baseUrl,apiKey,model},exerciseId,answer} => {exerciseId,sourceId,question,score,mastery:'low'|'medium'|'high',dimensions:{correctness:0..40,completeness:0..30,reasoning:0..20,expression:0..10},strengths:[text],gaps:[text],feedback:text,suggestedAnswer:text,referenceAnswer:text,rubric:[text]}.
Errors => HTTP non200 {error:humanFriendlyText}; never leak key/providerrawresponse. score computed from validateddimensions; mastery computed server. original-question tasks server-side memory, expires24h/restart. grade safe retries for same task/answer return cached result; mismatched repeats rejected to avoidduplicatecost.

## learning.js frontend
window.WenzhiLearning.create({data,core,getProgress,updateProgress,navigate,renderMarkdown,renderAnswer,toast,escape}) => {render(view)}.
getProgress()=>current version2; updateProgress(id,patch)=> main updates withcore, saves, refreshes navprogress; returns boolean success (false blockedstorage). navigate(view,options?) main navigation. renderAnswer(q)=>full existing answer HTML including self-eval controls. root #learning-view (main ownsvisibility).
Views study/practice/stats/settings. learning owns filtering controls and drafts/secret configmemory. key never localStorage/export; non-secret baseUrl/model maypersist separately. Config keytrim andinputtypepassword. Store original-question tasks in memory, drafts preserved switchingviews; no automaticmodelcalls. Use active-task identity guards, cancellation, in-flight duplicate prevention. On stats rendering core.summarize; on self-eval main document click handlesdata-status. Practice on successfulgrade call updateProgress(sourceId,{learned:true,mastery,score,source:'ai',exerciseId,question,answer,feedback,dimensions}); do not update on network/JSONerror.

## 2026-11-02 correction

随机练习使用题库原题；前端抽样ID，服务端返回对应title原文并固定完整参考资料。/start无需且不读取模型配置，不调用上游；/generate已移除。只有/grade使用模型。旧变式生成说明不再适用。

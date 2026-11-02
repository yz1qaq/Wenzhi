(() => {
  'use strict';
  const LABELS = {new:'未学习',learned:'已学习 · 未评估',low:'低掌握',medium:'中掌握',high:'高掌握'};
  const STATES = Object.keys(LABELS);
  const CONFIG_KEY = 'wenzhi-model-settings-v1';
  const DIMENSIONS = {correctness:['正确性',40],completeness:['完整性',30],reasoning:['推理与边界',20],expression:['表达',10]};
  function create(options) {
    const {data,core,getProgress,updateProgress,navigate,renderMarkdown,renderAnswer,toast} = options;
    const root = document.querySelector('#learning-view');
    const esc = options.escape || (s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
    const byId = new Map(data.questions.map(q=>[q.id,q]));
    const categories = new Map(data.categories.map(c=>[c.id,c.title]));
    const filters = {study:{track:'all',category:'all',status:'all'},practice:{track:'all',category:'all',status:'all'},stats:{track:'all',category:'all',status:'all'}};
    const config = {baseUrl:'',apiKey:'',model:''};
    try { const saved=JSON.parse(localStorage.getItem(CONFIG_KEY)||'null'); if(saved&&typeof saved==='object'){config.baseUrl=typeof saved.baseUrl==='string'?saved.baseUrl:'';config.model=typeof saved.model==='string'?saved.model:'';} } catch (_) { /* Configuration is optional. */ }
    let view='study', current=null, mode='weighted', count=1, tasks=[], active=0, busy=false, busyAction='', error='', health='checking';
    let requestId=0, pendingController=null;
    const drafts=new Map(), results=new Map();
    const text = s => esc(String(s ?? ''));
    const md = s => renderMarkdown(String(s ?? ''));
    const button = (label,action,cls='',disabled=false) => `<button type="button" class="learn-button ${cls}" data-learn-action="${action}"${label.startsWith('正在')?' aria-busy="true"':''}${disabled?' disabled':''}>${label}</button>`;
    const sourceName = q => `${q.id} · ${q.track} / ${categories.get(q.category)||q.category}`;
    const statusOf = q => core.statusOf(getProgress(),q.id);
    const filtered = scope => data.questions.filter(q=>{
      const f=filters[scope]; return (f.track==='all'||q.track===f.track)&&(f.category==='all'||q.category===f.category)&&(f.status==='all'||statusOf(q)===f.status);
    });
    const option = (value,label,selected) => `<option value="${text(value)}"${value===selected?' selected':''}>${text(label)}</option>`;
    function filterBar(scope,withStatus=true) {
      const f=filters[scope], disabled=scope==='practice'&&busy?' disabled':'';
      return `<div class="learn-filters" aria-label="${scope==='stats'?'统计':'题目'}筛选"><label>方向<select id="${scope}-track" data-learn-filter="track" data-scope="${scope}"${disabled}>${option('all','全部方向',f.track)}${[...new Set(data.questions.map(q=>q.track))].map(t=>option(t,t==='Agent'?'Agent / LLM':t==='Go'?'Go / 后端':t,f.track)).join('')}</select></label><label class="learn-category">主题<select id="${scope}-category" data-learn-filter="category" data-scope="${scope}"${disabled}>${option('all','全部主题',f.category)}${data.categories.filter(c=>f.track==='all'||c.track===f.track).map(c=>option(c.id,c.title,f.category)).join('')}</select></label>${withStatus?`<label>掌握状态<select id="${scope}-status" data-learn-filter="status" data-scope="${scope}"${disabled}>${option('all','全部状态',f.status)}${STATES.map(s=>option(s,LABELS[s],f.status)).join('')}</select></label>`:''}<span class="learn-filter-count">${filtered(scope).length} 道原题</span></div>`;
    }
    function heading(kicker,title,description,actions='') {
      return `<header class="learn-heading"><div><p class="section-kicker">${kicker}</p><h2>${title}</h2><p>${description}</p></div>${actions}</header>`;
    }
    function empty(scope) {
      return `<div class="learn-empty"><span aria-hidden="true">○</span><h3>这个筛选下还没有题目</h3><p>调整方向、主题或掌握状态，再开始学习。</p>${button('清除筛选',`reset-${scope}`)}</div>`;
    }
    function pickNext() {
      current=core.selectQuestion(filtered('study'),getProgress(),{mode,excludeId:current?.id});
    }
    function study() {
      const pool=filtered('study');
      if(!current&&pool.length) pickNext();
      const q=current;
      return heading('RANDOM STUDY','随机学习','读完整答案，再用自己的话解释一次。',button('下一题 →','next','learn-primary',!pool.length))+filterBar('study')+`<div class="learn-study-options"><label>抽题方式<select id="study-mode"><option value="weighted"${mode==='weighted'?' selected':''}>优先未学习与低掌握</option><option value="uniform"${mode==='uniform'?' selected':''}>均匀随机</option></select></label><span>有多道题时，下一题不会立即重复。</span></div>`+(!q?empty('study'):`<article class="learn-question" data-study-question="${text(q.id)}"><div class="learn-question-meta"><span>${text(q.track)} / ${text(categories.get(q.category)||q.category)}</span><span class="learn-status learn-state-${statusOf(q)}">${LABELS[statusOf(q)]}</span></div><p class="learn-question-id">${text(q.id)} · 完整原题</p><h3 id="study-question-title">${text(q.title)}</h3><div id="study-full-answer">${renderAnswer(q)}</div><div class="learn-study-end"><p>每次自评只记录掌握等级；数字分数来自 AI 练习。</p>${button('换一道题 →','next','learn-primary',!pool.length)}</div></article>`);
    }
    function serviceNotice() {
      if(health==='checking') return '<p class="learn-service" role="status">正在检查本地练习服务…</p>';
      if(health==='ok') return '<p class="learn-service"><i aria-hidden="true"></i>本地练习服务已连接</p>';
      return '<div class="learn-notice"><b>AI 练习需要本地服务</b><p>在项目目录运行 <code>make run</code>，用 <code>http://127.0.0.1:8765</code> 打开后刷新页面。普通静态网页仍可学习与查看统计。</p></div>';
    }
    function configReady() { return Boolean(config.baseUrl.trim()&&config.apiKey.trim()&&config.model.trim()); }
    function practice() {
      const task=tasks[active], result=task&&results.get(task.id), draft=task?drafts.get(task.id)||'':'';
      return heading('QUESTION BANK ASSESSMENT','题库测评','随机抽取题库原题，独立作答后由 AI 评分并展示完整参考回答。',button('模型配置','settings'))+serviceNotice()+filterBar('practice')+`<div class="learn-generate"><label>本轮题量<select id="practice-count"${busy?' disabled':''}>${[1,3,5].map(n=>option(String(n),`${n} 道`,String(count))).join('')}</select></label>${button(busyAction==='start'?'正在抽题…':'随机抽题','draw','learn-primary',busy||health!=='ok'||!filtered('practice').length)}${busy?button('停止等待','cancel'):''}<p>随机抽题在本地完成；仅点击“提交评分”时调用配置的模型，可能产生费用。${!configReady()?`<button type="button" class="learn-link" data-learn-action="settings">评分前填写模型配置 ↗</button>`:''}</p>${filtered('practice').length<count?`<p>当前范围只有 ${filtered('practice').length} 道原题，将按实际题量抽取。</p>`:''}</div><p id="practice-message" class="learn-error" role="status"${error?'':' hidden'}>${text(error)}</p>${!task?`<div class="learn-empty learn-practice-empty"><span aria-hidden="true">↗</span><h3>用题库原题检验掌握情况</h3><p>选择范围，随机抽取 1、3 或 5 道题库原题。提交评分前不会展示参考答案。</p><small>题目与题库标题保持一致，AI 只负责评分。</small></div>`:`<div class="learn-task-nav" role="group" aria-label="本轮练习">${tasks.map((t,i)=>`<button type="button" data-learn-task="${i}" class="${i===active?'active':''}"${busy?' disabled':''}>第 ${i+1} 题${results.has(t.id)?' · 已评估':''}</button>`).join('')}<span>本轮 ${tasks.length} 道</span></div><article class="learn-exercise" data-exercise-id="${text(task.id)}"><p class="learn-question-id">练习 ${active+1} / ${tasks.length} · 题库原题</p><h3 id="practice-question">${text(task.question)}</h3><p class="learn-source">题库原题：${text(sourceName(byId.get(task.sourceId)))}</p><label for="practice-answer" class="learn-answer-label">你的回答<span>先说明结论，再解释原因、步骤与边界。</span></label><textarea id="practice-answer" maxlength="12000" rows="10" placeholder="写下你的独立回答…"${busy||result?' disabled':''}>${text(draft)}</textarea><div class="learn-submit"><span id="practice-answer-count">${draft.length.toLocaleString()} / 12,000</span>${result?'<span class="learn-completed">本题已完成评估</span>':button(busyAction==='grade'?'正在评估…':'提交评分','grade','learn-primary',busy||!draft.trim()||health!=='ok')}</div>${result?gradeResult(result):''}</article>`}`;
    }
    function gradeResult(entry) {
      const r=entry.result;
      const list=(title,items)=>`<section class="learn-feedback-section"><h4>${title}</h4><ul>${items.map(s=>`<li>${text(s)}</li>`).join('')}</ul></section>`;
      return `<section class="learn-grade" id="practice-result" aria-labelledby="grade-title"><div class="learn-grade-heading"><div><p class="section-kicker">ASSESSMENT</p><h3 id="grade-title">${LABELS[r.mastery]}</h3></div><p class="learn-score"><b>${r.score}</b><span>/ 100</span></p></div><p class="learn-muted">分数只反映你本次对这道原题的回答，不等于对该考点能力的完整证明。</p><p class="learn-save-state${entry.saved?'':' learn-error'}">${entry.saved?'已写入对应原题的学习记录。':'评分已完成，但学习记录保存失败。请导出备份或恢复本地存储后重试。'}</p>${entry.saved?'':button('重试保存学习记录','save-grade')}<div class="learn-dimensions">${Object.entries(DIMENSIONS).map(([key,[label,max]])=>`<div><div><span>${label}</span><b>${r.dimensions[key]} / ${max}</b></div><div class="learn-dimension-track"><i style="width:${r.dimensions[key]/max*100}%"></i></div></div>`).join('')}</div>${list('评分依据',r.rubric)}${list('回答中的优点',r.strengths)}${list('遗漏与需要修正的地方',r.gaps)}<section class="learn-feedback-section"><h4>评估反馈</h4><div class="markdown-body">${md(r.feedback)}</div></section><section class="learn-feedback-section"><h4>建议回答</h4><div class="markdown-body">${md(r.suggestedAnswer)}</div></section><section class="learn-feedback-section"><h4>本题完整参考回答</h4><div class="markdown-body">${md(r.referenceAnswer)}</div></section></section>`;
    }
    function stats() {
      const questions=filtered('stats'), summary=core.summarize(questions,getProgress());
      const scopeIds=new Set(questions.map(q=>q.id));
      const recentAI=(getProgress().history||[]).filter(h=>h.source==='ai'&&scopeIds.has(h.id)).slice().sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,20);
      const values=[summary.unlearned,summary.unrated,summary.low,summary.medium,summary.high];
      const total=summary.total, percent=n=>total?Number((n/total*100).toFixed(1)):0;
      const circumference=2*Math.PI*64;
      let offset=0;
      const arcs=values.map((n,i)=>{const length=total?n/total*circumference:0; const arc=`<circle class="learn-fill-${STATES[i]}" cx="90" cy="90" r="64" fill="none" stroke-width="17" stroke-dasharray="${length} ${circumference-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)"/>`;offset+=length;return arc;}).join('');
      const trend=summary.trend||[], max=Math.max(1,...trend.map(d=>d.count));
      return heading('LEARNING STATISTICS','学习统计','分布按每题最新记录统计；活动与 AI 历史按保留的最近 200 条学习记录统计。')+filterBar('stats',false)+`<div class="learn-metrics"><div><span>学习进度</span><strong>${percent(summary.learned)}<small>%</small></strong><p>${summary.learned} / ${total} 道已学习</p></div><div><span>高掌握</span><strong>${percent(summary.high)}<small>%</small></strong><p>${summary.high} 道原题</p></div><div><span>建议复习</span><strong>${summary.reviewDue}</strong><p>低掌握与已到期题目</p></div><div><span>AI 评估</span><strong>${summary.aiAttempts}</strong><p>平均 ${summary.averageScore==null?'—':Number(summary.averageScore).toFixed(1)} 分</p></div></div><div class="learn-stats-grid"><section class="learn-stat-section"><h3>掌握程度分布</h3><div class="learn-distribution"><svg class="learn-donut" viewBox="0 0 180 180" role="img" aria-label="掌握程度分布：${STATES.map((s,i)=>`${LABELS[s]} ${values[i]} 道`).join('，')}"><circle cx="90" cy="90" r="64" fill="none" stroke="var(--line)" stroke-width="17"/>${arcs}<text x="90" y="87" text-anchor="middle" class="learn-donut-number">${total}</text><text x="90" y="108" text-anchor="middle" class="learn-donut-caption">道原题</text></svg><ul class="learn-legend">${STATES.map((s,i)=>`<li><i class="learn-bg-${s}" aria-hidden="true"></i><span>${LABELS[s]}</span><b>${values[i]}</b></li>`).join('')}</ul></div></section><section class="learn-stat-section"><h3>最近 14 天学习活动</h3><p class="learn-muted">自评与成功的 AI 评估均计入活动。</p><div class="learn-trend" role="img" aria-label="${trend.map(d=>`${d.date}：${d.count} 次`).join('，')}">${trend.map((d,i)=>`<div class="learn-trend-day" title="${text(d.date)}：${d.count} 次"><span>${d.count||''}</span><div><i style="height:${d.count/max*100}%"></i></div><small>${i===0||i===trend.length-1||i%4===0?text(d.date.slice(5).replace('-','/')):''}</small></div>`).join('')}</div></section></div><section class="learn-stat-section learn-category-stats"><div class="learn-section-line"><h3>按主题查看</h3><span>未学习 → 高掌握</span></div>${summary.byCategory.length?summary.byCategory.map(c=>{const vals=[c.unlearned,c.unrated,c.low,c.medium,c.high];return `<div class="learn-category-row"><div><span>${text(categories.get(c.category)||c.category)}</span><small>${c.learned} / ${c.total} 已学习</small></div><div class="learn-stacked" role="img" aria-label="${text(categories.get(c.category)||c.category)}：${STATES.map((s,i)=>`${LABELS[s]} ${vals[i]}`).join('，')}">${STATES.map((s,i)=>`<i class="learn-bg-${s}" style="width:${c.total?vals[i]/c.total*100:0}%" title="${LABELS[s]} ${vals[i]} 道"></i>`).join('')}</div></div>`;}).join(''):'<p class="learn-muted">当前范围暂无题目。</p>'}</section><section class="learn-stat-section"><div class="learn-section-line"><h3>最近 AI 评估</h3><span>最近 20 次</span></div><div class="learn-history">${recentAI.map(h=>`<details><summary><span><b>${text(byId.get(h.id)?.title||h.id)}</b><small>${text(h.id)} · ${text(new Date(h.updatedAt).toLocaleString('zh-CN'))}</small></span><span class="learn-history-score">${h.score==null?'—':h.score}<small> / 100</small></span></summary><div class="learn-history-body"><h4>练习题目</h4><p>${text(h.question||'—')}</p><h4>你的回答</h4><p class="learn-preserve">${text(h.answer||'—')}</p><h4>评估反馈</h4><div class="markdown-body">${md(h.feedback||'暂无详细反馈')}</div></div></details>`).join('')||'<p class="learn-muted learn-history-empty">完成一次 AI 练习后，这里会显示评估记录。</p>'}</div></section>`;
    }
    function settings() {
      return heading('MODEL SETTINGS','模型配置','使用你自己的 Chat Completions 兼容服务。')+serviceNotice()+`<form id="learning-settings-form" class="learn-settings"><label for="model-base-url">服务地址<span>兼容 OpenAI Chat Completions 的 API Base URL，例如服务商给出的 /v1 地址。</span></label><input id="model-base-url" type="url" data-config="baseUrl" placeholder="https://your-provider.example/v1" value="${text(config.baseUrl)}" autocomplete="url" required><label for="model-api-key">API Key<span>只保留在当前页面内存，刷新页面后需要重新输入。</span></label><input id="model-api-key" type="password" data-config="apiKey" placeholder="填写你的 API Key" value="${text(config.apiKey)}" autocomplete="off" spellcheck="false" required><label for="model-name">模型名称<span>填写服务商支持的完整模型标识，没有预设模型。</span></label><input id="model-name" type="text" data-config="model" placeholder="填写模型名称" value="${text(config.model)}" autocomplete="off" spellcheck="false" required><div class="learn-settings-actions"><button class="learn-button learn-primary" type="submit">保存配置</button>${button('清除本页密钥','clear-key')}</div><div class="learn-notice"><b>调用与保存说明</b><p>保存会将服务地址和模型名称记在此浏览器；API Key 不写入本地存储、学习记录或导出文件。只有提交评分时，回答才会通过本地服务发送给你配置的模型服务商，可能产生费用。</p><p>保存配置与随机抽题均在本地完成，不调用模型。更改配置后，下一次提交评分会使用新的配置。</p><p><a href="prompts/grade.md" target="_blank" rel="noopener">查看评分提示词 ↗</a></p></div><p id="settings-message" class="learn-muted" role="status"></p></form>`;
    }
    function render(nextView) {
      view=nextView||view;
      if(!root) return;
      root.classList.add('learning-workspace');
      root.innerHTML=view==='practice'?practice():view==='stats'?stats():view==='settings'?settings():study();
      if(view==='study'&&current) {
        if(typeof options.hydrateAnswer==='function') options.hydrateAnswer(root,current);
        root.querySelectorAll('#study-full-answer details').forEach(d=>{d.open=true;});
      }
    }
    function message(value) {error=value;if(view==='practice')render();else toast?.(value);}
    function safeError(err) {
      let value=err?.name==='AbortError'?'请求超时。你的回答已保留，请稍后重试。':err?.message||'请求未完成，请检查本地服务与模型配置。';
      if(config.apiKey) value=value.split(config.apiKey).join('[密钥已隐藏]');
      return value.slice(0,500);
    }
    function validateConfig() {
      if(!configReady()) throw new Error('请先填写服务地址、API Key 和模型名称。');
      let parsed;try{parsed=new URL(config.baseUrl.trim());}catch(_){throw new Error('请填写完整的 HTTP(S) 模型服务地址。');}
      if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('服务地址应使用 HTTP(S)，且不应包含用户名或密码。');
      return {baseUrl:config.baseUrl.trim(),apiKey:config.apiKey.trim(),model:config.model.trim()};
    }
    async function post(path,body) {
      const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),115000);
      pendingController=controller;
      try {
        const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
        if(path==='/api/practice/start'&&response.status===404)throw new Error('服务需更新，请 Ctrl+C 后 make run。');
        let payload;try{payload=await response.json();}catch(_){throw new Error('本地服务返回了无法读取的结果；学习记录未更改。');}
        if(!response.ok)throw new Error(typeof payload?.error==='string'?payload.error:'请求失败，请检查配置或稍后重试。');
        return payload;
      } finally {clearTimeout(timer);if(pendingController===controller)pendingController=null;}
    }
    async function drawPractice() {
      if(busy)return;
      let pool=filtered('practice').slice();if(!pool.length)return;
      const required=Math.min(count,pool.length),previousIds=new Set(tasks.map(t=>t.sourceId));
      const fresh=pool.filter(q=>!previousIds.has(q.id));
      if(fresh.length>=required)pool=fresh;
      const questionIds=[];
      for(let i=0;i<required&&pool.length;i++){const q=core.selectQuestion(pool,getProgress(),{mode:'weighted'});if(!q)break;questionIds.push(q.id);pool=pool.filter(x=>x.id!==q.id);}
      if(!questionIds.length)return;
      const identity=++requestId;
      busy=true;busyAction='start';error='';if(view==='practice')render();
      try {
        const result=await post('/api/practice/start',{questionIds});
        if(identity!==requestId)return;
        const seen=new Set(),seenSources=new Set();
        if(!Array.isArray(result?.items)||result.items.length!==questionIds.length||result.items.some(t=>!t||typeof t.id!=='string'||!t.id.trim()||seen.has(t.id)||seenSources.has(t.sourceId)||!questionIds.includes(t.sourceId)||typeof t.question!=='string'||t.question!==byId.get(t.sourceId)?.title||(seen.add(t.id),seenSources.add(t.sourceId),false)))throw new Error('抽题结果与题库原题不匹配，请重试；原有回答已保留。');
        tasks=result.items.map(t=>({id:t.id,sourceId:t.sourceId,question:t.question}));active=0;
        tasks.forEach(t=>drafts.set(t.id,''));
      } catch(err) {if(identity===requestId)error=safeError(err);}
      finally {if(identity===requestId){busy=false;busyAction='';if(view==='practice')render();}}
    }
    function validatedGrade(r,task) {
      if(!r||r.exerciseId!==task.id||r.sourceId!==task.sourceId||!r.dimensions||Array.isArray(r.dimensions)||Object.keys(r.dimensions).length!==4)throw new Error('评分结果与当前练习不匹配，学习记录未更改。');
      let sum=0;
      for(const [key,[,max]] of Object.entries(DIMENSIONS)){const n=r.dimensions[key];if(!Number.isInteger(n)||n<0||n>max)throw new Error('评分维度无效，学习记录未更改。');sum+=n;}
      if(typeof r.score!=='number'||r.score!==sum||r.mastery!==core.masteryFromScore(sum))throw new Error('评分结果无效，学习记录未更改。');
      for(const key of ['question','feedback','suggestedAnswer','referenceAnswer'])if(typeof r[key]!=='string'||!r[key].trim())throw new Error('评分反馈不完整，学习记录未更改。');
      for(const key of ['rubric','strengths','gaps'])if(!Array.isArray(r[key])||r[key].some(s=>typeof s!=='string'))throw new Error('评分反馈格式无效，学习记录未更改。');
      return r;
    }
    function saveGrade(task,r,answer) {
      return updateProgress(task.sourceId,{learned:true,mastery:r.mastery,score:r.score,source:'ai',exerciseId:task.id,question:task.question,answer,feedback:r.feedback,dimensions:r.dimensions})!==false;
    }
    async function grade() {
      const task=tasks[active];if(busy||!task||results.has(task.id))return;
      const answer=drafts.get(task.id)||'';if(!answer.trim())return;
      let requestConfig;try{requestConfig=validateConfig();}catch(err){message(safeError(err));return;}
      const identity=++requestId;
      busy=true;busyAction='grade';error='';if(view==='practice')render();
      try {
        const r=validatedGrade(await post('/api/practice/grade',{config:requestConfig,exerciseId:task.id,answer}),task);
        if(identity!==requestId||tasks[active]?.id!==task.id)return;
        const entry={result:r,saved:false,answer};results.set(task.id,entry);
        try{entry.saved=saveGrade(task,r,answer);}catch(_){entry.saved=false;}
      } catch(err) {if(identity===requestId)error=safeError(err);}
      finally {if(identity===requestId){busy=false;busyAction='';if(view==='practice')render();}}
    }
    root?.addEventListener('click',event=>{
      const taskButton=event.target.closest('[data-learn-task]');
      if(taskButton){if(!busy){active=Number(taskButton.dataset.learnTask);error='';render();}return;}
      const el=event.target.closest('[data-learn-action]');if(!el||el.disabled)return;
      const action=el.dataset.learnAction;
      if(action==='next'){pickNext();render();}
      else if(action==='settings')navigate('settings');
      else if(action.startsWith('reset-')){const scope=action.slice(6);Object.assign(filters[scope],{track:'all',category:'all',status:'all'});if(scope==='study')current=null;render();}
      else if(action==='cancel'){requestId++;pendingController?.abort();busy=false;busyAction='';error='已停止等待，回答已保留。本地服务可能仍在完成请求。';render();}
      else if(action==='draw')drawPractice();
      else if(action==='grade')grade();
      else if(action==='clear-key'){config.apiKey='';render();toast?.('当前页面的 API Key 已清除。');}
      else if(action==='save-grade'){const task=tasks[active],entry=task&&results.get(task.id);if(entry){try{entry.saved=saveGrade(task,entry.result,entry.answer);}catch(_){entry.saved=false;}render();}}
    });
    root?.addEventListener('input',event=>{
      const el=event.target;
      if(el.dataset.config)config[el.dataset.config]=el.value;
      if(el.id==='practice-answer'){
        const task=tasks[active];if(!task||busy)return;drafts.set(task.id,el.value);
        const counter=root.querySelector('#practice-answer-count');if(counter)counter.textContent=`${el.value.length.toLocaleString()} / 12,000`;
        const submit=root.querySelector('[data-learn-action="grade"]');if(submit)submit.disabled=!el.value.trim()||health!=='ok';
      }
    });
    root?.addEventListener('change',event=>{
      const el=event.target;
      if(el.dataset.learnFilter){const scope=el.dataset.scope;if(scope==='practice'&&busy)return;filters[scope][el.dataset.learnFilter]=el.value;if(el.dataset.learnFilter==='track')filters[scope].category='all';if(scope==='study')current=null;render();}
      else if(el.id==='study-mode')mode=el.value;
      else if(el.id==='practice-count'&&!busy)count=Number(el.value);
    });
    root?.addEventListener('submit',event=>{
      if(event.target.id!=='learning-settings-form')return;event.preventDefault();
      let notice;try{validateConfig();try{localStorage.setItem(CONFIG_KEY,JSON.stringify({baseUrl:config.baseUrl.trim(),model:config.model.trim()}));notice='配置已保存，密钥仅保留在当前页面。';}catch(_){notice='配置已用于当前页面；浏览器未允许保存服务地址和模型名称。';}}catch(err){notice=safeError(err);}
      const status=root.querySelector('#settings-message');if(status)status.textContent=notice;
    });
    const healthController=new AbortController();
    const healthTimer=setTimeout(()=>healthController.abort(),6000);
    fetch('/api/health',{signal:healthController.signal}).then(async r=>{const body=await r.json();health=r.ok&&body.ok===true&&body.service==='wenzhi'?'ok':'unavailable';}).catch(()=>{health='unavailable';}).finally(()=>{clearTimeout(healthTimer);if(view==='practice'||view==='settings')render();});
    return {render};
  }
  window.WenzhiLearning={create};
})();

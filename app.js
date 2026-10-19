(() => {
'use strict';
const D = window.ATLAS_DATA;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const icons = {
 book:'<path d="M4 3h13a2 2 0 0 1 2 2v15H6a2 2 0 0 1-2-2V3Z"/><path d="M4 16h15M8 7h7M8 10h5"/>',
 bookmark:'<path d="M6 4h12v17l-6-4-6 4V4Z"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 github:'<path d="M9 19c-4 1-4-2-6-2m12 5v-4a3.5 3.5 0 0 0-1-2.8c3.3-.4 6.8-1.6 6.8-7A5.5 5.5 0 0 0 19.3 4a5 5 0 0 0-.1-3S18 1 15 2.6a13 13 0 0 0-6 0C6 1 4.8 1 4.8 1a5 5 0 0 0-.1 3 5.5 5.5 0 0 0-1.5 4.2c0 5.4 3.5 6.6 6.8 7A3.5 3.5 0 0 0 9 18v4"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
 moon:'<path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
 shuffle:'<path d="M3 6h3c5 0 6 12 11 12h4m-4-4 4 4-4 4M3 18h3c5 0 6-12 11-12h4m-4-4 4 4-4 4"/>',
 sprout:'<path d="M12 21v-8m0 4C4 17 3 12 3 8c5 0 9 1 9 9Zm0-4c0-7 4-10 9-10 0 6-3 10-9 10Z"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',
 external:'<path d="M13 3h8v8M21 3 11 13M9 3H4v17h17v-5"/>',
 download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
 upload:'<path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 check:'<path d="m5 12 4 4L19 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.book}</svg>`;
$$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
$('#export').innerHTML = icon('download'); $('#import').innerHTML = icon('upload'); $('#menu').innerHTML = icon('menu');
const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const rich = value => esc(value).replace(/`([^`]+)`/g,'<code>$1</code>');
// Markdown is rendered locally. Raw HTML is escaped, and links never accept executable schemes.
function safeHref(value){
 const url=String(value||'').trim();
 if(!url||/[\\\u0000-\u0020\u007f]/.test(url)||url.startsWith('//'))return null;
 if(/^[a-z][a-z0-9+.-]*:/i.test(url))return /^https?:\/\//i.test(url)?url:null;
 return url;
}
function mdInline(value){
 const slots=[];
 const token=html=>{slots.push(html);return `\u0000${slots.length-1}\u0000`;};
 let text=esc(String(value).replace(/\u0000/g,''));
 text=text.replace(/`([^`]+)`/g,(_,code)=>token(`<code>${code}</code>`));
 text=text.replace(/!?\[([^\]\n]+)\]\(([^\s)]+)(?:\s+&quot;[^\n]*?&quot;)?\)/g,(full,label,url)=>{
  const raw=url.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  const href=safeHref(raw);
  return href?token(`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`):label;
 });
 text=text.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/__([^_]+)__/g,'<strong>$1</strong>').replace(/(^|\s)\*([^*\n]+)\*/g,'$1<em>$2</em>').replace(/~~([^~]+)~~/g,'<del>$1</del>');
 // Repeated expansion handles a code span used as the label of a link.
 for(let i=0;i<3;i++)text=text.replace(/\u0000(\d+)\u0000/g,(_,n)=>slots[Number(n)]||'');
 return text;
}
function markdown(value){
 const lines=String(value||'').replace(/\r\n?/g,'\n').split('\n');
 const out=[];let i=0;
 const list=line=>/^(\s*)([-+*]|\d+[.)])\s+(.*)$/.exec(line);
 const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(x=>x.trim().replace(/\\\|/g,'|'));
 const tableRule=line=>/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line||'');
 const block=line=>/^\s*(`{3,}|~{3,}|#{1,6}\s|>|([-*_])(?:\s*\2){2,}\s*$)/.test(line)||!!list(line);
 while(i<lines.length){
  const line=lines[i];if(!line.trim()){i++;continue;}
  const fence=/^\s*(`{3,}|~{3,})(.*)$/.exec(line);
  if(fence){
   const code=[];i++;const close=new RegExp('^\\s*'+fence[1][0]+'{'+fence[1].length+',}\\s*$');
   while(i<lines.length&&!close.test(lines[i]))code.push(lines[i++]);if(i<lines.length)i++;
   const language=fence[2].trim().split(/\s/)[0];
   out.push(`<div class="md-code">${language?`<div class="code-title">${esc(language)}</div>`:''}<pre><code>${esc(code.join('\n'))}</code></pre></div>`);continue;
  }
  const heading=/^\s*(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
  if(heading){const level=Math.min(6,heading[1].length+2);out.push(`<h${level}>${mdInline(heading[2])}</h${level}>`);i++;continue;}
  if(/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)){out.push('<hr>');i++;continue;}
  if(/^\s*>/.test(line)){const quote=[];while(i<lines.length&&/^\s*>/.test(lines[i]))quote.push(lines[i++].replace(/^\s*> ?/,''));out.push(`<blockquote>${markdown(quote.join('\n'))}</blockquote>`);continue;}
  if(line.includes('|')&&tableRule(lines[i+1])){
   const headers=cells(line);i+=2;const rows=[];
   while(i<lines.length&&lines[i].trim()&&lines[i].includes('|'))rows.push(cells(lines[i++]));
   out.push(`<div class="md-table"><table><thead><tr>${headers.map(c=>`<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${headers.map((_,j)=>`<td>${mdInline(row[j]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);continue;
  }
  const first=list(line);
  if(first){
   const indent=first[1].length,ordered=/\d/.test(first[2]),tag=ordered?'ol':'ul',items=[];
   while(i<lines.length){
    const current=list(lines[i]);if(!current||current[1].length!==indent||/\d/.test(current[2])!==ordered)break;
    const body=[current[3]],contentIndent=current[1].length+current[2].length+1;i++;
    while(i<lines.length){
     const next=list(lines[i]);if(next&&next[1].length<=indent)break;
     if(!lines[i].trim()){if(i+1<lines.length&&/^\s+\S/.test(lines[i+1])){body.push('');i++;continue;}break;}
     if((/^\s*/.exec(lines[i])[0].length)<=indent)break;
     body.push(lines[i++].slice(contentIndent));
    }
    items.push(`<li>${markdown(body.join('\n'))}</li>`);
    if(i<lines.length&&!lines[i].trim()){let n=i;while(n<lines.length&&!lines[n].trim())n++;const next=list(lines[n]||'');if(next&&next[1].length===indent){i=n;continue;}break;}
   }
   out.push(`<${tag}${ordered?` start="${parseInt(first[2],10)}"`:''}>${items.join('')}</${tag}>`);continue;
  }
  const paragraph=[line];i++;
  while(i<lines.length&&lines[i].trim()&&!block(lines[i])&&!(lines[i].includes('|')&&tableRule(lines[i+1])))paragraph.push(lines[i++]);
  out.push(`<p>${paragraph.map(mdInline).join('<br>')}</p>`);
 }
 return out.join('');
}
const greenbookQuestions=D.questions.filter(q=>q.greenbook?.length);
const questionById=new Map(D.questions.map(q=>[q.id,q]));
const questionNumbers=new Map();const trackNumbers={};
D.questions.forEach(q=>{trackNumbers[q.track]=(trackNumbers[q.track]||0)+1;questionNumbers.set(q.id,trackNumbers[q.track]);});
const searchIndex=new Map();
const STATUS = {new:'未学习',learning:'学习中',review:'待复习',mastered:'已掌握'};
const KEY = 'interview-atlas-progress-v1';
const ids = new Set(D.questions.map(q => q.id));
let persistent = true;
let progress = {version:1,bookmarks:[],statuses:{},theme:'light'};
function canonicalId(id) { return D.aliases?.[id] || id; }
function validateProgress(v) {
 if (!v || typeof v !== 'object' || Array.isArray(v) || v.version !== 1 || !Array.isArray(v.bookmarks) || !v.statuses || typeof v.statuses !== 'object' || Array.isArray(v.statuses)) throw new Error('文件格式不符');
 if(v.bookmarks.length>10000||Object.keys(v.statuses).length>10000)throw new Error('记录过多');
 if(v.bookmarks.some(id=>!ids.has(canonicalId(id)))||Object.entries(v.statuses).some(([id,status])=>!ids.has(canonicalId(id))||!Object.hasOwn(STATUS,status)))throw new Error('未知题号或状态');
 const statuses={};
 for(const [id,status] of Object.entries(v.statuses))if(!D.aliases?.[id])statuses[id]=status;
 for(const [id,status] of Object.entries(v.statuses))if(statuses[canonicalId(id)]===undefined)statuses[canonicalId(id)]=status;
 return {version:1,bookmarks:[...new Set(v.bookmarks.map(canonicalId))],statuses,theme:v.theme==='dark'?'dark':'light'};
}
try { const stored=localStorage.getItem(KEY); if(stored) progress=validateProgress(JSON.parse(stored)); }
catch (_) { persistent=false; }
let state={view:'actual',track:'all',category:'all',query:'',level:'all',status:'all',origin:'all',core:false,sourceTrack:'all'};
const expanded = new Set();
let toastTimer;
function toast(message) { $('#toast').textContent=message; $('#toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>{$('#toast').hidden=true;},3800); }
function save() {
 try { localStorage.setItem(KEY,JSON.stringify(progress)); persistent=true; }
 catch (_) { persistent=false; toast('浏览器限制了本地保存，请用导出按钮备份本次进度。'); }
}
function applyTheme() {
 document.documentElement.dataset.theme=progress.theme;
 $('#theme-label').textContent=progress.theme==='dark'?'切换浅色模式':'切换深色模式';
 $('#theme [data-icon]').innerHTML=icon(progress.theme==='dark'?'moon':'sun');
 $('#mobile-theme').innerHTML=icon(progress.theme==='dark'?'moon':'sun');
}
function toggleTheme(){progress.theme=progress.theme==='light'?'dark':'light';applyTheme();save();}
function catOf(q){return D.categories.find(c=>c.id===q.category);}
function statusOf(q){return progress.statuses[q.id]||'new';}
const SOURCE_LABEL={public:'公开面经',student:'学员反馈',repo:'仓库原题',course:'课程延伸',edited:'整理补充'};
function mainSource(q){return ['public','student','repo','course','edited'].find(k=>q.sourceKinds?.includes(k))||'edited';}
function trackCount(t){return D.questions.filter(q=>t==='all'||q.track===t).length;}
function matchesOrigin(q,origin){return origin==='all'||(origin==='actual'?q.isActual:q.sourceKinds.includes(origin));}
function filtered(){
 const terms=state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
 return D.questions.filter(q=>{
  if(state.track!=='all'&&q.track!==state.track)return false;
  if(state.category!=='all'&&q.category!==state.category)return false;
  if(state.level!=='all'&&q.level!==state.level)return false;
  if(state.status!=='all'&&statusOf(q)!==state.status)return false;
  if(state.core&&q.priority!=='核心')return false;
  if(!matchesOrigin(q,state.origin))return false;
  if(state.view==='actual'&&!q.isActual)return false;
  if(state.view==='pdf'&&!q.originalVariants?.length)return false;
  if(state.view==='greenbook'&&!q.greenbook?.length)return false;
  if(state.view==='favorites'&&!progress.bookmarks.includes(q.id))return false;
  if(state.view==='review'&&statusOf(q)!=='review')return false;
  if(!terms.length)return true;
  if(!searchIndex.has(q.id)){
  const sourceText=(q.refs||[]).map(r=>{const ref=D.references[r];return `${ref.label} ${D.repositories.find(x=>x.id===ref.repo)?.repo||''}`;}).join(' ');
  const text=[q.id,q.title,q.summary,...q.points,q.followup,q.pitfall,catOf(q).title,q.track,sourceText,...(q.variants||[]),...(q.standardAnswer||[]),...(q.deepDive||[]).map(x=>x.text),...(q.followups||[]).flatMap(x=>[x.question,x.answer]),...(q.provenance||[]).map(p=>p.statement),...(q.originalVariants||[]).flatMap(v=>[v.sourceId,'Q'+v.number,'PDF Q'+v.number]),...(q.greenbook||[]).flatMap(v=>[v.id,v.title,v.chapter,v.markdown,v.novice,v.expert,v.analysis])].join(' ').toLowerCase();
  searchIndex.set(q.id,text);}
  return terms.every(t=>searchIndex.get(q.id).includes(t));
 });
}
function renderProgress(){
 const mastered=D.questions.filter(q=>statusOf(q)==='mastered').length;
 $('#total-progress').textContent=`${mastered} / ${D.questions.length}`;
 $('#total-bar').style.width=`${mastered/(D.questions.length||1)*100}%`;
 $('#fav-count').textContent=progress.bookmarks.length;
 $('#review-count').textContent=D.questions.filter(q=>statusOf(q)==='review').length;
 $('#track-progress').innerHTML=['Agent','Go'].map(t=>{
 const n=D.questions.filter(q=>q.track===t&&statusOf(q)==='mastered').length;
 return `<div class="track-progress-item"><div><span>${t==='Agent'?'Agent 开发':'Go 后端'}</span><b>${n} / ${trackCount(t)}</b></div><div class="progress-track"><i style="width:${n/(trackCount(t)||1)*100}%"></i></div></div>`;
 }).join('');
}
function renderTopics(){
 const cats=D.categories.filter(c=>state.track==='all'||c.track===state.track);
 $('#topic-track').textContent=state.track==='all'?'ALL':state.track.toUpperCase();
 $('#topics').innerHTML=`<button data-category="all" class="${state.category==='all'&&state.view!=='sources'?'active':''}"><span class="topic-n">—</span><span>全部主题</span><span class="topic-count">${trackCount(state.track)}</span></button>`+cats.map((c,i)=>`<button data-category="${c.id}" class="${c.id===state.category&&state.view!=='sources'?'active':''}"><span class="topic-n">${String(i+1).padStart(2,'0')}</span><span>${esc(c.title)}</span><span class="topic-count">${D.questions.filter(q=>q.category===c.id).length}</span></button>`).join('');
}
function renderRoute(){
 const data=state.track==='Go'?[['g-types','01 · 值语义与集合','从基础语义建立判断标准'],['g-channel','02 · 并发与运行时','把同步与退出路径讲清楚'],['g-http','03 · 服务与实战','用接口和测试验证设计']]:[['a-foundation','01 · 模型与 Agent 基础','建立完整的执行循环'],['a-tools','02 · 工具与检索','给每一步行动可靠的依据'],['a-eval','03 · 评测与工程实践','让结果能测量、可复现']];
 $('#route').innerHTML=data.map(([id,t,d])=>`<li><button data-jump="${id}">${t}</button><small>${d}</small></li>`).join('');
}
function sourceLink(p){
 const pdf=D.documents?.find(x=>x.id===p.document);
 return `${pdf?`<a href="${esc(pdf.url)}#page=${p.pageStart}" target="_blank" rel="noopener">PDF ${esc(p.sourceId)} · 第 ${p.pageStart}${p.pageEnd!==p.pageStart?'–'+p.pageEnd:''} 页 ↗</a>`:''}${(p.urls||[]).map((u,i)=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${p.kind==='repo'?'仓库原题':'面经原帖'}${p.urls.length>1?' '+(i+1):''} ↗</a>`).join(' ')}`;
}
function classicAnswer(q){
 const refs=q.refs.map(key=>{const r=D.references[key];return `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.label)} ${icon('external')}</a>`;}).join('');
 const ps=q.provenance.filter(p=>p.kind!=='edited'||q.sourceKinds.includes('edited'));
 const example=q.example;
 const code=example?.code?{text:example.code,label:example.title,language:example.language}:q.code;
 return `<div class="answer"><p class="answer-kicker">DETAILED INTERVIEW ANSWER</p><h4 class="answer-main-title">详细参考回答</h4><p class="answer-attribution ${q.answerKind==='pdf-course'?'pdf-attribution':''}">${esc(q.answerAttribution)}</p><div class="standard-answer">${q.standardAnswer.map(p=>`<p>${rich(p)}</p>`).join('')}</div>${q.deepDive?.length?`<section class="deep-section"><h4>原理、步骤与边界</h4>${q.deepDive.map(x=>`<h5>${esc(x.title)}</h5><p>${rich(x.text)}</p>`).join('')}</section>`:''}${example?`<section class="case-section"><h4>${esc(example.title)}</h4><p>${rich(example.text)}</p>${example.sourceUrl?`<div class="reference-links"><a href="${esc(example.sourceUrl)}" target="_blank" rel="noopener">配套 Go 源码 ↗</a><a href="${esc(example.testUrl)}" target="_blank" rel="noopener">边界与竞态测试 ↗</a></div>`:''}</section>`:''}${code?`<p class="code-title">${esc(code.label||'代码片段')}</p><pre><code>${esc(code.text)}</code></pre>`:''}<section class="followups-section"><h4>追问与直接回答</h4>${q.followups.map(f=>`<div class="followup"><b>${esc(f.question)}</b><p>${rich(f.answer)}</p></div>`).join('')}</section>${q.pitfall&&!q.pitfall.startsWith('区分概念、课程示例')?`<p class="pitfall"><b>容易答偏：</b>${rich(q.pitfall)}</p>`:''}<details class="origin-details"><summary>原题、页码与合并记录 <span>${q.originalVariants?.length? q.originalVariants.map(v=>v.sourceId).join(' / '):'查看出处'}</span></summary><div class="origin-body">${ps.map(p=>`<div class="origin-item"><span class="source-badge source-${p.kind}">${SOURCE_LABEL[p.kind]}</span><b>${esc(p.title)}</b><p>${esc(p.statement)}</p><div class="reference-links">${sourceLink(p)}</div></div>`).join('')}${q.mergedNotes?.length?`<div class="merged-variants"><b>同考点合并的旧问法</b><ul>${q.mergedNotes.map(n=>`<li>${esc(n.title)}</li>`).join('')}</ul></div>`:''}${q.originalVariants?.length?`<p class="origin-note">PDF 以原作者口述稿为参考；表格与排版请查看原件。本次未将文档的简历模板、个人贡献或性能声明登记为你的个人事实。</p>`:''}</div></details>${sourceVariants(q)}<h4>技术核对与延伸阅读</h4><div class="reference-links">${refs}</div><div class="status-actions" role="group" aria-label="${esc(q.id)} 复习状态">${Object.entries(STATUS).map(([key,label])=>`<button data-status="${key}" data-id="${q.id}" class="${statusOf(q)===key?'active':''}" aria-pressed="${statusOf(q)===key}">${key==='mastered'?'✓ ':''}${label}</button>`).join('')}</div></div>`;
}
function greenbookVariant(v){
 const href=safeHref(v.sourceUrl);
 const body=v.markdown||[v.novice?`## 小白回答\n\n${v.novice}`:'',v.expert?`## 高手回答\n\n${v.expert}`:'',v.analysis?`## 解析\n\n${v.analysis}`:''].filter(Boolean).join('\n\n');
 return `<section class="greenbook-variant"><div class="source-variant-heading"><span class="source-badge source-repo">仓库原题</span><b>${esc(v.id)} · ${esc(v.title)}</b></div>${v.chapter?`<p class="source-chapter">${esc(v.chapter)}</p>`:''}<div class="markdown-body">${markdown(body)}</div><p class="origin-note">${esc(v.sourceStatement||'上游企业、轮次与面试日期为原作者自述，未经企业独立确认。')}</p>${href?`<div class="reference-links"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">查看上游原题 ↗</a></div>`:''}</section>`;
}
function greenbookNotice(){return '<p class="answer-attribution">来源：Onefly / zero2Agent 面试绿皮书 · CC BY-NC-SA 4.0。原题与参考回答按来源保留；上游的企业与面试经历声明未经独立确认。第一人称经历和项目指标是作者示例，不代表你的个人事实。</p>';}
function sourceVariants(q){
 return q.greenbook?.length?`<details class="origin-details source-variants" data-greenbook="${esc(q.id)}"><summary>绿皮书原题与完整参考回答 <span>${q.greenbook.length} 个来源版本</span></summary><div class="origin-body" data-source-body></div></details>`:'';
}
function answer(q){
 const sourceFirst=q.answerKind==='greenbook';
 if(!sourceFirst)return classicAnswer(q);
 return `<div class="answer"><p class="answer-kicker">GREENBOOK · ORIGINAL SOURCE ANSWER</p><h4 class="answer-main-title">绿皮书完整参考回答</h4>${greenbookNotice()}${(q.greenbook||[]).map(greenbookVariant).join('')}<div class="status-actions" role="group" aria-label="${esc(q.id)} 复习状态">${Object.entries(STATUS).map(([key,label])=>`<button data-status="${key}" data-id="${esc(q.id)}" class="${statusOf(q)===key?'active':''}" aria-pressed="${statusOf(q)===key}">${key==='mastered'?'✓ ':''}${label}</button>`).join('')}</div></div>`;
}
function ensureAnswer(details){
 if(!details.open||details.querySelector(':scope > .answer'))return;
 const q=questionById.get(details.dataset.question);if(q)details.insertAdjacentHTML('beforeend',answer(q));
}
function renderDedupGroups(details){
 if(!details.open||details.dataset.rendered)return;
 details.dataset.rendered='true';
 details.insertAdjacentHTML('beforeend',(D.dedup?.groups||[]).map(g=>`<div class="dedup-group"><a href="#${esc(g.canonicalId)}">${esc(g.title)}</a><p>${g.records.map(r=>esc((r.kind==='pdf'?'PDF ':r.kind==='greenbook'?'绿皮书 ':r.kind==='repo'?'仓库 ':'旧题 ')+r.sourceId+'：'+r.title)).join('<br>')}</p></div>`).join(''));
}
function renderQuestions(){
 const qs=filtered();
 $('#result-count').textContent=`${qs.length} 道题${state.query?' · 当前方向搜索':''}`;
 $('#reset').hidden=!(state.query||state.category!=='all'||state.level!=='all'||state.status!=='all'||state.origin!=='all'||state.core);
 const cat=state.category!=='all'?D.categories.find(c=>c.id===state.category):null;
 const titles={bank:state.track==='all'?'全部方向':state.track==='Go'?'Go 后端':'Agent 开发',favorites:'我的收藏',review:'待复习',actual:'面经与仓库原题',pdf:'PDF 收录题',greenbook:'zero2Agent 面试绿皮书'};
 $('#section-title').textContent=cat?.title||titles[state.view]||'题库';
 $('#section-kicker').textContent=state.track==='Go'?'02 / GO ENGINEERING':state.track==='all'?'THE COMPLETE COLLECTION':'01 / AGENT ENGINEERING';
 const descriptions={bank:state.track==='Go'?'语言语义、并发机制与后端服务的完整链路。':'模型原理、工具使用与可验证的工程实践。',favorites:'把值得反复思考的问题留在这里。',review:'重新讲一遍，直到能解释原因和边界。',actual:'公开面经、学员反馈与可定位的仓库原题；每题保留来源层级。',pdf:`${(D.documents||[]).reduce((n,d)=>n+(d.questions||0),0)} 道 PDF 原题按考点合并为 ${D.questions.filter(q=>q.originalVariants?.length).length} 个主题，原题题号与页码均可追溯。`,greenbook:`${(D.collections||[]).find(c=>c.id==='greenbook')?.questions??greenbookQuestions.reduce((n,q)=>n+q.greenbook.length,0)} 道来源原题，关联 ${greenbookQuestions.length} 个去重主题；保留完整参考回答、代码与出处。` };
 $('#section-description').textContent=cat?.subtitle||descriptions[state.view]||'';
 $('#random').disabled=qs.length===0;
 if(!qs.length){
  const message=state.view==='favorites'?'点击题目右侧的书签，即可加入收藏。':state.view==='review'?'展开题目，将复习状态设为“待复习”。':'换一个关键词，或清除筛选后再试试。';
  $('#questions').innerHTML=`<div class="empty-state">${icon(state.view==='favorites'?'bookmark':'search')}<h3>这里还没有符合条件的题目</h3><p>${message}</p><button data-empty-reset>查看当前方向全部题目</button></div>`;
  return;
 }
 $('#questions').innerHTML=D.categories.map(c=>{
  const group=qs.filter(q=>q.category===c.id);if(!group.length)return '';
  return `<section class="question-group" aria-label="${esc(c.title)}"><div class="group-heading"><h3>${esc(c.title)}</h3><small>${group.length} QUESTIONS</small></div><div class="question-list">${group.map(q=>{
   const n=questionNumbers.get(q.id);
   const starred=progress.bookmarks.includes(q.id);
   return `<article class="question-row" id="q-${q.id}"><details data-question="${q.id}" ${expanded.has(q.id)?'open':''}><summary><span class="question-number">${String(n).padStart(2,'0')}</span><div class="summary-content"><h4 class="question-title" style="margin:0">${esc(q.title)}</h4><div class="question-info"><span class="level-label">${q.level}</span>${q.priority==='核心'?'<span class="priority-label">核心</span>':'<span>拓展</span>'}<span class="info-divider"></span><span class="question-status status-${statusOf(q)}">${STATUS[statusOf(q)]}</span>${q.sourceKinds.map(k=>`<span class="source-badge source-${k}">${SOURCE_LABEL[k]}</span>`).join('')}<span class="source-name">· 详细回答</span></div></div><span class="chevron">${icon('chevron')}</span></summary>${expanded.has(q.id)?answer(q):''}</details><button class="bookmark" data-bookmark="${q.id}" aria-pressed="${starred}" aria-label="${starred?'取消收藏':'收藏'}：${esc(q.title)}" title="${starred?'取消收藏':'收藏'}">${icon('bookmark')}</button></article>`;
  }).join('')}</div></section>`;
 }).join('');
}
function renderSources(){
 $('#method').textContent=D.method;
 $('#document-sources').innerHTML=(D.documents||[]).map(doc=>`<article class="document-card"><div><p class="section-kicker">YOUR SOURCE DOCUMENT</p><h3>${esc(doc.title)}</h3><p>${doc.pages} 页 · ${doc.questions} 道 PDF 原题</p><p>${esc(doc.notice)}</p></div><a class="document-open" href="${esc(doc.url)}" target="_blank" rel="noopener">打开离线 PDF ↗</a></article>`).join('')+(D.collections||[]).map(collection=>{
 const url=safeHref(collection.sourceUrl),local=safeHref(collection.localUrl),pdf=safeHref(collection.url);
 const linked=collection.id==='greenbook'?greenbookQuestions.length:collection.canonicalCount;
 return `<article class="document-card collection-card"><div><p class="section-kicker">OPEN SOURCE QUESTION COLLECTION</p><h3>${esc(collection.title)}</h3><p>${collection.questions} 道来源原题${linked!==undefined?` · ${linked} 个关联主题`:''}${collection.version?` · ${esc(collection.version)}`:''}</p><p>${esc(collection.notice||'来源作者的企业与面试经历声明未经独立确认。')}</p><p>${esc(collection.author||'Onefly')} · ${esc(collection.license||'CC BY-NC-SA 4.0')}${collection.commit?` · 固定提交 ${esc(collection.commit.slice(0,12))}`:''}</p></div><div class="collection-actions">${collection.id==='greenbook'?'<button class="document-open" data-view="greenbook">进入完整题集 →</button>':''}${pdf?`<a class="document-open" href="${esc(pdf)}" target="_blank" rel="noopener">离线绿皮书 PDF ↗</a>`:''}${local?`<a class="document-open" href="${esc(local)}" target="_blank" rel="noopener">离线原文 Markdown ↗</a>`:''}${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">上游来源 ↗</a>`:''}</div></article>`;
 }).join('');
 const d=D.dedup||{},groups=d.groups||[];
 const parts=[d.oldAliasCount!==undefined?`旧题内部合并 ${d.oldAliasCount} 条`:null,d.pdfInternalMerges!==undefined?`PDF 内部合并 ${d.pdfInternalMerges} 条`:null,d.crossSourceMerges!==undefined?`跨来源合并 ${d.crossSourceMerges} 条`:null].filter(Boolean);
 $('#dedup-summary').innerHTML=`<section class="dedup-card"><h3>去重：${d.inputCount??D.questions.length} 条输入 → ${D.questions.length} 个主条目</h3><p>累计合并 ${d.mergedCount??0} 个重复条目；上一版合并 ${d.previousMergedCount??62} 条，本轮合并 ${d.newMergedCount??0} 条。</p>${d.newSourceCount!==undefined?`<p>本次收录 ${d.newSourceCount} 道绿皮书来源题${d.newMergedCount!==undefined?`，其中 ${d.newMergedCount} 条合并到已有考点`:''}。</p>`:''}<p>${esc(d.criteria||'按题意、回答范围与考点去重，同时保留原始问法和来源。')}</p><p>来源标签可能重叠：同一道题可同时关联多个来源，计数不能直接相加。仓库原题只表示来源可定位；企业与面试日期按作者自述保留，不作为企业独立确认。</p><details data-dedup><summary>查看全部合并组（${groups.length} 组）</summary></details><div class="reference-links"><a href="去重对照表.md" target="_blank">下载原题到主条目的完整对照 ↗</a><a href="题库汇总.md" target="_blank">完整详细题库 Markdown ↗</a></div></section>`;
 const repos=D.repositories.filter(r=>state.sourceTrack==='all'||r.track===state.sourceTrack);
 $('#repositories').innerHTML=repos.map(r=>`<article class="repo-card"><div class="repo-top"><span>${String(D.repositories.indexOf(r)+1).padStart(2,'0')} / ${esc(r.track.toUpperCase())}</span><span class="repo-tier">${esc(r.tier)}</span></div><h3 class="repo-name"><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.repo)}</a></h3><div class="repo-kind">${esc(r.kind)} · 核验于 ${r.checked}</div><p>${esc(r.why)}</p><p><b>建议读法</b>　${esc(r.start)}</p><p class="repo-caveat"><b>使用边界</b>　${esc(r.caveat)}</p><div class="repo-links"><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${icon('github')} 打开仓库 ↗</a><a href="${esc(r.sample)}" target="_blank" rel="noopener noreferrer">抽样入口 ↗</a></div></article>`).join('');
 $$('[data-source-track]').forEach(b=>b.classList.toggle('active',b.dataset.sourceTrack===state.sourceTrack));
}
function render(){
 const source=state.view==='sources';
 $('#bank-view').hidden=source;$('#sources-view').hidden=!source;
 $('#breadcrumb').textContent=({bank:'分类题库',favorites:'我的收藏',review:'待复习',actual:'面经与仓库原题',pdf:'PDF 收录题',greenbook:'zero2Agent 面试绿皮书',sources:'来源与去重'})[state.view];
 $$('.primary-nav [data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);b.setAttribute('aria-current',b.dataset.view===state.view?'page':'false');});
 $$('[data-track]').forEach(b=>{b.classList.toggle('active',b.dataset.track===state.track);b.setAttribute('aria-pressed',b.dataset.track===state.track);});
 $$('[data-track]').forEach(b=>{const count=b.querySelector('small');if(count)count.textContent=trackCount(b.dataset.track);});
 $('#bank-count').textContent=D.questions.length;$('#actual-count').textContent=D.questions.filter(q=>q.isActual).length;$('#pdf-count').textContent=D.questions.filter(q=>q.originalVariants?.length).length;$('#stat-questions').textContent=D.questions.length;$('#stat-categories').textContent=D.categories.length;$('#greenbook-count').textContent=greenbookQuestions.length;$('#repo-count').textContent=D.repositories.length;$('#stat-pdf').textContent=(D.documents||[]).reduce((n,d)=>n+(d.questions||0),0);$('#stat-greenbook').textContent=(D.collections||[]).find(c=>c.id==='greenbook')?.questions??greenbookQuestions.reduce((n,q)=>n+q.greenbook.length,0);$('#source-total').textContent=`${(D.documents||[]).length} PDF + ${(D.collections||[]).length} COLLECTION + ${D.repositories.length} REPOSITORIES ↗`;
 renderTopics();renderProgress();renderRoute();
 if(source)renderSources();else renderQuestions();
}
function closeMenu(){ $('#sidebar').classList.remove('open');$('#scrim').hidden=true;$('#menu').setAttribute('aria-expanded','false');$('#menu').setAttribute('aria-label','打开导航'); }
function resetFilters(){state.category='all';state.query='';state.level='all';state.status='all';state.origin='all';state.core=false;$('#search').value='';$('#level').value='all';$('#status').value='all';$('#origin').value='all';$('#core').checked=false;}
function navigate(view,{track,category,scroll=true}={}){
 state.view=view;if(track)state.track=track;
 resetFilters();if(category){state.category=category;const cat=D.categories.find(c=>c.id===category);if(cat)state.track=cat.track;}
 const params=new URLSearchParams({view:state.view,track:state.track});if(state.category!=='all')params.set('category',state.category);
 try{history.replaceState(null,'','#'+params.toString());}catch(_){}
 closeMenu();render();if(scroll)window.scrollTo({top:0,behavior:'instant'});
}
function readHash(){
 const raw=location.hash.slice(1);if(raw==='bank'){state.view='bank';return;}const direct=D.questions.find(q=>q.id===canonicalId(raw));
 if(direct){state.view='bank';state.track=direct.track;state.category=direct.category;expanded.add(direct.id);return direct.id;}
 const p=new URLSearchParams(raw);if(['bank','actual','pdf','greenbook','favorites','review','sources'].includes(p.get('view')))state.view=p.get('view');
 if(['Agent','Go','all'].includes(p.get('track')))state.track=p.get('track');
 const c=D.categories.find(x=>x.id===p.get('category'));
 if(c){state.category=c.id;state.track=c.track;}
}
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.view){navigate(b.dataset.view,{track:['actual','pdf','greenbook'].includes(b.dataset.view)?'all':undefined});return;}
 if(b.dataset.track){navigate(state.view,{track:b.dataset.track,scroll:false});return;}
 if(b.dataset.category){navigate(state.view==='greenbook'?'greenbook':'bank',{category:b.dataset.category});return;}
 if(b.dataset.jump){const c=D.categories.find(x=>x.id===b.dataset.jump);navigate('bank',{track:c.track,category:c.id});return;}
 if(b.dataset.bookmark){
  const id=b.dataset.bookmark;const added=!progress.bookmarks.includes(id);
  progress.bookmarks=added?[...progress.bookmarks,id]:progress.bookmarks.filter(x=>x!==id);save();
  if(state.view==='favorites')render();else {b.setAttribute('aria-pressed',added);const q=D.questions.find(q=>q.id===id);b.setAttribute('aria-label',`${added?'取消收藏':'收藏'}：${q.title}`);b.title=added?'取消收藏':'收藏';renderProgress();}
  toast(added?'已加入收藏':'已取消收藏');return;
 }
 if(b.dataset.status){
  const {id,status}=b.dataset;progress.statuses[id]=status;save();
  const focusId=id;render();
  document.querySelector(`[data-status="${status}"][data-id="${focusId}"]`)?.focus({preventScroll:true});
  toast(`已标记为${STATUS[status]}`);return;
 }
 if(b.dataset.sourceTrack){state.sourceTrack=b.dataset.sourceTrack;renderSources();return;}
 if(b.hasAttribute('data-empty-reset')){navigate('bank',{track:state.track,scroll:false});return;}
});
document.addEventListener('toggle',e=>{
 const details=e.target;
 if(details.matches('details[data-question]')){const id=details.dataset.question;details.open?expanded.add(id):expanded.delete(id);ensureAnswer(details);}
 if(details.matches('details[data-greenbook]')&&details.open){const body=details.querySelector('[data-source-body]');if(!body.dataset.rendered){body.dataset.rendered='true';body.innerHTML=greenbookNotice()+(questionById.get(details.dataset.greenbook)?.greenbook||[]).map(greenbookVariant).join('');}}
 if(details.matches('details[data-dedup]'))renderDedupGroups(details);
},true);
$('#search').addEventListener('input',e=>{state.query=e.target.value;renderQuestions();});
$('#level').addEventListener('change',e=>{state.level=e.target.value;renderQuestions();});
$('#status').addEventListener('change',e=>{state.status=e.target.value;renderQuestions();});
$('#origin').addEventListener('change',e=>{state.origin=e.target.value;renderQuestions();});
$('#core').addEventListener('change',e=>{state.core=e.target.checked;renderQuestions();});
$('#reset').addEventListener('click',()=>navigate(state.view,{track:state.track,scroll:false}));
$('#random').addEventListener('click',()=>{
 const qs=filtered();if(!qs.length)return;
 const pending=qs.filter(q=>statusOf(q)!=='mastered');const pool=pending.length?pending:qs;
 const q=pool[Math.floor(Math.random()*pool.length)];expanded.clear();renderQuestions();
 const details=document.querySelector(`[data-question="${q.id}"]`);details.open=true;expanded.add(q.id);ensureAnswer(details);details.querySelector('summary').focus({preventScroll:true});
 details.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
 toast('先独立口述，再对照答题要点');
});
$('.brand').addEventListener('click',e=>{e.preventDefault();navigate('bank');});
$('#theme').addEventListener('click',toggleTheme);$('#mobile-theme').addEventListener('click',toggleTheme);
$('#menu').addEventListener('click',()=>{const open=!$('#sidebar').classList.contains('open');$('#sidebar').classList.toggle('open',open);$('#scrim').hidden=!open;$('#menu').setAttribute('aria-expanded',open);$('#menu').setAttribute('aria-label',open?'关闭导航':'打开导航');});
$('#scrim').addEventListener('click',closeMenu);
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){closeMenu();if(document.activeElement===$('#search')){$('#search').blur();}}
 if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();if(state.view==='sources')navigate('bank',{scroll:false});$('#search').focus();}
});
function download(filename,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
$('#export').addEventListener('click',()=>{download(`问知-复习进度-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({...progress,exportedAt:new Date().toISOString()},null,2),'application/json');toast('收藏与复习进度已导出');});
$('#import').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',async e=>{
 const file=e.target.files[0];if(!file)return;
 try{
  if(file.size>1024*1024)throw new Error('文件过大');
  const incoming=validateProgress(JSON.parse(await file.text()));
  progress.bookmarks=[...new Set([...progress.bookmarks,...incoming.bookmarks])];
  progress.statuses={...progress.statuses,...incoming.statuses};
  save();render();toast('已合并导入；同题状态以导入记录为准');
 }catch(_){toast('导入失败：请选择本题库导出的有效 JSON 文件。');}
 finally{e.target.value='';}
});
window.addEventListener('hashchange',()=>{resetFilters();const id=readHash();render();if(id)requestAnimationFrame(()=>document.getElementById('q-'+id)?.scrollIntoView({block:'center'}));});
applyTheme();const first=readHash();render();if(first)setTimeout(()=>$('#q-'+first)?.scrollIntoView({block:'center'}),100);
if(!persistent)setTimeout(()=>toast('已有进度无法读取或浏览器限制了存储；可用导入/导出备份。'),300);
})();

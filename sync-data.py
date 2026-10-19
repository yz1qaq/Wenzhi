"""编辑data.json后运行：同步离线网页数据、完整Markdown和原题去重对照。"""
import json
from pathlib import Path
from collections import Counter
root=Path(__file__).resolve().parent
d=json.loads((root/'data.json').read_text(encoding='utf-8'))
ids={q['id'] for q in d['questions']}
assert len(ids)==len(d['questions']),'题号重复'
assert all(q['category'] in {c['id'] for c in d['categories']} for q in d['questions'])
assert all(r in d['references'] for q in d['questions'] for r in q['refs'])
assert all(q.get('standardAnswer') and (q.get('followups') or q.get('greenbook')) for q in d['questions'])
assert all(r['canonicalId'] in ids for r in d['dedup']['records'])
(root/'data.js').write_text('window.ATLAS_DATA = '+json.dumps(d,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
labels={'public':'公开面经（作者回忆）','student':'学员反馈（课程方转述）','repo':'仓库原题','course':'课程延伸','edited':'整理补充'}
lines=[f'# Agent × Go 详细面试题库 · V{d["version"]}','',d['method'],'',f'共{len(d["questions"])}道去重题；{len(d["categories"])}类；核验日期{d["checked"]}。','','绿皮书内容：Onefly / [zero2Agent](https://github.com/ranxi2001/zero2Agent)，[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)。本地分类、合并与技术校注属于整理改动，完整许可与归属见[NOTICE](materials/zero2Agent/NOTICE.md)。企业题源为原作者自述，不代表企业官方统一标准答案。','']
for c in d['categories']:
 lines += [f'## {c["track"]} / {c["title"]}','',c['subtitle'],'']
 for q in d['questions']:
  if q['category']!=c['id']:continue
  lines += [f'### {q["id"]} · {q["title"]}','',f'{q["level"]} · {" / ".join(labels[k] for k in q["sourceKinds"])}','', '**回答归属：** '+q['answerAttribution'],'']
  if q.get('answerKind')!='greenbook':
   lines += ['#### 详细参考回答','']+q['standardAnswer']+['']
   for section in q.get('deepDive',[]):lines += [f'#### {section["title"]}','',section['text'],'']
   example=q.get('example')
   if example:
    lines += [f'#### 案例：{example["title"]}','',example['text'],'']
    if example.get('sourceUrl'):lines += [f'[配套Go源码]({example["sourceUrl"]}) · [测试]({example["testUrl"]})','']
   code=({'text':example['code'],'language':example.get('language','text')} if example and example.get('code') else q.get('code'))
   if code:lines += ['```'+code.get('language','text'),code['text'],'```','']
   lines += ['#### 追问与回答','']
   for f in q['followups']:lines += ['**问：** '+f['question'],'','**答：** '+f['answer'],'']
   if q.get('pitfall') and not q['pitfall'].startswith('区分概念、课程示例'):lines += ['**易错点：** '+q['pitfall'],'']
  for v in q.get('greenbook',[]):
   lines += [f'#### 绿皮书 {v["id"]} · {v["title"]}','',f'Onefly · CC BY-NC-SA 4.0 · [固定版本原文]({v["sourceUrl"]})','',v['markdown'],'']
  lines += ['#### 原题出处','']
  for pr in q['provenance']:
   if pr['kind']=='edited' and q['sourceKinds']!=['edited']:continue
   lines += ['- '+labels[pr['kind']]+'：'+pr['title']+'；'+pr.get('statement','')]
   if pr.get('document')=='user-pdf':lines += [f'  - [PDF {pr["sourceId"]} 第{pr["pageStart"]}–{pr["pageEnd"]}页](materials/agent-interview-source.pdf#page={pr["pageStart"]})']
   lines += [f'  - [原始链接]({u})' for u in pr.get('urls',[])]
  lines += ['','**技术参考：** '+' · '.join(f'[{d["references"][r]["label"]}]({d["references"][r]["url"]})' for r in q['refs']),'']
(root/'题库汇总.md').write_text('\n'.join(lines),encoding='utf-8')
D=d['dedup'];report=[f'# 原题到去重题的对照 · V{d["version"]}','',f'累计输入{D["inputCount"]}条（旧版128 + 用户PDF116 + 绿皮书828），去重后{D["outputCount"]}个主条目，累计合并{D["mergedCount"]}条。','',f'本轮：原182题 + 绿皮书828条 → {D["outputCount"]}题；新增{D["newUniqueCount"]}个主条目，合并{D["newMergedCount"]}条。绿皮书828条关联{D["greenbookCanonicalCount"]}个主题；仓库网页与同版本PDF不重复计数。','',D['criteria'],'','旧题收藏/状态按原题号和aliases继续使用；已有182个主条目均保留。每条来源问法和完整回答都可在对应主条目查看。','']
for kind,title in [('greenbook','绿皮书828题完整去向'),('pdf','用户PDF116题完整去向'),('v1','旧版128题完整去向')]:
 report += ['## '+title,'','| 原题号 | 原题标题 | 主条目 | 决策 / 依据 |','| --- | --- | --- | --- |']
 for r in [r for r in D['records'] if r['kind']==kind]:
  note=r.get('reason',f'用户PDF第{r.get("pageStart","")}–{r.get("pageEnd","")}页' if kind=='pdf' else '保留或迁移原题号')
  report += [f'| {r["sourceId"]} | {r["title"].replace("|","/")} | [{r["canonicalId"]}](index.html#{r["canonicalId"]}) | {note.replace("|","/")} |']
 report += ['']
report += ['## 全部合并组','']
for g in D['groups']:
 report += [f'### {g["canonicalId"]} · {g["title"]}','']
 report += ['- '+r['kind']+' '+r['sourceId']+'：'+r['title'] for r in g['records']]+['']
(root/'去重对照表.md').write_text('\n'.join(report),encoding='utf-8')
print(f'已同步{len(d["questions"])}题、完整Markdown及{len(D["records"])}条原题去向。')

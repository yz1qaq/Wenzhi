(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WenzhiStudy = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const DAY = 86400000;
  const MAX_HISTORY = 200;
  const MAX_ITEMS = 10000;
  const LEVELS = new Set(['low', 'medium', 'high']);
  const SOURCES = new Set(['self', 'ai', 'legacy']);
  const DIMENSIONS = {correctness:40, completeness:30, reasoning:20, expression:10};
  const TEXT_LIMITS = {exerciseId:200, question:2000, answer:4000, feedback:2000};
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const fail = () => { throw new Error('学习记录格式无效：请检查题号、状态或评分'); };
  function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail();
    return value;
  }
  function id(value) {
    if (typeof value !== 'string' || !value.length || value.length > 200 ||
        value === '__proto__' || value === 'constructor' || value === 'prototype') fail();
    return value;
  }
  function timestamp(value, nullable=true) {
    if (nullable && value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8640000000000000) fail();
    return value;
  }
  function masteryFromScore(score) {
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) fail();
    return score < 60 ? 'low' : score < 85 ? 'medium' : 'high';
  }
  function emptyProgress() { return {version:2, bookmarks:[], records:{}, history:[], theme:'light'}; }
  function emptyRecord() { return {learned:false, mastery:null, score:null, source:null, updatedAt:null, nextReviewAt:null}; }
  function getRecord(progress, questionId) {
    id(questionId);
    return own(progress.records, questionId) ? {...progress.records[questionId]} : emptyRecord();
  }
  function statusOf(progress, questionId) {
    const r = getRecord(progress, questionId);
    return !r.learned ? 'new' : r.mastery || 'learned';
  }
  function validateRecord(value) {
    const r = object(value);
    if (typeof r.learned !== 'boolean' || (r.mastery !== null && !LEVELS.has(r.mastery)) ||
        (r.source !== null && !SOURCES.has(r.source))) fail();
    timestamp(r.updatedAt);
    timestamp(r.nextReviewAt);
    if (r.score !== null) {
      if (r.source !== 'ai' || masteryFromScore(r.score) !== r.mastery || !r.learned) fail();
    } else if (r.source === 'ai') fail();
    if (!r.learned && (r.mastery !== null || r.score !== null || r.nextReviewAt !== null)) fail();
    if (r.learned && r.source === null) fail();
    if ((r.mastery === null || r.mastery === 'low') && r.nextReviewAt !== null) fail();
    return {learned:r.learned, mastery:r.mastery, score:r.score, source:r.source,
      updatedAt:r.updatedAt, nextReviewAt:r.nextReviewAt};
  }
  function dimensions(value, score) {
    object(value);
    if (Object.keys(value).length !== 4) fail();
    const result = {};
    let total = 0;
    for (const [key, max] of Object.entries(DIMENSIONS)) {
      const number = value[key];
      if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > max) fail();
      result[key] = number;
      total += number;
    }
    if (Math.abs(total - score) > 1e-7) fail();
    return result;
  }
  function text(value, key, truncate) {
    if (typeof value !== 'string') fail();
    if (!truncate && value.length > TEXT_LIMITS[key]) fail();
    if (key === 'exerciseId' && !value.trim()) fail();
    return value.slice(0, TEXT_LIMITS[key]);
  }
  function historyEntry(value, canonical) {
    const r = validateRecord(value);
    if (!SOURCES.has(r.source)) fail();
    timestamp(r.updatedAt, false);
    const entry = {id:canonical(value.id), ...r};
    for (const key of Object.keys(TEXT_LIMITS)) {
      entry[key] = value[key] === null ? null : text(value[key], key, false);
    }
    if (r.source === 'ai') {
      if (!entry.exerciseId) fail();
      entry.dimensions = value.dimensions === null ? null : dimensions(value.dimensions, r.score);
    } else {
      if (entry.exerciseId !== null || value.dimensions !== null) fail();
      entry.dimensions = null;
    }
    return entry;
  }
  function canonicalizer(data) {
    object(data);
    if (!Array.isArray(data.questions)) fail();
    const ids = new Set(data.questions.map(q => id(q.id)));
    const aliases = data.aliases === undefined ? {} : object(data.aliases);
    return raw => {
      id(raw);
      if (ids.has(raw)) return raw;
      const seen = new Set();
      let current = raw;
      while (own(aliases, current)) {
        if (seen.has(current)) fail();
        seen.add(current);
        current = id(aliases[current]);
        if (ids.has(current)) return current;
      }
      return fail();
    };
  }
  function historyKey(entry) {
    return entry.exerciseId ? 'exercise:' + entry.exerciseId : 'event:' + JSON.stringify(entry);
  }
  function deduplicateHistory(entries) {
    const found = new Set();
    return entries.filter(e => {
      const key = historyKey(e);
      if (found.has(key)) return false;
      found.add(key);
      return true;
    }).sort((a,b) => a.updatedAt - b.updatedAt).slice(-MAX_HISTORY);
  }
  function normalizeProgress(input, data) {
    object(input);
    if (![1,2].includes(input.version) || !Array.isArray(input.bookmarks) || input.bookmarks.length > MAX_ITEMS) fail();
    if (input.theme !== undefined && input.theme !== 'light' && input.theme !== 'dark') fail();
    const canonical = canonicalizer(data);
    const result = emptyProgress();
    result.theme = input.theme || 'light';
    result.bookmarks = [...new Set(input.bookmarks.map(canonical))];
    const rawRecords = object(input.version === 1 ? input.statuses : input.records);
    const entries = Object.entries(rawRecords);
    if (entries.length > MAX_ITEMS) fail();
    const converted = entries.map(([raw, value]) => {
      const canonicalId = canonical(raw);
      let record;
      if (input.version === 1) {
        if (!['new', 'learning', 'review', 'mastered'].includes(value)) fail();
        record = {...emptyRecord(), learned:value !== 'new',
          mastery:value === 'review' ? 'low' : value === 'mastered' ? 'high' : null, source:'legacy',
          nextReviewAt:value === 'mastered' ? 0 : null};
      } else record = validateRecord(value);
      return {raw, canonicalId, record};
    });
    // Canonical entries take precedence independently of object insertion order.
    for (const entry of converted.filter(e => e.raw === e.canonicalId)) result.records[entry.canonicalId] = entry.record;
    for (const entry of converted) if (!own(result.records, entry.canonicalId)) result.records[entry.canonicalId] = entry.record;
    if (input.version === 2) {
      if (!Array.isArray(input.history) || input.history.length > MAX_HISTORY) fail();
      result.history = deduplicateHistory(input.history.map(e => historyEntry(e, canonical)));
    }
    return result;
  }
  function updateProgress(progress, questionId, patch, now=Date.now()) {
    id(questionId);
    object(patch);
    timestamp(now, false);
    if (own(patch,'learned') && typeof patch.learned !== 'boolean') fail();
    if (own(patch,'mastery') && patch.mastery !== null && !LEVELS.has(patch.mastery)) fail();
    const source = patch.source === undefined ? 'self' : patch.source;
    if (!SOURCES.has(source)) fail();
    const previous = getRecord(progress, questionId);
    const mastery = own(patch,'mastery') ? patch.mastery : previous.mastery;
    const learned = patch.learned === undefined ? (mastery !== null || previous.learned) : patch.learned;
    let next = {...emptyRecord(), learned, mastery:learned ? mastery : null, source, updatedAt:now};
    if (source === 'ai') {
      if (!learned || !own(patch,'score') || masteryFromScore(patch.score) !== next.mastery) fail();
      next.score = patch.score;
    } else if (own(patch,'score') && patch.score !== null) fail();
    const entry = {id:questionId, ...next, exerciseId:null, question:null, answer:null, feedback:null, dimensions:null};
    for (const key of Object.keys(TEXT_LIMITS)) if (own(patch,key)) entry[key] = patch[key] === null ? null : text(patch[key],key,key !== 'exerciseId');
    if (source === 'ai') {
      if (!entry.exerciseId) fail();
      if (own(patch,'dimensions')) entry.dimensions = dimensions(patch.dimensions, next.score);
    } else if (entry.exerciseId !== null || (own(patch,'dimensions') && patch.dimensions !== null)) fail();
    // Retried grading must not replace a more recent manual or AI assessment.
    if (entry.exerciseId && progress.history.some(e => e.exerciseId === entry.exerciseId)) return progress;
    if (next.mastery === 'medium' || next.mastery === 'high') {
      next.nextReviewAt = now + (next.mastery === 'medium' ? 3 : 7)*DAY;
      timestamp(next.nextReviewAt,false);
    }
    entry.nextReviewAt = next.nextReviewAt;
    next = validateRecord(next);
    return {...progress, records:{...progress.records,[questionId]:next},
      bookmarks:[...progress.bookmarks], history:[...progress.history,entry].slice(-MAX_HISTORY)};
  }
  function isReviewDue(record, now=Date.now()) {
    timestamp(now,false);
    return record.learned && (record.mastery === 'low' ||
      ((record.mastery === 'medium' || record.mastery === 'high') && record.nextReviewAt !== null && record.nextReviewAt <= now));
  }
  function selectQuestion(questions, progress, options={}) {
    if (!questions.length) return null;
    const eligible = questions.length > 1 ? questions.filter(q => q.id !== options.excludeId) : questions;
    const pool = eligible.length ? eligible : questions;
    if (options.mode !== undefined && !['uniform','weighted'].includes(options.mode)) fail();
    const random = options.random || Math.random;
    const draw = random();
    if (typeof draw !== 'number' || !Number.isFinite(draw) || draw < 0 || draw >= 1) fail();
    const now = options.now === undefined ? Date.now() : options.now;
    const weights = pool.map(q => {
      if (options.mode === 'uniform') return 1;
      const r = getRecord(progress,q.id);
      if (!r.learned) return 5;
      if (r.mastery === 'low') return 6;
      if (r.mastery === null) return 4;
      return isReviewDue(r,now) ? 3 : r.mastery === 'medium' ? 2 : 1;
    });
    let target = draw * weights.reduce((sum,w) => sum+w,0);
    for (let i=0;i<pool.length;i++) {
      target -= weights[i];
      if (target < 0) return pool[i];
    }
    return pool[pool.length-1];
  }
  function counts() { return {total:0,learned:0,unlearned:0,unrated:0,low:0,medium:0,high:0,reviewDue:0}; }
  function countQuestion(bucket, record, now) {
    bucket.total++;
    if (!record.learned) bucket.unlearned++;
    else {
      bucket.learned++;
      if (record.mastery === null) bucket.unrated++;
      else bucket[record.mastery]++;
      if (isReviewDue(record,now)) bucket.reviewDue++;
    }
  }
  function localDate(time) {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function summarize(questions, progress, now=Date.now()) {
    timestamp(now,false);
    const summary = counts();
    const categories = new Map();
    const poolIds = new Set();
    for (const q of questions) {
      if (poolIds.has(q.id)) continue;
      poolIds.add(q.id);
      const record = getRecord(progress,q.id);
      const category = q.category || '未分类';
      if (!categories.has(category)) categories.set(category,{category,...counts()});
      countQuestion(summary,record,now);
      countQuestion(categories.get(category),record,now);
    }
    const history = progress.history.filter(e => poolIds.has(e.id));
    const aiHistory = history.filter(e => e.source === 'ai' && e.score !== null);
    summary.aiAttempts = aiHistory.length;
    summary.averageScore = aiHistory.length ? aiHistory.reduce((sum,e) => sum+e.score,0)/aiHistory.length : null;
    summary.byCategory = [...categories.values()];
    const today = new Date(now);
    summary.trend = Array.from({length:14},(_,index) => {
      const day = new Date(today.getFullYear(),today.getMonth(),today.getDate() - 13 + index);
      return {date:localDate(day.getTime()),count:0};
    });
    const dates = new Map(summary.trend.map(day => [day.date,day]));
    for (const entry of history) {
      const day = dates.get(localDate(entry.updatedAt));
      if (day) day.count++;
    }
    summary.recent = history.slice().sort((a,b) => a.updatedAt-b.updatedAt).reverse().slice(0,20).map(e => ({...e,dimensions:e.dimensions ? {...e.dimensions} : null}));
    return summary;
  }
  function mergeProgress(current, incoming, data) {
    const a = normalizeProgress(current,data);
    const b = normalizeProgress(incoming,data);
    return {version:2,bookmarks:[...new Set([...a.bookmarks,...b.bookmarks])],records:{...a.records,...b.records},
      history:deduplicateHistory([...a.history,...b.history]),theme:b.theme};
  }
  return {emptyProgress,normalizeProgress,getRecord,statusOf,updateProgress,isReviewDue,
    selectQuestion,summarize,mergeProgress,masteryFromScore};
});

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MindCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // All moods start at the same comfort default: a feeling is not a health score.
  const MOODS = Object.freeze([
    { id: 0, name: '低落', icon: '🌧️', color: '#899bb4', comfortDefault: 5 },
    { id: 1, name: '焦虑', icon: '🌪️', color: '#b6a3bf', comfortDefault: 5 },
    { id: 2, name: '平静', icon: '🌤️', color: '#93ad99', comfortDefault: 5 },
    { id: 3, name: '开心', icon: '☀️', color: '#dec278', comfortDefault: 5 },
    { id: 4, name: '充满能量', icon: '🌈', color: '#d7a582', comfortDefault: 5 },
    { id: 5, name: '烦躁', icon: '🌩️', color: '#bf9088', comfortDefault: 5 }
  ].map(Object.freeze));
  const TAGS = Object.freeze(['学业', '工作', '人际关系', '亲密关系', '睡眠', '身体状态', '独处', '生活小事']);
  const NEEDS = Object.freeze(['想被听见', '让自己平静', '恢复一点能量', '理清思绪', '留住好时刻']);
  const ACTIVITIES = Object.freeze([
    {
      id: 'breathe', title: '1 分钟呼吸', category: '冥想', duration: 60,
      description: '给自己一个短暂停顿，按舒服的节奏呼吸。', color: '#dce9d9', icon: '◌',
      steps: ['找到一个舒服、安稳的姿势。', '自然吸气，再缓缓呼气，不需要屏息。', '走神时，温柔地把注意力带回呼吸。', '不适时随时停止，按照自己的节奏就好。']
    },
    {
      id: 'ground', title: '2 分钟感官着陆', category: '冥想', duration: 120,
      description: '用眼前能感受到的小事，把注意力带回此刻。', color: '#e5e6d6', icon: '◎',
      steps: ['看看周围，找到 5 样看得见的东西。', '留意 4 种触感，比如衣服、椅子或脚下的地面。', '听听 3 种声音，再留意 2 种气味。', '感受 1 种味道，或喝一小口水；没有感觉也可以跳过。']
    },
    {
      id: 'sound', title: '3 分钟舒缓音乐', category: '音乐', duration: 180,
      description: '听一段轻柔的声音，暂时不必处理任何事情。', color: '#e9e2ed', icon: '♫',
      steps: ['把音量调到舒服的大小。', '听一听声音的起伏，不需要努力专注。', '让念头来去，想暂停时随时暂停。', '结束后留意一下，此刻的感受有没有变化。']
    },
    {
      id: 'walk', title: '5 分钟散步', category: '运动', duration: 300,
      description: '如果环境和身体状态允许，走一小段属于自己的路。', color: '#dfebdc', icon: '↟',
      steps: ['选择安全、熟悉的地方，室内也可以。', '按舒服的速度慢慢走，留意脚落地的感觉。', '看看沿途的颜色、光线和形状。', '五分钟后停一停，喝点水，感受一下身体。']
    },
    {
      id: 'stretch', title: '2 分钟舒展', category: '运动', duration: 120,
      description: '坐着也可以，让紧绷的肩膀和手臂休息一会儿。', color: '#efe3d4', icon: '⤴',
      steps: ['坐稳或站稳，松开双手。', '轻轻抬起肩膀，再放下，动作保持舒服。', '缓慢伸展手臂和手指，不追求幅度。', '任何动作引起疼痛或不适，就停止这个动作。']
    },
    {
      id: 'write', title: '3 分钟自我关怀写作', category: '书写', duration: 180,
      description: '像对待朋友一样，给此刻的自己写几句话。', color: '#eee7d8', icon: '✎',
      steps: ['写下：刚刚发生了什么？只写你愿意写的。', '写下：我现在有什么感受，最需要什么？', '想象一位朋友有相同的经历，你会怎样回应？', '把这句话送给自己，再选一件做得到的小事。']
    }
  ].map(activity => Object.freeze({ ...activity, steps: Object.freeze(activity.steps) })));

  const activityIds = new Set(ACTIVITIES.map(activity => activity.id));
  const validComfort = value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 10;
  const validMood = value => Number.isInteger(value) && value >= 0 && value < MOODS.length;
  const mean = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null;

  function dateValue(value) {
    if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function localDay(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function knownTags(entry) {
    return [...new Set(Array.isArray(entry && entry.tags) ? entry.tags.filter(tag => TAGS.includes(tag)) : [])];
  }

  function isBetter(session) {
    if (session.feedback === 'better') return true;
    if (session.feedback === 'same' || session.feedback === 'worse') return false;
    return validComfort(session.beforeComfort) && validComfort(session.afterComfort) && session.afterComfort > session.beforeComfort;
  }

  function recommend(entry, sessions = []) {
    const current = entry && typeof entry === 'object' ? entry : {};
    const selectedTags = knownTags(current);
    const scores = Object.fromEntries(ACTIVITIES.map(activity => [activity.id, { score: 0, reasons: [] }]));
    function add(id, points, reason) {
      scores[id].score += points;
      if (reason && !scores[id].reasons.includes(reason)) scores[id].reasons.push(reason);
    }

    const needRules = {
      '想被听见': [['write', 9], ['sound', 4], ['ground', 2]],
      '让自己平静': [['breathe', 8], ['ground', 7], ['sound', 6]],
      '恢复一点能量': [['stretch', 8], ['walk', 7], ['sound', 3]],
      '理清思绪': [['write', 9], ['ground', 6], ['walk', 3]],
      '留住好时刻': [['write', 9], ['walk', 5], ['sound', 3]]
    };
    (needRules[current.need] || []).forEach(([id, points]) => add(id, points, '你希望「' + current.need + '」'));
    const moodRules = [
      [['write', 4], ['sound', 5], ['stretch', 3]],
      [['breathe', 6], ['ground', 6], ['sound', 3]],
      [['write', 4], ['sound', 4], ['walk', 3]],
      [['write', 6], ['walk', 4], ['sound', 3]],
      [['walk', 6], ['stretch', 4], ['write', 3]],
      [['ground', 6], ['breathe', 5], ['walk', 4]]
    ];
    if (validMood(current.mood)) {
      moodRules[current.mood].forEach(([id, points]) => add(id, points, '你记录了「' + MOODS[current.mood].name + '」的感受'));
    }
    const tagRules = {
      '学业': [['breathe', 3], ['ground', 2], ['write', 2]],
      '工作': [['stretch', 4], ['walk', 3], ['breathe', 2]],
      '人际关系': [['write', 5], ['ground', 3]],
      '亲密关系': [['write', 5], ['ground', 3]],
      '睡眠': [['sound', 6], ['breathe', 3]],
      '身体状态': [['stretch', 5], ['sound', 3]],
      '独处': [['sound', 4], ['write', 3]],
      '生活小事': [['write', 3], ['walk', 2]]
    };
    selectedTags.forEach(tag => tagRules[tag].forEach(([id, points]) => add(id, points, '你提到了「' + tag + '」')));
    if (typeof current.intensity === 'number' && current.intensity >= 8 && current.intensity <= 10) {
      add('ground', 4, '你标记的情绪强度较高，可以先做一个短练习');
      add('breathe', 3, '你标记的情绪强度较高，可以先做一个短练习');
    }
    if (validComfort(current.comfort) && current.comfort <= 4) {
      add('ground', 3, '你给此刻的舒适度打了 ' + current.comfort + ' 分，可以从眼前的小事开始');
      add('sound', 2, '你给此刻的舒适度打了 ' + current.comfort + ' 分，可以留一点休息时间');
    }

    const helpfulIds = new Set((Array.isArray(sessions) ? sessions : []).filter(session => session && activityIds.has(session.activityId) && isBetter(session)).map(session => session.activityId));
    helpfulIds.forEach(id => add(id, 2, '你曾在这项练习后反馈好一些，或记录了更高的舒适度'));
    const purposes = {
      breathe: '试试用一分钟留意呼吸，按自己的节奏就好。',
      ground: '可以留意身边的颜色、触感与声音，把注意力带回此刻。',
      sound: '可以听一段轻柔声音，给自己一点安静的时间。',
      walk: '如果身体和环境允许，可以用一小段散步换个节奏。',
      stretch: '如果身体允许，可以轻轻舒展肩膀和手臂。',
      write: '可以把感受和需要写下来，像回应朋友一样回应自己。'
    };
    return ACTIVITIES.map((activity, order) => ({ activity, order, ...scores[activity.id] }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, 3)
      .map(item => ({ activityId: item.activity.id, reason: (item.reasons.slice(0, 2).join('；') || '从一件此刻做得到的小事开始') + '。' + purposes[item.activity.id] }));
  }

  function summarize(entries, sessions = [], days = 7, now = new Date()) {
    const end = dateValue(now) || new Date(0);
    const length = Number.isFinite(days) ? Math.min(366, Math.max(1, Math.floor(days))) : 7;
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - length + 1);
    const inWindow = item => {
      const date = item && dateValue(item.date);
      return date && date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
    };
    const rows = (Array.isArray(entries) ? entries : []).filter(entry => entry && validMood(entry.mood) && inWindow(entry));
    const practiceRows = (Array.isArray(sessions) ? sessions : []).filter(session => session && activityIds.has(session.activityId) && inWindow(session));
    const scored = rows.filter(entry => validComfort(entry.comfort));
    const series = Array.from({ length }, (_, index) => {
      const day = new Date(start);
      day.setDate(day.getDate() + index);
      const key = localDay(day);
      const dayRows = rows.filter(entry => localDay(dateValue(entry.date)) === key);
      return { date: key, label: (day.getMonth() + 1) + '/' + day.getDate(), count: dayRows.length, average: mean(dayRows.filter(entry => validComfort(entry.comfort)).map(entry => entry.comfort)) };
    });
    const triggerMap = new Map();
    rows.forEach(entry => knownTags(entry).forEach(tag => {
      const trigger = triggerMap.get(tag) || { tag, count: 0, uncomfortableCount: 0 };
      trigger.count += 1;
      if (validComfort(entry.comfort) && entry.comfort <= 4) trigger.uncomfortableCount += 1;
      triggerMap.set(tag, trigger);
    }));
    const topTriggers = [...triggerMap.values()].sort((a, b) => b.count - a.count || TAGS.indexOf(a.tag) - TAGS.indexOf(b.tag));
    const moodCounts = MOODS.map(mood => ({ mood: mood.id, count: rows.filter(entry => entry.mood === mood.id).length }));
    const helpful = ACTIVITIES.map(activity => {
      const activityRows = practiceRows.filter(session => session.activityId === activity.id);
      return { activityId: activity.id, total: activityRows.length, better: activityRows.filter(isBetter).length };
    }).filter(activity => activity.total > 0).sort((a, b) => b.better - a.better || b.total - a.total);
    const observations = [];
    if (!rows.length) {
      observations.push({ title: '这段时间，还没有情绪记录', text: '留下一条此刻的感受就可以开始。不需要补齐空白的日子。' });
    } else if (rows.length < 3) {
      observations.push({ title: '先收藏感受，不急着下结论', text: '这段时间只有 ' + rows.length + ' 条记录，暂时不足以看出稳定的规律。每一次记录都可以只为了解当下。' });
    } else {
      observations.push({ title: '你为自己留出了 ' + series.filter(day => day.count > 0).length + ' 天', text: '这 ' + length + ' 天里，你记录了 ' + rows.length + ' 次感受。记录不必连续，也不需要每天都有相同的心情。' });
    }
    if (rows.length && !scored.length) {
      observations.push({ title: '旧日记被完整保留', text: '这些记录还没有独立的舒适度评分，所以图表保持留白。我们不会把某一种情绪换算成舒适度。' });
    } else if (scored.length) {
      observations.push({ title: '舒适度是你自己的感受刻度', text: '在 ' + scored.length + ' 条有评分的记录中，平均舒适度为 ' + mean(scored.map(entry => entry.comfort)) + ' / 10。' + (rows.length > scored.length ? '其余 ' + (rows.length - scored.length) + ' 条未评分记录没有参与计算。' : '') + '这不是心理健康分数，也不用和别人比较。' });
    }
    if (topTriggers.length) {
      const top = topTriggers[0];
      observations.push({ title: '你较常提到「' + top.tag + '」', text: '在本时段的 ' + rows.length + ' 条记录中，这个标签出现了 ' + top.count + ' 次；其中 ' + top.uncomfortableCount + ' 次同时记录了 1–4 分的舒适度。共同出现不代表因果，未评分的日记不计入后一个数字。' });
    }
    if (helpful.length) {
      const best = helpful[0];
      const activity = ACTIVITIES.find(item => item.id === best.activityId);
      observations.push({ title: '回看做过的小练习', text: '你在本时段完成了 ' + best.total + ' 次「' + activity.title + '」，其中 ' + best.better + ' 次反馈好一些，或在未选反馈时记录了更高的练习后舒适度。这是个人回顾，少量反馈不能说明效果稳定。' });
    }
    return {
      count: rows.length,
      activeDays: series.filter(day => day.count > 0).length,
      comfortAverage: mean(scored.map(entry => entry.comfort)),
      series, topTriggers, moodCounts, observations, helpful
    };
  }

  function demoData(now = new Date()) {
    const reference = dateValue(now) || new Date(0);
    const offsets = [0, 0, 1, 1, 2, 3, 3, 4, 5, 5, 6, 7, 7, 8, 9, 9, 10, 11, 12, 13];
    const scenes = [
      [2, 4, 7, ['生活小事', '独处'], '午后坐在窗边喝茶，终于有时间慢慢看一会儿天。', '留住好时刻'],
      [1, 7, 4, ['工作'], '汇报前担心准备得不够充分，想先把最重要的三点写清楚。', '理清思绪'],
      [3, 6, 8, ['人际关系'], '和老朋友聊了一会儿，发现有人愿意认真听我说话。', '留住好时刻'],
      [5, 7, 4, ['工作', '睡眠'], '昨晚睡得有些晚，今天连续开会，想给自己十分钟安静。', '让自己平静'],
      [0, 5, 4, ['学业'], '练习没有达到预期，有点失落，也想肯定自己已经做的准备。', '想被听见'],
      [4, 7, 8, ['身体状态', '生活小事'], '傍晚在公园走了一圈，回来还有精神做一点喜欢的事情。', '恢复一点能量'],
      [2, 3, 6, ['独处'], '关掉消息提醒，整理了书桌，安静地完成了一件小事。', '理清思绪'],
      [1, 6, 5, ['亲密关系'], '一条消息还没收到回复，忍不住反复看手机，想把注意力带回眼前。', '让自己平静'],
      [3, 5, 7, ['生活小事'], '尝试做的新菜还不错，给自己拍了一张小小的纪念照。', '留住好时刻'],
      [0, 4, 5, ['睡眠', '身体状态'], '醒来有些疲惫，决定今天少安排一点，把休息也写进计划里。', '恢复一点能量']
    ];
    const entries = offsets.map((offset, index) => {
      const date = new Date(reference);
      date.setDate(date.getDate() - offset);
      date.setHours(index % 2 ? 19 : 10, 15 + index, 0, 0);
      if (date > reference) date.setTime(reference.getTime() - (index + 1) * 60000);
      const [mood, intensity, comfort, tags, note, need] = scenes[index % scenes.length];
      return { id: 'demo-entry-' + index, date: date.toISOString(), mood, intensity, comfort, tags: [...tags], note: '【虚构示例】' + note, need };
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
    const sessions = [
      ['breathe', 1, 4, 6, 'better'],
      ['write', 3, 5, 6, 'better'],
      ['sound', 5, 5, 5, 'same'],
      ['walk', 7, 4, 7, 'better'],
      ['stretch', 9, 6, 6, 'same'],
      ['ground', 12, 4, 5, 'better']
    ].map(([activityId, offset, beforeComfort, afterComfort, feedback], index) => {
      const date = new Date(reference);
      date.setDate(date.getDate() - offset);
      date.setHours(20, 0, 0, 0);
      return { id: 'demo-session-' + index, activityId, date: date.toISOString(), beforeComfort, afterComfort, feedback, duration: ACTIVITIES.find(activity => activity.id === activityId).duration };
    });
    return { entries, sessions };
  }

  return Object.freeze({ MOODS, TAGS, NEEDS, ACTIVITIES, recommend, summarize, demoData });
});

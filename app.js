/* Mind Island — no network requests, no trackers, no remote AI calls. */
(() => {
  'use strict';
  const Core = window.MindCore;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const KEY = 'mind-island-v2';
  const pages = {today:'今日心情', journal:'我的日记', insights:'情绪洞察', care:'关怀空间'};
  const uid = prefix => prefix + '-' + (window.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2));
  const dayKey = value => {const d = new Date(value); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');};
  const validScore = x => typeof x === 'number' && Number.isFinite(x) && x >= 1 && x <= 10;
  const validId = x => (typeof x === 'number' || typeof x === 'string') && /^[a-zA-Z0-9_-]{1,100}$/.test(String(x));
  const blankDraft = () => ({mood:null, comfort:5, comfortUnrated:false, intensity:5, tags:[], note:'', need:'', editId:null});
  const blankData = () => ({version:2, entries:[], sessions:[], legacyCareCount:0, trash:[], draft:blankDraft(), previousDraft:null});
  let storageBroken = false, storageConflict = false, lastStorageRaw = null, demo = false, demoStore = null, period = 7, category = 'all';
  let toastTimer, draftTimer, undoTarget = null, currentPage = '', busySaving = false;

  function normalizeEntry(e) {
    if (!e || !validId(e.id) || !Number.isInteger(e.mood) || !Core.MOODS[e.mood] || typeof e.date !== 'string' || !Number.isFinite(Date.parse(e.date)) || typeof e.note !== 'string' || !Array.isArray(e.tags)) return null;
    return {id:String(e.id), date:new Date(e.date).toISOString(), mood:e.mood, comfort:validScore(e.comfort)?e.comfort:null, intensity:validScore(e.intensity)?e.intensity:5, tags:[...new Set(e.tags.filter(t=>Core.TAGS.includes(t)))], note:e.note.slice(0,2000), need:Core.NEEDS.includes(e.need)?e.need:''};
  }
  function normalizeSession(s) {
    if (!s || !validId(s.id) || !Core.ACTIVITIES.some(a=>a.id===s.activityId) || typeof s.date!=='string' || !Number.isFinite(Date.parse(s.date)) || typeof s.duration!=='number' || s.duration<1 || s.duration>86400) return null;
    return {id:String(s.id),activityId:s.activityId,date:new Date(s.date).toISOString(),duration:s.duration,beforeComfort:validScore(s.beforeComfort)?s.beforeComfort:null,afterComfort:validScore(s.afterComfort)?s.afterComfort:null,feedback:['better','same','worse'].includes(s.feedback)?s.feedback:null};
  }
  function normalizeDraft(d) {
    if (!d || typeof d!=='object') return blankDraft();
    return {mood:Number.isInteger(d.mood)&&Core.MOODS[d.mood]?d.mood:null,comfort:validScore(d.comfort)?d.comfort:5,comfortUnrated:d.comfortUnrated===true,intensity:validScore(d.intensity)?d.intensity:5,tags:Array.isArray(d.tags)?d.tags.filter(t=>Core.TAGS.includes(t)):[],note:typeof d.note==='string'?d.note.slice(0,2000):'',need:Core.NEEDS.includes(d.need)?d.need:'',editId:validId(d.editId)?String(d.editId):null};
  }
  function loadData() {
    const data = blankData();
    try {
      const raw = localStorage.getItem(KEY);
      lastStorageRaw = raw;
      const old = raw || localStorage.getItem('mind-island-v1');
      if (!old) return data;
      const parsed = JSON.parse(old);
      if (!parsed || !Array.isArray(parsed.entries)) throw new Error('Invalid saved data');
      data.entries = parsed.entries.map(normalizeEntry).filter(Boolean).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
      data.sessions = (Array.isArray(parsed.sessions)?parsed.sessions:[]).map(normalizeSession).filter(Boolean);
      data.legacyCareCount = Math.max(0,Math.floor(Number(raw?parsed.legacyCareCount:parsed.careCount)||0));
      data.draft = normalizeDraft(parsed.draft);
      data.previousDraft = parsed.previousDraft ? normalizeDraft(parsed.previousDraft) : null;
      data.trash = (Array.isArray(parsed.trash)?parsed.trash:[]).map(normalizeEntry).filter(Boolean).slice(0,10);
      if (data.draft.editId && !data.entries.some(e=>e.id===data.draft.editId)) data.draft.editId = null;
      if (data.previousDraft?.editId && !data.entries.some(e=>e.id===data.previousDraft.editId)) data.previousDraft.editId = null;
      return data;
    } catch {storageBroken=true; return data;}
  }
  const personal = loadData();
  const data = () => demo?demoStore:personal;
  let draft = {...personal.draft,tags:[...personal.draft.tags]};
  function updateStorageBanner() {
    $('storageBanner').hidden=!(storageBroken||storageConflict);
    $('storageBanner').textContent=storageConflict?'另一标签页已更新日记。为避免覆盖，本页改动只暂存；请先导出本页备份，再刷新查看最新数据。':'此浏览器暂时无法保存数据。你可以继续使用，请在离开前导出备份。';
  }
  function persist() {
    if (demo) return true;
    if (storageBroken||storageConflict) return false;
    try {
      if(localStorage.getItem(KEY)!==lastStorageRaw){storageConflict=true;updateStorageBanner();return false;}
      const nextRaw=JSON.stringify(personal);
      localStorage.setItem(KEY,nextRaw);lastStorageRaw=nextRaw;return true;
    }
    catch {storageBroken=true;updateStorageBanner();return false;}
  }
  function toast(text, undo=false) {
    clearTimeout(toastTimer);
    $('toastText').textContent=text;
    $('undoDelete').hidden=!undo;
    $('toast').classList.add('visible');
    toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),undo?10000:4500);
  }
  function icon(name) {
    const paths = {
      sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
      book:'<path d="M4 3h13a2 2 0 0 1 2 2v16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2ZM7 3v18M10 8h6m-6 4h6"/>',
      chart:'<path d="M3 3v18h18M6 15l5-6 4 3 6-8"/>',
      leaf:'<path d="M20 3C8 2 2 8 5 15c4 8 16 3 15-12ZM4 21L16 9"/>',
      sprout:'<path d="M12 22V11M12 15C5 16 2 11 3 6c8-1 11 4 9 9ZM12 11C11 4 16 2 21 3c0 7-3 9-9 8Z"/>',
      lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
      spark:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z"/>',
      heart:'<path d="M20 5c-3-3-7-1-8 2-1-3-5-5-8-2-5 5 3 11 8 15 5-4 13-10 8-15Z"/>',
      search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
      edit:'<path d="m14 4 6 6M4 20l5-1L21 7l-5-5L4 14v6Z"/>',
      trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
      arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>'
    };
    return '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.leaf)+'</svg>';
  }
  function face(mood, small=false) {
    const color = Core.MOODS[mood]?.color || '#93ad99';
    const eyes = mood===2?'<path d="M16 22h4m8 0h4"/>':mood===4?'<path d="m15 20 3-2 3 2m6 0 3-2 3 2"/>':'<circle cx="18" cy="22" r="1"/><circle cx="30" cy="22" r="1"/>';
    const mouths = ['M18 33q6-6 12 0','M18 31q3-3 6 0t6 0','M19 31q5 3 10 0','M17 29q7 10 14 0Z','M17 28q7 12 14 0Z','M18 32h12'];
    return '<svg class="mood-face'+(small?' small':'')+'" width="'+(small?36:42)+'" height="'+(small?36:42)+'" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="'+color+'" fill-opacity=".28"/><g fill="none" stroke="#4e6257" stroke-width="1.8" stroke-linecap="round">'+eyes+'<path d="'+mouths[mood]+'"/>'+(mood===5?'<path d="m15 17 7 3m4 0 7-3"/>':'')+'</g></svg>';
  }
  function decorate() {document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));}
  function syncDraft() {
    clearTimeout(draftTimer);
    draft.note=$('note').value; draft.comfort=Number($('comfort').value); draft.intensity=Number($('intensity').value);
    data().draft={...draft,tags:[...draft.tags]};
    const saved=persist();
    $('draftStatus').textContent=demo?'示例中的操作只保留在本次体验中':saved?'草稿已自动保存在此设备':'草稿仅暂存在页面，请勿关闭';
  }
  function drawForm() {
    const focused=document.activeElement;
    const focusSelector=focused?.dataset?.mood!==undefined?'[data-mood="'+focused.dataset.mood+'"]':focused?.dataset?.tag?'#tags [data-tag="'+focused.dataset.tag+'"]':focused?.dataset?.need?'[data-need="'+focused.dataset.need+'"]':null;
    $('moods').innerHTML=Core.MOODS.map(m=>'<button type="button" class="mood" data-mood="'+m.id+'" aria-pressed="'+(draft.mood===m.id)+'">'+face(m.id)+'<span class="mood-label">'+m.name+'</span></button>').join('');
    $('tags').innerHTML=Core.TAGS.map(t=>'<button type="button" data-tag="'+t+'" aria-pressed="'+draft.tags.includes(t)+'">'+t+'</button>').join('');
    $('needs').innerHTML=Core.NEEDS.map(n=>'<button type="button" data-need="'+n+'" aria-pressed="'+(draft.need===n)+'">'+n+'</button>').join('');
    $('comfort').value=draft.comfort; $('intensity').value=draft.intensity; $('note').value=draft.note;
    $('comfortValue').innerHTML=draft.comfortUnrated?'旧记录未评分':draft.comfort+' <small>/ 10</small>';
    $('intensityValue').textContent=draft.intensity+' / 10';
    $('noteCount').textContent=draft.note.length+' / 2000';
    $('checkinTitle').textContent=draft.editId?'重新看看，这一刻的心情':'此刻，我感觉……';
    $('save').innerHTML=(draft.editId?'保存修改':'保存心情，给自己一点关怀')+' <span>↗</span>';
    $('cancelEdit').hidden=!draft.editId;
    $('moodHint').textContent=draft.mood===null?'选一个最贴近的感受，就从这里开始。':'「'+Core.MOODS[draft.mood].name+'」被看见了。无论哪种感受，都可以留在这里。';
    renderSuggestedTags();
    if(focusSelector)document.querySelector(focusSelector)?.focus({preventScroll:true});
  }
  const keywordRules = [['工作',/工作|汇报|同事|老板|加班|职场|面试|项目/],['学业',/考试|学业|作业|论文|老师|课程|学习|笔试/],['人际关系',/朋友|社交|聚会|人际|室友/],['亲密关系',/伴侣|恋爱|分手|男友|女友|爱人/],['睡眠',/失眠|睡眠|熬夜|睡不|没睡|早醒/],['身体状态',/疲惫|身体|头痛|累了|生病/],['独处',/独处|一个人|安静/],['生活小事',/咖啡|喝茶|做饭|小猫|阳光|散步/]];
  function renderSuggestedTags() {
    const found=keywordRules.filter(([tag,re])=>!draft.tags.includes(tag)&&re.test(draft.note)).map(([tag])=>tag);
    $('suggestedTags').hidden=!found.length;
    $('suggestedTags').innerHTML='<span>文字中可能提到了 <small>点击确认才会加入</small></span><div>'+found.map(tag=>'<button type="button" data-tag="'+tag+'">＋ '+tag+'</button>').join('')+'</div>';
  }
  function openDialog(id) {const d=$(id);if(!d.open)d.showModal();}
  function navigate(id) {if(location.hash==='#'+id)route();else location.hash=id;}
  function route() {
    let name=location.hash.slice(1);if(!pages[name]){name='today';history.replaceState(null,'','#today');}
    const changed=currentPage!==name; currentPage=name;
    document.querySelectorAll('.page').forEach(p=>{p.hidden=p.id!==name;p.classList.toggle('active',p.id===name);});
    document.querySelectorAll('nav a').forEach(a=>{a.classList.toggle('active',a.dataset.page===name);if(a.dataset.page===name)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    $('pageLabel').textContent=pages[name]; document.title=pages[name]+' · 心屿';
    render(); if(changed)window.scrollTo({top:0,behavior:'instant'});
  }
  function render() {
    $('demoBanner').hidden=!demo; $('welcomeStrip').hidden=demo||personal.entries.length>0; updateStorageBanner();
    renderToday();
    if(currentPage==='journal')renderJournal();
    if(currentPage==='insights')renderInsights();
    if(currentPage==='care')renderCare();
  }
  function renderToday() {
    const d=data(), summary=Core.summarize(d.entries,d.sessions,7);
    $('total').textContent=d.entries.length; $('days').textContent=new Set(d.entries.map(e=>dayKey(e.date))).size;
    $('sessions').textContent=d.sessions.length+(d.legacyCareCount||0);
    $('weekDots').innerHTML=summary.series.map((day,i)=>'<div class="week-day"><span class="week-orb '+(day.count?'recorded ':'')+(i===6?'is-today':'')+'" title="'+day.label+' · '+day.count+' 条记录">'+(day.count?'<span aria-hidden="true">✳</span>':'<span aria-hidden="true">·</span>')+'</span><span class="week-label">'+(i===6?'今天':day.label)+'</span></div>').join('');
    $('weekHint').textContent=summary.activeDays?'近 7 天，你为自己留出了 '+summary.activeDays+' 天。每一次停下来，都算数。':'记录不需要连续，回来就很好。';
    const rec=Core.recommend(d.entries[0],d.sessions)[0], activity=Core.ACTIVITIES.find(a=>a.id===rec.activityId);
    $('todayRecommendation').innerHTML='<div class="small-rec-icon">'+icon('leaf')+'</div><div><span class="eyebrow">今天可以试试</span><h3>'+activity.title+'</h3><p>'+(d.entries.length?esc(rec.reason):'无需准备，给自己一个轻轻的停顿。')+'</p><button class="text-btn" data-start="'+activity.id+'">开始小练习 ↗</button></div>';
  }
  const supportive = ['低落的时候，不必勉强自己立刻好起来。能看见并记录感受，已经是在照顾自己。','紧张可能让很多想法同时涌来。我们可以先停一会儿，再看眼前最小的一件事。','平静的时刻，也值得被认真收藏。留意一下，是什么让你此刻感到踏实。','很高兴你留住了这个时刻。把让你开心的小事写下来，给未来的自己留一点光。','感受到这份活力了。把它留给喜欢的小事，也给自己保留休息的空间。','烦躁的时候，可以先给自己留一点距离。不必马上回应每件事情。'];
  function showResult(entry,saved,editing) {
    $('resultTitle').textContent=demo?'心情已留在示例体验中。':!saved?'这一刻，已暂存在页面。':editing?'这段记录，已更新。':'这一刻，被好好接住了。';
    $('resultText').textContent=supportive[entry.mood];
    const low=validScore(entry.comfort)&&entry.comfort<=3;
    const crisis=/自杀|伤害自己|不想活|结束生命/.test(entry.note);
    $('resultObservation').innerHTML=crisis?'<strong>如果这些文字反映了你此刻的处境</strong><p>当你担心自己的安全时，请立即联系当地紧急服务，并找可信任的人陪在身边。</p><button class="text-btn" data-action="support">获取更多支持 →</button>':'<strong>'+ (entry.need?'此刻，你希望「'+esc(entry.need)+'」':entry.tags.length?'你提到了「'+entry.tags.map(esc).join('、')+'」':'先从此刻的感受开始')+'</strong><p>'+(low?'你给舒适度打了 '+entry.comfort+' 分。可以先选择一个轻量练习；也可以直接找人陪一会儿。':entry.tags.length?'这是一条由你确认的生活线索。持续记录后，可以在「情绪洞察」里看看它什么时候出现。':'不需要给感受找一个确定的原因。愿意的话，先尝试一件小小的关怀。')+'</p>';
    $('resultRecommendations').innerHTML=Core.recommend(entry,data().sessions).map(rec=>{const a=Core.ACTIVITIES.find(a=>a.id===rec.activityId);return '<button class="result-rec" data-start="'+a.id+'"><span class="result-rec-icon">'+a.icon+'</span><span><strong>'+a.title+'</strong><small>'+esc(rec.reason)+'</small></span><span>↗</span></button>';}).join('');
    openDialog('result');
  }
  function saveEntry(event) {
    event.preventDefault();if(busySaving)return;
    syncDraft();
    if(draft.mood===null){$('formError').textContent='先选一个最贴近的情绪，再保存这段心情。';$('moods').querySelector('button').focus();return;}
    busySaving=true; $('formError').textContent='';
    const existing=draft.editId?data().entries.find(e=>e.id===draft.editId):null;
    const entry={id:existing?.id||uid('entry'),date:existing?.date||new Date().toISOString(),mood:draft.mood,comfort:draft.comfortUnrated?null:draft.comfort,intensity:draft.intensity,tags:[...draft.tags],note:draft.note.trim(),need:draft.need};
    if(existing)data().entries=data().entries.map(e=>e.id===entry.id?entry:e);else data().entries.unshift(entry);
    data().entries.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
    const restored=existing&&data().previousDraft?normalizeDraft(data().previousDraft):null;
    data().previousDraft=null;draft=restored||blankDraft();data().draft={...draft,tags:[...draft.tags]};
    const saved=persist();drawForm();render();showResult(entry,saved,!!existing);
    if(restored)toast('编辑已完成，编辑前的草稿已恢复到输入区');
    setTimeout(()=>busySaving=false,400);
  }
  function emptyState(title,text,extra='') {return '<div class="empty-state"><div class="empty-icon">'+icon('sprout')+'</div><h2>'+title+'</h2><p>'+text+'</p><div class="empty-actions"><a class="primary button" href="#today">写下此刻的心情 ↗</a>'+extra+'</div></div>';}
  function renderJournal() {
    const query=$('search').value.trim().toLocaleLowerCase(), filter=$('moodFilter').value;
    const all=data().entries, rows=all.filter(e=>(filter==='all'||String(e.mood)===filter)&&[e.note,Core.MOODS[e.mood].name,...e.tags,e.need].join(' ').toLocaleLowerCase().includes(query));
    $('journalCount').textContent='共 '+all.length+' 篇日记'+(query||filter!=='all'?' · 找到 '+rows.length+' 篇':'');
    if(!rows.length){$('journalList').innerHTML=all.length?'<div class="empty-state"><div class="empty-icon">'+icon('search')+'</div><h2>暂时没有找到这段心情</h2><p>换一个关键词，或清除情绪筛选试试。</p><button class="secondary" data-action="reset-search">清除筛选</button></div>':emptyState('故事，从这一刻开始。','不需要写得完整，也不必找到原因。选一个感受，就是一篇日记。','<button class="secondary" data-action="enter-demo">看看示例日记</button>');return;}
    let html='',lastDay='';
    rows.forEach(e=>{
      const day=dayKey(e.date), when=new Date(e.date), mood=Core.MOODS[e.mood];
      if(day!==lastDay){if(lastDay)html+='</div>';html+='<div class="journal-day"><h2>'+when.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})+(day===dayKey(new Date())?' <span class="pill">今天</span>':'')+'</h2>';lastDay=day;}
      html+='<article class="entry"><div class="entry-rail"><span class="entry-mood">'+face(e.mood,true)+'</span></div><div class="entry-body"><div class="entry-top"><div><strong>'+mood.name+'</strong><span class="entry-time">'+when.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+'</span></div><div class="entry-actions"><button class="icon-button" data-edit="'+esc(e.id)+'" aria-label="编辑'+esc(when.toLocaleString('zh-CN'))+'的日记">'+icon('edit')+'</button><button class="icon-button" data-delete="'+esc(e.id)+'" aria-label="删除'+esc(when.toLocaleString('zh-CN'))+'的日记">'+icon('trash')+'</button></div></div><p class="entry-note">'+esc(e.note||'今天没有写文字，但我认真看见了自己的感受。')+'</p><div class="entry-tags">'+e.tags.map(t=>'<span class="pill">'+t+'</span>').join('')+'</div><div class="entry-footer"><span>舒适度 '+(validScore(e.comfort)?e.comfort+' / 10':'未记录')+' <span class="divider">·</span> 情绪强度 '+e.intensity+' / 10</span>'+(e.need?'<span class="entry-need">♡ '+e.need+'</span>':'')+'</div></div></article>';
    });$('journalList').innerHTML=html+'</div>';
  }
  function drawChart(series) {
    const w=660,h=225,left=30,right=14,top=20,bottom=36,dx=(w-left-right)/Math.max(series.length-1,1), y=v=>top+(10-v)/9*(h-top-bottom);
    let svg='<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="近'+period+'天每日舒适度趋势；缺失日期不连线">';
    [1,4,7,10].forEach(n=>svg+='<line x1="'+left+'" y1="'+y(n)+'" x2="'+(w-right)+'" y2="'+y(n)+'" stroke="#e8ece5" stroke-dasharray="3 5"/><text x="8" y="'+(y(n)+4)+'" fill="#7b867e" font-size="11">'+n+'</text>');
    let segment=[];const flush=()=>{if(segment.length>1)svg+='<polyline points="'+segment.join(' ')+'" fill="none" stroke="#638c72" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';segment=[];};
    series.forEach((d,i)=>{if(d.average===null)flush();else segment.push((left+i*dx)+','+y(d.average));});flush();
    series.forEach((d,i)=>{const x=left+i*dx;if(d.average!==null)svg+='<circle cx="'+x+'" cy="'+y(d.average)+'" r="'+(period===7?5:3.5)+'" fill="#638c72" stroke="#fff" stroke-width="2" tabindex="0" role="img" aria-label="'+d.date+'，平均舒适度'+d.average+'，'+d.count+'条记录"><title>'+d.date+' · '+d.average+' / 10 · '+d.count+' 条</title></circle>';else svg+='<circle cx="'+x+'" cy="'+y(1)+'" r="2" fill="#d9e0d5"/>';if(period===7||i%5===0||i===series.length-1)svg+='<text x="'+x+'" y="'+(h-9)+'" text-anchor="middle" fill="#7b867e" font-size="11">'+d.label+'</text>';});
    svg+='</svg><details class="chart-data"><summary>查看逐日数据</summary><table><thead><tr><th>日期</th><th>记录数</th><th>平均舒适度</th></tr></thead><tbody>'+series.map(d=>'<tr><td>'+d.date+'</td><td>'+d.count+'</td><td>'+(d.average===null?'未记录':d.average+' / 10')+'</td></tr>').join('')+'</tbody></table></details>';
    return svg;
  }
  function renderInsights() {
    const s=Core.summarize(data().entries,data().sessions,period);
    const hasSessions=s.helpful.length>0;
    $('insightsEmpty').innerHTML=s.count||hasSessions?'':emptyState('每一个发现，都从一次记录开始。','记录后，你会在这里看到情绪分布、生活线索，以及自己觉得有帮助的练习。','<button class="secondary" data-action="enter-demo">体验一段示例故事</button>');
    $('insightsContent').hidden=!s.count&&!hasSessions;
    $('insightStats').innerHTML=[['为自己停留',s.activeDays,'个记录日 / 近 '+period+' 天'],['留下感受',s.count,'条情绪记录'],['平均舒适度',s.comfortAverage===null?'—':s.comfortAverage,'仅统计已评分记录 / 10'],['关怀小行动',s.helpful.reduce((n,a)=>n+a.total,0),'次已记录的练习']].map(([label,value,sub])=>'<div class="metric-card"><span class="metric-label">'+label+'</span><b>'+value+'</b><small>'+sub+'</small></div>').join('');
    $('chart').innerHTML=drawChart(s.series);
    $('moodDistribution').innerHTML=s.moodCounts.map(m=>'<div class="distribution-item"><span class="distribution-face">'+face(m.mood,true)+'</span><span class="distribution-label">'+Core.MOODS[m.mood].name+'</span><div class="distribution-track"><i style="width:'+(s.count?m.count/s.count*100:0)+'%;background:'+Core.MOODS[m.mood].color+'"></i></div><span class="distribution-count">'+m.count+' 次</span></div>').join('');
    $('triggers').innerHTML=s.topTriggers.length?s.topTriggers.map((t,i)=>'<div class="trigger-row"><div class="trigger-top"><span class="trigger-name"><small>0'+(i+1)+'</small> '+t.tag+'</span><span>'+t.count+' 次</span></div><div class="track"><i style="width:'+(t.count/Math.max(1,s.count)*100)+'%"></i></div><p class="trigger-note">其中 '+t.uncomfortableCount+' 次舒适度为 1–4 分</p></div>').join(''):'<p class="muted">在日记中选一个影响你的生活因素，线索会慢慢浮现。</p>';
    $('observations').innerHTML=s.observations.map((o,i)=>'<div class="observation-item"><span class="observation-number">0'+(i+1)+'</span><div><h3>'+esc(o.title)+'</h3><p>'+esc(o.text)+'</p></div></div>').join('');
    $('helpful').innerHTML=s.helpful.length?s.helpful.map(h=>{const a=Core.ACTIVITIES.find(a=>a.id===h.activityId);return '<div class="helpful-item"><span class="helpful-icon" style="background:'+a.color+'">'+a.icon+'</span><div class="helpful-copy"><strong>'+a.title+'</strong><span>完成 '+h.total+' 次 · '+h.better+' 次感觉好一些</span></div><span class="helpful-rate">'+h.better+'<small> / '+h.total+'</small></span><button class="text-btn" data-start="'+a.id+'">再试试 ↗</button></div>';}).join(''):'<div class="helpful-empty"><span>'+icon('leaf')+'</span><p>练习后花几秒记录感受，适合你的方法就会慢慢浮现。</p><a class="text-btn" href="#care">开始第一次关怀 →</a></div>';
  }
  function activityArt(id) {
    const art={
      breathe:'<circle cx="100" cy="70" r="47" fill="none" stroke="#7b9f83" opacity=".2"/><circle cx="100" cy="70" r="35" fill="#9ebc9b" opacity=".35"/><circle cx="100" cy="70" r="23" fill="#789e7e" opacity=".6"/>',
      ground:'<ellipse cx="100" cy="104" rx="45" ry="12" fill="#92a184" opacity=".25"/><path d="M65 97c-8-15 4-32 20-29 5-29 42-29 43-2 25 2 24 37-1 38H80Z" fill="#a8b293"/><path d="M89 70c-3-20 24-22 27-4" stroke="#738566" stroke-width="2" fill="none"/>',
      sound:Array.from({length:11},(_,i)=>'<rect x="'+(42+i*11)+'" y="'+(70-[12,25,38,21,46,33,46,21,38,25,12][i]/2)+'" width="4" height="'+[12,25,38,21,46,33,46,21,38,25,12][i]+'" rx="2" fill="#9b88a6"/>').join(''),
      walk:'<circle cx="143" cy="35" r="16" fill="#e7c995"/><path d="M25 107Q64 45 105 93T177 79v43H25Z" fill="#a5b798"/><path d="M80 120q-40-25 22-37t-14-28" stroke="#e9ebd5" stroke-width="8" fill="none"/>',
      stretch:'<circle cx="100" cy="39" r="11" fill="#b89173"/><path d="M100 57v36m-28-31 28 9 28-9m-42 55 14-24 14 24" stroke="#b89173" stroke-width="7" stroke-linecap="round"/><path d="M65 45q-9 13-5 25m75-25q9 13 5 25" stroke="#d8bba1" stroke-width="2" fill="none"/>',
      write:'<rect x="64" y="28" width="72" height="89" rx="4" fill="#fcf9ed" transform="rotate(-7 100 70)"/><path d="M80 51h40M80 63h28M80 75h37M80 87h24" stroke="#b6ac8b" stroke-width="2"/><path d="m124 95 22-53 6 3-22 52-7 5Z" fill="#9eaa83"/>'
    };return '<svg viewBox="0 0 200 140" aria-hidden="true">'+art[id]+'</svg>';
  }
  function renderCare() {
    const recs=Core.recommend(data().entries[0],data().sessions),latest=data().entries[0];
    $('careIntroTitle').textContent=latest?'为「'+Core.MOODS[latest.mood].name+'」的此刻，留一点空间':'从你愿意尝试的小事开始';
    $('careReason').textContent=latest?'结合你最近记录的感受'+(latest.tags.length?'和「'+latest.tags.join('、')+'」标签':'')+'，这里有几个可以自由选择的方向。':'无需完成所有练习。选一种方式，舒服地做一点就好。';
    const maxMinutes=Number($('careDuration').value);
    const activities=[...Core.ACTIVITIES].sort((a,b)=>{const ia=recs.findIndex(r=>r.activityId===a.id),ib=recs.findIndex(r=>r.activityId===b.id);return(ia<0?99:ia)-(ib<0?99:ib);}).filter(a=>(category==='all'||a.category===category)&&a.duration<=maxMinutes*60);
    $('careGrid').innerHTML=activities.length?activities.map(a=>{const rec=recs.find(r=>r.activityId===a.id);return '<article class="care-card" data-activity="'+a.id+'"><div class="activity-art '+a.id+'" style="background:'+a.color+'">'+activityArt(a.id)+(rec&&latest?'<span class="recommended-badge">适合此刻</span>':'')+'</div><div class="activity-body"><div class="activity-meta"><span>'+a.category+'</span><span>'+a.duration/60+' 分钟</span></div><h2>'+a.title+'</h2><p>'+a.description+'</p>'+(rec&&latest?'<div class="recommend-reason"><span>为什么推荐</span>'+esc(rec.reason)+'</div>':'')+'<div class="activity-footer"><span class="activity-duration">随时可以暂停</span><button class="primary" data-start="'+a.id+'">开始练习 ↗</button></div></div></article>';}).join(''):'<div class="empty-state"><h2>这个时间里，暂时没有匹配的练习</h2><p>可以放宽时间，或从 1 分钟呼吸开始。</p><button class="secondary" data-action="reset-care">查看全部练习</button></div>';
  }
  function beginPractice(id) {if($('result').open)$('result').close();window.CarePlayer.open(id);}
  function switchDemo(on) {
    document.querySelectorAll('.app-dialog[open]').forEach(dialog=>dialog.close());
    syncDraft();undoTarget=null;window.CarePlayer.stop();
    if(on){demoStore={...blankData(),...Core.demoData()};demo=true;}else demo=false;
    draft={...data().draft,tags:[...data().draft.tags]};drawForm();render();
    toast(on?'已进入虚构示例体验，你的个人日记保持不变':'已回到你的个人空间');
    if(on)navigate('insights');
  }
  function editEntry(id) {
    const entry=data().entries.find(e=>e.id===id);if(!entry)return;
    if(!draft.editId&&!data().previousDraft&&(draft.note||draft.mood!==null||draft.tags.length||draft.need)){syncDraft();toast('当前草稿已保留，完成或取消编辑后会恢复');data().previousDraft={...draft,tags:[...draft.tags]};}
    draft={...entry,tags:[...entry.tags],comfort:validScore(entry.comfort)?entry.comfort:5,comfortUnrated:!validScore(entry.comfort),editId:entry.id};drawForm();syncDraft();navigate('today');$('checkin').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function deleteEntry(id) {
    const d=data(),entry=d.entries.find(e=>e.id===id);if(!entry)return;
    d.entries=d.entries.filter(e=>e.id!==id);d.trash=[entry,...d.trash].slice(0,10);undoTarget={store:d,entry};
    if(draft.editId===id){draft=d.previousDraft?normalizeDraft(d.previousDraft):blankDraft();d.previousDraft=null;d.draft={...draft,tags:[...draft.tags]};drawForm();}
    persist();render();toast('这条日记已移出列表。',true);
  }
  function undoDelete() {
    if(!undoTarget||undoTarget.store!==data())return;
    const {store,entry}=undoTarget;if(!store.entries.some(e=>e.id===entry.id))store.entries.push(entry);
    store.entries.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));store.trash=store.trash.filter(e=>e.id!==entry.id);undoTarget=null;persist();render();toast('日记已恢复');
  }
  function exportData() {
    syncDraft();const d=data();const payload={product:'mind-island',version:2,dataKind:demo?'demo':'personal',exportedAt:new Date().toISOString(),entries:d.entries,sessions:d.sessions,legacyCareCount:d.legacyCareCount||0,draft:d.draft,previousDraft:d.previousDraft||null};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='心屿-'+(demo?'虚构示例':'日记备份')+'-'+dayKey(new Date())+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(demo?'已导出虚构示例文件':'备份已导出，请妥善保管');
  }
  async function importData(file) {
    if(!file)return;if(demo){toast('请先退出示例体验，再导入个人备份');return;}
    if(file.size>5*1024*1024){toast('文件超过 5 MB，请选择心屿导出的备份');return;}
    try {
      const parsed=JSON.parse(await file.text());
      if(parsed?.dataKind==='demo')throw new Error('示例数据不能导入个人日记');
      if(!parsed||!Array.isArray(parsed.entries)||parsed.entries.length>10000)throw new Error('这不是有效的心屿日记备份');
      const incoming=parsed.entries.map(normalizeEntry), rawSessions=Array.isArray(parsed.sessions)?parsed.sessions:[], incomingSessions=rawSessions.map(normalizeSession);
      if(incoming.some(e=>!e)||incomingSessions.some(s=>!s))throw new Error('备份含有无效记录，未导入任何内容');
      const ids=new Set(personal.entries.map(e=>e.id)),sessionIds=new Set(personal.sessions.map(s=>s.id));let count=0,sessionCount=0;
      incoming.forEach(e=>{if(!ids.has(e.id)){ids.add(e.id);personal.entries.push(e);count++;}});
      incomingSessions.forEach(s=>{if(!sessionIds.has(s.id)){sessionIds.add(s.id);personal.sessions.push(s);sessionCount++;}});
      personal.entries.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
      personal.legacyCareCount=Math.max(personal.legacyCareCount,Math.max(0,Math.floor(Number(parsed.legacyCareCount??parsed.careCount)||0)));
      const importedDraft=parsed.draft?normalizeDraft(parsed.draft):null;
      let restoredDraft=false;
      if(importedDraft&&!draft.note&&draft.mood===null&&!draft.tags.length&&!draft.need&&!draft.editId){
        if(importedDraft.editId&&!personal.entries.some(e=>e.id===importedDraft.editId))importedDraft.editId=null;
        draft=importedDraft;personal.draft={...draft,tags:[...draft.tags]};
        personal.previousDraft=parsed.previousDraft?normalizeDraft(parsed.previousDraft):null;
        if(personal.previousDraft?.editId&&!personal.entries.some(e=>e.id===personal.previousDraft.editId))personal.previousDraft.editId=null;
        drawForm();restoredDraft=true;
      }
      const saved=persist();render();toast('已'+(saved?'导入':'暂存')+' '+count+' 篇日记、'+sessionCount+' 次练习，重复记录已跳过'+(restoredDraft?'；备份草稿已恢复':''));
    } catch(error){toast(error instanceof SyntaxError?'文件无法解析，请选择 JSON 格式的心屿备份':error.message);}
    finally{$('importFile').value='';}
  }
  const actions = {
    privacy:()=>openDialog('privacyDialog'),about:()=>openDialog('aboutDialog'),support:()=>{if($('result').open)$('result').close();openDialog('supportDialog');},
    'recommendation-info':()=>openDialog('aboutDialog'),'quick-breathe':()=>beginPractice('breathe'),
    'enter-demo':()=>switchDemo(true),'exit-demo':()=>switchDemo(false),export:exportData,
    import:()=>{if(demo)toast('请先退出示例体验，再导入个人备份');else $('importFile').click();},
    'result-journal':()=>{$('result').close();navigate('journal');},
    'reset-search':()=>{$('search').value='';$('moodFilter').value='all';renderJournal();},
    'reset-care':()=>{category='all';$('careDuration').value='99';document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.category==='all'));renderCare();},
    'copy-support':async()=>{try{await navigator.clipboard.writeText('我现在有点难受，不需要马上给我建议。你可以陪我说说话，或者陪我待一会儿吗？');toast('已复制，可以发给你信任的人');}catch{toast('无法自动复制，请长按或选中上面的文字复制');}}
  };
  document.addEventListener('click',event=>{
    if(event.target.closest('a.skip-link')){event.preventDefault();$('main').focus();return;}
    const target=event.target.closest('button');if(!target)return;
    if(target.dataset.action){actions[target.dataset.action]?.();return;}
    if(target.dataset.close){$(target.dataset.close).close();return;}
    if(target.dataset.start){beginPractice(target.dataset.start);return;}
    if(target.dataset.edit){editEntry(target.dataset.edit);return;}
    if(target.dataset.delete){deleteEntry(target.dataset.delete);return;}
    if(target.dataset.mood!==undefined){draft.mood=Number(target.dataset.mood);$('formError').textContent='';drawForm();syncDraft();return;}
    if(target.dataset.tag){const tag=target.dataset.tag;draft.tags=draft.tags.includes(tag)?draft.tags.filter(t=>t!==tag):[...draft.tags,tag];drawForm();syncDraft();return;}
    if(target.dataset.need){draft.need=draft.need===target.dataset.need?'':target.dataset.need;drawForm();syncDraft();return;}
    if(target.dataset.days){period=Number(target.dataset.days);document.querySelectorAll('[data-days]').forEach(b=>b.setAttribute('aria-pressed',b===target));renderInsights();return;}
    if(target.dataset.category){category=target.dataset.category;document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',b===target));renderCare();}
  });
  $('checkinForm').addEventListener('submit',saveEntry);
  $('note').addEventListener('input',()=>{draft.note=$('note').value;$('noteCount').textContent=draft.note.length+' / 2000';renderSuggestedTags();clearTimeout(draftTimer);draftTimer=setTimeout(syncDraft,350);});
  $('comfort').addEventListener('input',()=>{draft.comfort=Number($('comfort').value);draft.comfortUnrated=false;$('comfortValue').innerHTML=draft.comfort+' <small>/ 10</small>';syncDraft();});
  $('intensity').addEventListener('input',()=>{draft.intensity=Number($('intensity').value);$('intensityValue').textContent=draft.intensity+' / 10';syncDraft();});
  $('cancelEdit').addEventListener('click',()=>{draft=data().previousDraft?normalizeDraft(data().previousDraft):blankDraft();data().previousDraft=null;data().draft={...draft,tags:[...draft.tags]};drawForm();syncDraft();toast('已取消编辑，原草稿已恢复');});
  $('search').addEventListener('input',renderJournal);$('moodFilter').addEventListener('change',renderJournal);$('careDuration').addEventListener('change',renderCare);
  $('importFile').addEventListener('change',()=>importData($('importFile').files[0]));$('undoDelete').addEventListener('click',undoDelete);
  window.addEventListener('hashchange',route);window.addEventListener('pagehide',()=>{syncDraft();window.CarePlayer.stop();});
  window.addEventListener('storage',event=>{if((event.key===KEY||event.key===null)&&event.newValue!==lastStorageRaw){storageConflict=true;updateStorageBanner();if(!demo)toast('另一标签页已更新日记。本页改动暂存，请先导出备份，再刷新。');}});
  window.CarePlayer.init({getComfort:()=>{const latest=data().entries[0],age=latest?Date.now()-Date.parse(latest.date):Infinity;return latest&&validScore(latest.comfort)&&age>=0&&age<=3600000?latest.comfort:null;},onComplete:session=>{const normalized=normalizeSession(session);if(!normalized)return false;if(!data().sessions.some(s=>s.id===normalized.id))data().sessions.unshift(normalized);const saved=persist();render();toast(demo?'这次关怀已记入示例体验':saved?'这次关怀已记下。你的感受比完成练习更重要。':'关怀记录已暂存，请导出备份');return saved;}});
  $('moodFilter').insertAdjacentHTML('beforeend',Core.MOODS.map(m=>'<option value="'+m.id+'">'+m.name+'</option>').join(''));
  $('date').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
  decorate();drawForm();route();
  if(personal.entries.length&&!localStorageSafeHasV2())persist();
  function localStorageSafeHasV2(){try{return !!localStorage.getItem(KEY);}catch{return true;}}
})();

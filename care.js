(function () {
  'use strict';

  const DEFAULTS = [
    { id: 'breathe', title: '给自己一次慢呼吸', category: '呼吸', duration: 2, description: '以舒服的幅度呼吸，让注意力回到此刻。', steps: ['找到一个舒服的坐姿。', '轻轻吸气 4 秒，再慢慢呼气 6 秒。', '如果节奏不适合你，随时恢复自然呼吸。'] },
    { id: 'ground', title: '回到此刻', category: '冥想', duration: 3, description: '留意身边真实可感的小事。', steps: ['找到眼前 5 样看得见的东西。', '感受 4 种可以触碰的质地。', '留意 3 种听得到的声音。', '留意 2 种气味，或想起两种熟悉的气味。', '感受口中 1 种味道，再自然呼吸。'] },
    { id: 'sound', title: '一小段安静声场', category: '音乐', duration: 5, description: '轻柔的合成和弦，陪你停留一会儿。', steps: ['把音量调到舒适的程度。', '让声音自然地来去，不必追赶每个念头。', '最后，把注意力放回脚下与周围。'] },
    { id: 'walk', title: '走一走，换个视角', category: '运动', duration: 5, description: '找一条安全、熟悉的路线，按自己的节奏走。', steps: ['起身，确认周围安全。行走时请收起手机。', '放松肩膀，留意脚掌与地面的接触。', '看看周围，找一样让你觉得舒服的东西。', '慢慢停下来，感受一下现在的自己。'] },
    { id: 'stretch', title: '松一松肩膀', category: '运动', duration: 3, description: '动作保持轻柔，在自己舒服的范围内活动。', steps: ['坐稳或站稳，放下肩膀。', '轻轻向后绕肩，按舒服的幅度进行。', '松开手掌，伸展手指，感受双脚着地。', '恢复自然姿势。任何不适都可以停下。'] },
    { id: 'write', title: '写给此刻的自己', category: '书写', duration: 3, description: '不用写得好，写下真实的感受就够了。', steps: ['此刻让我在意的是什么？', '如果朋友经历同样的事，我会怎么对他说？', '接下来，我愿意为自己做的一件小事是……'] }
  ].map(item => ({ ...item, duration: item.duration * 60 }));

  let dialog, active = null, callbacks = {}, opener = null, tick = null, frame = null;
  let audioContext = null, audioGain = null, audioNodes = [], audioVersion = 0;
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const comfort = value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 10 ? Math.round(value) : null;
  const durationLabel = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  const elapsed = () => active ? active.elapsed + (active.phase === 'running' ? (performance.now() - active.startedAt) / 1000 : 0) : 0;
  const elements = () => ({ time: dialog.querySelector('[data-practice-time]'), progress: dialog.querySelector('[data-practice-progress]'), toggle: dialog.querySelector('[data-practice-toggle]'), finish: dialog.querySelector('[data-practice-finish]'), circle: dialog.querySelector('.practice-breath-orb'), instruction: dialog.querySelector('[data-practice-instruction]') });

  function stopAudio() {
    audioVersion += 1;
    for (const node of audioNodes) { try { node.stop(); } catch (_) { /* Already stopped. */ } try { node.disconnect(); } catch (_) { /* Already detached. */ } }
    audioNodes = [];
    const previous = audioContext;
    audioContext = audioGain = null;
    if (previous && previous.state !== 'closed') previous.close().catch(() => {});
  }

  async function playAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const status = dialog.querySelector('[data-practice-audio-status]');
    if (!AudioContextClass) { if (status) status.textContent = '当前浏览器不支持声音播放，你仍可以安静地休息片刻。'; return; }
    try {
      const version = audioVersion;
      if (!audioContext) {
        audioContext = new AudioContextClass();
        audioGain = audioContext.createGain();
        audioGain.gain.value = active.volume / 100 * 0.16;
        audioGain.connect(audioContext.destination);
        [174.614, 220, 261.626, 349.228].forEach((frequency, index) => {
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.value = frequency;
          gain.gain.value = index === 3 ? 0.12 : 0.23;
          oscillator.connect(gain);
          gain.connect(audioGain);
          oscillator.start();
          audioNodes.push(oscillator);
        });
      }
      const context = audioContext;
      await context.resume();
      if (version !== audioVersion || !active || active.phase !== 'running') { if (context.state === 'running') await context.suspend(); return; }
      if (status) status.textContent = '正在播放 · 轻柔合成和弦';
    } catch (_) { if (status) status.textContent = '声音暂时无法播放，你仍可以完成这段安静时光。'; }
  }

  function clearClocks() { clearInterval(tick); cancelAnimationFrame(frame); tick = frame = null; }

  function buildDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.id = 'practiceDialog';
    dialog.className = 'practice-dialog';
    dialog.setAttribute('aria-labelledby', 'practiceTitle');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); stop(); });
    dialog.addEventListener('close', () => { if (!dialog.open) cleanup(); });
    dialog.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-practice-close')) stop();
      else if (button.hasAttribute('data-practice-toggle')) toggle();
      else if (button.hasAttribute('data-practice-finish')) finish();
      else if (button.hasAttribute('data-practice-save')) commit(false);
      else if (button.hasAttribute('data-practice-skip')) commit(true);
    });
    dialog.addEventListener('input', event => {
      if (event.target.id === 'practiceVolume' && active) {
        active.volume = Number(event.target.value);
        const out = dialog.querySelector('#practiceVolumeValue');
        if (out) out.value = `${active.volume}%`;
        if (audioGain && audioContext) audioGain.gain.setTargetAtTime(active.volume / 100 * 0.16, audioContext.currentTime, 0.1);
      }
      if (event.target.id === 'practiceComfort') dialog.querySelector('#practiceComfortValue').value = event.target.value;
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); stop(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea,a[href],[tabindex="0"]')).filter(el => el.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.addEventListener('visibilitychange', () => { if (active && active.phase === 'running') update(); });
  }

  function header(title, kicker) {
    return `<header class="practice-header"><div><p class="practice-eyebrow">${escape(kicker)}</p><h2 id="practiceTitle">${escape(title)}</h2></div><button type="button" class="practice-close" data-practice-close aria-label="退出练习，不保存" title="退出练习，不保存">×</button></header>`;
  }

  function render() {
    const a = active.activity;
    const steps = Array.isArray(a.steps) && a.steps.length ? a.steps : ['找一个舒服的姿势，给自己留一点时间。'];
    active.steps = steps;
    dialog.innerHTML = `${header(a.title, `留一点时间给自己 / ${a.category || '自我关怀'}`)}
      <p class="practice-description">${escape(a.description)}</p>
      ${a.id === 'breathe' ? '<div class="practice-breath-space"><div class="practice-breath-guide"></div><div class="practice-breath-orb"><span data-practice-instruction>按你的节奏</span><small>吸气 4 秒 · 呼气 6 秒</small></div></div><p class="practice-gentle">不需要屏息；感觉不舒服时，恢复自然呼吸或随时停下。</p>' : a.id === 'sound' ? '<div class="practice-sound-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><p class="practice-gentle" data-practice-audio-status>点击开始后播放 · 建议从较低音量开始</p><div class="practice-volume"><label for="practiceVolume">音量</label><input id="practiceVolume" type="range" min="0" max="100" value="30"><output id="practiceVolumeValue" for="practiceVolume">30%</output></div>' : ''}
      <ol class="practice-steps">${steps.map((step, i) => `<li data-practice-step="${i}"><span class="practice-step-number">${i + 1}</span><span>${escape(step)}</span></li>`).join('')}</ol>
      ${a.id === 'write' ? '<label class="practice-write-label" for="practiceWriting">把想说的话写在这里</label><textarea id="practiceWriting" class="practice-writing" rows="4" maxlength="5000" placeholder="此刻，我想对自己说……"></textarea><p class="practice-micro">这段练习文字只保留在当前弹窗，退出后清空，不会保存为日记。</p>' : ''}
      <div class="practice-timer"><div><span class="practice-time" data-practice-time>00:00</span><span class="practice-total"> / ${durationLabel(active.target)}</span></div><span class="practice-state" data-practice-state>准备好了就开始</span></div>
      <div class="practice-progress" role="progressbar" aria-label="练习进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span data-practice-progress></span></div>
      <footer class="practice-actions"><button type="button" class="practice-primary" data-practice-toggle>开始练习</button><button type="button" class="practice-secondary" data-practice-finish disabled>提前结束并记录</button></footer>
      <p class="practice-micro practice-centered">不必做到满分，愿意照顾自己就很好。</p>`;
  }

  function toggle() {
    if (!active || !['ready', 'running', 'paused'].includes(active.phase)) return;
    if (active.phase === 'running') {
      active.elapsed = Math.min(elapsed(), active.target);
      active.phase = 'paused';
      clearClocks();
      if (audioContext && audioContext.state === 'running') audioContext.suspend().catch(() => {});
      const status = dialog.querySelector('[data-practice-audio-status]');
      if (status) status.textContent = '已暂停播放';
    } else {
      active.phase = 'running';
      active.startedAt = performance.now();
      if (active.activity.id === 'sound') playAudio();
      tick = setInterval(update, 250);
      animate();
    }
    update();
  }

  function animate() {
    if (!active || active.phase !== 'running') return;
    if (active.activity.id === 'breathe') {
      const position = elapsed() % 10;
      const progress = position < 4 ? position / 4 : 1 - (position - 4) / 6;
      const ui = elements();
      const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (ui.circle) ui.circle.style.transform = `scale(${reduced ? 1 : 0.81 + progress * 0.19})`;
      if (ui.instruction) ui.instruction.textContent = position < 4 ? '轻轻吸气' : '慢慢呼气';
    }
    frame = requestAnimationFrame(animate);
  }

  function update() {
    if (!active || !['ready', 'running', 'paused'].includes(active.phase)) return;
    const seconds = Math.min(elapsed(), active.target);
    if (seconds >= active.target && active.phase === 'running') { finish(); return; }
    const ui = elements();
    if (ui.time) ui.time.textContent = durationLabel(seconds);
    if (ui.progress) { ui.progress.style.width = `${seconds / active.target * 100}%`; ui.progress.parentElement.setAttribute('aria-valuenow', String(Math.round(seconds / active.target * 100))); }
    if (ui.toggle) ui.toggle.textContent = active.phase === 'running' ? '暂停一下' : active.phase === 'paused' ? '继续练习' : '开始练习';
    if (ui.finish) ui.finish.disabled = seconds < 1;
    const state = dialog.querySelector('[data-practice-state]');
    if (state) state.textContent = active.phase === 'running' ? '进行中 · 随时可以停下' : active.phase === 'paused' ? '已暂停 · 时间不会继续累计' : '准备好了就开始';
    dialog.classList.toggle('practice-is-running', active.phase === 'running');
    dialog.querySelectorAll('[data-practice-step]').forEach((row, index) => row.classList.toggle('practice-step-active', active.phase !== 'ready' && index === Math.min(active.steps.length - 1, Math.floor(seconds / active.target * active.steps.length))));
    if (active.phase === 'paused' && ui.instruction) ui.instruction.textContent = '自然呼吸';
  }

  function finish() {
    if (!active || !['running', 'paused'].includes(active.phase) || elapsed() < 1) return;
    active.elapsed = Math.min(elapsed(), active.target);
    active.phase = 'feedback';
    clearClocks();
    stopAudio();
    dialog.classList.remove('practice-is-running');
    const full = active.elapsed >= active.target - 0.5;
    const value = active.beforeComfort || 5;
    dialog.innerHTML = `${header('现在的你，感觉怎么样？', '给自己的关怀 / 练习回顾')}
      <div class="practice-complete-icon" aria-hidden="true">✓</div><p class="practice-feedback-intro">${full ? '完成了这段' : '已提前结束这段'}「${escape(active.activity.title)}」</p>
      <p class="practice-duration-note">实际练习 <strong>${durationLabel(Math.floor(active.elapsed))}</strong> · ${full ? '谢谢你留出这段时间。' : '只记录实际时长，照顾自己不必勉强。'}</p>
      <div class="practice-comfort"><label for="practiceComfort">现在的舒适度 <output id="practiceComfortValue" for="practiceComfort">${value}</output><span> / 10</span></label><input id="practiceComfort" type="range" min="1" max="10" step="1" value="${value}"><div class="practice-range-labels"><span>很不舒服</span><span>很舒适</span></div>${active.beforeComfort === null ? '' : `<p class="practice-micro">练习前最近记录的舒适度：${active.beforeComfort} / 10</p>`}</div>
      <fieldset class="practice-feedback"><legend>和刚才相比（选填）</legend><div class="practice-feedback-options"><label><input type="radio" name="practiceFeedback" value="better"><span>舒服了一点</span></label><label><input type="radio" name="practiceFeedback" value="same"><span>差不多</span></label><label><input type="radio" name="practiceFeedback" value="worse"><span>不太适合</span></label></div></fieldset>
      <p class="practice-gentle">没有变化也没关系。每个人适合的方式都不同。</p>
      <footer class="practice-actions"><button type="button" class="practice-primary" data-practice-save>保存这次关怀</button><button type="button" class="practice-secondary" data-practice-skip>跳过反馈，记录完成</button></footer><button type="button" class="practice-text-button" data-practice-close>不保存，退出</button>`;
    dialog.querySelector('[data-practice-save]').focus();
  }

  function commit(skip) {
    if (!active || active.phase !== 'feedback' || active.committed) return;
    const selected = dialog.querySelector('input[name="practiceFeedback"]:checked');
    const session = { id: window.crypto && crypto.randomUUID ? crypto.randomUUID() : `care-${Date.now()}-${Math.random().toString(36).slice(2)}`, activityId: active.activity.id, date: new Date().toISOString(), duration: Math.max(1, Math.floor(active.elapsed)), beforeComfort: active.beforeComfort, afterComfort: skip ? null : comfort(Number(dialog.querySelector('#practiceComfort').value)), feedback: skip ? null : selected ? selected.value : null };
    active.committed = true;
    active.phase = 'done';
    let saved = true;
    try { if (typeof callbacks.onComplete === 'function') saved = callbacks.onComplete(session) !== false; } catch (_) { saved = false; }
    dialog.innerHTML = `${header(saved ? '这一小步，已经很好。' : '你完成了这次练习。', '给自己的关怀 / 完成')}<div class="practice-complete-icon" aria-hidden="true">✓</div><p class="practice-feedback-intro">${saved ? '这次关怀已记录' : '练习完成，但记录暂时未能保存'}</p><p class="practice-gentle">${saved ? '不急着变得更好，先允许自己好好休息。' : '浏览器存储可能暂时不可用。你为自己付出的这段时间依然有意义。'}</p><footer class="practice-actions"><button type="button" class="practice-primary" data-practice-close>回到我的空间</button></footer>`;
    dialog.querySelectorAll('[data-practice-close]').forEach(button => {
      button.setAttribute('aria-label', '关闭练习回顾');
      button.title = '关闭练习回顾';
    });
    dialog.querySelector('.practice-primary').focus();
  }

  function cleanup() {
    clearClocks();
    stopAudio();
    active = null;
    if (dialog) { dialog.classList.remove('practice-is-running'); dialog.innerHTML = ''; }
    document.documentElement.classList.remove('practice-modal-open');
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    opener = null;
  }

  function stop() {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    cleanup();
  }

  function open(activityId) {
    buildDialog();
    if (active) stop();
    const activities = window.MindCore && Array.isArray(window.MindCore.ACTIVITIES) ? window.MindCore.ACTIVITIES : DEFAULTS;
    const activity = activities.find(item => item.id === activityId) || DEFAULTS.find(item => item.id === activityId);
    if (!activity) return false;
    opener = document.activeElement;
    let before = null;
    try { before = typeof callbacks.getComfort === 'function' ? comfort(callbacks.getComfort()) : null; } catch (_) { before = null; }
    active = { activity, phase: 'ready', target: Math.max(1, Number(activity.duration) || 120), elapsed: 0, startedAt: 0, beforeComfort: before, committed: false, volume: 30 };
    render();
    document.documentElement.classList.add('practice-modal-open');
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    dialog.querySelector('[data-practice-toggle]').focus();
    return true;
  }

  window.CarePlayer = { init(options = {}) { callbacks = options; buildDialog(); }, open, stop };
})();

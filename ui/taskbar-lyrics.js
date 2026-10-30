'use strict';
(() => {
  const caption = document.querySelector('#taskbar-lyric');
  const track = document.querySelector('#taskbar-lyric-track');
  const { normalize, positionAt, progressAt, scrollTarget } = window.QingyinTaskbarRender;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = normalize(), anchoredAt = performance.now(), lastFrame = anchoredAt;
  let units = [], widths = [], totalWidth = 0, scroll = 0, frame = 0, backupTimer = 0, generation = 0, receivedEvent = false;

  function measure() {
    widths = units.map(unit => unit.node.getBoundingClientRect().width);
    totalWidth = track.scrollWidth;
  }
  function cancelFrame() {
    if (frame) cancelAnimationFrame(frame);
    if (backupTimer) clearTimeout(backupTimer);
    frame = 0;
    backupTimer = 0;
    generation++;
  }
  function draw(now, immediate = false) {
    frame = 0;
    if (backupTimer) clearTimeout(backupTimer);
    backupTimer = 0;
    const position = positionAt(current, (now - anchoredAt) / 1000);
    let sungWidth = 0;
    for (let index = 0; index < units.length; index++) {
      const progress = progressAt(current.units[index], position);
      sungWidth += widths[index] * progress;
      const right = `${((1 - progress) * 100).toFixed(3)}%`;
      if (units[index].right !== right) {
        units[index].fill.style.clipPath = `inset(0 ${right} 0 0)`;
        units[index].right = right;
      }
    }
    const target = scrollTarget(sungWidth, totalWidth, caption.clientWidth);
    const delta = Math.max(0, Math.min(100, now - lastFrame));
    scroll = immediate || reducedMotion.matches ? target : scroll + (target - scroll) * (1 - Math.exp(-delta / 135));
    if (Math.abs(target - scroll) < .05) scroll = target;
    track.style.transform = `translateX(${-scroll.toFixed(3)}px)`;
    track.dataset.position = position.toFixed(3);
    track.dataset.scroll = scroll.toFixed(3);
    lastFrame = now;
    if (current.kind === 'lyric' && current.playing && current.rate > 0 && (position < current.lineEnd || Math.abs(target - scroll) > .05)) {
      const scheduledGeneration = generation;
      const queuedFrame = requestAnimationFrame(timestamp => {
        if (generation === scheduledGeneration && frame === queuedFrame) draw(timestamp);
      });
      frame = queuedFrame;
      // A hidden/occluded native compositor may stop RAF even when background throttling is disabled.
      // The timer only runs when no frame arrived; it keeps the transport clock current without polling IPC.
      const queuedTimer = setTimeout(() => {
        if (generation !== scheduledGeneration || backupTimer !== queuedTimer) return;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        backupTimer = 0;
        draw(performance.now());
      }, 100);
      backupTimer = queuedTimer;
    }
  }
  function show(payload) {
    cancelFrame();
    const previous = current;
    const previousPosition = positionAt(previous, (performance.now() - anchoredAt) / 1000);
    current = normalize(payload);
    anchoredAt = performance.now();
    document.body.dataset.playing = String(current.playing);
    document.body.dataset.kind = current.kind;
    document.documentElement.dataset.theme = current.theme;
    document.title = current.title ? `${current.title} · 青音任务栏歌词` : '青音 · 任务栏歌词';
    caption.setAttribute('aria-label', current.text || '当前播放歌词');
    const differentLine = previous.text !== current.text || previous.kind !== current.kind || previous.lineStart !== current.lineStart || previous.lineEnd !== current.lineEnd || previous.title !== current.title;
    if (differentLine || current.units.length !== units.length || current.units.some((unit, index) => unit.text !== units[index]?.text)) {
      track.replaceChildren();
      units = current.units.map(unit => {
        const node = document.createElement('span');
        node.className = 'lyric-unit';
        const base = document.createElement('span');
        base.className = 'lyric-unit-base';
        base.textContent = unit.text;
        const fill = document.createElement('span');
        fill.className = 'lyric-unit-fill';
        fill.textContent = unit.text;
        node.append(base, fill);
        track.append(node);
        return { node, fill, text: unit.text, right: '' };
      });
      if (!units.length) track.textContent = current.text;
      scroll = 0;
      measure();
    }
    const seek = Math.abs(current.position - previousPosition) > .45;
    draw(anchoredAt, differentLine || seek || !current.playing);
  }
  const unsubscribe = window.taskbarLyrics?.onState?.(state => { receivedEvent = true; show(state); });
  window.taskbarLyrics?.getState?.().then(state => { if (!receivedEvent) show(state); }).catch(() => {});
  const resizeObserver = new ResizeObserver(() => { cancelFrame(); measure(); draw(performance.now(), true); });
  resizeObserver.observe(caption);
  reducedMotion.addEventListener('change', () => { cancelFrame(); draw(performance.now(), true); });
  window.addEventListener('beforeunload', () => { cancelFrame(); resizeObserver.disconnect(); unsubscribe?.(); }, { once: true });
})();

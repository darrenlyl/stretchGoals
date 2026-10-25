// This session's numbers (owner: Claude via Darren): time watched, share of time in good
// posture, best good streak, and a sparkline of the score for the last 5 minutes.
//
// Kept in memory only. Nothing is saved, and it starts again when the app restarts.
//
//   const session = createSession(refs);  // refs: watched, good, streak, spark, sparkLine, sparkArea, ...
//   session.track(state, mode, tone)       // every PostureState; only "live" frames count

const SAMPLE_MS = 2000; // one sparkline point every 2 s
const WINDOW_MS = 5 * 60 * 1000; // the sparkline shows the last 5 minutes
const MAX_POINTS = WINDOW_MS / SAMPLE_MS;
const W = 300; // sparkline viewBox size
const H = 60;

/** 75 s -> "1:15", 3725 s -> "1:02:05" */
export function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function createSession(refs, setText) {
  let watchedMs = 0;
  let goodMs = 0;
  let streakMs = 0;
  let bestMs = 0;
  let lastTs = null;
  let bucket = { sum: 0, count: 0, startedAt: null };
  const points = []; // { score } oldest first
  let lastText = 0;

  function track(state, mode, tone) {
    const now = performance.now();
    if (mode !== 'live') {
      lastTs = null; // a gap: don't count the time we weren't watching
      streakMs = 0;
      return;
    }
    if (lastTs !== null) {
      const dt = Math.min(1000, now - lastTs); // a stalled camera shouldn't add minutes
      watchedMs += dt;
      if (tone === 'good') {
        goodMs += dt;
        streakMs += dt;
        bestMs = Math.max(bestMs, streakMs);
      } else streakMs = 0;
    }
    lastTs = now;

    bucket.startedAt ??= now;
    bucket.sum += state.score;
    bucket.count += 1;
    if (now - bucket.startedAt >= SAMPLE_MS) {
      points.push(bucket.sum / bucket.count);
      if (points.length > MAX_POINTS) points.shift();
      bucket = { sum: 0, count: 0, startedAt: now };
      drawSpark();
    }
    // The numbers only change once a second, so only write them once a second
    if (now - lastText >= 1000) {
      lastText = now;
      renderNumbers();
    }
  }

  function renderNumbers() {
    setText(refs.watched, clock(watchedMs));
    setText(
      refs.good,
      watchedMs > 0 ? `${Math.round((goodMs / watchedMs) * 100)}%` : '0%',
    );
    setText(refs.streak, clock(bestMs));
  }

  // The chart's time span grows with the session (at least 1 minute) up to 5 minutes, so a
  // new session isn't a speck at the right edge. The newest point sits at the right edge.
  const MIN_SPAN = 60000 / SAMPLE_MS;
  const x = (i) =>
    W - (points.length - 1 - i) * (W / Math.max(MIN_SPAN, points.length - 1));
  const y = (score) =>
    H - 2 - (Math.min(100, Math.max(0, score)) / 100) * (H - 4);

  function drawSpark() {
    if (points.length < 2) return;
    let line = '';
    points.forEach(
      (p, i) =>
        (line += `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)}`),
    );
    refs.sparkLine.setAttribute('d', line);
    refs.sparkArea.setAttribute(
      'd',
      `${line}L${W} ${H}L${x(0).toFixed(1)} ${H}Z`,
    );
    const last = points.at(-1);
    refs.sparkDot.setAttribute('cx', W);
    refs.sparkDot.setAttribute('cy', y(last).toFixed(1));
    refs.spark.dataset.empty = 'false';
    setText(
      refs.sparkLabel,
      points.length >= MAX_POINTS ? 'Score, last 5 min' : 'Score, this session',
    );
  }

  // Hover: a crosshair and the score at that moment
  function onPointer(event) {
    if (points.length < 2) return;
    const box = refs.spark.getBoundingClientRect();
    const fx = ((event.clientX - box.left) / box.width) * W;
    let nearest = 0;
    for (let i = 1; i < points.length; i++)
      if (Math.abs(x(i) - fx) < Math.abs(x(nearest) - fx)) nearest = i;
    const px = x(nearest);
    refs.sparkCross.setAttribute('x1', px);
    refs.sparkCross.setAttribute('x2', px);
    refs.spark.dataset.hover = 'true';
    const ago = Math.round(((points.length - 1 - nearest) * SAMPLE_MS) / 1000);
    setText(
      refs.sparkTip,
      `${Math.round(points[nearest])}${ago ? `, ${clock(ago * 1000)} ago` : ', now'}`,
    );
    // The tip is pinned to the right edge; slide it left to sit above the crosshair
    const fromRight = box.width - (px / W) * box.width;
    refs.sparkTip.style.transform = `translateX(${(-Math.max(0, fromRight - 36)).toFixed(0)}px)`;
  }
  refs.spark.addEventListener('pointermove', onPointer);
  refs.spark.addEventListener(
    'pointerleave',
    () => (refs.spark.dataset.hover = 'false'),
  );

  renderNumbers();
  return { track };
}

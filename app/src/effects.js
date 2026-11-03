/** Split text into editor units, preserving Unicode grapheme clusters and spaces. */
export function splitUnits(text, mode, boundaries = []) {
  if (mode === 'all') return [{text, start: 0, end: text.length}];
  const segments = [...new Intl.Segmenter('ko', {granularity: mode === 'word' ? 'word' : 'grapheme'}).segment(text)];
  if (!['word', 'character', 'custom'].includes(mode)) throw new Error('알 수 없는 적용 범위입니다.');
  if (mode !== 'custom') return segments.map(s => ({text:s.segment, start:s.index, end:s.index + s.segment.length, isWordLike:s.isWordLike}));
  const valid = new Set([0, text.length, ...segments.map(s => s.index)]);
  const points = [0, ...boundaries, text.length];
  if (points.some((point, i) => !Number.isInteger(point) || !valid.has(point) || (i > 0 && point <= points[i-1]))) {
    throw new Error('글자 묶음 경계가 올바르지 않습니다.');
  }
  return points.slice(0,-1).map((start, i) => ({text:text.slice(start,points[i+1]), start, end:points[i+1]}));
}

function coordinate(t, a, b) { const u = 1-t; return 3*u*u*t*a + 3*u*t*t*b + t*t*t; }

/** CSS-style cubic Bezier: x is time, y is progress. */
export function cubicProgress(x, curve = [0,0,1,1]) {
  if (!Array.isArray(curve) || curve.length !== 4 || curve.some(v => !Number.isFinite(v)) || curve[0] < 0 || curve[0] > 1 || curve[2] < 0 || curve[2] > 1) {
    throw new Error('베지어 곡선 제어점이 올바르지 않습니다.');
  }
  x = Math.max(0, Math.min(1, x));
  if (curve[0] === curve[1] && curve[2] === curve[3]) return x;
  let low=0, high=1;
  for (let i=0;i<30;i++) { const t=(low+high)/2; if (coordinate(t,curve[0],curve[2]) < x) low=t; else high=t; }
  return coordinate((low+high)/2,curve[1],curve[3]);
}

const ease = {linear:[0,0,1,1], 'ease-in':[0.42,0,1,1], 'ease-out':[0,0,0.58,1], 'ease-in-out':[0.42,0,0.58,1]};
function interpolate(a,b,t) {
  if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) return a+(b-a)*t;
  if (typeof a === 'string' && typeof b === 'string' && /^#[0-9a-f]{6}$/i.test(a) && /^#[0-9a-f]{6}$/i.test(b)) {
    return '#'+[1,3,5].map(i => Math.max(0,Math.min(255,Math.round(parseInt(a.slice(i,i+2),16)+(parseInt(b.slice(i,i+2),16)-parseInt(a.slice(i,i+2),16))*t))).toString(16).padStart(2,'0')).join('').toUpperCase();
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v,i) => interpolate(v,b[i],t));
  throw new Error('키프레임 값의 형식이 일치하지 않습니다.');
}

/** Keyframe times are milliseconds relative to the cue start. */
export function evaluateKeyframes(keyframes, time) {
  if (!Number.isFinite(time) || !Array.isArray(keyframes) || !keyframes.length) throw new Error('키프레임이 필요합니다.');
  const sorted = [...keyframes].sort((a,b) => a.time-b.time);
  if (sorted.some((k,i) => !Number.isFinite(k.time) || (i && k.time === sorted[i-1].time))) throw new Error('키프레임 시간이 중복되거나 올바르지 않습니다.');
  if (time <= sorted[0].time) return sorted[0].value;
  if (time >= sorted.at(-1).time) return sorted.at(-1).value;
  const index = sorted.findIndex(k => k.time >= time), a = sorted[index-1], b = sorted[index];
  const curve = Array.isArray(a.easing) ? a.easing : ease[a.easing ?? 'linear'];
  if (!curve) throw new Error('알 수 없는 보간 방식입니다.');
  return interpolate(a.value,b.value,cubicProgress((time-a.time)/(b.time-a.time),curve));
}

/** Place a spatial cubic Bezier path independently of temporal easing. */
export function evaluatePath(points, progress) {
  if (!Array.isArray(points) || points.length !== 4 || points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v)))) throw new Error('이동 경로 제어점이 올바르지 않습니다.');
  const t = Math.max(0,Math.min(1,progress)), u=1-t;
  return [0,1].map(axis => u**3*points[0][axis]+3*u*u*t*points[1][axis]+3*u*t*t*points[2][axis]+t**3*points[3][axis]);
}

/** Build a deterministic sample schedule including keyframes and cue end. */
export function sampleEffect(keyframes, duration, {stepMs=100, delayMs=0} = {}) {
  if (!Number.isSafeInteger(duration) || duration <= 0 || !Number.isSafeInteger(stepMs) || stepMs <= 0 || !Number.isSafeInteger(delayMs) || delayMs < 0) throw new Error('출력 시간 간격이 올바르지 않습니다.');
  const times = new Set([0,duration]);
  for (let t=stepMs;t<duration;t+=stepMs) times.add(t);
  for (const frame of keyframes) { const t=frame.time+delayMs; if (Number.isSafeInteger(t) && t>0 && t<duration) times.add(t); }
  return [...times].sort((a,b)=>a-b).map(t => ({time:t,value:evaluateKeyframes(keyframes,t-delayMs)}));
}

export function staggerUnits(units, intervalMs, direction='forward') {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 0 || !['forward','reverse'].includes(direction)) throw new Error('시차 설정이 올바르지 않습니다.');
  return units.map((unit,i) => ({...unit,delayMs:(direction === 'forward' ? i : units.length-1-i)*intervalMs}));
}

import {evaluateKeyframes,evaluatePath} from './effects.js';

const defaults = Object.freeze({color:'#FEFEFE', opacity:254, backgroundColor:'#080808',
  backgroundOpacity:0, size:100, position:[50,90], anchor:7, font:4, bold:false, italic:false, underline:false, edgeColor:'#000000', edgeType:0});
const animated = new Set(['color','opacity','backgroundColor','backgroundOpacity','size','position','edgeColor']);
const colors = new Set(['color','backgroundColor','edgeColor']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
const xmlText = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

/** Exact integer values emitted to YTT, usable by both preview and export. */
export function animatedStateAt(cue, elapsed) {
  const base = {...defaults, ...cue.appearance};
  for (const [name, frames] of Object.entries(cue.keyframes ?? {})) {
    if (!animated.has(name)) throw new Error(`지원하지 않는 키프레임 속성: ${name}`);
    const delay=cue.delays?.[name] ?? cue.defaultDelayMs ?? 0;
    if (!Number.isSafeInteger(delay) || delay<0) throw new Error('효과별 시차가 올바르지 않습니다.');
    base[name] = evaluateKeyframes(frames, elapsed-delay);
  }
  if (cue.motionPath) {
    const path=cue.motionPath;
    if (cue.keyframes?.position) throw new Error('위치 키프레임과 곡선 경로를 동시에 사용할 수 없습니다.');
    if (!Number.isSafeInteger(path.start) || !Number.isSafeInteger(path.end) || path.start<0 || path.end<=path.start) throw new Error('이동 경로 시간이 올바르지 않습니다.');
    const progress=evaluateKeyframes([{time:path.start,value:0,easing:path.easing ?? 'linear'},{time:path.end,value:1}],elapsed);
    base.position=evaluatePath(path.points,progress);
  }
  for (const name of colors) {
    if (typeof base[name] !== 'string' || !/^#[\da-f]{6}$/i.test(base[name])) throw new Error(`색상 값이 올바르지 않습니다: ${name}`);
    base[name] = base[name].toUpperCase();
  }
  for (const name of ['opacity','backgroundOpacity','size']) {
    if (!Number.isFinite(base[name])) throw new Error(`숫자 값이 올바르지 않습니다: ${name}`);
  }
  if (!Array.isArray(base.position) || base.position.length !== 2 || base.position.some(v=>!Number.isFinite(v))) throw new Error('위치 값이 올바르지 않습니다.');
  if (!Number.isInteger(base.font) || base.font < 0 || base.font > 7 || !Number.isInteger(base.edgeType) || base.edgeType < 0 || base.edgeType > 4) throw new Error('글꼴 또는 외곽선 종류가 올바르지 않습니다.');
  if (!Number.isInteger(base.anchor) || base.anchor<0 || base.anchor>8) throw new Error('자막 기준점이 올바르지 않습니다.');
  return { color:base.color, opacity:clamp(base.opacity,0,254), backgroundColor:base.backgroundColor,
    backgroundOpacity:clamp(base.backgroundOpacity,0,254), size:clamp(base.size,0,10000),
    position:base.position.map(v=>clamp(v,0,100)), anchor:base.anchor, font:base.font, bold:!!base.bold, italic:!!base.italic, underline:!!base.underline,
    edgeColor:base.edgeColor, edgeType:base.edgeType };
}

/** Compile cue and text-unit animations; per-unit positions require measured layout offsets. */
export function compileAnimatedYtt(cues, {quality='optimized', maxSegments=100000}={}) {
  if (!['optimized','high'].includes(quality)) throw new Error('알 수 없는 출력 품질입니다.');
  if (!Number.isSafeInteger(maxSegments) || maxSegments < 1) throw new Error('구간 제한이 올바르지 않습니다.');
  const step = quality === 'high' ? 33 : 100;
  const events = [], warnings=new Set(['출력된 효과의 실제 YouTube 표시와 미리보기 일치는 아직 검증되지 않았습니다.']);
  for (const cue of cues) {
    if (!Number.isSafeInteger(cue.start) || !Number.isSafeInteger(cue.end) || cue.start < 0 || cue.end <= cue.start) throw new Error('자막 시간이 올바르지 않습니다.');
    if (cue.effects?.length) throw new Error('지원하지 않는 효과 데이터가 있습니다.');
    if (cue.style) throw new Error('가져온 스타일을 애니메이션 출력에 적용하는 기능은 아직 지원하지 않습니다.');
    if (cue.units != null && (!Array.isArray(cue.units) || !cue.units.length || cue.units.some(unit=>typeof unit.text !== 'string') || cue.units.map(unit=>unit.text).join('') !== cue.text)) throw new Error('글자 단위가 원본 자막과 일치하지 않습니다.');
    const separated=!!cue.units?.some(unit=>unit.keyframes?.position);
    if (separated && !cue.units.some(unit=>/\S/u.test(unit.text))) throw new Error('이동할 글자가 없습니다.');
    if (separated && (cue.keyframes?.size || cue.units.some(unit=>unit.keyframes?.size)) && typeof cue.layoutAt!=='function') throw new Error('글자별 이동과 크기 변화를 함께 출력하려면 영상과 글자 배치 정보가 필요합니다.');
    if (separated) warnings.add('글자별 위치는 측정한 글꼴 폭으로 분리됩니다. YouTube의 글꼴·배경·줄바꿈 결과가 다를 수 있습니다.');
    for (const unit of cue.units ?? []) {
      if (!Number.isSafeInteger(unit.delayMs ?? 0) || (unit.delayMs ?? 0) < 0) throw new Error('글자별 시차가 올바르지 않습니다.');
      if (unit.appearance?.position) throw new Error('단위별 고정 위치 데이터는 지원하지 않습니다.');
      if (separated && /\S/u.test(unit.text) && (!Array.isArray(unit.layoutOffset) || unit.layoutOffset.length!==2 || unit.layoutOffset.some(v=>!Number.isFinite(v)))) throw new Error('단어·글자별 위치를 출력하려면 텍스트 배치를 먼저 측정해야 합니다.');
      if (separated && /\S/u.test(unit.text) && unit.text.includes('\n')) throw new Error('줄바꿈을 포함한 글자 묶음은 따로 나누어 주세요.');
      if (Object.values(unit.keyframes ?? {}).flat().some(k=>!Number.isSafeInteger(k.time) || k.time < 0)) throw new Error('키프레임 시간은 0 이상의 정수 밀리초여야 합니다.');
      if (Object.values(unit.delays ?? {}).some(delay=>!Number.isSafeInteger(delay) || delay<0)) throw new Error('효과별 시차가 올바르지 않습니다.');
    }
    const duration = cue.end-cue.start;
    const keys = Object.values(cue.keyframes ?? {}).flat();
    if (cue.motionPath) keys.push({time:cue.motionPath.start},{time:cue.motionPath.end});
    const unitKeys = (cue.units ?? []).flatMap(unit => Object.entries(unit.keyframes ?? {}).flatMap(([property,frames])=>frames.map(key=>({...key,time:key.time+(unit.delays?.[property] ?? unit.delayMs ?? 0)}))));
    keys.push(...unitKeys);
    if (keys.some(k => !Number.isSafeInteger(k.time) || k.time < 0)) throw new Error('키프레임 시간은 0 이상의 정수 밀리초여야 합니다.');
    const times = new Set([0,duration]);
    if (keys.length > 1) for (let t=step; t<duration; t+=step) times.add(t);
    for (const key of keys) if (key.time > 0 && key.time < duration) times.add(key.time);
    const ordered = [...times].sort((a,b)=>a-b);
    let previous = null; const previousUnits=new Map();
    for (let i=0;i<ordered.length-1;i++) {
      const start=cue.start+ordered[i], end=cue.start+ordered[i+1];
      const state=animatedStateAt(cue,ordered[i]);
      if (separated) {
        const offsets=typeof cue.layoutAt==='function' ? cue.layoutAt(ordered[i]) : cue.units.map(unit=>unit.layoutOffset);
        if (!Array.isArray(offsets) || offsets.length!==cue.units.length) throw new Error('시간별 글자 배치를 계산할 수 없습니다.');
        cue.units.forEach((unit,index)=>{
          if (!/\S/u.test(unit.text)) return;
          if (!Array.isArray(offsets[index]) || offsets[index].length!==2 || offsets[index].some(value=>!Number.isFinite(value))) throw new Error('시간별 글자 위치가 올바르지 않습니다.');
          const {position:positionFrames,...otherFrames}=unit.keyframes ?? {};
          const part=animatedStateAt({appearance:{...state,...unit.appearance},keyframes:otherFrames,delays:unit.delays,defaultDelayMs:unit.delayMs},ordered[i]);
          const delta=positionFrames ? evaluateKeyframes(positionFrames,ordered[i]-(unit.delays?.position ?? unit.delayMs ?? 0)) : [0,0];
          if (!Array.isArray(delta) || delta.length!==2 || delta.some(value=>!Number.isFinite(value))) throw new Error('단위별 위치 값이 올바르지 않습니다.');
          part.position=state.position.map((value,axis)=>clamp(value+offsets[index][axis]+delta[axis],0,100));
          const key=JSON.stringify(part), prior=previousUnits.get(index);
          if (prior && prior.key===key && prior.end===start) prior.end=end;
          else { const event={start,end,state:part,key,text:unit.text,cueId:cue.id,unitIndex:index}; events.push(event); previousUnits.set(index,event); if(events.length>maxSegments) throw new Error('출력 구간 수가 제한을 초과했습니다.'); }
        });
        continue;
      }
      const parts=cue.units?.map(unit=>({text:unit.text,state:animatedStateAt({appearance:{...state,...unit.appearance},keyframes:unit.keyframes,delays:unit.delays,defaultDelayMs:unit.delayMs},ordered[i])}));
      const key=JSON.stringify([state,parts]);
      if (previous && previous.key === key && previous.end === start) previous.end=end;
      else { previous={start,end,state,parts,key,text:cue.text,cueId:cue.id}; events.push(previous); if(events.length>maxSegments) throw new Error('출력 구간 수가 제한을 초과했습니다.'); }
    }
  }
  events.sort((a,b)=>a.start-b.start);
  const pens=new Map(), positions=new Map();
  function penFor(s) {
    const pen=`fc="${s.color}" fo="${s.opacity}" bc="${s.backgroundColor}" bo="${s.backgroundOpacity}" sz="${s.size}" fs="${s.font}" b="${s.bold?1:0}" i="${s.italic?1:0}" u="${s.underline?1:0}" ec="${s.edgeColor}" et="${s.edgeType}"`;
    if (!pens.has(pen)) pens.set(pen,pens.size+1);
    return pens.get(pen);
  }
  for (const event of events) {
    const s=event.state;
    event.penId=penFor(s);
    if (event.parts) for (const part of event.parts) part.penId=penFor(part.state);
    event.position=`ap="${s.anchor}" ah="${s.position[0]}" av="${s.position[1]}"`;
    if (!positions.has(event.position)) positions.set(event.position,positions.size+1);
  }
  const head=[...pens].map(([v,id])=>`    <pen id="${id}" ${v} />`).concat([...positions].map(([v,id])=>`    <wp id="${id}" ${v} />`)).join('\n');
  const body=events.map(e=>{
    const content=e.parts ? e.parts.map((p,i)=>`<s p="${p.penId}">${xmlText(p.text)}</s>${i===0 && e.parts.length>1 ? '&#8203;' : ''}`).join('') : xmlText(e.text);
    return `    <p t="${e.start}" d="${e.end-e.start}" p="${e.penId}" wp="${positions.get(e.position)}">${content}</p>`;
  }).join('\n');
  const xml=`<?xml version="1.0" encoding="utf-8"?>\n<timedtext format="3">\n<head>\n${head}\n</head>\n<body>\n${body}\n</body>\n</timedtext>\n`;
  return {xml, segments:events.length, bytes:new TextEncoder().encode(xml).length, events, warnings:[...warnings]};
}

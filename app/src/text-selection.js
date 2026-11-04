import {splitUnits} from './effects.js';
import {repartitionUnits} from './unit-effects.js';

/** Plan a selection without mutating the cue. Offsets use textarea UTF-16 indices. */
export function planTextSelection(cue,start,end,mode='group') {
  if (!cue || typeof cue.text!=='string' || !['group','character'].includes(mode) || !Number.isInteger(start) || !Number.isInteger(end) || start<0 || end>cue.text.length || end<=start) throw new Error('효과를 적용할 글자를 드래그해 선택하세요.');
  const graphemes=splitUnits(cue.text,'character');
  const first=graphemes.find(part=>part.start<=start && part.end>start);
  const last=[...graphemes].reverse().find(part=>part.start<end && part.end>=end);
  if (!first || !last) throw new Error('글자 선택 범위를 읽을 수 없습니다.');
  start=first.start;end=last.end;
  const boundaries=new Set([0,cue.text.length,start,end]);
  let offset=0;
  for(const unit of cue.units ?? []) {offset+=unit.text.length;boundaries.add(offset);}
  if(mode==='character')for(const part of graphemes)if(part.start>=start && part.end<=end){boundaries.add(part.start);boundaries.add(part.end);}
  const sorted=[...boundaries].sort((a,b)=>a-b);
  if(sorted.some(value=>!Number.isInteger(value) || value<0 || value>cue.text.length))throw new Error('기존 글자 구성이 올바르지 않습니다.');
  const pieces=sorted.slice(0,-1).map((value,index)=>({start:value,end:sorted[index+1],text:cue.text.slice(value,sorted[index+1])})).filter(piece=>piece.end>piece.start);
  const units=cue.units ? repartitionUnits(cue.text,cue.units,pieces) : pieces.map(piece=>({text:piece.text}));
  const indices=pieces.map((piece,index)=>piece.start>=start && piece.end<=end ? index : -1).filter(index=>index>=0);
  return {units,indices,start,end};
}

/** Propagate only changed keys to each unit, retaining unrelated existing keys and delays. */
export function applySelectionFrames(plan,property,previous,next) {
  const units=structuredClone(plan.units), reference=units[plan.indices[0]];
  if (!reference) throw new Error('선택한 글자 단위를 찾을 수 없습니다.');
  const firstDelay=reference.delays?.[property] ?? reference.delayMs ?? 0;
  const oldMap=new Map(previous.map(frame=>[frame.time+firstDelay,frame]));
  const newMap=new Map(next.map(frame=>[frame.time+firstDelay,frame]));
  const removed=[...oldMap.keys()].filter(time=>!newMap.has(time));
  const changed=[...newMap.entries()].filter(([time,frame])=>!oldMap.has(time) || JSON.stringify(oldMap.get(time))!==JSON.stringify(frame));
  for(const index of plan.indices) {
    const unit=units[index],delay=unit.delays?.[property] ?? unit.delayMs ?? 0;
    let frames=structuredClone(unit.keyframes?.[property] ?? []);
    for(const time of removed)frames=frames.filter(frame=>frame.time+delay!==time);
    for(const [time,frame] of changed) {
      if(time<delay)throw new Error('선택 범위에 시차보다 앞선 키프레임이 있습니다. 시차를 줄여 주세요.');
      const adjusted={...structuredClone(frame),time:time-delay},existing=frames.findIndex(item=>item.time===adjusted.time);
      if(existing<0)frames.push(adjusted);else frames[existing]=adjusted;
    }
    frames.sort((a,b)=>a.time-b.time);
    unit.keyframes={...unit.keyframes};if(frames.length)unit.keyframes[property]=frames;else delete unit.keyframes[property];
  }
  return units;
}

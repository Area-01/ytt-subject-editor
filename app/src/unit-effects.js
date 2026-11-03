import {splitUnits} from './effects.js';

export function splitEffectUnits(text,mode,boundaries=[]) {
  if (!['word','character','custom'].includes(mode)) throw new Error('단어 또는 글자 적용 범위를 선택하세요.');
  const graphemes=splitUnits(text,'character');
  let offsets=[];
  if (mode==='custom') {
    if (!Array.isArray(boundaries) || boundaries.some((n,i)=>!Number.isInteger(n) || n<=0 || n>=graphemes.length || (i>0 && n<=boundaries[i-1]))) throw new Error('묶음 경계는 오름차순 글자 번호로 입력하세요.');
    offsets=boundaries.map(n=>graphemes[n].start);
  }
  return splitUnits(text,mode,offsets);
}

/** Repartition without discarding existing unit effects. */
export function repartitionUnits(text,units,pieces) {
  if (!Array.isArray(units) || units.some(unit=>typeof unit.text!=='string' || !unit.text.length) || units.map(unit=>unit.text).join('')!==text) throw new Error('기존 효과의 텍스트 단위가 일치하지 않습니다.');
  const existing=[]; let cursor=0;
  for(const unit of units) { existing.push({start:cursor,end:cursor+unit.text.length,unit}); cursor+=unit.text.length; }
  const comparable=unit=>JSON.stringify({delayMs:unit.delayMs ?? 0,delays:unit.delays ?? {},keyframes:unit.keyframes ?? {},appearance:unit.appearance ?? null});
  let firstIndex=0;
  return pieces.map(piece=>{
    while(firstIndex<existing.length && existing[firstIndex].end<=piece.start) firstIndex++;
    const overlapping=[];
    for(let index=firstIndex;index<existing.length && existing[index].start<piece.end;index++) overlapping.push(existing[index]);
    if (!overlapping.length) throw new Error('새 텍스트 단위를 찾을 수 없습니다.');
    const first=overlapping[0].unit, signature=comparable(first);
    if (overlapping.some(item=>comparable(item.unit)!==signature)) throw new Error('서로 다른 효과를 가진 글자를 합칠 수 없습니다. 효과를 통일하거나 다른 묶음을 선택하세요.');
    const result=structuredClone(first); result.text=piece.text; delete result.layoutOffset;
    return result;
  });
}

/** Construct non-destructive unit effects from grapheme boundary counts. */
export function setUnitEffect(cue, {mode, boundaries=[], intervalMs=0, direction='forward', property, frames, targets=null}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs<0 || !['forward','reverse'].includes(direction)) throw new Error('시차 설정이 올바르지 않습니다.');
  if (!Array.isArray(frames) || !frames.length) throw new Error('키프레임이 필요합니다.');
  const pieces=splitEffectUnits(cue.text,mode,boundaries);
  if (!pieces.length) throw new Error('빈 자막에는 효과를 적용할 수 없습니다.');
  const prior=cue.units && (cue.units.length!==pieces.length || cue.units.some((unit,i)=>unit.text!==pieces[i].text)) ? repartitionUnits(cue.text,cue.units,pieces) : cue.units;
  const active=pieces.map((part,index)=>({part,index})).filter(({part})=>!/^\s+$/u.test(part.text));
  if (targets!==null && (!Array.isArray(targets) || !targets.length || targets.some(n=>!Number.isSafeInteger(n) || n<1 || n>active.length) || new Set(targets).size!==targets.length)) throw new Error('선택한 단어·글자 번호가 올바르지 않습니다.');
  const chosen=targets===null ? active : targets.map(n=>active[n-1]);
  const order=direction==='reverse' ? [...chosen].reverse() : chosen;
  const delays=new Map(order.map(({index},rank)=>[index,rank*intervalMs]));
  const units=pieces.map((part,index)=>{
    const existing=prior?.[index] ?? {text:part.text};
    const perProperty={...existing.delays};
    for (const name of Object.keys(existing.keyframes ?? {})) if (perProperty[name]==null) perProperty[name]=existing.delayMs ?? 0;
    if (delays.has(index)) perProperty[property]=delays.get(index);
    return {...existing,delayMs:existing.delayMs ?? (delays.get(index) ?? 0),delays:perProperty,keyframes:delays.has(index) ? {...existing.keyframes,[property]:structuredClone(frames)} : {...existing.keyframes}};
  });
  const result={...cue,units,unitPlan:targets===null ? {mode,boundaries:[...boundaries],intervalMs,direction} : null};
  Object.defineProperty(result,'changedUnitIndices',{value:[...delays.keys()],enumerable:false});
  return result;
}

export function parseUnitTargets(value) {
  const text=value.trim(); if (!text) return null;
  if (!/^\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*$/.test(text)) throw new Error('대상 번호를 1,3-5 형식으로 입력하세요.');
  const result=[];
  for (const range of text.split(',')) {
    const [from,to=from]=range.split('-').map(part=>Number(part.trim()));
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from<1 || to<from || to-from>10000) throw new Error('대상 번호 범위가 올바르지 않습니다.');
    for(let n=from;n<=to;n++) { if(result.includes(n)) throw new Error('대상 번호가 중복되었습니다.'); result.push(n); }
  }
  return result;
}

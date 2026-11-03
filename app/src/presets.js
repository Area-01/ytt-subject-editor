import {splitUnits} from './effects.js';
import {compileAnimatedYtt} from './animated-ytt.js';
import {setUnitEffect} from './unit-effects.js';

const properties=new Set(['color','opacity','backgroundColor','backgroundOpacity','size','position','edgeColor']);
function mapFrames(map, convert) {
  const result={};
  for (const [name,frames] of Object.entries(map ?? {})) {
    if (!properties.has(name) || !Array.isArray(frames) || !frames.length) throw new Error('프리셋의 효과 속성이 올바르지 않습니다.');
    result[name]=frames.map(frame=>({...frame,time:convert(frame.time)}));
  }
  return result;
}
export function makePreset(cue,name) {
  if (typeof name!=='string' || !name.trim() || name.length>100) throw new Error('프리셋 이름을 입력하세요.');
  const duration=cue.end-cue.start;
  if (!Number.isSafeInteger(duration) || duration<=0) throw new Error('자막 길이가 올바르지 않습니다.');
  const scale=t=>{if (!Number.isSafeInteger(t) || t<0) throw new Error('키프레임 시간이 올바르지 않습니다.'); return t/duration;};
  const units=cue.units?.map(unit=>({count:splitUnits(unit.text,'character').length,delay:scale(unit.delayMs ?? 0),delays:Object.fromEntries(Object.entries(unit.delays ?? {}).map(([name,delay])=>[name,scale(delay)])),keyframes:mapFrames(unit.keyframes,scale),appearance:unit.appearance}));
  const motionPath=cue.motionPath ? {...structuredClone(cue.motionPath),start:scale(cue.motionPath.start),end:scale(cue.motionPath.end)} : null;
  let unitRecipe=null;
  if (cue.unitPlan && cue.units?.length) {
    const active=cue.units.filter(unit=>!/^\s+$/u.test(unit.text));
    const first=active[0];
    if (first && Object.keys(first.keyframes ?? {}).length && active.every(unit=>JSON.stringify(unit.keyframes ?? {})===JSON.stringify(first.keyframes ?? {}) && JSON.stringify(unit.appearance ?? null)===JSON.stringify(first.appearance ?? null))) {
      const order=cue.unitPlan.direction==='reverse' ? [...active].reverse() : active;
      const consistent=order.every((unit,index)=>Object.keys(unit.keyframes ?? {}).every(property=>(unit.delays?.[property] ?? unit.delayMs ?? 0)===index*cue.unitPlan.intervalMs));
      if (consistent) unitRecipe={mode:cue.unitPlan.mode,boundaries:[...cue.unitPlan.boundaries],interval:cue.unitPlan.intervalMs/duration,direction:cue.unitPlan.direction,keyframes:mapFrames(first.keyframes,scale),appearance:first.appearance ?? null};
    }
  }
  const preset={name:name.trim(),version:1,appearance:cue.appearance ?? null,keyframes:mapFrames(cue.keyframes,scale),units:units ?? null,motionPath,unitRecipe};
  if (!Object.keys(preset.keyframes).length && !preset.units && !preset.appearance && !preset.motionPath) throw new Error('저장할 효과가 없습니다.');
  return preset;
}
export function applyPreset(cue,preset,{prepareCue}={}) {
  if (!preset || preset.version!==1 || typeof preset.name!=='string') throw new Error('지원하지 않는 프리셋 형식입니다.');
  if (cue.style) throw new Error('가져온 스타일에 프리셋을 적용하는 기능은 아직 지원하지 않습니다.');
  const duration=cue.end-cue.start;
  if (!Number.isSafeInteger(duration) || duration<=0) throw new Error('자막 길이가 올바르지 않습니다.');
  const scale=t=>{if (!Number.isFinite(t) || t<0 || t>1000) throw new Error('프리셋 시간이 올바르지 않습니다.'); return Math.round(t*duration);};
  let updated={...cue,appearance:structuredClone(preset.appearance ?? undefined),keyframes:mapFrames(preset.keyframes,scale)};
  if (preset.motionPath) updated.motionPath={...structuredClone(preset.motionPath),start:scale(preset.motionPath.start),end:scale(preset.motionPath.end)};
  else delete updated.motionPath;
  if (preset.unitRecipe) {
    const recipe=preset.unitRecipe, intervalMs=scale(recipe.interval ?? 0), frames=mapFrames(recipe.keyframes,scale);
    if (!Object.keys(frames).length) throw new Error('프리셋에 단위별 효과가 없습니다.');
    delete updated.units; delete updated.unitPlan;
    for (const [property,keyframes] of Object.entries(frames)) updated=setUnitEffect(updated,{mode:recipe.mode,boundaries:recipe.boundaries ?? [],intervalMs,direction:recipe.direction,property,frames:keyframes});
    if (recipe.appearance) for (const unit of updated.units) if (Object.keys(unit.keyframes ?? {}).length) unit.appearance=structuredClone(recipe.appearance);
    const maxDelay=updated.units.reduce((max,unit)=>Object.keys(unit.keyframes ?? {}).reduce((n,property)=>Math.max(n,unit.delays?.[property] ?? unit.delayMs ?? 0),max),0);
    const available=duration-maxDelay;
    if (available<1) throw new Error('대상 자막이 짧아 프리셋의 시차를 적용할 수 없습니다.');
    const maxTime=Object.values(frames).flat().reduce((max,frame)=>Math.max(max,frame.time),0);
    if (maxTime>available) for (const unit of updated.units) for (const keyframes of Object.values(unit.keyframes ?? {})) for (const frame of keyframes) frame.time=Math.round(frame.time*available/maxTime);
  } else if (preset.units) {
    if (!Array.isArray(preset.units) || !preset.units.length) throw new Error('프리셋의 글자 묶음이 올바르지 않습니다.');
    const chars=splitUnits(cue.text,'character'); let cursor=0;
    updated.units=preset.units.map(unit=>{
      if (!Number.isSafeInteger(unit.count) || unit.count<1 || cursor+unit.count>chars.length) throw new Error('대상 자막의 글자 수가 프리셋과 다릅니다.');
      const text=chars.slice(cursor,cursor+unit.count).map(c=>c.text).join(''); cursor+=unit.count;
      return {text,delayMs:scale(unit.delay ?? 0),delays:Object.fromEntries(Object.entries(unit.delays ?? {}).map(([name,delay])=>[name,scale(delay)])),keyframes:mapFrames(unit.keyframes,scale),appearance:structuredClone(unit.appearance)};
    });
    if (cursor!==chars.length) throw new Error('대상 자막의 글자 수가 프리셋과 다릅니다.');
    delete updated.unitPlan;
  } else { delete updated.units; delete updated.unitPlan; }
  if (updated.units?.some(unit=>unit.keyframes?.position)) {
    if (typeof prepareCue!=='function') throw new Error('글자별 위치 프리셋을 적용하려면 영상 배치 정보가 필요합니다.');
    updated=prepareCue(updated);
  }
  compileAnimatedYtt([updated]);
  return updated;
}
export function parsePresetLibrary(text) {
  let data; try { data=JSON.parse(text); } catch { throw new Error('프리셋 파일을 읽을 수 없습니다.'); }
  if (data?.format!=='ytt-editor-presets' || data.version!==1 || !Array.isArray(data.presets) || data.presets.length>1000 || data.presets.some(p=>!p || p.version!==1 || typeof p.name!=='string' || !p.name.trim() || p.name.length>100)) throw new Error('프리셋 파일 형식이 올바르지 않습니다.');
  return data.presets;
}
export function stringifyPresetLibrary(presets) { const text=JSON.stringify({format:'ytt-editor-presets',version:1,presets},null,2); parsePresetLibrary(text); return text; }

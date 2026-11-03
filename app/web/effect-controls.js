import {evaluateKeyframes} from '/src/effects.js';

const properties=[['position','위치'],['size','크기'],['opacity','불투명도'],['color','글자색'],['backgroundColor','배경색'],['backgroundOpacity','배경 불투명도'],['edgeColor','윤곽선 색']];
const colors=new Set(['color','backgroundColor','edgeColor']);
const showValue=value=>Array.isArray(value)?value.join(', '):String(value);
function parseValue(property,text) {
  const input=text.trim();
  if(colors.has(property)) {if(!/^#[0-9a-f]{6}$/i.test(input)) throw new Error('#RRGGBB 형식의 색상을 입력하세요.'); return input.toUpperCase();}
  if(property==='position') {const values=input.split(',').map(value=>Number(value.trim())); if(values.length!==2 || values.some(value=>!Number.isFinite(value))) throw new Error('위치는 X,Y 형식으로 입력하세요.');return values;}
  const value=Number(input); if(input==='' || !Number.isFinite(value))throw new Error('숫자를 입력하세요.');
  if ((property==='opacity' || property==='backgroundOpacity') && (value<0 || value>254)) throw new Error('불투명도는 0~254여야 합니다.');
  if(property==='size' && (value<0 || value>10000))throw new Error('크기는 0~10000이어야 합니다.');
  return value;
}

/** Keyframe rows operate on a single cue or one existing text unit. */
export function createEffectControls({parent,getCue,getBaseState,getTime,commitFrames,seek,notify,isEditable,openUnitSettings}) {
  const panel=document.createElement('section'); panel.className='effect-controls';
  panel.innerHTML='<div class="effect-controls-head"><strong>효과 컨트롤</strong><span>현재 자막 기준</span></div><label class="effect-unit-label">편집 대상 <select class="effect-unit"></select><button type="button" class="unit-settings">단위 설정</button></label><p class="effect-instruction">행의 빈 곳을 클릭해 키프레임 추가 · ◆를 끌어 시간 이동 · 값을 바꿔 적용</p><div class="effect-ruler"><span>시작</span><span>자막 길이</span></div><div class="effect-rows"></div><div class="effect-actions"><button type="button" class="key-add">현재 위치에 ◆ 추가</button><button type="button" class="key-delete">선택 ◆ 삭제</button><output class="key-status">속성 행을 선택하세요.</output></div>';
  parent.prepend(panel);
  const rows=panel.querySelector('.effect-rows'),unitChoice=panel.querySelector('.effect-unit'),status=panel.querySelector('.key-status');
  let cueId=null,unit='all',property='opacity',selectedTime=null,drag=null; const expanded=new Set();
  const getUnit=cue=>unit==='all'?null:cue.units?.[Number(unit)];
  function delayFor(cue,name) {const part=getUnit(cue);return part ? (part.delays?.[name] ?? part.delayMs ?? 0) : (cue.delays?.[name] ?? cue.defaultDelayMs ?? 0);}
  function framesFor(cue,name) {const frames=(getUnit(cue)?.keyframes ?? (unit==='all'?cue.keyframes:null))?.[name] ?? [];const delay=delayFor(cue,name);return frames.map(frame=>({...frame,time:frame.time+delay}));}
  function valueAt(cue,name,time) {
    const frames=framesFor(cue,name);
    if(frames.length) return evaluateKeyframes(frames,time);
    const state=getBaseState(cue,unit,time);
    return unit!=='all' && name==='position' ? [0,0] : state[name];
  }
  function commit(cue,name,frames) {
    try {const delay=delayFor(cue,name);if(frames.some(frame=>frame.time<delay))throw new Error('키프레임은 이 단위의 시차보다 앞에 놓을 수 없습니다.');commitFrames(cue,unit,name,frames.map(frame=>({...frame,time:frame.time-delay}))); refresh(); return true;} catch(error) {notify(error.message);refresh();return false;}
  }
  function addAt(cue,name,time) {
    const duration=cue.end-cue.start; time=Math.max(0,Math.min(duration,Math.round(time)));
    try {
      const frames=structuredClone(framesFor(cue,name));
      if(!frames.some(frame=>frame.time===time)) frames.push({time,value:valueAt(cue,name,time),easing:'linear'});
      frames.sort((a,b)=>a.time-b.time); property=name; selectedTime=time;
      if(commit(cue,name,frames))seek(cue.start+time);
    } catch(error){notify(error.message);}
  }
  function refresh() {
    const cue=getCue(); panel.hidden=!cue; if(!cue)return;
    if(cueId!==cue.id){cueId=cue.id;unit='all';selectedTime=null;}
    const oldUnit=unit; unitChoice.replaceChildren();
    const whole=document.createElement('option');whole.value='all';whole.textContent='자막 전체';unitChoice.append(whole);
    (cue.units ?? []).forEach((part,index)=>{if(!/\S/u.test(part.text))return;const option=document.createElement('option');option.value=String(index);option.textContent=`${index+1}: ${part.text}`;unitChoice.append(option);});
    if(![...unitChoice.options].some(option=>option.value===oldUnit))unit='all';
    unitChoice.value=unit; rows.replaceChildren();
    const duration=cue.end-cue.start, elapsed=Math.max(0,Math.min(duration,getTime()-cue.start));
    for(const [name,label] of properties) {
      const row=document.createElement('div');row.className=`effect-row${property===name?' is-active':''}`;
      const title=document.createElement('button');title.type='button';title.className='effect-name';title.textContent=`${expanded.has(name)?'▾':'▸'} ${label}`;title.title='속성 선택 및 값 그래프 열기';
      title.onclick=()=>{property=name;selectedTime=null;if(expanded.has(name))expanded.delete(name);else expanded.add(name);refresh();};
      const value=document.createElement('input');value.type=colors.has(name)?'color':'text';value.className='effect-value';value.setAttribute('aria-label',`${label} 값`);
      try {const at=property===name && selectedTime!==null?selectedTime:elapsed;value.value=showValue(valueAt(cue,name,at));}catch{value.value='';}
      value.addEventListener('change',()=>{try{const newValue=parseValue(name,value.value),at=property===name && selectedTime!==null?selectedTime:Math.round(elapsed);const frames=structuredClone(framesFor(cue,name));const existing=frames.find(frame=>frame.time===at);if(existing)existing.value=newValue;else frames.push({time:at,value:newValue,easing:'linear'});frames.sort((a,b)=>a.time-b.time);property=name;selectedTime=at;commit(cue,name,frames);}catch(error){notify(error.message);refresh();}});
      const lane=document.createElement('div');lane.className='effect-lane';lane.title='클릭하여 해당 시점에 키프레임 추가';
      const playhead=document.createElement('span');playhead.className='effect-playhead';playhead.style.left=`${elapsed/duration*100}%`;lane.append(playhead);
      lane.addEventListener('click',event=>{if(event.target!==lane)return;const rect=lane.getBoundingClientRect();if(rect.width)addAt(cue,name,(event.clientX-rect.left)/rect.width*duration);});
      for(const frame of framesFor(cue,name)) {
        const key=document.createElement('button');key.type='button';key.className=`effect-diamond${name===property && frame.time===selectedTime?' selected':''}`;key.style.left=`${Math.max(0,Math.min(100,frame.time/duration*100))}%`;key.title=`${(frame.time/1000).toFixed(3)}초 · ${showValue(frame.value)}`;key.setAttribute('aria-label',`${label} ${(frame.time/1000).toFixed(3)}초 키프레임`);
        key.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();property=name;selectedTime=frame.time;drag={cue,name,oldTime:frame.time,newTime:frame.time,lane,key,pointer:event.pointerId};key.setPointerCapture(event.pointerId);});
        key.addEventListener('pointermove',event=>{if(!drag || drag.key!==key || drag.pointer!==event.pointerId)return;const rect=lane.getBoundingClientRect();if(!rect.width)return;drag.newTime=Math.round(Math.max(0,Math.min(duration,(event.clientX-rect.left)/rect.width*duration)));key.style.left=`${drag.newTime/duration*100}%`;});
        const finish=(event,cancelled)=>{if(!drag || drag.key!==key || drag.pointer!==event.pointerId)return;const current=drag;drag=null;if(cancelled){refresh();return;}const frames=structuredClone(framesFor(cue,name));if(current.newTime!==current.oldTime && frames.some(item=>item.time===current.newTime)){notify('같은 시각에 다른 키프레임이 있습니다.');refresh();return;}const chosen=frames.find(item=>item.time===current.oldTime);if(chosen)chosen.time=current.newTime;frames.sort((a,b)=>a.time-b.time);selectedTime=current.newTime;if(current.newTime===current.oldTime){seek(cue.start+selectedTime);refresh();}else if(commit(cue,name,frames))seek(cue.start+selectedTime);};
        key.addEventListener('pointerup',event=>finish(event,false));key.addEventListener('pointercancel',event=>finish(event,true));lane.append(key);
      }
      row.append(title,value,lane);rows.append(row);
      const frameList=framesFor(cue,name);
      if(expanded.has(name) && frameList.length && (typeof frameList[0].value==='number' || name==='position')) {
        const graph=document.createElement('div');graph.className='effect-graph';
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 40');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-label',`${label} 값 변화`);
        try {
          const dimensions=name==='position'?2:1, samples=Array.from({length:41},(_,i)=>evaluateKeyframes(frameList,duration*i/40));
          const numbers=samples.flatMap(value=>Array.isArray(value)?value:[value]);let low=Math.min(...numbers),high=Math.max(...numbers);if(high===low){low-=1;high+=1;}
          for(let axis=0;axis<dimensions;axis++) {
            const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.setAttribute('class',axis?'effect-curve secondary':'effect-curve');
            line.setAttribute('points',samples.map((value,i)=>`${i*2.5},${36-32*((Array.isArray(value)?value[axis]:value)-low)/(high-low)}`).join(' '));svg.append(line);
          }
          svg.addEventListener('click',event=>{const rect=svg.getBoundingClientRect();if(rect.width)addAt(cue,name,(event.clientX-rect.left)/rect.width*duration);});
          graph.append(svg);rows.append(graph);
        } catch { /* Invalid imported effects are reported on edit. */ }
      }
    }
    status.textContent=selectedTime===null?'속성 행을 선택하세요.':`${properties.find(item=>item[0]===property)?.[1]} · ${(selectedTime/1000).toFixed(3)}초`;
    const disabled=!isEditable(cue);for(const control of panel.querySelectorAll('button,input,select'))control.disabled=disabled;
    if(disabled)status.textContent='이 원본 구조는 효과 편집을 지원하지 않습니다.';
  }
  unitChoice.onchange=()=>{unit=unitChoice.value;selectedTime=null;refresh();};
  panel.querySelector('.unit-settings').onclick=openUnitSettings;
  panel.querySelector('.key-add').onclick=()=>{const cue=getCue();if(cue)addAt(cue,property,getTime()-cue.start);};
  panel.querySelector('.key-delete').onclick=()=>{const cue=getCue();if(!cue || selectedTime===null)return;const frames=structuredClone(framesFor(cue,property)).filter(frame=>frame.time!==selectedTime);selectedTime=null;commit(cue,property,frames);};
  function updatePlayhead() {const cue=getCue();if(!cue)return;const duration=cue.end-cue.start,percent=Math.max(0,Math.min(100,(getTime()-cue.start)/duration*100));for(const line of rows.querySelectorAll('.effect-playhead'))line.style.left=`${percent}%`;}
  return {refresh,updatePlayhead};
}

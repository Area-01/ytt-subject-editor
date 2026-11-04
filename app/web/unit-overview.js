import {evaluateKeyframes,evaluatePath} from '/src/effects.js';
const names=[['opacity','글자 불투명도'],['color','글자색'],['position','위치'],['size','크기'],['backgroundColor','배경색'],['backgroundOpacity','배경 불투명도'],['edgeColor','윤곽선 색']];

/** Read-only simultaneous view; editing remains in the effect-control tab. */
export function createUnitOverview(parent,{getCue,getPlan,getTime,seek}) {
  const panel=document.createElement('section');panel.className='unit-overview';
  panel.innerHTML='<div class="overview-options"><label>표시 단위 <select class="overview-mode"><option value="character">글자별</option><option value="group">현재 묶음</option></select></label><label>표시 속성 <select class="overview-property"></select></label></div><p>선택한 글자는 강조됩니다. ◆를 클릭하면 해당 시각으로 이동합니다.</p><div class="overview-header"><span>글자 · 묶음</span><span>시작 → 끝</span></div><div class="overview-rows"></div><div class="overview-pages"><button type="button" class="overview-prev">이전</button><span class="overview-note"></span><button type="button" class="overview-next">다음</button></div>';
  parent.append(panel);
  const select=panel.querySelector('.overview-property'),rows=panel.querySelector('.overview-rows'),note=panel.querySelector('.overview-note');
  let page=0,lastCue=null;const limit=250;
  const all=document.createElement('option');all.value='all';all.textContent='모든 효과';select.append(all);
  for(const [value,label] of names){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
  function refresh() {
    if(parent.hidden)return;
    const cue=getCue();rows.replaceChildren();if(!cue){note.textContent='';return;}if(lastCue!==cue.id){lastCue=cue.id;page=0;}
    let plan;try{plan=getPlan(cue,panel.querySelector('.overview-mode').value);}catch(error){note.textContent=error.message;return;}
    const units=plan.units,property=select.value,duration=cue.end-cue.start;
    page=Math.min(page,Math.max(0,Math.ceil(units.length/limit)-1));const first=page*limit;
    units.slice(first,first+limit).forEach((unit,localIndex)=>{
      const index=first+localIndex;
      const candidates=property==='all' ? names.map(([name])=>name) : [property];
      const shown=candidates.flatMap(name=>[
        ...(name==='position' && cue.motionPath ? [{name,source:'path'}] : []),
        ...(cue.keyframes?.[name]?.length ? [{name,source:'whole'}] : []),
        ...(unit.keyframes?.[name]?.length ? [{name,source:'unit'}] : [])
      ]);
      if(!shown.length)shown.push({name:null,source:'unit'});
      for(const item of shown) {
      const shownProperty=item.name;
      const row=document.createElement('div');row.className=`overview-row${plan.indices.includes(index)?' is-selected':''}`;
      const label=document.createElement('span');label.className='overview-label';const unitText=unit.text.replaceAll('\n','↵') || '공백';label.textContent=shownProperty ? `${unitText} · ${names.find(([key])=>key===shownProperty)?.[1]} (${item.source==='path'?'경로':item.source==='whole'?'전체':'부분'})` : unitText;label.title=label.textContent;
      const lane=document.createElement('div');lane.className='overview-lane';
      const delay=item.source==='whole' ? (cue.delays?.[shownProperty] ?? cue.defaultDelayMs ?? 0) : (unit.delays?.[shownProperty] ?? unit.delayMs ?? 0);
      const frames=item.source==='path' ? [{time:cue.motionPath.start,value:cue.motionPath.points[0]},{time:cue.motionPath.end,value:cue.motionPath.points[3]}] : ((item.source==='whole'?cue.keyframes:unit.keyframes)?.[shownProperty] ?? []).map(frame=>({...frame,time:frame.time+delay}));
      frames.sort((a,b)=>a.time-b.time);
      if(frames.length && frames.every(frame=>typeof frame.value==='string' && /^#[0-9a-f]{6}$/i.test(frame.value))) {
        const stops=frames.map(frame=>`${frame.value} ${Math.max(0,Math.min(100,frame.time/duration*100))}%`);
        lane.style.backgroundImage=`linear-gradient(to right, ${frames[0].value} 0%, ${stops.join(', ')}, ${frames[frames.length-1].value} 100%)`;
        lane.title='색상 변화의 대략적인 흐름입니다. 보간 곡선은 효과 편집에서 확인하세요.';
      }
      if(frames.length && (typeof frames[0].value==='number' || Array.isArray(frames[0].value))) {
        try {
          const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 32');svg.setAttribute('preserveAspectRatio','none');
          const samples=Array.from({length:33},(_,i)=>{const time=duration*i/32;if(item.source!=='path')return evaluateKeyframes(frames,time);const path=cue.motionPath;const progress=evaluateKeyframes([{time:path.start,value:0,easing:path.easing ?? 'linear'},{time:path.end,value:1}],time);return evaluatePath(path.points,progress);});
          const numbers=samples.flatMap(value=>Array.isArray(value)?value:[value]);let low=Math.min(...numbers),high=Math.max(...numbers);if(high===low){low-=1;high+=1;}
          for(let axis=0;axis<(Array.isArray(samples[0])?2:1);axis++) {const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.setAttribute('class',axis?'effect-curve secondary':'effect-curve');line.setAttribute('points',samples.map((value,i)=>`${i*100/32},${28-24*((Array.isArray(value)?value[axis]:value)-low)/(high-low)}`).join(' '));svg.append(line);}
          lane.append(svg);
        }catch{}
      }
      for(const frame of frames){const marker=document.createElement('button');marker.type='button';marker.className='overview-key';marker.style.left=`${Math.max(0,Math.min(100,frame.time/duration*100))}%`;if(typeof frame.value==='string' && /^#[0-9a-f]{6}$/i.test(frame.value))marker.style.backgroundColor=frame.value;marker.title=`${(frame.time/1000).toFixed(3)}초`;marker.setAttribute('aria-label',`${label.textContent} ${(frame.time/1000).toFixed(3)}초`);marker.onclick=()=>seek(cue.start+frame.time);lane.append(marker);}
      const playhead=document.createElement('span');playhead.className='overview-playhead';lane.append(playhead);row.append(label,lane);rows.append(row);
      }
    });
    note.textContent=units.length>limit ? `${first+1}–${Math.min(first+limit,units.length)} / ${units.length}` : `${units.length}개 단위 · ${property==='all'?'모든 효과':names.find(([key])=>key===property)?.[1]}`;
    panel.querySelector('.overview-prev').disabled=page===0;panel.querySelector('.overview-next').disabled=first+limit>=units.length;
    updatePlayhead();
  }
  function updatePlayhead(){if(parent.hidden)return;const cue=getCue();if(!cue)return;const percent=Math.max(0,Math.min(100,(getTime()-cue.start)/(cue.end-cue.start)*100));for(const marker of rows.querySelectorAll('.overview-playhead'))marker.style.left=`${percent}%`;}
  select.onchange=refresh;panel.querySelector('.overview-mode').onchange=()=>{page=0;refresh();};
  panel.querySelector('.overview-prev').onclick=()=>{if(page>0){page--;refresh();}};
  panel.querySelector('.overview-next').onclick=()=>{page++;refresh();};
  return {refresh,updatePlayhead};
}

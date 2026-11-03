/** Return new integer millisecond timings for a move or edge drag. */
export function calculateCueDrag(cue, operation, deltaMs, minDuration=1) {
  if (!Number.isSafeInteger(cue.start) || !Number.isSafeInteger(cue.end) || cue.start<0 || cue.end<=cue.start || !Number.isFinite(deltaMs) || !Number.isSafeInteger(minDuration) || minDuration<1) throw new Error('자막 시간 또는 이동량이 올바르지 않습니다.');
  const delta=Math.round(deltaMs);
  if (operation==='move') { const start=Math.max(0,cue.start+delta); return {start,end:start+(cue.end-cue.start)}; }
  if (operation==='start') return {start:Math.max(0,Math.min(cue.end-minDuration,cue.start+delta)),end:cue.end};
  if (operation==='end') return {start:cue.start,end:Math.max(cue.start+minDuration,cue.end+delta)};
  throw new Error('알 수 없는 타임라인 조작입니다.');
}

/** Snap a dragged edge to nearby sorted subtitle boundaries or video frames. */
export function snapCue(candidate,operation,{boundaries=[],fps=30,mode='none',tolerance=0}={}) {
  if (!['none','cues','frames','both'].includes(mode) || !['move','start','end'].includes(operation) || !Number.isFinite(tolerance) || tolerance<0) throw new Error('스냅 설정이 올바르지 않습니다.');
  if (mode==='none') return candidate;
  if (!Number.isFinite(fps) || fps<=0) throw new Error('프레임 속도가 올바르지 않습니다.');
  let best=null;
  const edges=operation==='move' ? [candidate.start,candidate.end] : [candidate[operation]];
  for (const edge of edges) {
    const points=[];
    if (mode==='cues' || mode==='both') {
      let low=0,high=boundaries.length;
      while(low<high) { const middle=(low+high)>>1; if(boundaries[middle]<edge) low=middle+1; else high=middle; }
      if(low<boundaries.length) points.push(boundaries[low]);
      if(low>0) points.push(boundaries[low-1]);
    }
    if (mode==='frames' || mode==='both') points.push(Math.round(Math.round(edge*fps/1000)*1000/fps));
    for(const point of points) {
      const delta=point-edge, distance=Math.abs(delta);
      if (distance>tolerance || (best && distance>=best.distance)) continue;
      const start=candidate.start+(operation==='end'?0:delta), end=candidate.end+(operation==='start'?0:delta);
      if (start<0 || end<=start) continue;
      best={start,end,distance};
    }
  }
  return best ? {start:best.start,end:best.end} : candidate;
}

/** Sorted interval index; prefix maxima keep long overlapping cues visible. */
export function indexCues(cues) {
  const sorted=cues.map((cue,order)=>({cue,order})).sort((a,b)=>a.cue.start-b.cue.start || a.order-b.order).map(entry=>entry.cue);
  const maxEnd=[]; let max=-Infinity;
  for (const cue of sorted) { max=Math.max(max,cue.end); maxEnd.push(max); }
  return {sorted,maxEnd};
}

/** Assign non-overlapping visual rows while retaining each cue's track. */
export function packCueLanes(cues) {
  const ordered=cues.map((cue,order)=>({cue,order})).sort((a,b)=>a.cue.start-b.cue.start || a.order-b.order);
  const busy=[], free=[], lanes=new Map(); let count=0;
  function push(heap,value,compare) {
    heap.push(value); let i=heap.length-1;
    while(i>0) { const p=(i-1)>>1; if(compare(heap[p],value)<=0) break; heap[i]=heap[p]; i=p; }
    heap[i]=value;
  }
  function pop(heap,compare) {
    const first=heap[0], last=heap.pop();
    if(heap.length) {
      let i=0;
      while(true) { let child=i*2+1; if(child>=heap.length) break; if(child+1<heap.length && compare(heap[child+1],heap[child])<0) child++; if(compare(last,heap[child])<=0) break; heap[i]=heap[child]; i=child; }
      heap[i]=last;
    }
    return first;
  }
  const byEnd=(a,b)=>a.end-b.end || a.lane-b.lane, byNumber=(a,b)=>a-b;
  for(const {cue} of ordered) {
    while(busy.length && busy[0].end<=cue.start) push(free,pop(busy,byEnd).lane,byNumber);
    const lane=free.length ? pop(free,byNumber) : count++;
    lanes.set(cue,lane); push(busy,{end:cue.end,lane},byEnd);
  }
  return {lanes,count:Math.max(1,count)};
}

/** Return intervals intersecting [start,end), including earlier long cues. */
export function queryCues(index,start,end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end<=start) return [];
  const {sorted,maxEnd}=index; let low=0,high=sorted.length;
  while (low<high) { const mid=(low+high)>>1; if(sorted[mid].start<end) low=mid+1; else high=mid; }
  const result=[];
  for(let i=low-1;i>=0 && maxEnd[i]>start;i--) if(sorted[i].end>start) result.push(sorted[i]);
  return result.reverse();
}

export function findEventAt(events,time) {
  let low=0,high=events.length;
  while(low<high) {const mid=(low+high)>>1;if(events[mid].start<=time)low=mid+1;else high=mid;}
  const event=events[low-1];
  return event && time<event.end ? event : undefined;
}

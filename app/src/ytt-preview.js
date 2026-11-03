import {parseYtt,getTextRuns} from './ytt-document.js';
import {animatedStateAt} from './animated-ytt.js';

/** Refuse conversion when paragraph or referenced definitions contain unsupported data. */
export function canAnimateOriginal(source,index) {
  try {
    const doc=parseYtt(source), cue=doc.cues[index];
    if (!cue || cue.children.length || source.slice(cue.contentStart,cue.contentEnd).includes('<')) return false;
    const allowedCue=new Set(['t','d','p','wp']);
    if (Object.keys(cue.attrs).some(name=>!allowedCue.has(name))) return false;
    const head=doc.root.children.find(node=>node.name==='head');
    for (const [attribute,type,allowed] of [['p','pen',new Set(['id','fc','fo','bc','bo','sz','fs','b','i','u','ec','et'])],['wp','wp',new Set(['id','ap','ah','av'])]]) {
      const id=cue.attrs[attribute]?.value;
      if (id==null) continue;
      const definition=head?.children.find(node=>node.name===type && node.attrs.id?.value===id);
      if (!definition) { if (id==='0') continue; return false; }
      if (definition.children.length || definition.contentStart!==definition.contentEnd || Object.keys(definition.attrs).some(name=>!allowed.has(name))) return false;
      if (type==='pen' && (definition.attrs.fo?.value==='255' || definition.attrs.bo?.value==='255')) return false;
    }
    originalPreview(source,index);
    return true;
  } catch { return false; }
}

// A best-effort interpretation for preview only. The source document is never rewritten.
export function originalPreview(source,index,textEdits,override) {
  const doc=parseYtt(source), cue=doc.cues[index];
  if (!cue) throw new Error('원본 자막을 찾을 수 없습니다.');
  const head=doc.root.children.find(node=>node.name==='head');
  const lookup=(type,id)=>head?.children.find(node=>node.name===type && node.attrs.id?.value===id);
  function penStyle(id) {
    if (id==null) return {};
    const pen=lookup('pen',id);
    if (!pen) { if (id==='0') return {}; throw new Error('원본 글꼴 스타일 참조를 찾을 수 없습니다.'); }
    const result={};
    for (const [attr,name] of [['fc','color'],['bc','backgroundColor'],['ec','edgeColor']]) if (pen.attrs[attr]) result[name]=pen.attrs[attr].value;
    for (const [attr,name] of [['fo','opacity'],['bo','backgroundOpacity'],['sz','size'],['fs','font'],['et','edgeType']]) if (pen.attrs[attr]) result[name]=Number(pen.attrs[attr].value);
    for (const [attr,name] of [['b','bold'],['i','italic'],['u','underline']]) if (pen.attrs[attr]) result[name]=pen.attrs[attr].value==='1';
    if (result.opacity===255) result.opacity=254;
    if (result.backgroundOpacity===255) result.backgroundOpacity=254;
    return result;
  }
  const base={backgroundOpacity:191,...penStyle(cue.attrs.p?.value),...override};
  const wpId=cue.attrs.wp?.value, wp=wpId==null ? null : lookup('wp',wpId);
  if (wpId!=null && !wp && wpId!=='0') throw new Error('원본 위치 참조를 찾을 수 없습니다.');
  if (wp) { base.position=[Number(wp.attrs.ah?.value ?? 50),Number(wp.attrs.av?.value ?? 90)]; base.anchor=Number(wp.attrs.ap?.value ?? 7); }
  const wsId=cue.attrs.ws?.value, ws=wsId==null ? null : lookup('ws',wsId);
  if (wsId!=null && !ws && wsId!=='0') throw new Error('원본 문단 스타일 참조를 찾을 수 없습니다.');
  const justify=Number(ws?.attrs.ju?.value ?? 2), direction=Number(ws?.attrs.pd?.value ?? 0), flow=Number(ws?.attrs.sd?.value ?? 0);
  const layout={align:({0:'left',1:'right',2:'center'})[justify] ?? 'center',direction:direction===1 ? 'rtl' : 'ltr',writingMode:'horizontal-tb',orientation:'mixed'};
  if (direction===2) { layout.writingMode=flow===1 ? 'vertical-lr' : 'vertical-rl'; layout.orientation='upright'; }
  if (direction===3) { layout.writingMode=flow===1 ? 'vertical-rl' : 'vertical-lr'; layout.orientation='sideways'; }
  const state=animatedStateAt({appearance:base},0);
  const runs=getTextRuns(doc,cue);
  if (textEdits && textEdits.length!==runs.length) throw new Error('원본 텍스트 구간이 일치하지 않습니다.');
  const parts=runs.map((run,i)=>{
    const ancestors=doc.elements.filter(node=>node.name==='s' && node.start>=cue.contentStart && node.end<=cue.contentEnd && node.contentStart<=run.start && node.contentEnd>=run.end).sort((a,b)=>a.start-b.start);
    const style={...base}; let appearAt=0;
    for(const span of ancestors) {
      Object.assign(style,penStyle(span.attrs.p?.value));
      if (span.attrs.t) {
        const value=Number(span.attrs.t.value);
        if (!Number.isSafeInteger(value) || value<0) throw new Error('텍스트 구간의 표시 시간이 올바르지 않습니다.');
        appearAt=Math.max(appearAt,value);
      }
    }
    return {text:textEdits?.[i] ?? run.value,state:animatedStateAt({appearance:style},0),appearAt};
  });
  const timed=doc.elements.some(node=>node.name==='s' && node.start>=cue.contentStart && node.end<=cue.contentEnd && node.attrs.t);
  return {state,parts,timed,layout};
}

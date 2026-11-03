import {parseYtt,setAttributes} from './ytt-document.js';
import {applyEdits} from './ytt-preserve.js';

function context(source,index) {
  const doc=parseYtt(source), cue=doc.cues[index];
  if (!cue) throw new Error('원본 자막을 찾을 수 없습니다.');
  const head=doc.root.children.find(n=>n.name==='head'), body=doc.root.children.find(n=>n.name==='body');
  const pens=(head?.children ?? []).filter(n=>n.name==='pen');
  let previous=-1;
  for (const pen of pens) {
    const raw=pen.attrs.id?.value, id=Number(raw);
    if (!/^\d+$/.test(raw ?? '') || !Number.isSafeInteger(id) || id<=previous) throw new Error('원본 스타일 ID가 오름차순 정수가 아닙니다.');
    previous=id;
  }
  const known=(head?.children ?? []).filter(n=>['pen','ws','wp'].includes(n.name)), ranks={pen:0,ws:1,wp:2};
  if (known.some((n,i)=>i && ranks[n.name]<ranks[known[i-1].name])) throw new Error('원본 스타일 정의 순서가 올바르지 않습니다.');
  const ref=cue.attrs.p?.value;
  const pen=ref==null ? null : pens.find(n=>n.attrs.id.value===ref);
  if (ref!=null && !pen && ref!=='0') throw new Error('원본 자막의 스타일 참조를 찾을 수 없습니다.');
  return {doc,cue,head,body,pen,nextId:Math.max(0,previous)+1};
}

export function readCueStyle(source,index) {
  const {cue,pen}=context(source,index);
  const font=Number(pen?.attrs.fs?.value ?? 4), boldValue=pen?.attrs.b?.value ?? '0', edgeType=Number(pen?.attrs.et?.value ?? 0), edgeColor=pen?.attrs.ec?.value ?? '#000000';
  const color=pen?.attrs.fc?.value ?? '#FEFEFE', opacity=Number(pen?.attrs.fo?.value ?? 254), backgroundColor=pen?.attrs.bc?.value ?? '#080808', backgroundOpacity=Number(pen?.attrs.bo?.value ?? 191), size=Number(pen?.attrs.sz?.value ?? 100);
  if (!Number.isInteger(font) || font<0 || font>7 || !['0','1'].includes(boldValue) || !Number.isInteger(edgeType) || edgeType<0 || edgeType>4 || !/^#[0-9a-f]{6}$/i.test(edgeColor)) throw new Error('원본 스타일의 일부 값이 편집 범위를 벗어납니다.');
  if (![color,backgroundColor].every(value=>/^#[0-9a-f]{6}$/i.test(value)) || !Number.isInteger(opacity) || opacity<0 || opacity>255 || !Number.isInteger(backgroundOpacity) || backgroundOpacity<0 || backgroundOpacity>255 || !Number.isInteger(size) || size<0 || size>10000) throw new Error('원본 색상 또는 크기가 편집 범위를 벗어납니다.');
  return {font,bold:boldValue==='1',edgeType,edgeColor,color,opacity:Math.min(opacity,254),backgroundColor,backgroundOpacity:Math.min(backgroundOpacity,254),size,hasStyledSpans:cue.children.some(n=>n.name==='s' && n.attrs.p)};
}

export function setCueStyle(source,index,style) {
  const {cue,head,body,pen,nextId}=context(source,index);
  if (!Number.isSafeInteger(nextId) || !style || !Number.isInteger(style.font) || style.font<0 || style.font>7 || typeof style.bold!=='boolean' || !Number.isInteger(style.edgeType) || style.edgeType<0 || style.edgeType>4 || !/^#[0-9a-f]{6}$/i.test(style.edgeColor ?? '')) throw new Error('스타일 값이 올바르지 않습니다.');
  for (const key of ['color','backgroundColor']) if (style[key]!=null && !/^#[0-9a-f]{6}$/i.test(style[key])) throw new Error('색상 값이 올바르지 않습니다.');
  for (const key of ['opacity','backgroundOpacity','size']) if (style[key]!=null && (!Number.isInteger(style[key]) || style[key]<0 || style[key]>(key==='size'?10000:254))) throw new Error('크기 또는 불투명도가 올바르지 않습니다.');
  const raw=pen ? source.slice(pen.start,pen.end) : '<pen />';
  let temp=`<timedtext><head>${raw}</head><body/></timedtext>`;
  let clone=parseYtt(temp), clonePen=clone.elements.find(n=>n.name==='pen');
  const attrs={id:nextId,fs:style.font,b:style.bold?1:0,et:style.edgeType,ec:style.edgeColor};
  for (const [key,attribute] of [['color','fc'],['opacity','fo'],['backgroundColor','bc'],['backgroundOpacity','bo'],['size','sz']]) if (style[key]!=null) attrs[attribute]=style[key];
  temp=setAttributes(clone,clonePen,attrs);
  clone=parseYtt(temp); clonePen=clone.elements.find(n=>n.name==='pen');
  const definition=temp.slice(clonePen.start,clonePen.end);
  let insert;
  if (!head) insert={start:body.start,end:body.start,text:`<head>\n    ${definition}\n</head>\n`};
  else if (head.end===head.openEnd) {
    const tag=source.slice(head.start,head.openEnd).replace(/\/\s*>$/, '>');
    insert={start:head.start,end:head.end,text:`${tag}\n    ${definition}\n</head>`};
  } else {
    const afterPen=head.children.find(n=>n.name==='ws' || n.name==='wp');
    const offset=afterPen?.start ?? head.contentEnd;
    insert={start:offset,end:offset,text:`\n    ${definition}\n`};
  }
  let updated=applyEdits(source,[insert]);
  const doc=parseYtt(updated);
  updated=setAttributes(doc,doc.cues[index],{p:nextId});
  return updated;
}

import {parseYtt} from './ytt-document.js';
import {applyEdits} from './ytt-preserve.js';
import {compileAnimatedYtt} from './animated-ytt.js';

/** Sort paragraph slots while leaving every other source byte in its place. */
export function orderYttCues(source) {
  const doc=parseYtt(source), body=doc.root.children.find(node=>node.name==='body');
  const cues=doc.cues.map((node,index)=>({node,index,time:Number(node.attrs.t?.value ?? 0)}));
  if (cues.some(item=>!Number.isSafeInteger(item.time) || item.time<0)) throw new Error('원본 자막 시간이 올바르지 않습니다.');
  if (cues.every((item,index)=>index===0 || cues[index-1].time<=item.time)) return {xml:source,reordered:false};
  if (body.children.some(node=>node.name!=='p')) throw new Error('원본 본문에 다른 요소가 있어 자막 순서를 안전하게 바꿀 수 없습니다.');
  const sorted=[...cues].sort((a,b)=>a.time-b.time || a.index-b.index);
  const edits=cues.map((item,index)=>({start:item.node.start,end:item.node.end,text:source.slice(sorted[index].node.start,sorted[index].node.end)}));
  return {xml:applyEdits(source,edits),reordered:true};
}

/** Append new cues without rewriting pre-existing XML or reusing existing IDs. */
export function mergeNewCues(original, cues, options={}) {
  if (!cues.length) return {xml:original,segments:0,bytes:new TextEncoder().encode(original).length,warnings:[]};
  const target=parseYtt(original), generated=compileAnimatedYtt(cues,options);
  let src=generated.xml, addition=parseYtt(src);
  const targetHead=target.root.children.find(n=>n.name==='head');
  const targetBody=target.root.children.find(n=>n.name==='body');
  const addedHead=addition.root.children.find(n=>n.name==='head');
  const maps={pen:new Map(),wp:new Map()};
  for (const type of ['pen','wp']) {
    const entries=(targetHead?.children ?? []).filter(n=>n.name===type);
    let max=0, previous=-1;
    for (const entry of entries) {
      const raw=entry.attrs.id?.value;
      if (!/^\d+$/.test(raw ?? '') || !Number.isSafeInteger(Number(raw)) || Number(raw)<=previous) throw new Error(`원본 ${type} ID가 오름차순 정수가 아니므로 새 자막을 안전하게 추가할 수 없습니다.`);
      previous=Number(raw); max=Math.max(max,previous);
    }
    for (const entry of addedHead.children.filter(n=>n.name===type)) {
      if (!Number.isSafeInteger(++max)) throw new Error('새 스타일 ID를 할당할 수 없습니다.');
      maps[type].set(entry.attrs.id.value,String(max));
    }
  }
  const known=(targetHead?.children ?? []).filter(n=>['pen','ws','wp'].includes(n.name));
  const ranks={pen:0,ws:1,wp:2};
  if (known.some((node,i)=>i>0 && ranks[node.name]<ranks[known[i-1].name])) throw new Error('원본 스타일 정의 순서가 불명확하여 새 자막을 안전하게 추가할 수 없습니다.');
  const remap=[];
  for (const node of addition.elements) {
    const attrs=[];
    if (node.name==='pen') attrs.push(['id','pen']);
    if (node.name==='wp') attrs.push(['id','wp']);
    if (node.name==='p' || node.name==='s') attrs.push(['p','pen'],['wp','wp']);
    for (const [name,type] of attrs) {
      const attr=node.attrs[name]; if (!attr) continue;
      const value=maps[type].get(attr.value);
      if (value==null) throw new Error('생성된 스타일 참조가 올바르지 않습니다.');
      remap.push({start:attr.start,end:attr.end,text:value});
    }
  }
  src=applyEdits(src,remap); addition=parseYtt(src);
  const sourceHead=addition.root.children.find(n=>n.name==='head');
  const defs=type=>sourceHead.children.filter(n=>n.name===type).map(n=>src.slice(n.start,n.end));
  const pens=defs('pen'), positions=defs('wp'), patches=[];
  const text=items=>items.length ? '\n    '+items.join('\n    ')+'\n' : '';
  if (!targetHead) patches.push({start:targetBody.start,end:targetBody.start,text:`<head>${text(pens)}${text(positions)}</head>\n`});
  else if (targetHead.end===targetHead.openEnd) {
    const tag=original.slice(targetHead.start,targetHead.openEnd).replace(/\/\s*>$/, '>');
    patches.push({start:targetHead.start,end:targetHead.end,text:`${tag}${text(pens)}${text(positions)}</head>`});
  } else {
    const next=targetHead.children.find(n=>n.name==='ws' || n.name==='wp');
    const penPos=next?.start ?? targetHead.contentEnd;
    patches.push({start:penPos,end:penPos,text:text(pens)});
    patches.push({start:targetHead.contentEnd,end:targetHead.contentEnd,text:text(positions)});
  }
  const originalTimes=target.cues.map(c=>Number(c.attrs.t?.value ?? 0));
  if (originalTimes.some((t,i)=>!Number.isSafeInteger(t) || t<0 || (i>0 && t<originalTimes[i-1]))) throw new Error('원본 자막 시간 순서가 올바르지 않아 새 자막을 추가할 수 없습니다.');
  const additions=addition.cues.map(c=>({time:Number(c.attrs.t.value),xml:src.slice(c.start,c.end)}));
  if (targetBody.end===targetBody.openEnd) {
    const tag=original.slice(targetBody.start,targetBody.openEnd).replace(/\/\s*>$/, '>');
    patches.push({start:targetBody.start,end:targetBody.end,text:`${tag}${text(additions.map(x=>x.xml))}</body>`});
  } else {
    const groups=new Map();
    for (const cue of additions) {
      const index=originalTimes.findIndex(t=>t>cue.time);
      const offset=index<0 ? targetBody.contentEnd : target.cues[index].start;
      if (!groups.has(offset)) groups.set(offset,[]);
      groups.get(offset).push(cue.xml);
    }
    for (const [offset,items] of groups) patches.push({start:offset,end:offset,text:text(items)});
  }
  const xml=applyEdits(original,patches);
  return {xml,segments:generated.segments,bytes:new TextEncoder().encode(xml).length,warnings:generated.warnings};
}

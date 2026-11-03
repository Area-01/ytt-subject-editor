/** Calculate percent offsets from measured text, keeping whitespace in layout. */
export function layoutUnits(units,{width,height,lineHeight,anchor=7,measure}) {
  if (!Array.isArray(units) || !units.length || !Number.isFinite(width) || width<=0 || !Number.isFinite(height) || height<=0 || !Number.isFinite(lineHeight) || lineHeight<=0 || !Number.isInteger(anchor) || anchor<0 || anchor>8 || typeof measure!=='function') throw new Error('텍스트 배치 정보가 올바르지 않습니다.');
  const rows=[[]];
  for (let i=0;i<units.length;i++) {
    const unit=units[i];
    if (typeof unit.text!=='string') throw new Error('텍스트 단위가 올바르지 않습니다.');
    if (/\r/.test(unit.text)) throw new Error('줄바꿈 형식을 먼저 변환하세요.');
    if (unit.text.includes('\n') && /\S/u.test(unit.text)) throw new Error('줄바꿈을 포함한 글자 묶음은 따로 나누어 주세요.');
    const pieces=unit.text.split('\n');
    for (let part=0;part<pieces.length;part++) {
      if (part) rows.push([]);
      if (pieces[part]) {
        const value=measure(pieces[part],unit);
        if (!Number.isFinite(value) || value<0) throw new Error('글자 폭을 측정할 수 없습니다.');
        rows.at(-1).push({index:i,text:pieces[part],width:value});
      }
    }
  }
  const ax=(anchor%3)/2, ay=Math.floor(anchor/3)/2, fullHeight=rows.length*lineHeight;
  const result=units.map(unit=>({...unit,layoutOffset:null}));
  rows.forEach((row,line)=>{
    const lineWidth=row.reduce((sum,item)=>sum+item.width,0); let x=0;
    for (const item of row) {
      if (/\S/u.test(item.text)) {
        result[item.index].layoutOffset=[(x+item.width*ax-lineWidth*ax)/width*100,(line*lineHeight+lineHeight*ay-fullHeight*ay)/height*100];
      }
      x+=item.width;
    }
  });
  return result;
}

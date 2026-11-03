const fontMap=new Map([['courier new',1],['times new roman',2],['lucida console',3],['roboto',4],['comic sans ms',5],['monotype corsiva',6]]);
const alignments={1:[6,0,90],2:[7,50,90],3:[8,100,90],4:[3,0,50],5:[4,50,50],6:[5,100,50],7:[0,0,10],8:[1,50,10],9:[2,100,10]};

/** ASS appearance is approximated using the fixed YTT font and edge types. */
export function convertAssStyle(style) {
  if (!style) return {appearance:null,warnings:[]};
  const warnings=new Set(), appearance={};
  appearance.bold=!!style.bold; appearance.italic=!!style.italic; appearance.underline=!!style.underline;
  if (style.font) {
    const font=fontMap.get(style.font.toLowerCase());
    if (font===undefined) { appearance.font=4; warnings.add(`지원되지 않는 ASS 글꼴 '${style.font}'을 기본 고딕으로 대체했습니다.`); }
    else appearance.font=font;
  }
  if (style.foreground) { appearance.color=style.foreground.color; appearance.opacity=Math.min(254,style.foreground.opacity); }
  if (style.size && style.baseSize>0) {
    const realPercent=style.size/style.baseSize*100;
    appearance.size=Math.max(0,Math.round(100+4*(realPercent-100)));
    if (realPercent<75) warnings.add('ASS 글자 크기가 YTT 최소 크기보다 작아 최솟값으로 조정했습니다.');
  } else if (style.size) warnings.add('ASS 기준 글자 크기가 없어 기본 크기를 사용합니다.');
  const align=alignments[style.alignment];
  if (align) { appearance.anchor=align[0]; appearance.position=align.slice(1); }
  else if (style.alignment) warnings.add('지원되지 않는 ASS 정렬은 기본 위치로 표시합니다.');
  if (style.margins?.some(value=>value!==0)) warnings.add('ASS 여백은 유튜브 위치에 정확히 적용되지 않습니다.');
  if (style.outlineWidth>0 && style.outline) { appearance.edgeType=3; appearance.edgeColor=style.outline.color; }
  else if (style.shadowDistance>0 && style.shadow) { appearance.edgeType=1; appearance.edgeColor=style.shadow.color; }
  if (style.outlineWidth>0 && style.shadowDistance>0) warnings.add('ASS 윤곽선과 그림자가 함께 있을 때 YTT에서는 윤곽선을 우선 적용합니다.');
  if ((style.outlineWidth>0 && style.outline?.opacity<255) || (style.shadowDistance>0 && style.shadow?.opacity<255)) warnings.add('윤곽선·그림자의 독립 투명도는 적용되지 않습니다.');
  return {appearance,warnings:[...warnings]};
}

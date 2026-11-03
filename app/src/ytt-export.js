const fonts = new Map([['courier new', 1], ['times new roman', 2], ['lucida console', 3],
  ['roboto', 4], ['comic sans ms', 5], ['monotype corsiva', 6]]);
const xmlText = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Export new cues. Existing YTT documents must use the preserving editor instead. */
export function exportYtt(cues) {
  const warnings = new Set();
  const pens = new Map();
  const paragraphs = [];
  const ordered=cues.map((cue,index)=>({cue,index})).sort((a,b)=>a.cue.start-b.cue.start || a.index-b.index);
  for (const {cue} of ordered) {
    if (!Number.isSafeInteger(cue.start) || !Number.isSafeInteger(cue.end) || cue.start < 0 || cue.end <= cue.start) {
      throw new Error('자막 시간은 0 이상의 정수 밀리초여야 하며 종료가 시작보다 늦어야 합니다.');
    }
    const style = cue.style;
    let pen = '';
    if (style) {
      const attrs = [];
      if (style.bold) attrs.push('b="1"');
      if (style.italic) attrs.push('i="1"');
      if (style.underline) attrs.push('u="1"');
      if (style.foreground && /^#[0-9a-f]{6}$/i.test(style.foreground.color)) {
        attrs.push(`fc="${style.foreground.color}"`);
        if (Number.isInteger(style.foreground.opacity)) attrs.push(`fo="${Math.max(0, Math.min(254, style.foreground.opacity))}"`);
      }
      if (style.font) {
        const font = fonts.get(style.font.toLowerCase());
        if (font === undefined) warnings.add(`유튜브에서 지원하는 글꼴로 변경해야 합니다: ${style.font}`);
        else attrs.push(`fs="${font}"`);
      }
      if (style.size != null) warnings.add('ASS 글자 크기는 기준 스타일과의 비율을 확인해야 하므로 자동 적용하지 않았습니다.');
      if (style.outline || style.shadow) warnings.add('ASS 윤곽선·그림자의 표시 방식은 유튜브와 다르므로 자동 적용하지 않았습니다.');
      if (style.alignment) warnings.add('ASS 정렬은 영상 크기를 확인한 뒤 적용해야 합니다.');
      const key = attrs.join(' ');
      if (key) {
        if (!pens.has(key)) pens.set(key, pens.size + 1);
        pen = ` p="${pens.get(key)}"`;
      }
    }
    paragraphs.push(`    <p t="${cue.start}" d="${cue.end - cue.start}"${pen}>${xmlText(cue.text)}</p>`);
  }
  const definitions = [...pens].map(([attrs, id]) => `    <pen id="${id}" ${attrs} />`).join('\n');
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<timedtext format="3">\n<head>\n${definitions}${definitions ? '\n' : ''}</head>\n<body>\n${paragraphs.join('\n')}\n</body>\n</timedtext>\n`;
  return { xml, warnings: [...warnings] };
}

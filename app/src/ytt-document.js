import { applyEdits, escapeXmlAttribute } from './ytt-preserve.js';

// Tokenize the original text so edits can preserve comments, unknown attributes,
// whitespace and elements that are not yet understood by the editor.
function tokenize(source) {
  const tokens = [];
  let pos = 0;
  while ((pos = source.indexOf('<', pos)) !== -1) {
    const start = pos;
    if (source.startsWith('<!--', pos)) {
      const end = source.indexOf('-->', pos + 4);
      if (end < 0) throw new Error('Unterminated XML comment');
      pos = end + 3; continue;
    }
    if (source.startsWith('<![CDATA[', pos)) {
      const end = source.indexOf(']]>', pos + 9);
      if (end < 0) throw new Error('Unterminated CDATA');
      pos = end + 3; continue;
    }
    if (source.startsWith('<?', pos)) {
      const end = source.indexOf('?>', pos + 2);
      if (end < 0) throw new Error('Unterminated XML instruction');
      pos = end + 2; continue;
    }
    if (source.startsWith('<!', pos)) throw new Error('DTD and declarations are not supported');
    let quote = null;
    for (pos++; pos < source.length; pos++) {
      const c = source[pos];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (pos >= source.length) throw new Error('Unterminated XML tag');
    const end = ++pos;
    tokens.push({ start, end, raw: source.slice(start, end) });
  }
  return tokens;
}

function decode(value) {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, entity) => {
    if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity];
  });
}

function attributes(token, offset) {
  const attrs = {};
  const raw = token.raw;
  let i = offset;
  while (i < raw.length) {
    while (/\s/.test(raw[i] || '')) i++;
    if (raw[i] === '>' || raw[i] === '/' || i >= raw.length) break;
    const match = /^[A-Za-z_:][\w:.-]*/.exec(raw.slice(i));
    if (!match) throw new Error('Invalid XML attribute');
    const name = match[0]; i += name.length;
    while (/\s/.test(raw[i] || '')) i++;
    if (raw[i++] !== '=') throw new Error('Expected attribute value');
    while (/\s/.test(raw[i] || '')) i++;
    const quote = raw[i++];
    if (quote !== '"' && quote !== "'") throw new Error('Unquoted XML attribute');
    const valueStart = i;
    while (i < raw.length && raw[i] !== quote) i++;
    if (i >= raw.length || Object.hasOwn(attrs, name)) throw new Error('Invalid or duplicate XML attribute');
    attrs[name] = { value: decode(raw.slice(valueStart, i)), start: token.start + valueStart, end: token.start + i, quote };
    i++;
  }
  return attrs;
}

export function parseYtt(source) {
  const stack = [];
  const elements = [];
  for (const token of tokenize(source)) {
    const close = /^<\/\s*([A-Za-z_:][\w:.-]*)\s*>$/.exec(token.raw);
    if (close) {
      const node = stack.pop();
      if (!node || node.name !== close[1]) throw new Error('Mismatched XML closing tag');
      node.contentEnd = token.start; node.end = token.end;
      continue;
    }
    const open = /^<([A-Za-z_:][\w:.-]*)/.exec(token.raw);
    if (!open) throw new Error('Invalid XML tag');
    const selfClosing = /\/\s*>$/.test(token.raw);
    const node = { name: open[1], start: token.start, openEnd: token.end, end: token.end,
      contentStart: token.end, contentEnd: token.end, attrs: attributes(token, open[0].length),
      parent: stack.at(-1) ?? null, children: [] };
    if (node.parent) node.parent.children.push(node);
    elements.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length) throw new Error('Unclosed XML element');
  const roots = elements.filter(e => !e.parent);
  if (roots.length !== 1 || roots[0].name !== 'timedtext') throw new Error('Expected timedtext root');
  const body = roots[0].children.find(e => e.name === 'body');
  if (!body) throw new Error('Missing timedtext body');
  return { source, root: roots[0], elements, cues: body.children.filter(e => e.name === 'p') };
}

export function setAttributes(document, node, values) {
  if (!document.elements.includes(node)) throw new Error('Node does not belong to document');
  const edits = [];
  const additions = [];
  for (const [name, value] of Object.entries(values)) {
    if (!/^[A-Za-z_:][\w:.-]*$/.test(name)) throw new Error('Invalid attribute name');
    if (value == null) throw new Error('Attribute removal is not supported');
    const existing = node.attrs[name];
    if (existing) edits.push({ start: existing.start, end: existing.end, text: escapeXmlAttribute(value) });
    else additions.push(` ${name}="${escapeXmlAttribute(value)}"`);
  }
  if (additions.length) {
    const tag = document.source.slice(node.start, node.openEnd);
    const end = node.start + tag.search(/\s*\/?>$/);
    edits.push({ start: end, end, text: additions.join('') });
  }
  return applyEdits(document.source, edits);
}

/** Return editable text runs while retaining source offsets for tags and comments. */
export function getTextRuns(document, node) {
  if (!document.elements.includes(node)) throw new Error('Node does not belong to document');
  const source=document.source.slice(node.contentStart,node.contentEnd);
  const token=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^"'<>]|"[^"]*"|'[^']*')*>|[^<]+/gy;
  const runs=[]; let pos=0, match;
  while (pos < source.length) {
    token.lastIndex=pos; match=token.exec(source);
    if (!match) throw new Error('자막 텍스트 구조를 안전하게 읽을 수 없습니다.');
    const raw=match[0], start=node.contentStart+pos; pos=token.lastIndex;
    if (raw.startsWith('<![CDATA[')) runs.push({start,end:start+raw.length,value:raw.slice(9,-3).replace(/\r\n?/g,'\n')});
    else if (!raw.startsWith('<')) runs.push({start,end:start+raw.length,value:decode(raw).replace(/\r\n?/g,'\n')});
  }
  return runs;
}

export function replaceTextRuns(document,node,values) {
  const runs=getTextRuns(document,node);
  if (!Array.isArray(values) || values.length!==runs.length || values.some(value=>typeof value!=='string')) throw new Error('자막 텍스트 구간이 원본과 일치하지 않습니다.');
  const edits=[];
  for (let i=0;i<runs.length;i++) {
    const value=values[i];
    for (const char of value) {
      const cp=char.codePointAt(0);
      if (!(cp===9 || cp===10 || cp===13 || (cp>=0x20 && cp<=0xD7FF) || (cp>=0xE000 && cp<=0xFFFD) || (cp>=0x10000 && cp<=0x10FFFF))) throw new Error('XML에서 사용할 수 없는 문자가 있습니다.');
    }
    if (value!==runs[i].value) edits.push({start:runs[i].start,end:runs[i].end,text:value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')});
  }
  return applyEdits(document.source,edits);
}

// Small, dependency-free Markdown renderer for Codex messages.
// All user/Codex-provided strings become text nodes; no remote HTML is inserted.
function parseCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.replace(/\\\|/g, '|').trim());
}
function isSeparator(line) {
  const cells = parseCells(line);
  return cells.length >= 2 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}
function isFence(line) { return /^\s*(`{3,}|~{3,})([^`]*)$/.exec(line); }
function isHeading(line) { return /^\s{0,3}(#{1,6})\s+(.+)$/.exec(line); }
function isList(line) { return /^\s{0,3}([-*+]\s+|\d+\.\s+)(.+)$/.exec(line); }
function isQuote(line) { return /^\s{0,3}>\s?(.*)$/.exec(line); }
function isRule(line) { return /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line); }
function startsBlock(lines, i) {
  if (i >= lines.length) return true;
  const line = lines[i];
  return !line.trim() || isFence(line) || isHeading(line) || isList(line) || isQuote(line) || isRule(line) || (line.includes('|') && isSeparator(lines[i + 1] || ''));
}
export function parseMarkdown(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = isFence(line);
    if (fence) {
      const mark = fence[1][0], length = fence[1].length, language = fence[2].trim().split(/\s+/)[0].slice(0, 30);
      const body = []; i++;
      while (i < lines.length && !new RegExp(`^\\s*${mark}{${length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({type:'code', language, text:body.join('\n')}); continue;
    }
    const heading = isHeading(line);
    if (heading) { blocks.push({type:'heading', level:heading[1].length, text:heading[2].trim()}); i++; continue; }
    if (isRule(line)) { blocks.push({type:'rule'}); i++; continue; }
    if (line.includes('|') && isSeparator(lines[i + 1] || '')) {
      const head = parseCells(line); const rows = []; i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(parseCells(lines[i++]));
      blocks.push({type:'table', head, rows}); continue;
    }
    const list = isList(line);
    if (list) {
      const ordered = /\d/.test(list[1][0]), values = [];
      while (i < lines.length) {
        const current = isList(lines[i]);
        if (!current || /\d/.test(current[1][0]) !== ordered) break;
        values.push(current[2].trim()); i++;
      }
      blocks.push({type:ordered?'ol':'ul', values}); continue;
    }
    if (isQuote(line)) {
      const values = [];
      while (i < lines.length && isQuote(lines[i])) values.push(isQuote(lines[i++])[1]);
      blocks.push({type:'quote', text:values.join('\n')}); continue;
    }
    const content = [line.trim()]; i++;
    while (i < lines.length && !startsBlock(lines, i)) content.push(lines[i++].trim());
    blocks.push({type:'paragraph', text:content.join('\n')});
  }
  return blocks;
}

const inlinePattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|\[[^\]\n]+\]\([^\)\n]+\))/g;
function inlineFragment(doc, text) {
  const fragment = doc.createDocumentFragment();
  let start = 0;
  for (const match of String(text).matchAll(inlinePattern)) {
    if (match.index > start) fragment.append(doc.createTextNode(text.slice(start, match.index)));
    const token = match[0]; let node;
    if (token.startsWith('`')) { node = doc.createElement('code'); node.textContent = token.slice(1, -1); }
    else if (token.startsWith('**') || token.startsWith('__')) { node = doc.createElement('strong'); node.textContent = token.slice(2, -2); }
    else if (token.startsWith('~~')) { node = doc.createElement('del'); node.textContent = token.slice(2, -2); }
    else if (token.startsWith('*')) { node = doc.createElement('em'); node.textContent = token.slice(1, -1); }
    else {
      const divider = token.indexOf(']('), label = token.slice(1, divider), href = token.slice(divider + 2, -1);
      // Only external https/http links may navigate. Local code paths remain copyable text.
      if (/^https?:\/\//i.test(href)) {
        node = doc.createElement('a'); node.textContent = label; node.href = href;
        node.target = '_blank'; node.rel = 'noopener noreferrer';
      } else { node = doc.createElement('code'); node.textContent = label; node.title = href; }
    }
    fragment.append(node); start = match.index + token.length;
  }
  fragment.append(doc.createTextNode(text.slice(start)));
  return fragment;
}
export function renderMarkdown(source, doc = document) {
  const container = doc.createElement('div'); container.className = 'markdown-body';
  for (const block of parseMarkdown(source)) {
    let node;
    switch (block.type) {
      case 'heading': node = doc.createElement(`h${Math.min(6, block.level + 2)}`); node.append(inlineFragment(doc, block.text)); break;
      case 'rule': node = doc.createElement('hr'); break;
      case 'code': {
        node = doc.createElement('div'); node.className = 'code-box';
        if (block.language) { const tag = doc.createElement('span'); tag.className = 'code-language'; tag.textContent = block.language; node.append(tag); }
        const pre = doc.createElement('pre'), code = doc.createElement('code'); code.textContent = block.text; pre.append(code); node.append(pre); break;
      }
      case 'table': {
        node = doc.createElement('div'); node.className = 'table-scroll';
        const table = doc.createElement('table'), thead = doc.createElement('thead'), tbody = doc.createElement('tbody'), tr = doc.createElement('tr');
        for (const cell of block.head) { const th = doc.createElement('th'); th.append(inlineFragment(doc, cell)); tr.append(th); }
        thead.append(tr);
        for (const cells of block.rows) {
          const row = doc.createElement('tr');
          for (let c=0; c<block.head.length; c++) { const td = doc.createElement('td'); td.append(inlineFragment(doc, cells[c] || '')); row.append(td); }
          tbody.append(row);
        }
        table.append(thead,tbody); node.append(table); break;
      }
      case 'ul': case 'ol': {
        node = doc.createElement(block.type);
        for (const value of block.values) { const li = doc.createElement('li'); li.append(inlineFragment(doc, value)); node.append(li); } break;
      }
      case 'quote': node = doc.createElement('blockquote'); node.append(inlineFragment(doc, block.text)); break;
      default: node = doc.createElement('p'); node.append(inlineFragment(doc, block.text));
    }
    container.append(node);
  }
  return container;
}

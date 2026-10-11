import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../public/markdown.js';

test('parses Codex report headings, list, table and code', () => {
  const input = `## 全体構成\n\n- 認証\n- Calendar\n\n| アプリ | ポート |\n| --- | --- |\n| auth | 3002 |\n\n\`\`\`powershell\nnpm test\n\`\`\``;
  const blocks = parseMarkdown(input);
  assert.deepEqual(blocks.map(b=>b.type), ['heading','ul','table','code']);
  assert.equal(blocks[2].rows[0][1], '3002');
  assert.equal(blocks[3].language, 'powershell');
});
test('untrusted HTML remains paragraph text, never parsed as markup', () => {
  const blocks = parseMarkdown('<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))');
  assert.equal(blocks[0].text, '<img src=x onerror=alert(1)>');
  assert.equal(blocks[1].type, 'paragraph');
});
test('handles Windows paths and mixed line endings', () => {
  const blocks = parseMarkdown('### Files\r\n\r\n[readme](/F:/CodexWorkSpace/oshiport/README.md)');
  assert.deepEqual(blocks.map(b=>b.type),['heading','paragraph']);
});

test('renderer creates only safe DOM nodes and leaves HTML as literal text', async () => {
  const { renderMarkdown } = await import('../public/markdown.js');
  class Node {
    constructor(tag = '#text') { this.tag=tag; this.children=[]; this.text=''; }
    append(...nodes) { this.children.push(...nodes); }
    set textContent(value) { this.text=String(value); this.children=[]; }
    get textContent() { return this.text + this.children.map(n => n.textContent).join(''); }
    query(tag) { return (this.tag===tag ? [this] : []).concat(this.children.flatMap(c => c.query(tag))); }
  }
  const created=[];
  const doc={
    createElement(tag) { created.push(tag); return new Node(tag); },
    createTextNode(value) { const n=new Node('#text'); n.textContent=value; return n; },
    createDocumentFragment() { return new Node('#fragment'); }
  };
  const rendered=renderMarkdown('<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n[good](https://example.com)',doc);
  assert.equal(rendered.query('img').length,0);
  assert.ok(rendered.textContent.includes('<img src=x onerror=alert(1)>'));
  assert.deepEqual(rendered.query('a').map(n=>n.href),['https://example.com']);
  assert.equal(rendered.query('a')[0].rel,'noopener noreferrer');
  assert.ok(!created.includes('script'));
});

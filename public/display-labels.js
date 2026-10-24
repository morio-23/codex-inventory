// This object keeps only ephemeral display labels in memory. Never write
// thread names or previews into localStorage, diagnostics, or telemetry.
export class DisplayLabels {
  #projects = new Map();
  #threads = new Map();
  #threadTitles = new Map();

  projectLabel(cwd, locale = 'ja') {
    return this.#label(this.#projects, cwd, locale, 'プロジェクト', 'Project ');
  }

  // The Codex App Server Thread.name is an optional user-facing title;
  // Thread.preview is usually the opening user message. Prefer either to
  // anonymous numbering without changing the underlying thread identity.
  threadLabel(threadOrId, locale = 'ja') {
    const isThread = threadOrId && typeof threadOrId === 'object';
    const id = isThread ? threadOrId.id : threadOrId;
    if (isThread && typeof id === 'string') {
      const name = this.#cleanTitle(threadOrId.name);
      const preview = this.#cleanTitle(threadOrId.preview, true);
      this.#threadTitles.set(id, name || preview || null);
    }
    return this.#threadTitles.get(id) ||
      this.#label(this.#threads, id, locale, 'チャット', 'Chat ');
  }

  #cleanTitle(value, preview = false) {
    if (typeof value !== 'string') return '';
    let text = value;
    // Some first prompts include an Inventory-generated instruction wrapper.
    // Show the user's request instead of the wrapper if that delimiter exists.
    if (preview && text.includes('【ユーザー依頼】')) {
      text = text.split('【ユーザー依頼】').at(-1);
    }
    text = text.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const characters = Array.from(text);
    return characters.length > 80 ? characters.slice(0, 80).join('') + '…' : text;
  }

  #label(registry, key, locale, japanesePrefix, englishPrefix) {
    if (!registry.has(key)) registry.set(key, registry.size + 1);
    const prefix = typeof locale === 'string' && locale.toLowerCase().startsWith('en')
      ? englishPrefix
      : japanesePrefix;
    return prefix + registry.get(key);
  }
}

// This object keeps only ephemeral display labels in memory. Never write
// thread names or previews into localStorage, diagnostics, or telemetry.
export class DisplayLabels {
  #projects = new Map();
  #projectFallbacks = new Map();
  #threads = new Map();
  #threadTitles = new Map();

  projectLabel(cwd, locale = 'ja') {
    // Show only the final directory component, never the parent path or drive.
    // The full path remains the internal workspace identifier.
    const path=typeof cwd==='string'?cwd.trim():'';
    const normalizedPath=path.replace(/[\\/]+$/g,'').replace(/\\/g,'/');
    const projectKey=/^[A-Za-z]:\//.test(normalizedPath)
      ?normalizedPath.toLowerCase():normalizedPath;
    const last=normalizedPath.split('/').at(-1);
    const title=this.#cleanTitle(last);
    if (!title || title==='.' || title==='..' || /^[A-Za-z]:$/.test(title)) {
      return this.#label(this.#projectFallbacks, cwd, locale, 'プロジェクト', 'Project ');
    }
    if (!this.#projects.has(projectKey)) {
      const normalized=title.toLocaleLowerCase();
      const matching=[...this.#projects.values()].filter(p=>p.normalized===normalized).length;
      this.#projects.set(projectKey,{label:matching?title+' ('+(matching+1)+')':title,normalized});
    }
    return this.#projects.get(projectKey).label;
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
      // Empty list/read fields must not discard a previously observed title.
      // An explicit name always wins; preview wins over a history fallback.
      const current = this.#threadTitles.get(id);
      if (name) this.#threadTitles.set(id, {value:name,priority:3});
      else if (preview && (!current || current.priority <= 2))
        this.#threadTitles.set(id, {value:preview,priority:2});
    }
    return this.#threadTitles.get(id)?.value ||
      this.#label(this.#threads, id, locale, 'チャット', 'Chat ');
  }

  // Older Codex threads may have no summary in thread/list or thread/read,
  // even though their saved turns contain a user message. This is a display-
  // only fallback after a normal read; never mutate the persisted session.
  rememberHistoryTitle(id, messages) {
    if (typeof id !== 'string' || this.#threadTitles.has(id) ||
        !Array.isArray(messages)) return false;
    const firstUser = messages.find(item =>
      item?.role === 'user' && typeof item.text === 'string' &&
      this.#cleanTitle(item.text, true));
    if (!firstUser) return false;
    const title = this.#cleanTitle(firstUser.text, true);
    this.#threadTitles.set(id, {value:title,priority:1});
    return true;
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

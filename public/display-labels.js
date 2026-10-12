export class DisplayLabels {
  #projects = new Map();
  #threads = new Map();

  projectLabel(cwd, locale = 'ja') {
    return this.#label(this.#projects, cwd, locale, 'プロジェクト', 'Project ');
  }

  threadLabel(threadId, locale = 'ja') {
    return this.#label(this.#threads, threadId, locale, 'チャット', 'Chat ');
  }

  #label(registry, key, locale, japanesePrefix, englishPrefix) {
    if (!registry.has(key)) registry.set(key, registry.size + 1);
    const prefix = typeof locale === 'string' && locale.toLowerCase().startsWith('en')
      ? englishPrefix
      : japanesePrefix;
    return prefix + registry.get(key);
  }
}

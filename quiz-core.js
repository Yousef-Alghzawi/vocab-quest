(function (root) {
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function allWords(scenes) {
    return scenes.flatMap((s) => s.words);
  }

  function buildOptions(word, kind, pool, rng) {
    // word.avoid lists values that would be a second fair answer, so they are never offered.
    const seen = new Set([word.word, word.synonym, word.antonym].concat(word.avoid || []).map((v) => v.toLowerCase()));
    const candidates = [];
    for (const w of pool) {
      for (const v of [w.synonym, w.antonym]) {
        const key = v.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(v);
        }
      }
    }
    return shuffle([word[kind]].concat(shuffle(candidates, rng).slice(0, 3)), rng);
  }

  function choiceQuestion(word, kind, pool, rng) {
    return {
      type: kind,
      wordId: word.id,
      word: word.word,
      prompt: kind === 'synonym'
        ? 'Which word means the same as "' + word.word + '"?'
        : 'Which word is the opposite of "' + word.word + '"?',
      options: buildOptions(word, kind, pool, rng),
      answer: word[kind],
    };
  }

  function makeQuestions(scene, scenes, rng) {
    const pool = allWords(scenes);
    const qs = [];
    for (const w of scene.words) {
      qs.push({ type: 'find', wordId: w.id, word: w.word, prompt: 'Tap the picture clue for "' + w.word + '".', answer: w.id });
      qs.push(choiceQuestion(w, 'synonym', pool, rng));
      qs.push(choiceQuestion(w, 'antonym', pool, rng));
    }
    return shuffle(qs, rng);
  }

  function misses(progress, wordId) {
    const rec = progress.words[wordId];
    return rec ? rec.wrong - rec.right : 0;
  }

  function pickComeback(scenes, sceneIndex, progress, rng, n) {
    const count = n || 5;
    const earlier = scenes.slice(0, sceneIndex).flatMap((s) => s.words);
    if (!earlier.length) return [];
    const pool = allWords(scenes);
    const ranked = shuffle(earlier, rng).sort((a, b) => misses(progress, b.id) - misses(progress, a.id));
    return ranked.slice(0, count).map((w, i) => choiceQuestion(w, i % 2 ? 'antonym' : 'synonym', pool, rng));
  }

  function newProgress() {
    return { version: 1, words: {}, scenes: {} };
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function loadProgress(raw) {
    try {
      const p = JSON.parse(raw);
      if (isPlainObject(p) && p.version === 1 && isPlainObject(p.words) && isPlainObject(p.scenes)) return p;
    } catch (e) { /* fall through to fresh progress */ }
    return newProgress();
  }

  function recordAnswer(progress, wordId, correct) {
    const rec = progress.words[wordId] || (progress.words[wordId] = { right: 0, wrong: 0 });
    if (correct) rec.right += 1; else rec.wrong += 1;
  }

  function completeScene(progress, sceneId, score, total) {
    const prev = progress.scenes[sceneId];
    progress.scenes[sceneId] = { done: true, best: Math.max(score, prev ? prev.best : 0), total: total };
  }

  function isUnlocked(scenes, progress, sceneIndex) {
    if (sceneIndex === 0) return true;
    const prev = progress.scenes[scenes[sceneIndex - 1].id];
    return Boolean(prev && prev.done);
  }

  const api = { makeQuestions, pickComeback, newProgress, loadProgress, recordAnswer, completeScene, isUnlocked };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QuizCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

(function (root) {
  // Days until the next review for each box. Box 0 means "not scheduled yet".
  const INTERVALS = [0, 1, 3, 7, 14, 30];
  const MAX_RETRIES = 2;

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function lower(v) { return String(v).toLowerCase(); }
  function allWords(scenes) { return scenes.flatMap((s) => s.words); }
  function sceneOf(wordId) { return wordId.split('_')[0]; }
  function sameGroup(a, b) { return Boolean(a.group) && a.group === b.group; }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function dayNumber(date) {
    return Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000);
  }

  // Synonym or antonym question. Distractors are other words' synonyms and antonyms, never a
  // value that could also be right: own values, word.avoid, or anything from the same group.
  function buildOptions(word, kind, pool, rng) {
    const seen = new Set([word.word, word.synonym, word.antonym].concat(word.avoid || []).filter(Boolean).map(lower));
    for (const w of pool) if (sameGroup(w, word)) [w.word, w.synonym, w.antonym].filter(Boolean).forEach((v) => seen.add(lower(v)));
    const candidates = [];
    for (const w of pool) {
      if (w.id === word.id || sameGroup(w, word)) continue;
      for (const v of [w.synonym, w.antonym]) {
        if (!v || seen.has(lower(v))) continue;
        seen.add(lower(v));
        candidates.push(v);
      }
    }
    return shuffle([word[kind]].concat(shuffle(candidates, rng).slice(0, 3)), rng);
  }

  function choiceQuestion(word, kind, pool, rng) {
    return {
      type: kind, wordId: word.id, word: word.word, scheduled: true, opposite: null,
      prompt: kind === 'synonym' ? 'Which word means the same as "' + word.word + '"?' : 'Which word is the opposite of "' + word.word + '"?',
      options: buildOptions(word, kind, pool, rng), answer: word[kind],
    };
  }

  // Five meanings: the right one, the opposite meaning (the exam's favourite trap) and others.
  function meaningOptions(word, pool, rng) {
    const seen = new Set([lower(word.meaning)]);
    if (word.antonymMeaning) seen.add(lower(word.antonymMeaning));
    const others = [];
    for (const w of pool) {
      if (w.id === word.id || sameGroup(w, word) || seen.has(lower(w.meaning))) continue;
      seen.add(lower(w.meaning));
      others.push(w.meaning);
    }
    const wrong = (word.antonymMeaning ? [word.antonymMeaning] : []).concat(shuffle(others, rng)).slice(0, 4);
    return shuffle([word.meaning].concat(wrong), rng);
  }

  function meaningQuestion(word, pool, rng) {
    return { type: 'meaning', wordId: word.id, word: word.word, scheduled: true, prompt: 'What does "' + word.word + '" mean?',
      options: meaningOptions(word, pool, rng), answer: word.meaning, opposite: word.antonymMeaning || null };
  }

  function contextQuestion(word, pool, rng) {
    return { type: 'context', wordId: word.id, word: word.word, scheduled: true, sentence: word.sentence,
      prompt: 'In this sentence, what does "' + word.word + '" mean?',
      options: meaningOptions(word, pool, rng), answer: word.meaning, opposite: word.antonymMeaning || null };
  }

  function gap(sentence) { return sentence.replace(/\*[^*]+\*/, '_____'); }

  // Word bank gap fill. Same part of speech first, so grammar alone cannot give the answer.
  function clozeQuestion(word, pool, rng) {
    const banned = new Set([word.word, word.synonym].concat(word.avoid || []).map(lower));
    const same = [];
    const other = [];
    for (const w of pool) {
      if (w.id === word.id || sameGroup(w, word) || banned.has(lower(w.word))) continue;
      banned.add(lower(w.word));
      (w.pos === word.pos ? same : other).push(w.word);
    }
    const picks = shuffle(same, rng).concat(shuffle(other, rng)).slice(0, 4);
    return { type: 'cloze', wordId: word.id, word: word.word, scheduled: true, sentence: gap(word.sentence),
      prompt: 'Which word fits the gap?', options: shuffle([word.word].concat(picks), rng), answer: word.word, opposite: null };
  }

  function twinsQuestion(word, twin, rng) {
    return { type: 'twins', wordId: word.id, word: word.word, twin: twin.word, scheduled: false, sentence: gap(word.sentence),
      prompt: 'Twins! Which one fits the gap?', options: shuffle([word.word, twin.word], rng), answer: word.word, opposite: null };
  }

  // Recall right after a lesson: the picture clue, then one of synonym, opposite or meaning.
  function makeQuestions(scene, scenes, rng) {
    const pool = allWords(scenes);
    const kinds = ['synonym', 'antonym', 'meaning'];
    const qs = [];
    scene.words.forEach((w, i) => {
      qs.push({ type: 'find', wordId: w.id, word: w.word, scheduled: true, opposite: null, prompt: 'Tap the picture clue for "' + w.word + '".', answer: w.id });
      let kind = kinds[i % 3];
      if (kind === 'antonym' && !w.antonym) kind = 'meaning';
      qs.push(kind === 'meaning' ? meaningQuestion(w, pool, rng) : choiceQuestion(w, kind, pool, rng));
    });
    return shuffle(qs, rng);
  }

  function newProgress() { return { version: 2, words: {}, scenes: {}, days: {} }; }

  function migrateV1(p, today) {
    const out = newProgress();
    for (const id in p.scenes) out.scenes[id] = Object.assign({ firstDone: today - 1 }, p.scenes[id]);
    for (const id in p.words) {
      const r = isPlainObject(p.words[id]) ? p.words[id] : {};
      out.words[id] = { box: 1, due: today, right: r.right | 0, wrong: r.wrong | 0 };
    }
    return out;
  }

  function loadProgress(raw, today) {
    const day = today == null ? dayNumber(new Date()) : today;
    try {
      const p = JSON.parse(raw);
      if (isPlainObject(p) && isPlainObject(p.words) && isPlainObject(p.scenes)) {
        if (p.version === 2 && isPlainObject(p.days)) return p;
        if (p.version === 1) return migrateV1(p, day);
      }
    } catch (e) { /* fall through to fresh progress */ }
    return newProgress();
  }

  function rec(progress, wordId) {
    return progress.words[wordId] || (progress.words[wordId] = { box: 0, due: null, right: 0, wrong: 0 });
  }

  function recordAnswer(progress, wordId, correct) {
    const r = rec(progress, wordId);
    if (correct) r.right += 1; else r.wrong += 1;
  }

  function introduce(progress, wordId, today) {
    const r = rec(progress, wordId);
    if (r.box > 0) return;
    r.box = 1;
    r.due = today + INTERVALS[1];
  }

  function review(progress, wordId, correct, today) {
    const r = rec(progress, wordId);
    if (correct) { r.right += 1; r.box = Math.min(r.box + 1, 5); } else { r.wrong += 1; r.box = 1; }
    r.due = today + INTERVALS[r.box];
  }

  function finishLesson(progress, scene, score, total, today) {
    const prev = progress.scenes[scene.id];
    progress.scenes[scene.id] = { done: true, best: Math.max(score, prev ? prev.best : 0), total: total, firstDone: prev && prev.firstDone != null ? prev.firstDone : today };
    for (const w of scene.words) introduce(progress, w.id, today);
  }

  function dueWords(scenes, progress, today) {
    return allWords(scenes)
      .filter((w) => { const r = progress.words[w.id]; return r && r.box > 0 && r.due <= today; })
      .sort((a, b) => progress.words[a.id].due - progress.words[b.id].due || progress.words[a.id].box - progress.words[b.id].box);
  }

  function nextLesson(scenes, progress) {
    return scenes.findIndex((s) => !(progress.scenes[s.id] && progress.scenes[s.id].done));
  }

  function newLessonDoneToday(progress, today) {
    return Object.keys(progress.scenes).some((id) => progress.scenes[id].firstDone === today);
  }

  // Harder question types as a word climbs the boxes.
  function reviewQuestion(word, box, pool, learned, rng) {
    const kinds = box <= 1 ? ['meaning', 'synonym'] : box === 2 ? ['context', 'antonym'] : ['context', 'cloze', 'antonym'];
    let kind = kinds[Math.floor(rng() * kinds.length)];
    if (kind === 'antonym' && !word.antonym) kind = 'context';
    if (kind === 'cloze' && learned.length < 5) kind = 'context';
    if (kind === 'synonym' || kind === 'antonym') return choiceQuestion(word, kind, pool, rng);
    if (kind === 'meaning') return meaningQuestion(word, pool, rng);
    if (kind === 'cloze') return clozeQuestion(word, learned, rng);
    return contextQuestion(word, pool, rng);
  }

  // Shuffle, then swap items so neighbours come from different lessons where possible.
  function interleave(qs, rng) {
    const a = shuffle(qs, rng);
    for (let i = 1; i < a.length; i++) {
      if (sceneOf(a[i].wordId) !== sceneOf(a[i - 1].wordId)) continue;
      for (let j = i + 1; j < a.length; j++) {
        if (sceneOf(a[j].wordId) !== sceneOf(a[i - 1].wordId)) { [a[i], a[j]] = [a[j], a[i]]; break; }
      }
    }
    return a;
  }

  function buildSession(scenes, progress, today, rng, cap) {
    const pool = allWords(scenes);
    const learned = pool.filter((w) => progress.words[w.id] && progress.words[w.id].box > 0);
    const due = dueWords(scenes, progress, today).slice(0, cap || 30);
    const qs = due.map((w) => reviewQuestion(w, progress.words[w.id].box, pool, learned, rng));
    const dueIds = new Set(due.map((w) => w.id));
    const groups = {};
    for (const w of learned) if (w.group) (groups[w.group] = groups[w.group] || []).push(w);
    let twins = 0;
    for (const g of Object.keys(groups).sort()) {
      const members = groups[g];
      const a = members.find((w) => dueIds.has(w.id));
      if (members.length < 2 || !a || twins >= 3) continue;
      qs.push(twinsQuestion(a, members.find((w) => w.id !== a.id), rng));
      twins += 1;
    }
    return interleave(qs, rng);
  }

  function createSession(questions, pool) {
    return { queue: questions.slice(), i: 0, pool: pool, tried: {}, retries: {} };
  }

  // Moves to the next question. A wrong scheduled answer brings the word back 3 questions
  // later as a meaning question (at most twice). Returns true when this answer is the word's
  // first try in the session, which is the only one that updates the schedule.
  function answerSession(session, correct, rng) {
    const q = session.queue[session.i];
    session.i += 1;
    if (!q.scheduled) return false;
    const first = !session.tried[q.wordId];
    session.tried[q.wordId] = true;
    const used = session.retries[q.wordId] || 0;
    if (!correct && used < MAX_RETRIES) {
      const word = session.pool.find((w) => w.id === q.wordId);
      const retry = meaningQuestion(word, session.pool, rng);
      session.queue.splice(Math.min(session.i + 3, session.queue.length), 0, retry);
      session.retries[q.wordId] = used + 1;
    }
    return first;
  }

  const api = {
    INTERVALS, dayNumber, makeQuestions, choiceQuestion, meaningQuestion, contextQuestion, clozeQuestion, twinsQuestion,
    newProgress, loadProgress, recordAnswer, introduce, review, finishLesson, dueWords, nextLesson, newLessonDoneToday,
    buildSession, createSession, answerSession,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QuizCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

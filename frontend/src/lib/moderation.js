// Модерация текста — бит-в-бит повторяет app/services/moderation.py.
// Правила общие: ./moderation_rules.json (копия app/core/moderation_rules.json),
// общие тест-векторы: tests/fixtures/moderation_cases.json.
import RULES from "./moderation_rules.json";

const HOMOGLYPHS = RULES.homoglyphs;
const ALLOW_WORDS = new Set(RULES.allow_words);
const ALLOW_PREFIXES = RULES.allow_prefixes;
const RAW_PATTERNS = RULES.raw_patterns.map((p) => new RegExp(p, "i"));
const CATEGORIES = RULES.categories.map((c) => ({
  title: c.title,
  substrings: c.substrings,
  prefixes: c.prefixes,
  words: new Set(c.words),
}));

const ZERO_WIDTH = /[​-‍﻿­]/g;
const SPLIT = /[^0-9a-zа-я@$]+/;
const CYRILLIC = /[а-я]/;
const RUN3 = /(.)\1{2,}/g;
const RUN2 = /(.)\1+/g;

function prepare(raw) {
  return String(raw ?? "")
    .replace(ZERO_WIDTH, "")
    .toLowerCase()
    .replace(/ё/g, "е");
}

function mapHomoglyphs(token) {
  let out = "";
  for (const ch of token) out += HOMOGLYPHS[ch] ?? ch;
  return out;
}

function tokens(prepared) {
  return prepared.split(SPLIT).filter(Boolean);
}

function variants(token) {
  const bases = [token];
  if (CYRILLIC.test(token)) bases.push(mapHomoglyphs(token));
  const out = new Set();
  for (const b of bases) {
    out.add(b);
    out.add(b.replace(RUN3, "$1"));
    out.add(b.replace(RUN2, "$1"));
  }
  return out;
}

function joinedRuns(toks) {
  const result = [];
  const flush = (run) => {
    if (!run.length) return;
    if ((run.length >= 2 && run.every((t) => t.length === 1)) || run.length >= 3) {
      result.push(run.join(""));
    }
  };
  let run = [];
  for (const tok of toks) {
    if (tok.length <= 2) run.push(tok);
    else {
      flush(run);
      run = [];
    }
  }
  flush(run);
  return result;
}

export function normalizeForModeration(raw) {
  return tokens(prepare(raw))
    .map((tok) => (CYRILLIC.test(tok) ? mapHomoglyphs(tok) : tok).replace(RUN3, "$1"))
    .join(" ");
}

function matchToken(variant) {
  if (ALLOW_WORDS.has(variant) || ALLOW_PREFIXES.some((p) => variant.startsWith(p))) {
    return null;
  }
  for (const cat of CATEGORIES) {
    if (
      cat.words.has(variant) ||
      cat.prefixes.some((p) => variant.startsWith(p)) ||
      cat.substrings.some((s) => variant.includes(s))
    ) {
      return cat.title;
    }
  }
  return null;
}

export function findTextViolation(raw) {
  const prepared = prepare(raw);
  if (!prepared) return null;
  for (const pattern of RAW_PATTERNS) {
    if (pattern.test(prepared)) return RULES.raw_category;
  }
  const toks = tokens(prepared);
  for (const tok of [...toks, ...joinedRuns(toks)]) {
    for (const v of variants(tok)) {
      const category = matchToken(v);
      if (category) return category;
    }
  }
  return null;
}

export function inspectContentSafety(fieldsMap) {
  for (const [fieldName, rawValue] of Object.entries(fieldsMap)) {
    const category = findTextViolation(rawValue);
    if (category) return { isSafe: false, field: fieldName, reason: category };
  }
  return { isSafe: true, field: null, reason: null };
}

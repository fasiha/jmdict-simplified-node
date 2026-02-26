import assert from "assert";
import {
  get,
  setup,
  findExact,
  countExact,
  findExactIds,
  readingBeginning,
  readingAnywhere,
  kanjiBeginning,
  kanjiAnywhere,
  kanjiFuzzy,
  getXrefs,
} from "./index";
import type { Word } from "./interfaces";

(async () => {
  const DBNAME = "test.db";

  const { db, dictDate, version, tags } = await setup(
    DBNAME,
    // TODO: Download latest jmdict-eng JSON
    "jmdict-eng-3.6.1.json",
  );
  assert(dictDate);
  assert(version);
  assert(Object.keys(tags).length > 100);

  const summarize = (word: Word) =>
    word.kanji
      .map((k) => k.text)
      .concat(word.kana.map((k) => k.text))
      .join(", ") +
    ` ${word.sense
      .map((s) => s.gloss.map((g) => g.text).join("; "))
      .join(" / ")} (#${word.id})`;
  const summarizeAll = (words: Word[]) => words.map(summarize).join("\n");

  const kanaBeg = readingBeginning(db, "いい"); // それ
  assert(kanaBeg.every((r) => r.kana.some((k) => k.text.startsWith("いい"))));
  console.log(`${kanaBeg.length} exact beginning found: reading`);

  const kanaAny = readingAnywhere(db, "いい");
  assert(kanaAny.length > kanaBeg.length);
  assert(kanaAny.every((r) => r.kana.some((k) => k.text.includes("いい"))));
  console.log(`${kanaAny.length} exact anywhere found: reading`);

  const kanjiBeg = kanjiBeginning(db, "中人");
  const kanjiAny = kanjiAnywhere(db, "中人");

  assert(kanjiBeg.every((r) => r.kanji.some((k) => k.text.startsWith("中人"))));
  console.log(`${kanjiBeg.length} exact beginning found: kanji`);
  console.log(`${kanjiAny.length} exact anywhere found: kanji`);
  assert(kanjiAny.length > kanjiBeg.length);
  assert(kanjiAny.every((r) => r.kanji.some((k) => k.text.includes("中人"))));

  const kanjiFuzz = kanjiFuzzy(db, "中人");
  assert(kanjiFuzz.length > kanjiAny.length);
  console.log(`${kanjiFuzz.length} fuzzy found: kanji`);

  const REGEXP = /中.+人/;
  assert(kanjiFuzz.some((r) => r.kanji.some((k) => REGEXP.test(k.text))));
  assert(kanjiFuzz.some((r) => r.kanji.some((k) => k.text.includes("中人"))));

  const got = get(db, "食べ物");
  assert(got.length === 1);

  const gotKana = get(db, "ものがたり");
  assert(gotKana.length === 1);

  {
    // findExact: matches on kana or kanji text
    const kanaHits = findExact(db, "ものがたり");
    assert(kanaHits.length === 1);
    assert(kanaHits[0].kana.some((k) => k.text === "ものがたり"));
  }
  {
    const kanjiHits = findExact(db, "食べ物");
    assert(kanjiHits.length === 1);
    assert(kanjiHits[0].kanji.some((k) => k.text === "食べ物"));
  }
  {
    const haHits = findExact(db, "は");
    assert(haHits.length > 2);
    console.log("findExact ok");
  }

  {
    // countExact: result is always a number
    const zeroCount = countExact(db, "dummy text");
    assert(zeroCount === 0);

    // countExact matches findExact's length for kana
    const kanaCount = countExact(db, "ものがたり");
    assert(kanaCount === findExact(db, "ものがたり").length);
    assert(kanaCount > 0);

    // countExact matches findExact's length for kanji
    const kanjiCount = countExact(db, "食べ物");
    assert(kanjiCount === findExact(db, "食べ物").length);
    assert(kanjiCount > 0);

    // countExact matches findExact's length for multi-result query
    const haCount = countExact(db, "は");
    assert(haCount === findExact(db, "は").length);
    assert(haCount > 1);

    console.log("countExact ok");
  }

  {
    const arrEq = (a: string[], b: string[]) =>
      a.length === b.length && a.every((x, i) => x === b[i]);
    const ids = (words: Word[]) => words.map((w) => w.id);

    // findExactIds: returns string IDs, same count as findExact
    const zeroIds = findExactIds(db, "dummy text");
    assert(zeroIds.length === 0);

    const kanaIds = findExactIds(db, "ものがたり");
    assert(arrEq(kanaIds, ids(findExact(db, "ものがたり"))));
    assert(kanaIds.every((id) => typeof id === "string"));

    const kanjiIds = findExactIds(db, "食べ物");
    assert(arrEq(kanjiIds, ids(findExact(db, "食べ物"))));

    const haIds = findExactIds(db, "は");
    assert(arrEq(haIds, ids(findExact(db, "は"))));
    assert(haIds.length > 2);

    console.log("findExactIds ok");
  }

  {
    const words = get(db, "すっきり");
    assert(words.length >= 1);
    const xrefs = getXrefs(db, words[0].sense[0].related[0]);
    assert(xrefs.length >= 1);
    assert(xrefs[0].id !== words[0].id);
  }

  {
    // no duplicates: entries with multiple matching readings must appear once
    const hits = readingBeginning(db, "あいさつ");
    const ids = hits.map((w) => w.id);
    assert(
      ids.length === new Set(ids).size,
      `readingBeginning returned ${ids.length - new Set(ids).size} duplicate(s)`,
    );
  }
  {
    const hitsAny = readingAnywhere(db, "あいさつ");
    const idsAny = hitsAny.map((w) => w.id);
    assert(
      idsAny.length === new Set(idsAny).size,
      `readingAnywhere returned ${idsAny.length - new Set(idsAny).size} duplicate(s)`,
    );
    console.log("no duplicates: ok");
  }

  const xrefs = [
    getXrefs(db, ["かも知れない", "かもしれない"]),
    getXrefs(db, ["おばあさん", 2]),
    getXrefs(db, ["振れる", "ふれる・2", 2]),
  ];
  assert(xrefs.every((arr) => arr.length >= 1));

  {
    // pagination
    const page1 = readingAnywhere(db, "あい", 5, 0);
    const page2 = readingAnywhere(db, "あい", 5, 5);

    const bothPages = readingAnywhere(db, "あい", 10);

    assert(page1.length === 5);
    assert(page2.length === 5);
    assert(bothPages.length === 10);
    assert(
      [...page1, ...page2].map((w) => w.id).join("/") ===
        bothPages.map((w) => w.id).join("/"),
    );

    const noResults = readingAnywhere(db, "卵焼きもち", -1, 10000);
    assert(noResults.length === 0);
  }
  {
    // more pagination: paginating through all results must equal the unpaginated query
    const PAGE_SIZE = 3;
    const hits = [];
    let pages = 0;
    while (true) {
      const thisPage = readingBeginning(db, "あいさつ", PAGE_SIZE, hits.length);
      hits.push(...thisPage);
      pages++;
      if (thisPage.length < PAGE_SIZE || pages > 100) break;
    }
    assert(pages >= 3, `expected a bunch of pages but got ${pages}`);
    const all = readingBeginning(db, "あいさつ");
    assert(
      hits.length === all.length,
      `paginated ${hits.length} !== unpaginated ${all.length}`,
    );
    console.log(`pagination ok: ${hits.length} hits, ${pages} pages`);
  }
})();

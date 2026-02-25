import assert from "assert";
import {
  get,
  setup,
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
    "jmdict-eng-3.6.1.json"
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
    const words = get(db, "すっきり");
    assert(words.length >= 1);
    const xrefs = getXrefs(db, words[0].sense[0].related[0]);
    assert(xrefs.length >= 1);
    assert(xrefs[0].id !== words[0].id);
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
        bothPages.map((w) => w.id).join("/")
    );

    const noResults = readingAnywhere(db, "卵焼きもち", -1, 10000);
    assert(noResults.length === 0);
  }
  {
    // more pagination
    const NUM_PAGES = 3;
    const PAGE_SIZE = 10;
    const hits = [];
    for (let page = 0; page < NUM_PAGES; page++) {
      const thisPage = readingBeginning(db, "あいさつ", PAGE_SIZE, hits.length);
      hits.push(...thisPage);
      console.log(`Page ${page + 1}: total hits ${hits.length}`);
    }
  }
})();

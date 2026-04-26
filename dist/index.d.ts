import { Database } from 'better-sqlite3';

type Tag = string;
interface Kanji {
    common: boolean;
    text: string;
    tags: Tag[];
}
interface Kana {
    common: boolean;
    text: string;
    tags: Tag[];
    appliesToKanji: string[];
}
type Xref = [string, string, number] | [string, string] | [string, number] | [string];
interface Source {
    lang: string;
    full: boolean;
    wasei: boolean;
    text?: string;
}
declare enum GlossType {
    literal = "literal",
    figurative = "figurative",
    explanation = "explanation"
}
interface Gloss {
    lang: string;
    text: string;
    type: GlossType | null;
}
interface Sense {
    partOfSpeech: Tag[];
    appliesToKanji: string[];
    appliesToKana: string[];
    related: Xref[];
    antonym: Xref[];
    field: Tag[];
    dialect: Tag[];
    misc: Tag[];
    info: string[];
    languageSource: Source[];
    gloss: Gloss[];
}
interface Word {
    id: string;
    kanji: Kanji[];
    kana: Kana[];
    sense: Sense[];
}
interface Simplified {
    version: string;
    dictDate: string;
    dictRevisions: string[];
    tags: {
        [k: string]: string;
    };
    words: Word[];
}

type SetupType = {
    db: Database;
    dictDate: string;
    version: string;
    tags: Simplified["tags"];
};
declare function setup(dbpath: string, filename?: string): Promise<SetupType>;
interface GetExtra {
    /**
     * If true (default), `text` must match exactly. If false, `text` is treated
     * as a prefix and any entry starting with `text` is returned.
     */
    exact?: boolean;
    limit?: number;
    offset?: number;
}
declare function get(db: Database, text: string, { exact, limit, offset }?: GetExtra): Word[];
declare function getXrefs(db: Database, xref: Xref): Word[];
declare function idsToWords(db: Database, idxs: string[]): Word[];
declare function findExact(db: Database, text: string, limit?: number, offset?: number): Word[];
declare function countExact(db: Database, text: string): number;
declare function findExactIds(db: Database, text: string): string[];
declare function readingBeginning(db: Database, prefix: string, limit?: number, offset?: number): Word[];
declare function kanjiBeginning(db: Database, prefix: string, limit?: number, offset?: number): Word[];
declare function readingAnywhere(db: Database, text: string, limit?: number, offset?: number): Word[];
declare function kanjiAnywhere(db: Database, text: string, limit?: number, offset?: number): Word[];
declare function readingFuzzy(db: Database, text: string, limit?: number, offset?: number): Word[];
declare function kanjiFuzzy(db: Database, text: string, limit?: number, offset?: number): Word[];
declare function getTags(db: Database): Simplified["tags"];
declare function getField(db: Database, key: keyof Omit<Simplified, "words">): unknown;

export { type Gloss, GlossType, type Kana, type Kanji, type Sense, type SetupType, type Simplified, type Source, type Tag, type Word, type Xref, countExact, findExact, findExactIds, get, getField, getTags, getXrefs, idsToWords, kanjiAnywhere, kanjiBeginning, kanjiFuzzy, readingAnywhere, readingBeginning, readingFuzzy, setup };

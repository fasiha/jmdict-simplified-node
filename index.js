"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !exports.hasOwnProperty(p)) __createBinding(exports, m, p);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getField = exports.getTags = exports.kanjiAnywhere = exports.kanjiBeginning = exports.readingAnywhere = exports.readingBeginning = exports.idsToWords = exports.getXrefs = exports.setup = void 0;
const fs_1 = require("fs");
const leveldown_1 = __importDefault(require("leveldown"));
const levelup_1 = __importDefault(require("levelup"));
__exportStar(require("./interfaces"), exports);
function setup(dbpath, filename = '', verbose = false, omitPartial = false) {
    return __awaiter(this, void 0, void 0, function* () {
        const db = levelup_1.default(leveldown_1.default(dbpath));
        try {
            const opt = { asBuffer: false };
            const [dictDate, version] = yield Promise.all([db.get('raw/dictDate', opt), db.get('raw/version', opt)]);
            return { db, dictDate, version };
        }
        catch (_a) {
            // pass
        }
        if (!filename) {
            throw new Error('database not found but cannot create it if no `filename` given');
        }
        let contents = '';
        try {
            contents = yield fs_1.promises.readFile(filename, 'utf8');
        }
        catch (_b) {
            console.error(`Unable to find ${filename}, download it from https://github.com/scriptin/jmdict-simplified`);
            process.exit(1);
        }
        const raw = JSON.parse(contents);
        const maxBatches = 10000;
        let batch = [];
        {
            // non-JSON, pure strings
            const keys = ['dictDate', 'version'];
            for (const key of keys) {
                batch.push({ type: 'put', key: `raw/${key}`, value: raw[key] });
            }
        }
        {
            // to JSONify
            const keys = ['tags', 'dictRevisions'];
            for (const key of keys) {
                batch.push({ type: 'put', key: `raw/${key}`, value: JSON.stringify(raw[key]) });
            }
        }
        for (const [numWordsWritten, w] of raw.words.entries()) {
            if (batch.length > maxBatches) {
                yield db.batch(batch);
                batch = [];
                if (verbose) {
                    console.log(`${numWordsWritten} entries written`);
                }
            }
            batch.push({ type: 'put', key: `raw/words/${w.id}`, value: JSON.stringify(w) });
            for (const key of ['kana', 'kanji']) {
                for (const k of w[key]) {
                    batch.push({ type: 'put', key: `indexes/${key}/${k.text}-${w.id}`, value: w.id });
                    if (!omitPartial) {
                        for (const substr of allSubstrings(k.text)) {
                            // collisions in key ok, since value will be same
                            batch.push({ type: 'put', key: `indexes/partial-${key}/${substr}-${w.id}`, value: w.id });
                        }
                    }
                }
            }
        }
        if (batch.length) {
            yield db.batch(batch);
        }
        return { db, dictDate: raw.dictDate, version: raw.version };
    });
}
exports.setup = setup;
function drainStream(stream) {
    const ret = [];
    return new Promise((resolve, reject) => {
        stream.on('data', x => ret.push(x))
            .on('error', e => reject(e))
            .on('close', () => resolve(ret))
            .on('end', () => resolve(ret));
    });
}
function searchBeginning(db, prefix, key = 'kana', limit) {
    return __awaiter(this, void 0, void 0, function* () {
        const gte = `indexes/${key}/${prefix}`;
        return idsToWords(db, yield drainStream(db.createValueStream({ gte, lt: gte + '\uFE0F', valueAsBuffer: false, limit })));
    });
}
function searchAnywhere(db, text, key = 'kana', limit) {
    return __awaiter(this, void 0, void 0, function* () {
        const gte = `indexes/partial-${key}/${text}`;
        return idsToWords(db, yield drainStream(db.createValueStream({ gte, lt: gte + '\uFE0F', valueAsBuffer: false, limit })));
    });
}
function get(db, text, key = 'kana') {
    return __awaiter(this, void 0, void 0, function* () {
        return searchBeginning(db, text + '-', key, -1);
    });
}
function getXrefs(db, xref) {
    return __awaiter(this, void 0, void 0, function* () {
        const [first, second] = xref;
        if (typeof second === 'string') {
            // per DTD http://www.edrdg.org/jmdict/jmdict_dtd_h.html `first`
            // will be keb (kanji) and `second` will have a reb (reading)
            // potentially with a center-dot separating it from a sense number.
            const reb = second.split('・')[0];
            const keb = first;
            const kebHits = yield get(db, keb, 'kanji');
            const rebMatches = kebHits.filter(w => w.kana.some(k => k.text === reb));
            return rebMatches;
        }
        else {
            // all we have is `first`, which could be a keb or reb (kanji or
            // reading/kana) so search both
            const hits = (yield get(db, first, 'kanji')).concat(yield get(db, first, 'kana'));
            const seen = new Set(); // dedupe
            const result = [];
            for (const hit of hits) {
                if (seen.has(hit.id)) {
                    continue;
                }
                seen.add(hit.id);
                result.push(hit);
            }
            return result;
        }
    });
}
exports.getXrefs = getXrefs;
function idsToWords(db, idxs) {
    return Promise.all(idxs.map(i => db.get(`raw/words/${i}`, { asBuffer: false }).then(x => JSON.parse(x))));
}
exports.idsToWords = idsToWords;
function readingBeginning(db, prefix, limit = -1) {
    return __awaiter(this, void 0, void 0, function* () {
        return searchBeginning(db, prefix, 'kana', limit);
    });
}
exports.readingBeginning = readingBeginning;
function readingAnywhere(db, text, limit = -1) {
    return __awaiter(this, void 0, void 0, function* () {
        return searchAnywhere(db, text, 'kana', limit);
    });
}
exports.readingAnywhere = readingAnywhere;
function kanjiBeginning(db, prefix, limit = -1) {
    return __awaiter(this, void 0, void 0, function* () {
        return searchBeginning(db, prefix, 'kanji', limit);
    });
}
exports.kanjiBeginning = kanjiBeginning;
function kanjiAnywhere(db, text, limit = -1) {
    return __awaiter(this, void 0, void 0, function* () {
        return searchAnywhere(db, text, 'kanji', limit);
    });
}
exports.kanjiAnywhere = kanjiAnywhere;
function getTags(db) {
    return __awaiter(this, void 0, void 0, function* () {
        return db.get('raw/tags', { asBuffer: false }).then(x => JSON.parse(x));
    });
}
exports.getTags = getTags;
function getField(db, key) {
    return __awaiter(this, void 0, void 0, function* () {
        return db.get(`raw/${key}`, { asBuffer: false });
    });
}
exports.getField = getField;
function allSubstrings(s) {
    const slen = s.length;
    let ret = new Set();
    for (let start = 0; start < slen; start++) {
        for (let length = 1; length <= slen - start; length++) {
            ret.add(s.substr(start, length));
        }
    }
    return ret;
}
if (module === require.main) {
    (function () {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: Download latest jmdict-eng JSON
            const DBNAME = 'test';
            const { db, dictDate, version } = yield setup(DBNAME, 'jmdict-eng-3.1.0.json', true, false);
            console.log({ dictDate, version });
            const res = yield readingBeginning(db, 'いい'); // それ
            const resPartial = yield readingAnywhere(db, 'いい');
            console.log(`${res.length} exact found`);
            console.log(`${resPartial.length} partial found`);
            console.log(yield idsToWords(db, ['1383480']));
            {
                const LIMIT = 4;
                const res = yield readingBeginning(db, 'いい', LIMIT);
                console.log(`${res.length} found with limit ${LIMIT}`);
            }
            {
                console.log(Object.keys(yield getTags(db)));
            }
            {
                console.log(yield getField(db, "dictDate"));
            }
            {
                // all the various forms of `Xref`s
                const res = yield readingBeginning(db, 'かぜひく');
                const xref = res[0].sense[0].related[0];
                const related = yield getXrefs(db, xref);
                console.log(related.map(r => r.kanji[0].text));
                console.log((yield getXrefs(db, ['かも知れない', 'かもしれない'])).map(r => r.kanji[0].text));
                console.log((yield getXrefs(db, ['おばあさん', 2])).map(r => r.kanji[0].text));
                console.log((yield getXrefs(db, ['振れる', 'ふれる・2', 2])).map(r => r.kanji[0].text));
            }
        });
    })();
}

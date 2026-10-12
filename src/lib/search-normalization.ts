import data from "./search-unicode-data.json";

// Shared frozen Unicode data keeps browser, Node and PostgreSQL case conversion
// identical across runtime upgrades. SQL generation uses this same snapshot.
const lowercase = [...data.lower];
const mapped = new Map([...data.upper].map((char, i) => [char, lowercase[i]]));
const cased = new RegExp(data.cased, "u");
const ignorable = new RegExp(data.ignorable, "u");
const modern = new RegExp(data.nfcCompatibility.pattern, "u");
const classes: Record<string, number> = data.nfcCompatibility.classes;
const decompositions: Record<string, string> =
  data.nfcCompatibility.decompositions;
const compositions: Record<string, string> = data.nfcCompatibility.compositions;

/** Node 24 and browsers may have older Unicode tables too. Mirror the SQL NFC
 * compatibility path only for characters introduced after Unicode 15. */
function normalizeNfc(value: string): string {
  if (!modern.test(value)) return value.normalize("NFC");
  const decomposed = [...value]
    .map((char) => decompositions[char] ?? char)
    .join("")
    .normalize("NFD");
  let segment = 0;
  const ordered = [...decomposed]
    .map((char, order) => {
      const cc = classes[char] ?? 0;
      if (cc === 0) segment++;
      return { char, cc, segment, order };
    })
    .sort((a, b) => a.segment - b.segment || a.cc - b.cc || a.order - b.order);
  const result: string[] = [];
  let starter = -1,
    lastClass = 0;
  for (const { char, cc } of ordered) {
    if (starter >= 0 && (lastClass === 0 || lastClass < cc)) {
      const pair = result[starter] + char;
      const combined = compositions[pair] ?? pair.normalize("NFC");
      if ([...combined].length === 1) {
        result[starter] = combined;
        continue;
      }
    }
    if (cc === 0) starter = result.length;
    result.push(char);
    lastClass = cc;
  }
  return result.join("");
}

export function normalizeSearchText(value: string): string {
  const source = [...normalizeNfc(value).trim()];
  return source
    .map((char, i) => {
      if (char === "İ") return "i\u0307";
      if (char !== "Σ") return mapped.get(char) ?? char;
      let before = i - 1,
        after = i + 1;
      while (before >= 0 && ignorable.test(source[before])) before--;
      while (after < source.length && ignorable.test(source[after])) after++;
      return before >= 0 &&
        cased.test(source[before]) &&
        !(after < source.length && cased.test(source[after]))
        ? "ς"
        : "σ";
    })
    .join("");
}

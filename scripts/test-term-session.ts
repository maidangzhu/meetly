import assert from "node:assert/strict";
import {
  CUSTOM_INDUSTRY_ID,
  INDUSTRY_HINT,
  INDUSTRY_PRESETS,
  isIndustryReady,
  resolveIndustryLabel,
  termRequestInput,
  type IndustryChoice,
} from "../src/app/industry.ts";
import { earlierTerms, heroTerm, normalizeTerm, recordDetectedTerms } from "../src/app/terms.ts";

const labels = INDUSTRY_PRESETS.map((preset) => preset.label);
assert.deepEqual(labels.slice(0, 4), ["CRO / 临床研究", "IT", "建筑", "电商"]);
for (const label of ["金融", "医疗", "制造", "教育"]) {
  assert.ok(labels.includes(label), label);
}

const cro: IndustryChoice = { presetId: "cro", customText: "" };
const commerce: IndustryChoice = { presetId: "commerce", customText: "不会被用到" };
const custom: IndustryChoice = { presetId: CUSTOM_INDUSTRY_ID, customText: " 法律 " };
const blankCustom: IndustryChoice = { presetId: CUSTOM_INDUSTRY_ID, customText: "   " };

assert.equal(resolveIndustryLabel(cro), "CRO / 临床研究");
assert.equal(resolveIndustryLabel(commerce), "电商");
assert.equal(resolveIndustryLabel(custom), "法律");
assert.equal(isIndustryReady(cro), true);
assert.equal(isIndustryReady(blankCustom), false);
assert.equal(isIndustryReady({ presetId: "", customText: "" }), false);
assert.deepEqual(termRequestInput(commerce, " 这个 CTA 的点击率怎么样 "), {
  industry: "电商",
  transcript: "这个 CTA 的点击率怎么样",
});
assert.notEqual(termRequestInput(commerce, "CTA").industry, "CRO / 临床研究");

assert.match(INDUSTRY_HINT, /临床试验助理/);
assert.match(INDUSTRY_HINT, /行动号召/);
assert.match(INDUSTRY_HINT, /CRO \/ 临床研究/);
assert.match(INDUSTRY_HINT, /电商/);
assert.doesNotMatch(INDUSTRY_HINT, /临床委托协议/);

assert.equal(normalizeTerm(" CTA "), normalizeTerm("c.t.a"));
assert.equal(normalizeTerm("Call to Action"), "calltoaction");

const first = recordDetectedTerms([], [
  { term: "CTA", explanation: "临床试验助理，协助研究者处理试验现场事务。" },
]);
const repeated = recordDetectedTerms(first, [
  { term: "cta", explanation: "另一套解释，不应该把卡片再闪一次。" },
]);
assert.deepEqual(repeated, first);
assert.equal(heroTerm(repeated)?.term, "CTA");

const batch = recordDetectedTerms([], [
  { term: "CRA", explanation: "临床监查员，到研究中心核对试验怎么做。" },
  { term: "CTA", explanation: "临床试验助理，协助研究者处理现场事务。" },
  { term: "GCP", explanation: "药物临床试验质量管理规范。" },
]);
assert.equal(heroTerm(batch)?.term, "GCP");
assert.deepEqual(
  earlierTerms(batch).map((term) => term.term),
  ["CTA", "CRA"],
);

const ordinary = recordDetectedTerms(batch, []);
assert.equal(ordinary.length, batch.length);
assert.equal(heroTerm([]), null);

const skipped = recordDetectedTerms([], [
  { term: "  ", explanation: "空术语" },
  { term: "SOP", explanation: "   " },
]);
assert.equal(skipped.length, 0);

console.log("term session ok");

import { writeFile } from "node:fs/promises";

import {
  BASELINE_EVAL_FIXTURE_GENERATED_AT,
  baselineEvalFixturePath,
  buildBaselineArchetypeEvalArtifact,
} from "../src/test-intelligence/baseline-eval.js";
import { BASELINE_ARCHETYPE_FIXTURE_IDS } from "@oscharko-dev/ti-core-engine";
import { canonicalJson } from "@oscharko-dev/ti-security";

for (const archetypeId of BASELINE_ARCHETYPE_FIXTURE_IDS) {
  const artifact = await buildBaselineArchetypeEvalArtifact({
    archetypeId,
    generatedAt: BASELINE_EVAL_FIXTURE_GENERATED_AT,
  });
  await writeFile(baselineEvalFixturePath(archetypeId), canonicalJson(artifact));
  console.log(`updated ${archetypeId}`);
}

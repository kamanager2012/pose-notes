// Pure filtering of the public catalog. No source drawings or internal review data.
const preferredIds = [
  "photo-full-single-p017", "photo-full-single-p015", "photo-full-single-p041",
  "walk-natural", "hands-in-pockets", "wall-relaxed", "photo-upper80v2-p019",
  "photo-full-single-p012", "photo-full-single-p009", "photo-full-single-p046",
];

export function recommendPhotoPoses(catalog, options = {}) {
  const {
    peopleCount = 1, context, posture, framing,
    availableFeatures = [], includeStyles = false, limit = 6,
    deduplicateFamilies = true,
  } = options;
  const vocabulary = catalog.recommendationOptions;
  const peopleCounts = vocabulary.peopleCounts ?? [1, 2];
  const all = [...catalog.poses, ...catalog.guideBasedPoses];
  if (!peopleCounts.includes(peopleCount)) throw new RangeError(`peopleCount must be one of: ${peopleCounts.join(", ")}`);
  if (!Number.isInteger(limit) || limit < 0 || limit > all.length) throw new RangeError(`limit must be an integer from 0 to ${all.length}`);
  if (typeof includeStyles !== "boolean") throw new TypeError("includeStyles must be boolean");
  if (typeof deduplicateFamilies !== "boolean") throw new TypeError("deduplicateFamilies must be boolean");
  for (const [name, value, values] of [
    ["context", context, vocabulary.contexts],
    ["posture", posture, vocabulary.postures],
    ["framing", framing, vocabulary.framing],
  ]) {
    if (value !== undefined && !Object.hasOwn(values, value)) throw new RangeError(`Unknown ${name}: ${value}`);
  }
  if (!Array.isArray(availableFeatures) || availableFeatures.some((feature) => !Object.hasOwn(vocabulary.features, feature))) {
    throw new RangeError("availableFeatures must contain known feature IDs");
  }
  const features = new Set(availableFeatures);
  for (const feature of availableFeatures) {
    for (const implied of vocabulary.featureImplications[feature] ?? []) features.add(implied);
  }
  const usesChosenFeature = (pose) => pose.recommendation.requiredFeatures.some((feature) => features.has(feature));
  const rank = (id) => {
    const index = preferredIds.indexOf(id);
    return index < 0 ? preferredIds.length : index;
  };
  const candidates = all
    .filter((pose) => {
      const r = pose.recommendation;
      return r.peopleCount === peopleCount
        && (!context || r.contexts.includes(context))
        && (!posture || r.postures.includes(posture))
        && (!framing || r.framing.includes(framing))
        && r.requiredFeatures.every((feature) => features.has(feature))
        && (includeStyles || r.tier !== "style")
        && (r.tier !== "contextual" || (context && r.contexts.includes(context)));
    })
    .sort((a, b) => Number(usesChosenFeature(b)) - Number(usesChosenFeature(a)) || rank(a.id) - rank(b.id));
  const families = new Set();
  const result = [];
  for (const pose of candidates) {
    if (result.length === limit) break;
    if (deduplicateFamilies && families.has(pose.recommendation.family)) continue;
    families.add(pose.recommendation.family);
    result.push(pose);
  }
  return result;
}

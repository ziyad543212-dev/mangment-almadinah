const { validateName } = require('./passport-extraction');

const FIELDS = ['first_name_ar', 'father_name_ar', 'last_name_ar'];

function needsArabicAssistance(extraction) {
  return FIELDS.some((field) => !extraction.data[field] || !extraction.agreements.has(field) ||
    extraction.conflicts.some((entry) => entry.field === field));
}

function applyArabicAssistance(extraction, result) {
  const fields = result?.status === 'completed' ? result.fields || {} : {};
  const updated = { ...extraction, data: { ...extraction.data }, sources: { ...extraction.sources },
    confidence: { ...extraction.confidence }, conflicts: [...extraction.conflicts],
    reviewFields: [...extraction.reviewFields], agreements: new Set(extraction.agreements) };
  for (const field of FIELDS) {
    const hit = fields[field];
    const value = hit?.readability === 'clear' ? validateName(hit.value, 'arabic') : '';
    if (!value) {
      if (hit) {
        updated.reviewFields.push(field);
        updated.agreements.delete(field);
      }
      continue;
    }
    const localValue = updated.data[field];
    const existingConflicts = updated.conflicts.filter((entry) => entry.field === field);
    if (localValue === value) {
      if (!existingConflicts.length) updated.agreements.add(field);
      continue;
    }
    const alternatives = existingConflicts.flatMap((entry) => entry.alternatives || [entry.visual, entry.mrz].filter(Boolean));
    if (localValue) alternatives.push({ source: updated.sources[field], value: localValue });
    alternatives.push({ source: 'gemini', value });
    updated.data[field] = value;
    updated.sources[field] = 'gemini';
    updated.confidence[field] = null; // LLM self-reported confidence is not calibrated.
    updated.agreements.delete(field);
    updated.conflicts = updated.conflicts.filter((entry) => entry.field !== field);
    if (localValue || existingConflicts.length) {
      const unique = [...new Map(alternatives.map((entry) => [`${entry.source}:${entry.value}`, entry])).values()];
      updated.conflicts.push({ field, resolution: 'gemini', visual: { source: 'gemini', value }, alternatives: unique });
    }
    updated.reviewFields.push(field);
  }
  updated.reviewFields = [...new Set(updated.reviewFields)];
  return updated;
}

module.exports = { needsArabicAssistance, applyArabicAssistance };

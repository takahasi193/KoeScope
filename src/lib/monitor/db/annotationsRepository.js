import {
  asJson,
  isoNow,
  mapWorkAnnotation,
  normalizeProductId,
  normalizeWorkAnnotationInput,
} from "./utils.js";

export function createAnnotationsRepository({ db, statements }) {
  function requireProductId(productId) {
    const normalized = normalizeProductId(productId);
    if (!normalized) {
      const error = new Error("productId is required.");
      error.statusCode = 400;
      throw error;
    }
    return normalized;
  }

  function getWorkAnnotation(productId) {
    const normalized = requireProductId(productId);
    const row = db.prepare("SELECT * FROM work_annotations WHERE product_id = ?").get(normalized);
    return mapWorkAnnotation(row, normalized);
  }

  function saveWorkAnnotation({ productId, note = "", tags = [], status = "" }) {
    const normalized = requireProductId(productId);
    const annotation = normalizeWorkAnnotationInput({ note, tags, status });
    statements.upsertWorkAnnotation.run({
      productId: normalized,
      note: annotation.note,
      tagsJson: asJson(annotation.tags),
      status: annotation.status,
      now: isoNow(),
    });
    return getWorkAnnotation(normalized);
  }

  function deleteWorkAnnotation(productId) {
    const result = statements.deleteWorkAnnotation.run(requireProductId(productId));
    return result.changes > 0;
  }

  return {
    getWorkAnnotation,
    saveWorkAnnotation,
    deleteWorkAnnotation,
  };
}

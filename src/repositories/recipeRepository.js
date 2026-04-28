const crypto = require("crypto");
const { getDb } = require("../db/database");

function nowIso() {
  return new Date().toISOString();
}

function rowToRecipe(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    cuisine: row.cuisine,
    difficulty: row.difficulty,
    prepTimeMinutes: row.prep_time_minutes,
    cookTimeMinutes: row.cook_time_minutes,
    totalTimeMinutes: row.total_time_minutes,
    servings: row.servings,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    foodContent: Boolean(row.food_content),
    confidence: row.confidence,
    tags: safeJson(row.tags, []),
    favorite: Boolean(row.favorite),
    ingredients: safeJson(row.ingredients_json, []),
    equipment: safeJson(row.equipment_json, []),
    steps: safeJson(row.steps_json, []),
    macros: safeJson(row.macros_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function safeJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function listRecipes(filters = {}) {
  const db = getDb();
  const {
    search = "",
    cuisine = "",
    difficulty = "",
    favorite,
    tag = "",
    prepTimeMax,
    sort = "newest"
  } = filters;

  const clauses = [];
  const params = [];

  if (search) {
    clauses.push("(title LIKE ? OR description LIKE ?)");
    const q = `%${search}%`;
    params.push(q, q);
  }
  if (cuisine) {
    clauses.push("cuisine = ?");
    params.push(cuisine);
  }
  if (difficulty) {
    clauses.push("difficulty = ?");
    params.push(difficulty);
  }
  if (favorite === true || favorite === "true" || favorite === "1") {
    clauses.push("favorite = 1");
  }
  if (tag) {
    clauses.push("LOWER(tags) LIKE ?");
    params.push(`%${String(tag).toLowerCase()}%`);
  }
  if (prepTimeMax !== undefined && prepTimeMax !== "" && !Number.isNaN(Number(prepTimeMax))) {
    clauses.push("prep_time_minutes <= ?");
    params.push(Number(prepTimeMax));
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  let orderBy = "created_at DESC";
  if (sort === "oldest") orderBy = "created_at ASC";
  else if (sort === "easiest") orderBy = "CASE difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC, created_at DESC";
  else if (sort === "hardest") orderBy = "CASE difficulty WHEN 'hard' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC, created_at DESC";
  else if (sort === "fastest") orderBy = "total_time_minutes ASC, created_at DESC";
  else if (sort === "slowest") orderBy = "total_time_minutes DESC, created_at DESC";

  const sql = `SELECT * FROM recipes ${where} ORDER BY ${orderBy}`;
  const rows = db.prepare(sql).all(...params);
  return rows.map(rowToRecipe);
}

function getRecipeById(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM recipes WHERE id = ?").get(id);
  return rowToRecipe(row);
}

function insertRecipe(payload) {
  const db = getDb();
  const id = payload.id || crypto.randomUUID();
  const ts = nowIso();
  const stmt = db.prepare(`
    INSERT INTO recipes (
      id, title, description, cuisine, difficulty,
      prep_time_minutes, cook_time_minutes, total_time_minutes, servings,
      source_type, source_url, food_content, confidence, tags, favorite,
      ingredients_json, equipment_json, steps_json, macros_json, created_at, updated_at
    ) VALUES (
      @id, @title, @description, @cuisine, @difficulty,
      @prep_time_minutes, @cook_time_minutes, @total_time_minutes, @servings,
      @source_type, @source_url, @food_content, @confidence, @tags, @favorite,
      @ingredients_json, @equipment_json, @steps_json, @macros_json, @created_at, @updated_at
    )
  `);

  stmt.run({
    id,
    title: payload.title ?? "",
    description: payload.description ?? "",
    cuisine: payload.cuisine ?? "",
    difficulty: payload.difficulty ?? "medium",
    prep_time_minutes: Number(payload.prepTimeMinutes) || 0,
    cook_time_minutes: Number(payload.cookTimeMinutes) || 0,
    total_time_minutes: Number(payload.totalTimeMinutes) || 0,
    servings: Math.max(1, Number(payload.servings) || 2),
    source_type: payload.sourceType ?? "video_import",
    source_url: payload.sourceUrl ?? "",
    food_content: payload.foodContent === false ? 0 : 1,
    confidence: typeof payload.confidence === "number" ? payload.confidence : 0,
    tags: JSON.stringify(payload.tags ?? []),
    favorite: payload.favorite ? 1 : 0,
    ingredients_json: JSON.stringify(payload.ingredients ?? []),
    equipment_json: JSON.stringify(payload.equipment ?? []),
    steps_json: JSON.stringify(payload.steps ?? []),
    macros_json: JSON.stringify(payload.macros ?? null),
    created_at: payload.createdAt || ts,
    updated_at: ts
  });

  return getRecipeById(id);
}

function updateRecipe(id, payload) {
  const db = getDb();
  const existing = getRecipeById(id);
  if (!existing) return null;

  const merged = {
    ...existing,
    ...payload,
    ingredients: payload.ingredients !== undefined ? payload.ingredients : existing.ingredients,
    equipment: payload.equipment !== undefined ? payload.equipment : existing.equipment,
    steps: payload.steps !== undefined ? payload.steps : existing.steps,
    tags: payload.tags !== undefined ? payload.tags : existing.tags,
    macros: payload.macros !== undefined ? payload.macros : existing.macros
  };

  db.prepare(
    `
    UPDATE recipes SET
      title = @title,
      description = @description,
      cuisine = @cuisine,
      difficulty = @difficulty,
      prep_time_minutes = @prep_time_minutes,
      cook_time_minutes = @cook_time_minutes,
      total_time_minutes = @total_time_minutes,
      servings = @servings,
      source_type = @source_type,
      source_url = @source_url,
      food_content = @food_content,
      confidence = @confidence,
      tags = @tags,
      favorite = @favorite,
      ingredients_json = @ingredients_json,
      equipment_json = @equipment_json,
      steps_json = @steps_json,
      macros_json = @macros_json,
      updated_at = @updated_at
    WHERE id = @id
  `
  ).run({
    id,
    title: merged.title ?? "",
    description: merged.description ?? "",
    cuisine: merged.cuisine ?? "",
    difficulty: merged.difficulty ?? "medium",
    prep_time_minutes: Number(merged.prepTimeMinutes) || 0,
    cook_time_minutes: Number(merged.cookTimeMinutes) || 0,
    total_time_minutes: Number(merged.totalTimeMinutes) || 0,
    servings: Math.max(1, Number(merged.servings) || 2),
    source_type: merged.sourceType ?? "video_import",
    source_url: merged.sourceUrl ?? "",
    food_content: merged.foodContent === false ? 0 : 1,
    confidence: typeof merged.confidence === "number" ? merged.confidence : 0,
    tags: JSON.stringify(merged.tags ?? []),
    favorite: merged.favorite ? 1 : 0,
    ingredients_json: JSON.stringify(merged.ingredients ?? []),
    equipment_json: JSON.stringify(merged.equipment ?? []),
    steps_json: JSON.stringify(merged.steps ?? []),
    macros_json: JSON.stringify(merged.macros ?? null),
    updated_at: nowIso()
  });

  return getRecipeById(id);
}

function deleteRecipe(id) {
  const db = getDb();
  const info = db.prepare("DELETE FROM recipes WHERE id = ?").run(id);
  return info.changes > 0;
}

function duplicateRecipe(id) {
  const src = getRecipeById(id);
  if (!src) return null;
  const copy = {
    ...src,
    id: undefined,
    title: `${src.title} (copy)`,
    favorite: false,
    createdAt: undefined,
    updatedAt: undefined
  };
  return insertRecipe(copy);
}

function setFavorite(id, favorite) {
  const db = getDb();
  const info = db
    .prepare("UPDATE recipes SET favorite = ?, updated_at = ? WHERE id = ?")
    .run(favorite ? 1 : 0, nowIso(), id);
  if (info.changes === 0) return null;
  return getRecipeById(id);
}

module.exports = {
  listRecipes,
  getRecipeById,
  insertRecipe,
  updateRecipe,
  deleteRecipe,
  duplicateRecipe,
  setFavorite
};

const crypto = require("crypto");
const { getDb } = require("../db/database");

function nowIso() {
  return new Date().toISOString();
}

function listMealPlan({ startDate, endDate } = {}) {
  const db = getDb();
  let sql = "SELECT * FROM meal_plan_entries WHERE 1=1";
  const params = [];
  if (startDate) {
    sql += " AND date_str >= ?";
    params.push(startDate);
  }
  if (endDate) {
    sql += " AND date_str <= ?";
    params.push(endDate);
  }
  sql += " ORDER BY date_str ASC, meal_slot ASC";
  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => ({
    id: row.id,
    date: row.date_str,
    mealSlot: row.meal_slot,
    recipeId: row.recipe_id,
    createdAt: row.created_at
  }));
}

function replaceMealPlan(entries, options = {}) {
  const { startDate, endDate } = options;
  const db = getDb();
  const ts = nowIso();
  const ins = db.prepare(`
    INSERT INTO meal_plan_entries (id, date_str, meal_slot, recipe_id, created_at)
    VALUES (@id, @date_str, @meal_slot, @recipe_id, @created_at)
  `);

  const run = db.transaction((rows) => {
    if (startDate && endDate) {
      db.prepare("DELETE FROM meal_plan_entries WHERE date_str BETWEEN ? AND ?").run(startDate, endDate);
    } else if (rows.length) {
      const dates = [...new Set(rows.map((r) => r.date).filter(Boolean))];
      if (dates.length) {
        db.prepare(`DELETE FROM meal_plan_entries WHERE date_str IN (${dates.map(() => "?").join(",")})`).run(
          ...dates
        );
      }
    }
    rows.forEach((e) => {
      ins.run({
        id: e.id || crypto.randomUUID(),
        date_str: e.date,
        meal_slot: e.mealSlot || "dinner",
        recipe_id: e.recipeId,
        created_at: e.createdAt || ts
      });
    });
  });

  run(entries || []);
  return listMealPlan();
}

module.exports = {
  listMealPlan,
  replaceMealPlan
};

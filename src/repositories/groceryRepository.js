const crypto = require("crypto");
const { getDb } = require("../db/database");

function nowIso() {
  return new Date().toISOString();
}

function listGroceryLists() {
  const db = getDb();
  return db.prepare("SELECT * FROM grocery_lists ORDER BY updated_at DESC").all();
}

function getGroceryListWithItems(id) {
  const db = getDb();
  const list = db.prepare("SELECT * FROM grocery_lists WHERE id = ?").get(id);
  if (!list) return null;
  const items = db
    .prepare(
      "SELECT * FROM grocery_list_items WHERE list_id = ? ORDER BY sort_order ASC, name ASC"
    )
    .all(id);
  return {
    id: list.id,
    name: list.name,
    createdAt: list.created_at,
    updatedAt: list.updated_at,
    items: items.map((row) => ({
      id: row.id,
      name: row.name,
      amount: row.amount,
      unit: row.unit,
      notes: row.notes,
      checked: Boolean(row.checked),
      recipeId: row.recipe_id,
      sortOrder: row.sort_order
    }))
  };
}

function createGroceryList({ name = "Groceries", items = [] }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const ts = nowIso();
  db.prepare(
    "INSERT INTO grocery_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(id, name || "Groceries", ts, ts);

  const insertItem = db.prepare(`
    INSERT INTO grocery_list_items (id, list_id, name, amount, unit, notes, checked, recipe_id, sort_order)
    VALUES (@id, @list_id, @name, @amount, @unit, @notes, @checked, @recipe_id, @sort_order)
  `);

  const run = db.transaction((rows) => {
    rows.forEach((item, index) => {
      insertItem.run({
        id: crypto.randomUUID(),
        list_id: id,
        name: item.name || "",
        amount: item.amount || "",
        unit: item.unit || "",
        notes: item.notes || "",
        checked: item.checked ? 1 : 0,
        recipe_id: item.recipeId || null,
        sort_order: index
      });
    });
  });

  run(items);
  return getGroceryListWithItems(id);
}

function updateGroceryList(id, { name, items }) {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM grocery_lists WHERE id = ?").get(id);
  if (!existing) return null;

  const ts = nowIso();
  if (typeof name === "string") {
    db.prepare("UPDATE grocery_lists SET name = ?, updated_at = ? WHERE id = ?").run(name, ts, id);
  }

  if (Array.isArray(items)) {
    db.prepare("DELETE FROM grocery_list_items WHERE list_id = ?").run(id);
    const insertItem = db.prepare(`
      INSERT INTO grocery_list_items (id, list_id, name, amount, unit, notes, checked, recipe_id, sort_order)
      VALUES (@id, @list_id, @name, @amount, @unit, @notes, @checked, @recipe_id, @sort_order)
    `);
    const run = db.transaction((rows) => {
      rows.forEach((item, index) => {
        insertItem.run({
          id: item.id || crypto.randomUUID(),
          list_id: id,
          name: item.name || "",
          amount: item.amount || "",
          unit: item.unit || "",
          notes: item.notes || "",
          checked: item.checked ? 1 : 0,
          recipe_id: item.recipeId || null,
          sort_order: index
        });
      });
    });
    run(items);
  }

  db.prepare("UPDATE grocery_lists SET updated_at = ? WHERE id = ?").run(ts, id);
  return getGroceryListWithItems(id);
}

function deleteGroceryList(id) {
  const db = getDb();
  const info = db.prepare("DELETE FROM grocery_lists WHERE id = ?").run(id);
  return info.changes > 0;
}

module.exports = {
  listGroceryLists,
  getGroceryListWithItems,
  createGroceryList,
  updateGroceryList,
  deleteGroceryList
};

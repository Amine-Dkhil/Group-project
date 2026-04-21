const { getRecipeById } = require("../repositories/recipeRepository");
const groceryRepository = require("../repositories/groceryRepository");

function normalizeKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeLineKey(name, unit) {
  return `${normalizeKey(name)}|${String(unit || "").toLowerCase().trim()}`;
}

function buildItemsFromRecipes(recipeIds) {
  const merged = new Map();

  for (const rid of recipeIds) {
    const recipe = getRecipeById(rid);
    if (!recipe) continue;
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    ingredients.forEach((ing) => {
      const name = ing.name || "Ingredient";
      const unit = ing.unit || "";
      const key = mergeLineKey(name, unit);
      const amount = String(ing.amount || "").trim();
      const notes = String(ing.notes || "").trim();
      const recipeNote = recipe.title ? `from ${recipe.title}` : "";

      if (!merged.has(key)) {
        merged.set(key, {
          name,
          amount,
          unit,
          notes: [notes, recipeNote].filter(Boolean).join(" · "),
          recipeId: rid,
          checked: false
        });
      } else {
        const cur = merged.get(key);
        const parts = [cur.amount, amount].filter(Boolean);
        cur.amount = parts.length ? parts.join(" + ") : cur.amount;
        const extra = [notes, recipeNote].filter(Boolean).join(" · ");
        if (extra) {
          cur.notes = cur.notes ? `${cur.notes}; ${extra}` : extra;
        }
      }
    });
  }

  return Array.from(merged.values()).map((item, index) => ({
    ...item,
    sortOrder: index
  }));
}

function createListFromRecipes({ recipeIds = [], name = "Groceries" }) {
  const ids = Array.isArray(recipeIds) ? recipeIds : [];
  const items = buildItemsFromRecipes(ids);
  return groceryRepository.createGroceryList({ name, items });
}

module.exports = {
  buildItemsFromRecipes,
  createListFromRecipes
};

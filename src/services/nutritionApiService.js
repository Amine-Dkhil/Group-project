const { amountToGrams } = require("./unitConversionService");

function emptyMacros() {
  return {
    calories: 0,
    proteinGrams: 0,
    carbsGrams: 0,
    fatGrams: 0,
    fiberGrams: 0,
    sugarGrams: 0,
    sodiumMg: 0
  };
}

async function fetchIngredientNutrition(ingredient) {
  const key = process.env.USDA_API_KEY;
  if (!key) return null;
  const query = `${ingredient.amount || ""} ${ingredient.unit || ""} ${ingredient.name || ""}`.trim();
  if (!query) return null;

  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", key);
  url.searchParams.set("query", query);
  url.searchParams.set("pageSize", "1");

  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  const food = Array.isArray(data.foods) && data.foods.length ? data.foods[0] : null;
  if (!food || !Array.isArray(food.foodNutrients)) return null;

  const nutrients = {};
  food.foodNutrients.forEach((n) => {
    const keyName = String(n.nutrientName || "").toLowerCase();
    nutrients[keyName] = Number(n.value || 0);
  });

  const grams = amountToGrams(ingredient.amount, ingredient.unit);
  const scale = grams / 100;
  const macros = emptyMacros();
  macros.calories = Number(((nutrients.energy || 0) * scale).toFixed(2));
  macros.proteinGrams = Number(((nutrients.protein || 0) * scale).toFixed(2));
  macros.carbsGrams = Number(((nutrients["carbohydrate, by difference"] || 0) * scale).toFixed(2));
  macros.fatGrams = Number(((nutrients["total lipid (fat)"] || 0) * scale).toFixed(2));
  macros.fiberGrams = Number(((nutrients["fiber, total dietary"] || 0) * scale).toFixed(2));
  macros.sugarGrams = Number(((nutrients["sugars, total including nlea"] || 0) * scale).toFixed(2));
  macros.sodiumMg = Number(((nutrients.sodium || 0) * scale).toFixed(2));
  return macros;
}

module.exports = {
  fetchIngredientNutrition,
  emptyMacros
};

const recipeRepository = require("../repositories/recipeRepository");
const { fetchIngredientNutrition, emptyMacros } = require("./nutritionApiService");
const { estimateWithGemini } = require("./geminiNutritionService");
const { toNumber } = require("./unitConversionService");

function sumMacros(items) {
  return items.reduce(
    (acc, item) => ({
      calories: acc.calories + (item.calories || 0),
      proteinGrams: acc.proteinGrams + (item.proteinGrams || 0),
      carbsGrams: acc.carbsGrams + (item.carbsGrams || 0),
      fatGrams: acc.fatGrams + (item.fatGrams || 0),
      fiberGrams: acc.fiberGrams + (item.fiberGrams || 0),
      sugarGrams: acc.sugarGrams + (item.sugarGrams || 0),
      sodiumMg: acc.sodiumMg + (item.sodiumMg || 0)
    }),
    emptyMacros()
  );
}

function roundMacros(macros) {
  return Object.fromEntries(
    Object.entries(macros).map(([k, v]) => {
      const n = Number(v);
      return [k, Number((Number.isFinite(n) ? n : 0).toFixed(2))];
    })
  );
}

function fallbackIngredientMacros(ingredient) {
  const amount = Math.max(1, toNumber(ingredient.amount, 1));
  return {
    calories: 50 * amount,
    proteinGrams: 2 * amount,
    carbsGrams: 6 * amount,
    fatGrams: 1.5 * amount,
    fiberGrams: 1 * amount,
    sugarGrams: 1 * amount,
    sodiumMg: 40 * amount
  };
}

async function calculateRecipeMacros({ recipeId, ingredientsOverride }) {
  const recipe = recipeRepository.getRecipeById(recipeId);
  if (!recipe) throw new Error("Recipe not found.");
  const ingredients = Array.isArray(ingredientsOverride) ? ingredientsOverride : recipe.ingredients || [];

  const enriched = [];
  let source = "fallback";
  for (const ingredient of ingredients) {
    if (!ingredient || !ingredient.name) continue;
    if (ingredient.included === false) continue;
    const usda = await fetchIngredientNutrition(ingredient);
    const macros = usda || fallbackIngredientMacros(ingredient);
    if (usda) source = "usda";
    enriched.push({
      name: ingredient.name,
      amount: String(ingredient.amount || ""),
      unit: String(ingredient.unit || ""),
      included: ingredient.included !== false,
      ...roundMacros(macros),
      confidence: usda ? 0.9 : 0.45
    });
  }

  if (!enriched.length) {
    return {
      recipeId,
      servings: recipe.servings || 1,
      source: "fallback",
      perServing: emptyMacros(),
      wholeRecipe: emptyMacros(),
      ingredients: [],
      notes: "No included ingredients to calculate.",
      createdAt: new Date().toISOString()
    };
  }

  if (source !== "usda") {
    const geminiEstimate = await estimateWithGemini({ recipe, ingredients: enriched });
    if (geminiEstimate && geminiEstimate.wholeRecipe && geminiEstimate.perServing) {
      return {
        recipeId,
        servings: recipe.servings || 1,
        source: "gemini_estimate",
        perServing: roundMacros(geminiEstimate.perServing),
        wholeRecipe: roundMacros(geminiEstimate.wholeRecipe),
        ingredients: enriched.map((item) => {
          const gm = (geminiEstimate.ingredients || []).find(
            (entry) => String(entry.name || "").toLowerCase() === String(item.name || "").toLowerCase()
          );
          return gm
            ? {
                ...item,
                calories: Number(gm.calories || item.calories || 0),
                proteinGrams: Number(gm.proteinGrams || item.proteinGrams || 0),
                carbsGrams: Number(gm.carbsGrams || item.carbsGrams || 0),
                fatGrams: Number(gm.fatGrams || item.fatGrams || 0),
                fiberGrams: Number(gm.fiberGrams || item.fiberGrams || 0),
                sugarGrams: Number(gm.sugarGrams || item.sugarGrams || 0),
                sodiumMg: Number(gm.sodiumMg || item.sodiumMg || 0),
                confidence: Number(gm.confidence || item.confidence)
              }
            : item;
        }),
        notes: String(geminiEstimate.notes || "AI-estimated nutrition, not medical advice."),
        createdAt: new Date().toISOString()
      };
    }
  }

  const wholeRecipe = roundMacros(sumMacros(enriched));
  const servings = Math.max(1, Number(recipe.servings || 1));
  const perServing = roundMacros({
    calories: wholeRecipe.calories / servings,
    proteinGrams: wholeRecipe.proteinGrams / servings,
    carbsGrams: wholeRecipe.carbsGrams / servings,
    fatGrams: wholeRecipe.fatGrams / servings,
    fiberGrams: wholeRecipe.fiberGrams / servings,
    sugarGrams: wholeRecipe.sugarGrams / servings,
    sodiumMg: wholeRecipe.sodiumMg / servings
  });

  return {
    recipeId,
    servings,
    source,
    perServing,
    wholeRecipe,
    ingredients: enriched,
    notes:
      source === "usda"
        ? "Nutrition from USDA search matches where available."
        : "AI-estimated nutrition, not medical advice.",
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  calculateRecipeMacros
};

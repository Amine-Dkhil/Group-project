const { createGenAI, runWithModels, safeJsonParse } = require("./geminiRecipeService");

function promptForNutrition({ recipe, ingredients }) {
  return `You are a nutrition estimation engine.

Estimate calories, protein, carbs, fat, fiber, sugar, and sodium for a recipe based on its ingredients and quantities.

Return ONLY valid JSON.

Input:
${JSON.stringify({ recipeId: recipe.id, servings: recipe.servings || 1, ingredients }).slice(0, 20000)}

JSON schema:
{
  "ingredients":[{"name":"","calories":0,"proteinGrams":0,"carbsGrams":0,"fatGrams":0,"fiberGrams":0,"sugarGrams":0,"sodiumMg":0,"confidence":0}],
  "wholeRecipe":{"calories":0,"proteinGrams":0,"carbsGrams":0,"fatGrams":0,"fiberGrams":0,"sugarGrams":0,"sodiumMg":0},
  "perServing":{"calories":0,"proteinGrams":0,"carbsGrams":0,"fatGrams":0,"fiberGrams":0,"sugarGrams":0,"sodiumMg":0},
  "notes":""
}

Rules:
- realistic estimates
- if uncertain, lower confidence
- sodium in mg
- macros in grams
- calories in kcal`;
}

async function estimateWithGemini({ recipe, ingredients }) {
  const genAI = createGenAI();
  if (!genAI) return null;
  try {
    const { text } = await runWithModels(genAI, promptForNutrition({ recipe, ingredients }), { jsonMode: true });
    return safeJsonParse(text);
  } catch {
    return null;
  }
}

module.exports = {
  estimateWithGemini
};

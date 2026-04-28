const recipeRepository = require("../repositories/recipeRepository");
const { geocodeAddress } = require("./geocodingService");
const { findNearbyStores } = require("./placesService");
const { normalizeIngredientName } = require("./ingredientNormalizeService");
const { estimateBasket, storeMultiplier } = require("./priceEstimateService");

function toAmount(value) {
  const n = Number.parseFloat(String(value || "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function buildListFromRecipes(recipeIds = []) {
  const merged = new Map();
  const recipes = recipeIds
    .map((id) => recipeRepository.getRecipeById(id))
    .filter(Boolean);

  recipes.forEach((recipe) => {
    (recipe.ingredients || []).forEach((ingredient) => {
      const normalizedName = normalizeIngredientName(ingredient.name || "");
      if (!normalizedName) return;
      const existing = merged.get(normalizedName);
      const amount = toAmount(ingredient.amount);
      if (!existing) {
        merged.set(normalizedName, {
          id: `item-${normalizedName.replace(/\s+/g, "-")}`,
          name: ingredient.name || normalizedName,
          normalizedName,
          quantity: amount,
          unit: ingredient.unit || "item",
          selected: true,
          availability: "likely available",
          recipeRefs: [recipe.id]
        });
      } else {
        existing.quantity = Number((existing.quantity + amount).toFixed(2));
        existing.recipeRefs = Array.from(new Set(existing.recipeRefs.concat(recipe.id)));
      }
    });
  });

  return Array.from(merged.values());
}

async function compareStores({ address, radiusMiles = 10, recipeIds = [], items = [] }) {
  const geocode = await geocodeAddress(address);
  const stores = await findNearbyStores({
    lat: geocode.location.lat,
    lng: geocode.location.lng,
    radiusMiles,
    limit: 10
  });
  const sourceItems = items.length ? items : buildListFromRecipes(recipeIds);
  const basket = await estimateBasket(sourceItems);

  const storesWithEstimates = stores.map((store) => {
    const likelyCount = sourceItems.filter((it) => it.selected).length;
    const distanceFactor = store.distanceMiles ? 1 + Math.min(store.distanceMiles / 100, 0.05) : 1;
    const multiplier = storeMultiplier(store.name);
    return {
      ...store,
      estimatedBasketTotal: Number((basket.total * multiplier * distanceFactor).toFixed(2)),
      likelyAvailableCount: likelyCount,
      availabilitySource: "likely",
      ingredientStatuses: sourceItems.map((item) => ({
        name: item.name,
        status: "likely available"
      }))
    };
  });

  return {
    geocode,
    stores: storesWithEstimates,
    pricing: basket
  };
}

module.exports = {
  buildListFromRecipes,
  compareStores
};

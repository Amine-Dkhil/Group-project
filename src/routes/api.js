const express = require("express");
const { runVideoImportAnalysis } = require("../services/importPipeline");
const recipeRepository = require("../repositories/recipeRepository");
const groceryRepository = require("../repositories/groceryRepository");
const groceryService = require("../services/groceryService");
const plannerService = require("../services/plannerService");
const { resolveIngredientImageUrl } = require("../services/ingredientImageService");
const shopService = require("../services/shopService");
const { geocodeAddress } = require("../services/geocodingService");
const { findNearbyStores, suggestAddresses } = require("../services/placesService");
const { estimateBasket } = require("../services/priceEstimateService");
const { calculateRecipeMacros } = require("../services/macroService");

const router = express.Router();

router.post("/import/analyze", async (req, res) => {
  const { videoUrl } = req.body || {};
  try {
    const result = await runVideoImportAnalysis(videoUrl);
    res.json(result);
  } catch (error) {
    const message = error && error.message ? error.message : "Analysis failed.";
    const status = message.includes("required") || message.includes("valid http") ? 400 : 500;
    res.status(status).json({ error: message, fallback: true });
  }
});

router.post("/analyze", async (req, res) => {
  const { videoUrl } = req.body || {};
  try {
    const result = await runVideoImportAnalysis(videoUrl);
    res.json({
      videoUrl: result.videoUrl,
      analyzedFrames: result.analyzedFrames,
      transcriptUsed: result.transcriptUsed,
      analysis: result.legacyAnalysis,
      recipeDraft: result.recipeDraft
    });
  } catch (error) {
    const message = error && error.message ? error.message : "Analysis failed.";
    const status = message.includes("required") || message.includes("valid http") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.get("/recipes", (req, res) => {
  const recipes = recipeRepository.listRecipes({
    search: req.query.search || "",
    cuisine: req.query.cuisine || "",
    difficulty: req.query.difficulty || "",
    favorite: req.query.favorite,
    tag: req.query.tag || "",
    prepTimeMax: req.query.prepTimeMax,
    sort: req.query.sort || "newest"
  });
  res.json({ recipes });
});

router.post("/recipes", (req, res) => {
  try {
    const body = req.body || {};
    const recipe = recipeRepository.insertRecipe({
      ...body,
      favorite: Boolean(body.favorite)
    });
    res.status(201).json({ recipe });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not save recipe." });
  }
});

router.get("/recipes/:id", (req, res) => {
  const recipe = recipeRepository.getRecipeById(req.params.id);
  if (!recipe) return res.status(404).json({ error: "Recipe not found." });
  res.json({ recipe });
});

router.put("/recipes/:id", (req, res) => {
  const recipe = recipeRepository.updateRecipe(req.params.id, req.body || {});
  if (!recipe) return res.status(404).json({ error: "Recipe not found." });
  res.json({ recipe });
});

router.delete("/recipes/:id", (req, res) => {
  const ok = recipeRepository.deleteRecipe(req.params.id);
  if (!ok) return res.status(404).json({ error: "Recipe not found." });
  res.json({ ok: true });
});

router.post("/recipes/:id/favorite", (req, res) => {
  const body = req.body || {};
  const favorite =
    typeof body.favorite === "boolean" ? body.favorite : Boolean(body.favorite ?? true);
  const recipe = recipeRepository.setFavorite(req.params.id, favorite);
  if (!recipe) return res.status(404).json({ error: "Recipe not found." });
  res.json({ recipe });
});

router.post("/recipes/:id/duplicate", (req, res) => {
  const recipe = recipeRepository.duplicateRecipe(req.params.id);
  if (!recipe) return res.status(404).json({ error: "Recipe not found." });
  res.status(201).json({ recipe });
});

router.get("/grocery-lists", (_req, res) => {
  const lists = groceryRepository.listGroceryLists().map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  res.json({ lists });
});

router.get("/grocery-lists/:id", (req, res) => {
  const list = groceryRepository.getGroceryListWithItems(req.params.id);
  if (!list) return res.status(404).json({ error: "List not found." });
  res.json({ list });
});

router.post("/grocery-lists/from-recipes", (req, res) => {
  const { recipeIds, name } = req.body || {};
  if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
    return res.status(400).json({ error: "recipeIds must be a non-empty array." });
  }
  const list = groceryService.createListFromRecipes({ recipeIds, name });
  res.status(201).json({ list });
});

router.post("/shop/build-list", (req, res) => {
  const { recipeIds } = req.body || {};
  if (!Array.isArray(recipeIds) || !recipeIds.length) {
    return res.status(400).json({ error: "recipeIds must be a non-empty array." });
  }
  const items = shopService.buildListFromRecipes(recipeIds);
  res.json({ items });
});

router.get("/shop/address-suggest", async (req, res) => {
  try {
    const input = typeof req.query.input === "string" ? req.query.input : "";
    if (!input.trim()) return res.json({ suggestions: [] });
    const suggestions = await suggestAddresses(input);
    res.json({ suggestions });
  } catch (error) {
    const status = /requires google maps api/i.test(error.message || "") ? 400 : 500;
    res.status(status).json({ error: error.message || "Could not fetch address suggestions." });
  }
});

router.post("/shop/geocode", async (req, res) => {
  try {
    const result = await geocodeAddress((req.body || {}).address);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not geocode address." });
  }
});

router.post("/shop/stores", async (req, res) => {
  const { lat, lng, radiusMiles } = req.body || {};
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return res.status(400).json({ error: "lat and lng are required." });
  }
  try {
    const stores = await findNearbyStores({
      lat: Number(lat),
      lng: Number(lng),
      radiusMiles: Number(radiusMiles || 10),
      limit: 10
    });
    res.json({ stores });
  } catch (error) {
    const status = /requires google maps api/i.test(error.message || "") ? 400 : 500;
    res.status(status).json({ error: error.message || "Could not fetch stores." });
  }
});

router.post("/shop/price-estimate", async (req, res) => {
  try {
    const basket = await estimateBasket((req.body || {}).items || []);
    res.json(basket);
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not estimate basket." });
  }
});

router.post("/shop/compare-stores", async (req, res) => {
  try {
    const result = await shopService.compareStores(req.body || {});
    res.json(result);
  } catch (error) {
    const status = /required|invalid/i.test(error.message || "") ? 400 : 500;
    res.status(status).json({ error: error.message || "Could not compare stores." });
  }
});

router.put("/grocery-lists/:id", (req, res) => {
  const list = groceryRepository.updateGroceryList(req.params.id, req.body || {});
  if (!list) return res.status(404).json({ error: "List not found." });
  res.json({ list });
});

router.get("/meal-plan", (req, res) => {
  const entries = plannerService.getMealPlan({
    startDate: req.query.startDate,
    endDate: req.query.endDate
  });
  res.json({ entries });
});

router.put("/meal-plan", (req, res) => {
  const { entries, startDate, endDate } = req.body || {};
  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: "entries must be an array." });
  }
  const saved = plannerService.saveMealPlan(entries, { startDate, endDate });
  res.json({ entries: saved });
});

router.post("/macros/calculate", async (req, res) => {
  try {
    const { recipeId, ingredients } = req.body || {};
    if (!recipeId) return res.status(400).json({ error: "recipeId is required." });
    const result = await calculateRecipeMacros({ recipeId, ingredientsOverride: ingredients });
    res.json(result);
  } catch (error) {
    const status = /not found/i.test(error.message || "") ? 404 : 500;
    res.status(status).json({ error: error.message || "Could not calculate macros." });
  }
});

router.post("/macros/ingredient", async (req, res) => {
  try {
    const { recipeId, ingredient } = req.body || {};
    if (!recipeId || !ingredient) {
      return res.status(400).json({ error: "recipeId and ingredient are required." });
    }
    const result = await calculateRecipeMacros({ recipeId, ingredientsOverride: [ingredient] });
    res.json({ ingredient: result.ingredients[0] || null, source: result.source, notes: result.notes });
  } catch (error) {
    const status = /not found/i.test(error.message || "") ? 404 : 500;
    res.status(status).json({ error: error.message || "Could not calculate ingredient macros." });
  }
});

router.put("/recipes/:id/macros", (req, res) => {
  const macros = (req.body || {}).macros;
  if (!macros || typeof macros !== "object") {
    return res.status(400).json({ error: "macros object is required." });
  }
  const recipe = recipeRepository.updateRecipe(req.params.id, { macros });
  if (!recipe) return res.status(404).json({ error: "Recipe not found." });
  res.json({ recipe });
});

router.get("/resolve-tiktok", async (req, res) => {
  const raw = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!raw) return res.status(400).json({ error: "url is required." });
  let host;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return res.status(400).json({ error: "Invalid URL." });
  }
  if (!host.endsWith("tiktok.com")) {
    return res.status(400).json({ error: "Only tiktok.com URLs are supported." });
  }
  try {
    const response = await fetch(raw, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
    const finalUrl = response.url || raw;
    const match = finalUrl.match(/\/video\/(\d+)/);
    res.json({
      originalUrl: raw,
      resolvedUrl: finalUrl,
      videoId: match ? match[1] : null
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Failed to resolve TikTok URL." });
  }
});

router.get("/ingredient-image", async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name : "";
  const imageUrl = await resolveIngredientImageUrl(name);
  res.json({ name, imageUrl });
});

module.exports = router;

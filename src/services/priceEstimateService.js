const { normalizeIngredientName, levenshtein } = require("./ingredientNormalizeService");

const FALLBACK_PRICES = {
  tomato: { unit: "each", price: 0.75 },
  onion: { unit: "each", price: 0.6 },
  garlic: { unit: "head", price: 0.8 },
  "chicken breast": { unit: "lb", price: 5.99 },
  "ground beef": { unit: "lb", price: 6.99 },
  pasta: { unit: "box", price: 1.99 },
  rice: { unit: "lb", price: 1.5 },
  milk: { unit: "gallon", price: 4.5 },
  egg: { unit: "dozen", price: 3.5 },
  butter: { unit: "lb", price: 4.99 },
  "olive oil": { unit: "bottle", price: 8.99 },
  salt: { unit: "container", price: 1.99 },
  "black pepper": { unit: "container", price: 3.99 },
  "whole chicken": { unit: "each", price: 9.99 },
  "bell pepper": { unit: "each", price: 1.49 },
  salmon: { unit: "lb", price: 11.99 },
  cheese: { unit: "lb", price: 4.99 },
  potato: { unit: "lb", price: 1.29 },
  banana: { unit: "lb", price: 0.69 }
};

const CATEGORY_HINTS = [
  { tokens: ["chicken", "thigh", "drumstick"], key: "whole chicken", unit: "lb", price: 4.99 },
  { tokens: ["salmon", "tuna", "fish", "shrimp"], key: "salmon", unit: "lb", price: 11.99 },
  { tokens: ["onion", "shallot"], key: "onion", unit: "each", price: 0.89 },
  { tokens: ["pepper"], key: "bell pepper", unit: "each", price: 1.49 },
  { tokens: ["pasta", "spaghetti", "penne"], key: "pasta", unit: "box", price: 1.99 },
  { tokens: ["milk"], key: "milk", unit: "gallon", price: 4.49 },
  { tokens: ["egg"], key: "egg", unit: "dozen", price: 3.99 }
];

function toNumber(input, fallback = 1) {
  const val = Number.parseFloat(String(input ?? "").replace(",", "."));
  return Number.isFinite(val) && val > 0 ? val : fallback;
}

function findFallback(name) {
  const normalized = normalizeIngredientName(name);
  if (FALLBACK_PRICES[normalized]) return { key: normalized, ...FALLBACK_PRICES[normalized], confidence: 0.98 };
  const hint = CATEGORY_HINTS.find((row) => row.tokens.some((token) => normalized.includes(token)));
  if (hint) {
    return { key: hint.key, unit: hint.unit, price: hint.price, confidence: 0.84 };
  }
  const keys = Object.keys(FALLBACK_PRICES);
  let best = keys[0];
  let bestDist = Infinity;
  keys.forEach((key) => {
    const dist = levenshtein(normalized, key);
    if (dist < bestDist) {
      best = key;
      bestDist = dist;
    }
  });
  if (bestDist <= Math.max(2, Math.floor(best.length * 0.35))) {
    return { key: best, ...FALLBACK_PRICES[best], confidence: 0.72 };
  }
  const hash = Math.abs(
    normalized.split("").reduce((acc, ch, idx) => acc + ch.charCodeAt(0) * (idx + 17), 0)
  );
  const dynamic = Number((1.49 + (hash % 700) / 100).toFixed(2));
  return { key: "generic", unit: "item", price: dynamic, confidence: 0.38 };
}

async function estimateIngredientPrice(ingredient) {
  const amount = toNumber(ingredient.amount, 1);
  const found = findFallback(ingredient.name);
  const estimate = Number((amount * found.price).toFixed(2));
  return {
    ingredient: ingredient.name,
    normalizedName: normalizeIngredientName(ingredient.name),
    quantity: amount,
    unit: ingredient.unit || found.unit,
    unitPrice: found.price,
    estimatedPrice: estimate,
    source: process.env.GROCERY_PRICE_API_KEY ? "fallback" : "fallback",
    exactPrice: false,
    confidence: found.confidence
  };
}

async function estimateBasket(items) {
  const pricedItems = [];
  for (const item of items || []) {
    if (!item || !item.selected) continue;
    const priced = await estimateIngredientPrice(item);
    pricedItems.push(priced);
  }
  const total = Number(pricedItems.reduce((sum, item) => sum + item.estimatedPrice, 0).toFixed(2));
  return {
    pricedItems,
    total,
    estimated: true,
    note: "Estimated price based on average grocery pricing, not live store inventory."
  };
}

function storeMultiplier(storeName) {
  const n = String(storeName || "").toLowerCase();
  if (n.includes("walmart") || n.includes("target")) return 0.95;
  if (n.includes("whole foods") || n.includes("trader joe")) return 1.1;
  return 1.0;
}

module.exports = {
  estimateIngredientPrice,
  estimateBasket,
  storeMultiplier
};

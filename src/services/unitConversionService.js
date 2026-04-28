function toNumber(value, fallback = 0) {
  const n = Number.parseFloat(String(value || "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function amountToGrams(amount, unit) {
  const value = Math.max(0, toNumber(amount, 0));
  const normalized = String(unit || "").trim().toLowerCase();
  const factorMap = {
    g: 1,
    gram: 1,
    grams: 1,
    kg: 1000,
    lb: 453.592,
    lbs: 453.592,
    oz: 28.3495,
    ml: 1,
    l: 1000,
    tsp: 4.2,
    tbsp: 14.3,
    cup: 240
  };
  const factor = factorMap[normalized];
  if (!factor) return value > 0 ? value * 50 : 100;
  return Number((value * factor).toFixed(2));
}

module.exports = {
  toNumber,
  amountToGrams
};

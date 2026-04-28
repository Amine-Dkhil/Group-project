const STOP_WORDS = new Set([
  "fresh",
  "large",
  "small",
  "medium",
  "organic",
  "chopped",
  "diced",
  "minced",
  "sliced"
]);

function singularize(word) {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokenize(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => singularize(w))
    .filter((w) => w && !STOP_WORDS.has(w));
}

function normalizeIngredientName(name) {
  const tokens = tokenize(name);
  if (!tokens.length) return String(name || "").trim().toLowerCase();
  if (tokens.includes("cherry") && tokens.includes("tomato")) return "tomato";
  return tokens.join(" ");
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const aa = String(a || "");
  const bb = String(b || "");
  const dp = Array.from({ length: aa.length + 1 }, () => Array(bb.length + 1).fill(0));
  for (let i = 0; i <= aa.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= bb.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= aa.length; i += 1) {
    for (let j = 1; j <= bb.length; j += 1) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[aa.length][bb.length];
}

module.exports = {
  normalizeIngredientName,
  levenshtein
};

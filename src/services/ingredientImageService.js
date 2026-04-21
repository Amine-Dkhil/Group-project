const ingredientImageCache = new Map();
const preferGeneratedIngredientImages =
  (process.env.PREFER_GENERATED_INGREDIENT_IMAGES || "true").toLowerCase() !== "false";

function ingredientPlaceholderDataUrl(name) {
  const label = (name || "Ingredient").replace(/&/g, "and").slice(0, 32);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">` +
    `<rect width="100%" height="100%" fill="#e6edf7"/>` +
    `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ` +
    `font-family="Arial, sans-serif" font-size="34" fill="#2f4b6f">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function hashString(input) {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function normalizeIngredientForImagePrompt(name) {
  const key = (name || "").trim().toLowerCase();
  const map = {
    corn: "sweet corn kernels",
    "corn kernels": "sweet corn kernels",
    "ground beef": "raw ground beef",
    "ground meat": "raw ground beef",
    "black beans": "black beans in a small bowl",
    "cooking oil": "olive oil bottle",
    salsa: "red salsa in a small bowl",
    onion: "whole yellow onion"
  };
  return map[key] || key || "ingredient";
}

function buildGeneratedIngredientImageUrl(name, variant = 0) {
  const ingredient = normalizeIngredientForImagePrompt(name);
  const prompt =
    `minimal studio product photo of only one ingredient: ${ingredient}, isolated on pure white background, ` +
    "soft lighting, centered, realistic, simple composition, no text, no watermark, no logo, no plate, no hands";
  const seed = hashString(`${ingredient.toLowerCase()}-${variant}`);
  return (
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=640&height=640&seed=${seed}&nologo=true`
  );
}

async function isReachableImageUrl(url) {
  try {
    let response = await fetch(url, { method: "HEAD" });
    let contentType = response.headers.get("content-type") || "";
    if (response.ok && contentType.includes("image")) return true;

    if (response.status === 405 || response.status === 403 || response.status === 400) {
      response = await fetch(url, { method: "GET" });
      contentType = response.headers.get("content-type") || "";
      return response.ok && contentType.includes("image");
    }

    return false;
  } catch {
    return false;
  }
}

async function resolveIngredientImageUrl(name) {
  const cacheKey = (name || "").trim().toLowerCase();
  if (!cacheKey) return ingredientPlaceholderDataUrl("Ingredient");
  if (ingredientImageCache.has(cacheKey)) return ingredientImageCache.get(cacheKey);

  if (preferGeneratedIngredientImages) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generatedUrl = buildGeneratedIngredientImageUrl(name, attempt);
      if (await isReachableImageUrl(generatedUrl)) {
        ingredientImageCache.set(cacheKey, generatedUrl);
        return generatedUrl;
      }
    }
  }

  const normalized = cacheKey
    .replace(/\(.*?\)/g, "")
    .replace(/fresh|dried|chopped|diced|shredded|ground|minced|kernels|powder/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const keywordMap = {
    "ground meat": "beef",
    "minced meat": "beef",
    "black beans": "black beans",
    "cooking oil": "olive oil",
    "green herbs": "parsley"
  };
  const baseName = keywordMap[cacheKey] || keywordMap[normalized] || normalized || cacheKey;
  const shortName = baseName.split(" ").slice(-1)[0];
  const mealDbCandidates = [...new Set([baseName, shortName])];

  for (const candidate of mealDbCandidates) {
    const mealDbUrl = `https://www.themealdb.com/images/ingredients/${encodeURIComponent(candidate)}.png`;
    if (await isReachableImageUrl(mealDbUrl)) {
      ingredientImageCache.set(cacheKey, mealDbUrl);
      return mealDbUrl;
    }
  }

  const wikiUrl =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search" +
    `&gsrsearch=${encodeURIComponent(`${name} food ingredient`)}` +
    "&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=600";

  try {
    const response = await fetch(wikiUrl);
    if (!response.ok) throw new Error("Image provider request failed.");
    const data = await response.json();
    const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
    const thumb = pages[0]?.thumbnail?.source;
    if (thumb && (await isReachableImageUrl(thumb))) {
      ingredientImageCache.set(cacheKey, thumb);
      return thumb;
    }
  } catch {
    // Fall through to placeholder fallback.
  }

  const fallback = ingredientPlaceholderDataUrl(name);
  ingredientImageCache.set(cacheKey, fallback);
  return fallback;
}

module.exports = {
  resolveIngredientImageUrl
};

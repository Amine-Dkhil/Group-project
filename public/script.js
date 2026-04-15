const form = document.getElementById("analyzeForm");
const loadBtn = document.getElementById("loadBtn");
const videoUrlInput = document.getElementById("videoUrl");
const videoContainer = document.getElementById("videoContainer");
const statusEl = document.getElementById("status");
const analysisSummaryEl = document.getElementById("analysisSummary");
const instructionsSectionEl = document.getElementById("instructionsSection");
const ingredientGridEl = document.getElementById("ingredientGrid");
const resultEl = document.getElementById("result");

function getIngredientImageUrl(ingredientName) {
  return `/api/ingredient-image?name=${encodeURIComponent(ingredientName)}`;
}

function sanitizeDisplayText(text) {
  if (!text) return "";
  return String(text)
    .replace(/\((frames|transcript|both)\)/gi, "")
    .replace(/\bframe\s*\d+\b/gi, "")
    .replace(/\bframes\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function ingredientFallbackSvg(name, loading = false) {
  const label = loading ? "Loading..." : sanitizeDisplayText(name || "Ingredient");
  return (
    "data:image/svg+xml;base64," +
    btoa(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">
        <rect width="100%" height="100%" fill="#f2f5fa" />
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
          font-family="Arial, sans-serif" font-size="26" fill="#45628a">${label}</text>
      </svg>`
    )
  );
}

async function fetchIngredientImageUrl(ingredientName, retry = 0) {
  try {
    const response = await fetch(`${getIngredientImageUrl(ingredientName)}&retry=${retry}`);
    if (!response.ok) throw new Error("Image lookup failed");
    const data = await response.json();
    return data.imageUrl || "";
  } catch {
    return "";
  }
}

async function renderStructuredResult(payload) {
  const analysis = payload.analysis || {};
  const ingredients = Array.isArray(analysis.ingredients) ? analysis.ingredients : [];
  const instructions = Array.isArray(analysis.cooking_instructions)
    ? analysis.cooking_instructions
    : [];

  analysisSummaryEl.innerHTML = `
    <strong>Food Content:</strong> ${analysis.food_content ? "Yes" : "No"} |
    <strong>Confidence:</strong> ${analysis.confidence ?? "N/A"}
    ${analysis.notes ? `<br /><strong>Notes:</strong> ${analysis.notes}` : ""}
  `;

  if (instructions.length) {
    const instructionItems = instructions.map((step, index) => {
      const stepText =
        typeof step === "string"
          ? sanitizeDisplayText(step)
          : sanitizeDisplayText(step?.step || "");
      const detailText = typeof step === "object" ? sanitizeDisplayText(step?.detail || "") : "";
      const tipText = typeof step === "object" ? sanitizeDisplayText(step?.tip || "") : "";

      return `
        <div class="instruction-card">
          <div class="instruction-step-badge">Step ${index + 1}</div>
          <div class="instruction-step-text">${stepText}</div>
          ${detailText ? `<div class="instruction-step-detail">${detailText}</div>` : ""}
          ${tipText ? `<div class="instruction-step-tip">Tip: ${tipText}</div>` : ""}
        </div>
      `;
    });

    instructionsSectionEl.innerHTML = `<div class="instructions-cards">${instructionItems.join("")}</div>`;
  } else {
    instructionsSectionEl.innerHTML = "<p>No clear instruction sequence was detected in this video.</p>";
  }

  if (!ingredients.length) {
    ingredientGridEl.innerHTML = "<p>No ingredients detected.</p>";
    resultEl.textContent = JSON.stringify(payload, null, 2);
    return;
  }

  ingredientGridEl.innerHTML = "";

  ingredients.forEach((item, index) => {
    const name = sanitizeDisplayText(item.name || "Unknown ingredient");
    const qty = sanitizeDisplayText(item.quantity_estimate || "Not available");
    const grams = sanitizeDisplayText(item.quantity_estimate_grams || "Not estimated");
    const evidence = sanitizeDisplayText(item.evidence || "No visual evidence provided.");
    const loadingSvg = ingredientFallbackSvg(name, true);

    const card = document.createElement("article");
    card.className = "ingredient-card";
    card.innerHTML = `
      <img id="ingredient-image-${index}" src="${loadingSvg}" alt="${name}" loading="lazy" />
      <div class="ingredient-card-content">
        <div class="ingredient-name">${name}</div>
        <div class="ingredient-qty"><strong>Estimate:</strong> ${qty}</div>
        <div class="ingredient-qty"><strong>Grams:</strong> ${grams}</div>
        <div class="ingredient-evidence">${evidence}</div>
      </div>
    `;
    ingredientGridEl.appendChild(card);

    fetchIngredientImageUrl(name).then(async (imageUrl) => {
      const img = document.getElementById(`ingredient-image-${index}`);
      if (!img) return;
      let finalImage = imageUrl;
      if (!finalImage) {
        finalImage = await fetchIngredientImageUrl(name, 1);
      }
      img.src = finalImage || ingredientFallbackSvg(name);
      img.onerror = () => {
        img.src = ingredientFallbackSvg(name);
      };
    });
  });
}

function getYouTubeEmbedUrl(url) {
  try {
    const parsed = new URL(url);
    const cleanPath = parsed.pathname.replace(/^\/+|\/+$/g, "");

    if (parsed.hostname.includes("youtu.be")) {
      const id = cleanPath.split("/")[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }

    if (parsed.hostname.includes("youtube.com")) {
      const id = parsed.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;

      // Support Shorts links like: /shorts/<id>
      const parts = cleanPath.split("/");
      if (parts[0] === "shorts" && parts[1]) {
        return `https://www.youtube.com/embed/${parts[1]}`;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function renderPlayer(videoUrl) {
  videoContainer.innerHTML = "";
  const youtubeEmbed = getYouTubeEmbedUrl(videoUrl);

  if (youtubeEmbed) {
    const iframe = document.createElement("iframe");
    iframe.src = youtubeEmbed;
    iframe.title = "Video player";
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    videoContainer.appendChild(iframe);
    return;
  }

  const video = document.createElement("video");
  video.src = videoUrl;
  video.controls = true;
  video.playsInline = true;
  video.addEventListener("error", () => {
    statusEl.textContent =
      "This link cannot be played directly in the browser. For YouTube, use a standard watch/shorts/share URL.";
  });
  videoContainer.appendChild(video);
}

loadBtn.addEventListener("click", () => {
  const url = videoUrlInput.value.trim();
  if (!url) return;
  renderPlayer(url);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const videoUrl = videoUrlInput.value.trim();
  if (!videoUrl) return;

  renderPlayer(videoUrl);
  statusEl.innerHTML = `
    <span class="loading-inline">
      <span class="loading-emoji">🍴</span>
      <span class="loading-emoji delayed">🔪</span>
      <span>Analyzing video and extracting ingredients...</span>
    </span>
  `;
  analysisSummaryEl.innerHTML = "";
  instructionsSectionEl.innerHTML = "";
  ingredientGridEl.innerHTML = "";
  resultEl.textContent = "";

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }

    statusEl.textContent = "Analysis complete.";
    await renderStructuredResult(payload);
    resultEl.textContent = "";
  } catch (error) {
    statusEl.textContent = "Analysis failed.";
    analysisSummaryEl.innerHTML = "";
    instructionsSectionEl.innerHTML = "";
    ingredientGridEl.innerHTML = "";
    resultEl.textContent = error.message;
  }
});

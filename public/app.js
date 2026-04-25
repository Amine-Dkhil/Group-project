/* Let's Eat TikTok — client app (vanilla JS, hash routing) */

const STORAGE_DRAFT = "kitchenAtlasDraft";
const STORAGE_PLANNER = "kitchenAtlasMealPlan";

const $ = (sel, root = document) => root.querySelector(sel);

function showToast(message, isError) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", Boolean(isError));
  el.classList.add("show");
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => el.classList.remove("show"), 3200);
}

function parseHash() {
  const raw = (location.hash || "#/").replace(/^#/, "") || "/";
  const pathOnly = raw.split("?")[0] || "/";
  const parts = pathOnly.split("/").filter(Boolean);
  const name = parts[0] || "home";
  if (name === "recipe" && parts[1]) return { name: "recipe", id: decodeURIComponent(parts[1]) };
  if (name === "cook" && parts[1]) return { name: "cook", id: decodeURIComponent(parts[1]) };
  return { name };
}

function defaultDraft(overrides = {}) {
  const base = {
    title: "",
    description: "",
    cuisine: "",
    difficulty: "medium",
    prepTimeMinutes: 0,
    cookTimeMinutes: 0,
    totalTimeMinutes: 0,
    servings: 2,
    ingredients: [
      { name: "", amount: "", unit: "", gramsEstimate: "", optional: false, notes: "" }
    ],
    equipment: [""],
    steps: [
      {
        title: "",
        instruction: "",
        detail: "",
        tip: "",
        whyItMatters: "",
        estimatedMinutes: 0
      }
    ],
    tags: [],
    favorite: false,
    sourceType: "video_import",
    sourceUrl: "",
    foodContent: true,
    confidence: 0
  };
  return { ...base, ...overrides };
}

function loadDraft() {
  try {
    const raw = sessionStorage.getItem(STORAGE_DRAFT);
    if (!raw) return defaultDraft();
    const parsed = JSON.parse(raw);
    return defaultDraft(parsed);
  } catch {
    return defaultDraft();
  }
}

function saveDraftLocal(draft) {
  sessionStorage.setItem(STORAGE_DRAFT, JSON.stringify(draft));
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

function getTikTokInfo(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("tiktok.com")) return null;
    const cleanPath = parsed.pathname.replace(/^\/+|\/+$/g, "");
    const parts = cleanPath.split("/").filter(Boolean);
    const videoIdx = parts.indexOf("video");
    if (videoIdx >= 0 && parts[videoIdx + 1]) {
      return { kind: "long", videoId: parts[videoIdx + 1] };
    }
    return { kind: "short" };
  } catch {
    return null;
  }
}

function renderPlayer(container, videoUrl) {
  container.innerHTML = "";
  const ytEmbed = getYouTubeEmbedUrl(videoUrl);
  if (ytEmbed) {
    const iframe = document.createElement("iframe");
    iframe.src = ytEmbed;
    iframe.title = "Video preview";
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    container.appendChild(iframe);
    return;
  }
  const tt = getTikTokInfo(videoUrl);
  if (tt) {
    if (tt.kind === "long") {
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.tiktok.com/embed/v2/${tt.videoId}`;
      iframe.title = "TikTok video preview";
      iframe.allow = "encrypted-media; picture-in-picture; web-share";
      iframe.allowFullscreen = true;
      iframe.style.aspectRatio = "9 / 16";
      container.appendChild(iframe);
      return;
    }
    container.innerHTML = '<p class="placeholder">Resolving TikTok short link…</p>';
    fetch(`/api/resolve-tiktok?url=${encodeURIComponent(videoUrl)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.videoId) {
          container.innerHTML = "";
          const iframe = document.createElement("iframe");
          iframe.src = `https://www.tiktok.com/embed/v2/${data.videoId}`;
          iframe.title = "TikTok video preview";
          iframe.allow = "encrypted-media; picture-in-picture; web-share";
          iframe.allowFullscreen = true;
          iframe.style.aspectRatio = "9 / 16";
          container.appendChild(iframe);
        } else {
          container.innerHTML =
            '<p class="placeholder">Could not resolve this TikTok link to a preview, but analysis will still work. Click "Analyze video" to continue.</p>';
        }
      })
      .catch(() => {
        container.innerHTML =
          '<p class="placeholder">Could not resolve this TikTok link to a preview, but analysis will still work. Click "Analyze video" to continue.</p>';
      });
    return;
  }
  const video = document.createElement("video");
  video.src = videoUrl;
  video.controls = true;
  video.playsInline = true;
  video.addEventListener("error", () => {
    container.innerHTML =
      '<p class="placeholder">This link cannot be played inline. Try a TikTok, YouTube, or direct video URL.</p>';
  });
  container.appendChild(video);
}

async function apiJson(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Request failed.");
    err.status = res.status;
    throw err;
  }
  return data;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function renderHome(view) {
  let recipes = [];
  try {
    const data = await apiJson("/api/recipes?sort=newest");
    recipes = data.recipes || [];
  } catch {
    recipes = [];
  }

  const recent = recipes.slice(0, 6);
  const favorites = recipes.filter((r) => r.favorite).slice(0, 6);

  view.innerHTML = `
    <section class="hero">
      <h1>Cook with clarity</h1>
      <p>Paste a recipe video link. We will draft a structured recipe you can edit, save, and cook step by step.</p>
      <div class="import-row">
        <div class="field">
          <label for="homeVideoUrl">Recipe video link</label>
          <input id="homeVideoUrl" class="input" type="url" placeholder="https://www.tiktok.com/@user/video/... or YouTube link" />
        </div>
        <div style="align-self:end">
          <button class="btn btn-primary" type="button" id="homeGoImport">Import video</button>
        </div>
      </div>
    </section>

    <div class="section-head">
      <h2>Quick access</h2>
    </div>
    <div class="quick-cards">
      <a class="quick-card" href="#/library">
        <h3>Recipe library</h3>
        <p>Search, filter, and open saved recipes.</p>
        <span class="pill accent">Browse</span>
      </a>
      <a class="quick-card" href="#/grocery">
        <h3>Grocery lists</h3>
        <p>Merge ingredients from one or more recipes.</p>
        <span class="pill">Open</span>
      </a>
      <a class="quick-card" href="#/planner">
        <h3>Meal planner</h3>
        <p>Light weekly planning that stays out of your way.</p>
        <span class="pill">Plan</span>
      </a>
    </div>

    <div class="section-head">
      <h2>Favorites</h2>
      <a class="btn btn-ghost btn-small" href="#/library?favorite=1">View all</a>
    </div>
    ${
      favorites.length
        ? `<div class="grid">${favorites.map((r) => recipeCard(r)).join("")}</div>`
        : `<div class="ghost-hero"><h3>No favorites yet</h3><p>Save recipes you love from the detail page.</p></div>`
    }

    <div class="section-head">
      <h2>Recent recipes</h2>
      <a class="btn btn-ghost btn-small" href="#/library">Library</a>
    </div>
    ${
      recent.length
        ? `<div class="grid">${recent.map((r) => recipeCard(r)).join("")}</div>`
        : `<div class="ghost-hero"><h3>Your library is empty</h3><p>Import a video to create your first recipe draft.</p><a class="btn btn-primary" href="#/import" style="margin-top:0.75rem;display:inline-flex">Start import</a></div>`
    }
  `;

  $("#homeGoImport", view).addEventListener("click", () => {
    const val = $("#homeVideoUrl", view).value.trim();
    if (val) {
      sessionStorage.setItem("kitchenAtlasImportUrl", val);
    }
    location.hash = "#/import";
  });

  view.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-duplicate]");
    if (!btn) return;
    const id = btn.getAttribute("data-duplicate");
    if (!id) return;
    try {
      await apiJson(`/api/recipes/${encodeURIComponent(id)}/duplicate`, { method: "POST", body: "{}" });
      showToast("Duplicated.");
      location.hash = "#/library";
    } catch (e) {
      showToast(e.message || "Duplicate failed.", true);
    }
  });
}

function recipeCard(r) {
  const meta = [r.cuisine, r.difficulty, `${r.totalTimeMinutes || 0} min`]
    .filter(Boolean)
    .join(" · ");
  return `
    <article class="card">
      <h3>${esc(r.title || "Untitled recipe")}</h3>
      <p class="card-meta">${esc(meta || "No metadata yet")}</p>
      <div class="card-actions">
        <a class="btn btn-secondary btn-small" href="#/recipe/${encodeURIComponent(r.id)}">Open</a>
        <button class="btn btn-ghost btn-small" type="button" data-duplicate="${esc(r.id)}">Duplicate</button>
      </div>
    </article>
  `;
}

async function renderImport(view) {
  const preset = sessionStorage.getItem("kitchenAtlasImportUrl") || "";

  view.innerHTML = `
    <h1 class="page-title">Import from video</h1>
    <p class="page-sub">TikTok, YouTube, and direct video URLs are supported. Unsupported links show a clear message.</p>

    <div class="card-panel">
      <div class="import-row">
        <div class="field" style="flex:1">
          <label for="videoUrl">Video URL</label>
          <input id="videoUrl" class="input" type="url" placeholder="https://..." value="${esc(preset)}" />
        </div>
        <div style="align-self:end;display:flex;gap:0.5rem;flex-wrap:wrap">
          <button class="btn btn-secondary" type="button" id="loadPreview">Preview</button>
          <button class="btn btn-primary" type="button" id="runAnalyze">Analyze video</button>
        </div>
      </div>
      <div id="importStatus" class="status-chip" style="margin-top:0.85rem;display:none"></div>
    </div>

    <div class="video-shell" id="videoContainer">
      <p class="placeholder">Load a preview when you are ready.</p>
    </div>

    <div class="card-panel" style="margin-top:1rem">
      <h3>What happens next</h3>
      <p style="margin:0;color:var(--muted)">We extract frames and audio locally, ask Gemini for a structured recipe, then open an editor for you to refine before saving.</p>
    </div>
  `;

  const videoContainer = $("#videoContainer", view);
  const status = $("#importStatus", view);

  $("#loadPreview", view).addEventListener("click", () => {
    const url = $("#videoUrl", view).value.trim();
    if (!url) return;
    renderPlayer(videoContainer, url);
  });

  $("#runAnalyze", view).addEventListener("click", async () => {
    const videoUrl = $("#videoUrl", view).value.trim();
    if (!videoUrl) {
      showToast("Add a video URL first.", true);
      return;
    }
    renderPlayer(videoContainer, videoUrl);
    status.style.display = "flex";
    status.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>Analyzing video… this can take a minute.</span>`;
    try {
      const data = await apiJson("/api/import/analyze", {
        method: "POST",
        body: JSON.stringify({ videoUrl })
      });
      const draft = defaultDraft(data.recipeDraft || {});
      draft.sourceUrl = videoUrl;
      saveDraftLocal(draft);
      if (Array.isArray(data.warnings) && data.warnings.length) {
        showToast(data.warnings[0]);
      } else {
        showToast("Draft ready — review and save.");
      }
      location.hash = "#/draft";
    } catch (e) {
      status.style.display = "flex";
      status.innerHTML = `<span>${esc(e.message || "Analysis failed.")}</span>`;
      showToast(e.message || "Analysis failed.", true);
      const manual = defaultDraft({ sourceUrl: videoUrl, description: "Manual entry after import issue." });
      saveDraftLocal(manual);
      const row = document.createElement("div");
      row.className = "card-panel";
      row.style.marginTop = "1rem";
      row.innerHTML = `
        <h3>We could not fully analyze this link</h3>
        <p style="color:var(--muted);margin:0 0 0.75rem">You can still build the recipe manually in the editor.</p>
        <a class="btn btn-primary" href="#/draft">Open manual draft</a>
      `;
      view.appendChild(row);
    }
  });
}

function renderDraftEditor(view, draft) {
  const tags = (draft.tags || []).join(", ");
  const ingredients = draft.ingredients || [];
  const equipment = draft.equipment || [];
  const steps = draft.steps || [];

  view.innerHTML = `
    <h1 class="page-title">Review recipe draft</h1>
    <p class="page-sub">Tune ingredients and steps before saving to your library.</p>

    <div class="editor">
      <div class="card-panel">
        <h3>Overview</h3>
        <div class="editor-grid">
          <div class="field"><label for="f_title">Title</label><input id="f_title" class="input" value="${esc(draft.title)}" /></div>
          <div class="field"><label for="f_cuisine">Cuisine</label><input id="f_cuisine" class="input" value="${esc(draft.cuisine)}" /></div>
          <div class="field"><label for="f_difficulty">Difficulty</label>
            <select id="f_difficulty" class="select">
              ${["easy", "medium", "hard"]
                .map((d) => `<option value="${d}" ${draft.difficulty === d ? "selected" : ""}>${d}</option>`)
                .join("")}
            </select>
          </div>
          <div class="field"><label for="f_prep">Prep (minutes)</label><input id="f_prep" class="input" type="number" min="0" value="${Number(
            draft.prepTimeMinutes || 0
          )}" /></div>
          <div class="field"><label for="f_cook">Cook (minutes)</label><input id="f_cook" class="input" type="number" min="0" value="${Number(
            draft.cookTimeMinutes || 0
          )}" /></div>
          <div class="field"><label for="f_total">Total (minutes)</label><input id="f_total" class="input" type="number" min="0" value="${Number(
            draft.totalTimeMinutes || 0
          )}" /></div>
          <div class="field"><label for="f_servings">Servings</label><input id="f_servings" class="input" type="number" min="1" value="${Number(
            draft.servings || 2
          )}" /></div>
        </div>
        <div class="field" style="margin-top:0.75rem">
          <label for="f_desc">Description</label>
          <textarea id="f_desc" class="input" rows="4" style="resize:vertical">${esc(draft.description)}</textarea>
        </div>
        <div class="field" style="margin-top:0.75rem">
          <label for="f_tags">Tags (comma separated)</label>
          <input id="f_tags" class="input" value="${esc(tags)}" />
        </div>
        <div class="field" style="margin-top:0.75rem">
          <label for="f_source">Source URL</label>
          <input id="f_source" class="input" value="${esc(draft.sourceUrl)}" />
        </div>
      </div>

      <div class="card-panel">
        <h3>Ingredients</h3>
        <div id="ingRows">${ingredients.map((ing, i) => ingredientRow(ing, i)).join("")}</div>
        <button class="btn btn-secondary btn-small" type="button" id="addIng">Add ingredient</button>
      </div>

      <div class="card-panel">
        <h3>Equipment</h3>
        <div id="eqRows">${equipment.map((eq, i) => equipmentRow(eq, i)).join("")}</div>
        <button class="btn btn-secondary btn-small" type="button" id="addEq">Add item</button>
      </div>

      <div class="card-panel">
        <h3>Steps</h3>
        <div id="stepRows">${steps.map((s, i) => stepRow(s, i)).join("")}</div>
        <button class="btn btn-secondary btn-small" type="button" id="addStep">Add step</button>
      </div>

      <div class="draft-actions">
        <button class="btn btn-secondary" type="button" id="discardDraft">Discard draft</button>
        <button class="btn btn-primary" type="button" id="saveRecipe">Save to library</button>
      </div>
    </div>
  `;

  function readDraftFromDom() {
    const next = defaultDraft(draft);
    next.title = $("#f_title", view).value.trim();
    next.cuisine = $("#f_cuisine", view).value.trim();
    next.difficulty = $("#f_difficulty", view).value;
    next.prepTimeMinutes = Number($("#f_prep", view).value || 0);
    next.cookTimeMinutes = Number($("#f_cook", view).value || 0);
    next.totalTimeMinutes = Number($("#f_total", view).value || 0);
    next.servings = Math.max(1, Number($("#f_servings", view).value || 2));
    next.description = $("#f_desc", view).value;
    next.sourceUrl = $("#f_source", view).value.trim();
    next.tags = $("#f_tags", view)
      .value.split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    next.ingredients = $$("#ingRows .row-editor", view).map((row) => ({
      name: $("[data-k='name']", row).value.trim(),
      amount: $("[data-k='amount']", row).value.trim(),
      unit: $("[data-k='unit']", row).value.trim(),
      gramsEstimate: $("[data-k='grams']", row).value.trim(),
      optional: $("[data-k='opt']", row).checked,
      notes: $("[data-k='notes']", row).value.trim()
    }));

    next.equipment = $$("#eqRows .eq-row", view)
      .map((row) => $(".eq-input", row).value.trim())
      .filter(Boolean);

    next.steps = $$("#stepRows .step-editor", view).map((row) => ({
      title: $("[data-k='title']", row).value.trim(),
      instruction: $("[data-k='instruction']", row).value.trim(),
      detail: $("[data-k='detail']", row).value.trim(),
      tip: $("[data-k='tip']", row).value.trim(),
      whyItMatters: $("[data-k='why']", row).value.trim(),
      estimatedMinutes: Number($("[data-k='mins']", row).value || 0)
    }));

    return next;
  }

  function $$(sel, root) {
    return Array.from(root.querySelectorAll(sel));
  }

  $("#addIng", view).addEventListener("click", () => {
    const d = readDraftFromDom();
    d.ingredients.push({ name: "", amount: "", unit: "", gramsEstimate: "", optional: false, notes: "" });
    saveDraftLocal(d);
    renderDraftEditor(view, d);
  });
  $("#addEq", view).addEventListener("click", () => {
    const d = readDraftFromDom();
    d.equipment.push("");
    saveDraftLocal(d);
    renderDraftEditor(view, d);
  });
  $("#addStep", view).addEventListener("click", () => {
    const d = readDraftFromDom();
    d.steps.push({ title: "", instruction: "", detail: "", tip: "", whyItMatters: "", estimatedMinutes: 0 });
    saveDraftLocal(d);
    renderDraftEditor(view, d);
  });

  $("#discardDraft", view).addEventListener("click", () => {
    sessionStorage.removeItem(STORAGE_DRAFT);
    showToast("Draft discarded.");
    location.hash = "#/import";
  });

  $("#saveRecipe", view).addEventListener("click", async () => {
    const payload = readDraftFromDom();
    if (!payload.title.trim()) {
      showToast("Add a title before saving.", true);
      return;
    }
    try {
      await apiJson("/api/recipes", { method: "POST", body: JSON.stringify(payload) });
      sessionStorage.removeItem(STORAGE_DRAFT);
      showToast("Recipe saved.");
      location.hash = "#/library";
    } catch (e) {
      showToast(e.message || "Save failed.", true);
    }
  });

  view.addEventListener(
    "click",
    (ev) => {
      const t = ev.target;
      if (t && t.matches && t.matches("[data-remove-ing]")) {
        const idx = Number(t.getAttribute("data-remove-ing"));
        const d = readDraftFromDom();
        d.ingredients.splice(idx, 1);
        if (!d.ingredients.length) d.ingredients.push(defaultDraft().ingredients[0]);
        saveDraftLocal(d);
        renderDraftEditor(view, d);
      }
      if (t && t.matches && t.matches("[data-remove-eq]")) {
        const idx = Number(t.getAttribute("data-remove-eq"));
        const d = readDraftFromDom();
        d.equipment.splice(idx, 1);
        if (!d.equipment.length) d.equipment.push("");
        saveDraftLocal(d);
        renderDraftEditor(view, d);
      }
      if (t && t.matches && t.matches("[data-remove-step]")) {
        const idx = Number(t.getAttribute("data-remove-step"));
        const d = readDraftFromDom();
        d.steps.splice(idx, 1);
        if (!d.steps.length) d.steps.push(defaultDraft().steps[0]);
        saveDraftLocal(d);
        renderDraftEditor(view, d);
      }
    },
    { once: false }
  );
}

function ingredientRow(ing, index) {
  return `
    <div class="row-editor" data-ing="${index}">
      <div class="mini-grid">
        <div class="field"><label>Name</label><input class="input" data-k="name" value="${esc(ing.name)}" /></div>
        <div class="field"><label>Amount</label><input class="input" data-k="amount" value="${esc(ing.amount)}" /></div>
        <div class="field"><label>Unit</label><input class="input" data-k="unit" value="${esc(ing.unit)}" /></div>
        <div class="field"><label>Grams est.</label><input class="input" data-k="grams" value="${esc(ing.gramsEstimate)}" /></div>
      </div>
      <div class="mini-grid" style="margin-top:0.45rem">
        <div class="field"><label>Notes</label><input class="input" data-k="notes" value="${esc(ing.notes)}" /></div>
        <div class="field" style="align-self:end">
          <label><input type="checkbox" data-k="opt" ${ing.optional ? "checked" : ""} /> Optional</label>
        </div>
        <div class="field" style="align-self:end">
          <button class="btn btn-ghost btn-small" type="button" data-remove-ing="${index}">Remove</button>
        </div>
      </div>
    </div>
  `;
}

function equipmentRow(eq, index) {
  return `
    <div class="row-editor eq-row" data-eq="${index}">
      <input class="input eq-input" value="${esc(eq)}" />
      <button class="btn btn-ghost btn-small" type="button" data-remove-eq="${index}">Remove</button>
    </div>
  `;
}

function stepRow(s, index) {
  return `
    <div class="card-panel step-editor" data-step="${index}" style="margin-bottom:0.75rem">
      <div class="field"><label>Step title</label><input class="input" data-k="title" value="${esc(s.title)}" /></div>
      <div class="field"><label>Instruction</label><textarea class="input" rows="3" data-k="instruction" style="resize:vertical">${esc(
        s.instruction
      )}</textarea></div>
      <div class="field"><label>Detail</label><textarea class="input" rows="2" data-k="detail" style="resize:vertical">${esc(
        s.detail
      )}</textarea></div>
      <div class="editor-grid">
        <div class="field"><label>Tip</label><input class="input" data-k="tip" value="${esc(s.tip)}" /></div>
        <div class="field"><label>Why it matters</label><input class="input" data-k="why" value="${esc(s.whyItMatters)}" /></div>
        <div class="field"><label>Minutes</label><input class="input" type="number" min="0" data-k="mins" value="${Number(
          s.estimatedMinutes || 0
        )}" /></div>
      </div>
      <button class="btn btn-ghost btn-small" type="button" data-remove-step="${index}">Remove step</button>
    </div>
  `;
}

async function renderDraft(view) {
  const draft = loadDraft();
  renderDraftEditor(view, draft);
}

async function renderLibrary(view) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const search = params.get("search") || "";
  const favorite = params.get("favorite") || "";
  const sort = params.get("sort") || "newest";
  const cuisine = params.get("cuisine") || "";
  const difficulty = params.get("difficulty") || "";

  const qs = new URLSearchParams();
  if (search) qs.set("search", search);
  if (favorite) qs.set("favorite", favorite);
  if (sort) qs.set("sort", sort);
  if (cuisine) qs.set("cuisine", cuisine);
  if (difficulty) qs.set("difficulty", difficulty);

  let recipes = [];
  try {
    const data = await apiJson(`/api/recipes?${qs.toString()}`);
    recipes = data.recipes || [];
  } catch {
    recipes = [];
  }

  view.innerHTML = `
    <h1 class="page-title">Library</h1>
    <p class="page-sub">Search and filter saved recipes. Everything stays on this device in a local database.</p>
    <div class="toolbar">
      <input id="libSearch" class="input" placeholder="Search titles and descriptions" value="${esc(search)}" />
      <div class="filter-row">
        <select id="libSort" class="select">
          ${[
            ["newest", "Newest"],
            ["oldest", "Oldest"],
            ["easiest", "Easiest"],
            ["fastest", "Fastest"]
          ]
            .map(([v, l]) => `<option value="${v}" ${sort === v ? "selected" : ""}>${l}</option>`)
            .join("")}
        </select>
        <select id="libCuisine" class="select">
          <option value="">All cuisines</option>
          ${Array.from(new Set(recipes.map((r) => r.cuisine).filter(Boolean)))
            .slice(0, 30)
            .map((c) => `<option value="${esc(c)}" ${cuisine === c ? "selected" : ""}>${esc(c)}</option>`)
            .join("")}
        </select>
        <select id="libDiff" class="select">
          <option value="">All levels</option>
          ${["easy", "medium", "hard"]
            .map((d) => `<option value="${d}" ${difficulty === d ? "selected" : ""}>${d}</option>`)
            .join("")}
        </select>
        <label class="pill"><input type="checkbox" id="libFav" ${favorite ? "checked" : ""} /> Favorites</label>
      </div>
    </div>
    ${
      recipes.length
        ? `<div class="grid" id="libGrid">${recipes.map((r) => recipeCard(r)).join("")}</div>`
        : `<div class="ghost-hero"><h3>No recipes match</h3><p>Try clearing filters or import a new video.</p></div>`
    }
  `;

  function applyFilters() {
    const next = new URLSearchParams();
    const s = $("#libSearch", view).value.trim();
    if (s) next.set("search", s);
    if ($("#libFav", view).checked) next.set("favorite", "1");
    const c = $("#libCuisine", view).value;
    if (c) next.set("cuisine", c);
    const d = $("#libDiff", view).value;
    if (d) next.set("difficulty", d);
    next.set("sort", $("#libSort", view).value);
    location.hash = `#/library?${next.toString()}`;
  }

  $("#libSearch", view).addEventListener("change", applyFilters);
  $("#libSort", view).addEventListener("change", applyFilters);
  $("#libCuisine", view).addEventListener("change", applyFilters);
  $("#libDiff", view).addEventListener("change", applyFilters);
  $("#libFav", view).addEventListener("change", applyFilters);

  $("#libGrid", view)?.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-duplicate]");
    if (!btn) return;
    const id = btn.getAttribute("data-duplicate");
    try {
      await apiJson(`/api/recipes/${encodeURIComponent(id)}/duplicate`, { method: "POST", body: "{}" });
      showToast("Duplicated.");
      applyFilters();
    } catch (e) {
      showToast(e.message || "Duplicate failed.", true);
    }
  });
}

async function renderRecipe(view, id) {
  let recipe = null;
  try {
    const data = await apiJson(`/api/recipes/${encodeURIComponent(id)}`);
    recipe = data.recipe;
  } catch {
    recipe = null;
  }
  if (!recipe) {
    view.innerHTML = `<div class="ghost-hero"><h3>Recipe not found</h3><p>It may have been deleted.</p><a class="btn btn-primary" href="#/library">Back to library</a></div>`;
    return;
  }

  const tags = (recipe.tags || []).map((t) => `<span class="pill">${esc(t)}</span>`).join(" ");

  view.innerHTML = `
    <div class="detail-hero">
      <div>
        <h1>${esc(recipe.title)}</h1>
        <div class="detail-meta">
          <span class="pill accent">${esc(recipe.cuisine || "Any cuisine")}</span>
          <span class="pill">${esc(recipe.difficulty || "medium")}</span>
          <span class="pill">${recipe.totalTimeMinutes || 0} min</span>
          <span class="pill">${recipe.servings || 2} servings</span>
        </div>
        ${tags ? `<div style="margin-top:0.65rem;display:flex;flex-wrap:wrap;gap:0.4rem">${tags}</div>` : ""}
      </div>
    </div>

    <p style="color:var(--muted);max-width:72ch">${esc(recipe.description || "")}</p>

    <div style="display:flex;flex-wrap:wrap;gap:0.6rem;margin:1rem 0">
      <a class="btn btn-primary" href="#/cook/${encodeURIComponent(recipe.id)}">Start cooking</a>
      <button class="btn btn-secondary" type="button" id="favBtn">${recipe.favorite ? "Unfavorite" : "Favorite"}</button>
      <button class="btn btn-secondary" type="button" id="groceryBtn">Add to grocery list</button>
      <button class="btn btn-ghost" type="button" id="delBtn">Delete</button>
    </div>

    <div class="card-panel">
      <h3>Ingredients</h3>
      <ul class="list-check">
        ${(recipe.ingredients || [])
          .map(
            (i) => `
          <li>
            <input type="checkbox" />
            <div>
              <strong>${esc(i.name)}</strong>
              <div style="color:var(--muted);font-size:0.92rem">
                ${esc([i.amount, i.unit].filter(Boolean).join(" "))}
                ${i.gramsEstimate ? ` · ${esc(i.gramsEstimate)}` : ""}
                ${i.notes ? ` — ${esc(i.notes)}` : ""}
              </div>
            </div>
          </li>
        `
          )
          .join("")}
      </ul>
    </div>

    <div class="card-panel">
      <h3>Equipment</h3>
      <p style="margin:0;color:var(--muted)">${esc((recipe.equipment || []).join(", ") || "None listed")}</p>
    </div>

    <div class="card-panel">
      <h3>Steps preview</h3>
      <ol class="steps-preview">
        ${(recipe.steps || [])
          .map(
            (s) => `
          <li>
            <strong>${esc(s.title || "Step")}</strong>
            <div style="color:var(--muted);margin-top:0.25rem">${esc(s.instruction)}</div>
            ${
              s.whyItMatters
                ? `<div style="margin-top:0.45rem" class="pill">Why: ${esc(s.whyItMatters)}</div>`
                : ""
            }
          </li>
        `
          )
          .join("")}
      </ol>
    </div>
  `;

  $("#favBtn", view).addEventListener("click", async () => {
    try {
      const data = await apiJson(`/api/recipes/${encodeURIComponent(recipe.id)}/favorite`, {
        method: "POST",
        body: JSON.stringify({ favorite: !recipe.favorite })
      });
      recipe = data.recipe;
      showToast(recipe.favorite ? "Saved to favorites." : "Removed from favorites.");
      await renderRecipe(view, id);
    } catch (e) {
      showToast(e.message || "Could not update favorite.", true);
    }
  });

  $("#groceryBtn", view).addEventListener("click", async () => {
    try {
      const data = await apiJson("/api/grocery-lists/from-recipes", {
        method: "POST",
        body: JSON.stringify({ recipeIds: [recipe.id], name: `${recipe.title} groceries` })
      });
      showToast("Grocery list created.");
      sessionStorage.setItem("kitchenAtlasGroceryId", data.list.id);
      location.hash = "#/grocery";
    } catch (e) {
      showToast(e.message || "Could not create list.", true);
    }
  });

  $("#delBtn", view).addEventListener("click", async () => {
    if (!window.confirm("Delete this recipe permanently?")) return;
    try {
      await apiJson(`/api/recipes/${encodeURIComponent(recipe.id)}`, { method: "DELETE" });
      showToast("Recipe deleted.");
      location.hash = "#/library";
    } catch (e) {
      showToast(e.message || "Delete failed.", true);
    }
  });
}

async function renderGrocery(view) {
  let lists = [];
  try {
    const data = await apiJson("/api/grocery-lists");
    lists = data.lists || [];
  } catch {
    lists = [];
  }

  const activeId = sessionStorage.getItem("kitchenAtlasGroceryId") || (lists[0] && lists[0].id);
  let active = null;
  if (activeId) {
    try {
      const data = await apiJson(`/api/grocery-lists/${encodeURIComponent(activeId)}`);
      active = data.list;
    } catch {
      active = null;
    }
  }

  let recipes = [];
  try {
    const data = await apiJson("/api/recipes?sort=newest");
    recipes = data.recipes || [];
  } catch {
    recipes = [];
  }

  view.innerHTML = `
    <h1 class="page-title">Grocery</h1>
    <p class="page-sub">Create a merged list from saved recipes. Check items off as you shop.</p>

    <div class="card-panel">
      <h3>Generate from recipes</h3>
      <div class="field">
        <label for="gRecipes">Select recipes</label>
        <select id="gRecipes" class="select" multiple size="6" style="width:100%;min-height:140px">
          ${recipes.map((r) => `<option value="${esc(r.id)}">${esc(r.title)}</option>`).join("")}
        </select>
      </div>
      <div class="field" style="margin-top:0.65rem">
        <label for="gName">List name</label>
        <input id="gName" class="input" placeholder="Weekend shop" />
      </div>
      <button class="btn btn-primary" type="button" id="genList" style="margin-top:0.75rem">Create merged list</button>
    </div>

    <div class="section-head">
      <h2>Your lists</h2>
    </div>
    ${
      lists.length
        ? `<div class="toolbar" style="margin-bottom:0.75rem">
            <select id="listPick" class="select">
              ${lists.map((l) => `<option value="${esc(l.id)}" ${l.id === activeId ? "selected" : ""}>${esc(l.name || "List")}</option>`).join("")}
            </select>
          </div>`
        : `<div class="ghost-hero"><h3>No lists yet</h3><p>Generate one from recipes above.</p></div>`
    }

    <div class="grocery-list" id="groceryItems"></div>
  `;

  function renderItems(list) {
    const host = $("#groceryItems", view);
    if (!host) return;
    if (!list || !list.items || !list.items.length) {
      host.innerHTML = `<div class="ghost-hero"><h3>Empty list</h3><p>Add recipes and generate items.</p></div>`;
      return;
    }
    host.innerHTML = list.items
      .map(
        (it) => `
      <label class="grocery-item">
        <input type="checkbox" data-id="${esc(it.id)}" ${it.checked ? "checked" : ""} />
        <div>
          <strong>${esc(it.name)}</strong>
          <div style="color:var(--muted);font-size:0.92rem">
            ${esc([it.amount, it.unit].filter(Boolean).join(" "))}
            ${it.notes ? ` — ${esc(it.notes)}` : ""}
          </div>
        </div>
      </label>
    `
      )
      .join("");
  }

  renderItems(active);

  $("#genList", view)?.addEventListener("click", async () => {
    const selected = Array.from($("#gRecipes", view).selectedOptions || []).map((o) => o.value);
    if (!selected.length) {
      showToast("Select at least one recipe.", true);
      return;
    }
    const name = $("#gName", view).value.trim() || "Groceries";
    try {
      const data = await apiJson("/api/grocery-lists/from-recipes", {
        method: "POST",
        body: JSON.stringify({ recipeIds: selected, name })
      });
      sessionStorage.setItem("kitchenAtlasGroceryId", data.list.id);
      showToast("List created.");
      await renderGrocery(view);
    } catch (e) {
      showToast(e.message || "Could not create list.", true);
    }
  });

  $("#listPick", view)?.addEventListener("change", async () => {
    const id = $("#listPick", view).value;
    sessionStorage.setItem("kitchenAtlasGroceryId", id);
    try {
      const data = await apiJson(`/api/grocery-lists/${encodeURIComponent(id)}`);
      renderItems(data.list);
    } catch {
      renderItems(null);
    }
  });

  $("#groceryItems", view)?.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement) || t.type !== "checkbox") return;
    const itemId = t.getAttribute("data-id");
    const listId = $("#listPick", view)?.value || activeId;
    if (!listId || !itemId) return;
    let current = active;
    if (!current || current.id !== listId) {
      try {
        current = (await apiJson(`/api/grocery-lists/${encodeURIComponent(listId)}`)).list;
      } catch {
        showToast("Could not load list.", true);
        return;
      }
    }
    const nextItems = (current.items || []).map((it) =>
      it.id === itemId ? { ...it, checked: t.checked } : it
    );
    try {
      await apiJson(`/api/grocery-lists/${encodeURIComponent(listId)}`, {
        method: "PUT",
        body: JSON.stringify({ items: nextItems })
      });
    } catch {
      showToast("Could not update item.", true);
    }
  });
}

function weekDates(base = new Date()) {
  const start = new Date(base);
  const day = start.getDay();
  const diff = (day + 6) % 7;
  start.setDate(start.getDate() - diff);
  return Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

async function renderPlanner(view) {
  const days = weekDates();
  let entries = [];
  try {
    const data = await apiJson(`/api/meal-plan?startDate=${days[0]}&endDate=${days[6]}`);
    entries = data.entries || [];
  } catch {
    entries = [];
  }

  let recipes = [];
  try {
    const data = await apiJson("/api/recipes?sort=newest");
    recipes = data.recipes || [];
  } catch {
    recipes = [];
  }

  const byDate = new Map();
  entries.forEach((e) => {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  });

  view.innerHTML = `
    <h1 class="page-title">Planner</h1>
    <p class="page-sub">Assign recipes to evenings for the current week. Grocery generation arrives in one tap.</p>

    <div class="planner-grid">
      ${days
        .map((d) => {
          const label = new Date(d + "T12:00:00");
          const dayName = label.toLocaleDateString(undefined, { weekday: "short" });
          const list = byDate.get(d) || [];
          return `
          <div class="planner-day" data-date="${esc(d)}">
            <h4>${esc(dayName)} · ${esc(d.slice(5))}</h4>
            <div class="field">
              <label class="sr-only" for="pick-${esc(d)}">Recipe</label>
              <select id="pick-${esc(d)}" class="select" style="width:100%">
                <option value="">Dinner</option>
                ${recipes.map((r) => `<option value="${esc(r.id)}">${esc(r.title)}</option>`).join("")}
              </select>
            </div>
            <div style="margin-top:0.5rem;color:var(--muted);font-size:0.9rem">
              ${
                list.length
                  ? list.map((e) => `<div>• ${esc(recipes.find((x) => x.id === e.recipeId)?.title || "Recipe")}</div>`).join("")
                  : "No meals yet"
              }
            </div>
          </div>
        `;
        })
        .join("")}
    </div>

    <div class="card-panel" style="margin-top:1rem">
      <h3>Save week</h3>
      <p style="color:var(--muted);margin:0 0 0.75rem">This replaces planned entries for the visible week range.</p>
      <button class="btn btn-primary" type="button" id="savePlan">Save plan</button>
      <button class="btn btn-secondary" type="button" id="planGroceries" style="margin-left:0.5rem">Generate groceries</button>
    </div>
  `;

  days.forEach((d) => {
    const first = (byDate.get(d) || [])[0];
    const sel = $(`#pick-${d}`, view);
    if (sel && first) sel.value = first.recipeId;
  });

  $("#savePlan", view).addEventListener("click", async () => {
    const next = [];
    days.forEach((d) => {
      const rid = $(`#pick-${d}`, view).value;
      if (rid) {
        next.push({ date: d, mealSlot: "dinner", recipeId: rid });
      }
    });
    try {
      await apiJson("/api/meal-plan", {
        method: "PUT",
        body: JSON.stringify({ entries: next, startDate: days[0], endDate: days[6] })
      });
      showToast("Plan saved.");
      await renderPlanner(view);
    } catch (e) {
      showToast(e.message || "Save failed.", true);
    }
  });

  $("#planGroceries", view).addEventListener("click", async () => {
    const ids = Array.from(new Set(days.map((d) => $(`#pick-${d}`, view).value).filter(Boolean)));
    if (!ids.length) {
      showToast("Pick at least one dinner.", true);
      return;
    }
    try {
      const data = await apiJson("/api/grocery-lists/from-recipes", {
        method: "POST",
        body: JSON.stringify({ recipeIds: ids, name: "Week plan groceries" })
      });
      sessionStorage.setItem("kitchenAtlasGroceryId", data.list.id);
      showToast("Grocery list created.");
      location.hash = "#/grocery";
    } catch (e) {
      showToast(e.message || "Could not create list.", true);
    }
  });
}

function renderCook(view, id) {
  view.innerHTML = `<div class="ghost-hero"><h3>Guided cooking</h3><p>Coming in the next pass — timers, progress, and calm steps.</p><a class="btn btn-primary" href="#/recipe/${encodeURIComponent(id)}">Back to recipe</a></div>`;
}

async function route() {
  const view = $("#view");
  if (!view) return;
  const r = parseHash();
  if (r.name === "cook" && r.id) return renderCook(view, r.id);
  if (r.name === "import") return renderImport(view);
  if (r.name === "draft") return renderDraft(view);
  if (r.name === "library") return renderLibrary(view);
  if (r.name === "recipe" && r.id) return renderRecipe(view, r.id);
  if (r.name === "grocery") return renderGrocery(view);
  if (r.name === "planner") return renderPlanner(view);
  return renderHome(view);
}

document.addEventListener("DOMContentLoaded", () => {
  const toggle = $("#navToggle");
  const links = $("#navLinks");
  toggle?.addEventListener("click", () => links?.classList.toggle("is-open"));
  document.querySelectorAll("[data-nav]").forEach((a) => {
    a.addEventListener("click", () => links?.classList.remove("is-open"));
  });
  window.addEventListener("hashchange", route);
  route();
});

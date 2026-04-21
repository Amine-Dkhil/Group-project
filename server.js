require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const apiRouter = require("./src/routes/api");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

if (!process.env.GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY is missing in .env");
}

app.use("/api", apiRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

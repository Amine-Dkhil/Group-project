const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_PATH = path.join(DATA_DIR, "kitchen.db");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function migrate(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      cuisine TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT 'medium',
      prep_time_minutes INTEGER NOT NULL DEFAULT 0,
      cook_time_minutes INTEGER NOT NULL DEFAULT 0,
      total_time_minutes INTEGER NOT NULL DEFAULT 0,
      servings INTEGER NOT NULL DEFAULT 2,
      source_type TEXT NOT NULL DEFAULT 'video_import',
      source_url TEXT NOT NULL DEFAULT '',
      food_content INTEGER NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      favorite INTEGER NOT NULL DEFAULT 0,
      ingredients_json TEXT NOT NULL DEFAULT '[]',
      equipment_json TEXT NOT NULL DEFAULT '[]',
      steps_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recipes_favorite ON recipes(favorite);
    CREATE INDEX IF NOT EXISTS idx_recipes_created ON recipes(created_at);
    CREATE INDEX IF NOT EXISTS idx_recipes_cuisine ON recipes(cuisine);
    CREATE INDEX IF NOT EXISTS idx_recipes_difficulty ON recipes(difficulty);

    CREATE TABLE IF NOT EXISTS grocery_lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grocery_list_items (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      amount TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      checked INTEGER NOT NULL DEFAULT 0,
      recipe_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (list_id) REFERENCES grocery_lists(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_grocery_items_list ON grocery_list_items(list_id);

    CREATE TABLE IF NOT EXISTS meal_plan_entries (
      id TEXT PRIMARY KEY,
      date_str TEXT NOT NULL,
      meal_slot TEXT NOT NULL DEFAULT 'dinner',
      recipe_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_meal_plan_date ON meal_plan_entries(date_str);
  `);
}

let singleton;

function getDb() {
  if (!singleton) {
    ensureDataDir();
    singleton = new Database(DB_PATH);
    singleton.pragma("journal_mode = WAL");
    migrate(singleton);
  }
  return singleton;
}

module.exports = { getDb, DB_PATH };

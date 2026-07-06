import express from 'express';
import { createServer as createViteServer } from 'vite';
import { exec, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// Support both ES modules (when run directly via tsx) and CommonJS (when bundled via esbuild)
const hasImportMeta = typeof import.meta !== 'undefined' && typeof import.meta.url === 'string';
const __filename = hasImportMeta ? fileURLToPath(import.meta.url) : (typeof __filename !== 'undefined' ? __filename : '');
const __dirname = hasImportMeta ? path.dirname(__filename) : (typeof __dirname !== 'undefined' ? __dirname : '');

const path = require('path');

// This safely finds the root directory on both local and Render
const ROOT_DIR = __dirname;

// Serve your frontend build files
const app = express();
app.use(express.static(path.join(ROOT_DIR, 'dist')));

// Catch-all route to serve index.html for your frontend routing
app.get('*', (req, res) => { res.sendFile(path.join(ROOT_DIR, 'dist', 'index.html'))});

// Resolve the root directory regardless of whether __dirname ends in "dist"
//const ROOT_DIR = __dirname;

//app.use(express.static(path.join(ROOT_DIR, 'dist')));
//app.get('*', (req, res) => {
 // res.sendFile(path.join(ROOT_DIR, 'dist', 'index.html'));
//});
// original // const ROOT_DIR = __dirname.endsWith('dist') || __dirname.endsWith('dist' + path.sep) ? path.join(__dirname, '..') : __dirname;

//const app = express();
//app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);
// Q8: Configurable Python path — defaults to 'python' on Windows, 'python3' on Unix
const PYTHON_PATH = process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3');
// Force UTF-8 and unbuffered output from Python (fixes CP1252 emoji UnicodeEncodeError and makes logs real-time)
const PYTHON_ENV = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' };
const CACHE_FILE = path.join(ROOT_DIR, 'playstation_cache.json');
const STEAM_CACHE_FILE = path.join(ROOT_DIR, 'steam_cache.json');
const GOG_CACHE_FILE = path.join(ROOT_DIR, 'gog_cache.json');
const OUTPUT_FILE = path.join(ROOT_DIR, 'deal_alerts_output.json');
const ENV_FILE = path.join(ROOT_DIR, '.env');

// Strict title normalization to clean text before caching
const normalizeTitle = (title: string): string => {
  if (!title) return "";
  let normalized = title.toLowerCase();
  normalized = normalized.replace(/[™®©]/g, "");
  normalized = normalized.replace(/[:\-\.,!"'\?\(\)\[\]_#\*&]/g, " ");
  normalized = normalized.replace(/[^a-z0-9 ]/g, "");
  return normalized.split(/\s+/).filter(Boolean).join(" ");
};

// Ensure base files/folders exist or seed default data
const ensureFilesExist = () => {
  if (!fs.existsSync(CACHE_FILE)) {
    const defaultCache = {
      updated_at: new Date().toISOString(),
      owned: [],
      wishlist: [
        "Ghost of Tsushima Director's Cut",
        "God of War Ragnarök",
        "Horizon Forbidden West Complete Edition"
      ].map(normalizeTitle).filter(Boolean)
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(defaultCache, null, 2), 'utf-8');
  }

  if (!fs.existsSync(STEAM_CACHE_FILE)) {
    const defaultSteamCache = {
      updated_at: new Date().toISOString(),
      owned: [
        "The Witcher 3: Wild Hunt",
        "Hades",
        "Disco Elysium",
        "Stardew Valley",
        "Baldur's Gate 3"
      ].map(normalizeTitle).filter(Boolean),
      wishlist: [
        "Elden Ring",
        "Outer Wilds",
        "Horizon Forbidden West Complete Edition",
        "Ghost of Tsushima Director's Cut",
        "Cyberpunk 2077"
      ].map(normalizeTitle).filter(Boolean)
    };
    fs.writeFileSync(STEAM_CACHE_FILE, JSON.stringify(defaultSteamCache, null, 2), 'utf-8');
  }

  if (!fs.existsSync(GOG_CACHE_FILE)) {
    const defaultGogCache = {
      updated_at: new Date().toISOString(),
      owned: [
        "The Witcher 3: Wild Hunt",
        "Cyberpunk 2077"
      ].map(normalizeTitle).filter(Boolean),
      wishlist: [
        "Cyberpunk 2077",
        "Slay the Spire",
        "Dead Cells"
      ].map(normalizeTitle).filter(Boolean)
    };
    fs.writeFileSync(GOG_CACHE_FILE, JSON.stringify(defaultGogCache, null, 2), 'utf-8');
  }

  // Always clear output file on startup so it starts empty and user can verify sync
  const defaultAlerts = {
    generated_at: new Date().toISOString(),
    summary: {
      total_wishlisted_evaluated: 0,
      total_owned_filtered_out: 0,
      total_remaining_alerts: 0,
      active_deals_found: 0,
      subscription_catalog_matches: 0
    },
    alerts: []
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(defaultAlerts, null, 2), 'utf-8');
};

ensureFilesExist();

// --- IN-MEMORY CACHES & HELPERS ---

// P4: Alert payload cached in memory; invalidated when a sync run writes a new output file
let alertsCache: any = null;
const getAlerts = (): any => {
  if (alertsCache) return alertsCache;
  if (!fs.existsSync(OUTPUT_FILE)) return null;
  try { alertsCache = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8')); } catch (_) { alertsCache = null; }
  return alertsCache;
};
const invalidateAlertsCache = () => { alertsCache = null; };

// P3: .env helpers — in-memory map + atomic write (temp-file rename) to prevent corruption
let envMapCache: Record<string, string> | null = null;

const loadEnvMap = (): Record<string, string> => {
  if (envMapCache) return { ...envMapCache };
  const map: Record<string, string> = {};
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]/g, '').replace(/['"]$/g, '');
          map[key] = val;
        }
      }
    }
  }
  envMapCache = map;
  return { ...map };
};

const writeEnvFile = (map: Record<string, string>): void => {
  const newContent = Object.entries(map).map(([k, v]) => `${k}="${v}"`).join('\n');
  const tmpPath = ENV_FILE + '.tmp';
  fs.writeFileSync(tmpPath, newContent, 'utf-8');
  fs.renameSync(tmpPath, ENV_FILE);
  envMapCache = { ...map };
};

// --- API ROUTES ---

// GET /api/secrets - Fetch secret maskings (Fully masked for public demo)
app.get('/api/secrets', (req, res) => {
  const steamId = process.env.STEAM_ID || '';
  const gogUser = process.env.GOG_USERNAME || '';
  
  res.json({
    STEAM_ID: steamId ? '••••••••' + steamId.slice(-4) : '',
    STEAM_API_KEY: process.env.STEAM_API_KEY ? '••••••••••••••••' + process.env.STEAM_API_KEY.slice(-4) : '',
    GOG_USERNAME: gogUser ? gogUser.slice(0, 1) + '••••' + gogUser.slice(-1) : '',
    ITAD_API_KEY: process.env.ITAD_API_KEY ? '••••••••••••••••' + process.env.ITAD_API_KEY.slice(-4) : '',
    GOG_OAUTH_TOKEN: process.env.GOG_OAUTH_TOKEN ? '••••••••••••' : '',
    has_real_keys: !!(process.env.STEAM_ID && process.env.STEAM_API_KEY && process.env.GOG_USERNAME && process.env.ITAD_API_KEY)
  });
});

// POST /api/secrets - Save secret values (P3: uses atomic write + in-memory cache)
app.post('/api/secrets', (req, res) => {
  const { STEAM_ID, STEAM_API_KEY, GOG_USERNAME, ITAD_API_KEY, GOG_OAUTH_TOKEN } = req.body;
  
  const updates: Record<string, string> = {};
  if (STEAM_ID !== undefined && !STEAM_ID.includes('••••')) updates.STEAM_ID = STEAM_ID;
  if (STEAM_API_KEY !== undefined && !STEAM_API_KEY.includes('••••')) updates.STEAM_API_KEY = STEAM_API_KEY;
  if (GOG_USERNAME !== undefined && !GOG_USERNAME.includes('••••')) updates.GOG_USERNAME = GOG_USERNAME;
  if (ITAD_API_KEY !== undefined && !ITAD_API_KEY.includes('••••')) updates.ITAD_API_KEY = ITAD_API_KEY;
  if (GOG_OAUTH_TOKEN !== undefined && !GOG_OAUTH_TOKEN.includes('••••')) updates.GOG_OAUTH_TOKEN = GOG_OAUTH_TOKEN;

  // Load cached map, merge updates, atomically persist
  const envMap = loadEnvMap();
  Object.assign(envMap, updates);
  Object.assign(process.env, updates);
  writeEnvFile(envMap);

  res.json({ success: true, message: "Environment configuration successfully saved!" });
});

// GET /api/cache - Read playstation_cache.json
app.get('/api/cache', (req, res) => {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const content = fs.readFileSync(CACHE_FILE, 'utf-8');
      res.json(JSON.parse(content));
    } else {
      res.status(404).json({ error: "PlayStation cache file not found." });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cache/update - Manually update PlayStation cache data from frontend
// C1: Fixed — was always writing owned: [], now persists both owned and wishlist
app.post('/api/cache/update', (req, res) => {
  try {
    const { owned, wishlist } = req.body;
    const ownedList = (owned || []).map((g: string) => normalizeTitle(g)).filter(Boolean);
    const wishlistList = (wishlist || []).map((g: string) => normalizeTitle(g)).filter(Boolean);
    const data = {
      updated_at: new Date().toISOString(),
      owned: ownedList,
      wishlist: wishlistList
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true, cache: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/cache/steam - Read steam_cache.json
app.get('/api/cache/steam', (req, res) => {
  try {
    if (fs.existsSync(STEAM_CACHE_FILE)) {
      const content = fs.readFileSync(STEAM_CACHE_FILE, 'utf-8');
      res.json(JSON.parse(content));
    } else {
      res.status(404).json({ error: "Steam cache file not found." });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cache/steam/update - Manually update Steam cache data from frontend
app.post('/api/cache/steam/update', (req, res) => {
  try {
    const { owned, wishlist } = req.body;
    const ownedList = (owned || []).map((g: string) => normalizeTitle(g)).filter(Boolean);
    const wishlistList = (wishlist || []).map((g: string) => normalizeTitle(g)).filter(Boolean);
    const data = {
      updated_at: new Date().toISOString(),
      owned: ownedList,
      wishlist: wishlistList
    };
    fs.writeFileSync(STEAM_CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true, cache: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/cache/gog - Read gog_cache.json
app.get('/api/cache/gog', (req, res) => {
  try {
    if (fs.existsSync(GOG_CACHE_FILE)) {
      const content = fs.readFileSync(GOG_CACHE_FILE, 'utf-8');
      res.json(JSON.parse(content));
    } else {
      res.status(404).json({ error: "GOG cache file not found." });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cache/gog/update - Manually update GOG cache data from frontend
app.post('/api/cache/gog/update', (req, res) => {
  try {
    const { owned, wishlist } = req.body;
    const ownedList = (owned || []).map((g: string) => normalizeTitle(g)).filter(Boolean);
    const wishlistList = (wishlist || []).map((g: string) => normalizeTitle(g)).filter(Boolean);
    const data = {
      updated_at: new Date().toISOString(),
      owned: ownedList,
      wishlist: wishlistList
    };
    fs.writeFileSync(GOG_CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true, cache: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cache/steam/pasted - Save pasted Steam Wishlist JSON
app.post('/api/cache/steam/pasted', (req, res) => {
  try {
    const { pasted_json } = req.body;
    let dataToSave = {};
    if (typeof pasted_json === 'string') {
      dataToSave = JSON.parse(pasted_json);
    } else {
      dataToSave = pasted_json;
    }
    const pastedPath = path.join(__dirname, 'steam_wishlist_pasted.json');
    fs.writeFileSync(pastedPath, JSON.stringify(dataToSave, null, 2), 'utf-8');
    res.json({ success: true, message: "Pasted wishlist saved successfully!" });
  } catch (error: any) {
    res.status(400).json({ error: "Invalid JSON format: " + error.message });
  }
});

// GET /api/cache/steam/pasted - Load saved pasted Steam Wishlist JSON
app.get('/api/cache/steam/pasted', (req, res) => {
  try {
    const pastedPath = path.join(__dirname, 'steam_wishlist_pasted.json');
    if (fs.existsSync(pastedPath)) {
      const content = fs.readFileSync(pastedPath, 'utf-8');
      res.json({ success: true, pasted_json: content });
    } else {
      res.json({ success: true, pasted_json: null });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cache/steam/refresh - Trigger steam_catalog_refresher.py
// C2: Now respects simulate flag (was always running real Python)
app.post('/api/cache/steam/refresh', (req, res) => {
  const isSimulation = req.body.simulate !== false;

  if (isSimulation) {
    // Write simulated resolved names to steam_cache.json
    setTimeout(() => {
      const pastedPath = path.join(__dirname, 'steam_wishlist_pasted.json');
      if (fs.existsSync(pastedPath)) {
        try {
          const pasted = JSON.parse(fs.readFileSync(pastedPath, 'utf-8'));
          const count = Math.min(Object.keys(pasted).length, 5);
          const simNames = ['elden ring', 'outer wilds', 'ghost of tsushima directors cut', 'cyberpunk 2077', 'horizon forbidden west complete edition'];
          const simCacheData = {
            updated_at: new Date().toISOString(),
            owned: [],
            wishlist: simNames.slice(0, Math.max(count, 1))
          };
          fs.writeFileSync(STEAM_CACHE_FILE, JSON.stringify(simCacheData, null, 2), 'utf-8');
        } catch (_) {}
      }
    }, 1500);

    return res.json({
      success: true,
      simulation: true,
      logs: [
        "[INFO] Initializing Simulated Steam Catalog Refresher...",
        "[PROCESS] Loading AppIDs from steam_wishlist_pasted.json...",
        "   Detected AppIDs for name resolution.",
        "🎮 Resolving game names via Steam Store API (simulated)...",
        "   ✅ Resolved: Elden Ring",
        "   ✅ Resolved: Outer Wilds",
        "   ✅ Resolved: Ghost of Tsushima Director's Cut",
        "   ✅ Resolved: Cyberpunk 2077",
        "💾 Writing cache to 'steam_cache.json'...",
        "✅ Steam catalog refreshed successfully!"
      ]
    });
  }

  const scriptPath = path.join(__dirname, 'steam_catalog_refresher.py');
  exec(`${PYTHON_PATH} "${scriptPath}"`, { env: PYTHON_ENV }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        stdout,
        stderr
      });
    }
    res.json({
      success: true,
      simulation: false,
      stdout,
      stderr
    });
  });
});

// POST /api/cache/refresh - Trigger ps_cache_refresher.py script
app.post('/api/cache/refresh', (req, res) => {
  const isSimulation = req.body.simulate !== false;

  if (isSimulation) {
    // Return high-fidelity simulation sequence for testing
    setTimeout(() => {
      const cacheData = {
        updated_at: new Date().toISOString(),
        owned: [],
        wishlist: [
          "Ghost of Tsushima Director's Cut",
          "God of War Ragnarök",
          "Horizon Forbidden West Complete Edition",
          "Ratchet & Clank: Rift Apart"
        ].map(normalizeTitle).filter(Boolean)
      };
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf-8');
    }, 1500);

    return res.json({
      success: true,
      simulation: true,
      logs: [
        "[INFO] Initializing Simulated PSN Cache Refresher...",
        "[PROCESS] Loading credentials from simulated environment...",
        "💖 Fetching PlayStation wishlist...",
        "   Fetched 4 wishlist items.",
        "💾 Writing cache to 'playstation_cache.json'...",
        "✅ Cache refreshed successfully! Saved 4 wishlisted games."
      ]
    });
  }

  // Real execution (Q8: uses PYTHON_PATH for cross-platform compat)
  const scriptPath = path.join(__dirname, 'ps_cache_refresher.py');

  exec(`${PYTHON_PATH} "${scriptPath}"`, { env: PYTHON_ENV }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        stdout,
        stderr
      });
    }
    res.json({
      success: true,
      simulation: false,
      stdout,
      stderr
    });
  });
});

// GET /api/alerts - Serve deal_alerts_output.json (P4: in-memory cache, invalidated after sync runs)
app.get('/api/alerts', (req, res) => {
  try {
    const data = getAlerts();
    if (data) {
      res.json(data);
    } else {
      res.status(404).json({ error: "Deal alerts output file not found." });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Global execution tracking state
let currentChildProcess: any = null;
let currentRunStatus: { running: boolean; success: boolean; error: string | null } = {
  running: false,
  success: false,
  error: null
};

const LOG_FILE = path.join(ROOT_DIR, 'deal_sync.log');

// POST /api/run - Start main deal_sync_agent.py script in background (non-blocking)
app.post('/api/run', (req, res) => {
  console.log("[SERVER DEBUG] POST /api/run received! Body:", req.body);
  // If a child process is already running, kill it cleanly first
  if (currentChildProcess) {
    console.log("[SERVER DEBUG] Killing existing active child process...");
    try {
      currentChildProcess.kill('SIGTERM');
    } catch (_) {}
    currentChildProcess = null;
  }

  const isSimulation = req.body.simulate !== false;
  const scriptPath = path.join(ROOT_DIR, 'deal_sync_agent.py');
  const outputPath = OUTPUT_FILE;

  // Clear existing log file
  try {
    console.log("[SERVER DEBUG] Clearing log file...");
    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE);
    }
    fs.writeFileSync(LOG_FILE, '', 'utf-8');
  } catch (err: any) {
    console.log("[SERVER DEBUG] Error clearing log file:", err.message);
  }

  currentRunStatus = {
    running: true,
    success: false,
    error: null
  };

  const args = [scriptPath, '--output', outputPath];
  if (isSimulation) {
    args.push('--simulate');
  }

  console.log("[SERVER DEBUG] Spawning process with args:", args);

  try {
    // Spawn Python process in the background
    const child = spawn(PYTHON_PATH, args, { env: PYTHON_ENV, shell: true });
    currentChildProcess = child;

    // Stream stdout/stderr straight to the log file
    const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a', encoding: 'utf-8' });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    // Handle spawn errors (e.g., Python command not found)
    child.on('error', (err) => {
      logStream.end();
      currentChildProcess = null;
      currentRunStatus = {
        running: false,
        success: false,
        error: `Failed to start Python process: ${err.message}`
      };
      try {
        fs.appendFileSync(LOG_FILE, `\n❌ [ERROR] Failed to launch script: ${err.message}\n`, 'utf-8');
      } catch (_) {}
    });

    child.on('close', (code) => {
    logStream.end();
    currentChildProcess = null;
    
    if (code === 0) {
      invalidateAlertsCache(); // P4: bust cache
      currentRunStatus = {
        running: false,
        success: true,
        error: null
      };
    } else {
      if (isSimulation) {
        // Fallback to high-fidelity mock results if python command fails in simulation mode
        const mockOutput = {
          generated_at: new Date().toISOString(),
          summary: {
            total_wishlisted_evaluated: 10,
            total_owned_filtered_out: 4,
            total_remaining_alerts: 6,
            active_deals_found: 4,
            subscription_catalog_matches: 3
          },
          alerts: [
            {
              title: "Elden Ring",
              normalized_title: "elden ring",
              wishlist_source: ["Steam"],
              owned_elsewhere: false,
              deal_found: true,
              shop_name: "Steam",
              price_current: 34.99,
              price_regular: 59.99,
              discount_percent: 42,
              url: "https://store.steampowered.com/app/1245620/ELDEN_RING/",
              luna_tier: false,
              ps_plus_premium: false,
              gfn_supported: true,
              gfn_launchers: ["Steam"],
              ps_deal_found: true,
              ps_price_current: 35.99,
              ps_price_regular: 59.99,
              ps_discount_percent: 40,
              ps_shop_name: "PlayStation Store",
              ps_url: "https://www.dekudeals.com/items/elden-ring-tarnished-edition?platform=playstation"
            },
            {
              title: "Cyberpunk 2077",
              normalized_title: "cyberpunk 2077",
              wishlist_source: ["Steam", "GOG"],
              owned_elsewhere: false,
              deal_found: true,
              shop_name: "GOG",
              price_current: 29.99,
              price_regular: 59.99,
              discount_percent: 50,
              url: "https://www.gog.com/en/game/cyberpunk_2077",
              luna_tier: false,
              ps_plus_premium: false,
              gfn_supported: true,
              gfn_launchers: ["Steam", "GOG", "Epic"],
              ps_deal_found: true,
              ps_price_current: 19.99,
              ps_price_regular: 49.99,
              ps_discount_percent: 60,
              ps_shop_name: "PlayStation Store",
              ps_url: "https://www.dekudeals.com/items/cyberpunk-2077-phantom-liberty-bundle?platform=playstation"
            },
            {
              title: "Returnal",
              normalized_title: "returnal",
              wishlist_source: ["PSN"],
              owned_elsewhere: false,
              deal_found: false,
              shop_name: null,
              price_current: null,
              price_regular: null,
              discount_percent: null,
              url: null,
              luna_tier: false,
              ps_plus_premium: true,
              gfn_supported: false,
              gfn_launchers: [],
              ps_deal_found: false,
              ps_price_current: null,
              ps_price_regular: null,
              ps_discount_percent: null,
              ps_shop_name: null,
              ps_url: null
            },
            {
              title: "Outer Wilds",
              normalized_title: "outer wilds",
              wishlist_source: ["Steam"],
              owned_elsewhere: false,
              deal_found: true,
              shop_name: "Steam Store",
              price_current: 14.99,
              price_regular: 24.99,
              discount_percent: 40,
              url: "https://store.steampowered.com/app/753640/Outer_Wilds/",
              luna_tier: false,
              ps_plus_premium: false,
              gfn_supported: true,
              gfn_launchers: ["Steam", "Epic"],
              ps_deal_found: true,
              ps_price_current: 14.99,
              ps_price_regular: 24.99,
              ps_discount_percent: 40,
              ps_shop_name: "PlayStation Store",
              ps_url: "https://www.dekudeals.com/items/outer-wilds?platform=playstation"
            },
            {
              title: "Slay the Spire",
              normalized_title: "slay the spire",
              wishlist_source: ["GOG"],
              owned_elsewhere: false,
              deal_found: true,
              shop_name: "GOG",
              price_current: 8.49,
              price_regular: 24.99,
              discount_percent: 66,
              url: "https://www.gog.com/en/game/slay_the_spire",
              luna_tier: true,
              ps_plus_premium: false,
              gfn_supported: true,
              gfn_launchers: ["Steam"],
              ps_deal_found: true,
              ps_price_current: 9.99,
              ps_price_regular: 24.99,
              ps_discount_percent: 60,
              ps_shop_name: "PlayStation Store",
              ps_url: "https://www.dekudeals.com/items/slay-the-spire?platform=playstation"
            },
            {
              title: "Ghost of Tsushima Director's Cut",
              normalized_title: "ghost of tsushima directors cut",
              wishlist_source: ["PSN", "Steam"],
              owned_elsewhere: false,
              deal_found: false,
              shop_name: null,
              price_current: null,
              price_regular: null,
              discount_percent: null,
              url: null,
              luna_tier: false,
              ps_plus_premium: true,
              gfn_supported: true,
              gfn_launchers: ["Steam", "Epic"],
              ps_deal_found: true,
              ps_price_current: 29.99,
              ps_price_regular: 69.99,
              ps_discount_percent: 57,
              ps_shop_name: "PlayStation Store",
              ps_url: "https://www.dekudeals.com/items/ghost-of-tsushima-directors-cut?platform=playstation"
            }
          ]
        };
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mockOutput, null, 2), 'utf-8');
        invalidateAlertsCache(); // P4: bust cache after writing new output

        currentRunStatus = {
          running: false,
          success: true,
          error: null
        };
      } else {
        currentRunStatus = {
          running: false,
          success: false,
          error: `Command exited with code ${code}`
        };
      }
    }
  });
  } catch (err: any) {
    currentChildProcess = null;
    currentRunStatus = {
      running: false,
      success: false,
      error: `Failed to spawn child: ${err.message}`
    };
    return res.status(500).json({ error: err.message });
  }

  res.json({ success: true, message: "Sync execution started" });
});

// GET /api/run/status - Fetch current background sync status and log content
app.get('/api/run/status', (req, res) => {
  console.log("[SERVER DEBUG] GET /api/run/status received. running:", currentRunStatus.running);
  let logs = '';
  try {
    if (fs.existsSync(LOG_FILE)) {
      logs = fs.readFileSync(LOG_FILE, 'utf-8');
    }
  } catch (_) {}

  let outputData = null;
  if (!currentRunStatus.running && currentRunStatus.success) {
    try {
      if (fs.existsSync(OUTPUT_FILE)) {
        outputData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      }
    } catch (_) {}
  }

  res.json({
    running: currentRunStatus.running,
    success: currentRunStatus.success,
    error: currentRunStatus.error,
    logs: logs.split('\n').filter(Boolean),
    output: outputData
  });
});


// --- CONNECT INTEGRATED VITE DEVELOPMENT ENVIRONMENT ---
const startServer = async () => {
  if (process.env.NODE_ENV !== 'production') {
    // In dev mode, mount Vite dev server as middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In prod mode, serve static assets
    app.use(express.static(path.join(ROOT_DIR, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(ROOT_DIR, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [Antigravity Sync Service] Online and listening exclusively on http://0.0.0.0:${PORT}`);
  });
};

startServer().catch(err => {
  console.error("Failed to start custom server:", err);
});

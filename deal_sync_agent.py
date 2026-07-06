#!/usr/bin/env python3
"""
Antigravity Game Wishlist Deal Sync Agent (DEAL_SYNC_AGENT_V2.PY)

This script:
1. Gathers game wishlists from Steam, GOG, and PlayStation (via local cache).
2. Gathers owned games from Steam, GOG, and PlayStation (via local cache).
3. Normalizes all titles to perform an accurate cross-reference.
4. Filters out any wishlisted game that is already owned.
5. Performs pricing checks using IsThereAnyDeal (ITAD) API v2.
6. Checks if titles are in the PS Plus Premium catalog.
7. Checks if titles are supported on Nvidia GeForce NOW (GFN), matching the correct launcher.
8. Outputs a structured, Pydantic-validated JSON alert payload.
"""

import os
import sys
import re
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import argparse
from typing import List, Dict, Set, Optional
import requests
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

# Define global HTTP/HTTPS proxy configuration for Steam scraper requests
# Set values here if your local/server IP is rate-limited or banned.
# Example: STEAM_PROXIES = {"http": "http://username:password@proxy:port", "https": "http://username:password@proxy:port"}
STEAM_PROXIES = {
    "http": None,
    "https": None
}

# Define Pydantic models for data validation
class DealInfo(BaseModel):
    title: str
    normalized_title: str
    wishlist_source: List[str]
    owned_elsewhere: bool = False
    deal_found: bool = False
    shop_name: Optional[str] = None
    price_current: Optional[float] = None
    price_regular: Optional[float] = None
    discount_percent: Optional[int] = None
    url: Optional[str] = None
    luna_tier: bool = False
    ps_plus_premium: bool = False
    gfn_supported: bool = False
    gfn_launchers: List[str] = Field(default_factory=list)
    # PlayStation specific Deku Deals fields
    ps_deal_found: bool = False
    ps_price_current: Optional[float] = None
    ps_price_regular: Optional[float] = None
    ps_discount_percent: Optional[int] = None
    ps_shop_name: Optional[str] = None
    ps_url: Optional[str] = None

class DealAlertPayload(BaseModel):
    generated_at: str
    summary: Dict[str, int]
    alerts: List[DealInfo]

# --- PHASE 2: STRING NORMALIZATION ---
def normalize_title(title: str) -> str:
    """
    Strict text-cleaning function to normalize game titles before comparison.
    Converts to lowercase, strips trailing whitespaces, removes trademark/registration
    symbols (™, ®), colons, punctuation, and multiple spaces.
    """
    if not title:
        return ""
    # Convert to lowercase
    normalized = title.lower()
    # Remove trademark and registration symbols
    normalized = normalized.replace("™", "").replace("®", "").replace("©", "")
    # Replace colons, hyphens, and other punctuation with space to prevent blending words
    normalized = re.sub(r'[:\-\.,!"\'\?\(\)\[\]_#\*&]', ' ', normalized)
    # Strip non-alphanumeric (except spaces)
    normalized = re.sub(r'[^a-z0-9 ]', '', normalized)
    # Strip outer whitespace and reduce multiple spaces to a single space
    normalized = " ".join(normalized.split())
    return normalized

# --- PHASE 1: DATA GATHERING & AUTHENTICATION ---
def resolve_steam_vanity_url(vanity_url_name: str, steam_api_key: str) -> Optional[str]:
    """
    Resolves a custom Steam profile URL name (vanity URL) to a 64-bit numeric Steam ID.
    Endpoint: http://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/
    """
    if not vanity_url_name or not steam_api_key or steam_api_key == "MOCK_STEAM_KEY":
        return None
        
    print(f"[PROCESS] Resolving Steam custom URL '{vanity_url_name}' to 64-bit numeric ID...")
    url = "http://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/"
    params = {
        "key": steam_api_key,
        "vanityurl": vanity_url_name
    }
    try:
        response = requests.get(url, params=params, timeout=10)
        if response.status_code == 200:
            data = response.json()
            success = data.get("response", {}).get("success")
            if success == 1:
                resolved_id = data.get("response", {}).get("steamid")
                print(f"   ✅ Successfully resolved '{vanity_url_name}' to Steam ID: {resolved_id}")
                return resolved_id
            else:
                message = data.get("response", {}).get("message", "unknown reason")
                print(f"   ⚠️ Could not resolve custom URL '{vanity_url_name}': {message}")
        else:
            print(f"   ⚠️ Steam ResolveVanityURL API returned status code {response.status_code}")
    except Exception as e:
        print(f"   ⚠️ Failed to resolve Steam custom URL: {e}")
    return None

def save_steam_cache(owned=None, wishlist=None):
    cache_path = "steam_cache.json"
    data = {"updated_at": datetime.now().isoformat(), "owned": [], "wishlist": []}
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
    if owned is not None:
        data["owned"] = sorted(list(set(normalize_title(g) for g in owned if g)))
    if wishlist is not None:
        data["wishlist"] = sorted(list(set(normalize_title(g) for g in wishlist if g)))
    data["updated_at"] = datetime.now().isoformat()
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"   [DEBUG] Failed to write steam_cache.json: {e}")

def load_steam_cache_wishlist() -> List[Dict]:
    cache_path = "steam_cache.json"
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            wishlist = data.get("wishlist", [])
            print(f"   ℹ️ Loaded {len(wishlist)} Steam wishlist items from local cache.")
            return [{"id": f"cached_{idx}", "name": normalize_title(name), "platform": "Steam"} for idx, name in enumerate(wishlist) if name]
        except Exception as e:
            print(f"   ⚠️ Failed to load Steam wishlist cache: {e}")
    return []

def load_steam_cache_owned() -> List[str]:
    cache_path = "steam_cache.json"
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            owned = data.get("owned", [])
            print(f"   ℹ️ Loaded {len(owned)} Steam owned games from local cache.")
            return [normalize_title(g) for g in owned if g]
        except Exception as e:
            print(f"   ⚠️ Failed to load Steam owned cache: {e}")
    return []

# Steam Wishlist Scraping code has been removed.
# Steam wishlists are now loaded from the locally refreshed and parsed Steam Catalog.

def fetch_steam_owned(steam_api_key: str, steam_id: str) -> List[str]:
    """
    GET Steam Owned games.
    Endpoint: http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/
    Requires numeric SteamID64.
    """
    print(f"[PROCESS] Fetching Steam Owned Games for Steam ID: {steam_id}")
    url = "http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/"
    params = {
        "key": steam_api_key,
        "steamid": steam_id,
        "format": "json",
        "include_appinfo": 1 # Required to get game names (Steam API expects integer 1, not string 'true')
    }
    try:
        response = requests.get(url, params=params, timeout=15)
        print(f"   [DEBUG] Steam GetOwnedGames HTTP status: {response.status_code}")
        
        if response.status_code == 401 or response.status_code == 403:
            print("   ⚠️ [ERROR] Steam Web API returned 401/403. Check that your STEAM_API_KEY is correct and active.")
            print("      👉 Attempting to load Steam owned games from local cache instead...")
            return load_steam_cache_owned()
            
        response.raise_for_status()
        data = response.json()
        
        owned_games = []
        games_list = data.get("response", {}).get("games", [])
        if not games_list:
            print("   ⚠️ [WARN] Steam Web API returned 0 owned games. This almost always means either:")
            print("      1. Your Steam 'Game Details' privacy setting is set to 'Private' or 'Friends Only' (which hides your library).")
            print("         👉 Go to Steam -> Edit Profile -> Privacy Settings and set **Game Details** to **Public**.")
            print("      2. Your Steam ID or custom vanity username in secrets is incorrect or mismatched.")
            print("      👉 You can also use the 'Local Database Cache' tab in the app UI to manually import or edit your owned games list.")
        for game in games_list:
            if "name" in game:
                owned_games.append(game["name"])
        print(f"   ✅ Successfully fetched {len(owned_games)} Steam owned games.")
        
        # Save to cache on success
        if owned_games:
            save_steam_cache(owned=owned_games)
            
        return owned_games
    except Exception as e:
        print(f"[WARN] Failed to fetch Steam Owned games: {e}. Attempting cache fallback...")
        return load_steam_cache_owned()

def save_gog_cache(owned=None, wishlist=None):
    cache_path = "gog_cache.json"
    data = {"updated_at": datetime.now().isoformat(), "owned": [], "wishlist": []}
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
    if owned is not None:
        data["owned"] = sorted(list(set(normalize_title(g) for g in owned if g)))
    if wishlist is not None:
        data["wishlist"] = sorted(list(set(normalize_title(g) for g in wishlist if g)))
    data["updated_at"] = datetime.now().isoformat()
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"   [DEBUG] Failed to write gog_cache.json: {e}")

def load_gog_cache_wishlist() -> List[str]:
    cache_path = "gog_cache.json"
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            wishlist = data.get("wishlist", [])
            print(f"   ℹ️ Loaded {len(wishlist)} GOG wishlist items from local cache.")
            return [normalize_title(g) for g in wishlist if g]
        except Exception as e:
            print(f"   ⚠️ Failed to load GOG wishlist cache: {e}")
    return []

def load_gog_cache_owned() -> List[str]:
    cache_path = "gog_cache.json"
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            owned = data.get("owned", [])
            print(f"   ℹ️ Loaded {len(owned)} GOG owned games from local cache.")
            return [normalize_title(g) for g in owned if g]
        except Exception as e:
            print(f"   ⚠️ Failed to load GOG owned cache: {e}")
    return []

def fetch_gog_wishlist(username: str) -> List[str]:
    """
    GET GOG Wishlist.
    Endpoint: https://www.gog.com/u/{username}/wishlist
    """
    print(f"[PROCESS] Fetching GOG Wishlist for GOG User: {username}")
    url = f"https://www.gog.com/u/{username}/wishlist"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    }
    try:
        response = requests.get(url, headers=headers, timeout=15)
        print(f"   [DEBUG] GOG Wishlist HTTP status: {response.status_code}")
        
        if response.status_code == 403:
            print("   ⚠️ [ERROR] GOG returned 403 Forbidden. Your GOG profile/wishlist settings might be Private, or cloud IPs are being throttled. Ensure your GOG privacy settings are 'Public'.")
            print("      👉 Attempting to load GOG wishlist from last successful local cache fallback instead...")
            return load_gog_cache_wishlist()
        elif response.status_code == 404:
            print("   ⚠️ [ERROR] GOG returned 404 Not Found. Verify your GOG username is correct and that your GOG profile is set to Public.")
            print("      👉 Attempting to load GOG wishlist from last successful local cache fallback instead...")
            return load_gog_cache_wishlist()
            
        response.raise_for_status()
        
        wishlist = []
        # Try to parse var gogData in script tags (contains complete wishlist products JSON)
        match = re.search(r'var gogData\s*=\s*(\{.*?\});', response.text)
        if match:
            try:
                data = json.loads(match.group(1))
                products = data.get("products", [])
                for p in products:
                    if isinstance(p, dict) and "title" in p:
                        wishlist.append(p["title"])
            except Exception as parse_err:
                print(f"   [DEBUG] Failed to parse embedded var gogData: {parse_err}")

        # If var gogData extraction returned nothing, fall back to BeautifulSoup elements
        if not wishlist:
            soup = BeautifulSoup(response.text, 'html.parser')
            # Look for wishlist game elements (common on GOG user profile layouts)
            elements = soup.select(".wishlist-game-title, .product-title, .product-row__title")
            for elem in elements:
                wishlist.append(elem.get_text(strip=True))
        
        print(f"   ✅ Successfully fetched {len(wishlist)} GOG wishlist items.")
        
        # Save to local cache on success
        if wishlist:
            save_gog_cache(wishlist=wishlist)
            
        return wishlist
    except Exception as e:
        print(f"[WARN] Failed to fetch GOG Wishlist: {e}. Attempting cache fallback...")
        return load_gog_cache_wishlist()

def fetch_gog_owned() -> List[str]:
    """
    GOG Owned Games - Load manually added games from the local cache.
    """
    print("[PROCESS] Loading manually configured GOG Owned games from local cache...")
    return load_gog_cache_owned()

# --- PHASE 3: PLAYSTATION CACHE INTEGRATION ---
def load_playstation_cache() -> tuple[Set[str], Set[str], Optional[str]]:
    """
    Completely decoupled from live PSN APIs.
    Attempts to read playstation_cache.json.
    If missing or empty, handles exception gracefully by returning empty sets
    and logging a warning.
    Returns: (owned_games_set, wishlist_games_set, updated_at_string)
    """
    cache_path = "playstation_cache.json"
    print(f"[PROCESS] Attempting to read local PlayStation cache: {cache_path}")
    
    if not os.path.exists(cache_path) or os.path.getsize(cache_path) == 0:
        print("[WARN] PSN local cache not found (or empty). Proceeding with Steam and GOG data only.")
        return set(), set(), None
        
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        owned = set()
        wishlist = {normalize_title(g) for g in data.get("wishlist", []) if g}
        updated_at = data.get("updated_at", "Unknown")
        print(f"   ✅ PSN cache loaded successfully! (Wishlist: {len(wishlist)}, Updated At: {updated_at})")
        return owned, wishlist, updated_at
    except Exception as e:
        print(f"[WARN] Failed to parse PlayStation cache: {e}. Proceeding with empty PSN sets.")
        return set(), set(), None

DEKU_DEALS_BLOCKED = False

def check_ps_store_deal(game_title: str) -> Optional[Dict]:
    """
    Queries Deku Deals search endpoint for a game and filters for PlayStation platform.
    Gracefully avoids hammering if rate limited (403/429) or on request errors.
    """
    global DEKU_DEALS_BLOCKED
    if DEKU_DEALS_BLOCKED:
        return None
        
    import urllib.parse
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    # Tiny rate-limiting throttle to respect the host
    time.sleep(0.5)
    
    try:
        q = urllib.parse.quote(game_title)
        url = f"https://www.dekudeals.com/search?q={q}&filter[platform]=playstation"
        resp = requests.get(url, headers=headers, timeout=8)
        
        if resp.status_code in [403, 429]:
            print(f"   ⚠️ [DEKU DEALS] Received status code {resp.status_code}. Rate limit or Cloudflare block detected. Disabling further Deku Deals real-time queries.")
            DEKU_DEALS_BLOCKED = True
            return None
            
        if resp.status_code != 200:
            return None
            
        soup = BeautifulSoup(resp.text, 'html.parser')
        main_links = soup.find_all('a', class_='main-link')
        
        target_norm = normalize_title(game_title)
        best_match = None
        
        for link in main_links:
            title_text = link.get_text(strip=True)
            href = link.get('href')
            item_norm = normalize_title(title_text)
            
            # Match strictly or flexibly (exact match or substring)
            is_match = False
            if target_norm == item_norm:
                is_match = True
            elif target_norm in item_norm or item_norm in target_norm:
                is_match = True
                
            if is_match:
                parent_container = link.find_parent('div', class_='d-flex flex-column')
                price_str = ''
                reg_price_str = ''
                discount_str = ''
                
                if parent_container:
                    price_container = parent_container.find('div', class_='d-flex align-items-center text-tight flex-wrap text-responsive')
                    if price_container:
                        strong = price_container.find('strong')
                        if strong:
                            price_str = strong.get_text(strip=True)
                        s_tag = price_container.find('s')
                        if s_tag:
                            reg_price_str = s_tag.get_text(strip=True)
                        badge = price_container.find('span', class_='badge-danger')
                        if badge:
                            discount_str = badge.get_text(strip=True)
                
                # Format price values to floats
                def parse_price(p_str):
                    if not p_str or p_str.lower() == 'free':
                        return 0.0
                    clean = re.sub(r'[^0-9\.]', '', p_str)
                    try:
                        return float(clean)
                    except ValueError:
                        return None
                        
                price_current = parse_price(price_str)
                price_regular = parse_price(reg_price_str)
                if price_regular is None:
                    price_regular = price_current
                
                # Parse discount percentage
                discount_pct = None
                if discount_str:
                    discount_pct = int(re.sub(r'[^0-9]', '', discount_str))
                elif price_regular and price_current and price_regular > price_current:
                    discount_pct = int(round((1 - price_current / price_regular) * 100))
                
                best_match = {
                    'title': title_text,
                    'url': 'https://www.dekudeals.com' + href if href else None,
                    'price_current': price_current,
                    'price_regular': price_regular,
                    'discount_percent': discount_pct,
                    'shop_name': "PlayStation Store",
                    'deal_found': discount_pct is not None and discount_pct > 0
                }
                break
                
        return best_match
    except Exception as e:
        print(f"   ⚠️ [WARN] Deku Deals query failed for '{game_title}': {e}")
        return None

# --- PHASE 4: EXTERNAL CATALOG & PRICE CHECKS ---
def check_is_there_any_deal(game_title: str, itad_api_key: str) -> Dict:
    """
    IsThereAnyDeal (ITAD) API Integration.
    Checks price and active discount cut > 0, and parses for Amazon Luna subscription.
    ITAD API uses a flow:
    1. Resolve title to ITAD internal UUID / slug: GET https://api.isthereanydeal.com/games/lookup/v1?key={key}&title={title}
    2. Get prices for the UUID: POST https://api.isthereanydeal.com/games/prices/v3?key={key} with JSON array [uuid] in the body.
    """
    result = {
        "deal_found": False,
        "price_current": None,
        "price_regular": None,
        "discount_percent": None,
        "shop_name": None,
        "url": None,
        "luna_tier": False
    }
    
    if not itad_api_key or itad_api_key == "MOCK_KEY":
        return result
        
    try:
        # Step 1: Lookup game slug/uuid
        lookup_url = "https://api.isthereanydeal.com/games/lookup/v1"
        lookup_params = {"key": itad_api_key, "title": game_title}
        lookup_resp = requests.get(lookup_url, params=lookup_params, timeout=5)
        
        if lookup_resp.status_code == 200:
            lookup_data = lookup_resp.json()
            game_id = lookup_data.get("game", {}).get("id")
            if not game_id:
                return result
                
            # Step 2: Query prices & deals via POST
            prices_url = f"https://api.isthereanydeal.com/games/prices/v3?key={itad_api_key}"
            prices_resp = requests.post(prices_url, json=[game_id], timeout=5)
            
            if prices_resp.status_code == 200:
                prices_data = prices_resp.json()
                if isinstance(prices_data, list) and len(prices_data) > 0:
                    game_prices = prices_data[0]
                    deals = game_prices.get("deals", [])
                    
                    # Filter for active cuts (cut > 0)
                    active_deals = [d for d in deals if d.get("cut", 0) > 0]
                    if active_deals:
                        # Select best deal (highest cut or lowest price)
                        best_deal = min(active_deals, key=lambda x: x.get("price", {}).get("amount", 999999))
                        result["deal_found"] = True
                        result["price_current"] = best_deal.get("price", {}).get("amount")
                        result["price_regular"] = best_deal.get("regular", {}).get("amount")
                        result["discount_percent"] = best_deal.get("cut")
                        result["shop_name"] = best_deal.get("shop", {}).get("name")
                        result["url"] = best_deal.get("url")
                    
                    # Check for subscription tags or shops (like Amazon Luna, Game Pass, etc.)
                    for deal in deals:
                        shop_id = str(deal.get("shop", {}).get("id", "")).lower()
                        shop_name = str(deal.get("shop", {}).get("name", "")).lower()
                        if "luna" in shop_name or "luna" in shop_id or deal.get("luna") or deal.get("tier") == "luna":
                            result["luna_tier"] = True
                            
        return result
    except Exception as e:
        print(f"   ⚠️ [WARN] ITAD API query failed for '{game_title}': {e}")
        return result

def find_game_match(norm_title: str, catalog_normalized_set: Set[str]) -> bool:
    """
    Performs robust substring and token matching between a wishlisted game
    and the catalog database (handling Complete Editions, GOTYs, Directors Cuts etc.)
    """
    if not norm_title:
        return False
    if norm_title in catalog_normalized_set:
        return True
    
    # Substring matching for longer titles (ignore matches under 5 characters)
    for cat_norm in catalog_normalized_set:
        if not cat_norm:
            continue
        if len(cat_norm) >= 5 and len(norm_title) >= 5:
            if cat_norm in norm_title or norm_title in cat_norm:
                return True
    return False

def find_gfn_match(norm_title: str, gfn_catalog: Dict) -> tuple[bool, List[str]]:
    """
    Smart GFN database matching with substring/edition fallback.
    """
    if not norm_title:
        return False, []
    if norm_title in gfn_catalog:
        return True, gfn_catalog[norm_title].get("launchers", [])
        
    for cat_norm in gfn_catalog.keys():
        if len(cat_norm) >= 5 and len(norm_title) >= 5:
            if cat_norm in norm_title or norm_title in cat_norm:
                return True, gfn_catalog[cat_norm].get("launchers", [])
    return False, []

def get_amazon_luna_catalog() -> Set[str]:
    """
    Amazon Luna subscription catalog loader.
    Exclusively loads normalized titles from the local json cache.
    Does not perform live web requests at runtime.
    """
    cache_file = "amazon_luna_catalog.json"
    
    # 1. Attempt to load from cache
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                cached_list = json.load(f)
                if cached_list:
                    return {normalize_title(g) for g in cached_list if g}
        except Exception as e:
            print(f"   ⚠️ Failed to read Amazon Luna catalog cache: {e}")

    # 2. Fallback to baseline seeds if cache is missing or corrupt
    print("   ⚠️ Amazon Luna cache missing. Initializing with baseline seeds...")
    seed_list = {
        "Slay the Spire", "Control Ultimate Edition", "Control", "Metro Exodus", 
        "Fortnite", "Resident Evil 2", "Resident Evil 3", "LEGO DC Super-Villains", 
        "Trackmania", "SMITE", "Alien: Isolation", "Sonic Mania", "Mega Man 11", 
        "Devil May Cry 5", "Street Fighter V", "Guacamelee! 2", "Yakuza Kiwami", 
        "Yakuza Kiwami 2", "Yakuza 0", "Yakuza 3 Remastered", "Yakuza 4 Remastered", 
        "Yakuza 5 Remastered", "Yakuza 6: The Song of Life", "Like a Dragon: Ishin!", 
        "Judgment", "Lost Judgment", "Overcooked! All You Can Eat", "The Jackbox Party Pack 9", 
        "The Jackbox Party Pack 8", "The Jackbox Party Pack 7", "Amnesia: Rebirth", 
        "SOMA", "System Shock", "Deus Ex: Mankind Divided", "Just Cause 4", 
        "Tomb Raider Game of the Year Edition", "Rise of the Tomb Raider: 20 Year Celebration", 
        "Shadow of the Tomb Raider: Definitive Edition", "Batman: Arkham Knight", 
        "Batman: Arkham City", "Batman: Arkham Asylum", "Far Cry 6", "Far Cry 5", 
        "Far Cry 4", "Far Cry 3", "Assassin's Creed Mirage", "Assassin's Creed Valhalla", 
        "Assassin's Creed Odyssey", "Assassin's Creed Origins", "Prince of Persia: The Lost Crown", 
        "Star Wars Outlaws", "Cyberpunk 2077", "The Witcher 3: Wild Hunt"
    }
    normalized_luna_games = {normalize_title(g) for g in seed_list if g}
    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(sorted(list(normalized_luna_games)), f, indent=2, ensure_ascii=False)
        print(f"   💾 Saved {len(normalized_luna_games)} baseline seed titles to Amazon Luna local cache.")
    except Exception as e:
        print(f"   ⚠️ Failed to save Amazon Luna catalog cache: {e}")
        
    return normalized_luna_games

def scrape_ps_plus_catalog() -> Set[str]:
    """
    PlayStation Plus Premium Catalog Loader.
    Exclusively loads normalized titles from the local json cache.
    Does not perform live web requests at runtime.
    """
    cache_file = "ps_plus_catalog.json"
    
    # 1. Attempt to load from cache
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                cached_list = json.load(f)
                return {normalize_title(g) for g in cached_list if g}
        except Exception as e:
            print(f"   ⚠️ Failed to read PS Plus catalog cache: {e}")

    # 2. Fallback to baseline seeds if cache is missing or corrupt
    print("   ⚠️ PlayStation Plus cache missing. Initializing with baseline seeds...")
    fallback = {
        "Returnal", "Demon's Souls", "Ghost of Tsushima Director's Cut", 
        "Spider-Man: Miles Morales", "God of War",
        "Death Stranding Director's Cut", "Ratchet & Clank: Rift Apart",
        "Bloodborne", "Until Dawn", "Detroit: Become Human", "The Last of Us Remastered",
        "Slay the Spire", "Dead Cells", "Outer Wilds", "Skyrim", "Control"
    }
    normalized_ps_games = {normalize_title(g) for g in fallback if g}
    
    # Save to local cache
    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(sorted(list(normalized_ps_games)), f, indent=2, ensure_ascii=False)
        print(f"   💾 Saved {len(normalized_ps_games)} baseline seeds to PS Plus local cache.")
    except Exception as e:
        print(f"   ⚠️ Failed to save PS Plus local catalog cache: {e}")
        
    return normalized_ps_games

def fetch_geforce_now_database() -> Dict:
    """
    GeForce NOW (GFN) supported game database loader.
    Exclusively loads normalized titles from the local json cache.
    Does not perform live web requests at runtime.
    """
    cache_file = "gfn_catalog.json"
    
    # 1. Attempt to load from cache
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"   ⚠️ Failed to read GFN catalog cache: {e}")
            
    # 2. Fallback to basic dictionary if cache is missing
    print("   ⚠️ GeForce NOW cache missing. Initializing with offline fallback...")
    fallback = {
        normalize_title("Cyberpunk 2077"): {"title": "Cyberpunk 2077", "launchers": ["Steam", "GOG", "Epic"]},
        normalize_title("Elden Ring"): {"title": "Elden Ring", "launchers": ["Steam"]},
        normalize_title("The Witcher 3: Wild Hunt"): {"title": "The Witcher 3: Wild Hunt", "launchers": ["Steam", "GOG"]},
        normalize_title("Outer Wilds"): {"title": "Outer Wilds", "launchers": ["Steam", "Epic"]},
        normalize_title("Slay the Spire"): {"title": "Slay the Spire", "launchers": ["Steam", "GOG"]}
    }
    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(fallback, f, indent=2, ensure_ascii=False)
        print(f"   💾 Saved baseline fallback to GFN local cache.")
    except Exception as e:
        print(f"   ⚠️ Failed to save GFN local catalog cache: {e}")
        
    return fallback

# --- MAIN EXECUTION PIPELINE ---
def main():
    parser = argparse.ArgumentParser(description="Antigravity Game Wishlist Deal Sync Agent")
    parser.add_argument("--simulate", action="store_true", help="Run in mock/simulated pipeline mode")
    parser.add_argument("--output", default="deal_alerts_output.json", help="Path to write JSON alert payload")
    args = parser.parse_args()

    print("=======================================================================")
    print("🚀 ANTIGRAVITY GAME WISHLIST DEAL SYNC AGENT STARTING...")
    print(f"🕒 Current Time: {datetime.now().isoformat()}")
    print("=======================================================================")

    # Get environment secrets
    steam_id = os.getenv("STEAM_ID")
    steam_api_key = os.getenv("STEAM_API_KEY")
    gog_username = os.getenv("GOG_USERNAME")
    itad_api_key = os.getenv("ITAD_API_KEY")

    if steam_id:
        steam_id_clean = steam_id.strip()
        # Extract from profile URL patterns: profiles/76561198... or id/custom_name
        m_profile = re.search(r"steamcommunity\.com/profiles/([0-9]+)", steam_id_clean)
        if m_profile:
            steam_id_clean = m_profile.group(1)
        else:
            m_id = re.search(r"steamcommunity\.com/id/([^/]+)", steam_id_clean)
            if m_id:
                steam_id_clean = m_id.group(1).rstrip("/")
        
        if steam_id_clean != steam_id:
            print(f"   ℹ️ Auto-extracted clean Steam ID/Vanity Slug '{steam_id_clean}' from profile URL.")
            steam_id = steam_id_clean

    # If simulation is explicitly requested, we don't block on missing keys.
    # Otherwise, check constraints and exit gracefully.
    is_simulating = args.simulate or not (steam_id and steam_api_key and gog_username and itad_api_key)
    
    if not is_simulating:
        print("🔒 Security Verification: All required environment variables are loaded.")
    else:
        print("ℹ️ PIPELINE RUNNING IN SIMULATED MODE.")
        print("To run with real data, populate STEAM_ID, STEAM_API_KEY, GOG_USERNAME, and ITAD_API_KEY in secrets.")
        # Provide safe mock variables
        steam_id = steam_id or "76561198000000001"
        steam_api_key = steam_api_key or "MOCK_STEAM_KEY"
        gog_username = gog_username or "gog_explorer_user"
        itad_api_key = itad_api_key or "MOCK_KEY"

    # --- PHASE 1: GATHERING & AUTHENTICATION ---
    print("\n--- PHASE 1: DATA GATHERING & AUTHENTICATION ---")
    
    steam_wishlist_raw = []
    steam_owned_raw = []
    gog_wishlist_raw = []
    gog_owned_raw = []
    
    if not args.simulate and not is_simulating:
        # If steam_id is not numeric (e.g. custom vanity username), resolve it to numeric first
        resolved_steam_id = steam_id
        if steam_id and not steam_id.isdigit():
            resolved = resolve_steam_vanity_url(steam_id, steam_api_key)
            if resolved:
                resolved_steam_id = resolved
                
        # Active API Gather loaded from locally cached/refreshed Steam Catalog
        steam_wishlist_raw = load_steam_cache_wishlist()
        steam_owned_raw = fetch_steam_owned(steam_api_key, resolved_steam_id)
        gog_wishlist_raw = fetch_gog_wishlist(gog_username)
        gog_owned_raw = fetch_gog_owned()
    else:
        # Detailed high-fidelity simulation datasets
        print("[INFO] Simulating Steam and GOG user profiles...")
        time.sleep(1.0)
        
        # Load GOG Wishlist from local cache, fallback if empty
        gog_wishlist_raw = load_gog_cache_wishlist()
        if not gog_wishlist_raw:
            gog_wishlist_raw = [
                "Cyberpunk 2077", "Slay the Spire", "Dead Cells"
            ]
            
        # Load GOG Owned from local cache, only use manually added games
        gog_owned_raw = load_gog_cache_owned()
            
        # Load Steam Wishlist from local cache, fallback if empty
        steam_wishlist_raw = load_steam_cache_wishlist()
        if not steam_wishlist_raw:
            steam_wishlist_raw = [
                {"id": "1245620", "name": "Elden Ring", "platform": "Steam"},
                {"id": "753640", "name": "Outer Wilds", "platform": "Steam"},
                {"id": "1151640", "name": "Horizon Forbidden West Complete Edition", "platform": "Steam"},
                {"id": "2215430", "name": "Ghost of Tsushima Director's Cut", "platform": "Steam"},
                {"id": "1091500", "name": "Cyberpunk 2077", "platform": "Steam"}
            ]
            
        # Load Steam Owned from local cache, fallback if empty
        steam_owned_raw = load_steam_cache_owned()
        if not steam_owned_raw:
            steam_owned_raw = [
                "The Witcher 3: Wild Hunt", "Hades", "Disco Elysium", "Stardew Valley", "Baldur's Gate 3"
            ]

    # --- PHASE 3: PLAYSTATION CACHE INTEGRATION ---
    print("\n--- PHASE 3: PLAYSTATION INTEGRATION & CACHING ---")
    psn_owned_raw, psn_wishlist_raw, psn_updated_at = load_playstation_cache()
    psn_owned_raw = set() # Always empty as playstation owned logic is removed
    
    # If simulated and cache is empty, seed mock cache data for demonstrating the cross-reference
    if is_simulating and not psn_wishlist_raw:
        print("[INFO] Playstation cache empty or missing. Adding realistic sample PSN cache data for demo.")
        psn_wishlist_raw = {"Ghost of Tsushima Director's Cut", "God of War Ragnarök"}
        psn_updated_at = "2026-07-04T12:00:00Z"

    # --- PHASE 2 & 3: THE FILTER & CROSS-REFERENCE PIPELINE ---
    print("\n--- PHASES 2 & 3: NORMALIZATION, INTEGRATION, FILTER PIPELINE ---")
    
    # Create master owned dictionary mapping normalized title to original title
    master_owned_normalized: Dict[str, str] = {}
    
    # Populate master owned games from all 3 platforms
    for game in steam_owned_raw:
        norm = normalize_title(game)
        if norm:
            master_owned_normalized[norm] = f"Steam ({game})"
            
    for game in gog_owned_raw:
        norm = normalize_title(game)
        if norm:
            master_owned_normalized[norm] = f"GOG ({game})"
            
    for game in psn_owned_raw:
        norm = normalize_title(game)
        if norm:
            master_owned_normalized[norm] = f"PSN ({game})"
            
    master_owned_set = set(master_owned_normalized.keys())
    print(f"[INFO] Consolidated Master Owned Set has {len(master_owned_set)} unique normalized titles.")

    # Gather wishlists mapping normalized title to Details
    wishlist_by_normalized: Dict[str, Dict] = {}
    
    # Extract & Deduplicate Wishlisted games
    for item in steam_wishlist_raw:
        name = item["name"]
        norm = normalize_title(name)
        if norm:
            if norm not in wishlist_by_normalized:
                wishlist_by_normalized[norm] = {"title": name, "sources": []}
            if "Steam" not in wishlist_by_normalized[norm]["sources"]:
                wishlist_by_normalized[norm]["sources"].append("Steam")
                
    for name in gog_wishlist_raw:
        norm = normalize_title(name)
        if norm:
            if norm not in wishlist_by_normalized:
                wishlist_by_normalized[norm] = {"title": name, "sources": []}
            if "GOG" not in wishlist_by_normalized[norm]["sources"]:
                wishlist_by_normalized[norm]["sources"].append("GOG")
                
    for name in psn_wishlist_raw:
        norm = normalize_title(name)
        if norm:
            if norm not in wishlist_by_normalized:
                wishlist_by_normalized[norm] = {"title": name, "sources": []}
            if "PSN" not in wishlist_by_normalized[norm]["sources"]:
                wishlist_by_normalized[norm]["sources"].append("PSN")

    print(f"[INFO] Extracted {len(wishlist_by_normalized)} unique normalized wishlist titles across all services.")

    # Apply Cross-Reference Filtering
    filtered_wishlist: List[Dict] = []
    skipped_count = 0
    
    for norm, info in wishlist_by_normalized.items():
        if norm in master_owned_set:
            owned_source = master_owned_normalized[norm]
            print(f"❌ [FILTERED OUT] '{info['title']}' is wishlisted on {info['sources']} but already owned on {owned_source}.")
            skipped_count += 1
        else:
            filtered_wishlist.append(info)
            
    print(f"✅ Filter Complete! Dropped {skipped_count} owned titles. {len(filtered_wishlist)} titles remaining for deal checking.")

    # --- PHASE 4: EXTERNAL CATALOG & PRICE CHECKS ---
    print("\n--- PHASE 4: EXTERNAL PRICING & STREAMING CATALOG CHECKS ---")
    
    # Scrape PS Plus Catalog
    ps_plus_catalog = scrape_ps_plus_catalog()
    ps_plus_normalized = {normalize_title(g) for g in ps_plus_catalog}
    
    # Get Amazon Luna Catalog
    luna_catalog = get_amazon_luna_catalog()
    luna_normalized = {normalize_title(g) for g in luna_catalog}
    
    # Fetch GFN Database
    gfn_catalog = fetch_geforce_now_database()

    # Normalized PSN Wishlist for lookup
    playstation_wishlist_normalized = {normalize_title(g) for g in psn_wishlist_raw if g}

    final_alerts: List[DealInfo] = []

    # Prefetch ITAD deals concurrently in Live API mode to maximize speed
    itad_prefetched = {}
    if not is_simulating and itad_api_key and itad_api_key != "MOCK_KEY":
        print(f"[PROCESS] Prefetching IsThereAnyDeal pricing for {len(filtered_wishlist)} games in parallel...")
        def fetch_itad(game_title):
            return game_title, check_is_there_any_deal(game_title, itad_api_key)
        
        with ThreadPoolExecutor(max_workers=16) as executor:
            results = executor.map(fetch_itad, [g["title"] for g in filtered_wishlist])
            for title, deal in results:
                itad_prefetched[title] = deal
        print("   ✅ Prefetched all ITAD deals.")

    for index, game in enumerate(filtered_wishlist):
        title = game["title"]
        norm = normalize_title(title)
        sources = game["sources"]
        
        print(f"\n🎮 [{index+1}/{len(filtered_wishlist)}] Processing deal metrics for '{title}'...")
        
        # ITAD Pricing
        itad_deal = {
            "deal_found": False,
            "price_current": None,
            "price_regular": None,
            "discount_percent": None,
            "shop_name": None,
            "url": None,
            "luna_tier": False
        }
        
        if not is_simulating:
            itad_deal = itad_prefetched.get(title, itad_deal)
        else:
            # High-fidelity simulation pricing
            time.sleep(0.1)
            if "elden ring" in norm:
                itad_deal = {
                    "deal_found": True,
                    "price_current": 34.99,
                    "price_regular": 59.99,
                    "discount_percent": 42,
                    "shop_name": "Steam",
                    "url": "https://store.steampowered.com/app/1245620/ELDEN_RING/",
                    "luna_tier": False
                }
            elif "outer wilds" in norm:
                itad_deal = {
                    "deal_found": True,
                    "price_current": 14.99,
                    "price_regular": 24.99,
                    "discount_percent": 40,
                    "shop_name": "Steam Store",
                    "url": "https://store.steampowered.com/app/753640/Outer_Wilds/",
                    "luna_tier": False
                }
            elif "slay the spire" in norm:
                itad_deal = {
                    "deal_found": True,
                    "price_current": 8.49,
                    "price_regular": 24.99,
                    "discount_percent": 66,
                    "shop_name": "GOG",
                    "url": "https://www.gog.com/en/game/slay_the_spire",
                    "luna_tier": True # Amazon Luna sub contains Slay the Spire in simulated tier!
                }
            elif "ghost of tsushima" in norm:
                itad_deal = {
                    "deal_found": False,
                    "price_current": None,
                    "price_regular": None,
                    "discount_percent": None,
                    "shop_name": None,
                    "url": None,
                    "luna_tier": False
                }

        # PlayStation Store Pricing from Deku Deals (Live or Simulated)
        ps_store_deal = {
            "ps_deal_found": False,
            "ps_price_current": None,
            "ps_price_regular": None,
            "ps_discount_percent": None,
            "ps_shop_name": None,
            "ps_url": None
        }
        
        if not is_simulating:
            # Query Deku Deals strictly for games wishlisted on PlayStation (PSN)
            is_ps_related = "PSN" in sources
            if is_ps_related:
                print(f"   🔍 [DEKU DEALS] Querying PlayStation deal for '{title}'...")
                deku_result = check_ps_store_deal(title)
                if deku_result:
                    print(f"      🎯 Found PS Store Deal: ${deku_result['price_current']} (-{deku_result['discount_percent']}%)")
                    ps_store_deal = {
                        "ps_deal_found": deku_result["deal_found"],
                        "ps_price_current": deku_result["price_current"],
                        "ps_price_regular": deku_result["price_regular"],
                        "ps_discount_percent": deku_result["discount_percent"],
                        "ps_shop_name": deku_result["shop_name"],
                        "ps_url": deku_result["url"]
                    }
                else:
                    print(f"      ℹ️ No PS Store deal found on Deku Deals.")
        else:
            # High-fidelity simulation for Deku Deals
            if "elden ring" in norm:
                ps_store_deal = {
                    "ps_deal_found": True,
                    "ps_price_current": 35.99,
                    "ps_price_regular": 59.99,
                    "ps_discount_percent": 40,
                    "ps_shop_name": "PlayStation Store",
                    "ps_url": "https://www.dekudeals.com/items/elden-ring-tarnished-edition?platform=playstation"
                }
            elif "outer wilds" in norm:
                ps_store_deal = {
                    "ps_deal_found": True,
                    "ps_price_current": 14.99,
                    "ps_price_regular": 24.99,
                    "ps_discount_percent": 40,
                    "ps_shop_name": "PlayStation Store",
                    "ps_url": "https://www.dekudeals.com/items/outer-wilds?platform=playstation"
                }
            elif "ghost of tsushima" in norm:
                ps_store_deal = {
                    "ps_deal_found": True,
                    "ps_price_current": 29.99,
                    "ps_price_regular": 69.99,
                    "ps_discount_percent": 57,
                    "ps_shop_name": "PlayStation Store",
                    "ps_url": "https://www.dekudeals.com/items/ghost-of-tsushima-directors-cut?platform=playstation"
                }
            elif "cyberpunk" in norm:
                ps_store_deal = {
                    "ps_deal_found": True,
                    "ps_price_current": 19.99,
                    "ps_price_regular": 49.99,
                    "ps_discount_percent": 60,
                    "ps_shop_name": "PlayStation Store",
                    "ps_url": "https://www.dekudeals.com/items/cyberpunk-2077-phantom-liberty-bundle?platform=playstation"
                }
            elif "slay the spire" in norm:
                ps_store_deal = {
                    "ps_deal_found": True,
                    "ps_price_current": 9.99,
                    "ps_price_regular": 24.99,
                    "ps_discount_percent": 60,
                    "ps_shop_name": "PlayStation Store",
                    "ps_url": "https://www.dekudeals.com/items/slay-the-spire?platform=playstation"
                }
            elif "horizon forbidden west" in norm:
                ps_store_deal = {
                    "ps_deal_found": True,
                    "ps_price_current": 19.99,
                    "ps_price_regular": 49.99,
                    "ps_discount_percent": 60,
                    "ps_shop_name": "PlayStation Store",
                    "ps_url": "https://www.dekudeals.com/items/horizon-forbidden-west?platform=playstation"
                }

        # PS Plus Subscription Check
        is_ps_plus = find_game_match(norm, ps_plus_normalized) or norm in ps_plus_normalized
        if is_ps_plus:
            print(f"   🎁 [CATALOG] Title matched inside PlayStation Plus Premium catalog!")
            
        # Amazon Luna Subscription Check
        is_luna = find_game_match(norm, luna_normalized) or norm in luna_normalized or itad_deal.get("luna_tier", False)
        if is_luna:
            print(f"   🌙 [CATALOG] Title matched inside Amazon Luna catalog!")
            
        # GFN Streaming check & launcher match
        gfn_supported, gfn_launchers = find_gfn_match(norm, gfn_catalog)
        if gfn_supported:
            print(f"   🖥️ [GFN STREAMABLE] Available on GeForce NOW. Launchers: {gfn_launchers}")
            
        # Compile structured object
        deal_info = DealInfo(
            title=title,
            normalized_title=norm,
            wishlist_source=sources,
            owned_elsewhere=False, # Set to False since we filtered out owned
            deal_found=itad_deal["deal_found"],
            shop_name=itad_deal["shop_name"],
            price_current=itad_deal["price_current"],
            price_regular=itad_deal["price_regular"],
            discount_percent=itad_deal["discount_percent"],
            url=itad_deal["url"],
            luna_tier=is_luna,
            ps_plus_premium=is_ps_plus,
            gfn_supported=gfn_supported,
            gfn_launchers=gfn_launchers,
            # Deku Deals / PS Store
            ps_deal_found=ps_store_deal["ps_deal_found"],
            ps_price_current=ps_store_deal["ps_price_current"],
            ps_price_regular=ps_store_deal["ps_price_regular"],
            ps_discount_percent=ps_store_deal["ps_discount_percent"],
            ps_shop_name=ps_store_deal["ps_shop_name"],
            ps_url=ps_store_deal["ps_url"]
        )
        
        final_alerts.append(deal_info)

    # --- PHASE 5: OUTPUT AND STRUCTURING ---
    print("\n--- PHASE 5: COMPILING STRIPED PAYLOAD ---")
    
    payload = DealAlertPayload(
        generated_at=datetime.utcnow().isoformat() + "Z",
        summary={
            "total_wishlisted_evaluated": len(wishlist_by_normalized),
            "total_owned_filtered_out": skipped_count,
            "total_remaining_alerts": len(final_alerts),
            "active_deals_found": sum(1 for a in final_alerts if a.deal_found or a.ps_deal_found),
            "subscription_catalog_matches": sum(1 for a in final_alerts if a.ps_plus_premium or a.luna_tier)
        },
        alerts=final_alerts
    )

    # Output to stdout and write file
    try:
        output_json = payload.model_dump_json(indent=2)
    except AttributeError:
        output_json = payload.json(indent=2)
    print(f"💾 Writing final structured output payload to: {args.output}")
    try:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output_json)
        print("✅ Pipeline sync execution successfully finalized!")
        
        # Log quick stats summary
        print("\n================== EXECUTIVE SUMMARY ==================")
        print(f"📊 Evaluated Wishlist Titles: {payload.summary['total_wishlisted_evaluated']}")
        print(f"🛡️ Filtered Out (Already Owned): {payload.summary['total_owned_filtered_out']}")
        print(f"🔥 Active Sale Deals: {payload.summary['active_deals_found']}")
        print(f"🎮 Streamable on GFN: {sum(1 for a in payload.alerts if a.gfn_supported)}")
        print(f"🎁 PS+ Premium Matches: {sum(1 for a in payload.alerts if a.ps_plus_premium)}")
        print("=======================================================")
    except Exception as e:
        print(f"❌ Failed to write output file: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()

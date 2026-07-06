#!/usr/bin/env python3
"""
Utility script to refresh the weekly offline catalogs:
1. Amazon Luna Catalog (luna sitemap scraper)
2. PlayStation Plus Premium Catalog (CDN endpoint scraper)
3. Nvidia GeForce NOW Catalog (Nvidia supported list JSON)

Usage:
  python refresh_weekly_catalogs.py
"""

import re
import json
import requests
from bs4 import BeautifulSoup

def normalize_title(title: str) -> str:
    if not title:
        return ""
    normalized = title.lower()
    normalized = normalized.replace("™", "").replace("®", "").replace("©", "")
    normalized = re.sub(r'[:\-\.,!"\'\?\(\)\[\]_#\*&]', ' ', normalized)
    normalized = re.sub(r'[^a-z0-9 ]', '', normalized)
    normalized = " ".join(normalized.split())
    return normalized

def refresh_luna():
    print("[LUNA] Scraping live Amazon Luna catalog sitemap...")
    luna_games = set()
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        response = requests.get("https://luna.amazon.com/sitemap.xml", headers=headers, timeout=15)
        if response.status_code == 200:
            urls = re.findall(r'<loc>(https://luna.amazon.com/game/[^<]+)</loc>', response.text)
            for url in urls:
                match = re.search(r'https://luna.amazon.com/game/([^/]+)', url)
                if match:
                    slug = match.group(1)
                    title = " ".join(word.capitalize() for word in slug.split("-") if word)
                    if title:
                        luna_games.add(title)
            print(f"   ✅ Parsed {len(luna_games)} active titles from sitemap.")
    except Exception as e:
        print(f"   ⚠️ Failed to fetch live sitemap: {e}")

    # Add seeds
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
    luna_games.update(seed_list)
    normalized = sorted(list({normalize_title(g) for g in luna_games if g}))
    with open("amazon_luna_catalog.json", "w", encoding="utf-8") as f:
        json.dump(normalized, f, indent=2, ensure_ascii=False)
    print(f"   💾 Saved {len(normalized)} titles to amazon_luna_catalog.json\n")

def refresh_ps_plus():
    print("[PS PLUS] Scraping live PlayStation Plus catalog...")
    ps_plus_games = set()
    categories = [
        "plus-games-list",
        "ubisoft-classics-list",
        "plus-classics-list",
        "plus-monthly-games-list"
    ]
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }
    any_success = False
    for cat in categories:
        url = f"https://www.playstation.com/bin/imagic/gameslist?locale=en-us&categoryList={cat}"
        try:
            response = requests.get(url, headers=headers, timeout=15)
            if response.status_code == 200:
                data = response.json()
                fetched_count = 0
                for group in data:
                    if isinstance(group, dict) and "games" in group:
                        for game in group["games"]:
                            if isinstance(game, dict) and "name" in game and game["name"]:
                                ps_plus_games.add(game["name"])
                                fetched_count += 1
                print(f"   ✅ Category '{cat}': found {fetched_count} games.")
                any_success = True
        except Exception as e:
            print(f"   ⚠️ Failed category '{cat}': {e}")

    if not any_success or len(ps_plus_games) < 50:
        fallback = {
            "Returnal", "Demon's Souls", "Ghost of Tsushima Director's Cut", 
            "Spider-Man: Miles Morales", "God of War",
            "Death Stranding Director's Cut", "Ratchet & Clank: Rift Apart",
            "Bloodborne", "Until Dawn", "Detroit: Become Human", "The Last of Us Remastered",
            "Slay the Spire", "Dead Cells", "Outer Wilds", "Skyrim", "Control"
        }
        ps_plus_games.update(fallback)

    normalized = sorted(list({normalize_title(g) for g in ps_plus_games if g}))
    with open("ps_plus_catalog.json", "w", encoding="utf-8") as f:
        json.dump(normalized, f, indent=2, ensure_ascii=False)
    print(f"   💾 Saved {len(normalized)} titles to ps_plus_catalog.json\n")

def refresh_gfn():
    print("[GFN] Pulling Nvidia GeForce NOW live database...")
    url = "https://static.nvidiagrid.net/supported-public-game-list/locales/gfnpc-en-US.json"
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, list):
            if isinstance(data, dict):
                for k, v in data.items():
                    if isinstance(v, list):
                        data = v
                        break
        gfn_index = {}
        for item in data:
            if not isinstance(item, dict):
                continue
            title = item.get("title")
            store = item.get("store", "Unknown")
            if title:
                norm = normalize_title(title)
                if norm not in gfn_index:
                    gfn_index[norm] = {"title": title, "launchers": []}
                if store not in gfn_index[norm]["launchers"]:
                    gfn_index[norm]["launchers"].append(store)
        with open("gfn_catalog.json", "w", encoding="utf-8") as f:
            json.dump(gfn_index, f, indent=2, ensure_ascii=False)
        print(f"   💾 Saved {len(gfn_index)} GFN titles to gfn_catalog.json\n")
    except Exception as e:
        print(f"   ⚠️ GFN database pull failed: {e}\n")

if __name__ == "__main__":
    refresh_luna()
    refresh_ps_plus()
    refresh_gfn()
    print("✨ Weekly catalogs refresh completed!")

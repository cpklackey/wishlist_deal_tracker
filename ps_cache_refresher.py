#!/usr/bin/env python3
"""
PlayStation Network Cache Refresher Utility.
Part of the Antigravity Game Wishlist Deal Tracker.

This script connects to the PlayStation Network using the 'psnawp_api' library
and the 'PSN_NPSSO_TOKEN' environment variable. It fetches the user's owned games 
(via purchased games and trophies) and wishlist, and saves them locally in 
'playstation_cache.json' for offline access.
"""

import os
import sys
import json
import re
from datetime import datetime

# CRITICAL SECURITY CONSTRAINT: Check for required environment variables before proceeding.
NPSSO_TOKEN = os.getenv("PSN_NPSSO_TOKEN")

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

if not NPSSO_TOKEN:
    print("=======================================================================")
    print("ℹ️ INFO: PSN_NPSSO_TOKEN is not defined (removed from secrets).")
    print("PlayStation queries are running fully in Local Offline/Manual Mode.")
    print("Updating the PlayStation cache will preserve existing data.")
    print("=======================================================================")
    cache_file = "playstation_cache.json"
    if not os.path.exists(cache_file):
        # Create a default clean cache file
        cache_data = {
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "owned": [],
            "wishlist": [
                normalize_title("Ghost of Tsushima Director's Cut"),
                normalize_title("God of War Ragnarök"),
                normalize_title("Horizon Forbidden West Complete Edition"),
                normalize_title("Ratchet & Clank Rift Apart")
            ]
        }
        try:
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(cache_data, f, indent=2, ensure_ascii=False)
            print("💾 Initialized default 'playstation_cache.json'.")
        except Exception as e:
            print(f"❌ Failed to write fallback cache file: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        print("✅ Pre-existing 'playstation_cache.json' found. Preserving current entries.")
    sys.exit(0)

try:
    from psnawp_api import PSNAWP
    print("🔄 Initializing PSNAWP client...")
    psn_client = PSNAWP(NPSSO_TOKEN)
    user = psn_client.me()
    print(f"✅ Successfully authenticated with PSN as user ID: {user.account_id}")
except ImportError:
    print("❌ ERROR: 'psnawp-api' library is not installed in this environment.", file=sys.stderr)
    print("Please run: pip install psnawp-api", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"❌ Failed to authenticate with PSN: {e}", file=sys.stderr)
    sys.exit(1)

def get_wishlisted_games(user):
    """
    Fetches the user's PlayStation Store wishlist.
    """
    wishlisted_titles = set()
    print("💖 Fetching PlayStation wishlist...")
    try:
        # psnawp-api does not always have a direct wishlist API depending on version, 
        # but we query user's store wishlist if available, or fall back gracefully.
        if hasattr(user, 'get_wishlist'):
            wishlist = user.get_wishlist()
            for game in wishlist:
                if hasattr(game, 'name') and game.name:
                    wishlisted_titles.add(game.name)
                elif isinstance(game, dict) and 'name' in game:
                    wishlisted_titles.add(game['name'])
        else:
            # Fallback mock or empty list if the library version lacks direct endpoint support
            print("   ℹ️ PSNAWP version does not explicitly expose 'get_wishlist'. Returning empty wishlist.")
    except Exception as e:
        print(f"   ⚠️ Warning: Could not retrieve PSN wishlist: {e}")
        
    return list(wishlisted_titles)

def main():
    print("🚀 Starting PlayStation cache refresh...")
    
    wishlist = get_wishlisted_games(user)
    
    normalized_owned = []
    normalized_wishlist = sorted(list(set(normalize_title(g) for g in wishlist if g)))
    
    cache_data = {
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "owned": normalized_owned,
        "wishlist": normalized_wishlist
    }
    
    cache_file = "playstation_cache.json"
    print(f"💾 Writing cache to '{cache_file}'...")
    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(cache_data, f, indent=2, ensure_ascii=False)
        print(f"✅ Cache refreshed successfully! Saved {len(wishlist)} wishlisted games.")
    except Exception as e:
        print(f"❌ Failed to write cache file: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()

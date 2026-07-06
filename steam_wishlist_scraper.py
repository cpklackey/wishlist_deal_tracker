import re
import json
import requests
from typing import List, Dict

def fetch_steam_wishlist_app_ids(steam_id: str) -> List[int]:
    """
    Scrapes the public Steam Wishlist storefront HTML page to extract App IDs.
    
    1. Targets the public storefront HTML page.
    2. Uses a realistic browser User-Agent header to avoid being blocked.
    3. Uses Regular Expressions to locate the embedded 'var g_rgWishlistData' variable.
    4. Parses the extracted string match into a structured Python list using json.
    5. Returns a clean list of numerical App IDs.
    """
    print(f"[PROCESS] Scraping public Steam Wishlist HTML for App IDs (Steam ID: {steam_id})")
    
    # 1. Target the public storefront HTML page
    if steam_id.isdigit():
        url = f"https://store.steampowered.com/wishlist/profiles/{steam_id}/"
    else:
        url = f"https://store.steampowered.com/wishlist/id/{steam_id}/"
        
    # 2. Realistic browser User-Agent to avoid bot blocking
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://store.steampowered.com/"
    }
    
    try:
        # 6. Include clear error handling
        response = requests.get(url, headers=headers, timeout=15)
        print(f"   [DEBUG] Steam Wishlist HTML HTTP status: {response.status_code}")
        
        if response.status_code == 429:
            print("   ⚠️ [ERROR] Steam returned 429 Too Many Requests (Rate Limited).")
            return []
            
        # Check if redirected to the main store page (happens with private profile / invalid ID)
        is_redirected = False
        if response.history:
            for resp in response.history:
                if resp.status_code in [301, 302]:
                    is_redirected = True
                    break
        if is_redirected or response.url == "https://store.steampowered.com/" or response.url == "https://store.steampowered.com":
            print("   ⚠️ [ERROR] Redirected to store homepage. Ensure the Steam ID is correct and Game Details are Public.")
            return []
            
        if response.status_code == 403:
            print("   ⚠️ [ERROR] HTTP 403 Forbidden. Your Steam profile/inventory is likely Private.")
            return []
        elif response.status_code == 404:
            print("   ⚠️ [ERROR] HTTP 404 Not Found. Verify your Steam ID/Custom Vanity Slug.")
            return []
            
        response.raise_for_status()
        html_content = response.text
        
        # 3. Regular Expressions to locate 'var g_rgWishlistData = [ ... ];'
        match = re.search(r'var g_rgWishlistData\s*=\s*(\[.*?\])\s*;', html_content, re.DOTALL)
        if not match:
            # Fallback regex with less strict spacing rules
            match = re.search(r'g_rgWishlistData\s*=\s*(\[.*?\])', html_content, re.DOTALL)
            
        if not match:
            print("   ⚠️ [WARN] Could not find 'g_rgWishlistData' inside the HTML response. The wishlist is either empty, private, or restricted.")
            return []
            
        json_str = match.group(1)
        
        # 4. JSON library to parse the extracted string
        try:
            wishlist_data = json.loads(json_str)
        except json.JSONDecodeError as je:
            print(f"   ⚠️ [ERROR] Failed to parse extracted g_rgWishlistData JSON: {je}")
            return []
            
        if not isinstance(wishlist_data, list):
            print("   ⚠️ [ERROR] Wishlist data structure is not a list.")
            return []
            
        # 5. Extract only the 'appid' field from each item
        app_ids = []
        for item in wishlist_data:
            if isinstance(item, dict) and "appid" in item:
                try:
                    app_ids.append(int(item["appid"]))
                except (ValueError, TypeError):
                    pass
                    
        print(f"   ✅ Successfully extracted {len(app_ids)} clean App IDs.")
        return app_ids
        
    except Exception as e:
        print(f"   ⚠️ [ERROR] Scraper failed with exception: {e}")
        return []

# Example Execution Block with placeholder SteamID64
if __name__ == "__main__":
    # Replace this placeholder with a real public 64-bit Steam ID or Custom Vanity Slug to test
    PLACEHOLDER_STEAM_ID = "76561198035123456" 
    
    print("=" * 60)
    print("STEAM WISHLIST SCRAPER DEMO")
    print("=" * 60)
    print(f"Testing with Steam ID: {PLACEHOLDER_STEAM_ID}\n")
    
    app_ids = fetch_steam_wishlist_app_ids(PLACEHOLDER_STEAM_ID)
    
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    if app_ids:
        print(f"Found {len(app_ids)} app IDs in the wishlist:")
        print(app_ids[:20], "... " if len(app_ids) > 20 else "")
    else:
        print("No App IDs could be fetched. This is expected if the placeholder profile is private or does not exist.")
    print("=" * 60)

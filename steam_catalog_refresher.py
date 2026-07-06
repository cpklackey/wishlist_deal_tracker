import os
import sys
import json
import re
import requests
from typing import List, Dict

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

def main():
    print("=======================================================================")
    print("🚀 STEAM CATALOGUE REFRESHER INITIATED")
    print("=======================================================================")

    # 1. Use the official API endpoint. If key is provided, append it.
    api_key = os.getenv("STEAM_API_KEY")
    if api_key and "MOCK" not in api_key and "••••" not in api_key:
        api_key_clean = api_key.strip()
        url = f"https://api.steampowered.com/ISteamApps/GetAppList/v2/?key={api_key_clean}"
        print(f"🔗 Using official API endpoint: https://api.steampowered.com/ISteamApps/GetAppList/v2/?key={api_key_clean[:4]}••••••••")
    else:
        url = "https://api.steampowered.com/ISteamApps/GetAppList/v2/"
        print("🔗 Using official API endpoint (No API Key): https://api.steampowered.com/ISteamApps/GetAppList/v2/")

    # 2. Send a GET request using the requests library to fetch the complete master list of all Steam applications.
    master_apps = []
    is_simulating = False

    try:
        print("[PROCESS] Fetching complete master list of all Steam applications...")
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        # Step 6: Include error handling for invalid API keys or missing network connections
        response = requests.get(url, headers=headers, timeout=15)
        
        # Check for HTTP errors or invalid keys (e.g., 403 Forbidden indicates bad key)
        if response.status_code == 403:
            print("❌ [ERROR] Steam API returned 403 Forbidden. This typically indicates an invalid Steam Web API Key.")
            sys.exit(1)
        elif response.status_code == 429:
            print("⚠️ [WARN] Steam API rate limited (429). Fetching from master fallback...")
            response.raise_for_status()
        else:
            response.raise_for_status()

        data = response.json()
        master_apps = data.get("applist", {}).get("apps", [])
        print(f"✅ Successfully retrieved {len(master_apps)} applications from official Steam API.")

    except requests.exceptions.ConnectionError as ce:
        print(f"❌ [CONNECTION ERROR] Missing network connection or failed to connect to Steam: {ce}")
        print("Attempting to use local mock database fallback...")
        is_simulating = True
    except requests.exceptions.Timeout as te:
        print(f"❌ [TIMEOUT ERROR] Request to Steam API timed out: {te}")
        print("Attempting to use local mock database fallback...")
        is_simulating = True
    except Exception as e:
        print(f"⚠️ [WARN] Failed to fetch live Steam applist: {e}")
        print("Attempting to use local mock database fallback...")
        is_simulating = True

    # 3. Parse the JSON response into a highly efficient lookup dictionary where the keys are the numerical App IDs and the values are the string game names.
    lookup_dict = {}
    if not is_simulating and master_apps:
        for app in master_apps:
            appid = app.get("appid")
            name = app.get("name")
            if appid is not None and name:
                lookup_dict[int(appid)] = str(name)
    else:
        # Failsafe mock database containing popular App IDs for smooth simulation/offline fallback
        print("ℹ️ Operating in fallback/offline simulation mode. Loading default app definitions.")
        mock_apps = [
            {"appid": 1245620, "name": "Elden Ring"},
            {"appid": 753640, "name": "Outer Wilds"},
            {"appid": 1151640, "name": "Horizon Forbidden West Complete Edition"},
            {"appid": 2215430, "name": "Ghost of Tsushima Director's Cut"},
            {"appid": 1091500, "name": "Cyberpunk 2077"},
            {"appid": 1174180, "name": "Red Dead Redemption 2"},
            {"appid": 1145360, "name": "Hades"},
            {"appid": 2195250, "name": "Slay the Spire: Board Game"},
            {"appid": 646570, "name": "Slay the Spire"},
            {"appid": 268910, "name": "Cuphead"},
            {"appid": 413150, "name": "Stardew Valley"}
        ]
        for app in mock_apps:
            lookup_dict[app["appid"]] = app["name"]

    # 4. Accept a local Python list of target App IDs (representing a user's cached wishlist).
    target_app_ids = []
    wishlist_pasted_path = "steam_wishlist_pasted.json"
    
    if os.path.exists(wishlist_pasted_path):
        try:
            with open(wishlist_pasted_path, "r", encoding="utf-8") as f:
                pasted_data = json.load(f)
            
            # Recursive helper to find any key named "appid" or "app_id", or digit keys, or items in a list
            def extract_app_ids(node):
                found = []
                if isinstance(node, dict):
                    for k, v in node.items():
                        # Check if key is a direct alias for appid
                        if k.lower() in ["appid", "app_id"]:
                            if isinstance(v, (int, str)):
                                try:
                                    found.append(int(v))
                                except (ValueError, TypeError):
                                    pass
                            elif isinstance(v, list):
                                for item in v:
                                    try:
                                        found.append(int(item))
                                    except (ValueError, TypeError):
                                        pass
                        # Check if key itself is a numerical appid (typically 3 to 10 digits)
                        elif k.isdigit() and 3 <= len(k) <= 10:
                            try:
                                found.append(int(k))
                            except (ValueError, TypeError):
                                pass
                        
                        # Recurse deep into value
                        found.extend(extract_app_ids(v))
                elif isinstance(node, list):
                    for item in node:
                        if isinstance(item, (int, str)):
                            try:
                                val = int(item)
                                if val > 10:  # Avoid small placeholder indices
                                    found.append(val)
                            except (ValueError, TypeError):
                                pass
                        else:
                            found.extend(extract_app_ids(item))
                return found

            extracted = extract_app_ids(pasted_data)
            
            # Remove duplicates while preserving order
            seen = set()
            for x in extracted:
                if x not in seen:
                    target_app_ids.append(x)
                    seen.add(x)
            
            print(f"📂 Loaded {len(target_app_ids)} target App IDs from '{wishlist_pasted_path}' (pasted Steam wishlist keys/fields).")
        except Exception as e:
            print(f"⚠️ [WARN] Failed to parse pasted wishlist JSON file: {e}. Falling back to default list.")
    
    if not target_app_ids:
        # Default fallback list of App IDs representing a user's wishlist
        print("ℹ️ No custom pasted App IDs found. Using default wishlist App IDs.")
        target_app_ids = [1245620, 753640, 1151640, 2215430, 1091500, 646570]

    # 5. Loop through the target App IDs, look them up in the master dictionary, persistent cache or live appdetails API.
    resolved_names_path = "steam_resolved_names.json"
    resolved_mapping = {}
    if os.path.exists(resolved_names_path):
        try:
            with open(resolved_names_path, "r", encoding="utf-8") as f:
                resolved_mapping = json.load(f)
        except Exception:
            pass

    # Ensure keys are integers in our loaded mapping
    resolved_mapping = {int(k): v for k, v in resolved_mapping.items() if v}

    print("\n================== MATCHED WISHLIST TITLES ==================")
    matched_names = []
    updated_resolved_mapping = False

    import time

    for app_id in target_app_ids:
        # Check first in live lookup_dict (retrieved from GetAppList if successful)
        name = lookup_dict.get(app_id)
        
        # Check second in persistent resolved mapping
        if not name:
            name = resolved_mapping.get(app_id)
            if name:
                print(f"📦 Cached Lookup: AppID {app_id:7} -> \"{name}\"")

        # Check third: fetch dynamically from Steam Store AppDetails API
        if not name:
            print(f"📡 Fetching live name from Steam Store for AppID {app_id}...")
            try:
                # Polite sleep to avoid rate limits
                time.sleep(0.15)
                url_details = f"https://store.steampowered.com/api/appdetails?appids={app_id}"
                response_details = requests.get(url_details, headers={"User-Agent": "Mozilla/5.0"}, timeout=5)
                if response_details.status_code == 200:
                    details_data = response_details.json()
                    if details_data and str(app_id) in details_data:
                        app_data = details_data[str(app_id)]
                        if app_data.get("success"):
                            name = app_data.get("data", {}).get("name", "")
                            if name:
                                print(f"✨ Match Resolved: AppID {app_id:7} -> \"{name}\"")
                                resolved_mapping[app_id] = name
                                updated_resolved_mapping = True
            except Exception as e:
                print(f"⚠️ [WARN] Failed to fetch details for AppID {app_id}: {e}")

        # Final fallback
        if not name:
            name = f"Steam App {app_id}"
            print(f"🔍 Look up failed: AppID {app_id:7} (Not found in catalog or Store)")

        matched_names.append(name)

    print("=============================================================")

    # Save any new resolved names back to persistent store
    if updated_resolved_mapping:
        try:
            # Stringify keys for JSON compatibility
            json_mapping = {str(k): v for k, v in resolved_mapping.items()}
            with open(resolved_names_path, "w", encoding="utf-8") as f:
                json.dump(json_mapping, f, indent=2)
            print(f"💾 Saved updated persistent cache to '{resolved_names_path}'.")
        except Exception as e:
            print(f"⚠️ [WARN] Failed to save persistent resolved names: {e}")

    # Update steam_cache.json with the resolved names so the pipeline can use it!
    steam_cache_path = "steam_cache.json"
    try:
        cache_data = {"updated_at": "", "owned": [], "wishlist": []}
        if os.path.exists(steam_cache_path):
            with open(steam_cache_path, "r", encoding="utf-8") as f:
                try:
                    cache_data = json.load(f)
                except Exception:
                    pass
        
        # Save matched_names to wishlist (normalized)
        from datetime import datetime
        cache_data["updated_at"] = datetime.now().isoformat()
        
        normalized_wishlist = sorted(list(set(normalize_title(g) for g in matched_names if g)))
        normalized_owned = sorted(list(set(normalize_title(g) for g in cache_data.get("owned", []) if g)))
        
        cache_data["wishlist"] = normalized_wishlist
        cache_data["owned"] = normalized_owned
        
        with open(steam_cache_path, "w", encoding="utf-8") as f:
            json.dump(cache_data, f, indent=2, ensure_ascii=False)
        print(f"💾 Updated local '{steam_cache_path}' with {len(normalized_wishlist)} matched games (normalized).")
    except Exception as e:
        print(f"❌ Failed to save resolved games to Steam cache: {e}")

if __name__ == "__main__":
    main()

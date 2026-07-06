import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Terminal, 
  Settings, 
  Play, 
  RefreshCw, 
  Key, 
  Database, 
  Gamepad, 
  AlertCircle, 
  CheckCircle, 
  ExternalLink, 
  Shield, 
  Activity, 
  Plus, 
  Trash2, 
  Send, 
  Download, 
  HelpCircle, 
  Eye, 
  EyeOff, 
  Loader2,
  ListFilter,
  Check,
  Flame,
  Tv,
  Globe,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FilterX
} from 'lucide-react';

// Interfaces matching backend payload models
interface DealInfo {
  title: string;
  normalized_title: string;
  wishlist_source: string[];
  owned_elsewhere: boolean;
  deal_found: boolean;
  shop_name: string | null;
  price_current: number | null;
  price_regular: number | null;
  discount_percent: number | null;
  url: string | null;
  luna_tier: boolean;
  ps_plus_premium: boolean;
  gfn_supported: boolean;
  gfn_launchers: string[];
  // PlayStation specific Deku Deals fields
  ps_deal_found?: boolean;
  ps_price_current?: number | null;
  ps_price_regular?: number | null;
  ps_discount_percent?: number | null;
  ps_shop_name?: string | null;
  ps_url?: string | null;
}

interface Summary {
  total_wishlisted_evaluated: number;
  total_owned_filtered_out: number;
  total_remaining_alerts: number;
  active_deals_found: number;
  subscription_catalog_matches: number;
}

interface DealAlertPayload {
  generated_at: string;
  summary: Summary;
  alerts: DealInfo[];
}

interface PlatformCache {
  updated_at: string;
  owned: string[];
  wishlist: string[];
}

interface Secrets {
  STEAM_ID: string;
  STEAM_API_KEY: string;
  GOG_USERNAME: string;
  ITAD_API_KEY: string;
  GOG_OAUTH_TOKEN: string;
  has_real_keys: boolean;
}

// ---------------------------------------------------------------------------
// Reusable sub-components extracted to eliminate copy-paste (Q4, Q5, Q6)
// ---------------------------------------------------------------------------

/** SortableHeader: Sortable column header with animated sort icon (Q4) */
function SortableHeader({ field, label, sortField, sortDirection, onSort, style, extraClassName = '' }: {
  field: string;
  label: string;
  sortField: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (field: string) => void;
  style?: Record<string, string | number>;
  extraClassName?: string;
}) {
  return (
    <div
      onClick={() => onSort(field)}
      style={style}
      className={`${extraClassName} whitespace-normal break-words leading-tight pr-1 hover:text-slate-300 cursor-pointer flex items-center gap-1 group transition-colors`.trim()}
    >
      <span>{label}</span>
      {sortField === field ? (
        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-teal-400 shrink-0" /> : <ArrowDown className="w-3 h-3 text-teal-400 shrink-0" />
      ) : (
        <ArrowUpDown className="w-3 h-3 text-slate-600 group-hover:text-slate-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </div>
  );
}

/** SecretStatusBadge: LOADED / MISSING environment key pill (Q5) */
function SecretStatusBadge({ loaded }: { loaded: boolean }) {
  return loaded
    ? <span className="text-[10px] text-teal-400 bg-teal-400/10 border border-teal-400/20 px-1.5 py-0.5 rounded uppercase font-semibold font-sans">LOADED</span>
    : <span className="text-[10px] text-rose-400 bg-rose-400/10 border border-rose-400/20 px-1.5 py-0.5 rounded uppercase font-semibold font-sans">MISSING</span>;
}

/** getPlatformBadgeClass: Maps platform name → Tailwind badge classes (Q6) */
function getPlatformBadgeClass(source: string): string {
  if (source === 'Steam') return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
  if (source === 'GOG')   return 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
  return 'bg-sky-500/10 text-sky-400 border border-sky-500/20'; // PSN and others
}

export default function App() {
  console.log("[DEBUG] App component rendering!");
  // Config & Secret management
  const [secrets, setSecrets] = useState<Secrets>({
    STEAM_ID: '',
    STEAM_API_KEY: '',
    GOG_USERNAME: '',
    ITAD_API_KEY: '',
    GOG_OAUTH_TOKEN: '',
    has_real_keys: false
  });
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // PlayStation/Steam/GOG Cache Management
  const [cachePlatform, setCachePlatform] = useState<'psn' | 'steam' | 'gog'>('psn');
  const [psnCache, setPsnCache] = useState<PlatformCache | null>(null);
  const [steamCache, setSteamCache] = useState<PlatformCache | null>(null);
  const [gogCache, setGogCache] = useState<PlatformCache | null>(null);

  // P5: Consolidated per-platform title input state (replaces 6 individual useState vars)
  const [newTitleInputs, setNewTitleInputs] = useState<Record<'psn' | 'steam' | 'gog', { owned: string; wishlist: string }>>(
    { psn: { owned: '', wishlist: '' }, steam: { owned: '', wishlist: '' }, gog: { owned: '', wishlist: '' } }
  );
  const setNewTitle = (platform: 'psn' | 'steam' | 'gog', type: 'owned' | 'wishlist', value: string) =>
    setNewTitleInputs(prev => ({ ...prev, [platform]: { ...prev[platform], [type]: value } }));

  const [showCacheEditor, setShowCacheEditor] = useState(false);
  const [showSteamHelp, setShowSteamHelp] = useState(false);
  const [bulkModeOwned, setBulkModeOwned] = useState(false);
  const [bulkModeWishlist, setBulkModeWishlist] = useState(false);
  const [bulkTextOwned, setBulkTextOwned] = useState('');
  const [bulkTextWishlist, setBulkTextWishlist] = useState('');
  const [steamWishlistJson, setSteamWishlistJson] = useState('{\n  "1245620": {},\n  "753640": {},\n  "1151640": {},\n  "2215430": {},\n  "1091500": {}\n}');
  const [isRefreshingSteamCatalog, setIsRefreshingSteamCatalog] = useState(false);

  // Main Pipeline Engine State
  const [simulateMode, setSimulateMode] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [currentLogs, setCurrentLogs] = useState<string[]>([
    "[SYSTEM] Antigravity Deal Sync Agent ready.",
    "[INFO] Simulation mode selected by default. Set real API keys to execute live queries.",
    "[DEBUG] playstation_cache.json verified. System online."
  ]);
  const [alertPayload, setAlertPayload] = useState<DealAlertPayload | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<DealInfo | null>(null);


  // Interactive View Controls
  const [activeTab, setActiveTab] = useState<'alerts' | 'pipeline' | 'cache'>('alerts');
  const [searchQuery, setSearchQuery] = useState('');

  // Column Filters
  const [colFilterTitle, setColFilterTitle] = useState('');
  const [colFilterSource, setColFilterSource] = useState('all');
  const [colFilterItad, setColFilterItad] = useState('all');
  const [colFilterPs, setColFilterPs] = useState('all');
  const [colFilterCatalog, setColFilterCatalog] = useState('all');

  // Sorting
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  // Timer and terminal refs
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const terminalBottomRef = useRef<HTMLDivElement | null>(null);
  // P2: Single interval ref for log animation (replaces per-log setTimeout spray)
  const logQueueRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load initial configurations
  useEffect(() => {
    fetchSecrets();
    fetchCache();
    fetchAlerts();
    return () => {
      // P2: Clean up log animation interval on unmount
      if (logQueueRef.current) clearInterval(logQueueRef.current);
    };
  }, []);

  // Handle elapsed timer when running
  useEffect(() => {
    if (isRunning) {
      setElapsedTime(0);
      timerRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning]);

  // Autoscroll terminal
  useEffect(() => {
    if (terminalBottomRef.current) {
      terminalBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentLogs]);

  // P2: Plays an array of log strings into the terminal via a single managed interval.
  // Replaces the old pattern of spawning one setTimeout per log entry.
  const playLogs = (logs: string[], intervalMs = 150) => {
    if (logQueueRef.current) clearInterval(logQueueRef.current);
    let i = 0;
    logQueueRef.current = setInterval(() => {
      if (i >= logs.length) {
        if (logQueueRef.current) clearInterval(logQueueRef.current);
        logQueueRef.current = null;
        return;
      }
      setCurrentLogs(prev => [...prev, logs[i++]]);
    }, intervalMs);
  };

  const fetchSecrets = async () => {
    try {
      const res = await fetch('/api/secrets');
      if (res.ok) {
        const data = await res.json();
        setSecrets(data);
        if (data.has_real_keys) {
          // If keys are loaded, let the user default to real mode
          setSimulateMode(false);
        }
      }
    } catch (e) {
      console.error("Failed to load secrets", e);
    }
  };

  const fetchCache = async () => {
    try {
      const res = await fetch('/api/cache');
      if (res.ok) {
        const data = await res.json();
        setPsnCache(data);
      }
    } catch (e) {
      console.error("Failed to load PlayStation cache", e);
    }

    try {
      const res = await fetch('/api/cache/steam');
      if (res.ok) {
        const data = await res.json();
        setSteamCache(data);
      }
    } catch (e) {
      console.error("Failed to load Steam cache", e);
    }

    try {
      const res = await fetch('/api/cache/gog');
      if (res.ok) {
        const data = await res.json();
        setGogCache(data);
      }
    } catch (e) {
      console.error("Failed to load GOG cache", e);
    }

    try {
      const res = await fetch('/api/cache/steam/pasted');
      if (res.ok) {
        const data = await res.json();
        if (data.pasted_json) {
          setSteamWishlistJson(data.pasted_json);
        }
      }
    } catch (e) {
      console.error("Failed to load saved pasted Steam wishlist JSON", e);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/alerts');
      if (res.ok) {
        const data = await res.json();
        setAlertPayload(data);
      }
    } catch (e) {
      console.error("Failed to load alerts output", e);
    }
  };

  const saveSecrets = async (e: any) => {
    e.preventDefault();
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(secrets)
      });
      if (res.ok) {
        setSaveStatus('success');
        fetchSecrets();
        setTimeout(() => {
          setSaveStatus(null);
          setShowConfigModal(false);
        }, 1500);
      } else {
        setSaveStatus('error');
      }
    } catch (e) {
      setSaveStatus('error');
    }
  };

  const toggleShowSecret = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };


  const triggerSteamCatalogRefresh = async () => {
    setIsRefreshingSteamCatalog(true);
    setCurrentLogs(prev => [
      ...prev,
      "[PROCESS] Saving pasted Steam wishlist...",
      `[PROCESS] Steam Catalogue Refresh registered. Mode: ${simulateMode ? 'SIMULATION' : 'LIVE API'}`
    ]);

    try {
      // 1. Save pasted JSON first
      const saveRes = await fetch('/api/cache/steam/pasted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pasted_json: steamWishlistJson })
      });

      if (!saveRes.ok) {
        const errorData = await saveRes.json();
        throw new Error(errorData.error || "Failed to save pasted wishlist JSON");
      }

      setCurrentLogs(prev => [...prev, "✅ [SUCCESS] Pasted Steam Wishlist JSON verified and saved."]);

      // 2. Trigger script refresh
      const res = await fetch('/api/cache/steam/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulate: simulateMode })
      });

      const data = await res.json();
      if (data.success) {
        if (data.simulation) {
          // Push logs sequentially
          playLogs(data.logs, 150);
        } else {
          setCurrentLogs(prev => [
            ...prev,
            "✅ [SUCCESS] Steam Catalogue Refresh executed successfully.",
            ...data.stdout.split('\n').filter(Boolean)
          ]);
        }
        setTimeout(() => {
          fetchCache();
          setIsRefreshingSteamCatalog(false);
        }, 2000);
      } else {
        setCurrentLogs(prev => [
          ...prev,
          `❌ [ERROR] Failed to refresh Steam Catalogue: ${data.error || 'Server rejected request'}`
        ]);
        setIsRefreshingSteamCatalog(false);
      }
    } catch (error: any) {
      setCurrentLogs(prev => [...prev, `❌ [ERROR] Service fault: ${error.message}`]);
      setIsRefreshingSteamCatalog(false);
    }
  };

  const triggerDealSyncAgent = async () => {
    try {
      console.log("[DEBUG] triggerDealSyncAgent invoked!");
      setAlertPayload(null); // Clear previous results so the user sees a fresh run
      setIsRunning(true);
      setElapsedTime(0);
      setActiveTab('pipeline'); // Auto-switch so the terminal is visible
      setCurrentLogs([
        `=========================================`,
        `🚀 DEAL SYNC AGENT INITIATED (Simulate Mode: ${simulateMode ? "ON" : "OFF"})`,
        `🕒 Thread start time: ${new Date().toISOString()}`,
        `=========================================`,
      ]);

      console.log("[DEBUG] Sending POST /api/run request...");
      // 1. Start execution on backend
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulate: simulateMode })
      });

      console.log("[DEBUG] POST response status:", response.status);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to start sync execution");
      }

      console.log("[DEBUG] POST successful, initiating status polling...");
      // 2. Poll for status and logs
      let logsBuffer: string[] = [];

      const intervalId = setInterval(async () => {
        try {
          console.log("[DEBUG] Polling status...");
          const statusRes = await fetch('/api/run/status');
          if (statusRes.ok) {
            const data = await statusRes.json();
            
            // Render new log lines
            if (data.logs && data.logs.length > logsBuffer.length) {
              const newLines = data.logs.slice(logsBuffer.length);
              logsBuffer = data.logs;
              setCurrentLogs(prev => [...prev, ...newLines]);
            }

            if (!data.running) {
              clearInterval(intervalId);
              setIsRunning(false);
              
              if (data.success) {
                if (data.output) {
                  setAlertPayload(data.output);
                }
                setCurrentLogs(prev => [
                  ...prev,
                  `✅ [SYSTEM] Execution thread completed. Deal Alerts fully synced.`
                ]);
                fetchAlerts(); // Refresh alerts UI
              } else {
                setCurrentLogs(prev => [
                  ...prev,
                  `❌ [FATAL] Script execution failed: ${data.error}`
                ]);
              }
            }
          }
        } catch (pollErr) {
          // Ignore transient network errors during polling
        }
      }, 500);

      // Store interval reference to clean up if component unmounts
      logQueueRef.current = intervalId;

    } catch (e: any) {
      alert(`[CRASH] triggerDealSyncAgent failed: ${e.message}`);
      setCurrentLogs(prev => [...prev, `❌ [FATAL] Backend communications fault: ${e.message}`]);
      setIsRunning(false);
    }
  };

  const updateCacheOnServer = async (platform: 'psn' | 'steam' | 'gog', updatedCache: PSNCache) => {
    try {
      const url = platform === 'psn' ? '/api/cache/update' : `/api/cache/${platform}/update`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedCache)
      });
      if (platform === 'psn') setPsnCache(updatedCache);
      if (platform === 'steam') setSteamCache(updatedCache);
      if (platform === 'gog') setGogCache(updatedCache);
    } catch (e) {
      console.error(`Failed to update ${platform} cache`, e);
    }
  };

  const handleAddCacheItem = (type: 'owned' | 'wishlist') => {
    const currentCache = cachePlatform === 'psn' ? psnCache : cachePlatform === 'steam' ? steamCache : gogCache;
    if (!currentCache) return;

    // P5: Read from consolidated newTitleInputs instead of 6 individual state vars
    const value = newTitleInputs[cachePlatform][type].trim();
    if (!value) return;

    const list = [...currentCache[type]];
    if (!list.includes(value)) {
      list.push(value);
      const updated = { ...currentCache, [type]: list };
      updateCacheOnServer(cachePlatform, updated);
      setCurrentLogs(prev => [...prev, `[CACHE] Manually appended ${value} to local ${cachePlatform.toUpperCase()} ${type} catalog.`]);
    }

    setNewTitle(cachePlatform, type, '');
  };

  const handleRemoveCacheItem = (type: 'owned' | 'wishlist', item: string) => {
    const currentCache = cachePlatform === 'psn' ? psnCache : cachePlatform === 'steam' ? steamCache : gogCache;
    if (!currentCache) return;

    const list = currentCache[type].filter(x => x !== item);
    const updated = { ...currentCache, [type]: list };
    updateCacheOnServer(cachePlatform, updated);
    setCurrentLogs(prev => [...prev, `[CACHE] Removed ${item} from local ${cachePlatform.toUpperCase()} ${type} catalog.`]);
  };

  const handleBulkImport = (type: 'owned' | 'wishlist') => {
    const currentCache = cachePlatform === 'psn' ? psnCache : cachePlatform === 'steam' ? steamCache : gogCache;
    if (!currentCache) return;

    const text = type === 'owned' ? bulkTextOwned : bulkTextWishlist;
    if (!text.trim()) return;

    const newTitles = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (newTitles.length === 0) return;

    const list = [...currentCache[type]];
    let addedCount = 0;
    newTitles.forEach(title => {
      if (!list.includes(title)) {
        list.push(title);
        addedCount++;
      }
    });

    if (addedCount > 0) {
      const updated = { ...currentCache, [type]: list };
      updateCacheOnServer(cachePlatform, updated);
      setCurrentLogs(prev => [...prev, `[CACHE] Bulk imported ${addedCount} titles to local ${cachePlatform.toUpperCase()} ${type} catalog.`]);
    }

    if (type === 'owned') {
      setBulkTextOwned('');
      setBulkModeOwned(false);
    } else {
      setBulkTextWishlist('');
      setBulkModeWishlist(false);
    }
  };


  const downloadPayload = () => {
    if (!alertPayload) return;
    const blob = new Blob([JSON.stringify(alertPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deal_alerts_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Handle header click to sort
  const handleSort = (field: string) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortField(null); // unsorted
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // C3: Wrapped in useMemo — was an IIFE that recomputed on every render
  const filteredAndSortedAlerts = useMemo(() => {
    let result = alertPayload?.alerts || [];

    // 1. Apply top search query (matches title or normalized title)
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(alert => 
        alert.title.toLowerCase().includes(query) || 
        alert.normalized_title.toLowerCase().includes(query)
      );
    }

    // 2. Apply Column specific filter: Title
    if (colFilterTitle) {
      const query = colFilterTitle.toLowerCase();
      result = result.filter(alert => 
        alert.title.toLowerCase().includes(query) || 
        alert.normalized_title.toLowerCase().includes(query)
      );
    }

    // 3. Apply Column specific filter: Source Wishlist
    if (colFilterSource !== 'all') {
      result = result.filter(alert => alert.wishlist_source.includes(colFilterSource));
    }

    // 4. Apply Column specific filter: ITAD Price & Cut
    if (colFilterItad === 'deal') {
      result = result.filter(alert => alert.deal_found);
    } else if (colFilterItad === 'discount-50') {
      result = result.filter(alert => alert.deal_found && (alert.discount_percent || 0) >= 50);
    } else if (colFilterItad === 'no-deal') {
      result = result.filter(alert => !alert.deal_found);
    }

    // 5. Apply Column specific filter: PS Store Deal
    if (colFilterPs === 'deal') {
      result = result.filter(alert => alert.ps_deal_found);
    } else if (colFilterPs === 'discount-50') {
      result = result.filter(alert => alert.ps_deal_found && (alert.ps_discount_percent || 0) >= 50);
    } else if (colFilterPs === 'no-deal') {
      result = result.filter(alert => !alert.ps_deal_found);
    }

    // 6. Apply Column specific filter: Catalog / Launcher fits
    if (colFilterCatalog === 'ps_plus') {
      result = result.filter(alert => alert.ps_plus_premium);
    } else if (colFilterCatalog === 'luna') {
      result = result.filter(alert => alert.luna_tier);
    } else if (colFilterCatalog === 'gfn') {
      result = result.filter(alert => alert.gfn_supported);
    } else if (colFilterCatalog === 'any') {
      result = result.filter(alert => alert.ps_plus_premium || alert.luna_tier || alert.gfn_supported);
    } else if (colFilterCatalog === 'none') {
      result = result.filter(alert => !alert.ps_plus_premium && !alert.luna_tier && !alert.gfn_supported);
    }

    // 7. Apply Sorting
    if (sortField) {
      result = [...result].sort((a, b) => {
        let valA: any = null;
        let valB: any = null;

        if (sortField === 'title') {
          valA = a.title.toLowerCase();
          valB = b.title.toLowerCase();
        } else if (sortField === 'source') {
          valA = a.wishlist_source.join(',');
          valB = b.wishlist_source.join(',');
        } else if (sortField === 'itad') {
          // Put deal_found false at the end
          const hasA = a.deal_found;
          const hasB = b.deal_found;
          if (hasA && !hasB) return sortDirection === 'asc' ? -1 : 1;
          if (!hasA && hasB) return sortDirection === 'asc' ? 1 : -1;
          if (!hasA && !hasB) return 0;
          valA = a.price_current ?? 999999;
          valB = b.price_current ?? 999999;
        } else if (sortField === 'ps') {
          const hasA = a.ps_deal_found;
          const hasB = b.ps_deal_found;
          if (hasA && !hasB) return sortDirection === 'asc' ? -1 : 1;
          if (!hasA && hasB) return sortDirection === 'asc' ? 1 : -1;
          if (!hasA && !hasB) return 0;
          valA = a.ps_price_current ?? 999999;
          valB = b.ps_price_current ?? 999999;
        } else if (sortField === 'catalog') {
          const scoreA = (a.ps_plus_premium ? 4 : 0) + (a.gfn_supported ? 2 : 0) + (a.luna_tier ? 1 : 0);
          const scoreB = (b.ps_plus_premium ? 4 : 0) + (b.gfn_supported ? 2 : 0) + (b.luna_tier ? 1 : 0);
          valA = scoreA;
          valB = scoreB;
        }

        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;

        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [alertPayload, searchQuery, colFilterTitle, colFilterSource, colFilterItad, colFilterPs, colFilterCatalog, sortField, sortDirection]);

  const filteredAlerts = filteredAndSortedAlerts;

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60).toString().padStart(2, '0');
    const sec = (seconds % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  };

  return (
    <div className="w-full min-h-screen bg-[#0a0a0c] text-[#e2e8f0] font-sans flex flex-col overflow-hidden select-none">
      
      {/* HEADER BAR */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-8 bg-[#0f1115] shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 bg-teal-500 rounded flex items-center justify-center shadow-[0_0_12px_rgba(20,184,166,0.3)]">
            <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-widest uppercase text-white">Antigravity IDE</h1>
            <p className="text-[10px] text-teal-400 font-mono tracking-tighter">DEAL_SYNC_AGENT_V2.PY</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          {/* Simulate Mode Selector */}
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 p-1.5 rounded-md text-xs">
            <button 
              onClick={() => {
                setSimulateMode(true);
                setCurrentLogs(prev => [...prev, "[SYSTEM] Switched execution to Simulation Mode."]);
              }}
              className={`px-2.5 py-1 rounded transition-all text-[11px] uppercase font-bold tracking-wider ${simulateMode ? 'bg-teal-500 text-black shadow-[0_0_8px_rgba(20,184,166,0.5)]' : 'text-slate-400 hover:text-white'}`}
            >
              Simulated
            </button>
            <button 
              onClick={() => {
                if (!secrets.has_real_keys) {
                  setCurrentLogs(prev => [...prev, "[WARN] No real secrets stored. Direct queries might crash or fallback to mock schemas. Please configure environment variables first."]);
                }
                setSimulateMode(false);
                setCurrentLogs(prev => [...prev, "[SYSTEM] Switched execution to Live API Mode."]);
              }}
              className={`px-2.5 py-1 rounded transition-all text-[11px] uppercase font-bold tracking-wider ${!simulateMode ? 'bg-purple-600 text-white shadow-[0_0_8px_rgba(147,51,234,0.5)]' : 'text-slate-400 hover:text-white'}`}
            >
              Live API
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-teal-500 animate-ping shadow-[0_0_8px_rgba(20,184,166,0.8)]' : 'bg-slate-500'}`}></span>
            <span className={`text-[11px] font-mono uppercase tracking-widest ${isRunning ? 'text-teal-400' : 'text-slate-400'}`}>
              {isRunning ? 'Running' : 'Standby'}
            </span>
          </div>

          <div className="h-8 w-[1px] bg-white/10"></div>
          
          <div className="text-[11px] font-mono text-slate-500 uppercase">
            Elapsed: {formatTime(elapsedTime)}
          </div>
        </div>
      </header>

      {/* WORKSPACE MIDDLE BODY */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* LEFT SIDEBAR: CONTROL DECKS & CONFIGS */}
        <aside className="w-80 bg-[#0f1115] border-r border-white/10 p-6 flex flex-col gap-6 overflow-y-auto shrink-0">
          
          {/* PIPELINE ACTIONS */}
          <section>
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-3 font-semibold">Agent Control Desk</h2>
            <div className="space-y-2">
              <button
                onClick={() => triggerDealSyncAgent()}
                disabled={isRunning}
                className="w-full py-2.5 bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 text-black font-bold uppercase text-[11px] tracking-widest rounded-md flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(20,184,166,0.15)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Executing Pipeline...
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-black" />
                    Sync Wishlist Deals
                  </>
                )}
              </button>


            </div>
          </section>

          {/* SECRETS STATUS SECTION */}
          <section className="border-t border-white/5 pt-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold">Environment Secrets</h2>
              <button 
                onClick={() => setShowConfigModal(true)}
                className="text-[10px] text-teal-400 hover:text-teal-300 flex items-center gap-1 font-semibold uppercase tracking-wider"
              >
                <Settings className="w-3 h-3" />
                Configure
              </button>
            </div>
            
            <div className="space-y-2.5 bg-white/[0.02] p-3 rounded-lg border border-white/5 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">STEAM_ID</span>
                <SecretStatusBadge loaded={!!secrets.STEAM_ID} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">STEAM_API_KEY</span>
                <SecretStatusBadge loaded={!!secrets.STEAM_API_KEY} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">GOG_USERNAME</span>
                <SecretStatusBadge loaded={!!secrets.GOG_USERNAME} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">ITAD_API_KEY</span>
                <SecretStatusBadge loaded={!!secrets.ITAD_API_KEY} />
              </div>
            </div>
          </section>

          {/* LOCAL CACHE MODULES */}
          <section className="border-t border-white/5 pt-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold">Local Databases</h2>
              <button 
                onClick={() => {
                  setActiveTab('cache');
                }}
                className="text-[10px] text-teal-400 hover:text-teal-300 flex items-center gap-1 font-semibold uppercase tracking-wider"
              >
                Manage
              </button>
            </div>

            {/* PlayStation Cache */}
            <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Database className="w-3 h-3 text-teal-500" />
                  <span className="text-xs font-semibold text-slate-200">playstation_cache.json</span>
                </div>
                <span className="text-[9px] bg-teal-500/10 text-teal-400 px-1 py-0.2 rounded font-mono uppercase font-semibold">PSN</span>
              </div>
              <div className="text-center text-xs">
                <div className="bg-white/[0.02] p-1.5 rounded border border-white/5 flex flex-col justify-center">
                  <div className="text-slate-500 text-[9px] uppercase font-semibold">Wishlisted</div>
                  <div className="text-white font-mono text-xs font-bold mt-0.5">{psnCache?.wishlist.length || 0}</div>
                </div>
              </div>
            </div>

            {/* Steam Cache */}
            <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Database className="w-3 h-3 text-sky-500" />
                  <span className="text-xs font-semibold text-slate-200">steam_cache.json</span>
                </div>
                <span className="text-[9px] bg-sky-500/10 text-sky-400 px-1 py-0.2 rounded font-mono uppercase font-semibold">Steam</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                <div className="bg-white/[0.02] p-1.5 rounded border border-white/5 flex flex-col justify-center">
                  <div className="text-slate-500 text-[9px] uppercase font-semibold">Owned</div>
                  <div className="text-white font-mono text-xs font-bold mt-0.5">{steamCache?.owned.length || 0}</div>
                </div>
                <div className="bg-white/[0.02] p-1.5 rounded border border-white/5 flex flex-col justify-center">
                  <div className="text-slate-500 text-[9px] uppercase font-semibold">Wishlisted</div>
                  <div className="text-white font-mono text-xs font-bold mt-0.5">{steamCache?.wishlist.length || 0}</div>
                </div>
              </div>
            </div>

            {/* GOG Cache */}
            <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Database className="w-3 h-3 text-purple-500" />
                  <span className="text-xs font-semibold text-slate-200">gog_cache.json</span>
                </div>
                <span className="text-[9px] bg-purple-500/10 text-purple-400 px-1 py-0.2 rounded font-mono uppercase font-semibold">GOG</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                <div className="bg-white/[0.02] p-1.5 rounded border border-white/5 flex flex-col justify-center">
                  <div className="text-slate-500 text-[9px] uppercase font-semibold">Owned</div>
                  <div className="text-white font-mono text-xs font-bold mt-0.5">{gogCache?.owned.length || 0}</div>
                </div>
                <div className="bg-white/[0.02] p-1.5 rounded border border-white/5 flex flex-col justify-center">
                  <div className="text-slate-500 text-[9px] uppercase font-semibold">Wishlisted</div>
                  <div className="text-white font-mono text-xs font-bold mt-0.5">{gogCache?.wishlist.length || 0}</div>
                </div>
              </div>
            </div>
          </section>

          {/* SIDEBAR ANNOTATION CARD */}
          <section className="mt-auto">
            <div className="bg-indigo-500/10 border border-indigo-500/30 p-4 rounded-lg">
              <div className="flex gap-2.5">
                <Shield className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-indigo-300 leading-relaxed font-sans">
                  The automation engine applies <strong>Phase 3</strong> text-cleaning normalization algorithms to strip trailing symbols (™, ®) and punctuation before comparing wishlists.
                </p>
              </div>
            </div>
          </section>

        </aside>

        {/* RIGHT CENTRAL SECTION: VIEWS AND TERMINAL */}
        <section className="flex-1 flex flex-col bg-[#0a0a0c] overflow-hidden">
          
          {/* TAB BAR AND SEARCH CONTROLS */}
          <div className="p-6 pb-0 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveTab('alerts')}
                  className={`text-sm pb-1 font-semibold uppercase tracking-wider transition-all border-b-2 ${activeTab === 'alerts' ? 'border-teal-500 text-teal-400' : 'border-transparent text-slate-400 hover:text-white'}`}
                >
                  Deal Alerts
                </button>
                <button
                  onClick={() => setActiveTab('pipeline')}
                  className={`text-sm pb-1 font-semibold uppercase tracking-wider transition-all border-b-2 ${activeTab === 'pipeline' ? 'border-teal-500 text-teal-400' : 'border-transparent text-slate-400 hover:text-white'}`}
                >
                  Cross-Ref Pipeline
                </button>
                <button
                  onClick={() => setActiveTab('cache')}
                  className={`text-sm pb-1 font-semibold uppercase tracking-wider transition-all border-b-2 ${activeTab === 'cache' ? 'border-teal-500 text-teal-400' : 'border-transparent text-slate-400 hover:text-white'}`}
                >
                  PSN Local Database
                </button>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={downloadPayload}
                  disabled={!alertPayload}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[10px] uppercase font-bold tracking-widest text-slate-400 hover:text-white flex items-center gap-1.5 transition-all"
                >
                  <Download className="w-3 h-3" />
                  Export JSON
                </button>


              </div>
            </div>

            {/* QUICK STATS BAR */}
            {alertPayload && activeTab === 'alerts' && (
              <div className="grid grid-cols-5 gap-3 bg-white/[0.02] border border-white/5 p-3.5 rounded-lg text-xs">
                <div className="border-r border-white/10 pr-2">
                  <div className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-0.5">Evaluated</div>
                  <div className="font-mono text-lg font-bold text-slate-300">{alertPayload.summary.total_wishlisted_evaluated}</div>
                </div>
                <div className="border-r border-white/10 px-2">
                  <div className="text-rose-500 text-[10px] uppercase font-bold tracking-wider mb-0.5">Owned (Filtered)</div>
                  <div className="font-mono text-lg font-bold text-rose-400">{alertPayload.summary.total_owned_filtered_out}</div>
                </div>
                <div className="border-r border-white/10 px-2">
                  <div className="text-emerald-500 text-[10px] uppercase font-bold tracking-wider mb-0.5">Surviving Wishlist</div>
                  <div className="font-mono text-lg font-bold text-emerald-400">{alertPayload.summary.total_remaining_alerts}</div>
                </div>
                <div className="border-r border-white/10 px-2">
                  <div className="text-teal-400 text-[10px] uppercase font-bold tracking-wider mb-0.5">Active Deals</div>
                  <div className="font-mono text-lg font-bold text-teal-300">{alertPayload.summary.active_deals_found}</div>
                </div>
                <div className="pl-2">
                  <div className="text-indigo-400 text-[10px] uppercase font-bold tracking-wider mb-0.5">Sub Catalog Fits</div>
                  <div className="font-mono text-lg font-bold text-indigo-300">{alertPayload.summary.subscription_catalog_matches}</div>
                </div>
              </div>
            )}
          </div>

          {/* DYNAMIC TAB COMPONENT WORKSPACE */}
          <div className="flex-1 p-6 overflow-hidden flex flex-col">
            
            {/* TAB 1: DEAL ALERTS VIEW */}
            {activeTab === 'alerts' && (
              <div className="flex-1 flex flex-col border border-white/10 rounded-lg overflow-hidden bg-[#0f1115]">
                {/* Filters */}
                <div className="p-4 bg-white/5 border-b border-white/10 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <ListFilter className="w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Filter by game title or token..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="px-3 py-1.5 bg-black/30 border border-white/10 rounded-md text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-teal-500/40 w-64"
                    />
                    
                    <select
                      value={colFilterSource}
                      onChange={(e) => setColFilterSource(e.target.value)}
                      className="px-2 py-1.5 bg-black/30 border border-white/10 rounded-md text-xs text-slate-300 focus:outline-none focus:border-teal-500/40"
                    >
                      <option value="all">All Platforms</option>
                      <option value="Steam">Steam Wishlist</option>
                      <option value="GOG">GOG Wishlist</option>
                      <option value="PSN">PSN Wishlist</option>
                    </select>
                  </div>
                  
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">
                    Showing {filteredAlerts.length} out of {alertPayload?.alerts.length || 0} synchronized alerts
                  </div>
                </div>

                {/* Grid Table */}
                <div className="flex-1 overflow-y-auto">
                  {/* Sortable Header Row */}
                  <div className="grid grid-cols-6 text-[10px] uppercase tracking-widest p-4 bg-black/20 border-b border-white/10 text-slate-500 font-bold sticky top-0 backdrop-blur-sm select-none">
                    <SortableHeader field="title" label="Normalized Game Title" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} extraClassName="text-[11px]" style={{ width: '126.569px' }} />
                    <SortableHeader field="source" label="Source Wishlist" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                    <SortableHeader field="itad" label="ITAD Price & Cut" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                    <SortableHeader field="ps" label="PS Store Deal" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                    <SortableHeader field="catalog" label="Catalog / Launcher fits" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} style={{ width: '69.588px' }} />
                    <div className="text-right whitespace-normal break-words leading-tight">Action</div>
                  </div>

                  {/* Column Filters Row */}
                  <div className="grid grid-cols-6 px-4 py-2 bg-black/40 border-b border-white/10 gap-2 items-center sticky top-[48px] backdrop-blur-sm z-10">
                    {/* Column 1: Title Filter Input */}
                    <div style={{ width: '126.569px' }} className="pr-1">
                      <input
                        type="text"
                        placeholder="Filter title..."
                        value={colFilterTitle}
                        onChange={(e) => setColFilterTitle(e.target.value)}
                        className="w-full px-1.5 py-1 bg-black/60 border border-white/10 rounded text-[10px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-teal-500/40 font-mono"
                      />
                    </div>

                    {/* Column 2: Source Wishlist Dropdown */}
                    <div className="pr-1">
                      <select
                        value={colFilterSource}
                        onChange={(e) => setColFilterSource(e.target.value)}
                        className="w-full px-1 py-1 bg-black/60 border border-white/10 rounded text-[10px] text-slate-300 focus:outline-none focus:border-teal-500/40"
                      >
                        <option value="all">All</option>
                        <option value="Steam">Steam</option>
                        <option value="GOG">GOG</option>
                        <option value="PSN">PSN</option>
                      </select>
                    </div>

                    {/* Column 3: ITAD Price Filter Dropdown */}
                    <div className="pr-1">
                      <select
                        value={colFilterItad}
                        onChange={(e) => setColFilterItad(e.target.value)}
                        className="w-full px-1 py-1 bg-black/60 border border-white/10 rounded text-[10px] text-slate-300 focus:outline-none focus:border-teal-500/40"
                      >
                        <option value="all">All Prices</option>
                        <option value="deal">Has Deal</option>
                        <option value="discount-50">≥ 50% Off</option>
                        <option value="no-deal">No PC Deal</option>
                      </select>
                    </div>

                    {/* Column 4: PS Store Deal Filter Dropdown */}
                    <div className="pr-1">
                      <select
                        value={colFilterPs}
                        onChange={(e) => setColFilterPs(e.target.value)}
                        className="w-full px-1 py-1 bg-black/60 border border-white/10 rounded text-[10px] text-slate-300 focus:outline-none focus:border-teal-500/40"
                      >
                        <option value="all">All Prices</option>
                        <option value="deal">Has Deal</option>
                        <option value="discount-50">≥ 50% Off</option>
                        <option value="no-deal">No PS Deal</option>
                      </select>
                    </div>

                    {/* Column 5: Catalog / Launcher Filter Dropdown */}
                    <div style={{ width: '69.588px' }} className="pr-1">
                      <select
                        value={colFilterCatalog}
                        onChange={(e) => setColFilterCatalog(e.target.value)}
                        className="w-full px-0.5 py-1 bg-black/60 border border-white/10 rounded text-[10px] text-slate-300 focus:outline-none focus:border-teal-500/40"
                      >
                        <option value="all">All Fits</option>
                        <option value="any">Any Fit</option>
                        <option value="ps_plus">PS+</option>
                        <option value="luna">Luna</option>
                        <option value="gfn">GFN</option>
                        <option value="none">No Fits</option>
                      </select>
                    </div>

                    {/* Column 6: Reset / Summary Button */}
                    <div className="text-right flex justify-end">
                      {(colFilterTitle || colFilterSource !== 'all' || colFilterItad !== 'all' || colFilterPs !== 'all' || colFilterCatalog !== 'all' || searchQuery || sortField) ? (
                        <button
                          onClick={() => {
                            setColFilterTitle('');
                            setColFilterSource('all');
                            setFilterSource('all');
                            setColFilterItad('all');
                            setColFilterPs('all');
                            setColFilterCatalog('all');
                            setSearchQuery('');
                            setSortField(null);
                          }}
                          className="px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-all"
                          title="Reset All Filters & Sort"
                        >
                          <FilterX className="w-3 h-3" />
                          Reset
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-600 uppercase font-bold tracking-widest mr-1">ACTIVE</span>
                      )}
                    </div>
                  </div>

                  <div className="font-mono text-xs divide-y divide-white/5">
                    {filteredAlerts.length === 0 ? (
                      <div className="p-8 text-center text-slate-500 font-sans">
                        No synchronized deal alerts matches found. Run the sync agent above to populate this panel!
                      </div>
                    ) : (
                      filteredAlerts.map((alert, index) => (
                        <div 
                          key={alert.normalized_title + index} 
                          onClick={() => setSelectedAlert(alert)}
                          className={`grid grid-cols-6 p-4 items-center cursor-pointer transition-all ${selectedAlert?.normalized_title === alert.normalized_title ? 'bg-teal-900/10 border-l-2 border-teal-500' : 'hover:bg-white/[0.02]'}`}
                        >
                          <div className="font-bold text-white uppercase tracking-tight break-words whitespace-normal leading-tight pr-2">{alert.title}</div>
                          
                          <div className="flex gap-1.5 flex-wrap">
                            {alert.wishlist_source.map(source => (
                              <span 
                                key={source} 
                                className={`text-[9px] px-1.5 py-0.5 rounded font-sans uppercase font-bold tracking-wider ${getPlatformBadgeClass(source)}`}
                              >
                                {source}
                              </span>
                            ))}
                          </div>

                          <div>
                            {alert.deal_found ? (
                              <div className="text-teal-400 flex items-center gap-1.5 font-bold">
                                <span>${alert.price_current?.toFixed(2)}</span>
                                <span className="bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[10px] px-1 py-0.2 rounded">
                                  -{alert.discount_percent}%
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-500 italic text-[11px]">No PC Deal</span>
                            )}
                          </div>

                          <div>
                            {alert.ps_deal_found ? (
                              <div className="text-sky-400 flex items-center gap-1.5 font-bold">
                                <span>${alert.ps_price_current?.toFixed(2)}</span>
                                <span className="bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[10px] px-1 py-0.2 rounded">
                                  -{alert.ps_discount_percent}%
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-500 italic text-[11px]">No PS Deal</span>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-1 items-center">
                            {alert.ps_plus_premium && (
                              <span className="bg-teal-500/10 border border-teal-500/20 text-teal-300 text-[9px] font-bold tracking-wider uppercase font-sans px-2 py-0.5 rounded shadow-[0_0_8px_rgba(20,184,166,0.1)]">
                                PS+ PREMIUM
                              </span>
                            )}
                            {alert.luna_tier && (
                              <span className="bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[9px] font-bold tracking-wider uppercase font-sans px-2 py-0.5 rounded">
                                AMAZON LUNA
                              </span>
                            )}
                            {alert.gfn_supported ? (
                              <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-bold tracking-wider uppercase font-sans px-2 py-0.5 rounded" title={`GFN launchers: ${alert.gfn_launchers.join(', ')}`}>
                                GFN SUPPORTED
                              </span>
                            ) : (
                              alert.wishlist_source.length > 0 && !alert.ps_plus_premium && !alert.luna_tier && (
                                <span className="text-slate-600 italic text-[10px]">None</span>
                              )
                            )}
                          </div>

                          <div className="text-right flex flex-col items-end gap-1">
                            {alert.url && (
                              <a 
                                href={alert.url} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="inline-flex items-center gap-1 text-[10px] text-teal-400 hover:text-teal-300 underline font-semibold font-sans uppercase tracking-wider truncate max-w-[120px]"
                              >
                                {alert.shop_name || 'PC Store'}
                                <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                              </a>
                            )}
                            {alert.ps_url && (
                              <a 
                                href={alert.ps_url} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="inline-flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 underline font-semibold font-sans uppercase tracking-wider"
                              >
                                PS Store
                                <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                              </a>
                            )}
                            {!alert.url && !alert.ps_url && (
                              <span className="text-slate-600">—</span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: PIPELINE ANALYSIS */}
            {activeTab === 'pipeline' && (
              <div className="flex-1 grid grid-cols-3 gap-4 overflow-hidden">
                
                {/* 1. MASTER OWNED GAMES */}
                <div className="flex flex-col border border-white/10 rounded-lg bg-[#0f1115] overflow-hidden">
                  <div className="p-3 bg-white/5 border-b border-white/10 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">1. Consolidated Owned Set</span>
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono font-bold">
                      N={(steamCache?.owned?.length || 0) + (gogCache?.owned?.length || 0)}
                    </span>
                  </div>
                  <div className="p-3 bg-black/20 border-b border-white/5">
                    <p className="text-[10px] text-slate-500 leading-relaxed font-sans mb-2">
                      Games owned on Steam or GOG. If a wishlisted game matches any title in this column, it is filtered out.
                    </p>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs">
                    {/* Render standard known owned lists */}
                    <div className="space-y-1.5">
                      <div className="text-[10px] uppercase text-blue-400 font-sans tracking-widest font-bold">Steam Owned ({steamCache?.owned?.length || 0}):</div>
                      {(steamCache?.owned || ["The Witcher 3: Wild Hunt", "Hades", "Disco Elysium", "Stardew Valley", "Baldur's Gate 3"]).map(g => (
                        <div key={g} className="bg-white/[0.02] border border-white/5 p-1.5 rounded flex items-center justify-between">
                          <span className="text-slate-300">{g}</span>
                          <span className="text-[9px] text-blue-400 font-sans">STEAM</span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-3 space-y-1.5">
                      <div className="text-[10px] uppercase text-purple-400 font-sans tracking-widest font-bold">GOG Owned ({gogCache?.owned?.length || 0}):</div>
                      {(gogCache?.owned || ["Cyberpunk 2077", "The Witcher 3: Wild Hunt"]).map(g => (
                        <div key={g} className="bg-white/[0.02] border border-white/5 p-1.5 rounded flex items-center justify-between">
                          <span className="text-slate-300">{g}</span>
                          <span className="text-[9px] text-purple-400 font-sans">GOG</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 2. RAW WISHLISTS */}
                <div className="flex flex-col border border-white/10 rounded-lg bg-[#0f1115] overflow-hidden">
                  <div className="p-3 bg-white/5 border-b border-white/10 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">2. Wishlisted Games</span>
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono font-bold">
                      N={(steamCache?.wishlist?.length || 0) + (gogCache?.wishlist?.length || 0) + (psnCache?.wishlist?.length || 0)}
                    </span>
                  </div>
                  <div className="p-3 bg-black/20 border-b border-white/5">
                    <p className="text-[10px] text-slate-500 leading-relaxed font-sans mb-2">
                      All titles gathered from Steam, GOG, and PSN wishlists before filtering.
                    </p>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-xs">
                    <div className="space-y-1.5">
                      <div className="text-[10px] uppercase text-blue-400 font-sans tracking-widest font-bold">Steam Wishlist ({steamCache?.wishlist?.length || 0}):</div>
                      {(steamCache?.wishlist || ["Elden Ring", "Outer Wilds", "Horizon Forbidden West Complete Edition", "Ghost of Tsushima Director's Cut", "Cyberpunk 2077"]).map(g => (
                        <div key={g} className="bg-white/[0.02] border border-white/5 p-1.5 rounded flex items-center justify-between">
                          <span className="text-slate-300 truncate max-w-[160px]">{g}</span>
                          <span className="text-[8px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-1.5 py-0.2 rounded font-sans">UNFILTERED</span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 space-y-1.5">
                      <div className="text-[10px] uppercase text-purple-400 font-sans tracking-widest font-bold">GOG Wishlist ({gogCache?.wishlist?.length || 0}):</div>
                      {(gogCache?.wishlist || ["Cyberpunk 2077", "Slay the Spire", "Dead Cells"]).map(g => (
                        <div key={g} className="bg-white/[0.02] border border-white/5 p-1.5 rounded flex items-center justify-between">
                          <span className="text-slate-300">{g}</span>
                          <span className="text-[8px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-1.5 py-0.2 rounded font-sans">UNFILTERED</span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 space-y-1.5">
                      <div className="text-[10px] uppercase text-sky-400 font-sans tracking-widest font-bold">PSN Wishlist ({psnCache?.wishlist?.length || 0}):</div>
                      {psnCache?.wishlist.map(g => (
                        <div key={g} className="bg-white/[0.02] border border-white/5 p-1.5 rounded flex items-center justify-between">
                          <span className="text-slate-300 truncate max-w-[160px]">{g}</span>
                          <span className="text-[8px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-1.5 py-0.2 rounded font-sans">UNFILTERED</span>
                        </div>
                      )) || <div className="text-slate-600 italic">No cache found</div>}
                    </div>
                  </div>
                </div>

                {/* 3. FINAL DEEP EXCLUSION FLOW */}
                <div className="flex flex-col border border-white/10 rounded-lg bg-[#0f1115] overflow-hidden">
                  <div className="p-3 bg-white/5 border-b border-white/10 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">3. Cross-Filtering Logic</span>
                    <span className="text-[10px] bg-teal-500/10 text-teal-400 border border-teal-500/20 px-1.5 py-0.5 rounded font-mono font-bold">ALERTS</span>
                  </div>
                  <div className="p-4 flex-1 flex flex-col justify-between font-sans text-xs">
                    <div className="space-y-4">
                      <div className="bg-teal-950/10 border border-teal-500/20 p-3 rounded-lg">
                        <h4 className="text-teal-400 font-bold mb-1 uppercase tracking-wider text-[11px]">The GOG Cyberpunk Case</h4>
                        <p className="text-slate-400 leading-relaxed text-[11px]">
                          Cyberpunk 2077 is wishlisted on Steam, but since the user owns Cyberpunk 2077 on GOG, the normalizer detects the match and drops it from Steam's evaluated wishlist, saving you money!
                        </p>
                      </div>

                      <div className="bg-rose-950/10 border border-rose-500/20 p-3 rounded-lg">
                        <h4 className="text-rose-400 font-bold mb-1 uppercase tracking-wider text-[11px]">PlayStation Cache System</h4>
                        <p className="text-slate-400 leading-relaxed text-[11px]">
                          To avoid blocking pipeline queries due to slow live web handshake timeouts or rate limits, PSN queries read directly from <code className="bg-slate-800 text-slate-200 px-1 rounded">playstation_cache.json</code>.
                        </p>
                      </div>

                      <div className="bg-indigo-950/10 border border-indigo-500/20 p-3 rounded-lg">
                        <h4 className="text-indigo-400 font-bold mb-1 uppercase tracking-wider text-[11px]">IsThereAnyDeal V2 API</h4>
                        <p className="text-slate-400 leading-relaxed text-[11px]">
                          Instead of simple scrapes, the engine resolves slugs against the official ITAD UUID table and retrieves precise cuts, checking for specialized tiers like Amazon Luna.
                        </p>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-white/5 text-center">
                      <span className="text-[10px] text-slate-500 font-mono">NORMALIZE &rarr; RESOLVE &rarr; COMPARE &rarr; FILTER</span>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* TAB 3: PSN LOCAL DATABASE */}
            {activeTab === 'cache' && (
              <div className="flex-1 flex flex-col overflow-hidden gap-4">
                {/* PLATFORM SUB-SELECTOR */}
                <div className="flex items-center gap-2 border-b border-white/5 pb-2 shrink-0">
                  <button
                    onClick={() => {
                      setCachePlatform('psn');
                      setBulkModeOwned(false);
                      setBulkModeWishlist(false);
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                      cachePlatform === 'psn'
                        ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                        : 'bg-white/5 text-slate-400 hover:text-white border border-transparent'
                    }`}
                  >
                    <Gamepad className="w-3.5 h-3.5" />
                    PlayStation Database
                  </button>
                  <button
                    onClick={() => {
                      setCachePlatform('steam');
                      setBulkModeOwned(false);
                      setBulkModeWishlist(false);
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                      cachePlatform === 'steam'
                        ? 'bg-teal-500/20 text-teal-400 border border-teal-500/40'
                        : 'bg-white/5 text-slate-400 hover:text-white border border-transparent'
                    }`}
                  >
                    <Gamepad className="w-3.5 h-3.5" />
                    Steam Database
                  </button>
                  <button
                    onClick={() => {
                      setCachePlatform('gog');
                      setBulkModeOwned(false);
                      setBulkModeWishlist(false);
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                      cachePlatform === 'gog'
                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                        : 'bg-white/5 text-slate-400 hover:text-white border border-transparent'
                    }`}
                  >
                    <Gamepad className="w-3.5 h-3.5" />
                    GOG Database
                  </button>
                  
                  <div className="ml-auto text-[10px] font-mono text-slate-500 uppercase">
                    Last Updated: {
                      cachePlatform === 'psn'
                        ? (psnCache?.updated_at ? new Date(psnCache.updated_at).toLocaleTimeString() : 'Never')
                        : cachePlatform === 'steam'
                          ? (steamCache?.updated_at ? new Date(steamCache.updated_at).toLocaleTimeString() : 'Never')
                          : (gogCache?.updated_at ? new Date(gogCache.updated_at).toLocaleTimeString() : 'Never')
                    }
                  </div>
                </div>

                <div className={`flex-1 grid gap-6 overflow-hidden ${cachePlatform === 'psn' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {/* OWNED CACHE LIST */}
                  {cachePlatform !== 'psn' && (
                    <div className="flex flex-col border border-[#22252a] rounded-lg bg-[#0f1115] overflow-hidden">
                      <div className="p-4 bg-white/5 border-b border-white/10 flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                          <Gamepad className={`w-4 h-4 ${cachePlatform === 'steam' ? 'text-teal-400' : 'text-purple-400'}`} />
                          {cachePlatform.toUpperCase()} Owned Games Catalog
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setBulkModeOwned(!bulkModeOwned)}
                            className="text-[9px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-0.5 rounded font-mono uppercase transition-all"
                          >
                            {bulkModeOwned ? "Single Add" : "Bulk Paste"}
                          </button>
                          <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                            {cachePlatform === 'steam' ? (steamCache?.owned.length || 0) : (gogCache?.owned.length || 0)} Titles
                          </span>
                        </div>
                      </div>

                      {bulkModeOwned ? (
                        <div className="p-3.5 bg-black/30 border-b border-white/5 flex flex-col gap-2">
                          <textarea
                            placeholder={`Paste owned titles here, one per line (e.g. ${cachePlatform === 'steam' ? 'Elden Ring' : 'Cyberpunk 2077'})...`}
                            value={bulkTextOwned}
                            onChange={(e) => setBulkTextOwned(e.target.value)}
                            rows={3}
                            className="w-full px-3 py-1.5 bg-black/40 border border-[#22252a] rounded text-xs text-white focus:outline-none focus:border-teal-500/50 font-mono resize-none"
                          />
                          <button
                            onClick={() => handleBulkImport('owned')}
                            className="w-full py-1.5 bg-teal-500 hover:bg-teal-400 text-black rounded text-xs font-bold uppercase tracking-wider transition-all"
                          >
                            Import Bulk List
                          </button>
                        </div>
                      ) : (
                        <div className="p-3.5 bg-black/30 border-b border-white/5 flex gap-2">
                          <input
                            type="text"
                            placeholder={`Add owned title (e.g., ${cachePlatform === 'steam' ? 'Elden Ring' : 'Cyberpunk 2077'})...`}
                            value={newTitleInputs[cachePlatform].owned}
                            onChange={(e) => setNewTitle(cachePlatform, 'owned', e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddCacheItem('owned')}
                            className="flex-1 px-3 py-1.5 bg-black/40 border border-[#22252a] rounded text-xs text-white focus:outline-none focus:border-teal-500/50"
                          />
                          <button
                            onClick={() => handleAddCacheItem('owned')}
                            className="px-3 py-1.5 bg-teal-500 hover:bg-teal-400 text-black rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1 transition-all"
                          >
                            <Plus className="w-3.5 h-3.5 stroke-[3px]" />
                            Add
                          </button>
                        </div>
                      )}

                      <div className="flex-1 overflow-y-auto p-4 space-y-1.5 font-mono text-xs">
                        {((cachePlatform === 'steam' ? steamCache?.owned : gogCache?.owned) || []).map(title => (
                          <div key={title} className="flex items-center justify-between p-2 rounded bg-white/[0.02] border border-white/5 group hover:bg-white/[0.04] transition-all">
                            <span className="text-slate-300 font-bold uppercase tracking-tight">{title}</span>
                            <button
                              onClick={() => handleRemoveCacheItem('owned', title)}
                              className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-300 transition-all p-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* WISHLIST CACHE LIST */}
                  <div className="flex flex-col border border-[#22252a] rounded-lg bg-[#0f1115] overflow-hidden">
                    <div className="p-4 bg-white/5 border-b border-white/10 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                        <Gamepad className={`w-4 h-4 ${cachePlatform === 'psn' ? 'text-pink-400' : cachePlatform === 'steam' ? 'text-teal-400' : 'text-purple-400'}`} />
                        {cachePlatform.toUpperCase()} Wishlist Catalog
                      </span>
                      <div className="flex items-center gap-2">
                        {cachePlatform !== 'steam' && (
                          <button
                            onClick={() => setBulkModeWishlist(!bulkModeWishlist)}
                            className="text-[9px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-0.5 rounded font-mono uppercase transition-all"
                          >
                            {bulkModeWishlist ? "Single Add" : "Bulk Paste"}
                          </button>
                        )}
                        <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                          {cachePlatform === 'psn' ? (psnCache?.wishlist.length || 0) : cachePlatform === 'steam' ? (steamCache?.wishlist.length || 0) : (gogCache?.wishlist.length || 0)} Titles
                        </span>
                      </div>
                    </div>

                    {cachePlatform === 'steam' ? (
                      <div className="p-4 flex-1 flex flex-col gap-3.5 overflow-hidden">
                        <div className="flex-1 flex flex-col gap-2 overflow-hidden">
                          <label className="text-[10px] uppercase font-sans tracking-widest font-bold text-teal-400">Paste Steam Wishlist JSON (AppID keys):</label>
                          <p className="text-[10px] text-slate-500 font-sans leading-normal">
                            Paste the JSON containing App IDs as keys (e.g. from your saved Steam configurations or export).
                          </p>
                          <textarea
                            placeholder='{\n  "1245620": {},\n  "753640": {}\n}'
                            value={steamWishlistJson}
                            onChange={(e) => setSteamWishlistJson(e.target.value)}
                            className="flex-1 p-3 bg-black/40 border border-[#22252a] rounded text-xs text-teal-300 focus:outline-none focus:border-teal-500/50 font-mono resize-none h-44"
                          />
                        </div>
                        <button
                          onClick={triggerSteamCatalogRefresh}
                          disabled={isRefreshingSteamCatalog || isRunning}
                          className="w-full py-2.5 bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 disabled:from-slate-850 disabled:to-slate-850 text-black font-bold uppercase text-xs tracking-wider rounded-md flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(20,184,166,0.15)] transition-all disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingSteamCatalog ? 'animate-spin' : ''}`} />
                          Refresh Steam Catalogue
                        </button>
                        
                        <div className="pt-2 border-t border-white/5 overflow-hidden flex flex-col">
                          <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Resolved Games ({steamCache?.wishlist.length || 0}):</span>
                          <div className="mt-2 space-y-1 max-h-44 overflow-y-auto pr-1">
                            {(steamCache?.wishlist || []).map(title => (
                              <div key={title} className="flex items-center justify-between p-1.5 rounded bg-white/[0.01] border border-white/5 font-mono text-[10px]">
                                <span className="text-slate-300 truncate">{title}</span>
                                <span className="text-[8px] bg-teal-500/10 text-teal-400 border border-teal-500/20 px-1 py-0.2 rounded font-sans">RESOLVED</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        {bulkModeWishlist ? (
                          <div className="p-3.5 bg-black/30 border-b border-white/5 flex flex-col gap-2">
                            <textarea
                              placeholder={`Paste wishlist titles here, one per line (e.g. ${cachePlatform === 'psn' ? 'Bloodborne' : cachePlatform === 'steam' ? 'Outer Wilds' : 'Slay the Spire'})...`}
                              value={bulkTextWishlist}
                              onChange={(e) => setBulkTextWishlist(e.target.value)}
                              rows={3}
                              className="w-full px-3 py-1.5 bg-black/40 border border-[#22252a] rounded text-xs text-white focus:outline-none focus:border-teal-500/50 font-mono resize-none"
                            />
                            <button
                              onClick={() => handleBulkImport('wishlist')}
                              className="w-full py-1.5 bg-teal-500 hover:bg-teal-400 text-black rounded text-xs font-bold uppercase tracking-wider transition-all"
                            >
                              Import Bulk List
                            </button>
                          </div>
                        ) : (
                          <div className="p-3.5 bg-black/30 border-b border-white/5 flex gap-2">
                            <input
                              type="text"
                              placeholder={`Add wishlist title (e.g., ${cachePlatform === 'psn' ? 'Bloodborne' : cachePlatform === 'steam' ? 'Outer Wilds' : 'Slay the Spire'})...`}
                              value={newTitleInputs[cachePlatform].wishlist}
                              onChange={(e) => setNewTitle(cachePlatform, 'wishlist', e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleAddCacheItem('wishlist')}
                              className="flex-1 px-3 py-1.5 bg-black/40 border border-[#22252a] rounded text-xs text-white focus:outline-none focus:border-teal-500/50"
                            />
                            <button
                              onClick={() => handleAddCacheItem('wishlist')}
                              className="px-3 py-1.5 bg-teal-500 hover:bg-teal-400 text-black rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1 transition-all"
                            >
                              <Plus className="w-3.5 h-3.5 stroke-[3px]" />
                              Add
                            </button>
                          </div>
                        )}

                        <div className="flex-1 overflow-y-auto p-4 space-y-1.5 font-mono text-xs">
                          {((cachePlatform === 'psn' ? psnCache?.wishlist : cachePlatform === 'steam' ? steamCache?.wishlist : gogCache?.wishlist) || []).map(title => (
                            <div key={title} className="flex items-center justify-between p-2 rounded bg-white/[0.02] border border-white/5 group hover:bg-white/[0.04] transition-all">
                              <span className="text-slate-300 font-bold uppercase tracking-tight">{title}</span>
                              <button
                                onClick={() => handleRemoveCacheItem('wishlist', title)}
                                className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-300 transition-all p-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* SYSTEM CONSOLE TERMINAL (BOTTOM) */}
          <div className="h-56 bg-black/50 border-t border-white/10 p-5 font-mono text-[11px] text-slate-400 flex flex-col justify-between shrink-0">
            <div className="flex items-center justify-between mb-2 text-slate-500 uppercase text-[9px] font-bold tracking-widest shrink-0 border-b border-white/5 pb-1.5">
              <span>Live Pipeline Console Logs</span>
              <div className="flex items-center gap-3">
                <span>Thread: #8112</span>
                <button 
                  onClick={() => setCurrentLogs(["[SYSTEM] Logs cleared."])} 
                  className="text-slate-500 hover:text-slate-300 text-[8px] uppercase tracking-wider"
                >
                  Clear Logs
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-1 pr-2 select-text custom-scrollbar">
              {currentLogs.map((log, index) => {
                let colorClass = "text-slate-400";
                if (log.startsWith("❌") || log.includes("[ERROR]") || log.startsWith("[FATAL]")) colorClass = "text-rose-400 font-bold";
                else if (log.startsWith("✅") || log.includes("[SUCCESS]") || log.includes("refreshed successfully")) colorClass = "text-teal-400";
                else if (log.startsWith("🚀") || log.includes("[ALERT]")) colorClass = "text-yellow-400 font-semibold";
                else if (log.includes("[PROCESS]")) colorClass = "text-slate-300";
                else if (log.startsWith("🎮") || log.includes("[INFO]")) colorClass = "text-teal-500";
                else if (log.startsWith("⚠️") || log.includes("[WARN]")) colorClass = "text-amber-500";
                
                return (
                  <p key={index} className={colorClass}>
                    {log}
                  </p>
                );
              })}
              <div ref={terminalBottomRef} />
            </div>

            <div className="mt-2 text-teal-400 font-bold animate-pulse shrink-0">
              _
            </div>
          </div>

        </section>
      </main>

      {/* SECRETS CONFIGURATION MODAL */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1115] border border-white/15 rounded-lg w-full max-w-lg p-6 shadow-2xl relative">
            <div className="flex items-center gap-2.5 mb-4 border-b border-white/5 pb-3">
              <Key className="w-5 h-5 text-teal-400" />
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">Pipeline Secrets Configuration</h3>
                <p className="text-[10px] text-slate-500 font-mono">Stored on-disk securely within local environment workspace</p>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] text-slate-400 font-bold uppercase font-sans">Steam Account ID</label>
                    <button 
                      type="button" 
                      onClick={() => setShowSteamHelp(!showSteamHelp)}
                      className="text-[9px] text-teal-400 hover:underline uppercase flex items-center gap-0.5"
                    >
                      <HelpCircle className="w-3 h-3" />
                      Troubleshoot
                    </button>
                  </div>
                  <input
                    type="text"
                    value={secrets.STEAM_ID}
                    onChange={(e) => setSecrets({ ...secrets, STEAM_ID: e.target.value })}
                    placeholder="e.g., 76561198035123456"
                    autoComplete="off"
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-slate-200 focus:outline-none focus:border-teal-500 font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-bold uppercase font-sans">GOG Username</label>
                  <input
                    type="text"
                    value={secrets.GOG_USERNAME}
                    onChange={(e) => setSecrets({ ...secrets, GOG_USERNAME: e.target.value })}
                    placeholder="e.g., gog_explorer_user"
                    autoComplete="off"
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-slate-200 focus:outline-none focus:border-teal-500 font-mono"
                  />
                </div>
              </div>

              {showSteamHelp && (
                <div className="mt-2 p-3 bg-teal-950/20 border border-teal-500/25 rounded text-[11px] leading-relaxed text-slate-300 font-sans space-y-2">
                  <p className="font-bold text-teal-400 flex items-center gap-1">
                    <span>🎮 Steam ID & Privacy Troubleshooting:</span>
                  </p>
                  <ol className="list-decimal pl-4 space-y-1 text-[10px] text-slate-300">
                    <li>
                      <strong>Finding your correct Steam ID or Vanity Slug:</strong>
                      <p className="text-slate-400 mt-0.5">
                        Open your Steam Profile page in a browser. Check the URL:
                        <br />• If it's <code className="text-teal-300 font-mono">/profiles/76561198035123456/</code>, copy the number <code className="text-teal-300 font-mono">76561198035123456</code>.
                        <br />• If it's <code className="text-teal-300 font-mono">/id/mycustomname/</code>, copy the vanity slug <code className="text-teal-300 font-mono">mycustomname</code>.
                        <br />• <em>Tip:</em> You can paste the **entire profile URL** into the input above; our sync agent will automatically extract the clean ID!
                        <br />• <em>Warning:</em> Do <strong>NOT</strong> enter your display username (e.g., "GamerPro123").
                      </p>
                    </li>
                    <li>
                      <strong>Configuring your Privacy settings:</strong>
                      <p className="text-slate-400 mt-0.5">
                        In Steam, edit your Profile &rarr; select <strong>Privacy Settings</strong>.
                        <br />• Set <strong>My Profile</strong> to <strong className="text-emerald-400">Public</strong>.
                        <br />• Set <strong>Game Details</strong> to <strong className="text-emerald-400">Public</strong> (this controls access to your wishlist and owned library).
                        <br />• Keep the checkbox <strong className="text-slate-200">"Keep my total playtime private"</strong> unchecked.
                      </p>
                    </li>
                    <li>
                      <strong>Rate Limiting / Cloud IP blocks:</strong>
                      <p className="text-slate-400 mt-0.5">
                        Steam aggressively throttles cloud IP ranges (like GCP). If your settings are 100% public but you still see fetch errors, wait a minute and retry, or use the <strong>PSN/Steam/GOG Local Database</strong> tab on the dashboard to manually bulk-import/edit your games to bypass the API entirely!
                      </p>
                    </li>
                  </ol>
                </div>
              )}

              <div className="space-y-1.5 relative">
                <label className="text-[10px] text-slate-400 font-bold uppercase font-sans flex items-center justify-between">
                  <span>Steam Web API Key</span>
                  <button 
                    type="button" 
                    onClick={() => toggleShowSecret('STEAM_API_KEY')}
                    className="text-[9px] text-teal-400 hover:underline uppercase"
                  >
                    {showSecrets.STEAM_API_KEY ? 'Hide' : 'Show'}
                  </button>
                </label>
                <input
                  type="text"
                  value={secrets.STEAM_API_KEY}
                  onChange={(e) => setSecrets({ ...secrets, STEAM_API_KEY: e.target.value })}
                  placeholder="Insert 32-character Steam Web API hex key..."
                  autoComplete="off"
                  style={{ WebkitTextSecurity: showSecrets.STEAM_API_KEY ? 'none' : 'disc' } as any}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-slate-200 focus:outline-none focus:border-teal-500 font-mono"
                />
              </div>

              <div className="space-y-1.5 relative">
                <label className="text-[10px] text-slate-400 font-bold uppercase font-sans flex items-center justify-between">
                  <span>IsThereAnyDeal (ITAD) API Key</span>
                  <button 
                    type="button" 
                    onClick={() => toggleShowSecret('ITAD_API_KEY')}
                    className="text-[9px] text-teal-400 hover:underline uppercase"
                  >
                    {showSecrets.ITAD_API_KEY ? 'Hide' : 'Show'}
                  </button>
                </label>
                <input
                  type="text"
                  value={secrets.ITAD_API_KEY}
                  onChange={(e) => setSecrets({ ...secrets, ITAD_API_KEY: e.target.value })}
                  placeholder="Insert ITAD API key..."
                  autoComplete="off"
                  style={{ WebkitTextSecurity: showSecrets.ITAD_API_KEY ? 'none' : 'disc' } as any}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-slate-200 focus:outline-none focus:border-teal-500 font-mono"
                />
              </div>

              <div className="space-y-1.5 relative">
                <label className="text-[10px] text-slate-400 font-bold uppercase font-sans flex items-center justify-between">
                  <span>GOG OAuth2 Bearer Token (Optional)</span>
                  <button 
                    type="button" 
                    onClick={() => toggleShowSecret('GOG_OAUTH_TOKEN')}
                    className="text-[9px] text-teal-400 hover:underline uppercase"
                  >
                    {showSecrets.GOG_OAUTH_TOKEN ? 'Hide' : 'Show'}
                  </button>
                </label>
                <input
                  type="text"
                  value={secrets.GOG_OAUTH_TOKEN}
                  onChange={(e) => setSecrets({ ...secrets, GOG_OAUTH_TOKEN: e.target.value })}
                  placeholder="Insert GOG OAuth2 bearer token pattern..."
                  autoComplete="off"
                  style={{ WebkitTextSecurity: showSecrets.GOG_OAUTH_TOKEN ? 'none' : 'disc' } as any}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-slate-200 focus:outline-none focus:border-teal-500 font-mono"
                />
              </div>

              {saveStatus === 'success' && (
                <div className="p-3 bg-teal-500/10 border border-teal-500/20 text-teal-400 rounded flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  Secrets persisted successfully. Restarting agent pipeline.
                </div>
              )}

              {saveStatus === 'error' && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  Failed to write credentials. Check file permissions.
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveSecrets}
                  disabled={saveStatus === 'saving'}
                  className="px-4 py-2 bg-teal-500 hover:bg-teal-400 text-black rounded font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
                >
                  {saveStatus === 'saving' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Keys
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}

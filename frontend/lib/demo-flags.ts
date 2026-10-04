// Shared keys + the pre-paint script for the public-demo banner.
// Kept in a plain (non-"use client") module so the server layout can inline the script.

/** localStorage: last known `config.demoMode` ("1" / "0") so the banner can render before /api/config answers. */
export const DEMO_CACHE_KEY = "ensemblis_demo_mode";
/** sessionStorage: banner dismissed for this browser session. */
export const DEMO_DISMISS_KEY = "ensemblis_demo_banner_dismissed";

/**
 * Runs before first paint: sets <html data-demo="1"> from the cached flag and
 * <html data-demo-off> if dismissed this session — CSS then shows/hides the
 * server-rendered banner without a layout jump on repeat visits.
 */
export const demoInitScript = `(function(){try{var r=document.documentElement;var d=null,x=null;try{d=localStorage.getItem('${DEMO_CACHE_KEY}')}catch(e){}try{x=sessionStorage.getItem('${DEMO_DISMISS_KEY}')}catch(e){}if(d==='1')r.setAttribute('data-demo','1');if(x==='1')r.setAttribute('data-demo-off','');}catch(e){}})();`;

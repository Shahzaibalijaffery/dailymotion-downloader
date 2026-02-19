/**
 * Shared state and constants for the background script.
 * Load early; other modules depend on these.
 */
let videoData = {};
const processedConfigs = new Set();
const activeDownloads = new Map();
const downloadControllers = new Map();
const downloadInfo = new Map();
const parsingHLSVariants = new Set();
const activeChromeDownloads = new Map();
let webRequestListener = null;
let downloadsListener = null;
let pendingFileSizes = new Map();

const CONTENT_SCRIPT_FILES = [
  "scripts/utils.js",
  "scripts/storage.js",
  "scripts/messaging.js",
  "content/utils.js",
  "content/restoreDownloads.js",
  "content/downloadNotifications.js",
  "content/downloadButton.js",
  "content/content.js",
];
const INJECT_BUTTON_RETRY_DELAYS_MS = [6000, 12000];

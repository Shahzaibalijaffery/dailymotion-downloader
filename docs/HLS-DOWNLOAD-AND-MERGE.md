# How HLS Download and Merge Works

This document explains how the extension downloads Dailymotion HLS videos and merges them into a single file.

---

## 1. Overview

**HLS (HTTP Live Streaming)** splits a video into many small **segments** (e.g. 2–10 seconds each). The extension:

1. Fetches the **playlist** (.m3u8) to get the list of segment URLs.
2. **Downloads all segments** in batches (with retries).
3. **Merges** them in order into one file (MPEG-TS or fMP4).
4. Optionally **converts** to MP4 (FFmpeg.wasm); for very large files this is skipped and we save as .ts.
5. **Saves** the file via Chrome’s download API.

---

## 2. Playlist and Segments

- The user picks a quality (e.g. “544p (HLS)”); that points to a **variant playlist** URL.
- The extension fetches that .m3u8 and parses it to get:
  - **Segment URLs** (e.g. 2780 URLs for a long movie).
  - Optional **init segment** (for fMP4).
- Format is either **MPEG-TS** (`.ts` segments, sync byte `0x47`) or **fMP4** (fragmented MP4).

---

## 3. Downloading Segments

- Segments are downloaded in **batches** (e.g. 5 or 10 at a time) to limit concurrency and memory.
- Each segment is fetched with `fetch(segmentUrl)`; the response body is read as `arrayBuffer()` and stored with its **index** so order is preserved.
- **Retries**: Each segment is retried up to 5 times (with backoff for 503/429).
- Failed segments are collected and retried again at the end; if critical early segments are missing, the download fails.
- Progress is reported (e.g. “Downloading batch 550/556 (segments 2746–2750)”).

Result: an ordered list of **segment buffers** (ArrayBuffers), one per segment.

---

## 4. Merging: Two Paths

After all segments are downloaded, they are merged. There are **two paths** depending on total size.

### 4.1 “Creating blobs from segments in correct order”

- `segmentBuffers = orderedSegments.map(s => s.data)` → one ArrayBuffer per segment.
- These are grouped into **batch blobs** of 50 segments:
  - `batch = segmentBuffers.slice(i, i + 50)`
  - `batchBlob = new Blob(batch, { type: 'video/mp2t' or 'video/mp4' })`
- So we get an array **segmentBlobs**: each entry is a Blob of ~50 segments (~tens of MB).

### 4.2 fMP4 init segment (if needed)

- For **fMP4**, an **init segment** (ftyp + moov) is required for playback.
- If the playlist didn’t provide one, the code may take it from the **first segment** (if it starts with an ftyp box) and put it in `finalBlobs` first.
- For **MPEG-TS** there is no init segment; segments are concatenated as-is.

### 4.3 Building “final” blobs

- `finalBlobs = [initSegmentBlob (if any), ...segmentBlobs]`  
  i.e. init (if present) then all segment batches in order.

---

## 5. Merge Path A: Small/Medium Files (≤ 1 GB)

- **One merged blob** is created in memory:
  - `mergedBlob = new Blob(finalBlobs, { type: 'video/mp2t' or 'video/mp4' })`
- The first 8 bytes are read to validate structure (e.g. MPEG-TS sync byte `0x47`, or fMP4 `ftyp`).
- That single **mergedBlob** is then:
  - Either **converted to MP4** (see below), or
  - Saved as .ts/.mp4 via **downloadBlob** (blob or IDB).

So for smaller files, “merging” = **one `new Blob([...])` over all batch blobs**.

---

## 6. Merge Path B: Large Files (> 1 GB)

To avoid creating a single 2GB+ blob in the service worker (which can cause NotReadableError or suspension):

- We **do not** create `mergedBlob`.
- We open **IndexedDB** and write **each** entry of `finalBlobs` as a separate “chunk”:
  - `chunk_0`, `chunk_1`, … `chunk_N-1`
  - Each chunk is one batch blob (~40MB), read with `finalBlobs[i].arrayBuffer()` and stored.
- We keep a **blobId** and **chunkCount** and **totalSize** (`chunksOnlyForDownload`).
- The offscreen document is kept open (and we ping it) so the service worker doesn’t suspend during this long write loop.

So for large files, “merging” = **writing ordered batch blobs into IDB as chunk_0, chunk_1, …** (no single huge blob in memory).

---

## 7. Conversion to MP4 (When Requested)

- Only if the merged result is not already MP4:
  - **Small file**: The SW cuts **mergedBlob** into 32MB chunks, stores them in IDB, and asks the offscreen doc to **assemble** them into one blob again for FFmpeg.
  - **Large file**: Chunks are already in IDB; we ask the offscreen doc to **assemble** them (one big buffer). If that allocation fails (e.g. 2GB), we skip conversion and go to .ts fallback.
- The offscreen document runs **FFmpeg.wasm**: reads the assembled blob, runs `ffmpeg -i input.ts -c copy output.mp4`, and stores the MP4 back in IDB.
- The SW then triggers **downloadBlob** for that MP4 blob.

For very large files, assembly in the offscreen doc often fails (“Array buffer allocation failed”), so we **don’t** convert and instead save as .ts.

---

## 8. Saving the File (.ts or .mp4)

- **If we have one blob** (small file, or after successful conversion):
  - We use **downloadBlob** (passing either the blob or a blobId). The offscreen doc (or SW) creates a blob URL and calls `chrome.downloads.download({ url: blobUrl, filename })`.
- **If we have only chunks** (large file, conversion skipped or assembly failed):
  - We use **downloadViaBlobFromChunks**:
    - Offscreen doc reads **chunk_0, chunk_1, …** from IDB, builds `new Blob([...parts])`, creates a blob URL, and returns it.
    - The SW calls `chrome.downloads.download({ url: blobUrl, filename })`.
    - After download, the blob URL is revoked and chunk keys are removed from IDB.

So “merging” for the user = **one final file on disk**, either from one in-memory blob or from chunks assembled in the offscreen document for download.

---

## 9. Flow Diagram (Simplified)

```
User clicks "Download" (e.g. 544p HLS)
         │
         ▼
┌─────────────────────────────────────┐
│  Fetch playlist (.m3u8)              │
│  Parse segment URLs (e.g. 2780)     │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Download segments in batches        │
│  (batch size 5 or 10, retries 5x)   │
│  → orderedSegments[i].data (buffer) │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Create batch blobs                  │
│  50 segments → 1 Blob → segmentBlobs│
│  finalBlobs = [init?, ...segmentBlobs]
└─────────────────────────────────────┘
         │
         ├── totalSize ≤ 1GB ──────────────────────┐
         │                                          │
         │   mergedBlob = new Blob(finalBlobs)       │
         │   Validate header (8 bytes)              │
         │   → Chunk into IDB → assemble → FFmpeg    │
         │   → downloadBlob(MP4 or .ts)             │
         │                                          │
         └── totalSize > 1GB ──────────────────────┤
                                                    │
              Write finalBlobs[i] → IDB as chunk_i  │
              (no mergedBlob)                       │
              Try assemble in offscreen → FFmpeg    │
              (often fails for 2GB)                 │
              → downloadViaBlobFromChunks(.ts)      │
                                                    │
                                                    ▼
                                    chrome.downloads.download(...)
                                    → File on disk
```

---

## 10. Summary

| Step            | What happens |
|-----------------|--------------|
| **Download**    | Segments fetched in batches, each stored as ArrayBuffer with index; retries and failed-segment retry at end. |
| **Batch blobs** | Segments grouped into blobs of 50 → `segmentBlobs`, then `finalBlobs` (init + segmentBlobs). |
| **Merge (small)** | One `mergedBlob = new Blob(finalBlobs)`; then chunked into IDB for conversion or passed to download. |
| **Merge (large)** | No single blob; each `finalBlobs[i]` written to IDB as `chunk_i`; conversion attempted from chunks; if assembly fails, save as .ts via blob-from-chunks. |
| **Save**        | One blob URL (from blob or from chunks assembled in offscreen) → `chrome.downloads.download` → one file on disk. |

So “merging” is: **concatenating all segment data in order**, either as one in-memory blob (small files) or as indexed chunks in IDB that are later assembled or streamed for download (large files).

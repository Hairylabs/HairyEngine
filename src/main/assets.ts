import { app, dialog, shell, BrowserWindow } from 'electron';
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

// Global asset library at <userData>/assets/. Assets land here once and are
// reusable across every project. Project-local assets land in <project>/assets/
// when the user explicitly imports next to a saved .hairy file (future).

const SUPPORTED_EXTS = new Set(['.glb', '.gltf']);

export type AssetEntry = {
  path: string;
  name: string;
  size: number;
  mtime: number;
  ext: string;
};

function libraryDir(): string {
  return join(app.getPath('userData'), 'assets');
}

async function ensureLibrary(): Promise<string> {
  const dir = libraryDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function listAssets(): Promise<AssetEntry[]> {
  const dir = await ensureLibrary();
  const names = await readdir(dir);
  const entries: AssetEntry[] = [];
  for (const name of names) {
    const ext = extname(name).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) continue;
    const path = join(dir, name);
    try {
      const s = await stat(path);
      if (!s.isFile()) continue;
      entries.push({
        path,
        name,
        size: s.size,
        mtime: s.mtimeMs,
        ext,
      });
    } catch {
      // skip unreadable files
    }
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries;
}

export async function readAsset(
  path: string,
): Promise<{ ok: true; bytes: ArrayBuffer } | { ok: false; error: string }> {
  // Guard against directory traversal — the path must be inside the library dir.
  const dir = libraryDir();
  if (!path.startsWith(dir)) {
    return { ok: false, error: 'asset path outside library' };
  }
  try {
    const buf = await readFile(path);
    return {
      ok: true,
      bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Write a binary blob (bytes) into the asset library under the given filename.
// Used by the in-app Kenney importer + future asset-download buttons.
export async function writeAssetBinary(
  filename: string,
  bytes: ArrayBuffer,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const dir = await ensureLibrary();
    // Sanitize: strip directory traversal, allow only common chars.
    const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'asset.glb';
    const dest = join(dir, safe);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(dest, Buffer.from(bytes));
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function importAsset(
  win: BrowserWindow | null,
): Promise<
  | { canceled: true }
  | { canceled: false; imported: AssetEntry[] }
  | { canceled: false; error: string }
> {
  if (!win) return { canceled: true };
  const result = await dialog.showOpenDialog(win, {
    title: 'Add to asset library',
    filters: [
      { name: 'All assets', extensions: ['glb', 'gltf', 'fbx', 'obj', 'stl', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'mp3', 'wav', 'ogg', 'm4a'] },
      { name: '3D models', extensions: ['glb', 'gltf', 'fbx', 'obj', 'stl'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
      { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  const dir = await ensureLibrary();
  const imported: AssetEntry[] = [];
  try {
    for (const src of result.filePaths) {
      const name = basename(src);
      const dst = join(dir, name);
      await copyFile(src, dst);
      const s = await stat(dst);
      imported.push({
        path: dst,
        name,
        size: s.size,
        mtime: s.mtimeMs,
        ext: extname(name).toLowerCase(),
      });
    }
    return { canceled: false, imported };
  } catch (err) {
    return { canceled: false, error: (err as Error).message };
  }
}

export async function revealAsset(path: string) {
  shell.showItemInFolder(path);
}

export async function openLibrary() {
  const dir = await ensureLibrary();
  shell.openPath(dir);
}

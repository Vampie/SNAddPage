/** Pure helpers (no SDK), so they are testable with plain jest. */

export type NoteFile = {path: string; name: string};
export type Rect = {left: number; top: number; right: number; bottom: number};

// shortcut: font size and glyph width are the SNCalculator estimates (64 reads well on the Nomad);
// margin is a guess. Adjust after seeing the header on the device.
export const FONT_SIZE = 64;
const CHAR_WIDTH = FONT_SIZE * 0.62;
const MARGIN = 100;
/** 7 px below the margin: looked better on the device (v0.0.5). */
const TOP = MARGIN + 7;

const STORAGE_ROOT = /^\/storage\/emulated\/0\//;

/** `Meeting 2026-11-20`, in the device's local time. */
export function meetingTitle(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Meeting ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

/** File name without `.note` and its folder relative to internal storage. */
export function describeNote(path: string): {name: string; folder: string} {
  const relative = path.replace(STORAGE_ROOT, '');
  const cut = relative.lastIndexOf('/');
  return {
    name: relative.slice(cut + 1).replace(/\.note$/i, ''),
    folder: cut < 0 ? '' : relative.slice(0, cut),
  };
}

/** A folder entry as FileUtils.listFiles really returns it: type 0 = folder, 1 = file. */
export type DirEntry = {path: string; type: number};

export type ListDir = (dir: string) => Promise<DirEntry[] | null>;

/** Paths of files below `dir` that pass `keep`; `list` gives a folder's entries, or null for an empty folder. */
export async function findFiles(
  dir: string,
  list: ListDir,
  keep: (path: string) => boolean,
): Promise<string[]> {
  const found: string[] = [];
  for (const entry of (await list(dir)) ?? []) {
    if (entry.type === 0) {
      found.push(...(await findFiles(entry.path, list, keep)));
    } else if (keep(entry.path)) {
      found.push(entry.path);
    }
  }
  return found;
}

/**
 * A custom template as getNotePageTemplate reports it (seen on the device): name
 * "user_<file name>" and md5 "<MD5 of the image>_<number>".
 */
export function customTemplateKey(
  name: string,
  md5: string,
): {file: string; hash: string} {
  return {
    file: name.replace(/^user_/, ''),
    hash: md5.split('_')[0].toLowerCase(),
  };
}

/** Every .note below `dir`. */
export async function findNotes(
  dir: string,
  list: ListDir,
): Promise<NoteFile[]> {
  const paths = await findFiles(dir, list, p => /\.note$/i.test(p));
  return paths.map(path => ({path, name: describeNote(path).name}));
}

/**
 * The open note first, then the last chosen one, then the rest by path (case-insensitive).
 * The open note is added when the device's file list does not contain it.
 */
export function orderNotes(
  notes: NoteFile[],
  current: string | null,
  last: string | null,
): NoteFile[] {
  const all =
    current && !notes.some(n => n.path === current)
      ? [...notes, {path: current, name: describeNote(current).name}]
      : [...notes];
  const rank = (n: NoteFile) =>
    n.path === current ? 0 : n.path === last ? 1 : 2;
  const key = (n: NoteFile) => n.path.toLowerCase();
  return all.sort(
    (a, b) =>
      rank(a) - rank(b) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0),
  );
}

/** Top-left box for the header text, sized to the text and kept on the page (pixels). */
export function headerRect(
  text: string,
  page: {width: number; height: number},
): Rect {
  const width = Math.round(
    Math.min(page.width - 2 * MARGIN, text.length * CHAR_WIDTH + FONT_SIZE),
  );
  const height = FONT_SIZE * 2;
  return {
    left: MARGIN,
    top: TOP,
    right: MARGIN + width,
    bottom: TOP + height,
  };
}

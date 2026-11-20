/** Pure helpers (no SDK), so they are testable with plain jest. */

export type NoteFile = {path: string; name: string};
export type Rect = {left: number; top: number; right: number; bottom: number};

// shortcut: font size and glyph width are the SNCalculator estimates (64 reads well on the Nomad).
export const FONT_SIZE = 64;
const CHAR_WIDTH = FONT_SIZE * 0.62;

const STORAGE_ROOT = /^\/storage\/emulated\/0\//;

/** What the user can set: the header text (with placeholders) and where it goes, in page pixels. */
export type Settings = {title: string; left: number; top: number};

/** (100, 107): the place that looked right on the Nomad (v0.0.5 + 7 px down). */
export const DEFAULT_SETTINGS: Settings = {
  title: 'Meeting {date}',
  left: 100,
  top: 107,
};

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** Placeholders the title may hold, filled in from the device's local time. */
export const PLACEHOLDERS = [
  '{date}',
  '{time}',
  '{year}',
  '{month}',
  '{day}',
  '{hour}',
  '{minute}',
  '{weekday}',
];

/** The title with its placeholders filled in; unknown ones stay as typed. */
export function fillTitle(title: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const parts: Record<string, string> = {
    year: String(date.getFullYear()),
    month: pad(date.getMonth() + 1),
    day: pad(date.getDate()),
    hour: pad(date.getHours()),
    minute: pad(date.getMinutes()),
    weekday: WEEKDAYS[date.getDay()],
  };
  parts.date = `${parts.year}-${parts.month}-${parts.day}`;
  parts.time = `${parts.hour}:${parts.minute}`;
  return title.replace(/\{(\w+)\}/g, (all, key: string) => parts[key] ?? all);
}

const SETTINGS_PREFIX = 's1_';
/** A folder name may have 255 bytes; the encoded name is plain ASCII. */
const MAX_SETTINGS_NAME = 200;

/** The settings as a folder name: the SDK has no other way to store anything. */
export function encodeSettings(settings: Settings): string {
  return (
    SETTINGS_PREFIX +
    encodeURIComponent(
      JSON.stringify([settings.title, settings.left, settings.top]),
    )
  );
}

const isOffset = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** The settings in a folder name from encodeSettings, or null for any other name. */
export function decodeSettings(name: string): Settings | null {
  if (!name.startsWith(SETTINGS_PREFIX)) {
    return null;
  }
  try {
    const [title, left, top] = JSON.parse(
      decodeURIComponent(name.slice(SETTINGS_PREFIX.length)),
    );
    return typeof title === 'string' &&
      title.trim() &&
      isOffset(left) &&
      isOffset(top)
      ? {title, left, top}
      : null;
  } catch {
    return null;
  }
}

/** The settings typed on the settings screen, or what is wrong with them. */
export function parseSettings(
  title: string,
  left: string,
  top: string,
): Settings | string {
  const trimmed = title.trim();
  if (!trimmed) {
    return 'The title cannot be empty.';
  }
  if (!/^\d+$/.test(left.trim())) {
    return 'Left must be a whole number of pixels, 0 or more.';
  }
  if (!/^\d+$/.test(top.trim())) {
    return 'Top must be a whole number of pixels, 0 or more.';
  }
  const settings = {
    title: trimmed,
    left: Number(left.trim()),
    top: Number(top.trim()),
  };
  if (encodeSettings(settings).length > MAX_SETTINGS_NAME) {
    return 'The title is too long to store. Make it shorter.';
  }
  return settings;
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

/** Box for the header text at `at` (page pixels), sized to the text and kept on the page. */
export function headerRect(
  text: string,
  page: {width: number; height: number},
  at: {left: number; top: number},
): Rect {
  const width = Math.round(
    Math.min(page.width, text.length * CHAR_WIDTH + FONT_SIZE),
  );
  const height = Math.min(page.height, FONT_SIZE * 2);
  const left = Math.min(at.left, page.width - width);
  const top = Math.min(at.top, page.height - height);
  return {left, top, right: left + width, bottom: top + height};
}

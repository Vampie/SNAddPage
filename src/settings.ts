/**
 * Stores the settings as the name of a folder in the plugin's own folder: the SDK has no
 * storage API, but makeDir, listFiles and deleteDir work there without any permission.
 * shortcut: whether the folder survives a plugin update is untested; without it the defaults return.
 */
import {FileUtils, PluginManager} from 'sn-plugin-lib';
import {
  decodeSettings,
  DEFAULT_SETTINGS,
  DirEntry,
  encodeSettings,
  Settings,
} from './meeting';

async function settingsDir(): Promise<string> {
  const dir = await PluginManager.getPluginDirPath();
  if (!dir) {
    throw new Error('getPluginDirPath gave no folder');
  }
  return `${dir.replace(/\/$/, '')}/settings`;
}

async function entries(dir: string): Promise<DirEntry[]> {
  if (!(await FileUtils.exists(dir))) {
    return [];
  }
  // The SDK types say string[]; the native module returns {path, type} or null when empty.
  return ((await FileUtils.listFiles(dir)) ?? []) as unknown as DirEntry[];
}

/** The saved settings, or the defaults when there are none (or they cannot be read). */
export async function loadSettings(): Promise<Settings> {
  try {
    for (const entry of await entries(await settingsDir())) {
      const settings = decodeSettings(
        entry.path.slice(entry.path.lastIndexOf('/') + 1),
      );
      if (settings) {
        return settings;
      }
    }
  } catch {
    // Fall back to the defaults.
  }
  return DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const dir = await settingsDir();
  const path = `${dir}/${encodeSettings(settings)}`;
  // makeDir creates the settings folder too; the old entries go only once the new one exists.
  if (!(await FileUtils.makeDir(path))) {
    throw new Error('the settings could not be saved');
  }
  for (const entry of await entries(dir)) {
    if (entry.path !== path) {
      await FileUtils.deleteDir(entry.path);
    }
  }
}

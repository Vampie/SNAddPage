/**
 * The Add meeting flow: append a page to the chosen note, put the "Meeting <date>" header and
 * keyword on it, and turn the lasso selection in the open note into a link to that page.
 * Untested parts (device only): see the SNAddPage section in the workspace CLAUDE.md.
 */
import {
  Element,
  FileUtils,
  PluginCommAPI,
  PluginFileAPI,
  PluginManager,
  PluginNoteAPI,
  TextBox,
} from 'sn-plugin-lib';
import {
  customTemplateKey,
  describeNote,
  DirEntry,
  findFiles,
  findNotes,
  ListDir,
  FONT_SIZE,
  headerRect,
  meetingTitle,
  NoteFile,
  Rect,
} from './meeting';

/** Shape of every PluginCommAPI/PluginNoteAPI/PluginFileAPI result (the SDK does not export it). */
type APIResponse<T> = {
  success: boolean;
  result: T | null;
  error: {code: number; message: string} | null;
};

/** An error that also says which steps already changed something. */
export type StepError = Error & {done?: string[]};

const PERMISSIONS: [string, string][] = [
  [
    'plugin.permission.FILE:READ',
    'Needed to list your notes and read the selection.',
  ],
  [
    'plugin.permission.FILE:WRITE',
    'Needed to add the meeting page and the link.',
  ],
];
const FALLBACK_TEMPLATE = 'style_white';
const NOTE_ROOT = '/storage/emulated/0/Note';
const MYSTYLE_ROOT = '/storage/emulated/0/MyStyle';
const CALL_TIMEOUT_MS = 10000;
const WALK_TIMEOUT_MS = 60000;
/** setLassoStrokeLink/insertTextLink result: the destination note needs an upgrade. */
const LINK_NEEDS_UPGRADE = -2;

function unwrap<T>(res: unknown, what: string): T {
  const r = res as APIResponse<T> | null | undefined;
  if (!r?.success) {
    throw new Error(`${what}: ${r?.error?.message ?? 'failed'}`);
  }
  return r.result as T;
}

/** For APIs whose result is true/false. */
function expectTrue(res: unknown, what: string): void {
  if (unwrap<boolean>(res, what) === false) {
    throw new Error(`${what}: the device said no`);
  }
}

/** Rejects when `promise` does not settle in time, naming the call that hung. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} did not answer within ${ms / 1000} s`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function ensurePermissions(): Promise<void> {
  for (const [permission, why] of PERMISSIONS) {
    const has = await withTimeout(
      PluginManager.hasPermission(permission),
      CALL_TIMEOUT_MS,
      'hasPermission',
    );
    if (has === 1) {
      continue;
    }
    // No timeout: this waits for the user to answer the dialog.
    const choice = await PluginManager.requestPermission(permission, why);
    if (choice !== 1 && choice !== 2) {
      throw new Error(`permission refused: ${permission}`);
    }
  }
}

/**
 * The open note's path (null if unknown) and every note in the Note folder. `onStep` names
 * the call in progress, so a hang shows on screen.
 */
export async function loadNotes(onStep: (step: string) => void): Promise<{
  current: string | null;
  notes: NoteFile[];
}> {
  onStep('checking permissions');
  await ensurePermissions();
  onStep('reading the open note');
  let current: string | null = null;
  try {
    current = unwrap<string>(
      await withTimeout(
        PluginCommAPI.getCurrentFilePath(),
        CALL_TIMEOUT_MS,
        'getCurrentFilePath',
      ),
      'getCurrentFilePath',
    );
  } catch {
    // Without it the open note is just not listed first.
  }
  // Not FileUtils.getFileList: its native code calls getCurrentActivity() without a null
  // check, which most likely crashed PluginHost on the device (v0.0.1-v0.0.3).
  // shortcut: only the Note folder, no SD card or OTG (getExternalDirPath has the same risk).
  onStep(`scanning ${NOTE_ROOT}`);
  const notes = await withTimeout(
    findNotes(NOTE_ROOT, listDir),
    WALK_TIMEOUT_MS,
    `scanning ${NOTE_ROOT}`,
  );
  return {current, notes};
}

// The SDK types say string[]; the native module returns {path, type} or null when empty.
const listDir: ListDir = async dir =>
  (await FileUtils.listFiles(dir)) as unknown as DirEntry[] | null;

/** A page's template: md5 "0" for system templates, the image's MD5 for custom ones. */
type PageTemplate = {name: string; md5: string};

async function templateOf(
  notePath: string,
  page: number,
): Promise<PageTemplate | null> {
  try {
    return unwrap<PageTemplate>(
      await PluginFileAPI.getNotePageTemplate(notePath, page),
      'getNotePageTemplate',
    );
  } catch {
    return null;
  }
}

const describeTemplate = (t: PageTemplate | null) =>
  t ? `"${t.name}" (md5 ${t.md5})` : 'unknown';

/**
 * The image of a custom template in MyStyle, by file name or else by MD5: createNote takes
 * custom templates as an image path, so insertNotePage probably does too (not documented).
 */
async function customTemplatePath(
  template: PageTemplate,
): Promise<string | null> {
  const {file, hash} = customTemplateKey(template.name, template.md5);
  const images = await findFiles(MYSTYLE_ROOT, listDir, p =>
    /\.png$/i.test(p),
  );
  const byName = images.find(
    p => describeNote(p).name.replace(/\.png$/i, '') === file,
  );
  if (byName) {
    return byName;
  }
  for (const path of images) {
    if ((await FileUtils.getFileMD5(path)).toLowerCase() === hash) {
      return path;
    }
  }
  return null;
}

/** What the device answered, for error messages. */
function answer(res: APIResponse<unknown> | null | undefined): string {
  if (!res) {
    return 'nothing';
  }
  if (res.success) {
    return res.result === LINK_NEEDS_UPGRADE
      ? 'result -2 (the chosen note needs an upgrade)'
      : `result ${String(res.result)}`;
  }
  return `error ${res.error?.code}: ${res.error?.message}`;
}

/** Lasso counts that must match when the selection is made again (geometryNum includes lines, circles, ellipses). */
const COUNT_FIELDS = [
  'trailNum',
  'trailLinkNum',
  'textLinkNum',
  'todoLinkNum',
  'titleNum',
  'bitmapNum',
  'normalTextBoxNum',
  'digestTextBoxNum',
  'digestTextBoxEditableNum',
  'geometryNum',
];
type Counts = Record<string, number>;

/** The lasso selection, read before anything can drop it. */
type Selection = {
  page: number;
  rect: Rect;
  counts: Counts;
  textBox: TextBox | null;
};

async function readCounts(): Promise<Counts> {
  return (
    unwrap<Counts>(
      await PluginCommAPI.getLassoElementTypeCounts(),
      'getLassoElementTypeCounts',
    ) ?? {}
  );
}

function describeCounts(counts: Counts): string {
  const parts = COUNT_FIELDS.filter(k => (counts[k] ?? 0) > 0).map(
    k => `${k} ${counts[k]}`,
  );
  return parts.join(', ') || 'nothing';
}

async function readSelection(): Promise<Selection> {
  const rect = unwrap<Rect>(await PluginCommAPI.getLassoRect(), 'getLassoRect');
  const page = unwrap<number>(
    await PluginCommAPI.getCurrentPageNum(),
    'getCurrentPageNum',
  );
  const counts = await readCounts();
  const loneTextBox =
    counts.normalTextBoxNum === 1 &&
    COUNT_FIELDS.every(k => k === 'normalTextBoxNum' || !(counts[k] > 0));
  let textBox: TextBox | null = null;
  if (loneTextBox) {
    // Kept to replace the box by a text link if the device refuses a stroke link on it.
    const boxes =
      unwrap<TextBox[]>(await PluginNoteAPI.getLassoText(), 'getLassoText') ??
      [];
    textBox = boxes.length === 1 && boxes[0].textContentFull ? boxes[0] : null;
  }
  return {page, rect, counts, textBox};
}

/**
 * Makes the lasso the original selection again when it was dropped, by lassoing its rectangle.
 * Refuses when the rectangle now holds other elements. Returns whether it re-made the lasso.
 */
async function restoreLasso(selection: Selection): Promise<boolean> {
  const now = (await PluginCommAPI.getLassoRect()) as
    | APIResponse<Rect>
    | null
    | undefined;
  if (now?.success && now.result) {
    return false;
  }
  // Reloading the open note may show another page; the rectangle belongs to the original one.
  const shown = unwrap<number>(
    await PluginCommAPI.getCurrentPageNum(),
    'getCurrentPageNum',
  );
  if (shown !== selection.page) {
    expectTrue(await PluginCommAPI.jumpToPage(selection.page), 'jumpToPage');
  }
  expectTrue(
    await PluginCommAPI.lassoElements(selection.rect),
    'lassoElements',
  );
  const counts = await readCounts();
  if (COUNT_FIELDS.some(k => (counts[k] ?? 0) !== (selection.counts[k] ?? 0))) {
    await PluginCommAPI.setLassoBoxState(2).catch(() => undefined);
    throw new Error(
      `the lasso was gone and its rectangle now holds ${describeCounts(
        counts,
      )} instead of ${describeCounts(selection.counts)}, so nothing was linked`,
    );
  }
  return true;
}

/**
 * Links the lasso selection to `page` of `target`. Handwriting gets a stroke link; when the
 * device refuses that for a lone text box, the box is replaced by a text link with the same text.
 */
async function linkSelection(
  target: string,
  page: number,
  selection: Selection,
): Promise<void> {
  const link = {destPath: target, destPage: page, style: 0, linkType: 0};
  const res = (await PluginNoteAPI.setLassoStrokeLink(link)) as
    | APIResponse<number>
    | null
    | undefined;
  if (res?.success && res.result === 0) {
    return;
  }
  const box = selection.textBox;
  if (!box || res?.result === LINK_NEEDS_UPGRADE) {
    throw new Error(
      `setLassoStrokeLink answered ${answer(res)} (selection: ${describeCounts(
        selection.counts,
      )})`,
    );
  }
  unwrap(
    await PluginCommAPI.deleteLassoElements(),
    `setLassoStrokeLink answered ${answer(
      res,
    )}; removing the text box to replace it`,
  );
  const text = box.textContentFull ?? '';
  const textLink = (await PluginNoteAPI.insertTextLink({
    ...link,
    rect: box.textRect,
    fontSize: box.fontSize || FONT_SIZE,
    fullText: text,
    showText: text,
    isItalic: box.textItalics ? 1 : 0,
  })) as APIResponse<number> | null | undefined;
  if (!(textLink?.success && textLink.result === 0)) {
    throw new Error(
      `insertTextLink answered ${answer(
        textLink,
      )}. The text box was already removed: use undo in the note to get it back`,
    );
  }
}

/**
 * Adds `page` with the template of the page before it. Returns a warning when the new page
 * ended up with another template (v0.0.5 on the device: always blank), null otherwise.
 */
async function insertPage(notePath: string, page: number): Promise<string | null> {
  const previous = await templateOf(notePath, page - 1);
  const candidates: string[] = [];
  let lookup = '';
  if (previous && previous.md5 !== '0') {
    // v0.0.6: the name "user_D_ToDo" got "802: Background template file does not exist!".
    const path = await customTemplatePath(previous).catch(() => null);
    if (path) {
      candidates.push(path);
    } else {
      lookup = `No image of it found in ${MYSTYLE_ROOT}. `;
    }
    candidates.push(customTemplateKey(previous.name, previous.md5).file);
  }
  if (previous?.name) {
    candidates.push(previous.name);
  }
  candidates.push(FALLBACK_TEMPLATE);

  const refused: string[] = [];
  let used: string | null = null;
  for (const template of new Set(candidates)) {
    const res = (await PluginFileAPI.insertNotePage({
      notePath,
      page,
      template,
    })) as APIResponse<boolean> | null | undefined;
    if (res?.success === true && res.result !== false) {
      used = template;
      break;
    }
    refused.push(`"${template}": ${answer(res)}`);
  }
  if (used === null) {
    throw new Error(`every template was refused (${refused.join('; ')})`);
  }
  // insertNotePage only answers true/false: check that the page really was added.
  const total = unwrap<number>(
    await PluginFileAPI.getNoteTotalPageNum(notePath),
    'getNoteTotalPageNum',
  );
  if (total !== page + 1) {
    throw new Error(`expected ${page + 1} pages, the note has ${total}`);
  }

  const added = await templateOf(notePath, page);
  if (
    previous &&
    added &&
    added.name === previous.name &&
    added.md5 === previous.md5
  ) {
    return null;
  }
  return (
    `Page ${page + 1} did not get the template of page ${page}. ` +
    `Page ${page}: ${describeTemplate(previous)}. ` +
    lookup +
    (refused.length ? `Refused: ${refused.join('; ')}. ` : '') +
    `Accepted: "${used}". Page ${page + 1}: ${describeTemplate(added)}.`
  );
}

async function insertHeader(
  notePath: string,
  page: number,
  title: string,
): Promise<void> {
  const size = unwrap<{width: number; height: number}>(
    await PluginFileAPI.getPageSize(notePath, page),
    'getPageSize',
  );
  const element = unwrap<Element>(
    await PluginCommAPI.createElement(Element.TYPE_TEXT),
    'createElement',
  );
  try {
    element.pageNum = page;
    element.layerNum = 0; // text boxes only live on the main layer
    element.textBox = Object.assign(new TextBox(), {
      fontSize: FONT_SIZE,
      textContentFull: title,
      textRect: headerRect(title, size),
    });
    expectTrue(
      await PluginFileAPI.insertElements(notePath, page, [element]),
      'insertElements',
    );
  } finally {
    PluginCommAPI.recycleElement(element.uuid);
  }
}

/**
 * Runs the whole flow for `target`. `current` is the open note (the lasso lives there).
 * Throws a StepError naming the failed step and the steps that already changed something.
 * Returns warnings about what only partly worked (empty when all went as planned).
 */
export async function addMeeting(
  target: string,
  current: string | null,
): Promise<string[]> {
  const title = meetingTitle(new Date());
  const isCurrent = target === current;
  const done: string[] = [];
  const fail = (name: string, e: unknown): StepError =>
    Object.assign(new Error(`${name}: ${(e as Error).message}`), {
      done: [...done],
    });
  const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    try {
      const result = await run();
      done.push(name);
      return result;
    } catch (e) {
      throw fail(name, e);
    }
  };

  // First, while the lasso is surely there: on the device (v0.0.4) it was gone by the time
  // the link was made, after the page count and template of the chosen note were read.
  const selection = await readSelection().catch(e => {
    throw fail('Read the selection', e);
  });
  // The new page's index is the current page count (pages are 0-based).
  const page = unwrap<number>(
    await PluginFileAPI.getNoteTotalPageNum(target),
    'Count the pages',
  );
  const pageLabel = `page ${page + 1}`;

  if (isCurrent) {
    await step('Save this note', async () =>
      expectTrue(await PluginNoteAPI.saveCurrentNote(), 'saveCurrentNote'),
    );
  }
  const templateWarning = await step(`Add ${pageLabel}`, () =>
    insertPage(target, page),
  );
  await step(`Write "${title}" on ${pageLabel}`, () =>
    insertHeader(target, page, title),
  );
  await step(`Add keyword "${title}"`, async () =>
    expectTrue(
      await PluginFileAPI.insertKeyWord(target, page, title),
      'insertKeyWord',
    ),
  );
  if (isCurrent) {
    await step('Reload this note', async () =>
      unwrap(await PluginCommAPI.reloadFile(), 'reloadFile'),
    );
  }

  // Link last, to a page that now exists.
  const reselected = await restoreLasso(selection).catch(e => {
    throw fail('Find the selection again', e);
  });
  if (reselected) {
    done.push('Selection was gone: lassoed its rectangle again (same elements)');
  }
  await step(`Link the selection to ${pageLabel}`, () =>
    linkSelection(target, page, selection),
  );
  await PluginCommAPI.setLassoBoxState(2).catch(() => undefined);
  return templateWarning ? [templateWarning] : [];
}

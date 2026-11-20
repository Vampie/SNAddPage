import {
  customTemplateKey,
  DirEntry,
  describeNote,
  findNotes,
  headerRect,
  meetingTitle,
  orderNotes,
} from '../src/meeting';

const note = (path: string) => ({path, name: path.split('/').pop() ?? ''});

describe('meetingTitle', () => {
  it('uses the local date with zero padding', () => {
    expect(meetingTitle(new Date(2026, 0, 5, 23, 59))).toBe(
      'Meeting 2026-01-05',
    );
  });
});

describe('describeNote', () => {
  it('drops the storage root and the extension', () => {
    expect(describeNote('/storage/emulated/0/Note/Work/Team.note')).toEqual({
      name: 'Team',
      folder: 'Note/Work',
    });
  });

  it('handles a bare file name', () => {
    expect(describeNote('Team.NOTE')).toEqual({name: 'Team', folder: ''});
  });
});

describe('orderNotes', () => {
  const notes = [
    note('/storage/emulated/0/Note/b.note'),
    note('/storage/emulated/0/Note/A.note'),
    note('/storage/emulated/0/Note/c.note'),
  ];

  it('puts the open note first, then the last used, then by path ignoring case', () => {
    const ordered = orderNotes(
      notes,
      '/storage/emulated/0/Note/c.note',
      '/storage/emulated/0/Note/b.note',
    ).map(n => describeNote(n.path).name);
    expect(ordered).toEqual(['c', 'b', 'A']);
  });

  it('adds the open note when the file list misses it', () => {
    const ordered = orderNotes(notes, '/storage/emulated/0/Other/x.note', null);
    expect(ordered[0].path).toBe('/storage/emulated/0/Other/x.note');
    expect(ordered).toHaveLength(4);
  });

  it('does not change the input array', () => {
    const copy = [...notes];
    orderNotes(notes, null, null);
    expect(notes).toEqual(copy);
  });
});

describe('findNotes', () => {
  const tree: Record<string, DirEntry[] | null> = {
    '/N': [
      {path: '/N/a.note', type: 1},
      {path: '/N/pic.png', type: 1},
      {path: '/N/Work', type: 0},
      {path: '/N/Empty', type: 0},
    ],
    '/N/Work': [{path: '/N/Work/B.NOTE', type: 1}],
    '/N/Empty': null,
  };
  const list = async (dir: string) => tree[dir];

  it('finds .note files in subfolders and skips other files and empty folders', async () => {
    const notes = await findNotes('/N', list);
    expect(notes.map(n => n.path)).toEqual(['/N/a.note', '/N/Work/B.NOTE']);
    expect(notes[1].name).toBe('B');
  });
});

describe('customTemplateKey', () => {
  it('splits what getNotePageTemplate gives for a custom template (seen on the device)', () => {
    expect(
      customTemplateKey('user_D_ToDo', 'F5BBB3C5E375077420C95DDDDAA8861F_62771'),
    ).toEqual({file: 'D_ToDo', hash: 'f5bbb3c5e375077420c95ddddaa8861f'});
  });
});

describe('headerRect', () => {
  it('stays on a small page', () => {
    const rect = headerRect('Meeting 2026-11-20', {width: 600, height: 800});
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(600);
    expect(rect.right - rect.left).toBeGreaterThan(0);
    expect(rect.bottom - rect.top).toBeGreaterThan(0);
  });

  it('sits 7 px below the left margin', () => {
    const rect = headerRect('Meeting 2026-11-20', {width: 1404, height: 1872});
    expect(rect.top - rect.left).toBe(7);
  });

  it('fits the title on a Nomad page', () => {
    const rect = headerRect('Meeting 2026-11-20', {width: 1404, height: 1872});
    expect(rect.right - rect.left).toBeGreaterThan(18 * 64 * 0.6);
  });
});

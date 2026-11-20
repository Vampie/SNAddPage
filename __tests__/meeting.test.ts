import {
  customTemplateKey,
  decodeSettings,
  DEFAULT_SETTINGS,
  DirEntry,
  describeNote,
  encodeSettings,
  fillTitle,
  findNotes,
  headerRect,
  orderNotes,
  parseSettings,
} from '../src/meeting';

const note = (path: string) => ({path, name: path.split('/').pop() ?? ''});

describe('fillTitle', () => {
  // Monday 5 January 2026, 08:04 local time
  const date = new Date(2026, 0, 5, 8, 4);

  it('gives the old header with the default title', () => {
    expect(fillTitle(DEFAULT_SETTINGS.title, date)).toBe('Meeting 2026-01-05');
  });

  it('fills every placeholder with zero padding', () => {
    expect(
      fillTitle(
        '{weekday} {day}/{month}/{year} {hour}h{minute} = {date} {time}',
        date,
      ),
    ).toBe('Monday 05/01/2026 08h04 = 2026-01-05 08:04');
  });

  it('leaves unknown placeholders and plain braces alone', () => {
    expect(fillTitle('Team {foo} {DATE} {}', date)).toBe('Team {foo} {DATE} {}');
  });
});

describe('settings', () => {
  it('survive a round trip through a folder name', () => {
    const settings = {title: 'Overleg {date} / 50% {time}', left: 120, top: 80};
    const name = encodeSettings(settings);
    expect(name).not.toMatch(/[/\\]/);
    expect(decodeSettings(name)).toEqual(settings);
  });

  it('ignore folder names that are not settings', () => {
    expect(decodeSettings('something-else')).toBeNull();
    expect(decodeSettings('s1_%E0%A4%A')).toBeNull();
    expect(decodeSettings(`s1_${encodeURIComponent('["x", "1", 2]')}`)).toBeNull();
  });

  it('are parsed from the settings screen', () => {
    expect(parseSettings(' Meeting {date} ', '100', '107')).toEqual({
      title: 'Meeting {date}',
      left: 100,
      top: 107,
    });
  });

  it('refuse an empty title, offsets that are no whole numbers, and titles too long to store', () => {
    expect(parseSettings('  ', '1', '1')).toMatch(/title/i);
    expect(parseSettings('x', '-5', '1')).toMatch(/left/i);
    expect(parseSettings('x', '1', '1.5')).toMatch(/top/i);
    expect(parseSettings('é'.repeat(200), '1', '1')).toMatch(/long/i);
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
  const nomad = {width: 1404, height: 1872};

  it('stays on a small page', () => {
    const rect = headerRect('Meeting 2026-11-20', {width: 600, height: 800}, DEFAULT_SETTINGS);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(600);
    expect(rect.right - rect.left).toBeGreaterThan(0);
    expect(rect.bottom - rect.top).toBeGreaterThan(0);
  });

  it('starts at the default place (100, 107), as on v0.0.5-v0.0.8', () => {
    const rect = headerRect('Meeting 2026-11-20', nomad, DEFAULT_SETTINGS);
    expect([rect.left, rect.top]).toEqual([100, 107]);
  });

  it('uses the chosen offsets', () => {
    const rect = headerRect('Hi', nomad, {left: 300, top: 40});
    expect([rect.left, rect.top]).toEqual([300, 40]);
  });

  it('keeps the box on the page when the offsets are too big', () => {
    const rect = headerRect('Meeting 2026-11-20', nomad, {left: 5000, top: 5000});
    expect(rect.right).toBe(nomad.width);
    expect(rect.bottom).toBe(nomad.height);
  });

  it('fits the title on a Nomad page', () => {
    const rect = headerRect('Meeting 2026-11-20', nomad, DEFAULT_SETTINGS);
    expect(rect.right - rect.left).toBeGreaterThan(18 * 64 * 0.6);
  });
});

/**
 * Add meeting: pick the note that gets the meeting page.
 *
 * @format
 */

import React, {useEffect, useRef, useState} from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {addMeeting, loadNotes, StepError} from './src/addMeeting';
import {
  DEFAULT_SETTINGS,
  describeNote,
  fillTitle,
  NoteFile,
  orderNotes,
  parseSettings,
  PLACEHOLDERS,
} from './src/meeting';
import {onPress, pressCount, startedAt} from './src/presses';
import {loadSettings, saveSettings} from './src/settings';

// Kept while PluginHost runs, lost when it restarts (the SDK has no storage API).
let lastTarget: string | null = null;

type ListScreen = {kind: 'list'; current: string | null; notes: NoteFile[]};

type Screen =
  | {kind: 'waiting'}
  | {kind: 'loading'; step: string}
  | ListScreen
  | {
      kind: 'settings';
      /** The list to go back to. */
      list: ListScreen;
      title: string;
      left: string;
      top: string;
      error: string | null;
    }
  | {kind: 'working'; target: string}
  | {kind: 'warnings'; warnings: string[]}
  | {kind: 'error'; message: string; done: string[]};

function App(): React.JSX.Element {
  // Distinct from loading, so a missed button event shows on screen.
  const [screen, setScreen] = useState<Screen>({kind: 'waiting'});
  // Ignores a note list that arrives after a newer button press.
  const requestId = useRef(0);

  // Number of presses this App instance has handled.
  const handled = useRef(0);

  useEffect(() => {
    // Handles the press that opened the view (it may have come before App mounted) and later ones.
    const check = () => {
      if (pressCount() !== handled.current) {
        handled.current = pressCount();
        const id = ++requestId.current;
        const onStep = (step: string) => {
          if (id === requestId.current) {
            setScreen({kind: 'loading', step});
          }
        };
        loadNotes(onStep)
          .then(({current, notes}) => {
            if (id === requestId.current) {
              setScreen({
                kind: 'list',
                current,
                notes: orderNotes(notes, current, lastTarget),
              });
            }
          })
          .catch(e => {
            if (id === requestId.current) {
              setScreen({kind: 'error', message: e.message, done: []});
            }
          });
      }
    };
    check();
    return onPress(check);
  }, []);

  const close = () => PluginManager.closePluginView();

  const openSettings = async (list: ListScreen) => {
    const {title, left, top} = await loadSettings();
    setScreen({
      kind: 'settings',
      list,
      title,
      left: String(left),
      top: String(top),
      error: null,
    });
  };

  /** Changes fields of the settings screen (ignored once another screen shows). */
  const editSettings = (
    change: Partial<{title: string; left: string; top: string; error: string | null}>,
  ) => setScreen(s => (s.kind === 'settings' ? {...s, ...change} : s));

  const save = async () => {
    if (screen.kind !== 'settings') {
      return;
    }
    const settings = parseSettings(screen.title, screen.left, screen.top);
    if (typeof settings === 'string') {
      editSettings({error: settings});
      return;
    }
    try {
      await saveSettings(settings);
      setScreen(screen.list);
    } catch (e) {
      editSettings({error: `Not saved: ${(e as Error).message}`});
    }
  };

  const choose = async (target: string, current: string | null) => {
    lastTarget = target;
    setScreen({kind: 'working', target});
    try {
      const warnings = await addMeeting(target, current);
      if (warnings.length > 0) {
        setScreen({kind: 'warnings', warnings});
      } else {
        close();
      }
    } catch (e) {
      const error = e as StepError;
      setScreen({kind: 'error', message: error.message, done: error.done ?? []});
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Text style={styles.title}>
          {screen.kind === 'settings' ? 'Settings' : 'Add meeting to…'}
        </Text>
        {screen.kind === 'list' && (
          <Pressable
            style={styles.button}
            onPress={() => openSettings(screen)}
            accessibilityRole="button">
            <Text style={styles.buttonText}>Settings</Text>
          </Pressable>
        )}
        <Pressable
          style={styles.roundButton}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close">
          <Text style={styles.roundText}>✕</Text>
        </Pressable>
      </View>
      {screen.kind === 'waiting' && (
        <Text style={styles.message}>
          Waiting for the button press… (none received since the plugin
          started at {startedAt.toTimeString().slice(0, 8)})
        </Text>
      )}
      {screen.kind === 'loading' && (
        <Text style={styles.message}>Loading notes: {screen.step}…</Text>
      )}
      {screen.kind === 'working' && (
        <Text style={styles.message}>
          Adding the meeting page to {describeNote(screen.target).name}…
        </Text>
      )}
      {screen.kind === 'warnings' && (
        <View>
          <Text style={styles.label}>Done, with a remark</Text>
          {screen.warnings.map(warning => (
            <Text key={warning} style={styles.message}>
              {warning}
            </Text>
          ))}
        </View>
      )}
      {screen.kind === 'error' && (
        <View>
          <Text style={styles.label}>Failed</Text>
          <Text style={styles.message}>{screen.message}</Text>
          <Text style={styles.label}>
            {screen.done.length > 0 ? 'Already done' : 'Nothing was changed.'}
          </Text>
          {screen.done.map(step => (
            <Text key={step} style={styles.message}>
              • {step}
            </Text>
          ))}
          {screen.done.length > 0 && (
            <Text style={styles.message}>
              Clean up by hand if needed (undo in the note, or delete the
              page).
            </Text>
          )}
        </View>
      )}
      {screen.kind === 'settings' && (
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Title of the new page</Text>
          <TextInput
            style={styles.input}
            value={screen.title}
            onChangeText={title => editSettings({title, error: null})}
            autoCorrect={false}
          />
          <Text style={styles.folder}>
            Placeholders: {PLACEHOLDERS.join('  ')}
          </Text>
          <Text style={styles.message}>
            Now: {fillTitle(screen.title, new Date())}
          </Text>
          <Text style={styles.label}>Place, in pixels from the top left</Text>
          <View style={styles.offsets}>
            <Text style={styles.message}>Left</Text>
            <TextInput
              style={[styles.input, styles.number]}
              value={screen.left}
              onChangeText={left => editSettings({left, error: null})}
              keyboardType="number-pad"
            />
            <Text style={styles.message}>Top</Text>
            <TextInput
              style={[styles.input, styles.number]}
              value={screen.top}
              onChangeText={top => editSettings({top, error: null})}
              keyboardType="number-pad"
            />
          </View>
          {screen.error !== null && (
            <Text style={styles.label}>{screen.error}</Text>
          )}
          <View style={styles.offsets}>
            <Pressable
              style={[styles.button, styles.primary]}
              onPress={save}
              accessibilityRole="button">
              <Text style={[styles.buttonText, styles.primaryText]}>Save</Text>
            </Pressable>
            <Pressable
              style={styles.button}
              onPress={() => setScreen(screen.list)}
              accessibilityRole="button">
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.button}
              onPress={() =>
                editSettings({
                  title: DEFAULT_SETTINGS.title,
                  left: String(DEFAULT_SETTINGS.left),
                  top: String(DEFAULT_SETTINGS.top),
                  error: null,
                })
              }
              accessibilityRole="button">
              <Text style={styles.buttonText}>Defaults</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
      {screen.kind === 'list' && (
        <FlatList
          data={screen.notes}
          keyExtractor={note => note.path}
          ListEmptyComponent={
            <Text style={styles.message}>No notes found.</Text>
          }
          renderItem={({item}) => {
            const {name, folder} = describeNote(item.path);
            const tag =
              item.path === screen.current
                ? ' (this note)'
                : item.path === lastTarget
                ? ' (last used)'
                : '';
            return (
              <Pressable
                style={styles.row}
                onPress={() => choose(item.path, screen.current)}
                accessibilityRole="button">
                <Text style={styles.name}>
                  {name}
                  {tag}
                </Text>
                <Text style={styles.folder}>{folder}</Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 16,
    backgroundColor: '#ffffff',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    flex: 1,
    fontSize: 24,
    fontWeight: '700',
    color: '#000000',
  },
  roundButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 22,
  },
  roundText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
  },
  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
  },
  folder: {
    fontSize: 16,
    color: '#000000',
  },
  label: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
  },
  message: {
    fontSize: 18,
    color: '#000000',
  },
  button: {
    marginRight: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 22,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
  },
  primary: {
    backgroundColor: '#000000',
  },
  primaryText: {
    color: '#ffffff',
  },
  input: {
    marginVertical: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 8,
    fontSize: 20,
    color: '#000000',
  },
  number: {
    width: 110,
    marginLeft: 8,
    marginRight: 24,
  },
  offsets: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 8,
  },
});

export default App;

/**
 * Add meeting: pick the note that gets the meeting page.
 *
 * @format
 */

import React, {useEffect, useRef, useState} from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {addMeeting, loadNotes, StepError} from './src/addMeeting';
import {describeNote, NoteFile, orderNotes} from './src/meeting';
import {onPress, pressCount, startedAt} from './src/presses';

// Kept while PluginHost runs, lost when it restarts (the SDK has no storage API).
let lastTarget: string | null = null;

type Screen =
  | {kind: 'waiting'}
  | {kind: 'loading'; step: string}
  | {kind: 'list'; current: string | null; notes: NoteFile[]}
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
        <Text style={styles.title}>Add meeting to…</Text>
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
});

export default App;

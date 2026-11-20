/**
 * @format
 */

import {AppRegistry, Image} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

import {PluginManager} from 'sn-plugin-lib';
import {recordPress} from './src/presses';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

// Lasso toolbar, notes only (documents cannot hold links): handwriting (0) or a text box (3).
PluginManager.registerButton(2, ['NOTE'], {
  id: 200,
  name: 'Add meeting',
  icon: Image.resolveAssetSource(require('./assets/icons/button.png')).uri,
  editDataTypes: [0, 3],
  showType: 1,
});

// Here and not in App: App may mount too late to hear the press (see src/presses.ts).
PluginManager.registerButtonListener({onButtonPress: recordPress});

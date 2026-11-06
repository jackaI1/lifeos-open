import React from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {TodayScreen} from './src/TodayScreen';
import {createFeedClient} from './src/feed';
const client = createFeedClient();
export default function App() {
  return <SafeAreaProvider><TodayScreen client={client} /></SafeAreaProvider>;
}

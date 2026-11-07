import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AgendaScreen } from './src/AgendaScreen';
import { createRepository } from './src/repository';

const repository = createRepository({ storage: AsyncStorage });
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={{ flex: 1, backgroundColor: '#F3F7FB' }}>
        <AgendaScreen repository={repository} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

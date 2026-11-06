import React from 'react';
import {ActivityIndicator, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {selectToday} from '../../src/shared/today';
import type {FeedClient} from './feed';
import {useToday} from './useToday';

export function TodayScreen({client, clock = Date.now}: {client: FeedClient; clock?: () => number}) {
  const {snapshot, refreshing, offline, cacheSaved, now, refresh} = useToday(client, clock);
  const today = snapshot ? selectToday(snapshot.feed, now) : null;
  const zone = snapshot?.feed.timeZone ?? 'America/Toronto';
  const time = (value: string) => new Intl.DateTimeFormat('en-CA', {timeZone: zone, hour: 'numeric', minute: '2-digit'}).format(new Date(value));
  return <SafeAreaView style={s.safe}>
    <StatusBar barStyle="dark-content" />
    <ScrollView contentContainerStyle={s.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <Text style={s.brand}>LifeOS</Text>
      <Text role="heading" style={s.title}>Today</Text>
      <Text style={s.date}>{today?.day ?? 'Your day at a glance'}</Text>
      <Text style={s.secondary}>Fictional public demo. Read only.</Text>
      <Text style={s.secondary}>{zone} · Days begin at 5 a.m.</Text>

      <View style={s.connection} accessibilityLiveRegion="polite">
        {refreshing && <View style={s.loading}><ActivityIndicator color="#235588" /><Text style={s.body}>{snapshot ? 'Refreshing…' : 'Loading your day…'}</Text></View>}
        {!refreshing && offline && <Text style={s.warning}>{snapshot ? 'Could not refresh. Showing the saved copy.' : 'No saved day yet. Connect to the internet and retry.'}</Text>}
        {!refreshing && !offline && snapshot && <Text style={s.body}>{cacheSaved ? 'Saved for offline use.' : 'Could not save for offline use. This copy is available until you close the app.'}</Text>}
        {snapshot && <Text style={s.secondary}>Last downloaded {new Intl.DateTimeFormat('en-CA', {timeZone: zone, dateStyle: 'medium', timeStyle: 'short'}).format(snapshot.savedAt)}</Text>}
        {snapshot && today && snapshot.feed.anchorDate !== today.day && <Text style={s.warning}>Saved for {snapshot.feed.anchorDate}. Dates have not been moved to today.</Text>}
        <Pressable role="button" accessibilityLabel={offline ? 'Retry' : 'Refresh'} accessibilityState={{disabled: refreshing}} disabled={refreshing} onPress={() => void refresh()} style={({pressed}) => [s.button, pressed && s.pressed, refreshing && s.disabled]}>
          <Text style={s.buttonText}>{offline ? 'Retry' : 'Refresh'}</Text>
        </Pressable>
      </View>

      {today && <>
        <Text role="heading" style={s.heading}>Schedule</Text>
        {!today.events.length && <Text style={s.empty}>No scheduled events today.</Text>}
        {today.events.map(event => <View key={event.id} style={s.row}>
          <Text style={s.time}>{time(event.start)} to {time(event.end)}</Text>
          <Text style={s.itemTitle}>{event.title}</Text>
          {event.location && <Text style={s.secondary}>{event.location}</Text>}
        </View>)}
        <Text role="heading" style={s.heading}>Deadlines</Text>
        <Text style={s.secondary}>Overdue work and the next seven days</Text>
        {!today.deadlines.length && <Text style={s.empty}>No deadlines in the next seven days.</Text>}
        {today.deadlines.map(task => <View key={task.id} style={s.row}>
          <Text style={task.day! < today.day ? s.warning : s.time}>{task.day! < today.day ? 'Overdue · ' : task.day === today.day ? 'Due today · ' : 'Due '}{task.day}{task.dueAt ? ` at ${time(task.dueAt)}` : ' · Time not supplied'}</Text>
          <Text style={s.itemTitle}>{task.title}</Text>
        </View>)}
        {!!today.unknown.length && <>
          <Text role="heading" style={s.heading}>Date to confirm</Text>
          {today.unknown.map(task => <View key={task.id} style={s.row}><Text style={s.itemTitle}>{task.title}</Text><Text style={s.secondary}>No deadline supplied.</Text></View>)}
        </>}
      </>}
      <Text style={s.footer}>This sample does not sync changes from the browser workspace.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#f2f5f8'},
  page: {width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48},
  brand: {fontSize: 17, fontWeight: '600', color: '#235588', marginBottom: 12},
  title: {fontSize: 36, fontWeight: '700', color: '#172b3d'},
  date: {fontSize: 22, color: '#172b3d', marginTop: 6, marginBottom: 16, fontVariant: ['tabular-nums']},
  secondary: {fontSize: 15, lineHeight: 22, color: '#4c6072'},
  body: {fontSize: 16, lineHeight: 24, color: '#172b3d'},
  connection: {marginTop: 20, padding: 16, backgroundColor: '#e3ecf5', borderRadius: 12, gap: 8},
  loading: {flexDirection: 'row', gap: 10, alignItems: 'center'},
  warning: {fontSize: 16, lineHeight: 24, color: '#87370f'},
  button: {minHeight: 48, backgroundColor: '#235588', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 4, padding: 12},
  buttonText: {fontSize: 17, fontWeight: '600', color: '#ffffff'},
  pressed: {backgroundColor: '#173d64'}, disabled: {opacity: 0.5},
  heading: {fontSize: 24, fontWeight: '600', color: '#172b3d', marginTop: 32, marginBottom: 8},
  row: {paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#aab9c8', gap: 4},
  time: {fontSize: 16, lineHeight: 24, color: '#235588', fontVariant: ['tabular-nums']},
  itemTitle: {fontSize: 18, lineHeight: 26, fontWeight: '500', color: '#172b3d'},
  empty: {fontSize: 16, lineHeight: 24, color: '#4c6072', paddingVertical: 16},
  footer: {fontSize: 14, lineHeight: 21, color: '#4c6072', marginTop: 32},
});

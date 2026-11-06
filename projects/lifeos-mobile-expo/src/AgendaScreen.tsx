import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { deadlineLabel, localDay, selectAgenda } from './dates';
import { Snapshot } from './feed';
import { Repository } from './repository';

const systemNow = () => new Date();
const colors = { canvas: '#F3F7FB', paper: '#FFFFFF', ink: '#182F49', secondary: '#46617B', action: '#145CC6', caution: '#854000', rule: '#D6E1ED' };
interface State { snapshot: Snapshot | null; saved: boolean; error: boolean; warning: boolean }
export function AgendaScreen({ repository, now = systemNow }: { repository: Repository; now?: () => Date }) {
  const [state, setState] = useState<State>({ snapshot: null, saved: false, error: false, warning: false });
  const [busy, setBusy] = useState(true);
  const [date, setDate] = useState(now);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (request.current || !mounted.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setDate(now());
    try {
      const result = await repository.refresh(controller.signal);
      if (mounted.current) setState({ snapshot: result.snapshot, saved: false, error: false, warning: !result.persisted });
    } catch {
      if (mounted.current) setState(previous => ({ ...previous, error: true, saved: !!previous.snapshot && !previous.warning }));
    } finally {
      if (request.current === controller) request.current = null;
      if (mounted.current) setBusy(false);
    }
  }, [repository, now]);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const cached = await repository.read();
      if (!mounted.current) return;
      if (cached) setState(previous => previous.snapshot ? previous : { ...previous, snapshot: cached, saved: true });
      await refresh();
    })();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') { setDate(now()); void refresh(); }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
      request.current?.abort();
      request.current = null;
    };
  }, [repository, now, refresh]);

  useEffect(() => {
    const current = now();
    const midnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
    const timer = setTimeout(() => setDate(now()), midnight.getTime() - current.getTime() + 50);
    return () => clearTimeout(timer);
  }, [date, now]);

  const { snapshot } = state;
  const agenda = snapshot ? selectAgenda(snapshot, date) : null;
  const time = (value: string) => new Date(value).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  const eventTime = (value: string) => `${localDay(new Date(value)) !== localDay(date) ? `${new Date(value).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} ` : ''}${time(value)}`;
  const retry = state.error;
  return (
    <ScrollView testID="agenda" style={styles.screen} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void refresh()} tintColor={colors.action} colors={[colors.action]} />}>
      <View style={styles.heading}>
        <View style={styles.headingText}>
          <Text accessibilityRole="header" style={styles.title}>LifeOS Today</Text>
          <Text style={styles.date}>{date.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={retry ? 'Retry' : 'Refresh'}
          accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void refresh()}
          style={({ pressed }) => [styles.button, (pressed || busy) && styles.buttonDim]}>
          <Text style={styles.buttonText}>{retry ? 'Retry' : 'Refresh'}</Text>
        </Pressable>
      </View>
      <Text style={styles.intro}>Your day, with the next step in reach.</Text>
      <View style={styles.status} accessibilityLiveRegion="polite">
        {busy && <ActivityIndicator color={colors.action} accessibilityLabel="Refreshing schedule" />}
        <Text style={styles.body}>
          {snapshot ? `${state.saved ? 'Saved snapshot' : state.error ? 'Last loaded' : 'Updated'} · ${new Date(snapshot.fetchedAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}` : busy ? 'Loading the public demo…' : 'No saved snapshot yet. Connect to the internet and tap Retry.'}
        </Text>
        {state.error && snapshot && <Text style={styles.caution}>Could not refresh. Showing {state.warning ? 'last loaded data' : 'saved data'}. Check your connection and tap Retry.</Text>}
        {state.warning && <Text style={styles.caution}>Loaded fresh data, but could not save it for offline use. Try refreshing again.</Text>}
      </View>
      {agenda && <>
        <View style={styles.sectionHeading}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Today’s schedule</Text>
          <Text style={styles.secondary}>{agenda.schedule.length} events</Text>
        </View>
        {agenda.schedule.length === 0 && <Text style={styles.empty}>No events today.</Text>}
        {agenda.schedule.map(event => (
          <View key={event.id} style={styles.event}>
            <View style={styles.timeColumn}>
              <Text style={styles.time}>{eventTime(event.start)}</Text>
              <Text style={styles.secondary}>to {eventTime(event.end)}</Text>
            </View>
            <View style={styles.details}>
              <Text style={styles.rowTitle}>{event.title}</Text>
              {!!event.location && <Text style={styles.secondary}>{event.location}</Text>}
            </View>
          </View>
        ))}
        <View style={styles.sectionHeading}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Unfinished deadlines</Text>
          <Text style={styles.secondary}>{agenda.deadlines.length} open</Text>
        </View>
        {agenda.deadlines.length === 0 && <Text style={styles.empty}>No unfinished deadlines.</Text>}
        {agenda.deadlines.map(task => (
          <View key={task.id} style={styles.task}>
            <Text style={[styles.due, (!task.dueDate || task.dueDate < localDay(date)) && styles.caution]}>{deadlineLabel(task.dueDate, date)}</Text>
            <Text style={styles.rowTitle}>{task.title}</Text>
            {!!task.course && <Text style={styles.secondary}>{task.course}</Text>}
            {!!task.nextStep && <Text style={styles.nextStep}>{task.nextStep}</Text>}
          </View>
        ))}
      </>}
      <View style={styles.footer}>
        <Text style={styles.footerTitle}>Public demo</Text>
        <Text style={styles.secondary}>Fictional LifeOS examples. Times follow this device’s time zone. Pull down or tap Refresh to fetch a new snapshot.</Text>
        <Text style={styles.secondary}>Saved dates stay fixed while offline. This app does not sync changes from the LifeOS browser demo.</Text>
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 28, paddingBottom: 40 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headingText: { flex: 1 },
  title: { fontSize: 32, fontWeight: '700', color: colors.ink, letterSpacing: -0.6 },
  date: { fontSize: 17, color: colors.secondary, marginTop: 6 },
  intro: { fontSize: 17, color: colors.ink, marginTop: 22, marginBottom: 20 },
  button: { backgroundColor: colors.action, minHeight: 48, minWidth: 84, borderRadius: 12, justifyContent: 'center', alignItems: 'center', padding: 12 },
  buttonDim: { opacity: 0.6 },
  buttonText: { color: colors.paper, fontSize: 16, fontWeight: '600' },
  status: { padding: 16, gap: 10, backgroundColor: colors.paper, borderRadius: 12 },
  body: { color: colors.ink, fontSize: 16, lineHeight: 24 },
  caution: { color: colors.caution, fontSize: 16, lineHeight: 24 },
  sectionHeading: { marginTop: 32, marginBottom: 10, gap: 4 },
  sectionTitle: { color: colors.ink, fontSize: 23, fontWeight: '700' },
  secondary: { color: colors.secondary, fontSize: 15, lineHeight: 22, flexShrink: 1 },
  event: { flexDirection: 'row', gap: 16, paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
  timeColumn: { flex: 0.4, minWidth: 90, gap: 4 },
  time: { color: colors.action, fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  details: { flex: 1, gap: 4 },
  rowTitle: { color: colors.ink, fontSize: 18, lineHeight: 25, fontWeight: '600' },
  task: { gap: 5, paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
  due: { color: colors.action, fontSize: 15, fontWeight: '600' },
  nextStep: { color: colors.ink, fontSize: 16, lineHeight: 24, marginTop: 6 },
  empty: { color: colors.secondary, fontSize: 17, paddingVertical: 18 },
  footer: { marginTop: 36, gap: 10 },
  footerTitle: { fontSize: 17, color: colors.ink, fontWeight: '600' },
});

import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { Participant } from '@/features/participants/domain/participant';
import type { Recording } from '@/features/recordings/domain/recording';
import type { Scenario } from '@/features/scenarios/domain/scenario';
import type { CollectionSession } from '@/features/sessions/domain/session';
import { Button, Card, EmptyState, ErrorNotice, Heading, Screen, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

export default function SessionDetailScreen() {
  const params = useLocalSearchParams<{ sessionId: string }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const repositories = useRepositories();
  const [session, setSession] = useState<CollectionSession | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [consentValid, setConsentValid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const sessionResult = await repositories.sessions.get(sessionId);
      if (!sessionResult) throw new Error('Session not found.');
      const [participantResult, scenarioResults, recordingResults, consentResult] = await Promise.all([
        repositories.participants.get(sessionResult.participantId),
        repositories.scenarios.listByProject(sessionResult.projectId),
        repositories.recordings.listBySession(sessionResult.id),
        repositories.consent.participantCanRecord(sessionResult.participantId),
      ]);
      setSession(sessionResult);
      setParticipant(participantResult);
      setScenarios(scenarioResults);
      setRecordings(recordingResults);
      setConsentValid(consentResult);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Session could not be loaded.');
    }
  }, [repositories, sessionId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const updateState = async (action: 'resume' | 'reopen' | 'pause' | 'complete') => {
    if (!session) return;
    try {
      if (action === 'resume') await repositories.sessions.resume(session.id);
      if (action === 'reopen') await repositories.sessions.reopen(session.id);
      if (action === 'pause') await repositories.sessions.pause(session.id);
      if (action === 'complete') await repositories.sessions.complete(session.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Session state could not be changed.');
    }
  };

  const confirmComplete = () => Alert.alert('Complete session?', 'You can review its recordings later, but cannot add new takes.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Complete', onPress: () => void updateState('complete') },
  ]);

  const confirmReopen = () => Alert.alert(
    'Reopen completed session?',
    'The completion time will be cleared and new takes can be added. Existing recordings will remain attached.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reopen session', onPress: () => void updateState('reopen') },
    ],
  );

  if (!session) return <Screen>{error ? <ErrorNotice message={error} /> : <EmptyState>Loading session…</EmptyState>}</Screen>;
  const canCollect = session.status === 'in_progress' && consentValid && participant?.status === 'active';
  const counts = recordings.reduce<Record<string, number>>((accumulator, recording) => {
    accumulator[recording.scenarioId] = (accumulator[recording.scenarioId] ?? 0) + 1;
    return accumulator;
  }, {});

  return (
    <Screen>
      <Heading subtitle={`${participant?.speakerCode ?? 'Unknown speaker'} · ${session.collectionEnvironment}`}>Collection session</Heading>
      {error ? <ErrorNotice message={error} /> : null}
      <Card>
        <View style={uiStyles.row}>
          <Text style={session.status === 'completed' ? uiStyles.badge : styles.stateBadge}>{session.status.replaceAll('_', ' ').toUpperCase()}</Text>
          <Text style={consentValid ? uiStyles.badge : styles.blockedBadge}>{consentValid ? 'CONSENT VALID' : 'CONSENT BLOCKED'}</Text>
        </View>
        <Text style={uiStyles.muted}>Started {new Date(session.startedAt).toLocaleString()}</Text>
        <Text style={uiStyles.muted}>{session.city || 'No city recorded'} · {recordings.length} recording{recordings.length === 1 ? '' : 's'}</Text>
        {session.status === 'paused' && consentValid ? <Button label="Resume session" onPress={() => void updateState('resume')} /> : null}
        {session.status === 'in_progress' ? <Button label="Pause and finish later" variant="secondary" onPress={() => void updateState('pause')} /> : null}
        {session.status === 'in_progress' || session.status === 'paused' ? <Button label="Complete session" variant="secondary" onPress={confirmComplete} /> : null}
        {session.status === 'completed' && consentValid ? <Button label="Reopen completed session" variant="secondary" onPress={confirmReopen} /> : null}
      </Card>

      {recordings.length > 0 ? (
        <Card>
          <Text style={uiStyles.title}>Transcription and annotation</Text>
          <Text style={uiStyles.body}>You can annotate now or after finishing every scenario. Open a recording in the library to replay it, enter verbatim and normalized text, add language tags and business labels, and save revision history.</Text>
          <Button label="Review, transcribe and annotate recordings" variant="secondary" onPress={() => router.push('/library')} />
        </Card>
      ) : null}

      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Choose a scenario</Text></View>
      {!consentValid ? <ErrorNotice message="Recording is disabled. Review the participant's current consent before continuing." /> : null}
      {scenarios.length === 0 ? <EmptyState>No active scenarios are configured for this project.</EmptyState> : scenarios.map((scenario) => (
        <Pressable
          key={scenario.id}
          disabled={!canCollect}
          onPress={() => router.push(`/sessions/${session.id}/record?scenarioId=${scenario.id}`)}
          style={!canCollect ? styles.disabled : undefined}>
          <Card>
            <View style={uiStyles.row}>
              <Text style={[uiStyles.title, uiStyles.grow]}>{scenario.title}</Text>
              <Text style={uiStyles.badge}>{counts[scenario.id] ?? 0} takes</Text>
            </View>
            <Text style={uiStyles.body}>{scenario.collectionInstructions}</Text>
            <Text style={uiStyles.muted}>Version {scenario.version}</Text>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stateBadge: { alignSelf: 'flex-start', color: colors.warning, backgroundColor: '#F6E9CF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 12, fontWeight: '700' },
  blockedBadge: { alignSelf: 'flex-start', color: colors.danger, backgroundColor: '#FFF0F0', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 12, fontWeight: '700' },
  sectionHeader: { marginTop: spacing.sm },
  sectionTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  disabled: { opacity: 0.45 },
});

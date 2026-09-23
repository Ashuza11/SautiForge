import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import { canRecord, type ConsentRecord } from '@/features/consent/domain/consent';
import type { Participant } from '@/features/participants/domain/participant';
import type { CollectionSession } from '@/features/sessions/domain/session';
import { Button, Card, EmptyState, ErrorNotice, Heading, Screen, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

export default function ParticipantDetailScreen() {
  const params = useLocalSearchParams<{ participantId: string }>();
  const participantId = Array.isArray(params.participantId) ? params.participantId[0] : params.participantId;
  const repositories = useRepositories();
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [history, setHistory] = useState<ConsentRecord[]>([]);
  const [sessions, setSessions] = useState<CollectionSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!participantId) return;
    try {
      const [participantResult, consentResults, sessionResults] = await Promise.all([
        repositories.participants.get(participantId),
        repositories.consent.listByParticipant(participantId),
        repositories.sessions.listByParticipant(participantId),
      ]);
      setParticipant(participantResult);
      setHistory(consentResults);
      setSessions(sessionResults);
      setError(participantResult ? null : 'Participant not found.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Participant could not be loaded.');
    }
  }, [participantId, repositories]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const archive = () => {
    if (!participant) return;
    Alert.alert('Archive participant?', 'Historical sessions and consent records will be preserved. New sessions will be disabled.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: async () => {
        try {
          await repositories.participants.archive(participant.id);
          await load();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Participant could not be archived.');
        }
      } },
    ]);
  };

  if (!participant) return <Screen>{error ? <ErrorNotice message={error} /> : <EmptyState>Loading participant…</EmptyState>}</Screen>;
  const current = history[0] ?? null;
  const authorized = participant.status === 'active' && canRecord(current);

  return (
    <Screen>
      <Heading subtitle="Pseudonymous participant record">{participant.speakerCode}</Heading>
      {error ? <ErrorNotice message={error} /> : null}
      <Card>
        <Text style={authorized ? uiStyles.badge : styles.blockedBadge}>{authorized ? 'RECORDING CONSENT VALID' : 'RECORDING DISABLED'}</Text>
        <Text style={uiStyles.body}>{participant.primaryLanguage}{participant.languageVariety ? ` · ${participant.languageVariety}` : ''}</Text>
        <Text style={uiStyles.muted}>Other languages: {participant.otherLanguages.join(', ') || 'Not recorded'}</Text>
        <Text style={uiStyles.muted}>Age bracket: {participant.ageBracket || 'Not recorded'}</Text>
        <Text style={uiStyles.muted}>Gender: {participant.genderSelfDescribed || 'Not recorded'}</Text>
        <Text style={uiStyles.muted}>Business: {participant.businessCategory || 'Not recorded'}</Text>
        <Text style={uiStyles.muted}>Experience: {participant.yearsBusinessExperience ?? 'Not recorded'} years</Text>
        <Button label="Edit participant" variant="secondary" onPress={() => router.push(`/participants/${participant.id}/edit`)} />
        <Button label={current ? 'Update consent' : 'Record consent'} onPress={() => router.push(`/participants/${participant.id}/consent/new`)} />
        {authorized ? <Button label="Start new session" onPress={() => router.push(`/participants/${participant.id}/sessions/new`)} /> : null}
      </Card>

      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Sessions</Text><Text style={styles.count}>{sessions.length}</Text></View>
      {sessions.length === 0 ? <EmptyState>No collection sessions for this participant.</EmptyState> : sessions.map((session) => (
        <Card key={session.id}>
          <View style={uiStyles.row}>
            <Text style={[uiStyles.title, uiStyles.grow]}>{new Date(session.startedAt).toLocaleString()}</Text>
            <Text style={session.status === 'completed' ? uiStyles.badge : styles.sessionBadge}>{session.status.replaceAll('_', ' ').toUpperCase()}</Text>
          </View>
          <Text style={uiStyles.muted}>{session.collectionEnvironment}{session.city ? ` · ${session.city}` : ''}</Text>
          {session.status === 'in_progress' || session.status === 'paused' ? (
            <Button label="Resume session" variant="secondary" onPress={() => router.push(`/sessions/${session.id}`)} />
          ) : null}
        </Card>
      ))}

      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Consent history</Text><Text style={styles.count}>{history.length}</Text></View>
      {history.length === 0 ? <EmptyState>No consent record. Microphone access must remain disabled.</EmptyState> : history.map((record, index) => (
        <Card key={record.id}>
          <View style={uiStyles.row}>
            <Text style={record.status === 'granted' ? uiStyles.badge : styles.blockedBadge}>{record.status.toUpperCase()}</Text>
            {index === 0 ? <Text style={uiStyles.muted}>Current</Text> : null}
          </View>
          <Text style={uiStyles.muted}>{new Date(record.consentedAt).toLocaleString()} · protocol {record.consentProtocolVersion}</Text>
          <Text style={uiStyles.body}>Internal research: {record.internalResearch ? 'Yes' : 'No'}</Text>
          <Text style={uiStyles.body}>Restricted annotation: {record.restrictedAnnotation ? 'Yes' : 'No'}</Text>
          <Text style={uiStyles.body}>Public release: {record.publicRelease ? 'Yes' : 'No'}</Text>
          {record.notes ? <Text style={uiStyles.muted}>Administrative note: {record.notes}</Text> : null}
        </Card>
      ))}
      {participant.status === 'active' ? <Button label="Archive participant" variant="danger" onPress={archive} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  blockedBadge: { alignSelf: 'flex-start', color: colors.danger, backgroundColor: '#FFF0F0', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 12, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  count: { color: colors.primary, backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, overflow: 'hidden', fontWeight: '700' },
  sessionBadge: { alignSelf: 'flex-start', color: colors.warning, backgroundColor: '#F6E9CF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 12, fontWeight: '700' },
});

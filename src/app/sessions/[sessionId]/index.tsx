import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { Participant } from '@/features/participants/domain/participant';
import type { Recording } from '@/features/recordings/domain/recording';
import type { Scenario } from '@/features/scenarios/domain/scenario';
import type { CollectionSession } from '@/features/sessions/domain/session';
import { useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorNotice, Heading, Screen, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

export default function SessionDetailScreen() {
  const params = useLocalSearchParams<{ sessionId: string }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const repositories = useRepositories();
  const { localeTag, strings, translateText } = useI18n();
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
      if (!sessionResult) throw new Error(strings.sessionNotFound);
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
      setError(cause instanceof Error ? translateText(cause.message) : strings.sessionLoadFailed);
    }
  }, [repositories, sessionId, strings, translateText]);
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
      setError(cause instanceof Error ? translateText(cause.message) : strings.sessionStateFailed);
    }
  };

  const confirmComplete = () => Alert.alert(strings.completeSessionQuestion, strings.completeSessionWarning, [
    { text: strings.cancel, style: 'cancel' },
    { text: strings.complete, onPress: () => void updateState('complete') },
  ]);

  const confirmReopen = () => Alert.alert(
    strings.reopenSessionQuestion,
    strings.reopenSessionWarning,
    [
      { text: strings.cancel, style: 'cancel' },
      { text: strings.reopenSession, onPress: () => void updateState('reopen') },
    ],
  );

  const removeIncorrectSession = () => {
    if (!session) return;
    Alert.alert(
      strings.removeSessionQuestion,
      recordings.length > 0
        ? `${strings.removeSessionWithRecordings} ${recordings.length}. ${strings.recoveryCopyRetained}`
        : `${strings.removeSessionWarning} ${strings.recoveryCopyRetained}`,
      [
        { text: strings.cancel, style: 'cancel' },
        { text: strings.removeSession, style: 'destructive', onPress: async () => {
          try {
            await repositories.sessions.archive(session.id);
            router.back();
          } catch (cause) {
            setError(cause instanceof Error ? translateText(cause.message) : strings.sessionRemoveFailed);
          }
        } },
      ],
    );
  };

  if (!session) return <Screen>{error ? <ErrorNotice message={error} /> : <EmptyState>{strings.loadingSession}</EmptyState>}</Screen>;
  const canCollect = session.status === 'in_progress' && consentValid && participant?.status === 'active';
  const counts = recordings.reduce<Record<string, number>>((accumulator, recording) => {
    accumulator[recording.scenarioId] = (accumulator[recording.scenarioId] ?? 0) + 1;
    return accumulator;
  }, {});

  return (
    <Screen>
      <Heading subtitle={`${participant?.speakerCode ?? strings.unknownSpeaker} · ${translateText(session.collectionEnvironment)}`}>{strings.collectionSession}</Heading>
      {error ? <ErrorNotice message={error} /> : null}
      <Card>
        <View style={uiStyles.row}>
          <Text style={session.status === 'completed' ? uiStyles.badge : styles.stateBadge}>{translateText(session.status.replaceAll('_', ' ')).toUpperCase()}</Text>
          <Text style={consentValid ? uiStyles.badge : styles.blockedBadge}>{consentValid ? strings.consentValid : strings.consentBlocked}</Text>
        </View>
        <Text style={uiStyles.muted}>{strings.started}: {new Date(session.startedAt).toLocaleString(localeTag)}</Text>
        <Text style={uiStyles.muted}>{session.city || strings.noCity} · {recordings.length} {strings.recordings.toLowerCase()}</Text>
        {session.status === 'paused' && consentValid ? <Button label={strings.resumeSession} onPress={() => void updateState('resume')} /> : null}
        {session.status === 'in_progress' ? <Button label={strings.pauseSession} variant="secondary" onPress={() => void updateState('pause')} /> : null}
        {session.status === 'in_progress' || session.status === 'paused' ? <Button label={strings.completeSession} variant="secondary" onPress={confirmComplete} /> : null}
        {session.status === 'completed' && consentValid ? <Button label={strings.reopenSession} variant="secondary" onPress={confirmReopen} /> : null}
      </Card>

      {recordings.length > 0 ? (
        <Card>
          <Text style={uiStyles.title}>{strings.transcriptionAndAnnotation}</Text>
          <Button label={strings.reviewRecordings} variant="secondary" onPress={() => router.push('/library')} />
        </Card>
      ) : null}

      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{strings.chooseScenario}</Text></View>
      {!consentValid ? <ErrorNotice message={strings.reviewConsentBeforeRecording} /> : null}
      {scenarios.length === 0 ? <EmptyState>{strings.noActiveScenarios}</EmptyState> : scenarios.map((scenario) => (
        <Pressable
          key={scenario.id}
          disabled={!canCollect}
          onPress={() => router.push(`/sessions/${session.id}/record?scenarioId=${scenario.id}`)}
          style={!canCollect ? styles.disabled : undefined}>
          <Card>
            <View style={uiStyles.row}>
              <Text style={[uiStyles.title, uiStyles.grow]}>{scenario.title}</Text>
              <Text style={uiStyles.badge}>{counts[scenario.id] ?? 0} {strings.takes}</Text>
            </View>
            <Text style={uiStyles.body}>{scenario.collectionInstructions}</Text>
            <Text style={uiStyles.muted}>{strings.version} {scenario.version}</Text>
          </Card>
        </Pressable>
      ))}
      <Button label={strings.removeSession} variant="danger" onPress={removeIncorrectSession} />
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

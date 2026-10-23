import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { Project } from '@/features/projects/domain/project';
import type { Scenario } from '@/features/scenarios/domain/scenario';
import type { Participant } from '@/features/participants/domain/participant';
import type { ParticipantProgress } from '@/features/participants/domain/participant-progress';
import { canRecord, type ConsentRecord } from '@/features/consent/domain/consent';
import { useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorNotice, Heading, Screen, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

export default function ProjectDetailScreen() {
  const params = useLocalSearchParams<{ projectId: string }>();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const repositories = useRepositories();
  const { strings, translateText } = useI18n();
  const [project, setProject] = useState<Project | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [currentConsent, setCurrentConsent] = useState<Record<string, ConsentRecord | null>>({});
  const [participantProgress, setParticipantProgress] = useState<Record<string, ParticipantProgress>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [projectResult, scenarioResults, participantResults, activeProject, progress] = await Promise.all([
        repositories.projects.get(projectId),
        repositories.scenarios.listByProject(projectId, true),
        repositories.participants.listByProject(projectId, true),
        repositories.projects.getActive(),
        repositories.participants.getProgressByProject(projectId),
      ]);
      const consentPairs = await Promise.all(participantResults.map(async (participant) => [participant.id, await repositories.consent.getCurrent(participant.id)] as const));
      setProject(projectResult);
      setScenarios(scenarioResults);
      setParticipants(participantResults);
      setActiveProjectId(activeProject?.id ?? null);
      setCurrentConsent(Object.fromEntries(consentPairs));
      setParticipantProgress(progress);
      setError(projectResult ? null : strings.projectNotFound);
    } catch (cause) {
      setError(cause instanceof Error ? translateText(cause.message) : strings.projectLoadFailed);
    }
  }, [projectId, repositories, strings, translateText]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const archiveProject = () => {
    if (!project) return;
    Alert.alert(strings.archiveProjectQuestion, strings.archiveProjectWarning, [
      { text: strings.cancel, style: 'cancel' },
      { text: strings.archive, style: 'destructive', onPress: async () => {
        try {
          await repositories.projects.archive(project.id);
          router.replace('/');
        } catch (cause) {
          setError(cause instanceof Error ? translateText(cause.message) : strings.projectArchiveFailed);
        }
      } },
    ]);
  };

  const selectForCollection = async () => {
    if (!project) return;
    try {
      await repositories.projects.setActive(project.id);
      setActiveProjectId(project.id);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? translateText(cause.message) : strings.activeProjectChangeFailed);
    }
  };

  const archiveScenario = (scenario: Scenario) => {
    Alert.alert(strings.archiveScenarioQuestion, strings.archiveScenarioWarning, [
      { text: strings.cancel, style: 'cancel' },
      { text: strings.archive, style: 'destructive', onPress: async () => {
        try {
          await repositories.scenarios.archive(scenario.id);
          await load();
        } catch (cause) {
          setError(cause instanceof Error ? translateText(cause.message) : strings.scenarioArchiveFailed);
        }
      } },
    ]);
  };

  if (!project) return <Screen>{error ? <ErrorNotice message={error} /> : <EmptyState>{strings.loadingProject}</EmptyState>}</Screen>;

  return (
    <Screen>
      <Heading subtitle={`${project.targetLanguage} · ${project.languageVariety}`}>{project.title}</Heading>
      {error ? <ErrorNotice message={error} /> : null}
      <Card>
        {project.status === 'archived' ? <Text style={styles.archivedBadge}>{strings.archived}</Text> : null}
        {activeProjectId === project.id ? <Text style={uiStyles.badge}>{strings.currentCollectionProject}</Text> : null}
        <Text style={uiStyles.body}>{project.description || strings.noDescription}</Text>
        <View style={uiStyles.divider} />
        <Text style={uiStyles.muted}>{strings.domain}: {project.researchDomain}</Text>
        <Text style={uiStyles.muted}>{strings.languageCode}: {project.languageCode}</Text>
        <Text style={uiStyles.muted}>{strings.annotationProfile}: {project.annotationProfile === 'business_transaction' ? strings.businessTransactionProfile : strings.verbatimTranscriptionProfile}</Text>
        <Text style={uiStyles.muted}>{strings.location}: {project.collectionLocation}</Text>
        <Text style={uiStyles.muted}>{strings.protocol}: {project.protocolVersion}</Text>
        {project.status === 'active' && activeProjectId !== project.id ? <Button label={strings.selectProject} variant="secondary" onPress={() => void selectForCollection()} /> : null}
        <Button label={strings.editProject} variant="secondary" onPress={() => router.push(`/projects/${project.id}/edit`)} />
      </Card>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{strings.participants}</Text>
        <Text style={styles.count}>{participants.length}</Text>
      </View>
      {participants.length === 0 ? <EmptyState>{strings.noParticipants}</EmptyState> : participants.map((participant) => {
        const progress = participantProgress[participant.id];
        return (
          <Pressable key={participant.id} onPress={() => router.push(`/participants/${participant.id}`)}>
            <View style={[styles.participantCard, progress?.collectionComplete && styles.collectionCompleteCard, progress?.transcriptionComplete && styles.transcriptionCompleteCard]}>
              <View style={uiStyles.row}>
                <Text style={[uiStyles.title, uiStyles.grow]}>{participant.speakerCode}</Text>
                <Text style={canRecord(currentConsent[participant.id] ?? null) ? uiStyles.badge : styles.consentRequired}>
                  {canRecord(currentConsent[participant.id] ?? null) ? strings.consentValid : strings.consentRequired}
                </Text>
              </View>
              <Text style={uiStyles.muted}>{participant.primaryLanguage}{participant.languageVariety ? ` · ${participant.languageVariety}` : ''}</Text>
              {progress ? <Text style={uiStyles.muted}>{progress.recordingCount}/{progress.requiredRecordingCount} {strings.targetRecordings} · {progress.transcribedRecordingCount}/{progress.recordingCount} {strings.transcribed}</Text> : null}
              {progress?.transcriptionComplete ? <Text style={styles.transcriptionCompleteBadge}>{strings.transcriptionComplete}</Text> : progress?.collectionComplete ? <Text style={styles.collectionCompleteBadge}>{strings.collectionComplete}</Text> : null}
              {participant.status !== 'active' ? <Text style={styles.archivedBadge}>{translateText(participant.status).toUpperCase()}</Text> : null}
            </View>
          </Pressable>
        );
      })}
      {project.status === 'active' ? <Button label={strings.registerParticipant} onPress={() => router.push(`/projects/${project.id}/participants/new`)} /> : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{strings.scenarios}</Text>
        <Text style={styles.count}>{scenarios.length}</Text>
      </View>
      {scenarios.length === 0 ? <EmptyState>{strings.noScenarios}</EmptyState> : scenarios.map((scenario) => (
        <Pressable key={scenario.id} onPress={() => router.push(`/scenarios/${scenario.id}/edit`)}>
          <Card>
            <View style={uiStyles.row}>
              <Text style={[uiStyles.title, uiStyles.grow]}>{scenario.title}</Text>
              <Text style={uiStyles.badge}>v{scenario.version}</Text>
            </View>
            {scenario.status === 'archived' ? <Text style={styles.archivedBadge}>{strings.archived}</Text> : null}
            <Text style={uiStyles.body}>{scenario.description}</Text>
            <Text style={uiStyles.muted}>{translateText(scenario.collectionMethod.replaceAll('_', ' '))}</Text>
            {scenario.status === 'active' ? <Button label={strings.archiveScenario} variant="secondary" onPress={() => archiveScenario(scenario)} /> : null}
          </Card>
        </Pressable>
      ))}
      <Button label={strings.newScenario} onPress={() => router.push(`/projects/${project.id}/scenarios/new`)} />
      {project.status === 'active' ? <Button label={strings.archiveProject} variant="danger" onPress={archiveProject} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  count: { color: colors.primary, backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, overflow: 'hidden', fontWeight: '700' },
  archivedBadge: { alignSelf: 'flex-start', color: colors.warning, backgroundColor: colors.warningSoft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 12, fontWeight: '700' },
  consentRequired: { alignSelf: 'flex-start', color: colors.danger, backgroundColor: '#FFF0F0', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 12, fontWeight: '700' },
  participantCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: spacing.md, gap: spacing.sm },
  collectionCompleteCard: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  transcriptionCompleteCard: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  collectionCompleteBadge: { alignSelf: 'flex-start', color: colors.warning, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 12, fontWeight: '700' },
  transcriptionCompleteBadge: { alignSelf: 'flex-start', color: colors.primaryPressed, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 12, fontWeight: '700' },
});

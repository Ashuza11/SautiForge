import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { Project } from '@/features/projects/domain/project';
import type { Scenario } from '@/features/scenarios/domain/scenario';
import type { Participant } from '@/features/participants/domain/participant';
import { canRecord, type ConsentRecord } from '@/features/consent/domain/consent';
import { strings } from '@/i18n/en';
import { Button, Card, EmptyState, ErrorNotice, Heading, Screen, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

export default function ProjectDetailScreen() {
  const params = useLocalSearchParams<{ projectId: string }>();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const repositories = useRepositories();
  const [project, setProject] = useState<Project | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [currentConsent, setCurrentConsent] = useState<Record<string, ConsentRecord | null>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [projectResult, scenarioResults, participantResults, activeProject] = await Promise.all([
        repositories.projects.get(projectId),
        repositories.scenarios.listByProject(projectId, true),
        repositories.participants.listByProject(projectId, true),
        repositories.projects.getActive(),
      ]);
      const consentPairs = await Promise.all(participantResults.map(async (participant) => [participant.id, await repositories.consent.getCurrent(participant.id)] as const));
      setProject(projectResult);
      setScenarios(scenarioResults);
      setParticipants(participantResults);
      setActiveProjectId(activeProject?.id ?? null);
      setCurrentConsent(Object.fromEntries(consentPairs));
      setError(projectResult ? null : 'Project not found.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The project could not be loaded.');
    }
  }, [projectId, repositories]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const archiveProject = () => {
    if (!project) return;
    Alert.alert('Archive project?', 'Existing research records will be preserved. This project will no longer appear in the active list.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: async () => {
        try {
          await repositories.projects.archive(project.id);
          router.replace('/');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'The project could not be archived.');
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
      setError(cause instanceof Error ? cause.message : 'The active collection project could not be changed.');
    }
  };

  const archiveScenario = (scenario: Scenario) => {
    Alert.alert('Archive scenario?', 'The scenario will be hidden from new collection. Historical recordings will retain their snapshot.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: async () => {
        try {
          await repositories.scenarios.archive(scenario.id);
          await load();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'The scenario could not be archived.');
        }
      } },
    ]);
  };

  if (!project) return <Screen>{error ? <ErrorNotice message={error} /> : <EmptyState>Loading project…</EmptyState>}</Screen>;

  return (
    <Screen>
      <Heading subtitle={`${project.targetLanguage} · ${project.languageVariety}`}>{project.title}</Heading>
      {error ? <ErrorNotice message={error} /> : null}
      <Card>
        {project.status === 'archived' ? <Text style={styles.archivedBadge}>ARCHIVED</Text> : null}
        {activeProjectId === project.id ? <Text style={uiStyles.badge}>CURRENT COLLECTION PROJECT</Text> : null}
        <Text style={uiStyles.body}>{project.description || 'No description'}</Text>
        <View style={uiStyles.divider} />
        <Text style={uiStyles.muted}>Domain: {project.researchDomain}</Text>
        <Text style={uiStyles.muted}>Location: {project.collectionLocation}</Text>
        <Text style={uiStyles.muted}>Protocol: {project.protocolVersion}</Text>
        <Text style={uiStyles.muted}>The current collection project controls the dashboard and where new participants, sessions, and recordings are created. It does not change existing records.</Text>
        {project.status === 'active' && activeProjectId !== project.id ? <Button label={strings.selectProject} variant="secondary" onPress={() => void selectForCollection()} /> : null}
        <Button label="Edit project" variant="secondary" onPress={() => router.push(`/projects/${project.id}/edit`)} />
      </Card>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Participants</Text>
        <Text style={styles.count}>{participants.length}</Text>
      </View>
      {participants.length === 0 ? <EmptyState>No participants registered. Add a pseudonymous speaker before starting a session.</EmptyState> : participants.map((participant) => (
        <Pressable key={participant.id} onPress={() => router.push(`/participants/${participant.id}`)}>
          <Card>
            <View style={uiStyles.row}>
              <Text style={[uiStyles.title, uiStyles.grow]}>{participant.speakerCode}</Text>
              <Text style={canRecord(currentConsent[participant.id] ?? null) ? uiStyles.badge : styles.consentRequired}>
                {canRecord(currentConsent[participant.id] ?? null) ? 'CONSENT VALID' : 'CONSENT REQUIRED'}
              </Text>
            </View>
            <Text style={uiStyles.muted}>{participant.primaryLanguage}{participant.languageVariety ? ` · ${participant.languageVariety}` : ''}</Text>
            {participant.status !== 'active' ? <Text style={styles.archivedBadge}>{participant.status.toUpperCase()}</Text> : null}
          </Card>
        </Pressable>
      ))}
      {project.status === 'active' ? <Button label="Register participant" onPress={() => router.push(`/projects/${project.id}/participants/new`)} /> : null}

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
            {scenario.status === 'archived' ? <Text style={styles.archivedBadge}>ARCHIVED</Text> : null}
            <Text style={uiStyles.body}>{scenario.description}</Text>
            <Text style={uiStyles.muted}>{scenario.collectionMethod.replaceAll('_', ' ')}</Text>
            {scenario.status === 'active' ? <Button label="Archive scenario" variant="secondary" onPress={() => archiveScenario(scenario)} /> : null}
          </Card>
        </Pressable>
      ))}
      <Button label={strings.newScenario} onPress={() => router.push(`/projects/${project.id}/scenarios/new`)} />
      {project.status === 'active' ? <Button label="Archive project" variant="danger" onPress={archiveProject} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  count: { color: colors.primary, backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, overflow: 'hidden', fontWeight: '700' },
  archivedBadge: { alignSelf: 'flex-start', color: colors.warning, backgroundColor: '#F6E9CF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 12, fontWeight: '700' },
  consentRequired: { alignSelf: 'flex-start', color: colors.danger, backgroundColor: '#FFF0F0', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 12, fontWeight: '700' },
});

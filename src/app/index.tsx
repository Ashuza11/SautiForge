import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { Project } from '@/features/projects/domain/project';
import type { DashboardSummary } from '@/features/dashboard/data/dashboard-repository';
import { useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorNotice, Heading, Screen, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

export default function HomeScreen() {
  const repositories = useRepositories();
  const { strings } = useI18n();
  const projectRepository = repositories.projects;
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<Project | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [items, selected] = await Promise.all([projectRepository.list(true), projectRepository.getActive()]);
      setProjects(items);
      setActive(selected);
      setSummary(selected ? await repositories.dashboard.getProjectSummary(selected.id) : null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : strings.projectsLoadFailed);
    }
  }, [projectRepository, repositories.dashboard, strings.projectsLoadFailed]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const select = async (project: Project) => {
    try {
      await projectRepository.setActive(project.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : strings.activeProjectChangeFailed);
    }
  };

  return (
    <Screen>
      <Heading subtitle={strings.tagline}>{strings.appName}</Heading>
      {error ? <ErrorNotice message={error} action={<Button label={strings.retry} variant="secondary" onPress={() => void load()} />} /> : null}

      <Text style={styles.sectionLabel}>{strings.activeProject}</Text>
      {active ? (
        <Card>
          <Text style={uiStyles.badge}>{strings.active}</Text>
          <Text style={uiStyles.title}>{active.title}</Text>
          <Text style={uiStyles.muted}>{active.languageVariety} · {active.collectionLocation}</Text>
          <Button label={strings.openProject} onPress={() => router.push(`/projects/${active.id}`)} />
        </Card>
      ) : (
        <Card><EmptyState>{strings.selectActiveProject}</EmptyState></Card>
      )}

      {summary ? (
        <View style={styles.statGrid}>
          <Stat label={strings.participants} value={summary.participantCount.toString()} />
          <Stat label={strings.sessions} value={summary.sessionCount.toString()} />
          <Stat label={strings.recordings} value={summary.recordingCount.toString()} />
          <Stat label={strings.duration} value={formatDuration(summary.durationMs, strings.minuteShort, strings.hourShort)} />
          <Stat label={strings.needsReview} value={summary.needsReviewCount.toString()} />
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>{strings.projects}</Text>
      </View>
      {projects.length === 0 ? <EmptyState>{strings.noProjects}</EmptyState> : projects.map((project) => (
        <Pressable key={project.id} onPress={() => router.push(`/projects/${project.id}`)}>
          <Card>
            {project.status === 'archived' ? <Text style={styles.archivedBadge}>{strings.archived}</Text> : null}
            <Text style={uiStyles.title}>{project.title}</Text>
            <Text style={uiStyles.muted}>{project.targetLanguage} · {project.languageVariety}</Text>
            <Text style={uiStyles.body} numberOfLines={2}>{project.description || strings.noDescription}</Text>
            {project.status === 'active' && active?.id !== project.id ? <Button label={strings.selectProject} variant="secondary" onPress={() => void select(project)} /> : null}
          </Card>
        </Pressable>
      ))}
      <Button label={strings.newProject} onPress={() => router.push('/projects/new')} />
      <Button label={strings.openRecordingLibrary} variant="secondary" onPress={() => router.push('/library')} />
      <Button label={strings.exportOrRestore} variant="secondary" onPress={() => router.push('/exports')} />
      <Button label={strings.settingsAndSafety} variant="secondary" onPress={() => router.push('/settings')} />
      <Text style={styles.privacy}>{strings.offlineByDesign}</Text>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function formatDuration(milliseconds: number, minuteShort: string, hourShort: string): string {
  const totalMinutes = Math.round(milliseconds / 60000);
  return totalMinutes < 60 ? `${totalMinutes} ${minuteShort}` : `${Math.floor(totalMinutes / 60)} ${hourShort} ${totalMinutes % 60} ${minuteShort}`;
}

const styles = StyleSheet.create({
  sectionHeader: { marginTop: spacing.sm },
  sectionLabel: { color: colors.ink, fontSize: 13, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  privacy: { color: colors.muted, textAlign: 'center', fontSize: 12, lineHeight: 18, marginVertical: spacing.md },
  archivedBadge: { alignSelf: 'flex-start', color: colors.warning, backgroundColor: '#F6E9CF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 12, fontWeight: '700' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: { minWidth: '30%', flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.sm },
  statValue: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  statLabel: { color: colors.muted, fontSize: 12 },
});

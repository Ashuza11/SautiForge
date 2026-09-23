import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { Participant } from '@/features/participants/domain/participant';
import type { Project } from '@/features/projects/domain/project';
import type { Recording } from '@/features/recordings/domain/recording';
import type { Scenario } from '@/features/scenarios/domain/scenario';
import { Button, Card, EmptyState, ErrorNotice, Field, Heading, Screen, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

const statuses: Array<Recording['annotationStatus'] | 'all'> = ['all', 'recorded', 'needs_transcription', 'transcribed', 'needs_review', 'validated', 'rejected'];

export default function LibraryScreen() {
  const repositories = useRepositories();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>();
  const [participantId, setParticipantId] = useState<string | undefined>();
  const [scenarioId, setScenarioId] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('');
  const [status, setStatus] = useState<Recording['annotationStatus'] | 'all'>('all');
  const [quality, setQuality] = useState<number | undefined>();
  const [recordedFrom, setRecordedFrom] = useState('');
  const [recordedTo, setRecordedTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [allProjects, active] = await Promise.all([repositories.projects.list(true), repositories.projects.getActive()]);
      const selectedProjectId = projectId ?? active?.id;
      if (!projectId && selectedProjectId) setProjectId(selectedProjectId);
      const [projectParticipants, projectScenarios] = selectedProjectId ? await Promise.all([
        repositories.participants.listByProject(selectedProjectId, true),
        repositories.scenarios.listByProject(selectedProjectId, true),
      ]) : [[], []];
      const fromValid = !recordedFrom || validDate(recordedFrom);
      const toValid = !recordedTo || validDate(recordedTo);
      const rangeValid = fromValid && toValid && (!recordedFrom || !recordedTo || recordedFrom <= recordedTo);
      const results = await repositories.recordings.search({
        projectId: selectedProjectId,
        participantId,
        scenarioId,
        query,
        language,
        annotationStatus: status === 'all' ? undefined : status,
        qualityRating: quality,
        recordedFrom: rangeValid && recordedFrom ? recordedFrom : undefined,
        recordedTo: rangeValid && recordedTo ? recordedTo : undefined,
      });
      setProjects(allProjects);
      setParticipants(projectParticipants);
      setScenarios(projectScenarios);
      setRecordings(results);
      if (!fromValid || !toValid) setError('Dates must use YYYY-MM-DD. Invalid dates are not applied.');
      else if (recordedFrom && recordedTo && recordedFrom > recordedTo) setError('The start date must not be after the end date.');
      else setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recordings could not be loaded.');
    }
  }, [language, participantId, projectId, quality, query, recordedFrom, recordedTo, repositories, scenarioId, status]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen>
      <Heading subtitle="Searches the active project's verified local recordings.">Recording library</Heading>
      {error ? <ErrorNotice message={error} /> : null}
      <Card>
        <Text style={styles.label}>Project</Text>
        <View style={uiStyles.row}>
          {projects.map((project) => <FilterChoice key={project.id} label={project.title} selected={projectId === project.id} onPress={() => { setProjectId(project.id); setParticipantId(undefined); setScenarioId(undefined); }} />)}
        </View>
        <Field label="Search" value={query} onChangeText={setQuery} placeholder="Recording ID, speaker, scenario, or notes" />
        <Field label="Spoken language" value={language} onChangeText={setLanguage} placeholder="Leave blank for all" />
        <Text style={styles.label}>Participant</Text>
        <View style={uiStyles.row}>
          <FilterChoice label="All" selected={!participantId} onPress={() => setParticipantId(undefined)} />
          {participants.map((participant) => <FilterChoice key={participant.id} label={participant.speakerCode} selected={participantId === participant.id} onPress={() => setParticipantId(participant.id)} />)}
        </View>
        <Text style={styles.label}>Scenario</Text>
        <View style={uiStyles.row}>
          <FilterChoice label="All" selected={!scenarioId} onPress={() => setScenarioId(undefined)} />
          {scenarios.map((scenario) => <FilterChoice key={scenario.id} label={scenario.title} selected={scenarioId === scenario.id} onPress={() => setScenarioId(scenario.id)} />)}
        </View>
        <Text style={styles.label}>Annotation status</Text>
        <View style={uiStyles.row}>
          {statuses.map((option) => <FilterChoice key={option} label={option.replaceAll('_', ' ')} selected={status === option} onPress={() => setStatus(option)} />)}
        </View>
        <Text style={styles.label}>Quality rating</Text>
        <View style={uiStyles.row}>
          <FilterChoice label="All" selected={!quality} onPress={() => setQuality(undefined)} />
          {[1, 2, 3, 4, 5].map((rating) => <FilterChoice key={rating} label={`${rating}/5`} selected={quality === rating} onPress={() => setQuality(rating)} />)}
        </View>
        <View style={styles.dateRow}>
          <View style={uiStyles.grow}><Field label="From date" value={recordedFrom} onChangeText={setRecordedFrom} placeholder="YYYY-MM-DD" autoCapitalize="none" /></View>
          <View style={uiStyles.grow}><Field label="To date" value={recordedTo} onChangeText={setRecordedTo} placeholder="YYYY-MM-DD" autoCapitalize="none" /></View>
        </View>
        <Button label="Apply filters" onPress={() => void load()} />
        <Button label="Clear filters" variant="secondary" onPress={() => { setParticipantId(undefined); setScenarioId(undefined); setQuery(''); setLanguage(''); setStatus('all'); setQuality(undefined); setRecordedFrom(''); setRecordedTo(''); }} />
      </Card>
      {recordings.length === 0 ? <EmptyState>No recordings match these filters.</EmptyState> : recordings.map((recording) => (
        <Pressable key={recording.id} onPress={() => router.push(`/recordings/${recording.id}`)}>
          <Card>
            <View style={uiStyles.row}>
              <Text style={[uiStyles.title, uiStyles.grow]}>{recording.displayId}</Text>
              <Text style={uiStyles.badge}>{recording.annotationStatus.replaceAll('_', ' ')}</Text>
            </View>
            <Text style={uiStyles.body}>{String(recording.scenarioPromptSnapshot.title ?? 'Scenario')}</Text>
            <Text style={uiStyles.muted}>{recording.spokenLanguages.join(', ')} · {formatDuration(recording.durationMs)} · {formatBytes(recording.fileSizeBytes)}</Text>
            <Text style={uiStyles.muted}>{new Date(recording.recordedAt).toLocaleString()}</Text>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

function FilterChoice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>;
}

function validDate(value: string): boolean {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const formatDuration = (milliseconds: number) => `${Math.floor(milliseconds / 60000)}:${Math.floor((milliseconds % 60000) / 1000).toString().padStart(2, '0')}`;
const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const styles = StyleSheet.create({
  label: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  choice: { borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: colors.surface },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { color: colors.ink, textTransform: 'capitalize', fontSize: 13 },
  choiceTextSelected: { color: '#FFFFFF', fontWeight: '700' },
  dateRow: { flexDirection: 'row', gap: spacing.sm },
});

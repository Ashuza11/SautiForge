import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { Recording } from '@/features/recordings/domain/recording';
import { Button, Card, EmptyState, ErrorNotice, Field, Heading, Screen, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

const statuses: Array<Recording['annotationStatus'] | 'all'> = ['all', 'needs_transcription', 'transcribed', 'needs_review', 'validated', 'rejected'];

export default function LibraryScreen() {
  const repositories = useRepositories();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('');
  const [status, setStatus] = useState<Recording['annotationStatus'] | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const active = await repositories.projects.getActive();
      const results = await repositories.recordings.search({
        projectId: active?.id,
        query,
        language,
        annotationStatus: status === 'all' ? undefined : status,
      });
      setRecordings(results);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recordings could not be loaded.');
    }
  }, [language, query, repositories, status]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen>
      <Heading subtitle="Searches the active project's verified local recordings.">Recording library</Heading>
      {error ? <ErrorNotice message={error} /> : null}
      <Card>
        <Field label="Search" value={query} onChangeText={setQuery} placeholder="Recording ID, speaker, scenario, or notes" />
        <Field label="Spoken language" value={language} onChangeText={setLanguage} placeholder="Leave blank for all" />
        <Text style={styles.label}>Annotation status</Text>
        <View style={uiStyles.row}>
          {statuses.map((option) => (
            <Pressable key={option} onPress={() => setStatus(option)} style={[styles.choice, status === option && styles.choiceSelected]}>
              <Text style={[styles.choiceText, status === option && styles.choiceTextSelected]}>{option.replaceAll('_', ' ')}</Text>
            </Pressable>
          ))}
        </View>
        <Button label="Apply filters" onPress={() => void load()} />
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

const formatDuration = (milliseconds: number) => `${Math.floor(milliseconds / 60000)}:${Math.floor((milliseconds % 60000) / 1000).toString().padStart(2, '0')}`;
const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const styles = StyleSheet.create({
  label: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  choice: { borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: colors.surface },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { color: colors.ink, textTransform: 'capitalize', fontSize: 13 },
  choiceTextSelected: { color: '#FFFFFF', fontWeight: '700' },
});

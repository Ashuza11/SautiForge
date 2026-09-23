import { useCallback, useEffect, useState } from 'react';
import { Alert, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';

import { useRepositories } from '@/core/database/repositories';
import { nullableText, nowIso } from '@/domain/common';
import type { Participant } from '@/features/participants/domain/participant';
import { discardFile, hasRecordingSpace } from '@/features/recordings/data/audio-file-store';
import { recordingMetadataDraftSchema, type AcceptedTake } from '@/features/recordings/domain/recording';
import type { Scenario } from '@/features/scenarios/domain/scenario';
import type { CollectionSession } from '@/features/sessions/domain/session';
import { Button, Card, EmptyState, ErrorNotice, Field, Heading, Screen, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

// Unaccepted takes remain temporary; accepted takes are copied and verified in document storage.
const recordingOptions = { ...RecordingPresets.HIGH_QUALITY, directory: 'cache' as const };

export default function RecordScreen() {
  const params = useLocalSearchParams<{ sessionId: string; scenarioId: string }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const scenarioId = Array.isArray(params.scenarioId) ? params.scenarioId[0] : params.scenarioId;
  const repositories = useRepositories();
  const [session, setSession] = useState<CollectionSession | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [take, setTake] = useState<AcceptedTake | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [languages, setLanguages] = useState('');
  const [variety, setVariety] = useState('');
  const [codeSwitching, setCodeSwitching] = useState('unknown');
  const [environment, setEnvironment] = useState('');
  const [noiseLevel, setNoiseLevel] = useState('unknown');
  const [quality, setQuality] = useState('');
  const [notes, setNotes] = useState('');
  const recorder = useAudioRecorder(recordingOptions, (status) => {
    if (status.hasError) setError(status.error ?? 'Recording was interrupted.');
  });
  const recorderState = useAudioRecorderState(recorder, 100);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!sessionId || !scenarioId) return;
      try {
        const [sessionResult, scenarioResult] = await Promise.all([
          repositories.sessions.get(sessionId),
          repositories.scenarios.get(scenarioId),
        ]);
        if (!sessionResult || sessionResult.status !== 'in_progress') throw new Error('An active session is required.');
        if (!scenarioResult || scenarioResult.projectId !== sessionResult.projectId || scenarioResult.status !== 'active') throw new Error('An active scenario from this project is required.');
        const [participantResult, allowed] = await Promise.all([
          repositories.participants.get(sessionResult.participantId),
          repositories.consent.participantCanRecord(sessionResult.participantId),
        ]);
        if (!participantResult || !allowed) throw new Error('Valid recording consent is required.');
        if (!active) return;
        setSession(sessionResult);
        setScenario(scenarioResult);
        setParticipant(participantResult);
        setLanguages(participantResult.primaryLanguage);
        setVariety(participantResult.languageVariety ?? '');
        setEnvironment(sessionResult.collectionEnvironment);
        const permission = await getRecordingPermissionsAsync();
        if (active) setPermissionDenied(permission.status === 'denied' && !permission.canAskAgain);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Recording screen could not be prepared.');
      }
    }
    void load();
    return () => { active = false; };
  }, [repositories, scenarioId, sessionId]);

  const confirmDiscard = useCallback((afterDiscard: () => void) => {
    if (!take) return afterDiscard();
    Alert.alert('Discard this take?', 'The unsaved audio will be permanently removed.', [
      { text: 'Keep take', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => {
        discardFile(take.sourceUri);
        setTake(null);
        afterDiscard();
      } },
    ]);
  }, [take]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (recorderState.isRecording) {
        Alert.alert('Recording in progress', 'Stop the recording before leaving this screen.');
        return true;
      }
      if (take) {
        confirmDiscard(() => router.back());
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [confirmDiscard, recorderState.isRecording, take]);

  const start = async () => {
    setError(null);
    if (!session || !scenario || !participant) return;
    try {
      if (!(await repositories.consent.participantCanRecord(participant.id))) throw new Error('Recording consent is no longer valid.');
      if (!hasRecordingSpace()) throw new Error('Less than 50 MB of free storage remains. Free space before recording.');
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setPermissionDenied(true);
        throw new Error('Microphone permission was denied. No recording was started.');
      }
      setPermissionDenied(false);
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: false });
      await recorder.prepareToRecordAsync(recordingOptions);
      setStartedAt(nowIso());
      recorder.record();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recording could not start.');
    }
  };

  const stop = async () => {
    setError(null);
    try {
      const statusBeforeStop = recorder.getStatus();
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) throw new Error('The recorder did not return an audio file.');
      const file = new File(uri);
      if (!file.exists || !file.size || file.size <= 0) throw new Error('The stopped audio file is missing or empty.');
      await file.slice(0, 1).arrayBuffer();
      setTake({
        sourceUri: uri,
        durationMs: Math.max(statusBeforeStop.durationMillis, recorder.getStatus().durationMillis),
        recordedAt: startedAt ?? nowIso(),
        extension: recordingOptions.extension,
        container: 'm4a',
        codec: 'aac',
        sampleRateHz: recordingOptions.sampleRate,
        channelCount: recordingOptions.numberOfChannels,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recording could not be stopped safely.');
    }
  };

  const save = async () => {
    if (!take || !session || !scenario) return;
    const qualityRating = quality.trim() ? Number(quality) : null;
    const parsed = recordingMetadataDraftSchema.safeParse({
      spokenLanguages: languages.split(',').map((value) => value.trim()).filter(Boolean),
      languageVariety: nullableText(variety),
      codeSwitchingStatus: nullableText(codeSwitching),
      recordingEnvironment: nullableText(environment),
      noiseLevel: nullableText(noiseLevel),
      qualityRating,
      notes: nullableText(notes),
      annotationStatus: 'needs_transcription',
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Recording metadata is invalid.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await repositories.recordings.saveAcceptedTake(session.id, scenario.id, take, parsed.data);
      discardFile(take.sourceUri);
      setTake(null);
      Alert.alert('Recording saved', `${saved.displayId} and its audio file were verified in local storage.`, [
        { text: 'Next recording', onPress: () => router.back() },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recording was not saved. The original take is still available.');
    } finally {
      setSaving(false);
    }
  };

  if (!session || !scenario || !participant) {
    return <Screen>{error ? <ErrorNotice message={error} /> : <EmptyState>Preparing recorder…</EmptyState>}</Screen>;
  }

  return (
    <Screen>
      <Heading subtitle={`Speaker ${participant.speakerCode} · scenario v${scenario.version}`}>{scenario.title}</Heading>
      <Card>
        <Text style={uiStyles.body}>{scenario.collectionInstructions}</Text>
        <Text style={uiStyles.muted}>Expected intent: {scenario.expectedIntent}</Text>
      </Card>
      {error ? <ErrorNotice message={error} action={permissionDenied ? <Button label="Open Android settings" variant="secondary" onPress={() => void Linking.openSettings()} /> : undefined} /> : null}

      {!take ? (
        <Card>
          <Text accessibilityLiveRegion="polite" style={styles.timer}>{formatDuration(recorderState.durationMillis)}</Text>
          <View style={[styles.indicator, recorderState.isRecording && styles.indicatorActive]} />
          <Text style={styles.recordingState}>{recorderState.isRecording ? 'RECORDING' : 'Ready to record'}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recorderState.isRecording ? 'Stop recording' : 'Start recording'}
            onPress={() => void (recorderState.isRecording ? stop() : start())}
            style={[styles.recordButton, recorderState.isRecording && styles.stopButton]}>
            <View style={recorderState.isRecording ? styles.stopIcon : styles.recordIcon} />
          </Pressable>
          <Text style={uiStyles.muted}>Recording stays in the foreground. Pause/resume is disabled until it is verified on the target Android device.</Text>
        </Card>
      ) : (
        <>
          <Card>
            <Text style={styles.timer}>{formatDuration(take.durationMs)}</Text>
            <TakePlayer uri={take.sourceUri} />
            <Button label="Rerecord" variant="secondary" onPress={() => confirmDiscard(() => setStartedAt(null))} />
          </Card>
          <Heading subtitle="Confirm inherited values or correct them for this take.">Recording metadata</Heading>
          <Field label="Spoken languages, comma separated" value={languages} onChangeText={setLanguages} />
          <Field label="Language variety (optional)" value={variety} onChangeText={setVariety} />
          <Field label="Code switching" value={codeSwitching} onChangeText={setCodeSwitching} placeholder="none, present, ambiguous, unknown" />
          <Field label="Recording environment" value={environment} onChangeText={setEnvironment} />
          <Field label="Noise level" value={noiseLevel} onChangeText={setNoiseLevel} placeholder="low, medium, high, unknown" />
          <Field label="Quality rating 1–5 (optional)" value={quality} onChangeText={setQuality} keyboardType="number-pad" />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
          <Button label="Accept and save verified take" onPress={() => void save()} loading={saving} />
        </>
      )}
      <Button label="Cancel" variant="secondary" onPress={() => confirmDiscard(() => router.back())} disabled={recorderState.isRecording} />
    </Screen>
  );
}

function TakePlayer({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  return <Button label={status.playing ? 'Pause playback' : 'Play take'} variant="secondary" onPress={() => status.playing ? player.pause() : player.play()} />;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

const styles = StyleSheet.create({
  timer: { color: colors.ink, fontSize: 42, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
  indicator: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.muted, alignSelf: 'center' },
  indicatorActive: { backgroundColor: '#D42727' },
  recordingState: { color: colors.muted, textAlign: 'center', fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  recordButton: { width: 112, height: 112, borderRadius: 56, backgroundColor: '#D42727', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginVertical: spacing.md, borderWidth: 8, borderColor: '#F6C9C9' },
  stopButton: { backgroundColor: colors.ink, borderColor: '#CAD0CC' },
  recordIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFFFFF' },
  stopIcon: { width: 42, height: 42, borderRadius: 5, backgroundColor: '#FFFFFF' },
});

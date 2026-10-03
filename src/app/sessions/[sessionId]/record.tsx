import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
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
import * as DocumentPicker from 'expo-document-picker';

import { useRepositories } from '@/core/database/repositories';
import { newId, nullableText, nowIso } from '@/domain/common';
import type { Participant } from '@/features/participants/domain/participant';
import { discardFile, hasRecordingSpace, verifyReadableAudioFile } from '@/features/recordings/data/audio-file-store';
import { hashAudioFile } from '@/features/recordings/data/audio-hash';
import { describeImportedAudio, importedDurationMs } from '@/features/recordings/domain/imported-audio';
import { appStateInterruptsRecording, stopAndDiscardInterruptedTake } from '@/features/recordings/domain/interruption';
import { shouldRestartFinishedPlayback } from '@/features/recordings/domain/playback';
import { recordingMetadataDraftSchema, type AcceptedTake } from '@/features/recordings/domain/recording';
import { codeSwitchingOptions } from '@/features/recordings/domain/recording-metadata-options';
import { buildRemotePrompt } from '@/features/recordings/domain/remote-prompt';
import type { Scenario } from '@/features/scenarios/domain/scenario';
import type { CollectionSession } from '@/features/sessions/domain/session';
import { Button, Card, EmptyState, ErrorNotice, Field, Heading, Screen, SelectField, uiStyles } from '@/ui/components';
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
  const [stopping, setStopping] = useState(false);
  const [languages, setLanguages] = useState('');
  const [variety, setVariety] = useState('');
  const [codeSwitching, setCodeSwitching] = useState('unknown');
  const [environment, setEnvironment] = useState('');
  const [noiseLevel, setNoiseLevel] = useState('unknown');
  const [quality, setQuality] = useState('');
  const [notes, setNotes] = useState('');
  const [remoteExample, setRemoteExample] = useState('');
  const [lastSubmissionId, setLastSubmissionId] = useState<string | null>(null);
  const interruptedRef = useRef(false);
  const stoppingRef = useRef(false);
  const recorder = useAudioRecorder(recordingOptions, (status) => {
    if (status.hasError) {
      interruptedRef.current = true;
      setError(status.error ?? 'Recording was interrupted. The take will not be saved.');
    }
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

  const updateImportedDuration = useCallback((durationMs: number) => {
    setTake((current) => current && current.durationMs !== durationMs ? { ...current, durationMs } : current);
  }, []);

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
      interruptedRef.current = false;
      setStartedAt(nowIso());
      recorder.record();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recording could not start.');
    }
  };

  const stop = useCallback(async (interrupted = false) => {
    if (interrupted) interruptedRef.current = true;
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    setError(null);
    try {
      const statusBeforeStop = recorder.getStatus();
      await recorder.stop();
      const uri = recorder.uri;
      if (interruptedRef.current) {
        if (uri) discardFile(uri);
        setTake(null);
        setStartedAt(null);
        setError('Recording stopped because SautiForge left the foreground. The interrupted take was discarded; record again.');
        return;
      }
      if (!uri) throw new Error('The recorder did not return an audio file.');
      await verifyReadableAudioFile(new File(uri));
      if (interruptedRef.current) {
        discardFile(uri);
        setTake(null);
        setStartedAt(null);
        setError('Recording stopped because SautiForge left the foreground. The interrupted take was discarded; record again.');
        return;
      }
      setTake({
        sourceUri: uri,
        durationMs: Math.max(statusBeforeStop.durationMillis, recorder.getStatus().durationMillis),
        recordedAt: startedAt ?? nowIso(),
        extension: recordingOptions.extension,
        container: 'm4a',
        codec: 'aac',
        sampleRateHz: recordingOptions.sampleRate,
        channelCount: recordingOptions.numberOfChannels,
        captureSource: 'device_microphone',
        transport: null,
        promptExposure: 'instructions_only',
        importedAt: null,
        sourceMimeType: 'audio/mp4',
        contentSha256: null,
        externalSubmissionId: null,
      });
    } catch (cause) {
      const cleanup = await stopAndDiscardInterruptedTake({
        stop: async () => {
          if (recorder.getStatus().isRecording) await recorder.stop();
        },
        getUri: () => recorder.uri,
        discard: discardFile,
      });
      setTake(null);
      setStartedAt(null);
      const detail = cleanup.errors.length ? ` Cleanup details: ${cleanup.errors.join('; ')}.` : '';
      setError(`${cause instanceof Error ? cause.message : 'Recording could not be stopped safely.'} The take was not saved.${detail}`);
    } finally {
      try {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      } catch (cause) {
        setError((current) => `${current ?? 'Recording stopped.'} Audio reset failed: ${cause instanceof Error ? cause.message : 'unknown error'}`);
      }
      stoppingRef.current = false;
      setStopping(false);
    }
  }, [recorder, startedAt]);

  const shareRemotePrompt = async () => {
    if (!session || !scenario || !participant) return;
    try {
      if (!(await repositories.consent.participantCanRecord(participant.id))) throw new Error('Valid recording consent is required before sending a collection task.');
      const submissionId = `SUB-${newId().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      const message = buildRemotePrompt(remoteExample);
      await Share.share({ message, title: `SautiForge: ${scenario.title}` }, { dialogTitle: 'Share remote collection task' });
      setLastSubmissionId(submissionId);
      Alert.alert('Share sheet opened', `Submission code ${submissionId} is tracked inside SautiForge and was not included in the message. Android cannot confirm that the message was delivered.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The remote collection task could not be shared.');
    }
  };

  const importExternalAudio = async () => {
    if (!session || !scenario || !participant) return;
    setError(null);
    try {
      if (!(await repositories.consent.participantCanRecord(participant.id))) throw new Error('Valid recording consent is required before importing audio.');
      if (!hasRecordingSpace()) throw new Error('Less than 50 MB of free storage remains. Free space before importing audio.');
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error('Android did not return the selected audio file.');
      const media = describeImportedAudio(asset.name, asset.mimeType ?? null);
      const file = new File(asset.uri);
      await verifyReadableAudioFile(file);
      const contentSha256 = await hashAudioFile(file);
      setTake({
        sourceUri: file.uri,
        durationMs: 0,
        recordedAt: nowIso(),
        extension: media.extension,
        container: media.container,
        codec: null,
        sampleRateHz: null,
        channelCount: null,
        captureSource: 'imported_file',
        transport: 'whatsapp_manual',
        promptExposure: remoteExample.trim() ? 'example_shown' : 'instructions_only',
        importedAt: nowIso(),
        sourceMimeType: media.mimeType,
        contentSha256,
        externalSubmissionId: lastSubmissionId ?? `SUB-${newId().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The external audio file could not be imported.');
    }
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (!appStateInterruptsRecording(nextState)) return;
      const status = recorder.getStatus();
      if (status.isRecording || stoppingRef.current) {
        interruptedRef.current = true;
        if (status.isRecording && !stoppingRef.current) void stop(true);
      }
    });
    return () => subscription.remove();
  }, [recorder, stop]);

  const save = async () => {
    if (!take || !session || !scenario) return;
    if (take.captureSource === 'imported_file' && take.durationMs <= 0) {
      setError('Wait for the imported audio to load and show a valid duration before saving.');
      return;
    }
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
        <>
          <Card>
            <Text accessibilityLiveRegion="polite" style={styles.timer}>{formatDuration(recorderState.durationMillis)}</Text>
            <View style={[styles.indicator, recorderState.isRecording && styles.indicatorActive]} />
            <Text style={styles.recordingState}>{recorderState.isRecording ? 'RECORDING' : 'Ready to record'}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={recorderState.isRecording ? 'Stop recording' : 'Start recording'}
              disabled={stopping}
              onPress={() => void (recorderState.isRecording ? stop(false) : start())}
              style={[styles.recordButton, recorderState.isRecording && styles.stopButton, stopping && styles.buttonDisabled]}>
              <View style={recorderState.isRecording ? styles.stopIcon : styles.recordIcon} />
            </Pressable>
            <Text style={uiStyles.muted}>Recording stays in the foreground. Pause/resume is disabled until it is verified on the target Android device.</Text>
          </Card>
          {!recorderState.isRecording ? (
            <Card>
              <Text style={uiStyles.title}>Remote or externally recorded contribution</Text>
              <Text style={uiStyles.body}>Share only a fictional example through any messaging app. The contributor receives short guidance and the example in bold, without speaker, submission, scenario, or instruction fields.</Text>
              <Field label="Fictional situation/example to share" value={remoteExample} onChangeText={setRemoteExample} multiline />
              <Button label="Share fictional example" variant="secondary" onPress={() => void shareRemotePrompt()} />
              {lastSubmissionId ? <Text style={uiStyles.muted}>Internally tracked submission code: {lastSubmissionId}</Text> : null}
              <Button label="Import returned audio" variant="secondary" onPress={() => void importExternalAudio()} />
              <Text style={uiStyles.muted}>Use fictional or sanitized content only. Opening the share sheet does not prove delivery. SautiForge does not read WhatsApp chats or groups.</Text>
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Card>
            <Text style={styles.timer}>{formatDuration(take.durationMs)}</Text>
            <TakePlayer
              uri={take.sourceUri}
              onDurationMs={take.captureSource === 'imported_file' ? updateImportedDuration : undefined}
            />
            <Text style={uiStyles.muted}>Source: {take.captureSource === 'imported_file' ? `Imported file · ${take.container.toUpperCase()}` : 'Device microphone'}</Text>
            <Button label={take.captureSource === 'imported_file' ? 'Discard imported file' : 'Rerecord'} variant="secondary" onPress={() => confirmDiscard(() => setStartedAt(null))} />
          </Card>
          <Heading subtitle="Confirm inherited values or correct them for this take.">Recording metadata</Heading>
          <Field label="Spoken languages, comma separated" value={languages} onChangeText={setLanguages} />
          <Field label="Language variety (optional)" value={variety} onChangeText={setVariety} />
          <SelectField label="Code switching" value={codeSwitching} options={[...codeSwitchingOptions]} onValueChange={setCodeSwitching} />
          {take.captureSource === 'imported_file' ? (
            <>
              <SelectField
                label="How the audio arrived"
                value={take.transport ?? 'whatsapp_manual'}
                options={[
                  { label: 'WhatsApp — manual import', value: 'whatsapp_manual' },
                  { label: 'Another messaging app', value: 'other_messaging' },
                  { label: 'File transfer', value: 'file_transfer' },
                  { label: 'Other', value: 'other' },
                ]}
                onValueChange={(transport) => setTake((current) => current ? { ...current, transport: transport as AcceptedTake['transport'] } : current)}
              />
              <SelectField
                label="Prompt exposure"
                value={take.promptExposure}
                options={[
                  { label: 'Instructions only', value: 'instructions_only' },
                  { label: 'Example shown', value: 'example_shown' },
                  { label: 'Scripted reading', value: 'scripted_reading' },
                ]}
                onValueChange={(promptExposure) => setTake((current) => current ? { ...current, promptExposure: promptExposure as AcceptedTake['promptExposure'] } : current)}
              />
              <Field
                label="Pseudonymous submission code"
                value={take.externalSubmissionId ?? ''}
                onChangeText={(externalSubmissionId) => setTake((current) => current ? { ...current, externalSubmissionId: nullableText(externalSubmissionId) } : current)}
                autoCapitalize="characters"
              />
            </>
          ) : null}
          <Field label="Recording environment" value={environment} onChangeText={setEnvironment} />
          <Field label="Noise level" value={noiseLevel} onChangeText={setNoiseLevel} placeholder="low, medium, high, unknown" />
          <Field label="Quality rating 1–5 (optional)" value={quality} onChangeText={setQuality} keyboardType="number-pad" />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
          <Button label="Accept and save verified take" onPress={() => void save()} loading={saving} />
        </>
      )}
      <Button label="Cancel" variant="secondary" onPress={() => confirmDiscard(() => router.back())} disabled={recorderState.isRecording || stopping} />
    </Screen>
  );
}

function TakePlayer({ uri, onDurationMs }: { uri: string; onDurationMs?: (durationMs: number) => void }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  useEffect(() => {
    if (!onDurationMs || !status.isLoaded || status.duration <= 0) return;
    try { onDurationMs(importedDurationMs(status.duration)); } catch { /* Save validation will report an unreadable duration. */ }
  }, [onDurationMs, status.duration, status.isLoaded]);
  const play = () => {
    if (shouldRestartFinishedPlayback(status.didJustFinish)) player.seekTo(0);
    player.play();
  };
  return <Button label={status.playing ? 'Pause playback' : 'Play take'} variant="secondary" onPress={() => status.playing ? player.pause() : play()} />;
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
  buttonDisabled: { opacity: 0.5 },
});

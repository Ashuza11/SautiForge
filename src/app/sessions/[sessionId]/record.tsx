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
import { advanceImportedTakeQueue } from '@/features/recordings/domain/import-queue';
import { appStateInterruptsRecording, stopAndDiscardInterruptedTake } from '@/features/recordings/domain/interruption';
import { shouldRestartFinishedPlayback } from '@/features/recordings/domain/playback';
import { acceptedTakeSchema, elicitationPromptSelectionError, recordingMetadataDraftSchema, type AcceptedTake } from '@/features/recordings/domain/recording';
import { codeSwitchingOptions, CUSTOM_METADATA_VALUE, noiseLevelOptions, recordingEnvironmentOptions } from '@/features/recordings/domain/recording-metadata-options';
import { buildRemotePrompt } from '@/features/recordings/domain/remote-prompt';
import type { Scenario } from '@/features/scenarios/domain/scenario';
import type { CollectionSession } from '@/features/sessions/domain/session';
import { useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorNotice, Field, Heading, Screen, SelectField, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

// Unaccepted takes remain temporary; accepted takes are copied and verified in document storage.
const recordingOptions = { ...RecordingPresets.HIGH_QUALITY, directory: 'cache' as const };

export default function RecordScreen() {
  const params = useLocalSearchParams<{ sessionId: string; scenarioId: string }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const scenarioId = Array.isArray(params.scenarioId) ? params.scenarioId[0] : params.scenarioId;
  const repositories = useRepositories();
  const { strings, translateText } = useI18n();
  const [session, setSession] = useState<CollectionSession | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [take, setTake] = useState<AcceptedTake | null>(null);
  const [importQueue, setImportQueue] = useState<AcceptedTake[]>([]);
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
  const [lastSubmissionId, setLastSubmissionId] = useState<string | null>(null);
  const [exampleError, setExampleError] = useState<string | null>(null);
  const interruptedRef = useRef(false);
  const stoppingRef = useRef(false);
  const recorder = useAudioRecorder(recordingOptions, (status) => {
    if (status.hasError) {
      interruptedRef.current = true;
      setError(status.error ?? strings.interruptedTakeDiscarded);
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
        if (!sessionResult || sessionResult.status !== 'in_progress') throw new Error(strings.activeSessionRequired);
        if (!scenarioResult || scenarioResult.projectId !== sessionResult.projectId || scenarioResult.status !== 'active') throw new Error(strings.activeScenarioRequired);
        const [participantResult, allowed] = await Promise.all([
          repositories.participants.get(sessionResult.participantId),
          repositories.consent.participantCanRecord(sessionResult.participantId),
        ]);
        if (!participantResult || !allowed) throw new Error(strings.validConsentRequired);
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
        if (active) setError(cause instanceof Error ? translateText(cause.message) : strings.recorderPrepareFailed);
      }
    }
    void load();
    return () => { active = false; };
  }, [repositories, scenarioId, sessionId, strings, translateText]);

  const confirmDiscard = useCallback((afterDiscard: () => void) => {
    if (!take) return afterDiscard();
    Alert.alert(strings.discardTakeQuestion, strings.unsavedAudioWarning, [
      { text: strings.keepTake, style: 'cancel' },
      { text: strings.discard, style: 'destructive', onPress: () => {
        discardFile(take.sourceUri);
        setTake(null);
        afterDiscard();
      } },
    ]);
  }, [strings, take]);

  const advanceImportQueue = useCallback(() => {
    setExampleError(null);
    setImportQueue((current) => {
      const { next, remaining } = advanceImportedTakeQueue(current);
      setTake(next);
      return remaining;
    });
  }, []);

  const confirmExit = useCallback((afterDiscard: () => void) => {
    const count = (take ? 1 : 0) + importQueue.length;
    if (!count) return afterDiscard();
    Alert.alert(strings.discardUnsavedQuestion, `${count} ${strings.unsavedFilesWarning}`, [
      { text: strings.keepReviewing, style: 'cancel' },
      { text: strings.discardAll, style: 'destructive', onPress: () => {
        if (take) discardFile(take.sourceUri);
        for (const queued of importQueue) discardFile(queued.sourceUri);
        setTake(null);
        setImportQueue([]);
        afterDiscard();
      } },
    ]);
  }, [importQueue, strings, take]);

  const updateImportedDuration = useCallback((durationMs: number) => {
    setTake((current) => current && current.durationMs !== durationMs ? { ...current, durationMs } : current);
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (recorderState.isRecording) {
        Alert.alert(strings.recordingInProgress, strings.stopBeforeLeaving);
        return true;
      }
      if (take || importQueue.length) {
        confirmExit(() => router.back());
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [confirmExit, importQueue.length, recorderState.isRecording, strings, take]);

  const start = async () => {
    setError(null);
    if (!session || !scenario || !participant) return;
    try {
      if (!(await repositories.consent.participantCanRecord(participant.id))) throw new Error(strings.recordingConsentInvalid);
      if (!hasRecordingSpace()) throw new Error(strings.lowStorageRecording);
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setPermissionDenied(true);
        throw new Error(strings.microphoneDenied);
      }
      setPermissionDenied(false);
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: false });
      await recorder.prepareToRecordAsync(recordingOptions);
      interruptedRef.current = false;
      setStartedAt(nowIso());
      recorder.record();
    } catch (cause) {
      setError(cause instanceof Error ? translateText(cause.message) : strings.recordingStartFailed);
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
        setError(strings.interruptedTakeDiscarded);
        return;
      }
      if (!uri) throw new Error(strings.noAudioFile);
      await verifyReadableAudioFile(new File(uri));
      if (interruptedRef.current) {
        discardFile(uri);
        setTake(null);
        setStartedAt(null);
        setError(strings.interruptedTakeDiscarded);
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
        elicitationPromptText: null,
        sourceFileName: null,
      });
    } catch (cause) {
      await stopAndDiscardInterruptedTake({
        stop: async () => {
          if (recorder.getStatus().isRecording) await recorder.stop();
        },
        getUri: () => recorder.uri,
        discard: discardFile,
      });
      setTake(null);
      setStartedAt(null);
      setError(`${cause instanceof Error ? translateText(cause.message) : strings.recordingStopFailed} ${strings.takeNotSaved}`);
    } finally {
      try {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      } catch (cause) {
        setError((current) => `${current ?? strings.recordingStopped} ${strings.audioResetFailed}`);
      }
      stoppingRef.current = false;
      setStopping(false);
    }
  }, [recorder, startedAt, strings, translateText]);

  const shareRemotePrompt = async () => {
    if (!session || !scenario || !participant) return;
    try {
      if (!(await repositories.consent.participantCanRecord(participant.id))) throw new Error(strings.consentRequiredToShare);
      const submissionId = `SUB-${newId().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      const message = buildRemotePrompt(scenario.remoteExamples);
      await Share.share({ message, title: `SautiForge: ${scenario.title}` }, { dialogTitle: strings.shareRemoteTask });
      setLastSubmissionId(submissionId);
      Alert.alert(strings.shareSheetOpened, `${strings.submissionCode}: ${submissionId}. ${strings.deliveryNotConfirmed}`);
    } catch (cause) {
      setError(cause instanceof Error ? translateText(cause.message) : strings.shareTaskFailed);
    }
  };

  const importExternalAudio = async () => {
    if (!session || !scenario || !participant) return;
    setError(null);
    try {
      if (!(await repositories.consent.participantCanRecord(participant.id))) throw new Error(strings.consentRequiredToImport);
      if (!hasRecordingSpace()) throw new Error(strings.lowStorageImport);
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: true });
      if (result.canceled) return;
      if (!result.assets.length) throw new Error(strings.noSelectedAudio);
      const submissionId = lastSubmissionId ?? `SUB-${newId().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      const imported: AcceptedTake[] = [];
      try {
        for (const asset of result.assets) {
          const media = describeImportedAudio(asset.name, asset.mimeType ?? null);
          const file = new File(asset.uri);
          await verifyReadableAudioFile(file);
          imported.push({
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
            promptExposure: scenario.remoteExamples.length ? 'example_shown' : 'instructions_only',
            importedAt: nowIso(),
            sourceMimeType: media.mimeType,
            contentSha256: await hashAudioFile(file),
            externalSubmissionId: submissionId,
            elicitationPromptText: null,
            sourceFileName: asset.name.trim().slice(0, 255) || null,
          });
        }
      } catch (cause) {
        for (const asset of result.assets) discardFile(asset.uri);
        throw cause;
      }
      const [first, ...remaining] = imported;
      setExampleError(null);
      setTake(first ?? null);
      setImportQueue(remaining);
    } catch (cause) {
      setError(cause instanceof Error ? translateText(cause.message) : strings.importAudioFailed);
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
    const promptSelectionError = elicitationPromptSelectionError(take);
    setExampleError(promptSelectionError);
    if (promptSelectionError) {
      setError(strings.chooseExampleBeforeSaving);
      return;
    }
    if (take.captureSource === 'imported_file' && take.durationMs <= 0) {
      setError(strings.waitForAudioDuration);
      return;
    }
    const parsedTake = acceptedTakeSchema.safeParse(take);
    if (!parsedTake.success) {
      setError(translateText(parsedTake.error.issues[0]?.message ?? strings.importedAudioIncomplete));
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
      setError(translateText(parsed.error.issues[0]?.message ?? strings.invalidRecordingMetadata));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await repositories.recordings.saveAcceptedTake(session.id, scenario.id, take, parsed.data);
      discardFile(take.sourceUri);
      if (take.captureSource === 'imported_file' && importQueue.length) {
        advanceImportQueue();
        Alert.alert(strings.recordingSaved, `${saved.displayId} ${strings.verified}. ${importQueue.length} ${strings.filesRemain}.`);
      } else {
        setTake(null);
        Alert.alert(strings.recordingSaved, `${saved.displayId} ${strings.savedAndVerified}`, [
          { text: strings.nextRecording, onPress: () => router.back() },
        ]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? translateText(cause.message) : strings.recordingSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  if (!session || !scenario || !participant) {
    return <Screen>{error ? <ErrorNotice message={error} /> : <EmptyState>{strings.preparingRecorder}</EmptyState>}</Screen>;
  }

  return (
    <Screen>
      <Heading subtitle={`${strings.speakerShort} ${participant.speakerCode} · ${strings.scenarioShort} v${scenario.version}`}>{scenario.title}</Heading>
      <Card>
        <Text style={uiStyles.body}>{scenario.collectionInstructions}</Text>
      </Card>
      {error ? <ErrorNotice message={error} action={permissionDenied ? <Button label={strings.openAndroidSettings} variant="secondary" onPress={() => void Linking.openSettings()} /> : undefined} /> : null}

      {!take ? (
        <>
          <Card>
            <Text accessibilityLiveRegion="polite" style={styles.timer}>{formatDuration(recorderState.durationMillis)}</Text>
            <View style={[styles.indicator, recorderState.isRecording && styles.indicatorActive]} />
            <Text style={styles.recordingState}>{recorderState.isRecording ? strings.recordingNow : strings.readyToRecord}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={recorderState.isRecording ? strings.stopRecording : strings.startRecording}
              disabled={stopping}
              onPress={() => void (recorderState.isRecording ? stop(false) : start())}
              style={[styles.recordButton, recorderState.isRecording && styles.stopButton, stopping && styles.buttonDisabled]}>
              <View style={recorderState.isRecording ? styles.stopIcon : styles.recordIcon} />
            </Pressable>
          </Card>
          {!recorderState.isRecording ? (
            <Card>
              <Text style={uiStyles.title}>{strings.remoteContribution}</Text>
              <Text style={uiStyles.body}>{scenario.remoteExamples.length} {strings.configuredExamples}</Text>
              {scenario.remoteExamples.map((example, index) => <Text key={`${index}-${example}`} style={uiStyles.muted}>{index + 1}. {example}</Text>)}
              {!scenario.remoteExamples.length ? <Text style={uiStyles.muted}>{strings.addExamplesBeforeSharing}</Text> : null}
              <Button label={strings.shareExamples} variant="secondary" onPress={() => void shareRemotePrompt()} disabled={!scenario.remoteExamples.length} />
              {lastSubmissionId ? <Text style={uiStyles.muted}>{strings.submissionCode}: {lastSubmissionId}</Text> : null}
              <Button label={strings.importAudio} variant="secondary" onPress={() => void importExternalAudio()} />
              <Text style={uiStyles.muted}>{strings.sanitizedContentOnly}</Text>
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Card>
            <Text style={styles.timer}>{formatDuration(take.durationMs)}</Text>
            <TakePlayer
              key={take.sourceUri}
              uri={take.sourceUri}
              onDurationMs={take.captureSource === 'imported_file' ? updateImportedDuration : undefined}
            />
            <Text style={uiStyles.muted}>{strings.source}: {take.captureSource === 'imported_file' ? `${strings.importedAudio} · ${take.container.toUpperCase()}` : strings.deviceMicrophone}</Text>
            {take.sourceFileName ? <Text style={uiStyles.muted}>{take.sourceFileName} · {importQueue.length} {strings.filesWaiting}</Text> : null}
            <Button label={take.captureSource === 'imported_file' ? strings.discardImported : strings.rerecord} variant="secondary" onPress={() => confirmDiscard(() => take.captureSource === 'imported_file' ? advanceImportQueue() : setStartedAt(null))} />
          </Card>
          <Heading>{strings.recordingMetadata}</Heading>
          <Field label={strings.spokenLanguages} value={languages} onChangeText={setLanguages} />
          <Field label={strings.languageVarietyOptional} value={variety} onChangeText={setVariety} />
          <SelectField label={strings.codeSwitching} value={codeSwitching} options={codeSwitchingOptions.map((option) => ({ ...option, label: translateText(option.label) }))} onValueChange={setCodeSwitching} />
          {take.captureSource === 'imported_file' ? (
            <>
              <SelectField
                label={strings.audioArrival}
                value={take.transport ?? 'whatsapp_manual'}
                options={[
                  { label: strings.whatsappManual, value: 'whatsapp_manual' },
                  { label: strings.otherMessaging, value: 'other_messaging' },
                  { label: strings.fileTransfer, value: 'file_transfer' },
                  { label: strings.other, value: 'other' },
                ]}
                onValueChange={(transport) => setTake((current) => current ? { ...current, transport: transport as AcceptedTake['transport'] } : current)}
              />
              <SelectField
                label={strings.promptExposure}
                value={take.promptExposure}
                options={[
                  { label: strings.instructionsOnly, value: 'instructions_only' },
                  { label: strings.exampleShown, value: 'example_shown' },
                  { label: strings.scriptedReading, value: 'scripted_reading' },
                ]}
                onValueChange={(promptExposure) => {
                  setExampleError(null);
                  setError(null);
                  setTake((current) => current ? {
                    ...current,
                    promptExposure: promptExposure as AcceptedTake['promptExposure'],
                    elicitationPromptText: promptExposure === 'example_shown' ? current.elicitationPromptText : null,
                  } : current);
                }}
              />
              {take.promptExposure === 'example_shown' ? (
                <SelectField
                  label={strings.exampleUsed}
                  value={take.elicitationPromptText ?? ''}
                  options={scenario.remoteExamples.map((example, index) => ({ label: `${index + 1}. ${example}`, value: example }))}
                  onValueChange={(elicitationPromptText) => {
                    setExampleError(null);
                    setError(null);
                    setTake((current) => current ? { ...current, elicitationPromptText } : current);
                  }}
                  placeholder={strings.selectMatchingExample}
                  error={exampleError ?? undefined}
                />
              ) : null}
              <Field
                label={strings.submissionCode}
                value={take.externalSubmissionId ?? ''}
                onChangeText={(externalSubmissionId) => setTake((current) => current ? { ...current, externalSubmissionId: nullableText(externalSubmissionId) } : current)}
                autoCapitalize="characters"
              />
            </>
          ) : null}
          <SelectField
            label={strings.recordingEnvironment}
            value={recordingEnvironmentOptions.some((option) => option.value === environment) ? environment : CUSTOM_METADATA_VALUE}
            options={recordingEnvironmentOptions.map((option) => ({ ...option, label: translateText(option.label) }))}
            onValueChange={(value) => setEnvironment(value === CUSTOM_METADATA_VALUE ? '' : value)}
          />
          {!recordingEnvironmentOptions.some((option) => option.value === environment) ? (
            <Field label={strings.customEnvironment} value={environment} onChangeText={setEnvironment} />
          ) : null}
          <SelectField
            label={strings.noiseLevel}
            value={noiseLevel}
            options={noiseLevelOptions.map((option) => ({ ...option, label: translateText(option.label) }))}
            onValueChange={setNoiseLevel}
          />
          <Field label={strings.qualityRating} value={quality} onChangeText={setQuality} keyboardType="number-pad" />
          <Field label={strings.notesOptional} value={notes} onChangeText={setNotes} multiline />
          <Button label={strings.acceptTake} onPress={() => void save()} loading={saving} />
        </>
      )}
      <Button label={strings.cancel} variant="secondary" onPress={() => confirmExit(() => router.back())} disabled={recorderState.isRecording || stopping} />
    </Screen>
  );
}

function TakePlayer({ uri, onDurationMs }: { uri: string; onDurationMs?: (durationMs: number) => void }) {
  const { strings } = useI18n();
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
  return <Button label={status.playing ? strings.pausePlayback : strings.playTake} variant="secondary" onPress={() => status.playing ? player.pause() : play()} />;
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

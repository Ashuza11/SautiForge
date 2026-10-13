import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { useRepositories } from '@/core/database/repositories';
import { nullableText } from '@/domain/common';
import { businessAnnotationPayloadSchema, type BusinessAnnotationPayload } from '@/features/annotations/domain/annotation';
import { currencyOptions, paymentMethodOptions, preserveAnnotationValue, transactionIntentOptions, type AnnotationSelectOption } from '@/features/annotations/domain/business-annotation-options';
import { getRecordingFile } from '@/features/recordings/data/audio-file-store';
import { annotationStatusSchema, recordingSnapshotExamples, type Recording, type RecordingPromptCorrection } from '@/features/recordings/domain/recording';
import type { Transcription } from '@/features/transcriptions/domain/transcription';
import { useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorNotice, Field, Heading, Screen, SelectField, uiStyles } from '@/ui/components';
import { colors } from '@/ui/theme';

const statusOptions = annotationStatusSchema.options;
const CUSTOM_CONTEXT_VALUE = '__custom_context__';
const emptyBusiness: BusinessAnnotationPayload = {
  transactionIntent: null, productOrService: null, quantity: null, amount: null, currency: null,
  amountPaid: null, outstandingDebt: null, paymentMethod: null, transactionReference: null,
};

export default function RecordingDetailScreen() {
  const params = useLocalSearchParams<{ recordingId: string }>();
  const recordingId = Array.isArray(params.recordingId) ? params.recordingId[0] : params.recordingId;
  const repositories = useRepositories();
  const { localeTag, strings, translateText } = useI18n();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [promptCorrections, setPromptCorrections] = useState<RecordingPromptCorrection[]>([]);
  const [transcriptionHistory, setTranscriptionHistory] = useState<Transcription[]>([]);
  const [verbatim, setVerbatim] = useState('');
  const [normalized, setNormalized] = useState('');
  const [scenarioContext, setScenarioContext] = useState('');
  const [promptContext, setPromptContext] = useState('');
  const [languageTags, setLanguageTags] = useState('');
  const [transcriptionNotes, setTranscriptionNotes] = useState('');
  const [annotator, setAnnotator] = useState('');
  const [business, setBusiness] = useState<BusinessAnnotationPayload>(emptyBusiness);
  const [annotationRevision, setAnnotationRevision] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [savingAnnotation, setSavingAnnotation] = useState(false);
  const [correctedPrompt, setCorrectedPrompt] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctedBy, setCorrectedBy] = useState('');
  const [savingCorrection, setSavingCorrection] = useState(false);

  const load = useCallback(async () => {
    if (!recordingId) return;
    try {
      const [recordingResult, transcripts, annotation, corrections] = await Promise.all([
        repositories.recordings.get(recordingId),
        repositories.transcriptions.listRevisions(recordingId),
        repositories.annotations.getCurrentBusiness(recordingId),
        repositories.recordings.listPromptCorrections(recordingId),
      ]);
      if (!recordingResult) throw new Error(strings.recordingNotFound);
      setRecording(recordingResult);
      setTranscriptionHistory(transcripts);
      setPromptCorrections(corrections);
      setCorrectedPrompt(recordingResult.elicitationPromptText ?? '');
      const current = transcripts[0];
      setVerbatim(current?.verbatimText ?? '');
      setNormalized(current?.normalizedText ?? '');
      setScenarioContext(current?.scenarioContext ?? String(recordingResult.scenarioPromptSnapshot.title ?? ''));
      setPromptContext(current?.elicitationPromptContext ?? recordingResult.elicitationPromptText ?? '');
      setLanguageTags(current?.languageTags.join(', ') ?? recordingResult.spokenLanguages.join(', '));
      setTranscriptionNotes(current?.notes ?? '');
      setAnnotator(current?.createdBy ?? '');
      if (annotation) {
        setBusiness(businessAnnotationPayloadSchema.parse(annotation.payload));
        setAnnotationRevision(annotation.revisionNumber);
      } else {
        setBusiness({
          ...emptyBusiness,
          transactionIntent: nullableText(String(recordingResult.scenarioPromptSnapshot.expectedIntent ?? '')),
        });
        setAnnotationRevision(null);
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? translateText(cause.message) : strings.recordingLoadFailed);
    }
  }, [recordingId, repositories, strings, translateText]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const saveTranscript = async () => {
    if (!recording) return;
    setSavingTranscript(true);
    setError(null);
    try {
      await repositories.transcriptions.createRevision(recording.id, {
        verbatimText: nullableText(verbatim),
        normalizedText: nullableText(normalized),
        scenarioContext: nullableText(scenarioContext),
        elicitationPromptContext: nullableText(promptContext),
        languageTags: languageTags.split(',').map((value) => value.trim()).filter(Boolean),
        notes: nullableText(transcriptionNotes),
        createdBy: nullableText(annotator),
      });
      if (verbatim.trim()) await repositories.recordings.updateStatus(recording.id, 'transcribed');
      await load();
      Alert.alert(strings.transcriptionSaved, strings.revisionSaved);
    } catch (cause) {
      setError(cause instanceof Error ? translateText(cause.message) : strings.transcriptionSaveFailed);
    } finally {
      setSavingTranscript(false);
    }
  };

  const saveAnnotation = async () => {
    if (!recording) return;
    setSavingAnnotation(true);
    setError(null);
    try {
      await repositories.annotations.createBusinessRevision(recording.id, businessAnnotationPayloadSchema.parse(business), nullableText(annotator));
      await load();
      Alert.alert(strings.annotationSaved, strings.revisionSaved);
    } catch (cause) {
      setError(cause instanceof Error ? translateText(cause.message) : strings.annotationSaveFailed);
    } finally {
      setSavingAnnotation(false);
    }
  };

  const updateStatus = async (status: Recording['annotationStatus']) => {
    if (!recording) return;
    try {
      setRecording(await repositories.recordings.updateStatus(recording.id, status));
    } catch (cause) {
      setError(cause instanceof Error ? translateText(cause.message) : strings.statusChangeFailed);
    }
  };

  const confirmPromptCorrection = () => {
    if (!recording) return;
    if (!correctionReason.trim()) {
      setError(strings.correctionReasonRequired);
      return;
    }
    Alert.alert(strings.confirmExampleCorrection, strings.exampleCorrectionWarning, [
      { text: strings.cancel, style: 'cancel' },
      { text: strings.saveExampleCorrection, onPress: () => void savePromptCorrection() },
    ]);
  };

  const savePromptCorrection = async () => {
    if (!recording) return;
    setSavingCorrection(true);
    setError(null);
    try {
      await repositories.recordings.correctElicitationPrompt(recording.id, {
        correctedPromptText: correctedPrompt,
        reason: correctionReason,
        correctedBy: nullableText(correctedBy),
      });
      setCorrectionReason('');
      await load();
      Alert.alert(strings.exampleCorrectionSaved, strings.exampleCorrectionSavedDetail);
    } catch (cause) {
      setError(cause instanceof Error ? translateText(cause.message) : strings.exampleCorrectionFailed);
    } finally {
      setSavingCorrection(false);
    }
  };

  const archive = () => {
    if (!recording) return;
    Alert.alert(strings.removeRecordingQuestion, strings.removeRecordingWarning, [
      { text: strings.cancel, style: 'cancel' },
      { text: strings.remove, style: 'destructive', onPress: async () => {
        try { await repositories.recordings.archive(recording.id); router.replace('/library'); }
        catch (cause) { setError(cause instanceof Error ? translateText(cause.message) : strings.recordingRemoveFailed); }
      } },
    ]);
  };

  if (!recording) return <Screen>{error ? <ErrorNotice message={error} /> : <EmptyState>{strings.loadingRecording}</EmptyState>}</Screen>;
  let audioUri: string | null = null;
  let audioError: string | null = null;
  try { audioUri = getRecordingFile(recording.relativeAudioPath).uri; }
  catch (cause) { audioError = cause instanceof Error ? translateText(cause.message) : strings.audioUnavailable; }
  const snapshotExamples = recordingSnapshotExamples(recording);
  const canCorrectPrompt = recording.captureSource === 'imported_file'
    && recording.promptExposure === 'example_shown'
    && Boolean(recording.elicitationPromptText)
    && snapshotExamples.length > 1;

  return (
    <Screen>
      <Heading subtitle={`${recording.container.toUpperCase()} · ${formatDuration(recording.durationMs)} · ${formatBytes(recording.fileSizeBytes)}`}>{recording.displayId}</Heading>
      {error ? <ErrorNotice message={error} /> : null}
      {audioError ? <ErrorNotice message={audioError} /> : null}
      <Card>
        <Text style={uiStyles.title}>{String(recording.scenarioPromptSnapshot.title ?? 'Scenario')}</Text>
        <Text style={uiStyles.muted}>{strings.version} {recording.scenarioVersion} · {new Date(recording.recordedAt).toLocaleString(localeTag)}</Text>
        <Text style={uiStyles.body}>{strings.languages}: {recording.spokenLanguages.join(', ')}</Text>
        <Text style={uiStyles.muted}>{strings.codec}: {recording.codec ?? strings.unavailable} · {recording.sampleRateHz ?? strings.unavailable} Hz · {recording.channelCount ?? strings.unavailable} {strings.channels}</Text>
        <Text style={uiStyles.muted}>{strings.source}: {recording.captureSource === 'imported_file' ? strings.importedAudio : strings.deviceMicrophone} · {translateText(recording.promptExposure.replaceAll('_', ' '))}</Text>
        {recording.captureSource === 'imported_file' ? (
          <>
            <Text style={uiStyles.muted}>{strings.transport}: {recording.transport ? translateText(recording.transport.replaceAll('_', ' ')) : strings.unavailable} · {strings.submission}: {recording.externalSubmissionId ?? strings.unavailable}</Text>
            <Text style={uiStyles.muted}>{strings.sourceFile}: {recording.sourceFileName ?? strings.unavailable}</Text>
            {recording.elicitationPromptText ? <Text style={uiStyles.body}>{strings.exampleUsed}: {recording.elicitationPromptText}</Text> : null}
          </>
        ) : null}
        {audioUri ? <StoredAudioPlayer uri={audioUri} /> : null}
      </Card>

      <Heading>{strings.reviewState}</Heading>
      <View style={uiStyles.row}>
        {statusOptions.map((status) => (
          <Pressable key={status} onPress={() => void updateStatus(status)} style={[styles.choice, recording.annotationStatus === status && styles.choiceSelected]}>
            <Text style={[styles.choiceText, recording.annotationStatus === status && styles.choiceTextSelected]}>{translateText(status.replaceAll('_', ' '))}</Text>
          </Pressable>
        ))}
      </View>

      <Heading subtitle={`${transcriptionHistory.length} ${strings.savedRevisions}`}>{strings.transcription}</Heading>
      <Field label={strings.transcriptionScenario} value={scenarioContext} onChangeText={setScenarioContext} />
      {snapshotExamples.length ? (
        <SelectField
          label={strings.transcriptionExample}
          value={snapshotExamples.includes(promptContext) ? promptContext : CUSTOM_CONTEXT_VALUE}
          options={[
            ...snapshotExamples.map((example, index) => ({ label: `${index + 1}. ${example}`, value: example })),
            { label: strings.otherEditableValue, value: CUSTOM_CONTEXT_VALUE },
          ]}
          onValueChange={(value) => setPromptContext(value === CUSTOM_CONTEXT_VALUE ? '' : value)}
        />
      ) : null}
      {!snapshotExamples.length || !snapshotExamples.includes(promptContext) ? (
        <Field label={strings.transcriptionExample} value={promptContext} onChangeText={setPromptContext} multiline />
      ) : null}
      <Field label={strings.verbatimText} value={verbatim} onChangeText={setVerbatim} multiline />
      <Field label={strings.normalizedText} value={normalized} onChangeText={setNormalized} multiline />
      <Field label={strings.languageTags} value={languageTags} onChangeText={setLanguageTags} />
      <Field label={strings.annotationNotes} value={transcriptionNotes} onChangeText={setTranscriptionNotes} multiline />
      <Field label={strings.annotatorCode} value={annotator} onChangeText={setAnnotator} />
      <Button label={strings.saveTranscription} onPress={() => void saveTranscript()} loading={savingTranscript} />

      <Heading subtitle={`${strings.revision} ${annotationRevision ?? 0}`}>{strings.businessLabels}</Heading>
      <BusinessSelectField label={strings.transactionIntent} field="transactionIntent" value={business.transactionIntent} options={transactionIntentOptions} setBusiness={setBusiness} />
      <BusinessField label={strings.productService} field="productOrService" value={business.productOrService} setBusiness={setBusiness} />
      <BusinessField label={strings.quantity} field="quantity" value={business.quantity} setBusiness={setBusiness} />
      <BusinessField label={strings.amount} field="amount" value={business.amount} setBusiness={setBusiness} />
      <BusinessSelectField label={strings.currency} field="currency" value={business.currency} options={currencyOptions} setBusiness={setBusiness} />
      <BusinessField label={strings.amountPaid} field="amountPaid" value={business.amountPaid} setBusiness={setBusiness} />
      <BusinessField label={strings.outstandingDebt} field="outstandingDebt" value={business.outstandingDebt} setBusiness={setBusiness} />
      <BusinessSelectField label={strings.paymentMethod} field="paymentMethod" value={business.paymentMethod} options={paymentMethodOptions} setBusiness={setBusiness} />
      <BusinessField label={strings.transactionReference} field="transactionReference" value={business.transactionReference} setBusiness={setBusiness} />
      <Button label={strings.saveBusinessAnnotation} onPress={() => void saveAnnotation()} loading={savingAnnotation} />
      {canCorrectPrompt ? (
        <>
          <Heading subtitle={strings.exampleCorrectionSubtitle}>{strings.correctExampleAssociation}</Heading>
          <SelectField
            label={strings.correctExample}
            value={correctedPrompt}
            options={snapshotExamples.map((example, index) => ({ label: `${index + 1}. ${example}`, value: example }))}
            onValueChange={setCorrectedPrompt}
          />
          <Field label={strings.correctionReason} value={correctionReason} onChangeText={setCorrectionReason} multiline />
          <Field label={strings.correctedBy} value={correctedBy} onChangeText={setCorrectedBy} />
          <Button
            label={strings.saveExampleCorrection}
            onPress={confirmPromptCorrection}
            loading={savingCorrection}
            disabled={correctedPrompt === recording.elicitationPromptText}
          />
          {promptCorrections.length ? (
            <Card>
              <Text style={uiStyles.title}>{strings.correctionHistory}</Text>
              {promptCorrections.map((correction) => (
                <View key={correction.id} style={styles.correctionEntry}>
                  <Text style={uiStyles.body}>{correction.previousPromptText} → {correction.correctedPromptText}</Text>
                  <Text style={uiStyles.muted}>{correction.reason}</Text>
                  <Text style={uiStyles.muted}>{new Date(correction.createdAt).toLocaleString(localeTag)} · {correction.correctedBy ?? strings.researcherNotRecorded}</Text>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}
      <Heading>{strings.correctMistake}</Heading>
      <Button label={strings.removeRecording} variant="danger" onPress={archive} />
    </Screen>
  );
}

function StoredAudioPlayer({ uri }: { uri: string }) {
  const { strings } = useI18n();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const play = () => { if (status.didJustFinish) player.seekTo(0); player.play(); };
  return <Button label={status.playing ? strings.pauseAudio : strings.playAudio} variant="secondary" onPress={() => status.playing ? player.pause() : play()} />;
}

function BusinessField({ label, field, value, setBusiness }: { label: string; field: keyof BusinessAnnotationPayload; value: string | null; setBusiness: React.Dispatch<React.SetStateAction<BusinessAnnotationPayload>> }) {
  return <Field label={label} value={value ?? ''} onChangeText={(text) => setBusiness((current) => ({ ...current, [field]: nullableText(text) }))} />;
}

function BusinessSelectField({ label, field, value, options, setBusiness }: { label: string; field: keyof BusinessAnnotationPayload; value: string | null; options: AnnotationSelectOption[]; setBusiness: React.Dispatch<React.SetStateAction<BusinessAnnotationPayload>> }) {
  const { translateText } = useI18n();
  return (
    <SelectField
      label={label}
      value={value ?? ''}
      options={preserveAnnotationValue(options, value).map((option) => ({ ...option, label: translateText(option.label) }))}
      onValueChange={(selected) => setBusiness((current) => ({ ...current, [field]: nullableText(selected) }))}
    />
  );
}

const formatDuration = (milliseconds: number) => `${Math.floor(milliseconds / 60000)}:${Math.floor((milliseconds % 60000) / 1000).toString().padStart(2, '0')}`;
const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const styles = StyleSheet.create({
  choice: { borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: colors.surface },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { color: colors.ink, textTransform: 'capitalize', fontSize: 13 },
  choiceTextSelected: { color: '#FFFFFF', fontWeight: '700' },
  correctionEntry: { borderTopColor: colors.border, borderTopWidth: 1, marginTop: 10, paddingTop: 10, gap: 4 },
});

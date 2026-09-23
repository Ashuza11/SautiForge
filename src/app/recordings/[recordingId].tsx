import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { useRepositories } from '@/core/database/repositories';
import { nullableText } from '@/domain/common';
import { businessAnnotationPayloadSchema, type BusinessAnnotationPayload } from '@/features/annotations/domain/annotation';
import { getRecordingFile } from '@/features/recordings/data/audio-file-store';
import { annotationStatusSchema, type Recording } from '@/features/recordings/domain/recording';
import type { Transcription } from '@/features/transcriptions/domain/transcription';
import { Button, Card, EmptyState, ErrorNotice, Field, Heading, Screen, uiStyles } from '@/ui/components';
import { colors } from '@/ui/theme';

const statusOptions = annotationStatusSchema.options;
const emptyBusiness: BusinessAnnotationPayload = {
  transactionIntent: null, productOrService: null, quantity: null, amount: null, currency: null,
  amountPaid: null, outstandingDebt: null, paymentMethod: null, transactionReference: null,
};

export default function RecordingDetailScreen() {
  const params = useLocalSearchParams<{ recordingId: string }>();
  const recordingId = Array.isArray(params.recordingId) ? params.recordingId[0] : params.recordingId;
  const repositories = useRepositories();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [transcriptionHistory, setTranscriptionHistory] = useState<Transcription[]>([]);
  const [verbatim, setVerbatim] = useState('');
  const [normalized, setNormalized] = useState('');
  const [languageTags, setLanguageTags] = useState('');
  const [transcriptionNotes, setTranscriptionNotes] = useState('');
  const [annotator, setAnnotator] = useState('');
  const [business, setBusiness] = useState<BusinessAnnotationPayload>(emptyBusiness);
  const [annotationRevision, setAnnotationRevision] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [savingAnnotation, setSavingAnnotation] = useState(false);

  const load = useCallback(async () => {
    if (!recordingId) return;
    try {
      const [recordingResult, transcripts, annotation] = await Promise.all([
        repositories.recordings.get(recordingId),
        repositories.transcriptions.listRevisions(recordingId),
        repositories.annotations.getCurrentBusiness(recordingId),
      ]);
      if (!recordingResult) throw new Error('Recording not found.');
      setRecording(recordingResult);
      setTranscriptionHistory(transcripts);
      const current = transcripts[0];
      setVerbatim(current?.verbatimText ?? '');
      setNormalized(current?.normalizedText ?? '');
      setLanguageTags(current?.languageTags.join(', ') ?? recordingResult.spokenLanguages.join(', '));
      setTranscriptionNotes(current?.notes ?? '');
      setAnnotator(current?.createdBy ?? '');
      if (annotation) {
        setBusiness(businessAnnotationPayloadSchema.parse(annotation.payload));
        setAnnotationRevision(annotation.revisionNumber);
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recording detail could not be loaded.');
    }
  }, [recordingId, repositories]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const saveTranscript = async () => {
    if (!recording) return;
    setSavingTranscript(true);
    setError(null);
    try {
      await repositories.transcriptions.createRevision(recording.id, {
        verbatimText: nullableText(verbatim),
        normalizedText: nullableText(normalized),
        languageTags: languageTags.split(',').map((value) => value.trim()).filter(Boolean),
        notes: nullableText(transcriptionNotes),
        createdBy: nullableText(annotator),
      });
      if (verbatim.trim()) await repositories.recordings.updateStatus(recording.id, 'transcribed');
      await load();
      Alert.alert('Transcription saved', 'A new human revision was stored; prior revisions were preserved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Transcription was not saved.');
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
      Alert.alert('Annotation saved', 'A new human annotation revision was stored.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Annotation was not saved.');
    } finally {
      setSavingAnnotation(false);
    }
  };

  const updateStatus = async (status: Recording['annotationStatus']) => {
    if (!recording) return;
    try {
      setRecording(await repositories.recordings.updateStatus(recording.id, status));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Status was not changed.');
    }
  };

  const archive = () => {
    if (!recording) return;
    Alert.alert('Archive recording?', 'The audio and metadata will be excluded from the active library but retained for research integrity.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: async () => {
        try { await repositories.recordings.archive(recording.id); router.replace('/library'); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Recording could not be archived.'); }
      } },
    ]);
  };

  if (!recording) return <Screen>{error ? <ErrorNotice message={error} /> : <EmptyState>Loading recording…</EmptyState>}</Screen>;
  let audioUri: string | null = null;
  let audioError: string | null = null;
  try { audioUri = getRecordingFile(recording.relativeAudioPath).uri; }
  catch (cause) { audioError = cause instanceof Error ? cause.message : 'Audio is unavailable.'; }

  return (
    <Screen>
      <Heading subtitle={`${recording.container.toUpperCase()} · ${formatDuration(recording.durationMs)} · ${formatBytes(recording.fileSizeBytes)}`}>{recording.displayId}</Heading>
      {error ? <ErrorNotice message={error} /> : null}
      {audioError ? <ErrorNotice message={audioError} /> : null}
      <Card>
        <Text style={uiStyles.title}>{String(recording.scenarioPromptSnapshot.title ?? 'Scenario')}</Text>
        <Text style={uiStyles.muted}>Scenario version {recording.scenarioVersion} · {new Date(recording.recordedAt).toLocaleString()}</Text>
        <Text style={uiStyles.body}>Languages: {recording.spokenLanguages.join(', ')}</Text>
        <Text style={uiStyles.muted}>Codec: {recording.codec ?? 'unavailable'} · {recording.sampleRateHz ?? 'unavailable'} Hz · {recording.channelCount ?? 'unavailable'} channels</Text>
        {audioUri ? <StoredAudioPlayer uri={audioUri} /> : null}
      </Card>

      <Heading subtitle="Status changes are separate from transcript revisions.">Review state</Heading>
      <View style={uiStyles.row}>
        {statusOptions.map((status) => (
          <Pressable key={status} onPress={() => void updateStatus(status)} style={[styles.choice, recording.annotationStatus === status && styles.choiceSelected]}>
            <Text style={[styles.choiceText, recording.annotationStatus === status && styles.choiceTextSelected]}>{status.replaceAll('_', ' ')}</Text>
          </Pressable>
        ))}
      </View>

      <Heading subtitle={`${transcriptionHistory.length} human revision${transcriptionHistory.length === 1 ? '' : 's'} stored. Verbatim text should preserve the spoken variety.`}>Transcription</Heading>
      <Field label="Verbatim transcription (optional)" value={verbatim} onChangeText={setVerbatim} multiline />
      <Field label="Normalized text (optional, independent)" value={normalized} onChangeText={setNormalized} multiline />
      <Field label="Language tags, comma separated" value={languageTags} onChangeText={setLanguageTags} />
      <Field label="Annotation notes (optional)" value={transcriptionNotes} onChangeText={setTranscriptionNotes} multiline />
      <Field label="Annotator code (optional)" value={annotator} onChangeText={setAnnotator} />
      <Button label="Save transcription revision" onPress={() => void saveTranscript()} loading={savingTranscript} />

      <Heading subtitle={`Business annotation revision ${annotationRevision ?? 0}. Leave irrelevant fields blank; enter “unknown”, “ambiguous”, or “unavailable” explicitly when needed.`}>Structured business labels</Heading>
      <BusinessField label="Transaction intent" field="transactionIntent" value={business.transactionIntent} setBusiness={setBusiness} />
      <BusinessField label="Product or service" field="productOrService" value={business.productOrService} setBusiness={setBusiness} />
      <BusinessField label="Quantity" field="quantity" value={business.quantity} setBusiness={setBusiness} />
      <BusinessField label="Amount" field="amount" value={business.amount} setBusiness={setBusiness} />
      <BusinessField label="Currency" field="currency" value={business.currency} setBusiness={setBusiness} />
      <BusinessField label="Amount paid" field="amountPaid" value={business.amountPaid} setBusiness={setBusiness} />
      <BusinessField label="Outstanding debt" field="outstandingDebt" value={business.outstandingDebt} setBusiness={setBusiness} />
      <BusinessField label="Payment method" field="paymentMethod" value={business.paymentMethod} setBusiness={setBusiness} />
      <BusinessField label="Transaction reference" field="transactionReference" value={business.transactionReference} setBusiness={setBusiness} />
      <Button label="Save business annotation revision" onPress={() => void saveAnnotation()} loading={savingAnnotation} />
      <Button label="Archive recording" variant="danger" onPress={archive} />
    </Screen>
  );
}

function StoredAudioPlayer({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const play = () => { if (status.didJustFinish) player.seekTo(0); player.play(); };
  return <Button label={status.playing ? 'Pause audio' : 'Play audio'} variant="secondary" onPress={() => status.playing ? player.pause() : play()} />;
}

function BusinessField({ label, field, value, setBusiness }: { label: string; field: keyof BusinessAnnotationPayload; value: string | null; setBusiness: React.Dispatch<React.SetStateAction<BusinessAnnotationPayload>> }) {
  return <Field label={label} value={value ?? ''} onChangeText={(text) => setBusiness((current) => ({ ...current, [field]: nullableText(text) }))} />;
}

const formatDuration = (milliseconds: number) => `${Math.floor(milliseconds / 60000)}:${Math.floor((milliseconds % 60000) / 1000).toString().padStart(2, '0')}`;
const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const styles = StyleSheet.create({
  choice: { borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: colors.surface },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { color: colors.ink, textTransform: 'capitalize', fontSize: 13 },
  choiceTextSelected: { color: '#FFFFFF', fontWeight: '700' },
});

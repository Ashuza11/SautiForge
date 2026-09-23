import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { File } from 'expo-file-system';

import { useRepositories } from '@/core/database/repositories';
import type { SharingCategory } from '@/features/consent/domain/consent';
import type { Project } from '@/features/projects/domain/project';
import { Button, Card, ErrorNotice, Heading, Screen, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

type ReadyArchive = { file: File; exportId: string; label: string };

const categories: Array<{ value: SharingCategory; label: string; explanation: string }> = [
  { value: 'internal_research', label: 'Internal research', explanation: 'Includes recordings currently approved for internal research.' },
  { value: 'restricted_annotation', label: 'Restricted annotation', explanation: 'Includes only recordings approved for controlled annotator sharing.' },
  { value: 'public_release', label: 'Public release', explanation: 'Includes only recordings explicitly approved for public release.' },
];

export default function ExportScreen() {
  const repositories = useRepositories();
  const [project, setProject] = useState<Project | null>(null);
  const [category, setCategory] = useState<SharingCategory>('internal_research');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ready, setReady] = useState<ReadyArchive | null>(null);

  useFocusEffect(useCallback(() => {
    void repositories.projects.getActive().then(setProject).catch((cause) => setError(errorMessage(cause)));
  }, [repositories.projects]));

  const createResearch = async () => {
    if (!project) return;
    setBusy('research'); setError(null); setMessage(null); setReady(null);
    try {
      const result = await repositories.exports.createResearchDataset(project.id, category);
      setReady({ file: result.archive, exportId: result.exportId, label: 'research dataset' });
      setMessage(`ZIP verified: ${result.includedRecordings} recording(s) included, ${result.excludedRecordings} excluded by current consent.`);
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(null); }
  };

  const createBackup = () => Alert.alert(
    'Create sensitive backup?',
    'This separate ZIP contains consent records, administrative notes, and all audio. It is not encrypted by SautiForge. Store it only in an access-controlled location.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Create backup', onPress: () => void runBackup() }],
  );

  const runBackup = async () => {
    setBusy('backup'); setError(null); setMessage(null); setReady(null);
    try {
      const result = await repositories.exports.createAdministrativeBackup();
      setReady({ file: result.archive, exportId: result.exportId, label: 'administrative backup' });
      setMessage(`Private backup verified with ${result.includedRecordings} recording(s). Save it outside the app now.`);
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(null); }
  };

  const save = async () => {
    if (!ready) return;
    setBusy('save'); setError(null);
    try {
      const destination = await repositories.exports.saveOutsideApp(ready.file, ready.exportId);
      setMessage(`${ready.label} saved and verified at ${destination}`);
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(null); }
  };

  const share = async () => {
    if (!ready) return;
    setBusy('share'); setError(null);
    try { await repositories.exports.share(ready.file); setMessage('Android sharing completed. Confirm receipt at the destination.'); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusy(null); }
  };

  const confirmRestore = () => Alert.alert(
    'Replace local data?',
    'Restore validates every hash and the SQLite database before replacing local data. Existing local database records will be replaced. Keep a current backup first.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Select backup', style: 'destructive', onPress: () => void restore() }],
  );

  const restore = async () => {
    setBusy('restore'); setError(null); setMessage(null); setReady(null);
    try {
      const result = await repositories.exports.pickAndRestoreAdministrativeBackup();
      setMessage(`Restore verified and completed with ${result.recordings} recording(s). Close and reopen SautiForge before continuing work.`);
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(null); }
  };

  return (
    <Screen>
      <Heading subtitle="Portable, verified archives created entirely on this device">Export and backup</Heading>
      {error ? <ErrorNotice message={error} /> : null}
      {message ? <Card><Text style={styles.success}>{message}</Text></Card> : null}

      <Card>
        <Text style={uiStyles.title}>Research dataset</Text>
        <Text style={uiStyles.body}>{project ? project.title : 'Select an active project on the home screen first.'}</Text>
        <Text style={uiStyles.muted}>Consent and private administrative notes are excluded. Current consent is checked when the archive is created.</Text>
        {categories.map((item) => (
          <Button key={item.value} label={`${category === item.value ? '✓ ' : ''}${item.label}`} variant="secondary" onPress={() => setCategory(item.value)} disabled={Boolean(busy)} />
        ))}
        <Text style={styles.hint}>{categories.find((item) => item.value === category)?.explanation}</Text>
        <Button label="Create verified research ZIP" onPress={() => void createResearch()} loading={busy === 'research'} disabled={!project || Boolean(busy)} />
      </Card>

      {ready ? (
        <Card>
          <Text style={uiStyles.title}>Archive ready in temporary app storage</Text>
          <Text style={uiStyles.muted}>{ready.file.name} · {formatBytes(ready.file.size ?? 0)}</Text>
          <View style={styles.actions}>
            <Button label="Save to folder" onPress={() => void save()} loading={busy === 'save'} disabled={Boolean(busy)} />
            <Button label="Share ZIP" variant="secondary" onPress={() => void share()} loading={busy === 'share'} disabled={Boolean(busy)} />
          </View>
        </Card>
      ) : null}

      <Card>
        <Text style={uiStyles.title}>Restricted administrative backup</Text>
        <Text style={styles.warning}>Sensitive: includes the complete database, consent records, administrative notes, and all audio. The ZIP is not app-encrypted.</Text>
        <Button label="Create private backup" variant="secondary" onPress={createBackup} loading={busy === 'backup'} disabled={Boolean(busy)} />
        <Button label="Restore verified backup" variant="danger" onPress={confirmRestore} loading={busy === 'restore'} disabled={Boolean(busy)} />
      </Card>
    </Screen>
  );
}

function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : 'The operation failed without a readable error.'; }
function formatBytes(bytes: number): string { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`; }

const styles = StyleSheet.create({
  success: { color: colors.primary, fontWeight: '700', lineHeight: 21 },
  warning: { color: colors.warning, lineHeight: 21 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  actions: { gap: spacing.sm },
});

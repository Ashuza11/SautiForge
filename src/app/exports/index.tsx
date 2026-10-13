import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { File } from 'expo-file-system';

import { useRepositories } from '@/core/database/repositories';
import type { SharingCategory } from '@/features/consent/domain/consent';
import type { Project } from '@/features/projects/domain/project';
import { useI18n } from '@/i18n';
import { Button, Card, ErrorNotice, Heading, Screen, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

type ReadyArchive = { file: File; exportId: string; label: string };

export default function ExportScreen() {
  const repositories = useRepositories();
  const { strings, translateText } = useI18n();
  const categories: Array<{ value: SharingCategory; label: string; explanation: string }> = [
    { value: 'internal_research', label: strings.internalResearch, explanation: strings.internalResearchExport },
    { value: 'restricted_annotation', label: strings.restrictedAnnotation, explanation: strings.restrictedExport },
    { value: 'public_release', label: strings.publicRelease, explanation: strings.publicExport },
  ];
  const [project, setProject] = useState<Project | null>(null);
  const [category, setCategory] = useState<SharingCategory>('internal_research');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ready, setReady] = useState<ReadyArchive | null>(null);

  useFocusEffect(useCallback(() => {
    void repositories.projects.getActive().then(setProject).catch((cause) => setError(errorMessage(cause, translateText, strings.operationFailed)));
  }, [repositories.projects, strings.operationFailed, translateText]));

  const createResearch = async () => {
    if (!project) return;
    setBusy('research'); setError(null); setMessage(null); setReady(null);
    try {
      const result = await repositories.exports.createResearchDataset(project.id, category);
      setReady({ file: result.archive, exportId: result.exportId, label: strings.researchDataset });
      setMessage(`${strings.zipVerified}: ${result.includedRecordings} ${strings.included}, ${result.excludedRecordings} ${strings.excluded}.`);
    } catch (cause) { setError(errorMessage(cause, translateText, strings.operationFailed)); } finally { setBusy(null); }
  };

  const createBackup = () => Alert.alert(
    strings.createSensitiveBackup,
    strings.sensitiveBackupWarning,
    [{ text: strings.cancel, style: 'cancel' }, { text: strings.createPrivateBackup, onPress: () => void runBackup() }],
  );

  const runBackup = async () => {
    setBusy('backup'); setError(null); setMessage(null); setReady(null);
    try {
      const result = await repositories.exports.createAdministrativeBackup();
      setReady({ file: result.archive, exportId: result.exportId, label: strings.administrativeBackup });
      setMessage(`${strings.backupVerified}: ${result.includedRecordings} ${strings.recordings.toLowerCase()}.`);
    } catch (cause) { setError(errorMessage(cause, translateText, strings.operationFailed)); } finally { setBusy(null); }
  };

  const save = async () => {
    if (!ready) return;
    setBusy('save'); setError(null);
    try {
      const destination = await repositories.exports.saveOutsideApp(ready.file, ready.exportId);
      setMessage(`${ready.label} ${strings.savedAt} ${destination}`);
    } catch (cause) { setError(errorMessage(cause, translateText, strings.operationFailed)); } finally { setBusy(null); }
  };

  const share = async () => {
    if (!ready) return;
    setBusy('share'); setError(null);
    try { await repositories.exports.share(ready.file); setMessage(strings.sharingCompleted); }
    catch (cause) { setError(errorMessage(cause, translateText, strings.operationFailed)); } finally { setBusy(null); }
  };

  const confirmRestore = () => Alert.alert(
    strings.replaceLocalData,
    strings.restoreWarning,
    [{ text: strings.cancel, style: 'cancel' }, { text: strings.selectBackup, style: 'destructive', onPress: () => void restore() }],
  );

  const restore = async () => {
    setBusy('restore'); setError(null); setMessage(null); setReady(null);
    try {
      const result = await repositories.exports.pickAndRestoreAdministrativeBackup();
      setMessage(`${strings.restoreCompleted}: ${result.recordings} ${strings.recordings.toLowerCase()}. ${strings.restartApp}.`);
    } catch (cause) { setError(errorMessage(cause, translateText, strings.operationFailed)); } finally { setBusy(null); }
  };

  return (
    <Screen>
      <Heading>{strings.exports}</Heading>
      {error ? <ErrorNotice message={error} /> : null}
      {message ? <Card><Text style={styles.success}>{message}</Text></Card> : null}

      <Card>
        <Text style={uiStyles.title}>{strings.researchDataset}</Text>
        <Text style={uiStyles.body}>{project ? project.title : strings.selectActiveProject}</Text>
        <Text style={uiStyles.muted}>{strings.privateDataExcluded}</Text>
        {categories.map((item) => (
          <Button key={item.value} label={`${category === item.value ? '✓ ' : ''}${item.label}`} variant="secondary" onPress={() => setCategory(item.value)} disabled={Boolean(busy)} />
        ))}
        <Text style={styles.hint}>{categories.find((item) => item.value === category)?.explanation}</Text>
        <Button label={strings.createResearchZip} onPress={() => void createResearch()} loading={busy === 'research'} disabled={!project || Boolean(busy)} />
      </Card>

      {ready ? (
        <Card>
          <Text style={uiStyles.title}>{strings.archiveReady}</Text>
          <Text style={uiStyles.muted}>{ready.file.name} · {formatBytes(ready.file.size ?? 0)}</Text>
          <View style={styles.actions}>
            <Button label={strings.saveToFolder} onPress={() => void save()} loading={busy === 'save'} disabled={Boolean(busy)} />
            <Button label={strings.shareZip} variant="secondary" onPress={() => void share()} loading={busy === 'share'} disabled={Boolean(busy)} />
          </View>
        </Card>
      ) : null}

      <Card>
        <Text style={uiStyles.title}>{strings.administrativeBackup}</Text>
        <Text style={styles.warning}>{strings.sensitiveBackupShort}</Text>
        <Button label={strings.createPrivateBackup} variant="secondary" onPress={createBackup} loading={busy === 'backup'} disabled={Boolean(busy)} />
        <Button label={strings.restoreBackup} variant="danger" onPress={confirmRestore} loading={busy === 'restore'} disabled={Boolean(busy)} />
      </Card>
    </Screen>
  );
}

function errorMessage(cause: unknown, translateText: (text: string) => string, fallback: string): string { return cause instanceof Error ? translateText(cause.message) : fallback; }
function formatBytes(bytes: number): string { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`; }

const styles = StyleSheet.create({
  success: { color: colors.primary, fontWeight: '700', lineHeight: 21 },
  warning: { color: colors.warning, lineHeight: 21 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  actions: { gap: spacing.sm },
});

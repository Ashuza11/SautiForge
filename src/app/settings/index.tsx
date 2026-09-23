import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text } from 'react-native';
import Constants from 'expo-constants';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { Paths } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';

import { DATABASE_VERSION } from '@/core/database/migrations';
import { useRepositories } from '@/core/database/repositories';
import type { Project } from '@/features/projects/domain/project';
import type { StorageRecoveryReport } from '@/features/settings/domain/settings';
import { Button, Card, ErrorNotice, Heading, Screen, uiStyles } from '@/ui/components';
import { colors } from '@/ui/theme';

type PermissionState = { status: string; canAskAgain: boolean };

export default function SettingsScreen() {
  const repositories = useRepositories();
  const [project, setProject] = useState<Project | null>(null);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [recovery, setRecovery] = useState<StorageRecoveryReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [active, microphone, lastRecovery] = await Promise.all([repositories.projects.getActive(), getRecordingPermissionsAsync(), repositories.settings.getLastStorageRecovery()]);
      setProject(active);
      setPermission({ status: microphone.status, canAskAgain: microphone.canAskAgain });
      setRecovery(lastRecovery);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Settings could not be loaded.'); }
  }, [repositories.projects]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const requestMicrophone = async () => {
    try {
      const result = await requestRecordingPermissionsAsync();
      setPermission({ status: result.status, canAskAgain: result.canAskAgain });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Microphone permission could not be requested.'); }
  };

  return (
    <Screen>
      <Heading subtitle="Local configuration, permissions, and field-safety limits">Settings and safety</Heading>
      {error ? <ErrorNotice message={error} /> : null}
      <Card>
        <Text style={uiStyles.title}>Collection context</Text>
        <Text style={uiStyles.body}>Active project: {project?.title ?? 'None selected'}</Text>
        <Text style={uiStyles.muted}>Interface language: English</Text>
        <Text style={uiStyles.muted}>App version: {Constants.expoConfig?.version ?? '0.1.0'} · database schema {DATABASE_VERSION}</Text>
        <Text style={uiStyles.muted}>Available device storage: {formatBytes(Paths.availableDiskSpace)}</Text>
      </Card>
      <Card>
        <Text style={uiStyles.title}>Microphone permission</Text>
        <Text style={permission?.status === 'granted' ? styles.ok : styles.warning}>{permission?.status ?? 'Checking…'}</Text>
        <Text style={uiStyles.muted}>Permission alone never starts recording. A visible recording screen, active session, and current participant consent are also required.</Text>
        {permission?.status !== 'granted' && permission?.canAskAgain ? <Button label="Request microphone permission" onPress={() => void requestMicrophone()} /> : null}
        {permission?.status === 'denied' && !permission.canAskAgain ? <Button label="Open Android app settings" variant="secondary" onPress={() => void Linking.openSettings()} /> : null}
      </Card>
      <Card>
        <Text style={uiStyles.title}>Recording storage check</Text>
        <Text style={recovery?.missingPaths.length || recovery?.errors.length ? styles.warning : styles.ok}>
          {recovery ? `${recovery.verifiedFiles} verified · ${recovery.missingPaths.length} missing · ${recovery.quarantinedPaths.length} quarantined` : 'No check result'}
        </Text>
        {recovery ? <Text style={uiStyles.muted}>Last checked {new Date(recovery.checkedAt).toLocaleString()}. Interrupted or unreferenced saves are moved to app-private recovery storage, not silently treated as saved recordings.</Text> : null}
        {recovery?.missingPaths.map((path) => <Text key={path} style={styles.warning}>Missing: {path}</Text>)}
        {recovery?.errors.map((message) => <Text key={message} style={styles.warning}>{message}</Text>)}
      </Card>
      <Card>
        <Text style={uiStyles.title}>Data protection</Text>
        <Text style={styles.warning}>App-private storage is not a complete encryption or backup strategy. Administrative backup ZIPs are sensitive and unencrypted.</Text>
        <Text style={uiStyles.body}>Use Android device encryption and a strong device lock. Store private backups only in restricted encrypted storage. Never collect PINs, credentials, real customer identifiers, or private customer conversations.</Text>
        <Button label="Export or restore data" variant="secondary" onPress={() => router.push('/exports')} />
      </Card>
      <Card>
        <Text style={uiStyles.title}>Offline operation</Text>
        <Text style={uiStyles.body}>SautiForge has no account, backend, automatic upload, background recording, or AI transcription. Core collection and export run on this device.</Text>
      </Card>
    </Screen>
  );
}

function formatBytes(bytes: number): string {
  const gigabytes = bytes / 1024 / 1024 / 1024;
  return gigabytes >= 1 ? `${gigabytes.toFixed(1)} GB` : `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

const styles = StyleSheet.create({
  ok: { color: colors.primary, fontWeight: '800', textTransform: 'uppercase' },
  warning: { color: colors.warning, fontWeight: '700', lineHeight: 21 },
});

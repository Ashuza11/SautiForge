import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text } from 'react-native';
import Constants from 'expo-constants';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { Paths } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';

import { DATABASE_VERSION } from '@/core/database/migrations';
import { useRepositories } from '@/core/database/repositories';
import type { Project } from '@/features/projects/domain/project';
import type { InterfaceLanguage, StorageRecoveryReport } from '@/features/settings/domain/settings';
import { useI18n } from '@/i18n';
import { Button, Card, ErrorNotice, Heading, Screen, SelectField, uiStyles } from '@/ui/components';
import { colors } from '@/ui/theme';

type PermissionState = { status: string; canAskAgain: boolean };

export default function SettingsScreen() {
  const repositories = useRepositories();
  const { language, localeTag, setLanguage, strings } = useI18n();
  const [project, setProject] = useState<Project | null>(null);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [recovery, setRecovery] = useState<StorageRecoveryReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [languageSaved, setLanguageSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const [active, microphone, lastRecovery] = await Promise.all([repositories.projects.getActive(), getRecordingPermissionsAsync(), repositories.settings.getLastStorageRecovery()]);
      setProject(active);
      setPermission({ status: microphone.status, canAskAgain: microphone.canAskAgain });
      setRecovery(lastRecovery);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : strings.settingsLoadFailed); }
  }, [repositories.projects, repositories.settings, strings.settingsLoadFailed]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const requestMicrophone = async () => {
    try {
      const result = await requestRecordingPermissionsAsync();
      setPermission({ status: result.status, canAskAgain: result.canAskAgain });
    } catch (cause) { setError(cause instanceof Error ? cause.message : strings.microphoneRequestFailed); }
  };

  const changeLanguage = async (value: string) => {
    setError(null);
    setLanguageSaved(false);
    try {
      await setLanguage(value as InterfaceLanguage);
      setLanguageSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : strings.languageSaveFailed);
    }
  };

  const permissionLabel = permission?.status === 'granted'
    ? strings.granted
    : permission?.status === 'denied'
      ? strings.denied
      : permission?.status === 'undetermined'
        ? strings.undetermined
        : strings.checking;

  return (
    <Screen>
      <Heading subtitle={strings.settingsSubtitle}>{strings.settingsAndSafety}</Heading>
      {error ? <ErrorNotice message={error} /> : null}
      <Card>
        <Text style={uiStyles.title}>{strings.collectionContext}</Text>
        <Text style={uiStyles.body}>{strings.activeProject}: {project?.title ?? strings.noneSelected}</Text>
        <SelectField
          label={strings.interfaceLanguage}
          value={language}
          options={[
            { label: strings.english, value: 'en' },
            { label: strings.french, value: 'fr' },
            { label: strings.kiswahili, value: 'sw' },
          ]}
          onValueChange={(value) => void changeLanguage(value)}
        />
        {languageSaved ? <Text accessibilityLiveRegion="polite" style={styles.ok}>{strings.languageSaved}</Text> : null}
        <Text style={uiStyles.muted}>{strings.appVersion}: {Constants.expoConfig?.version ?? '0.1.0'} · {strings.databaseSchema} {DATABASE_VERSION}</Text>
        <Text style={uiStyles.muted}>{strings.availableStorage}: {formatBytes(Paths.availableDiskSpace)}</Text>
      </Card>
      <Card>
        <Text style={uiStyles.title}>{strings.microphonePermission}</Text>
        <Text style={permission?.status === 'granted' ? styles.ok : styles.warning}>{permissionLabel}</Text>
        <Text style={uiStyles.muted}>{strings.permissionExplanation}</Text>
        {permission?.status !== 'granted' && permission?.canAskAgain ? <Button label={strings.requestMicrophonePermission} onPress={() => void requestMicrophone()} /> : null}
        {permission?.status === 'denied' && !permission.canAskAgain ? <Button label={strings.openAndroidSettings} variant="secondary" onPress={() => void Linking.openSettings()} /> : null}
      </Card>
      <Card>
        <Text style={uiStyles.title}>{strings.recordingStorageCheck}</Text>
        <Text style={recovery?.missingPaths.length || recovery?.errors.length ? styles.warning : styles.ok}>
          {recovery ? `${recovery.verifiedFiles} ${strings.verified} · ${recovery.missingPaths.length} ${strings.missing} · ${recovery.quarantinedPaths.length} ${strings.quarantined}` : strings.noCheckResult}
        </Text>
        {recovery ? <Text style={uiStyles.muted}>{strings.lastChecked} {new Date(recovery.checkedAt).toLocaleString(localeTag)}. {strings.recoveryExplanation}</Text> : null}
        {recovery?.missingPaths.map((path) => <Text key={path} style={styles.warning}>{strings.missing}: {path}</Text>)}
        {recovery?.errors.map((message) => <Text key={message} style={styles.warning}>{message}</Text>)}
      </Card>
      <Card>
        <Text style={uiStyles.title}>{strings.dataProtection}</Text>
        <Text style={styles.warning}>{strings.protectionWarning}</Text>
        <Text style={uiStyles.body}>{strings.protectionInstructions}</Text>
        <Button label={strings.exportOrRestoreData} variant="secondary" onPress={() => router.push('/exports')} />
      </Card>
      <Card>
        <Text style={uiStyles.title}>{strings.offlineOperation}</Text>
        <Text style={uiStyles.body}>{strings.offlineExplanation}</Text>
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

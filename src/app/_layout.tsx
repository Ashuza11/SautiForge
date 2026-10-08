import { Suspense } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DATABASE_NAME, migrateDatabase } from '@/core/database/migrations';
import { RepositoryProvider } from '@/core/database/repositories';
import { recoverRecordingStorage } from '@/features/recordings/data/recording-recovery';
import { I18nProvider, useI18n } from '@/i18n';
import { colors } from '@/ui/theme';

function LoadingDatabase() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.loadingText}>Preparing secure local storage…</Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Suspense fallback={<LoadingDatabase />}>
        <SQLiteProvider databaseName={DATABASE_NAME} onInit={initializeDatabase} useSuspense>
          <RepositoryProvider>
            <I18nProvider><LocalizedStack /></I18nProvider>
          </RepositoryProvider>
        </SQLiteProvider>
      </Suspense>
    </SafeAreaProvider>
  );
}

function LocalizedStack() {
  const { strings } = useI18n();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerShadowVisible: false, headerTintColor: colors.ink }}>
      <Stack.Screen name="index" options={{ title: strings.appName }} />
      <Stack.Screen name="projects/new" options={{ title: strings.newProject }} />
      <Stack.Screen name="projects/[projectId]/index" options={{ title: strings.project }} />
      <Stack.Screen name="projects/[projectId]/edit" options={{ title: strings.editProject }} />
      <Stack.Screen name="projects/[projectId]/scenarios/new" options={{ title: strings.newScenario }} />
      <Stack.Screen name="scenarios/[scenarioId]/edit" options={{ title: strings.editScenario }} />
      <Stack.Screen name="projects/[projectId]/participants/new" options={{ title: strings.newParticipant }} />
      <Stack.Screen name="participants/[participantId]/index" options={{ title: strings.participant }} />
      <Stack.Screen name="participants/[participantId]/edit" options={{ title: strings.editParticipant }} />
      <Stack.Screen name="participants/[participantId]/consent/new" options={{ title: strings.updateConsent }} />
      <Stack.Screen name="participants/[participantId]/sessions/new" options={{ title: strings.startSession }} />
      <Stack.Screen name="sessions/[sessionId]/index" options={{ title: strings.collectionSession }} />
      <Stack.Screen name="sessions/[sessionId]/record" options={{ title: strings.recordAudio, gestureEnabled: false, headerBackVisible: false }} />
      <Stack.Screen name="library/index" options={{ title: strings.recordingLibrary }} />
      <Stack.Screen name="recordings/[recordingId]" options={{ title: strings.recordingDetail }} />
      <Stack.Screen name="exports/index" options={{ title: strings.exports }} />
      <Stack.Screen name="settings/index" options={{ title: strings.settingsAndSafety }} />
    </Stack>
  );
}

async function initializeDatabase(database: Parameters<typeof migrateDatabase>[0]) {
  await migrateDatabase(database);
  try {
    await recoverRecordingStorage(database);
  } catch (cause) {
    const checkedAt = new Date().toISOString();
    const message = cause instanceof Error ? cause.message : 'Storage recovery failed without a readable error.';
    await database.runAsync(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('last_storage_recovery', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      JSON.stringify({ checkedAt, scannedFiles: 0, verifiedFiles: 0, quarantinedPaths: [], missingPaths: [], errors: [message] }), checkedAt,
    );
  }
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: colors.background },
  loadingText: { color: colors.muted, fontSize: 15 },
});

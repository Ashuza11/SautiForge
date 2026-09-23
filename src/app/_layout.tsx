import { Suspense } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DATABASE_NAME, migrateDatabase } from '@/core/database/migrations';
import { RepositoryProvider } from '@/core/database/repositories';
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
        <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDatabase} useSuspense>
          <RepositoryProvider>
            <Stack screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerShadowVisible: false, headerTintColor: colors.ink }}>
              <Stack.Screen name="index" options={{ title: 'SautiForge' }} />
              <Stack.Screen name="projects/new" options={{ title: 'New project' }} />
              <Stack.Screen name="projects/[projectId]/index" options={{ title: 'Project' }} />
              <Stack.Screen name="projects/[projectId]/edit" options={{ title: 'Edit project' }} />
              <Stack.Screen name="projects/[projectId]/scenarios/new" options={{ title: 'New scenario' }} />
              <Stack.Screen name="scenarios/[scenarioId]/edit" options={{ title: 'Edit scenario' }} />
              <Stack.Screen name="projects/[projectId]/participants/new" options={{ title: 'New participant' }} />
              <Stack.Screen name="participants/[participantId]/index" options={{ title: 'Participant' }} />
              <Stack.Screen name="participants/[participantId]/edit" options={{ title: 'Edit participant' }} />
              <Stack.Screen name="participants/[participantId]/consent/new" options={{ title: 'Update consent' }} />
              <Stack.Screen name="participants/[participantId]/sessions/new" options={{ title: 'Start session' }} />
              <Stack.Screen name="sessions/[sessionId]/index" options={{ title: 'Collection session' }} />
              <Stack.Screen name="sessions/[sessionId]/record" options={{ title: 'Record audio', gestureEnabled: false, headerBackVisible: false }} />
              <Stack.Screen name="library/index" options={{ title: 'Recording library' }} />
              <Stack.Screen name="recordings/[recordingId]" options={{ title: 'Recording detail' }} />
              <Stack.Screen name="exports/index" options={{ title: 'Export and backup' }} />
            </Stack>
          </RepositoryProvider>
        </SQLiteProvider>
      </Suspense>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: colors.background },
  loadingText: { color: colors.muted, fontSize: 15 },
});

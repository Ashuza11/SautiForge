import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import * as Device from 'expo-device';
import type { ZodIssue } from 'zod';

import { nullableText } from '@/domain/common';
import { Button, ErrorNotice, Field, uiStyles } from '@/ui/components';
import { sessionDraftSchema, type SessionDraft } from '../domain/session';

export function SessionForm({ onSave }: { onSave: (draft: SessionDraft) => Promise<void> }) {
  const [environment, setEnvironment] = useState('Indoor shop');
  const [city, setCity] = useState('Bukavu');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const result = sessionDraftSchema.safeParse({
      collectionEnvironment: environment,
      city: nullableText(city),
      researcherNotes: nullableText(notes),
      deviceMetadata: {
        platform: Platform.OS,
        platformVersion: String(Platform.Version),
        brand: Device.brand,
        manufacturer: Device.manufacturer,
        modelName: Device.modelName,
        deviceName: Device.deviceName,
        osName: Device.osName,
        osVersion: Device.osVersion,
        deviceType: Device.deviceType,
      },
    });
    if (!result.success) {
      setErrors(Object.fromEntries(result.error.issues.map((issue: ZodIssue) => [String(issue.path[0]), issue.message])));
      return;
    }
    setErrors({});
    setSubmitError(null);
    setSaving(true);
    try {
      await onSave(result.data);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The session could not be started.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={uiStyles.gap}>
      {submitError ? <ErrorNotice message={submitError} /> : null}
      <Field label="Collection environment" value={environment} onChangeText={setEnvironment} error={errors.collectionEnvironment} placeholder="e.g. Indoor shop" />
      <Field label="City-level location (optional)" value={city} onChangeText={setCity} error={errors.city} />
      <Field label="Researcher notes (optional)" value={notes} onChangeText={setNotes} error={errors.researcherNotes} multiline />
      <Text style={uiStyles.muted}>Device model and operating-system metadata are captured automatically. Precise location is not collected.</Text>
      <Button label="Start session" onPress={submit} loading={saving} />
    </View>
  );
}

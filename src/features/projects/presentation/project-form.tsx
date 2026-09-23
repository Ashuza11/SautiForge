import { useState } from 'react';
import { Text, View } from 'react-native';
import type { ZodIssue } from 'zod';

import { projectDraftSchema, type ProjectDraft } from '../domain/project';
import { Button, ErrorNotice, Field, uiStyles } from '@/ui/components';

const blankProject: ProjectDraft = {
  title: '',
  description: '',
  targetLanguage: '',
  languageVariety: '',
  researchDomain: '',
  collectionLocation: '',
  protocolVersion: '0.1',
  status: 'active',
};

type Props = {
  initial?: ProjectDraft;
  onSave: (draft: ProjectDraft) => Promise<void>;
};

export function ProjectForm({ initial = blankProject, onSave }: Props) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof ProjectDraft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setSubmitError(null);
    const result = projectDraftSchema.safeParse(draft);
    if (!result.success) {
      setErrors(Object.fromEntries(result.error.issues.map((issue: ZodIssue) => [String(issue.path[0]), issue.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await onSave(result.data);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The project could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={uiStyles.gap}>
      {submitError ? <ErrorNotice message={submitError} /> : null}
      <Field label="Project title" value={draft.title} onChangeText={set('title')} error={errors.title} autoCapitalize="sentences" />
      <Field label="Description" value={draft.description} onChangeText={set('description')} error={errors.description} multiline />
      <Field label="Target language" value={draft.targetLanguage} onChangeText={set('targetLanguage')} error={errors.targetLanguage} />
      <Field label="Language variety" value={draft.languageVariety} onChangeText={set('languageVariety')} error={errors.languageVariety} />
      <Field label="Research domain" value={draft.researchDomain} onChangeText={set('researchDomain')} error={errors.researchDomain} />
      <Field label="General collection location" value={draft.collectionLocation} onChangeText={set('collectionLocation')} error={errors.collectionLocation} />
      <Field label="Protocol version" value={draft.protocolVersion} onChangeText={set('protocolVersion')} error={errors.protocolVersion} autoCapitalize="none" />
      <Text style={uiStyles.muted}>All data is stored on this device. Archiving is available from the project screen.</Text>
      <Button label="Save project" onPress={submit} loading={saving} />
    </View>
  );
}

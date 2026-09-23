import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ZodIssue } from 'zod';

import { scenarioDraftSchema, type ScenarioDraft } from '../domain/scenario';
import { Button, ErrorNotice, Field, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

const methods: Array<{ value: ScenarioDraft['collectionMethod']; label: string }> = [
  { value: 'elicited_prompt', label: 'Elicited prompt' },
  { value: 'role_play', label: 'Role play' },
  { value: 'guided_interview', label: 'Guided interview' },
  { value: 'naturalistic', label: 'Naturalistic' },
  { value: 'other', label: 'Other' },
];

const blankScenario: ScenarioDraft = {
  title: '',
  description: '',
  collectionInstructions: '',
  expectedIntent: '',
  collectionMethod: 'elicited_prompt',
  version: '1.0',
  referenceData: null,
  status: 'active',
};

type Props = {
  initial?: ScenarioDraft;
  onSave: (draft: ScenarioDraft) => Promise<void>;
};

export function ScenarioForm({ initial = blankScenario, onSave }: Props) {
  const [draft, setDraft] = useState(initial);
  const [referenceText, setReferenceText] = useState(initial.referenceData ? JSON.stringify(initial.referenceData, null, 2) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof ScenarioDraft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setSubmitError(null);
    let referenceData: Record<string, unknown> | null = null;
    if (referenceText.trim()) {
      try {
        const parsed: unknown = JSON.parse(referenceText);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
        referenceData = parsed as Record<string, unknown>;
      } catch {
        setErrors((current) => ({ ...current, referenceData: 'Enter a valid JSON object, or leave this blank.' }));
        return;
      }
    }
    const result = scenarioDraftSchema.safeParse({ ...draft, referenceData });
    if (!result.success) {
      setErrors(Object.fromEntries(result.error.issues.map((issue: ZodIssue) => [String(issue.path[0]), issue.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await onSave(result.data);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The scenario could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={uiStyles.gap}>
      {submitError ? <ErrorNotice message={submitError} /> : null}
      <Field label="Scenario title" value={draft.title} onChangeText={set('title')} error={errors.title} />
      <Field label="Description" value={draft.description} onChangeText={set('description')} error={errors.description} multiline />
      <Field label="Collection instructions" value={draft.collectionInstructions} onChangeText={set('collectionInstructions')} error={errors.collectionInstructions} multiline />
      <Field label="Expected intent" value={draft.expectedIntent} onChangeText={set('expectedIntent')} error={errors.expectedIntent} autoCapitalize="none" />
      <View style={styles.methodBlock}>
        <Text style={styles.label}>Collection method</Text>
        <View style={uiStyles.row}>
          {methods.map((method) => (
            <Pressable
              key={method.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: draft.collectionMethod === method.value }}
              onPress={() => setDraft((current) => ({ ...current, collectionMethod: method.value }))}
              style={[styles.choice, draft.collectionMethod === method.value && styles.choiceSelected]}>
              <Text style={[styles.choiceText, draft.collectionMethod === method.value && styles.choiceTextSelected]}>{method.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Field label="Scenario version" value={draft.version} onChangeText={set('version')} error={errors.version} autoCapitalize="none" />
      <Field
        label="Structured reference data (optional JSON object)"
        value={referenceText}
        onChangeText={setReferenceText}
        error={errors.referenceData}
        autoCapitalize="none"
        multiline
      />
      <Text style={uiStyles.muted}>A recording will keep a snapshot of this version and prompt, even if the scenario changes later.</Text>
      <Button label="Save scenario" onPress={submit} loading={saving} />
    </View>
  );
}

const styles = StyleSheet.create({
  methodBlock: { gap: spacing.sm },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  choice: { borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.surface },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { color: colors.ink, fontSize: 14 },
  choiceTextSelected: { color: '#FFFFFF', fontWeight: '700' },
});

import { useState } from 'react';
import { Text, View } from 'react-native';
import type { ZodIssue } from 'zod';

import { nullableText } from '@/domain/common';
import { Button, ErrorNotice, Field, uiStyles } from '@/ui/components';
import { participantDraftSchema, type ParticipantDraft } from '../domain/participant';

type EditableParticipant = {
  speakerCode: string;
  primaryLanguage: string;
  languageVariety: string;
  otherLanguages: string;
  ageBracket: string;
  genderSelfDescribed: string;
  businessCategory: string;
  yearsBusinessExperience: string;
  researchNotes: string;
};

function toEditable(initial?: ParticipantDraft): EditableParticipant {
  return {
    speakerCode: initial?.speakerCode ?? '',
    primaryLanguage: initial?.primaryLanguage ?? '',
    languageVariety: initial?.languageVariety ?? '',
    otherLanguages: initial?.otherLanguages.join(', ') ?? '',
    ageBracket: initial?.ageBracket ?? '',
    genderSelfDescribed: initial?.genderSelfDescribed ?? '',
    businessCategory: initial?.businessCategory ?? '',
    yearsBusinessExperience: initial?.yearsBusinessExperience?.toString() ?? '',
    researchNotes: initial?.researchNotes ?? '',
  };
}

export function ParticipantForm({ initial, onSave }: { initial?: ParticipantDraft; onSave: (draft: ParticipantDraft) => Promise<void> }) {
  const [values, setValues] = useState(() => toEditable(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof EditableParticipant) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    const yearsText = values.yearsBusinessExperience.trim();
    const result = participantDraftSchema.safeParse({
      speakerCode: values.speakerCode,
      primaryLanguage: values.primaryLanguage,
      languageVariety: nullableText(values.languageVariety),
      otherLanguages: values.otherLanguages.split(',').map((value) => value.trim()).filter(Boolean),
      ageBracket: nullableText(values.ageBracket),
      genderSelfDescribed: nullableText(values.genderSelfDescribed),
      businessCategory: nullableText(values.businessCategory),
      yearsBusinessExperience: yearsText ? Number(yearsText) : null,
      researchNotes: nullableText(values.researchNotes),
      status: initial?.status ?? 'active',
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
      setSubmitError(error instanceof Error ? error.message : 'The participant could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={uiStyles.gap}>
      {submitError ? <ErrorNotice message={submitError} /> : null}
      <Field label="Pseudonymous speaker ID" value={values.speakerCode} onChangeText={set('speakerCode')} error={errors.speakerCode} autoCapitalize="characters" />
      <Text style={uiStyles.muted}>Do not enter a participant's name, phone number, or customer identifier.</Text>
      <Field label="Primary language" value={values.primaryLanguage} onChangeText={set('primaryLanguage')} error={errors.primaryLanguage} />
      <Field label="Self-described language variety (optional)" value={values.languageVariety} onChangeText={set('languageVariety')} error={errors.languageVariety} />
      <Field label="Other languages, comma separated (optional)" value={values.otherLanguages} onChangeText={set('otherLanguages')} error={errors.otherLanguages} />
      <Field label="Age bracket (optional)" value={values.ageBracket} onChangeText={set('ageBracket')} error={errors.ageBracket} placeholder="e.g. 25–34" />
      <Field label="Self-described gender (optional)" value={values.genderSelfDescribed} onChangeText={set('genderSelfDescribed')} error={errors.genderSelfDescribed} />
      <Field label="Business category (optional)" value={values.businessCategory} onChangeText={set('businessCategory')} error={errors.businessCategory} />
      <Field label="Years of business experience (optional)" value={values.yearsBusinessExperience} onChangeText={set('yearsBusinessExperience')} error={errors.yearsBusinessExperience} keyboardType="decimal-pad" />
      <Field label="Research notes (optional, non-identifying)" value={values.researchNotes} onChangeText={set('researchNotes')} error={errors.researchNotes} multiline />
      <Button label="Save participant" onPress={submit} loading={saving} />
    </View>
  );
}

import { useState } from 'react';
import { Text, View } from 'react-native';
import type { ZodIssue } from 'zod';

import { newId, nullableText } from '@/domain/common';
import { Button, ErrorNotice, Field, SelectField, uiStyles } from '@/ui/components';
import { participantDraftSchema, speakerCodeFromId, type ParticipantDraft } from '../domain/participant';
import {
  ageBracketOptions,
  businessCategoryOptions,
  genderOptions,
  isCustomParticipantValue,
  OTHER_PARTICIPANT_VALUE,
  primaryLanguageOptions,
} from '../domain/participant-form-options';

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
    speakerCode: initial?.speakerCode ?? speakerCodeFromId(newId()),
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
  const [customPrimaryLanguage, setCustomPrimaryLanguage] = useState(() => isCustomParticipantValue(values.primaryLanguage, primaryLanguageOptions));
  const [customGender, setCustomGender] = useState(() => isCustomParticipantValue(values.genderSelfDescribed, genderOptions));
  const [customBusinessCategory, setCustomBusinessCategory] = useState(() => isCustomParticipantValue(values.businessCategory, businessCategoryOptions));
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
      <Field label="Pseudonymous speaker ID" value={values.speakerCode} editable={false} error={errors.speakerCode} />
      <Text style={uiStyles.muted}>Generated automatically. It does not contain the participant's name, phone number, or customer identifier.</Text>
      <SelectField
        label="Primary language"
        value={customPrimaryLanguage ? OTHER_PARTICIPANT_VALUE : values.primaryLanguage}
        options={primaryLanguageOptions}
        onValueChange={(value) => {
          const custom = value === OTHER_PARTICIPANT_VALUE;
          setCustomPrimaryLanguage(custom);
          set('primaryLanguage')(custom ? '' : value);
        }}
        error={errors.primaryLanguage}
      />
      {customPrimaryLanguage ? <Field label="Enter primary language" value={values.primaryLanguage} onChangeText={set('primaryLanguage')} error={errors.primaryLanguage} autoFocus /> : null}
      <Field label="Self-described language variety (optional)" value={values.languageVariety} onChangeText={set('languageVariety')} error={errors.languageVariety} />
      <Field label="Other languages (optional)" value={values.otherLanguages} onChangeText={set('otherLanguages')} error={errors.otherLanguages} placeholder="e.g. French, Mashi" />
      <SelectField label="Age bracket (optional)" value={values.ageBracket} options={ageBracketOptions} onValueChange={set('ageBracket')} error={errors.ageBracket} />
      <SelectField
        label="Self-described gender (optional)"
        value={customGender ? OTHER_PARTICIPANT_VALUE : values.genderSelfDescribed}
        options={genderOptions}
        onValueChange={(value) => {
          const custom = value === OTHER_PARTICIPANT_VALUE;
          setCustomGender(custom);
          set('genderSelfDescribed')(custom ? '' : value);
        }}
        error={errors.genderSelfDescribed}
      />
      {customGender ? <Field label="Self-described gender" value={values.genderSelfDescribed} onChangeText={set('genderSelfDescribed')} error={errors.genderSelfDescribed} autoFocus /> : null}
      <SelectField
        label="Business category (optional)"
        value={customBusinessCategory ? OTHER_PARTICIPANT_VALUE : values.businessCategory}
        options={businessCategoryOptions}
        onValueChange={(value) => {
          const custom = value === OTHER_PARTICIPANT_VALUE;
          setCustomBusinessCategory(custom);
          set('businessCategory')(custom ? '' : value);
        }}
        error={errors.businessCategory}
      />
      {customBusinessCategory ? <Field label="Enter business category" value={values.businessCategory} onChangeText={set('businessCategory')} error={errors.businessCategory} autoFocus /> : null}
      <Field label="Years of business experience (optional)" value={values.yearsBusinessExperience} onChangeText={set('yearsBusinessExperience')} error={errors.yearsBusinessExperience} keyboardType="decimal-pad" />
      <Field label="Research notes (optional, non-identifying)" value={values.researchNotes} onChangeText={set('researchNotes')} error={errors.researchNotes} multiline />
      <Button label="Save participant" onPress={submit} loading={saving} />
    </View>
  );
}

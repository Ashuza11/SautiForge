import { useState } from 'react';
import { Text, View } from 'react-native';
import type { ZodIssue } from 'zod';

import { newId, nullableText } from '@/domain/common';
import { useI18n } from '@/i18n';
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
  const { strings, translateText } = useI18n();
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
      setErrors(Object.fromEntries(result.error.issues.map((issue: ZodIssue) => [String(issue.path[0]), translateText(issue.message)])));
      return;
    }
    setErrors({});
    setSubmitError(null);
    setSaving(true);
    try {
      await onSave(result.data);
    } catch (error) {
      setSubmitError(error instanceof Error ? translateText(error.message) : strings.participantSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={uiStyles.gap}>
      {submitError ? <ErrorNotice message={submitError} /> : null}
      <Field label={strings.speakerId} value={values.speakerCode} editable={false} error={errors.speakerCode} />
      <Text style={uiStyles.muted}>{strings.generatedAutomatically}</Text>
      <SelectField
        label={strings.primaryLanguage}
        value={customPrimaryLanguage ? OTHER_PARTICIPANT_VALUE : values.primaryLanguage}
        options={primaryLanguageOptions.map((option) => ({ ...option, label: translateText(option.label) }))}
        onValueChange={(value) => {
          const custom = value === OTHER_PARTICIPANT_VALUE;
          setCustomPrimaryLanguage(custom);
          set('primaryLanguage')(custom ? '' : value);
        }}
        error={errors.primaryLanguage}
      />
      {customPrimaryLanguage ? <Field label={strings.enterPrimaryLanguage} value={values.primaryLanguage} onChangeText={set('primaryLanguage')} error={errors.primaryLanguage} autoFocus /> : null}
      <Field label={strings.languageVarietySelf} value={values.languageVariety} onChangeText={set('languageVariety')} error={errors.languageVariety} />
      <Field label={strings.otherLanguages} value={values.otherLanguages} onChangeText={set('otherLanguages')} error={errors.otherLanguages} placeholder={strings.languageExample} />
      <SelectField label={strings.ageBracket} value={values.ageBracket} options={ageBracketOptions.map((option) => ({ ...option, label: translateText(option.label) }))} onValueChange={set('ageBracket')} error={errors.ageBracket} />
      <SelectField
        label={strings.genderOptional}
        value={customGender ? OTHER_PARTICIPANT_VALUE : values.genderSelfDescribed}
        options={genderOptions.map((option) => ({ ...option, label: translateText(option.label) }))}
        onValueChange={(value) => {
          const custom = value === OTHER_PARTICIPANT_VALUE;
          setCustomGender(custom);
          set('genderSelfDescribed')(custom ? '' : value);
        }}
        error={errors.genderSelfDescribed}
      />
      {customGender ? <Field label={strings.gender} value={values.genderSelfDescribed} onChangeText={set('genderSelfDescribed')} error={errors.genderSelfDescribed} autoFocus /> : null}
      <SelectField
        label={strings.businessCategory}
        value={customBusinessCategory ? OTHER_PARTICIPANT_VALUE : values.businessCategory}
        options={businessCategoryOptions.map((option) => ({ ...option, label: translateText(option.label) }))}
        onValueChange={(value) => {
          const custom = value === OTHER_PARTICIPANT_VALUE;
          setCustomBusinessCategory(custom);
          set('businessCategory')(custom ? '' : value);
        }}
        error={errors.businessCategory}
      />
      {customBusinessCategory ? <Field label={strings.enterBusinessCategory} value={values.businessCategory} onChangeText={set('businessCategory')} error={errors.businessCategory} autoFocus /> : null}
      <Field label={strings.businessExperience} value={values.yearsBusinessExperience} onChangeText={set('yearsBusinessExperience')} error={errors.yearsBusinessExperience} keyboardType="decimal-pad" />
      <Field label={strings.researchNotes} value={values.researchNotes} onChangeText={set('researchNotes')} error={errors.researchNotes} multiline />
      <Button label={strings.saveParticipant} onPress={submit} loading={saving} />
    </View>
  );
}

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ZodIssue } from 'zod';

import { nullableText, nowIso } from '@/domain/common';
import { Button, ErrorNotice, Field, uiStyles } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';
import { consentDraftSchema, type ConsentDraft, type ConsentRecord } from '../domain/consent';

type ConsentUse = 'internalResearch' | 'restrictedAnnotation' | 'publicRelease';

export function ConsentForm({ current, onSave }: { current: ConsentRecord | null; onSave: (draft: ConsentDraft) => Promise<void> }) {
  const [status, setStatus] = useState<ConsentDraft['status']>(current?.status ?? 'granted');
  const [uses, setUses] = useState({
    internalResearch: current?.internalResearch ?? true,
    restrictedAnnotation: current?.restrictedAnnotation ?? false,
    publicRelease: current?.publicRelease ?? false,
  });
  const [protocolVersion, setProtocolVersion] = useState(current?.consentProtocolVersion ?? '1.0');
  const [recordedBy, setRecordedBy] = useState(current?.recordedBy ?? '');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectStatus = (next: ConsentDraft['status']) => {
    setStatus(next);
    if (next !== 'granted') setUses({ internalResearch: false, restrictedAnnotation: false, publicRelease: false });
  };
  const toggleUse = (key: ConsentUse) => {
    if (status !== 'granted') return;
    setUses((currentUses) => ({ ...currentUses, [key]: !currentUses[key] }));
  };

  const submit = async () => {
    const result = consentDraftSchema.safeParse({
      status,
      ...uses,
      recordedBy: nullableText(recordedBy),
      consentedAt: nowIso(),
      validUntil: null,
      notes: nullableText(notes),
      consentProtocolVersion: protocolVersion,
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
      setSubmitError(error instanceof Error ? error.message : 'Consent could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={uiStyles.gap}>
      {submitError ? <ErrorNotice message={submitError} /> : null}
      <Text style={styles.label}>Consent decision</Text>
      <View style={uiStyles.row}>
        {(['granted', 'declined', 'withdrawn'] as const).map((option) => (
          <Pressable key={option} onPress={() => selectStatus(option)} style={[styles.choice, status === option && styles.choiceSelected]}>
            <Text style={[styles.choiceText, status === option && styles.choiceTextSelected]}>{option}</Text>
          </Pressable>
        ))}
      </View>
      {errors.status ? <Text style={styles.error}>{errors.status}</Text> : null}
      <Text style={styles.label}>Approved uses</Text>
      <ConsentToggle label="Internal research and recording" selected={uses.internalResearch} onPress={() => toggleUse('internalResearch')} disabled={status !== 'granted'} />
      <ConsentToggle label="Restricted annotation sharing" selected={uses.restrictedAnnotation} onPress={() => toggleUse('restrictedAnnotation')} disabled={status !== 'granted'} />
      <ConsentToggle label="Public dataset release" selected={uses.publicRelease} onPress={() => toggleUse('publicRelease')} disabled={status !== 'granted'} />
      {errors.publicRelease ? <Text style={styles.error}>{errors.publicRelease}</Text> : null}
      <Field label="Consent protocol version" value={protocolVersion} onChangeText={setProtocolVersion} error={errors.consentProtocolVersion} autoCapitalize="none" />
      <Field label="Recorded by (optional researcher code)" value={recordedBy} onChangeText={setRecordedBy} error={errors.recordedBy} />
      <Field label="Consent notes (optional, administrative)" value={notes} onChangeText={setNotes} error={errors.notes} multiline />
      <Text style={uiStyles.muted}>Saving creates a new historical record. It never edits or deletes the previous decision.</Text>
      <Button label="Save consent revision" onPress={submit} loading={saving} />
    </View>
  );
}

function ConsentToggle({ label, selected, onPress, disabled }: { label: string; selected: boolean; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.toggle, selected && styles.toggleSelected, disabled && styles.disabled]}>
      <Text style={[styles.toggleMark, selected && styles.toggleMarkSelected]}>{selected ? '✓' : ''}</Text>
      <Text style={styles.toggleLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  choice: { borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.surface },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { color: colors.ink, textTransform: 'capitalize' },
  choiceTextSelected: { color: '#FFFFFF', fontWeight: '700' },
  toggle: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 12, padding: spacing.sm },
  toggleSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  toggleMark: { width: 28, height: 28, borderWidth: 2, borderColor: colors.muted, borderRadius: 7, textAlign: 'center', lineHeight: 24, color: colors.surface, fontWeight: '900' },
  toggleMarkSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleLabel: { flex: 1, color: colors.ink, fontSize: 15 },
  disabled: { opacity: 0.45 },
  error: { color: colors.danger, fontSize: 13 },
});

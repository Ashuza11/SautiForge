import { useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from './theme';

export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  const content = scroll ? (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.screenContent}>
      {children}
    </ScrollView>
  ) : (
    <View style={styles.screenContent}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.keyboardArea} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Heading({ children, subtitle }: PropsWithChildren<{ subtitle?: string }>) {
  return (
    <View style={styles.headingBlock}>
      <Text style={styles.heading}>{children}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Card({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
};

export function Button({ label, onPress, disabled, loading, variant = 'primary' }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        pressed && styles.buttonPressed,
        (disabled || loading) && styles.buttonDisabled,
      ]}>
      {loading ? <ActivityIndicator color={variant === 'secondary' ? colors.primary : '#FFFFFF'} /> : (
        <Text style={[styles.buttonLabel, variant === 'secondary' && styles.buttonLabelSecondary]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, error, multiline, ...props }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        multiline={multiline}
        placeholderTextColor="#8B938E"
        style={[styles.input, multiline && styles.multiline, error && styles.inputError]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export type SelectOption = { label: string; value: string };

export function SelectField({ label, value, options, onValueChange, placeholder = 'Select an option', error }: {
  label: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.select, pressed && styles.buttonPressed, error && styles.inputError]}>
        <Text style={selected ? styles.selectText : styles.selectPlaceholder}>{selected?.label ?? placeholder}</Text>
        <Text style={styles.selectArrow}>⌄</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel="Close options" style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={styles.optionSheet}>
            <Text style={styles.optionTitle}>{label}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: option.value === value }}
                  onPress={() => { onValueChange(option.value); setOpen(false); }}
                  style={[styles.option, option.value === value && styles.optionSelected]}>
                  <Text style={[styles.optionText, option.value === value && styles.optionTextSelected]}>{option.label}</Text>
                  {option.value === value ? <Text style={styles.optionCheck}>✓</Text> : null}
                </Pressable>
              ))}
            </ScrollView>
            <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function EmptyState({ children }: PropsWithChildren) {
  return <Text style={styles.empty}>{children}</Text>;
}

export function ErrorNotice({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <View style={styles.errorNotice}>
      <Text style={styles.errorNoticeText}>{message}</Text>
      {action}
    </View>
  );
}

export const uiStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  grow: { flex: 1 },
  title: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  body: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  badge: { alignSelf: 'flex-start', color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 12, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  gap: { gap: spacing.md },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  keyboardArea: { flex: 1 },
  screenContent: { flexGrow: 1, padding: spacing.md, paddingBottom: 120, gap: spacing.md },
  headingBlock: { gap: spacing.xs, marginBottom: spacing.xs },
  heading: { color: colors.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: spacing.md, gap: spacing.sm },
  button: { minHeight: 50, borderRadius: 12, backgroundColor: colors.primary, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  buttonDanger: { backgroundColor: colors.danger },
  buttonPressed: { opacity: 0.82 },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  buttonLabelSecondary: { color: colors.primary },
  field: { gap: spacing.xs },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: colors.ink, backgroundColor: colors.surface, fontSize: 16 },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger },
  select: { minHeight: 50, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selectText: { flex: 1, color: colors.ink, fontSize: 16 },
  selectPlaceholder: { flex: 1, color: '#8B938E', fontSize: 16 },
  selectArrow: { color: colors.primary, fontSize: 24, fontWeight: '700' },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20, 28, 24, 0.45)' },
  optionSheet: { maxHeight: '75%', padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm, backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  optionTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', marginBottom: spacing.xs },
  option: { minHeight: 50, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  optionSelected: { backgroundColor: colors.primarySoft, borderRadius: 10, borderBottomWidth: 0 },
  optionText: { flex: 1, color: colors.ink, fontSize: 16 },
  optionTextSelected: { color: colors.primary, fontWeight: '700' },
  optionCheck: { color: colors.primary, fontSize: 18, fontWeight: '900' },
  error: { color: colors.danger, fontSize: 13 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: spacing.xl, fontSize: 15 },
  errorNotice: { borderWidth: 1, borderColor: '#E5BABA', backgroundColor: '#FFF0F0', borderRadius: 12, padding: spacing.md, gap: spacing.sm },
  errorNoticeText: { color: colors.danger, lineHeight: 20 },
});

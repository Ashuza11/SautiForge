import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { ConsentDraft, ConsentRecord } from '@/features/consent/domain/consent';
import { ConsentForm } from '@/features/consent/presentation/consent-form';
import { useI18n } from '@/i18n';
import { EmptyState, ErrorNotice, Heading, Screen } from '@/ui/components';

export default function NewConsentRevisionScreen() {
  const { strings, translateText } = useI18n();
  const params = useLocalSearchParams<{ participantId: string }>();
  const participantId = Array.isArray(params.participantId) ? params.participantId[0] : params.participantId;
  const { consent } = useRepositories();
  const [current, setCurrent] = useState<ConsentRecord | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!participantId) return;
    consent.getCurrent(participantId).then(setCurrent).catch((cause: unknown) => setError(cause instanceof Error ? translateText(cause.message) : strings.consentLoadFailed));
  }, [consent, participantId, strings, translateText]);
  if (error) return <Screen><ErrorNotice message={error} /></Screen>;
  if (current === undefined) return <Screen><EmptyState>{strings.loadingConsent}</EmptyState></Screen>;
  const save = async (draft: ConsentDraft) => {
    if (!participantId) throw new Error(strings.participantIdMissing);
    await consent.createRevision(participantId, draft);
    router.back();
  };
  return <Screen><Heading>{strings.consentDecision}</Heading><ConsentForm current={current} onSave={save} /></Screen>;
}

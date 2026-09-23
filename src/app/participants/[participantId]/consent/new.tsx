import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { ConsentDraft, ConsentRecord } from '@/features/consent/domain/consent';
import { ConsentForm } from '@/features/consent/presentation/consent-form';
import { EmptyState, ErrorNotice, Heading, Screen } from '@/ui/components';

export default function NewConsentRevisionScreen() {
  const params = useLocalSearchParams<{ participantId: string }>();
  const participantId = Array.isArray(params.participantId) ? params.participantId[0] : params.participantId;
  const { consent } = useRepositories();
  const [current, setCurrent] = useState<ConsentRecord | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!participantId) return;
    consent.getCurrent(participantId).then(setCurrent).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Consent could not be loaded.'));
  }, [consent, participantId]);
  if (error) return <Screen><ErrorNotice message={error} /></Screen>;
  if (current === undefined) return <Screen><EmptyState>Loading consent…</EmptyState></Screen>;
  const save = async (draft: ConsentDraft) => {
    if (!participantId) throw new Error('Participant ID is missing.');
    await consent.createRevision(participantId, draft);
    router.back();
  };
  return <Screen><Heading subtitle="Approved uses control recording and future export eligibility.">Consent decision</Heading><ConsentForm current={current} onSave={save} /></Screen>;
}

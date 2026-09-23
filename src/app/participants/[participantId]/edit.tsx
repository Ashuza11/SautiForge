import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { Participant, ParticipantDraft } from '@/features/participants/domain/participant';
import { ParticipantForm } from '@/features/participants/presentation/participant-form';
import { EmptyState, ErrorNotice, Heading, Screen } from '@/ui/components';

export default function EditParticipantScreen() {
  const params = useLocalSearchParams<{ participantId: string }>();
  const participantId = Array.isArray(params.participantId) ? params.participantId[0] : params.participantId;
  const { participants } = useRepositories();
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!participantId) return;
    participants.get(participantId).then(setParticipant).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Participant could not be loaded.'));
  }, [participantId, participants]);
  if (error) return <Screen><ErrorNotice message={error} /></Screen>;
  if (!participant) return <Screen><EmptyState>Loading participant…</EmptyState></Screen>;
  const initial: ParticipantDraft = { ...participant };
  const save = async (draft: ParticipantDraft) => {
    await participants.update(participant.id, draft);
    router.back();
  };
  return <Screen><Heading>Edit participant</Heading><ParticipantForm initial={initial} onSave={save} /></Screen>;
}

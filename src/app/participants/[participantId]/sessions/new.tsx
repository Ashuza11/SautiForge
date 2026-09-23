import { router, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { SessionDraft } from '@/features/sessions/domain/session';
import { SessionForm } from '@/features/sessions/presentation/session-form';
import { Heading, Screen } from '@/ui/components';

export default function NewSessionScreen() {
  const params = useLocalSearchParams<{ participantId: string }>();
  const participantId = Array.isArray(params.participantId) ? params.participantId[0] : params.participantId;
  const { participants, sessions } = useRepositories();
  const save = async (draft: SessionDraft) => {
    if (!participantId) throw new Error('Participant ID is missing.');
    const participant = await participants.get(participantId);
    if (!participant) throw new Error('Participant not found.');
    const session = await sessions.create(participant.projectId, participant.id, draft);
    router.replace(`/sessions/${session.id}`);
  };
  return <Screen><Heading subtitle="Consent is checked again before the session is created.">Start collection session</Heading><SessionForm onSave={save} /></Screen>;
}

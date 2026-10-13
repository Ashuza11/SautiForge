import { router, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { SessionDraft } from '@/features/sessions/domain/session';
import { SessionForm } from '@/features/sessions/presentation/session-form';
import { useI18n } from '@/i18n';
import { Heading, Screen } from '@/ui/components';

export default function NewSessionScreen() {
  const { strings } = useI18n();
  const params = useLocalSearchParams<{ participantId: string }>();
  const participantId = Array.isArray(params.participantId) ? params.participantId[0] : params.participantId;
  const { participants, sessions } = useRepositories();
  const save = async (draft: SessionDraft) => {
    if (!participantId) throw new Error(strings.participantIdMissing);
    const participant = await participants.get(participantId);
    if (!participant) throw new Error(strings.participantNotFound);
    const session = await sessions.create(participant.projectId, participant.id, draft);
    router.replace(`/sessions/${session.id}`);
  };
  return <Screen><Heading>{strings.startCollectionSession}</Heading><SessionForm onSave={save} /></Screen>;
}

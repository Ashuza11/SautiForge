import { router, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { ParticipantDraft } from '@/features/participants/domain/participant';
import { ParticipantForm } from '@/features/participants/presentation/participant-form';
import { useI18n } from '@/i18n';
import { Heading, Screen } from '@/ui/components';

export default function NewParticipantScreen() {
  const { strings } = useI18n();
  const params = useLocalSearchParams<{ projectId: string }>();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const { participants } = useRepositories();
  const save = async (draft: ParticipantDraft) => {
    if (!projectId) throw new Error(strings.projectIdMissing);
    const participant = await participants.create(projectId, draft);
    router.replace(`/participants/${participant.id}`);
  };
  return <Screen><Heading>{strings.registerParticipant}</Heading><ParticipantForm onSave={save} /></Screen>;
}

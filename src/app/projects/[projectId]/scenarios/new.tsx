import { router, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { ScenarioDraft } from '@/features/scenarios/domain/scenario';
import { ScenarioForm } from '@/features/scenarios/presentation/scenario-form';
import { useI18n } from '@/i18n';
import { Heading, Screen } from '@/ui/components';

export default function NewScenarioScreen() {
  const { strings } = useI18n();
  const params = useLocalSearchParams<{ projectId: string }>();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const { scenarios } = useRepositories();
  const save = async (draft: ScenarioDraft) => {
    if (!projectId) throw new Error(strings.projectIdMissing);
    await scenarios.create(projectId, draft);
    router.back();
  };
  return <Screen><Heading>{strings.newScenario}</Heading><ScenarioForm onSave={save} /></Screen>;
}

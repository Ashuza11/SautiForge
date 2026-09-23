import { router, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { ScenarioDraft } from '@/features/scenarios/domain/scenario';
import { ScenarioForm } from '@/features/scenarios/presentation/scenario-form';
import { Heading, Screen } from '@/ui/components';

export default function NewScenarioScreen() {
  const params = useLocalSearchParams<{ projectId: string }>();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const { scenarios } = useRepositories();
  const save = async (draft: ScenarioDraft) => {
    if (!projectId) throw new Error('Project ID is missing.');
    await scenarios.create(projectId, draft);
    router.back();
  };
  return <Screen><Heading subtitle="Prompts stay separate from recording logic and can evolve by version.">New scenario</Heading><ScenarioForm onSave={save} /></Screen>;
}

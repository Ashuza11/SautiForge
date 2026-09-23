import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { useRepositories } from '@/core/database/repositories';
import type { Scenario, ScenarioDraft } from '@/features/scenarios/domain/scenario';
import { ScenarioForm } from '@/features/scenarios/presentation/scenario-form';
import { EmptyState, ErrorNotice, Heading, Screen } from '@/ui/components';

export default function EditScenarioScreen() {
  const params = useLocalSearchParams<{ scenarioId: string }>();
  const scenarioId = Array.isArray(params.scenarioId) ? params.scenarioId[0] : params.scenarioId;
  const { scenarios } = useRepositories();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scenarioId) return;
    scenarios.get(scenarioId).then(setScenario).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Scenario could not be loaded.'));
  }, [scenarioId, scenarios]);

  if (error) return <Screen><ErrorNotice message={error} /></Screen>;
  if (!scenario) return <Screen><EmptyState>Loading scenario…</EmptyState></Screen>;
  const initial: ScenarioDraft = { ...scenario };
  const save = async (draft: ScenarioDraft) => {
    await scenarios.update(scenario.id, draft);
    router.back();
  };
  return <Screen><Heading>Edit scenario</Heading><ScenarioForm initial={initial} onSave={save} /></Screen>;
}

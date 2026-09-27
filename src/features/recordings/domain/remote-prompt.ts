type RemotePromptInput = {
  speakerCode: string;
  submissionId: string;
  scenarioTitle: string;
  instructions: string;
  fictionalExample: string;
};

export function buildRemotePrompt(input: RemotePromptInput): string {
  const example = input.fictionalExample.trim();
  return [
    'SautiForge speech task',
    `Speaker code: ${input.speakerCode}`,
    `Submission code: ${input.submissionId}`,
    `Scenario: ${input.scenarioTitle}`,
    `Instructions: ${input.instructions}`,
    example ? `Fictional situation/example: ${example}` : null,
    'Please speak naturally in your usual language variety. Do not share real customer names, phone numbers, account details, credentials, or mobile-money PINs.',
    'Send one voice note for this task only.',
  ].filter(Boolean).join('\n\n');
}
